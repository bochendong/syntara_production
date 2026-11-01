'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import { ArrowUp, X } from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { LANDING_MARBLE_ART } from '@/components/home/landing/marble-art';
import { askCourseOrchestrator } from '@/lib/chat/ask-course-orchestrator';
import {
  buildProblemCoachContext,
  formatProblemCoachAnswerUpdate,
} from '@/lib/chat/problem-explain-prompt';
import {
  PROBLEM_COACH_CHIPS,
  problemCoachInstruction,
  problemCoachRules,
  problemCoachUserText,
  type ProblemCoachMove,
} from '@/lib/problem-bank/problem-coach';
import type {
  NotebookProblemAttemptAnswer,
  NotebookProblemAttemptRecord,
  NotebookProblemPublicContent,
} from '@/lib/problem-bank';
import type { ChatMessageMetadata } from '@/lib/types/chat';
import {
  recordCourseProblemEvent,
  type NotebookProblemClientRecord,
} from '@/lib/utils/notebook-problem-api';
import { cn } from '@/lib/utils';

type CoachLocale = 'zh-CN' | 'en-US';

type CoachLine = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  move?: ProblemCoachMove;
  streaming?: boolean;
  failed?: boolean;
};

type CoachThread = {
  lines: CoachLine[];
  conversation: UIMessage<ChatMessageMetadata>[];
  lastAnswerKey: string;
  sending: boolean;
};

const coachMarkdownClassName = cn(
  'min-w-0 max-w-full text-[13px] leading-6 text-slate-800 dark:text-slate-100',
  '[&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-0.5',
  '[&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold',
  '[&_.katex-display]:overflow-x-auto [&_[data-streamdown=code-block]]:my-2 [&_[data-streamdown=code-block]]:max-w-full [&_[data-streamdown=code-block]]:overflow-x-auto',
);

const CHIP_MARBLE: Record<Exclude<ProblemCoachMove, 'ask'>, keyof typeof LANDING_MARBLE_ART> = {
  hint: 'amber',
  next: 'green',
  check: 'blue',
  solution: 'pink',
};

function assistantText(messages: UIMessage<ChatMessageMetadata>[]): string {
  const latest = messages
    .slice()
    .reverse()
    .find((message) => message.role === 'assistant' && !message.metadata?.progressOnly);
  if (!latest) return '';
  return latest.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim();
}

function emptyThread(): CoachThread {
  return { lines: [], conversation: [], lastAnswerKey: '', sending: false };
}

/** 顶栏上的「AI」弹珠按钮。 */
export function ProblemAiCoachButton({
  open,
  busy,
  locale,
  onClick,
  className,
}: {
  open: boolean;
  busy?: boolean;
  locale: CoachLocale;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={open}
      aria-label={locale === 'en-US' ? 'Ask AI about this problem' : '问 AI 这道题'}
      title={locale === 'en-US' ? 'Ask AI' : '问 AI'}
      className={cn(
        'group inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 pl-1 text-xs font-semibold transition',
        'border-white/70 bg-white/70 text-slate-700 shadow-[0_6px_18px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl hover:bg-white',
        'dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-100 dark:hover:bg-white/10',
        open &&
          'border-violet-200 bg-violet-50/90 text-violet-700 dark:border-violet-300/30 dark:bg-violet-400/15 dark:text-violet-100',
        className,
      )}
    >
      <img
        src={LANDING_MARBLE_ART.purple.src}
        alt=""
        className={cn(
          'size-6 rounded-full transition-transform group-hover:rotate-12',
          busy && 'animate-spin [animation-duration:1.6s]',
        )}
      />
      AI
    </button>
  );
}

/** 做题时的 AI 助教面板：默认只给提示，学生主动要才给完整解答。 */
export function ProblemAiCoachPanel({
  open,
  onOpenChange,
  onBusyChange,
  courseId,
  courseName,
  problem,
  problemTitle,
  problemContent,
  notebookName,
  currentAnswer,
  latestAttempt,
  locale,
  recordHelpEvents = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  courseId: string;
  courseName?: string;
  problem: NotebookProblemClientRecord;
  problemTitle: string;
  problemContent: NotebookProblemPublicContent | null;
  notebookName: string;
  currentAnswer: NotebookProblemAttemptAnswer | null;
  latestAttempt: NotebookProblemAttemptRecord | null;
  locale: CoachLocale;
  /** 老师预览、管理员只读时不记求助。 */
  recordHelpEvents?: boolean;
}) {
  const threads = useRef(new Map<string, CoachThread>());
  const [, setVersion] = useState(0);
  const rerender = useCallback(() => setVersion((value) => value + 1), []);
  const [draft, setDraft] = useState('');
  const [confirmSolution, setConfirmSolution] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const aborters = useRef(new Set<AbortController>());

  const thread = threads.current.get(problem.id) ?? emptyThread();
  const sending = thread.sending;

  useEffect(() => {
    onBusyChange?.(sending);
  }, [onBusyChange, sending]);

  useEffect(() => {
    setConfirmSolution(false);
    setDraft('');
  }, [problem.id]);

  useEffect(() => {
    if (!confirmSolution) return;
    const timer = window.setTimeout(() => setConfirmSolution(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmSolution]);

  useEffect(() => {
    const live = aborters.current;
    return () => {
      for (const controller of live) controller.abort();
    };
  }, []);

  const lineCount = thread.lines.length;
  const lastText = thread.lines.at(-1)?.text.length ?? 0;
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lineCount, lastText, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpenChange, open]);

  const send = useCallback(
    async (move: ProblemCoachMove, freeText = '') => {
      const problemId = problem.id;
      const current = threads.current.get(problemId) ?? emptyThread();
      if (current.sending || !problemContent) return;
      const userText = problemCoachUserText(move, locale, freeText);
      if (!userText) return;

      const first = current.conversation.length === 0;
      const answerKey = JSON.stringify(currentAnswer ?? null);
      const question = [
        first ? problemCoachRules(locale) : '',
        first
          ? buildProblemCoachContext({
              problem,
              problemTitle,
              problemContent,
              notebookName,
              currentAnswer,
              latestAttempt,
            })
          : '',
        !first && answerKey !== current.lastAnswerKey
          ? formatProblemCoachAnswerUpdate(currentAnswer)
          : '',
        `【学生】${userText}`,
        problemCoachInstruction(move),
      ]
        .filter(Boolean)
        .join('\n\n');

      const at = Date.now();
      const assistantId = `coach-a-${at}`;
      const next: CoachThread = {
        ...current,
        sending: true,
        lastAnswerKey: answerKey,
        lines: [
          ...current.lines,
          { id: `coach-u-${at}`, role: 'user', text: userText, move },
          { id: assistantId, role: 'assistant', text: '', streaming: true },
        ],
      };
      threads.current.set(problemId, next);
      rerender();

      const setAssistant = (patch: Partial<CoachLine>, extra?: Partial<CoachThread>) => {
        const live = threads.current.get(problemId);
        if (!live) return;
        threads.current.set(problemId, {
          ...live,
          ...extra,
          lines: live.lines.map((line) => (line.id === assistantId ? { ...line, ...patch } : line)),
        });
        rerender();
      };

      const controller = new AbortController();
      aborters.current.add(controller);
      try {
        const result = await askCourseOrchestrator({
          courseId,
          courseName,
          question,
          conversation: current.conversation,
          teachingMode: move === 'solution' ? 'reply' : 'guided',
          signal: controller.signal,
          onMessages: (messages) => {
            const text = assistantText(messages);
            if (text) setAssistant({ text });
          },
        });
        const text =
          assistantText(result.messages) ||
          result.answer.trim() ||
          (locale === 'en-US' ? 'No answer this time. Try again.' : '这次没有生成回答，再试一次。');
        setAssistant({ text, streaming: false }, { conversation: result.messages, sending: false });
        if (move === 'solution' && recordHelpEvents)
          void recordCourseProblemEvent({ courseId, problemId, event: 'solution_viewed' }).catch(
            () => undefined,
          );
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : '';
        setAssistant(
          {
            text:
              locale === 'en-US' ? `Failed. ${message}` : `没能回答：${message || '请稍后再试'}`,
            streaming: false,
            failed: true,
          },
          { sending: false },
        );
      } finally {
        aborters.current.delete(controller);
      }
    },
    [
      courseId,
      courseName,
      currentAnswer,
      latestAttempt,
      locale,
      notebookName,
      problem,
      problemContent,
      problemTitle,
      recordHelpEvents,
      rerender,
    ],
  );

  const pressChip = (move: Exclude<ProblemCoachMove, 'ask'>) => {
    if (move === 'solution' && !confirmSolution) {
      setConfirmSolution(true);
      return;
    }
    setConfirmSolution(false);
    void send(move);
  };

  const submitDraft = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    void send('ask', text);
  };

  if (!open) return null;

  const empty = thread.lines.length === 0;
  const disabled = sending || !problemContent;

  return (
    <aside
      role="dialog"
      aria-label={locale === 'en-US' ? 'AI tutor' : 'AI 助教'}
      className={cn(
        'absolute inset-y-2 right-2 z-40 flex w-[min(400px,calc(100%-1rem))] flex-col overflow-hidden rounded-[26px]',
        'border border-white/70 bg-white/80 shadow-[0_24px_60px_rgba(15,23,42,0.18),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-2xl',
        'dark:border-white/10 dark:bg-slate-900/80 dark:shadow-[0_24px_60px_rgba(0,0,0,0.45)]',
        'animate-in fade-in slide-in-from-right-4 duration-200',
      )}
    >
      <header className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-3">
        <img src={LANDING_MARBLE_ART.purple.src} alt="" className="size-7 rounded-full" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">AI</p>
          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            {problemTitle || problem.title}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label={locale === 'en-US' ? 'Close' : '关闭'}
          className="grid size-8 place-items-center rounded-full text-slate-500 transition hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/10"
        >
          <X className="size-4" />
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span className="relative grid size-20 place-items-center">
              <span className="absolute inset-2 rounded-full bg-violet-300/30 blur-xl dark:bg-violet-500/20" />
              <img
                src={LANDING_MARBLE_ART.purple.src}
                alt=""
                className="relative size-16 animate-[spin_14s_linear_infinite] rounded-full"
              />
            </span>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {locale === 'en-US' ? 'Stuck? Start with a hint.' : '卡住了？先来个提示'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {thread.lines.map((line) =>
              line.role === 'user' ? (
                <div key={line.id} className="flex justify-end">
                  <span className="inline-flex max-w-[85%] items-center gap-1.5 rounded-2xl bg-slate-900 px-3 py-1.5 text-[13px] leading-5 text-white dark:bg-white dark:text-slate-900">
                    {line.move && line.move !== 'ask' ? (
                      <img
                        src={LANDING_MARBLE_ART[CHIP_MARBLE[line.move]].src}
                        alt=""
                        className="size-4 rounded-full"
                      />
                    ) : null}
                    {line.text}
                  </span>
                </div>
              ) : (
                <div
                  key={line.id}
                  className={cn(
                    'rounded-2xl border border-white/70 bg-white/70 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-white/[0.04]',
                    line.failed &&
                      'border-rose-200 bg-rose-50/80 dark:border-rose-400/20 dark:bg-rose-500/10',
                  )}
                >
                  {line.text ? (
                    <MessageResponse className={coachMarkdownClassName}>
                      {line.text}
                    </MessageResponse>
                  ) : (
                    <span className="flex items-center gap-1 py-1" aria-label="…">
                      {(['amber', 'green', 'blue'] as const).map((color, index) => (
                        <img
                          key={color}
                          src={LANDING_MARBLE_ART[color].src}
                          alt=""
                          className="size-3 animate-bounce rounded-full"
                          style={{ animationDelay: `${index * 120}ms` }}
                        />
                      ))}
                    </span>
                  )}
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2 px-3 pb-3 pt-1">
        <div className="flex flex-wrap gap-1.5">
          {PROBLEM_COACH_CHIPS.map((chip) => {
            const confirming = chip.move === 'solution' && confirmSolution;
            return (
              <button
                key={chip.move}
                type="button"
                disabled={disabled}
                onClick={() => pressChip(chip.move)}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-full border px-2 pl-1 text-xs font-medium transition disabled:opacity-50',
                  'border-white/70 bg-white/70 text-slate-700 hover:bg-white dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200 dark:hover:bg-white/10',
                  confirming &&
                    'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/15 dark:text-rose-100',
                )}
              >
                <img
                  src={LANDING_MARBLE_ART[CHIP_MARBLE[chip.move]].src}
                  alt=""
                  className="size-5 rounded-full"
                />
                {confirming
                  ? locale === 'en-US'
                    ? 'Tap again'
                    : '再点一下'
                  : locale === 'en-US'
                    ? chip.en
                    : chip.zh}
              </button>
            );
          })}
        </div>
        <form
          className="flex items-end gap-2 rounded-2xl border border-white/70 bg-white/70 p-1.5 pl-3 dark:border-white/10 dark:bg-white/[0.05]"
          onSubmit={(event) => {
            event.preventDefault();
            submitDraft();
          }}
        >
          <textarea
            value={draft}
            rows={1}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submitDraft();
              }
            }}
            placeholder={locale === 'en-US' ? 'Ask about this problem' : '问这道题…'}
            className="max-h-28 min-h-7 flex-1 resize-none bg-transparent py-1 text-[13px] leading-5 text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
          />
          <button
            type="submit"
            disabled={disabled || !draft.trim()}
            aria-label={locale === 'en-US' ? 'Send' : '发送'}
            className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-900 text-white transition disabled:opacity-30 dark:bg-white dark:text-slate-900"
          >
            <ArrowUp className="size-4" />
          </button>
        </form>
      </div>
    </aside>
  );
}
