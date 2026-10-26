import { isValidPhotoAnswerUpload } from '../../../../lib/problem-bank/photo-answer';
import { PhotoAnswerInput } from './problem-bank/photo-answer-input';
import type { PhotoAnswerImage } from '../data/local-problem-grading';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileCode2,
  FileText,
  Play,
  RotateCcw,
  SendHorizontal,
  Square,
  SquareFunction,
  Terminal,
} from 'lucide-react';

import {
  answerHasContent,
  buildPublicTestsPython,
  difficultyLabel,
  emptyAnswerForProblem,
  gradeLocalProblem,
  problemIsCode,
  problemOptions,
  problemPublicContent,
  problemSelectionMode,
  problemStem,
  problemTypeLabel,
  type LocalProblemAnswer,
} from '../data/local-problem-grading';
import { gradeNativeAnswer } from '../data/platform-api-client';
import { problemAiGradeRequest } from '../data/problem-ai-grading';
import { queueProblemAttempt } from '../data/problem-sync';
import { getLocalRepository } from '../data/repository';
import { accountStorageKey } from '../data/browser-runtime';
import {
  problemCodeDraftKey,
  readProblemCodeDraft,
  saveProblemCodeDraft,
} from '../data/problem-code-draft';
import { runPythonDebug } from '../data/python-debug-runner';
import type { LocalProblem, LocalProblemDocument } from '../domain/models';
import { cn } from '../lib/cn';
import { CodeAnswerEditor, highlightPython } from './problem-bank/code-answer-editor';
import { FormulaReferencePanel } from './problem-bank/formula-reference-panel';
import { PythonRunOutput, type PythonDebugResult } from './problem-bank/PythonRunOutput';
import { CodeProblemStatement } from './problem-bank/code-problem-statement';
import { ProblemImageAssets, ProblemRichText } from './problem-bank/problem-rich-text';
import type { NotebookProblemPublicContent } from './problem-bank/types';
import type { ProblemBankLaunch } from './ProblemBankPage';
import {
  SheetCell,
  STATUS_MARBLES,
  notifyProblemProgress,
  useProblemStatuses,
  type ProblemStatus,
} from './problem-bank/answer-sheet';
import { DIFFICULTY_MARBLES, marbleImages } from '../lib/learning-action-marbles';
import './course-pages.css';
import { GlassSpinner } from './GlassLoadMore';
import { LearningEmptyState } from './LearningEmptyState';
import { ContentLanguageSwitch } from './ContentLanguageSwitch';
import {
  hasBilingualProblem,
  localizeProblem,
  type ProblemContentLanguage,
} from '../lib/problem-language';

type ProblemPracticePageProps = {
  problems: LocalProblem[];
  launch: ProblemBankLaunch;
  onBack: () => void;
};

type RightTab = 'answer' | 'code' | 'history';

const PANE_RATIO_KEY = 'syntara.practice-pane-ratio';
const clampPaneRatio = (value: number) => Math.min(75, Math.max(25, value));

function readPaneRatio() {
  try {
    const stored = window.localStorage.getItem(PANE_RATIO_KEY);
    const value = stored === null ? 50 : Number(stored);
    return Number.isFinite(value) ? clampPaneRatio(value) : 50;
  } catch {
    return 50;
  }
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
  if (record.kind === 'code' && typeof record.code === 'string') {
    return { kind: 'code', code: record.code };
  }
  if (record.kind === 'text' && typeof record.text === 'string') {
    return {
      kind: 'text',
      text: record.text,
      images: Array.isArray(record.images)
        ? record.images.filter((image): image is PhotoAnswerImage =>
            Boolean(
              image &&
              typeof image === 'object' &&
              isValidPhotoAnswerUpload(image as PhotoAnswerImage),
            ),
          )
        : [],
    };
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

/** 一组题都做过了：每题一颗弹珠落进玻璃罐，颜色就是结果。 */
function PracticeFinish({
  title,
  ids,
  statuses,
  onBack,
  onStay,
}: {
  title?: string;
  ids: string[];
  statuses: Map<string, ProblemStatus>;
  onBack: () => void;
  onStay: () => void;
}) {
  const passed = ids.filter((id) => statuses.get(id) === 'passed').length;
  const shown = ids.slice(0, 36);
  return (
    <div className="pp-finish" role="dialog" aria-label="这一组刷完了">
      <div className="pp-finish-card">
        <div className="pp-finish-jar" aria-hidden>
          {shown.map((id, index) => (
            <img
              key={id}
              src={marbleImages[STATUS_MARBLES[statuses.get(id) ?? 'pending']]}
              alt=""
              style={{ animationDelay: `${120 + index * 60}ms` }}
            />
          ))}
        </div>
        <strong>{title ? `${title} 刷完了` : '这一组刷完了'}</strong>
        <small>
          通过 {passed} / {ids.length}
        </small>
        <div className="pp-finish-actions">
          <button type="button" onClick={onStay}>
            再看看
          </button>
          <button type="button" className="is-primary" onClick={onBack}>
            回题库
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProblemPracticePage({ problems, launch, onBack }: ProblemPracticePageProps) {
  const [language, setLanguage] = useState<ProblemContentLanguage>(launch.language ?? 'zh-CN');
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
  const textAnswerRef = useRef<HTMLTextAreaElement>(null);
  const [answer, setAnswer] = useState<LocalProblemAnswer | null>(null);
  const draftRef = useRef<{ key: string; code: string; dirty: boolean } | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const saveDraft = useCallback(() => {
    const draft = draftRef.current;
    if (!draft?.dirty) return;
    try {
      saveProblemCodeDraft(window.localStorage, draft.key, draft.code);
      draft.dirty = false;
      setDraftError(null);
    } catch {
      setDraftError('代码草稿保存失败，请保留当前代码后重试。');
    }
  }, []);
  useEffect(() => {
    window.addEventListener('pagehide', saveDraft);
    return () => window.removeEventListener('pagehide', saveDraft);
  }, [saveDraft]);
  const [loading, setLoading] = useState(true);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('answer');
  const [leftTab, setLeftTab] = useState<'description' | 'testcase' | 'output' | 'formulas'>(
    'description',
  );
  const [debugResult, setDebugResult] = useState<PythonDebugResult>({
    phase: 'idle',
    output: '',
    error: '',
  });
  const cancelDebugRef = useRef<(() => void) | null>(null);
  const [debugCode, setDebugCode] = useState('');
  const debugSequence = useRef(0);
  const debugRunning = debugResult.phase === 'loading' || debugResult.phase === 'running';
  const [statuses, setStatuses] = useProblemStatuses(problems[0]?.courseId ?? '', launch);
  const [justGraded, setJustGraded] = useState<ProblemStatus | null>(null);
  const [finish, setFinish] = useState<'hidden' | 'shown' | 'dismissed'>('hidden');
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetAnchorRef = useRef<HTMLDivElement>(null);
  const sheetTriggerRef = useRef<HTMLButtonElement>(null);
  const autoNextRef = useRef<number | null>(null);
  const [paneRatio, setPaneRatio] = useState(readPaneRatio);
  const [resizing, setResizing] = useState(false);
  const panesRef = useRef<HTMLDivElement>(null);
  const statementId = useId();
  const photoContainerId = useId();

  const resizePanes = useCallback((value: number) => {
    const pane = panesRef.current;
    const available = pane ? pane.clientWidth - 36 - 14 : 0;
    const minimum = available > 0 ? Math.max(25, (280 / available) * 100) : 25;
    const next = Math.min(100 - minimum, Math.max(minimum, clampPaneRatio(value)));
    setPaneRatio(next);
    try {
      window.localStorage.setItem(PANE_RATIO_KEY, String(next));
    } catch {
      // Resizing still works when browser storage is unavailable.
    }
  }, []);

  const resizeAtPointer = useCallback(
    (clientX: number) => {
      const pane = panesRef.current;
      if (!pane) return;
      const rect = pane.getBoundingClientRect();
      const available = rect.width - 36 - 14;
      if (available > 0) resizePanes(((clientX - rect.left - 18 - 7) / available) * 100);
    },
    [resizePanes],
  );

  const currentIndex = Math.max(0, orderedIds.indexOf(currentId));
  const currentProblem = problemMap.get(currentId) || null;
  const displayedProblem = useMemo(
    () => (currentProblem ? localizeProblem(currentProblem, language) : null),
    [currentProblem, language],
  );
  const total = orderedIds.length;
  const isCode = currentProblem ? problemIsCode(currentProblem) : false;
  const publicContent = displayedProblem ? problemPublicContent(displayedProblem) : {};
  const codeContent = isCode ? asCodeContent(publicContent) : null;
  const stem = displayedProblem ? problemStem(displayedProblem) : '';
  const options = displayedProblem ? problemOptions(displayedProblem) : [];
  const testcaseCode = currentProblem ? buildPublicTestsPython(currentProblem) : '';

  useEffect(() => {
    debugSequence.current += 1;
    cancelDebugRef.current?.();
    cancelDebugRef.current = null;
    setDebugResult({ phase: 'idle', output: '', error: '' });
    return () => {
      debugSequence.current += 1;
      cancelDebugRef.current?.();
      cancelDebugRef.current = null;
    };
  }, [currentId]);

  const runDebug = () => {
    if (debugRunning) {
      cancelDebugRef.current?.();
      cancelDebugRef.current = null;
      return;
    }
    if (answer?.kind !== 'code') return;
    saveDraft();
    const sequence = ++debugSequence.current;
    setDebugCode(answer.code);
    setDebugResult({ phase: 'loading', output: '', error: '' });
    setLeftTab('output');
    try {
      cancelDebugRef.current = runPythonDebug(answer.code, (event) => {
        if (sequence !== debugSequence.current) return;
        if (event.type === 'output') {
          setDebugResult((previous) => ({ ...previous, output: previous.output + event.text }));
        } else if (event.type === 'ready') {
          setDebugResult((previous) => ({ ...previous, phase: 'running' }));
        } else {
          cancelDebugRef.current = null;
          const error =
            event.type === 'done'
              ? (event.error ?? '')
              : event.type === 'timeout'
                ? event.message
                : event.type === 'output-limit'
                  ? '输出超过 64 KB，已停止。'
                  : '';
          setDebugResult((previous) => ({
            ...previous,
            error,
            phase: event.type === 'stopped' ? 'stopped' : error ? 'error' : 'success',
          }));
        }
      });
    } catch (cause) {
      setDebugResult({
        phase: 'error',
        output: '',
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  useEffect(() => {
    if (!orderedIds.includes(currentId) && orderedIds[0]) {
      setCurrentId(orderedIds[0]);
    }
  }, [currentId, orderedIds]);

  useEffect(() => {
    if (!currentProblem) return;
    let alive = true;
    draftRef.current = null;
    const draftKey = problemCodeDraftKey(
      accountStorageKey('syntara.problem-code-draft.v1'),
      currentProblem.courseId,
      currentProblem.id,
    );
    const restoreAnswer = (nextDocument: LocalProblemDocument | null) => {
      let next = restoreAnswerFromAttempt(currentProblem, nextDocument);
      if (next.kind === 'code') {
        try {
          const code = readProblemCodeDraft(window.localStorage, draftKey);
          if (code !== null) next = { kind: 'code', code };
        } catch {
          setDraftError('无法读取代码草稿，请检查本机存储是否可用。');
        }
        draftRef.current = { key: draftKey, code: next.code, dirty: false };
      }
      setAnswer(next);
    };
    setLoading(true);
    setError(null);
    setFeedback(null);
    setRightTab(problemIsCode(currentProblem) ? 'code' : 'answer');
    setLeftTab('description');
    setPhotoBusy(false);
    void (async () => {
      try {
        const repository = await getLocalRepository();
        const nextDocument = await repository.loadProblemDocument(currentProblem.id);
        if (!alive) return;
        setDocument(nextDocument);
        restoreAnswer(nextDocument);
      } catch (cause) {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setDocument(null);
        restoreAnswer(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      saveDraft();
    };
  }, [currentProblem, saveDraft]);

  const goRelative = useCallback(
    (delta: number) => {
      const nextIndex = currentIndex + delta;
      if (nextIndex < 0 || nextIndex >= orderedIds.length) return;
      setSheetOpen(false);
      setCurrentId(orderedIds[nextIndex]);
    },
    [currentIndex, orderedIds],
  );

  useEffect(() => {
    if (!sheetOpen) return;
    const current = sheetRef.current?.querySelector<HTMLButtonElement>('.is-current');
    current?.focus({ preventScroll: true });
    current?.scrollIntoView({ block: 'nearest' });
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !sheetAnchorRef.current?.contains(event.target)) {
        setSheetOpen(false);
      }
    };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [sheetOpen]);

  // 换题时取消还没跑完的自动下一题。
  useEffect(() => {
    setJustGraded(null);
    if (autoNextRef.current) window.clearTimeout(autoNextRef.current);
    autoNextRef.current = null;
  }, [currentId]);
  useEffect(
    () => () => {
      if (autoNextRef.current) window.clearTimeout(autoNextRef.current);
    },
    [],
  );

  /** 下一题：从当前往后第一道还没通过的，没有就按顺序下一道。 */
  const nextTarget = useCallback(
    (fromStatuses: Map<string, ProblemStatus>) => {
      const after = orderedIds.slice(currentIndex + 1);
      return after.find((id) => fromStatuses.get(id) !== 'passed') ?? after[0] ?? null;
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
    saveDraft();
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
        const request = problemAiGradeRequest(
          currentProblem,
          answer.text || '请查看附图中的作答。',
        );
        const points = request.points;
        try {
          const result = await gradeNativeAnswer({
            ...request,
            question: stem,
            language,
            images: answer.images,
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
      const status: ProblemStatus = grade.status === 'pending' ? 'pending' : grade.status;
      const nextStatuses = new Map(statuses);
      nextStatuses.set(currentProblem.id, status);
      setStatuses(nextStatuses);
      notifyProblemProgress();
      setJustGraded(status);
      // 这一组每题都做过了：弹珠落进罐子。
      if (finish === 'hidden' && orderedIds.every((id) => nextStatuses.has(id))) {
        setFinish('shown');
      } else if (status === 'passed') {
        // 做对了就自动进下一题；做错的留在这里看反馈。
        const target = nextTarget(nextStatuses);
        if (target) {
          autoNextRef.current = window.setTimeout(() => setCurrentId(target), 1400);
        }
      }
      // 网页课程的作答同步到网页题库；传不上去会排队，下次打开课程再传。
      void queueProblemAttempt(repository, currentProblem.courseId, saved.attempt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }, [
    answer,
    currentProblem,
    finish,
    nextTarget,
    orderedIds,
    saveDraft,
    setStatuses,
    statuses,
    submitting,
    language,
    stem,
  ]);

  if (!currentProblem || orderedIds.length === 0) {
    return (
      <section className="native-problem-practice">
        <header className="pp-header">
          <button
            type="button"
            className="phone-glass-button"
            onClick={onBack}
            aria-label="返回题库"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="pp-progress">
            <strong>没有可练习的题目</strong>
          </div>
        </header>
      </section>
    );
  }

  const rightTabs: Array<{ id: RightTab; label: string; icon: typeof Code2 }> = isCode
    ? [
        { id: 'code', label: '代码', icon: Code2 },
        { id: 'history', label: '记录', icon: Terminal },
      ]
    : [
        { id: 'answer', label: '作答', icon: SendHorizontal },
        { id: 'history', label: '记录', icon: Terminal },
      ];

  return (
    <section className="native-problem-practice" aria-label="本地做题器">
      <header className="pp-header">
        <button type="button" className="phone-glass-button" onClick={onBack} aria-label="返回题库">
          <ChevronLeft size={22} />
        </button>
        <div className="pp-header-context">
          <div
            className="pp-question-picker"
            ref={sheetAnchorRef}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && sheetOpen) {
                event.preventDefault();
                event.stopPropagation();
                setSheetOpen(false);
                sheetTriggerRef.current?.focus();
              }
            }}
          >
            <button
              ref={sheetTriggerRef}
              type="button"
              className="pp-question-trigger"
              aria-expanded={sheetOpen}
              aria-controls={sheetId}
              aria-label={'第 ' + (currentIndex + 1) + ' 题，共 ' + total + ' 题，答题卡'}
              onClick={() => setSheetOpen((open) => !open)}
            >
              {launch.title ? <span className="pp-question-chapter">{launch.title}</span> : null}
              <span className="pp-question-count">
                第 {currentIndex + 1} / {total} 题
              </span>
              <ChevronDown size={16} aria-hidden />
            </button>
            {sheetOpen ? (
              <div className="pp-sheet-popover" id={sheetId}>
                <div className="pp-sheet-heading">
                  <strong>答题卡</strong>
                  <span>
                    {orderedIds.filter((id) => statuses.get(id) === 'passed').length} / {total} 通过
                  </span>
                </div>
                <div className="pp-sheet-grid" ref={sheetRef} role="list" aria-label="答题卡">
                  {orderedIds.map((id, index) => (
                    <span key={id} role="listitem">
                      <SheetCell
                        size="sm"
                        number={launch.numbers?.[id] ?? index + 1}
                        status={statuses.get(id)}
                        current={id === currentId}
                        title={problemMap.get(id)?.title}
                        onClick={() => {
                          setCurrentId(id);
                          setSheetOpen(false);
                          sheetTriggerRef.current?.focus();
                        }}
                      />
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <span
            className="pp-progress-track"
            role="progressbar"
            aria-label="当前题目位置"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={currentIndex + 1}
          >
            <span style={{ width: Math.round(((currentIndex + 1) / total) * 100) + '%' }}>
              <img src={marbleImages[DIFFICULTY_MARBLES[currentProblem.difficulty]]} alt="" />
            </span>
          </span>
        </div>
        <div className="pp-header-tools">
          {hasBilingualProblem(currentProblem) ? (
            <ContentLanguageSwitch
              label="题目语言"
              value={language}
              onChange={setLanguage}
              busy={submitting}
            />
          ) : null}
          <div className="pp-nav">
            <button
              type="button"
              className="phone-glass-button"
              disabled={currentIndex <= 0}
              onClick={() => goRelative(-1)}
              aria-label="上一题"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              className="phone-glass-button"
              disabled={currentIndex >= total - 1}
              onClick={() => goRelative(1)}
              aria-label="下一题"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </header>

      {finish === 'shown' ? (
        <PracticeFinish
          title={launch.title}
          ids={orderedIds}
          statuses={statuses}
          onBack={onBack}
          onStay={() => setFinish('dismissed')}
        />
      ) : null}

      {loading ? (
        <div className="native-problem-practice-loading">
          <GlassSpinner size={18} />
          正在从本机打开题目…
        </div>
      ) : (
        <div
          ref={panesRef}
          className={cn(
            'native-problem-practice-panes pp-resizable-panes',
            resizing && 'is-resizing',
          )}
          style={
            {
              '--pp-left-size': `${paneRatio}fr`,
              '--pp-right-size': `${100 - paneRatio}fr`,
            } as CSSProperties
          }
        >
          <section className="native-problem-practice-pane" id={statementId}>
            {isCode ? (
              <header className="native-problem-practice-pane-tabs pp-statement-tabs">
                <div className="pp-tabs" role="group" aria-label="题目参考内容">
                  <button
                    type="button"
                    className={cn('pp-tab', leftTab === 'description' && 'is-active')}
                    aria-pressed={leftTab === 'description'}
                    onClick={() => setLeftTab('description')}
                  >
                    <FileText size={13} />
                    描述
                  </button>
                  <button
                    type="button"
                    className={cn('pp-tab', leftTab === 'testcase' && 'is-active')}
                    aria-pressed={leftTab === 'testcase'}
                    onClick={() => setLeftTab('testcase')}
                  >
                    <FileCode2 size={13} />
                    测试
                  </button>
                  <button
                    type="button"
                    className={cn('pp-tab', leftTab === 'output' && 'is-active')}
                    aria-pressed={leftTab === 'output'}
                    onClick={() => setLeftTab('output')}
                  >
                    <Terminal size={13} />
                    运行结果
                  </button>
                </div>
                <small className="pp-statement-difficulty">
                  {difficultyLabel(currentProblem.difficulty)}
                </small>
              </header>
            ) : answer?.kind === 'text' ? (
              <header className="native-problem-practice-pane-tabs pp-statement-tabs">
                <div className="pp-tabs" role="group" aria-label="题目参考内容">
                  <button
                    type="button"
                    className={cn('pp-tab', leftTab === 'description' && 'is-active')}
                    aria-pressed={leftTab === 'description'}
                    onClick={() => setLeftTab('description')}
                  >
                    <FileText size={13} />
                    描述
                  </button>
                  <button
                    type="button"
                    className={cn('pp-tab', leftTab === 'formulas' && 'is-active')}
                    aria-pressed={leftTab === 'formulas'}
                    onClick={() => setLeftTab('formulas')}
                  >
                    <SquareFunction size={13} />
                    公式表
                  </button>
                </div>
                <small className="pp-statement-difficulty">
                  {difficultyLabel(currentProblem.difficulty)}
                </small>
              </header>
            ) : (
              <header className="pp-pane-head">
                <img src={marbleImages[DIFFICULTY_MARBLES[currentProblem.difficulty]]} alt="" />
                <span>{problemTypeLabel(currentProblem.type)}</span>
                <small>{difficultyLabel(currentProblem.difficulty)}</small>
              </header>
            )}
            <div className="native-problem-practice-pane-body native-problem-rich-scroll">
              {leftTab === 'formulas' && answer?.kind === 'text' ? (
                <FormulaReferencePanel
                  locale={language}
                  onInsert={(latex) => {
                    const input = textAnswerRef.current;
                    const start = input?.selectionStart ?? answer.text.length;
                    const end = input?.selectionEnd ?? start;
                    const scrollTop = input?.scrollTop ?? 0;
                    setAnswer({
                      ...answer,
                      text: answer.text.slice(0, start) + latex + answer.text.slice(end),
                    });
                    setFeedback(null);
                    setRightTab('answer');
                    requestAnimationFrame(() => {
                      const editor = textAnswerRef.current;
                      editor?.focus({ preventScroll: true });
                      editor?.setSelectionRange(start + latex.length, start + latex.length);
                      if (editor) editor.scrollTop = scrollTop;
                    });
                  }}
                />
              ) : isCode && codeContent ? (
                leftTab === 'output' ? (
                  <PythonRunOutput
                    result={debugResult}
                    stale={
                      debugResult.phase !== 'idle' &&
                      answer?.kind === 'code' &&
                      answer.code !== debugCode
                    }
                  />
                ) : leftTab === 'testcase' ? (
                  <CodeTestcasePanel code={testcaseCode} />
                ) : (
                  <CodeProblemStatement content={codeContent} locale={language} />
                )
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
              ) : null}
            </div>
          </section>

          <div
            className="pp-pane-resizer"
            role="separator"
            tabIndex={0}
            aria-label="调整题目区与作答区宽度"
            aria-orientation="vertical"
            aria-controls={statementId}
            aria-valuemin={25}
            aria-valuemax={75}
            aria-valuenow={Math.round(paneRatio)}
            aria-valuetext={`题目区 ${Math.round(paneRatio)}%，作答区 ${Math.round(100 - paneRatio)}%`}
            title="拖动调整宽度，双击恢复对半分"
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              setResizing(true);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                resizeAtPointer(event.clientX);
              }
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              setResizing(false);
            }}
            onPointerCancel={() => setResizing(false)}
            onLostPointerCapture={() => setResizing(false)}
            onDoubleClick={() => resizePanes(50)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowLeft'
                  ? paneRatio - 5
                  : event.key === 'ArrowRight'
                    ? paneRatio + 5
                    : event.key === 'Home'
                      ? 25
                      : event.key === 'End'
                        ? 75
                        : event.key === 'Enter'
                          ? 50
                          : null;
              if (next !== null) {
                event.preventDefault();
                resizePanes(next);
              }
            }}
          >
            <span aria-hidden />
          </div>

          <section className="native-problem-practice-pane">
            <header className="native-problem-practice-pane-tabs pp-answer-header">
              <div className="pp-tabs">
                {rightTabs.map((tab) => {
                  const Icon = tab.icon;
                  const active = rightTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={cn('pp-tab', active && 'is-active')}
                      aria-pressed={active}
                      onClick={() => setRightTab(tab.id)}
                    >
                      <Icon size={13} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              {rightTab !== 'history' ? (
                <div className="pp-header-actions">
                  {answer?.kind === 'text' ? (
                    <PhotoAnswerInput
                      containerId={photoContainerId}
                      key={currentId}
                      images={answer.images ?? []}
                      disabled={loading || submitting}
                      onBusyChange={setPhotoBusy}
                      onChange={(images) => {
                        setAnswer((current) =>
                          current?.kind === 'text' ? { ...current, images } : current,
                        );
                        setFeedback(null);
                      }}
                    />
                  ) : null}
                  {isCode ? (
                    <button
                      type="button"
                      className="pp-run-button pp-reset-button"
                      title="恢复起始代码"
                      disabled={loading || submitting || debugRunning}
                      onClick={() => {
                        const initial = emptyAnswerForProblem(currentProblem);
                        if (initial.kind !== 'code') return;
                        setAnswer(initial);
                        if (draftRef.current) {
                          draftRef.current.code = initial.code;
                          draftRef.current.dirty = true;
                        }
                        saveDraft();
                        setFeedback(null);
                        setError(null);
                        setDebugResult({ phase: 'idle', output: '', error: '' });
                      }}
                    >
                      <RotateCcw size={13} />
                      重置
                    </button>
                  ) : null}
                  {isCode ? (
                    <button
                      type="button"
                      className="pp-run-button"
                      disabled={loading || submitting || answer?.kind !== 'code'}
                      onClick={runDebug}
                    >
                      {debugRunning ? <Square size={13} /> : <Play size={13} />}
                      {debugRunning ? '停止' : '运行'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="pp-submit pp-header-submit"
                    disabled={
                      loading ||
                      !answerHasContent(answer) ||
                      submitting ||
                      debugRunning ||
                      photoBusy
                    }
                    onClick={() => void submitAnswer()}
                  >
                    {submitting ? <GlassSpinner size={14} /> : <SendHorizontal size={14} />}
                    提交作答
                  </button>
                </div>
              ) : null}
            </header>

            {draftError ? (
              <p role="alert" className="native-problem-practice-error">
                {draftError}
              </p>
            ) : null}
            <div
              className={cn(
                'native-problem-practice-pane-body native-problem-rich-scroll',
                rightTab === 'code' && isCode && 'pp-code-body',
                rightTab === 'answer' && answer?.kind === 'text' && 'pp-text-body',
              )}
            >
              {rightTab === 'code' && isCode && answer?.kind === 'code' ? (
                <div className="pp-code-workspace">
                  <CodeAnswerEditor
                    value={answer.code}
                    onChange={(code) => {
                      setFeedback(null);
                      if (draftRef.current) {
                        draftRef.current.code = code;
                        draftRef.current.dirty = true;
                      }
                      setAnswer({ kind: 'code', code });
                    }}
                    locale="zh-CN"
                    placeholder="# 在此编写 Python 代码"
                    className="pp-code-editor"
                  />
                  <footer className="native-problem-practice-footer">
                    {justGraded && currentIndex < total - 1 ? (
                      <button
                        type="button"
                        className={`pp-next is-${justGraded}`}
                        onClick={() => {
                          const target = nextTarget(statuses);
                          if (target) setCurrentId(target);
                        }}
                      >
                        <img src={marbleImages[STATUS_MARBLES[justGraded]]} alt="" />
                        下一题
                        <ChevronRight size={15} />
                      </button>
                    ) : null}
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
                            <strong>
                              {selected ? <img src={marbleImages.blue} alt="" /> : option.id}
                            </strong>
                            <span>
                              <ProblemRichText content={option.label} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {answer?.kind === 'text' ? (
                    <div id={photoContainerId} className="pp-photo-container" />
                  ) : null}
                  {(currentProblem.type === 'short_answer' ||
                    currentProblem.type === 'calculation' ||
                    currentProblem.type === 'proof') &&
                  answer?.kind === 'text' ? (
                    <textarea
                      ref={textAnswerRef}
                      aria-label="解答输入框"
                      className="native-problem-practice-text"
                      value={answer.text}
                      onChange={(event) => {
                        setFeedback(null);
                        setAnswer({ ...answer, text: event.target.value });
                      }}
                      placeholder="写下你的解答，公式用 $…$"
                    />
                  ) : null}
                  {answer?.kind === 'text' && /\$|\\\(|\\\[/.test(answer.text) ? (
                    <div className="pp-answer-preview">
                      <small>预览</small>
                      <ProblemRichText content={answer.text} />
                    </div>
                  ) : null}

                  <footer className="native-problem-practice-footer">
                    {justGraded && currentIndex < total - 1 ? (
                      <button
                        type="button"
                        className={`pp-next is-${justGraded}`}
                        onClick={() => {
                          const target = nextTarget(statuses);
                          if (target) setCurrentId(target);
                        }}
                      >
                        <img src={marbleImages[STATUS_MARBLES[justGraded]]} alt="" />
                        下一题
                        <ChevronRight size={15} />
                      </button>
                    ) : null}
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
                        {Array.isArray(attempt.answer.images) ? (
                          <div className="pp-history-photos">
                            {attempt.answer.images
                              .filter((image): image is PhotoAnswerImage =>
                                Boolean(
                                  image &&
                                  typeof image === 'object' &&
                                  isValidPhotoAnswerUpload(image as PhotoAnswerImage),
                                ),
                              )
                              .map((image) => (
                                <img key={image.id} src={image.dataUrl} alt={image.name} />
                              ))}
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </section>
                ) : (
                  <LearningEmptyState title="还没有本机作答记录" compact />
                )
              ) : null}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
