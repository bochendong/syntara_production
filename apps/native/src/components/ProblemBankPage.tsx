import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ArrowLeft, Check, ChevronLeft, LayoutGrid, List, Play } from 'lucide-react';

import { resetBankProblems } from '../data/problem-sync';
import { getLocalRepository } from '../data/repository';
import { useBackDismiss } from '../lib/use-back-dismiss';
import { difficultyLabel, problemTypeLabel } from '../data/local-problem-grading';
import {
  courseSeries,
  csc108PaperSourceTag,
  courseQuestionNumber,
  paperLabels,
  matchesProblemFilters,
  namedMidtermYear,
  paperSetPositions,
  problemPaperSeries,
  problemPaperSets,
  usesCsc108PaperNames,
  visibleBankProblems,
  type PaperSetKind,
  type PaperSourceTag,
} from '../data/problem-bank-filters';
import { practiceLaunchForResults } from '../data/problem-practice-scope';
import { ProblemTitleText } from './problem-bank/problem-rich-text';
import {
  SheetCell,
  notifyProblemProgress,
  STATUS_LABELS,
  STATUS_MARBLES,
  useProblemStatuses,
  type ProblemStatus,
} from './problem-bank/answer-sheet';
import { LearningEmptyState } from './LearningEmptyState';
import type { LocalCourseWorkspace, LocalProblem } from '../domain/models';
import { DIFFICULTY_MARBLES, marbleImages, type MarbleColor } from '../lib/learning-action-marbles';
import { notebookMarbleColor, splitNotebookName } from '../lib/notebook-reading';
import {
  ProblemBankFilters,
  type BankFilterValues,
  type BankFilterGroup,
} from './ProblemBankFilters';
import {
  LayerActionMenu,
  LayerBadges,
  LayerItem,
  type LayerMenuTarget,
} from './CourseLayerControls';
import {
  isPrivateProblem,
  isProblemContentUpdated,
  isProblemNew,
  refreshCourseLayers,
  removeCourseContent,
  useCourseLayers,
} from '../lib/course-layers';
import { TeachLiveBanner, TeachSessionToggle, useTeachLiveCourse } from './TeachLiveBar';
import './course-pages.css';
import { BankAnalytics } from './problem-bank/BankAnalytics';
import { MistakeBookView, MistakeRedoResult } from './problem-bank/MistakeBook';
import { useBankAttemptHistory } from './problem-bank/bank-first-attempts';
import {
  MISTAKE_BOOK_EVENT,
  readRemovedMistakes,
  removeMistakes,
  sortMistakes,
} from '../data/mistake-book';
import type { BankComparison } from '../../../../lib/problem-bank/bank-comparison';
import { localizeProblem, type ProblemContentLanguage } from '../lib/problem-language';

export type ProblemBankLaunch = {
  language?: ProblemContentLanguage;
  problemIds: string[];
  initialProblemId: string;
  /** 每道题在当前筛选结果里的连续题号，做题页的答题卡用。 */
  numbers?: Record<string, number>;
  /** 这一组题的名字（章节名 / 错题重练）。 */
  title?: string;
  /** 从课堂入口进来：这组题的提交记到这节课上。 */
  classSessionId?: string;
  /** 老师试做：作答只留在本次窗口，不计入学生记录。 */
  teacherPreview?: boolean;
  /** 错题重做：这一轮每题都重新交过才算刷完（之前做错的不算）。 */
  freshRound?: boolean;
};

type ProblemBankPageProps = {
  workspace: LocalCourseWorkspace;
  onBack: () => void;
  onPractice: (launch: ProblemBankLaunch) => void;
  /** 没有题目时去「资料」上传。 */
  onUpload?: () => void;
  /** 搜索框旁上传键选好的文件，交给「资料」页整理。 */
  onUploadFiles?: (files: File[]) => void;
  /** 从商城加入的课：题目可以删除（公有的只对自己隐藏）、复制到我的，显示「新」。 */
  layered?: boolean;
  /** 删除、恢复、复制之后重新同步这门课。 */
  onContentChanged?: () => Promise<void> | void;
  /** 本机预览：同班对比用的样例数据。 */
  previewComparison?: BankComparison;
};

type TypeFilter = 'all' | string;
type DifficultyFilter = 'all' | LocalProblem['difficulty'];
type SheetView = 'grid' | 'list';
type BankMode = 'chapters' | 'sets' | PaperSourceTag;

type Chapter = {
  sourceTag?: PaperSourceTag;
  key: string;
  number: string | null;
  title: string;
  color: MarbleColor | null;
  order: number;
  problems: LocalProblem[];
  passed: number;
  failed: number;
  partial: number;
};

const UNSORTED_CHAPTER = '__unsorted__';
const ALL_CHAPTERS = '__all_chapters__';
const COURSE_CHAPTER_PREFIX = 'course-chapter:';
const VIEW_STORAGE_KEY = 'syntara.problem-bank-view.v1';
// 从做题页回来时回到刚才那一章（只在这次打开 App 期间记着）。
const OPEN_CHAPTER_KEY = 'syntara.problem-bank-open-chapter';
// 章节墙 / 套题墙，按课程记着。
const BANK_MODE_KEY = 'syntara.problem-bank-mode.v1';
const PAPER_SET_PREFIX = 'paper-set:';
// 错题本开着没有、这一轮重做的是哪些题（只在这次打开 App 期间记着）。
const MISTAKE_MODE_KEY = 'syntara.problem-bank-mistake-mode.v1';
const MISTAKE_REDO_KEY = 'syntara.problem-bank-mistake-redo.v1';
const PAPER_SET_COLORS: Record<PaperSetKind, MarbleColor> = {
  tt1: 'green',
  tt2: 'amber',
  midterm: 'purple',
  final: 'pink',
  test: 'purple',
  practice: 'blue',
};
const PAPER_SET_TITLES: Record<PaperSetKind, string> = {
  tt1: 'TT1',
  tt2: 'TT2',
  midterm: 'Midterm',
  final: '期末',
  test: '期中与小测',
  practice: '练习卷',
};
const CSC108_PAPER_SET_TITLES = { ...PAPER_SET_TITLES, final: 'Final', test: '其他测验' };
const LIST_PAGE_SIZE = 20;

function storage(kind: 'local' | 'session'): Storage | undefined {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function readJson<T>(kind: 'local' | 'session', key: string): T | null {
  try {
    const raw = storage(kind)?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(kind: 'local' | 'session', key: string, value: unknown) {
  try {
    storage(kind)?.setItem(key, JSON.stringify(value));
  } catch {
    // 存不了就算了。
  }
}

/** 按课程分开存的小记录（上次刷到哪、打开的是哪一章）。 */
function readCourseValue<T>(kind: 'local' | 'session', key: string, courseId: string): T | null {
  return readJson<Record<string, T>>(kind, key)?.[courseId] ?? null;
}

function writeCourseValue(
  kind: 'local' | 'session',
  key: string,
  courseId: string,
  value: unknown,
) {
  const all = readJson<Record<string, unknown>>(kind, key) ?? {};
  all[courseId] = value;
  writeJson(kind, key, all);
}

function problemOrder(a: LocalProblem, b: LocalProblem): number {
  return (
    ((a.chapterId ? a.order : undefined) ?? Number.POSITIVE_INFINITY) -
      ((b.chapterId ? b.order : undefined) ?? Number.POSITIVE_INFINITY) ||
    a.createdAt - b.createdAt ||
    a.title.localeCompare(b.title, 'zh-CN', { numeric: true }) ||
    a.id.localeCompare(b.id)
  );
}

// 难度用弹珠颜色表示：基础绿、进阶黄、挑战粉。
const DIFFICULTY_OPTIONS = (['easy', 'medium', 'hard'] as const).map((value) => ({
  value,
  label: difficultyLabel(value),
  color: DIFFICULTY_MARBLES[value],
}));

// 同步来的标题会在公式中间截断（比如 "$mx\equiv nx\..."），公式就渲染不出来；
// 这种情况改用完整题干，一行放不下交给 CSS 省略。
function listTitle(problem: LocalProblem): string {
  const stem = problem.publicContent.stem;
  if (typeof stem !== 'string' || !stem.trim()) return problem.title;
  return /(\.\.\.|…)\s*$/.test(problem.title) ? stem.replace(/\s+/g, ' ') : problem.title;
}

function accentVars(color: MarbleColor | null): CSSProperties {
  const marble = color ?? 'blue';
  return {
    '--accent-rgb': `var(--marble-${marble}-rgb)`,
    '--accent-ink': `var(--marble-${marble}-ink)`,
  } as CSSProperties;
}

/** 章节弹珠：笔记的颜色，编号印在上面。 */
function ChapterMarble({ chapter }: { chapter: Chapter }) {
  return (
    <span className="pb-chapter-marble" aria-hidden>
      {chapter.color ? (
        <img src={marbleImages[chapter.color]} alt="" />
      ) : (
        <i className="pb-chapter-marble-empty" />
      )}
      {chapter.number ? <b>{chapter.number}</b> : null}
    </span>
  );
}

type GroupProgress = Pick<Chapter, 'problems' | 'passed' | 'partial' | 'failed'>;

function groupProgress(
  problems: LocalProblem[],
  statuses: ReadonlyMap<string, ProblemStatus>,
): GroupProgress {
  const progress = { problems, passed: 0, partial: 0, failed: 0 };
  for (const problem of problems) {
    const status = statuses.get(problem.id);
    if (status && status !== 'pending') progress[status] += 1;
  }
  return progress;
}

/** 一根玻璃管：通过、部分对、错了按比例排开，后面是「通过 / 总数」。 */
function ChapterTube({ chapter }: { chapter: GroupProgress }) {
  const total = chapter.problems.length || 1;
  return (
    <span
      className="pb-tube-meter"
      aria-label={`通过 ${chapter.passed} / ${chapter.problems.length}`}
    >
      <span className="pb-tube-meter-track">
        <i className="is-passed" style={{ width: `${(chapter.passed / total) * 100}%` }} />
        <i className="is-partial" style={{ width: `${(chapter.partial / total) * 100}%` }} />
        <i className="is-failed" style={{ width: `${(chapter.failed / total) * 100}%` }} />
      </span>
      <small>
        {chapter.passed}/{chapter.problems.length}
      </small>
    </span>
  );
}

function ProblemRow({
  problem,
  number,
  status,
  badges,
  onClick,
}: {
  problem: LocalProblem;
  number: number | undefined;
  status: ProblemStatus | undefined;
  badges?: ReactNode;
  onClick: () => void;
}) {
  const color = DIFFICULTY_MARBLES[problem.difficulty] ?? 'blue';
  return (
    <button
      type="button"
      className={`pb-row is-${color}${status ? ` is-${status}` : ''}`}
      onClick={onClick}
    >
      <span className="pb-row-no">{number}</span>
      <span className="pb-row-marble">
        <img src={marbleImages[color]} alt="" />
        {status === 'passed' ? (
          <i className="pb-row-badge" aria-label="已通过">
            <Check size={10} strokeWidth={3.5} />
          </i>
        ) : status ? (
          <i className="pb-row-badge" aria-label={STATUS_LABELS[status]} />
        ) : null}
      </span>
      <span className="pb-row-copy">
        <strong>
          <ProblemTitleText content={listTitle(problem)} />
          {badges}
        </strong>
        <small>
          <span className="pb-row-type">{problemTypeLabel(problem.type)}</span>
          {[
            problem.chapterName,
            ...(paperSetPositions(problem.tags).length
              ? paperSetPositions(problem.tags).map(
                  (position) => `${position.set} ${position.label}`,
                )
              : problem.tags.some((tag) => courseSeries.test(tag))
                ? [...paperLabels(problem.tags), courseQuestionNumber(problem.tags)]
                : problem.tags.slice(0, 2)),
          ]
            .filter(Boolean)
            .join(' · ')}
        </small>
      </span>
      <span className="pb-row-play" aria-hidden>
        <Play size={14} />
      </span>
    </button>
  );
}

function BankHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
}) {
  return (
    <header className="pb-header">
      <button type="button" className="phone-glass-button" onClick={onBack} aria-label="返回">
        <ChevronLeft size={22} />
      </button>
      <div className="pb-title">
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </div>
      <span className="pb-header-spacer" aria-hidden />
    </header>
  );
}

/**
 * 题库是一张按章节刷题的地图：首页是章节墙（接着上次、错题重练、每章一张卡），
 * 进到一章是题号答题卡，每格一颗弹珠，颜色就是做题状态。
 */
export function ProblemBankPage({
  workspace,
  onBack,
  onPractice,
  onUpload,
  onUploadFiles,
  layered = false,
  onContentChanged,
  previewComparison,
}: ProblemBankPageProps) {
  const courseId = workspace.course.id;
  const useCsc108Names = usesCsc108PaperNames(workspace.course);
  const sourceProblems = useMemo(
    () => new Map(workspace.problems.map((problem) => [problem.id, problem])),
    [workspace.problems],
  );
  const [statuses, , historicalMistakes, progressById] = useProblemStatuses(
    courseId,
    workspace.problems,
  );
  const layers = useCourseLayers(courseId);
  const [menuTarget, setMenuTarget] = useState<LayerMenuTarget | null>(null);
  const teachLive = useTeachLiveCourse(courseId);
  /** 上课时每道已发布的公有题多一个「加入这节课」。 */
  const sessionToggleFor = (problem: LocalProblem) =>
    teachLive.live && problem.status === 'published' && !isPrivateProblem(layers, problem.id) ? (
      <TeachSessionToggle
        added={teachLive.live.problemIds.includes(problem.id)}
        busy={teachLive.busy === problem.id}
        onToggle={() => void teachLive.toggle(problem.id)}
      />
    ) : null;
  const liveBanner = <TeachLiveBanner live={teachLive.live} error={teachLive.error} />;
  useEffect(() => {
    if (layered) void refreshCourseLayers(courseId).catch(() => undefined);
  }, [courseId, layered]);
  const badgesFor = (problem: LocalProblem, showFresh = true) =>
    layered ? (
      <LayerBadges
        fresh={showFresh && isProblemNew(layers, problem.id)}
        updated={isProblemContentUpdated(
          layers,
          problem.id,
          progressById?.get(problem.id)?.lastAttemptAt ?? undefined,
        )}
        mine={isPrivateProblem(layers, problem.id)}
      />
    ) : null;
  const moreFor = (problem: LocalProblem) =>
    layered && isPrivateProblem(layers, problem.id)
      ? () =>
          setMenuTarget({
            targetType: 'problem',
            targetId: problem.id,
            title: listTitle(problem).replace(/\$+/g, ''),
            mine: isPrivateProblem(layers, problem.id),
          })
      : undefined;
  const afterChange = async () => {
    await onContentChanged?.();
  };
  const layerOverlays = (
    <>
      {menuTarget ? (
        <LayerActionMenu
          target={menuTarget}
          onClose={() => setMenuTarget(null)}
          onRemove={async () => {
            await removeCourseContent(courseId, menuTarget);
            await afterChange();
          }}
        />
      ) : null}
    </>
  );
  // 学生只看已发布的题；课程里还没有发布的题时（本机自建课程）就全部显示。
  // 加入的课里自己上传的题（私有层）还是草稿也照样显示。
  const bankProblems = useMemo(() => {
    const visible = visibleBankProblems(
      workspace.problems,
      (p) => layered && isPrivateProblem(layers, p.id),
    );
    return visible.map((problem) => localizeProblem(problem, 'zh-CN'));
  }, [layered, layers, workspace.problems]);

  // 真实课程章节优先；未分课程章节的旧题仍沿用笔记 / 知识点分组。
  const chapterOf = useMemo(() => {
    const notebookIds = new Set(workspace.notebooks.map((notebook) => notebook.id));
    const anyLinked = bankProblems.some(
      (problem) => !problem.chapterId && problem.notebookId && notebookIds.has(problem.notebookId),
    );
    return (problem: LocalProblem): string => {
      if (problem.chapterId) return `${COURSE_CHAPTER_PREFIX}${problem.chapterId}`;
      if (anyLinked) {
        return problem.notebookId && notebookIds.has(problem.notebookId)
          ? problem.notebookId
          : UNSORTED_CHAPTER;
      }
      return problem.tags[0] ? `tag:${problem.tags[0]}` : UNSORTED_CHAPTER;
    };
  }, [bankProblems, workspace.notebooks]);

  const chapters = useMemo(() => {
    const sortedNotebooks = [...workspace.notebooks].sort((a, b) =>
      a.name.localeCompare(b.name, 'zh-CN', { numeric: true }),
    );
    const notebookIndex = new Map(sortedNotebooks.map((notebook, index) => [notebook.id, index]));
    const byKey = new Map<string, Chapter>();
    for (const problem of bankProblems) {
      const key = chapterOf(problem);
      let chapter = byKey.get(key);
      if (!chapter) {
        const index = notebookIndex.get(key);
        const notebook = index === undefined ? null : sortedNotebooks[index];
        const name = notebook ? splitNotebookName(notebook.name) : null;
        const courseChapter = key.startsWith(COURSE_CHAPTER_PREFIX);
        const courseName = courseChapter
          ? splitNotebookName(problem.chapterName?.trim() || '未命名章节')
          : null;
        chapter = {
          key,
          number: courseName?.number ?? name?.number ?? null,
          title:
            courseName?.title ??
            name?.title ??
            (key === UNSORTED_CHAPTER ? '未分章节' : key.startsWith('tag:') ? key.slice(4) : key),
          color: index === undefined ? null : notebookMarbleColor(index),
          // 编号章节跟着课程学习顺序，不能由最近更新的题目决定显示位置。
          order: courseChapter
            ? courseName?.number
              ? Number(courseName.number) - 1
              : Number.MAX_SAFE_INTEGER - 1
            : (index ?? Number.MAX_SAFE_INTEGER),
          problems: [],
          passed: 0,
          failed: 0,
          partial: 0,
        };
        byKey.set(key, chapter);
      }
      chapter.problems.push(problem);
      const status = statuses.get(problem.id);
      if (status === 'passed') chapter.passed += 1;
      else if (status === 'failed') chapter.failed += 1;
      else if (status === 'partial') chapter.partial += 1;
    }
    const list = [...byKey.values()];
    const tagMode = list.every((chapter) => chapter.order === Number.MAX_SAFE_INTEGER);
    list.sort((a, b) =>
      a.key === UNSORTED_CHAPTER
        ? 1
        : b.key === UNSORTED_CHAPTER
          ? -1
          : tagMode
            ? b.problems.length - a.problems.length
            : a.order - b.order,
    );
    list.forEach((chapter, index) => {
      chapter.problems.sort((a, b) =>
        problemOrder(sourceProblems.get(a.id) ?? a, sourceProblems.get(b.id) ?? b),
      );
      // 知识点分组没有自己的颜色，按顺序轮着给。
      if (!chapter.color && chapter.key !== UNSORTED_CHAPTER) {
        chapter.color = notebookMarbleColor(index);
      }
    });
    return list;
  }, [bankProblems, chapterOf, statuses, workspace.notebooks, sourceProblems]);

  const allChapter = useMemo<Chapter>(
    () => ({
      key: ALL_CHAPTERS,
      number: null,
      title: '全部章节',
      color: 'blue',
      order: -1,
      problems: chapters.flatMap((chapter) => chapter.problems),
      passed: chapters.reduce((sum, chapter) => sum + chapter.passed, 0),
      failed: chapters.reduce((sum, chapter) => sum + chapter.failed, 0),
      partial: chapters.reduce((sum, chapter) => sum + chapter.partial, 0),
    }),
    [chapters],
  );

  // 题号：每一章里按出题顺序 1、2、3…，筛选时不变。
  const numberById = useMemo(() => {
    const numbers = new Map<string, number>();
    for (const chapter of chapters) {
      let publicNumber = 0;
      for (const problem of chapter.problems) {
        if (!layered || !isPrivateProblem(layers, problem.id))
          numbers.set(problem.id, ++publicNumber);
      }
    }
    return numbers;
  }, [chapters, layered, layers]);
  // 套题：同一道题可以在好几套里，每套按原卷题号排。
  const paperSetTitles = useCsc108Names ? CSC108_PAPER_SET_TITLES : PAPER_SET_TITLES;
  const paperSetChapters = useMemo(
    () =>
      problemPaperSets(bankProblems, useCsc108Names, (a, b) =>
        problemOrder(sourceProblems.get(a.id) ?? a, sourceProblems.get(b.id) ?? b),
      ).map((set, index) => {
        const year = /20(\d{2})/.exec(set.name)?.[1] ?? null;
        const chapter: Chapter = {
          key: `${PAPER_SET_PREFIX}${set.name}`,
          number: year,
          title: set.name,
          color: PAPER_SET_COLORS[set.kind],
          sourceTag: useCsc108Names ? csc108PaperSourceTag(set.name) : undefined,
          order: index,
          ...groupProgress(set.problems, statuses),
        };
        return { ...chapter, kind: set.kind };
      }),
    [bankProblems, useCsc108Names, sourceProblems, statuses],
  );
  const bankTabs: { mode: BankMode; label: string; count: number }[] = [
    { mode: 'chapters', label: '按章节', count: chapters.length },
  ];
  if (useCsc108Names) {
    for (const source of ['考试原题', '模拟题'] as const) {
      bankTabs.push({
        mode: source,
        label: source,
        count: paperSetChapters.filter((set) => set.sourceTag === source).length,
      });
    }
  } else if (paperSetChapters.length) {
    bankTabs.push({ mode: 'sets', label: '按套题', count: paperSetChapters.length });
  }
  const [bankModeState, setBankModeState] = useState<BankMode>(() => {
    const saved = readCourseValue<BankMode>('session', BANK_MODE_KEY, courseId);
    return useCsc108Names && saved === 'sets' ? '考试原题' : (saved ?? 'chapters');
  });
  const bankMode = bankTabs.find((tab) => tab.mode === bankModeState)?.mode ?? 'chapters';
  const visiblePaperSets = useMemo(
    () =>
      bankMode === 'sets'
        ? paperSetChapters
        : paperSetChapters.filter((set) => set.sourceTag === bankMode),
    [bankMode, paperSetChapters],
  );
  const progressGroups = bankMode === 'chapters' ? chapters : visiblePaperSets;
  const progress = useMemo(() => {
    if (bankMode === 'chapters') return allChapter;
    // A problem shared by several papers contributes once to this tab's overall progress.
    const ids = new Set(
      visiblePaperSets.flatMap((set) => set.problems.map((problem) => problem.id)),
    );
    return groupProgress(
      bankProblems.filter((problem) => ids.has(problem.id)),
      statuses,
    );
  }, [allChapter, bankMode, bankProblems, statuses, visiblePaperSets]);
  const progressTotal = progress.problems.length;
  const setBankMode = (next: BankMode) => {
    setBankModeState(next);
    writeCourseValue('session', BANK_MODE_KEY, courseId, next);
  };
  const isPaperSetKey = (key: string | null | undefined) =>
    Boolean(key?.startsWith(PAPER_SET_PREFIX));
  /** 套题里的题号就是在这套里的位置；章节里沿用章节题号。 */
  const numberIn = (chapter: Chapter | null | undefined, problem: LocalProblem) =>
    chapter && isPaperSetKey(chapter.key)
      ? chapter.problems.indexOf(problem) + 1
      : numberById.get(problem.id);
  const chapterByKey = useMemo(
    () =>
      new Map(
        [...chapters, ...paperSetChapters, allChapter].map((chapter) => [chapter.key, chapter]),
      ),
    [chapters, paperSetChapters, allChapter],
  );

  const [openKey, setOpenKey] = useState<string | null>(() =>
    readCourseValue<string>('session', OPEN_CHAPTER_KEY, courseId),
  );
  const seriesOptions = useMemo(
    () => problemPaperSeries(bankProblems, useCsc108Names),
    [bankProblems, useCsc108Names],
  );
  const [seriesSelection, setSeriesSelection] = useState({ courseId, tag: '' });
  const activeSeries =
    seriesSelection.courseId === courseId &&
    seriesOptions.some(([tag]) => tag === seriesSelection.tag)
      ? seriesSelection.tag
      : '';
  // 只有一章时不需要章节墙，直接进这一章。
  const openChapter =
    openKey === ALL_CHAPTERS
      ? allChapter
      : chapters.length === 1 && bankTabs.length === 1 && !isPaperSetKey(openKey)
        ? chapters[0]
        : openKey
          ? (chapterByKey.get(openKey) ?? null)
          : null;
  const openChapterKey = (key: string | null) => {
    setTypeFilter('all');
    setDifficultyFilter('all');
    setListCount(LIST_PAGE_SIZE);
    setOpenKey(key);
    writeCourseValue('session', OPEN_CHAPTER_KEY, courseId, key);
  };

  const startPractice = useCallback(
    (
      problems: LocalProblem[],
      initial: LocalProblem | undefined,
      title: string,
      freshRound = false,
    ) => {
      if (!problems.length) return;
      const start = initial ?? problems[0];
      const launch = practiceLaunchForResults(problems, start.id, title);
      if (launch) onPractice(freshRound ? { ...launch, freshRound } : launch);
    },
    [onPractice],
  );

  /** 「继续刷」：这一组里第一道还没通过的题。 */
  const firstUnpassed = (problems: LocalProblem[]) =>
    problems.find((problem) => statuses.get(problem.id) !== 'passed');

  // ---------- 错题本 ----------
  // 做错过的题都收在错题本里；改对了也留着，学生自己点「移出」。
  const attemptHistory = useBankAttemptHistory(courseId, bankProblems, progressById);
  const [removedMistakes, setRemovedMistakes] = useState(() => readRemovedMistakes(courseId));
  useEffect(() => {
    const refresh = () => setRemovedMistakes(readRemovedMistakes(courseId));
    refresh();
    window.addEventListener(MISTAKE_BOOK_EVENT, refresh);
    return () => window.removeEventListener(MISTAKE_BOOK_EVENT, refresh);
  }, [courseId]);
  const mistakeEntries = useMemo(
    () => sortMistakes(progress.problems, attemptHistory.mistakes, progressById, removedMistakes),
    [progress.problems, attemptHistory.mistakes, progressById, removedMistakes],
  );
  const mistakeCounts = useMemo(() => {
    const book = new Set<string>();
    let removed = 0;
    for (const entry of mistakeEntries) {
      if (entry.tab === 'book') book.add(entry.problem.id);
      else removed += 1;
    }
    return { book, removed };
  }, [mistakeEntries]);
  const mistakes = useMemo(
    () => mistakeEntries.filter((entry) => entry.tab === 'book').map((entry) => entry.problem),
    [mistakeEntries],
  );
  const [mistakeMode, setMistakeModeState] = useState(
    () => readCourseValue<boolean>('session', MISTAKE_MODE_KEY, courseId) === true,
  );
  const [mistakeFocus, setMistakeFocus] = useState<string | null>(null);
  const setMistakeMode = (next: boolean) => {
    setMistakeModeState(next);
    setMistakeFocus(null);
    writeCourseValue('session', MISTAKE_MODE_KEY, courseId, next);
  };
  const activeMistakeFocus = progressGroups.some((group) => group.key === mistakeFocus)
    ? mistakeFocus
    : null;
  // 从错题本去重做：记下这一轮的题，回来时看哪些改对了。
  const [redoResult, setRedoResult] = useState<{
    title: string;
    fixed: LocalProblem[];
    still: LocalProblem[];
  } | null>(null);
  const startMistakePractice = (problems: LocalProblem[], initial: LocalProblem, title: string) => {
    writeCourseValue('session', MISTAKE_REDO_KEY, courseId, {
      ids: problems.map((problem) => problem.id),
      at: Date.now(),
      title,
    });
    startPractice(problems, initial, title, true);
  };
  useEffect(() => {
    if (!progressById) return;
    const round = readCourseValue<{ ids: string[]; at: number; title: string }>(
      'session',
      MISTAKE_REDO_KEY,
      courseId,
    );
    if (!round) return;
    const done = round.ids.flatMap((id) => {
      const row = progressById.get(id);
      const problem = sourceProblems.get(id);
      return problem && row && (row.lastAttemptAt ?? 0) > round.at ? [{ problem, row }] : [];
    });
    if (!done.length) return;
    writeCourseValue('session', MISTAKE_REDO_KEY, courseId, null);
    setRedoResult({
      title: round.title,
      fixed: done.filter(({ row }) => row.status === 'passed').map(({ problem }) => problem),
      still: done.filter(({ row }) => row.status !== 'passed').map(({ problem }) => problem),
    });
  }, [courseId, progressById, sourceProblems]);
  const redoCard = redoResult ? (
    <MistakeRedoResult
      title={redoResult.title}
      fixed={redoResult.fixed}
      still={redoResult.still}
      onRemoveFixed={() => {
        removeMistakes(
          courseId,
          redoResult.fixed.map((problem) => problem.id),
        );
        setRedoResult(null);
      }}
      onKeep={() => setRedoResult(null)}
      onRetry={() => {
        const still = redoResult.still;
        setRedoResult(null);
        startMistakePractice(still, still[0], redoResult.title);
      }}
    />
  ) : null;
  // ---------- 章节里：答题卡 ----------
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>('all');
  const [view, setViewState] = useState<SheetView>(() =>
    readJson<SheetView>('local', VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid',
  );
  const setView = (next: SheetView) => {
    setViewState(next);
    writeJson('local', VIEW_STORAGE_KEY, next);
  };
  const [listCount, setListCount] = useState(LIST_PAGE_SIZE);
  const [query, setQuery] = useState('');

  const scopeProblems = useMemo(
    () => openChapter?.problems ?? progress.problems,
    [openChapter, progress],
  );
  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const problem of scopeProblems) {
      counts.set(problem.type, (counts.get(problem.type) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [scopeProblems]);
  const difficultyCounts = useMemo(() => {
    const counts = { easy: 0, medium: 0, hard: 0 } as Record<LocalProblem['difficulty'], number>;
    for (const problem of scopeProblems) {
      if (problem.difficulty in counts) counts[problem.difficulty] += 1;
    }
    return counts;
  }, [scopeProblems]);
  const activeTypeFilter =
    typeFilter === 'all' || typeOptions.some(([type]) => type === typeFilter) ? typeFilter : 'all';
  const activeDifficultyFilter =
    difficultyFilter === 'all' || difficultyCounts[difficultyFilter] > 0 ? difficultyFilter : 'all';
  const sheetProblems = useMemo(() => {
    const filtered = scopeProblems.filter((problem) =>
      matchesProblemFilters(
        sourceProblems.get(problem.id) ?? problem,
        {
          query,
          type: activeTypeFilter,
          difficulty: activeDifficultyFilter,
          chapter: 'all',
          series: activeSeries,
        },
        useCsc108Names,
      ),
    );
    // Imported named midterms use course order even when their questions span several topics.
    if (courseSeries.test(activeSeries)) {
      filtered.sort((a, b) =>
        courseQuestionNumber(a.tags).localeCompare(courseQuestionNumber(b.tags), 'en', {
          numeric: true,
        }),
      );
    } else if (namedMidtermYear(activeSeries)) {
      filtered.sort((a, b) =>
        problemOrder(sourceProblems.get(a.id) ?? a, sourceProblems.get(b.id) ?? b),
      );
    }
    return filtered;
  }, [
    scopeProblems,
    query,
    activeDifficultyFilter,
    activeTypeFilter,
    sourceProblems,
    activeSeries,
    useCsc108Names,
  ]);

  const hasFilters = Boolean(
    query.trim() || activeSeries || activeTypeFilter !== 'all' || activeDifficultyFilter !== 'all',
  );
  const [searchCount, setSearchCount] = useState(LIST_PAGE_SIZE);
  const searchResults = hasFilters ? sheetProblems : [];

  const visibleSeriesOptions = problemPaperSeries(scopeProblems, useCsc108Names);
  const filterValues: BankFilterValues = {
    series: activeSeries,
    difficulty: activeDifficultyFilter,
    type: activeTypeFilter,
  };
  const filterGroups: BankFilterGroup[] = [
    // 已经在一套题里面时不再按套题筛。
    ...(visibleSeriesOptions.length && !isPaperSetKey(openChapter?.key)
      ? [
          {
            key: 'series' as const,
            label: '套题',
            allLabel: '全部套题',
            options: [
              { value: '', label: '全部套题', count: scopeProblems.length },
              ...visibleSeriesOptions.map(([value, count]) => ({ value, label: value, count })),
            ],
          },
        ]
      : []),
    {
      key: 'difficulty',
      label: '难度',
      allLabel: '全部难度',
      options: [
        { value: 'all', label: '全部难度', count: scopeProblems.length },
        ...DIFFICULTY_OPTIONS.filter((option) => difficultyCounts[option.value] > 0).map(
          (option) => ({
            value: option.value,
            label: option.label,
            count: difficultyCounts[option.value],
            icon: <img className="pb-filter-gem" src={marbleImages[option.color]} alt="" />,
          }),
        ),
      ],
    },
    {
      key: 'type',
      label: '题型',
      allLabel: '全部题型',
      options: [
        { value: 'all', label: '全部题型', count: scopeProblems.length },
        ...typeOptions.map(([value, count]) => ({ value, label: problemTypeLabel(value), count })),
      ],
    },
  ];
  const applyFilters = (values: BankFilterValues) => {
    setSeriesSelection({ courseId, tag: values.series });
    setDifficultyFilter(values.difficulty as DifficultyFilter);
    setTypeFilter(values.type);
    setSearchCount(LIST_PAGE_SIZE);
    setListCount(LIST_PAGE_SIZE);
  };
  const clearFilters = () => {
    applyFilters({ series: '', difficulty: 'all', type: 'all' });
    setQuery('');
  };
  const filterTitle = [
    activeSeries,
    activeDifficultyFilter !== 'all' ? difficultyLabel(activeDifficultyFilter) : '',
    activeTypeFilter !== 'all' ? problemTypeLabel(activeTypeFilter) : '',
    query.trim(),
  ]
    .filter(Boolean)
    .join(' · ');

  const [resetTarget, setResetTarget] = useState<{
    courseId: string;
    label: string;
    ids: string[];
    through: number;
  } | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState('');
  const resetInFlight = useRef(false);
  const [roundRevision, setRoundRevision] = useState(0);
  const resetDialog = useRef<HTMLDialogElement>(null);
  const cancelReset = () => {
    if (!resetInFlight.current) setResetTarget(null);
  };
  useBackDismiss(resetTarget?.courseId === courseId, cancelReset, 40);
  useEffect(() => {
    if (resetTarget?.courseId !== courseId) return;
    const dialog = resetDialog.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, [courseId, resetTarget]);
  const confirmReset = async () => {
    if (!resetTarget || resetTarget.courseId !== courseId || resetInFlight.current) return;
    resetInFlight.current = true;
    setResetBusy(true);
    setResetError('');
    try {
      await resetBankProblems(
        await getLocalRepository(),
        courseId,
        resetTarget.ids,
        resetTarget.through,
      );
      notifyProblemProgress();
      setRoundRevision((r) => r + 1);
      setResetTarget(null);
    } catch (error) {
      setResetError(error instanceof Error ? error.message : '重置失败，请重试。');
    } finally {
      resetInFlight.current = false;
      setResetBusy(false);
    }
  };
  const filterBar = (
    <>
      <ProblemBankFilters
        key={courseId}
        groups={filterGroups}
        values={filterValues}
        query={query}
        onQueryChange={(next) => {
          setQuery(next);
          setSearchCount(LIST_PAGE_SIZE);
          setListCount(LIST_PAGE_SIZE);
        }}
        onChange={applyFilters}
        canReset={sheetProblems.length > 0}
        onReset={() => {
          const label = [
            workspace.course.name,
            openChapter?.title ?? bankTabs.find((t) => t.mode === bankMode)?.label,
            filterTitle,
          ]
            .filter(Boolean)
            .join(' · ');
          setResetError('');
          setResetTarget({
            courseId,
            label,
            ids: [...new Set(sheetProblems.map((p) => p.id))],
            through: Date.now(),
          });
        }}
        resultCount={(values) =>
          scopeProblems.filter((problem) =>
            matchesProblemFilters(
              sourceProblems.get(problem.id) ?? problem,
              {
                query,
                ...values,
                chapter: 'all',
              },
              useCsc108Names,
            ),
          ).length
        }
        onUploadFiles={onUploadFiles}
        onUpload={onUpload}
      />
      {resetTarget?.courseId === courseId && (
        <dialog
          ref={resetDialog}
          className="phone-confirm pb-reset-confirm"
          role="alertdialog"
          aria-label="重置当前范围的做题进度？"
          onCancel={(event) => {
            event.preventDefault();
            cancelReset();
          }}
        >
          <strong className="phone-confirm-title">重置当前范围的做题进度？</strong>
          <p className="phone-confirm-message">
            「{resetTarget.label}」共 {resetTarget.ids.length}{' '}
            道题。确认后，这些题会恢复为未作答。已提交的课堂记录会保留。
          </p>
          {resetError && (
            <p role="alert" className="phone-confirm-message">
              {resetError}
            </p>
          )}
          <div className="phone-confirm-actions">
            <button
              type="button"
              className="phone-confirm-button"
              disabled={resetBusy}
              onClick={cancelReset}
            >
              取消
            </button>
            <button
              type="button"
              className="phone-confirm-button is-primary is-destructive"
              disabled={resetBusy}
              onClick={() => void confirmReset()}
            >
              {resetBusy ? '正在重置…' : '确认重置'}
            </button>
          </div>
        </dialog>
      )}
    </>
  );
  const courseLabel = workspace.course.courseCode || workspace.course.name;
  if (!bankProblems.length) {
    return (
      <section className="pb-page pb-redesigned" aria-label="课程题库">
        <BankHeader title="题库" subtitle={courseLabel} onBack={onBack} />
        <div className="pb-scroll">
          <div className="pb-column">
            <LearningEmptyState
              title="还没有题目"
              action={
                onUpload
                  ? {
                      label: '上传题目',
                      icon: <img src={marbleImages.pink} alt="" />,
                      onClick: onUpload,
                    }
                  : undefined
              }
            />
          </div>
        </div>
      </section>
    );
  }

  if (openChapter) {
    const next = firstUnpassed(sheetProblems);
    const allPassed = sheetProblems.length > 0 && !next;
    // 这一章的作答情况：宽屏放在右侧栏，窄屏是标题下的一行。
    const chapterStats = (() => {
      let passed = 0;
      let wrong = 0;
      for (const problem of openChapter.problems) {
        const status = statuses.get(problem.id);
        if (status === 'passed') passed += 1;
        else if (status === 'failed' || status === 'partial') wrong += 1;
      }
      return [
        { key: 'passed', label: '通过', count: passed, color: STATUS_MARBLES.passed },
        { key: 'failed', label: '错题', count: wrong, color: STATUS_MARBLES.failed },
        {
          key: 'todo',
          label: '没做',
          count: openChapter.problems.length - passed - wrong,
          color: null,
        },
      ] as const;
    })();
    const practice = (problem?: LocalProblem) =>
      startPractice(
        sheetProblems,
        problem,
        filterTitle ? `${openChapter.title} · ${filterTitle}` : openChapter.title,
      );
    return (
      <section className="pb-page pb-redesigned" aria-label={`${openChapter.title} 题目`}>
        <BankHeader title={openChapter.title} subtitle={courseLabel} onBack={onBack} />
        <div className="pb-scroll">
          <div className="pb-column">
            {liveBanner}
            <div className="pb-chapter-head" style={accentVars(openChapter.color)}>
              {bankTabs.length > 1 ||
              chapters.length > 1 ||
              openChapter.key === ALL_CHAPTERS ||
              isPaperSetKey(openChapter.key) ? (
                <button
                  type="button"
                  className="pb-wall-back"
                  onClick={() => openChapterKey(null)}
                  aria-label={isPaperSetKey(openChapter.key) ? '回到套题' : '回到章节'}
                >
                  <ArrowLeft size={16} />
                </button>
              ) : null}
              <ChapterMarble chapter={openChapter} />
              <strong>{openChapter.title}</strong>
              {openChapter.sourceTag && (
                <span className="pb-paper-source">{openChapter.sourceTag}</span>
              )}
              <ChapterTube chapter={openChapter} />
              <div
                className="pb-view-toggle"
                role="group"
                aria-label="显示方式"
                hidden={Boolean(teachLive.live)}
              >
                <button
                  type="button"
                  className={view === 'grid' ? 'is-active' : ''}
                  onClick={() => setView('grid')}
                  aria-label="答题卡"
                  aria-pressed={view === 'grid'}
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  type="button"
                  className={view === 'list' ? 'is-active' : ''}
                  onClick={() => setView('list')}
                  aria-label="列表"
                  aria-pressed={view === 'list'}
                >
                  <List size={16} />
                </button>
              </div>
            </div>

            {filterBar}
            {hasFilters ? (
              <div className="pb-filter-result" role="status">
                <button type="button" onClick={clearFilters}>
                  清除筛选
                </button>
                <span>找到 {sheetProblems.length} 道题</span>
              </div>
            ) : null}
            <div className="pb-chapter-body">
              <aside
                className="pb-chapter-stats-row"
                aria-label={
                  isPaperSetKey(openChapter.key) ? '这一套的作答情况' : '这一章的作答情况'
                }
              >
                <div className="pb-chapter-stats" aria-label="这一章">
                  {chapterStats.map((stat) => (
                    <span key={stat.key} className={`is-${stat.key}`}>
                      {stat.color ? (
                        <img src={marbleImages[stat.color]} alt="" />
                      ) : (
                        <i aria-hidden />
                      )}
                      <b>{stat.count}</b>
                      <small>{stat.label}</small>
                    </span>
                  ))}
                </div>
              </aside>

              <div className="pb-chapter-main">
                {sheetProblems.length === 0 ? (
                  <LearningEmptyState title="没有找到题目" />
                ) : view === 'grid' && !teachLive.live ? (
                  <>
                    <div className="pb-sheet" role="list">
                      {sheetProblems.map((problem, index) => (
                        <span
                          key={problem.id}
                          role="listitem"
                          style={{ animationDelay: `${Math.min(index, 40) * 10}ms` }}
                        >
                          <LayerItem label={problem.title} onMore={moreFor(problem)}>
                            <SheetCell
                              number={hasFilters ? index + 1 : numberIn(openChapter, problem)}
                              status={statuses.get(problem.id)}
                              previouslyIncorrect={historicalMistakes.has(problem.id)}
                              difficulty={problem.difficulty}
                              title={
                                problem.chapterName
                                  ? `${problem.chapterName} · ${problem.title}`
                                  : problem.title
                              }
                              fresh={layered && isProblemNew(layers, problem.id)}
                              onClick={() => practice(problem)}
                            />
                            {layered ? (
                              <span className="lay-grid-badges">{badgesFor(problem, false)}</span>
                            ) : null}
                          </LayerItem>
                        </span>
                      ))}
                    </div>
                    <div className="pb-legend" aria-hidden>
                      {(['passed', 'partial', 'failed'] as const).map((status) => (
                        <span key={status}>
                          <img src={marbleImages[STATUS_MARBLES[status]]} alt="" />
                          {STATUS_LABELS[status]}
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <ol className="pb-list">
                      {sheetProblems.slice(0, listCount).map((problem, index) => (
                        <li
                          key={problem.id}
                          className={sessionToggleFor(problem) ? 'tl-has-action' : undefined}
                          style={{ animationDelay: `${Math.min(index, 12) * 24}ms` }}
                        >
                          <LayerItem label={problem.title} onMore={moreFor(problem)}>
                            <ProblemRow
                              problem={problem}
                              number={hasFilters ? index + 1 : numberIn(openChapter, problem)}
                              status={statuses.get(problem.id)}
                              badges={badgesFor(problem)}
                              onClick={() => practice(problem)}
                            />
                          </LayerItem>
                          {sessionToggleFor(problem)}
                        </li>
                      ))}
                    </ol>
                    {sheetProblems.length > listCount ? (
                      <button
                        type="button"
                        className="pb-more"
                        onClick={() => setListCount((count) => count + LIST_PAGE_SIZE)}
                      >
                        再看 {Math.min(LIST_PAGE_SIZE, sheetProblems.length - listCount)} 题
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {sheetProblems.length ? (
          <button type="button" className="pb-start" onClick={() => practice(next)}>
            <span className="pb-start-marbles" aria-hidden>
              {(['green', 'amber', 'pink'] as const).map((color) => (
                <img key={color} src={marbleImages[color]} alt="" />
              ))}
            </span>
            {isPaperSetKey(openChapter.key)
              ? allPassed
                ? '再做一遍'
                : '继续做'
              : allPassed
                ? '再刷一遍'
                : '继续刷'}
            {next ? <small>{`第 ${sheetProblems.indexOf(next) + 1} 题`}</small> : null}
          </button>
        ) : null}
        {layerOverlays}
      </section>
    );
  }

  // ---------- 章节墙 ----------
  return (
    <section
      className={`pb-page pb-redesigned${mistakeMode ? ' is-mistake-mode' : ''}`}
      aria-label={mistakeMode ? '错题本' : '课程题库'}
    >
      <BankHeader title="题库" subtitle={courseLabel} onBack={onBack} />
      <div className="pb-scroll">
        <div className="pb-column">
          {liveBanner}
          {mistakeMode ? null : filterBar}
          {hasFilters && !mistakeMode ? (
            <div className="pb-filter-result" role="status">
              <button type="button" onClick={clearFilters}>
                清除筛选
              </button>
              <span>找到 {sheetProblems.length} 道题</span>
            </div>
          ) : null}

          <div className="pb-chapter-body pb-bank-body">
            <div className="pb-chapter-main">
              {mistakeMode ? (
                <>
                  {bankTabs.length > 1 ? (
                    <div className="pb-bank-toolbar">
                      <div className="pb-mode-switch" role="tablist" aria-label="错题分组">
                        {bankTabs.map(({ mode, label }) => (
                          <button
                            key={mode}
                            type="button"
                            role="tab"
                            aria-selected={bankMode === mode}
                            className={bankMode === mode ? 'is-active' : ''}
                            onClick={() => {
                              setBankMode(mode);
                              setMistakeFocus(null);
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <MistakeBookView
                    courseId={courseId}
                    entries={mistakeEntries}
                    groups={progressGroups}
                    groupLabel={bankMode === 'chapters' ? '章' : '套'}
                    focusKey={activeMistakeFocus}
                    onClearFocus={() => setMistakeFocus(null)}
                    numberOf={(problem, group) =>
                      isPaperSetKey(group.key)
                        ? group.problems.indexOf(problem) + 1
                        : numberById.get(problem.id)
                    }
                    loading={attemptHistory.loading}
                    onBack={() => setMistakeMode(false)}
                    onPractice={startMistakePractice}
                  />
                </>
              ) : hasFilters ? (
                searchResults.length ? (
                  <>
                    {hasFilters ? (
                      <div className="pb-series-summary">
                        <span>
                          <strong>{filterTitle}</strong> · {searchResults.length} 题
                        </span>
                        <button
                          type="button"
                          className="pb-wall-go"
                          onClick={() =>
                            startPractice(
                              searchResults,
                              courseSeries.test(activeSeries)
                                ? searchResults[0]
                                : firstUnpassed(searchResults),
                              filterTitle,
                            )
                          }
                        >
                          <Play size={12} fill="currentColor" />
                          开始练习
                        </button>
                      </div>
                    ) : null}
                    <ol className="pb-list pb-search-results">
                      {searchResults.slice(0, searchCount).map((problem, index) => (
                        <li
                          key={problem.id}
                          className={sessionToggleFor(problem) ? 'tl-has-action' : undefined}
                          style={{ animationDelay: `${Math.min(index, 12) * 24}ms` }}
                        >
                          <LayerItem label={problem.title} onMore={moreFor(problem)}>
                            <ProblemRow
                              problem={problem}
                              number={hasFilters ? index + 1 : numberById.get(problem.id)}
                              status={statuses.get(problem.id)}
                              badges={badgesFor(problem)}
                              onClick={() => {
                                startPractice(searchResults, problem, filterTitle);
                              }}
                            />
                          </LayerItem>
                          {sessionToggleFor(problem)}
                        </li>
                      ))}
                    </ol>
                    {searchResults.length > searchCount ? (
                      <button
                        type="button"
                        className="pb-more"
                        onClick={() => setSearchCount((count) => count + LIST_PAGE_SIZE)}
                      >
                        再看 {Math.min(LIST_PAGE_SIZE, searchResults.length - searchCount)} 题
                      </button>
                    ) : null}
                  </>
                ) : (
                  <LearningEmptyState title="没有找到题目" />
                )
              ) : (
                <>
                  {mistakes.length ? (
                    <div className="pb-hero">
                      <button
                        type="button"
                        className="pb-hero-card is-mistakes"
                        style={accentVars('pink')}
                        onClick={() => setMistakeMode(true)}
                      >
                        <span className="pb-hero-stack" aria-hidden>
                          {mistakes.slice(0, 3).map((problem) => (
                            <img key={problem.id} src={marbleImages.pink} alt="" />
                          ))}
                        </span>
                        <span className="pb-hero-copy">
                          <small>错题本</small>
                          <strong>{mistakes.length} 道错题</strong>
                        </span>
                        <span className="pb-hero-go" aria-hidden>
                          <Play size={16} fill="currentColor" />
                        </span>
                      </button>
                    </div>
                  ) : null}

                  <div className="pb-bank-toolbar">
                    {bankTabs.length > 1 ? (
                      <div className="pb-mode-switch" role="tablist" aria-label="题库分组">
                        {bankTabs.map(({ mode, label, count }) => (
                          <button
                            key={mode}
                            type="button"
                            role="tab"
                            aria-selected={bankMode === mode}
                            className={bankMode === mode ? 'is-active' : ''}
                            onClick={() => setBankMode(mode)}
                          >
                            {label}
                            <small>{count}</small>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <p className="phone-group-title pb-bank-summary">
                      <span>
                        {progressGroups.length} {bankMode === 'chapters' ? '章' : '套'} · 共{' '}
                        {progressTotal} 道题
                      </span>
                      <span>
                        {progress.passed}/{progressTotal} 通过
                      </span>
                    </p>
                  </div>
                  {bankMode !== 'chapters' && !visiblePaperSets.length ? (
                    <p role="status">暂无{bankMode}套题</p>
                  ) : null}
                  {bankMode !== 'chapters' ? (
                    [...new Set(visiblePaperSets.map((set) => set.kind))].map((kind) => {
                      const sets = visiblePaperSets.filter((set) => set.kind === kind);
                      const total = sets.reduce((sum, set) => sum + set.problems.length, 0);
                      const done = sets.filter((set) => !firstUnpassed(set.problems)).length;
                      return (
                        <section key={kind} className="pb-set-group">
                          <p className="phone-group-title pb-wall-title">
                            <span>
                              {paperSetTitles[kind]} · {sets.length} 套 · {total} 题
                            </span>
                            <span>
                              {done}/{sets.length} 套做完
                            </span>
                          </p>
                          <div className="pb-wall">
                            {sets.map((set, index) => {
                              const nextInSet = firstUnpassed(set.problems);
                              return (
                                <div
                                  key={set.key}
                                  className={`pb-wall-card pb-set-card${nextInSet ? '' : ' is-done'}`}
                                  style={{
                                    ...accentVars(set.color),
                                    animationDelay: `${Math.min(index, 16) * 26}ms`,
                                  }}
                                >
                                  <button
                                    type="button"
                                    className="pb-wall-open"
                                    onClick={() => openChapterKey(set.key)}
                                  >
                                    <ChapterMarble chapter={set} />
                                    <span className="pb-set-copy">
                                      <strong>{set.title}</strong>
                                      <small>
                                        {set.sourceTag && (
                                          <span className="pb-paper-source">{set.sourceTag}</span>
                                        )}
                                        {set.problems.length} 题
                                      </small>
                                    </span>
                                  </button>
                                  <div className="pb-wall-foot">
                                    <ChapterTube chapter={set} />
                                    <button
                                      type="button"
                                      className="pb-wall-go"
                                      onClick={() =>
                                        startPractice(set.problems, nextInSet, set.title)
                                      }
                                    >
                                      <Play size={12} fill="currentColor" />
                                      {set.passed + set.failed + set.partial === 0
                                        ? '开始做'
                                        : nextInSet
                                          ? '继续做'
                                          : '再做一遍'}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })
                  ) : (
                    <>
                      <div className="pb-wall">
                        {chapters.map((chapter, index) => {
                          const nextInChapter = firstUnpassed(chapter.problems);
                          const freshCount = layered
                            ? chapter.problems.filter((problem) => isProblemNew(layers, problem.id))
                                .length
                            : 0;
                          return (
                            <div
                              key={chapter.key}
                              className={`pb-wall-card${nextInChapter ? '' : ' is-done'}`}
                              style={{
                                ...accentVars(chapter.color),
                                animationDelay: `${Math.min(index, 16) * 26}ms`,
                              }}
                            >
                              <button
                                type="button"
                                className="pb-wall-open"
                                onClick={() => openChapterKey(chapter.key)}
                              >
                                <ChapterMarble chapter={chapter} />
                                <strong>{chapter.title}</strong>
                                {freshCount ? (
                                  <span className="pb-wall-new">
                                    <LayerBadges fresh />
                                    {freshCount > 1 ? (
                                      <b className="pb-wall-new-count">{freshCount}</b>
                                    ) : null}
                                  </span>
                                ) : null}
                              </button>
                              <div className="pb-wall-foot">
                                <ChapterTube chapter={chapter} />
                                <button
                                  type="button"
                                  className="pb-wall-go"
                                  onClick={() =>
                                    startPractice(chapter.problems, nextInChapter, chapter.title)
                                  }
                                >
                                  <Play size={12} fill="currentColor" />
                                  {nextInChapter ? '继续刷' : '再刷'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
            <BankAnalytics
              key={roundRevision}
              courseId={courseId}
              mode={bankMode}
              problems={progress.problems}
              records={progressById}
              groups={progressGroups}
              mistakes={mistakeCounts}
              mistakeMode={mistakeMode}
              onToggleMistakes={() => setMistakeMode(!mistakeMode)}
              onOpenGroup={openChapterKey}
              focusKey={activeMistakeFocus}
              onFocusGroup={setMistakeFocus}
              previewComparison={previewComparison}
            />
          </div>
        </div>
      </div>
      {layerOverlays}
      {redoCard}
    </section>
  );
}
