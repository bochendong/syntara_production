import { useEffect, useRef, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2 } from 'lucide-react';
import { HandwritingPageDeleteConfirmation } from './handwriting-page-delete-confirmation';
import {
  appendHandwritingPage,
  removeHandwritingPage,
  handwritingHasContent,
  MAX_HANDWRITING_PAGES,
  readHandwritingDraft,
  saveHandwritingDraft,
  type HandwritingDocument,
  type HandwritingDraft,
  type HandwritingPage,
  type InkStroke,
} from '../../data/handwriting-draft';

export type HandwritingPageEditorProps = {
  page: HandwritingPage;
  redoStrokes: InkStroke[];
  disabled: boolean;
  onPageChange: (page: HandwritingPage, redo: InkStroke[]) => void;
  onWritingChange: (writing: boolean) => void;
  writing: boolean;
};
const EMPTY_REDO: InkStroke[] = [];

export function HandwritingDocumentInput({
  draftKey,
  headerContainerId,
  disabled,
  onHandwritingChange,
  PageEditor,
}: {
  draftKey: string;
  headerContainerId?: string;
  disabled: boolean;
  onHandwritingChange: (document: HandwritingDocument) => void;
  PageEditor: ComponentType<HandwritingPageEditorProps>;
}) {
  const [documentDraft, setDocumentDraft] = useState<HandwritingDraft | null>(null);
  const latest = useRef<HandwritingDraft | null>(null);
  const [redos, setRedos] = useState<Record<string, InkStroke[]>>({});
  const [header, setHeader] = useState<HTMLElement | null>(null);
  const [error, setError] = useState('');
  const [writing, setWriting] = useState(false);
  const [deletePageId, setDeletePageId] = useState<string | null>(null);
  const pagesHeaderRef = useRef<HTMLDivElement>(null);
  const focusActivePage = useRef(false);
  useEffect(() => {
    if (!focusActivePage.current) return;
    pagesHeaderRef.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.focus({ preventScroll: true });
    focusActivePage.current = false;
  }, [documentDraft]);
  const saveQueue = useRef(Promise.resolve());
  const mounted = useRef(true);
  const change = useRef(onHandwritingChange);
  useEffect(() => {
    change.current = onHandwritingChange;
  }, [onHandwritingChange]);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void readHandwritingDraft(draftKey)
      .then((stored) => {
        if (cancelled) return;
        latest.current = stored;
        setHeader(headerContainerId ? document.getElementById(headerContainerId) : null);
        setDocumentDraft(stored);
        if (handwritingHasContent(stored)) change.current({ pages: structuredClone(stored.pages) });
      })
      .catch(() => {
        if (!cancelled) setError('本机草稿无法读取，请重新打开手写作答。');
      });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [draftKey, headerContainerId]);
  const save = (next: HandwritingDraft) => {
    const snapshot = structuredClone(next);
    latest.current = snapshot;
    setDocumentDraft(snapshot);
    change.current({ pages: structuredClone(snapshot.pages) });
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(async () => {
        try {
          await saveHandwritingDraft(snapshot);
        } catch {
          if (mounted.current) setError('本机草稿暂未保存，请先提交作答再离开。');
        }
      });
  };
  const deletePage = (imageId: string) => {
    const current = latest.current;
    if (!current || disabled || writing) return;
    const next = removeHandwritingPage(current, imageId);
    if (next === current) return;
    focusActivePage.current = true;
    setRedos((before) => {
      const remaining = { ...before };
      delete remaining[imageId];
      return remaining;
    });
    save(next);
    setDeletePageId(null);
  };
  if (!documentDraft)
    return (
      <div className="ink-document-loading" aria-busy={!error}>
        {error ? <p role="alert">{error}</p> : null}
      </div>
    );
  const activePage =
    documentDraft.pages.find((page) => page.imageId === documentDraft.activePageId) ??
    documentDraft.pages[0];
  const pagesHeader = (
    <div
      ref={pagesHeaderRef}
      className="ink-pages-header"
      role="group"
      aria-label="手写页面"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="ink-page-tabs" role="group" aria-label="切换手写页面">
        {documentDraft.pages.map((page, index) => (
          <button
            key={page.imageId}
            type="button"
            aria-label={`手写第 ${index + 1} 页`}
            aria-pressed={page.imageId === activePage.imageId}
            disabled={disabled || writing}
            onClick={() => {
              if (latest.current) save({ ...latest.current, activePageId: page.imageId });
            }}
          >
            {index + 1}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="ink-add-page"
        aria-label="新页面"
        title={
          documentDraft.pages.length >= MAX_HANDWRITING_PAGES ? '最多 4 页' : '新页面，最多 4 页'
        }
        disabled={disabled || writing || documentDraft.pages.length >= MAX_HANDWRITING_PAGES}
        onClick={() => {
          if (latest.current) save(appendHandwritingPage(latest.current));
        }}
      >
        <Plus size={14} />
        {documentDraft.pages.length >= MAX_HANDWRITING_PAGES ? '已达 4 页' : '新页面'}
      </button>
      <button
        type="button"
        className="ink-delete-page"
        aria-label="删除当前手写页"
        title={documentDraft.pages.length <= 1 ? '至少保留 1 页' : '删除当前页'}
        disabled={disabled || writing || documentDraft.pages.length <= 1}
        onClick={() => {
          if (activePage.strokes.length) setDeletePageId(activePage.imageId);
          else deletePage(activePage.imageId);
        }}
      >
        <Trash2 size={14} />
        删除页面
      </button>
    </div>
  );
  return (
    <>
      {header ? createPortal(pagesHeader, header) : pagesHeader}
      <PageEditor
        page={activePage}
        redoStrokes={redos[activePage.imageId] ?? EMPTY_REDO}
        disabled={disabled}
        onWritingChange={setWriting}
        writing={writing}
        onPageChange={(page, redo) => {
          const current = latest.current;
          if (!current) return;
          setRedos((before) => ({ ...before, [page.imageId]: redo }));
          save({
            ...current,
            pages: current.pages.map((before) => (before.imageId === page.imageId ? page : before)),
          });
        }}
      />
      {deletePageId ? (
        <HandwritingPageDeleteConfirmation
          pageNumber={documentDraft.pages.findIndex((page) => page.imageId === deletePageId) + 1}
          busy={disabled || writing}
          onCancel={() => setDeletePageId(null)}
          onConfirm={() => deletePage(deletePageId)}
        />
      ) : null}
      {error ? (
        <p role="alert" className="native-problem-practice-error">
          {error}
        </p>
      ) : null}
    </>
  );
}
