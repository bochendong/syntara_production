'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Bot, Clock3, Loader2, Mail, School, Search, ShieldCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { CourseAccessClosedCard } from '@/components/course-access-closed-card';
import { CourseSpaceHeader } from '@/components/course-space/course-space-header';
import { CourseSpacePageFrame } from '@/components/course-space/course-space-page-frame';
import {
  COURSE_SPACE_BODY_SURFACE_CLASS,
  resolveCourseSpaceHeaderFields,
} from '@/lib/course-space/format-course-space-header';
import { findLocalDemoTeacherHomeCourse } from '@/lib/teacher/local-demo-fixtures';
import {
  StudioItemTag,
  StudioList,
  StudioListItem,
  StudioPagination,
} from '@/components/teacher/studio-list';
import { academicTermLabel, type AcademicTerm } from '@/lib/teacher/online-course-studio';
import { cn } from '@/lib/utils';
import { BackendApiError, backendJson } from '@/lib/utils/backend-api';

type TeacherCourseSummary = {
  id: string;
  code: string;
  name: string;
  academicYear: number | null;
  term: AcademicTerm | null;
  notebookCount: number;
};

type CourseStudentRosterItem = {
  userId: string;
  name: string;
  email: string;
  avatarUrl?: string;
  notebookAccessLimit: number | null;
  grantedAt: number;
};

type CourseLearningOverview = {
  range: string;
  from: string | null;
  to: string;
  sample: { submissionCount: number; timingSampleCount: number };
  metrics: {
    enrolledStudentCount: number;
    activeStudentCount: number;
    submissionCount: number;
    passRate: number | null;
    averageActiveDurationMs: number | null;
  };
  students: Array<{
    userId: string;
    active: boolean;
    attemptedProblemCount: number;
    submissionCount: number;
    passRate: number | null;
    averageActiveDurationMs: number | null;
    timingSampleCount: number;
    lastSubmissionAt: number | null;
  }>;
  weakTagPaths: Array<{
    area: string;
    concept: string;
    affectedStudentCount: number;
    failedAttempts: number;
  }>;
  difficultProblems: Array<{
    problemId: string;
    title: string;
    affectedStudentCount: number;
    failureRate: number;
    forumQuestionCount: number;
    timingSampleCount: number;
  }>;
};

function formatDuration(value: number | null) {
  if (value == null) return '暂无数据';
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return minutes ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}

const STUDENT_PAGE_SIZE = 20;

const STUDENTS_SECTION_CLASS = cn(
  COURSE_SPACE_BODY_SURFACE_CLASS,
  'flex min-h-[min(706px,72dvh)] flex-1 flex-col',
);

function localDemoCourseStudents(courseId: string): {
  course: TeacherCourseSummary;
  students: CourseStudentRosterItem[];
} {
  const demo = findLocalDemoTeacherHomeCourse(courseId);
  const roster: Array<[string, string, string, number | null]> = [
    ['stu-li-wei', '李维', 'li.wei@mail.utoronto.ca', null],
    ['stu-wang-min', '王敏', 'wang.min@mail.utoronto.ca', 3],
    ['stu-chen-hao', '陈浩', 'hao.chen@mail.utoronto.ca', 2],
    ['stu-zhao-lin', '赵琳', 'lin.zhao@mail.utoronto.ca', null],
    ['stu-sun-yue', '孙悦', 'yue.sun@mail.utoronto.ca', 1],
    ['stu-zhou-qi', '周琪', 'qi.zhou@mail.utoronto.ca', null],
    ['stu-wu-fang', '吴芳', 'fang.wu@mail.utoronto.ca', 3],
    ['stu-zheng-kai', '郑凯', 'kai.zheng@mail.utoronto.ca', null],
  ];

  return {
    course: {
      id: courseId,
      code: demo?.courseCode || courseId,
      name: demo?.name || '课程',
      academicYear: demo?.academicYear ?? 2026,
      term: demo?.academicTerm ?? 'summer',
      notebookCount: demo?.notebookCount ?? 12,
    },
    students: roster.map(([userId, name, email, notebookAccessLimit], index) => ({
      userId,
      name,
      email,
      notebookAccessLimit,
      grantedAt: Date.UTC(2026, 7, 10, 9, 0, 0) - index * 86_400_000,
    })),
  };
}

function localDemoCourseLearning(
  students: CourseStudentRosterItem[],
  range: '7d' | '30d' | 'term' | 'all',
): CourseLearningOverview {
  return {
    range,
    from:
      range === 'all'
        ? null
        : new Date(Date.now() - (range === '30d' ? 30 : 7) * 86_400_000).toISOString(),
    to: new Date().toISOString(),
    sample: { submissionCount: 46, timingSampleCount: 31 },
    metrics: {
      enrolledStudentCount: students.length,
      activeStudentCount: 6,
      submissionCount: 46,
      passRate: 0.67,
      averageActiveDurationMs: 412_000,
    },
    students: students.map((student, index) => ({
      userId: student.userId,
      active: index < 6,
      attemptedProblemCount: Math.max(0, 11 - index),
      submissionCount: Math.max(0, 16 - index * 2),
      passRate: index < 7 ? Math.max(0.35, 0.86 - index * 0.07) : null,
      averageActiveDurationMs: index < 6 ? 280_000 + index * 52_000 : null,
      timingSampleCount: index < 6 ? 5 - Math.floor(index / 2) : 0,
      lastSubmissionAt: index < 6 ? Date.now() - index * 7_200_000 : null,
    })),
    weakTagPaths: [
      { area: '算法分析', concept: '递归复杂度', affectedStudentCount: 4, failedAttempts: 9 },
      { area: '数据结构', concept: '树遍历', affectedStudentCount: 3, failedAttempts: 6 },
    ],
    difficultProblems: [
      {
        problemId: 'csc148-mock-problem-4',
        title: '递归树复杂度分析',
        affectedStudentCount: 4,
        failureRate: 0.62,
        forumQuestionCount: 3,
        timingSampleCount: 8,
      },
    ],
  };
}

export function TeacherCourseStudentsClient({
  courseId,
  mockMode = false,
}: {
  courseId: string;
  mockMode?: boolean;
}) {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const hydrated = mockMode || sessionStatus !== 'loading';
  const isLoggedIn = mockMode || sessionStatus === 'authenticated';
  const role =
    mockMode || session?.user?.role === 'TEACHER' || session?.user?.role === 'ADMIN'
      ? 'TEACHER'
      : 'STUDENT';
  const teacherId = mockMode ? 'local-demo-teacher-ui-mock' : session?.user?.id || '';
  const [course, setCourse] = useState<TeacherCourseSummary | null>(null);
  const [students, setStudents] = useState<CourseStudentRosterItem[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
  const [savingProgressUserId, setSavingProgressUserId] = useState<string | null>(null);
  const [range, setRange] = useState<'7d' | '30d' | 'term' | 'all'>('7d');
  const [learning, setLearning] = useState<CourseLearningOverview | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!mockMode && (!isLoggedIn || role !== 'TEACHER')) {
      router.replace('/speedup/signed-out?role=teacher');
    }
  }, [hydrated, isLoggedIn, mockMode, role, router]);

  const loadStudents = useCallback(
    async (background = false) => {
      if (!teacherId || loadingRef.current) return;
      loadingRef.current = true;
      if (background) setRefreshing(true);
      else setLoading(true);
      try {
        const [payload, learningPayload] = mockMode
          ? [localDemoCourseStudents(courseId), null]
          : await Promise.all([
              backendJson<{
                course: TeacherCourseSummary;
                students: CourseStudentRosterItem[];
              }>(`/api/teacher/courses/${encodeURIComponent(courseId)}/students`),
              backendJson<CourseLearningOverview>(
                `/api/teacher/courses/${encodeURIComponent(courseId)}/learning?range=${range}`,
              ),
            ]);
        setCourse(payload.course);
        setStudents(payload.students);
        if (mockMode) {
          setLearning(localDemoCourseLearning(payload.students, range));
        } else {
          setLearning(learningPayload);
        }
        setLastUpdatedAt(Date.now());
        setError('');
        setAccessRevoked(false);
      } catch (loadError) {
        if (
          loadError instanceof BackendApiError &&
          (loadError.status === 403 || loadError.status === 404)
        ) {
          setCourse(null);
          setStudents([]);
          setAccessRevoked(true);
        }
        setError(loadError instanceof Error ? loadError.message : '学生名单读取失败');
      } finally {
        setLoading(false);
        setRefreshing(false);
        loadingRef.current = false;
      }
    },
    [courseId, mockMode, range, teacherId],
  );

  useEffect(() => {
    if (!hydrated || !isLoggedIn || role !== 'TEACHER' || !teacherId || accessRevoked) return;
    void loadStudents(false);
    if (mockMode) return;
    const refresh = () => void loadStudents(true);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [accessRevoked, hydrated, isLoggedIn, loadStudents, mockMode, role, teacherId]);

  const filteredStudents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
    if (!normalizedQuery) return students;
    return students.filter((student) =>
      [student.name, student.email, student.userId].some((value) =>
        value?.toLocaleLowerCase('zh-CN').includes(normalizedQuery),
      ),
    );
  }, [query, students]);
  const pageCount = Math.max(1, Math.ceil(filteredStudents.length / STUDENT_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleStudents = filteredStudents.slice(
    (safePage - 1) * STUDENT_PAGE_SIZE,
    safePage * STUDENT_PAGE_SIZE,
  );
  const learningByStudentId = useMemo(
    () => new Map((learning?.students || []).map((student) => [student.userId, student])),
    [learning],
  );

  const updateNotebookAccessLimit = useCallback(
    async (student: CourseStudentRosterItem, notebookAccessLimit: number | null) => {
      setSavingProgressUserId(student.userId);
      try {
        if (!mockMode) {
          await backendJson(`/api/teacher/courses/${encodeURIComponent(courseId)}/students`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ userId: student.userId, notebookAccessLimit }),
          });
        }
        setStudents((current) =>
          current.map((item) =>
            item.userId === student.userId ? { ...item, notebookAccessLimit } : item,
          ),
        );
        setError('');
      } catch (saveError) {
        if (
          saveError instanceof BackendApiError &&
          (saveError.status === 403 || saveError.status === 404)
        ) {
          setCourse(null);
          setStudents([]);
          setAccessRevoked(true);
        }
        setError(saveError instanceof Error ? saveError.message : '进度限制保存失败');
      } finally {
        setSavingProgressUserId(null);
      }
    },
    [courseId, mockMode],
  );

  if (!hydrated || !isLoggedIn || role !== 'TEACHER' || !teacherId) return null;

  if (accessRevoked) {
    return <CourseAccessClosedCard returnHref="/teacher" returnLabel="返回教师工作台" />;
  }

  const courseHeaderFields = resolveCourseSpaceHeaderFields({
    id: courseId,
    code: course?.code,
    name: course?.name,
    academicYear: course?.academicYear,
    term: course?.term,
  });

  if (loading && !course) {
    return (
      <CourseSpacePageFrame>
        <CourseSpaceHeader
          courseId={courseId}
          courseTitle={courseHeaderFields.courseTitle}
          role="teacher"
          active="students"
          previewMode={mockMode}
        />
        <section
          className={cn(STUDENTS_SECTION_CLASS, 'grid place-items-center bg-slate-50/70')}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="inline-flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" />
            正在读取学生名单…
          </span>
        </section>
      </CourseSpacePageFrame>
    );
  }

  if (!course) {
    return (
      <CourseSpacePageFrame>
        <CourseSpaceHeader
          courseId={courseId}
          courseTitle={courseHeaderFields.courseTitle}
          role="teacher"
          active="students"
          previewMode={mockMode}
        />
        <section className={cn(STUDENTS_SECTION_CLASS, 'grid place-items-center p-6 text-center')}>
          <div>
            <p className="font-semibold text-rose-600 dark:text-rose-300">
              {error || '课程不存在'}
            </p>
            <button
              type="button"
              className="mt-4 text-slate-500 underline underline-offset-4"
              onClick={() => router.push(mockMode ? '/teacher?mock=1' : '/teacher')}
            >
              返回教师桌面
            </button>
          </div>
        </section>
      </CourseSpacePageFrame>
    );
  }

  return (
    <CourseSpacePageFrame>
      <CourseSpaceHeader
        courseId={courseId}
        courseTitle={courseHeaderFields.courseTitle}
        courseMeta={courseHeaderFields.courseMeta}
        role="teacher"
        active="students"
        previewMode={mockMode}
      />
      <section className={STUDENTS_SECTION_CLASS} data-testid="teacher-course-students-app">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50/80 p-4 dark:bg-slate-950 sm:p-5">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200">
                {error}
              </div>
            ) : null}

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="mr-auto text-base font-semibold text-slate-950 dark:text-white">
                  班级总览
                </h2>
                <select
                  value={range}
                  onChange={(event) => setRange(event.target.value as typeof range)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="7d">最近 7 天</option>
                  <option value="30d">最近 30 天</option>
                  <option value="term">本学期</option>
                  <option value="all">全部</option>
                </select>
                <Button
                  size="sm"
                  onClick={() =>
                    router.push(
                      `/learn?courseId=${encodeURIComponent(courseId)}&from=teacher&range=${range}`,
                    )
                  }
                >
                  <Bot className="mr-1.5 size-4" />问 AI
                </Button>
              </div>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {course.academicYear ?? '—'} {course.term ? academicTermLabel(course.term) : '—'}
                {' · '}
                {learning?.from
                  ? `${new Date(learning.from).toLocaleDateString('zh-CN')} 至今`
                  : '全部时间'}
                ，计时样本 {learning?.sample.timingSampleCount ?? 0} 条。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-5">
              <StudentSummaryCard
                icon={<Users className="size-4" />}
                label="课程学生"
                value={`${students.length} 人`}
              />
              <StudentSummaryCard
                icon={<Users className="size-4" />}
                label="活跃学生"
                value={`${learning?.metrics.activeStudentCount ?? 0} 人`}
              />
              <StudentSummaryCard
                icon={<ShieldCheck className="size-4" />}
                label="通过率"
                value={
                  learning?.metrics.passRate == null
                    ? '暂无数据'
                    : `${Math.round(learning.metrics.passRate * 100)}%`
                }
              />
              <StudentSummaryCard
                icon={<Clock3 className="size-4" />}
                label="平均有效时长"
                value={formatDuration(learning?.metrics.averageActiveDurationMs ?? null)}
              />
              <StudentSummaryCard
                icon={<School className="size-4" />}
                label="名单来源"
                value={mockMode ? '本地预览' : '管理员数据库'}
              />
              <StudentSummaryCard
                icon={
                  refreshing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Clock3 className="size-4" />
                  )
                }
                label="自动更新"
                value={
                  lastUpdatedAt
                    ? new Date(lastUpdatedAt).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      })
                    : '--:--'
                }
              />
            </div>

            {learning ? (
              <div className="grid gap-3 lg:grid-cols-2">
                <section className="rounded-2xl border bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="font-semibold">困难题排行</h3>
                  <div className="mt-3 space-y-2">
                    {learning.difficultProblems.slice(0, 5).map((item, index) => (
                      <div
                        key={item.problemId}
                        className="flex items-center gap-1 rounded-lg bg-slate-50 p-1 dark:bg-slate-800"
                      >
                        <button
                          onClick={() =>
                            router.push(
                              `/course/${encodeURIComponent(courseId)}/problem-bank/${encodeURIComponent(item.problemId)}`,
                            )
                          }
                          className="flex min-w-0 flex-1 items-center gap-3 p-1.5 text-left text-sm"
                        >
                          <span className="font-semibold text-slate-400">{index + 1}</span>
                          <span className="min-w-0 flex-1 truncate">{item.title}</span>
                          <span className="text-xs text-slate-500">
                            {item.affectedStudentCount} 人 · 失败{' '}
                            {Math.round(item.failureRate * 100)}% · 论坛 {item.forumQuestionCount}
                          </span>
                        </button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`向 AI 询问 ${item.title}`}
                          onClick={() =>
                            router.push(
                              `/learn?courseId=${encodeURIComponent(courseId)}&from=teacher&problemId=${encodeURIComponent(item.problemId)}&range=${range}`,
                            )
                          }
                        >
                          <Bot className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="rounded-2xl border bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="font-semibold">薄弱知识点</h3>
                  <div className="mt-3 space-y-2">
                    {learning.weakTagPaths.slice(0, 5).map((item) => (
                      <div
                        key={`${item.area}:${item.concept}`}
                        className="flex items-center justify-between rounded-lg bg-slate-50 p-2.5 text-sm dark:bg-slate-800"
                      >
                        <span>
                          {item.area} / {item.concept}
                        </span>
                        <span className="text-xs text-slate-500">
                          {item.affectedStudentCount} 人 · {item.failedAttempts} 次
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            ) : null}

            <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-slate-50/80 dark:border-white/10 dark:bg-slate-950/70">
              <div className="flex flex-col gap-4 border-b border-slate-200/80 bg-white px-4 py-4 dark:border-white/10 dark:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div>
                  <h2 className="font-semibold text-slate-950 dark:text-white">学生名单</h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    当前显示 {filteredStudents.length} 位具有课程访问权限的学生
                  </p>
                </div>
                <div className="relative w-full sm:w-80">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                    className="h-10 rounded-xl border-slate-200 bg-white pl-9 shadow-none dark:border-white/10 dark:bg-white/5"
                    placeholder="搜索姓名、手机号或学号"
                    aria-label="搜索课程学生"
                  />
                </div>
              </div>

              <div className="p-4 sm:p-5">
                {visibleStudents.length ? (
                  <StudioList>
                    <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(150px,0.75fr)_minmax(140px,0.65fr)_minmax(150px,0.7fr)_130px] gap-4 bg-slate-50/80 px-5 py-3 text-xs font-semibold text-slate-500 dark:bg-white/[0.035] lg:grid">
                      <span>学生</span>
                      <span>邮箱</span>
                      <span>账户 ID</span>
                      <span>笔记本进度限制</span>
                      <span>加入时间</span>
                    </div>
                    {visibleStudents.map((student) => (
                      <StudioListItem
                        key={student.userId}
                        className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(150px,0.75fr)_minmax(140px,0.65fr)_minmax(150px,0.7fr)_130px] lg:items-center lg:gap-4"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar size="lg" className="ring-1 ring-slate-200 dark:ring-white/10">
                            {student.avatarUrl ? (
                              <AvatarImage src={student.avatarUrl} alt={student.name} />
                            ) : null}
                            <AvatarFallback className="bg-sky-50 font-semibold text-sky-700 dark:bg-sky-400/10 dark:text-sky-200">
                              {student.name.trim().slice(0, 1).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">
                              {student.name}
                            </p>
                            <StudioItemTag className="mt-1 w-fit rounded-full">学生</StudioItemTag>
                          </div>
                        </div>
                        <a
                          href={student.email === '未提供' ? undefined : `mailto:${student.email}`}
                          className="inline-flex min-w-0 items-center gap-2 text-sm text-slate-600 dark:text-slate-300"
                        >
                          <Mail className="size-3.5 shrink-0 text-slate-400" />
                          <span className="truncate">{student.email}</span>
                        </a>
                        <span className="truncate text-sm text-slate-500 dark:text-slate-400">
                          {student.userId}
                        </span>
                        <label className="flex items-center gap-2 text-xs text-slate-500">
                          <ShieldCheck className="size-3.5 shrink-0 text-emerald-600" />
                          <select
                            aria-label={`${student.name} 的笔记本进度限制`}
                            value={
                              student.notebookAccessLimit === null
                                ? 'all'
                                : String(student.notebookAccessLimit)
                            }
                            disabled={savingProgressUserId === student.userId}
                            onChange={(event) =>
                              void updateNotebookAccessLimit(
                                student,
                                event.target.value === 'all' ? null : Number(event.target.value),
                              )
                            }
                            className="h-9 min-w-32 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"
                          >
                            <option value="all">全部开放</option>
                            {Array.from({ length: course.notebookCount + 1 }, (_, index) => (
                              <option key={index} value={index}>
                                前 {index} 本
                              </option>
                            ))}
                          </select>
                        </label>
                        <span className="text-xs tabular-nums text-slate-400">
                          {new Date(student.grantedAt).toLocaleString('zh-CN')}
                        </span>
                        {(() => {
                          const stats = learningByStudentId.get(student.userId);
                          return (
                            <button
                              type="button"
                              onClick={() =>
                                router.push(
                                  `/teacher/courses/${encodeURIComponent(courseId)}/students/${encodeURIComponent(student.userId)}${mockMode ? '?mock=1' : ''}`,
                                )
                              }
                              className="col-span-full flex flex-wrap gap-3 text-left text-xs text-sky-700 lg:col-span-5"
                            >
                              <span>查看逐题详情</span>
                              <span>{stats?.active ? '活跃' : '近期未活跃'}</span>
                              <span>已做 {stats?.attemptedProblemCount ?? 0} 题</span>
                              <span>
                                通过率{' '}
                                {stats?.passRate == null
                                  ? '暂无数据'
                                  : `${Math.round(stats.passRate * 100)}%`}
                              </span>
                              <span>
                                平均 {formatDuration(stats?.averageActiveDurationMs ?? null)}
                              </span>
                              <span>
                                最近提交{' '}
                                {stats?.lastSubmissionAt
                                  ? new Date(stats.lastSubmissionAt).toLocaleString('zh-CN')
                                  : '暂无提交'}
                              </span>
                            </button>
                          );
                        })()}
                      </StudioListItem>
                    ))}
                  </StudioList>
                ) : (
                  <div className="grid min-h-64 place-items-center text-center text-sm text-slate-500 dark:text-slate-400">
                    {query ? '没有找到匹配的学生。' : '管理员尚未给这门课分配学生。'}
                  </div>
                )}
              </div>

              <StudioPagination
                page={safePage}
                pageCount={pageCount}
                total={filteredStudents.length}
                onPage={setPage}
              />
            </section>
          </div>
        </div>
      </section>
    </CourseSpacePageFrame>
  );
}

function StudentSummaryCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <span className="grid size-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
        {icon}
      </span>
      <div>
        <p className="text-xs text-slate-400">{label}</p>
        <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">{value}</p>
      </div>
    </div>
  );
}
