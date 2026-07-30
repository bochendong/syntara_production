import snapshotJson from './snapshots/production-problem-bank.v1.json' with { type: 'json' };
import type { LocalCourse, LocalProblem } from '../domain/models';

type SnapshotCourse = LocalCourse & {
  sourceCourseId: string;
  sourceName: string;
  problemCount: number;
};

type ProblemSnapshot = {
  format: 'syntara-native-problem-snapshot';
  schemaVersion: 1;
  snapshotId: string;
  exportedAt: number;
  integrity: {
    algorithm: 'sha256';
    value: string;
  };
  courses: SnapshotCourse[];
  problems: LocalProblem[];
};

const snapshot = snapshotJson as ProblemSnapshot;

if (
  snapshot.format !== 'syntara-native-problem-snapshot' ||
  snapshot.schemaVersion !== 1 ||
  !snapshot.snapshotId ||
  !snapshot.integrity?.value
) {
  throw new Error('内置题库快照格式无效。');
}

const courseIds = new Set(snapshot.courses.map((course) => course.id));
const problemIds = new Set<string>();
const problemCounts = new Map<string, number>();
for (const problem of snapshot.problems) {
  if (!courseIds.has(problem.courseId) || problem.status !== 'published') {
    throw new Error(`内置题库快照包含无效题目：${problem.id}`);
  }
  if (problemIds.has(problem.id)) {
    throw new Error(`内置题库快照包含重复题目：${problem.id}`);
  }
  problemIds.add(problem.id);
  problemCounts.set(problem.courseId, (problemCounts.get(problem.courseId) ?? 0) + 1);
}
for (const course of snapshot.courses) {
  if ((problemCounts.get(course.id) ?? 0) !== course.problemCount) {
    throw new Error(`内置题库快照数量不匹配：${course.courseCode ?? course.id}`);
  }
}

export const bundledProblemSnapshotVersion = `${snapshot.snapshotId}:${snapshot.integrity.value}`;

export const bundledProblemCourses: LocalCourse[] = snapshot.courses.map(
  ({
    sourceCourseId: _sourceCourseId,
    sourceName: _sourceName,
    problemCount: _problemCount,
    ...course
  }) => course,
);

export const bundledProblems: LocalProblem[] = snapshot.problems;

export const bundledProblemCounts = Object.fromEntries(
  snapshot.courses.map((course) => [course.courseCode ?? course.id, course.problemCount]),
);

export const bundledProblemCount = snapshot.problems.length;

export const legacyDemoProblemIds = [
  'problem-riemann-1-local',
  'problem-substitution-1-local',
  'problem-tree-1-local',
];
