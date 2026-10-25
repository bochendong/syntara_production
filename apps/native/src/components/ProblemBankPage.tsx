import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, Play, Search, X } from 'lucide-react';

import { difficultyLabel, problemTypeLabel } from '../data/local-problem-grading';
import { ProblemTitleText } from './problem-bank/problem-rich-text';
import { LearningEmptyState } from './LearningEmptyState';
import { getLocalRepository } from '../data/repository';
import type { LocalCourseWorkspace, LocalProblem } from '../domain/models';
import { DIFFICULTY_MARBLES, marbleImages } from '../lib/learning-action-marbles';
import './course-pages.css';

export type ProblemBankLaunch = {
  problemIds: string[];
  initialProblemId: string;
};

type ProblemBankPageProps = {
  workspace: LocalCourseWorkspace;
  onBack: () => void;
  onPractice: (launch: ProblemBankLaunch) => void;
  /** 没有题目时去「资料」上传。 */
  onUpload?: () => void;
};

type TypeFilter = 'all' | string;
type DifficultyFilter = 'all' | LocalProblem['difficulty'];

const PROBLEM_BANK_PAGE_SIZE = 20;

// 难度用弹珠颜色表示：基础绿、进阶黄、挑战粉。
const DIFFICULTY_OPTIONS = (['easy', 'medium', 'hard'] as const).map((value) => ({
  value,
  label: difficultyLabel(value),
  color: DIFFICULTY_MARBLES[value],
}));

type ProblemStatus = 'passed' | 'partial' | 'failed' | 'pending';

function progressStatus(value: string | undefined): ProblemStatus | null {
  return value === 'passed' || value === 'partial' || value === 'failed' || value === 'pending'
    ? value
    : null;
}

function difficultyMarble(difficulty: LocalProblem['difficulty']): string {
  return marbleImages[DIFFICULTY_MARBLES[difficulty] ?? 'blue'];
}

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

export function ProblemBankPage({ workspace, onBack, onPractice, onUpload }: ProblemBankPageProps) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>('all');
  const [visibleCount, setVisibleCount] = useState(PROBLEM_BANK_PAGE_SIZE);
  const [statuses, setStatuses] = useState<Map<string, ProblemStatus>>(() => new Map());

  // 做过的题在弹珠上留个小记号：对了绿勾，错了粉点。
  useEffect(() => {
    let alive = true;
    void getLocalRepository()
      .then((repository) => repository.listProblemProgress(workspace.course.id))
      .then((progress) => {
        if (!alive) return;
        const next = new Map<string, ProblemStatus>();
        for (const item of progress) {
          const status = progressStatus(item.status);
          if (status) next.set(item.problemId, status);
        }
        setStatuses(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [workspace.course.id, workspace.problems]);

  // 学生只看已发布的题；课程里还没有发布的题时（本机自建课程）就全部显示。
  const bankProblems = useMemo(() => {
    const published = workspace.problems.filter((problem) => problem.status === 'published');
    return published.length
      ? published
      : workspace.problems.filter((problem) => problem.status !== 'archived');
  }, [workspace.problems]);

  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const problem of bankProblems) {
      counts.set(problem.type, (counts.get(problem.type) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [bankProblems]);

  const difficultyCounts = useMemo(() => {
    const counts = { easy: 0, medium: 0, hard: 0 } as Record<LocalProblem['difficulty'], number>;
    for (const problem of bankProblems) {
      if (problem.difficulty in counts) counts[problem.difficulty] += 1;
    }
    return counts;
  }, [bankProblems]);
  const passedCount = useMemo(
    () => bankProblems.filter((problem) => statuses.get(problem.id) === 'passed').length,
    [bankProblems, statuses],
  );

  const filteredProblems = useMemo(() => {
    return bankProblems
      .filter((problem) => {
        if (typeFilter !== 'all' && problem.type !== typeFilter) return false;
        if (difficultyFilter !== 'all' && problem.difficulty !== difficultyFilter) return false;
        return matchesQuery(problem, query.trim());
      })
      .sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title, 'zh-CN'));
  }, [bankProblems, difficultyFilter, query, typeFilter]);

  const visibleProblems = filteredProblems.slice(0, visibleCount);

  const startPractice = (initialProblemId?: string) => {
    if (!filteredProblems.length) return;
    const ids = filteredProblems.map((problem) => problem.id);
    onPractice({
      problemIds: ids,
      initialProblemId:
        initialProblemId && ids.includes(initialProblemId) ? initialProblemId : ids[0],
    });
  };

  return (
    <section className="pb-page" aria-label="课程题库">
      <header className="pb-header">
        <button type="button" className="phone-glass-button" onClick={onBack} aria-label="返回">
          <ChevronLeft size={22} />
        </button>
        <div className="pb-title">
          <strong>题库</strong>
          <small>
            {workspace.course.courseCode || workspace.course.name} · {filteredProblems.length} 题
            {passedCount ? ` · ${passedCount} 已过` : ''}
          </small>
        </div>
        <span className="pb-header-spacer" aria-hidden />
      </header>

      <div className="pb-scroll">
        <div className="pb-column">
          {bankProblems.length ? (
            <>
              <label className="pb-search">
                <Search size={17} />
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setVisibleCount(PROBLEM_BANK_PAGE_SIZE);
                  }}
                  placeholder="搜索题目或知识点"
                  type="search"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      setVisibleCount(PROBLEM_BANK_PAGE_SIZE);
                    }}
                    aria-label="清空搜索"
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </label>

              {/* 一根玻璃管：三种难度的弹珠按题数分段，点一段只看这一档。 */}
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
                      style={{ flexGrow: Math.max(count, bankProblems.length * 0.14) }}
                      aria-pressed={active}
                      onClick={() => {
                        setDifficultyFilter((current) =>
                          current === option.value ? 'all' : option.value,
                        );
                        setVisibleCount(PROBLEM_BANK_PAGE_SIZE);
                      }}
                    >
                      <img src={marbleImages[option.color]} alt="" />
                      <span>{option.label}</span>
                      <b>{count}</b>
                    </button>
                  );
                })}
              </div>

              <div className="pb-chips" role="group" aria-label="题型">
                {typeOptions.length > 1 ? (
                  <button
                    type="button"
                    className={typeFilter === 'all' ? 'is-active' : ''}
                    onClick={() => {
                      setTypeFilter('all');
                      setVisibleCount(PROBLEM_BANK_PAGE_SIZE);
                    }}
                  >
                    全部
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
                          setVisibleCount(PROBLEM_BANK_PAGE_SIZE);
                        }}
                      >
                        {problemTypeLabel(type)}
                        <small>{count}</small>
                      </button>
                    ))
                  : null}
              </div>
            </>
          ) : null}

          {!bankProblems.length ? (
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
          ) : visibleProblems.length === 0 ? (
            <LearningEmptyState title="没有找到题目" />
          ) : (
            <ol className="pb-list">
              {visibleProblems.map((problem, index) => {
                const status = statuses.get(problem.id);
                return (
                <li key={problem.id} style={{ animationDelay: `${Math.min(index, 12) * 24}ms` }}>
                  <button
                    type="button"
                    className={`pb-row is-${DIFFICULTY_MARBLES[problem.difficulty] ?? 'blue'}${status ? ` is-${status}` : ''}`}
                    onClick={() => startPractice(problem.id)}
                  >
                    <span className="pb-row-marble">
                      <img src={difficultyMarble(problem.difficulty)} alt="" />
                      {status === 'passed' ? (
                        <i className="pb-row-badge" aria-label="已通过">
                          <Check size={10} strokeWidth={3.5} />
                        </i>
                      ) : status ? (
                        <i className="pb-row-badge" aria-label="做过" />
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
                </li>
                );
              })}
            </ol>
          )}

          {filteredProblems.length > visibleCount ? (
            <button
              type="button"
              className="pb-more"
              onClick={() => setVisibleCount((count) => count + PROBLEM_BANK_PAGE_SIZE)}
            >
              再看 {Math.min(PROBLEM_BANK_PAGE_SIZE, filteredProblems.length - visibleCount)} 题
            </button>
          ) : null}
        </div>
      </div>

      {filteredProblems.length ? (
        <button type="button" className="pb-start" onClick={() => startPractice()}>
          <span className="pb-start-marbles" aria-hidden>
            {(['green', 'amber', 'pink'] as const).map((color) => (
              <img key={color} src={marbleImages[color]} alt="" />
            ))}
          </span>
          开始练习
          <small>{filteredProblems.length}</small>
        </button>
      ) : null}
    </section>
  );
}
