'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Bot, Loader2, Search } from 'lucide-react';
import { CourseDetail } from '@/components/admin/admin-student-course-card';
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
import { TeacherTemporaryAiDialog } from '@/components/teacher/teacher-temporary-ai-dialog';
import type { AcademicTerm } from '@/lib/teacher/online-course-studio';
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

type Insights = {
  usage: { credits: number; tokens: number; requests: number };
  activities: Array<{
    id: string;
    actionType: string;
    label: string | null;
    createdAt: string;
    problemId: string | null;
  }>;
  conversations: Array<{
    id: string;
    title: string | null;
    updatedAt: string;
    messageCount: number;
  }>;
  chapters: Array<{ id: string; name: string; total: number; attempted: number; passed: number }>;
};

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

function localDemoInsights(): Insights {
  return {
    usage: { credits: 18, tokens: 4200, requests: 6 },
    activities: [
      {
        id: 'demo-activity',
        actionType: 'QUIZ_COMPLETED',
        label: '提交练习：示例题目',
        createdAt: new Date().toISOString(),
        problemId: null,
      },
    ],
    conversations: [
      {
        id: 'demo-conversation',
        title: '示例对话',
        updatedAt: new Date().toISOString(),
        messageCount: 2,
      },
    ],
    chapters: [{ id: 'demo-chapter', name: '第一章', total: 10, attempted: 4, passed: 2 }],
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightsError, setInsightsError] = useState('');
  const [insightsRetry, setInsightsRetry] = useState(0);
  const [temporaryAiOpen, setTemporaryAiOpen] = useState(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!mockMode && (!isLoggedIn || role !== 'TEACHER')) {
      router.replace('/speedup/signed-out?role=teacher');
    }
  }, [hydrated, isLoggedIn, mockMode, role, router]);

  const loadStudents = useCallback(async () => {
    if (!teacherId || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const payload = mockMode
        ? localDemoCourseStudents(courseId)
        : await backendJson<{
            course: TeacherCourseSummary;
            students: CourseStudentRosterItem[];
          }>(`/api/teacher/courses/${encodeURIComponent(courseId)}/students`);
      setCourse(payload.course);
      setStudents(payload.students);
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
      loadingRef.current = false;
    }
  }, [courseId, mockMode, teacherId]);

  useEffect(() => {
    if (!hydrated || !isLoggedIn || role !== 'TEACHER' || !teacherId || accessRevoked) return;
    void loadStudents();
  }, [accessRevoked, hydrated, isLoggedIn, loadStudents, role, teacherId]);

  const filteredStudents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
    if (!normalizedQuery) return students;
    return students.filter((student) =>
      [student.name, student.phoneLast4].some((value) =>
        value?.toLocaleLowerCase('zh-CN').includes(normalizedQuery),
      ),
    );
  }, [query, students]);
  const pageCount = Math.max(1, Math.ceil(filteredStudents.length / STUDENT_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageStudents = filteredStudents.slice(
    (safePage - 1) * STUDENT_PAGE_SIZE,
    safePage * STUDENT_PAGE_SIZE,
  );
  const selected =
    filteredStudents.find((student) => student.userId === selectedId) || filteredStudents[0] || null;

  const selectedUserId = selected?.userId ?? null;

  useEffect(() => {
    if (!selectedUserId) {
      setInsights(null);
      setInsightsError('');
      return;
    }
    if (mockMode) {
      setInsights(localDemoInsights());
      setInsightsError('');
      return;
    }
    let active = true;
    setInsights(null);
    setInsightsError('');
    void backendJson<Insights>(
      `/api/teacher/courses/${encodeURIComponent(courseId)}/students/${encodeURIComponent(selectedUserId)}/insights`,
    )
      .then((value) => {
        if (active) setInsights(value);
      })
      .catch((reason) => {
        if (active) setInsightsError(reason instanceof Error ? reason.message : '学习数据加载失败');
      });
    return () => {
      active = false;
    };
  }, [courseId, insightsRetry, mockMode, selectedUserId]);

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

  const insightCourse = {
    id: course.id,
    name: course.name,
    courseCode: course.code,
    academicYear: course.academicYear,
    academicTerm: course.term,
  };

  return (
    <CourseSpacePageFrame>
      <CourseSpaceHeader
        courseId={courseId}
        courseTitle={courseHeaderFields.courseTitle}
        courseMeta={courseHeaderFields.courseMeta}
        role="teacher"
        active="students"
        previewMode={mockMode}
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg px-2.5"
            onClick={() => setTemporaryAiOpen(true)}
          >
            <Bot className="size-3.5" />
            问 AI
          </Button>
        }
      />
      <section className={STUDENTS_SECTION_CLASS} data-testid="teacher-course-students-app">
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {error ? (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200">
              {error}
            </div>
          ) : null}
          <div className="grid min-h-[640px] items-stretch gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside
              aria-label="学生列表"
              className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-background/40"
            >
              <div className="border-b px-3 py-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                    className="h-9 pl-9"
                    placeholder="搜索姓名或手机号后四位"
                    aria-label="搜索课程学生"
                  />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  共 {students.length} 名学生
                  {query.trim() ? ` · 匹配 ${filteredStudents.length} 名` : ''}
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {pageStudents.length ? (
                  pageStudents.map((student) => (
                    <button
                      key={student.userId}
                      type="button"
                      aria-pressed={selected?.userId === student.userId}
                      onClick={() => setSelectedId(student.userId)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-primary',
                        selected?.userId === student.userId ? 'bg-primary/10' : 'hover:bg-muted/50',
                      )}
                    >
                      <Avatar className="size-10">
                        {student.avatarUrl ? (
                          <AvatarImage src={student.avatarUrl} alt="" />
                        ) : null}
                        <AvatarFallback>
                          {student.name.trim().slice(0, 1).toUpperCase() || '学'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{student.name}</span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {student.phoneLast4 ? `尾号 ${student.phoneLast4}` : '未填写手机号'}
                        </span>
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                    {query.trim() ? '没有找到匹配的学生' : '管理员尚未给这门课分配学生'}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 border-t px-3 py-3">
                <p className="text-xs text-muted-foreground">
                  第 {safePage} / {pageCount} 页
                </p>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safePage <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    上一页
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safePage >= pageCount}
                    onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </aside>
            {selected ? (
              <section
                aria-label="学生学习详情"
                className="h-full min-w-0 rounded-xl border p-5 lg:p-6"
              >
                <div className="mb-4 flex items-start gap-4">
                  <Avatar className="size-14 shrink-0">
                    {selected.avatarUrl ? (
                      <AvatarImage src={selected.avatarUrl} alt={selected.name} />
                    ) : null}
                    <AvatarFallback className="text-lg">
                      {selected.name.trim().slice(0, 1).toUpperCase() || '学'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <h2 className="text-xl font-semibold">{selected.name}</h2>
                      <div className="ml-auto flex items-center gap-1.5">
                        <Button size="sm" variant="outline" asChild>
                          <a
                            href={`/teacher/courses/${encodeURIComponent(courseId)}/students/${encodeURIComponent(selected.userId)}${mockMode ? '?mock=1' : ''}`}
                          >
                            逐题记录
                          </a>
                        </Button>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {selected.phoneLast4 ? `尾号 ${selected.phoneLast4}` : '未填写手机号'}
                    </p>
                  </div>
                </div>
                <CourseDetail
                  studentId={selected.userId}
                  course={insightCourse}
                  data={insights || undefined}
                  error={insightsError || undefined}
                  onRetry={() => setInsightsRetry((value) => value + 1)}
                  showCoursePreview={false}
                  problemAccess="course"
                  conversationUrl={(conversationId) =>
                    `/api/teacher/courses/${encodeURIComponent(courseId)}/students/${encodeURIComponent(selected.userId)}/conversations/${encodeURIComponent(conversationId)}`
                  }
                />
              </section>
            ) : (
              <section className="grid h-full min-h-64 place-items-center rounded-xl border text-sm text-muted-foreground">
                选择一名学生查看学习情况
              </section>
            )}
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
