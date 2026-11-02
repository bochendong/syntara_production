'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Play, RefreshCw, UserMinus, UserPlus, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TeacherAppShell } from '@/components/teacher/teacher-app-shell';
import {
  STATUS_STYLE,
  StatusLegend,
  classroomFetch,
  formatClock,
  problemLabel,
  usePolledJson,
  type AttemptStatus,
} from './classroom-shared';

type Person = { userId: string; name: string; email: string | null; avatarUrl: string | null };

type ClassPayload = {
  class: {
    id: string;
    name: string;
    joinCode: string;
    label: string;
    course: { id: string; name: string; courseCode: string | null };
  };
  roster: Array<Person & { joinedAt: number; source: string }>;
  visitors: Person[];
  sessions: Array<{
    id: string;
    status: string;
    code: string | null;
    startedAt: number;
    endedAt: number | null;
    participantCount: number;
    itemCount: number;
  }>;
  problems: Array<{
    id: string;
    title: string;
    type: string;
    number: number | null;
    chapter: { id: string; name: string } | null;
  }>;
  progress: Array<{
    userId: string;
    problemId: string;
    status: AttemptStatus;
    score: number | null;
    attemptedCount: number;
  }>;
};

export function TeacherClassClient({ classId }: { classId: string }) {
  const router = useRouter();
  const path = `/api/teacher/classroom/classes/${encodeURIComponent(classId)}`;
  const { data, error, loading, reload } = usePolledJson<ClassPayload>(path, 15_000);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [chapterId, setChapterId] = useState<string>('all');
  const [showVisitors, setShowVisitors] = useState(false);

  const act = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setActionError('');
    try {
      const result = await classroomFetch<{ sessionId?: string }>(path, body);
      if (body.action === 'start-session' && result.sessionId) {
        router.push(`/teacher/classroom/sessions/${encodeURIComponent(result.sessionId)}`);
        return;
      }
      if (body.action === 'add-member') setEmail('');
      await reload();
    } catch (actError) {
      setActionError(actError instanceof Error ? actError.message : '操作失败');
    } finally {
      setBusy('');
    }
  };

  const chapters = useMemo(() => {
    const map = new Map<string, string>();
    for (const problem of data?.problems ?? []) {
      if (problem.chapter) map.set(problem.chapter.id, problem.chapter.name);
    }
    return [...map.entries()];
  }, [data?.problems]);

  const problems = useMemo(
    () =>
      (data?.problems ?? []).filter(
        (problem) => chapterId === 'all' || problem.chapter?.id === chapterId,
      ),
    [chapterId, data?.problems],
  );

  const progressMap = useMemo(() => {
    const map = new Map<string, ClassPayload['progress'][number]>();
    for (const row of data?.progress ?? []) map.set(`${row.userId}:${row.problemId}`, row);
    return map;
  }, [data?.progress]);

  const students = useMemo(
    () => [
      ...(data?.roster ?? []).map((person) => ({ ...person, visitor: false })),
      ...(showVisitors
        ? (data?.visitors ?? []).map((person) => ({ ...person, visitor: true }))
        : []),
    ],
    [data?.roster, data?.visitors, showVisitors],
  );

  const liveSession = data?.sessions.find((session) => session.status === 'live');

  return (
    <TeacherAppShell
      testId="teacher-class"
      title={data?.class.name ?? '班级'}
      eyebrow={data ? `${data.class.label} · 班级` : 'CLASS'}
      description="名单上的学生和进过课堂的人，你可以看到每个人每道题的答题情况。"
      Icon={Users}
      accentClassName="bg-gradient-to-br from-sky-400 via-sky-600 to-indigo-800"
      backHref="/teacher/classroom"
      backLabel="返回班级列表"
    >
      <div className="space-y-5 p-4 sm:p-6">
        {error || actionError ? (
          <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
            {actionError || error}
          </p>
        ) : null}
        {loading && !data ? <p className="text-sm text-slate-400">读取中…</p> : null}

        {data ? (
          <>
            <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
              <section className="flex flex-col justify-between gap-4 rounded-3xl bg-gradient-to-br from-sky-500 to-indigo-700 p-5 text-white">
                <div>
                  <p className="text-xs font-semibold tracking-[0.14em] text-white/70">班级码</p>
                  <div className="mt-1 flex items-center gap-3">
                    <span className="font-mono text-4xl font-bold tracking-[0.28em]">
                      {data.class.joinCode}
                    </span>
                    <button
                      type="button"
                      className="rounded-full bg-white/15 p-2 hover:bg-white/25"
                      title="复制"
                      onClick={() => void navigator.clipboard?.writeText(data.class.joinCode)}
                    >
                      <Copy className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-full bg-white/15 p-2 hover:bg-white/25"
                      title="换一个班级码（旧码失效）"
                      disabled={busy === 'reset'}
                      onClick={() => void act('reset', { action: 'reset-code' })}
                    >
                      <RefreshCw className="size-4" />
                    </button>
                  </div>
                  <p className="mt-2 text-sm text-white/80">
                    学生在网页版、iPad 或电脑 App 里输一次班级码，就进入本学期名单。
                  </p>
                </div>
                <Button
                  type="button"
                  className="w-fit rounded-2xl bg-white text-sky-700 hover:bg-white/90"
                  disabled={busy === 'start'}
                  onClick={() =>
                    liveSession
                      ? router.push(
                          `/teacher/classroom/sessions/${encodeURIComponent(liveSession.id)}`,
                        )
                      : void act('start', { action: 'start-session' })
                  }
                >
                  <Play className="mr-1.5 size-4" />
                  {liveSession ? '回到正在上的课' : '开始上课'}
                </Button>
              </section>

              <section className="rounded-3xl border border-slate-200/80 p-4 dark:border-white/10">
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (email.trim())
                      void act('add', { action: 'add-member', email: email.trim() });
                  }}
                >
                  <Input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="按邮箱把学生拉进班"
                    type="email"
                    className="rounded-xl"
                  />
                  <Button type="submit" className="rounded-xl" disabled={busy === 'add'}>
                    <UserPlus className="mr-1 size-4" />
                    添加
                  </Button>
                </form>
                <p className="mt-4 text-xs font-semibold text-slate-500">
                  上过的课 · {data.sessions.length}
                </p>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {data.sessions.length ? (
                    data.sessions.map((session) => (
                      <li key={session.id}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-white/5"
                          onClick={() =>
                            router.push(
                              `/teacher/classroom/sessions/${encodeURIComponent(session.id)}`,
                            )
                          }
                        >
                          <span>
                            {formatClock(session.startedAt)}
                            {session.status === 'live' ? (
                              <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-600">
                                上课中
                              </span>
                            ) : null}
                          </span>
                          <span className="text-xs text-slate-500">
                            {session.participantCount} 人 · {session.itemCount} 题
                          </span>
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="px-3 py-2 text-sm text-slate-400">还没有上过课。</li>
                  )}
                </ul>
              </section>
            </div>

            <section className="rounded-3xl border border-slate-200/80 dark:border-white/10">
              <header className="flex flex-wrap items-center gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-white/10">
                <h2 className="font-semibold">
                  答题情况
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    名单 {data.roster.length} 人 · {problems.length} 道题
                  </span>
                </h2>
                <select
                  value={chapterId}
                  onChange={(event) => setChapterId(event.target.value)}
                  className="rounded-xl border border-slate-200 bg-transparent px-3 py-1.5 text-sm dark:border-white/10"
                >
                  <option value="all">全部章节</option>
                  {chapters.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
                {data.visitors.length ? (
                  <label className="flex items-center gap-1.5 text-sm text-slate-500">
                    <input
                      type="checkbox"
                      checked={showVisitors}
                      onChange={(event) => setShowVisitors(event.target.checked)}
                    />
                    显示旁听 {data.visitors.length} 人
                  </label>
                ) : null}
                <div className="ml-auto">
                  <StatusLegend />
                </div>
              </header>
              {students.length ? (
                <div className="max-h-[70vh] overflow-auto">
                  <table className="border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr>
                        <th className="sticky left-0 top-0 z-20 min-w-44 bg-white px-4 py-2 text-left font-medium text-slate-500 dark:bg-slate-900">
                          学生
                        </th>
                        {problems.map((problem) => (
                          <th
                            key={problem.id}
                            title={problemLabel(problem)}
                            className="sticky top-0 z-10 bg-white px-1 py-2 text-center text-xs font-medium text-slate-500 dark:bg-slate-900"
                          >
                            <span className="inline-block w-9 truncate">
                              {problem.number ?? '·'}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((student) => {
                        const done = problems.filter((problem) =>
                          progressMap.has(`${student.userId}:${problem.id}`),
                        ).length;
                        return (
                          <tr key={student.userId} className="group">
                            <td className="sticky left-0 z-10 border-t border-slate-100 bg-white px-4 py-1.5 dark:border-white/5 dark:bg-slate-900">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate font-medium">
                                    {student.name}
                                    {student.visitor ? (
                                      <span className="ml-1 text-xs text-slate-400">旁听</span>
                                    ) : null}
                                  </p>
                                  <p className="text-xs text-slate-400">
                                    做过 {done}/{problems.length}
                                  </p>
                                </div>
                                {!student.visitor ? (
                                  <button
                                    type="button"
                                    title="移出名单"
                                    className="rounded-lg p-1 text-slate-300 opacity-0 hover:text-rose-500 group-hover:opacity-100"
                                    onClick={() => {
                                      if (window.confirm(`把 ${student.name} 移出班级？`)) {
                                        void act(`remove:${student.userId}`, {
                                          action: 'remove-member',
                                          userId: student.userId,
                                        });
                                      }
                                    }}
                                  >
                                    <UserMinus className="size-4" />
                                  </button>
                                ) : null}
                              </div>
                            </td>
                            {problems.map((problem) => {
                              const row = progressMap.get(`${student.userId}:${problem.id}`);
                              const style = STATUS_STYLE[row?.status ?? 'none'];
                              return (
                                <td
                                  key={problem.id}
                                  className="border-t border-slate-100 px-1 py-1.5 text-center dark:border-white/5"
                                >
                                  <span
                                    title={`${problemLabel(problem)}\n${style.label}${
                                      row ? ` · 做了 ${row.attemptedCount} 次` : ''
                                    }`}
                                    className={`inline-grid h-7 w-9 place-items-center rounded-lg text-[11px] font-semibold ${style.cell}`}
                                  >
                                    {row ? (row.attemptedCount > 1 ? row.attemptedCount : '') : ''}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 py-10 text-center text-sm text-slate-500">
                  名单还是空的。把班级码发给学生，或者按邮箱添加。
                </p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </TeacherAppShell>
  );
}
