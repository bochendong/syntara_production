import { useState } from 'react';
import { createBrowserCourse } from '../data/platform-api-client';
import { useBackDismiss } from '../lib/use-back-dismiss';
import './create-course.css';
export function CreateCourseDialog({
  onCancel,
  onCreated,
  createCourse = createBrowserCourse,
  editing,
}: {
  onCancel: () => void;
  onCreated: (id: string) => Promise<void>;
  createCourse?: (name: string, description: string) => Promise<{ id: string }>;
  /** 编辑已有课程：预填名字和介绍，按钮改成「保存」。 */
  editing?: { name: string; description: string };
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
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
        <h2 id="create-course-title">{editing ? '编辑课程' : '添加课程'}</h2>
        {editing ? null : <p>创建自己的课程，然后开始聊天、添加资料和安排学习。</p>}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError(null);
            try {
              const course = await createCourse(name, description);
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
              {editing ? (busy ? '正在保存…' : '保存') : busy ? '正在创建…' : '创建课程'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
