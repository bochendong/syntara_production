'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/lib/notifications/client-toast';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  getLocalizedProblemContent,
  getLocalizedProblemTitle,
  hasProblemTranslation,
  type NotebookProblemAttemptAnswer,
  type NotebookProblemAttemptRecord,
  type NotebookProblemAttemptStatus,
  type NotebookProblemImportDraft,
  type ProblemContentLanguage,
} from '@/lib/problem-bank';
import {
  archiveCourseProblems,
  deleteCourseProblem,
  listCourseProblemChapters,
  listCourseProblemAttempts,
  listCourseProblemPage,
  listCourseProblemsByIds,
  listCourseProblems,
  runCourseCodeProblem,
  submitCourseProblem,
  updateCourseProblem,
  type CourseProblemPageClientResult,
  type NotebookProblemClientRecord,
  type CourseProblemChapter,
} from '@/lib/utils/notebook-problem-api';
import { getCourse } from '@/lib/utils/course-storage';
import { queueProblemAttemptWorkingMemoryUpdate } from '@/lib/learning/working-memory-tasks';
import type { CourseRecord } from '@/lib/utils/database';
import { useAnswerComposerController } from '@/components/problem-bank/answer-composer';
import { problemRecordToDraft } from '@/lib/problem-bank/editor';
import {
  isLocalDemoProblemBankCourse,
  listLocalDemoProblemBank,
  listLocalDemoProblemChapters,
  resolveLocalDemoProblemBankCourse,
} from '@/lib/teacher/local-demo-problem-bank';
import {
  MAX_PHOTO_ANSWER_BYTES,
  MAX_PHOTO_ANSWER_FILES,
  PROBLEM_BANK_PAGE_SIZE,
  buildChoiceAnswerFeedback,
  compareProblemSequence,
  difficultyLabel,
  feedbackFromAttempt,
  latestAttemptFromRecord,
  matchesPracticeFilter,
  practiceFilterLabel,
  problemPracticeState,
  problemSolutionSections,
  readFileAsDataUrl,
  renderProblemContentStem,
  renderProblemStem,
  statusLabel,
  supportsPhotoAnswer,
  typeLabel,
  type AnswerPanelTab,
  type FilterSelectOption,
  type InlineAnswerFeedback,
  type PhotoAnswerDraft,
  type PracticeFilter,
  type ProblemPracticeState,
  type ProblemInfoTab,
  type TextAnswerMode,
} from '@/components/problem-bank/course-problem-bank-helpers';
import { useProblemActiveTimer } from '@/components/problem-bank/use-problem-active-timer';

type CourseProblemBankControllerArgs = {
  courseId: string;
  initialNotebookId?: string;
  initialProblemId?: string;
  initialFilters?: CourseProblemBankInitialFilters;
  initialPracticeAnswers?: Record<string, NotebookProblemAttemptAnswer | null | undefined>;
  practiceProblemIds?: string[];
  mode?: 'bank' | 'practice';
  previewMode?: boolean;
  previewAsTeacher?: boolean;
  onPracticeAttemptResolved?: (event: CourseProblemPracticeAttemptResolvedEvent) => void;
};

export type CourseProblemPracticeAttemptResolvedEvent = {
  problemId: string;
  problemTitle: string;
  concepts: string[];
  status: NotebookProblemAttemptStatus;
  score?: number | null;
  feedback: string;
};

export type CourseCodeRunTarget = 'code' | 'public' | 'secret';

export type CourseCodeRunResult = {
  attempt?: NotebookProblemAttemptRecord;
  error?: string;
  code: string;
  target: CourseCodeRunTarget;
  ranAt: number;
};

export type CourseProblemBankInitialFilters = {
  searchQuery?: string;
  practiceFilter?: string;
  typeFilter?: string;
  difficultyFilter?: string;
  chapterFilter?: string;
  statusFilter?: string;
};

const PRACTICE_FILTER_VALUES = ['all', 'review', 'wrong', 'unattempted', 'mastered'] as const;
const PROBLEM_TYPE_FILTER_VALUES = [
  'all',
  'short_answer',
  'choice',
  'proof',
  'calculation',
  'fill_blank',
  'code',
] as const;
const DIFFICULTY_FILTER_VALUES = ['all', 'easy', 'medium', 'hard'] as const;
const STATUS_FILTER_VALUES = ['all', 'draft', 'published', 'archived'] as const;

function hasStringValue<const T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return (values as readonly string[]).includes(value);
}

function normalizeInitialFilterValue(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeInitialSearchQuery(value: string | undefined): string {
  return normalizeInitialFilterValue(value);
}

function normalizeInitialPracticeFilter(value: string | undefined): PracticeFilter {
  const next = normalizeInitialFilterValue(value);
  return hasStringValue(PRACTICE_FILTER_VALUES, next) ? next : 'all';
}

function normalizeInitialTypeFilter(
  value: string | undefined,
): 'all' | NotebookProblemClientRecord['type'] {
  const next = normalizeInitialFilterValue(value);
  return hasStringValue(PROBLEM_TYPE_FILTER_VALUES, next) ? next : 'all';
}

function normalizeInitialDifficultyFilter(
  value: string | undefined,
): 'all' | NotebookProblemClientRecord['difficulty'] {
  const next = normalizeInitialFilterValue(value);
  return hasStringValue(DIFFICULTY_FILTER_VALUES, next) ? next : 'all';
}

function normalizeInitialChapterFilter(value: string | undefined): string {
  return normalizeInitialFilterValue(value) || 'all';
}

function normalizeInitialStatusFilter(
  value: string | undefined,
): 'all' | NotebookProblemClientRecord['status'] {
  const next = normalizeInitialFilterValue(value);
  return hasStringValue(STATUS_FILTER_VALUES, next) ? next : 'all';
}

function attemptAnswerHasContent(answer: NotebookProblemAttemptAnswer | null | undefined): boolean {
  if (!answer) return false;
  if (typeof answer.text === 'string' && answer.text.trim()) return true;
  if (Array.isArray(answer.selectedOptionIds) && answer.selectedOptionIds.length > 0) return true;
  if (answer.blanks && Object.values(answer.blanks).some((value) => value.trim())) return true;
  if (typeof answer.code === 'string' && answer.code.trim()) return true;
  if (Array.isArray(answer.images) && answer.images.length > 0) return true;
  return false;
}

export function useCourseProblemBankController({
  courseId,
  initialNotebookId,
  initialProblemId,
  initialFilters,
  initialPracticeAnswers,
  practiceProblemIds,
  mode = 'bank',
  previewMode = false,
  previewAsTeacher = false,
  onPracticeAttemptResolved,
}: CourseProblemBankControllerArgs) {
  const router = useRouter();
  const isPracticeMode = mode === 'practice';
  const { locale } = useI18n();
  const initialPracticeAnswersRef = useRef(initialPracticeAnswers);

  const [courseName, setCourseName] = useState('');
  const [courseCode, setCourseCode] = useState<string | undefined>();
  const [courseAcademicYear, setCourseAcademicYear] = useState<number | undefined>();
  const [courseAcademicTerm, setCourseAcademicTerm] = useState<CourseRecord['academicTerm']>();
  const [courseAccessRole, setCourseAccessRole] = useState<CourseRecord['accessRole']>();
  const [problems, setProblems] = useState<NotebookProblemClientRecord[]>([]);
  const [serverFilteredProblemCount, setServerFilteredProblemCount] = useState(0);
  const [courseProblemCount, setCourseProblemCount] = useState(0);
  const [serverBankStats, setServerBankStats] = useState<
    CourseProblemPageClientResult['bankStats'] | null
  >(null);
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);
  const [problemLanguage, setProblemLanguage] = useState<ProblemContentLanguage>(
    locale === 'zh-CN' ? 'zh-CN' : 'en-US',
  );
  const [problemInfoTab, setProblemInfoTab] = useState<ProblemInfoTab>('description');
  const [answerPanelTab, setAnswerPanelTab] = useState<AnswerPanelTab>('answer');
  const [editingPreviewDraft, setEditingPreviewDraft] = useState<NotebookProblemImportDraft | null>(
    null,
  );
  const [savingChapterProblemId, setSavingChapterProblemId] = useState<string | null>(null);
  const [autoArchiving, setAutoArchiving] = useState(false);
  const [problemChapters, setProblemChapters] = useState<CourseProblemChapter[]>([]);
  const [deletingProblemId, setDeletingProblemId] = useState<string | null>(null);
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [answerModes, setAnswerModes] = useState<Record<string, TextAnswerMode>>({});
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
  const [photoAnswers, setPhotoAnswers] = useState<Record<string, PhotoAnswerDraft[]>>({});
  const [choiceAnswers, setChoiceAnswers] = useState<Record<string, string[]>>({});
  const [blankAnswers, setBlankAnswers] = useState<Record<string, Record<string, string>>>({});
  const [codeAnswers, setCodeAnswers] = useState<Record<string, string>>({});
  const [runningCode, setRunningCode] = useState(false);
  const [runningCodeTarget, setRunningCodeTarget] = useState<CourseCodeRunTarget | null>(null);
  const [codeRunResults, setCodeRunResults] = useState<Record<string, CourseCodeRunResult>>({});
  const [answerFeedbackByProblemId, setAnswerFeedbackByProblemId] = useState<
    Record<string, InlineAnswerFeedback>
  >({});
  const [attemptsByProblemId, setAttemptsByProblemId] = useState<
    Record<string, NotebookProblemAttemptRecord[]>
  >({});
  const [attemptHistoryLoadingProblemId, setAttemptHistoryLoadingProblemId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(() =>
    normalizeInitialSearchQuery(initialFilters?.searchQuery),
  );
  const [problemPage, setProblemPage] = useState(1);
  const [practiceFilter, setPracticeFilter] = useState<PracticeFilter>(() =>
    normalizeInitialPracticeFilter(initialFilters?.practiceFilter),
  );
  const [typeFilter, setTypeFilter] = useState<'all' | NotebookProblemClientRecord['type']>(() =>
    normalizeInitialTypeFilter(initialFilters?.typeFilter),
  );
  const [difficultyFilter, setDifficultyFilter] = useState<
    'all' | NotebookProblemClientRecord['difficulty']
  >(() => normalizeInitialDifficultyFilter(initialFilters?.difficultyFilter));
  const [chapterFilter, setChapterFilter] = useState(() =>
    normalizeInitialChapterFilter(initialFilters?.chapterFilter),
  );
  const [statusFilter, setStatusFilter] = useState<'all' | NotebookProblemClientRecord['status']>(
    () => normalizeInitialStatusFilter(initialFilters?.statusFilter),
  );
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const usesServerPagination = !isPracticeMode && !isLocalDemoProblemBankCourse(courseId);

  const scopedPracticeProblemIdKey = useMemo(
    () => Array.from(new Set(practiceProblemIds?.filter(Boolean) ?? [])).join('\u001f'),
    [practiceProblemIds],
  );
  const scopedPracticeProblemIds = useMemo(
    () => (scopedPracticeProblemIdKey ? scopedPracticeProblemIdKey.split('\u001f') : []),
    [scopedPracticeProblemIdKey],
  );
  const loadAll = useCallback(async () => {
    if (!courseId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const localDemoProblems = listLocalDemoProblemBank(courseId);
      if (localDemoProblems) {
        const localDemoCourse = resolveLocalDemoProblemBankCourse(courseId, previewAsTeacher);
        setCourseName(localDemoCourse?.name || '');
        setCourseCode(localDemoCourse?.courseCode);
        setCourseAcademicYear(localDemoCourse?.academicYear);
        setCourseAcademicTerm(localDemoCourse?.academicTerm);
        setCourseAccessRole(localDemoCourse?.accessRole);
        setProblems(localDemoProblems);
        setCourseProblemCount(localDemoProblems.length);
        setServerBankStats(null);
        if (isPracticeMode) {
          const preferred =
            localDemoProblems.find((problem) => problem.id === initialProblemId)?.id ??
            localDemoProblems.find((problem) =>
              initialNotebookId ? problem.notebookId === initialNotebookId : true,
            )?.id ??
            localDemoProblems[0]?.id ??
            null;
          setSelectedProblemId(preferred);
        } else {
          setSelectedProblemId((current) =>
            current && localDemoProblems.some((problem) => problem.id === current) ? current : null,
          );
        }
        return;
      }

      if (isPracticeMode && scopedPracticeProblemIds.length > 0) {
        const courseProblems = await listCourseProblemsByIds(courseId, scopedPracticeProblemIds);
        setProblems(courseProblems);
        const preferred =
          courseProblems.find((problem) => problem.id === initialProblemId)?.id ??
          courseProblems.find((problem) =>
            initialNotebookId ? problem.notebookId === initialNotebookId : true,
          )?.id ??
          courseProblems[0]?.id ??
          null;
        setSelectedProblemId(preferred);
        setLoading(false);

        void getCourse(courseId)
          .then((course) => {
            setCourseName(course?.name || '');
            setCourseCode(course?.courseCode);
            setCourseAcademicYear(course?.academicYear);
            setCourseAcademicTerm(course?.academicTerm);
            setCourseAccessRole(course?.accessRole);
          })
          .catch((error) => {
            console.warn('Failed to hydrate practice problem bank metadata', error);
          });
        return;
      }

      const course = await getCourse(courseId);
      const pageResult = usesServerPagination
        ? await listCourseProblemPage(courseId, {
            page: problemPage,
            pageSize: PROBLEM_BANK_PAGE_SIZE,
            searchQuery: deferredSearchQuery,
            practiceFilter,
            typeFilter,
            difficultyFilter,
            chapterFilter,
            statusFilter,
            notebookId: initialNotebookId,
            timeoutMs: 45_000,
          })
        : null;
      const courseProblems =
        pageResult?.problems ??
        (course?.problemCount === 0
          ? []
          : await listCourseProblems(courseId, { lean: true, timeoutMs: 45_000 }));
      setCourseName(course?.name || '');
      setCourseCode(course?.courseCode);
      setCourseAcademicYear(course?.academicYear);
      setCourseAcademicTerm(course?.academicTerm);
      setCourseAccessRole(course?.accessRole);
      setProblems(courseProblems);
      setCourseProblemCount(
        pageResult?.bankStats.allProblemCount ?? course?.problemCount ?? courseProblems.length,
      );
      setServerFilteredProblemCount(pageResult?.totalCount ?? courseProblems.length);
      setServerBankStats(pageResult?.bankStats ?? null);
      if (isPracticeMode) {
        const preferred =
          courseProblems.find((problem) => problem.id === initialProblemId)?.id ??
          courseProblems.find((problem) =>
            initialNotebookId ? problem.notebookId === initialNotebookId : true,
          )?.id ??
          courseProblems[0]?.id ??
          null;
        setSelectedProblemId(preferred);
      } else {
        setSelectedProblemId((current) =>
          current && courseProblems.some((problem) => problem.id === current) ? current : null,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load course problems');
    } finally {
      setLoading(false);
    }
  }, [
    chapterFilter,
    courseId,
    deferredSearchQuery,
    difficultyFilter,
    initialNotebookId,
    initialProblemId,
    isPracticeMode,
    practiceFilter,
    previewAsTeacher,
    problemPage,
    scopedPracticeProblemIds,
    statusFilter,
    typeFilter,
    usesServerPagination,
  ]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!courseId) {
      setProblemChapters([]);
      return;
    }
    if (isLocalDemoProblemBankCourse(courseId)) {
      setProblemChapters(listLocalDemoProblemChapters(courseId));
      return;
    }
    let cancelled = false;
    void listCourseProblemChapters(courseId)
      .then((result) => {
        if (!cancelled) setProblemChapters(result.chapters);
      })
      .catch((error) => console.warn('Failed to load problem chapters', error));
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const reloadProblemChapters = useCallback(async () => {
    if (!courseId) return;
    if (isLocalDemoProblemBankCourse(courseId)) {
      setProblemChapters(listLocalDemoProblemChapters(courseId));
      return;
    }
    const result = await listCourseProblemChapters(courseId);
    setProblemChapters(result.chapters);
    await loadAll();
  }, [courseId, loadAll]);

  useEffect(() => {
    initialPracticeAnswersRef.current = initialPracticeAnswers;
  }, [initialPracticeAnswers]);

  useEffect(() => {
    if (!isPracticeMode || !initialPracticeAnswers) return;
    const entries = Object.entries(initialPracticeAnswers).filter(([, answer]) =>
      attemptAnswerHasContent(answer),
    );
    if (entries.length === 0) return;

    setChoiceAnswers((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [problemId, answer] of entries) {
        if (!Array.isArray(answer?.selectedOptionIds)) continue;
        next[problemId] = answer.selectedOptionIds;
        changed = true;
      }
      return changed ? next : prev;
    });
    setBlankAnswers((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [problemId, answer] of entries) {
        if (!answer?.blanks) continue;
        next[problemId] = answer.blanks;
        changed = true;
      }
      return changed ? next : prev;
    });
    setCodeAnswers((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [problemId, answer] of entries) {
        if (typeof answer?.code !== 'string') continue;
        next[problemId] = answer.code;
        changed = true;
      }
      return changed ? next : prev;
    });
    setTextAnswers((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [problemId, answer] of entries) {
        if (typeof answer?.text !== 'string') continue;
        next[problemId] = answer.text;
        changed = true;
      }
      return changed ? next : prev;
    });
    setPhotoAnswers((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [problemId, answer] of entries) {
        if (!Array.isArray(answer?.images)) continue;
        next[problemId] = answer.images;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [initialPracticeAnswers, isPracticeMode]);

  const canEditProblems = courseAccessRole === 'owner';

  useEffect(() => {
    if (canEditProblems) return;
    setProblemInfoTab((current) => (current === 'edit' ? 'description' : current));
  }, [canEditProblems]);

  useEffect(() => {
    setProblemLanguage(locale === 'zh-CN' ? 'zh-CN' : 'en-US');
  }, [locale]);

  useEffect(() => {
    if (!isPracticeMode || problems.length === 0) return;
    const syncSelectedProblemFromUrl = () => {
      const [, courseSegment, encodedCourseId, problemBankSegment, encodedProblemId] =
        window.location.pathname.split('/');
      if (
        courseSegment !== 'course' ||
        problemBankSegment !== 'problem-bank' ||
        decodeURIComponent(encodedCourseId || '') !== courseId ||
        !encodedProblemId
      ) {
        return;
      }
      const problemId = decodeURIComponent(encodedProblemId);
      if (problems.some((problem) => problem.id === problemId)) {
        setSelectedProblemId(problemId);
      }
    };
    window.addEventListener('popstate', syncSelectedProblemFromUrl);
    return () => window.removeEventListener('popstate', syncSelectedProblemFromUrl);
  }, [courseId, isPracticeMode, problems]);

  const filteredProblems = useMemo(() => {
    if (usesServerPagination) return problems;
    const query = searchQuery.trim().toLowerCase();
    return problems.filter((problem) => {
      if (typeFilter !== 'all' && problem.type !== typeFilter) return false;
      if (statusFilter !== 'all' && problem.status !== statusFilter) return false;
      if (practiceFilter !== 'all' && !matchesPracticeFilter(problem, practiceFilter)) {
        return false;
      }
      if (difficultyFilter !== 'all' && problem.difficulty !== difficultyFilter) return false;
      if (initialNotebookId && problem.notebookId !== initialNotebookId) return false;
      if (chapterFilter === '__unfiled__') {
        if (problem.chapterId) return false;
      } else if (chapterFilter !== 'all' && problem.chapterId !== chapterFilter) {
        return false;
      }
      if (query) {
        const problemNumber = problem.problemNumber ?? problem.order + 1;
        const zhContent = getLocalizedProblemContent(problem.publicContent, 'zh-CN');
        const haystack = [
          String(problemNumber),
          `#${problemNumber}`,
          `q${problemNumber}`,
          problem.title,
          getLocalizedProblemTitle(problem, 'zh-CN'),
          renderProblemStem(problem),
          renderProblemContentStem(zhContent),
          problem.notebookName ?? '',
          problem.chapterName ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [
    difficultyFilter,
    initialNotebookId,
    chapterFilter,
    practiceFilter,
    problems,
    searchQuery,
    statusFilter,
    typeFilter,
    usesServerPagination,
  ]);

  useEffect(() => {
    setProblemPage(1);
  }, [
    difficultyFilter,
    initialNotebookId,
    chapterFilter,
    practiceFilter,
    searchQuery,
    statusFilter,
    typeFilter,
  ]);

  const filteredProblemCount = usesServerPagination
    ? serverFilteredProblemCount
    : filteredProblems.length;
  const problemPageCount = Math.max(1, Math.ceil(filteredProblemCount / PROBLEM_BANK_PAGE_SIZE));

  useEffect(() => {
    setProblemPage((current) => Math.min(Math.max(current, 1), problemPageCount));
  }, [problemPageCount]);

  const currentProblemPage = Math.min(Math.max(problemPage, 1), problemPageCount);
  const pageStartIndex = (currentProblemPage - 1) * PROBLEM_BANK_PAGE_SIZE;
  const paginatedProblems = useMemo(
    () =>
      usesServerPagination
        ? filteredProblems
        : filteredProblems.slice(pageStartIndex, pageStartIndex + PROBLEM_BANK_PAGE_SIZE),
    [filteredProblems, pageStartIndex, usesServerPagination],
  );
  const pageEndIndex = Math.min(pageStartIndex + paginatedProblems.length, filteredProblemCount);
  const buildProblemBankFilterSearchParams = useCallback(() => {
    const params = new URLSearchParams();
    const query = searchQuery.trim();
    const scopedNotebookId = normalizeInitialFilterValue(initialNotebookId);
    const normalizedChapterFilter = normalizeInitialChapterFilter(chapterFilter);

    if (query) params.set('q', query);
    if (practiceFilter !== 'all') params.set('practice', practiceFilter);
    if (typeFilter !== 'all') params.set('type', typeFilter);
    if (difficultyFilter !== 'all') params.set('difficulty', difficultyFilter);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (scopedNotebookId) params.set('notebookId', scopedNotebookId);
    if (normalizedChapterFilter !== 'all') params.set('chapter', normalizedChapterFilter);
    if (previewMode || isLocalDemoProblemBankCourse(courseId)) {
      params.set('mock', '1');
      if (previewAsTeacher) params.set('asTeacher', '1');
    }

    return params.toString();
  }, [
    difficultyFilter,
    initialNotebookId,
    chapterFilter,
    practiceFilter,
    previewAsTeacher,
    previewMode,
    searchQuery,
    statusFilter,
    typeFilter,
    courseId,
  ]);
  const getProblemBankHref = useCallback(() => {
    const query = buildProblemBankFilterSearchParams();
    const path = `/course/${encodeURIComponent(courseId)}/problem-bank`;
    return query ? `${path}?${query}` : path;
  }, [buildProblemBankFilterSearchParams, courseId]);
  const getPracticeProblemHref = useCallback(
    (problem: NotebookProblemClientRecord) => {
      const query = buildProblemBankFilterSearchParams();
      const path = `/course/${encodeURIComponent(courseId)}/problem-bank/${encodeURIComponent(problem.id)}`;
      return query ? `${path}?${query}` : path;
    },
    [buildProblemBankFilterSearchParams, courseId],
  );

  const activeProblems = useMemo(
    () => problems.filter((problem) => problem.status !== 'archived'),
    [problems],
  );
  const clientUnfiledProblemCount = useMemo(
    () => activeProblems.filter((problem) => !problem.chapterId).length,
    [activeProblems],
  );
  const clientCourseHasTranslations = useMemo(
    () => problems.some((problem) => hasProblemTranslation(problem)),
    [problems],
  );
  const unfiledProblemCount =
    usesServerPagination && serverBankStats
      ? serverBankStats.unfiledCount
      : clientUnfiledProblemCount;
  const courseHasTranslations =
    usesServerPagination && serverBankStats
      ? serverBankStats.hasTranslations
      : clientCourseHasTranslations;

  const difficultyOptions = useMemo(
    () =>
      (['easy', 'medium', 'hard'] as NotebookProblemClientRecord['difficulty'][]).map((value) => ({
        value,
        count:
          usesServerPagination && serverBankStats
            ? serverBankStats.difficultyCounts[value]
            : activeProblems.filter((problem) => problem.difficulty === value).length,
      })),
    [activeProblems, serverBankStats, usesServerPagination],
  );

  const practiceFilterOptions = useMemo<FilterSelectOption[]>(
    () =>
      (['all', 'mastered', 'unattempted', 'wrong', 'review'] as PracticeFilter[]).map((value) => ({
        value,
        label: practiceFilterLabel(value, locale),
      })),
    [locale],
  );

  const difficultyFilterOptions = useMemo<FilterSelectOption[]>(
    () => [
      { value: 'all', label: locale === 'zh-CN' ? '全部难度' : 'All levels' },
      ...difficultyOptions.map((option) => ({
        value: option.value,
        label: difficultyLabel(option.value, locale),
        count: option.count,
      })),
    ],
    [difficultyOptions, locale],
  );

  const chapterFilterOptions = useMemo<FilterSelectOption[]>(
    () => [
      { value: 'all', label: locale === 'zh-CN' ? '全部章节' : 'All chapters' },
      {
        value: '__unfiled__',
        label: locale === 'zh-CN' ? '未归档' : 'Unfiled',
        count: unfiledProblemCount,
      },
      ...problemChapters.map((chapter, index) => ({
        value: chapter.id,
        label:
          locale === 'zh-CN'
            ? `第 ${index + 1} 章 · ${chapter.name}`
            : `Chapter ${index + 1} · ${chapter.name}`,
        count: chapter.problemCount,
      })),
    ],
    [locale, problemChapters, unfiledProblemCount],
  );

  const typeFilterOptions = useMemo<FilterSelectOption[]>(
    () => [
      { value: 'all', label: locale === 'zh-CN' ? '全部题型' : 'All types' },
      { value: 'short_answer', label: typeLabel('short_answer', locale) },
      { value: 'choice', label: typeLabel('choice', locale) },
      { value: 'proof', label: typeLabel('proof', locale) },
      { value: 'calculation', label: typeLabel('calculation', locale) },
      { value: 'fill_blank', label: typeLabel('fill_blank', locale) },
      { value: 'code', label: typeLabel('code', locale) },
    ],
    [locale],
  );

  const statusFilterOptions = useMemo<FilterSelectOption[]>(
    () => [
      { value: 'all', label: locale === 'zh-CN' ? '全部状态' : 'All status' },
      { value: 'draft', label: statusLabel('draft', locale) },
      { value: 'published', label: statusLabel('published', locale) },
      { value: 'archived', label: statusLabel('archived', locale) },
    ],
    [locale],
  );

  const clientBankStats = useMemo(() => {
    const stateCounts = activeProblems.reduce(
      (counts, problem) => {
        counts[problemPracticeState(problem)] += 1;
        return counts;
      },
      { mastered: 0, review: 0, wrong: 0, unattempted: 0 } as Record<ProblemPracticeState, number>,
    );
    const attempted = activeProblems.length - stateCounts.unattempted;
    const masteryPercent =
      activeProblems.length > 0
        ? Math.round((stateCounts.mastered / activeProblems.length) * 100)
        : 0;
    const chapterProgressById = new Map<
      string,
      { chapter: string; attemptedCount: number; totalCount: number }
    >();
    for (const problem of activeProblems) {
      if (!problem.chapterId || !problem.chapterName) continue;
      const state = problemPracticeState(problem);
      const current = chapterProgressById.get(problem.chapterId) ?? {
        chapter: problem.chapterName,
        attemptedCount: 0,
        totalCount: 0,
      };
      current.totalCount += 1;
      if (state !== 'unattempted') current.attemptedCount += 1;
      chapterProgressById.set(problem.chapterId, current);
    }
    const chapterProgress = Array.from(chapterProgressById.values())
      .sort(
        (a, b) =>
          b.totalCount - a.totalCount ||
          a.attemptedCount / Math.max(1, a.totalCount) -
            b.attemptedCount / Math.max(1, b.totalCount) ||
          a.chapter.localeCompare(b.chapter),
      )
      .slice(0, 5)
      .map((item) => ({
        ...item,
        percent: Math.round((item.attemptedCount / Math.max(1, item.totalCount)) * 100),
      }));
    return {
      total: activeProblems.length,
      attempted,
      mastered: stateCounts.mastered,
      review: stateCounts.review,
      wrong: stateCounts.wrong,
      unattempted: stateCounts.unattempted,
      masteryPercent,
      chapterProgress,
    };
  }, [activeProblems]);
  const bankStats = usesServerPagination && serverBankStats ? serverBankStats : clientBankStats;

  const selectedProblem =
    filteredProblems.find((problem) => problem.id === selectedProblemId) ||
    problems.find((problem) => problem.id === selectedProblemId) ||
    null;
  const problemActiveTimer = useProblemActiveTimer({
    courseId,
    problemId: selectedProblem?.id ?? null,
    enabled: isPracticeMode && !previewMode,
  });
  const selectedProblemContent = selectedProblem
    ? getLocalizedProblemContent(selectedProblem.publicContent, problemLanguage)
    : null;
  const selectedProblemTitle = selectedProblem
    ? getLocalizedProblemTitle(selectedProblem, problemLanguage)
    : '';
  const selectedProblemHasTranslation = hasProblemTranslation(selectedProblem);
  const selectedProblemRef = useRef<NotebookProblemClientRecord | null>(null);
  const selectedProblemChapterLabel = selectedProblem
    ? selectedProblem.chapterName || (locale === 'zh-CN' ? '未归档' : 'Unfiled')
    : '';
  useEffect(() => {
    selectedProblemRef.current = selectedProblem;
  }, [selectedProblem]);
  const filteredSequenceProblems = useMemo(
    () => [...filteredProblems].sort(compareProblemSequence),
    [filteredProblems],
  );
  const currentFilteredProblemIndex = useMemo(() => {
    if (!selectedProblem) return -1;
    return filteredSequenceProblems.findIndex((problem) => problem.id === selectedProblem.id);
  }, [filteredSequenceProblems, selectedProblem]);
  const previousPracticeTarget =
    currentFilteredProblemIndex > 0
      ? filteredSequenceProblems[currentFilteredProblemIndex - 1]
      : null;
  const nextPracticeTarget =
    currentFilteredProblemIndex >= 0
      ? (filteredSequenceProblems[currentFilteredProblemIndex + 1] ?? null)
      : null;
  const currentFilteredProblemPosition =
    currentFilteredProblemIndex >= 0 ? currentFilteredProblemIndex + 1 : 0;
  const practiceNavigationProblemCount = filteredSequenceProblems.length;
  const deleteReplacementPracticeTarget = nextPracticeTarget ?? previousPracticeTarget;
  const selectedProblemEditDraft = useMemo(
    () => (selectedProblem ? problemRecordToDraft(selectedProblem) : null),
    [selectedProblem],
  );
  const visibleProblemPreviewDraft = editingPreviewDraft ?? selectedProblemEditDraft;
  const selectedProblemSolutionSections = useMemo(() => {
    if (!selectedProblem || !selectedProblemContent) return [];
    return problemSolutionSections(
      { ...selectedProblem, publicContent: selectedProblemContent },
      locale,
    );
  }, [locale, selectedProblem, selectedProblemContent]);
  const selectedAnswerFeedback = selectedProblem
    ? (answerFeedbackByProblemId[selectedProblem.id] ?? null)
    : null;
  const selectedProblemPoints = selectedProblem?.points ?? 0;
  const selectedProblemAttempts = selectedProblem
    ? (attemptsByProblemId[selectedProblem.id] ?? [])
    : [];
  const selectedProblemAttemptsLoaded = selectedProblem
    ? Object.prototype.hasOwnProperty.call(attemptsByProblemId, selectedProblem.id)
    : false;
  const selectedProblemAttemptsLoading = selectedProblem
    ? attemptHistoryLoadingProblemId === selectedProblem.id
    : false;
  const selectedAnswerMode: TextAnswerMode = selectedProblem
    ? (answerModes[selectedProblem.id] ?? 'text')
    : 'text';
  const selectedTextAnswerValue = selectedProblem ? (textAnswers[selectedProblem.id] ?? '') : '';
  const selectedTextAnswerId = selectedProblem?.id;
  const setSelectedTextAnswer = useCallback(
    (nextValue: string) => {
      if (!selectedTextAnswerId) return;
      setTextAnswers((prev) => ({
        ...prev,
        [selectedTextAnswerId]: nextValue,
      }));
    },
    [selectedTextAnswerId],
  );
  const selectedAnswerController = useAnswerComposerController({
    value: selectedTextAnswerValue,
    onChange: setSelectedTextAnswer,
  });
  const handleProblemInfoTabChange = useCallback(
    (tab: ProblemInfoTab) => {
      if (tab === 'edit' && !canEditProblems) {
        setProblemInfoTab('description');
        setAnswerPanelTab('answer');
        return;
      }
      setProblemInfoTab(tab);
      if (tab === 'edit') setAnswerPanelTab('preview');
    },
    [canEditProblems],
  );
  const handleEditingDraftChange = useCallback((nextDraft: NotebookProblemImportDraft) => {
    setEditingPreviewDraft(nextDraft);
  }, []);
  const insertFormulaIntoAnswer = useCallback(
    (latex: string) => {
      if (!selectedProblem) return;
      if (!supportsPhotoAnswer(selectedProblem)) {
        toast.error(
          locale === 'zh-CN'
            ? '这类题没有文字作答框，暂时不能插入公式。'
            : 'This problem type does not have a text answer box yet.',
        );
        return;
      }

      setAnswerPanelTab('answer');
      if (selectedAnswerMode === 'photo') {
        setAnswerModes((prev) => ({
          ...prev,
          [selectedProblem.id]: 'text',
        }));
      }

      window.setTimeout(() => {
        selectedAnswerController.applyEdit({ kind: 'insert', text: latex });
      }, 0);
    },
    [locale, selectedAnswerController, selectedAnswerMode, selectedProblem],
  );
  useEffect(() => {
    if (!isPracticeMode || !selectedProblemId) return;
    if (answerPanelTab !== 'history' || selectedProblemAttemptsLoaded) return;
    const problem = selectedProblemRef.current;
    if (!problem || problem.id !== selectedProblemId) return;

    let cancelled = false;
    setAttemptHistoryLoadingProblemId(selectedProblemId);
    void listCourseProblemAttempts(courseId, selectedProblemId)
      .then((attempts) => {
        if (cancelled) return;
        setAttemptsByProblemId((prev) => ({
          ...prev,
          [selectedProblemId]: attempts,
        }));
        const latestAttempt = attempts[0];
        if (!latestAttempt) return;
        const answer = latestAttempt.answer;
        const shouldRestoreAnswer = !attemptAnswerHasContent(
          initialPracticeAnswersRef.current?.[problem.id],
        );

        setProblems((prev) =>
          prev.map((item) =>
            item.id === problem.id
              ? {
                  ...item,
                  latestAttempt: latestAttemptFromRecord(latestAttempt),
                }
              : item,
          ),
        );
        if (shouldRestoreAnswer && Array.isArray(answer.selectedOptionIds)) {
          setChoiceAnswers((prev) => ({
            ...prev,
            [problem.id]: answer.selectedOptionIds ?? [],
          }));
        }
        if (shouldRestoreAnswer && answer.blanks) {
          setBlankAnswers((prev) => ({
            ...prev,
            [problem.id]: answer.blanks ?? {},
          }));
        }
        if (shouldRestoreAnswer && typeof answer.code === 'string' && answer.code.trim()) {
          setCodeAnswers((prev) =>
            Object.prototype.hasOwnProperty.call(prev, problem.id)
              ? prev
              : {
                  ...prev,
                  [problem.id]: answer.code ?? '',
                },
          );
        }
        if (shouldRestoreAnswer && typeof answer.text === 'string') {
          setTextAnswers((prev) => ({
            ...prev,
            [problem.id]: answer.text ?? '',
          }));
        }
        if (shouldRestoreAnswer && Array.isArray(answer.images)) {
          setPhotoAnswers((prev) => ({
            ...prev,
            [problem.id]: answer.images ?? [],
          }));
        }
        setAnswerFeedbackByProblemId((prev) => ({
          ...prev,
          [problem.id]: feedbackFromAttempt(problem, latestAttempt, locale),
        }));
      })
      .catch((error) => {
        console.warn('Failed to restore latest problem attempt', error);
        if (!cancelled) {
          setAttemptsByProblemId((prev) => ({
            ...prev,
            [selectedProblemId]: [],
          }));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAttemptHistoryLoadingProblemId((current) =>
            current === selectedProblemId ? null : current,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    answerPanelTab,
    courseId,
    isPracticeMode,
    locale,
    selectedProblemId,
    selectedProblemAttemptsLoaded,
  ]);
  const navigateToPracticeProblem = useCallback(
    (problem: NotebookProblemClientRecord) => {
      const nextPath = getPracticeProblemHref(problem);
      if (!isPracticeMode) {
        router.push(nextPath);
        return;
      }
      setSelectedProblemId(problem.id);
      const currentPath = `${window.location.pathname}${window.location.search}`;
      if (currentPath !== nextPath) {
        window.history.pushState(null, '', nextPath);
      }
    },
    [getPracticeProblemHref, isPracticeMode, router],
  );
  const showSidebarAnswerTools = false;
  const activeBankFilterCount = [
    practiceFilter !== 'all',
    typeFilter !== 'all',
    difficultyFilter !== 'all',
    statusFilter !== 'all',
    chapterFilter !== 'all',
  ].filter(Boolean).length;

  useEffect(() => {
    if (!selectedProblemId) return;
    setAnswerModes((prev) => {
      if (prev[selectedProblemId] === 'text') return prev;
      return {
        ...prev,
        [selectedProblemId]: 'text',
      };
    });
  }, [selectedProblemId]);

  useEffect(() => {
    setProblemInfoTab('description');
    setAnswerPanelTab('answer');
  }, [selectedProblem?.id]);

  useEffect(() => {
    setEditingPreviewDraft(selectedProblemEditDraft);
  }, [selectedProblemEditDraft]);

  const handleChangeProblemChapter = useCallback(
    async (problemId: string, chapterId: string) => {
      if (savingChapterProblemId) return;
      if (!canEditProblems) {
        toast.error(
          locale === 'zh-CN' ? '只有课程作者可以编辑题目。' : 'Only the author can edit problems.',
        );
        return;
      }
      const previousChapterId =
        problems.find((problem) => problem.id === problemId)?.chapterId ?? null;
      setSavingChapterProblemId(problemId);
      try {
        const updated = await updateCourseProblem({
          courseId,
          problemId,
          patch: {
            chapterId: chapterId === '__unfiled__' ? null : chapterId,
          },
        });
        setProblems((prev) =>
          prev.map((problem) => (problem.id === updated.id ? updated : problem)),
        );
        setProblemChapters((current) =>
          current.map((chapter) => ({
            ...chapter,
            problemCount:
              chapter.problemCount +
              (updated.chapterId === chapter.id ? 1 : 0) -
              (previousChapterId === chapter.id ? 1 : 0),
          })),
        );
        toast.success(locale === 'zh-CN' ? '题目章节已更新' : 'Problem chapter updated');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Chapter update failed');
      } finally {
        setSavingChapterProblemId(null);
      }
    },
    [canEditProblems, courseId, locale, problems, savingChapterProblemId],
  );

  const handleAddPhotoAnswerFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!selectedProblem) return;
      const problemId = selectedProblem.id;
      const existingCount = photoAnswers[problemId]?.length ?? 0;
      const remainingSlots = MAX_PHOTO_ANSWER_FILES - existingCount;
      if (remainingSlots <= 0) {
        toast.error(
          locale === 'zh-CN'
            ? `最多只能上传 ${MAX_PHOTO_ANSWER_FILES} 张照片。`
            : `You can upload up to ${MAX_PHOTO_ANSWER_FILES} photos.`,
        );
        return;
      }

      const incoming = Array.from(files);
      const imageFiles = incoming.filter((file) => file.type.startsWith('image/'));
      if (imageFiles.length === 0) {
        toast.error(locale === 'zh-CN' ? '请选择图片文件。' : 'Choose image files.');
        return;
      }

      const accepted = imageFiles
        .filter((file) => {
          if (file.size <= MAX_PHOTO_ANSWER_BYTES) return true;
          toast.error(
            locale === 'zh-CN'
              ? `${file.name} 超过 4 MB，已跳过。`
              : `${file.name} is larger than 4 MB and was skipped.`,
          );
          return false;
        })
        .slice(0, remainingSlots);

      if (imageFiles.length > accepted.length) {
        toast.error(
          locale === 'zh-CN'
            ? `已达到最多 ${MAX_PHOTO_ANSWER_FILES} 张照片的限制。`
            : `Only ${MAX_PHOTO_ANSWER_FILES} photos are allowed.`,
        );
      }
      if (accepted.length === 0) return;

      try {
        const nextPhotos = await Promise.all(
          accepted.map(async (file) => ({
            id: crypto.randomUUID(),
            name: file.name,
            mimeType: file.type || 'image/*',
            size: file.size,
            dataUrl: await readFileAsDataUrl(file),
          })),
        );
        setPhotoAnswers((prev) => ({
          ...prev,
          [problemId]: [...(prev[problemId] ?? []), ...nextPhotos].slice(0, MAX_PHOTO_ANSWER_FILES),
        }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to read image');
      }
    },
    [locale, photoAnswers, selectedProblem],
  );

  const handleRemovePhotoAnswer = useCallback(
    (photoId: string) => {
      if (!selectedProblem) return;
      setPhotoAnswers((prev) => ({
        ...prev,
        [selectedProblem.id]: (prev[selectedProblem.id] ?? []).filter(
          (photo) => photo.id !== photoId,
        ),
      }));
    },
    [selectedProblem],
  );

  const handleUpdateProblem = useCallback(
    async (patch: {
      title?: string;
      status?: 'draft' | 'published' | 'archived';
      points?: number;
      difficulty?: 'easy' | 'medium' | 'hard';
      publicContent?: unknown;
      grading?: unknown;
      secretJudge?: unknown | null;
    }) => {
      if (!selectedProblem) return;
      if (!canEditProblems) {
        throw new Error(
          locale === 'zh-CN' ? '只有课程作者可以编辑题目。' : 'Only the author can edit problems.',
        );
      }
      const updated = await updateCourseProblem({
        courseId,
        problemId: selectedProblem.id,
        patch,
      });
      setProblems((prev) => prev.map((problem) => (problem.id === updated.id ? updated : problem)));
      setSelectedProblemId(updated.id);
    },
    [canEditProblems, courseId, locale, selectedProblem],
  );

  const handleDeleteProblem = useCallback(
    async (problemToDelete?: NotebookProblemClientRecord) => {
      const targetProblem = problemToDelete ?? selectedProblem;
      if (!targetProblem || deletingProblemId) return;
      if (!canEditProblems) {
        toast.error(
          locale === 'zh-CN' ? '只有课程作者可以编辑题目。' : 'Only the author can edit problems.',
        );
        return;
      }
      const confirmed = window.confirm(
        locale === 'zh-CN'
          ? `确认删除题目「${targetProblem.title}」吗？删除后不可恢复。`
          : `Delete "${targetProblem.title}"? This cannot be undone.`,
      );
      if (!confirmed) return;

      setDeletingProblemId(targetProblem.id);
      try {
        await deleteCourseProblem({
          courseId,
          problemId: targetProblem.id,
        });
        const deletedSelectedProblem = selectedProblem?.id === targetProblem.id;
        const replacementProblem = deletedSelectedProblem ? deleteReplacementPracticeTarget : null;
        setProblems((prev) => prev.filter((problem) => problem.id !== targetProblem.id));
        if (usesServerPagination) {
          setServerFilteredProblemCount((current) => Math.max(0, current - 1));
          setCourseProblemCount((current) => Math.max(0, current - 1));
          if (problems.length === 1 && problemPage > 1) {
            setProblemPage((current) => Math.max(1, current - 1));
          } else {
            await loadAll();
          }
        }
        setSelectedProblemId((current) =>
          current === targetProblem.id ? (replacementProblem?.id ?? null) : current,
        );
        if (deletedSelectedProblem && isPracticeMode) {
          if (replacementProblem) {
            const nextPath = getPracticeProblemHref(replacementProblem);
            const currentPath = `${window.location.pathname}${window.location.search}`;
            if (currentPath !== nextPath) {
              window.history.replaceState(null, '', nextPath);
            }
          } else {
            router.replace(getProblemBankHref());
          }
        }
        toast.success(locale === 'zh-CN' ? '题目已删除' : 'Problem deleted');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Delete failed');
      } finally {
        setDeletingProblemId(null);
      }
    },
    [
      canEditProblems,
      courseId,
      deleteReplacementPracticeTarget,
      deletingProblemId,
      getPracticeProblemHref,
      getProblemBankHref,
      isPracticeMode,
      loadAll,
      locale,
      problemPage,
      problems.length,
      router,
      selectedProblem,
      usesServerPagination,
    ],
  );

  const handleSubmitInlineAnswer = useCallback(async () => {
    if (!selectedProblem || submittingAnswer) return false;
    const photoMode = supportsPhotoAnswer(selectedProblem) && selectedAnswerMode === 'photo';
    const selectedPhotos = photoAnswers[selectedProblem.id] ?? [];
    if (photoMode && selectedPhotos.length === 0) {
      toast.error(locale === 'zh-CN' ? '请先上传照片答案。' : 'Upload a photo answer first.');
      return false;
    }
    const selectedChoiceOptionIds = choiceAnswers[selectedProblem.id] ?? [];
    if (selectedProblem.type === 'choice' && selectedChoiceOptionIds.length === 0) {
      toast.error(locale === 'zh-CN' ? '请先选择一个答案。' : 'Choose an answer first.');
      return false;
    }
    const selectedBlankAnswers = blankAnswers[selectedProblem.id] ?? {};
    if (
      selectedProblem.type === 'fill_blank' &&
      selectedProblemContent?.type === 'fill_blank' &&
      selectedProblemContent.blanks.some((blank) => !selectedBlankAnswers[blank.id]?.trim())
    ) {
      toast.error(locale === 'zh-CN' ? '请填写所有空格。' : 'Fill in every blank first.');
      return false;
    }
    const immediateChoiceFeedback =
      selectedProblem.type === 'choice'
        ? buildChoiceAnswerFeedback(selectedProblem, selectedChoiceOptionIds, locale)
        : null;
    const selectedCodeAnswer =
      selectedProblem.type === 'code' && selectedProblemContent?.type === 'code'
        ? (codeAnswers[selectedProblem.id] ?? selectedProblemContent.starterCode ?? '')
        : '';
    if (selectedProblem.type === 'code' && !selectedCodeAnswer.trim()) {
      toast.error(locale === 'zh-CN' ? '请先填写代码。' : 'Code is required.');
      return false;
    }
    if (immediateChoiceFeedback) {
      setAnswerFeedbackByProblemId((prev) => ({
        ...prev,
        [selectedProblem.id]: immediateChoiceFeedback,
      }));
    }
    setSubmittingAnswer(true);
    try {
      const payload =
        selectedProblem.type === 'choice'
          ? { selectedOptionIds: selectedChoiceOptionIds }
          : selectedProblem.type === 'fill_blank'
            ? { blanks: selectedBlankAnswers }
            : selectedProblem.type === 'code'
              ? { code: selectedCodeAnswer }
              : photoMode
                ? { images: selectedPhotos }
                : { text: textAnswers[selectedProblem.id] ?? '' };
      const { attempt, result } = await submitCourseProblem({
        courseId,
        problemId: selectedProblem.id,
        language: locale,
        activeDurationMs: problemActiveTimer.getActiveDuration(),
        ...payload,
      });
      problemActiveTimer.reset();
      if (selectedProblem.type === 'code') {
        setCodeAnswers((prev) => ({
          ...prev,
          [selectedProblem.id]: selectedCodeAnswer,
        }));
      }
      setProblems((prev) =>
        prev.map((problem) =>
          problem.id === selectedProblem.id
            ? {
                ...problem,
                latestAttempt: latestAttemptFromRecord(attempt),
              }
            : problem,
        ),
      );
      setAttemptsByProblemId((prev) => ({
        ...prev,
        [selectedProblem.id]: [
          attempt,
          ...(prev[selectedProblem.id] ?? []).filter((item) => item.id !== attempt.id),
        ],
      }));
      const feedback =
        result?.feedback ||
        immediateChoiceFeedback?.feedback ||
        (locale === 'zh-CN' ? '答案已提交。' : 'Answer submitted.');
      const score = attempt.score ?? immediateChoiceFeedback?.score ?? null;
      setAnswerFeedbackByProblemId((prev) => ({
        ...prev,
        [selectedProblem.id]: {
          status: attempt.status,
          score,
          feedback,
          correctOptionIds: immediateChoiceFeedback?.correctOptionIds,
          selectedOptionIds: immediateChoiceFeedback?.selectedOptionIds,
          saving: false,
        },
      }));
      setAnswerPanelTab('history');
      onPracticeAttemptResolved?.({
        problemId: selectedProblem.id,
        problemTitle: selectedProblemTitle || selectedProblem.title,
        concepts: [selectedProblem.chapterName || selectedProblemTitle || selectedProblem.title],
        status: attempt.status,
        score,
        feedback,
      });
      if (selectedProblem.notebookId) {
        queueProblemAttemptWorkingMemoryUpdate({
          notebookId: selectedProblem.notebookId,
          notebookName: selectedProblem.notebookName,
          problem: selectedProblem,
          attempt,
        });
      }
      return true;
    } catch (error) {
      setAnswerFeedbackByProblemId((prev) => ({
        ...prev,
        [selectedProblem.id]: {
          status: 'error',
          score: null,
          feedback:
            locale === 'zh-CN'
              ? '答案没有保存成功，请再试一次。'
              : 'The answer was not saved. Please try again.',
          correctOptionIds: immediateChoiceFeedback?.correctOptionIds,
          selectedOptionIds: immediateChoiceFeedback?.selectedOptionIds,
          saving: false,
        },
      }));
      toast.error(error instanceof Error ? error.message : 'Submit failed');
      return false;
    } finally {
      setSubmittingAnswer(false);
    }
  }, [
    blankAnswers,
    choiceAnswers,
    codeAnswers,
    courseId,
    locale,
    photoAnswers,
    selectedProblem,
    selectedProblemContent,
    selectedProblemTitle,
    selectedAnswerMode,
    onPracticeAttemptResolved,
    problemActiveTimer,
    submittingAnswer,
    textAnswers,
  ]);

  const handleRunCodeAnswer = useCallback(
    async (target: CourseCodeRunTarget = 'public') => {
      if (!selectedProblem || runningCode) return false;
      if (selectedProblem.type !== 'code' || selectedProblemContent?.type !== 'code') return false;
      if (target === 'secret' && (selectedProblem.secretJudge?.secretTests?.length ?? 0) === 0) {
        toast.error(locale === 'zh-CN' ? '暂无隐藏测试。' : 'No secret tests available.');
        return false;
      }

      const selectedCodeAnswer =
        codeAnswers[selectedProblem.id] ?? selectedProblemContent.starterCode ?? '';
      if (!selectedCodeAnswer.trim()) {
        toast.error(locale === 'zh-CN' ? '请先填写代码。' : 'Code is required.');
        return false;
      }

      setRunningCode(true);
      problemActiveTimer.markActive();
      setRunningCodeTarget(target);
      try {
        const { attempt, result } = await runCourseCodeProblem({
          courseId,
          problemId: selectedProblem.id,
          code: selectedCodeAnswer,
          target,
          language: locale,
        });
        setCodeAnswers((prev) => ({
          ...prev,
          [selectedProblem.id]: selectedCodeAnswer,
        }));
        setCodeRunResults((prev) => ({
          ...prev,
          [selectedProblem.id]: {
            attempt,
            code: selectedCodeAnswer,
            target,
            ranAt: Date.now(),
          },
        }));
        setProblems((prev) =>
          prev.map((problem) =>
            problem.id === selectedProblem.id
              ? {
                  ...problem,
                  latestAttempt: latestAttemptFromRecord(attempt),
                }
              : problem,
          ),
        );
        setAttemptsByProblemId((prev) => ({
          ...prev,
          [selectedProblem.id]: [
            attempt,
            ...(prev[selectedProblem.id] ?? []).filter((item) => item.id !== attempt.id),
          ],
        }));

        if (target === 'code') {
          if (attempt.status === 'passed') {
            toast.success(locale === 'zh-CN' ? '代码运行完成' : 'Code ran successfully');
          } else {
            toast.error(
              result?.error ||
                result?.feedback ||
                (locale === 'zh-CN' ? '代码运行出错' : 'Code failed'),
            );
          }
        } else if (attempt.status === 'passed') {
          toast.success(
            target === 'secret'
              ? locale === 'zh-CN'
                ? '隐藏测试全部通过'
                : 'All secret tests passed'
              : locale === 'zh-CN'
                ? '公开测试全部通过'
                : 'All public tests passed',
          );
        } else {
          toast.error(
            (locale === 'zh-CN'
              ? result?.feedback
                  ?.replaceAll('Public tests', '公开测试')
                  .replaceAll('Secret tests', '隐藏测试')
              : result?.feedback) ||
              (target === 'secret'
                ? locale === 'zh-CN'
                  ? '隐藏测试未全部通过'
                  : 'Secret tests failed'
                : locale === 'zh-CN'
                  ? '公开测试未全部通过'
                  : 'Public tests failed'),
          );
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Run failed';
        setCodeRunResults((prev) => ({
          ...prev,
          [selectedProblem.id]: {
            error: message,
            code: selectedCodeAnswer,
            target,
            ranAt: Date.now(),
          },
        }));
        toast.error(message);
        return true;
      } finally {
        setRunningCode(false);
        setRunningCodeTarget(null);
      }
    },
    [
      codeAnswers,
      courseId,
      locale,
      problemActiveTimer,
      runningCode,
      selectedProblem,
      selectedProblemContent,
    ],
  );

  const handleAiFileUnfiledProblems = useCallback(async () => {
    if (!canEditProblems || autoArchiving) return;
    if (problemChapters.length === 0) {
      toast.error(
        locale === 'zh-CN'
          ? '请先在“管理章节”中添加至少一个章节，再使用 AI 归档。'
          : 'Add at least one chapter before using AI filing.',
      );
      return;
    }
    if (isLocalDemoProblemBankCourse(courseId)) {
      toast.info(locale === 'zh-CN' ? '预览课程不会写入归档结果。' : 'Preview data is read-only.');
      return;
    }
    setAutoArchiving(true);
    try {
      const result = await archiveCourseProblems(courseId);
      await loadAll();
      const chapterResult = await listCourseProblemChapters(courseId);
      setProblemChapters(chapterResult.chapters);
      if (result.archivedCount > 0) {
        toast.success(
          locale === 'zh-CN'
            ? `AI 已归档 ${result.archivedCount} 道题，仍有 ${result.unfiledCount} 道题未归档。`
            : `AI filed ${result.archivedCount} problems; ${result.unfiledCount} remain unfiled.`,
        );
      } else {
        toast.info(
          locale === 'zh-CN'
            ? '没有找到可以可靠归入现有章节的题目，题目仍保留为未归档。'
            : 'No problems could be confidently filed into the existing chapters.',
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'AI 归档失败');
    } finally {
      setAutoArchiving(false);
    }
  }, [autoArchiving, canEditProblems, courseId, loadAll, locale, problemChapters.length]);

  return {
    activeBankFilterCount,
    answerPanelTab,
    autoArchiving,
    bankStats,
    blankAnswers,
    canEditProblems,
    choiceAnswers,
    codeAnswers,
    codeRunResults,
    courseAccessRole,
    courseAcademicTerm,
    courseAcademicYear,
    courseCode,
    courseHasTranslations,
    courseId,
    courseName,
    courseProblemCount,
    currentFilteredProblemPosition,
    currentProblemPage,
    deletingProblemId,
    difficultyFilter,
    difficultyFilterOptions,
    filteredProblems,
    filteredProblemCount,
    handleAddPhotoAnswerFiles,
    handleAiFileUnfiledProblems,
    handleDeleteProblem,
    handleChangeProblemChapter,
    handleEditingDraftChange,
    handleProblemInfoTabChange,
    handleRemovePhotoAnswer,
    handleRunCodeAnswer,
    handleSubmitInlineAnswer,
    handleUpdateProblem,
    insertFormulaIntoAnswer,
    isPracticeMode,
    chapterFilter,
    chapterFilterOptions,
    loading,
    locale,
    navigateToPracticeProblem,
    nextPracticeTarget,
    pageEndIndex,
    pageStartIndex,
    paginatedProblems,
    photoAnswers,
    practiceFilter,
    practiceFilterOptions,
    practiceNavigationProblemCount,
    previousPracticeTarget,
    problemInfoTab,
    problemChapters,
    reloadProblemChapters,
    problemLanguage,
    problemPageCount,
    problems,
    router,
    runningCode,
    runningCodeTarget,
    savingChapterProblemId,
    searchQuery,
    selectedAnswerMode,
    selectedAnswerController,
    selectedAnswerFeedback,
    selectedProblem,
    selectedProblemAttempts,
    selectedProblemAttemptsLoading,
    selectedProblemContent,
    selectedProblemEditDraft,
    selectedProblemHasTranslation,
    selectedProblemId,
    selectedProblemChapterLabel,
    selectedProblemPoints,
    selectedProblemSolutionSections,
    selectedProblemTitle,
    selectedTextAnswerValue,
    setAnswerFeedbackByProblemId,
    setAnswerModes,
    setAnswerPanelTab,
    setBlankAnswers,
    setChoiceAnswers,
    setCodeAnswers,
    setDifficultyFilter,
    setChapterFilter,
    setPracticeFilter,
    setProblemLanguage,
    setProblemPage,
    setSelectedProblemId,
    setSearchQuery,
    setSelectedTextAnswer,
    setStatusFilter,
    setTypeFilter,
    showSidebarAnswerTools,
    statusFilter,
    statusFilterOptions,
    submittingAnswer,
    textAnswers,
    typeFilter,
    typeFilterOptions,
    unfiledProblemCount,
    visibleProblemPreviewDraft,
  };
}

export type CourseProblemBankController = ReturnType<typeof useCourseProblemBankController>;
