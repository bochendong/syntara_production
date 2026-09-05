'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Flame,
  LayoutDashboard,
  LibraryBig,
  RotateCcw,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { StudentCoursePageFrame } from '@/components/course-space/student-course-page-frame';
import { CourseSpaceImageCard } from '@/components/course-space/course-space-image-card';
import { Button } from '@/components/ui/button';
import { resolveCourseAvatarDisplayUrl } from '@/lib/constants/course-avatars';
import { resolveCourseBackgroundDisplayUrl } from '@/lib/constants/course-backgrounds';
import { usePersistHydrated } from '@/lib/hooks/use-persist-hydrated';
import { useAuthStore } from '@/lib/store/auth';
import { useCurrentCourseStore } from '@/lib/store/current-course';
import {
  listCourseProblemSummaries,
  type CourseProblemClientSummary,
} from '@/lib/utils/notebook-problem-api';
import { getCourseOrThrow } from '@/lib/utils/course-storage';
import type { CourseRecord } from '@/lib/utils/database';
import { cn } from '@/lib/utils';

type DashboardState = {
  course: CourseRecord;
  problems: CourseProblemClientSummary[];
};

type TopicProgress = {
  name: string;
  total: number;
  attempted: number;
  mastered: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function purposeLabel(purpose: CourseRecord['purpose']): string {
  if (purpose === 'research') return '科研';
  if (purpose === 'university') return '大学课程';
  return '日常学习';
}

function isAttempted(problem: CourseProblemClientSummary): boolean {
  return Boolean(problem.latestAttempt || (problem.attemptStats?.attemptedCount ?? 0) > 0);
}

function isMastered(problem: CourseProblemClientSummary): boolean {
  return problem.latestAttempt?.status === 'passed' || (problem.attemptStats?.passedCount ?? 0) > 0;
}

function percentage(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function problemTopic(problem: CourseProblemClientSummary): string {
  return (
    problem.chapterName?.trim() ||
    problem.notebookName?.trim() ||
    problem.tags.find((tag) => tag.trim())?.trim() ||
    '未分类知识点'
  );
}

function buildTopicProgress(problems: CourseProblemClientSummary[]): TopicProgress[] {
  const rows = new Map<string, TopicProgress>();
  for (const problem of problems) {
    const name = problemTopic(problem);
    const row = rows.get(name) ?? { name, total: 0, attempted: 0, mastered: 0 };
    row.total += 1;
    if (isAttempted(problem)) row.attempted += 1;
    if (isMastered(problem)) row.mastered += 1;
    rows.set(name, row);
  }
  return Array.from(rows.values())
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, 'zh-CN'))
    .slice(0, 6);
}

function startOfLocalDay(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function buildWeeklyActivity(problems: CourseProblemClientSummary[]) {
  const today = startOfLocalDay(Date.now());
  const counts = new Map<number, number>();
  for (const problem of problems) {
    const attemptedAt = problem.latestAttempt?.createdAt;
    if (!attemptedAt) continue;
    const day = startOfLocalDay(attemptedAt);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return Array.from({ length: 7 }, (_, index) => {
    const day = today - (6 - index) * DAY_MS;
    return {
      key: day,
      label: new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(day),
      value: counts.get(day) ?? 0,
    };
  });
}

function StatCard({
  icon: Icon,
  label,
  value,
  helper,
  tone,
}: {
  icon: typeof Target;
  label: string;
  value: string;
  helper: string;
  tone: string;
}) {
  return (
    <article className="rounded-[22px] border border-slate-200/80 bg-white/92 p-4 shadow-[0_14px_38px_rgba(15,23,42,0.055)] dark:border-white/10 dark:bg-white/[0.055]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
            {value}
          </p>
        </div>
        <span className={cn('grid size-10 place-items-center rounded-2xl', tone)}>
          <Icon className="size-5" strokeWidth={1.9} />
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-400">{helper}</p>
    </article>
  );
}

function EmptyChart({ children }: { children: string }) {
  return (
    <div className="grid min-h-40 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-5 text-center text-xs leading-5 text-slate-500 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-400">
      {children}
    </div>
  );
}

export default function CourseDetailPageClient() {
  const params = useParams();
  const router = useRouter();
  const courseId = typeof params.id === 'string' ? params.id : '';
  const authHydrated = usePersistHydrated(useAuthStore);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const portalRole = useAuthStore((state) => state.role);
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!authHydrated) return;
    if (!isLoggedIn) {
      router.replace('/speedup/signed-out?role=student');
      return;
    }
    if (portalRole !== 'STUDENT' && courseId) {
      router.replace(`/teacher/courses/${encodeURIComponent(courseId)}`);
    }
  }, [authHydrated, courseId, isLoggedIn, portalRole, router]);

  useEffect(() => {
    if (!authHydrated || !isLoggedIn || portalRole !== 'STUDENT' || !courseId) return;
    let alive = true;
    const controller = new AbortController();
    void Promise.all([
      getCourseOrThrow(courseId, { signal: controller.signal, timeoutMs: 60_000 }),
      listCourseProblemSummaries(courseId, {
        lean: true,
        signal: controller.signal,
        timeoutMs: 60_000,
      }),
    ])
      .then(([course, problems]) => {
        if (!alive) return;
        setDashboard({ course, problems });
        setError('');
        setLoading(false);
      })
      .catch((loadError) => {
        if (!alive || controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : 'Dashboard 暂时无法读取。');
        setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [authHydrated, courseId, isLoggedIn, portalRole, reloadKey]);

  useEffect(() => {
    if (!dashboard?.course) return;
    useCurrentCourseStore.getState().setCurrentCourse({
      id: dashboard.course.id,
      name: dashboard.course.name,
      avatarUrl: dashboard.course.avatarUrl,
    });
  }, [dashboard?.course]);

  const metrics = useMemo(() => {
    const problems = dashboard?.problems.filter((problem) => problem.status !== 'archived') ?? [];
    const total = problems.length;
    const attempted = problems.filter(isAttempted).length;
    const mastered = problems.filter(isMastered).length;
    const needsReview = problems.filter(
      (problem) =>
        problem.latestAttempt?.status === 'failed' ||
        problem.latestAttempt?.status === 'partial' ||
        problem.latestAttempt?.status === 'error',
    ).length;
    const classStudentCount = Math.max(
      0,
      ...problems.map((problem) => problem.classStats?.studentCount ?? 0),
    );
    const classAttempts = problems.reduce(
      (sum, problem) => sum + (problem.classStats?.attemptedStudentCount ?? 0),
      0,
    );
    const classPasses = problems.reduce(
      (sum, problem) => sum + (problem.classStats?.passedStudentCount ?? 0),
      0,
    );
    const classOpportunities = total * classStudentCount;
    return {
      problems,
      total,
      attempted,
      mastered,
      needsReview,
      completion: percentage(attempted, total),
      mastery: percentage(mastered, total),
      accuracy: percentage(mastered, attempted),
      classStudentCount,
      classCompletion: percentage(classAttempts, classOpportunities),
      classMastery: percentage(classPasses, classOpportunities),
      topics: buildTopicProgress(problems),
      weekly: buildWeeklyActivity(problems),
    };
  }, [dashboard?.problems]);

  if (!authHydrated || !isLoggedIn || portalRole !== 'STUDENT' || (loading && !dashboard)) {
    return <StudentCoursePageFrame courseId={courseId} active="dashboard" />;
  }

  if (!dashboard) {
    return (
      <StudentCoursePageFrame courseId={courseId} active="dashboard">
        <div className="max-w-md rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm dark:border-white/10 dark:bg-white/[0.06]">
          <CircleAlert className="mx-auto size-9 text-amber-500" strokeWidth={1.7} />
          <h1 className="mt-4 text-lg font-semibold text-slate-950 dark:text-white">
            Dashboard 暂时无法读取
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{error}</p>
          <Button
            type="button"
            className="mt-5 rounded-xl"
            onClick={() => {
              setLoading(true);
              setError('');
              setReloadKey((value) => value + 1);
            }}
          >
            <RotateCcw className="mr-1.5 size-4" />
            重新加载
          </Button>
        </div>
      </StudentCoursePageFrame>
    );
  }

  const { course } = dashboard;
  const avatarUrl = resolveCourseAvatarDisplayUrl(course.id, course.avatarUrl);
  const backgroundUrl = resolveCourseBackgroundDisplayUrl(course.id);
  const maxWeeklyValue = Math.max(1, ...metrics.weekly.map((day) => day.value));

  return (
    <StudentCoursePageFrame courseId={courseId} course={course} active="dashboard">
      <CourseSpaceImageCard
        imageUrl={backgroundUrl}
        priority
        className="min-h-[15rem]"
        contentClassName="justify-between gap-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            <Image
              src={avatarUrl}
              alt=""
              width={72}
              height={72}
              unoptimized
              className="size-16 shrink-0 rounded-[20px] border border-white/70 bg-white object-cover shadow-xl sm:size-[4.5rem]"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/20 bg-slate-950/20 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-white backdrop-blur-md">
                  Student Dashboard
                </span>
                {course.courseCode ? (
                  <span className="rounded-full border border-white/20 bg-slate-950/20 px-2.5 py-1 text-xs text-white/90 backdrop-blur-md">
                    {course.courseCode}
                  </span>
                ) : null}
              </div>
              <h1 className="mt-3 truncate text-2xl font-semibold tracking-tight text-white drop-shadow-sm sm:text-3xl">
                {course.name}
              </h1>
              <p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-6 text-white/82">
                {course.description?.trim() || '查看你的课程进度、练习表现与班级学习位置。'}
              </p>
            </div>
          </div>
          <LayoutDashboard className="hidden size-7 shrink-0 text-white/75 sm:block" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="rounded-full bg-white text-slate-950 hover:bg-white/90">
            <Link href={`/learn?courseId=${encodeURIComponent(courseId)}`}>
              继续学习
              <ArrowRight className="ml-1.5 size-4" />
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="rounded-full border-white/30 bg-slate-950/20 text-white hover:bg-slate-950/32 hover:text-white"
          >
            <Link href={`/course/${encodeURIComponent(courseId)}/resources`}>
              <LibraryBig className="mr-1.5 size-4" />
              资料库
            </Link>
          </Button>
          <span className="inline-flex items-center rounded-full border border-white/20 bg-slate-950/20 px-3 text-xs text-white/85 backdrop-blur-md">
            {purposeLabel(course.purpose)}
          </span>
        </div>
      </CourseSpaceImageCard>

      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100">
          数据刷新失败，当前继续显示上一次结果：{error}
        </div>
      ) : null}

      <section aria-labelledby="learning-summary-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-blue-600 dark:text-blue-300">
              Overview
            </p>
            <h2 id="learning-summary-title" className="mt-1 text-xl font-semibold tracking-tight">
              我的学习状态
            </h2>
          </div>
          <p className="text-xs text-slate-400">基于课程题库中的真实练习记录</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Target}
            label="课程完成率"
            value={`${metrics.completion}%`}
            helper={`${metrics.attempted}/${metrics.total || 0} 道题已练习`}
            tone="bg-blue-50 text-blue-600 dark:bg-blue-400/10 dark:text-blue-300"
          />
          <StatCard
            icon={CheckCircle2}
            label="总体掌握率"
            value={`${metrics.mastery}%`}
            helper={`${metrics.mastered} 道题已掌握`}
            tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300"
          />
          <StatCard
            icon={TrendingUp}
            label="已练习正确率"
            value={`${metrics.accuracy}%`}
            helper="只统计已经作答的题目"
            tone="bg-violet-50 text-violet-600 dark:bg-violet-400/10 dark:text-violet-300"
          />
          <StatCard
            icon={Clock3}
            label="待复习"
            value={`${metrics.needsReview}`}
            helper="错题、部分正确与异常提交"
            tone="bg-amber-50 text-amber-600 dark:bg-amber-400/10 dark:text-amber-300"
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)]">
        <section className="rounded-[24px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_16px_44px_rgba(15,23,42,0.055)] dark:border-white/10 dark:bg-white/[0.055]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">近 7 日学习活动</h2>
              <p className="mt-1 text-xs text-slate-400">按最近一次作答时间统计练习题数</p>
            </div>
            <Flame className="size-5 text-orange-500" strokeWidth={1.9} />
          </div>
          {metrics.weekly.some((day) => day.value > 0) ? (
            <div className="mt-6 grid h-52 grid-cols-7 items-end gap-2 sm:gap-4">
              {metrics.weekly.map((day) => (
                <div
                  key={day.key}
                  className="flex h-full min-w-0 flex-col items-center justify-end gap-2"
                >
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    {day.value}
                  </span>
                  <div className="flex h-36 w-full items-end justify-center rounded-2xl bg-slate-50 px-1.5 dark:bg-white/[0.035]">
                    <div
                      className="w-full max-w-10 rounded-t-xl bg-gradient-to-t from-blue-600 to-cyan-400"
                      style={{
                        height:
                          day.value > 0
                            ? `${Math.max(8, (day.value / maxWeeklyValue) * 100)}%`
                            : '0%',
                      }}
                    />
                  </div>
                  <span className="truncate text-[11px] text-slate-400">{day.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5">
              <EmptyChart>完成练习后，这里会形成你的近 7 日学习趋势。</EmptyChart>
            </div>
          )}
        </section>

        <section className="rounded-[24px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_16px_44px_rgba(15,23,42,0.055)] dark:border-white/10 dark:bg-white/[0.055]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">掌握结构</h2>
              <p className="mt-1 text-xs text-slate-400">课程题目覆盖与当前掌握情况</p>
            </div>
            <BarChart3 className="size-5 text-emerald-500" strokeWidth={1.9} />
          </div>
          {metrics.total > 0 ? (
            <div className="mt-6 flex items-center gap-6">
              <div
                className="grid size-32 shrink-0 place-items-center rounded-full"
                style={{
                  background: `conic-gradient(#10b981 ${metrics.mastery * 3.6}deg, #dbeafe ${metrics.mastery * 3.6}deg 360deg)`,
                }}
              >
                <div className="grid size-24 place-items-center rounded-full bg-white text-center shadow-inner dark:bg-slate-950">
                  <div>
                    <p className="text-2xl font-bold">{metrics.mastery}%</p>
                    <p className="text-[11px] text-slate-400">已掌握</p>
                  </div>
                </div>
              </div>
              <dl className="min-w-0 flex-1 space-y-3 text-sm">
                {[
                  ['已掌握', metrics.mastered, 'bg-emerald-500'],
                  ['待复习', metrics.needsReview, 'bg-amber-500'],
                  ['未练习', Math.max(0, metrics.total - metrics.attempted), 'bg-slate-300'],
                ].map(([label, value, tone]) => (
                  <div key={String(label)} className="flex items-center justify-between gap-2">
                    <dt className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                      <span className={cn('size-2 rounded-full', tone)} />
                      {label}
                    </dt>
                    <dd className="font-bold">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <div className="mt-5">
              <EmptyChart>课程暂时没有可统计的题目。</EmptyChart>
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-[24px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_16px_44px_rgba(15,23,42,0.055)] dark:border-white/10 dark:bg-white/[0.055]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">知识板块进度</h2>
              <p className="mt-1 text-xs text-slate-400">按章节或知识标签汇总</p>
            </div>
            <BookOpen className="size-5 text-blue-500" strokeWidth={1.9} />
          </div>
          {metrics.topics.length > 0 ? (
            <div className="mt-5 space-y-4">
              {metrics.topics.map((topic) => {
                const value = percentage(topic.mastered, topic.total);
                return (
                  <div key={topic.name}>
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate font-medium text-slate-700 dark:text-slate-200">
                        {topic.name}
                      </span>
                      <span className="shrink-0 font-bold tabular-nums">
                        {topic.mastered}/{topic.total}
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400"
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-5">
              <EmptyChart>课程知识板块建立后会显示在这里。</EmptyChart>
            </div>
          )}
        </section>

        <section className="rounded-[24px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_16px_44px_rgba(15,23,42,0.055)] dark:border-white/10 dark:bg-white/[0.055]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">与同班同学比较</h2>
              <p className="mt-1 text-xs text-slate-400">聚合班级数据，不展示其他学生身份</p>
            </div>
            <Users className="size-5 text-violet-500" strokeWidth={1.9} />
          </div>
          {metrics.classStudentCount > 0 && metrics.total > 0 ? (
            <div className="mt-5 space-y-6">
              {[
                {
                  label: '题目完成率',
                  mine: metrics.completion,
                  classmates: metrics.classCompletion,
                },
                { label: '总体掌握率', mine: metrics.mastery, classmates: metrics.classMastery },
              ].map((row) => (
                <div key={row.label}>
                  <p className="mb-3 text-sm font-semibold">{row.label}</p>
                  <div className="space-y-3">
                    {[
                      { label: '我', value: row.mine, tone: 'bg-blue-600' },
                      { label: '班级平均', value: row.classmates, tone: 'bg-violet-400' },
                    ].map((bar) => (
                      <div
                        key={bar.label}
                        className="grid grid-cols-[4rem_minmax(0,1fr)_3rem] items-center gap-2 text-xs"
                      >
                        <span className="text-slate-500 dark:text-slate-400">{bar.label}</span>
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className={cn('h-full rounded-full', bar.tone)}
                            style={{ width: `${bar.value}%` }}
                          />
                        </div>
                        <span className="text-right font-bold tabular-nums">{bar.value}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <p className="flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-700 dark:bg-violet-400/10 dark:text-violet-200">
                <Users className="size-4" />
                班级样本：{metrics.classStudentCount} 名学生
              </p>
            </div>
          ) : (
            <div className="mt-5">
              <EmptyChart>有足够的班级练习数据后，这里会显示匿名聚合对比。</EmptyChart>
            </div>
          )}
        </section>
      </div>

      <div className="flex justify-end">
        <Button asChild className="rounded-xl">
          <Link href={`/course/${encodeURIComponent(courseId)}/problem-bank`}>
            开始练习
            <ArrowRight className="ml-1.5 size-4" />
          </Link>
        </Button>
      </div>
    </StudentCoursePageFrame>
  );
}
