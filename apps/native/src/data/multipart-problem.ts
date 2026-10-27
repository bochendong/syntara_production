import type { LocalProblem } from '../domain/models';
import { gradeLocalProblem, type LocalGradeResult } from './local-problem-grading';

/** 大题里一问的作答：选项、文字或填空。 */
export type LocalPartAnswer = {
  selectedOptionIds?: string[];
  text?: string;
  blanks?: Record<string, string>;
  cells?: Record<string, string>;
};

export type LocalPartType =
  | 'choice'
  | 'fill_blank'
  | 'calculation'
  | 'short_answer'
  | 'proof'
  | 'table';

export type LocalProblemPart = {
  label: string;
  points: number;
  dependsOn: string[];
  type: LocalPartType;
  /** 这一问的问法；填空题是带 {{id}} 的模板 */
  prompt: string;
  content: Record<string, unknown>;
  grading: Record<string, unknown>;
};

export type LocalPartResult = {
  label: string;
  status: 'pending' | 'passed' | 'failed' | 'partial';
  /** 这一问的得分率 0–1 */
  score: number;
  /** 这一问占整题的比例 0–1 */
  share: number;
  feedback?: string;
  gradedAt?: number;
  submissions?: number;
  cells?: Array<{ key: string; correct: boolean }>;
};

export const PART_SUBMISSION_LIMIT = 3;
const PART_SCORE_CAPS = [1, 0.6, 0.3];
const PART_TYPES: LocalPartType[] = [
  'choice',
  'fill_blank',
  'calculation',
  'short_answer',
  'proof',
  'table',
];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isMultipartProblem(problem: LocalProblem): boolean {
  return problem.type === 'multipart' || record(problem.publicContent).type === 'multipart';
}

export function multipartStem(problem: LocalProblem): string {
  const stem = record(problem.publicContent).stem;
  return typeof stem === 'string' ? stem : '';
}

export function formatPartLabel(label: string): string {
  const trimmed = label.trim();
  return /^[(（].*[)）]$/.test(trimmed) ? trimmed : `(${trimmed})`;
}

export function multipartParts(problem: LocalProblem): LocalProblemPart[] {
  const content = record(problem.publicContent);
  const gradingParts = Array.isArray(record(problem.grading).parts)
    ? (record(problem.grading).parts as unknown[]).map(record)
    : [];
  const raw = Array.isArray(content.parts) ? content.parts.map(record) : [];
  return raw.flatMap((part) => {
    const label = typeof part.label === 'string' ? part.label.trim() : '';
    const partContent = record(part.content);
    const type = partContent.type as LocalPartType;
    if (!label || !PART_TYPES.includes(type)) return [];
    const prompt =
      type === 'fill_blank'
        ? String(partContent.stemTemplate ?? '')
        : String(partContent.stem ?? '');
    return [
      {
        label,
        points: typeof part.points === 'number' && part.points > 0 ? part.points : 0,
        dependsOn: Array.isArray(part.dependsOn)
          ? part.dependsOn.filter((item): item is string => typeof item === 'string')
          : [],
        type,
        prompt,
        content: partContent,
        grading: record(gradingParts.find((item) => item.label === label)?.grading),
      },
    ];
  });
}

export function partShares(parts: LocalProblemPart[]): number[] {
  const sum = parts.reduce((acc, part) => acc + part.points, 0);
  return parts.map((part) => (sum > 0 ? part.points / sum : 1 / Math.max(1, parts.length)));
}

export function partBlankIds(part: LocalProblemPart): string[] {
  const blanks = Array.isArray(part.content.blanks) ? part.content.blanks.map(record) : [];
  return blanks.map((blank) => String(blank.id ?? '')).filter(Boolean);
}

export function partAnswerHasContent(answer: LocalPartAnswer | undefined): boolean {
  if (!answer) return false;
  return Boolean(
    answer.text?.trim() ||
    answer.selectedOptionIds?.length ||
    Object.values(answer.blanks ?? {}).some((value) => value.trim()) ||
    Object.values(answer.cells ?? {}).some((value) => value.trim()),
  );
}

export function isAutoGradedPart(part: LocalProblemPart): boolean {
  return (
    part.type === 'choice' ||
    part.type === 'fill_blank' ||
    part.type === 'calculation' ||
    part.type === 'table'
  );
}

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\$/g, '').replace(/\s+/g, '').toLowerCase();
}

/** 本机能直接判的小问（选择、填空、计算）；文字题返回 pending，交给 AI 批改。 */
export function gradeLocalPart(
  problem: LocalProblem,
  part: LocalProblemPart,
  answer: LocalPartAnswer,
): LocalGradeResult {
  if (part.type === 'fill_blank') {
    const blanks = Array.isArray(part.grading.blanks) ? part.grading.blanks.map(record) : [];
    if (!blanks.length) {
      return {
        status: 'pending',
        score: null,
        feedback: '这一问没有参考答案，已保存。',
        autoGraded: false,
      };
    }
    const right = blanks.filter((blank) => {
      const accepted = Array.isArray(blank.acceptedAnswers)
        ? blank.acceptedAnswers.filter((item): item is string => typeof item === 'string')
        : [];
      const value = answer.blanks?.[String(blank.id)] ?? '';
      return accepted.some((item) => normalize(item) === normalize(value) && value.trim());
    }).length;
    const score = right / blanks.length;
    return {
      status: score >= 1 ? 'passed' : score > 0 ? 'partial' : 'failed',
      score,
      feedback: `答对 ${right}/${blanks.length} 个空。`,
      autoGraded: true,
    };
  }
  const virtual: LocalProblem = {
    ...problem,
    type: part.type,
    publicContent: part.content,
    grading: part.grading,
  };
  if (part.type === 'choice') {
    return gradeLocalProblem(virtual, {
      kind: 'choice',
      selectedOptionIds: answer.selectedOptionIds ?? [],
    });
  }
  return gradeLocalProblem(virtual, { kind: 'text', text: answer.text ?? '' });
}

/** 自动判分的小问按第几次提交封顶：100% → 60% → 30%。 */
export function capPartScore(score: number, submissions: number): number {
  return score * PART_SCORE_CAPS[Math.max(0, Math.min(2, submissions - 1))];
}

export function aggregatePartResults(results: LocalPartResult[]): {
  status: 'pending' | 'passed' | 'failed' | 'partial';
  score: number;
} {
  const score = results.reduce((acc, part) => acc + part.score * part.share, 0);
  if (results.length && results.every((part) => part.status === 'passed')) {
    return { status: 'passed', score };
  }
  if (results.every((part) => part.status === 'pending')) return { status: 'pending', score };
  if (score <= 0 && results.every((part) => part.status === 'failed')) {
    return { status: 'failed', score };
  }
  return { status: 'partial', score };
}

/** 小问的上下文：共享题干 + 前面各问 + 这一问，给 AI 批改用。 */
export function partQuestionText(problem: LocalProblem, partIndex: number): string {
  const parts = multipartParts(problem);
  return [
    multipartStem(problem),
    ...parts.slice(0, partIndex + 1).map((part) => `${formatPartLabel(part.label)} ${part.prompt}`),
  ].join('\n\n');
}
