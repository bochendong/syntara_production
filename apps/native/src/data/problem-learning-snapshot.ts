import type {
  LocalProblem,
  LocalProblemAttempt,
  LocalProblemProgress,
  LocalStudyMemory,
} from '../domain/models';
import type { LocalProblemAnswer } from './local-problem-grading';
import type { LocalRepository } from './repository';
import type { SyntaraArchiveV1 } from './archive';

export type ProblemLearningEvent = 'solution_viewed' | 'answer_reset';
export type ProblemProgressSnapshot = Pick<
  LocalProblemProgress,
  'status' | 'score' | 'attemptedCount'
>;

export function solutionReminderKey(accountKey: string) {
  return `${accountKey}:solution-view-confirmation:v1`;
}
export function skipsSolutionReminder(storage: Pick<Storage, 'getItem'>, key: string): boolean {
  try {
    return storage.getItem(key) === 'skip';
  } catch {
    return false;
  }
}
export function rememberSolutionReminder(storage: Pick<Storage, 'setItem'>, key: string) {
  storage.setItem(key, 'skip');
}

export function problemLearningArchive(input: {
  problem: LocalProblem;
  answer: LocalProblemAnswer;
  progress: LocalProblemProgress | null;
  event: ProblemLearningEvent;
  at: number;
  id: string;
}): { archive: SyntaraArchiveV1; attempt: LocalProblemAttempt } {
  const { problem, answer, progress, event, at, id } = input;
  const snapshot: ProblemProgressSnapshot | null = progress
    ? { status: progress.status, score: progress.score, attemptedCount: progress.attemptedCount }
    : null;
  const feedback =
    event === 'solution_viewed'
      ? '查看答案前保存的作答快照（未评分）'
      : '重置后的作答草稿（未评分）';
  const attempt: LocalProblemAttempt = {
    id,
    problemId: problem.id,
    kind: event,
    answer: structuredClone(answer) as unknown as Record<string, unknown>,
    result: { event, progressSnapshot: snapshot, feedback },
    status: 'pending',
    score: null,
    createdAt: at,
    updatedAt: at,
  };
  const memories: LocalStudyMemory[] = [];
  if (event === 'solution_viewed') {
    const draft =
      answer.kind === 'choice'
        ? answer.selectedOptionIds.join(', ') || '尚未选择选项'
        : answer.kind === 'code'
          ? answer.code
          : answer.kind === 'table'
            ? JSON.stringify(answer.cells)
            : answer.kind === 'parts'
              ? JSON.stringify(answer.parts)
              : `${answer.text || '尚未填写文字'}${answer.images?.length ? `；另有 ${answer.images.length} 张作答图片` : ''}`;
    memories.push({
      id: `solution-help:${problem.id}`,
      courseId: problem.courseId,
      notebookId: null,
      targetType: 'course',
      scope: 'course',
      kind: 'solution_help',
      status: 'active',
      source: 'problem-solution-view',
      title: `查看答案求助：${problem.title}`.slice(0, 300),
      text: `学生在「${problem.chapterName || '未分章节'} · ${problem.title}」查看了参考答案。这是求助信号，请关注其卡点，不代表已经掌握或应判为答错。\n查看前的进度：${progress?.status ?? '未作答'}，已提交 ${progress?.attemptedCount ?? 0} 次。\n题目：${String(problem.publicContent.stem ?? problem.publicContent.stemTemplate ?? '').slice(0, 240)}\n当时的作答：${draft.slice(0, 650)}`.slice(
        0,
        1200,
      ),
      reason: '用户确认查看参考答案，保留查看前的思路以支持后续个性化讲解。',
      question:
        String(problem.publicContent.stem ?? problem.publicContent.stemTemplate ?? '').slice(
          0,
          4000,
        ) || null,
      sourceReferences: [
        `problem:${problem.id}`,
        ...problem.tags.slice(0, 6).map((tag) => `concept:${tag}`),
      ],
      confidence: 1,
      createdAt: at,
      updatedAt: at,
    });
  }
  return {
    attempt,
    archive: {
      format: 'syntara-native-archive',
      version: 1,
      exportedAt: at,
      source: { kind: 'native' },
      courses: [],
      notebooks: [],
      notebookPages: [],
      markdownSections: [],
      problems: [],
      problemAttempts: [attempt],
      problemProgress: [],
      conversations: [],
      messages: [],
      studyMemories: memories,
      assets: [],
      pageAssets: [],
      notebookAssets: [],
      missingAssetPaths: [],
    },
  };
}

/** Reveal only after the snapshot and memory are saved; assessed progress is not rewritten. */
export async function saveProblemLearningSnapshot(
  repository: Pick<LocalRepository, 'importArchive' | 'loadProblemDocument'>,
  input: Parameters<typeof problemLearningArchive>[0],
) {
  const saved = problemLearningArchive(input);
  await repository.importArchive(saved.archive);
  const document = await repository.loadProblemDocument(input.problem.id);
  if (!document) throw new Error('作答快照保存后无法读取，请重试。');
  return { attempt: saved.attempt, document };
}
