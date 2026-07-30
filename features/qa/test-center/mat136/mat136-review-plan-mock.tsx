'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpenCheck,
  Brain,
  CalendarCheck2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  ExternalLink,
  FileQuestion,
  History,
  RotateCcw,
  Sparkles,
  Target,
  Undo2,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type ProblemStatus = 'idle' | 'correct' | 'incorrect';

type MockProblem = {
  id: string;
  title: string;
  eyebrow: string;
  stem: string;
  reason: string;
  options: Array<{ id: string; label: string }>;
  answer: string;
  explanation: string;
};

type ReviewDay = {
  id: string;
  date: string;
  weekday: string;
  duration: number;
  title: string;
  summary: string;
  reasons: string[];
  problemIds: string[];
};

const MOCK_PROBLEMS: MockProblem[] = [
  {
    id: 'riemann-left-sum',
    eyebrow: '题库原题 · 基础计算',
    title: '黎曼和左端点近似',
    stem: '把 [0,2] 平分成 4 个小区间，用左端点黎曼和近似 ∫₀²(x²+1)dx。计算该黎曼和。',
    reason: '你上次把最后一个右端点 x=2 放进了左端点和；这题专门检查采样点列表。',
    options: [
      { id: 'a', label: '15/4' },
      { id: 'b', label: '23/4' },
      { id: 'c', label: '4' },
      { id: 'd', label: '17/4' },
    ],
    answer: 'a',
    explanation: 'Δx=1/2，左端点是 0、1/2、1、3/2，所以和为 1/2[1+5/4+2+13/4]=15/4。',
  },
  {
    id: 'riemann-integrability',
    eyebrow: '题库原题 · 概念辨析',
    title: '黎曼可积性的采样点判断',
    stem: '为什么黎曼可积要求 mesh→0 时所有合法采样都趋向同一个极限，而不能只看某一次矩形和？',
    reason: '记忆里显示你会计算矩形和，但还容易把“一次近似”当成“可积性定义”。',
    options: [
      { id: 'a', label: '因为每次都必须使用左端点' },
      { id: 'b', label: '因为极限要摆脱分割与采样的偶然性' },
      { id: 'c', label: '因为矩形数量越少越准确' },
    ],
    answer: 'b',
    explanation:
      '某一次矩形和只是一个近似。只有分割变细后，不同合法采样都逼近同一个数，极限才不依赖偶然选择。',
  },
  {
    id: 'riemann-sum-to-integral',
    eyebrow: '题库同类题 · 表达转换',
    title: '从黎曼和识别定积分',
    stem: 'limₙ→∞ Σᵢ₌₁ⁿ (2/n)(1+2i/n)² 对应下面哪个定积分？',
    reason: '这道题连接“Δx、采样点、函数值”三部分，检查你能否从和式反推区间和被积函数。',
    options: [
      { id: 'a', label: '∫₀²(1+x)²dx' },
      { id: 'b', label: '∫₁³x²dx' },
      { id: 'c', label: '∫₀¹(1+2x)²dx' },
    ],
    answer: 'b',
    explanation: 'Δx=2/n，右端点 xᵢ=1+2i/n，区间长度为 2、起点为 1，因此对应 ∫₁³x²dx。',
  },
];

const REVIEW_DAYS: ReviewDay[] = [
  {
    id: '2026-07-29',
    date: '7月29日',
    weekday: '周三',
    duration: 40,
    title: '复习黎曼和的采样点与左右端点',
    summary: '先用 15 分钟重建“分割—采样—求和”链条，再完成两道针对题。',
    reasons: [
      '7月25日的作答中，你把左端点列表写成 0.5、1、1.5、2，漏掉 0。',
      '学习记忆将“左右端点采样混淆”标记为当前薄弱点。',
    ],
    problemIds: ['riemann-left-sum', 'riemann-integrability'],
  },
  {
    id: '2026-07-30',
    date: '7月30日',
    weekday: '周四',
    duration: 45,
    title: '复习黎曼和与定积分的转换',
    summary: '从 Δx 和采样点反推区间，再把有限和的结构翻译成定积分。',
    reasons: [
      '第一次复习先修正采样点，第二天再连接到定积分，避免一次塞入两个缺口。',
      'MAT136 课程资料把“从黎曼和到定积分”列为下一节必备连接。',
    ],
    problemIds: ['riemann-sum-to-integral'],
  },
  {
    id: '2026-07-31',
    date: '7月31日',
    weekday: '周五',
    duration: 25,
    title: '考前轻量回顾与错题复述',
    summary: '不再加新题；口头复述左/右端点规则，并重做仍显示错误的题。',
    reasons: [
      '日历显示 7月31日 14:00 有 MAT136 阶段测验，上午只安排低负荷回顾。',
      '前两天若有错题，优先复盘错误原因，不用随机新题打乱节奏。',
    ],
    problemIds: [],
  },
];

function statusMeta(status: ProblemStatus) {
  if (status === 'correct') {
    return {
      label: '已完成',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      icon: CheckCircle2,
    };
  }
  if (status === 'incorrect') {
    return {
      label: '需重做',
      className: 'border-rose-200 bg-rose-50 text-rose-700',
      icon: XCircle,
    };
  }
  return {
    label: '未开始',
    className: 'border-slate-200 bg-slate-50 text-slate-500',
    icon: Circle,
  };
}

function EvidencePill({
  icon: Icon,
  children,
}: {
  icon: typeof CalendarDays;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm">
      <Icon className="size-3.5 text-slate-400" />
      {children}
    </span>
  );
}

export function Mat136ReviewPlanMock() {
  const [calendarDays, setCalendarDays] = useState<Set<string>>(new Set());
  const [activeProblemId, setActiveProblemId] = useState<string | null>(null);
  const [activeEvidence, setActiveEvidence] = useState(false);
  const [problemAnswers, setProblemAnswers] = useState<Record<string, string>>({});
  const [problemStatuses, setProblemStatuses] = useState<Record<string, ProblemStatus>>({});

  const activeProblem = useMemo(
    () => MOCK_PROBLEMS.find((problem) => problem.id === activeProblemId) ?? null,
    [activeProblemId],
  );
  const completedCount = Object.values(problemStatuses).filter(
    (status) => status === 'correct',
  ).length;

  const toggleCalendarDay = (dayId: string) => {
    setCalendarDays((current) => {
      const next = new Set(current);
      if (next.has(dayId)) next.delete(dayId);
      else next.add(dayId);
      return next;
    });
  };

  const submitProblem = () => {
    if (!activeProblem) return;
    const answer = problemAnswers[activeProblem.id];
    if (!answer) return;
    setProblemStatuses((current) => ({
      ...current,
      [activeProblem.id]: answer === activeProblem.answer ? 'correct' : 'incorrect',
    }));
  };

  return (
    <main className="min-h-screen bg-[#f6f8fa] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/88 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1480px] items-center gap-3 px-4 sm:px-6">
          <Button asChild variant="ghost" size="sm" className="rounded-full">
            <Link href="/test">
              <ArrowLeft className="size-4" />
              测试中心
            </Link>
          </Button>
          <div className="h-5 w-px bg-slate-200" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">MAT136 · Calculus II</p>
            <p className="text-[11px] text-slate-500">证据化复习计划 Mock 对话</p>
          </div>
          <Badge
            variant="outline"
            className="ml-auto hidden rounded-full border-violet-200 bg-violet-50 text-violet-700 sm:inline-flex"
          >
            UI Prototype
          </Badge>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1480px] gap-0 lg:grid-cols-[240px_minmax(0,1fr)_300px]">
        <aside className="hidden min-h-[calc(100vh-64px)] border-r border-slate-200/80 bg-white/70 p-4 lg:block">
          <div className="rounded-[18px] border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-[13px] bg-sky-50 text-sky-700 ring-1 ring-sky-100">
                <BookOpenCheck className="size-5" />
              </div>
              <div>
                <p className="text-sm font-semibold">MAT136</p>
                <p className="text-xs text-slate-500">黎曼积分</p>
              </div>
            </div>
          </div>
          <nav className="mt-5 space-y-1 text-sm">
            <div className="flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2.5 font-medium text-white">
              <Sparkles className="size-4" />
              AI 学习对话
            </div>
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-slate-500">
              <BookOpenCheck className="size-4" />
              课程资料
            </div>
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-slate-500">
              <FileQuestion className="size-4" />
              题库
            </div>
          </nav>
        </aside>

        <section className="min-w-0 px-4 py-7 sm:px-7 lg:px-9">
          <div className="mx-auto max-w-3xl space-y-6">
            <div className="ml-auto max-w-[84%] rounded-[22px] bg-slate-950 px-4 py-3 text-sm leading-6 text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)]">
              我 7 月 31 日有 MAT136 阶段测验。帮我制定一个三天复习计划，每天不超过 45
              分钟，重点补黎曼积分。
            </div>

            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-violet-50 text-violet-700 ring-1 ring-violet-100">
                <Sparkles className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-6 text-slate-700">
                  可以。我先核对了你的考试日程、最近作答和学习记忆，再把复习拆成 “修正采样点 →
                  连接定积分 → 考前复述”。这样排不是平均分配知识点，而是先处理已经出现过的错误。
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <EvidencePill icon={CalendarDays}>7月31日 14:00 阶段测验</EvidencePill>
                  <EvidencePill icon={History}>7月25日黎曼和题答错</EvidencePill>
                  <EvidencePill icon={Brain}>薄弱点：左右端点采样</EvidencePill>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveEvidence(true)}
                  className="mt-4 flex w-full items-center gap-3 rounded-[16px] border border-rose-100 bg-rose-50/75 px-3.5 py-3 text-left shadow-sm transition hover:border-rose-200 hover:bg-rose-50"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-white text-rose-600 shadow-sm ring-1 ring-rose-100">
                    <History className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-rose-950">
                      为什么先复习黎曼和？
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-rose-800/75">
                      我在记忆中看到你上次把左端点题做成了右端点和
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-rose-400" />
                </button>

                <div className="mt-5 overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.07)]">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-3.5">
                    <div>
                      <p className="text-sm font-semibold">三天复习计划</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        共 110 分钟 · 3 道针对题 · 已完成 {completedCount}/3
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                      <Target className="size-4 text-emerald-600" />
                      目标：测验前修正核心误区
                    </div>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {REVIEW_DAYS.map((day, dayIndex) => {
                      const added = calendarDays.has(day.id);
                      return (
                        <article key={day.id} className="relative px-4 py-5 sm:px-5">
                          <div className="flex items-start gap-3">
                            <div className="relative flex shrink-0 flex-col items-center">
                              <span className="grid size-9 place-items-center rounded-full bg-slate-950 text-xs font-semibold text-white">
                                {dayIndex + 1}
                              </span>
                              {dayIndex < REVIEW_DAYS.length - 1 ? (
                                <span className="absolute top-10 h-[calc(100%+130px)] w-px bg-slate-200" />
                              ) : null}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-semibold">
                                      {day.date} · {day.weekday}
                                    </p>
                                    <Badge
                                      variant="outline"
                                      className="rounded-full border-slate-200 bg-slate-50 text-[10px] text-slate-500"
                                    >
                                      <Clock3 className="size-3" />
                                      {day.duration} 分钟
                                    </Badge>
                                  </div>
                                  <h3 className="mt-1.5 text-[15px] font-semibold text-slate-950">
                                    {day.title}
                                  </h3>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={added ? 'outline' : 'default'}
                                  onClick={() => toggleCalendarDay(day.id)}
                                  className={cn(
                                    'h-8 shrink-0 rounded-full px-3 text-xs',
                                    added &&
                                      'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
                                  )}
                                >
                                  {added ? (
                                    <>
                                      <Undo2 className="size-3.5" />
                                      撤销
                                    </>
                                  ) : (
                                    <>
                                      <CalendarCheck2 className="size-3.5" />
                                      添加到日历
                                    </>
                                  )}
                                </Button>
                              </div>
                              <p className="mt-2 text-xs leading-5 text-slate-600">{day.summary}</p>

                              <details className="group mt-3 rounded-xl bg-slate-50 px-3 py-2.5">
                                <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-slate-700">
                                  <Brain className="size-3.5 text-violet-500" />
                                  为什么这样安排
                                  <span className="ml-auto text-[10px] font-medium text-slate-400 group-open:hidden">
                                    展开依据
                                  </span>
                                </summary>
                                <ul className="mt-2 space-y-1.5 pl-5 text-xs leading-5 text-slate-600">
                                  {day.reasons.map((reason) => (
                                    <li key={reason} className="list-disc">
                                      {reason}
                                    </li>
                                  ))}
                                </ul>
                              </details>

                              {day.problemIds.length ? (
                                <div className="mt-3 grid gap-2">
                                  {day.problemIds.map((problemId, problemIndex) => {
                                    const problem = MOCK_PROBLEMS.find(
                                      (item) => item.id === problemId,
                                    );
                                    if (!problem) return null;
                                    const status = problemStatuses[problemId] ?? 'idle';
                                    const meta = statusMeta(status);
                                    const StatusIcon = meta.icon;
                                    return (
                                      <button
                                        key={problem.id}
                                        type="button"
                                        onClick={() => setActiveProblemId(problem.id)}
                                        className="flex items-center gap-3 rounded-[14px] border border-slate-200 bg-white px-3 py-3 text-left shadow-sm transition hover:border-sky-200 hover:bg-sky-50/30"
                                      >
                                        <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-sky-50 text-sky-700 ring-1 ring-sky-100">
                                          <FileQuestion className="size-4" />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          <span className="block text-[11px] font-medium text-slate-400">
                                            题目 {problemIndex + 1}
                                          </span>
                                          <span className="mt-0.5 block truncate text-xs font-semibold text-slate-800">
                                            {problem.title}
                                          </span>
                                        </span>
                                        <span
                                          className={cn(
                                            'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold',
                                            meta.className,
                                          )}
                                        >
                                          <StatusIcon className="size-3" />
                                          {meta.label}
                                        </span>
                                        <ExternalLink className="size-3.5 shrink-0 text-slate-300" />
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-slate-200 px-3 py-2.5 text-xs text-slate-500">
                                  <Check className="size-3.5 text-emerald-600" />
                                  只重做前两天仍标记为“需重做”的题，不新增负担
                                </div>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="hidden min-h-[calc(100vh-64px)] border-l border-slate-200/80 bg-white/55 p-4 xl:block">
          <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-slate-500" />
              <p className="text-sm font-semibold">本周日历</p>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {REVIEW_DAYS.map((day) => (
                <div
                  key={day.id}
                  className={cn(
                    'rounded-[14px] border px-2 py-3 text-center',
                    calendarDays.has(day.id)
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-slate-200 bg-slate-50 text-slate-500',
                  )}
                >
                  <p className="text-[10px] font-medium">{day.weekday}</p>
                  <p className="mt-1 text-lg font-semibold">{day.date.replace('7月', '')}</p>
                  <span
                    className={cn(
                      'mx-auto mt-2 block size-1.5 rounded-full',
                      calendarDays.has(day.id) ? 'bg-emerald-500' : 'bg-slate-300',
                    )}
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-amber-900">7月31日 · 14:00</p>
              <p className="mt-1 text-xs text-amber-800/75">MAT136 阶段测验</p>
            </div>
          </div>

          <div className="mt-4 rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Brain className="size-4 text-violet-500" />
              <p className="text-sm font-semibold">本次使用的学习记忆</p>
            </div>
            <div className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
              <p className="rounded-xl bg-violet-50 px-3 py-2">薄弱：左右端点采样点列表容易错位</p>
              <p className="rounded-xl bg-emerald-50 px-3 py-2">已掌握：能正确计算 Δx</p>
              <p className="rounded-xl bg-sky-50 px-3 py-2">下一步：先修正采样，再连接到定积分</p>
            </div>
          </div>
        </aside>
      </div>

      <Dialog open={activeEvidence} onOpenChange={setActiveEvidence}>
        <DialogContent className="max-w-xl rounded-[24px] p-0">
          <DialogHeader className="border-b border-slate-100 px-5 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-base">
              <History className="size-4 text-rose-600" />
              错题证据 · 7月25日
            </DialogTitle>
            <DialogDescription>计划引用的是具体作答与反馈，不是泛泛判断。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-5 pb-5">
            <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-500">原题</p>
              <p className="mt-2 text-sm leading-6 text-slate-800">
                在 [0,2] 上用 4 个小区间写出 f(x)=x²+1 的左端点黎曼和。
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[16px] border border-rose-100 bg-rose-50 p-4">
                <p className="text-xs font-semibold text-rose-700">你的作答</p>
                <p className="mt-2 text-sm text-rose-950">采样点：0.5、1、1.5、2</p>
                <Badge className="mt-3 rounded-full bg-rose-600">错误</Badge>
              </div>
              <div className="rounded-[16px] border border-emerald-100 bg-emerald-50 p-4">
                <p className="text-xs font-semibold text-emerald-700">评分反馈</p>
                <p className="mt-2 text-sm leading-6 text-emerald-950">
                  Δx 正确，但你使用的是右端点。左端点应为 0、0.5、1、1.5。
                </p>
              </div>
            </div>
            <div className="rounded-[16px] border border-violet-100 bg-violet-50 p-4 text-sm leading-6 text-violet-950">
              <span className="font-semibold">写入学习记忆：</span>
              计算宽度已掌握；薄弱点是左右端点采样错位。下一步先做一题同构纠错，再进入概念题。
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(activeProblem)}
        onOpenChange={(open) => {
          if (!open) setActiveProblemId(null);
        }}
      >
        <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col gap-0 overflow-hidden rounded-[26px] p-0">
          {activeProblem ? (
            <>
              <DialogHeader className="border-b border-slate-100 px-5 py-4 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="rounded-full border-sky-200 bg-sky-50 text-sky-700"
                  >
                    {activeProblem.eyebrow}
                  </Badge>
                  <span className="text-xs text-slate-400">MAT136 · 黎曼积分</span>
                </div>
                <DialogTitle className="mt-2 text-lg">{activeProblem.title}</DialogTitle>
                <DialogDescription className="text-left leading-5">
                  选题依据：{activeProblem.reason}
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 overflow-y-auto px-5 py-5">
                <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-900">
                  {activeProblem.stem}
                </div>
                <div className="mt-4 grid gap-2">
                  {activeProblem.options.map((option) => {
                    const selected = problemAnswers[activeProblem.id] === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() =>
                          setProblemAnswers((current) => ({
                            ...current,
                            [activeProblem.id]: option.id,
                          }))
                        }
                        className={cn(
                          'flex items-center gap-3 rounded-[15px] border px-4 py-3 text-left text-sm transition',
                          selected
                            ? 'border-sky-300 bg-sky-50 text-sky-950 ring-2 ring-sky-100'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                        )}
                      >
                        <span
                          className={cn(
                            'grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold uppercase',
                            selected
                              ? 'border-sky-500 bg-sky-500 text-white'
                              : 'border-slate-200 text-slate-500',
                          )}
                        >
                          {option.id}
                        </span>
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                {problemStatuses[activeProblem.id] &&
                problemStatuses[activeProblem.id] !== 'idle' ? (
                  <div
                    className={cn(
                      'mt-4 rounded-[16px] border p-4 text-sm leading-6',
                      problemStatuses[activeProblem.id] === 'correct'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                        : 'border-rose-200 bg-rose-50 text-rose-950',
                    )}
                  >
                    <p className="flex items-center gap-2 font-semibold">
                      {problemStatuses[activeProblem.id] === 'correct' ? (
                        <CheckCircle2 className="size-4" />
                      ) : (
                        <XCircle className="size-4" />
                      )}
                      {problemStatuses[activeProblem.id] === 'correct'
                        ? '回答正确，已完成'
                        : '这次还不对，可以根据解析重做'}
                    </p>
                    <p className="mt-1.5">{activeProblem.explanation}</p>
                  </div>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-5 py-4">
                <p className="text-xs text-slate-500">提交后，题目卡片会同步显示完成或需重做。</p>
                <Button
                  type="button"
                  onClick={submitProblem}
                  disabled={!problemAnswers[activeProblem.id]}
                  className="rounded-full px-5"
                >
                  {problemStatuses[activeProblem.id] === 'incorrect' ? (
                    <RotateCcw className="size-4" />
                  ) : null}
                  提交答案
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
