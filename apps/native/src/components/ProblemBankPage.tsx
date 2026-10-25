import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { ArrowLeft, Check, ChevronLeft, LayoutGrid, List, Play, Search, X } from 'lucide-react';

import { difficultyLabel, problemTypeLabel } from '../data/local-problem-grading';
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
import './course-pages.css';

export type ProblemBankLaunch = {
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

function matchesQuery(problem: LocalProblem, query: string): boolean {
  if (!query) return true;
  const haystack = [
    problem.title,
    problem.type,
    problem.tags.join(' '),
    JSON.stringify(problem.publicContent),
  ]
    .join('\n')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

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
  onClick,
}: {
  problem: LocalProblem;
  number: number | undefined;
  status: ProblemStatus | undefined;
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
        </strong>
        <small>
          <span className="pb-row-type">{problemTypeLabel(problem.type)}</span>
          {problem.tags.slice(0, 2).join(' · ')}
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
}: ProblemBankPageProps) {
  const courseId = workspace.course.id;
  const [statuses] = useProblemStatuses(courseId, workspace.problems);

  // 学生只看已发布的题；课程里还没有发布的题时（本机自建课程）就全部显示。
  const bankProblems = useMemo(() => {
    const published = workspace.problems.filter((problem) => problem.status === 'published');
    return published.length
      ? published
      : workspace.problems.filter((problem) => problem.status !== 'archived');
  }, [workspace.problems]);

  // 章节 = 题目挂的笔记本，按笔记编号排；同步来的题如果都没挂笔记本，就按第一个知识点分组。
  const chapterOf = useMemo(() => {
    const notebookIds = new Set(workspace.notebooks.map((notebook) => notebook.id));
    const anyLinked = bankProblems.some(
      (problem) => problem.notebookId && notebookIds.has(problem.notebookId),
    );
    return (problem: LocalProblem): string => {
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
        chapter = {
          key,
          number: name?.number ?? null,
          title:
            name?.title ??
            (key === UNSORTED_CHAPTER ? '未分章节' : key.startsWith('tag:') ? key.slice(4) : key),
          color: index === undefined ? null : notebookMarbleColor(index),
          order: index ?? Number.MAX_SAFE_INTEGER,
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
      chapter.problems.sort(problemOrder);
      // 知识点分组没有自己的颜色，按顺序轮着给。
      if (!chapter.color && chapter.key !== UNSORTED_CHAPTER) {
        chapter.color = notebookMarbleColor(index);
      }
    });
    return list;
  }, [bankProblems, chapterOf, statuses, workspace.notebooks]);

  // 题号：每一章里按出题顺序 1、2、3…，筛选时不变。
  const numberById = useMemo(() => {
    const numbers = new Map<string, number>();
    for (const chapter of chapters) {
      chapter.problems.forEach((problem, index) => numbers.set(problem.id, index + 1));
    }
    return numbers;
  }, [chapters]);
  const chapterByKey = useMemo(
    () => new Map(chapters.map((chapter) => [chapter.key, chapter])),
    [chapters],
  );

  const [openKey, setOpenKey] = useState<string | null>(() =>
    readCourseValue<string>('session', OPEN_CHAPTER_KEY, courseId),
  );
  // 只有一章时不需要章节墙，直接进这一章。
  const openChapter =
    chapters.length === 1 ? chapters[0] : openKey ? (chapterByKey.get(openKey) ?? null) : null;
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
        problemIds: problems.map((problem) => problem.id),
        initialProblemId: start.id,
        numbers: Object.fromEntries(
          problems.map((problem) => [problem.id, numberById.get(problem.id) ?? 0]),
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
  const sheetProblems = useMemo(
    () =>
      chapterProblems.filter(
        (problem) =>
          (typeFilter === 'all' || problem.type === typeFilter) &&
          (difficultyFilter === 'all' || problem.difficulty === difficultyFilter),
      ),
    [chapterProblems, difficultyFilter, typeFilter],
  );

  // ---------- 章节墙：搜索 ----------
  const [query, setQuery] = useState('');
  const [searchCount, setSearchCount] = useState(LIST_PAGE_SIZE);
  const searchResults = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return chapters.flatMap((chapter) =>
      chapter.problems.filter((problem) => matchesQuery(problem, q)),
    );
  }, [chapters, query]);

  const courseLabel = workspace.course.courseCode || workspace.course.name;

  if (!bankProblems.length) {
    return (
      <section className="pb-page" aria-label="课程题库">
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
    const practice = (problem?: LocalProblem) =>
      startPractice(sheetProblems, problem, openChapter.title, openChapter.key);
    return (
      <section className="pb-page" aria-label={`${openChapter.title} 题目`}>
        <BankHeader title={openChapter.title} subtitle={courseLabel} onBack={onBack} />
        <div className="pb-scroll">
          <div className="pb-column">
            <div className="pb-chapter-head" style={accentVars(openChapter.color)}>
              {chapters.length > 1 ? (
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
            </div>

            <div
              className={`pb-tube${difficultyFilter !== 'all' ? ' has-filter' : ''}`}
              role="group"
              aria-label="难度"
            >
              {DIFFICULTY_OPTIONS.map((option) => {
                const count = difficultyCounts[option.value];
                if (!count) return null;
                const active = difficultyFilter === option.value;
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
                    className={typeFilter === 'all' ? 'is-active' : ''}
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
                        className={typeFilter === type ? 'is-active' : ''}
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
                      <SheetCell
                        number={numberById.get(problem.id)}
                        status={statuses.get(problem.id)}
                        difficulty={problem.difficulty}
                        title={problem.title}
                        onClick={() => practice(problem)}
                      />
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
                      <ProblemRow
                        problem={problem}
                        number={numberById.get(problem.id)}
                        status={statuses.get(problem.id)}
                        onClick={() => practice(problem)}
                      />
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

        {sheetProblems.length ? (
          <button type="button" className="pb-start" onClick={() => practice(next)}>
            <span className="pb-start-marbles" aria-hidden>
              {(['green', 'amber', 'pink'] as const).map((color) => (
                <img key={color} src={marbleImages[color]} alt="" />
              ))}
            </span>
            {allPassed ? '再刷一遍' : '继续刷'}
            {next ? <small>第 {numberById.get(next.id)} 题</small> : null}
          </button>
        ) : null}
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
          <div className="material-search-row">
            <label className="pb-search">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSearchCount(LIST_PAGE_SIZE);
                }}
                placeholder="搜索题目或知识点"
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

          {query.trim() ? (
            searchResults.length ? (
              <>
                <ol className="pb-list pb-search-results">
                  {searchResults.slice(0, searchCount).map((problem, index) => (
                    <li
                      key={problem.id}
                      style={{ animationDelay: `${Math.min(index, 12) * 24}ms` }}
                    >
                      <ProblemRow
                        problem={problem}
                        number={numberById.get(problem.id)}
                        status={statuses.get(problem.id)}
                        onClick={() => {
                          const chapter = chapterByKey.get(chapterOf(problem));
                          if (chapter) {
                            startPractice(chapter.problems, problem, chapter.title, chapter.key);
                          }
                        }}
                      />
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
                            src={marbleImages[STATUS_MARBLES[statuses.get(problem.id) ?? 'failed']]}
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
    </section>
  );
}
