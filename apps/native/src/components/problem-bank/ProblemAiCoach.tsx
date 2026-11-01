import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, X } from 'lucide-react';

import { streamNativeChat, detectChatSurface } from '../../ai/chat';
import type { ChatResponseStrength } from '../../data/ai-client';
import { getLocalRepository } from '../../data/repository';
import {
  problemOptions,
  problemPublicContent,
  problemStem,
  problemTypeLabel,
  type LocalProblemAnswer,
} from '../../data/local-problem-grading';
import type { LocalProblem, LocalProblemAttempt } from '../../domain/models';
import { marbleImages, type MarbleColor } from '../../lib/learning-action-marbles';
import { problemSolution } from '../../lib/problem-solution';
import { cn } from '../../lib/cn';
import { ChatRichText } from '../chat-rich/ChatRichText';
import {
  PROBLEM_COACH_CHIPS,
  problemCoachUserText,
  type ProblemCoachMove,
} from '../../../../../lib/problem-bank/problem-coach';
import './problem-ai-coach.css';

type CoachLine = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  move?: ProblemCoachMove;
  failed?: boolean;
};

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
      return answer.code.trim() ? `代码：\n${clip(answer.code.trim(), 3000)}` : '';
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

/** 拼出给助教看的这道题：题面、学生作答、测试结果、参考答案（只给 AI 判断用）。 */
export function problemCoachText(input: {
  problem: LocalProblem;
  answer: LocalProblemAnswer | null;
  latestAttempt?: LocalProblemAttempt;
  runOutput?: string;
}): string {
  const { problem } = input;
  const content = problemPublicContent(problem);
  const options = problemOptions(problem);
  const solution = problemSolution(problem);
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
    formatAttempt(input.latestAttempt),
    input.runOutput?.trim() ? `【最近一次运行输出】\n${clip(input.runOutput.trim(), 1200)}` : '',
    solution.answer || solution.code || solution.explanation
      ? `【参考答案（只给你判断用）】\n${clip(
          [
            solution.answer,
            solution.code ? `\`\`\`\n${solution.code}\n\`\`\`` : '',
            solution.explanation,
          ]
            .filter(Boolean)
            .join('\n\n'),
          3000,
        )}`
      : '',
  ];
  return clip(sections.filter(Boolean).join('\n\n'), 11_800);
}

function readResponseStrength(): ChatResponseStrength {
  try {
    const stored = window.localStorage.getItem('syntara.phone.response-strength.v1');
    return stored === 'low' || stored === 'high' ? stored : 'medium';
  } catch {
    return 'medium';
  }
}

/** 做题顶栏的「AI」弹珠按钮。 */
export function ProblemAiCoachButton({
  open,
  busy,
  disabled,
  onClick,
}: {
  open: boolean;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn('pac-trigger', open && 'is-open', busy && 'is-busy')}
      aria-pressed={open}
      aria-label="问 AI 这道题"
      disabled={disabled}
      onClick={onClick}
    >
      <img src={marbleImages.purple} alt="" />
      AI
    </button>
  );
}

/** 做题时的 AI 助教：默认只给提示，学生主动要「完整解答」才讲完整。 */
export function ProblemAiCoachPanel({
  problem,
  answer,
  latestAttempt,
  runOutput,
  onClose,
  onBusyChange,
  onSolutionAsked,
}: {
  problem: LocalProblem;
  answer: LocalProblemAnswer | null;
  latestAttempt?: LocalProblemAttempt;
  runOutput?: string;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  /** 学生要了完整解答：和看参考答案一样记一次求助。 */
  onSolutionAsked: () => void;
}) {
  const threads = useRef(new Map<string, CoachLine[]>());
  const [, setVersion] = useState(0);
  const [sendingFor, setSendingFor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmSolution, setConfirmSolution] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lines = threads.current.get(problem.id) ?? [];
  const sending = sendingFor !== null;

  useEffect(() => onBusyChange(sending), [onBusyChange, sending]);
  useEffect(() => {
    setConfirmSolution(false);
    setDraft('');
  }, [problem.id]);
  useEffect(() => {
    if (!confirmSolution) return;
    const timer = window.setTimeout(() => setConfirmSolution(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmSolution]);
  const lastLength = lines.at(-1)?.text.length ?? 0;
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines.length, lastLength]);

  const update = useCallback((problemId: string, next: CoachLine[]) => {
    threads.current.set(problemId, next);
    setVersion((value) => value + 1);
  }, []);

  const send = useCallback(
    async (move: ProblemCoachMove, freeText = '') => {
      if (sendingFor) return;
      const problemId = problem.id;
      const userText = problemCoachUserText(move, 'zh-CN', freeText);
      if (!userText) return;
      const history = threads.current.get(problemId) ?? [];
      const at = Date.now();
      const assistantId = `coach-a-${at}`;
      let working: CoachLine[] = [
        ...history,
        { id: `coach-u-${at}`, role: 'user', text: userText, move },
        { id: assistantId, role: 'assistant', text: '' },
      ];
      update(problemId, working);
      setSendingFor(problemId);
      const patch = (change: Partial<CoachLine>) => {
        working = working.map((line) => (line.id === assistantId ? { ...line, ...change } : line));
        update(problemId, working);
      };
      try {
        const repository = await getLocalRepository();
        const workspace = await repository.loadCourseWorkspace(problem.courseId);
        const course = workspace?.course;
        const result = await streamNativeChat(
          {
            requestId: `problem-coach-${crypto.randomUUID()}`,
            surface: detectChatSurface(false),
            course: {
              id: problem.courseId,
              name: course?.name || '课程',
              code: course?.courseCode ?? null,
              description: '',
              language: course?.language ?? 'zh-CN',
            },
            messages: working
              .filter((line) => line.id !== assistantId && !line.failed && line.text)
              .slice(-12)
              .map(({ role, text }) => ({ role, text: text.slice(0, 6000) })),
            context: {
              notes: [],
              memories: [],
              calendar: [],
              attempts: [],
              problems: [],
              problemCoach: {
                problemId,
                title: problem.title.slice(0, 300),
                problem: problemCoachText({ problem, answer, latestAttempt, runOutput }),
                move,
              },
            },
          },
          { responseStrength: readResponseStrength() },
          (delta) => {
            const current = working.find((line) => line.id === assistantId)?.text ?? '';
            patch({ text: current + delta });
          },
        );
        patch({ text: result.text.trim() || '这次没有生成回答，再试一次。' });
        if (move === 'solution') onSolutionAsked();
      } catch (cause) {
        patch({
          text: `没能回答：${cause instanceof Error ? cause.message : '请稍后再试'}`,
          failed: true,
        });
      } finally {
        setSendingFor(null);
      }
    },
    [answer, latestAttempt, onSolutionAsked, problem, runOutput, sendingFor, update],
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

  return (
    <aside className="pac-panel" role="dialog" aria-label="AI 助教">
      <header className="pac-head">
        <img src={marbleImages.purple} alt="" />
        <div>
          <strong>AI</strong>
          <small>{problem.title}</small>
        </div>
        <button type="button" className="pac-close" aria-label="关闭" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="pac-body" ref={scrollRef}>
        {lines.length === 0 ? (
          <div className="pac-empty">
            <img src={marbleImages.purple} alt="" />
            <p>卡住了？先来个提示</p>
          </div>
        ) : (
          lines.map((line) =>
            line.role === 'user' ? (
              <div key={line.id} className="pac-user">
                <span>
                  {line.move && line.move !== 'ask' ? (
                    <img src={marbleImages[CHIP_MARBLE[line.move]]} alt="" />
                  ) : null}
                  {line.text}
                </span>
              </div>
            ) : (
              <div key={line.id} className={cn('pac-answer', line.failed && 'is-failed')}>
                {line.text ? (
                  <ChatRichText text={line.text} />
                ) : (
                  <span className="pac-dots" aria-label="…">
                    {(['amber', 'green', 'blue'] as const).map((color) => (
                      <img key={color} src={marbleImages[color]} alt="" />
                    ))}
                  </span>
                )}
              </div>
            ),
          )
        )}
      </div>
      <footer className="pac-foot">
        <div className="pac-chips">
          {PROBLEM_COACH_CHIPS.map((chip) => {
            const confirming = chip.move === 'solution' && confirmSolution;
            return (
              <button
                key={chip.move}
                type="button"
                className={cn('pac-chip', confirming && 'is-confirming')}
                disabled={sending}
                onClick={() => pressChip(chip.move)}
              >
                <img src={marbleImages[CHIP_MARBLE[chip.move]]} alt="" />
                {confirming ? '再点一下' : chip.zh}
              </button>
            );
          })}
        </div>
        <form
          className="pac-input"
          onSubmit={(event) => {
            event.preventDefault();
            submitDraft();
          }}
        >
          <textarea
            rows={1}
            value={draft}
            placeholder="问这道题…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submitDraft();
              }
            }}
          />
          <button type="submit" aria-label="发送" disabled={sending || !draft.trim()}>
            <ArrowUp size={16} />
          </button>
        </form>
      </footer>
    </aside>
  );
}
