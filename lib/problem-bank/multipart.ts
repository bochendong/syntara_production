import type {
  NotebookProblemAttemptAnswer,
  NotebookProblemAttemptStatus,
  NotebookProblemGrading,
  NotebookProblemPart,
  NotebookProblemPartAnswer,
  NotebookProblemPartGrading,
  NotebookProblemPartPublicContent,
  NotebookProblemPartResult,
  NotebookProblemPublicContent,
  NotebookProblemPublicMultipart,
  NotebookProblemRecord,
} from './schema';

/** 自动判分、按次数限分的小问题型；文字/证明题交给 AI 批改，不限次数。 */
const AUTO_GRADED_PART_TYPES = new Set<NotebookProblemPartPublicContent['type']>([
  'choice',
  'fill_blank',
  'calculation',
  'table',
]);

export const MULTIPART_PART_SUBMISSION_LIMIT = 3;

export function isAutoGradedPartType(type: NotebookProblemPartPublicContent['type']): boolean {
  return AUTO_GRADED_PART_TYPES.has(type);
}

/** 这一问自己的问法（填空用 stemTemplate）。 */
export function partPromptText(content: NotebookProblemPartPublicContent): string {
  return content.type === 'fill_blank' ? content.stemTemplate : content.stem;
}

/** 原卷编号的显示形式：a → (a)，已经带括号的不重复加。 */
export function formatPartLabel(label: string): string {
  const trimmed = label.trim();
  return /^[(（].*[)）]$/.test(trimmed) ? trimmed : `(${trimmed})`;
}

/**
 * 每问在 0–total 分里占多少：按 parts[].points 比例分；全为 0 时平均分。
 */
export function partPointShares(parts: Array<Pick<NotebookProblemPart, 'points'>>, total: number) {
  const sum = parts.reduce((acc, part) => acc + Math.max(0, part.points || 0), 0);
  return parts.map((part) =>
    sum > 0 ? (Math.max(0, part.points || 0) / sum) * total : total / Math.max(1, parts.length),
  );
}

/**
 * 整道大题的纯文本/Markdown：共享题干 + 每问问法（选择题带选项）。
 * 给 AI 讲题、去重、搜索、预览这些只需要「整题文字」的地方用。
 */
export function multipartStatementMarkdown(content: NotebookProblemPublicMultipart): string {
  const parts = content.parts.map((part) => {
    const lines = [`**${formatPartLabel(part.label)}** ${partPromptText(part.content)}`];
    if (part.content.type === 'choice') {
      for (const option of part.content.options) lines.push(`- ${option.id}. ${option.label}`);
    }
    return lines.join('\n');
  });
  return [content.stem, ...parts].join('\n\n');
}

/** 任何题型的完整题面文字；大题会把小问拼进去。 */
export function problemStatementText(content: NotebookProblemPublicContent): string {
  if (content.type === 'multipart') return multipartStatementMarkdown(content);
  if (content.type === 'fill_blank') return content.stemTemplate;
  return content.stem;
}

export function partGradingFor(
  grading: NotebookProblemGrading,
  label: string,
): NotebookProblemPartGrading | null {
  if (grading.type !== 'multipart') return null;
  return grading.parts.find((part) => part.label === label)?.grading ?? null;
}

/**
 * 把大题里的一问包装成一道普通题，方便复用现有的判分器和作答控件。
 * 题面 = 共享题干 + 前面各问 + 这一问，让 AI 批改时看得到上下文。
 */
export function buildPartProblem(
  problem: NotebookProblemRecord & { publicContent: NotebookProblemPublicMultipart },
  partIndex: number,
  points: number,
): NotebookProblemRecord | null {
  const part = problem.publicContent.parts[partIndex];
  if (!part) return null;
  const grading = partGradingFor(problem.grading, part.label);
  if (!grading || grading.type !== part.content.type) return null;
  const context = [
    problem.publicContent.stem,
    ...problem.publicContent.parts
      .slice(0, partIndex)
      .map((previous) => `${formatPartLabel(previous.label)} ${partPromptText(previous.content)}`),
  ].join('\n\n');
  const prompt = `${formatPartLabel(part.label)} ${partPromptText(part.content)}`;
  const content =
    part.content.type === 'fill_blank'
      ? { ...part.content, stemTemplate: `${context}\n\n${prompt}` }
      : { ...part.content, stem: `${context}\n\n${prompt}` };
  return {
    ...problem,
    id: `${problem.id}#${part.label}`,
    type: part.content.type,
    points,
    publicContent: content,
    grading,
  } as NotebookProblemRecord;
}

export function partAnswerIsEmpty(answer: NotebookProblemPartAnswer | undefined): boolean {
  if (!answer) return true;
  return (
    !answer.text?.trim() &&
    !(answer.selectedOptionIds ?? []).length &&
    !Object.values(answer.blanks ?? {}).some((value) => value.trim()) &&
    !Object.values(answer.cells ?? {}).some((value) => value.trim()) &&
    !(answer.images ?? []).length
  );
}

/** 只留下真正填了内容的小问，标签必须是题目里有的。 */
export function submittedPartAnswers(
  content: NotebookProblemPublicMultipart,
  answer: NotebookProblemAttemptAnswer,
): Record<string, NotebookProblemPartAnswer> {
  const labels = new Set(content.parts.map((part) => part.label));
  return Object.fromEntries(
    Object.entries(answer.parts ?? {}).filter(
      ([label, value]) => labels.has(label) && !partAnswerIsEmpty(value),
    ),
  );
}

/** 各问结果汇总成整题状态：全对 passed，一分没有 failed，其余 partial；没交过的问算未完成。 */
export function aggregatePartStatus(
  results: Array<Pick<NotebookProblemPartResult, 'status' | 'score'>>,
): NotebookProblemAttemptStatus {
  if (results.length === 0) return 'pending';
  if (results.every((result) => result.status === 'passed')) return 'passed';
  const earned = results.reduce((acc, result) => acc + result.score, 0);
  if (earned <= 0 && results.every((result) => result.status === 'failed')) return 'failed';
  if (earned <= 0 && results.every((result) => result.status === 'pending')) return 'pending';
  return 'partial';
}
