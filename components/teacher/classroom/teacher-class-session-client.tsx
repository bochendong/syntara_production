'use client';

import { useMemo, useState } from 'react';
import {
  Eye,
  Lock,
  LockOpen,
  Plus,
  Presentation,
  RotateCcw,
  Square,
  Trash2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TeacherAppShell } from '@/components/teacher/teacher-app-shell';
import {
  STATUS_STYLE,
  StatusLegend,
  classroomFetch,
  formatDuration,
  problemLabel,
  usePolledJson,
  type AttemptStatus,
} from './classroom-shared';

type SessionPayload = {
  session: {
    id: string;
    status: 'live' | 'ended' | string;
    code: string | null;
    locked: boolean;
    startedAt: number;
    endedAt: number | null;
    class: { id: string; name: string; rosterCount: number };
    course: { id: string; name: string; courseCode: string | null };
  };
  participants: Array<{
    userId: string;
    name: string;
    avatarUrl: string | null;
    via: string;
    joinedAt: number;
  }>;
  items: Array<{
    id: string;
    problemId: string;
    title: string;
    type: string;
    number: number | null;
    pushedAt: number;
    closedAt: number | null;
    answerRevealedAt: number | null;
    submittedCount: number;
    passedCount: number;
    results: Array<{
      userId: string;
      status: AttemptStatus;
      score: number | null;
      submittedAt: number;
      attempts: number;
    }>;
  }>;
};

type ProblemChoice = {
  id: string;
  title: string;
  type: string;
  difficulty: string;
  number: number | null;
  chapter: { id: string; name: string } | null;
};

export function TeacherClassSessionClient({ sessionId }: { sessionId: string }) {
  const path = `/api/teacher/classroom/sessions/${encodeURIComponent(sessionId)}`;
  const { data, setData, error, loading } = usePolledJson<SessionPayload>(path, 3_000);
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [picker, setPicker] = useState<ProblemChoice[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [focusItemId, setFocusItemId] = useState<string | null>(null);

  const live = data?.session.status === 'live';

  const act = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setActionError('');
    try {
      setData(await classroomFetch<SessionPayload>(path, body));
    } catch (actError) {
      setActionError(actError instanceof Error ? actError.message : '操作失败');
    } finally {
      setBusy('');
    }
  };

  const openPicker = async () => {
    setActionError('');
    try {
      const { problems } = await classroomFetch<{ problems: ProblemChoice[] }>(`${path}?choices=1`);
      setSelected([]);
      setQuery('');
      setPicker(problems);
    } catch (pickError) {
      setActionError(pickError instanceof Error ? pickError.message : '读取题目失败');
    }
  };

  const pushedIds = useMemo(
    () => new Set(data?.items.map((item) => item.problemId) ?? []),
    [data?.items],
  );
  const filteredChoices = useMemo(() => {
    const text = query.trim().toLowerCase();
    return (picker ?? []).filter(
      (problem) =>
        !text ||
        problemLabel(problem).toLowerCase().includes(text) ||
        problem.chapter?.name.toLowerCase().includes(text),
    );
  }, [picker, query]);

  const focusItem =
    data?.items.find((item) => item.id === focusItemId) ??
    [...(data?.items ?? [])].reverse().find((item) => !item.closedAt) ??
    data?.items.at(-1) ??
    null;

  const resultByUser = useMemo(
    () => new Map(focusItem?.results.map((row) => [row.userId, row]) ?? []),
    [focusItem],
  );

  return (
    <TeacherAppShell
      testId="teacher-class-session"
      title={data ? `${data.session.course.courseCode || data.session.course.name} · 上课` : '上课'}
      eyebrow={data?.session.class.name ?? 'LIVE CLASS'}
      description="学生在网页版、iPad 或电脑 App 里输课堂码进来。发出的题只统计这节课在场的人。"
      Icon={Presentation}
      accentClassName="bg-gradient-to-br from-rose-400 via-rose-500 to-orange-600"
      backHref={
        data
          ? `/teacher/classroom/classes/${encodeURIComponent(data.session.class.id)}`
          : '/teacher/classroom'
      }
      backLabel="返回班级"
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
            <section className="flex flex-col gap-4 rounded-3xl bg-slate-950 p-5 text-white sm:flex-row sm:items-center">
              <div className="flex-1">
                {live ? (
                  <>
                    <p className="text-xs font-semibold tracking-[0.18em] text-white/50">课堂码</p>
                    <p
                      data-testid="class-session-code"
                      className="font-mono text-6xl font-bold tracking-[0.3em] sm:text-7xl"
                    >
                      {data.session.code}
                    </p>
                    <p className="mt-1 text-sm text-white/60">
                      {data.session.locked
                        ? '已锁门：只有本班名单里的人还能进来'
                        : '本班的人点一下就能进；其他人输这 6 位数字'}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-semibold tracking-[0.18em] text-white/50">已下课</p>
                    <p className="text-2xl font-semibold">
                      上了{' '}
                      {formatDuration(
                        (data.session.endedAt ?? Date.now()) - data.session.startedAt,
                      )}
                    </p>
                  </>
                )}
              </div>
              <div className="flex items-end gap-6">
                <div>
                  <p className="text-5xl font-bold">{data.participants.length}</p>
                  <p className="text-xs text-white/60">
                    人在场 · 名单 {data.session.class.rosterCount} 人
                  </p>
                </div>
                {live ? (
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20"
                      disabled={busy === 'lock'}
                      onClick={() =>
                        void act('lock', { action: 'lock', locked: !data.session.locked })
                      }
                    >
                      {data.session.locked ? (
                        <LockOpen className="mr-1.5 size-4" />
                      ) : (
                        <Lock className="mr-1.5 size-4" />
                      )}
                      {data.session.locked ? '开门' : '锁门'}
                    </Button>
                    <Button
                      type="button"
                      className="rounded-xl bg-rose-500 hover:bg-rose-600"
                      disabled={busy === 'end'}
                      onClick={() => {
                        if (window.confirm('下课？课堂码会失效，没收的题会自动收卷。')) {
                          void act('end', { action: 'end' });
                        }
                      }}
                    >
                      <Square className="mr-1.5 size-4" />
                      下课
                    </Button>
                  </div>
                ) : null}
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">发出的题</h2>
                  {live ? (
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => void openPicker()}
                    >
                      <Plus className="mr-1 size-4" />
                      发题
                    </Button>
                  ) : null}
                </div>
                {data.items.length ? (
                  data.items.map((item) => {
                    const active = focusItem?.id === item.id;
                    const total = data.participants.length || 1;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setFocusItemId(item.id)}
                        className={`w-full rounded-2xl border px-3 py-2.5 text-left transition ${
                          active
                            ? 'border-sky-400 bg-sky-50 dark:bg-sky-500/10'
                            : 'border-slate-200/80 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium">{problemLabel(item)}</p>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                              item.closedAt
                                ? 'bg-slate-100 text-slate-500 dark:bg-white/10'
                                : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {item.closedAt ? '已收卷' : '作答中'}
                          </span>
                        </div>
                        <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                          <span
                            className="bg-emerald-500"
                            style={{ width: `${(item.passedCount / total) * 100}%` }}
                          />
                          <span
                            className="bg-amber-400"
                            style={{
                              width: `${((item.submittedCount - item.passedCount) / total) * 100}%`,
                            }}
                          />
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          交了 {item.submittedCount}/{data.participants.length} · 正确{' '}
                          {item.passedCount}
                        </p>
                      </button>
                    );
                  })
                ) : (
                  <p className="rounded-2xl border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-400 dark:border-white/10">
                    {live ? '点「发题」从题库里挑题发给在场的人。' : '这节课没有发题。'}
                  </p>
                )}
              </section>

              <section className="rounded-3xl border border-slate-200/80 p-4 dark:border-white/10">
                {focusItem ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="mr-auto font-semibold">{problemLabel(focusItem)}</h2>
                      {live ? (
                        focusItem.closedAt ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-xl"
                            onClick={() =>
                              void act('reopen', { action: 'reopen', itemId: focusItem.id })
                            }
                          >
                            <RotateCcw className="mr-1 size-4" />
                            继续作答
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-xl"
                            onClick={() =>
                              void act('close', { action: 'close', itemId: focusItem.id })
                            }
                          >
                            <Square className="mr-1 size-4" />
                            收卷
                          </Button>
                        )
                      ) : null}
                      {!focusItem.answerRevealedAt ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="rounded-xl"
                          onClick={() =>
                            void act('reveal', { action: 'reveal', itemId: focusItem.id })
                          }
                        >
                          <Eye className="mr-1 size-4" />
                          公布答案
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-500">已公布答案</span>
                      )}
                      {live && focusItem.submittedCount === 0 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="rounded-xl text-slate-400 hover:text-rose-500"
                          title="撤回这道题"
                          onClick={() =>
                            void act('remove', { action: 'remove', itemId: focusItem.id })
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      {[
                        ['已交', `${focusItem.submittedCount}/${data.participants.length}`],
                        [
                          '正确率',
                          focusItem.submittedCount
                            ? `${Math.round((focusItem.passedCount / focusItem.submittedCount) * 100)}%`
                            : '—',
                        ],
                        [
                          '未交',
                          `${Math.max(0, data.participants.length - focusItem.submittedCount)}`,
                        ],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-2xl bg-slate-50 py-3 dark:bg-white/5">
                          <p className="text-2xl font-bold">{value}</p>
                          <p className="text-xs text-slate-500">{label}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <p className="text-sm font-medium">每个人</p>
                      <StatusLegend />
                    </div>
                    <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
                      {data.participants.map((participant) => {
                        const row = resultByUser.get(participant.userId);
                        const style = STATUS_STYLE[row?.status ?? 'none'];
                        return (
                          <div
                            key={participant.userId}
                            className={`rounded-xl px-3 py-2 ${style.cell}`}
                            title={row ? `提交 ${row.attempts} 次` : '还没交'}
                          >
                            <p className="truncate text-sm font-medium">{participant.name}</p>
                            <p className="text-[11px] opacity-80">
                              {style.label}
                              {row && row.attempts > 1 ? ` · ${row.attempts} 次` : ''}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="py-6">
                    <p className="text-sm font-medium">在场的人</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {data.participants.length ? (
                        data.participants.map((participant) => (
                          <span
                            key={participant.userId}
                            className="rounded-full bg-slate-100 px-3 py-1 text-sm dark:bg-white/10"
                          >
                            {participant.name}
                            {participant.via === 'code' ? (
                              <span className="ml-1 text-xs text-slate-400">旁听</span>
                            ) : null}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-slate-400">还没有人进来。</span>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>

      {picker ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm"
          onClick={() => setPicker(null)}
        >
          <div
            role="dialog"
            aria-label="发题"
            className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-white/10">
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜题号、题目或章节"
                className="rounded-xl"
              />
              <button
                type="button"
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100"
                onClick={() => setPicker(null)}
              >
                <X className="size-4" />
              </button>
            </header>
            <ul className="flex-1 overflow-y-auto p-2">
              {filteredChoices.map((problem) => {
                const checked = selected.includes(problem.id);
                return (
                  <li key={problem.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-slate-50 dark:hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelected((current) =>
                            checked
                              ? current.filter((id) => id !== problem.id)
                              : [...current, problem.id],
                          )
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{problemLabel(problem)}</span>
                        <span className="text-xs text-slate-400">
                          {problem.chapter?.name ?? '未分章节'}
                          {pushedIds.has(problem.id) ? ' · 这节课发过（再发会重新计时）' : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
              {!filteredChoices.length ? (
                <li className="px-3 py-8 text-center text-sm text-slate-400">没有找到题目。</li>
              ) : null}
            </ul>
            <footer className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-white/10">
              <span className="text-sm text-slate-500">选了 {selected.length} 道</span>
              <Button
                type="button"
                className="rounded-xl"
                disabled={!selected.length || busy === 'push'}
                onClick={async () => {
                  await act('push', { action: 'push', problemIds: selected });
                  setPicker(null);
                  setFocusItemId(null);
                }}
              >
                发给在场的人
              </Button>
            </footer>
          </div>
        </div>
      ) : null}
    </TeacherAppShell>
  );
}
