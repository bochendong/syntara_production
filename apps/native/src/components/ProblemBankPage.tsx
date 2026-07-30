import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Play,
  Search,
  SlidersHorizontal,
} from 'lucide-react';

import { problemTypeLabel } from '../data/local-problem-grading';
import type { LocalCourseWorkspace, LocalProblem } from '../domain/models';

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
type StatusFilter = 'all' | LocalProblem['status'];

const PROBLEM_BANK_PAGE_SIZE = 10;

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

export function ProblemBankPage({ workspace, onBack, onPractice }: ProblemBankPageProps) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('published');
  const [currentPage, setCurrentPage] = useState(1);

  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const problem of workspace.problems) {
      counts.set(problem.type, (counts.get(problem.type) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [workspace.problems]);

  const filteredProblems = useMemo(() => {
    return workspace.problems
      .filter((problem) => {
        if (statusFilter !== 'all' && problem.status !== statusFilter) return false;
        if (typeFilter !== 'all' && problem.type !== typeFilter) return false;
        if (difficultyFilter !== 'all' && problem.difficulty !== difficultyFilter) return false;
        return matchesQuery(problem, query.trim());
      })
      .sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title, 'zh-CN'));
  }, [difficultyFilter, query, statusFilter, typeFilter, workspace.problems]);

  const pageCount = Math.max(1, Math.ceil(filteredProblems.length / PROBLEM_BANK_PAGE_SIZE));
  const safePage = Math.min(currentPage, pageCount);

  useEffect(() => {
    setCurrentPage(1);
  }, [difficultyFilter, query, statusFilter, typeFilter]);

  useEffect(() => {
    if (currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

  const pageStartIndex = (safePage - 1) * PROBLEM_BANK_PAGE_SIZE;
  const visibleProblems = filteredProblems.slice(
    pageStartIndex,
    pageStartIndex + PROBLEM_BANK_PAGE_SIZE,
  );

  const activeFilterCount =
    (statusFilter !== 'published' ? 1 : 0) +
    (typeFilter !== 'all' ? 1 : 0) +
    (difficultyFilter !== 'all' ? 1 : 0) +
    (query.trim() ? 1 : 0);

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
    <section className="native-problem-bank" aria-label="课程题库">
      <div className="native-problem-bank-shell">
        <header className="native-problem-bank-header">
          <div className="native-problem-bank-header-row">
            <button type="button" className="native-problem-bank-back" onClick={onBack}>
              <ArrowLeft size={16} />
              返回课程
            </button>
            <span className="native-problem-bank-course">
              {workspace.course.courseCode || workspace.course.name}
            </span>
            <label className="native-problem-bank-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索题号、题目、知识点、来源"
              />
            </label>
            <span className="native-problem-bank-count">
              {filteredProblems.length}/{workspace.problems.length}
            </span>
            <div className="native-problem-bank-filters" aria-label="筛选">
              <SlidersHorizontal size={14} />
              {activeFilterCount > 0 ? (
                <span className="native-problem-bank-filter-badge">{activeFilterCount}</span>
              ) : null}
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                <option value="published">已发布</option>
                <option value="all">全部状态</option>
                <option value="draft">草稿</option>
                <option value="archived">已归档</option>
              </select>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="all">全部题型</option>
                {typeOptions.map(([type, count]) => (
                  <option key={type} value={type}>
                    {problemTypeLabel(type)} · {count}
                  </option>
                ))}
              </select>
              <select
                value={difficultyFilter}
                onChange={(event) => setDifficultyFilter(event.target.value as DifficultyFilter)}
              >
                <option value="all">全部难度</option>
                <option value="easy">基础</option>
                <option value="medium">进阶</option>
                <option value="hard">挑战</option>
              </select>
            </div>
            <button
              type="button"
              className="native-problem-bank-primary"
              disabled={!filteredProblems.length}
              onClick={() => startPractice()}
            >
              <Play size={15} />
              开始练习
            </button>
          </div>
          <div className="native-problem-bank-meta">
            <span>
              <BookOpenCheck size={14} />
              当前筛选 {filteredProblems.length} 题
            </span>
            <span>
              第 {safePage}/{pageCount} 页 · 每页 {PROBLEM_BANK_PAGE_SIZE} 题
            </span>
          </div>
        </header>

        <div className="native-problem-bank-list">
          <div className="native-problem-bank-table-head" aria-hidden>
            <span>#</span>
            <span>难度</span>
            <span>题目</span>
            <span>题型</span>
            <span>状态</span>
            <span />
          </div>
          {visibleProblems.length === 0 ? (
            <div className="native-problem-bank-empty">
              <CheckCircle2 size={28} />
              <strong>没有匹配的题目</strong>
              <span>换个筛选条件，或清空搜索后再试。</span>
            </div>
          ) : (
            visibleProblems.map((problem, index) => (
              <button
                key={problem.id}
                type="button"
                className="native-problem-bank-row"
                onClick={() => startPractice(problem.id)}
              >
                <span className="native-problem-bank-index">{pageStartIndex + index + 1}</span>
                <span className={`difficulty-dot difficulty-dot-${problem.difficulty}`} />
                <span className="native-problem-bank-copy">
                  <strong>{problem.title}</strong>
                  <small>
                    {problem.tags.length ? problem.tags.slice(0, 3).join(' · ') : '未标注标签'}
                  </small>
                </span>
                <span className="native-problem-bank-type">{problemTypeLabel(problem.type)}</span>
                <span className="native-problem-bank-status">{problem.status}</span>
                <span className="native-problem-bank-practice">练习</span>
              </button>
            ))
          )}
        </div>

        {filteredProblems.length > 0 ? (
          <footer className="native-problem-bank-pagination">
            <button
              type="button"
              className="native-problem-bank-page-button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            >
              <ChevronLeft size={15} />
              上一页
            </button>
            <span className="native-problem-bank-page-status">
              {pageStartIndex + 1}-
              {Math.min(pageStartIndex + PROBLEM_BANK_PAGE_SIZE, filteredProblems.length)} /{' '}
              {filteredProblems.length}
            </span>
            <button
              type="button"
              className="native-problem-bank-page-button"
              disabled={safePage >= pageCount}
              onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
            >
              下一页
              <ChevronRight size={15} />
            </button>
          </footer>
        ) : null}
      </div>
    </section>
  );
}
