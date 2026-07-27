'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  CircleAlert,
  Clock3,
  Compass,
  MinusCircle,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  NEW_USER_JOURNEY_CHECKS,
  NEW_USER_JOURNEY_STAGES,
  NEW_USER_JOURNEY_STORAGE_KEY,
  type NewUserJourneyCheck,
  type NewUserJourneyStage,
  type NewUserJourneyVerdict,
} from './new-user-journey';

type JourneyRun = {
  version: 1;
  startedAt: string;
  updatedAt: string;
  verdicts: Record<string, NewUserJourneyVerdict>;
  notes: Record<string, string>;
};

type VerdictMeta = {
  label: string;
  shortLabel: string;
  Icon: LucideIcon;
  cardClassName: string;
  badgeClassName: string;
};

const EMPTY_RUN: JourneyRun = {
  version: 1,
  startedAt: '',
  updatedAt: '',
  verdicts: {},
  notes: {},
};

const VERDICT_ORDER: NewUserJourneyVerdict[] = [
  'untested',
  'pass',
  'friction',
  'fail',
  'blocked',
  'not-applicable',
];

const VERDICT_META: Record<NewUserJourneyVerdict, VerdictMeta> = {
  untested: {
    label: '未测试',
    shortLabel: '未测',
    Icon: Circle,
    cardClassName: 'border-slate-200 bg-white',
    badgeClassName: 'border-slate-200 bg-slate-50 text-slate-600',
  },
  pass: {
    label: '顺畅通过',
    shortLabel: '顺畅',
    Icon: CheckCircle2,
    cardClassName: 'border-emerald-200 bg-emerald-50/30',
    badgeClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  friction: {
    label: '可完成但有摩擦',
    shortLabel: '有摩擦',
    Icon: TriangleAlert,
    cardClassName: 'border-amber-200 bg-amber-50/30',
    badgeClassName: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  fail: {
    label: '功能失败',
    shortLabel: '失败',
    Icon: XCircle,
    cardClassName: 'border-rose-200 bg-rose-50/30',
    badgeClassName: 'border-rose-200 bg-rose-50 text-rose-700',
  },
  blocked: {
    label: '环境或前置条件受阻',
    shortLabel: '受阻',
    Icon: ShieldAlert,
    cardClassName: 'border-violet-200 bg-violet-50/30',
    badgeClassName: 'border-violet-200 bg-violet-50 text-violet-700',
  },
  'not-applicable': {
    label: '本轮不适用',
    shortLabel: '不适用',
    Icon: MinusCircle,
    cardClassName: 'border-slate-200 bg-slate-50/60',
    badgeClassName: 'border-slate-200 bg-white text-slate-500',
  },
};

function createRun(): JourneyRun {
  const now = new Date().toISOString();
  return {
    version: 1,
    startedAt: now,
    updatedAt: now,
    verdicts: {},
    notes: {},
  };
}

function readStoredRun(): JourneyRun {
  try {
    const value = window.localStorage.getItem(NEW_USER_JOURNEY_STORAGE_KEY);
    if (!value) return createRun();
    const parsed = JSON.parse(value) as Partial<JourneyRun>;
    if (parsed.version !== 1) return createRun();

    return {
      version: 1,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      verdicts: parsed.verdicts && typeof parsed.verdicts === 'object' ? parsed.verdicts : {},
      notes: parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : {},
    };
  } catch {
    return createRun();
  }
}

function formatRunTime(value: string): string {
  if (!value) return '准备中';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

function resolveVerdict(run: JourneyRun, checkId: string): NewUserJourneyVerdict {
  return run.verdicts[checkId] ?? 'untested';
}

function countStageProgress(stage: NewUserJourneyStage, run: JourneyRun) {
  const assessed = stage.checks.filter(
    (check) => resolveVerdict(run, check.id) !== 'untested',
  ).length;
  return { assessed, total: stage.checks.length };
}

function ReleaseDecision({
  p0Failures,
  failures,
  frictions,
  untested,
}: {
  p0Failures: number;
  failures: number;
  frictions: number;
  untested: number;
}) {
  const decision =
    p0Failures > 0
      ? {
          title: '阻断发布',
          detail: `${p0Failures} 个 P0 操作失败或受阻，核心新用户旅程尚不成立。`,
          className: 'border-rose-300 bg-rose-50 text-rose-950',
          Icon: XCircle,
        }
      : failures > 0
        ? {
            title: '修复后复测',
            detail: `${failures} 个操作失败或受阻，需要先修复再给出发布结论。`,
            className: 'border-violet-300 bg-violet-50 text-violet-950',
            Icon: ShieldAlert,
          }
        : untested > 0
          ? {
              title: '测试进行中',
              detail: `还有 ${untested} 个操作没有定性，当前不能给出完整发布结论。`,
              className: 'border-sky-300 bg-sky-50 text-sky-950',
              Icon: Clock3,
            }
          : frictions > 0
            ? {
                title: '可用，但有摩擦',
                detail: `${frictions} 个操作可以完成但体验不顺，应进入发布前体验修整。`,
                className: 'border-amber-300 bg-amber-50 text-amber-950',
                Icon: TriangleAlert,
              }
            : {
                title: '新用户旅程通过',
                detail: '所有适用操作都顺畅完成，没有发现阻断或体验摩擦。',
                className: 'border-emerald-300 bg-emerald-50 text-emerald-950',
                Icon: CheckCircle2,
              };
  const DecisionIcon = decision.Icon;

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-2xl border px-4 py-4 sm:px-5',
        decision.className,
      )}
      data-testid="journey-release-decision"
    >
      <DecisionIcon className="mt-0.5 size-5 shrink-0" />
      <div>
        <div className="font-semibold">{decision.title}</div>
        <p className="mt-1 text-sm leading-6 opacity-80">{decision.detail}</p>
      </div>
    </div>
  );
}

function JourneyCheckCard({
  check,
  index,
  run,
  onVerdictChange,
  onNoteChange,
}: {
  check: NewUserJourneyCheck;
  index: number;
  run: JourneyRun;
  onVerdictChange: (checkId: string, verdict: NewUserJourneyVerdict) => void;
  onNoteChange: (checkId: string, note: string) => void;
}) {
  const verdict = resolveVerdict(run, check.id);
  const meta = VERDICT_META[verdict];
  const VerdictIcon = meta.Icon;

  return (
    <article
      id={`journey-check-${check.id}`}
      data-testid={`journey-check-${check.id}`}
      className={cn(
        'scroll-mt-28 overflow-hidden rounded-2xl border shadow-sm transition-colors',
        meta.cardClassName,
      )}
    >
      <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-slate-950 font-mono text-[11px] font-semibold text-white">
              {String(index + 1).padStart(2, '0')}
            </span>
            <Badge
              variant="outline"
              className={cn(
                'rounded-md',
                check.priority === 'P0'
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : check.priority === 'P1'
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-slate-200 bg-slate-50 text-slate-600',
              )}
            >
              {check.priority}
            </Badge>
            <Badge variant="outline" className={cn('rounded-md', meta.badgeClassName)}>
              <VerdictIcon className="size-3.5" />
              {meta.shortLabel}
            </Badge>
          </div>

          <h3 className="mt-3 text-lg font-semibold tracking-tight text-slate-950">
            {check.title}
          </h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                怎么测
              </div>
              <p className="mt-1.5 text-sm leading-6 text-slate-700">{check.action}</p>
            </div>
            <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-600">
                顺畅的信号
              </div>
              <p className="mt-1.5 text-sm leading-6 text-emerald-950">{check.expected}</p>
            </div>
          </div>

          {check.boundary ? (
            <div className="mt-3 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-6 text-amber-900">
              <ShieldAlert className="mt-1 size-4 shrink-0 text-amber-600" />
              <span>{check.boundary}</span>
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white/90 p-4">
          <label className="text-xs font-semibold text-slate-600" htmlFor={`verdict-${check.id}`}>
            定性判定
          </label>
          <select
            id={`verdict-${check.id}`}
            data-testid={`journey-verdict-${check.id}`}
            value={verdict}
            onChange={(event) =>
              onVerdictChange(check.id, event.target.value as NewUserJourneyVerdict)
            }
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none ring-sky-500 focus:ring-2"
          >
            {VERDICT_ORDER.map((value) => (
              <option key={value} value={value}>
                {VERDICT_META[value].label}
              </option>
            ))}
          </select>

          <label className="text-xs font-semibold text-slate-600" htmlFor={`note-${check.id}`}>
            观察与证据
          </label>
          <textarea
            id={`note-${check.id}`}
            value={run.notes[check.id] ?? ''}
            onChange={(event) => onNoteChange(check.id, event.target.value)}
            placeholder="记录看到的文案、URL、错误、等待时间或截图编号…"
            rows={4}
            className="min-h-24 resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm leading-6 text-slate-700 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-sky-500"
          />

          <Button asChild variant="outline" className="mt-auto w-full rounded-lg">
            <Link href={check.href} target="_blank" rel="noopener noreferrer">
              {check.entryLabel}
              <ArrowUpRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

export function NewUserJourneyWorkspace() {
  const [run, setRun] = useState<JourneyRun>(EMPTY_RUN);
  const [hydrated, setHydrated] = useState(false);
  const [activeStageId, setActiveStageId] = useState<string>('arrival');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRun(readStoredRun());
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(NEW_USER_JOURNEY_STORAGE_KEY, JSON.stringify(run));
  }, [hydrated, run]);

  const counts = useMemo(() => {
    const result: Record<NewUserJourneyVerdict, number> = {
      untested: 0,
      pass: 0,
      friction: 0,
      fail: 0,
      blocked: 0,
      'not-applicable': 0,
    };
    for (const check of NEW_USER_JOURNEY_CHECKS) {
      result[resolveVerdict(run, check.id)] += 1;
    }
    return result;
  }, [run]);

  const assessed = NEW_USER_JOURNEY_CHECKS.length - counts.untested;
  const completion = Math.round((assessed / NEW_USER_JOURNEY_CHECKS.length) * 100);
  const failures = counts.fail + counts.blocked;
  const p0Failures = NEW_USER_JOURNEY_CHECKS.filter(
    (check) =>
      check.priority === 'P0' && ['fail', 'blocked'].includes(resolveVerdict(run, check.id)),
  ).length;

  const visibleStages =
    activeStageId === 'all'
      ? NEW_USER_JOURNEY_STAGES
      : NEW_USER_JOURNEY_STAGES.filter((stage) => stage.id === activeStageId);

  const updateVerdict = useCallback((checkId: string, verdict: NewUserJourneyVerdict) => {
    setRun((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      verdicts: { ...current.verdicts, [checkId]: verdict },
    }));
  }, []);

  const updateNote = useCallback((checkId: string, note: string) => {
    setRun((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      notes: { ...current.notes, [checkId]: note },
    }));
  }, []);

  const jumpToNextUntested = useCallback(() => {
    const nextCheck = NEW_USER_JOURNEY_CHECKS.find(
      (check) => resolveVerdict(run, check.id) === 'untested',
    );
    if (!nextCheck) {
      document.getElementById('journey-summary')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const nextStage = NEW_USER_JOURNEY_STAGES.find((stage) =>
      stage.checks.some((check) => check.id === nextCheck.id),
    );
    if (nextStage) setActiveStageId(nextStage.id);
    window.setTimeout(() => {
      document
        .getElementById(`journey-check-${nextCheck.id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }, [run]);

  const resetRun = useCallback(() => {
    if (!window.confirm('清空这次新用户旅程的全部判定和备注，重新开始？')) return;
    setRun(createRun());
    setActiveStageId('arrival');
  }, []);

  return (
    <main
      className="min-h-screen bg-[#f4f6fa] text-slate-950"
      data-testid="new-user-journey-workspace"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
        <div>
          <Button asChild variant="ghost" className="-ml-3 rounded-lg text-slate-600">
            <Link href="/test#release-regression-title">
              <ArrowLeft className="size-4" />
              返回测试中心
            </Link>
          </Button>
        </div>

        <header className="overflow-hidden rounded-[28px] bg-slate-950 text-white shadow-xl shadow-slate-950/10">
          <div className="grid gap-8 px-6 py-7 sm:px-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-10 lg:py-10">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-0 bg-amber-300 text-amber-950 hover:bg-amber-300">
                  第四阶段 · 发布回归
                </Badge>
                <Badge variant="outline" className="border-white/20 bg-white/5 text-slate-200">
                  <Compass className="size-3.5" />
                  新用户全旅程
                </Badge>
                <Badge variant="outline" className="border-white/20 bg-white/5 text-slate-200">
                  定性验收
                </Badge>
              </div>

              <h1 className="mt-5 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
                一个新用户，能不能从第一次打开平台一直走到真正学完一轮？
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300">
                这不是按钮清点。按真实用户意图检查 {NEW_USER_JOURNEY_CHECKS.length}{' '}
                个可见操作，并把每一步定性为顺畅、有摩擦、失败、受阻或不适用。
              </p>

              <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3">
                  <div className="text-xs font-semibold text-slate-400">测试人物</div>
                  <div className="mt-1 font-medium text-white">首次到访 · 零课程 · 零记忆</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3">
                  <div className="text-xs font-semibold text-slate-400">设备与语言</div>
                  <div className="mt-1 font-medium text-white">桌面浏览器 · 简体中文</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3">
                  <div className="text-xs font-semibold text-slate-400">数据边界</div>
                  <div className="mt-1 font-medium text-white">虚构账号 · 不做真实支付</div>
                </div>
              </div>
            </div>

            <div
              className="flex flex-col rounded-3xl border border-white/10 bg-white/[0.07] p-5"
              data-testid="journey-progress"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
                    本次进度
                  </div>
                  <div className="mt-1 font-mono text-4xl font-semibold">{completion}%</div>
                </div>
                <div className="grid size-14 place-items-center rounded-2xl bg-white/10">
                  <Sparkles className="size-6 text-amber-300" />
                </div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-amber-300 transition-[width] duration-300"
                  style={{ width: `${completion}%` }}
                />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-black/20 px-3 py-2.5">
                  <div className="text-xs text-slate-400">已定性</div>
                  <div className="mt-1 font-mono font-semibold">
                    {assessed}/{NEW_USER_JOURNEY_CHECKS.length}
                  </div>
                </div>
                <div className="rounded-xl bg-black/20 px-3 py-2.5">
                  <div className="text-xs text-slate-400">顺畅</div>
                  <div className="mt-1 font-mono font-semibold text-emerald-300">{counts.pass}</div>
                </div>
                <div className="rounded-xl bg-black/20 px-3 py-2.5">
                  <div className="text-xs text-slate-400">有摩擦</div>
                  <div className="mt-1 font-mono font-semibold text-amber-300">
                    {counts.friction}
                  </div>
                </div>
                <div className="rounded-xl bg-black/20 px-3 py-2.5">
                  <div className="text-xs text-slate-400">失败/受阻</div>
                  <div className="mt-1 font-mono font-semibold text-rose-300">{failures}</div>
                </div>
              </div>
              <Button
                type="button"
                onClick={jumpToNextUntested}
                className="mt-4 rounded-xl bg-white text-slate-950 hover:bg-slate-100"
              >
                {counts.untested > 0 ? '继续下一项' : '查看最终判定'}
                <ArrowRight className="size-4" />
              </Button>
              <div className="mt-3 text-center text-xs text-slate-400">
                开始 {formatRunTime(run.startedAt)} · 更新 {formatRunTime(run.updatedAt)}
              </div>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-950">选择旅程阶段</div>
              <p className="mt-1 text-sm text-slate-500">
                进度自动保存在当前浏览器；测试入口会在新标签页打开。
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={resetRun}
              className="self-start rounded-lg text-slate-600"
              disabled={!hydrated}
            >
              <RotateCcw className="size-4" />
              重新开始
            </Button>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setActiveStageId('all')}
              className={cn(
                'shrink-0 rounded-xl border px-3.5 py-2 text-left text-sm transition',
                activeStageId === 'all'
                  ? 'border-slate-950 bg-slate-950 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
              )}
            >
              <span className="block font-semibold">全部</span>
              <span className="mt-0.5 block text-[11px] opacity-70">
                {NEW_USER_JOURNEY_CHECKS.length} 项
              </span>
            </button>
            {NEW_USER_JOURNEY_STAGES.map((stage) => {
              const stageProgress = countStageProgress(stage, run);
              const active = activeStageId === stage.id;
              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => setActiveStageId(stage.id)}
                  className={cn(
                    'min-w-32 shrink-0 rounded-xl border px-3.5 py-2 text-left text-sm transition',
                    active
                      ? 'border-sky-600 bg-sky-50 text-sky-950 ring-1 ring-sky-600'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                >
                  <span className="block font-semibold">
                    {String(stage.order).padStart(2, '0')} · {stage.eyebrow}
                  </span>
                  <span className="mt-0.5 block text-[11px] opacity-70">
                    {stageProgress.assessed}/{stageProgress.total} 已定性
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {visibleStages.map((stage) => {
          const stageOffset = NEW_USER_JOURNEY_STAGES.slice(0, stage.order - 1).reduce(
            (sum, item) => sum + item.checks.length,
            0,
          );
          const stageProgress = countStageProgress(stage, run);
          return (
            <section key={stage.id} className="scroll-mt-24" aria-labelledby={`${stage.id}-title`}>
              <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm sm:px-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="max-w-3xl">
                    <div className="text-sm font-semibold text-sky-700">
                      阶段 {String(stage.order).padStart(2, '0')} · {stage.eyebrow}
                    </div>
                    <h2
                      id={`${stage.id}-title`}
                      className="mt-1 text-2xl font-semibold tracking-tight text-slate-950"
                    >
                      {stage.title}
                    </h2>
                    <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
                      {stage.acceptanceQuestion}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-500">{stage.description}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-lg border-sky-200 bg-sky-50 px-3 py-1.5 text-sky-700"
                  >
                    {stageProgress.assessed}/{stageProgress.total} 已定性
                  </Badge>
                </div>
              </div>

              <div className="grid gap-4">
                {stage.checks.map((check, index) => (
                  <JourneyCheckCard
                    key={check.id}
                    check={check}
                    index={stageOffset + index}
                    run={run}
                    onVerdictChange={updateVerdict}
                    onNoteChange={updateNote}
                  />
                ))}
              </div>
            </section>
          );
        })}

        <section id="journey-summary" className="scroll-mt-24 pb-8">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-slate-500" />
              <div>
                <div className="font-semibold text-slate-950">最终判定只看真实旅程证据</div>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  P0
                  失败或受阻直接阻断发布；“有摩擦”代表能完成但用户需要猜、等待或绕路；环境缺失请标记“受阻”，不要把未运行伪装成通过。
                </p>
              </div>
            </div>
            <div className="mt-4">
              <ReleaseDecision
                p0Failures={p0Failures}
                failures={failures}
                frictions={counts.friction}
                untested={counts.untested}
              />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
