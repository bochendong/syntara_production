'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { LANDING_MARBLE_ART } from '@/components/home/landing/marble-art';
import { PROBLEM_COACH_CHIPS, type ProblemCoachMove } from '@/lib/problem-bank/problem-coach';
import { cn } from '@/lib/utils';

type CoachLocale = 'zh-CN' | 'en-US';

const CHIP_MARBLE: Record<Exclude<ProblemCoachMove, 'ask'>, keyof typeof LANDING_MARBLE_ART> = {
  hint: 'amber',
  next: 'green',
  check: 'blue',
  solution: 'pink',
};

/**
 * 做题页「问 AI」交给课程主聊天的那道题。problem 是题面和学生当前作答（不含参考答案，
 * 服务端按 problemId 从题库读）；move 是这一次的快捷提问，ask 只挂卡片、聚焦输入框。
 */
export type ProblemChatHandoff = {
  courseId: string;
  problemId: string;
  title: string;
  problem: string;
  move: ProblemCoachMove;
  /** 「完整解答」答完后要不要记一次求助（老师预览、管理员只读时不记）。 */
  recordSolution: boolean;
};

/** 主聊天输入框上方挂着的那道题。 */
export type AttachedChatProblem = Omit<ProblemChatHandoff, 'move'>;

const HANDOFF_STORAGE_KEY = 'syntara.problem-chat-handoff.v1';

/** 独立题库页没有主聊天：先存起来，跳到课程聊天后由聊天页取走。 */
export function stashProblemChatHandoff(handoff: ProblemChatHandoff) {
  try {
    window.sessionStorage.setItem(
      HANDOFF_STORAGE_KEY,
      JSON.stringify({ ...handoff, at: Date.now() }),
    );
  } catch {
    // 存不了就只打开聊天。
  }
}

export function takeProblemChatHandoff(courseId: string): ProblemChatHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProblemChatHandoff & { at?: number };
    if (parsed.courseId !== courseId) return null;
    window.sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
    // 太久以前的交接（比如刷新了好几次）不再用。
    if (!parsed.at || Date.now() - parsed.at > 10 * 60_000) return null;
    return typeof parsed.problemId === 'string' && typeof parsed.problem === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * 做题顶栏的「问 AI」：点开是一排快捷提问，选一个就把这道题交给课程主聊天；
 * 「完整解答」要点两次。
 */
export function ProblemAiAskMenu({
  locale,
  disabled,
  onAsk,
  className,
}: {
  locale: CoachLocale;
  disabled?: boolean;
  onAsk: (move: ProblemCoachMove) => void;
  className?: string;
}) {
  const english = locale === 'en-US';
  const [open, setOpen] = useState(false);
  const [confirmSolution, setConfirmSolution] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    setConfirmSolution(false);
  };

  useEffect(() => {
    if (!open) return;
    const dismiss = () => {
      setOpen(false);
      setConfirmSolution(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) dismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // 只关菜单，不让做题弹窗跟着关。
      event.stopPropagation();
      dismiss();
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (!confirmSolution) return;
    const timer = window.setTimeout(() => setConfirmSolution(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmSolution]);

  const ask = (move: ProblemCoachMove) => {
    if (move === 'solution' && !confirmSolution) {
      setConfirmSolution(true);
      return;
    }
    close();
    onAsk(move);
  };

  const chipClassName =
    'flex h-8 w-full items-center gap-1.5 whitespace-nowrap rounded-full border border-white/70 bg-white/70 pr-3 pl-1 text-left text-xs font-medium text-slate-700 transition hover:bg-white dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-100 dark:hover:bg-white/10';

  return (
    <div ref={rootRef} className={cn('relative shrink-0', className)}>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={english ? 'Ask AI about this problem' : '问 AI 这道题'}
        className={cn(
          'group inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 pl-1 text-xs font-semibold transition',
          'border-white/70 bg-white/70 text-slate-700 shadow-[0_6px_18px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl hover:bg-white',
          'dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-100 dark:hover:bg-white/10',
          'disabled:pointer-events-none disabled:opacity-50',
          open &&
            'border-violet-200 bg-violet-50/90 text-violet-700 dark:border-violet-300/30 dark:bg-violet-400/15 dark:text-violet-100',
        )}
      >
        <img
          src={LANDING_MARBLE_ART.purple.src}
          alt=""
          className="size-6 rounded-full transition-transform group-hover:rotate-12"
        />
        {english ? 'Ask AI' : '问 AI'}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={english ? 'Ask AI' : '问 AI'}
          className="absolute top-[calc(100%+8px)] right-0 z-50 grid min-w-[172px] gap-1.5 rounded-2xl border border-white/75 bg-white/90 p-2 shadow-[0_18px_44px_rgba(15,23,42,0.16)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/95"
        >
          {PROBLEM_COACH_CHIPS.map((chip) => {
            const confirming = chip.move === 'solution' && confirmSolution;
            return (
              <button
                key={chip.move}
                type="button"
                role="menuitem"
                onClick={() => ask(chip.move)}
                className={cn(
                  chipClassName,
                  confirming &&
                    'border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-300/30 dark:bg-pink-400/15 dark:text-pink-100',
                )}
              >
                <img
                  src={LANDING_MARBLE_ART[CHIP_MARBLE[chip.move]].src}
                  alt=""
                  className="size-5"
                />
                {confirming ? (english ? 'Tap again' : '再点一下') : english ? chip.en : chip.zh}
              </button>
            );
          })}
          <button
            type="button"
            role="menuitem"
            onClick={() => ask('ask')}
            className={cn(chipClassName, 'pl-2.5 text-slate-500 dark:text-slate-300')}
          >
            <MessageCircle className="size-3.5" />
            {english ? 'Ask in chat' : '在聊天里问'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 主聊天里的题目小卡：输入框上方可移除，用户消息上方只展示。 */
export function ProblemChatCard({
  title,
  onRemove,
  className,
}: {
  title: string;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-2 rounded-xl border border-violet-200/80 bg-white/80 py-1 pr-1.5 pl-1 text-left shadow-[0_6px_18px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-violet-300/25 dark:bg-slate-900/70',
        className,
      )}
    >
      <img src={LANDING_MARBLE_ART.purple.src} alt="" className="size-6 shrink-0 rounded-full" />
      <span className="grid min-w-0 pr-1">
        <small className="text-[10.5px] leading-tight font-semibold text-violet-600 dark:text-violet-300">
          正在做的题
        </small>
        <strong className="truncate text-[13px] leading-snug font-semibold text-slate-900 dark:text-slate-50">
          {title}
        </strong>
      </span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`移除题目 ${title}`}
          className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-full bg-slate-900/5 px-2 text-xs font-medium text-slate-600 hover:bg-slate-900/10 hover:text-slate-900 dark:bg-white/10 dark:text-slate-300"
        >
          <X className="size-3" />
          移除
        </button>
      ) : null}
    </span>
  );
}
