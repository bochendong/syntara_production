import { useState, type DragEvent } from 'react';
import { Check, FileText, UploadCloud, X } from 'lucide-react';
import { addManagedCourseContent, type ManagedContentKind } from '../data/platform-api-client';
import { CourseModal } from './CourseModal';

const ACCEPT = '.txt,.md,.markdown,.csv,text/plain,text/markdown,text/csv';
const MAX_BYTES = 1_000_000;
const limit = (kind: ManagedContentKind) => (kind === 'problems' ? 12000 : MAX_BYTES);

type Upload = {
  id: string;
  file: File;
  kind: ManagedContentKind;
  title: string;
  status: 'waiting' | 'uploading' | 'done' | 'failed';
  error?: string;
};

/** 课程管理页的「上传」：拖入或选择多个文本文件，排队上传成笔记或题目，每个文件有自己的状态。 */
export function CourseUploadSheet({
  courseId,
  onUploaded,
  onClose,
}: {
  courseId: string;
  onUploaded: (kind: ManagedContentKind) => void;
  onClose: () => void;
}) {
  const [queue, setQueue] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const patch = (id: string, change: Partial<Upload>) =>
    setQueue((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));
  const add = (files: FileList | null) => {
    if (!files) return;
    setQueue((current) => [
      ...current,
      ...[...files].map((file) => ({
        id: crypto.randomUUID(),
        file,
        kind: 'notes' as const,
        title: file.name.replace(/\.[^.]+$/, ''),
        ...(file.size > MAX_BYTES
          ? { status: 'failed' as const, error: '超过 1 MB' }
          : { status: 'waiting' as const }),
      })),
    ]);
  };
  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    add(event.dataTransfer.files);
  };
  const waiting = queue.filter((item) => item.status === 'waiting');
  const start = async () => {
    setRunning(true);
    for (const item of waiting) {
      patch(item.id, { status: 'uploading', error: undefined });
      try {
        const text = (await item.file.text()).trim();
        if (!text) throw new Error('文件是空的');
        if (text.length > limit(item.kind)) throw new Error('内容太长');
        if (!item.title.trim()) throw new Error('名称不能为空');
        await addManagedCourseContent(courseId, item.kind, item.title.trim(), text);
        patch(item.id, { status: 'done' });
        onUploaded(item.kind);
      } catch (cause) {
        patch(item.id, {
          status: 'failed',
          error: cause instanceof Error ? cause.message : '上传失败',
        });
      }
    }
    setRunning(false);
  };
  const statusText = (item: Upload) =>
    item.status === 'waiting'
      ? '待上传'
      : item.status === 'uploading'
        ? '上传中…'
        : item.status === 'done'
          ? '已上传'
          : item.error || '失败';
  return (
    <CourseModal title="上传资料" busy={running} onClose={onClose}>
      <div className="cus">
        <label
          className={`cus-drop${dragging ? ' is-dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          <input
            type="file"
            multiple
            accept={ACCEPT}
            onChange={(event) => {
              add(event.target.files);
              event.target.value = '';
            }}
          />
          <UploadCloud size={30} aria-hidden />
          <strong>把文件拖到这里，或点一下选择</strong>
          <small>.txt · .md · .csv，每个不超过 1 MB；题目每个不超过 12000 字</small>
        </label>
        {queue.length ? (
          <ul className="cus-queue">
            {queue.map((item) => (
              <li key={item.id} className={`is-${item.status}`}>
                <FileText size={18} aria-hidden />
                <input
                  aria-label="名称"
                  value={item.title}
                  disabled={item.status !== 'waiting' && item.status !== 'failed'}
                  onChange={(event) => patch(item.id, { title: event.target.value })}
                />
                <span className="cce-seg" aria-label="上传成">
                  {(['notes', 'problems'] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={item.kind === kind}
                      disabled={item.status === 'uploading' || item.status === 'done'}
                      onClick={() =>
                        patch(item.id, {
                          kind,
                          ...(item.status === 'failed' && item.file.size <= MAX_BYTES
                            ? { status: 'waiting', error: undefined }
                            : {}),
                        })
                      }
                    >
                      {kind === 'notes' ? '笔记' : '题目'}
                    </button>
                  ))}
                </span>
                <span className={`cus-status is-${item.status}`}>
                  {item.status === 'done' ? <Check size={13} aria-hidden /> : null}
                  {statusText(item)}
                </span>
                {item.status === 'failed' && item.file.size <= MAX_BYTES ? (
                  <button
                    type="button"
                    className="cus-retry"
                    onClick={() => patch(item.id, { status: 'waiting', error: undefined })}
                  >
                    重试
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ccm-remove"
                  aria-label={`移除 ${item.file.name}`}
                  disabled={item.status === 'uploading'}
                  onClick={() =>
                    setQueue((current) => current.filter((entry) => entry.id !== item.id))
                  }
                >
                  <X size={15} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="cus-hint">
          每个文件会创建一条笔记或一道题；CSV
          不会自动拆分成多道题。题目先存为草稿，可在题库里编辑并设为待发布；发布课程更新后才向学生开放。
        </p>
        <div className="ccm-actions">
          <button type="button" className="ccm-ghost" disabled={running} onClick={onClose}>
            {queue.some((item) => item.status === 'done') ? '完成' : '关闭'}
          </button>
          <button
            type="button"
            className="ccm-primary"
            disabled={running || !waiting.length}
            onClick={() => void start()}
          >
            {running ? '上传中…' : waiting.length ? `上传 ${waiting.length} 个文件` : '上传'}
          </button>
        </div>
      </div>
    </CourseModal>
  );
}
