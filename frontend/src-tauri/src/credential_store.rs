const ALLOWED_SECRET_IDS: &[&str] = &["openai", "compatible", "codex"];

fn target_name(secret_id: &str) -> Result<String, String> {
    if !ALLOWED_SECRET_IDS.contains(&secret_id) {
        return Err("不支持的密钥类型".into());
    }
    Ok(format!("TraceFlow:ai:{secret_id}"))
}

#[cfg(windows)]
pub fn save_secret(secret_id: &str, value: &str) -> Result<(), String> {
    use windows::core::PWSTR;
    use windows::Win32::Security::Credentials::{CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC};
    if value.is_empty() { return Err("密钥不能为空".into()); }
    let mut target: Vec<u16> = target_name(secret_id)?.encode_utf16().chain(Some(0)).collect();
    let mut username: Vec<u16> = "TraceFlow".encode_utf16().chain(Some(0)).collect();
    let mut blob = value.as_bytes().to_vec();
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target.as_mut_ptr()),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: PWSTR(username.as_mut_ptr()),
        ..Default::default()
    };
    unsafe { CredWriteW(&credential, 0).map_err(|error| error.to_string()) }
}

#[cfg(windows)]
pub fn read_secret(secret_id: &str) -> Result<Option<String>, String> {
    use windows::Win32::Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC};
    let target: Vec<u16> = target_name(secret_id)?.encode_utf16().chain(Some(0)).collect();
    let mut credential = std::ptr::null_mut::<CREDENTIALW>();
    let read = unsafe { CredReadW(windows::core::PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None, &mut credential) };
    if let Err(error) = read {
        return if error.code().0 as u32 == 0x80070490 { Ok(None) } else { Err(error.to_string()) };
    }
    unsafe {
        let value = std::slice::from_raw_parts((*credential).CredentialBlob, (*credential).CredentialBlobSize as usize);
        let result = String::from_utf8(value.to_vec()).map_err(|_| "Windows 凭据中的密钥格式无效".to_string());
        CredFree(credential.cast());
        result.map(Some)
    }
}

#[cfg(windows)]
pub fn delete_secret(secret_id: &str) -> Result<(), String> {
    use windows::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};
    let target: Vec<u16> = target_name(secret_id)?.encode_utf16().chain(Some(0)).collect();
    unsafe { CredDeleteW(windows::core::PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None).map_err(|error| error.to_string()) }
}

#[cfg(not(windows))]
pub fn save_secret(_secret_id: &str, _value: &str) -> Result<(), String> { Err("一期密钥保管仅支持 Windows".into()) }
#[cfg(not(windows))]
pub fn read_secret(_secret_id: &str) -> Result<Option<String>, String> { Err("一期密钥保管仅支持 Windows".into()) }
#[cfg(not(windows))]
pub fn delete_secret(_secret_id: &str) -> Result<(), String> { Err("一期密钥保管仅支持 Windows".into()) }

#[cfg(test)]
mod tests {
    #[test]
    fn credential_targets_are_whitelisted_and_namespaced() {
        assert_eq!(super::target_name("openai").unwrap(), "TraceFlow:ai:openai");
        assert!(super::target_name("arbitrary-windows-credential").is_err());
    }
}
