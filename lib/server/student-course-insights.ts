import { prisma } from '@/lib/server/prisma';

export async function loadStudentCourseInsights(studentId: string, courseId: string) {
  const enrollment = await prisma.courseEnrollment.findUnique({
    where: { userId_courseId: { userId: studentId, courseId } },
    select: { id: true },
  });
  if (!enrollment) return null;
  const [usage, activities, conversations, legacy, chapters, attempts] = await Promise.all([
    prisma.$queryRaw<Array<{ credits: number; tokens: number; requests: number }>>`
      SELECT COALESCE(SUM(-"delta"), 0)::float8 AS credits,
        COALESCE(SUM(CASE WHEN metadata->>'totalTokens' ~ '^[0-9]+$' THEN (metadata->>'totalTokens')::numeric ELSE 0 END), 0)::float8 AS tokens,
        COUNT(*)::int AS requests
      FROM "CreditTransaction" WHERE "userId" = ${studentId} AND "delta" < 0 AND metadata->>'courseId' = ${courseId}`,
    prisma.learningActionLog.findMany({
      where: { userId: studentId, courseId },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, actionType: true, createdAt: true },
    }),
    prisma.courseConversation.findMany({
      where: { ownerId: studentId, courseId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 3,
      select: { id: true, title: true, updatedAt: true, messageCount: true },
    }),
    prisma.conversation.findMany({
      where: {
        ownerId: studentId,
        AND: [
          { OR: [{ courseId }, { courseId: null, notebook: { courseId } }] },
          { OR: [{ targetId: null }, { NOT: { targetId: { startsWith: 'learn:' } } }] },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 3,
      select: { id: true, title: true, updatedAt: true, _count: { select: { messages: true } } },
    }),
    prisma.$queryRaw<
      Array<{ id: string; name: string; total: number; attempted: number; passed: number }>
    >`
      SELECT COALESCE(c.id, 'unassigned') AS id, COALESCE(c.name, '未分章') AS name,
        COUNT(p.id)::int AS total,
        COUNT(p.id) FILTER (WHERE progress."attemptedCount" > 0)::int AS attempted,
        COUNT(p.id) FILTER (WHERE progress."passedCount" > 0)::int AS passed
      FROM "NotebookProblem" p
      LEFT JOIN "CourseProblemChapter" c ON c.id = p."chapterId"
      LEFT JOIN "NotebookProblemProgress" progress ON progress."problemId" = p.id AND progress."userId" = ${studentId}
      WHERE (p."courseId" = ${courseId} OR (p."courseId" IS NULL AND p."notebookId" IN (SELECT id FROM "Notebook" WHERE "courseId" = ${courseId})))
      GROUP BY c.id, c.name, c.position ORDER BY c.position NULLS LAST, c.name`,
    prisma.notebookProblemAttempt.findMany({
      where: {
        userId: studentId,
        problem: { OR: [{ courseId }, { courseId: null, notebook: { courseId } }] },
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, createdAt: true, problem: { select: { id: true, title: true } } },
    }),
  ]);
  return {
    usage: usage[0],
    activities: [
      ...activities.map((row) => ({
        ...row,
        label: null as string | null,
        problemId: null as string | null,
      })),
      ...attempts.map((row) => ({
        id: row.id,
        actionType: 'QUIZ_COMPLETED' as const,
        label: '提交练习：' + row.problem.title,
        createdAt: row.createdAt,
        problemId: row.problem.id,
      })),
    ]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, 3),
    conversations: [
      ...conversations,
      ...legacy.map(({ _count, ...row }) => ({ ...row, messageCount: _count.messages })),
    ]
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(0, 3),
    chapters,
  };
}
