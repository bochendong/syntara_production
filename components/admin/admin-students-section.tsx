'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, GraduationCap, Loader2, Minus, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { backendJson } from '@/lib/utils/backend-api';
import { toast } from '@/lib/notifications/client-toast';

type CourseOption = {
  id: string;
  name: string;
  courseCode: string | null;
  academicYear: number | null;
  academicTerm: 'winter' | 'summer' | 'fall' | null;
};

type StudentRow = {
  id: string;
  email: string;
  name: string;
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
  return [course.courseCode || course.name, course.academicYear, course.academicTerm]
    .filter(Boolean)
    .join(' · ');
}

export function AdminStudentsSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [courseIds, setCourseIds] = useState<string[]>([]);
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
      setCourses(coursePayload.courses);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '学生列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const selectedCourseLabels = useMemo(
    () => courses.filter((course) => courseIds.includes(course.id)).map(courseLabel),
    [courseIds, courses],
  );

  const createStudent = async () => {
    if (!name.trim() || !email.trim() || password.length < 10) return;
    setBusyId('create');
    try {
      await backendJson('/api/admin/students', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, password, courseIds }),
      });
      setName('');
      setEmail('');
      setPassword('');
      setCourseIds([]);
      toast.success('学生账号已创建，课程已写入共享数据库');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '学生创建失败');
    } finally {
      setBusyId(null);
    }
  };

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

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-4" />
            添加学生
          </CardTitle>
          <CardDescription>
            创建可登录的学生账号并分配课程；登录后课程会自动作为桌面 App 出现。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="student-name">学生姓名</Label>
            <Input
              id="student-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="student-email">登录邮箱</Label>
            <Input
              id="student-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="student-password">初始密码（至少 10 位）</Label>
            <Input
              id="student-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="student-courses">分配课程（可多选）</Label>
            <select
              id="student-courses"
              multiple
              value={courseIds}
              onChange={(event) =>
                setCourseIds(
                  Array.from(event.currentTarget.selectedOptions, (option) => option.value),
                )
              }
              className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {courseLabel(course)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {selectedCourseLabels.length
                ? `已选择：${selectedCourseLabels.join('、')}`
                : '尚未选择课程'}
            </p>
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              onClick={() => void createStudent()}
              disabled={
                busyId === 'create' || !name.trim() || !email.trim() || password.length < 10
              }
            >
              {busyId === 'create' ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Plus className="mr-2 size-4" />
              )}
              创建学生
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>学生数据库</CardTitle>
            <CardDescription>{students.length} 个学生账号</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 size-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && !students.length ? (
            <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : students.length ? (
            students.map((student) => {
              return (
                <div key={student.id} className="rounded-2xl border p-4">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="grid size-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                          <GraduationCap className="size-4" />
                        </span>
                        <div>
                          <p className="font-semibold">{student.name || '未命名学生'}</p>
                          <p className="text-xs text-muted-foreground">{student.email}</p>
                        </div>
                        <Badge variant={student.isActive ? 'default' : 'secondary'}>
                          {student.isActive ? '已启用' : '已停用'}
                        </Badge>
                      </div>
                      <p className="mt-3 text-xs font-medium text-muted-foreground">
                        当前课程（{student.courses.length}）
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {student.courses.length ? (
                          student.courses.map((course) => (
                            <Badge key={course.id} variant="outline">
                              {courseLabel(course)}
                            </Badge>
                          ))
                        ) : (
                          <span className="rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground">
                            尚未分配课程
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void openStudent(student.id)}
                        disabled={busyId === student.id}
                      >
                        {busyId === student.id ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <Eye className="mr-2 size-4" />
                        )}
                        进入学生页面
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openCourseDialog(student, 'add')}
                        disabled={busyId === student.id || student.courses.length >= courses.length}
                      >
                        <Plus className="mr-2 size-4" />
                        添加课程
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openCourseDialog(student, 'remove')}
                        disabled={busyId === student.id || student.courses.length === 0}
                      >
                        <Minus className="mr-2 size-4" />
                        删除课程
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void removeStudent(student)}
                        disabled={busyId === student.id}
                      >
                        <Trash2 className="mr-2 size-4" />
                        删除学生
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">
              还没有学生账号。
            </div>
          )}
        </CardContent>
      </Card>

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
