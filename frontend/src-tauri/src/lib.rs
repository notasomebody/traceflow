use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

struct BackendProcess(Mutex<Option<Child>>);

fn java_executable(resource_dir: &std::path::Path) -> PathBuf {
    let bundled = if cfg!(target_os = "windows") {
        resource_dir.join("runtime").join("bin").join("java.exe")
    } else {
        resource_dir.join("runtime").join("bin").join("java")
    };
    if bundled.exists() { bundled } else { PathBuf::from("java") }
}

fn backend_jar(resource_dir: &std::path::Path) -> PathBuf {
    let bundled = resource_dir.join("backend").join("traceflow-backend.jar");
    if bundled.exists() {
        bundled
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../backend/target/traceflow-backend.jar")
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
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
            let child = Command::new(java_executable(&resource_dir))
                .args(["-jar", backend_jar(&resource_dir).to_string_lossy().as_ref()])
                .env("TRACEFLOW_DB_PATH", data_dir.join("traceflow.db"))
                .env("TRACEFLOW_PORT", "17890")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|error| format!("无法启动迹汇本地后端: {error}"))?;
            app.manage(BackendProcess(Mutex::new(Some(child))));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("无法创建迹汇桌面应用");

    application.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let state = app_handle.state::<BackendProcess>();
            if let Ok(mut process) = state.0.lock() {
                if let Some(child) = process.as_mut() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    });
}
