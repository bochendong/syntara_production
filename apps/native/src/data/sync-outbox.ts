import { browserAccountId } from './browser-runtime';
import type { LocalRepository } from './repository';

export function syncPrefix(kind: string, courseId: string): string {
  return `sync.v2:${encodeURIComponent(browserAccountId())}:${kind}:${encodeURIComponent(courseId)}:`;
}
export async function queueSync(
  repository: LocalRepository,
  kind: string,
  courseId: string,
  id: string,
  payload: unknown,
  updatedAt?: number,
) {
  const key = syncPrefix(kind, courseId) + encodeURIComponent(id);
  const value = JSON.stringify(payload);
  await repository.putSyncEntry(key, value, updatedAt);
  return { key, value };
}
