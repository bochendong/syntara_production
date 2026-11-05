import type { PrismaClient } from '@prisma/client';

import { visibleProblemWhere } from '@/lib/server/native-problem-sync';

/**
 * 题库「和同班比」：这门课公有题上，我和同班同学的四项数字。
 * 同班 = 我所在的本课程最新一个班（老师名单）；没进班就和这门课所有学员比。
 * 只返回我自己的数字、平均、每项最高和名次，不返回任何同学的名字或 id。
 */

export type ClassStandingPeriod = 'week' | 'all';

type MetricKey = 'solved' | 'firstTry' | 'streak' | 'chapters';

export type ClassStandingMetric = {
  me: number;
  average: number;
  top: number;
  /** 这一项可能的最大值（题数、章节数）；比例和天数为空。 */
  max: number | null;
};

export type ClassStanding = {
  courseId: string;
  period: ClassStandingPeriod;
  scope: 'class' | 'course';
  className: string | null;
  size: number;
  rank: number;
  metrics: Record<MetricKey, ClassStandingMetric>;
  /** 第一名做对了、我还没做对最多的那一章。 */
  hint: {
    chapterId: string | null;
    notebookId: string | null;
    chapterName: string | null;
    ahead: number;
    problemIds: string[];
  } | null;
  generatedAt: number;
};

const MAX_COHORT = 400;
const MAX_ATTEMPTS = 80_000;
const MAX_PROBLEMS = 2_000;
const DAY_MS = 86_400_000;

/** 用户本地时间的「第几天」。offsetMinutes 和 Date#getTimezoneOffset 同号（东八区是 -480）。 */
function localDay(at: Date, offsetMinutes: number) {
  return Math.floor((at.getTime() - offsetMinutes * 60_000) / DAY_MS);
}

/** 本周一 0 点（用户本地时间）对应的 UTC 时间。 */
export function weekStart(now: Date, offsetMinutes: number) {
  const day = localDay(now, offsetMinutes);
  // 1970-01-01 是周四；周一为 0。
  const weekday = (day + 3) % 7;
  return new Date((day - weekday) * DAY_MS + offsetMinutes * 60_000);
}

/** 截到今天或昨天的连续做题天数。 */
export function currentStreak(days: Set<number>, today: number) {
  let cursor = days.has(today) ? today : today - 1;
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}

function round(value: number, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

async function readCohort(prisma: PrismaClient, userId: string, courseId: string) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { ownerId: true },
  });
  if (!course) return null;
  const membership = await prisma.courseClassMember.findFirst({
    where: { userId, class: { courseId, archivedAt: null } },
    orderBy: [{ class: { academicYear: 'desc' } }, { joinedAt: 'desc' }],
    select: {
      class: {
        select: {
          id: true,
          name: true,
          teacherId: true,
          members: { select: { userId: true }, take: MAX_COHORT },
        },
      },
    },
  });
  if (membership) {
    const excluded = new Set([membership.class.teacherId, course.ownerId]);
    const ids = membership.class.members
      .map((member) => member.userId)
      .filter((id) => !excluded.has(id));
    return {
      scope: 'class' as const,
      className: membership.class.name,
      userIds: [...new Set([userId, ...ids])],
    };
  }
  const enrollments = await prisma.courseEnrollment.findMany({
    where: { courseId },
    select: { userId: true },
    orderBy: { joinedAt: 'desc' },
    take: MAX_COHORT,
  });
  const ids = enrollments.map((row) => row.userId).filter((id) => id !== course.ownerId);
  return { scope: 'course' as const, className: null, userIds: [...new Set([userId, ...ids])] };
}

export async function readClassStanding(
  prisma: PrismaClient,
  userId: string,
  courseId: string,
  period: ClassStandingPeriod,
  offsetMinutes: number,
  now = new Date(),
): Promise<ClassStanding | null> {
  // 先确认我能看这门课的题。
  if (!(await visibleProblemWhere(prisma, userId, courseId))) return null;
  const cohort = await readCohort(prisma, userId, courseId);
  if (!cohort) return null;

  const problems = await prisma.notebookProblem.findMany({
    where: { courseId, ownerId: null, status: 'published' },
    select: { id: true, chapterId: true, notebookId: true, chapter: { select: { name: true } } },
    take: MAX_PROBLEMS,
  });
  const chapterOf = new Map(
    problems.map((problem) => [
      problem.id,
      problem.chapterId
        ? `c:${problem.chapterId}`
        : problem.notebookId
          ? `n:${problem.notebookId}`
          : '',
    ]),
  );
  const chapterSize = new Map<string, number>();
  for (const key of chapterOf.values()) {
    if (key) chapterSize.set(key, (chapterSize.get(key) ?? 0) + 1);
  }

  const attempts = problems.length
    ? await prisma.notebookProblemAttempt.findMany({
        where: { userId: { in: cohort.userIds }, problemId: { in: problems.map((p) => p.id) } },
        select: { userId: true, problemId: true, status: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: MAX_ATTEMPTS,
      })
    : [];

  const since = period === 'week' ? weekStart(now, offsetMinutes) : null;
  const today = localDay(now, offsetMinutes);
  type Stats = {
    firstPassAt: Map<string, Date>;
    firstAttempt: Map<string, { status: string; at: Date }>;
    days: Set<number>;
  };
  const stats = new Map<string, Stats>();
  for (const id of cohort.userIds) {
    stats.set(id, { firstPassAt: new Map(), firstAttempt: new Map(), days: new Set() });
  }
  for (const attempt of attempts) {
    const entry = stats.get(attempt.userId);
    if (!entry) continue;
    entry.days.add(localDay(attempt.createdAt, offsetMinutes));
    if (!entry.firstAttempt.has(attempt.problemId)) {
      entry.firstAttempt.set(attempt.problemId, { status: attempt.status, at: attempt.createdAt });
    }
    if (attempt.status === 'passed' && !entry.firstPassAt.has(attempt.problemId)) {
      entry.firstPassAt.set(attempt.problemId, attempt.createdAt);
    }
  }

  const values = new Map<string, Record<MetricKey, number>>();
  for (const [id, entry] of stats) {
    const inPeriod = (at: Date) => !since || at >= since;
    const solved = [...entry.firstPassAt.values()].filter(inPeriod).length;
    const firsts = [...entry.firstAttempt.values()].filter((first) => inPeriod(first.at));
    const firstTry = firsts.length
      ? firsts.filter((first) => first.status === 'passed').length / firsts.length
      : 0;
    const passedByChapter = new Map<string, number>();
    for (const problemId of entry.firstPassAt.keys()) {
      const key = chapterOf.get(problemId);
      if (key) passedByChapter.set(key, (passedByChapter.get(key) ?? 0) + 1);
    }
    const chapters = [...passedByChapter].filter(
      ([key, count]) => count >= (chapterSize.get(key) ?? Infinity),
    ).length;
    values.set(id, { solved, firstTry, streak: currentStreak(entry.days, today), chapters });
  }

  const mine = values.get(userId)!;
  const all = [...values.values()];
  const metric = (key: MetricKey, max: number | null): ClassStandingMetric => ({
    me: key === 'firstTry' ? round(mine[key], 3) : mine[key],
    average: round(
      all.reduce((sum, row) => sum + row[key], 0) / all.length,
      key === 'firstTry' ? 3 : 1,
    ),
    top: Math.max(...all.map((row) => row[key])),
    max,
  });
  // 名次按做对题数，一样多再看第一次就对的比例。
  const better = all.filter(
    (row) =>
      row.solved > mine.solved || (row.solved === mine.solved && row.firstTry > mine.firstTry),
  ).length;

  let hint: ClassStanding['hint'] = null;
  const topId = [...values].sort(
    ([, a], [, b]) => b.solved - a.solved || b.firstTry - a.firstTry,
  )[0]?.[0];
  if (topId && topId !== userId) {
    const topPassed = stats.get(topId)!.firstPassAt;
    const myPassed = stats.get(userId)!.firstPassAt;
    const ahead = new Map<string, number>();
    for (const problemId of topPassed.keys()) {
      const key = chapterOf.get(problemId);
      if (key && !myPassed.has(problemId)) ahead.set(key, (ahead.get(key) ?? 0) + 1);
    }
    const best = [...ahead].sort((a, b) => b[1] - a[1])[0];
    if (best) {
      const inChapter = problems.filter(
        (problem) => chapterOf.get(problem.id) === best[0] && !myPassed.has(problem.id),
      );
      const sample = inChapter[0];
      hint = {
        chapterId: sample?.chapterId ?? null,
        notebookId: sample?.chapterId ? null : (sample?.notebookId ?? null),
        chapterName: sample?.chapter?.name ?? null,
        ahead: best[1],
        problemIds: inChapter.map((problem) => problem.id),
      };
    }
  }

  return {
    courseId,
    period,
    scope: cohort.scope,
    className: cohort.className,
    size: cohort.userIds.length,
    rank: better + 1,
    metrics: {
      solved: metric('solved', problems.length),
      firstTry: metric('firstTry', null),
      streak: metric('streak', null),
      chapters: metric('chapters', chapterSize.size),
    },
    hint,
    generatedAt: now.getTime(),
  };
}
