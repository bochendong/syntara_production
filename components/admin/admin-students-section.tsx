'use client';

import { useCallback, useEffect, useState } from 'react';
import { Eye, Loader2, Minus, Plus, Search, Trash2 } from 'lucide-react';
import { AdminStudentCourseWorkspace } from '@/components/admin/admin-student-course-card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { backendJson } from '@/lib/utils/backend-api';
import { toast } from '@/lib/notifications/client-toast';

type AcademicTerm = 'winter' | 'summer' | 'fall';

const ACADEMIC_TERM_LABEL: Record<AcademicTerm, string> = {
  winter: 'Winter',
  summer: 'Summer',
  fall: 'Fall',
};

const TERM_RANK: Record<AcademicTerm, number> = {
  winter: 0,
  summer: 1,
  fall: 2,
};

const STUDENT_PAGE_SIZE = 20;

function currentSemesterValue(date = new Date()) {
  const month = date.getMonth() + 1;
  const term: AcademicTerm = month <= 4 ? 'winter' : month <= 8 ? 'summer' : 'fall';
  return `${date.getFullYear()}:${term}`;
}

type CourseOption = {
  id: string;
  name: string;
  courseCode: string | null;
  academicYear: number | null;
  academicTerm: AcademicTerm | null;
  university?: string | null;
};

type StudentRow = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  phone?: string | null;
  isActive: boolean;
  courses: Array<CourseOption & { notebookAccessLimit: number | null; joinedAt: string }>;
  createdAt: string;
  updatedAt: string;
};

type CourseDialogState = {
  mode: 'add' | 'remove';
  student: StudentRow;
};

function courseLabel(course: CourseOption) {
  const term = course.academicTerm ? ACADEMIC_TERM_LABEL[course.academicTerm] : null;
  return [course.courseCode || course.name, course.academicYear, term].filter(Boolean).join(' · ');
}

function campusOf(course: Pick<CourseOption, 'university' | 'courseCode'>) {
  const university = course.university?.trim();
  if (university) return university;
  const prefix = course.courseCode?.trim().split('-')[0] || '';
  return /^[A-Za-z]{2,8}$/.test(prefix) && prefix !== course.courseCode?.trim()
    ? prefix.toUpperCase()
    : '';
}

function semesterValue(course: Pick<CourseOption, 'academicYear' | 'academicTerm'>) {
  if (!course.academicYear || !course.academicTerm) return '';
  return `${course.academicYear}:${course.academicTerm}`;
}

function semesterLabel(value: string) {
  const [year, term] = value.split(':');
  if (!year || !(term === 'winter' || term === 'summer' || term === 'fall')) return value;
  return `${year} ${ACADEMIC_TERM_LABEL[term]}`;
}

export function AdminStudentsSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [semester, setSemester] = useState(currentSemesterValue);
  const [campus, setCampus] = useState('');
  const [courseId, setCourseId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [insightsVersion, setInsightsVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [courseDialog, setCourseDialog] = useState<CourseDialogState | null>(null);
  const [courseDialogSelection, setCourseDialogSelection] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [studentPayload, coursePayload] = await Promise.all([
        backendJson<{ students: StudentRow[] }>('/api/admin/students'),
        backendJson<{ courses: CourseOption[] }>('/api/admin/courses?take=200'),
      ]);
      setStudents(studentPayload.students);
      setLoadError('');
      setInsightsVersion((value) => value + 1);
      setCourses(coursePayload.courses);
    } catch (error) {
      const message = error instanceof Error ? error.message : '学生列表加载失败';
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const updateCourses = async (
    student: StudentRow,
    nextCourseIds: string[],
    successMessage = '学生课程已更新',
  ): Promise<boolean> => {
    setBusyId(student.id);
    try {
      await backendJson(`/api/admin/students/${encodeURIComponent(student.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseIds: nextCourseIds }),
      });
      await load();
      toast.success(successMessage);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '课程更新失败');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const openCourseDialog = (student: StudentRow, mode: CourseDialogState['mode']) => {
    setCourseDialog({ student, mode });
    setCourseDialogSelection([]);
  };

  const closeCourseDialog = () => {
    if (courseDialog && busyId === courseDialog.student.id) return;
    setCourseDialog(null);
    setCourseDialogSelection([]);
  };

  const toggleCourseDialogSelection = (courseId: string, checked: boolean) => {
    setCourseDialogSelection((current) =>
      checked
        ? Array.from(new Set([...current, courseId]))
        : current.filter((id) => id !== courseId),
    );
  };

  const confirmCourseDialog = async () => {
    if (!courseDialog || courseDialogSelection.length === 0) return;
    const assignedIds = courseDialog.student.courses.map((course) => course.id);
    const nextCourseIds =
      courseDialog.mode === 'add'
        ? Array.from(new Set([...assignedIds, ...courseDialogSelection]))
        : assignedIds.filter((courseId) => !courseDialogSelection.includes(courseId));
    const updated = await updateCourses(
      courseDialog.student,
      nextCourseIds,
      courseDialog.mode === 'add'
        ? `已添加 ${courseDialogSelection.length} 门课程`
        : `已移除 ${courseDialogSelection.length} 门课程`,
    );
    if (updated) {
      setCourseDialog(null);
      setCourseDialogSelection([]);
    }
  };

  const openStudent = async (studentId: string) => {
    setBusyId(studentId);
    try {
      const result = await backendJson<{ redirectUrl: string }>(
        `/api/admin/students/${encodeURIComponent(studentId)}/preview`,
        { method: 'POST' },
      );
      window.location.assign(result.redirectUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法进入学生页面');
      setBusyId(null);
    }
  };

  const removeStudent = async (student: StudentRow) => {
    if (!window.confirm(`确定删除学生“${student.name || student.email}”吗？`)) return;
    setBusyId(student.id);
    try {
      await backendJson(`/api/admin/students/${encodeURIComponent(student.id)}`, {
        method: 'DELETE',
      });
      setStudents((current) => current.filter((item) => item.id !== student.id));
      toast.success('学生账号已删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '学生删除失败');
    } finally {
      setBusyId(null);
    }
  };

  const search = query.trim().toLowerCase();
  const semesterOptions = Array.from(
    new Set([currentSemesterValue(), ...courses.map(semesterValue).filter(Boolean)]),
  ).sort((left, right) => {
    const [leftYear, leftTerm] = left.split(':');
    const [rightYear, rightTerm] = right.split(':');
    return (
      Number(rightYear) - Number(leftYear) ||
      TERM_RANK[leftTerm as AcademicTerm] - TERM_RANK[rightTerm as AcademicTerm]
    );
  });
  const campusOptions = Array.from(new Set(courses.map(campusOf).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
  const courseOptions = courses.filter((course) => {
    if (semester && semesterValue(course) !== semester) return false;
    if (campus && campusOf(course) !== campus) return false;
    return true;
  });
  const filtersActive = Boolean(search || semester || campus || courseId);
  const filteredStudents = students.filter((student) => {
    const matchesSearch =
      !search ||
      [student.name, student.email, student.phone || ''].some((value) =>
        value.toLowerCase().includes(search),
      );
    if (!matchesSearch) return false;
    if (!semester && !campus && !courseId) return true;
    return student.courses.some((course) => {
      if (semester && semesterValue(course) !== semester) return false;
      if (campus && campusOf(course) !== campus) return false;
      if (courseId && course.id !== courseId) return false;
      return true;
    });
  });
  const pageCount = Math.max(1, Math.ceil(filteredStudents.length / STUDENT_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStudents = filteredStudents.slice(
    (currentPage - 1) * STUDENT_PAGE_SIZE,
    currentPage * STUDENT_PAGE_SIZE,
  );
  const selected = pageStudents.find((student) => student.id === selectedId) || pageStudents[0];

  useEffect(() => {
    setPage(1);
  }, [search, semester, campus, courseId]);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative w-full min-w-0 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            aria-label="搜索学生"
            className="pl-10"
            placeholder="搜索姓名、手机号或邮箱…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          aria-label="学期"
          value={semester}
          onChange={(event) => {
            const nextSemester = event.target.value;
            setSemester(nextSemester);
            if (
              courseId &&
              !courses.some(
                (course) =>
                  course.id === courseId &&
                  (!nextSemester || semesterValue(course) === nextSemester) &&
                  (!campus || campusOf(course) === campus),
              )
            ) {
              setCourseId('');
            }
          }}
          className="h-9 shrink-0 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">全部学期</option>
          {semesterOptions.map((value) => (
            <option key={value} value={value}>
              {semesterLabel(value)}
            </option>
          ))}
        </select>
        <select
          aria-label="校区"
          value={campus}
          onChange={(event) => {
            const nextCampus = event.target.value;
            setCampus(nextCampus);
            if (
              courseId &&
              !courses.some(
                (course) =>
                  course.id === courseId &&
                  (!semester || semesterValue(course) === semester) &&
                  (!nextCampus || campusOf(course) === nextCampus),
              )
            ) {
              setCourseId('');
            }
          }}
          className="h-9 shrink-0 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">全部校区</option>
          {campusOptions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="课程"
          value={courseId}
          onChange={(event) => setCourseId(event.target.value)}
          className="h-9 min-w-0 shrink rounded-md border bg-background px-3 text-sm lg:max-w-[280px]"
        >
          <option value="">全部课程</option>
          {courseOptions.map((course) => (
            <option key={course.id} value={course.id}>
              {courseLabel(course)}
            </option>
          ))}
        </select>
      </div>
      {loadError ? (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/25 p-4 text-sm"
        >
          <p>{loadError}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            重新加载
          </Button>
        </div>
      ) : null}
      <div className="grid min-h-[640px] items-stretch gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside
          aria-label="学生列表"
          className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-background/40"
        >
          <div className="border-b px-4 py-4 text-xs text-muted-foreground">
            共 {students.length} 名学生
            {filtersActive ? ` · 匹配 ${filteredStudents.length} 名` : ''}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading && !students.length ? (
              <div role="status" className="grid min-h-40 place-items-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : pageStudents.length ? (
              pageStudents.map((student) => (
                <button
                  key={student.id}
                  type="button"
                  aria-pressed={selected?.id === student.id}
                  onClick={() => setSelectedId(student.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-primary',
                    selected?.id === student.id ? 'bg-primary/10' : 'hover:bg-muted/50',
                  )}
                >
                  <Avatar className="size-10">
                    <AvatarImage src={student.image || undefined} alt="" />
                    <AvatarFallback>
                      {Array.from(student.name.trim() || student.email || '学生')[0].toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {student.name || '未命名学生'}
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {student.phone || student.email || '未填写联系方式'}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                {filtersActive ? '没有匹配的学生' : '暂无学生账号'}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t px-3 py-3">
            <p className="text-xs text-muted-foreground">
              第 {currentPage} / {pageCount} 页
            </p>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                上一页
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={currentPage >= pageCount}
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
                <AvatarImage src={selected.image || undefined} alt={selected.name || '学生头像'} />
                <AvatarFallback className="text-lg">
                  {Array.from(selected.name.trim() || selected.email || '学生')[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <h2 className="text-xl font-semibold">{selected.name || '未命名学生'}</h2>
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="进入学生页面"
                      title="进入学生页面"
                      className="size-8"
                      onClick={() => void openStudent(selected.id)}
                      disabled={busyId === selected.id}
                    >
                      {busyId === selected.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="添加课程"
                      title="添加课程"
                      className="size-8"
                      onClick={() => openCourseDialog(selected, 'add')}
                      disabled={busyId === selected.id || selected.courses.length >= courses.length}
                    >
                      <Plus className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="删除课程"
                      title="删除课程"
                      className="size-8"
                      onClick={() => openCourseDialog(selected, 'remove')}
                      disabled={busyId === selected.id || selected.courses.length === 0}
                    >
                      <Minus className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="删除学生"
                      title="删除学生"
                      className="size-8 text-muted-foreground hover:border-destructive/30 hover:text-destructive"
                      onClick={() => void removeStudent(selected)}
                      disabled={busyId === selected.id}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span>{selected.phone || '未填写手机号'}</span>
                  {selected.email ? <span className="break-all">{selected.email}</span> : null}
                </div>
              </div>
            </div>
            <AdminStudentCourseWorkspace
              key={selected.id}
              studentId={selected.id}
              courses={selected.courses}
              refreshKey={insightsVersion}
            />
          </section>
        ) : (
          <div className="hidden min-h-96 items-center justify-center text-sm text-muted-foreground lg:flex">
            {loading ? '正在加载学生…' : '选择学生查看学习情况'}
          </div>
        )}
      </div>

      <Dialog
        open={Boolean(courseDialog)}
        onOpenChange={(open) => {
          if (!open) closeCourseDialog();
        }}
      >
        <DialogContent className="max-w-lg rounded-3xl p-0 sm:max-w-lg">
          <DialogHeader className="border-b px-6 py-5 pr-14">
            <DialogTitle>
              {courseDialog?.mode === 'add' ? '添加学生课程' : '删除学生课程'}
            </DialogTitle>
            <DialogDescription>
              {courseDialog?.mode === 'add'
                ? `选择要分配给“${courseDialog.student.name || courseDialog.student.email}”的课程。`
                : `选择要从“${courseDialog?.student.name || courseDialog?.student.email}”移除的课程；课程本身不会被删除。`}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[min(52vh,420px)] space-y-2 overflow-y-auto px-6 py-5">
            {courseDialog
              ? (courseDialog.mode === 'add'
                  ? courses.filter(
                      (course) =>
                        !courseDialog.student.courses.some(
                          (assignedCourse) => assignedCourse.id === course.id,
                        ),
                    )
                  : courseDialog.student.courses
                ).map((course) => {
                  const checked = courseDialogSelection.includes(course.id);
                  return (
                    <label
                      key={course.id}
                      className="flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) =>
                          toggleCourseDialogSelection(course.id, value === true)
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {courseLabel(course)}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {course.name}
                        </span>
                      </span>
                    </label>
                  );
                })
              : null}

            {courseDialog &&
            (courseDialog.mode === 'add'
              ? courses.every((course) =>
                  courseDialog.student.courses.some(
                    (assignedCourse) => assignedCourse.id === course.id,
                  ),
                )
              : courseDialog.student.courses.length === 0) ? (
              <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                {courseDialog.mode === 'add' ? '没有其他可添加的课程' : '该学生目前没有课程'}
              </div>
            ) : null}
          </div>

          <DialogFooter className="border-t bg-muted/20 px-6 py-4">
            <Button variant="outline" onClick={closeCourseDialog} disabled={Boolean(busyId)}>
              取消
            </Button>
            <Button
              variant={courseDialog?.mode === 'remove' ? 'destructive' : 'default'}
              onClick={() => void confirmCourseDialog()}
              disabled={courseDialogSelection.length === 0 || Boolean(busyId)}
            >
              {busyId ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {courseDialog?.mode === 'add' ? '确认添加' : '确认删除'}
              {courseDialogSelection.length ? `（${courseDialogSelection.length}）` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
