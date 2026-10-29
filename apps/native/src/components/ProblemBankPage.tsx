import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ArrowLeft, Check, ChevronLeft, LayoutGrid, List, Play, Search, X } from 'lucide-react';

import { difficultyLabel, problemTypeLabel } from '../data/local-problem-grading';
import { matchesProblemFilters, problemPaperSeries } from '../data/problem-bank-filters';
import { ProblemTitleText } from './problem-bank/problem-rich-text';
import {
  SheetCell,
  STATUS_LABELS,
  STATUS_MARBLES,
  useProblemStatuses,
  type ProblemStatus,
} from './problem-bank/answer-sheet';
import { LearningEmptyState } from './LearningEmptyState';
import type { LocalCourseWorkspace, LocalProblem } from '../domain/models';
import { DIFFICULTY_MARBLES, marbleImages, type MarbleColor } from '../lib/learning-action-marbles';
import { notebookMarbleColor, splitNotebookName } from '../lib/notebook-reading';
import { MaterialUploadButton } from './MaterialUploadButton';
import {
  CourseReleaseButton,
  LayerActionMenu,
  LayerBadges,
  LayerItem,
  type LayerMenuTarget,
} from './CourseLayerControls';
import { getLocalRepository } from '../data/repository';
import {
  isPrivateProblem,
  isProblemContentUpdated,
  isProblemNew,
  refreshCourseLayers,
  removeCourseContent,
  useCourseLayers,
} from '../lib/course-layers';
import './course-pages.css';
import { localizeProblem, type ProblemContentLanguage } from '../lib/problem-language';

export type ProblemBankLaunch = {
  language?: ProblemContentLanguage;
  problemIds: string[];
  initialProblemId: string;
  /** 每道题在这一章里的题号，做题页的答题卡用。 */
  numbers?: Record<string, number>;
  /** 这一组题的名字（章节名 / 错题重练）。 */
  title?: string;
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
  canRelease?: boolean;
  /** 删除、恢复、复制之后重新同步这门课。 */
  onContentChanged?: () => Promise<void> | void;
};

type TypeFilter = 'all' | string;
type DifficultyFilter = 'all' | LocalProblem['difficulty'];
type SheetView = 'grid' | 'list';

type Chapter = {
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

type LastSession = { chapterKey: string; problemId: string; at: number };

const UNSORTED_CHAPTER = '__unsorted__';
const ALL_CHAPTERS = '__all_chapters__';
const COURSE_CHAPTER_PREFIX = 'course-chapter:';
const LAST_STORAGE_KEY = 'syntara.problem-bank-last.v1';
const VIEW_STORAGE_KEY = 'syntara.problem-bank-view.v1';
// 从做题页回来时回到刚才那一章（只在这次打开 App 期间记着）。
const OPEN_CHAPTER_KEY = 'syntara.problem-bank-open-chapter';
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

/** 一根玻璃管：通过、部分对、错了按比例排开，后面是「通过 / 总数」。 */
function ChapterTube({ chapter }: { chapter: Chapter }) {
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
          {[problem.chapterName, ...problem.tags.slice(0, 2)].filter(Boolean).join(' · ')}
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
  canRelease = false,
  onContentChanged,
}: ProblemBankPageProps) {
  const courseId = workspace.course.id;
  const sourceProblems = useMemo(
    () => new Map(workspace.problems.map((problem) => [problem.id, problem])),
    [workspace.problems],
  );
  const releaseControl = canRelease ? <CourseReleaseButton courseId={courseId} /> : null;
  const [statuses] = useProblemStatuses(courseId, workspace.problems);
  const layers = useCourseLayers(courseId);
  const [menuTarget, setMenuTarget] = useState<LayerMenuTarget | null>(null);
  const lastAttemptAt = useLastAttemptTimes(courseId, workspace.problems);
  useEffect(() => {
    if (layered) void refreshCourseLayers(courseId).catch(() => undefined);
  }, [courseId, layered]);
  const badgesFor = (problem: LocalProblem, showFresh = true) =>
    layered ? (
      <LayerBadges
        fresh={showFresh && isProblemNew(layers, problem.id)}
        updated={isProblemContentUpdated(layers, problem.id, lastAttemptAt.get(problem.id))}
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
    const published = workspace.problems.filter(
      (problem) =>
        problem.status === 'published' ||
        (layered && problem.status === 'draft' && isPrivateProblem(layers, problem.id)),
    );
    const visible = published.length
      ? published
      : workspace.problems.filter((problem) => problem.status !== 'archived');
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
        chapter = {
          key,
          number: name?.number ?? null,
          title: courseChapter
            ? problem.chapterName?.trim() || '未命名章节'
            : (name?.title ??
              (key === UNSORTED_CHAPTER
                ? '未分章节'
                : key.startsWith('tag:')
                  ? key.slice(4)
                  : key)),
          color: index === undefined ? null : notebookMarbleColor(index),
          order: courseChapter ? Number.MAX_SAFE_INTEGER - 1 : (index ?? Number.MAX_SAFE_INTEGER),
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
  const chapterByKey = useMemo(
    () => new Map([...chapters, allChapter].map((chapter) => [chapter.key, chapter])),
    [chapters, allChapter],
  );

  const [openKey, setOpenKey] = useState<string | null>(() =>
    readCourseValue<string>('session', OPEN_CHAPTER_KEY, courseId),
  );
  const seriesOptions = useMemo(() => problemPaperSeries(bankProblems), [bankProblems]);
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
      : chapters.length === 1
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

  const [lastSession, setLastSession] = useState<LastSession | null>(() =>
    readCourseValue<LastSession>('local', LAST_STORAGE_KEY, courseId),
  );

  const startPractice = useCallback(
    (
      problems: LocalProblem[],
      initial: LocalProblem | undefined,
      title: string,
      chapterKey: string | null,
    ) => {
      if (!problems.length) return;
      const start = initial ?? problems[0];
      if (chapterKey) {
        const next: LastSession = { chapterKey, problemId: start.id, at: Date.now() };
        writeCourseValue('local', LAST_STORAGE_KEY, courseId, next);
        setLastSession(next);
      }
      onPractice({
        language: 'zh-CN',
        problemIds: problems.map((problem) => problem.id),
        initialProblemId: start.id,
        numbers: Object.fromEntries(
          problems
            .filter((problem) => numberById.has(problem.id))
            .map((problem) => [problem.id, numberById.get(problem.id)!]),
        ),
        title,
      });
    },
    [courseId, numberById, onPractice],
  );

  /** 「继续刷」：这一组里第一道还没通过的题。 */
  const firstUnpassed = (problems: LocalProblem[]) =>
    problems.find((problem) => statuses.get(problem.id) !== 'passed');

  // 错题重练：做错和只做对一部分的题，按章节和题号排。
  const mistakes = useMemo(
    () =>
      chapters.flatMap((chapter) =>
        chapter.problems.filter((problem) => {
          const status = statuses.get(problem.id);
          return status === 'failed' || status === 'partial';
        }),
      ),
    [chapters, statuses],
  );
  const passedTotal = useMemo(
    () => chapters.reduce((sum, chapter) => sum + chapter.passed, 0),
    [chapters],
  );

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

  const chapterProblems = useMemo(() => openChapter?.problems ?? [], [openChapter]);
  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const problem of chapterProblems) {
      counts.set(problem.type, (counts.get(problem.type) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [chapterProblems]);
  const difficultyCounts = useMemo(() => {
    const counts = { easy: 0, medium: 0, hard: 0 } as Record<LocalProblem['difficulty'], number>;
    for (const problem of chapterProblems) {
      if (problem.difficulty in counts) counts[problem.difficulty] += 1;
    }
    return counts;
  }, [chapterProblems]);
  const activeTypeFilter =
    typeFilter === 'all' || typeOptions.some(([type]) => type === typeFilter) ? typeFilter : 'all';
  const activeDifficultyFilter =
    difficultyFilter === 'all' || difficultyCounts[difficultyFilter] > 0 ? difficultyFilter : 'all';
  const sheetProblems = useMemo(
    () =>
      chapterProblems.filter((problem) =>
        matchesProblemFilters(sourceProblems.get(problem.id) ?? problem, {
          query,
          type: activeTypeFilter,
          difficulty: activeDifficultyFilter,
          chapter: 'all',
          series: activeSeries,
        }),
      ),
    [
      chapterProblems,
      query,
      activeDifficultyFilter,
      activeTypeFilter,
      sourceProblems,
      activeSeries,
    ],
  );

  // ---------- 章节墙：搜索 ----------
  const [searchCount, setSearchCount] = useState(LIST_PAGE_SIZE);
  const searchResults = useMemo(() => {
    const q = query.trim();
    if (!q && !activeSeries) return [];
    return chapters.flatMap((chapter) =>
      chapter.problems.filter((problem) =>
        matchesProblemFilters(sourceProblems.get(problem.id) ?? problem, {
          query: q,
          type: 'all',
          difficulty: 'all',
          chapter: 'all',
          series: activeSeries,
        }),
      ),
    );
  }, [chapters, query, sourceProblems, activeSeries]);

  const visibleSeriesOptions = problemPaperSeries(openChapter?.problems ?? bankProblems);
  const chooseSeries = (tag: string) => {
    setSeriesSelection({ courseId, tag });
    setSearchCount(LIST_PAGE_SIZE);
    setListCount(LIST_PAGE_SIZE);
  };
  const seriesFilter = visibleSeriesOptions.length ? (
    <section className="pb-series-panel" aria-label="系列筛选">
      <h3>系列</h3>
      <div className="pb-series-options" role="group" aria-label="试卷系列">
        <button
          type="button"
          className={!activeSeries ? 'is-active' : ''}
          aria-pressed={!activeSeries}
          onClick={() => chooseSeries('')}
        >
          <span>全部系列</span>
          <small>{openChapter?.problems.length ?? bankProblems.length}</small>
        </button>
        {visibleSeriesOptions.map(([tag, count]) => (
          <button
            key={tag}
            type="button"
            className={activeSeries === tag ? 'is-active' : ''}
            aria-pressed={activeSeries === tag}
            onClick={() => chooseSeries(activeSeries === tag ? '' : tag)}
          >
            <span>{tag}</span>
            <small>{count}</small>
          </button>
        ))}
      </div>
    </section>
  ) : null;

  const courseLabel = workspace.course.courseCode || workspace.course.name;
  if (!bankProblems.length) {
    return (
      <section className="pb-page" aria-label="课程题库">
        <BankHeader title="题库" subtitle={courseLabel} onBack={onBack} />
        <div className="pb-scroll">
          <div className="pb-column">
            {releaseControl}
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
        activeSeries ? `${openChapter.title} · ${activeSeries}` : openChapter.title,
        openChapter.key,
      );
    return (
      <section className="pb-page" aria-label={`${openChapter.title} 题目`}>
        <BankHeader title={openChapter.title} subtitle={courseLabel} onBack={onBack} />
        <div className="pb-scroll">
          <div className="pb-column">
            {releaseControl}
            <div className="pb-chapter-head" style={accentVars(openChapter.color)}>
              {chapters.length > 1 || openChapter.key === ALL_CHAPTERS ? (
                <button
                  type="button"
                  className="pb-wall-back"
                  onClick={() => openChapterKey(null)}
                  aria-label="回到章节"
                >
                  <ArrowLeft size={16} />
                </button>
              ) : null}
              <ChapterMarble chapter={openChapter} />
              <strong>{openChapter.title}</strong>
              <ChapterTube chapter={openChapter} />
              <div className="pb-view-toggle" role="group" aria-label="显示方式">
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

            <div className="material-search-row pb-bank-search-row">
              <label className="pb-search">
                <Search size={17} />
                <input
                  value={query}
                  aria-label="搜索题目、章节或知识点"
                  placeholder="搜索题目、章节或知识点"
                  type="search"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setListCount(LIST_PAGE_SIZE);
                  }}
                />
                {query ? (
                  <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">
                    <X size={14} />
                  </button>
                ) : null}
              </label>
            </div>
            <div className="pb-chapter-body">
              <aside className="pb-chapter-side">
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
                <div
                  className={`pb-tube${activeDifficultyFilter !== 'all' ? ' has-filter' : ''}`}
                  role="group"
                  aria-label="难度"
                >
                  {DIFFICULTY_OPTIONS.map((option) => {
                    const count = difficultyCounts[option.value];
                    if (!count) return null;
                    const active = activeDifficultyFilter === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`pb-tube-seg is-${option.color}${active ? ' is-active' : ''}`}
                        style={{ flexGrow: Math.max(count, chapterProblems.length * 0.14) }}
                        aria-pressed={active}
                        onClick={() => {
                          setDifficultyFilter((current) =>
                            current === option.value ? 'all' : option.value,
                          );
                          setListCount(LIST_PAGE_SIZE);
                        }}
                      >
                        <img src={marbleImages[option.color]} alt="" />
                        <span>{option.label}</span>
                        <b>{count}</b>
                      </button>
                    );
                  })}
                </div>

                <div className="pb-toolbar">
                  <div className="pb-chips" role="group" aria-label="题型">
                    {typeOptions.length > 1 ? (
                      <button
                        type="button"
                        className={activeTypeFilter === 'all' ? 'is-active' : ''}
                        onClick={() => setTypeFilter('all')}
                      >
                        全部题型
                      </button>
                    ) : null}
                    {typeOptions.length > 1
                      ? typeOptions.map(([type, count]) => (
                          <button
                            key={type}
                            type="button"
                            className={activeTypeFilter === type ? 'is-active' : ''}
                            onClick={() => {
                              setTypeFilter((current) => (current === type ? 'all' : type));
                              setListCount(LIST_PAGE_SIZE);
                            }}
                          >
                            {problemTypeLabel(type)}
                            <small>{count}</small>
                          </button>
                        ))
                      : null}
                  </div>
                </div>
                {seriesFilter}
              </aside>

              <div className="pb-chapter-main">
                {sheetProblems.length === 0 ? (
                  <LearningEmptyState title="没有找到题目" />
                ) : view === 'grid' ? (
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
                              number={numberById.get(problem.id)}
                              status={statuses.get(problem.id)}
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
                          style={{ animationDelay: `${Math.min(index, 12) * 24}ms` }}
                        >
                          <LayerItem label={problem.title} onMore={moreFor(problem)}>
                            <ProblemRow
                              problem={problem}
                              number={numberById.get(problem.id)}
                              status={statuses.get(problem.id)}
                              badges={badgesFor(problem)}
                              onClick={() => practice(problem)}
                            />
                          </LayerItem>
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
            {allPassed ? '再刷一遍' : '继续刷'}
            {next ? (
              <small>
                {numberById.has(next.id) ? `第 ${numberById.get(next.id)} 题` : '我的题目'}
              </small>
            ) : null}
          </button>
        ) : null}
        {layerOverlays}
      </section>
    );
  }

  // ---------- 章节墙 ----------
  const lastChapter = lastSession ? chapterByKey.get(lastSession.chapterKey) : undefined;
  const lastIndex = lastChapter
    ? Math.max(
        0,
        lastChapter.problems.findIndex((problem) => problem.id === lastSession?.problemId),
      )
    : 0;
  // 接着上次：从上次那题往后第一道没通过的；后面都过了就回到上次那题。
  const resumeTarget = lastChapter
    ? (lastChapter.problems
        .slice(lastIndex)
        .find((problem) => statuses.get(problem.id) !== 'passed') ??
      lastChapter.problems[lastIndex])
    : undefined;

  return (
    <section className="pb-page" aria-label="课程题库">
      <BankHeader title="题库" subtitle={courseLabel} onBack={onBack} />
      <div className="pb-scroll">
        <div className="pb-column">
          {releaseControl}
          <div className="material-search-row pb-bank-search-row">
            <label className="pb-search">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSearchCount(LIST_PAGE_SIZE);
                }}
                aria-label="搜索题目、章节或知识点"
                placeholder="搜索题目、章节或知识点"
                type="search"
              />
              {query ? (
                <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">
                  <X size={14} />
                </button>
              ) : null}
            </label>
            {onUploadFiles ? (
              <MaterialUploadButton label="上传题目" onFiles={onUploadFiles} />
            ) : null}
          </div>

          <div className={seriesFilter ? 'pb-chapter-body pb-series-layout' : undefined}>
            {seriesFilter ? (
              <aside className="pb-chapter-side pb-series-side" aria-label="筛选题目">
                {seriesFilter}
              </aside>
            ) : null}
            <div className={seriesFilter ? 'pb-chapter-main' : undefined}>
              {query.trim() || activeSeries ? (
                searchResults.length ? (
                  <>
                    {activeSeries ? (
                      <div className="pb-series-summary">
                        <span>
                          <strong>{activeSeries}</strong> · {searchResults.length} 题
                        </span>
                        <button
                          type="button"
                          className="pb-wall-go"
                          onClick={() =>
                            startPractice(
                              searchResults,
                              firstUnpassed(searchResults),
                              activeSeries,
                              null,
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
                          style={{ animationDelay: `${Math.min(index, 12) * 24}ms` }}
                        >
                          <LayerItem label={problem.title} onMore={moreFor(problem)}>
                            <ProblemRow
                              problem={problem}
                              number={numberById.get(problem.id)}
                              status={statuses.get(problem.id)}
                              badges={badgesFor(problem)}
                              onClick={() => {
                                startPractice(
                                  searchResults,
                                  problem,
                                  activeSeries || query.trim(),
                                  null,
                                );
                              }}
                            />
                          </LayerItem>
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
                  {(lastChapter && resumeTarget) || mistakes.length ? (
                    <div className="pb-hero">
                      {lastChapter && resumeTarget ? (
                        <button
                          type="button"
                          className="pb-hero-card is-resume"
                          style={accentVars(lastChapter.color)}
                          onClick={() =>
                            startPractice(
                              lastChapter.problems,
                              resumeTarget,
                              lastChapter.title,
                              lastChapter.key,
                            )
                          }
                        >
                          <span className="pb-hero-orb">
                            {lastChapter.color ? (
                              <img src={marbleImages[lastChapter.color]} alt="" />
                            ) : null}
                            <b>{numberById.get(resumeTarget.id)}</b>
                          </span>
                          <span className="pb-hero-copy">
                            <small>接着上次</small>
                            <strong>{lastChapter.title}</strong>
                            <ChapterTube chapter={lastChapter} />
                          </span>
                          <span className="pb-hero-go" aria-hidden>
                            <Play size={16} fill="currentColor" />
                          </span>
                        </button>
                      ) : null}
                      {mistakes.length ? (
                        <button
                          type="button"
                          className="pb-hero-card is-mistakes"
                          style={accentVars('pink')}
                          onClick={() => startPractice(mistakes, mistakes[0], '错题重练', null)}
                        >
                          <span className="pb-hero-stack" aria-hidden>
                            {mistakes.slice(0, 3).map((problem) => (
                              <img
                                key={problem.id}
                                src={
                                  marbleImages[STATUS_MARBLES[statuses.get(problem.id) ?? 'failed']]
                                }
                                alt=""
                              />
                            ))}
                          </span>
                          <span className="pb-hero-copy">
                            <small>错题重练</small>
                            <strong>{mistakes.length} 道</strong>
                          </span>
                          <span className="pb-hero-go" aria-hidden>
                            <Play size={16} fill="currentColor" />
                          </span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  <p className="phone-group-title pb-wall-title">
                    <span>{chapters.length} 章</span>
                    <span>
                      {passedTotal}/{bankProblems.length} 通过
                    </span>
                  </p>
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
                                startPractice(
                                  chapter.problems,
                                  nextInChapter,
                                  chapter.title,
                                  chapter.key,
                                )
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
            </div>
          </div>
        </div>
      </div>
      {layerOverlays}
    </section>
  );
}

/** 每道题本机最后一次作答的时间，判断「做过之后题目又改过」。 */
function useLastAttemptTimes(courseId: string, revision: unknown): Map<string, number> {
  const [times, setTimes] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    let alive = true;
    void getLocalRepository()
      .then((repository) => repository.listProblemProgress(courseId))
      .then((progress) => {
        if (!alive) return;
        setTimes(
          new Map(
            progress.flatMap((item) =>
              item.lastAttemptAt ? [[item.problemId, item.lastAttemptAt] as const] : [],
            ),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [courseId, revision]);
  return times;
}
