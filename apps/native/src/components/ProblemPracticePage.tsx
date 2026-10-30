import { prepareHandwritingAnswers, prepareProblemHandwriting } from '../data/handwriting-answer';
import { HandwritingAnswerInput } from './problem-bank/handwriting-answer-input';
import { clearHandwritingDrafts, handwritingDraftKey } from '../data/handwriting-draft';
import { visibleCodeTests } from '../../../../lib/problem-bank/visible-code-tests';
import { fillBlankPrompt } from '../../../../lib/problem-bank/fill-blank-presentation';
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
  Eye,
  Play,
  PenLine,
  RotateCcw,
  SendHorizontal,
  Square,
  SquareFunction,
  Terminal,
  X,
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
import {
  aggregatePartResults,
  capPartScore,
  gradeLocalPart,
  isAutoGradedPart,
  isMultipartProblem,
  multipartParts,
  partAnswerHasContent,
  partDraftIsDirty,
  partBlankIds,
  partQuestionText,
  partShares,
  PART_SUBMISSION_LIMIT,
  type LocalPartAnswer,
  type LocalPartResult,
} from '../data/multipart-problem';
import {
  gradeNativeAnswer,
  gradeNativeCode,
  getNativeHiddenTests,
  runNativeHiddenTests,
  type RevealedHiddenTests,
} from '../data/platform-api-client';
import { isPlatformCourse } from '../data/chat-sync';
import { pendingCodeSubmission, clearPendingCodeSubmission } from '../data/code-submission-id';
import { problemAiGradeRequest } from '../data/problem-ai-grading';
import { queueProblemAttempt } from '../data/problem-sync';
import { getLocalRepository } from '../data/repository';
import { accountStorageKey } from '../data/browser-runtime';
import {
  problemCodeDraftKey,
  readProblemCodeDraftRecord,
  saveProblemCodeDraft,
} from '../data/problem-code-draft';
import { runPythonDebug } from '../data/python-debug-runner';
import type { LocalProblem, LocalProblemDocument } from '../domain/models';
import { cn } from '../lib/cn';
import { CodeAnswerEditor, highlightCode } from './problem-bank/code-answer-editor';
import { isRacketLanguage } from '../../../../lib/problem-bank/racket-editor';
import type { ServerCodeTestRun } from './problem-bank/native-code-tests';
import type { BrowserScriptResult } from '../../../../lib/client/browser-python';
import { NativeCodeSlots } from './problem-bank/native-code-slots';
import { NativeCodePlayground } from './problem-bank/native-code-playground';
import { NativeTableAnswer } from './problem-bank/native-table-answer';
import { gradeNativeTable } from '../data/table-grading';
import type {
  NotebookProblemPublicTable,
  NotebookProblemGradingTable,
} from '../../../../lib/problem-bank/schema';
import { codeSlotTemplateFor } from '../../../../lib/problem-bank/code-slots';
import type { NotebookCodeSlot, NotebookCodeFile } from '../../../../lib/problem-bank/schema';
import { FormulaReferencePanel } from './problem-bank/formula-reference-panel';
import { PythonRunOutput, type PythonDebugResult } from './problem-bank/PythonRunOutput';
import { CodeProblemStatement } from './problem-bank/code-problem-statement';
import { ProblemImageAssets, ProblemRichText } from './problem-bank/problem-rich-text';
import type { NotebookProblemPublicContent } from './problem-bank/types';
import type { ProblemBankLaunch } from './ProblemBankPage';
import { adjacentPracticeProblem } from '../data/problem-practice-scope';
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
import {
  usePartFormulaEditor,
  type PartFormulaHandle,
} from '../../../../lib/problem-bank/use-part-formula-editor';
import {
  MultipartPractice,
  PartSubmitButton,
  type PartCodeRun,
} from './problem-bank/multipart-practice';
import { LearningEmptyState } from './LearningEmptyState';
import { NativeToast } from './NativeToast';
import { submissionFeedback, type SubmissionFeedback } from '../lib/submission-feedback';
import { ContentLanguageSwitch } from './ContentLanguageSwitch';
import { problemSolution } from '../lib/problem-solution';
import { syncAppMemories } from '../data/course-sync';
import {
  saveProblemLearningSnapshot,
  solutionReminderKey,
  skipsSolutionReminder,
  rememberSolutionReminder,
  type ProblemLearningEvent,
} from '../data/problem-learning-snapshot';
import { ProblemSolutionConfirmation } from './problem-bank/ProblemSolutionConfirmation';
import {
  hasBilingualProblem,
  localizeProblem,
  type ProblemContentLanguage,
} from '../lib/problem-language';

type ProblemPracticePageProps = {
  problems: LocalProblem[];
  launch: ProblemBankLaunch;
  onBack: () => void;
  loadHiddenTests?: (problemId: string, part?: string) => Promise<RevealedHiddenTests>;
};

type RightTab = 'answer' | 'code' | 'tests' | 'history' | 'solution';

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

function useStackedPanes(): boolean {
  const query = '(max-width: 980px)';
  const [stacked, setStacked] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setStacked(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return stacked;
}

function latestPartState(document: LocalProblemDocument | null): {
  answers: Record<string, LocalPartAnswer>;
  results: LocalPartResult[];
} {
  const latest = document?.attempts[0];
  const graded = document?.attempts.find(
    (a) =>
      a.result?.event !== 'solution_viewed' &&
      a.result?.event !== 'hidden_tests_viewed' &&
      a.result?.event !== 'answer_reset' &&
      Array.isArray(a.result?.parts),
  );
  const answer = recordValue(latest?.answer);
  const result = recordValue(graded?.result);
  return {
    answers:
      answer.kind === 'parts' ? (recordValue(answer.parts) as Record<string, LocalPartAnswer>) : {},
    results: Array.isArray(result.parts) ? (result.parts as LocalPartResult[]) : [],
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
  if (record.kind === 'parts')
    return { kind: 'parts', parts: recordValue(record.parts) as Record<string, LocalPartAnswer> };
  if (problem.type === 'fill_blank') {
    return record.blanks && typeof record.blanks === 'object'
      ? { kind: 'blanks', blanks: record.blanks as Record<string, string> }
      : emptyAnswerForProblem(problem);
  }
  if (record.kind === 'table' && record.cells && typeof record.cells === 'object')
    return { kind: 'table', cells: record.cells as Record<string, string> };
  if (record.kind === 'code' && typeof record.code === 'string') {
    return { kind: 'code', code: record.code };
  }
  if (record.kind === 'text' && typeof record.text === 'string') {
    return {
      kind: 'text',
      text: record.text,
      // Submitted images remain in history; photo answers are submitted directly.
      images: [],
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
    files: Array.isArray(content.files) ? (content.files as NotebookCodeFile[]) : [],
    stdin: typeof content.stdin === 'string' ? content.stdin : undefined,
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

function CodeTestcasePanel({ code, language }: { code: string; language?: string }) {
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
          <code>{highlightCode(code, language)}</code>
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

export function ProblemPracticePage({
  problems,
  launch,
  onBack,
  loadHiddenTests,
}: ProblemPracticePageProps) {
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
  const partFormulaRef = useRef<PartFormulaHandle>(null);
  const [partNavigationTarget, setPartNavigationTarget] = useState<HTMLDivElement | null>(null);
  const [partSelection, setPartSelection] = useState<{ problemId: string; label: string } | null>(
    null,
  );
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
  const [handwritingReset, setHandwritingReset] = useState(0);
  const [handwritingModes, setHandwritingModes] = useState<Record<string, boolean>>({});
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [solutionConfirm, setSolutionConfirm] = useState(false);
  const [hiddenConfirm, setHiddenConfirm] = useState<string | null>(null);
  const [revealedHiddenTests, setRevealedHiddenTests] = useState<
    Record<string, RevealedHiddenTests>
  >({});
  const [solutionSeen, setSolutionSeen] = useState(false);
  const [solutionError, setSolutionError] = useState<string | null>(null);
  const [solutionNotice, setSolutionNotice] = useState<string | null>(null);
  const snapshotSequence = useRef(0);
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
  const [submissionNotice, setSubmissionNotice] = useState<SubmissionFeedback | null>(null);
  const stackedPanes = useStackedPanes();
  const [partDrafts, setPartDrafts] = useState<Record<string, LocalPartAnswer>>({});
  const [stemCollapsed, setStemCollapsed] = useState(true);
  const [paneRatio, setPaneRatio] = useState(readPaneRatio);
  const [resizing, setResizing] = useState(false);
  const panesRef = useRef<HTMLDivElement>(null);
  const statementId = useId();
  const handwritingHeaderId = useId();

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
  const chapterTitle = launch.title || displayedProblem?.chapterName || undefined;
  const total = orderedIds.length;
  const isCode = currentProblem ? problemIsCode(currentProblem) : false;
  const publicContent = displayedProblem ? problemPublicContent(displayedProblem) : {};
  const codeContent = isCode ? asCodeContent(publicContent) : null;
  const codeLanguage = codeContent?.language ?? 'python';
  // Racket 在浏览器里跑不了：运行、公开测试和「自己试」都交给服务器判题器
  const serverRunsCode = isRacketLanguage(codeLanguage);
  const codeSlots = codeContent
    ? codeSlotTemplateFor({
        starterCode: codeContent.starterCode,
        template: typeof publicContent.template === 'string' ? publicContent.template : undefined,
        slots: Array.isArray(publicContent.slots)
          ? (publicContent.slots as NotebookCodeSlot[])
          : undefined,
      })
    : null;
  const rawStem = displayedProblem ? problemStem(displayedProblem) : '';
  const stem =
    displayedProblem?.type === 'fill_blank'
      ? fillBlankPrompt(
          rawStem,
          Array.isArray(publicContent.blanks)
            ? publicContent.blanks.map((blank) => (blank as { id: string }).id)
            : [],
        )
      : rawStem;
  const options = displayedProblem ? problemOptions(displayedProblem) : [];
  const testcaseCode = !currentProblem
    ? ''
    : serverRunsCode
      ? (codeContent?.publicTests ?? [])
          .map((test) => `(check-expect ${test.expression}\n              ${test.expected})`)
          .join('\n\n')
      : buildPublicTestsPython(currentProblem);
  const isMultipart = currentProblem ? isMultipartProblem(currentProblem) : false;
  const parts = useMemo(
    () => (displayedProblem && isMultipart ? multipartParts(displayedProblem) : []),
    [displayedProblem, isMultipart],
  );
  const savedParts = useMemo(() => latestPartState(document), [document]);
  const activePart =
    parts.find(
      (part) => partSelection?.problemId === currentId && part.label === partSelection.label,
    ) ??
    parts.find(
      (part) =>
        savedParts.results.find((result) => result.label === part.label)?.status !== 'passed',
    ) ??
    parts[0];
  const writtenPart =
    activePart && ['short_answer', 'proof', 'calculation'].includes(activePart.type)
      ? activePart
      : null;
  const handwritingModeKey = JSON.stringify([
    currentId,
    writtenPart?.label ?? '',
    handwritingReset,
  ]);
  const handwritingMode =
    rightTab === 'answer' && !stackedPanes && Boolean(handwritingModes[handwritingModeKey]);
  const visibleLeftTab = handwritingMode ? 'description' : leftTab;
  const activePartCode = activePart?.type === 'code' ? asCodeContent(activePart.content) : null;
  const activePartPrompt =
    activePart?.type === 'fill_blank'
      ? fillBlankPrompt(activePart.prompt, partBlankIds(activePart))
      : activePart?.prompt;
  const supportsFormulaReference =
    answer?.kind === 'text' ||
    answer?.kind === 'blanks' ||
    (isMultipart &&
      Boolean(
        activePart &&
        ['short_answer', 'calculation', 'proof', 'fill_blank'].includes(activePart.type),
      ));
  const blankFormulaEditor = usePartFormulaEditor({
    disabled: submitting || snapshotBusy,
    onInsertText: (id, text) => {
      setAnswer((current) =>
        current?.kind === 'blanks'
          ? { ...current, blanks: { ...current.blanks, [id]: text } }
          : current,
      );
      setFeedback(null);
    },
  });
  const solution = useMemo(
    () => (displayedProblem ? problemSolution(displayedProblem) : null),
    [displayedProblem],
  );

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

  /** 服务器整段运行（Racket）：返回和浏览器运行相同的结构。 */
  const serverRunCode = async (code: string): Promise<BrowserScriptResult> => {
    if (!currentProblem) return { stdout: '', error: '题目不可用，请重试。', files: [] };
    try {
      const reply = await gradeNativeCode({
        courseId: currentProblem.courseId,
        problemId: currentProblem.id,
        attemptId: `run_${crypto.randomUUID().replace(/-/g, '')}`,
        code,
        language,
        mode: 'run',
        target: 'code',
      });
      const stdout = typeof reply.result.stdout === 'string' ? reply.result.stdout : '';
      const error =
        typeof reply.result.error === 'string'
          ? reply.result.error
          : reply.status === 'error'
            ? reply.result.feedback || '运行失败，请重试。'
            : null;
      return { stdout, error, files: [] };
    } catch (cause) {
      return {
        stdout: '',
        error: cause instanceof Error ? cause.message : String(cause),
        files: [],
      };
    }
  };
  const serverRunPublicTests: ServerCodeTestRun = async (code) => {
    if (!currentProblem) return null;
    const reply = await gradeNativeCode({
      courseId: currentProblem.courseId,
      problemId: currentProblem.id,
      attemptId: `run_${crypto.randomUUID().replace(/-/g, '')}`,
      code,
      language,
      mode: 'run',
    });
    const cases = Array.isArray(reply.result.publicCases)
      ? reply.result.publicCases.map(recordValue)
      : [];
    return {
      feedback: reply.result.feedback,
      cases: cases.map((item) => {
        const detail = String(item.error ?? item.actual ?? '').trim();
        return {
          id: String(item.id ?? ''),
          passed: item.passed === true,
          detail: detail ? detail.split('\n').pop() : undefined,
        };
      }),
    };
  };

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
    if (serverRunsCode) {
      setDebugResult({ phase: 'running', output: '', error: '' });
      void serverRunCode(answer.code).then((result) => {
        if (sequence !== debugSequence.current) return;
        setDebugResult({
          phase: result.error ? 'error' : 'success',
          output: result.stdout,
          error: result.error ?? '',
        });
      });
      return;
    }
    try {
      cancelDebugRef.current = runPythonDebug(
        answer.code,
        (event) => {
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
        },
        {
          files: (codeContent?.files ?? []).filter((file) => file.role !== 'expected_output'),
          stdin: codeContent?.stdin,
        },
      );
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
          const draft = readProblemCodeDraftRecord(window.localStorage, draftKey);
          if (draft && draft.savedAt >= (nextDocument?.attempts[0]?.createdAt ?? 0))
            next = { kind: 'code', code: draft.code };
        } catch {
          setDraftError('无法读取代码草稿，请检查本机存储是否可用。');
        }
        draftRef.current = { key: draftKey, code: next.code, dirty: false };
      }
      setAnswer(next);
    };
    snapshotSequence.current += 1;
    setSnapshotBusy(false);
    setSolutionConfirm(false);
    setHiddenConfirm(null);
    setRevealedHiddenTests({});
    setSolutionSeen(false);
    setSolutionError(null);
    setSolutionNotice(null);
    setPartDrafts({});
    setStemCollapsed(true);
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
      snapshotSequence.current += 1;
      saveDraft();
    };
  }, [currentProblem, saveDraft]);

  const goRelative = useCallback(
    (delta: -1 | 1) => {
      const target = adjacentPracticeProblem(orderedIds, currentId, delta);
      if (!target) return;
      setSheetOpen(false);
      setCurrentId(target);
    },
    [currentId, orderedIds],
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

  useEffect(() => {
    setJustGraded(null);
    setSubmissionNotice(null);
    setSubmitting(false);
  }, [currentId]);

  useEffect(() => {
    if (!submissionNotice) return;
    const timer = window.setTimeout(() => setSubmissionNotice(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [submissionNotice]);

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

  const submitAnswer = useCallback(
    async (images?: PhotoAnswerImage[]) => {
      const answerToSubmit: LocalProblemAnswer | null = images
        ? { kind: 'text', text: '', images }
        : answer;
      if (!currentProblem || !answerToSubmit || !answerHasContent(answerToSubmit) || submitting)
        return;
      saveDraft();
      const sequence = snapshotSequence.current;
      setSubmissionNotice(null);
      setSubmitting(true);
      setError(null);
      try {
        let submittedAnswer = answerToSubmit;
        if (answerToSubmit.kind === 'text' && answerToSubmit.handwriting) {
          const images = await prepareHandwritingAnswers(answerToSubmit.handwriting);
          const { handwriting: _handwriting, ...plain } = answerToSubmit;
          submittedAnswer = { ...plain, images };
          if (!answerHasContent(submittedAnswer)) throw new Error('请先写下解答。');
        }
        const repository = await getLocalRepository();
        let serverCodeId: string | undefined;
        let serverCodeResult: Record<string, unknown> | undefined;
        let codePreview = false;
        let grade = gradeLocalProblem(currentProblem, submittedAnswer);
        if (submittedAnswer.kind === 'code') {
          if (!(await isPlatformCourse(repository, currentProblem.courseId))) {
            throw new Error('这道代码题需要连接课程服务器才能提交和判分。');
          }
          const attemptId = pendingCodeSubmission(currentProblem.id, submittedAnswer.code.trim());
          const reply = await gradeNativeCode({
            courseId: currentProblem.courseId,
            problemId: currentProblem.id,
            attemptId,
            code: submittedAnswer.code,
            language,
          });
          if (
            (!reply.saved && !reply.preview) ||
            reply.status === 'error' ||
            reply.status === 'pending'
          ) {
            throw new Error(reply.result.feedback || '公开测试未通过，请检查代码后重试。');
          }
          codePreview = Boolean(reply.preview);
          serverCodeId = attemptId;
          serverCodeResult = reply.result;
          grade = {
            status: reply.status,
            score: reply.score === null ? null : Math.max(0, Math.min(1, reply.score / 100)),
            feedback: reply.result.feedback || '',
            autoGraded: true,
          };
        }
        let tableCells: Array<{ key: string; correct: boolean }> | undefined;
        if (currentProblem.type === 'table' && submittedAnswer.kind === 'table') {
          const tableResult = await gradeNativeTable(
            currentProblem.publicContent as NotebookProblemPublicTable,
            currentProblem.grading as NotebookProblemGradingTable,
            submittedAnswer.cells,
          );
          grade = tableResult;
          tableCells = tableResult.cells;
        }
        let aiGradingError: string | null = null;
        if (
          grade.status === 'pending' &&
          submittedAnswer.kind === 'text' &&
          ['short_answer', 'calculation', 'proof', 'fill_blank'].includes(currentProblem.type)
        ) {
          const request = problemAiGradeRequest(
            currentProblem,
            submittedAnswer.text || '请查看附图中的作答。',
          );
          const points = request.points;
          try {
            const result = await gradeNativeAnswer({
              ...request,
              question: stem,
              language,
              images: submittedAnswer.images,
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
        const previousDocument = serverCodeId
          ? await repository.loadProblemDocument(currentProblem.id)
          : null;
        const priorAttempt = previousDocument?.attempts.find(
          (item) => item.result?.serverCodeId === serverCodeId,
        );
        const saved =
          priorAttempt && previousDocument
            ? { attempt: priorAttempt, document: previousDocument }
            : await repository.saveProblemAttempt({
                problemId: currentProblem.id,
                answer: submittedAnswer,
                status: grade.status === 'pending' ? 'pending' : grade.status,
                score: grade.score,
                feedback: grade.feedback,
                result: {
                  feedback: grade.feedback,
                  autoGraded: grade.autoGraded,
                  ...(tableCells ? { cells: tableCells } : {}),
                  ...(serverCodeId ? { serverCodeId, serverCodeResult } : {}),
                  gradingProvider: grade.autoGraded ? 'syntara-platform-ai' : 'local',
                  aiGradingError,
                },
              });
        if (serverCodeId) clearPendingCodeSubmission(currentProblem.id, serverCodeId);
        // Persist/sync even if the learner changed questions while grading.
        if (!serverCodeId && !codePreview)
          void queueProblemAttempt(repository, currentProblem.courseId, saved.attempt);
        if (sequence !== snapshotSequence.current) return;
        setDocument(saved.document);
        setSubmissionNotice(submissionFeedback([grade]));
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
        }
      } catch (cause) {
        if (sequence !== snapshotSequence.current) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        setSubmissionNotice({ tone: 'error', title: '提交未完成', description: message });
      } finally {
        if (sequence === snapshotSequence.current) setSubmitting(false);
      }
    },
    [
      answer,
      currentProblem,
      finish,
      orderedIds,
      saveDraft,
      setStatuses,
      statuses,
      submitting,
      language,
      stem,
    ],
  );

  /** 代码小问「运行公开测试」：服务器只跑公开测试，不算提交。 */
  const runCodePart = useCallback(
    async (label: string, code: string): Promise<PartCodeRun | null> => {
      if (!currentProblem) return null;
      try {
        const reply = await gradeNativeCode({
          courseId: currentProblem.courseId,
          problemId: currentProblem.id,
          attemptId: `run_${crypto.randomUUID().replace(/-/g, '')}`,
          code,
          language,
          part: label,
          mode: 'run',
        });
        const summary = recordValue(reply.result.publicSummary);
        const cases = Array.isArray(reply.result.publicCases)
          ? reply.result.publicCases.map(recordValue)
          : [];
        return {
          feedback: reply.result.feedback,
          passed: typeof summary.passed === 'number' ? summary.passed : 0,
          total: typeof summary.total === 'number' ? summary.total : 0,
          cases: cases.map((item) => {
            const detail = String(item.error ?? item.actual ?? '').trim();
            return {
              id: String(item.id ?? ''),
              passed: item.passed === true,
              detail: detail ? detail.split('\n').pop() : undefined,
            };
          }),
        };
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return null;
      }
    },
    [currentProblem, language],
  );

  /** 大题：只批改这几问，其余小问沿用上次结果，再存成一条完整的作答。 */
  const submitParts = useCallback(
    async (labels: string[], photoDrafts?: Record<string, LocalPartAnswer>) => {
      if (!currentProblem || !isMultipart || submitting || snapshotBusy) return;
      const sequence = snapshotSequence.current;
      setSubmissionNotice(null);
      setSubmitting(true);
      setError(null);
      try {
        const shares = partShares(parts);
        const now = Date.now();
        const previous = new Map(savedParts.results.map((item) => [item.label, item]));
        const answers = { ...savedParts.answers };
        const results: LocalPartResult[] = await Promise.all(
          parts.map(async (part, index): Promise<LocalPartResult> => {
            const share = shares[index];
            const before = previous.get(part.label);
            const carried: LocalPartResult = before
              ? { ...before, share }
              : { label: part.label, status: 'pending', score: 0, share, submissions: 0 };
            let draft = photoDrafts?.[part.label] ?? partDrafts[part.label];
            if (!labels.includes(part.label) || !partAnswerHasContent(draft)) return carried;
            if (draft.handwriting) {
              const images = await prepareHandwritingAnswers(draft.handwriting, 180 * 1024);
              const { handwriting: _handwriting, ...plain } = draft;
              draft = { ...plain, images };
              if (!partAnswerHasContent(draft)) return carried;
            }
            const used = before?.submissions ?? 0;
            if (isAutoGradedPart(part) && used >= PART_SUBMISSION_LIMIT) return carried;
            let grade = gradeLocalPart(currentProblem, part, draft);
            let tableCells: Array<{ key: string; correct: boolean }> | undefined;
            let codeSummary: Pick<LocalPartResult, 'publicSummary' | 'secretSummary'> = {};
            if (part.type === 'code') {
              // 代码小问在服务器上跑公开 + 隐藏测试；结果和其他小问一起存成整题作答
              try {
                const reply = await gradeNativeCode({
                  courseId: currentProblem.courseId,
                  problemId: currentProblem.id,
                  attemptId: `part_${crypto.randomUUID().replace(/-/g, '')}`,
                  code: draft.code ?? '',
                  language,
                  part: part.label,
                });
                if (reply.status === 'error' || reply.status === 'pending')
                  return { ...carried, feedback: reply.result.feedback || '这一问没能判分。' };
                const summary = (value: unknown) => {
                  const item = recordValue(value);
                  return typeof item.total === 'number' && typeof item.passed === 'number'
                    ? { passed: item.passed, total: item.total }
                    : undefined;
                };
                codeSummary = {
                  publicSummary: summary(reply.result.publicSummary),
                  secretSummary: summary(reply.result.secretSummary),
                };
                grade = {
                  status: reply.status,
                  score: reply.status === 'passed' ? 1 : 0,
                  feedback: reply.result.feedback || '',
                  autoGraded: true,
                };
              } catch (cause) {
                return {
                  ...carried,
                  feedback: `判分没完成：${cause instanceof Error ? cause.message : String(cause)}`,
                };
              }
            }
            if (part.type === 'table') {
              const tableResult = await gradeNativeTable(
                part.content as NotebookProblemPublicTable,
                part.grading as NotebookProblemGradingTable,
                draft.cells ?? {},
              );
              grade = tableResult;
              tableCells = tableResult.cells;
            }
            if (
              grade.status === 'pending' &&
              (part.type === 'short_answer' ||
                part.type === 'proof' ||
                (part.type === 'calculation' && Boolean(draft.images?.length)))
            ) {
              try {
                const request = problemAiGradeRequest(
                  {
                    ...currentProblem,
                    type: part.type,
                    publicContent: part.content,
                    grading: part.grading,
                  },
                  draft.text?.trim() || (draft.images?.length ? '请查看附图中的作答。' : ''),
                );
                const reply = await gradeNativeAnswer({
                  ...request,
                  question: partQuestionText(displayedProblem ?? currentProblem, index),
                  images: draft.images,
                  language,
                });
                const ratio = Math.max(0, Math.min(1, reply.score / request.points));
                grade = {
                  status: ratio >= 0.8 ? 'passed' : ratio >= 0.4 ? 'partial' : 'failed',
                  score: ratio,
                  feedback: reply.comment,
                  autoGraded: true,
                };
              } catch (cause) {
                return {
                  ...carried,
                  feedback: `AI 批改没完成：${cause instanceof Error ? cause.message : String(cause)}`,
                };
              }
            }
            answers[part.label] = draft;
            const submissions = used + 1;
            const raw = grade.score ?? 0;
            return {
              label: part.label,
              status: grade.status,
              score: isAutoGradedPart(part) ? capPartScore(raw, submissions) : raw,
              share,
              feedback: grade.feedback,
              ...(tableCells ? { cells: tableCells } : {}),
              ...codeSummary,
              gradedAt: now,
              submissions,
            };
          }),
        );
        const completedLabels = new Set(
          results.filter((r) => r.gradedAt === now).map((r) => r.label),
        );
        if (!completedLabels.size)
          throw new Error(
            results.find((r) => r.feedback)?.feedback ?? '这一问尚未完成批改，请重试。',
          );
        const overall = aggregatePartResults(results);
        const passedCount = results.filter((item) => item.status === 'passed').length;
        const summary = `答对 ${passedCount}/${results.length} 个小问。`;
        const repository = await getLocalRepository();
        const saved = await repository.saveProblemAttempt({
          problemId: currentProblem.id,
          answer: { kind: 'parts', parts: answers },
          status: overall.status,
          score: overall.score,
          feedback: summary,
          result: {
            feedback: summary,
            autoGraded: results.every((item) => item.status !== 'pending'),
            gradingProvider: 'local',
            parts: results,
          },
        });
        void queueProblemAttempt(repository, currentProblem.courseId, saved.attempt).catch(
          () => undefined,
        );
        if (sequence !== snapshotSequence.current) return;
        setDocument(saved.document);
        setSubmissionNotice(
          submissionFeedback(
            results
              .filter((part) => labels.includes(part.label))
              .map((part) =>
                part.gradedAt === now ? part : { ...part, status: 'pending' as const },
              ),
            true,
          ),
        );
        setPartDrafts((current) => {
          const next = { ...current };
          for (const label of completedLabels) delete next[label];
          return next;
        });
        const status: ProblemStatus = overall.status;
        const nextStatuses = new Map(statuses);
        nextStatuses.set(currentProblem.id, status);
        setStatuses(nextStatuses);
        notifyProblemProgress();
        setJustGraded(status);
        if (
          finish === 'hidden' &&
          results.every((part) => Boolean(part.gradedAt)) &&
          orderedIds.every(
            (id) =>
              id === currentProblem.id ||
              nextStatuses.get(id) === 'passed' ||
              nextStatuses.get(id) === 'failed',
          )
        ) {
          setFinish('shown');
        }
      } catch (cause) {
        if (sequence !== snapshotSequence.current) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        setSubmissionNotice({ tone: 'error', title: '本问提交未完成', description: message });
      } finally {
        if (sequence === snapshotSequence.current) setSubmitting(false);
      }
    },
    [
      currentProblem,
      displayedProblem,
      language,
      finish,
      isMultipart,
      orderedIds,
      partDrafts,
      parts,
      savedParts,
      setStatuses,
      statuses,
      submitting,
      snapshotBusy,
    ],
  );

  const persistLearningAction = async (
    event: ProblemLearningEvent,
    nextAnswer: LocalProblemAnswer,
  ) => {
    if (!currentProblem || snapshotBusy) return false;
    setSubmissionNotice(null);
    saveDraft();
    const problem = currentProblem;
    const sequence = ++snapshotSequence.current;
    setSnapshotBusy(true);
    setSolutionError(null);
    try {
      const repository = await getLocalRepository();
      const preparedAnswer =
        event === 'answer_reset' ? nextAnswer : await prepareProblemHandwriting(nextAnswer);
      const saved = await saveProblemLearningSnapshot(repository, {
        problem,
        answer: preparedAnswer,
        progress: document?.progress ?? null,
        event,
        at: Date.now(),
        id: crypto.randomUUID(),
      });
      void queueProblemAttempt(repository, problem.courseId, saved.attempt).catch(() => undefined);
      if (event === 'solution_viewed' || event === 'hidden_tests_viewed')
        void syncAppMemories(repository, problem.courseId).catch(() => undefined);
      if (sequence !== snapshotSequence.current) return false;
      if (event === 'answer_reset') {
        await clearHandwritingDrafts(
          handwritingDraftKey(
            accountStorageKey('syntara.handwriting.v1'),
            problem.courseId,
            problem.id,
          ),
        );
        setHandwritingReset((value) => value + 1);
      }
      setDocument(saved.document);
      if (event === 'answer_reset') {
        setAnswer(nextAnswer);
        if (nextAnswer.kind === 'parts')
          setPartDrafts(Object.fromEntries(parts.map((p) => [p.label, {}])));
        if (nextAnswer.kind === 'code' && draftRef.current) {
          draftRef.current.code = nextAnswer.code;
          draftRef.current.dirty = true;
          saveDraft();
        }
        setFeedback(null);
        setError(null);
        setJustGraded(null);
        setFinish('hidden');
        setSolutionSeen(false);
        setRevealedHiddenTests({});
        setSolutionNotice(null);
        setDebugResult({ phase: 'idle', output: '', error: '' });
        setRightTab(problemIsCode(problem) ? 'code' : 'answer');
      } else if (event === 'solution_viewed') {
        setSolutionSeen(true);
        setSolutionConfirm(false);
        setSolutionNotice('查看前的作答与求助记录已保存。');
        setRightTab('solution');
      }
      return true;
    } catch (cause) {
      if (sequence === snapshotSequence.current)
        setSolutionError(cause instanceof Error ? cause.message : '保存进度失败，请重试。');
      return false;
    } finally {
      if (sequence === snapshotSequence.current) setSnapshotBusy(false);
    }
  };
  const revealSolution = async (remember: boolean) => {
    if (!answer) return;
    const saved = await persistLearningAction(
      'solution_viewed',
      isMultipart ? { kind: 'parts', parts: { ...savedParts.answers, ...partDrafts } } : answer,
    );
    if (saved && remember) {
      try {
        rememberSolutionReminder(
          window.localStorage,
          solutionReminderKey(accountStorageKey('syntara.problem-preferences')),
        );
      } catch {
        setSolutionNotice('作答与求助记录已保存；提醒设置未能保存，下次仍会询问。');
      }
    }
  };
  const requestSolution = () => {
    setSubmissionNotice(null);
    if (!solution || !(solution.answer || solution.code || solution.explanation)) {
      setSolutionError('这道题尚未配置参考答案。');
      return;
    }
    if (solutionSeen) {
      setRightTab('solution');
      return;
    }
    if (
      skipsSolutionReminder(
        window.localStorage,
        solutionReminderKey(accountStorageKey('syntara.problem-preferences')),
      )
    ) {
      void revealSolution(false);
    } else {
      setSolutionError(null);
      setSolutionConfirm(true);
    }
  };

  const revealHiddenTests = async (part: string, remember: boolean) => {
    if (!currentProblem || !answer || snapshotBusy) return;
    const saved = await persistLearningAction(
      'hidden_tests_viewed',
      isMultipart ? { kind: 'parts', parts: { ...savedParts.answers, ...partDrafts } } : answer,
    );
    if (!saved) return;
    const sequence = snapshotSequence.current;
    setSnapshotBusy(true);
    try {
      const result = loadHiddenTests
        ? await loadHiddenTests(currentProblem.id, part || undefined)
        : await getNativeHiddenTests({
            courseId: currentProblem.courseId,
            problemId: currentProblem.id,
            ...(part ? { part } : {}),
          });
      if (sequence !== snapshotSequence.current) return;
      setRevealedHiddenTests((current) => ({ ...current, [part]: result }));
      setHiddenConfirm(null);
      if (remember) {
        try {
          rememberSolutionReminder(
            window.localStorage,
            `${solutionReminderKey(accountStorageKey('syntara.problem-preferences'))}:hidden-tests`,
          );
        } catch {
          // The reveal succeeded even if the optional reminder preference could not be saved.
        }
      }
    } catch (cause) {
      if (sequence === snapshotSequence.current)
        setSolutionError(cause instanceof Error ? cause.message : '隐藏测试暂时无法读取，请重试。');
    } finally {
      if (sequence === snapshotSequence.current) setSnapshotBusy(false);
    }
  };
  const requestHiddenTests = (part = '') => {
    setSubmissionNotice(null);
    if (revealedHiddenTests[part] || snapshotBusy) return;
    setSolutionError(null);
    setHiddenConfirm(part);
    if (
      skipsSolutionReminder(
        window.localStorage,
        `${solutionReminderKey(accountStorageKey('syntara.problem-preferences'))}:hidden-tests`,
      )
    )
      void revealHiddenTests(part, false);
  };
  const runHiddenTests = (part: string, code: string, caseIds?: string[]) => {
    if (!currentProblem) return Promise.reject(new Error('题目不可用，请重试。'));
    return runNativeHiddenTests({
      courseId: currentProblem.courseId,
      problemId: currentProblem.id,
      ...(part ? { part } : {}),
      code,
      language,
      ...(caseIds ? { indices: caseIds.map((id) => Number(id.replace(/^hidden-/, ''))) } : {}),
    });
  };

  if (!currentProblem || orderedIds.length === 0) {
    return (
      <section className="native-problem-practice">
        <header className="pp-header">
          <div className="pp-progress">
            <strong>没有可练习的题目</strong>
          </div>
          <button
            type="button"
            className="phone-glass-button pp-close"
            onClick={onBack}
            disabled={snapshotBusy}
            aria-label="关闭做题"
          >
            <X size={22} />
          </button>
        </header>
      </section>
    );
  }

  const rightTabs: Array<{ id: RightTab; label: string; icon: typeof Code2 }> = isCode
    ? [
        { id: 'code', label: '代码', icon: Code2 },
        { id: 'tests', label: '测试', icon: FileCode2 },
        { id: 'history', label: '记录', icon: Terminal },
      ]
    : [
        {
          id: 'answer',
          label: isMultipart && activePart?.type === 'code' ? '代码' : '作答',
          icon: isMultipart && activePart?.type === 'code' ? Code2 : SendHorizontal,
        },
        ...(activePartCode ? [{ id: 'tests' as const, label: '测试', icon: FileCode2 }] : []),
        { id: 'history', label: '记录', icon: Terminal },
      ];

  return (
    <section className="native-problem-practice" aria-label="本地做题器">
      {submissionNotice ? (
        <NativeToast
          {...submissionNotice}
          className="pp-submission-notice"
          onDismiss={() => setSubmissionNotice(null)}
        />
      ) : null}
      <header className="pp-header">
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
              disabled={snapshotBusy}
              aria-label={'第 ' + (currentIndex + 1) + ' 题，共 ' + total + ' 题，答题卡'}
              onClick={() => setSheetOpen((open) => !open)}
            >
              {chapterTitle ? <span className="pp-question-chapter">{chapterTitle}</span> : null}
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
        <div className="pp-top-answer-actions" role="group" aria-label="题目操作">
          {rightTab !== 'answer' || !handwritingMode ? (
            <>
              {rightTab !== 'solution' ? (
                <button
                  type="button"
                  className="pp-run-button pp-reset-button"
                  title={isCode ? '恢复起始代码并重新作答' : '清空本次作答'}
                  disabled={loading || submitting || snapshotBusy || debugRunning || photoBusy}
                  onClick={() =>
                    void persistLearningAction(
                      'answer_reset',
                      emptyAnswerForProblem(currentProblem),
                    )
                  }
                >
                  <RotateCcw size={13} />
                  重置
                </button>
              ) : null}
              <button
                type="button"
                className={cn(
                  'pp-run-button pp-solution-button',
                  rightTab === 'solution' && 'is-active',
                )}
                disabled={loading || submitting || snapshotBusy || debugRunning || photoBusy}
                onClick={() => {
                  if (rightTab === 'solution') setRightTab(isCode ? 'code' : 'answer');
                  else requestSolution();
                }}
              >
                {snapshotBusy ? (
                  <GlassSpinner size={13} />
                ) : rightTab === 'solution' ? (
                  <ChevronLeft size={13} />
                ) : (
                  <Eye size={13} />
                )}
                {rightTab === 'solution' ? '返回作答' : '答案'}
              </button>
            </>
          ) : null}
          {isMultipart &&
          activePart &&
          (rightTab === 'answer' || (rightTab === 'tests' && activePartCode)) ? (
            <PartSubmitButton
              part={activePart}
              answer={partDrafts[activePart.label] ?? savedParts.answers[activePart.label] ?? {}}
              dirty={partDraftIsDirty(
                partDrafts[activePart.label],
                savedParts.answers[activePart.label],
              )}
              result={savedParts.results.find((item) => item.label === activePart.label)}
              submitting={loading || submitting || snapshotBusy || debugRunning || photoBusy}
              onSubmit={() => void submitParts([activePart.label])}
            />
          ) : null}
          {rightTab !== 'history' && rightTab !== 'solution' && !isMultipart ? (
            <button
              type="button"
              className="pp-submit pp-header-submit"
              disabled={
                loading ||
                !answerHasContent(answer) ||
                submitting ||
                debugRunning ||
                photoBusy ||
                snapshotBusy
              }
              onClick={() => void submitAnswer()}
            >
              {submitting ? <GlassSpinner size={14} /> : <SendHorizontal size={14} />}提交
            </button>
          ) : null}
        </div>
        <div className="pp-header-tools">
          {hasBilingualProblem(currentProblem) ? (
            <ContentLanguageSwitch
              label="题目语言"
              value={language}
              onChange={setLanguage}
              busy={submitting || snapshotBusy}
            />
          ) : null}
          <div className="pp-nav">
            <button
              type="button"
              className="phone-glass-button"
              disabled={currentIndex <= 0 || snapshotBusy}
              onClick={() => goRelative(-1)}
              aria-label="上一题"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              className="phone-glass-button"
              disabled={currentIndex >= total - 1 || snapshotBusy}
              onClick={() => goRelative(1)}
              aria-label="下一题"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
        <button
          type="button"
          className="phone-glass-button pp-close"
          onClick={onBack}
          disabled={snapshotBusy}
          aria-label="关闭做题"
        >
          <X size={22} />
        </button>
      </header>

      {finish === 'shown' ? (
        <PracticeFinish
          title={chapterTitle}
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
          <section
            className={cn(
              'native-problem-practice-pane',
              handwritingMode && 'pp-statement-handwriting',
            )}
            id={statementId}
            onContextMenu={handwritingMode ? (event) => event.preventDefault() : undefined}
          >
            {isCode ? (
              <header className="native-problem-practice-pane-tabs pp-statement-tabs">
                <div className="pp-tabs" role="group" aria-label="题目参考内容">
                  <button
                    type="button"
                    className={cn('pp-tab', visibleLeftTab === 'description' && 'is-active')}
                    aria-pressed={visibleLeftTab === 'description'}
                    onClick={() => setLeftTab('description')}
                  >
                    <FileText size={13} />
                    描述
                  </button>
                  <button
                    type="button"
                    className={cn('pp-tab', visibleLeftTab === 'testcase' && 'is-active')}
                    aria-pressed={visibleLeftTab === 'testcase'}
                    onClick={() => setLeftTab('testcase')}
                  >
                    <FileCode2 size={13} />
                    测试
                  </button>
                  <button
                    type="button"
                    className={cn('pp-tab', visibleLeftTab === 'output' && 'is-active')}
                    aria-pressed={visibleLeftTab === 'output'}
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
            ) : supportsFormulaReference ? (
              <header className="native-problem-practice-pane-tabs pp-statement-tabs">
                <div className="pp-tabs" role="group" aria-label="题目参考内容">
                  <button
                    type="button"
                    className={cn('pp-tab', visibleLeftTab === 'description' && 'is-active')}
                    aria-pressed={visibleLeftTab === 'description'}
                    onClick={() => setLeftTab('description')}
                  >
                    <FileText size={13} />
                    描述
                  </button>
                  {!handwritingMode ? (
                    <button
                      type="button"
                      className={cn('pp-tab', visibleLeftTab === 'formulas' && 'is-active')}
                      aria-pressed={visibleLeftTab === 'formulas'}
                      onClick={() => setLeftTab('formulas')}
                    >
                      <SquareFunction size={13} />
                      公式表
                    </button>
                  ) : null}
                </div>
                <small className="pp-statement-difficulty">
                  {difficultyLabel(currentProblem.difficulty)}
                </small>
                {isMultipart ? (
                  <div ref={setPartNavigationTarget} className="mp-navigation-host" />
                ) : null}
              </header>
            ) : (
              <header className="pp-pane-head">
                <img src={marbleImages[DIFFICULTY_MARBLES[currentProblem.difficulty]]} alt="" />
                <span>{problemTypeLabel(currentProblem.type)}</span>
                <small>{difficultyLabel(currentProblem.difficulty)}</small>
                {isMultipart ? (
                  <div ref={setPartNavigationTarget} className="mp-navigation-host" />
                ) : null}
              </header>
            )}
            <div className="native-problem-practice-pane-body native-problem-rich-scroll">
              {visibleLeftTab === 'formulas' && supportsFormulaReference ? (
                <FormulaReferencePanel
                  locale={language}
                  insertionHint={
                    isMultipart
                      ? language === 'zh-CN'
                        ? '点击「插入」将公式写入当前小问的光标位置。'
                        : 'Insert a formula at the cursor in the selected part.'
                      : undefined
                  }
                  onInsert={(latex) => {
                    if (isMultipart) {
                      if (!partFormulaRef.current?.insertFormula(latex)) {
                        setError(
                          language === 'zh-CN'
                            ? '请先选择一个可输入文字或公式的小问。'
                            : 'Select a part with a text or formula input first.',
                        );
                      } else {
                        setError(null);
                        setRightTab('answer');
                      }
                      return;
                    }
                    if (answer?.kind === 'blanks') {
                      if (blankFormulaEditor.insertFormula(latex)) {
                        setError(null);
                        setRightTab('answer');
                      }
                      return;
                    }
                    if (answer?.kind !== 'text') return;
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
                visibleLeftTab === 'output' ? (
                  <PythonRunOutput
                    result={debugResult}
                    stale={
                      debugResult.phase !== 'idle' &&
                      answer?.kind === 'code' &&
                      answer.code !== debugCode
                    }
                  />
                ) : visibleLeftTab === 'testcase' ? (
                  <CodeTestcasePanel code={testcaseCode} language={codeLanguage} />
                ) : (
                  <>
                    <CodeProblemStatement content={codeContent} locale={language} />
                    <ProblemImageAssets content={publicContent as NotebookProblemPublicContent} />
                  </>
                )
              ) : isMultipart ? (
                <div className={cn('mp-stem', stackedPanes && stemCollapsed && 'is-collapsed')}>
                  <div className="mp-stem-body">
                    <ProblemRichText
                      content={stem}
                      className="text-[15px] leading-7 text-slate-800"
                    />
                    {activePart ? (
                      <section
                        className="mp-current-prompt"
                        aria-label={`当前小问 ${activePart.label}`}
                      >
                        <h3>小问 ({activePart.label})</h3>
                        {activePartCode ? (
                          <CodeProblemStatement content={activePartCode} locale={language} />
                        ) : (
                          <ProblemRichText
                            content={activePartPrompt ?? ''}
                            className="text-[15px] leading-7 text-slate-800"
                          />
                        )}
                        <ProblemImageAssets
                          content={activePart.content as NotebookProblemPublicContent}
                        />
                      </section>
                    ) : null}
                  </div>
                  <ProblemImageAssets content={publicContent as NotebookProblemPublicContent} />
                  {stackedPanes ? (
                    <button
                      type="button"
                      className="mp-stem-toggle"
                      onClick={() => setStemCollapsed((value) => !value)}
                    >
                      {stemCollapsed ? '展开题干' : '收起题干'}
                    </button>
                  ) : null}
                </div>
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
              {!handwritingMode ? (
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
              ) : null}
              <div
                className={cn('pp-header-actions', handwritingMode && 'is-handwriting')}
                onContextMenu={handwritingMode ? (event) => event.preventDefault() : undefined}
              >
                {rightTab === 'answer' && (answer?.kind === 'text' || writtenPart) ? (
                  <div className="pp-answer-input-actions" role="group" aria-label="作答输入工具">
                    <button
                      type="button"
                      className={cn('pp-run-button', handwritingMode && 'is-active')}
                      aria-pressed={handwritingMode}
                      disabled={stackedPanes || loading || submitting || snapshotBusy || photoBusy}
                      title={
                        stackedPanes
                          ? '窄屏模式不支持手写，请使用宽屏布局'
                          : handwritingMode
                            ? '退出手写，切换到文字作答'
                            : '切换到手写作答'
                      }
                      onClick={() => {
                        if (!handwritingMode) resizePanes(25);
                        setHandwritingModes((current) => ({
                          ...current,
                          [handwritingModeKey]: !handwritingMode,
                        }));
                      }}
                    >
                      <PenLine size={14} /> {handwritingMode ? '退出' : '手写'}
                    </button>
                    <span id={handwritingHeaderId} className="pp-handwriting-page-slot" />
                    {!handwritingMode ? (
                      <PhotoAnswerInput
                        key={handwritingModeKey}
                        maxImageBytes={writtenPart ? 180 * 1024 : undefined}
                        disabled={
                          loading ||
                          submitting ||
                          snapshotBusy ||
                          Boolean(
                            writtenPart &&
                            isAutoGradedPart(writtenPart) &&
                            (savedParts.results.find((item) => item.label === writtenPart.label)
                              ?.submissions ?? 0) >= PART_SUBMISSION_LIMIT,
                          )
                        }
                        onBusyChange={setPhotoBusy}
                        onError={setError}
                        onSubmit={async (images) => {
                          if (writtenPart) {
                            await submitParts([writtenPart.label], {
                              [writtenPart.label]: { images },
                            });
                          } else {
                            await submitAnswer(images);
                          }
                        }}
                      />
                    ) : null}
                  </div>
                ) : null}
                {isCode && rightTab === 'code' ? (
                  <button
                    type="button"
                    className="pp-run-button"
                    disabled={loading || submitting || snapshotBusy || answer?.kind !== 'code'}
                    onClick={runDebug}
                  >
                    {debugRunning ? <Square size={13} /> : <Play size={13} />}
                    {debugRunning ? '停止' : '运行'}
                  </button>
                ) : null}
                {handwritingMode &&
                typeof window !== 'undefined' &&
                !('__TAURI_INTERNALS__' in window) ? (
                  <p className="pp-handwriting-browser-note">
                    iPad 手写提示：请在「设置 → Apple Pencil」中关闭「随手写」，以免出现漏笔。
                  </p>
                ) : null}
              </div>
            </header>

            {solutionError && !solutionConfirm && hiddenConfirm === null ? (
              <p role="alert" className="native-problem-practice-error">
                {solutionError}
              </p>
            ) : null}
            {draftError ? (
              <p role="alert" className="native-problem-practice-error">
                {draftError}
              </p>
            ) : null}
            <div
              className={cn(
                'native-problem-practice-pane-body native-problem-rich-scroll',
                ((isCode && (rightTab === 'code' || rightTab === 'tests')) ||
                  (activePartCode && (rightTab === 'answer' || rightTab === 'tests'))) &&
                  'pp-code-body',
                rightTab === 'tests' ? 'is-code-tests' : 'is-code-editor',
                rightTab === 'answer' && (answer?.kind === 'text' || writtenPart) && 'pp-text-body',
                rightTab === 'answer' && handwritingMode && 'is-handwriting',
              )}
            >
              {rightTab === 'solution' && solutionSeen && solution ? (
                <section className="pp-solution-content" aria-label="参考答案">
                  <h3>参考答案</h3>
                  {solutionNotice ? (
                    <p className="pp-solution-notice" role="status">
                      {solutionNotice}
                    </p>
                  ) : null}
                  {solution.answer ? <ProblemRichText content={solution.answer} /> : null}
                  {solution.code ? (
                    <pre className="pp-solution-code">
                      <code>{solution.code}</code>
                    </pre>
                  ) : null}
                  {solution.explanation ? (
                    <>
                      <h4>解析</h4>
                      <ProblemRichText content={solution.explanation} />
                    </>
                  ) : null}
                </section>
              ) : null}
              {(rightTab === 'code' || rightTab === 'tests') &&
              isCode &&
              answer?.kind === 'code' ? (
                <div className="pp-code-workspace">
                  <div className="pp-code-edit-region">
                    {codeSlots ? (
                      <NativeCodeSlots
                        template={codeSlots}
                        className="min-h-0 flex-1 rounded-none border-0 shadow-none"
                        value={answer.code}
                        onChange={(code) => {
                          setFeedback(null);
                          if (draftRef.current) {
                            draftRef.current.code = code;
                            draftRef.current.dirty = true;
                          }
                          setAnswer({ kind: 'code', code });
                        }}
                      />
                    ) : (
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
                        language={codeLanguage}
                        placeholder={
                          serverRunsCode ? ';; 在此编写 Racket 代码' : '# 在此编写 Python 代码'
                        }
                        className="pp-code-editor"
                      />
                    )}
                  </div>
                  <div className="pp-code-test-region">
                    <NativeCodePlayground
                      key={currentProblem.id}
                      code={answer.code}
                      files={
                        Array.isArray(publicContent.files)
                          ? (publicContent.files as NotebookCodeFile[])
                          : []
                      }
                      stdin={
                        typeof publicContent.stdin === 'string' ? publicContent.stdin : undefined
                      }
                      tests={visibleCodeTests(codeContent ?? {})}
                      example={codeContent?.sampleIO?.[0]?.input}
                      language={codeLanguage}
                      onRunTests={serverRunsCode ? serverRunPublicTests : undefined}
                      onRunScript={serverRunsCode ? serverRunCode : undefined}
                      hiddenTests={revealedHiddenTests['']}
                      onViewHiddenTests={() => requestHiddenTests()}
                      onRunHiddenTests={
                        loadHiddenTests ? undefined : (code, ids) => runHiddenTests('', code, ids)
                      }
                    />
                    <footer className="native-problem-practice-footer">
                      {justGraded && currentIndex < total - 1 ? (
                        <button
                          type="button"
                          className={`pp-next is-${justGraded}`}
                          onClick={() => goRelative(1)}
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
                </div>
              ) : null}

              {isMultipart ? (
                <div hidden={rightTab !== 'answer' && !(rightTab === 'tests' && activePartCode)}>
                  <MultipartPractice
                    key={`${currentProblem.id}:${handwritingReset}`}
                    parts={parts}
                    handwritingMode={handwritingMode}
                    handwritingHeaderId={handwritingHeaderId}
                    handwritingKey={handwritingDraftKey(
                      accountStorageKey('syntara.handwriting.v1'),
                      currentProblem.courseId,
                      currentProblem.id,
                    )}
                    formulaRef={partFormulaRef}
                    navigationTarget={partNavigationTarget}
                    activePartLabel={activePart?.label}
                    onSelectPart={(label) => {
                      setPartSelection({ problemId: currentProblem.id, label });
                      setRightTab('answer');
                      setStemCollapsed(false);
                      if (
                        !parts.some(
                          (part) =>
                            part.label === label &&
                            ['short_answer', 'calculation', 'proof', 'fill_blank'].includes(
                              part.type,
                            ),
                        )
                      )
                        setLeftTab('description');
                    }}
                    locale={language}
                    drafts={partDrafts}
                    saved={savedParts.answers}
                    results={savedParts.results}
                    paged={stackedPanes}
                    submitting={submitting || snapshotBusy}
                    error={error}
                    onChange={(label, next) =>
                      setPartDrafts((current) => ({ ...current, [label]: next }))
                    }
                    onSubmit={(labels) => void submitParts(labels)}
                    onRunCode={runCodePart}
                    hiddenTests={revealedHiddenTests}
                    onViewHiddenTests={requestHiddenTests}
                    onRunHiddenTests={loadHiddenTests ? undefined : runHiddenTests}
                  />
                </div>
              ) : null}

              {rightTab === 'answer' && !isCode && !isMultipart ? (
                <>
                  {currentProblem.type === 'table' && answer?.kind === 'table' ? (
                    <NativeTableAnswer
                      content={publicContent as NotebookProblemPublicTable}
                      locale={language}
                      values={answer.cells}
                      results={
                        document?.attempts.find((item) => Array.isArray(item.result?.cells))?.result
                          ?.cells as Array<{ key: string; correct: boolean }> | undefined
                      }
                      disabled={submitting}
                      onChange={(cells) =>
                        setAnswer((current) =>
                          current?.kind === 'table' ? { ...current, cells } : current,
                        )
                      }
                    />
                  ) : null}
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

                  {currentProblem.type === 'fill_blank' && answer?.kind === 'blanks' ? (
                    <div className="native-blank-answer-list">
                      {(Array.isArray(publicContent.blanks) ? publicContent.blanks : []).map(
                        (item, index) => {
                          const blank = item as { id: string; placeholder?: string };
                          return (
                            <label key={blank.id} className="native-blank-answer-row">
                              <span>{index + 1}</span>
                              <textarea
                                rows={Math.max(
                                  1,
                                  (answer.blanks[blank.id] ?? '').split('\n').length,
                                )}
                                ref={(editor) =>
                                  blankFormulaEditor.registerEditor(blank.id, editor)
                                }
                                onFocus={() => blankFormulaEditor.activateEditor(blank.id)}
                                aria-label={`第 ${index + 1} 空：${blank.placeholder ?? blank.id}`}
                                placeholder={blank.placeholder ?? '填写答案'}
                                value={answer.blanks[blank.id] ?? ''}
                                disabled={submitting}
                                autoComplete="off"
                                spellCheck={false}
                                onChange={(event) => {
                                  setFeedback(null);
                                  setAnswer({
                                    kind: 'blanks',
                                    blanks: { ...answer.blanks, [blank.id]: event.target.value },
                                  });
                                }}
                              />
                            </label>
                          );
                        },
                      )}
                    </div>
                  ) : null}

                  {(currentProblem.type === 'short_answer' ||
                    currentProblem.type === 'calculation' ||
                    currentProblem.type === 'proof' ||
                    currentProblem.type === 'fill_blank') &&
                  answer?.kind === 'text' ? (
                    <HandwritingAnswerInput
                      key={`${currentProblem.id}:${handwritingReset}`}
                      draftKey={handwritingDraftKey(
                        accountStorageKey('syntara.handwriting.v1'),
                        currentProblem.courseId,
                        currentProblem.id,
                      )}
                      handwriting={handwritingMode}
                      headerContainerId={handwritingHeaderId}
                      disabled={loading || submitting || snapshotBusy}
                      onHandwritingChange={(page) => {
                        setFeedback(null);
                        setAnswer((current) =>
                          current?.kind === 'text'
                            ? { ...current, images: [], handwriting: page }
                            : current,
                        );
                      }}
                    >
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
                    </HandwritingAnswerInput>
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
                        onClick={() => goRelative(1)}
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
                        <strong>
                          {attempt.result?.event === 'solution_viewed'
                            ? '查看答案前的进度快照'
                            : attempt.result?.event === 'hidden_tests_viewed'
                              ? '查看隐藏测试前的进度快照'
                              : attempt.result?.event === 'answer_reset'
                                ? '重置作答'
                                : attempt.status}
                        </strong>
                        <span>{attempt.score === null ? '未评分' : `${attempt.score}`}</span>
                        {Array.isArray(attempt.answer.images) || attempt.answer.parts ? (
                          <div className="pp-history-photos">
                            {[
                              ...(Array.isArray(attempt.answer.images)
                                ? attempt.answer.images
                                : []),
                              ...Object.values(recordValue(attempt.answer.parts)).flatMap(
                                (part) => {
                                  const images = recordValue(part).images;
                                  return Array.isArray(images) ? images : [];
                                },
                              ),
                            ]
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
      {solutionConfirm ? (
        <ProblemSolutionConfirmation
          busy={snapshotBusy}
          error={solutionError}
          onCancel={() => {
            setSolutionConfirm(false);
            setSolutionError(null);
          }}
          onConfirm={(remember) => void revealSolution(remember)}
        />
      ) : null}
      {hiddenConfirm !== null ? (
        <ProblemSolutionConfirmation
          subject="隐藏测试"
          busy={snapshotBusy}
          error={solutionError}
          onCancel={() => {
            setHiddenConfirm(null);
            setSolutionError(null);
          }}
          onConfirm={(remember) => void revealHiddenTests(hiddenConfirm, remember)}
        />
      ) : null}
    </section>
  );
}
