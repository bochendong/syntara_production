import { accountStorageKey } from './browser-runtime';
import type { LocalProblemDocument } from '../domain/models';

export function bankRoundStorageKey(courseId: string) {
  return accountStorageKey('syntara.bank-round.v1:' + courseId);
}

export function bankResetTimes(courseId: string): Record<string, number> {
  if (typeof window === 'undefined') return {};
  const saved = window.localStorage.getItem(bankRoundStorageKey(courseId));
  return saved ? JSON.parse(saved) : {};
}

export function currentBankDocument(document: LocalProblemDocument) {
  const since = bankResetTimes(document.problem.courseId)[document.problem.id];
  if (!since) return document;
  return {
    ...document,
    attempts: document.attempts.filter((a) => a.createdAt > since),
    progress: (document.progress?.lastAttemptAt ?? 0) > since ? document.progress : null,
  };
}
