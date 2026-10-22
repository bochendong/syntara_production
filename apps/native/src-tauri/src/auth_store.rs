#[cfg(not(any(target_os = "ios", target_os = "android")))]
use keyring::v1::{Entry, Error as KeyringError};
#[cfg(target_os = "ios")]
use keyring_core::{Entry, Error as KeyringError};
use tauri::AppHandle;

#[cfg(not(target_os = "android"))]
const KEYRING_ACCOUNT: &str = "native-platform-session";
const MAX_SESSION_BYTES: usize = 16 * 1024;

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn session_entry(app: &AppHandle) -> Result<Entry, String> {
    Entry::new(&app.config().identifier, KEYRING_ACCOUNT)
        .map_err(|error| format!("无法打开系统钥匙串：{error}"))
}

#[cfg(target_os = "ios")]
fn session_entry(app: &AppHandle) -> Result<Entry, String> {
    use keyring_core::api::CredentialStoreApi;

    let store = apple_native_keyring_store::protected::Store::new()
        .map_err(|error| format!("无法打开系统钥匙串：{error}"))?;
    store
        .build(&app.config().identifier, KEYRING_ACCOUNT, None)
        .map_err(|error| format!("无法打开系统钥匙串：{error}"))
}

/// 安卓没有可用的钥匙串后端：登录状态存在 App 私有目录里，其他 App 读不到。
#[cfg(target_os = "android")]
fn session_file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法找到 App 数据目录：{error}"))?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("无法创建 App 数据目录：{error}"))?;
    Ok(directory.join("native-platform-session.json"))
}

#[cfg(not(target_os = "android"))]
fn load_session(app: &AppHandle) -> Result<Option<String>, String> {
    match session_entry(app)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("无法读取系统钥匙串中的登录状态：{error}")),
    }
}

#[cfg(target_os = "android")]
fn load_session(app: &AppHandle) -> Result<Option<String>, String> {
    match std::fs::read_to_string(session_file(app)?) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("无法读取登录状态：{error}")),
    }
}

#[cfg(not(target_os = "android"))]
fn save_session(app: &AppHandle, session: &str) -> Result<(), String> {
    session_entry(app)?
        .set_password(session)
        .map_err(|error| format!("无法把登录状态写入系统钥匙串：{error}"))
}

#[cfg(target_os = "android")]
fn save_session(app: &AppHandle, session: &str) -> Result<(), String> {
    std::fs::write(session_file(app)?, session)
        .map_err(|error| format!("无法保存登录状态：{error}"))
}

#[cfg(not(target_os = "android"))]
fn clear_session(app: &AppHandle) -> Result<(), String> {
    match session_entry(app)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("无法清除系统钥匙串中的登录状态：{error}")),
    }
}

#[cfg(target_os = "android")]
fn clear_session(app: &AppHandle) -> Result<(), String> {
    match std::fs::remove_file(session_file(app)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("无法清除登录状态：{error}")),
    }
}

#[tauri::command]
pub fn load_native_auth_session(app: AppHandle) -> Result<Option<String>, String> {
    load_session(&app)
}

#[tauri::command]
pub fn save_native_auth_session(app: AppHandle, session: String) -> Result<(), String> {
    if session.is_empty() || session.len() > MAX_SESSION_BYTES {
        return Err("登录状态大小不合法。".to_string());
    }
    serde_json::from_str::<serde_json::Value>(&session)
        .map_err(|_| "登录状态不是有效 JSON。".to_string())?;
    save_session(&app, &session)
}

#[tauri::command]
pub fn clear_native_auth_session(app: AppHandle) -> Result<(), String> {
    clear_session(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_payload_limit_stays_small() {
        assert_eq!(MAX_SESSION_BYTES, 16 * 1024);
    }
}
