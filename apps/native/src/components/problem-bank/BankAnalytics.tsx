import { useEffect, useId, useRef, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import type { LocalProblem, LocalProblemProgress } from '../../domain/models';
import type { PaperSourceTag } from '../../data/problem-bank-filters';
import { useBankAttemptHistory } from './bank-first-attempts';
import { ProblemTitleText } from './problem-rich-text';
import { BankPeerComparison } from './BankPeerComparison';
import './bank-analytics.css';

type Mode = 'chapters' | 'sets' | PaperSourceTag;
type Group = {
  key: string;
  title: string;
  problems: LocalProblem[];
  passed: number;
};
type Props = {
  courseId: string;
  mode: Mode;
  problems: LocalProblem[];
  records: Map<string, LocalProblemProgress> | null;
  groups: Group[];
  onPractice: (items: LocalProblem[], title: string) => void;
};
const pages = ['练习量', '同班对比'];
function Workload({
  problems,
  records,
  groups,
  mode,
}: Pick<Props, 'problems' | 'records' | 'groups' | 'mode'>) {
  if (!records) return <p role="status">正在读取练习记录…</p>;
  const practiced = problems.filter((p) => (records.get(p.id)?.attemptedCount ?? 0) > 0).length;
  return (
    <>
      <div className="ba-overview">
        <span>已刷题目</span>
        <div>
          <strong>{practiced}</strong>
          <small> / {problems.length} 道</small>
        </div>
      </div>
      <h3>{mode === 'chapters' ? '章节进度' : '试卷进度'}</h3>
      <ul className="ba-group-list">
        {groups.map((g) => (
          <li key={g.key}>
            <span>{g.title}</span>
            <small>
              {g.passed}/{g.problems.length} 通过
            </small>
          </li>
        ))}
      </ul>
    </>
  );
}

function MistakeBook({
  courseId,
  mode,
  problems,
  records,
  onPractice,
  onClose,
}: Props & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { mistakes, loading, incomplete } = useBankAttemptHistory(courseId, problems, records);
  const items = problems.filter((problem) => mistakes.has(problem.id));
  const scope = mode === 'chapters' ? '按章节' : mode === 'sets' ? '按套题' : mode;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog className="ba-mistake-book" ref={dialog} aria-label="错题本" onClose={onClose}>
      <header>
        <div>
          <h2>错题本</h2>
          <small>
            {scope} · {items.length} 道错题
          </small>
        </div>
        <button type="button" aria-label="关闭错题本" onClick={() => dialog.current?.close()}>
          <X size={18} />
        </button>
      </header>
      {loading ? (
        <p role="status">正在读取错题记录…</p>
      ) : incomplete ? (
        <p role="status">部分作答记录暂时无法读取。</p>
      ) : !items.length ? (
        <p>当前分组暂无错题。</p>
      ) : null}
      {items.length > 0 && (
        <ul>
          {items.map((problem) => {
            const status = records?.get(problem.id)?.status;
            return (
              <li key={problem.id}>
                <button
                  type="button"
                  onClick={() => {
                    dialog.current?.close();
                    onPractice([problem], '错题本');
                  }}
                >
                  <span>
                    <ProblemTitleText content={problem.title} />
                  </span>
                  <small>
                    {status === 'passed' ? '已订正' : status === 'pending' ? '待批改' : '待订正'}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </dialog>
  );
}

export function BankAnalytics(props: Props) {
  const [page, setPage] = useState(0);
  const [bookOpen, setBookOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const move = (offset: number) => setPage((p) => (p + offset + pages.length) % pages.length);
  const group = props.mode === '考试原题' ? 'exam' : props.mode === '模拟题' ? 'mock' : props.mode;
  return (
    <aside className="pb-progress-sidebar ba-sidebar" aria-label="学习分析">
      <header>
        <h2>学习分析</h2>
        <button
          type="button"
          className="ba-mobile-toggle"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? '收起' : '展开'}
        </button>
        <button
          type="button"
          className="ba-book-button"
          aria-haspopup="dialog"
          onClick={() => setBookOpen(true)}
        >
          <BookOpen size={14} aria-hidden />
          错题本
        </button>
      </header>
      <div className="ba-content" data-open={mobileOpen}>
        <div className="ba-tabs" role="tablist" aria-label="学习分析视图">
          {pages.map((name, i) => (
            <button
              key={name}
              type="button"
              ref={(el) => {
                tabs.current[i] = el;
              }}
              role="tab"
              id={id + 'tab' + i}
              aria-selected={page === i}
              tabIndex={page === i ? 0 : -1}
              aria-controls={id + 'panel'}
              onClick={() => setPage(i)}
              onKeyDown={(e) => {
                const next =
                  e.key === 'ArrowRight'
                    ? (i + 1) % pages.length
                    : e.key === 'ArrowLeft'
                      ? (i + pages.length - 1) % pages.length
                      : e.key === 'Home'
                        ? 0
                        : e.key === 'End'
                          ? pages.length - 1
                          : null;
                if (next !== null) {
                  e.preventDefault();
                  setPage(next);
                  tabs.current[next]?.focus();
                }
              }}
            >
              {name}
            </button>
          ))}
        </div>
        <section
          role="tabpanel"
          id={id + 'panel'}
          aria-labelledby={id + 'tab' + page}
          key={page}
          tabIndex={0}
          onTouchStart={(e) => {
            start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          }}
          onTouchCancel={() => {
            start.current = null;
          }}
          onTouchEnd={(e) => {
            if (!start.current) return;
            const dx = e.changedTouches[0].clientX - start.current.x,
              dy = e.changedTouches[0].clientY - start.current.y;
            if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6) move(dx < 0 ? 1 : -1);
            start.current = null;
          }}
        >
          {page === 0 ? (
            <Workload {...props} />
          ) : (
            <BankPeerComparison
              key={props.courseId + group}
              courseId={props.courseId}
              group={group}
            />
          )}
        </section>
      </div>
      {bookOpen && <MistakeBook {...props} onClose={() => setBookOpen(false)} />}
    </aside>
  );
}
