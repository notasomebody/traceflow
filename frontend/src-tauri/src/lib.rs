use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent, WindowEvent,
};

mod activity_monitor;
mod screenshot_capture;
mod credential_store;
mod ai_provider;
mod wecom_api;
use activity_monitor::{CapturePolicy, MonitorRuntime, MonitorStatus};
use screenshot_capture::{ScreenshotPreview, ScreenshotRuntime, ScreenshotSettings};

struct BackendProcess {
    child: Mutex<Option<Child>>,
    #[cfg(windows)]
    job: windows::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
unsafe impl Send for BackendProcess {}
#[cfg(windows)]
unsafe impl Sync for BackendProcess {}

impl Drop for BackendProcess {
    fn drop(&mut self) {
        if let Ok(child) = self.child.get_mut() {
            if let Some(child) = child.as_mut() { let _ = child.kill(); let _ = child.wait(); }
        }
        #[cfg(windows)]
        unsafe { let _ = windows::Win32::Foundation::CloseHandle(self.job); }
    }
}

#[cfg(windows)]
fn backend_job(child: &Child) -> Result<windows::Win32::Foundation::HANDLE, String> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::*;
    unsafe {
        let job = CreateJobObjectW(None, None).map_err(|error| error.to_string())?;
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(job, JobObjectExtendedLimitInformation, (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(), std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32)
            .map_err(|error| error.to_string())?;
        AssignProcessToJobObject(job, HANDLE(child.as_raw_handle())).map_err(|error| error.to_string())?;
        Ok(job)
    }
}

#[tauri::command]
fn monitor_status(state: tauri::State<'_, MonitorRuntime>) -> MonitorStatus {
    state.status()
}

#[tauri::command]
fn set_monitor_enabled(enabled: bool, state: tauri::State<'_, MonitorRuntime>) -> Result<MonitorStatus, String> {
    state.set_enabled(enabled)
}

#[tauri::command]
fn pause_monitor(minutes: u64, state: tauri::State<'_, MonitorRuntime>) -> Result<MonitorStatus, String> {
    state.pause_minutes(minutes)
}

#[tauri::command]
fn capture_policy(state: tauri::State<'_, MonitorRuntime>) -> Result<CapturePolicy, String> {
    state.capture_policy()
}

#[tauri::command]
fn set_capture_policy(policy: CapturePolicy, state: tauri::State<'_, MonitorRuntime>) -> Result<CapturePolicy, String> {
    state.set_capture_policy(policy)
}

#[tauri::command]
fn screenshot_settings(state: tauri::State<'_, ScreenshotRuntime>) -> Result<ScreenshotSettings, String> {
    state.settings()
}

#[tauri::command]
fn set_screenshot_settings(settings: ScreenshotSettings, state: tauri::State<'_, ScreenshotRuntime>) -> Result<ScreenshotSettings, String> {
    state.save_settings(settings)
}

#[tauri::command]
fn capture_screenshot_preview(delay_seconds: u64, screenshots: tauri::State<'_, ScreenshotRuntime>, monitor: tauri::State<'_, MonitorRuntime>) -> Result<ScreenshotPreview, String> {
    std::thread::sleep(std::time::Duration::from_secs(delay_seconds.min(5)));
    let active = activity_monitor::active_window().ok_or_else(|| "未找到活动窗口".to_string())?;
    if !monitor.can_capture_application(&active.application_name) {
        return Err(format!("已按隐私规则跳过 {}", active.application_name));
    }
    screenshots.capture_preview()
}

#[tauri::command]
fn capture_wecom_uia_preview(delay_seconds: u64, screenshots: tauri::State<'_, ScreenshotRuntime>) -> Result<ScreenshotPreview, String> {
    std::thread::sleep(std::time::Duration::from_secs(delay_seconds.min(5)));
    let active = activity_monitor::active_window().ok_or_else(|| "未找到活动窗口".to_string())?;
    if !screenshot_capture::is_wecom_application(&active.application_name) {
        return Err(format!("当前活动窗口是 {}，请切换到企业微信客户端", active.application_name));
    }
    screenshots.capture_wecom_preview()
}

#[tauri::command]
fn save_ai_secret(secret_id: String, value: String) -> Result<bool, String> {
    credential_store::save_secret(&secret_id, &value)?;
    Ok(true)
}

#[tauri::command]
fn ai_secret_status(secret_id: String) -> Result<bool, String> {
    credential_store::read_secret(&secret_id).map(|value| value.is_some())
}

#[tauri::command]
fn delete_ai_secret(secret_id: String) -> Result<bool, String> {
    credential_store::delete_secret(&secret_id)?;
    Ok(false)
}

#[tauri::command]
fn generate_with_ai(request: ai_provider::AiGenerateRequest) -> Result<ai_provider::AiGenerateResponse, String> {
    ai_provider::generate(request)
}

#[tauri::command]
fn test_wecom_connection(corp_id: String) -> Result<String, String> {
    wecom_api::test_connection(&corp_id)
}

#[tauri::command]
fn fetch_wecom_reports(request: wecom_api::WeComFetchRequest) -> Result<Vec<wecom_api::WeComJournal>, String> {
    wecom_api::fetch_reports(request)
}

#[tauri::command]
fn autostart_status() -> Result<bool, String> {
    #[cfg(windows)]
    {
        let key = windows::Win32::System::Registry::HKEY_CURRENT_USER;
        let subkey: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Run\0".encode_utf16().collect();
        let value: Vec<u16> = "TraceFlow\0".encode_utf16().collect();
        unsafe {
            let mut handle = windows::Win32::System::Registry::HKEY::default();
            if windows::Win32::System::Registry::RegOpenKeyExW(key, windows::core::PCWSTR(subkey.as_ptr()), None, windows::Win32::System::Registry::KEY_READ, &mut handle).is_err() { return Ok(false); }
            let result = windows::Win32::System::Registry::RegQueryValueExW(handle, windows::core::PCWSTR(value.as_ptr()), None, None, None, None).is_ok();
            let _ = windows::Win32::System::Registry::RegCloseKey(handle);
            Ok(result)
        }
    }
    #[cfg(not(windows))]
    { Ok(false) }
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use windows::Win32::System::Registry::*;
        let key = HKEY_CURRENT_USER;
        let subkey: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Run\0".encode_utf16().collect();
        let value_name: Vec<u16> = "TraceFlow\0".encode_utf16().collect();
        unsafe {
            let mut handle = HKEY::default();
            let created = RegCreateKeyExW(key, windows::core::PCWSTR(subkey.as_ptr()), None, None, REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, None, &mut handle, None);
            if created.0 != 0 { return Err(format!("无法打开开机启动项，Windows 错误 {}", created.0)); }
            if enabled {
                let executable = std::env::current_exe().map_err(|error| error.to_string())?;
                let command = format!("\"{}\" --background", executable.display());
                let bytes: Vec<u16> = command.encode_utf16().chain(Some(0)).collect();
                let written = RegSetValueExW(handle, windows::core::PCWSTR(value_name.as_ptr()), None, REG_SZ, Some(std::slice::from_raw_parts(bytes.as_ptr().cast(), bytes.len() * 2)));
                if written.0 != 0 { let _ = RegCloseKey(handle); return Err(format!("无法写入开机启动项，Windows 错误 {}", written.0)); }
            } else {
                let result = RegDeleteValueW(handle, windows::core::PCWSTR(value_name.as_ptr()));
                if result.0 != 0 && result.0 != 2 { let _ = RegCloseKey(handle); return Err(format!("无法删除开机启动项，Windows 错误 {}", result.0)); }
            }
            let _ = RegCloseKey(handle);
        }
        Ok(enabled)
    }
    #[cfg(not(windows))]
    { Err("一期开机自启动仅支持 Windows".into()) }
}

#[tauri::command]
fn clear_desktop_private_data(app: tauri::AppHandle, monitor: tauri::State<'_, MonitorRuntime>, screenshots: tauri::State<'_, ScreenshotRuntime>) -> Result<bool, String> {
    monitor.set_enabled(false)?;
    let mut settings = screenshots.settings()?;
    settings.enabled = false;
    screenshots.save_settings(settings)?;
    for secret in ["openai", "compatible", "codex", "wecom-report"] { let _ = credential_store::delete_secret(secret); }
    let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    for name in ["screenshots", "traceflow-backend.log"] {
        let path = data_dir.join(name);
        if path.is_dir() { std::fs::remove_dir_all(path).map_err(|error| error.to_string())?; }
        else if path.exists() { std::fs::remove_file(path).map_err(|error| error.to_string())?; }
    }
    Ok(true)
}

fn java_compatible_path(path: PathBuf) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let value = path.to_string_lossy();
        if let Some(without_prefix) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(without_prefix);
        }
    }
    path
}

fn java_executable(resource_dir: &std::path::Path) -> PathBuf {
    let bundled = if cfg!(target_os = "windows") {
        resource_dir.join("runtime").join("bin").join("java.exe")
    } else {
        resource_dir.join("runtime").join("bin").join("java")
    };
    if bundled.exists() { java_compatible_path(bundled) } else { PathBuf::from("java") }
}

fn backend_jar(resource_dir: &std::path::Path) -> PathBuf {
    let bundled = resource_dir.join("backend").join("traceflow-backend.jar");
    if bundled.exists() {
        java_compatible_path(bundled)
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../backend/target/traceflow-backend.jar")
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let resource_dir = app.path().resource_dir()?;
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let mut backend_log = OpenOptions::new()
                .create(true)
                .append(true)
                .open(data_dir.join("traceflow-backend.log"))?;
            let backend_path = backend_jar(&resource_dir);
            writeln!(
                backend_log,
                "\n[TraceFlow launcher] resource_dir={} backend={} java={}",
                resource_dir.display(),
                backend_path.display(),
                java_executable(&resource_dir).display()
            )?;
            let backend_error_log = backend_log.try_clone()?;
            let child = Command::new(java_executable(&resource_dir))
                .arg("-jar")
                .arg(&backend_path)
                .env("TRACEFLOW_DB_PATH", data_dir.join("traceflow.db"))
                .env("TRACEFLOW_DATA_DIR", &data_dir)
                .env("TRACEFLOW_PORT", "17890")
                .stdin(Stdio::null())
                .stdout(Stdio::from(backend_log))
                .stderr(Stdio::from(backend_error_log))
                .spawn()
                .map_err(|error| format!("无法启动迹汇本地后端: {error}"))?;
            #[cfg(windows)]
            let job = backend_job(&child).map_err(|error| format!("无法绑定本地后端生命周期: {error}"))?;
            app.manage(BackendProcess {
                child: Mutex::new(Some(child)),
                #[cfg(windows)]
                job,
            });
            let monitor = MonitorRuntime::new(data_dir.join("monitor-settings.json"));
            monitor.start();
            app.manage(monitor);
            let screenshots = ScreenshotRuntime::new(&data_dir);
            screenshots.start(app.state::<MonitorRuntime>().inner().clone());
            app.manage(screenshots);

            let open_item = MenuItem::with_id(app, "open", "打开迹汇", true, None::<&str>)?;
            let collect_item = MenuItem::with_id(app, "collect", "开始采集", true, None::<&str>)?;
            let pause_15_item = MenuItem::with_id(app, "pause-15", "暂停 15 分钟", true, None::<&str>)?;
            let pause_60_item = MenuItem::with_id(app, "pause-60", "暂停 1 小时", true, None::<&str>)?;
            let pause_tomorrow_item = MenuItem::with_id(app, "pause-tomorrow", "暂停到明天", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "彻底退出", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &collect_item, &pause_15_item, &pause_60_item, &pause_tomorrow_item, &quit_item])?;
            TrayIconBuilder::with_id("traceflow-main")
                .icon(app.default_window_icon().expect("缺少迹汇程序图标").clone())
                .tooltip("迹汇 TraceFlow")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app_handle, event| match event.id.as_ref() {
                    "open" => show_main_window(app_handle),
                    "collect" => { let _ = app_handle.state::<MonitorRuntime>().set_enabled(true); },
                    "pause-15" => { let _ = app_handle.state::<MonitorRuntime>().pause_minutes(15); },
                    "pause-60" => { let _ = app_handle.state::<MonitorRuntime>().pause_minutes(60); },
                    "pause-tomorrow" => { let _ = app_handle.state::<MonitorRuntime>().pause_until_tomorrow(); },
                    "quit" => app_handle.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![monitor_status, set_monitor_enabled, pause_monitor, capture_policy, set_capture_policy, screenshot_settings, set_screenshot_settings, capture_screenshot_preview, capture_wecom_uia_preview, save_ai_secret, ai_secret_status, delete_ai_secret, generate_with_ai, test_wecom_connection, fetch_wecom_reports, autostart_status, set_autostart, clear_desktop_private_data])
        .build(tauri::generate_context!())
        .expect("无法创建迹汇桌面应用");

    application.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let state = app_handle.state::<BackendProcess>();
            if let Ok(mut process) = state.child.lock() {
                if let Some(child) = process.as_mut() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            };
        }
    });
}

fn show_main_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
