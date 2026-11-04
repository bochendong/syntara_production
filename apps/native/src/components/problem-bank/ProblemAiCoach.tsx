import { useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';

import {
  problemOptions,
  problemPublicContent,
  problemStem,
  problemTypeLabel,
  type LocalProblemAnswer,
} from '../../data/local-problem-grading';
import type { LocalProblem, LocalProblemAttempt } from '../../domain/models';
import { marbleImages, type MarbleColor } from '../../lib/learning-action-marbles';
import { cn } from '../../lib/cn';
import {
  PROBLEM_COACH_CHIPS,
  type ProblemCoachMove,
} from '../../../../../lib/problem-bank/problem-coach';
import { draftChangeNote, numberCodeLines } from '../../../../../lib/chat/explain-method';
import './problem-ai-coach.css';

const CHIP_MARBLE: Record<Exclude<ProblemCoachMove, 'ask'>, MarbleColor> = {
  hint: 'amber',
  next: 'green',
  check: 'blue',
  solution: 'pink',
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function formatAnswer(answer: LocalProblemAnswer | null): string {
  if (!answer) return '';
  switch (answer.kind) {
    case 'choice':
      return answer.selectedOptionIds.length ? `选择：${answer.selectedOptionIds.join('、')}` : '';
    case 'text':
      return [
        answer.text.trim() ? clip(answer.text.trim(), 1600) : '',
        answer.images?.length ? `（另有 ${answer.images.length} 张照片，内容未附上）` : '',
        answer.handwriting ? '（有手写作答，内容未附上）' : '',
      ]
        .filter(Boolean)
        .join('\n');
    case 'code':
      return answer.code.trim()
        ? `代码（行首是行号）：\n${numberCodeLines(clip(answer.code.trim(), 3000))}`
        : '';
    case 'table':
      return Object.entries(answer.cells)
        .filter(([, value]) => value.trim())
        .map(([cell, value]) => `${cell}: ${value}`)
        .join('\n');
    case 'blanks':
      return Object.entries(answer.blanks)
        .filter(([, value]) => value.trim())
        .map(([blank, value]) => `空 ${blank}: ${value}`)
        .join('\n');
    case 'parts':
      return Object.entries(answer.parts)
        .map(([label, part]) => {
          const bits = [
            part.selectedOptionIds?.length ? `选 ${part.selectedOptionIds.join('、')}` : '',
            part.text?.trim() ? clip(part.text.trim(), 800) : '',
            part.blanks
              ? Object.entries(part.blanks)
                  .filter(([, value]) => value.trim())
                  .map(([id, value]) => `空 ${id}: ${value}`)
                  .join('；')
              : '',
            'code' in part && typeof part.code === 'string' && part.code.trim()
              ? `代码：\n${clip(part.code.trim(), 1500)}`
              : '',
          ].filter(Boolean);
          return bits.length ? `(${label}) ${bits.join('\n')}` : '';
        })
        .filter(Boolean)
        .join('\n');
    default:
      return '';
  }
}

function formatAttempt(attempt: LocalProblemAttempt | undefined): string {
  if (!attempt) return '';
  const result = attempt.result ?? {};
  if (typeof result.event === 'string') return '';
  const lines = [
    `最近一次提交：${attempt.status}${typeof attempt.score === 'number' ? `，得分 ${attempt.score}` : ''}`,
  ];
  const summary = result.publicSummary as { passed?: number; total?: number } | undefined;
  if (summary && typeof summary.total === 'number')
    lines.push(`公开测试通过 ${summary.passed ?? 0}/${summary.total}`);
  if (str(result.feedback)) lines.push(`反馈：${clip(str(result.feedback), 900)}`);
  if (str(result.error)) lines.push(`错误：${clip(str(result.error), 900)}`);
  return lines.join('\n');
}

/** 拼出给助教看的这道题：题面、学生作答、测试结果。参考答案由服务端按题目 id 自己读。 */
/** 用来比较两次提问之间改动的作答原文（代码不带行号）。 */
export function rawAnswerText(answer: LocalProblemAnswer | null): string {
  if (answer?.kind === 'code') return answer.code;
  return formatAnswer(answer);
}

/** 每道题上次问 AI 时发出去的作答；只在这次打开 App 期间记着。 */
const sentAnswers = new Map<string, string>();

/** 发送「问 AI」那一刻调用：带上和上次相比的改动，并记下这次的作答。 */
export function problemCoachTextForSend(input: Parameters<typeof problemCoachText>[0]): string {
  const key = input.problem.id;
  const text = problemCoachText({ ...input, previousAnswer: sentAnswers.get(key) });
  sentAnswers.set(key, rawAnswerText(input.answer));
  return text;
}

export function problemCoachText(input: {
  problem: LocalProblem;
  answer: LocalProblemAnswer | null;
  latestAttempt?: LocalProblemAttempt;
  runOutput?: string;
  /** 上次问 AI 时发出去的作答（rawAnswerText），用来列出这次改了哪些行。 */
  previousAnswer?: string;
}): string {
  const { problem } = input;
  const content = problemPublicContent(problem);
  const options = problemOptions(problem);
  const parts = Array.isArray(content.parts)
    ? (content.parts as Array<{ label: string; content: Record<string, unknown> }>)
        .map(
          (part) =>
            `(${part.label}) ${clip(str(part.content.stem) || str(part.content.prompt), 1200)}`,
        )
        .join('\n')
    : '';
  const answer = formatAnswer(input.answer);
  const sections = [
    `标题：${problem.title}`,
    `题型：${problemTypeLabel(problem.type)}`,
    `题面：${clip(problemStem(problem), 4000)}`,
    parts ? `小问：\n${parts}` : '',
    options.length ? `选项：\n${options.map((o) => `${o.id}. ${o.label}`).join('\n')}` : '',
    str(content.functionSignature) ? `函数签名：${str(content.functionSignature)}` : '',
    str(content.starterCode) ? `起始代码：\n${clip(str(content.starterCode), 2000)}` : '',
    answer ? `【学生当前作答】\n${answer}` : '学生还没有作答。',
    input.previousAnswer !== undefined
      ? draftChangeNote(input.previousAnswer, rawAnswerText(input.answer))
      : '',
    formatAttempt(input.latestAttempt),
    input.runOutput?.trim() ? `【最近一次运行输出】\n${clip(input.runOutput.trim(), 1200)}` : '',
  ];
  return clip(sections.filter(Boolean).join('\n\n'), 11_800);
}

/**
 * 做题顶栏的「问 AI」：点开是一排快捷提问。选一个就把这道题交给课程主聊天
 * （做题页收成右下角的弹珠），「在聊天里问」只挂上题目卡片、聚焦输入框。
 */
export function ProblemAiAskMenu({
  disabled,
  onAsk,
}: {
  disabled?: boolean;
  onAsk: (move: ProblemCoachMove) => void;
}) {
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

  return (
    <div className="pac-ask" ref={rootRef}>
      <button
        type="button"
        className={cn('pac-trigger', open && 'is-open')}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="问 AI 这道题"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <img src={marbleImages.purple} alt="" />问 AI
      </button>
      {open ? (
        <div className="pac-menu" role="menu" aria-label="问 AI">
          {PROBLEM_COACH_CHIPS.map((chip) => {
            const confirming = chip.move === 'solution' && confirmSolution;
            return (
              <button
                key={chip.move}
                type="button"
                role="menuitem"
                className={cn('pac-chip', confirming && 'is-confirming')}
                onClick={() => ask(chip.move)}
              >
                <img src={marbleImages[CHIP_MARBLE[chip.move]]} alt="" />
                {confirming ? '再点一下' : chip.zh}
              </button>
            );
          })}
          <button
            type="button"
            role="menuitem"
            className="pac-chip pac-chip-free"
            onClick={() => ask('ask')}
          >
            <MessageCircle size={15} />
            在聊天里问
          </button>
        </div>
      ) : null}
    </div>
  );
}
