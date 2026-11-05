type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};

/** Only submitted text crosses devices. Photos and handwriting stay on the submitting device. */
export function syncedAttemptAnswer(value: unknown): RecordValue {
  const answer = record(value);
  const result: RecordValue = {};
  for (const key of ['text', 'code', 'sourceCode'])
    if (typeof answer[key] === 'string') result[key] = answer[key];
  if (Array.isArray(answer.selectedOptionIds))
    result.selectedOptionIds = answer.selectedOptionIds.filter((id) => typeof id === 'string');
  for (const key of ['blanks', 'cells']) {
    if (answer[key] && typeof answer[key] === 'object')
      result[key] = Object.fromEntries(
        Object.entries(record(answer[key])).filter(([, text]) => typeof text === 'string'),
      );
  }
  if (Array.isArray(answer.images) && answer.images.length) result.hasImages = true;
  if (answer.handwriting || answer.hasImages === true) result.hasImages = true;
  if (answer.parts && typeof answer.parts === 'object')
    result.parts = Object.fromEntries(
      Object.entries(record(answer.parts)).map(([label, part]) => [
        label,
        syncedAttemptAnswer(part),
      ]),
    );
  result.kind = result.parts
    ? 'parts'
    : result.selectedOptionIds
      ? 'choice'
      : result.blanks
        ? 'blanks'
        : result.cells
          ? 'table'
          : typeof result.code === 'string'
            ? 'code'
            : 'text';
  return result;
}

export function attemptScoreRatio(score: number | null, points: number): number | null {
  return score !== null && points > 0 ? Math.max(0, Math.min(1, score / points)) : null;
}

/** Result fields used by the learner history view. Never return arbitrary stored assets/state. */
export function syncedAttemptResult(value: unknown, totalPoints?: number): RecordValue | null {
  if (!value || typeof value !== 'object') return null;
  const raw = record(value);
  const result: RecordValue = {};
  for (const key of ['feedback', 'analysis', 'aiGradingError', 'event'])
    if (typeof raw[key] === 'string') result[key] = raw[key];
  for (const key of ['correct', 'autoGraded'])
    if (typeof raw[key] === 'boolean') result[key] = raw[key];
  for (const key of ['share', 'gradedAt', 'submissions'])
    if (typeof raw[key] === 'number') result[key] = raw[key];
  for (const key of ['publicSummary', 'secretSummary', 'progressSnapshot']) {
    if (!raw[key]) continue;
    result[key] = Object.fromEntries(
      Object.entries(record(raw[key])).filter(
        ([field, entry]) =>
          ['passed', 'total', 'status', 'score', 'attemptedCount'].includes(field) &&
          (entry === null || ['string', 'number', 'boolean'].includes(typeof entry)),
      ),
    );
  }
  for (const key of ['cells', 'publicCases', 'caseResults', 'designRecipe']) {
    if (!Array.isArray(raw[key])) continue;
    result[key] = raw[key].map((item) =>
      Object.fromEntries(
        Object.entries(record(item)).filter(
          ([field, entry]) =>
            [
              'key',
              'correct',
              'id',
              'description',
              'passed',
              'actual',
              'error',
              'stdout',
              'target',
              'detail',
            ].includes(field) && ['string', 'number', 'boolean'].includes(typeof entry),
        ),
      ),
    );
  }
  if (Array.isArray(raw.parts))
    result.parts = raw.parts.map((value) => {
      const part = record(value);
      return {
        ...syncedAttemptResult(part),
        label: part.label,
        status: part.status,
        ...(typeof part.points === 'number' && totalPoints && totalPoints > 0
          ? { share: part.points / totalPoints }
          : {}),
        score:
          typeof part.score === 'number' && typeof part.points === 'number'
            ? attemptScoreRatio(part.score, part.points)
            : part.score,
      };
    });
  if (raw.serverCodeResult)
    result.serverCodeResult = syncedAttemptResult(raw.serverCodeResult, totalPoints);
  return result;
}
