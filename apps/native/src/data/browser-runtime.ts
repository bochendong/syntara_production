export const browserApp = import.meta.env?.VITE_SYNTARA_WEB_APP === '1';
let accountId: string | null = null;
export function setBrowserAccount(id: string) {
  accountId = id;
}
export function browserAccountId() {
  if (!accountId) throw new Error('请先登录账号。');
  return accountId;
}
export function accountStorageKey(key: string) {
  return browserApp ? `${key}:${browserAccountId()}` : key;
}
export function platformAvailable() {
  return browserApp || (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window);
}
