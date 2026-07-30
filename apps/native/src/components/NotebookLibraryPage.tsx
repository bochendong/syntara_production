import { useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, CheckCircle2, Loader2 } from 'lucide-react';

import { getLocalRepository } from '../data/repository';
import type { LocalCourseWorkspace, LocalNotebook } from '../domain/models';
import { LocalResourceViewer, type LocalResourceDocument } from './LocalResourceViewer';

type NotebookLibraryPageProps = {
  workspace: LocalCourseWorkspace;
  onBack: () => void;
};

export function NotebookLibraryPage({ workspace, onBack }: NotebookLibraryPageProps) {
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resource, setResource] = useState<LocalResourceDocument | null>(null);

  const notebooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...workspace.notebooks].sort(
      (a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, 'zh-CN'),
    );
    if (!q) return list;
    return list.filter((notebook) => {
      const haystack = [notebook.name, notebook.kind, String(notebook.sectionCount)]
        .join('\n')
        .toLowerCase();
      return q
        .split(/\s+/)
        .filter(Boolean)
        .every((term) => haystack.includes(term));
    });
  }, [query, workspace.notebooks]);

  const openNotebook = async (notebook: LocalNotebook) => {
    setBusyId(notebook.id);
    setError(null);
    try {
      const repository = await getLocalRepository();
      const document = await repository.loadNotebookDocument(notebook.id);
      if (!document) throw new Error('本地找不到这个笔记本。');
      setResource({ kind: 'notebook', document });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="native-problem-bank" aria-label="笔记本库">
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
              {notebooks.length}/{workspace.notebooks.length}
            </span>
          </div>
          <div className="native-problem-bank-meta">
            <span>
              <BookOpen size={14} />
              笔记本库 · {workspace.notebooks.length} 本
            </span>
            <span>点开后在本机阅读器中查看</span>
          </div>
          {error ? <p className="native-problem-practice-error">{error}</p> : null}
        </header>

        <div className="native-notebook-library-grid">
          {notebooks.length === 0 ? (
            <div className="native-problem-bank-empty">
              <CheckCircle2 size={28} />
              <strong>
                {workspace.notebooks.length ? '没有匹配的笔记本' : '还没有本地笔记本'}
              </strong>
              <span>
                {workspace.notebooks.length
                  ? '换个关键词再试。'
                  : '导入课程资料或迁移档案后，这里会出现笔记本。'}
              </span>
            </div>
          ) : (
            notebooks.map((notebook) => {
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
                  <span className="native-notebook-library-cover">
                    <span className="native-notebook-library-card-kind">
                      {notebook.kind === 'markdown' ? 'Markdown' : '讲义'}
                    </span>
                    <strong className="native-notebook-library-card-title">{notebook.name}</strong>
                    <span className="native-notebook-library-card-meta">
                      <span>{notebook.sectionCount} 章节</span>
                      <span>{new Date(notebook.updatedAt).toLocaleString()}</span>
                    </span>
                    <span className="native-notebook-library-card-action">
                      {busy ? <Loader2 size={14} className="spin" /> : null}
                      {busy ? '打开中…' : '打开'}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {resource ? (
        <LocalResourceViewer resource={resource} onClose={() => setResource(null)} />
      ) : null}
    </section>
  );
}
