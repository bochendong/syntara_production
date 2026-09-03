import type { PrismaClient } from '@/lib/server/generated-prisma';

export type LearningRange = '7d' | '30d' | 'term' | 'all';

export function parseLearningRange(value: string | null): LearningRange {
  return value === '30d' || value === 'term' || value === 'all' ? value : '7d';
}

function rangeStart(range: LearningRange, courseCreatedAt: Date) {
  if (range === 'all') return null;
  if (range === 'term') return courseCreatedAt;
  return new Date(Date.now() - (range === '30d' ? 30 : 7) * 86_400_000);
}

function average(values: number[]) {
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
}

export async function loadCourseLearningOverview(args: {
  prisma: PrismaClient;
  courseId: string;
  range: LearningRange;
}) {
  const course = await args.prisma.course.findUnique({
    where: { id: args.courseId },
    select: { createdAt: true, externalBinding: { select: { id: true } } },
  });
  if (!course) throw new Error('Course not found');
  const from = rangeStart(args.range, course.createdAt);
  const problems = await args.prisma.notebookProblem.findMany({
    where: {
      status: { not: 'archived' },
      OR: [{ courseId: args.courseId }, { notebook: { courseId: args.courseId } }],
    },
    select: {
      id: true,
      title: true,
      problemNumber: true,
      tagAssignments: {
        where: { status: 'applied' },
        include: { tag: { include: { parent: true } } },
      },
    },
  });
  const problemIds = problems.map((problem) => problem.id);
  const [enrollments, forumGroups] = await Promise.all([
    args.prisma.courseEnrollment.findMany({
      where: {
        courseId: args.courseId,
        user: {
          isActive: true,
          ...(course.externalBinding
            ? {
                externalCourseMemberships: {
                  some: {
                    bindingId: course.externalBinding.id,
                    role: 'STUDENT',
                    active: true,
                  },
                },
              }
            : {}),
        },
      },
      select: { userId: true, user: { select: { name: true, email: true, image: true } } },
    }),
    args.prisma.courseForumPost.groupBy({
      by: ['problemId'],
      where: {
        courseId: args.courseId,
        problemId: { in: problemIds },
        ...(from ? { createdAt: { gte: from } } : {}),
      },
      _count: { _all: true },
    }),
  ]);
  const enrolledUserIds = enrollments.map((enrollment) => enrollment.userId);
  const attempts = await args.prisma.notebookProblemAttempt.findMany({
    where: {
      problemId: { in: problemIds },
      userId: { in: enrolledUserIds },
      kind: { in: ['submit', 'answer'] },
      ...(from ? { createdAt: { gte: from } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      problemId: true,
      userId: true,
      status: true,
      score: true,
      activeDurationMs: true,
      createdAt: true,
    },
  });
  const forumCount = new Map(forumGroups.map((item) => [item.problemId, item._count._all]));
  const successful = attempts.filter((attempt) => attempt.status === 'passed').length;
  const timed = attempts.flatMap((attempt) =>
    attempt.activeDurationMs == null ? [] : [attempt.activeDurationMs],
  );
  const attemptsByStudent = new Map<string, typeof attempts>();
  const attemptsByProblem = new Map<string, typeof attempts>();
  for (const attempt of attempts) {
    attemptsByStudent.set(attempt.userId, [
      ...(attemptsByStudent.get(attempt.userId) || []),
      attempt,
    ]);
    attemptsByProblem.set(attempt.problemId, [
      ...(attemptsByProblem.get(attempt.problemId) || []),
      attempt,
    ]);
  }
  const problemById = new Map(problems.map((problem) => [problem.id, problem]));
  const difficultProblems = problems
    .map((problem) => {
      const rows = attemptsByProblem.get(problem.id) || [];
      const failures = rows.filter((attempt) => attempt.status !== 'passed');
      const affectedStudents = new Set(failures.map((attempt) => attempt.userId));
      return {
        problemId: problem.id,
        title: problem.title,
        problemNumber: problem.problemNumber,
        affectedStudentCount: affectedStudents.size,
        failureRate: rows.length ? failures.length / rows.length : 0,
        attemptCount: rows.length,
        forumQuestionCount: forumCount.get(problem.id) || 0,
        averageActiveDurationMs: average(
          rows.flatMap((row) => (row.activeDurationMs == null ? [] : [row.activeDurationMs])),
        ),
        timingSampleCount: rows.filter((row) => row.activeDurationMs != null).length,
      };
    })
    .filter((item) => item.affectedStudentCount || item.forumQuestionCount)
    .sort(
      (a, b) =>
        b.affectedStudentCount - a.affectedStudentCount ||
        b.failureRate - a.failureRate ||
        b.forumQuestionCount - a.forumQuestionCount,
    )
    .slice(0, 20);

  const weakPathMap = new Map<
    string,
    { area: string; concept: string; failedStudentIds: Set<string>; failedAttempts: number }
  >();
  for (const attempt of attempts.filter((item) => item.status !== 'passed')) {
    const problem = problemById.get(attempt.problemId);
    for (const assignment of problem?.tagAssignments || []) {
      if (!assignment.tag.parent) continue;
      const key = `${assignment.tag.parent.id}:${assignment.tag.id}`;
      const current = weakPathMap.get(key) || {
        area: assignment.tag.parent.name,
        concept: assignment.tag.name,
        failedStudentIds: new Set<string>(),
        failedAttempts: 0,
      };
      current.failedStudentIds.add(attempt.userId);
      current.failedAttempts += 1;
      weakPathMap.set(key, current);
    }
  }
  const students = enrollments.map((enrollment) => {
    const rows = attemptsByStudent.get(enrollment.userId) || [];
    const passed = rows.filter((attempt) => attempt.status === 'passed').length;
    const durations = rows.flatMap((row) =>
      row.activeDurationMs == null ? [] : [row.activeDurationMs],
    );
    return {
      userId: enrollment.userId,
      name: enrollment.user.name?.trim() || enrollment.user.email?.split('@')[0] || '未命名学生',
      email: enrollment.user.email || '未提供',
      avatarUrl: enrollment.user.image || undefined,
      active: rows.length > 0,
      attemptedProblemCount: new Set(rows.map((row) => row.problemId)).size,
      submissionCount: rows.length,
      passRate: rows.length ? passed / rows.length : null,
      averageActiveDurationMs: average(durations),
      timingSampleCount: durations.length,
      lastSubmissionAt: rows[0]?.createdAt.getTime() ?? null,
    };
  });
  return {
    range: args.range,
    from: from?.toISOString() || null,
    to: new Date().toISOString(),
    sample: { submissionCount: attempts.length, timingSampleCount: timed.length },
    metrics: {
      enrolledStudentCount: enrollments.length,
      activeStudentCount: new Set(attempts.map((attempt) => attempt.userId)).size,
      submissionCount: attempts.length,
      passRate: attempts.length ? successful / attempts.length : null,
      averageActiveDurationMs: average(timed),
    },
    weakTagPaths: Array.from(weakPathMap.values())
      .map((item) => ({
        ...item,
        affectedStudentCount: item.failedStudentIds.size,
        failedStudentIds: undefined,
      }))
      .sort(
        (a, b) =>
          b.affectedStudentCount - a.affectedStudentCount || b.failedAttempts - a.failedAttempts,
      )
      .slice(0, 20),
    difficultProblems,
    students,
  };
}

export async function loadCourseStudentLearningDetail(args: {
  prisma: PrismaClient;
  courseId: string;
  studentId: string;
  range: LearningRange;
}) {
  const overview = await loadCourseLearningOverview({
    prisma: args.prisma,
    courseId: args.courseId,
    range: args.range,
  });
  const student = overview.students.find((item) => item.userId === args.studentId);
  if (!student) return null;
  const problems = await args.prisma.notebookProblem.findMany({
    where: {
      status: { not: 'archived' },
      OR: [{ courseId: args.courseId }, { notebook: { courseId: args.courseId } }],
    },
    orderBy: [{ problemNumber: 'asc' }, { order: 'asc' }],
    select: {
      id: true,
      title: true,
      problemNumber: true,
      difficulty: true,
      tagAssignments: {
        where: { status: 'applied' },
        include: { tag: { include: { parent: true } } },
      },
    },
  });
  const from = overview.from ? new Date(overview.from) : null;
  const attempts = await args.prisma.notebookProblemAttempt.findMany({
    where: {
      userId: args.studentId,
      problemId: { in: problems.map((item) => item.id) },
      kind: { in: ['submit', 'answer'] },
      ...(from ? { createdAt: { gte: from } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      problemId: true,
      status: true,
      score: true,
      activeDurationMs: true,
      timingSource: true,
      createdAt: true,
    },
  });
  const byProblem = new Map<string, typeof attempts>();
  for (const attempt of attempts)
    byProblem.set(attempt.problemId, [...(byProblem.get(attempt.problemId) || []), attempt]);
  return {
    range: overview.range,
    from: overview.from,
    to: overview.to,
    student,
    problems: problems.map((problem) => {
      const rows = byProblem.get(problem.id) || [];
      const timed = rows.flatMap((row) =>
        row.activeDurationMs == null ? [] : [row.activeDurationMs],
      );
      return {
        problemId: problem.id,
        title: problem.title,
        problemNumber: problem.problemNumber,
        difficulty: problem.difficulty,
        status: rows[0]?.status || 'unattempted',
        attemptCount: rows.length,
        averageActiveDurationMs: average(timed),
        timingSampleCount: timed.length,
        latestAttempt: rows[0] ? { ...rows[0], createdAt: rows[0].createdAt.getTime() } : null,
        tagPaths: problem.tagAssignments
          .filter((item) => item.tag.parent)
          .map((item) => ({ area: item.tag.parent!.name, concept: item.tag.name })),
      };
    }),
  };
}
