'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bot,
  Clock3,
  Loader2,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
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
import { LOCAL_DEMO_STUDENT_ROSTER } from '@/lib/teacher/local-demo-student-roster';
import { StudioList, StudioListItem, StudioPagination } from '@/components/teacher/studio-list';
import { TeacherTemporaryAiDialog } from '@/components/teacher/teacher-temporary-ai-dialog';
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
  phoneLast4: string | null;
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
    submissionCount: number;
    passRate: number | null;
    averageActiveDurationMs: number | null;
  };
  students: Array<{
    userId: string;
    attemptedProblemCount: number;
    submissionCount: number;
    passRate: number | null;
    averageActiveDurationMs: number | null;
    timingSampleCount: number;
    lastSubmissionAt: number | null;
  }>;
};

function formatDuration(value: number | null) {
  if (value == null) return '暂无数据';
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return minutes ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}

type StudentSortKey = 'attempted' | 'passRate' | 'duration' | 'joinedAt';

const STUDENT_TABLE_GRID =
  'grid min-w-[52rem] grid-cols-[minmax(12rem,1.3fr)_minmax(6.5rem,0.7fr)_minmax(6.5rem,0.7fr)_minmax(8.5rem,0.9fr)_9rem_auto] items-center gap-4';

function compareSortValues(left: number | null, right: number | null, direction: 'asc' | 'desc') {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (left === right) return 0;
  const order = left < right ? -1 : 1;
  return direction === 'asc' ? order : -order;
}

function SortableColumnHeader({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  column: StudentSortKey;
  sortKey: StudentSortKey | null;
  sortDir: 'asc' | 'desc';
  onSort: (column: StudentSortKey) => void;
}) {
  const active = sortKey === column;
  const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1 rounded-md text-left outline-none transition hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-emerald-500/30 dark:hover:text-slate-100',
        active ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500',
      )}
    >
      {label}
      <Icon className={cn('size-3.5 shrink-0', active ? 'opacity-80' : 'opacity-35')} />
    </button>
  );
}

const STUDENT_PAGE_SIZE = 20;
const LEARNING_RANGE = '7d' as const;

const STUDENTS_SECTION_CLASS = cn(
  COURSE_SPACE_BODY_SURFACE_CLASS,
  'flex min-h-[min(706px,72dvh)] flex-1 flex-col',
);

function localDemoCourseStudents(courseId: string): {
  course: TeacherCourseSummary;
  students: CourseStudentRosterItem[];
} {
  const demo = findLocalDemoTeacherHomeCourse(courseId);
  return {
    course: {
      id: courseId,
      code: demo?.courseCode || courseId,
      name: demo?.name || '课程',
      academicYear: demo?.academicYear ?? 2026,
      term: demo?.academicTerm ?? 'summer',
      notebookCount: demo?.notebookCount ?? 12,
    },
    students: LOCAL_DEMO_STUDENT_ROSTER.map((student, index) => ({
      ...student,
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
      submissionCount: 46,
      passRate: 0.67,
      averageActiveDurationMs: 412_000,
    },
    students: students.map((student, index) => ({
      userId: student.userId,
      attemptedProblemCount: Math.max(0, 11 - index),
      submissionCount: Math.max(0, 16 - index * 2),
      passRate: index < 7 ? Math.max(0.35, 0.86 - index * 0.07) : null,
      averageActiveDurationMs: index < 6 ? 280_000 + index * 52_000 : null,
      timingSampleCount: index < 6 ? 5 - Math.floor(index / 2) : 0,
      lastSubmissionAt: index < 6 ? Date.now() - index * 7_200_000 : null,
    })),
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
  const [sortKey, setSortKey] = useState<StudentSortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
  const [learning, setLearning] = useState<CourseLearningOverview | null>(null);
  const [temporaryAiOpen, setTemporaryAiOpen] = useState(false);
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
                `/api/teacher/courses/${encodeURIComponent(courseId)}/learning?range=${LEARNING_RANGE}`,
              ),
            ]);
        setCourse(payload.course);
        setStudents(payload.students);
        if (mockMode) {
          setLearning(localDemoCourseLearning(payload.students, LEARNING_RANGE));
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
    [courseId, mockMode, teacherId],
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

  const learningByStudentId = useMemo(
    () => new Map((learning?.students || []).map((student) => [student.userId, student])),
    [learning],
  );
  const filteredStudents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
    const matched = !normalizedQuery
      ? students
      : students.filter((student) =>
          [student.name, student.phoneLast4].some((value) =>
            value?.toLocaleLowerCase('zh-CN').includes(normalizedQuery),
          ),
        );
    if (!sortKey) return matched;
    return [...matched].sort((left, right) => {
      const leftStats = learningByStudentId.get(left.userId);
      const rightStats = learningByStudentId.get(right.userId);
      const byColumn =
        sortKey === 'attempted'
          ? compareSortValues(
              leftStats?.attemptedProblemCount ?? 0,
              rightStats?.attemptedProblemCount ?? 0,
              sortDir,
            )
          : sortKey === 'passRate'
            ? compareSortValues(leftStats?.passRate ?? null, rightStats?.passRate ?? null, sortDir)
            : sortKey === 'duration'
              ? compareSortValues(
                  leftStats?.averageActiveDurationMs ?? null,
                  rightStats?.averageActiveDurationMs ?? null,
                  sortDir,
                )
              : compareSortValues(left.grantedAt, right.grantedAt, sortDir);
      if (byColumn !== 0) return byColumn;
      return left.name.localeCompare(right.name, 'zh-CN');
    });
  }, [learningByStudentId, query, sortDir, sortKey, students]);
  const pageCount = Math.max(1, Math.ceil(filteredStudents.length / STUDENT_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleStudents = filteredStudents.slice(
    (safePage - 1) * STUDENT_PAGE_SIZE,
    safePage * STUDENT_PAGE_SIZE,
  );
  const toggleSort = (column: StudentSortKey) => {
    setPage(1);
    if (sortKey === column) {
      setSortDir((current) => (current === 'desc' ? 'asc' : 'desc'));
      return;
    }
    setSortKey(column);
    setSortDir('desc');
  };

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
                <Button size="sm" onClick={() => setTemporaryAiOpen(true)}>
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

            <div className="grid gap-3 sm:grid-cols-4">
              <StudentSummaryCard
                icon={<Users className="size-4" />}
                label="课程学生"
                value={`${students.length} 人`}
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

            <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-slate-50/80 dark:border-white/10 dark:bg-slate-950/70">
              <div className="border-b border-slate-200/80 bg-white px-4 py-4 dark:border-white/10 dark:bg-white/[0.03] sm:px-5">
                <div className="relative w-full sm:w-80">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                    className="h-10 rounded-xl border-slate-200 bg-white pl-9 shadow-none dark:border-white/10 dark:bg-white/5"
                    placeholder="搜索姓名或手机号后四位"
                    aria-label="搜索课程学生"
                  />
                </div>
              </div>

              <div className="overflow-x-auto p-4 sm:p-5">
                {visibleStudents.length ? (
                  <StudioList>
                    <div
                      className={cn(
                        STUDENT_TABLE_GRID,
                        'bg-slate-50/80 px-5 py-2.5 text-xs font-semibold dark:bg-white/[0.035]',
                      )}
                    >
                      <span className="text-slate-500">学生</span>
                      <SortableColumnHeader
                        label="已做题目"
                        column="attempted"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={toggleSort}
                      />
                      <SortableColumnHeader
                        label="通过率"
                        column="passRate"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={toggleSort}
                      />
                      <SortableColumnHeader
                        label="平均做题时间"
                        column="duration"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={toggleSort}
                      />
                      <SortableColumnHeader
                        label="加入时间"
                        column="joinedAt"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={toggleSort}
                      />
                      <span className="text-right text-slate-500">操作</span>
                    </div>
                    {visibleStudents.map((student) => {
                      const stats = learningByStudentId.get(student.userId);
                      return (
                        <StudioListItem
                          key={student.userId}
                          density="compact"
                          className={STUDENT_TABLE_GRID}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar className="ring-1 ring-slate-200 dark:ring-white/10">
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
                              <p className="mt-0.5 truncate text-xs text-slate-400">
                                {student.phoneLast4
                                  ? `手机号尾号 ${student.phoneLast4}`
                                  : '手机号未填写'}
                              </p>
                            </div>
                          </div>
                          <span className="text-sm tabular-nums text-slate-700 dark:text-slate-200">
                            {stats?.attemptedProblemCount ?? 0} 题
                          </span>
                          <span className="text-sm tabular-nums text-slate-700 dark:text-slate-200">
                            {stats?.passRate == null
                              ? '暂无数据'
                              : `${Math.round(stats.passRate * 100)}%`}
                          </span>
                          <span className="text-sm tabular-nums text-slate-700 dark:text-slate-200">
                            {formatDuration(stats?.averageActiveDurationMs ?? null)}
                          </span>
                          <span className="text-xs tabular-nums text-slate-400">
                            {new Date(student.grantedAt).toLocaleString('zh-CN')}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 w-fit shrink-0 justify-self-end px-2.5 text-xs"
                            onClick={() =>
                              router.push(
                                `/teacher/courses/${encodeURIComponent(courseId)}/students/${encodeURIComponent(student.userId)}${mockMode ? '?mock=1' : ''}`,
                              )
                            }
                          >
                            查看逐题详情
                          </Button>
                        </StudioListItem>
                      );
                    })}
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
      <TeacherTemporaryAiDialog
        contextSelection={{ source: 'teacher-class', range: LEARNING_RANGE }}
        open={temporaryAiOpen}
        onOpenChange={setTemporaryAiOpen}
        courseId={courseId}
        courseName={course.name}
      />
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
