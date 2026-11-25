import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowLeft, Check, Play, RotateCcw } from 'lucide-react';
import type { LocalProblem } from '../../domain/models';
import { getLocalRepository } from '../../data/repository';
import { currentBankDocument } from '../../data/problem-bank-round';
import { problemAttemptHasMistake } from '../../data/problem-attempt-history';
import { problemTypeLabel } from '../../data/local-problem-grading';
import {
  mistakeSnippet,
  relativeDay,
  removeMistakes,
  restoreMistakes,
  type MistakeEntry,
  type MistakeSnippet,
  type MistakeTab,
} from '../../data/mistake-book';
import { marbleImages, type MarbleColor } from '../../lib/learning-action-marbles';
import { ProblemTitleText } from './problem-rich-text';
import './mistake-book.css';

export type MistakeGroup = {
  key: string;
  title: string;
  number: string | null;
  color: MarbleColor | null;
  problems: LocalProblem[];
};

function accent(color: MarbleColor | null): CSSProperties {
  const marble = color ?? 'pink';
  return {
    '--accent-rgb': `var(--marble-${marble}-rgb)`,
    '--accent-ink': `var(--marble-${marble}-ink)`,
  } as CSSProperties;
}

function statusMarble(entry: MistakeEntry): MarbleColor {
  if (entry.status === 'passed') return 'green';
  if (entry.status === 'partial') return 'amber';
  if (entry.status === 'pending') return 'blue';
  return 'pink';
}

/** 现在这道题的样子：错题本不分「改没改对」，只用小标签说一下最近一次。 */
function statusTag(entry: MistakeEntry) {
  if (entry.tab === 'removed') return { text: '已移出', tone: 'muted' };
  if (entry.status === 'passed') return { text: '最近做对', tone: 'green' };
  if (entry.status === 'partial') return { text: '对一部分', tone: 'amber' };
  if (entry.status === 'pending') return { text: '待批改', tone: 'blue' };
  return { text: '做错', tone: 'pink' };
}

/** 每道错题最近一次错的作答，压成一行；只读当前看得见的几十道。 */
function useSnippets(entries: MistakeEntry[]) {
  const [snippets, setSnippets] = useState<Map<string, MistakeSnippet | null>>(() => new Map());
  const wanted = useMemo(() => entries.slice(0, 60).map((entry) => entry.problem), [entries]);
  useEffect(() => {
    const missing = wanted.filter((problem) => !snippets.has(problem.id));
    if (!missing.length) return;
    let alive = true;
    void getLocalRepository()
      .then(async (repository) => {
        const found = await Promise.all(
          missing.map(async (problem) => {
            try {
              const document = await repository.loadProblemDocument(problem.id);
              const attempts = document ? currentBankDocument(document).attempts : [];
              const latest = [...attempts]
                .sort((a, b) => b.createdAt - a.createdAt)
                .find(problemAttemptHasMistake);
              return [problem.id, mistakeSnippet(problem, latest)] as const;
            } catch {
              return [problem.id, null] as const;
            }
          }),
        );
        if (!alive) return;
        setSnippets((current) => {
          const next = new Map(current);
          for (const [id, snippet] of found) next.set(id, snippet);
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [wanted, snippets]);
  return snippets;
}

export function MistakeBookView({
  courseId,
  entries,
  groups,
  groupLabel,
  focusKey,
  onClearFocus,
  numberOf,
  loading,
  onBack,
  onPractice,
}: {
  courseId: string;
  entries: MistakeEntry[];
  groups: MistakeGroup[];
  /** 「章」或「套」。 */
  groupLabel: string;
  /** 侧栏点了某一章：只看这一章。 */
  focusKey: string | null;
  onClearFocus: () => void;
  numberOf: (problem: LocalProblem, group: MistakeGroup) => number | undefined;
  loading: boolean;
  onBack: () => void;
  onPractice: (problems: LocalProblem[], initial: LocalProblem, title: string) => void;
}) {
  // 错题本就一张单子；移出的题收在「已移出」里，能找回。
  const [showRemoved, setShowRemoved] = useState(false);
  const [type, setType] = useState('all');
  const counts = useMemo(() => {
    const result: Record<MistakeTab, number> = { book: 0, removed: 0 };
    for (const entry of entries) result[entry.tab] += 1;
    return result;
  }, [entries]);
  const viewing: MistakeTab = showRemoved && counts.removed ? 'removed' : 'book';
  const inTab = useMemo(() => entries.filter((entry) => entry.tab === viewing), [entries, viewing]);
  const typeOptions = useMemo(() => {
    const byType = new Map<string, number>();
    for (const entry of inTab)
      byType.set(entry.problem.type, (byType.get(entry.problem.type) ?? 0) + 1);
    return [...byType.entries()].sort((a, b) => b[1] - a[1]);
  }, [inTab]);
  const activeType = typeOptions.some(([value]) => value === type) ? type : 'all';
  const visible = useMemo(
    () =>
      activeType === 'all' ? inTab : inTab.filter((entry) => entry.problem.type === activeType),
    [inTab, activeType],
  );
  const byId = useMemo(() => new Map(visible.map((entry) => [entry.problem.id, entry])), [visible]);
  // 按章 / 套分组；一道题在好几套里时只放在第一套。
  const sections = useMemo(() => {
    const placed = new Set<string>();
    return groups
      .filter((group) => !focusKey || group.key === focusKey)
      .map((group) => {
        const items = group.problems.flatMap((problem) => {
          const entry = byId.get(problem.id);
          if (!entry || placed.has(problem.id)) return [];
          placed.add(problem.id);
          return [entry];
        });
        return { group, items };
      })
      .filter((section) => section.items.length);
  }, [groups, focusKey, byId]);
  const shown = sections.flatMap((section) => section.items);
  const snippets = useSnippets(shown);
  const focusGroup = focusKey ? groups.find((group) => group.key === focusKey) : null;
  const bookShown = viewing === 'book' ? shown : [];

  const practice = (items: MistakeEntry[], initial: MistakeEntry, title: string) =>
    onPractice(
      items.map((item) => item.problem),
      initial.problem,
      title,
    );

  return (
    <div className="mb-view">
      <div className="mb-bar">
        <button type="button" className="mb-back" onClick={onBack}>
          <ArrowLeft size={15} />
          题库
        </button>
        <div className="mb-bar-copy">
          <strong>
            {viewing === 'removed' ? `已移出 · ${counts.removed} 道` : `错题本 · ${counts.book} 道`}
          </strong>
          <small>
            {focusGroup ? `只看「${focusGroup.title}」` : `跟着题库：按${groupLabel}`}
            {viewing === 'removed'
              ? ' · 点「找回」放回错题本'
              : ' · 做错过的题都在这，不想要了就移出'}
          </small>
        </div>
        {focusGroup ? (
          <button type="button" className="mb-chip" onClick={onClearFocus}>
            看全部
          </button>
        ) : null}
        {bookShown.length ? (
          <button
            type="button"
            className="mb-cta"
            onClick={() =>
              practice(
                bookShown,
                bookShown[0],
                focusGroup ? `${focusGroup.title} · 错题` : '错题本',
              )
            }
          >
            <Play size={14} fill="currentColor" />
            全部重做 {bookShown.length} 道
          </button>
        ) : null}
      </div>

      {counts.removed || typeOptions.length > 1 ? (
        <div className="mb-chips" role="group" aria-label="题型">
          {typeOptions.length > 1 ? (
            <>
              <button
                type="button"
                className={activeType === 'all' ? 'mb-chip is-active' : 'mb-chip'}
                onClick={() => setType('all')}
              >
                全部题型
              </button>
              {typeOptions.map(([value, count]) => (
                <button
                  key={value}
                  type="button"
                  className={activeType === value ? 'mb-chip is-active' : 'mb-chip'}
                  onClick={() => setType(value)}
                >
                  {problemTypeLabel(value)} <small>{count}</small>
                </button>
              ))}
            </>
          ) : null}
          {counts.removed ? (
            <button
              type="button"
              className={`mb-chip mb-removed-toggle${viewing === 'removed' ? ' is-active' : ''}`}
              aria-pressed={viewing === 'removed'}
              onClick={() => setShowRemoved(viewing !== 'removed')}
            >
              {viewing === 'removed' ? (
                <>
                  <ArrowLeft size={12} />
                  回错题本
                </>
              ) : (
                <>
                  <RotateCcw size={12} />
                  已移出 <small>{counts.removed}</small>
                </>
              )}
            </button>
          ) : null}
        </div>
      ) : null}

      {loading && !entries.length ? (
        <p className="mb-empty" role="status">
          正在读取错题记录…
        </p>
      ) : !sections.length ? (
        <div className="mb-empty">
          <img src={marbleImages[viewing === 'book' ? 'green' : 'blue']} alt="" />
          <strong>{viewing === 'book' ? '还没有错题' : '没有移出的题'}</strong>
          <small>
            {viewing === 'book' ? '做错的题会自动收进来' : '移出的题会放在这里，随时能找回'}
          </small>
        </div>
      ) : (
        sections.map(({ group, items }) => (
          <section key={group.key} className="mb-section" style={accent(group.color)}>
            <header className="mb-section-head">
              <span className="mb-section-marble" aria-hidden>
                <img src={marbleImages[group.color ?? 'blue']} alt="" />
                {group.number ? <b>{group.number}</b> : null}
              </span>
              <strong>{group.title}</strong>
              <small>{items.length} 道</small>
              {viewing === 'book' ? (
                <button
                  type="button"
                  className="mb-ghost"
                  onClick={() => practice(items, items[0], `${group.title} · 错题`)}
                >
                  <Play size={11} fill="currentColor" />
                  重做这{groupLabel}
                </button>
              ) : null}
            </header>
            <ol className="mb-list">
              {items.map((entry, index) => {
                const tag = statusTag(entry);
                const snippet = snippets.get(entry.problem.id);
                return (
                  <li
                    key={entry.problem.id}
                    className={`mb-row is-${entry.tab}`}
                    style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }}
                  >
                    <button
                      type="button"
                      className="mb-row-main"
                      onClick={() => practice(items, entry, `${group.title} · 错题`)}
                    >
                      <span className="mb-num" aria-hidden>
                        <img src={marbleImages[statusMarble(entry)]} alt="" />
                        <b>{numberOf(entry.problem, group)}</b>
                      </span>
                      <span className="mb-row-copy">
                        <strong>
                          <ProblemTitleText content={entry.problem.title} />
                        </strong>
                        <small>
                          <span className={`mb-tag is-${tag.tone}`}>{tag.text}</span>
                          <span className="mb-tag">{problemTypeLabel(entry.problem.type)}</span>
                          <span>
                            错过 {entry.wrongCount} 次
                            {entry.lastAttemptAt ? ` · ${relativeDay(entry.lastAttemptAt)}` : ''}
                          </span>
                        </small>
                      </span>
                      {snippet && entry.tab !== 'removed' ? (
                        <span className="mb-snippet">
                          {snippet.mine}
                          {snippet.detail ? <em> · {snippet.detail}</em> : null}
                        </span>
                      ) : null}
                    </button>
                    {entry.tab === 'book' ? (
                      <span className="mb-row-actions">
                        <button
                          type="button"
                          className="mb-action"
                          onClick={() => practice(items, entry, `${group.title} · 错题`)}
                        >
                          重做
                        </button>
                        <button
                          type="button"
                          className="mb-action is-muted"
                          aria-label="移出错题本"
                          onClick={() => removeMistakes(courseId, [entry.problem.id])}
                        >
                          <Check size={12} strokeWidth={3} />
                          移出
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="mb-action is-muted"
                        onClick={() => restoreMistakes(courseId, [entry.problem.id])}
                      >
                        <RotateCcw size={12} />
                        找回
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}

/** 重做一轮回来：改对的变绿，问要不要移出；没改对的留着，可以接着做。 */
export function MistakeRedoResult({
  title,
  fixed,
  still,
  onRemoveFixed,
  onKeep,
  onRetry,
}: {
  title: string;
  fixed: LocalProblem[];
  still: LocalProblem[];
  onRemoveFixed: () => void;
  onKeep: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="mb-result-backdrop" role="presentation" onClick={onKeep}>
      <div
        className="mb-result"
        role="dialog"
        aria-modal="true"
        aria-label="错题重做结果"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          className="mb-result-hero"
          src={marbleImages[fixed.length ? 'green' : 'pink']}
          alt=""
        />
        <h3>{fixed.length ? `改对了 ${fixed.length} 道` : '这次还没改对'}</h3>
        <p>{title}</p>
        <div className="mb-trays">
          <div className="mb-tray is-green">
            <span className="mb-tray-marbles" aria-hidden>
              {fixed.slice(0, 8).map((problem, index) => (
                <img
                  key={problem.id}
                  src={marbleImages.green}
                  alt=""
                  style={{ animationDelay: `${120 + index * 90}ms` }}
                />
              ))}
            </span>
            <strong>{fixed.length}</strong>
            <small>改对了</small>
          </div>
          <div className="mb-tray is-pink">
            <span className="mb-tray-marbles" aria-hidden>
              {still.slice(0, 8).map((problem, index) => (
                <img
                  key={problem.id}
                  src={marbleImages.pink}
                  alt=""
                  style={{ animationDelay: `${120 + index * 90}ms` }}
                />
              ))}
            </span>
            <strong>{still.length}</strong>
            <small>还要再练</small>
          </div>
        </div>
        <div className="mb-result-actions">
          {fixed.length ? (
            <button type="button" className="mb-action is-green is-large" onClick={onRemoveFixed}>
              <Check size={14} strokeWidth={3} />
              移出改对的 {fixed.length} 道
            </button>
          ) : null}
          <button type="button" className="mb-action is-muted is-large" onClick={onKeep}>
            {fixed.length ? '先留着' : '回错题本'}
          </button>
          {still.length ? (
            <button type="button" className="mb-cta" onClick={onRetry}>
              <Play size={13} fill="currentColor" />
              再做 {still.length} 道
            </button>
          ) : null}
        </div>
        <small className="mb-result-note">也可以在列表里一道道点「移出」，移出的题能找回</small>
      </div>
    </div>
  );
}
