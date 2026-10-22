import { useState } from 'react';
import { createBrowserCourse } from '../data/platform-api-client';
import { useBackDismiss } from '../lib/use-back-dismiss';
import './create-course.css';
export function CreateCourseDialog({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useBackDismiss(!busy, onCancel, 50);
  return (
    <div className="create-course-backdrop">
      <section
        className="create-course-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-course-title"
      >
        <h2 id="create-course-title">添加课程</h2>
        <p>创建自己的课程，然后开始聊天、添加资料和安排学习。</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError(null);
            try {
              const course = await createBrowserCourse(name, description);
              await onCreated(course.id);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
              setBusy(false);
            }
          }}
        >
          <label>
            课程名称
            <input
              autoFocus
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：线性代数"
              disabled={busy}
            />
          </label>
          <label>
            课程介绍（可选）
            <textarea
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
            />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <div className="create-course-actions">
            <button type="button" onClick={onCancel} disabled={busy}>
              取消
            </button>
            <button type="submit" disabled={busy || !name.trim()}>
              {busy ? '正在创建…' : '创建课程'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
