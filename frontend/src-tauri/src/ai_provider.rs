use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AiProvider {
    Openai,
    Compatible,
    Ollama,
    Codex,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiGenerateRequest {
    pub provider: AiProvider,
    pub base_url: Option<String>,
    pub model: String,
    pub prompt: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiGenerateResponse {
    pub content: String,
    pub provider: String,
    pub model: String,
}

pub fn generate(request: AiGenerateRequest) -> Result<AiGenerateResponse, String> {
    if request.model.trim().is_empty() || request.prompt.trim().is_empty() {
        return Err("模型和发送内容不能为空".into());
    }
    if matches!(request.provider, AiProvider::Codex) {
        return generate_with_codex(request);
    }
    let endpoint = endpoint(&request)?;
    let (secret_id, provider_name, body) = match request.provider {
        AiProvider::Openai => (Some("openai"), "OpenAI", serde_json::json!({ "model": request.model, "input": request.prompt })),
        AiProvider::Compatible => (Some("compatible"), "OpenAI Compatible", serde_json::json!({
            "model": request.model, "messages": [{ "role": "user", "content": request.prompt }], "stream": false
        })),
        AiProvider::Ollama => (None, "Ollama", serde_json::json!({
            "model": request.model, "messages": [{ "role": "user", "content": request.prompt }], "stream": false
        })),
        AiProvider::Codex => unreachable!(),
    };
    let config = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(90)))
        .build();
    let agent: ureq::Agent = config.into();
    let mut builder = agent.post(&endpoint).header("Content-Type", "application/json");
    if let Some(secret_id) = secret_id {
        let key = crate::credential_store::read_secret(secret_id)?.ok_or_else(|| format!("{provider_name} API Key 尚未配置"))?;
        builder = builder.header("Authorization", &format!("Bearer {key}"));
    }
    let mut response = builder.send_json(&body).map_err(safe_http_error)?;
    let payload: serde_json::Value = response.body_mut().with_config().limit(2 * 1024 * 1024).read_json()
        .map_err(|error| format!("无法解析模型响应或响应超过 2 MB: {error}"))?;
    let content = match request.provider {
        AiProvider::Openai => payload.get("output_text").and_then(|value| value.as_str()).map(str::to_string)
            .or_else(|| payload.get("output")?.as_array()?.iter().flat_map(|item| item.get("content").and_then(|value| value.as_array()).into_iter().flatten())
                .find_map(|item| item.get("text").and_then(|value| value.as_str()).map(str::to_string))),
        AiProvider::Compatible | AiProvider::Ollama => payload.pointer("/choices/0/message/content").and_then(|value| value.as_str()).map(str::to_string)
            .or_else(|| payload.pointer("/message/content").and_then(|value| value.as_str()).map(str::to_string)),
        AiProvider::Codex => unreachable!(),
    }.filter(|value| !value.trim().is_empty()).ok_or_else(|| "模型响应中没有可用文本".to_string())?;
    Ok(AiGenerateResponse { content, provider: provider_name.into(), model: request.model })
}

fn endpoint(request: &AiGenerateRequest) -> Result<String, String> {
    match request.provider {
        AiProvider::Openai => Ok("https://api.openai.com/v1/responses".into()),
        AiProvider::Compatible => validate_url(request.base_url.as_deref().ok_or_else(|| "请填写兼容接口地址".to_string())?, false),
        AiProvider::Ollama => validate_url(request.base_url.as_deref().unwrap_or("http://127.0.0.1:11434/api/chat"), true),
        AiProvider::Codex => Err("Codex 使用本地引擎，不使用 HTTP 地址".into()),
    }
}

fn generate_with_codex(request: AiGenerateRequest) -> Result<AiGenerateResponse, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let key = crate::credential_store::read_secret("codex")?.ok_or_else(|| "Codex API Key 尚未配置".to_string())?;
    let executable = codex_executable().ok_or_else(|| "未找到 Codex CLI，请先安装 Codex 或在设置中使用其他模型".to_string())?;
    let work_dir = std::env::temp_dir().join("traceflow-codex");
    std::fs::create_dir_all(&work_dir).map_err(|error| error.to_string())?;
    let output_file = work_dir.join(format!("response-{}.txt", std::process::id()));
    let is_script = executable.extension().and_then(|value| value.to_str()).is_some_and(|value| value.eq_ignore_ascii_case("cmd"));
    let mut command = if is_script {
        let mut command = Command::new("cmd.exe");
        command.arg("/D").arg("/C").arg(&executable);
        command
    } else {
        Command::new(&executable)
    };
    command.args(["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--sandbox", "read-only", "--color", "never", "--output-last-message"])
        .arg(&output_file).arg("--model").arg(&request.model).arg("-")
        .current_dir(&work_dir).env("CODEX_HOME", work_dir.join("home"))
        .env("CODEX_API_KEY", &key).env("OPENAI_API_KEY", &key)
        .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
    let mut child = command.spawn().map_err(|error| format!("无法启动 Codex: {error}"))?;
    child.stdin.take().ok_or_else(|| "无法写入 Codex 请求".to_string())?
        .write_all(request.prompt.as_bytes()).map_err(|error| error.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(180);
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? { break status; }
        if Instant::now() >= deadline {
            let _ = child.kill();
            return Err("Codex 调用超过 180 秒，已终止".into());
        }
        std::thread::sleep(Duration::from_millis(200));
    };
    if !status.success() {
        return Err(format!("Codex 调用失败（退出码 {:?}），请检查 API Key、模型和网络", status.code()));
    }
    let content = std::fs::read_to_string(&output_file).map_err(|error| format!("无法读取 Codex 结果: {error}"))?;
    let _ = std::fs::remove_file(output_file);
    if content.trim().is_empty() { return Err("Codex 未返回文本".into()); }
    Ok(AiGenerateResponse { content, provider: "Codex".into(), model: request.model })
}

fn codex_executable() -> Option<std::path::PathBuf> {
    if let Some(configured) = std::env::var_os("TRACEFLOW_CODEX_PATH").map(std::path::PathBuf::from).filter(|path| path.exists()) {
        return Some(configured);
    }
    std::env::var_os("APPDATA").map(std::path::PathBuf::from).map(|path| path.join("npm").join("codex.cmd"))
        .filter(|path| path.exists())
        .or_else(|| Some(std::path::PathBuf::from("codex.exe")).filter(|path| path.exists()))
}


fn validate_url(value: &str, loopback_only: bool) -> Result<String, String> {
    let parsed = url::Url::parse(value).map_err(|_| "模型接口地址格式无效".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") { return Err("模型接口只支持 HTTP/HTTPS".into()); }
    if loopback_only && !parsed.host_str().is_some_and(|host| matches!(host, "127.0.0.1" | "localhost" | "::1")) {
        return Err("Ollama 一期只允许连接本机回环地址".into());
    }
    Ok(parsed.to_string())
}

fn safe_http_error(error: ureq::Error) -> String {
    match error {
        ureq::Error::StatusCode(code) => format!("模型接口返回 HTTP {code}"),
        other => format!("无法连接模型接口: {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::{endpoint, AiGenerateRequest, AiProvider};

    fn request(provider: AiProvider, base_url: Option<&str>) -> AiGenerateRequest {
        AiGenerateRequest { provider, base_url: base_url.map(str::to_string), model: "test".into(), prompt: "test".into() }
    }

    #[test]
    fn openai_is_pinned_and_ollama_is_loopback_only() {
        assert_eq!(endpoint(&request(AiProvider::Openai, None)).unwrap(), "https://api.openai.com/v1/responses");
        assert!(endpoint(&request(AiProvider::Ollama, Some("http://127.0.0.1:11434/api/chat"))).is_ok());
        assert!(endpoint(&request(AiProvider::Ollama, Some("http://example.com/api/chat"))).is_err());
    }
}
