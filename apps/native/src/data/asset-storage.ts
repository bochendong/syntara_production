import type { LocalAsset } from '../domain/models';

interface PersistedAsset {
  id: string;
  storagePath: string;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function persistArchiveAssets(assets: LocalAsset[]): Promise<Map<string, string>> {
  if (!isTauriRuntime()) return new Map();
  const withData = assets.filter((asset) => asset.dataBase64);
  if (!withData.length) return new Map();

  const { invoke } = await import('@tauri-apps/api/core');
  const persisted = new Map<string, string>();
  const batchSize = 4;
  for (let index = 0; index < withData.length; index += batchSize) {
    const batch = withData.slice(index, index + batchSize);
    const result = await invoke<PersistedAsset[]>('persist_archive_assets', {
      assets: batch.map((asset) => ({
        id: asset.id,
        sha256: asset.sha256,
        mimeType: asset.mimeType,
        dataBase64: asset.dataBase64,
      })),
    });
    for (const asset of result) persisted.set(asset.id, asset.storagePath);
  }
  return persisted;
}

export async function readLocalAsset(asset: LocalAsset): Promise<string | null> {
  if (asset.dataBase64) return `data:${asset.mimeType};base64,${asset.dataBase64}`;
  if (!asset.storagePath || !isTauriRuntime()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('read_local_asset', {
    storagePath: asset.storagePath,
    mimeType: asset.mimeType,
  });
}

export async function verifyLocalAssets(assets: LocalAsset[]): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const persisted = assets.filter((asset) => asset.storagePath);
  if (persisted.length !== assets.length) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<boolean>('verify_local_assets', {
    assets: persisted.map((asset) => ({
      storagePath: asset.storagePath,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
    })),
  });
}

export async function deleteLocalAssetFiles(storagePaths: string[]): Promise<void> {
  if (!storagePaths.length || !isTauriRuntime()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke<number>('delete_local_asset_files', {
    storagePaths: [...new Set(storagePaths)],
  });
}
