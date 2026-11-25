import { platformAvailable } from './browser-runtime';
import { getLocalRepository } from './repository';
import { getNativeBankOverview } from './platform-api-client';
import { visibleBankProblems } from './problem-bank-filters';
import { isPrivateProblem, readCourseLayers } from '../lib/course-layers';
import { readPlatformCourseMeta } from '../lib/platform-course-meta';

export type BankStats = { total: number; attempted: number };

export async function loadBankStats(courseId: string): Promise<BankStats> {
  const repository = await getLocalRepository();
  const enrolled = readPlatformCourseMeta()[courseId]?.accessRole === 'enrolled';
  const localProgress = repository.listProblemProgress(courseId);
  const [local, overview] = await Promise.all([
    localProgress,
    platformAvailable() ? getNativeBankOverview(courseId) : loadLocalOverview(),
  ]);
  const visible = visibleBankProblems(overview.problems, (p) => enrolled && p.layer === 'private');
  const resetAt = new Map(overview.progress.map((row) => [row.problemId, row.resetAt ?? 0]));
  const currentLocal = local.filter(
    (row) => (row.lastAttemptAt ?? 0) > (resetAt.get(row.problemId) ?? -1),
  );
  const submitted = new Set(
    [...currentLocal, ...overview.progress]
      .filter((p) => p.attemptedCount > 0)
      .map((p) => p.problemId),
  );
  return { total: visible.length, attempted: visible.filter((p) => submitted.has(p.id)).length };

  async function loadLocalOverview() {
    const workspace = await repository.loadCourseWorkspace(courseId);
    if (!workspace) throw new Error('课程题库暂不可用');
    const layers = readCourseLayers(courseId);
    return {
      problems: workspace.problems.map(({ id, status }) => ({
        id,
        status,
        layer: isPrivateProblem(layers, id) ? ('private' as const) : ('public' as const),
      })),
      progress: [],
    };
  }
}
