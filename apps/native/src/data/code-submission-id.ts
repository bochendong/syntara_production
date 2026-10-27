import { accountStorageKey } from './browser-runtime';

type PendingCode = { id: string; code: string };
function key(problemId: string) {
  return accountStorageKey(`syntara.code-submission.v1:${problemId}`);
}
export function pendingCodeSubmission(problemId: string, code: string): string {
  const storageKey = key(problemId);
  try {
    const raw = window.localStorage.getItem(storageKey);
    const existing = raw ? (JSON.parse(raw) as PendingCode) : null;
    if (existing?.code === code && /^[a-zA-Z0-9_-]{8,80}$/.test(existing.id)) return existing.id;
    const id = crypto.randomUUID();
    window.localStorage.setItem(storageKey, JSON.stringify({ id, code }));
    return id;
  } catch {
    throw new Error('无法安全保存提交状态，请检查设备存储后重试。');
  }
}
export function clearPendingCodeSubmission(problemId: string, id: string) {
  try {
    const storageKey = key(problemId);
    const raw = window.localStorage.getItem(storageKey);
    if (raw && (JSON.parse(raw) as PendingCode).id === id)
      window.localStorage.removeItem(storageKey);
  } catch {
    /* A retained ID safely replays the same server result. */
  }
}
