'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Archive,
  BookOpenText,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  History,
  Library,
  Loader2,
  Search,
} from 'lucide-react';
import { TeacherAppShell } from '@/components/teacher/teacher-app-shell';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  academicTermLabel,
  listCourseContent,
  listTeacherCurrentCourses,
  listTeacherPastCoursesPage,
  listTeacherPastTerms,
  migrateCourseContentReferences,
  type AcademicCourseSummary,
  type AcademicTermSummary,
  type CourseContentItem,
} from '@/lib/teacher/online-course-archive';
import { isLocalDemoUserId } from '@/lib/auth/local-demo';
import {
  LOCAL_DEMO_CURRENT_COURSE_SUMMARIES,
  LOCAL_DEMO_PAST_COURSES,
  LOCAL_DEMO_PAST_TERMS,
} from '@/lib/teacher/local-demo-fixtures';

type CourseContentType = CourseContentItem['type'];

const PAST_COURSE_PAGE_SIZE = 12;

const CONTENT_TYPE_META: Record<CourseContentType, { label: string; Icon: typeof FileText }> = {
  notebook: { label: '笔记本', Icon: BookOpenText },
  problem_bank: { label: '题库', Icon: Library },
  source: { label: '源文件', Icon: FileText },
};

function localDemoCourseContent(course: AcademicCourseSummary): CourseContentItem[] {
  const items: Array<{ type: CourseContentType; title: string; description: string }> = [
    { type: 'notebook', title: `${course.code} 核心讲义`, description: '6 个章节 · Markdown' },
    { type: 'problem_bank', title: `${course.code} 练习题库`, description: '42 道题目' },
    { type: 'source', title: `${course.code} 课程大纲.pdf`, description: '教师源文件' },
  ];
  return items.map((item, index) => ({
    id: `demo-content-${course.id}-${index + 1}`,
    ...item,
    createdAt: course.createdAt + index,
    updatedAt: course.updatedAt + index,
    reference: {
      id: `demo-reference-${course.id}-${index + 1}`,
      courseId: course.id,
      assetId: `demo-asset-${course.id}-${index + 1}`,
    },
  }));
}

export function TeacherPastCoursesAppClient() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const hydrated = sessionStatus !== 'loading';
  const isLoggedIn = sessionStatus === 'authenticated';
  const role =
    session?.user?.role === 'TEACHER' || session?.user?.role === 'ADMIN' ? 'TEACHER' : 'STUDENT';
  const teacherId = session?.user?.id || '';
  const localDemo = isLocalDemoUserId(teacherId);
  const [currentCourses, setCurrentCourses] = useState<AcademicCourseSummary[]>([]);
  const [pastTerms, setPastTerms] = useState<AcademicTermSummary[]>([]);
  const [selectedTermKey, setSelectedTermKey] = useState('');
  const [pastCourses, setPastCourses] = useState<AcademicCourseSummary[]>([]);
  const [pastTotal, setPastTotal] = useState(0);
  const [pastPage, setPastPage] = useState(1);
  const [pastQuery, setPastQuery] = useState('');
  const [appliedPastQuery, setAppliedPastQuery] = useState('');
  const [termsLoading, setTermsLoading] = useState(true);
  const [pastLoading, setPastLoading] = useState(false);
  const [pastError, setPastError] = useState('');
  const [pastNotice, setPastNotice] = useState('');
  const [migrationSource, setMigrationSource] = useState<AcademicCourseSummary | null>(null);
  const [migrationContent, setMigrationContent] = useState<CourseContentItem[]>([]);
  const [migrationTargetCourseId, setMigrationTargetCourseId] = useState('');
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<Set<string>>(new Set());
  const [migrationLoading, setMigrationLoading] = useState(false);
  const [migrationSubmitting, setMigrationSubmitting] = useState(false);
  const [migrationError, setMigrationError] = useState('');

  const loadCurrentCourses = useCallback(async () => {
    if (!teacherId) return;
    if (localDemo) {
      setCurrentCourses(LOCAL_DEMO_CURRENT_COURSE_SUMMARIES);
      return;
    }
    setCurrentCourses(await listTeacherCurrentCourses({ teacherId }));
  }, [localDemo, teacherId]);

  const loadPastTerms = useCallback(async () => {
    if (!teacherId) return;
    setTermsLoading(true);
    setPastError('');
    try {
      if (localDemo) {
        setPastTerms(LOCAL_DEMO_PAST_TERMS);
        setSelectedTermKey((current) =>
          LOCAL_DEMO_PAST_TERMS.some((term) => term.key === current)
            ? current
            : (LOCAL_DEMO_PAST_TERMS[0]?.key ?? ''),
        );
        return;
      }
      const terms = await listTeacherPastTerms({ teacherId });
      setPastTerms(terms);
      setSelectedTermKey((current) =>
        terms.some((term) => term.key === current) ? current : (terms[0]?.key ?? ''),
      );
      if (terms.length === 0) {
        setPastCourses([]);
        setPastTotal(0);
      }
    } catch (loadError) {
      setPastError(loadError instanceof Error ? loadError.message : '学期目录读取失败');
    } finally {
      setTermsLoading(false);
    }
  }, [localDemo, teacherId]);

  useEffect(() => {
    if (!hydrated) return;
    if (!isLoggedIn || role !== 'TEACHER') {
      router.replace('/speedup/signed-out?role=teacher');
      return;
    }
    void loadCurrentCourses().catch((loadError) => {
      setPastError(loadError instanceof Error ? loadError.message : '当学期课程读取失败');
    });
    void loadPastTerms();
  }, [hydrated, isLoggedIn, loadCurrentCourses, loadPastTerms, role, router]);

  const selectedTerm = useMemo(
    () => pastTerms.find((term) => term.key === selectedTermKey) ?? null,
    [pastTerms, selectedTermKey],
  );

  useEffect(() => {
    if (!hydrated || !isLoggedIn || role !== 'TEACHER' || !teacherId || !selectedTerm) {
      return;
    }
    let cancelled = false;
    setPastLoading(true);
    setPastError('');
    if (localDemo) {
      const normalizedQuery = appliedPastQuery.trim().toLowerCase();
      const matching = LOCAL_DEMO_PAST_COURSES.filter(
        (course) =>
          course.academicYear === selectedTerm.academicYear &&
          course.term === selectedTerm.term &&
          (!normalizedQuery ||
            `${course.code} ${course.name}`.toLowerCase().includes(normalizedQuery)),
      );
      const start = (pastPage - 1) * PAST_COURSE_PAGE_SIZE;
      setPastCourses(matching.slice(start, start + PAST_COURSE_PAGE_SIZE));
      setPastTotal(matching.length);
      setPastLoading(false);
      return;
    }
    void listTeacherPastCoursesPage({
      teacherId,
      academicYear: selectedTerm.academicYear,
      term: selectedTerm.term,
      page: pastPage,
      pageSize: PAST_COURSE_PAGE_SIZE,
      query: appliedPastQuery,
    })
      .then((result) => {
        if (cancelled) return;
        setPastCourses(result.items);
        setPastTotal(result.total);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setPastError(loadError instanceof Error ? loadError.message : '往届课程读取失败');
      })
      .finally(() => {
        if (!cancelled) setPastLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedPastQuery, hydrated, isLoggedIn, localDemo, pastPage, role, selectedTerm, teacherId]);

  const pastPageCount = Math.max(1, Math.ceil(pastTotal / PAST_COURSE_PAGE_SIZE));
  const migrationTargetCourses = useMemo(
    () =>
      migrationSource
        ? currentCourses.filter((course) => course.code === migrationSource.code)
        : [],
    [currentCourses, migrationSource],
  );

  const selectTerm = (term: AcademicTermSummary) => {
    if (term.key === selectedTermKey) return;
    setSelectedTermKey(term.key);
    setPastPage(1);
    setPastQuery('');
    setAppliedPastQuery('');
    setPastCourses([]);
    setPastTotal(0);
  };

  const openMigration = async (course: AcademicCourseSummary) => {
    setMigrationSource(course);
    setMigrationContent([]);
    setSelectedReferenceIds(new Set());
    setMigrationError('');
    setMigrationLoading(true);
    const matchingTarget = currentCourses.find((candidate) => candidate.code === course.code);
    setMigrationTargetCourseId(matchingTarget?.id ?? '');
    if (localDemo) {
      const items = localDemoCourseContent(course);
      setMigrationContent(items);
      setSelectedReferenceIds(new Set(items.map((item) => item.reference.id)));
      setMigrationLoading(false);
      return;
    }
    try {
      const items = await listCourseContent(course.id);
      setMigrationContent(items);
      setSelectedReferenceIds(new Set(items.map((item) => item.reference.id)));
    } catch (loadError) {
      setMigrationError(loadError instanceof Error ? loadError.message : '课程内容读取失败');
    } finally {
      setMigrationLoading(false);
    }
  };

  const closeMigration = (force = false) => {
    if (migrationSubmitting && !force) return;
    setMigrationSource(null);
    setMigrationContent([]);
    setSelectedReferenceIds(new Set());
    setMigrationError('');
  };

  const toggleMigrationReference = (referenceId: string) => {
    setSelectedReferenceIds((current) => {
      const next = new Set(current);
      if (next.has(referenceId)) next.delete(referenceId);
      else next.add(referenceId);
      return next;
    });
  };

  const submitMigration = async () => {
    if (!teacherId || !migrationSource || !migrationTargetCourseId) return;
    setMigrationSubmitting(true);
    setMigrationError('');
    if (localDemo) {
      const target = currentCourses.find((course) => course.id === migrationTargetCourseId);
      setPastNotice(
        `本地预览：已模拟向 ${target?.code ?? '当学期课程'} 建立 ${selectedReferenceIds.size} 个内容引用。`,
      );
      closeMigration(true);
      setMigrationSubmitting(false);
      return;
    }
    try {
      const result = await migrateCourseContentReferences({
        teacherId,
        sourceCourseId: migrationSource.id,
        targetCourseId: migrationTargetCourseId,
        sourceReferenceIds: Array.from(selectedReferenceIds),
      });
      const target = currentCourses.find((course) => course.id === migrationTargetCourseId);
      setPastNotice(
        `已向 ${target?.code ?? '当学期课程'} 建立 ${result.migratedCount} 个内容引用。`,
      );
      closeMigration(true);
      await loadCurrentCourses();
    } catch (migrationFailure) {
      setMigrationError(
        migrationFailure instanceof Error ? migrationFailure.message : '内容迁移失败',
      );
    } finally {
      setMigrationSubmitting(false);
    }
  };

  if (!hydrated || !isLoggedIn || role !== 'TEACHER') return null;

  return (
    <TeacherAppShell
      testId="teacher-past-courses-app"
      title="往届课程"
      eyebrow="PAST COURSES"
      description="按学期浏览本届课程与机构共享的往届内容；选择 Term 后才读取课程。"
      Icon={History}
      accentClassName="bg-gradient-to-br from-emerald-400 via-emerald-600 to-emerald-800"
    >
      <div className="space-y-5 p-4 sm:p-6">
        {pastNotice ? (
          <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
            <Check className="size-4 shrink-0" />
            {pastNotice}
          </div>
        ) : null}
        {pastError ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-400/10 dark:text-rose-200">
            {pastError}
          </p>
        ) : null}

        <div className="grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside
            data-testid="teacher-past-term-list"
            className="rounded-3xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/[0.035] lg:sticky lg:top-4"
          >
            <div className="flex items-center justify-between px-2 py-1.5">
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">学期</p>
                <p className="mt-0.5 text-[11px] text-slate-400">包含本届与往届课程</p>
              </div>
              <Archive className="size-4 text-slate-400" />
            </div>

            {termsLoading ? (
              <div className="mt-2 flex gap-2 overflow-hidden lg:flex-col">
                {[0, 1, 2].map((item) => (
                  <div
                    key={item}
                    className="h-[58px] min-w-40 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-white/10 lg:min-w-0"
                  />
                ))}
              </div>
            ) : pastTerms.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed border-slate-200 px-3 py-7 text-center text-xs text-slate-400 dark:border-white/10">
                暂无课程学期
              </div>
            ) : (
              <nav
                aria-label="课程学期"
                className="mt-2 flex gap-2 overflow-x-auto pb-1 lg:flex-col"
              >
                {pastTerms.map((term) => {
                  const selected = term.key === selectedTermKey;
                  const isCurrentTerm = currentCourses.some(
                    (course) =>
                      course.academicYear === term.academicYear && course.term === term.term,
                  );
                  return (
                    <button
                      key={term.key}
                      type="button"
                      data-testid={`past-term-${term.academicYear}-${term.term}`}
                      aria-pressed={selected}
                      onClick={() => selectTerm(term)}
                      className={`group flex min-w-40 items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 text-left transition lg:min-w-0 ${selected ? 'border-emerald-300 bg-white shadow-sm dark:border-emerald-400/40 dark:bg-white/10' : 'border-transparent hover:border-slate-200 hover:bg-white/70 dark:hover:border-white/10 dark:hover:bg-white/5'}`}
                    >
                      <span>
                        <span
                          className={`block text-sm font-semibold ${selected ? 'text-emerald-800 dark:text-emerald-200' : 'text-slate-700 dark:text-slate-200'}`}
                        >
                          {term.academicYear} {academicTermLabel(term.term)}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          {term.courseCount} 门课程{isCurrentTerm ? ' · 本届' : ''}
                        </span>
                      </span>
                      <ChevronRight
                        className={`size-4 shrink-0 transition ${selected ? 'text-emerald-500' : 'text-slate-300 group-hover:text-slate-500'}`}
                      />
                    </button>
                  );
                })}
              </nav>
            )}
          </aside>

          <section
            data-testid="past-term-course-panel"
            aria-labelledby="selected-past-term-title"
            className="min-w-0 rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.025] sm:p-5"
          >
            <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-4 dark:border-white/10 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-[11px] font-bold tracking-[0.16em] text-emerald-600 dark:text-emerald-300">
                  SELECTED TERM
                </p>
                <h2 id="selected-past-term-title" className="mt-1 text-xl font-semibold">
                  {selectedTerm
                    ? `${selectedTerm.academicYear} ${academicTermLabel(selectedTerm.term)}`
                    : '选择一个学期'}
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  {selectedTerm ? `${pastTotal} 门符合条件的课程` : '左侧仅加载学期索引'}
                </p>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setPastPage(1);
                  setAppliedPastQuery(pastQuery.trim());
                }}
                className="flex w-full gap-2 xl:max-w-md"
              >
                <label className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={pastQuery}
                    onChange={(event) => setPastQuery(event.target.value)}
                    placeholder="搜索当前 Term 的课程"
                    disabled={!selectedTerm}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-900"
                  />
                </label>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={!selectedTerm || pastLoading}
                  className="h-10 rounded-xl bg-white dark:bg-white/5"
                >
                  搜索
                </Button>
              </form>
            </div>

            {termsLoading || pastLoading ? (
              <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin" />
                {termsLoading ? '正在读取学期目录…' : '正在读取该学期课程…'}
              </div>
            ) : !selectedTerm ? (
              <div className="grid min-h-72 place-items-center text-center">
                <div>
                  <Archive className="mx-auto size-9 text-slate-300" />
                  <p className="mt-3 font-medium">没有可查看的课程</p>
                </div>
              </div>
            ) : pastCourses.length === 0 ? (
              <div className="grid min-h-72 place-items-center text-center">
                <div>
                  <Search className="mx-auto size-8 text-slate-300" />
                  <p className="mt-3 font-medium">当前 Term 没有匹配的课程</p>
                  {appliedPastQuery ? (
                    <button
                      type="button"
                      className="mt-2 text-xs font-semibold text-emerald-600 hover:underline"
                      onClick={() => {
                        setPastQuery('');
                        setAppliedPastQuery('');
                        setPastPage(1);
                      }}
                    >
                      清除搜索
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="grid gap-3 pt-5 md:grid-cols-2 xl:grid-cols-3">
                {pastCourses.map((course) => {
                  const hasCurrentTarget = currentCourses.some(
                    (target) => target.code === course.code,
                  );
                  const isCurrentDesktopCourse = currentCourses.some(
                    (target) => target.id === course.id,
                  );
                  return (
                    <article
                      key={course.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-white/[0.06]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold tracking-[0.12em] text-sky-700 dark:text-sky-200">
                          {course.code}
                        </p>
                        {isCurrentDesktopCourse ? (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-400/15 dark:text-sky-200">
                            本届 · 已在桌面
                          </span>
                        ) : null}
                      </div>
                      <h3 className="mt-1 truncate font-semibold">{course.name}</h3>
                      <p className="mt-1 truncate text-[11px] text-slate-400">
                        由 {course.builderName ?? '机构教师'} 建设 · 机构共享
                      </p>
                      <div className="mt-3 flex gap-2 text-xs text-slate-500">
                        <span>{course.contentCount} 项内容</span>
                        <span>·</span>
                        <span>{course.inheritedCount} 个共享引用</span>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 rounded-xl bg-white dark:bg-white/5"
                          onClick={() =>
                            router.push(`/teacher/courses/${encodeURIComponent(course.id)}`)
                          }
                        >
                          查看课程
                        </Button>
                        <Button
                          data-testid={`migrate-course-${course.id}`}
                          size="sm"
                          className="flex-1 rounded-xl disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-white/10 dark:disabled:text-slate-400"
                          disabled={isCurrentDesktopCourse || !hasCurrentTarget}
                          onClick={() => void openMigration(course)}
                        >
                          {isCurrentDesktopCourse
                            ? '已在桌面'
                            : hasCurrentTarget
                              ? '迁移内容'
                              : '本学期未开设'}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {selectedTerm ? (
              <div className="mt-5 flex flex-col gap-3 border-t border-slate-200/80 pt-4 text-xs text-slate-500 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  共 {pastTotal} 门 · 第 {pastPage}/{pastPageCount} 页
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pastPage <= 1 || pastLoading}
                    onClick={() => setPastPage((value) => Math.max(1, value - 1))}
                  >
                    <ChevronLeft className="size-4" />
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pastPage >= pastPageCount || pastLoading}
                    onClick={() => setPastPage((value) => Math.min(pastPageCount, value + 1))}
                  >
                    下一页
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>

      <Dialog open={Boolean(migrationSource)} onOpenChange={(open) => !open && closeMigration()}>
        <DialogContent
          data-testid="migration-content-dialog"
          className="max-h-[min(86dvh,760px)] max-w-2xl overflow-hidden rounded-3xl p-0"
        >
          <DialogHeader className="border-b border-slate-200/80 px-6 py-5 dark:border-white/10">
            <DialogTitle>迁移课程内容</DialogTitle>
            <DialogDescription>
              从 {migrationSource?.code} · {migrationSource?.academicYear}{' '}
              {migrationSource ? academicTermLabel(migrationSource.term) : ''}{' '}
              选择内容，并引用到当学期课程。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <label className="block text-sm font-semibold">
              迁移到
              <select
                data-testid="migration-target"
                value={migrationTargetCourseId}
                onChange={(event) => setMigrationTargetCourseId(event.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-400 dark:border-white/10 dark:bg-slate-900"
              >
                {migrationTargetCourses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code} · {course.academicYear} {academicTermLabel(course.term)} ·{' '}
                    {course.name}
                  </option>
                ))}
              </select>
            </label>
            {migrationTargetCourses.length === 0 ? (
              <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-300">
                本学期没有同课程代码的机构课程，暂时不能迁移。
              </p>
            ) : null}
            <p className="mt-2 text-xs leading-5 text-slate-500">
              迁移会引用选中内容当时的版本，不复制底层文件；相同资料可以再次迁移。
            </p>

            <div className="mt-5 flex items-center justify-between">
              <h3 className="text-sm font-semibold">选择内容</h3>
              {migrationContent.length > 0 ? (
                <button
                  type="button"
                  className="text-xs font-semibold text-sky-600 hover:underline"
                  onClick={() =>
                    setSelectedReferenceIds(
                      selectedReferenceIds.size === migrationContent.length
                        ? new Set()
                        : new Set(migrationContent.map((item) => item.reference.id)),
                    )
                  }
                >
                  {selectedReferenceIds.size === migrationContent.length ? '取消全选' : '全部选择'}
                </button>
              ) : null}
            </div>
            {migrationError ? (
              <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-400/10 dark:text-rose-200">
                {migrationError}
              </p>
            ) : null}
            {migrationLoading ? (
              <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin" /> 正在读取轻量内容索引…
              </div>
            ) : migrationContent.length === 0 ? (
              <p className="mt-3 rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-400 dark:bg-white/5">
                这门往届课程还没有可迁移的内容。
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {migrationContent.map((item) => {
                  const meta = CONTENT_TYPE_META[item.type];
                  const selected = selectedReferenceIds.has(item.reference.id);
                  return (
                    <button
                      key={item.reference.id}
                      data-testid={`migration-reference-${item.reference.id}`}
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      onClick={() => toggleMigrationReference(item.reference.id)}
                      className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition ${selected ? 'border-sky-300 bg-sky-50/80 dark:border-sky-400/40 dark:bg-sky-400/10' : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20'}`}
                    >
                      <span
                        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border ${selected ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 bg-white dark:border-white/20 dark:bg-white/5'}`}
                      >
                        {selected ? <Check className="size-3.5" /> : null}
                      </span>
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-slate-500 shadow-sm dark:bg-white/10">
                        <meta.Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{item.title}</span>
                        <span className="mt-1 block text-xs text-slate-500">
                          {meta.label}
                          {item.reference.inheritedFromCourseId ? ' · 已是共享引用' : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-200/80 px-5 py-4 dark:border-white/10">
            <span className="text-xs text-slate-500">已选 {selectedReferenceIds.size} 项</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => closeMigration()}
                disabled={migrationSubmitting}
              >
                取消
              </Button>
              <Button
                onClick={() => void submitMigration()}
                disabled={
                  migrationLoading ||
                  migrationSubmitting ||
                  !migrationTargetCourseId ||
                  selectedReferenceIds.size === 0
                }
              >
                {migrationSubmitting ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
                建立内容引用
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </TeacherAppShell>
  );
}
