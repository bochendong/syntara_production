import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileCode2,
  Loader2,
  SendHorizontal,
  Terminal,
} from 'lucide-react';

import {
  answerHasContent,
  buildPublicTestsPython,
  difficultyLabel,
  emptyAnswerForProblem,
  gradeLocalProblem,
  problemBlanks,
  problemIsCode,
  problemOptions,
  problemPublicContent,
  problemSelectionMode,
  problemStem,
  problemTypeLabel,
  type LocalProblemAnswer,
} from '../data/local-problem-grading';
import { gradeNativeAnswer } from '../data/platform-api-client';
import { getLocalRepository } from '../data/repository';
import type { LocalProblem, LocalProblemDocument } from '../domain/models';
import { cn } from '../lib/cn';
import { CodeAnswerEditor, highlightPython } from './problem-bank/code-answer-editor';
import { CodeProblemStatement } from './problem-bank/code-problem-statement';
import {
  ProblemImageAssets,
  ProblemRichText,
  ProblemTitleText,
} from './problem-bank/problem-rich-text';
import type { NotebookProblemPublicContent } from './problem-bank/types';
import type { ProblemBankLaunch } from './ProblemBankPage';

type ProblemPracticePageProps = {
  problems: LocalProblem[];
  launch: ProblemBankLaunch;
  onBack: () => void;
};

type RightTab = 'answer' | 'code' | 'testcase' | 'history';

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function restoreAnswerFromAttempt(
  problem: LocalProblem,
  document: LocalProblemDocument | null,
): LocalProblemAnswer {
  const latest = document?.attempts[0];
  const raw = latest?.answer;
  if (!raw || typeof raw !== 'object') return emptyAnswerForProblem(problem);
  const record = raw as Record<string, unknown>;
  if (record.kind === 'choice' && Array.isArray(record.selectedOptionIds)) {
    return {
      kind: 'choice',
      selectedOptionIds: record.selectedOptionIds.filter(
        (item): item is string => typeof item === 'string',
      ),
    };
  }
  if (record.kind === 'fill_blank' && record.blanks && typeof record.blanks === 'object') {
    return {
      kind: 'fill_blank',
      blanks: Object.fromEntries(
        Object.entries(record.blanks as Record<string, unknown>).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : '',
        ]),
      ),
    };
  }
  if (record.kind === 'code' && typeof record.code === 'string') {
    return { kind: 'code', code: record.code };
  }
  if (record.kind === 'text' && typeof record.text === 'string') {
    return { kind: 'text', text: record.text };
  }
  return emptyAnswerForProblem(problem);
}

function asCodeContent(
  content: Record<string, unknown>,
): Extract<NotebookProblemPublicContent, { type: 'code' }> {
  return {
    type: 'code',
    stem: typeof content.stem === 'string' ? content.stem : '',
    language: typeof content.language === 'string' ? content.language : 'python',
    starterCode: typeof content.starterCode === 'string' ? content.starterCode : undefined,
    functionSignature:
      typeof content.functionSignature === 'string' ? content.functionSignature : undefined,
    constraints: Array.isArray(content.constraints)
      ? content.constraints.filter((item): item is string => typeof item === 'string')
      : [],
    publicTests: Array.isArray(content.publicTests)
      ? (content.publicTests as Extract<
          NotebookProblemPublicContent,
          { type: 'code' }
        >['publicTests'])
      : [],
    sampleIO: Array.isArray(content.sampleIO)
      ? (content.sampleIO as Extract<NotebookProblemPublicContent, { type: 'code' }>['sampleIO'])
      : [],
    statementSections: Array.isArray(content.statementSections)
      ? (content.statementSections as Extract<
          NotebookProblemPublicContent,
          { type: 'code' }
        >['statementSections'])
      : [],
    starterCodeDescription:
      typeof content.starterCodeDescription === 'string'
        ? content.starterCodeDescription
        : undefined,
    explanation: typeof content.explanation === 'string' ? content.explanation : undefined,
    assets:
      content.assets && typeof content.assets === 'object'
        ? (content.assets as Extract<NotebookProblemPublicContent, { type: 'code' }>['assets'])
        : undefined,
  };
}

function CodeTestcasePanel({ code }: { code: string }) {
  const lineNumbers = Array.from(
    { length: Math.max(1, code.split('\n').length) },
    (_, index) => index + 1,
  );

  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-white">
      <div className="grid min-h-0 flex-1 grid-cols-[3.25rem_minmax(0,1fr)] overflow-auto bg-white font-mono text-[13px] leading-6 text-slate-900">
        <pre className="select-none border-r border-slate-200 bg-slate-50 px-3 py-4 text-right text-slate-400">
          {lineNumbers.join('\n')}
        </pre>
        <pre className="min-w-max whitespace-pre px-4 py-4">
          <code>{highlightPython(code)}</code>
        </pre>
      </div>
    </div>
  );
}

export function ProblemPracticePage({ problems, launch, onBack }: ProblemPracticePageProps) {
  const problemMap = useMemo(
    () => new Map(problems.map((problem) => [problem.id, problem])),
    [problems],
  );
  const orderedIds = useMemo(
    () => launch.problemIds.filter((id) => problemMap.has(id)),
    [launch.problemIds, problemMap],
  );
  const [currentId, setCurrentId] = useState(
    orderedIds.includes(launch.initialProblemId) ? launch.initialProblemId : orderedIds[0],
  );
  const [document, setDocument] = useState<LocalProblemDocument | null>(null);
  const [answer, setAnswer] = useState<LocalProblemAnswer | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('answer');

  const currentIndex = Math.max(0, orderedIds.indexOf(currentId));
  const currentProblem = problemMap.get(currentId) || null;
  const total = orderedIds.length;
  const isCode = currentProblem ? problemIsCode(currentProblem) : false;
  const publicContent = currentProblem ? problemPublicContent(currentProblem) : {};
  const codeContent = isCode ? asCodeContent(publicContent) : null;
  const stem = currentProblem ? problemStem(currentProblem) : '';
  const options = currentProblem ? problemOptions(currentProblem) : [];
  const blanks = currentProblem ? problemBlanks(currentProblem) : [];
  const testcaseCode = currentProblem ? buildPublicTestsPython(currentProblem) : '';

  useEffect(() => {
    if (!orderedIds.includes(currentId) && orderedIds[0]) {
      setCurrentId(orderedIds[0]);
    }
  }, [currentId, orderedIds]);

  useEffect(() => {
    if (!currentProblem) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setFeedback(null);
    setRightTab(problemIsCode(currentProblem) ? 'code' : 'answer');
    void (async () => {
      try {
        const repository = await getLocalRepository();
        const nextDocument = await repository.loadProblemDocument(currentProblem.id);
        if (!alive) return;
        setDocument(nextDocument);
        setAnswer(restoreAnswerFromAttempt(currentProblem, nextDocument));
      } catch (cause) {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setDocument(null);
        setAnswer(emptyAnswerForProblem(currentProblem));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [currentProblem]);

  const goRelative = useCallback(
    (delta: number) => {
      const nextIndex = currentIndex + delta;
      if (nextIndex < 0 || nextIndex >= orderedIds.length) return;
      setCurrentId(orderedIds[nextIndex]);
    },
    [currentIndex, orderedIds],
  );

  const toggleChoice = useCallback(
    (optionId: string) => {
      if (!currentProblem) return;
      setFeedback(null);
      setAnswer((current) => {
        const base =
          current?.kind === 'choice' ? current : { kind: 'choice' as const, selectedOptionIds: [] };
        if (problemSelectionMode(currentProblem) === 'single') {
          return { kind: 'choice', selectedOptionIds: [optionId] };
        }
        const selected = new Set(base.selectedOptionIds);
        if (selected.has(optionId)) selected.delete(optionId);
        else selected.add(optionId);
        return { kind: 'choice', selectedOptionIds: [...selected] };
      });
    },
    [currentProblem],
  );

  const submitAnswer = useCallback(async () => {
    if (!currentProblem || !answer || !answerHasContent(answer) || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      let grade = gradeLocalProblem(currentProblem, answer);
      let aiGradingError: string | null = null;
      if (
        grade.status === 'pending' &&
        answer.kind === 'text' &&
        ['short_answer', 'calculation', 'proof'].includes(currentProblem.type)
      ) {
        const grading = recordValue(currentProblem.grading);
        const points =
          typeof grading.points === 'number' && grading.points > 0
            ? Math.min(100, Math.round(grading.points))
            : 10;
        try {
          const result = await gradeNativeAnswer({
            question: problemStem(currentProblem),
            userAnswer: answer.text,
            points,
            language: 'zh-CN',
            questionType: currentProblem.type === 'proof' ? 'proof' : 'short_answer',
            referenceAnswer: optionalText(grading.referenceAnswer),
            proof: optionalText(grading.proof),
            analysis: optionalText(grading.analysis),
            commentPrompt: optionalText(grading.commentPrompt),
          });
          const normalizedScore = Math.max(0, Math.min(1, result.score / points));
          grade = {
            status:
              normalizedScore >= 0.8 ? 'passed' : normalizedScore >= 0.4 ? 'partial' : 'failed',
            score: normalizedScore,
            feedback: result.comment,
            autoGraded: true,
          };
        } catch (cause) {
          aiGradingError = cause instanceof Error ? cause.message : String(cause);
          grade = {
            status: 'pending',
            score: null,
            feedback: `作答已保存；本次 AI 批改未完成：${aiGradingError}`,
            autoGraded: false,
          };
        }
      }
      const repository = await getLocalRepository();
      const saved = await repository.saveProblemAttempt({
        problemId: currentProblem.id,
        answer,
        status: grade.status === 'pending' ? 'pending' : grade.status,
        score: grade.score,
        feedback: grade.feedback,
        result: {
          feedback: grade.feedback,
          autoGraded: grade.autoGraded,
          gradingProvider: grade.autoGraded ? 'syntara-platform-ai' : 'local',
          aiGradingError,
        },
      });
      setDocument(saved.document);
      setFeedback(grade.feedback);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }, [answer, currentProblem, submitting]);

  if (!currentProblem || orderedIds.length === 0) {
    return (
      <section className="native-problem-practice">
        <header className="native-problem-practice-topbar">
          <button type="button" className="native-problem-practice-back" onClick={onBack}>
            <ChevronLeft size={16} />
            返回题库
          </button>
          <strong>没有可练习的题目</strong>
        </header>
      </section>
    );
  }

  const rightTabs: Array<{ id: RightTab; label: string; icon: typeof Code2 }> = isCode
    ? [
        { id: 'testcase', label: '测试', icon: FileCode2 },
        { id: 'code', label: '代码', icon: Code2 },
        { id: 'history', label: '记录', icon: Terminal },
      ]
    : [
        { id: 'answer', label: '作答', icon: SendHorizontal },
        { id: 'history', label: '记录', icon: Terminal },
      ];

  return (
    <section className="native-problem-practice" aria-label="本地做题器">
      <header className="native-problem-practice-topbar">
        <button type="button" className="native-problem-practice-back" onClick={onBack}>
          <ChevronLeft size={16} />
          返回题库
        </button>
        <span className="native-problem-practice-progress-chip">
          {currentIndex + 1}/{total}
        </span>
        <span className="native-problem-practice-source-chip">
          {problemTypeLabel(currentProblem.type)}
        </span>
        <strong className="native-problem-practice-title">
          <ProblemTitleText content={currentProblem.title} />
        </strong>
        <div className="native-problem-practice-nav">
          <button
            type="button"
            disabled={currentIndex <= 0}
            onClick={() => goRelative(-1)}
            aria-label="上一题"
          >
            <ChevronLeft size={16} />
            上一题
          </button>
          <button
            type="button"
            disabled={currentIndex >= total - 1}
            onClick={() => goRelative(1)}
            aria-label="下一题"
          >
            下一题
            <ChevronRight size={16} />
          </button>
        </div>
      </header>

      <div className="native-problem-practice-track">
        <div style={{ width: `${Math.round(((currentIndex + 1) / Math.max(total, 1)) * 100)}%` }} />
      </div>

      {loading ? (
        <div className="native-problem-practice-loading">
          <Loader2 size={18} className="spin" />
          正在从本机打开题目…
        </div>
      ) : (
        <div className="native-problem-practice-panes">
          <section className="native-problem-practice-pane">
            <header>
              <span>题目</span>
              <small>{difficultyLabel(currentProblem.difficulty)}</small>
            </header>
            <div className="native-problem-practice-pane-body native-problem-rich-scroll">
              {isCode && codeContent ? (
                <CodeProblemStatement content={codeContent} locale="zh-CN" />
              ) : (
                <>
                  <ProblemRichText
                    content={stem}
                    className="text-[15px] leading-7 text-slate-800"
                  />
                  <ProblemImageAssets content={publicContent as NotebookProblemPublicContent} />
                </>
              )}
              {document?.progress ? (
                <p className="native-problem-practice-progress-note">
                  <CheckCircle2 size={14} />
                  {document.progress.status} · 已作答 {document.progress.attemptedCount} 次
                </p>
              ) : (
                <p className="native-problem-practice-progress-note">尚未作答</p>
              )}
            </div>
          </section>

          <section className="native-problem-practice-pane">
            <header className="native-problem-practice-pane-tabs">
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                {rightTabs.map((tab) => {
                  const Icon = tab.icon;
                  const active = rightTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition',
                        active
                          ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-100'
                          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800',
                      )}
                      onClick={() => setRightTab(tab.id)}
                    >
                      <Icon size={13} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              <small>本地批改</small>
            </header>

            <div className="native-problem-practice-pane-body native-problem-rich-scroll">
              {rightTab === 'testcase' && isCode ? <CodeTestcasePanel code={testcaseCode} /> : null}

              {rightTab === 'code' && isCode && answer?.kind === 'code' ? (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  <CodeAnswerEditor
                    value={answer.code}
                    onChange={(code) => {
                      setFeedback(null);
                      setAnswer({ kind: 'code', code });
                    }}
                    locale="zh-CN"
                    placeholder="# 在此编写 Python 代码"
                    className="min-h-[360px]"
                  />
                  <footer className="native-problem-practice-footer">
                    <button
                      type="button"
                      className="native-problem-bank-primary"
                      disabled={!answerHasContent(answer) || submitting}
                      onClick={() => void submitAnswer()}
                    >
                      {submitting ? (
                        <Loader2 size={15} className="spin" />
                      ) : (
                        <SendHorizontal size={15} />
                      )}
                      提交作答
                    </button>
                    <p className="m-0 text-xs text-slate-500">
                      本机暂不执行公开测试；提交后会保存到本地作答记录。
                    </p>
                    {feedback ? (
                      <p className="native-problem-practice-feedback">{feedback}</p>
                    ) : null}
                    {error ? <p className="native-problem-practice-error">{error}</p> : null}
                  </footer>
                </div>
              ) : null}

              {rightTab === 'answer' && !isCode ? (
                <>
                  {currentProblem.type === 'choice' && answer?.kind === 'choice' ? (
                    <div className="native-problem-practice-choices">
                      {options.map((option) => {
                        const selected = answer.selectedOptionIds.includes(option.id);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            className={
                              selected
                                ? 'native-problem-choice native-problem-choice-selected'
                                : 'native-problem-choice'
                            }
                            onClick={() => toggleChoice(option.id)}
                          >
                            <strong>{option.id}</strong>
                            <span>
                              <ProblemRichText content={option.label} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {currentProblem.type === 'fill_blank' && answer?.kind === 'fill_blank' ? (
                    <div className="native-problem-practice-blanks">
                      {blanks.map((blank) => (
                        <label key={blank.id}>
                          <span>{blank.placeholder || blank.id}</span>
                          <input
                            value={answer.blanks[blank.id] || ''}
                            onChange={(event) => {
                              setFeedback(null);
                              const value = event.target.value;
                              setAnswer({
                                kind: 'fill_blank',
                                blanks: { ...answer.blanks, [blank.id]: value },
                              });
                            }}
                            placeholder="填写答案"
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}

                  {(currentProblem.type === 'short_answer' ||
                    currentProblem.type === 'calculation' ||
                    currentProblem.type === 'proof') &&
                  answer?.kind === 'text' ? (
                    <textarea
                      className="native-problem-practice-text"
                      value={answer.text}
                      onChange={(event) => {
                        setFeedback(null);
                        setAnswer({ kind: 'text', text: event.target.value });
                      }}
                      placeholder="写下你的解答（支持纯文本）"
                    />
                  ) : null}

                  <footer className="native-problem-practice-footer">
                    <button
                      type="button"
                      className="native-problem-bank-primary"
                      disabled={!answerHasContent(answer) || submitting}
                      onClick={() => void submitAnswer()}
                    >
                      {submitting ? (
                        <Loader2 size={15} className="spin" />
                      ) : (
                        <SendHorizontal size={15} />
                      )}
                      提交作答
                    </button>
                    {feedback ? (
                      <p className="native-problem-practice-feedback">{feedback}</p>
                    ) : null}
                    {error ? <p className="native-problem-practice-error">{error}</p> : null}
                  </footer>
                </>
              ) : null}

              {rightTab === 'history' ? (
                document?.attempts.length ? (
                  <section className="local-attempt-history">
                    <h3>本机作答记录</h3>
                    {document.attempts.slice(0, 8).map((attempt) => (
                      <article key={attempt.id}>
                        <span>{new Date(attempt.createdAt).toLocaleString()}</span>
                        <strong>{attempt.status}</strong>
                        <span>{attempt.score === null ? '未评分' : `${attempt.score}`}</span>
                      </article>
                    ))}
                  </section>
                ) : (
                  <p className="native-dialog-empty">还没有本机作答记录。</p>
                )
              ) : null}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
