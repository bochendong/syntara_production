'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Clock3, Loader2, Mail, School, Search, ShieldCheck, Users } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { TeacherAppShell } from '@/components/teacher/teacher-app-shell';
import {
  StudioItemTag,
  StudioList,
  StudioListItem,
  StudioPagination,
} from '@/components/teacher/studio-list';
import { academicTermLabel, type AcademicTerm } from '@/lib/teacher/online-course-studio';
import { backendJson } from '@/lib/utils/backend-api';

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

const STUDENT_PAGE_SIZE = 20;

export function TeacherCourseStudentsClient({ courseId }: { courseId: string }) {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const hydrated = sessionStatus !== 'loading';
  const isLoggedIn = sessionStatus === 'authenticated';
  const role =
    session?.user?.role === 'TEACHER' || session?.user?.role === 'ADMIN' ? 'TEACHER' : 'STUDENT';
  const teacherId = session?.user?.id || '';
  const [course, setCourse] = useState<TeacherCourseSummary | null>(null);
  const [students, setStudents] = useState<CourseStudentRosterItem[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
  const [savingProgressUserId, setSavingProgressUserId] = useState<string | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!isLoggedIn || role !== 'TEACHER') router.replace('/teacher/login');
  }, [hydrated, isLoggedIn, role, router]);

  const loadStudents = useCallback(
    async (background = false) => {
      if (!teacherId || loadingRef.current) return;
      loadingRef.current = true;
      if (background) setRefreshing(true);
      else setLoading(true);
      try {
        const payload = await backendJson<{
          course: TeacherCourseSummary;
          students: CourseStudentRosterItem[];
        }>(`/api/teacher/courses/${encodeURIComponent(courseId)}/students`);
        setCourse(payload.course);
        setStudents(payload.students);
        setLastUpdatedAt(Date.now());
        setError('');
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : '学生名单读取失败');
      } finally {
        setLoading(false);
        setRefreshing(false);
        loadingRef.current = false;
      }
    },
    [courseId, teacherId],
  );

  useEffect(() => {
    if (!hydrated || !isLoggedIn || role !== 'TEACHER' || !teacherId) return;
    void loadStudents(false);
    const refresh = () => void loadStudents(true);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [hydrated, isLoggedIn, loadStudents, role, teacherId]);

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

  const updateNotebookAccessLimit = useCallback(
    async (student: CourseStudentRosterItem, notebookAccessLimit: number | null) => {
      setSavingProgressUserId(student.userId);
      try {
        await backendJson(`/api/teacher/courses/${encodeURIComponent(courseId)}/students`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: student.userId, notebookAccessLimit }),
        });
        setStudents((current) =>
          current.map((item) =>
            item.userId === student.userId ? { ...item, notebookAccessLimit } : item,
          ),
        );
        setError('');
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : '进度限制保存失败');
      } finally {
        setSavingProgressUserId(null);
      }
    },
    [courseId],
  );

  if (!hydrated || !isLoggedIn || role !== 'TEACHER' || !teacherId) return null;

  if (loading && !course) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50 text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-300">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          正在读取学生名单…
        </span>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50 p-6 text-center text-sm text-rose-600 dark:bg-slate-950 dark:text-rose-300">
        <div>
          <p className="font-semibold">{error || '课程不存在'}</p>
          <button
            type="button"
            className="mt-4 text-slate-500 underline underline-offset-4"
            onClick={() => router.push('/teacher')}
          >
            返回教师桌面
          </button>
        </div>
      </div>
    );
  }

  return (
    <TeacherAppShell
      testId="teacher-course-students-app"
      title={`${course.code} · 学生管理`}
      eyebrow={`${course.academicYear ?? '—'} ${course.term ? academicTermLabel(course.term) : '—'} · COURSE STUDENTS`}
      description="查看管理员分配到这门课的学生，并控制每位学生可访问的笔记本进度。页面会自动更新。"
      Icon={Users}
      accentClassName="bg-gradient-to-br from-emerald-400 via-emerald-600 to-teal-900"
      backHref={`/teacher/courses/${courseId}`}
      backLabel="返回课程"
    >
      <div className="space-y-5 p-4 sm:p-6">
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <StudentSummaryCard
            icon={<Users className="size-4" />}
            label="课程学生"
            value={`${students.length} 人`}
          />
          <StudentSummaryCard
            icon={<School className="size-4" />}
            label="名单来源"
            value="管理员数据库"
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
    </TeacherAppShell>
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
