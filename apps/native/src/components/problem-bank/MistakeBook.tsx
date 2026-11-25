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

const TABS: { key: MistakeTab; label: string }[] = [
  { key: 'todo', label: '待订正' },
  { key: 'fixed', label: '已订正' },
  { key: 'removed', label: '已移出' },
];

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

function statusTag(entry: MistakeEntry) {
  if (entry.tab === 'removed') return { text: '已移出', tone: 'muted' };
  if (entry.status === 'passed') return { text: '已订正', tone: 'green' };
  if (entry.status === 'partial') return { text: '对一部分', tone: 'amber' };
  if (entry.status === 'pending') return { text: '待批改', tone: 'blue' };
  return { text: '待订正', tone: 'pink' };
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
  const [tab, setTab] = useState<MistakeTab>('todo');
  const [type, setType] = useState('all');
  const counts = useMemo(() => {
    const result: Record<MistakeTab, number> = { todo: 0, fixed: 0, removed: 0 };
    for (const entry of entries) result[entry.tab] += 1;
    return result;
  }, [entries]);
  const inTab = useMemo(() => entries.filter((entry) => entry.tab === tab), [entries, tab]);
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
  const todoShown = tab === 'todo' ? shown : [];
  const fixedShown = tab === 'fixed' ? shown : [];

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
          <strong>错题本 · {counts.todo} 道待订正</strong>
          <small>
            {focusGroup ? `只看「${focusGroup.title}」` : `跟着题库：按${groupLabel}`}
            {counts.fixed ? ` · ${counts.fixed} 道改对了，等你移出` : ''}
          </small>
        </div>
        {focusGroup ? (
          <button type="button" className="mb-chip" onClick={onClearFocus}>
            看全部
          </button>
        ) : null}
        {todoShown.length ? (
          <button
            type="button"
            className="mb-cta"
            onClick={() =>
              practice(
                todoShown,
                todoShown[0],
                focusGroup ? `${focusGroup.title} · 错题` : '错题本',
              )
            }
          >
            <Play size={14} fill="currentColor" />
            全部重做 {todoShown.length} 道
          </button>
        ) : fixedShown.length ? (
          <button
            type="button"
            className="mb-cta is-green"
            onClick={() =>
              removeMistakes(
                courseId,
                fixedShown.map((entry) => entry.problem.id),
              )
            }
          >
            <Check size={14} strokeWidth={3} />
            移出改对的 {fixedShown.length} 道
          </button>
        ) : null}
      </div>

      <div className="mb-tabs" role="tablist" aria-label="错题本分类">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={tab === item.key ? `is-active is-${item.key}` : ''}
            onClick={() => setTab(item.key)}
          >
            {item.label}
            <small>{counts[item.key]}</small>
          </button>
        ))}
      </div>

      {typeOptions.length > 1 ? (
        <div className="mb-chips" role="group" aria-label="题型">
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
        </div>
      ) : null}

      {loading && !entries.length ? (
        <p className="mb-empty" role="status">
          正在读取错题记录…
        </p>
      ) : !sections.length ? (
        <div className="mb-empty">
          <img src={marbleImages[tab === 'todo' ? 'green' : 'blue']} alt="" />
          <strong>
            {tab === 'todo'
              ? counts.fixed
                ? '错题都改对了'
                : '还没有错题'
              : tab === 'fixed'
                ? '还没有改对的题'
                : '没有移出的题'}
          </strong>
          <small>
            {tab === 'todo'
              ? counts.fixed
                ? '去「已订正」把它们移出错题本吧'
                : '做错的题会自动收进来'
              : tab === 'fixed'
                ? '重做做对之后会出现在这里'
                : '移出的题会放在这里，随时能找回'}
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
              {tab === 'todo' ? (
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
                            {entry.tab === 'fixed' ? '错过' : '错'} {entry.wrongCount} 次
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
                    {entry.tab === 'todo' ? (
                      <button
                        type="button"
                        className="mb-action"
                        onClick={() => practice(items, entry, `${group.title} · 错题`)}
                      >
                        重做
                      </button>
                    ) : entry.tab === 'fixed' ? (
                      <button
                        type="button"
                        className="mb-action is-green"
                        onClick={() => removeMistakes(courseId, [entry.problem.id])}
                      >
                        <Check size={12} strokeWidth={3} />
                        移出
                      </button>
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
