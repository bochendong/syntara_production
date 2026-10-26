import { useState } from 'react';
import { browserRequest } from '../../data/browser-platform';

type ImportFile = {
  name: string;
  data: Record<string, unknown>;
  preview?: ImportReceipt;
  committed?: ImportReceipt;
  error?: string;
};

type ImportReceipt = {
  payloadHash: string;
  itemCount: number;
  chapters: Array<{ ref: string; name: string }>;
  difficultyCounts?: { easy: number; medium: number; hard: number };
  replayed?: boolean;
};

const ENDPOINT = '/api/native/v1/course-problem-imports';

export function ProblemImport({
  courseId,
  onImported,
}: {
  courseId: string;
  onImported: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshPending, setRefreshPending] = useState(false);

  async function refresh() {
    try {
      await onImported();
      setRefreshPending(false);
    } catch (cause) {
      setRefreshPending(true);
      throw cause;
    }
  }

  async function selectFiles(selected: FileList | null) {
    setError('');
    setFiles([]);
    if (!selected?.length) return;
    try {
      const parsed = await Promise.all(
        Array.from(selected).map(async (file): Promise<ImportFile> => {
          if (file.size > 2_000_000) throw new Error(`${file.name} 超过 2 MB。`);
          const data: unknown = JSON.parse(await file.text());
          if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error(`${file.name} 不是题库导入文件。`);
          }
          const record = data as Record<string, unknown>;
          if (record.courseId !== courseId) {
            throw new Error(`${file.name} 的课程与当前课程不同。`);
          }
          return { name: file.name, data: record };
        }),
      );
      setFiles(parsed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取文件。');
    }
  }

  async function run(mode: 'preview' | 'commit') {
    setBusy(true);
    setError('');
    const next = [...files];
    let changed = false;
    try {
      for (let index = 0; index < next.length; index += 1) {
        const file = next[index];
        if (mode === 'commit' && file.committed) continue;
        try {
          const result = await browserRequest<ImportReceipt>(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode,
              data: file.data,
              ...(mode === 'commit' ? { expectedHash: file.preview?.payloadHash } : {}),
            }),
          });
          next[index] = {
            ...file,
            error: undefined,
            ...(mode === 'preview' ? { preview: result } : { committed: result }),
          };
          changed ||= mode === 'commit';
        } catch (cause) {
          next[index] = {
            ...file,
            ...(mode === 'preview' ? { preview: undefined } : {}),
            error: cause instanceof Error ? cause.message : '请求失败，可重试。',
          };
          break;
        } finally {
          setFiles([...next]);
        }
      }
      if (changed) await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入后刷新失败，请重新打开课程。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pb-import" aria-label="上传课程题库">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        上传题库
      </button>
      {open ? (
        <div>
          <p>选择 AI 整理的题库 JSON，可同时选择多套。先预览章节、难度与题目校验，再确认导入。</p>
          <p>
            需要当前课程的管理权限。每个文件最多 100 题；失败后可重试，已导入的题目不会重复创建。
          </p>
          <label>
            选择题库文件
            <input
              type="file"
              accept=".json,application/json"
              multiple
              disabled={busy}
              onChange={(event) => void selectFiles(event.target.files)}
            />
          </label>
          <ul aria-live="polite">
            {files.map((file, index) => (
              <li key={`${file.name}:${index}`}>
                <strong>{file.name}</strong>
                {file.preview ? (
                  <>
                    <p>
                      {file.preview.itemCount} 题 ·{' '}
                      {file.preview.chapters.map((chapter) => chapter.name).join('、')}
                    </p>
                    {file.preview.difficultyCounts ? (
                      <p>
                        基础 {file.preview.difficultyCounts.easy} · 进阶{' '}
                        {file.preview.difficultyCounts.medium} · 挑战{' '}
                        {file.preview.difficultyCounts.hard}
                      </p>
                    ) : null}
                  </>
                ) : null}
                {file.committed ? (
                  <p>{file.committed.replayed ? '已导入，未重复创建' : '导入完成'}</p>
                ) : null}
                {file.error ? <p role="alert">{file.error}</p> : null}
              </li>
            ))}
          </ul>
          {error ? <p role="alert">{error}</p> : null}
          <div className="pb-chips">
            {refreshPending ? (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await refresh();
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : '刷新失败，可重试。');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                题目已保存，重试刷新
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy || !files.length}
              onClick={() => void run('preview')}
            >
              {busy ? '处理中…' : '预览并校验'}
            </button>
            <button
              type="button"
              disabled={
                busy ||
                !files.length ||
                files.some((file) => !file.preview) ||
                files.every((file) => file.committed)
              }
              onClick={() => void run('commit')}
            >
              确认导入
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
