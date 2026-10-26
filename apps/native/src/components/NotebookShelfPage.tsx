import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Search } from 'lucide-react';

import { getLocalRepository } from '../data/repository';
import { loadNotebookForReading } from '../data/course-sync';
import type { LocalCourseWorkspace, LocalNotebook } from '../domain/models';
import { marbleImages, type MarbleColor } from '../lib/learning-action-marbles';
import {
  groupNotebookTranslations,
  notebookSearchText,
  notebookVariants,
} from '../lib/notebook-translations';
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
import { MaterialUploadButton } from './MaterialUploadButton';
import {
  HiddenContentShelf,
  LayerActionMenu,
  LayerBadges,
  LayerItem,
  type LayerMenuTarget,
} from './CourseLayerControls';
import {
  copyCourseContent,
  refreshCourseLayers,
  removeCourseContent,
  restoreCourseContent,
  useCourseLayers,
} from '../lib/course-layers';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 节数太多时只画这么多颗，剩下的收成「+N」。 */
const MAX_SECTION_DOTS = 12;

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
  onUploadFiles,
  layered = false,
  onContentChanged,
}: {
  workspace: LocalCourseWorkspace;
  onBack: () => void;
  /** 空课程时去「资料」上传笔记。 */
  onUpload?: () => void;
  /** 搜索框旁上传键选好的文件，交给「资料」页整理。 */
  onUploadFiles?: (files: File[]) => void;
  /** 从商城加入的课：笔记可以删除（公有的只对自己隐藏）、复制到我的，显示「新」。 */
  layered?: boolean;
  /** 删除、恢复、复制之后重新同步这门课。 */
  onContentChanged?: () => Promise<void> | void;
}) {
  const courseId = workspace.course.id;
  const layers = useCourseLayers(courseId);
  const [menuTarget, setMenuTarget] = useState<LayerMenuTarget | null>(null);
  useEffect(() => {
    if (layered) void refreshCourseLayers(courseId).catch(() => undefined);
  }, [courseId, layered]);
  const freshIds = useMemo(() => new Set(layers.newNotebookIds), [layers.newNotebookIds]);
  const mineIds = useMemo(() => new Set(layers.privateNotebookIds), [layers.privateNotebookIds]);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resource, setResource] = useState<LocalResourceDocument | null>(null);
  const [accent, setAccent] = useState<MarbleColor>('blue');
  // 关掉阅读器时重新读一次，刚读过的节马上亮起来。
  const [readings, setReadings] = useState(loadNotebookReadings);

  const sortedNotebooks = useMemo(
    () => groupNotebookTranslations(workspace.notebooks),
    [workspace.notebooks],
  );
  const readingById = useMemo(
    () =>
      new Map(
        sortedNotebooks.map((notebook) => {
          const latest = notebookVariants(workspace.notebooks, notebook.id)
            .map((variant) => ({ notebook: variant, reading: readings[variant.id] }))
            .filter((item) => item.reading)
            .sort((a, b) => b.reading.at - a.reading.at)[0];
          return [notebook.id, latest] as const;
        }),
      ),
    [readings, sortedNotebooks, workspace.notebooks],
  );
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
      const haystack = notebookSearchText(workspace.notebooks, notebook.id);
      return terms.every((term) => haystack.includes(term));
    });
  }, [query, sortedNotebooks, workspace.notebooks]);
  const listWindow = useListWindow(notebooks.length, `${workspace.course.id}:${query}`, 40);

  // 最近读过的那本放在最上面，点一下接着读。
  const resume = useMemo(() => {
    if (query.trim()) return null;
    let best: { notebook: LocalNotebook; reading: NotebookReading } | null = null;
    for (const notebook of sortedNotebooks) {
      const reading = readingById.get(notebook.id)?.reading;
      if (reading && (!best || reading.at > best.reading.at)) best = { notebook, reading };
    }
    return best;
  }, [query, readingById, sortedNotebooks]);

  const readCount = useMemo(
    () =>
      sortedNotebooks.reduce(
        (sum, notebook) => sum + (readingById.get(notebook.id)?.reading.visited.length ?? 0),
        0,
      ),
    [readingById, sortedNotebooks],
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
      const edition = readingById.get(notebook.id)?.notebook ?? notebook;
      const document = await loadNotebookForReading(repository, edition.id);
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
      wide
      onBack={onBack}
    >
      {workspace.notebooks.length ? (
        <div className="material-search-row">
          <label className="phone-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索笔记"
              type="search"
            />
          </label>
          {onUploadFiles ? <MaterialUploadButton label="上传笔记" onFiles={onUploadFiles} /> : null}
        </div>
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
            <span>{sortedNotebooks.length} 本笔记</span>
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
              const reading = readingById.get(notebook.id)?.reading;
              const done =
                notebook.sectionCount > 0 &&
                (reading?.visited.length ?? 0) >= notebook.sectionCount;
              return (
                <LayerItem
                  key={notebook.id}
                  label={title}
                  onMore={
                    layered
                      ? () =>
                          setMenuTarget({
                            targetType: 'notebook',
                            targetId: notebook.id,
                            title,
                            mine: mineIds.has(notebook.id),
                          })
                      : undefined
                  }
                >
                  <button
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
                      <strong>
                        <span>{title}</span>
                        {layered ? (
                          <LayerBadges
                            fresh={freshIds.has(notebook.id)}
                            mine={mineIds.has(notebook.id)}
                          />
                        ) : null}
                      </strong>
                      <span className="nb-card-foot">
                        {notebookVariants(workspace.notebooks, notebook.id).length > 1 ? (
                          <small>中文 / English</small>
                        ) : null}
                        <SectionDots total={notebook.sectionCount} reading={reading} />
                        <small title={new Date(notebook.updatedAt).toLocaleString()}>
                          {formatAgo(notebook.updatedAt)}
                        </small>
                      </span>
                    </span>
                    {busy ? <GlassSpinner size={17} className="nb-card-trailing" /> : null}
                  </button>
                </LayerItem>
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

      {layered ? (
        <HiddenContentShelf
          items={layers.hidden.filter((item) => item.targetType === 'notebook')}
          onRestore={async (item) => {
            await restoreCourseContent(courseId, item);
            await onContentChanged?.();
          }}
        />
      ) : null}

      {menuTarget ? (
        <LayerActionMenu
          target={menuTarget}
          onClose={() => setMenuTarget(null)}
          onCopy={async () => {
            await copyCourseContent(courseId, menuTarget);
            await onContentChanged?.();
          }}
          onRemove={async () => {
            await removeCourseContent(courseId, menuTarget);
            await onContentChanged?.();
          }}
        />
      ) : null}

      {resource ? (
        <LocalResourceViewer
          resource={resource}
          notebooks={workspace.notebooks}
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
