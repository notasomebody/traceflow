#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActiveWindow {
    pub application_name: String,
    pub window_title: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompletedObservation {
    pub window: ActiveWindow,
    pub duration_seconds: u64,
}

#[derive(Default)]
pub struct ObservationAccumulator {
    active: Option<(ActiveWindow, u64)>,
}

impl ObservationAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn sample(&mut self, now_seconds: u64, window: Option<ActiveWindow>, idle: bool) -> Option<CompletedObservation> {
        if idle || window.is_none() {
            return self.flush(now_seconds);
        }
        let window = window.expect("window was checked above");
        match self.active.take() {
            None => {
                self.active = Some((window, now_seconds));
                None
            }
            Some((current, started_at)) if current == window => {
                self.active = Some((current, started_at));
                None
            }
            Some((current, started_at)) => {
                self.active = Some((window, now_seconds));
                completed(current, started_at, now_seconds)
            }
        }
    }

    fn flush(&mut self, now_seconds: u64) -> Option<CompletedObservation> {
        self.active.take().and_then(|(window, started_at)| completed(window, started_at, now_seconds))
    }

    pub fn checkpoint(&mut self, now_seconds: u64) -> Option<CompletedObservation> {
        let (window, started_at) = self.active.take()?;
        self.active = Some((window.clone(), now_seconds));
        completed(window, started_at, now_seconds)
    }
}

fn completed(window: ActiveWindow, started_at: u64, ended_at: u64) -> Option<CompletedObservation> {
    let duration_seconds = ended_at.saturating_sub(started_at);
    (duration_seconds > 0).then_some(CompletedObservation { window, duration_seconds })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MonitorStatus {
    Disabled,
    Paused,
    Idle,
    Collecting,
    Error,
}

#[derive(Default)]
pub struct MonitorControl {
    enabled: bool,
    paused_until: Option<u64>,
}

#[derive(Clone, Debug, serde::Deserialize, Serialize)]
#[serde(default)]
pub struct CapturePolicy {
    pub work_intervals: Vec<WorkInterval>,
    pub excluded_applications: Vec<String>,
    pub excluded_dates: Vec<String>,
    pub additional_work_dates: Vec<String>,
    pub idle_threshold_seconds: u64,
}

#[derive(Clone, Debug, serde::Deserialize, Serialize)]
pub struct WorkInterval {
    /// Monday = 1, Sunday = 7.
    pub weekday: u8,
    pub start_minute: u16,
    pub end_minute: u16,
}

impl Default for CapturePolicy {
    fn default() -> Self {
        let mut work_intervals = Vec::new();
        for weekday in 1..=5 {
            work_intervals.push(WorkInterval { weekday, start_minute: 9 * 60, end_minute: 12 * 60 });
            work_intervals.push(WorkInterval { weekday, start_minute: 13 * 60 + 30, end_minute: 18 * 60 });
        }
        Self {
            work_intervals,
            excluded_applications: [
                "CredentialUIBroker.exe",
                "LogonUI.exe",
                "consent.exe",
                "AuthHost.exe",
                "SecurityHealthSystray.exe",
                "1Password.exe",
                "Bitwarden.exe",
                "KeePass.exe",
                "KeePassXC.exe",
                "traceflow-desktop.exe",
            ].into_iter().map(str::to_string).collect(),
            excluded_dates: Vec::new(),
            additional_work_dates: Vec::new(),
            idle_threshold_seconds: 300,
        }
    }
}

impl CapturePolicy {
    pub fn application_allowed(&self, application_name: &str) -> bool {
        !self.excluded_applications.iter().any(|excluded| excluded.eq_ignore_ascii_case(application_name))
    }

    #[cfg(test)]
    pub fn allows(&self, weekday: u8, minute_of_day: u16, application_name: &str) -> bool {
        self.allows_on("", weekday, minute_of_day, application_name)
    }

    pub fn allows_on(&self, local_date: &str, weekday: u8, minute_of_day: u16, application_name: &str) -> bool {
        if self.excluded_dates.iter().any(|date| date == local_date) {
            return false;
        }
        if !self.application_allowed(application_name) {
            return false;
        }
        let effective_weekday = if self.additional_work_dates.iter().any(|date| date == local_date) { 1 } else { weekday };
        self.work_intervals.iter().any(|interval| {
            interval.weekday == effective_weekday
                && minute_of_day >= interval.start_minute
                && minute_of_day < interval.end_minute
        })
    }

    fn validate_and_normalize(mut self) -> Result<Self, String> {
        if self.work_intervals.iter().any(|interval| {
            !(1..=7).contains(&interval.weekday)
                || interval.start_minute >= interval.end_minute
                || interval.end_minute > 24 * 60
        }) {
            return Err("工作时段必须在 00:00–24:00 内，且开始时间早于结束时间".into());
        }
        if !(60..=3600).contains(&self.idle_threshold_seconds) {
            return Err("空闲暂停阈值必须在 1–60 分钟之间".into());
        }
        self.excluded_applications = self.excluded_applications.into_iter()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
            .fold(Vec::<String>::new(), |mut names, name| {
                if !names.iter().any(|current| current.eq_ignore_ascii_case(&name)) {
                    names.push(name);
                }
                names
            });
        self.excluded_dates.sort();
        self.excluded_dates.dedup();
        self.additional_work_dates.sort();
        self.additional_work_dates.dedup();
        if self.excluded_dates.iter().chain(self.additional_work_dates.iter()).any(|date| !valid_iso_date(date)) {
            return Err("休息日期和补班日期必须使用 YYYY-MM-DD 格式".into());
        }
        if self.excluded_dates.iter().any(|date| self.additional_work_dates.contains(date)) {
            return Err("同一天不能同时设置为休息日和补班日".into());
        }
        Ok(self)
    }
}

#[derive(Clone)]
pub struct MonitorRuntime {
    control: Arc<Mutex<MonitorControl>>,
    last_status: Arc<Mutex<MonitorStatus>>,
    policy: Arc<Mutex<CapturePolicy>>,
    settings_path: PathBuf,
}

impl MonitorRuntime {
    pub fn new(settings_path: PathBuf) -> Self {
        let settings = std::fs::read_to_string(&settings_path)
            .ok()
            .and_then(|content| serde_json::from_str::<MonitorSettings>(&content).ok())
            .unwrap_or_default();
        let enabled = settings.enabled;
        Self {
            control: Arc::new(Mutex::new(MonitorControl { enabled, paused_until: None })),
            last_status: Arc::new(Mutex::new(if enabled { MonitorStatus::Idle } else { MonitorStatus::Disabled })),
            policy: Arc::new(Mutex::new(settings.capture_policy)),
            settings_path,
        }
    }

    pub fn start(&self) {
        let runtime = self.clone();
        let _ = std::thread::Builder::new().name("traceflow-activity-monitor".into()).spawn(move || {
            let mut accumulator = ObservationAccumulator::new();
            let mut last_checkpoint = unix_seconds();
            loop {
                let now = unix_seconds();
                let idle_threshold = runtime.policy.lock().map(|policy| policy.idle_threshold_seconds).unwrap_or(300);
                let idle = system_idle_seconds() >= idle_threshold;
                let status = runtime.control.lock().map(|control| control.status(now, idle)).unwrap_or(MonitorStatus::Error);
                if let Ok(mut current) = runtime.last_status.lock() {
                    *current = status;
                }
                let active_window = (status == MonitorStatus::Collecting).then(active_window).flatten()
                    .filter(|window| runtime.policy_allows_now(&window.application_name));
                if let Some(observation) = accumulator.sample(now, active_window, status != MonitorStatus::Collecting) {
                    let _ = send_observation(&observation);
                }
                if status == MonitorStatus::Collecting && now.saturating_sub(last_checkpoint) >= 60 {
                    if let Some(observation) = accumulator.checkpoint(now) {
                        let _ = send_observation(&observation);
                    }
                    last_checkpoint = now;
                }
                std::thread::sleep(Duration::from_secs(5));
            }
        });
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<MonitorStatus, String> {
        self.control.lock().map_err(|_| "监控状态不可用".to_string())?.set_enabled(enabled);
        let capture_policy = self.policy.lock().map_err(|_| "采集策略不可用".to_string())?.clone();
        self.persist_settings(enabled, capture_policy)?;
        Ok(self.status())
    }

    pub fn pause_minutes(&self, minutes: u64) -> Result<MonitorStatus, String> {
        let until = unix_seconds().saturating_add(minutes.saturating_mul(60));
        self.control.lock().map_err(|_| "监控状态不可用".to_string())?.pause_until(until);
        Ok(self.status())
    }

    pub fn pause_until_tomorrow(&self) -> Result<MonitorStatus, String> {
        let now = time::OffsetDateTime::now_local().unwrap_or_else(|_| time::OffsetDateTime::now_utc());
        let tomorrow = now.date().next_day().ok_or_else(|| "无法计算明天日期".to_string())?;
        let midnight = tomorrow.with_hms(0, 0, 0).map_err(|error| error.to_string())?;
        self.control.lock().map_err(|_| "监控状态不可用".to_string())?.pause_until(midnight.assume_offset(now.offset()).unix_timestamp().max(0) as u64);
        Ok(self.status())
    }

    pub fn status(&self) -> MonitorStatus {
        let idle_threshold = self.policy.lock().map(|policy| policy.idle_threshold_seconds).unwrap_or(300);
        self.control.lock().map(|control| control.status(unix_seconds(), system_idle_seconds() >= idle_threshold)).unwrap_or(MonitorStatus::Error)
    }

    pub fn capture_policy(&self) -> Result<CapturePolicy, String> {
        self.policy.lock().map(|policy| policy.clone()).map_err(|_| "采集策略不可用".into())
    }

    pub fn set_capture_policy(&self, capture_policy: CapturePolicy) -> Result<CapturePolicy, String> {
        let capture_policy = capture_policy.validate_and_normalize()?;
        *self.policy.lock().map_err(|_| "采集策略不可用".to_string())? = capture_policy.clone();
        let enabled = self.control.lock().map_err(|_| "监控状态不可用".to_string())?.enabled;
        self.persist_settings(enabled, capture_policy.clone())?;
        Ok(capture_policy)
    }

    pub fn can_capture_application(&self, application_name: &str) -> bool {
        self.policy.lock().map(|policy| policy.application_allowed(application_name)).unwrap_or(false)
    }

    pub fn can_capture_now(&self, application_name: &str) -> bool {
        self.status() == MonitorStatus::Collecting && self.policy_allows_now(application_name)
    }

    fn persist_settings(&self, enabled: bool, capture_policy: CapturePolicy) -> Result<(), String> {
        if let Some(parent) = self.settings_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let content = serde_json::to_vec(&MonitorSettings { enabled, capture_policy }).map_err(|error| error.to_string())?;
        std::fs::write(&self.settings_path, content).map_err(|error| error.to_string())
    }

    fn policy_allows_now(&self, application_name: &str) -> bool {
        let (local_date, weekday, minute_of_day) = local_date_weekday_and_minute();
        self.policy.lock().map(|policy| policy.allows_on(&local_date, weekday, minute_of_day, application_name)).unwrap_or(false)
    }
}

#[derive(Default, serde::Deserialize, Serialize)]
#[serde(default)]
struct MonitorSettings {
    enabled: bool,
    capture_policy: CapturePolicy,
}

#[cfg(windows)]
fn local_date_weekday_and_minute() -> (String, u8, u16) {
    use windows::Win32::System::SystemInformation::GetLocalTime;
    unsafe {
        let value = GetLocalTime();
        let weekday = if value.wDayOfWeek == 0 { 7 } else { value.wDayOfWeek as u8 };
        (format!("{:04}-{:02}-{:02}", value.wYear, value.wMonth, value.wDay), weekday, value.wHour * 60 + value.wMinute)
    }
}

#[cfg(not(windows))]
fn local_date_weekday_and_minute() -> (String, u8, u16) {
    let now = time::OffsetDateTime::now_utc();
    (now.date().to_string(), now.weekday().number_from_monday(), now.hour() as u16 * 60 + now.minute() as u16)
}

fn valid_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes.iter().enumerate().all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
        && value[5..7].parse::<u8>().is_ok_and(|month| (1..=12).contains(&month))
        && value[8..10].parse::<u8>().is_ok_and(|day| (1..=31).contains(&day))
}

fn unix_seconds() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn send_observation(observation: &CompletedObservation) -> Result<(), String> {
    let captured_at = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|error| error.to_string())?;
    let body = serde_json::to_vec(&serde_json::json!({
        "capturedAt": captured_at,
        "applicationName": observation.window.application_name,
        "windowTitle": observation.window.window_title,
        "durationSeconds": observation.duration_seconds
    })).map_err(|error| error.to_string())?;
    let mut stream = TcpStream::connect_timeout(
        &"127.0.0.1:17890".parse().map_err(|error: std::net::AddrParseError| error.to_string())?,
        Duration::from_secs(2),
    ).map_err(|error| error.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).map_err(|error| error.to_string())?;
    write!(stream, "POST /api/activity/ingest HTTP/1.1\r\nHost: 127.0.0.1:17890\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).map_err(|error| error.to_string())?;
    stream.write_all(&body).map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(|error| error.to_string())?;
    if response.starts_with("HTTP/1.1 201") || response.starts_with("HTTP/1.0 201") { Ok(()) } else { Err("本地活动入库失败".into()) }
}

#[cfg(windows)]
pub(crate) fn active_window() -> Option<ActiveWindow> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};

    unsafe {
        let window = GetForegroundWindow();
        if window.0.is_null() { return None; }
        let mut title_buffer = [0u16; 1024];
        let title_length = GetWindowTextW(window, &mut title_buffer);
        if title_length <= 0 { return None; }
        let window_title = String::from_utf16_lossy(&title_buffer[..title_length as usize]);
        let mut process_id = 0u32;
        GetWindowThreadProcessId(window, Some(&mut process_id));
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()?;
        let mut path_buffer = [0u16; 1024];
        let mut path_length = path_buffer.len() as u32;
        let result = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, windows::core::PWSTR(path_buffer.as_mut_ptr()), &mut path_length);
        let _ = CloseHandle(process);
        let full_path = result.ok().map(|_| String::from_utf16_lossy(&path_buffer[..path_length as usize])).unwrap_or_else(|| "unknown.exe".into());
        let application_name = std::path::Path::new(&full_path).file_name().and_then(|name| name.to_str()).unwrap_or("unknown.exe").to_string();
        Some(ActiveWindow { application_name, window_title })
    }
}

#[cfg(not(windows))]
pub(crate) fn active_window() -> Option<ActiveWindow> { None }

#[cfg(windows)]
fn system_idle_seconds() -> u64 {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    unsafe {
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        if GetLastInputInfo(&mut info).as_bool() { GetTickCount().wrapping_sub(info.dwTime) as u64 / 1000 } else { 0 }
    }
}

#[cfg(not(windows))]
fn system_idle_seconds() -> u64 { 0 }

impl MonitorControl {
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        if !enabled {
            self.paused_until = None;
        }
    }

    pub fn pause_until(&mut self, unix_seconds: u64) {
        if self.enabled {
            self.paused_until = Some(unix_seconds);
        }
    }

    pub fn status(&self, now_seconds: u64, idle: bool) -> MonitorStatus {
        if !self.enabled {
            MonitorStatus::Disabled
        } else if self.paused_until.is_some_and(|until| now_seconds < until) {
            MonitorStatus::Paused
        } else if idle {
            MonitorStatus::Idle
        } else {
            MonitorStatus::Collecting
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ActiveWindow, CapturePolicy, MonitorControl, MonitorStatus, ObservationAccumulator};

    fn window(title: &str) -> ActiveWindow {
        ActiveWindow { application_name: "Code.exe".into(), window_title: title.into() }
    }

    #[test]
    fn window_switch_and_idle_flush_only_real_active_time() {
        let mut accumulator = ObservationAccumulator::new();
        assert!(accumulator.sample(0, Some(window("项目 A")), false).is_none());
        assert!(accumulator.sample(30, Some(window("项目 A")), false).is_none());

        let completed = accumulator.sample(60, Some(window("项目 B")), false).unwrap();
        assert_eq!(completed.window.window_title, "项目 A");
        assert_eq!(completed.duration_seconds, 60);

        let paused = accumulator.sample(90, Some(window("项目 B")), true).unwrap();
        assert_eq!(paused.window.window_title, "项目 B");
        assert_eq!(paused.duration_seconds, 30);
        assert!(accumulator.sample(120, Some(window("项目 B")), true).is_none());
    }

    #[test]
    fn monitoring_requires_consent_and_honors_temporary_pause() {
        let mut control = MonitorControl::default();
        assert_eq!(control.status(10, false), MonitorStatus::Disabled);

        control.set_enabled(true);
        assert_eq!(control.status(10, false), MonitorStatus::Collecting);
        control.pause_until(100);
        assert_eq!(control.status(90, false), MonitorStatus::Paused);
        assert_eq!(control.status(101, false), MonitorStatus::Collecting);
        assert_eq!(control.status(101, true), MonitorStatus::Idle);
    }

    #[test]
    fn long_running_window_is_checkpointed_without_waiting_for_a_switch() {
        let mut accumulator = ObservationAccumulator::new();
        assert!(accumulator.sample(0, Some(window("项目 A")), false).is_none());
        let first = accumulator.checkpoint(60).unwrap();
        assert_eq!(first.duration_seconds, 60);
        let second = accumulator.checkpoint(120).unwrap();
        assert_eq!(second.duration_seconds, 60);
        assert_eq!(second.window.window_title, "项目 A");
    }

    #[test]
    fn capture_policy_only_allows_work_intervals_and_excludes_sensitive_apps() {
        let policy = CapturePolicy::default();

        assert!(policy.allows(1, 9 * 60 + 30, "Code.exe"));
        assert!(!policy.allows(1, 12 * 60 + 30, "Code.exe"));
        assert!(policy.allows(1, 14 * 60, "Code.exe"));
        assert!(!policy.allows(6, 10 * 60, "Code.exe"));

        assert!(!policy.allows(1, 10 * 60, "CredentialUIBroker.exe"));
        assert!(!policy.allows(1, 10 * 60, "LogonUI.exe"));
        assert!(!policy.allows(1, 10 * 60, "consent.exe"));
        assert!(!policy.allows(1, 10 * 60, "traceflow-desktop.exe"));
        assert_eq!(policy.idle_threshold_seconds, 300);
    }

    #[test]
    fn capture_policy_honors_case_insensitive_user_exclusions() {
        let mut policy = CapturePolicy::default();
        policy.excluded_applications.push("CompanySecret.exe".into());
        assert!(!policy.allows(2, 10 * 60, "companysecret.EXE"));
    }

    #[test]
    fn invalid_capture_intervals_are_rejected_and_exclusions_are_normalized() {
        let mut policy = CapturePolicy::default();
        policy.excluded_applications = vec![" Secret.exe ".into(), "secret.EXE".into(), "".into()];
        let normalized = policy.validate_and_normalize().unwrap();
        assert_eq!(normalized.excluded_applications, vec!["Secret.exe"]);

        let mut invalid = CapturePolicy::default();
        invalid.work_intervals[0].start_minute = invalid.work_intervals[0].end_minute;
        assert!(invalid.validate_and_normalize().is_err());

        let mut invalid_idle = CapturePolicy::default();
        invalid_idle.idle_threshold_seconds = 30;
        assert!(invalid_idle.validate_and_normalize().is_err());
    }

    #[test]
    fn excluded_dates_override_a_normal_workday() {
        let mut policy = CapturePolicy::default();
        policy.excluded_dates.push("2026-10-01".into());
        assert!(!policy.allows_on("2026-10-01", 4, 10 * 60, "Code.exe"));
        assert!(policy.allows_on("2026-10-08", 4, 10 * 60, "Code.exe"));
    }

    #[test]
    fn additional_work_date_uses_monday_schedule_on_a_weekend() {
        let mut policy = CapturePolicy::default();
        policy.additional_work_dates.push("2026-10-10".into());
        assert!(policy.allows_on("2026-10-10", 6, 10 * 60, "Code.exe"));
    }
}
use serde::Serialize;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
