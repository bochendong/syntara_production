import { useMemo, useState, type CSSProperties } from 'react';
import { Search } from 'lucide-react';

import { getLocalRepository } from '../data/repository';
import { loadNotebookForReading } from '../data/course-sync';
import type { LocalCourseWorkspace, LocalNotebook } from '../domain/models';
import { marbleImages, type MarbleColor } from '../lib/learning-action-marbles';
import {
  loadNotebookReadings,
  notebookMarbleColor,
  splitNotebookName,
  type NotebookReading,
} from '../lib/notebook-reading';
import { GlassLoadMore, GlassSpinner, useListWindow } from './GlassLoadMore';
import { LearningEmptyState } from './LearningEmptyState';
import { LocalResourceViewer, type LocalResourceDocument } from './LocalResourceViewer';
import { PhonePage } from './PhonePages';
import './course-pages.css';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 节数太多时只画这么多颗，剩下的收成「+N」。 */
const MAX_SECTION_DOTS = 12;

function sortNotebooks(notebooks: LocalNotebook[]): LocalNotebook[] {
  // 按笔记本编号排列（01 → 11），编号相同时按名称。
  return [...notebooks].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
}

function formatAgo(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / DAY_MS);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

function accentStyle(color: MarbleColor): CSSProperties {
  return {
    '--nb-rgb': `var(--marble-${color}-rgb)`,
    '--nb-ink': `var(--marble-${color}-ink)`,
  } as CSSProperties;
}

/** 一排小珠子：读过的节点亮，没读的是空玻璃。 */
function SectionDots({ total, reading }: { total: number; reading?: NotebookReading }) {
  const visited = new Set(reading?.visited ?? []);
  const shown = Math.min(total, MAX_SECTION_DOTS);
  return (
    <span className="nb-dots" aria-label={`${visited.size} / ${total} 节`}>
      {Array.from({ length: shown }, (_, index) => (
        <i key={index} className={visited.has(index) ? 'is-read' : undefined} />
      ))}
      {total > shown ? <em>+{total - shown}</em> : null}
    </span>
  );
}

function NotebookMarble({ color, number }: { color: MarbleColor; number: string | null }) {
  return (
    <span className="nb-marble" aria-hidden>
      <img src={marbleImages[color]} alt="" />
      {number ? <b>{number}</b> : null}
    </span>
  );
}

export function PhoneNotesPage({
  workspace,
  onBack,
  onUpload,
}: {
  workspace: LocalCourseWorkspace;
  onBack: () => void;
  /** 空课程时去「资料」上传笔记。 */
  onUpload?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resource, setResource] = useState<LocalResourceDocument | null>(null);
  const [accent, setAccent] = useState<MarbleColor>('blue');
  // 关掉阅读器时重新读一次，刚读过的节马上亮起来。
  const [readings, setReadings] = useState(loadNotebookReadings);

  const sortedNotebooks = useMemo(() => sortNotebooks(workspace.notebooks), [workspace.notebooks]);
  // 每本笔记的弹珠颜色跟着它在课程里的顺序走（和学习进度页一样），搜索时不会变色。
  const colorById = useMemo(
    () =>
      new Map(sortedNotebooks.map((notebook, index) => [notebook.id, notebookMarbleColor(index)])),
    [sortedNotebooks],
  );
  const notebooks = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return sortedNotebooks;
    return sortedNotebooks.filter((notebook) => {
      const haystack = notebook.name.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [query, sortedNotebooks]);
  const listWindow = useListWindow(notebooks.length, `${workspace.course.id}:${query}`, 40);

  // 最近读过的那本放在最上面，点一下接着读。
  const resume = useMemo(() => {
    if (query.trim()) return null;
    let best: { notebook: LocalNotebook; reading: NotebookReading } | null = null;
    for (const notebook of sortedNotebooks) {
      const reading = readings[notebook.id];
      if (reading && (!best || reading.at > best.reading.at)) best = { notebook, reading };
    }
    return best;
  }, [query, readings, sortedNotebooks]);

  const readCount = useMemo(
    () =>
      sortedNotebooks.reduce((sum, notebook) => sum + (readings[notebook.id]?.visited.length ?? 0), 0),
    [readings, sortedNotebooks],
  );
  const sectionTotal = useMemo(
    () => sortedNotebooks.reduce((sum, notebook) => sum + Math.max(0, notebook.sectionCount), 0),
    [sortedNotebooks],
  );

  const openNotebook = async (notebook: LocalNotebook) => {
    setBusyId(notebook.id);
    setError(null);
    try {
      const repository = await getLocalRepository();
      const document = await loadNotebookForReading(repository, notebook.id);
      if (!document) throw new Error('本地找不到这个笔记本。');
      setAccent(colorById.get(notebook.id) ?? 'blue');
      setResource({ kind: 'notebook', document });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const resumeColor = resume ? (colorById.get(resume.notebook.id) ?? 'blue') : 'blue';
  const resumeName = resume ? splitNotebookName(resume.notebook.name) : null;

  return (
    <PhonePage
      title="笔记"
      subtitle={workspace.course.courseCode || workspace.course.name}
      overlay
      onBack={onBack}
    >
      {workspace.notebooks.length ? (
        <label className="phone-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索笔记"
            type="search"
          />
        </label>
      ) : null}
      {error ? <p className="phone-page-error">{error}</p> : null}

      {resume && resumeName ? (
        <button
          type="button"
          className={`nb-resume${busyId === resume.notebook.id ? ' is-opening' : ''}`}
          style={accentStyle(resumeColor)}
          disabled={busyId !== null}
          onClick={() => void openNotebook(resume.notebook)}
        >
          <span className="nb-resume-orb" aria-hidden>
            <img src={marbleImages[resumeColor]} alt="" />
          </span>
          <span className="nb-resume-copy">
            <small>接着读</small>
            <strong>{resumeName.title}</strong>
            <SectionDots total={resume.notebook.sectionCount} reading={resume.reading} />
          </span>
          <span className="nb-resume-go" aria-hidden>
            {busyId === resume.notebook.id ? (
              <GlassSpinner size={16} />
            ) : (
              <span className="nb-resume-go-text">
                {Math.min(resume.reading.last + 1, Math.max(1, resume.notebook.sectionCount))}
                <i>/</i>
                {resume.notebook.sectionCount}
              </span>
            )}
          </span>
        </button>
      ) : null}

      {notebooks.length ? (
        <>
          <p className="phone-group-title nb-group-title">
            <span>{workspace.notebooks.length} 本笔记</span>
            {sectionTotal ? (
              <span className="nb-group-meter" title={`读过 ${readCount} / ${sectionTotal} 节`}>
                <i style={{ width: `${Math.min(100, (readCount / sectionTotal) * 100)}%` }} />
              </span>
            ) : null}
          </p>
          <div className="nb-grid">
            {notebooks.slice(0, listWindow.count).map((notebook, index) => {
              const busy = busyId === notebook.id;
              const color = colorById.get(notebook.id) ?? notebookMarbleColor(index);
              const { number, title } = splitNotebookName(notebook.name);
              const reading = readings[notebook.id];
              const done =
                notebook.sectionCount > 0 &&
                (reading?.visited.length ?? 0) >= notebook.sectionCount;
              return (
                <button
                  key={notebook.id}
                  type="button"
                  className={`nb-card${busy ? ' is-opening' : ''}${done ? ' is-done' : ''}`}
                  style={{
                    ...accentStyle(color),
                    animationDelay: `${Math.min(index % 40, 12) * 28}ms`,
                  }}
                  disabled={busyId !== null}
                  onClick={() => void openNotebook(notebook)}
                >
                  <NotebookMarble color={color} number={number} />
                  <span className="nb-card-copy">
                    <strong>{title}</strong>
                    <span className="nb-card-foot">
                      <SectionDots total={notebook.sectionCount} reading={reading} />
                      <small title={new Date(notebook.updatedAt).toLocaleString()}>
                        {formatAgo(notebook.updatedAt)}
                      </small>
                    </span>
                  </span>
                  {busy ? <GlassSpinner size={17} className="nb-card-trailing" /> : null}
                </button>
              );
            })}
          </div>
          {listWindow.hasHidden ? (
            <GlassLoadMore onLoadMore={listWindow.showMore} watchKey={listWindow.count} />
          ) : null}
        </>
      ) : (
        <LearningEmptyState
          title={workspace.notebooks.length ? '没有匹配的笔记' : '还没有笔记'}
          hint={workspace.notebooks.length ? '换个关键词再试。' : undefined}
          action={
            !workspace.notebooks.length && onUpload
              ? {
                  label: '上传笔记',
                  icon: <img src={marbleImages.blue} alt="" />,
                  onClick: onUpload,
                }
              : undefined
          }
        />
      )}

      {resource ? (
        <LocalResourceViewer
          resource={resource}
          accent={accent}
          onClose={() => {
            setResource(null);
            setReadings(loadNotebookReadings());
          }}
        />
      ) : null}
    </PhonePage>
  );
}
