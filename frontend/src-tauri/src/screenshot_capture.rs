use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::activity_monitor::{active_window, MonitorRuntime};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct ScreenshotSettings {
    /// UI Automation content reading is independently opt-in.
    pub uia_enabled: bool,
    /// Screenshot OCR is a separately authorized fallback.
    pub enabled: bool,
    pub interval_minutes: u8,
    /// 0 deletes the raw image after OCR. Other supported values are 1, 3 and 7 days.
    pub retain_raw_days: u8,
}

impl Default for ScreenshotSettings {
    fn default() -> Self {
        Self {
            uia_enabled: false,
            enabled: false,
            interval_minutes: 10,
            retain_raw_days: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ContentAcquisitionDecision {
    Skip,
    ReadUia,
    UseOcrFallback,
}

impl ScreenshotSettings {
    fn decide_content_acquisition(&self, uia_has_content: bool) -> ContentAcquisitionDecision {
        if !self.uia_enabled {
            ContentAcquisitionDecision::Skip
        } else if uia_has_content {
            ContentAcquisitionDecision::ReadUia
        } else if self.enabled {
            ContentAcquisitionDecision::UseOcrFallback
        } else {
            ContentAcquisitionDecision::Skip
        }
    }

    fn validate(self) -> Result<Self, String> {
        if !(1..=30).contains(&self.interval_minutes) {
            return Err("截图间隔必须在 1–30 分钟之间".into());
        }
        if ![0, 1, 3, 7].contains(&self.retain_raw_days) {
            return Err("原图保留天数只能是 0、1、3 或 7".into());
        }
        Ok(self)
    }
}

#[derive(Clone)]
pub struct ScreenshotRuntime {
    settings: Arc<Mutex<ScreenshotSettings>>,
    settings_path: PathBuf,
    screenshot_dir: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
pub struct ScreenshotPreview {
    pub image_path: Option<String>,
    pub ocr_text: String,
}

impl ScreenshotRuntime {
    pub fn new(data_dir: &Path) -> Self {
        let settings_path = data_dir.join("screenshot-settings.json");
        let settings = std::fs::read_to_string(&settings_path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default();
        Self {
            settings: Arc::new(Mutex::new(settings)),
            settings_path,
            screenshot_dir: data_dir.join("screenshots"),
        }
    }

    pub fn settings(&self) -> Result<ScreenshotSettings, String> {
        self.settings
            .lock()
            .map(|value| value.clone())
            .map_err(|_| "截图设置不可用".into())
    }

    pub fn save_settings(
        &self,
        settings: ScreenshotSettings,
    ) -> Result<ScreenshotSettings, String> {
        let settings = settings.validate()?;
        if let Some(parent) = self.settings_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        std::fs::write(
            &self.settings_path,
            serde_json::to_vec(&settings).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        *self
            .settings
            .lock()
            .map_err(|_| "截图设置不可用".to_string())? = settings.clone();
        Ok(settings)
    }

    pub fn start(&self, monitor: MonitorRuntime) {
        let runtime = self.clone();
        let _ = std::thread::Builder::new()
            .name("traceflow-screenshot-ocr".into())
            .spawn(move || {
                let mut last_capture = 0u64;
                loop {
                    let settings = runtime.settings().unwrap_or_default();
                    let now = unix_seconds();
                    let due =
                        now.saturating_sub(last_capture) >= settings.interval_minutes as u64 * 60;
                    if settings.uia_enabled && due {
                        if let Some(window) = active_window()
                            .filter(|window| monitor.can_capture_now(&window.application_name))
                        {
                            let uia_text = read_active_window_uia_text().unwrap_or_default();
                            let result = match settings
                                .decide_content_acquisition(!uia_text.trim().is_empty())
                            {
                                ContentAcquisitionDecision::ReadUia => {
                                    send_ocr_observation(&window.application_name, &uia_text)
                                }
                                ContentAcquisitionDecision::UseOcrFallback => runtime
                                    .capture_ocr_and_store(&window.application_name, &settings),
                                ContentAcquisitionDecision::Skip => Ok(()),
                            };
                            let _ = result;
                            last_capture = now;
                        }
                    }
                    let _ = runtime.cleanup_encrypted_raw(settings.retain_raw_days);
                    std::thread::sleep(Duration::from_secs(10));
                }
            });
    }

    pub fn capture_preview(&self) -> Result<ScreenshotPreview, String> {
        std::fs::create_dir_all(&self.screenshot_dir).map_err(|error| error.to_string())?;
        let file = self
            .screenshot_dir
            .join(format!("preview-{}.bmp", unix_millis()));
        capture_active_window(&file)?;
        let recognized = local_ocr(&file);
        let _ = std::fs::remove_file(&file);
        let ocr_text = recognized?;
        Ok(ScreenshotPreview {
            image_path: None,
            ocr_text,
        })
    }

    fn capture_ocr_and_store(
        &self,
        application_name: &str,
        settings: &ScreenshotSettings,
    ) -> Result<(), String> {
        std::fs::create_dir_all(&self.screenshot_dir).map_err(|error| error.to_string())?;
        let stamp = unix_millis();
        let raw = self.screenshot_dir.join(format!("capture-{stamp}.bmp"));
        capture_active_window(&raw)?;
        let ocr_result = local_ocr(&raw);
        if settings.retain_raw_days == 0 {
            let _ = std::fs::remove_file(&raw);
        } else {
            let encrypted = self.screenshot_dir.join(format!("capture-{stamp}.tfshot"));
            let protected =
                protect_bytes(&std::fs::read(&raw).map_err(|error| error.to_string())?)?;
            std::fs::write(encrypted, protected).map_err(|error| error.to_string())?;
            let _ = std::fs::remove_file(&raw);
        }
        let text = ocr_result?;
        if !text.trim().is_empty() {
            send_ocr_observation(application_name, &text)?;
        }
        Ok(())
    }

    fn cleanup_encrypted_raw(&self, retain_days: u8) -> Result<(), String> {
        if !self.screenshot_dir.exists() {
            return Ok(());
        }
        let maximum_age = Duration::from_secs(retain_days as u64 * 24 * 60 * 60);
        for entry in std::fs::read_dir(&self.screenshot_dir).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if entry.path().extension().and_then(|value| value.to_str()) != Some("tfshot") {
                continue;
            }
            let age = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| modified.elapsed().ok())
                .unwrap_or_default();
            if retain_days == 0 || age > maximum_age {
                let _ = std::fs::remove_file(entry.path());
            }
        }
        Ok(())
    }
}

#[cfg(windows)]
fn read_active_window_uia_text() -> Result<String, String> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let window = unsafe { GetForegroundWindow() };
    if window.0.is_null() {
        return Err("未找到活动窗口".into());
    }
    read_uia_text_from_handle(window)
}

pub fn capture_active_window_uia_preview() -> Result<ScreenshotPreview, String> {
    let text = read_active_window_uia_text()?;
    if text.trim().is_empty() {
        return Err("当前窗口没有可读取的 UI Automation 文本".into());
    }
    Ok(ScreenshotPreview {
        image_path: None,
        ocr_text: text,
    })
}

pub fn is_wecom_application(application_name: &str) -> bool {
    matches!(
        application_name.to_ascii_lowercase().as_str(),
        "wxwork.exe" | "wecom.exe"
    )
}

#[cfg(windows)]
fn read_uia_text_from_handle(window: windows::Win32::Foundation::HWND) -> Result<String, String> {
    use std::collections::HashSet;
    use windows::core::Interface;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern,
        IUIAutomationValuePattern, TreeScope_Subtree, UIA_TextPatternId, UIA_ValuePatternId,
    };

    fn push_text(
        text: String,
        seen: &mut HashSet<String>,
        lines: &mut Vec<String>,
        total: &mut usize,
    ) {
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.len() < 2 || *total + text.len() > 12_000 || !seen.insert(text.clone()) {
            return;
        }
        *total += text.len();
        lines.push(text);
    }

    unsafe fn element_text(element: &IUIAutomationElement) -> Vec<String> {
        if element
            .CurrentIsPassword()
            .map(|value| value.as_bool())
            .unwrap_or(true)
        {
            return Vec::new();
        }
        let mut values = Vec::new();
        if let Ok(pattern) = element
            .GetCurrentPattern(UIA_TextPatternId)
            .and_then(|pattern| pattern.cast::<IUIAutomationTextPattern>())
        {
            if let Ok(text) = pattern
                .DocumentRange()
                .and_then(|range| range.GetText(12_000))
            {
                values.push(text.to_string());
            }
        }
        if let Ok(pattern) = element
            .GetCurrentPattern(UIA_ValuePatternId)
            .and_then(|pattern| pattern.cast::<IUIAutomationValuePattern>())
        {
            if let Ok(text) = pattern.CurrentValue() {
                values.push(text.to_string());
            }
        }
        if let Ok(name) = element.CurrentName() {
            values.push(name.to_string());
        }
        values
    }

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                .map_err(|error| error.to_string())?;
        let root = automation
            .ElementFromHandle(window)
            .map_err(|error| error.to_string())?;
        let condition = automation
            .CreateTrueCondition()
            .map_err(|error| error.to_string())?;
        let elements = root
            .FindAll(TreeScope_Subtree, &condition)
            .map_err(|error| error.to_string())?;
        let length = elements
            .Length()
            .map_err(|error| error.to_string())?
            .min(300);
        let mut seen = HashSet::new();
        let mut lines = Vec::new();
        let mut total = 0usize;
        for index in 0..length {
            let Ok(element) = elements.GetElement(index) else {
                continue;
            };
            for text in element_text(&element) {
                push_text(text, &mut seen, &mut lines, &mut total);
            }
            if total >= 12_000 {
                break;
            }
        }
        Ok(lines.join("\n"))
    }
}

#[cfg(not(windows))]
fn read_active_window_uia_text() -> Result<String, String> {
    Err("UI Automation 内容读取仅支持 Windows".into())
}

fn unix_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn send_ocr_observation(application_name: &str, recognized_text: &str) -> Result<(), String> {
    let captured_at = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|error| error.to_string())?;
    let body = serde_json::to_vec(&serde_json::json!({
        "capturedAt": captured_at,
        "applicationName": application_name,
        "recognizedText": recognized_text,
    }))
    .map_err(|error| error.to_string())?;
    let mut stream =
        TcpStream::connect_timeout(&"127.0.0.1:17890".parse().unwrap(), Duration::from_secs(2))
            .map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| error.to_string())?;
    write!(stream, "POST /api/ocr/ingest HTTP/1.1\r\nHost: 127.0.0.1:17890\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).map_err(|error| error.to_string())?;
    stream.write_all(&body).map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    if response.starts_with("HTTP/1.1 201") || response.starts_with("HTTP/1.0 201") {
        Ok(())
    } else {
        Err("本地 OCR 文本入库失败".into())
    }
}

#[cfg(windows)]
fn protect_bytes(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    use windows::core::w;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: plaintext.len() as u32,
            pbData: plaintext.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        CryptProtectData(
            &input,
            w!("TraceFlow encrypted screenshot"),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| error.to_string())?;
        let protected = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(protected)
    }
}

#[cfg(not(windows))]
fn protect_bytes(_plaintext: &[u8]) -> Result<Vec<u8>, String> {
    Err("一期截图加密仅支持 Windows".into())
}

#[cfg(windows)]
fn local_ocr(path: &Path) -> Result<String, String> {
    use windows::core::HSTRING;
    use windows::Graphics::Imaging::BitmapDecoder;
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::{FileAccessMode, StorageFile};
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    unsafe {
        RoInitialize(RO_INIT_MULTITHREADED).ok();
    }
    let absolute = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
    let absolute_text = absolute.to_string_lossy();
    let winrt_path = absolute_text
        .strip_prefix(r"\\?\")
        .unwrap_or(absolute_text.as_ref());
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(winrt_path))
        .map_err(|error| error.to_string())?
        .get()
        .map_err(|error| error.to_string())?;
    let stream = file
        .OpenAsync(FileAccessMode::Read)
        .map_err(|error| error.to_string())?
        .get()
        .map_err(|error| error.to_string())?;
    let decoder = BitmapDecoder::CreateAsync(&stream)
        .map_err(|error| error.to_string())?
        .get()
        .map_err(|error| error.to_string())?;
    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|error| error.to_string())?
        .get()
        .map_err(|error| error.to_string())?;
    let engine =
        OcrEngine::TryCreateFromUserProfileLanguages().map_err(|error| error.to_string())?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|error| error.to_string())?
        .get()
        .map_err(|error| error.to_string())?;
    result
        .Text()
        .map(|text| text.to_string())
        .map_err(|error| error.to_string())
}

#[cfg(not(windows))]
fn local_ocr(_path: &Path) -> Result<String, String> {
    Err("一期本地 OCR 仅支持 Windows".into())
}

#[cfg(windows)]
fn capture_active_window(path: &Path) -> Result<(), String> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
        GetWindowDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        HGDIOBJ, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect};

    unsafe {
        let window = GetForegroundWindow();
        if window.0.is_null() {
            return Err("未找到活动窗口".into());
        }
        let mut rect = RECT::default();
        GetWindowRect(window, &mut rect).map_err(|error| error.to_string())?;
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width <= 0 || height <= 0 {
            return Err("活动窗口尺寸无效".into());
        }

        let source_dc = GetWindowDC(Some(window));
        if source_dc.0.is_null() {
            return Err("无法读取活动窗口画面".into());
        }
        let memory_dc = CreateCompatibleDC(Some(source_dc));
        let bitmap = CreateCompatibleBitmap(source_dc, width, height);
        if memory_dc.0.is_null() || bitmap.0.is_null() {
            let _ = ReleaseDC(Some(window), source_dc);
            return Err("无法创建截图缓冲区".into());
        }
        let old = SelectObject(memory_dc, HGDIOBJ(bitmap.0));
        let result = BitBlt(
            memory_dc,
            0,
            0,
            width,
            height,
            Some(source_dc),
            0,
            0,
            SRCCOPY,
        );
        if let Err(error) = result {
            SelectObject(memory_dc, old);
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            let _ = DeleteDC(memory_dc);
            let _ = ReleaseDC(Some(window), source_dc);
            return Err(error.to_string());
        }

        let image_size = width as usize * height as usize * 4;
        let mut pixels = vec![0u8; image_size];
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: image_size as u32,
                ..Default::default()
            },
            ..Default::default()
        };
        let scan_lines = GetDIBits(
            memory_dc,
            bitmap,
            0,
            height as u32,
            Some(pixels.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        );
        SelectObject(memory_dc, old);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory_dc);
        let _ = ReleaseDC(Some(window), source_dc);
        if scan_lines == 0 {
            return Err("无法读取截图像素".into());
        }

        let file_size = 14 + 40 + pixels.len();
        let mut bmp = Vec::with_capacity(file_size);
        bmp.extend_from_slice(b"BM");
        bmp.extend_from_slice(&(file_size as u32).to_le_bytes());
        bmp.extend_from_slice(&[0; 4]);
        bmp.extend_from_slice(&(54u32).to_le_bytes());
        bmp.extend_from_slice(&(40u32).to_le_bytes());
        bmp.extend_from_slice(&width.to_le_bytes());
        bmp.extend_from_slice(&(-height).to_le_bytes());
        bmp.extend_from_slice(&(1u16).to_le_bytes());
        bmp.extend_from_slice(&(32u16).to_le_bytes());
        bmp.extend_from_slice(&(0u32).to_le_bytes());
        bmp.extend_from_slice(&(pixels.len() as u32).to_le_bytes());
        bmp.extend_from_slice(&[0; 16]);
        bmp.extend_from_slice(&pixels);
        std::fs::write(path, bmp).map_err(|error| error.to_string())
    }
}

#[cfg(not(windows))]
fn capture_active_window(_path: &Path) -> Result<(), String> {
    Err("一期活动窗口截图仅支持 Windows".into())
}

#[cfg(test)]
mod tests {
    use super::{ContentAcquisitionDecision, ScreenshotSettings};

    #[test]
    fn content_collection_does_nothing_without_explicit_uia_consent() {
        let settings = ScreenshotSettings::default();
        assert_eq!(
            settings.decide_content_acquisition(false),
            ContentAcquisitionDecision::Skip
        );
    }

    #[test]
    fn wecom_reader_is_restricted_to_known_client_processes() {
        assert!(super::is_wecom_application("WXWork.exe"));
        assert!(super::is_wecom_application("wecom.EXE"));
        assert!(!super::is_wecom_application("Code.exe"));
    }

    #[test]
    fn uia_content_wins_even_when_ocr_fallback_is_authorized() {
        let settings = ScreenshotSettings {
            uia_enabled: true,
            enabled: true,
            ..Default::default()
        };
        assert_eq!(
            settings.decide_content_acquisition(true),
            ContentAcquisitionDecision::ReadUia
        );
    }

    #[test]
    fn ocr_is_used_only_when_uia_is_empty_and_fallback_is_authorized() {
        let settings = ScreenshotSettings {
            uia_enabled: true,
            enabled: true,
            ..Default::default()
        };
        assert_eq!(
            settings.decide_content_acquisition(false),
            ContentAcquisitionDecision::UseOcrFallback
        );
        let settings = ScreenshotSettings {
            uia_enabled: true,
            enabled: false,
            ..Default::default()
        };
        assert_eq!(
            settings.decide_content_acquisition(false),
            ContentAcquisitionDecision::Skip
        );
    }

    #[test]
    fn screenshot_is_opt_in_with_safe_retention_defaults() {
        let settings = ScreenshotSettings::default();
        assert!(!settings.enabled);
        assert_eq!(settings.interval_minutes, 10);
        assert_eq!(settings.retain_raw_days, 0);
    }

    #[test]
    fn screenshot_frequency_and_retention_are_bounded() {
        let mut settings = ScreenshotSettings::default();
        settings.interval_minutes = 0;
        assert!(settings.validate().is_err());
        let mut settings = ScreenshotSettings::default();
        settings.retain_raw_days = 2;
        assert!(settings.validate().is_err());
    }

    #[test]
    fn raw_retention_uses_only_explicit_supported_windows() {
        for days in [0, 1, 3, 7] {
            let settings = ScreenshotSettings {
                retain_raw_days: days,
                ..Default::default()
            };
            assert!(settings.validate().is_ok());
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_ocr_recognizes_a_controlled_test_image_when_provided() {
        let Some(path) = std::env::var_os("TRACEFLOW_OCR_TEST_IMAGE") else {
            return;
        };
        let text = super::local_ocr(std::path::Path::new(&path))
            .expect("Windows OCR should read the controlled image");
        let normalized = text.to_uppercase().replace(' ', "");
        assert!(
            normalized.contains("TRACEFLOW"),
            "recognized text was: {text}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_uia_reads_controlled_edit_content_without_a_screenshot() {
        use windows::core::w;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, WINDOW_EX_STYLE, WS_OVERLAPPEDWINDOW,
        };
        let expected = "TRACEFLOW_UIA_CONTROLLED_CONTENT_20260813";
        let window = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("EDIT"),
                &windows::core::HSTRING::from(expected),
                WS_OVERLAPPEDWINDOW,
                0,
                0,
                640,
                480,
                None,
                None,
                None,
                None,
            )
            .expect("controlled EDIT window should be created")
        };
        let text = super::read_uia_text_from_handle(window)
            .expect("UIA should read the controlled EDIT window");
        unsafe {
            let _ = DestroyWindow(window);
        }
        assert!(text.contains(expected), "UIA text was: {text}");
    }
}
