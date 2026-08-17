use serde::Serialize;
use serde::Deserialize;
use std::collections::HashSet;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::activity_monitor::{active_window, system_idle_seconds};
use crate::auto_organizer::AutoOrganizerRuntime;
use crate::screenshot_capture::{is_wecom_application, ScreenshotRuntime};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HistorySyncStage {
    Idle,
    WaitingForWeCom,
    Running,
    PausedForUser,
    Completed,
    Error,
}

#[cfg(test)]
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct HistorySyncSession {
    stage: HistorySyncStage,
    history_days: u16,
    imported_fingerprints: HashSet<String>,
}

#[cfg(test)]
impl HistorySyncSession {
    pub fn start(history_days: u16) -> Self {
        Self { stage: HistorySyncStage::WaitingForWeCom, history_days, imported_fingerprints: HashSet::new() }
    }

    pub fn stage(&self) -> HistorySyncStage { self.stage }

    pub fn wecom_ready(&mut self) {
        if self.stage == HistorySyncStage::WaitingForWeCom { self.stage = HistorySyncStage::Running; }
    }

    pub fn accept_report(&mut self, fingerprint: &str) -> bool {
        self.stage == HistorySyncStage::Running && self.imported_fingerprints.insert(fingerprint.to_string())
    }

    pub fn user_became_active(&mut self) {
        if self.stage == HistorySyncStage::Running { self.stage = HistorySyncStage::PausedForUser; }
    }

    pub fn resume(&mut self) {
        if self.stage == HistorySyncStage::PausedForUser { self.stage = HistorySyncStage::Running; }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeComHistoryStatus {
    pub stage: HistorySyncStage,
    pub visited_rows: usize,
    pub imported_reports: usize,
    pub message: String,
}

impl Default for WeComHistoryStatus {
    fn default() -> Self {
        Self { stage: HistorySyncStage::Idle, visited_rows: 0, imported_reports: 0, message: "尚未开始".into() }
    }
}

#[derive(Clone)]
pub struct WeComHistoryRuntime {
    status: Arc<Mutex<WeComHistoryStatus>>,
    imported_fingerprints: Arc<Mutex<HashSet<String>>>,
    fingerprints_path: PathBuf,
    stop_requested: Arc<AtomicBool>,
}

impl WeComHistoryRuntime {
    pub fn new(data_dir: PathBuf) -> Self {
        let fingerprints_path = data_dir.join("wecom-history-fingerprints.json");
        let imported_fingerprints = std::fs::read(&fingerprints_path).ok()
            .and_then(|content| serde_json::from_slice(&content).ok()).unwrap_or_default();
        Self {
            status: Arc::new(Mutex::new(WeComHistoryStatus::default())),
            imported_fingerprints: Arc::new(Mutex::new(imported_fingerprints)),
            fingerprints_path,
            stop_requested: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn status(&self) -> Result<WeComHistoryStatus, String> {
        self.status.lock().map(|value| value.clone()).map_err(|_| "企业微信同步状态不可用".into())
    }

    pub fn stop(&self) -> Result<WeComHistoryStatus, String> {
        self.stop_requested.store(true, Ordering::SeqCst);
        self.set_status(HistorySyncStage::Idle, "已停止，进度已保留", None, None)?;
        self.status()
    }

    pub fn start_passive_capture(&self, organizer: AutoOrganizerRuntime, screenshots: ScreenshotRuntime) {
        let runtime = self.clone();
        let _ = std::thread::Builder::new().name("traceflow-wecom-passive-capture".into()).spawn(move || loop {
            let settings = organizer.settings().unwrap_or_default();
            if settings.enabled && settings.wecom_passive_capture_enabled {
                if active_window().filter(|window| is_wecom_application(&window.application_name)).is_some() {
                    if let Ok(preview) = screenshots.capture_wecom_preview() {
                        if let Some(report) = parse_wecom_report(&preview.ocr_text) {
                            let _ = runtime.import_if_new(&report);
                        }
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(15));
        });
    }

    pub fn start_history_sync(&self, history_days: u16, screenshots: ScreenshotRuntime) -> Result<WeComHistoryStatus, String> {
        if !(1..=730).contains(&history_days) { return Err("企业微信历史范围必须在 1–730 天之间".into()); }
        let current = self.status()?;
        if matches!(current.stage, HistorySyncStage::WaitingForWeCom | HistorySyncStage::Running | HistorySyncStage::PausedForUser) {
            return Err("企业微信历史读取已经在进行中".into());
        }
        self.stop_requested.store(false, Ordering::SeqCst);
        self.set_status(HistorySyncStage::WaitingForWeCom, "请在 3 秒内切换到企业微信汇报列表", Some(0), Some(0))?;
        let runtime = self.clone();
        let _ = std::thread::Builder::new().name("traceflow-wecom-history".into()).spawn(move || {
            std::thread::sleep(Duration::from_secs(3));
            if let Err(error) = runtime.run_history_sync(history_days, screenshots) {
                let _ = runtime.set_status(HistorySyncStage::Error, &error, None, None);
            }
        });
        self.status()
    }

    fn run_history_sync(&self, history_days: u16, screenshots: ScreenshotRuntime) -> Result<(), String> {
        let window = active_window().ok_or_else(|| "没有检测到活动窗口".to_string())?;
        if !is_wecom_application(&window.application_name) { return Err("请先打开企业微信汇报列表再开始读取".into()); }
        if !screenshots.settings()?.uia_enabled { return Err("请先授权 UI Automation 文本读取".into()); }
        self.set_status(HistorySyncStage::Running, "正在只读遍历历史汇报", None, None)?;
        let mut processed_rows = HashSet::new();
        let mut pages_without_progress = 0usize;
        while processed_rows.len() < 500 && !self.stop_requested.load(Ordering::SeqCst) {
            while system_idle_seconds() < 2 && !self.stop_requested.load(Ordering::SeqCst) {
                self.set_status(HistorySyncStage::PausedForUser, "检测到用户操作，已暂停", None, None)?;
                std::thread::sleep(Duration::from_secs(2));
            }
            if self.stop_requested.load(Ordering::SeqCst) { return Ok(()); }
            self.set_status(HistorySyncStage::Running, "电脑空闲，继续读取", None, None)?;
            let Some(row_key) = invoke_next_safe_report_row(&processed_rows)? else {
                if scroll_report_list()? {
                    pages_without_progress += 1;
                    if pages_without_progress >= 3 { break; }
                    std::thread::sleep(Duration::from_millis(600));
                    continue;
                }
                break;
            };
            pages_without_progress = 0;
            processed_rows.insert(row_key);
            self.set_status(HistorySyncStage::Running, "正在读取汇报正文", Some(processed_rows.len()), None)?;
            std::thread::sleep(Duration::from_millis(800));
            if let Ok(preview) = screenshots.capture_wecom_preview() {
                if let Some(report) = parse_wecom_report(&preview.ocr_text) {
                    if report_in_range(&report.date, history_days) { let _ = self.import_if_new(&report); }
                }
            }
            if !invoke_back_button()? { return Err("无法安全返回汇报列表，已停止；不会模拟键盘或点击未知按钮".into()); }
            std::thread::sleep(Duration::from_millis(500));
        }
        let imported = self.status()?.imported_reports;
        self.set_status(HistorySyncStage::Completed, &format!("历史读取完成，共导入 {imported} 篇"), Some(processed_rows.len()), None)
    }

    fn import_if_new(&self, report: &ParsedWeComReport) -> Result<bool, String> {
        let fingerprint = report_fingerprint(report);
        {
            let fingerprints = self.imported_fingerprints.lock().map_err(|_| "企业微信去重状态不可用".to_string())?;
            if fingerprints.contains(&fingerprint) { return Ok(false); }
        }
        send_report_import(report)?;
        let mut fingerprints = self.imported_fingerprints.lock().map_err(|_| "企业微信去重状态不可用".to_string())?;
        fingerprints.insert(fingerprint);
        if let Some(parent) = self.fingerprints_path.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        std::fs::write(&self.fingerprints_path, serde_json::to_vec(&*fingerprints).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
        let current = self.status()?;
        self.set_status(current.stage, "已读取并保存到本机", None, Some(current.imported_reports + 1))?;
        Ok(true)
    }

    fn set_status(&self, stage: HistorySyncStage, message: &str, visited: Option<usize>, imported: Option<usize>) -> Result<(), String> {
        let mut status = self.status.lock().map_err(|_| "企业微信同步状态不可用".to_string())?;
        status.stage = stage;
        status.message = message.into();
        if let Some(value) = visited { status.visited_rows = value; }
        if let Some(value) = imported { status.imported_reports = value; }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedWeComReport {
    pub date: String,
    pub summary: String,
    pub next_plan: String,
}

pub fn parse_wecom_report(text: &str) -> Option<ParsedWeComReport> {
    let lines = text.lines().map(str::trim).filter(|line| !line.is_empty()).collect::<Vec<_>>();
    let date = lines.iter().find_map(|line| find_iso_date(line))?;
    let summary_start = lines.iter().position(|line| is_summary_label(line))? + 1;
    let plan_label = lines.iter().enumerate().skip(summary_start)
        .find(|(_, line)| is_plan_label(line)).map(|(index, _)| index)?;
    let summary = clean_section(&lines[summary_start..plan_label]);
    let next_plan = clean_section(&lines[plan_label + 1..]);
    if summary.is_empty() { return None; }
    Some(ParsedWeComReport {
        date,
        summary,
        next_plan: if next_plan.is_empty() { "请补充下一步计划。".into() } else { next_plan },
    })
}

pub fn is_safe_report_candidate(name: &str) -> bool {
    let compact = name.split_whitespace().collect::<String>();
    if compact.len() < 4 || compact.len() > 200 { return false; }
    let actionable = compact.replace("已提交", "").replace("未提交", "").replace("已保存", "");
    let unsafe_words = ["提交", "删除", "编辑", "发送", "保存", "新建", "取消", "撤回", "审批"];
    if unsafe_words.iter().any(|word| actionable.contains(word)) { return false; }
    let looks_like_report = ["日报", "周报", "月报", "汇报"].iter().any(|word| compact.contains(word));
    let has_date_or_number = compact.chars().any(|character| character.is_ascii_digit());
    looks_like_report && has_date_or_number
}

fn find_iso_date(value: &str) -> Option<String> {
    let normalized = value.replace('/', "-").replace('.', "-");
    let bytes = normalized.as_bytes();
    for index in 0..bytes.len().saturating_sub(9) {
        let value = &bytes[index..index + 10];
        if value[0..4].iter().all(u8::is_ascii_digit)
            && value[4] == b'-' && value[5..7].iter().all(u8::is_ascii_digit)
            && value[7] == b'-' && value[8..10].iter().all(u8::is_ascii_digit)
        {
            let candidate = std::str::from_utf8(value).ok()?;
            let month = candidate[5..7].parse::<u8>().ok()?;
            let day = candidate[8..10].parse::<u8>().ok()?;
            if (1..=12).contains(&month) && (1..=31).contains(&day) { return Some(candidate.into()); }
        }
    }
    None
}

fn is_summary_label(line: &str) -> bool {
    ["今日工作总结", "本日工作总结", "工作总结", "今日完成"].iter().any(|label| line.contains(label))
}

fn is_plan_label(line: &str) -> bool {
    ["明日工作计划", "下一步计划", "下周工作计划", "工作计划"].iter().any(|label| line.contains(label))
}

fn clean_section(lines: &[&str]) -> String {
    lines.iter().filter(|line| !is_ui_noise(line)).copied().collect::<Vec<_>>().join("\n").trim().to_string()
}

fn is_ui_noise(line: &str) -> bool {
    matches!(line, "提交" | "保存" | "取消" | "编辑" | "返回" | "更多")
}

fn report_fingerprint(report: &ParsedWeComReport) -> String {
    let mut hasher = DefaultHasher::new();
    report.date.hash(&mut hasher);
    report.summary.hash(&mut hasher);
    report.next_plan.hash(&mut hasher);
    format!("{}:{:016x}", report.date, hasher.finish())
}

fn report_in_range(date: &str, history_days: u16) -> bool {
    let Ok(date) = time::Date::parse(date, &time::format_description::well_known::Iso8601::DATE) else { return false; };
    let today = time::OffsetDateTime::now_local().unwrap_or_else(|_| time::OffsetDateTime::now_utc()).date();
    date <= today && date >= today - time::Duration::days(history_days as i64)
}

fn send_report_import(report: &ParsedWeComReport) -> Result<(), String> {
    let body = serde_json::to_vec(&serde_json::json!({
        "date": report.date,
        "summary": report.summary,
        "nextPlan": report.next_plan,
        "targetMinutes": 480
    })).map_err(|error| error.to_string())?;
    let mut stream = TcpStream::connect_timeout(&"127.0.0.1:17890".parse().unwrap(), Duration::from_secs(2))
        .map_err(|error| error.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).map_err(|error| error.to_string())?;
    write!(stream, "POST /api/reports/daily/import HTTP/1.1\r\nHost: 127.0.0.1:17890\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).map_err(|error| error.to_string())?;
    stream.write_all(&body).map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(|error| error.to_string())?;
    if response.starts_with("HTTP/1.1 201") || response.starts_with("HTTP/1.0 201") { Ok(()) }
    else { Err("企业微信历史汇报写入本机失败".into()) }
}

#[cfg(windows)]
fn automation_root() -> Result<(windows::Win32::UI::Accessibility::IUIAutomation, windows::Win32::UI::Accessibility::IUIAutomationElement), String> {
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation};
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(|error| error.to_string())?;
        let window = GetForegroundWindow();
        if window.0.is_null() { return Err("未找到企业微信活动窗口".into()); }
        let root = automation.ElementFromHandle(window).map_err(|error| error.to_string())?;
        Ok((automation, root))
    }
}

#[cfg(windows)]
fn invoke_next_safe_report_row(processed: &HashSet<String>) -> Result<Option<String>, String> {
    use windows::core::Interface;
    use windows::Win32::UI::Accessibility::{IUIAutomationInvokePattern, TreeScope_Subtree, UIA_InvokePatternId};
    let (automation, root) = automation_root()?;
    unsafe {
        let elements = root.FindAll(TreeScope_Subtree, &automation.CreateTrueCondition().map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
        for index in 0..elements.Length().map_err(|error| error.to_string())?.min(600) {
            let Ok(element) = elements.GetElement(index) else { continue; };
            if element.CurrentIsPassword().map(|value| value.as_bool()).unwrap_or(true) { continue; }
            let name = element.CurrentName().map(|value| value.to_string()).unwrap_or_default();
            let automation_id = element.CurrentAutomationId().map(|value| value.to_string()).unwrap_or_default();
            let key = format!("{automation_id}|{name}");
            if processed.contains(&key) || !is_safe_report_candidate(&name) { continue; }
            let Ok(pattern) = element.GetCurrentPattern(UIA_InvokePatternId).and_then(|value| value.cast::<IUIAutomationInvokePattern>()) else { continue; };
            pattern.Invoke().map_err(|error| error.to_string())?;
            return Ok(Some(key));
        }
    }
    Ok(None)
}

#[cfg(not(windows))]
fn invoke_next_safe_report_row(_processed: &HashSet<String>) -> Result<Option<String>, String> {
    Err("企业微信自动遍历仅支持 Windows".into())
}

#[cfg(windows)]
fn invoke_back_button() -> Result<bool, String> {
    use windows::core::Interface;
    use windows::Win32::UI::Accessibility::{IUIAutomationInvokePattern, TreeScope_Subtree, UIA_InvokePatternId};
    let (automation, root) = automation_root()?;
    unsafe {
        let elements = root.FindAll(TreeScope_Subtree, &automation.CreateTrueCondition().map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
        for index in 0..elements.Length().map_err(|error| error.to_string())?.min(400) {
            let Ok(element) = elements.GetElement(index) else { continue; };
            let name = element.CurrentName().map(|value| value.to_string()).unwrap_or_default();
            if !matches!(name.trim(), "返回" | "返回汇报" | "关闭") { continue; }
            let Ok(pattern) = element.GetCurrentPattern(UIA_InvokePatternId).and_then(|value| value.cast::<IUIAutomationInvokePattern>()) else { continue; };
            pattern.Invoke().map_err(|error| error.to_string())?;
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(not(windows))]
fn invoke_back_button() -> Result<bool, String> { Ok(false) }

#[cfg(windows)]
fn scroll_report_list() -> Result<bool, String> {
    use windows::core::Interface;
    use windows::Win32::UI::Accessibility::{IUIAutomationScrollPattern, ScrollAmount_LargeIncrement, ScrollAmount_NoAmount, TreeScope_Subtree, UIA_ScrollPatternId};
    let (automation, root) = automation_root()?;
    unsafe {
        let elements = root.FindAll(TreeScope_Subtree, &automation.CreateTrueCondition().map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
        for index in 0..elements.Length().map_err(|error| error.to_string())?.min(400) {
            let Ok(element) = elements.GetElement(index) else { continue; };
            let Ok(pattern) = element.GetCurrentPattern(UIA_ScrollPatternId).and_then(|value| value.cast::<IUIAutomationScrollPattern>()) else { continue; };
            if !pattern.CurrentVerticallyScrollable().map(|value| value.as_bool()).unwrap_or(false) { continue; }
            let before = pattern.CurrentVerticalScrollPercent().unwrap_or(100.0);
            if before >= 99.0 { return Ok(false); }
            pattern.Scroll(ScrollAmount_NoAmount, ScrollAmount_LargeIncrement).map_err(|error| error.to_string())?;
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(not(windows))]
fn scroll_report_list() -> Result<bool, String> { Ok(false) }

#[cfg(test)]
mod tests {
    use super::{is_safe_report_candidate, parse_wecom_report, HistorySyncSession, HistorySyncStage};

    #[test]
    fn visible_wecom_report_is_split_into_date_summary_and_next_plan() {
        let text = "国钥云技术人员日报\n汇报日期：2026-08-16\n今日工作总结\n完成数据接口联调和异常数据验证。\n明日工作计划\n继续进行回归测试。";
        let report = parse_wecom_report(text).expect("a visible report should be recognized");
        assert_eq!(report.date, "2026-08-16");
        assert_eq!(report.summary, "完成数据接口联调和异常数据验证。");
        assert_eq!(report.next_plan, "继续进行回归测试。");
    }

    #[test]
    fn history_sync_pauses_for_user_input_and_resumes_without_reimporting_reports() {
        let mut session = HistorySyncSession::start(90);
        assert_eq!(session.stage(), HistorySyncStage::WaitingForWeCom);
        session.wecom_ready();
        assert_eq!(session.stage(), HistorySyncStage::Running);
        assert!(session.accept_report("2026-08-16:abc"));
        assert!(!session.accept_report("2026-08-16:abc"));
        session.user_became_active();
        assert_eq!(session.stage(), HistorySyncStage::PausedForUser);
        session.resume();
        assert_eq!(session.stage(), HistorySyncStage::Running);
        assert!(!session.accept_report("2026-08-16:abc"));
    }

    #[test]
    fn automation_clicks_report_rows_but_never_write_or_destructive_controls() {
        assert!(is_safe_report_candidate("2026-08-16 国钥云技术人员日报"));
        assert!(is_safe_report_candidate("8月16日 日报 已提交"));
        for unsafe_name in ["提交", "删除汇报", "编辑日报", "发送", "保存", "新建汇报", "取消"] {
            assert!(!is_safe_report_candidate(unsafe_name), "unsafe candidate: {unsafe_name}");
        }
    }
}
