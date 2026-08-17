use serde::Serialize;
use serde::Deserialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

#[derive(Clone)]
pub struct ArtifactDiscoveryPolicy {
    pub content_authorized: bool,
    pub modified_since: SystemTime,
    pub maximum_files: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactEvidence {
    pub path: PathBuf,
    pub title: String,
    pub project_name: String,
    pub summary: String,
    pub modified_at_unix_seconds: u64,
}

#[derive(Default, Deserialize, Serialize)]
pub struct ArtifactCursor {
    emitted_versions: HashMap<PathBuf, u64>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AutoOrganizerSettings {
    pub enabled: bool,
    pub file_discovery_enabled: bool,
    pub file_content_authorized: bool,
    pub auto_create_projects: bool,
    pub wecom_passive_capture_enabled: bool,
    pub wecom_idle_sync_enabled: bool,
    pub wecom_history_days: u16,
}

impl Default for AutoOrganizerSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            file_discovery_enabled: true,
            file_content_authorized: false,
            auto_create_projects: true,
            wecom_passive_capture_enabled: false,
            wecom_idle_sync_enabled: false,
            wecom_history_days: 90,
        }
    }
}

impl AutoOrganizerSettings {
    fn validate(self) -> Result<Self, String> {
        if !(1..=730).contains(&self.wecom_history_days) {
            return Err("企业微信历史范围必须在 1–730 天之间".into());
        }
        Ok(self)
    }
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoOrganizerStatus {
    pub enabled: bool,
    pub last_scan_unix_seconds: Option<u64>,
    pub discovered_artifacts: usize,
    pub imported_artifacts: usize,
    pub last_error: Option<String>,
}

#[derive(Clone)]
pub struct AutoOrganizerRuntime {
    settings: Arc<Mutex<AutoOrganizerSettings>>,
    cursor: Arc<Mutex<ArtifactCursor>>,
    status: Arc<Mutex<AutoOrganizerStatus>>,
    settings_path: PathBuf,
    cursor_path: PathBuf,
}

impl AutoOrganizerRuntime {
    pub fn new(data_dir: PathBuf) -> Self {
        let settings_path = data_dir.join("auto-organizer-settings.json");
        let cursor_path = data_dir.join("auto-organizer-cursor.json");
        let settings = read_json(&settings_path).unwrap_or_default();
        let cursor = read_json(&cursor_path).unwrap_or_default();
        Self {
            settings: Arc::new(Mutex::new(settings)),
            cursor: Arc::new(Mutex::new(cursor)),
            status: Arc::new(Mutex::new(AutoOrganizerStatus::default())),
            settings_path,
            cursor_path,
        }
    }

    pub fn start(&self) {
        let runtime = self.clone();
        let _ = std::thread::Builder::new().name("traceflow-auto-organizer".into()).spawn(move || loop {
            let _ = runtime.scan_now();
            std::thread::sleep(Duration::from_secs(60));
        });
    }

    pub fn settings(&self) -> Result<AutoOrganizerSettings, String> {
        self.settings.lock().map(|value| value.clone()).map_err(|_| "自动整理设置不可用".into())
    }

    pub fn save_settings(&self, settings: AutoOrganizerSettings) -> Result<AutoOrganizerSettings, String> {
        let settings = settings.validate()?;
        write_json(&self.settings_path, &settings)?;
        *self.settings.lock().map_err(|_| "自动整理设置不可用".to_string())? = settings.clone();
        Ok(settings)
    }

    pub fn status(&self) -> Result<AutoOrganizerStatus, String> {
        self.status.lock().map(|value| value.clone()).map_err(|_| "自动整理状态不可用".into())
    }

    pub fn scan_now(&self) -> Result<AutoOrganizerStatus, String> {
        let settings = self.settings()?;
        if !settings.enabled || !settings.file_discovery_enabled {
            let mut status = self.status.lock().map_err(|_| "自动整理状态不可用".to_string())?;
            status.enabled = settings.enabled;
            return Ok(status.clone());
        }
        let roots = default_work_roots();
        let evidence = discover_recent_artifacts(&ArtifactDiscoveryPolicy {
            content_authorized: settings.file_content_authorized,
            modified_since: start_of_local_day(),
            maximum_files: 200,
        }, &roots);
        let mut imported = 0usize;
        let mut last_error = None;
        let mut cursor = self.cursor.lock().map_err(|_| "自动整理游标不可用".to_string())?;
        for item in &evidence {
            if !cursor.should_emit(&item.path, item.modified_at_unix_seconds) { continue; }
            match send_artifact_evidence(item) {
                Ok(()) => {
                    cursor.mark_emitted(&item.path, item.modified_at_unix_seconds);
                    imported += 1;
                }
                Err(error) => {
                    last_error = Some(error);
                    break;
                }
            }
        }
        write_json(&self.cursor_path, &*cursor)?;
        let result = AutoOrganizerStatus {
            enabled: true,
            last_scan_unix_seconds: Some(unix_seconds()),
            discovered_artifacts: evidence.len(),
            imported_artifacts: imported,
            last_error,
        };
        *self.status.lock().map_err(|_| "自动整理状态不可用".to_string())? = result.clone();
        Ok(result)
    }
}

impl ArtifactCursor {
    pub fn should_emit(&self, path: &Path, modified_at_unix_seconds: u64) -> bool {
        self.emitted_versions.get(path).copied() != Some(modified_at_unix_seconds)
    }

    pub fn mark_emitted(&mut self, path: &Path, modified_at_unix_seconds: u64) {
        self.emitted_versions.insert(path.to_path_buf(), modified_at_unix_seconds);
    }
}

const ALLOWED_EXTENSIONS: &[&str] = &[
    "md", "txt", "csv", "tsv", "json", "sql", "java", "kt", "rs", "py", "js", "jsx",
    "ts", "tsx", "vue", "go", "cs", "cpp", "c", "h", "html", "css", "scss", "yaml", "yml",
];
const EXCLUDED_DIRECTORIES: &[&str] = &[
    ".git", ".idea", ".vscode", "node_modules", "target", "dist", "build", "out", ".next",
    ".cache", "AppData", "$Recycle.Bin",
];
const SENSITIVE_NAMES: &[&str] = &[
    ".env", ".npmrc", ".pypirc", "credentials", "credentials.json", "id_rsa", "id_ed25519",
    "known_hosts", "secrets.json",
];

pub fn discover_recent_artifacts(policy: &ArtifactDiscoveryPolicy, roots: &[PathBuf]) -> Vec<ArtifactEvidence> {
    let mut evidence = Vec::new();
    let mut visited = 0usize;
    for root in roots {
        visit(root, root, policy, 0, &mut visited, &mut evidence);
        if evidence.len() >= policy.maximum_files || visited >= 25_000 { break; }
    }
    evidence.sort_by_key(|item| std::cmp::Reverse(item.modified_at_unix_seconds));
    evidence.truncate(policy.maximum_files);
    evidence
}

fn visit(root: &Path, current: &Path, policy: &ArtifactDiscoveryPolicy, depth: usize, visited: &mut usize, output: &mut Vec<ArtifactEvidence>) {
    if depth > 8 || *visited >= 25_000 || output.len() >= policy.maximum_files.saturating_mul(4).max(100) { return; }
    let Ok(entries) = std::fs::read_dir(current) else { return; };
    for entry in entries.flatten() {
        *visited += 1;
        if *visited >= 25_000 { return; }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if !EXCLUDED_DIRECTORIES.iter().any(|value| value.eq_ignore_ascii_case(&name)) {
                visit(root, &path, policy, depth + 1, visited, output);
            }
            continue;
        }
        if output.len() >= policy.maximum_files.saturating_mul(4).max(100) { return; }
        if is_sensitive(&name) || !allowed_extension(&path) { continue; }
        let Ok(metadata) = entry.metadata() else { continue; };
        if metadata.len() > 10 * 1024 * 1024 { continue; }
        let Ok(modified) = metadata.modified() else { continue; };
        if modified < policy.modified_since { continue; }
        let summary = if policy.content_authorized { read_text_preview(&path) } else { String::new() };
        output.push(ArtifactEvidence {
            path: path.clone(),
            title: name,
            project_name: project_name(root, &path),
            summary,
            modified_at_unix_seconds: modified.duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_secs(),
        });
    }
}

fn default_work_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(profile) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
        for name in ["Documents", "Desktop"] {
            let path = profile.join(name);
            if path.is_dir() { roots.push(path); }
        }
    }
    if let Some(one_drive) = std::env::var_os("OneDrive").map(PathBuf::from) {
        for name in ["Documents", "Desktop"] {
            let path = one_drive.join(name);
            if path.is_dir() && !roots.contains(&path) { roots.push(path); }
        }
    }
    roots
}

fn start_of_local_day() -> SystemTime {
    let now = time::OffsetDateTime::now_local().unwrap_or_else(|_| time::OffsetDateTime::now_utc());
    let midnight = now.date().with_hms(0, 0, 0).expect("midnight is a valid time");
    let unix = midnight.assume_offset(now.offset()).unix_timestamp().max(0) as u64;
    SystemTime::UNIX_EPOCH + Duration::from_secs(unix)
}

fn unix_seconds() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    std::fs::read(path).ok().and_then(|content| serde_json::from_slice(&content).ok())
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let content = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    std::fs::write(path, content).map_err(|error| error.to_string())
}

fn send_artifact_evidence(item: &ArtifactEvidence) -> Result<(), String> {
    let occurred_at = time::OffsetDateTime::from_unix_timestamp(item.modified_at_unix_seconds as i64)
        .unwrap_or_else(|_| time::OffsetDateTime::now_utc())
        .format(&time::format_description::well_known::Rfc3339).map_err(|error| error.to_string())?;
    let body = serde_json::to_vec(&serde_json::json!({
        "occurredAt": occurred_at,
        "sourceType": "LOCAL_FILE",
        "sourceName": "本机工作文件",
        "projectName": item.project_name,
        "title": format!("更新 {}", item.title),
        "summary": item.summary,
        "evidenceLevel": if item.summary.is_empty() { "METADATA" } else { "CONTENT" },
        "durationMinutes": 1,
        "includedInReport": true
    })).map_err(|error| error.to_string())?;
    let mut stream = TcpStream::connect_timeout(&"127.0.0.1:17890".parse().unwrap(), Duration::from_secs(2))
        .map_err(|error| error.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).map_err(|error| error.to_string())?;
    write!(stream, "POST /api/events HTTP/1.1\r\nHost: 127.0.0.1:17890\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).map_err(|error| error.to_string())?;
    stream.write_all(&body).map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(|error| error.to_string())?;
    if response.starts_with("HTTP/1.1 201") || response.starts_with("HTTP/1.0 201") { Ok(()) }
    else { Err("本地工作文件证据入库失败".into()) }
}

fn allowed_extension(path: &Path) -> bool {
    path.extension().and_then(|value| value.to_str())
        .is_some_and(|extension| ALLOWED_EXTENSIONS.iter().any(|value| value.eq_ignore_ascii_case(extension)))
}

fn is_sensitive(name: &str) -> bool {
    SENSITIVE_NAMES.iter().any(|value| value.eq_ignore_ascii_case(name))
        || name.ends_with(".key") || name.ends_with(".pem") || name.ends_with(".pfx") || name.ends_with(".kdbx")
}

fn read_text_preview(path: &Path) -> String {
    let Ok(bytes) = std::fs::read(path) else { return String::new(); };
    let limit = bytes.len().min(64 * 1024);
    let text = String::from_utf8_lossy(&bytes[..limit]);
    text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(2_000).collect()
}

fn project_name(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).ok()
        .and_then(|relative| relative.components().next())
        .map(|value| value.as_os_str().to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "本地工作文件".into())
}

#[cfg(test)]
mod tests {
    use super::{discover_recent_artifacts, ArtifactCursor, ArtifactDiscoveryPolicy};
    use std::time::{Duration, SystemTime};

    #[test]
    fn authorized_discovery_finds_only_recent_work_files_and_ignores_sensitive_or_build_content() {
        let root = std::env::temp_dir().join(format!("traceflow-artifacts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("project-a/src")).unwrap();
        std::fs::create_dir_all(root.join("project-a/node_modules/pkg")).unwrap();
        std::fs::write(root.join("project-a/src/report.md"), "完成指标接口校验和日报整理").unwrap();
        std::fs::write(root.join("project-a/.env"), "SECRET=must-not-be-read").unwrap();
        std::fs::write(root.join("project-a/node_modules/pkg/index.js"), "generated").unwrap();

        let evidence = discover_recent_artifacts(
            &ArtifactDiscoveryPolicy {
                content_authorized: true,
                modified_since: SystemTime::now() - Duration::from_secs(60),
                maximum_files: 20,
            },
            std::slice::from_ref(&root),
        );

        assert_eq!(evidence.len(), 1);
        assert_eq!(evidence[0].title, "report.md");
        assert_eq!(evidence[0].project_name, "project-a");
        assert!(evidence[0].summary.contains("指标接口校验"));
        assert!(!evidence.iter().any(|item| item.summary.contains("SECRET")));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn artifact_cursor_emits_a_file_once_and_emits_it_again_only_after_a_change() {
        let path = std::path::PathBuf::from("C:/work/project/report.md");
        let mut cursor = ArtifactCursor::default();
        assert!(cursor.should_emit(&path, 100));
        cursor.mark_emitted(&path, 100);
        assert!(!cursor.should_emit(&path, 100));
        assert!(cursor.should_emit(&path, 101));
    }
}
