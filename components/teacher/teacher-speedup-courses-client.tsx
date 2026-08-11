'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  BookOpenCheck,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  School,
} from 'lucide-react';
import { TeacherAppShell } from '@/components/teacher/teacher-app-shell';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { backendJson } from '@/lib/utils/backend-api';

type SpeedupCourseOption = {
  id: string;
  name: string;
  code: string | null;
  termName: string | null;
  universityAbbrs: string | null;
  isActivated: boolean;
  ownedByCurrentTeacher: boolean;
  localCourseId: string | null;
};

type TeacherCoursesResponse = { courses: SpeedupCourseOption[] };

export function TeacherSpeedupCoursesClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedCourseId = searchParams.get('requestedCourseId')?.trim() || '';
  const { data: session, status: sessionStatus } = useSession();
  const hydrated = sessionStatus !== 'loading';
  const isTeacher = session?.user?.role === 'TEACHER' || session?.user?.role === 'ADMIN';
  const [courses, setCourses] = useState<SpeedupCourseOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadCourses = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await backendJson<TeacherCoursesResponse>(
        '/api/integrations/speedup/teacher-courses',
      );
      setCourses(payload.courses);
      setSelectedIds((current) => {
        const available = new Set(
          payload.courses.filter((course) => !course.isActivated).map((course) => course.id),
        );
        const next = new Set(Array.from(current).filter((id) => available.has(id)));
        if (requestedCourseId && available.has(requestedCourseId) && current.size === 0) {
          next.add(requestedCourseId);
        }
        return next;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Speedup 课程读取失败');
    } finally {
      setLoading(false);
    }
  }, [requestedCourseId]);

  useEffect(() => {
    if (!hydrated) return;
    if (sessionStatus !== 'authenticated' || !isTeacher) {
      router.replace('/teacher/login');
      return;
    }
    void loadCourses();
  }, [hydrated, isTeacher, loadCourses, router, sessionStatus]);

  const selectableCourses = useMemo(
    () => courses.filter((course) => !course.isActivated),
    [courses],
  );
  const allSelectableChecked =
    selectableCourses.length > 0 && selectableCourses.every((course) => selectedIds.has(course.id));

  const toggleCourse = (courseId: string, checked: boolean) => {
    setNotice('');
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(courseId);
      else next.delete(courseId);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setNotice('');
    setSelectedIds(checked ? new Set(selectableCourses.map((course) => course.id)) : new Set());
  };

  const activateSelected = async () => {
    if (selectedIds.size === 0 || submitting) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const payload = await backendJson<{
        activated: Array<{ externalCourseId: string; localCourseId: string; created: boolean }>;
      }>('/api/integrations/speedup/courses/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseIds: Array.from(selectedIds) }),
      });
      const createdCount = payload.activated.filter((course) => course.created).length;
      setNotice(
        createdCount > 0
          ? `已开通 ${createdCount} 门课程，学生现在可以从 Speedup 进入。`
          : '所选课程此前已经开通。',
      );
      setSelectedIds(new Set());
      await loadCourses();
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : '课程开通失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (!hydrated || sessionStatus !== 'authenticated' || !isTeacher) return null;

  return (
    <TeacherAppShell
      title="开通本学期课程"
      description="以下课程来自 Speedup TeacherCourses；该接口约定只返回本学期允许开通 AI 的课程。"
      eyebrow="SPEEDUP AI COURSES"
      Icon={BookOpenCheck}
      accentClassName="bg-gradient-to-br from-sky-500 to-indigo-600"
      testId="teacher-speedup-courses"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-5 sm:p-7">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>课程读取或开通失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-100">
            <CheckCircle2 className="text-emerald-600" />
            <AlertTitle>课程已开通</AlertTitle>
            <AlertDescription className="text-emerald-800 dark:text-emerald-200">
              {notice}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
            <Checkbox
              checked={allSelectableChecked}
              disabled={selectableCourses.length === 0 || loading || submitting}
              onCheckedChange={(checked) => toggleAll(checked === true)}
              aria-label="选择全部未开通课程"
            />
            选择全部未开通课程
            <span className="text-slate-500">({selectableCourses.length})</span>
          </label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={loading || submitting}
              onClick={() => void loadCourses()}
            >
              <RefreshCw className={loading ? 'animate-spin' : ''} />
              刷新
            </Button>
            <Button
              type="button"
              disabled={selectedIds.size === 0 || loading || submitting}
              onClick={() => void activateSelected()}
            >
              {submitting ? <Loader2 className="animate-spin" /> : <BookOpenCheck />}
              开通所选课程{selectedIds.size > 0 ? `（${selectedIds.size}）` : ''}
            </Button>
          </div>
        </div>

        {loading && courses.length === 0 ? (
          <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-slate-300 text-sm text-slate-500 dark:border-white/15">
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> 正在读取本学期 Speedup 课程…
            </span>
          </div>
        ) : null}

        {!loading && courses.length === 0 && !error ? (
          <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-slate-300 px-6 text-center dark:border-white/15">
            <div>
              <School className="mx-auto size-9 text-slate-400" />
              <p className="mt-3 font-medium">本学期暂无可开通的 AI 课程</p>
              <p className="mt-1 text-sm text-slate-500">
                如有疑问，请确认 Speedup 的教师课程配置。
              </p>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          {courses.map((course) => {
            const selected = selectedIds.has(course.id);
            const requested = requestedCourseId === course.id;
            return (
              <Card
                key={course.id}
                className={
                  requested
                    ? 'border-sky-400 bg-sky-50/70 ring-2 ring-sky-200 dark:bg-sky-950/20 dark:ring-sky-900'
                    : 'border-slate-200 bg-white/90 dark:border-white/10 dark:bg-white/[0.04]'
                }
              >
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <Checkbox
                      className="mt-1"
                      checked={selected}
                      disabled={course.isActivated || submitting}
                      onCheckedChange={(checked) => toggleCourse(course.id, checked === true)}
                      aria-label={`选择课程 ${course.name}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="truncate">{course.name}</CardTitle>
                        {course.isActivated ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                          >
                            已开通
                          </Badge>
                        ) : (
                          <Badge variant="secondary">未开通</Badge>
                        )}
                        {requested ? <Badge>当前进入课程</Badge> : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {[course.code, course.termName].filter(Boolean).join(' · ') ||
                          `Speedup 课程 ${course.id}`}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex items-end justify-between gap-4">
                  <div className="min-w-0 text-xs leading-5 text-slate-500">
                    <p>{course.universityAbbrs || 'Speedup'}</p>
                    <p>外部课程 ID：{course.id}</p>
                  </div>
                  {course.localCourseId ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        router.push(
                          `/teacher/courses/${encodeURIComponent(course.localCourseId || '')}`,
                        )
                      }
                    >
                      进入课程 <ExternalLink />
                    </Button>
                  ) : course.isActivated ? (
                    <span className="text-xs text-amber-700 dark:text-amber-300">
                      已由其他教师开通
                    </span>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </TeacherAppShell>
  );
}
