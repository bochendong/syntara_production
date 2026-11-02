'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Presentation, Radio, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TeacherAppShell } from '@/components/teacher/teacher-app-shell';
import { classroomFetch, usePolledJson } from './classroom-shared';

type HomePayload = {
  currentPeriod: { label: string };
  courses: Array<{
    id: string;
    name: string;
    courseCode: string | null;
    avatarUrl: string | null;
    problemCount: number;
    currentClass: {
      id: string;
      name: string;
      mine: boolean;
      memberCount: number;
      liveSessionId: string | null;
    } | null;
    pastClasses: Array<{ id: string; name: string; label: string; memberCount: number }>;
  }>;
};

export function TeacherClassroomHomeClient() {
  const router = useRouter();
  const { data, error, loading } = usePolledJson<HomePayload>('/api/teacher/classroom');
  const [busyCourseId, setBusyCourseId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const openClass = async (courseId: string) => {
    setBusyCourseId(courseId);
    setActionError('');
    try {
      const { classId } = await classroomFetch<{ classId: string }>(
        '/api/teacher/classroom/classes',
        { courseId },
      );
      router.push(`/teacher/classroom/classes/${encodeURIComponent(classId)}`);
    } catch (openError) {
      setActionError(openError instanceof Error ? openError.message : '开班失败');
      setBusyCourseId(null);
    }
  };

  return (
    <TeacherAppShell
      testId="teacher-classroom-home"
      title="班级与上课"
      eyebrow={data ? `本学期 · ${data.currentPeriod.label}` : 'CLASSROOM'}
      description="每门课每学期一个班。上课时给学生 6 位课堂码，发题后只统计这节课在场的人。"
      Icon={Presentation}
      accentClassName="bg-gradient-to-br from-sky-400 via-sky-600 to-indigo-800"
    >
      <div className="space-y-3 p-4 sm:p-6">
        {error || actionError ? (
          <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
            {actionError || error}
          </p>
        ) : null}
        {loading && !data ? <p className="text-sm text-slate-400">读取中…</p> : null}
        {data && !data.courses.length ? (
          <div className="rounded-3xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500 dark:border-white/10">
            还没有可以开班的课程。机构管理员把你加为课程所属机构的成员后，这里会出现对应课程。
          </div>
        ) : null}
        {data?.courses.map((course) => {
          const current = course.currentClass;
          const blocked = current && !current.mine;
          return (
            <section
              key={course.id}
              className="flex flex-col gap-3 rounded-3xl border border-slate-200/80 bg-white px-4 py-4 dark:border-white/10 dark:bg-white/[0.04] sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {course.avatarUrl ? (
                  <img
                    src={course.avatarUrl}
                    alt=""
                    className="size-11 rounded-full object-cover"
                  />
                ) : (
                  <span className="grid size-11 place-items-center rounded-full bg-sky-100 text-sm font-semibold text-sky-700">
                    {(course.courseCode || course.name).slice(0, 2)}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate font-semibold">{course.courseCode || course.name}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {course.courseCode ? `${course.name} · ` : ''}
                    {course.problemCount} 道已发布的题
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {current?.liveSessionId && current.mine ? (
                  <Button
                    type="button"
                    className="rounded-xl bg-rose-500 text-white hover:bg-rose-600"
                    onClick={() =>
                      router.push(
                        `/teacher/classroom/sessions/${encodeURIComponent(current.liveSessionId!)}`,
                      )
                    }
                  >
                    <Radio className="mr-1.5 size-4 animate-pulse" />
                    正在上课
                  </Button>
                ) : null}
                {current ? (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                    <Users className="size-3.5" />
                    {current.memberCount} 人
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant={current ? 'outline' : 'default'}
                  className="rounded-xl"
                  disabled={Boolean(blocked) || busyCourseId === course.id}
                  title={blocked ? '本学期的班由另一位老师负责' : undefined}
                  onClick={() => void openClass(course.id)}
                >
                  {blocked ? '其他老师的班' : current ? '进入本学期班级' : '开本学期的班'}
                  <ChevronRight className="ml-1 size-4" />
                </Button>
              </div>
              {course.pastClasses.length ? (
                <div className="flex flex-wrap gap-1.5 sm:basis-full">
                  {course.pastClasses.map((past) => (
                    <button
                      key={past.id}
                      type="button"
                      className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300"
                      onClick={() =>
                        router.push(`/teacher/classroom/classes/${encodeURIComponent(past.id)}`)
                      }
                    >
                      往期 · {past.label} · {past.memberCount} 人
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </TeacherAppShell>
  );
}
