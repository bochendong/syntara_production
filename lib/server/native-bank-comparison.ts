import type { PrismaClient } from '@prisma/client';
import type {
  BankComparison,
  BankComparisonGroup,
  ComparisonMetric,
} from '@/lib/problem-bank/bank-comparison';
import {
  csc108PaperSourceTag,
  paperLabels,
  usesCsc108PaperNames,
} from '../../apps/native/src/data/problem-bank-filters';
import { STORE_SOURCES, currentStoreEnrollmentWindow } from './store-enrollment-term';
import { visibleProblemWhere } from './native-problem-sync';

type First = { userId: string; problemId: string; status: string };

export function comparisonMetric(me: number | null, peers: (number | null)[]): ComparisonMetric {
  const sorted = peers.filter((n): n is number => n !== null).sort((a, b) => a - b);
  function quantile(q: number) {
    if (!sorted.length) return null;
    const position = (sorted.length - 1) * q;
    const low = Math.floor(position);
    return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low);
  }
  return { me, median: quantile(0.5), lower: quantile(0.25), upper: quantile(0.75) };
}

function accuracy(rows: First[]) {
  const graded = rows.filter((r) => ['passed', 'partial', 'failed'].includes(r.status));
  return graded.length ? graded.filter((r) => r.status === 'passed').length / graded.length : null;
}

export async function readBankComparison(
  prisma: PrismaClient,
  userId: string,
  courseId: string,
  group: BankComparisonGroup,
  now = new Date(),
): Promise<BankComparison | null> {
  const visible = await visibleProblemWhere(prisma, userId, courseId);
  if (!visible) return null;
  const term = currentStoreEnrollmentWindow(now);
  const [enrollments, course, publicProblems] = await Promise.all([
    prisma.courseEnrollment.findMany({
      where: {
        courseId,
        source: { in: STORE_SOURCES },
        joinedAt: { gte: term.start, lt: term.end },
      },
      select: { userId: true },
    }),
    prisma.course.findUnique({
      where: { id: courseId },
      select: { ownerId: true, name: true, courseCode: true },
    }),
    prisma.notebookProblem.findMany({
      where: { ...visible, status: 'published', ownerId: null },
      select: {
        id: true,
        tags: true,
        chapter: { select: { name: true } },
        notebook: { select: { name: true } },
      },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    }),
  ]);
  if (!course) return null;
  const enrolled = enrollments.map((r) => r.userId).filter((id) => id !== course.ownerId);
  const peerIds = enrolled.filter((id) => id !== userId);
  const userIds = [userId, ...peerIds];
  const csc108 = usesCsc108PaperNames(course);
  const problems = publicProblems.filter((p) => {
    if (group === 'chapters') return true;
    const labels = paperLabels(p.tags, csc108);
    if (group === 'sets') return labels.length > 0;
    return (
      csc108 &&
      labels.some(
        (label) => csc108PaperSourceTag(label) === (group === 'exam' ? '考试原题' : '模拟题'),
      )
    );
  });
  const ids = problems.map((p) => p.id);
  const firsts = ids.length
    ? await prisma.$queryRaw<First[]>`
    SELECT DISTINCT ON ("userId", "problemId") "userId", "problemId", "status"::text AS status
    FROM "NotebookProblemAttempt"
    WHERE "userId" = ANY(${userIds}::text[]) AND "problemId" = ANY(${ids}::text[])
      AND kind IN ('answer', 'submit')
      AND NOT EXISTS (
        SELECT 1 FROM "NotebookProblemProgress" p
        WHERE p."userId" = "NotebookProblemAttempt"."userId" AND p."problemId" = "NotebookProblemAttempt"."problemId"
          AND p."resetAt" >= "NotebookProblemAttempt"."createdAt"
      )
    ORDER BY "userId", "problemId", "createdAt", id
  `
    : [];
  const byUser = new Map<string, First[]>();
  for (const entry of firsts) {
    const rows = byUser.get(entry.userId) ?? [];
    rows.push(entry);
    byUser.set(entry.userId, rows);
  }
  const mine = byUser.get(userId) ?? [];
  const peers = peerIds.map((id) => byUser.get(id) ?? []);
  const metric = (fn: (rows: First[]) => number | null) =>
    comparisonMetric(fn(mine), peers.map(fn));
  const topics = new Map(problems.map((p) => [p.id, p.chapter?.name || p.notebook?.name]));
  const topicNames = [...new Set(topics.values())]
    .filter((n): n is string => Boolean(n))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  return {
    group,
    scope: 'store-term',
    termLabel: term.label,
    enrollmentCount: enrolled.length,
    peerCount: peers.length,
    coverage: metric((rows) => (ids.length ? rows.length / ids.length : null)),
    firstTry: metric(accuracy),
    topics: topicNames.slice(0, 6).map((name) => ({
      name,
      firstTry: metric((rows) => accuracy(rows.filter((r) => topics.get(r.problemId) === name))),
    })),
  };
}
