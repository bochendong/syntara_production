import { useMemo, useState } from 'react';
import { ChevronLeft, Play, Search, X } from 'lucide-react';

import { difficultyLabel, problemTypeLabel } from '../data/local-problem-grading';
import { ProblemTitleText } from './problem-bank/problem-rich-text';
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

export function ProblemBankPage({ workspace, onBack, onPractice }: ProblemBankPageProps) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>('all');
  const [visibleCount, setVisibleCount] = useState(PROBLEM_BANK_PAGE_SIZE);

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
          </small>
        </div>
        <span className="pb-header-spacer" aria-hidden />
      </header>

      <div className="pb-scroll">
        <div className="pb-column">
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

          <div className="pb-chips" role="group" aria-label="难度">
            <button
              type="button"
              className={difficultyFilter === 'all' ? 'is-active' : ''}
              onClick={() => {
                if (difficultyFilter === 'all') return;
                setDifficultyFilter('all');
                setVisibleCount(PROBLEM_BANK_PAGE_SIZE);
              }}
            >
              全部
            </button>
            {DIFFICULTY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={difficultyFilter === option.value ? 'is-active' : ''}
                onClick={() => {
                  setDifficultyFilter((current) =>
                    current === option.value ? 'all' : option.value,
                  );
                  setVisibleCount(PROBLEM_BANK_PAGE_SIZE);
                }}
              >
                <img src={marbleImages[option.color]} alt="" />
                {option.label}
              </button>
            ))}
            {typeOptions.length > 1 ? <span className="pb-chips-divider" aria-hidden /> : null}
            {typeOptions.length > 1
              ? typeOptions.map(([type]) => (
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
                  </button>
                ))
              : null}
          </div>

          {visibleProblems.length === 0 ? (
            <div className="pb-empty">
              <span className="pb-empty-marbles" aria-hidden>
                <img src={marbleImages.green} alt="" />
                <img src={marbleImages.amber} alt="" />
                <img src={marbleImages.pink} alt="" />
              </span>
              <strong>没有找到题目</strong>
            </div>
          ) : (
            <ol className="pb-list">
              {visibleProblems.map((problem, index) => (
                <li key={problem.id} style={{ animationDelay: `${Math.min(index, 12) * 24}ms` }}>
                  <button
                    type="button"
                    className="pb-row"
                    onClick={() => startPractice(problem.id)}
                  >
                    <img
                      className="pb-row-marble"
                      src={difficultyMarble(problem.difficulty)}
                      alt=""
                    />
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
              ))}
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
          <Play size={16} fill="currentColor" />
          开始练习
        </button>
      ) : null}
    </section>
  );
}
