import { useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight } from 'lucide-react';
import { LearningEmptyState } from './LearningEmptyState';

import { getLocalRepository } from '../data/repository';
import { loadNotebookForReading } from '../data/course-sync';
import type { LocalCourseWorkspace, LocalNotebook } from '../domain/models';
import { GlassLoadMore, useListWindow, GlassSpinner } from './GlassLoadMore';
import { LocalResourceViewer, type LocalResourceDocument } from './LocalResourceViewer';
import {
  groupNotebookTranslations,
  notebookSearchText,
  notebookVariants,
} from '../lib/notebook-translations';

const DAY_MS = 24 * 60 * 60 * 1000;

function formatUpdatedAt(timestamp: number) {
  const days = Math.floor((Date.now() - timestamp) / DAY_MS);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

type NotebookLibraryPageProps = {
  workspace: LocalCourseWorkspace;
  onBack: () => void;
};

export function NotebookLibraryPage({ workspace, onBack }: NotebookLibraryPageProps) {
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resource, setResource] = useState<LocalResourceDocument | null>(null);
  const library = useMemo(
    () => groupNotebookTranslations(workspace.notebooks),
    [workspace.notebooks],
  );

  const notebooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = library;
    if (!q) return list;
    return list.filter((notebook) => {
      const haystack = [
        notebookSearchText(workspace.notebooks, notebook.id),
        notebook.kind,
        String(notebook.sectionCount),
      ]
        .join('\n')
        .toLowerCase();
      return q
        .split(/\s+/)
        .filter(Boolean)
        .every((term) => haystack.includes(term));
    });
  }, [query, workspace.notebooks, library]);

  const openNotebook = async (notebook: LocalNotebook) => {
    setBusyId(notebook.id);
    setError(null);
    try {
      const repository = await getLocalRepository();
      const document = await loadNotebookForReading(repository, notebook.id);
      if (!document) throw new Error('本地找不到这个笔记本。');
      setResource({ kind: 'notebook', document });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const listWindow = useListWindow(notebooks.length, `${workspace.course.id}:${query}`, 40);

  return (
    <section className="native-problem-bank native-notebook-library" aria-label="笔记本库">
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
              <BookOpen size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索笔记本名称"
              />
            </label>
            <span className="native-problem-bank-count">
              {notebooks.length}/{library.length}
            </span>
          </div>
          <div className="native-problem-bank-meta">
            <span>
              <BookOpen size={14} />
              笔记本库 · {library.length} 本
            </span>
            <span>点开后在本机阅读器中查看</span>
          </div>
          {error ? <p className="native-problem-practice-error">{error}</p> : null}
        </header>

        <div className="native-notebook-library-grid">
          {notebooks.length === 0 ? (
            <LearningEmptyState
              title={workspace.notebooks.length ? '没有匹配的笔记本' : '还没有本地笔记本'}
              hint={
                workspace.notebooks.length
                  ? '换个关键词再试。'
                  : '导入课程资料或迁移档案后，这里会出现笔记本。'
              }
            />
          ) : (
            notebooks.slice(0, listWindow.count).map((notebook) => {
              const busy = busyId === notebook.id;
              return (
                <button
                  key={notebook.id}
                  type="button"
                  className="native-notebook-library-card"
                  disabled={busy || busyId !== null}
                  onClick={() => void openNotebook(notebook)}
                >
                  <span className="native-notebook-library-spine" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className="native-notebook-library-pages" aria-hidden="true" />
                  <span className="native-notebook-library-row-icon" aria-hidden="true">
                    <BookOpen size={18} />
                  </span>
                  <span className="native-notebook-library-cover">
                    <span className="native-notebook-library-card-kind">
                      {notebook.kind === 'markdown' ? 'Markdown' : '讲义'}
                      {notebookVariants(workspace.notebooks, notebook.id).length > 1
                        ? ' · 中文 / English'
                        : ''}
                    </span>
                    <strong className="native-notebook-library-card-title">{notebook.name}</strong>
                    <span className="native-notebook-library-card-meta">
                      <span>{notebook.sectionCount} 章节</span>
                      <span title={new Date(notebook.updatedAt).toLocaleString()}>
                        {formatUpdatedAt(notebook.updatedAt)}
                      </span>
                    </span>
                    <span className="native-notebook-library-card-action">
                      {busy ? <GlassSpinner size={14} /> : null}
                      {busy ? '打开中…' : '打开'}
                    </span>
                  </span>
                  <span className="native-notebook-library-card-chevron" aria-hidden="true">
                    {busy ? <GlassSpinner size={16} /> : <ChevronRight size={18} />}
                  </span>
                </button>
              );
            })
          )}
        </div>
        {listWindow.hasHidden ? (
          <GlassLoadMore onLoadMore={listWindow.showMore} watchKey={listWindow.count} />
        ) : null}
      </div>

      {resource ? (
        <LocalResourceViewer
          resource={resource}
          notebooks={workspace.notebooks}
          onClose={() => setResource(null)}
        />
      ) : null}
    </section>
  );
}
