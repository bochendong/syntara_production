use std::path::{Component, Path, PathBuf};
use std::{collections::HashSet, io::ErrorKind};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

const MAX_ASSET_BYTES: usize = 256 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveAssetPayload {
    id: String,
    sha256: String,
    mime_type: String,
    data_base64: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedAsset {
    id: String,
    storage_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAssetPayload {
    storage_path: String,
    size_bytes: usize,
    sha256: String,
}

fn normalized_sha256(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.len() != 64 || !normalized.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("迁移资源缺少有效的 SHA-256。".to_string());
    }
    Ok(normalized)
}

fn extension_for_mime(mime_type: &str) -> &'static str {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/avif" => "avif",
        "image/gif" => "gif",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/svg+xml" => "svg",
        "image/webp" => "webp",
        "audio/aac" => "aac",
        "audio/m4a" | "audio/mp4" => "m4a",
        "audio/mpeg" => "mp3",
        "audio/ogg" => "ogg",
        "audio/wav" | "audio/x-wav" => "wav",
        "application/pdf" => "pdf",
        _ => "bin",
    }
}

fn safe_mime_type(value: &str) -> &str {
    let trimmed = value.trim();
    let valid = trimmed.len() <= 96
        && trimmed.contains('/')
        && trimmed
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'+' | b'-' | b'.'));
    if valid {
        trimmed
    } else {
        "application/octet-stream"
    }
}

fn relative_storage_path(sha256: &str, mime_type: &str) -> PathBuf {
    PathBuf::from("assets")
        .join(&sha256[..2])
        .join(format!("{sha256}.{}", extension_for_mime(mime_type)))
}

fn resolve_storage_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    let components = path.components().collect::<Vec<_>>();
    let valid = components.len() == 3
        && components[0] == Component::Normal("assets".as_ref())
        && components
            .iter()
            .all(|component| matches!(component, Component::Normal(_)));
    if !valid {
        return Err("本地资源路径无效。".to_string());
    }
    Ok(root.join(path))
}

fn persist_assets(
    root: &Path,
    assets: Vec<ArchiveAssetPayload>,
) -> Result<Vec<PersistedAsset>, String> {
    let mut persisted = Vec::new();
    for asset in assets {
        let Some(encoded) = asset.data_base64 else {
            continue;
        };
        if encoded.len() > MAX_ASSET_BYTES.saturating_mul(4).saturating_div(3) + 8 {
            return Err(format!("资源 {} 超过单文件大小限制。", asset.id));
        }
        let bytes = BASE64
            .decode(encoded.as_bytes())
            .map_err(|_| format!("资源 {} 的 Base64 数据无效。", asset.id))?;
        if bytes.len() > MAX_ASSET_BYTES {
            return Err(format!("资源 {} 超过单文件大小限制。", asset.id));
        }
        let expected = normalized_sha256(&asset.sha256)?;
        let actual = format!("{:x}", Sha256::digest(&bytes));
        if actual != expected {
            return Err(format!("资源 {} 的 SHA-256 校验失败。", asset.id));
        }

        let relative = relative_storage_path(&expected, &asset.mime_type);
        let destination = root.join(&relative);
        let already_valid = std::fs::read(&destination)
            .map(|current| format!("{:x}", Sha256::digest(current)) == expected)
            .unwrap_or(false);
        if !already_valid {
            let parent = destination
                .parent()
                .ok_or_else(|| "无法确定本地资源目录。".to_string())?;
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("无法创建本地资源目录：{error}"))?;
            let temporary = destination.with_extension(format!(
                "{}.tmp-{}",
                extension_for_mime(&asset.mime_type),
                std::process::id()
            ));
            std::fs::write(&temporary, &bytes)
                .map_err(|error| format!("无法写入本地资源：{error}"))?;
            std::fs::rename(&temporary, &destination)
                .map_err(|error| format!("无法提交本地资源：{error}"))?;
        }
        persisted.push(PersistedAsset {
            id: asset.id,
            storage_path: relative.to_string_lossy().into_owned(),
        });
    }
    Ok(persisted)
}

fn delete_asset_files(root: &Path, storage_paths: Vec<String>) -> Result<usize, String> {
    if storage_paths.len() > 2_048 {
        return Err("单次清理的本地资源数量过多。".to_string());
    }
    let mut deleted = 0;
    let mut seen = HashSet::new();
    for storage_path in storage_paths {
        if !seen.insert(storage_path.clone()) {
            continue;
        }
        let path = resolve_storage_path(root, &storage_path)?;
        match std::fs::remove_file(&path) {
            Ok(()) => {
                deleted += 1;
                if let Some(parent) = path.parent() {
                    let _ = std::fs::remove_dir(parent);
                }
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法清理本地资源：{error}")),
        }
    }
    Ok(deleted)
}

#[tauri::command]
pub async fn persist_archive_assets(
    app: AppHandle,
    assets: Vec<ArchiveAssetPayload>,
) -> Result<Vec<PersistedAsset>, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    tauri::async_runtime::spawn_blocking(move || persist_assets(&root, assets))
        .await
        .map_err(|error| format!("本地资源任务中断：{error}"))?
}

#[tauri::command]
pub async fn read_local_asset(
    app: AppHandle,
    storage_path: String,
    mime_type: String,
) -> Result<String, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    let path = resolve_storage_path(&root, &storage_path)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
        .await
        .map_err(|error| format!("本地资源读取任务中断：{error}"))?
        .map_err(|error| format!("无法读取本地资源：{error}"))?;
    Ok(format!(
        "data:{};base64,{}",
        safe_mime_type(&mime_type),
        BASE64.encode(bytes)
    ))
}

#[tauri::command]
pub async fn verify_local_assets(
    app: AppHandle,
    assets: Vec<VerifyAssetPayload>,
) -> Result<bool, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        for asset in assets {
            let path = resolve_storage_path(&root, &asset.storage_path)?;
            let bytes = match std::fs::read(path) {
                Ok(bytes) => bytes,
                Err(_) => return Ok(false),
            };
            if bytes.len() != asset.size_bytes {
                return Ok(false);
            }
            let expected = normalized_sha256(&asset.sha256)?;
            if format!("{:x}", Sha256::digest(bytes)) != expected {
                return Ok(false);
            }
        }
        Ok(true)
    })
    .await
    .map_err(|error| format!("本地资源校验任务中断：{error}"))?
}

#[tauri::command]
pub async fn delete_local_asset_files(
    app: AppHandle,
    storage_paths: Vec<String>,
) -> Result<usize, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    tauri::async_runtime::spawn_blocking(move || delete_asset_files(&root, storage_paths))
        .await
        .map_err(|error| format!("本地资源清理任务中断：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::{
        delete_asset_files, extension_for_mime, normalized_sha256, persist_assets,
        resolve_storage_path, ArchiveAssetPayload,
    };
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
    use sha2::{Digest, Sha256};
    use std::path::Path;

    #[test]
    fn accepts_only_sha256_hex() {
        assert!(normalized_sha256(&"a".repeat(64)).is_ok());
        assert!(normalized_sha256("../not-a-hash").is_err());
    }

    #[test]
    fn keeps_asset_reads_inside_content_store() {
        let root = Path::new("/tmp/syntara");
        assert!(resolve_storage_path(
            root,
            "assets/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"
        )
        .is_ok());
        assert!(resolve_storage_path(root, "assets/../secret").is_err());
        assert!(resolve_storage_path(root, "/etc/passwd").is_err());
    }

    #[test]
    fn uses_known_extensions_only() {
        assert_eq!(extension_for_mime("image/png"), "png");
        assert_eq!(extension_for_mime("../../unsafe"), "bin");
    }

    #[test]
    fn persists_and_reuses_content_addressed_blob() {
        let bytes = b"syntara-local-asset";
        let sha256 = format!("{:x}", Sha256::digest(bytes));
        let root = std::env::temp_dir().join(format!(
            "syntara-asset-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let payload = || ArchiveAssetPayload {
            id: "asset-test".to_string(),
            sha256: sha256.clone(),
            mime_type: "image/png".to_string(),
            data_base64: Some(BASE64.encode(bytes)),
        };

        let first = persist_assets(&root, vec![payload()]).unwrap();
        let second = persist_assets(&root, vec![payload()]).unwrap();
        assert_eq!(first[0].storage_path, second[0].storage_path);
        assert_eq!(
            std::fs::read(root.join(&first[0].storage_path)).unwrap(),
            bytes
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deletes_only_valid_content_store_paths() {
        let root =
            std::env::temp_dir().join(format!("syntara-asset-delete-test-{}", std::process::id()));
        let relative =
            "assets/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"temporary").unwrap();

        assert_eq!(
            delete_asset_files(&root, vec![relative.to_string(), relative.to_string()]).unwrap(),
            1
        );
        assert!(!path.exists());
        assert!(delete_asset_files(&root, vec!["../outside".to_string()]).is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}
