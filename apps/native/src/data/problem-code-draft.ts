type DraftStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function problemCodeDraftKey(accountKey: string, courseId: string, problemId: string) {
  return `${accountKey}:${JSON.stringify([courseId, problemId])}`;
}

export function readProblemCodeDraft(storage: DraftStorage, key: string): string | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  try {
    const draft: unknown = JSON.parse(raw);
    if (draft && typeof draft === 'object' && 'code' in draft && typeof draft.code === 'string') {
      return draft.code;
    }
  } catch {
    // Invalid data must not prevent opening the question.
  }
  return null;
}

export function saveProblemCodeDraft(storage: DraftStorage, key: string, code: string) {
  storage.setItem(key, JSON.stringify({ code, savedAt: Date.now() }));
}
