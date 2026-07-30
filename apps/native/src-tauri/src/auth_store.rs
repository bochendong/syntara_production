use keyring::v1::{Entry, Error as KeyringError};

const KEYRING_SERVICE: &str = "com.syntara.local";
const KEYRING_ACCOUNT: &str = "native-platform-session";
const MAX_SESSION_BYTES: usize = 16 * 1024;

fn session_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|error| format!("无法打开系统钥匙串：{error}"))
}

#[tauri::command]
pub fn load_native_auth_session() -> Result<Option<String>, String> {
    match session_entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("无法读取系统钥匙串中的登录状态：{error}")),
    }
}

#[tauri::command]
pub fn save_native_auth_session(session: String) -> Result<(), String> {
    if session.is_empty() || session.len() > MAX_SESSION_BYTES {
        return Err("登录状态大小不合法。".to_string());
    }
    serde_json::from_str::<serde_json::Value>(&session)
        .map_err(|_| "登录状态不是有效 JSON。".to_string())?;
    session_entry()?
        .set_password(&session)
        .map_err(|error| format!("无法把登录状态写入系统钥匙串：{error}"))
}

#[tauri::command]
pub fn clear_native_auth_session() -> Result<(), String> {
    match session_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("无法清除系统钥匙串中的登录状态：{error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_payload_limit_stays_small() {
        assert_eq!(MAX_SESSION_BYTES, 16 * 1024);
    }
}
