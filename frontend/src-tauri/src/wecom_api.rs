use serde::{Deserialize, Serialize};

const OFFICIAL_BASE_URL: &str = "https://qyapi.weixin.qq.com";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeComFetchRequest {
    pub corp_id: String,
    pub creator: Option<String>,
    pub start_time: i64,
    pub end_time: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeComJournal {
    pub journal_uuid: String,
    pub template_name: String,
    pub report_time: i64,
    pub submitter: String,
    pub text_content: String,
}

pub fn test_connection(corp_id: &str) -> Result<String, String> {
    let _ = access_token(corp_id)?;
    Ok("企业微信官方接口连接成功".into())
}

pub fn fetch_reports(request: WeComFetchRequest) -> Result<Vec<WeComJournal>, String> {
    if request.start_time <= 0 || request.end_time < request.start_time {
        return Err("汇报时间范围无效".into());
    }
    let token = access_token(&request.corp_id)?;
    let base = base_url()?;
    let list_url = format!("{base}/cgi-bin/oa/journal/get_record_list?access_token={token}");
    let filters = request.creator.as_deref().filter(|value| !value.trim().is_empty())
        .map(|creator| vec![serde_json::json!({"key":"creator","value":creator})])
        .unwrap_or_default();
    let body = serde_json::json!({
        "starttime": request.start_time,
        "endtime": request.end_time,
        "cursor": 0,
        "limit": 100,
        "filters": filters
    });
    let list = post_json(&list_url, &body)?;
    ensure_success(&list)?;
    let ids = list.get("journaluuid_list").and_then(serde_json::Value::as_array)
        .ok_or_else(|| "企业微信未返回汇报记录列表".to_string())?;
    ids.iter().filter_map(serde_json::Value::as_str).map(|id| {
        let detail_url = format!("{base}/cgi-bin/oa/journal/get_record_detail?access_token={token}");
        let detail = post_json(&detail_url, &serde_json::json!({"journaluuid":id}))?;
        ensure_success(&detail)?;
        parse_journal(&detail)
    }).collect()
}

fn access_token(corp_id: &str) -> Result<String, String> {
    if corp_id.trim().is_empty() { return Err("请填写企业 ID（CorpID）".into()); }
    let secret = crate::credential_store::read_secret("wecom-report")?
        .ok_or_else(|| "请先保存汇报应用 Secret".to_string())?;
    let base = base_url()?;
    let mut url = url::Url::parse(&format!("{base}/cgi-bin/gettoken")).map_err(|_| "企业微信接口地址无效".to_string())?;
    url.query_pairs_mut().append_pair("corpid", corp_id.trim()).append_pair("corpsecret", &secret);
    let mut response = ureq::get(url.as_str()).config().timeout_global(Some(std::time::Duration::from_secs(30))).build().call()
        .map_err(safe_error)?;
    let value: serde_json::Value = response.body_mut().with_config().limit(1024 * 1024).read_json()
        .map_err(|error| format!("无法解析企业微信响应：{error}"))?;
    ensure_success(&value)?;
    value.get("access_token").and_then(serde_json::Value::as_str).map(str::to_string)
        .ok_or_else(|| "企业微信未返回 access_token".to_string())
}

fn post_json(url: &str, body: &serde_json::Value) -> Result<serde_json::Value, String> {
    let mut response = ureq::post(url).config().timeout_global(Some(std::time::Duration::from_secs(30))).build()
        .send_json(body).map_err(safe_error)?;
    response.body_mut().with_config().limit(4 * 1024 * 1024).read_json()
        .map_err(|error| format!("无法解析企业微信响应：{error}"))
}

fn ensure_success(value: &serde_json::Value) -> Result<(), String> {
    let code = value.get("errcode").and_then(serde_json::Value::as_i64).unwrap_or(-1);
    if code == 0 { return Ok(()); }
    let message = value.get("errmsg").and_then(serde_json::Value::as_str).unwrap_or("未知错误");
    Err(match code {
        301065 => "当前汇报应用没有数据拉取权限，请让企业管理员在汇报应用中授权".into(),
        40013 | 40014 | 41001 => "企业 ID、Secret 或访问令牌无效".into(),
        60020 => "当前公网 IP 未加入企业微信可信 IP".into(),
        _ => format!("企业微信接口错误 {code}：{message}"),
    })
}

fn parse_journal(value: &serde_json::Value) -> Result<WeComJournal, String> {
    let info = value.get("info").ok_or_else(|| "企业微信汇报详情缺少 info".to_string())?;
    let mut lines = Vec::new();
    collect_text(info.get("apply_data").unwrap_or(&serde_json::Value::Null), &mut lines);
    Ok(WeComJournal {
        journal_uuid: info.get("journal_uuid").and_then(serde_json::Value::as_str).unwrap_or_default().into(),
        template_name: info.get("template_name").and_then(serde_json::Value::as_str).unwrap_or("企业微信汇报").into(),
        report_time: info.get("report_time").and_then(serde_json::Value::as_i64).unwrap_or_default(),
        submitter: info.pointer("/submitter/userid").and_then(serde_json::Value::as_str).unwrap_or_default().into(),
        text_content: lines.join("\n"),
    })
}

fn collect_text(value: &serde_json::Value, output: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(title) = map.get("title").and_then(serde_json::Value::as_str) {
                if !title.trim().is_empty() { output.push(title.trim().to_string()); }
            }
            for key in ["text", "new_number", "new_money"] {
                if let Some(text) = map.get(key).and_then(serde_json::Value::as_str) {
                    if !text.trim().is_empty() { output.push(text.trim().to_string()); }
                }
            }
            for (key, child) in map {
                if !matches!(key.as_str(), "title" | "text" | "new_number" | "new_money") { collect_text(child, output); }
            }
        }
        serde_json::Value::Array(items) => items.iter().for_each(|item| collect_text(item, output)),
        _ => {}
    }
}

fn base_url() -> Result<String, String> {
    let value = std::env::var("TRACEFLOW_WECOM_BASE_URL").unwrap_or_else(|_| OFFICIAL_BASE_URL.into());
    let parsed = url::Url::parse(&value).map_err(|_| "企业微信接口地址无效".to_string())?;
    let allowed = parsed.host_str().is_some_and(|host| host == "qyapi.weixin.qq.com" || matches!(host, "127.0.0.1" | "localhost" | "::1"));
    if !allowed || !matches!(parsed.scheme(), "http" | "https") { return Err("企业微信接口只允许官方域名或本机测试地址".into()); }
    Ok(value.trim_end_matches('/').to_string())
}

fn safe_error(error: ureq::Error) -> String {
    match error {
        ureq::Error::Timeout(_) => "连接企业微信超时，请检查网络".into(),
        ureq::Error::StatusCode(code) => format!("企业微信接口返回 HTTP {code}"),
        other => format!("无法连接企业微信：{other}"),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn journal_text_is_flattened_for_user_review() {
        let fixture = serde_json::json!({"errcode":0,"info":{"journal_uuid":"j1","template_name":"日报","report_time":123,"submitter":{"userid":"u1"},"apply_data":{"contents":[{"title":"今日工作总结","value":{"text":"完成接口联调"}},{"title":"工时","value":{"new_number":"8"}}]}}});
        let parsed = super::parse_journal(&fixture).unwrap();
        assert_eq!(parsed.submitter, "u1");
        assert!(parsed.text_content.contains("今日工作总结\n完成接口联调"));
        assert!(parsed.text_content.contains("工时\n8"));
    }

    #[test]
    fn official_permission_error_is_actionable() {
        let error = super::ensure_success(&serde_json::json!({"errcode":301065,"errmsg":"no permission"})).unwrap_err();
        assert!(error.contains("管理员"));
    }
}
