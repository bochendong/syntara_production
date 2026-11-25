import { useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import type { LocalProblem, LocalProblemProgress } from '../../domain/models';
import type { PaperSourceTag } from '../../data/problem-bank-filters';
import { marbleImages, type MarbleColor } from '../../lib/learning-action-marbles';
import { BankPeerComparison } from './BankPeerComparison';
import type { BankComparison } from '../../../../../lib/problem-bank/bank-comparison';
import './bank-analytics.css';

type Mode = 'chapters' | 'sets' | PaperSourceTag;
export type AnalyticsGroup = {
  key: string;
  title: string;
  number: string | null;
  color: MarbleColor | null;
  problems: LocalProblem[];
  passed: number;
};
export type MistakeCounts = {
  /** 错题本里的题 id（做错过、没被移出；只算当前范围）。 */
  book: ReadonlySet<string>;
  removed: number;
};
type Props = {
  courseId: string;
  mode: Mode;
  problems: LocalProblem[];
  records: Map<string, LocalProblemProgress> | null;
  groups: AnalyticsGroup[];
  mistakes: MistakeCounts;
  mistakeMode: boolean;
  onToggleMistakes: () => void;
  /** 练习量里点一章：直接打开。 */
  onOpenGroup: (key: string) => void;
  /** 错题本里点一章：只看这一章的错题。 */
  focusKey: string | null;
  onFocusGroup: (key: string | null) => void;
  /** 本机预览用的同班数据。 */
  previewComparison?: BankComparison;
};
const pages = ['练习量', '同班对比'];
const DAY = 86_400_000;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function dayStart(time: number) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 最近 7 天每天做过几道题（按每道题最后一次作答那天算）。 */
function useWeek(problems: LocalProblem[], records: Props['records']) {
  const [opened] = useState(() => Date.now());
  return useMemo(() => {
    const today = dayStart(opened);
    const days = Array.from({ length: 7 }, (_, index) => {
      const start = today - (6 - index) * DAY;
      return { start, label: WEEKDAYS[new Date(start).getDay()], count: 0 };
    });
    for (const problem of problems) {
      const at = records?.get(problem.id)?.lastAttemptAt;
      if (!at || at < days[0].start) continue;
      const index = Math.min(6, Math.floor((dayStart(at) - days[0].start) / DAY));
      days[index].count += 1;
    }
    return days;
  }, [opened, problems, records]);
}

function GroupMarble({ group }: { group: Pick<AnalyticsGroup, 'color' | 'number'> }) {
  return (
    <span className="ba-marble" aria-hidden>
      <img src={marbleImages[group.color ?? 'blue']} alt="" />
      {group.number ? <b>{group.number}</b> : null}
    </span>
  );
}

function Workload({
  problems,
  records,
  groups,
  mode,
  mistakes,
  onOpenGroup,
}: Pick<Props, 'problems' | 'records' | 'groups' | 'mode' | 'mistakes' | 'onOpenGroup'>) {
  const week = useWeek(problems, records);
  if (!records) return <p role="status">正在读取练习记录…</p>;
  let practiced = 0;
  let passed = 0;
  for (const problem of problems) {
    const row = records.get(problem.id);
    if (row?.attemptedCount) practiced += 1;
    if (row?.attemptedCount && row.status === 'passed') passed += 1;
  }
  const inBook = problems.filter((problem) => mistakes.book.has(problem.id)).length;
  // 管子里粉色是现在还没做对的题（错了 / 对一部分），和错题本数量分开看。
  const wrongNow = problems.filter((problem) => {
    const status = records.get(problem.id)?.status;
    return status === 'failed' || status === 'partial';
  }).length;
  const total = problems.length || 1;
  const thisWeek = week.reduce((sum, day) => sum + day.count, 0);
  const peak = Math.max(1, ...week.map((day) => day.count));
  return (
    <>
      <div className="ba-hero">
        <strong>{practiced}</strong>
        <small>/ {problems.length} 道刷过</small>
        {thisWeek ? <span className="ba-week-badge">7 天 +{thisWeek}</span> : null}
      </div>
      <div className="ba-tube" aria-label={`做对 ${passed}，还没做对 ${wrongNow}`}>
        <i className="is-green" style={{ width: `${(passed / total) * 100}%` }} />
        <i className="is-pink" style={{ width: `${(wrongNow / total) * 100}%` }} />
      </div>
      <div className="ba-stats">
        <span>
          <img src={marbleImages.green} alt="" />
          <b>{passed}</b>
          <small>做对</small>
        </span>
        <span>
          <img src={marbleImages.pink} alt="" />
          <b>{inBook}</b>
          <small>错题本</small>
        </span>
        <span className="is-todo">
          <img src={marbleImages.blue} alt="" />
          <b>{problems.length - practiced}</b>
          <small>没做</small>
        </span>
      </div>
      <h3>
        <span>这 7 天</span>
        <small>每天做过的题</small>
      </h3>
      <div className="ba-week" aria-label={week.map((d) => `${d.label} ${d.count} 道`).join('，')}>
        {week.map((day, index) => (
          <span key={day.start} className={index === 6 ? 'is-today' : ''}>
            <i style={{ height: day.count ? `${Math.max(12, (day.count / peak) * 100)}%` : 4 }} />
            <small>{index === 6 ? '今' : day.label}</small>
          </span>
        ))}
      </div>
      <h3>
        <span>{mode === 'chapters' ? '章节进度' : '试卷进度'}</span>
        <small>点一{mode === 'chapters' ? '章' : '套'}直接打开</small>
      </h3>
      <ul className="ba-groups">
        {groups.map((group) => {
          const size = group.problems.length || 1;
          const wrong = group.problems.filter((p) => mistakes.book.has(p.id)).length;
          return (
            <li key={group.key}>
              <button type="button" onClick={() => onOpenGroup(group.key)}>
                <GroupMarble group={group} />
                <span className="ba-group-copy">
                  <span>{group.title}</span>
                  <span className="ba-mini-tube" aria-hidden>
                    <i className="is-green" style={{ width: `${(group.passed / size) * 100}%` }} />
                    <i className="is-pink" style={{ width: `${(wrong / size) * 100}%` }} />
                  </span>
                </span>
                <span className="ba-group-count">
                  {group.passed}/{group.problems.length}
                  {wrong ? <b>{wrong} 道错题</b> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function MistakeSide({
  groups,
  mode,
  mistakes,
  focusKey,
  onFocusGroup,
}: Pick<Props, 'groups' | 'mode' | 'mistakes' | 'focusKey' | 'onFocusGroup'>) {
  const inBook = mistakes.book.size;
  const counted = groups
    .map((group) => ({
      group,
      count: group.problems.filter((p) => mistakes.book.has(p.id)).length,
    }))
    .sort((a, b) => (b.count ? 1 : 0) - (a.count ? 1 : 0));
  return (
    <>
      <div className="ba-hero is-pink">
        <strong>{inBook}</strong>
        <small>道错题</small>
      </div>
      <p className="ba-legend">
        <span className="is-pink">做错过的题都在这</span>
        {mistakes.removed ? <span>已移出 {mistakes.removed}</span> : null}
      </p>
      <h3>
        <span>按{mode === 'chapters' ? '章节' : '套题'}</span>
        <small>点一{mode === 'chapters' ? '章' : '套'}只看它</small>
      </h3>
      <ul className="ba-groups is-focus">
        <li className={focusKey ? '' : 'is-active'}>
          <button type="button" onClick={() => onFocusGroup(null)}>
            <GroupMarble group={{ color: 'pink', number: null }} />
            <span className="ba-group-copy">
              <span>全部{mode === 'chapters' ? '章节' : '套题'}</span>
            </span>
            <span className="ba-group-count">
              <b>{inBook}</b>
            </span>
          </button>
        </li>
        {counted.map(({ group, count }) => (
          <li key={group.key} className={focusKey === group.key ? 'is-active' : ''}>
            <button
              type="button"
              disabled={!count && focusKey !== group.key}
              onClick={() => onFocusGroup(group.key)}
            >
              <GroupMarble group={group} />
              <span className="ba-group-copy">
                <span>{group.title}</span>
              </span>
              <span className="ba-group-count">{count ? <b>{count}</b> : '0'}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function BankAnalytics(props: Props) {
  const [page, setPage] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const move = (offset: number) => setPage((p) => (p + offset + pages.length) % pages.length);
  const group = props.mode === '考试原题' ? 'exam' : props.mode === '模拟题' ? 'mock' : props.mode;
  const { mistakeMode, mistakes } = props;
  const practiced = props.records
    ? props.problems.filter((p) => props.records?.get(p.id)?.attemptedCount).length
    : 0;
  const passed = props.records
    ? props.problems.filter((p) => props.records?.get(p.id)?.status === 'passed').length
    : 0;
  const total = props.problems.length || 1;
  return (
    <aside
      className={`pb-progress-sidebar ba-sidebar${mistakeMode ? ' is-mistakes' : ''}`}
      aria-label={mistakeMode ? '错题本' : '学习分析'}
    >
      <header>
        <h2>{mistakeMode ? '错题本' : '学习分析'}</h2>
        {!mistakeMode ? (
          <span className="ba-peek" aria-hidden>
            <b>{practiced}</b>/{props.problems.length}
            <span className="ba-tube">
              <i className="is-green" style={{ width: `${(passed / total) * 100}%` }} />
              <i
                className="is-pink"
                style={{
                  width: `${(props.problems.filter((p) => ['failed', 'partial'].includes(props.records?.get(p.id)?.status ?? '')).length / total) * 100}%`,
                }}
              />
            </span>
          </span>
        ) : (
          <span className="ba-peek is-pink" aria-hidden>
            <b>{mistakes.book.size}</b>道错题
          </span>
        )}
        <button
          type="button"
          className="ba-mobile-toggle"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? '收起' : '展开'}
          <ChevronDown size={13} className={mobileOpen ? 'is-open' : ''} />
        </button>
        <button
          type="button"
          className={`ba-book-button${mistakeMode ? ' is-active' : ''}`}
          aria-pressed={mistakeMode}
          onClick={props.onToggleMistakes}
        >
          {mistakeMode ? (
            <>
              <ArrowLeft size={13} />
              返回题库
            </>
          ) : (
            <>
              <img src={marbleImages.pink} alt="" />
              错题本
              {mistakes.book.size ? <i>{mistakes.book.size}</i> : null}
            </>
          )}
        </button>
      </header>
      <div className="ba-content" data-open={mobileOpen}>
        {mistakeMode ? (
          <section className="ba-panel">
            <MistakeSide {...props} />
          </section>
        ) : (
          <>
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
              className="ba-panel"
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
                  groups={props.groups}
                  preview={props.previewComparison}
                />
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
