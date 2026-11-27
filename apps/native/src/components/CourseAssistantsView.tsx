import { useEffect, useState, type FormEvent } from 'react';
import {
  changeCourseAssistant,
  getCourseAssistants,
  type CourseAssistant,
} from '../data/platform-api-client';
import { GlassSkeletonRows } from './GlassLoadMore';

export function CourseAssistantsView({ courseId }: { courseId: string }) {
  const [assistants, setAssistants] = useState<CourseAssistant[] | null>(null);
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void getCourseAssistants(courseId)
      .then((result) => {
        if (active) setAssistants(result.assistants);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '读取助教名单失败。');
      });
    return () => {
      active = false;
    };
  }, [courseId]);

  async function update(change: Parameters<typeof changeCourseAssistant>[1]) {
    setBusy(true);
    setError('');
    try {
      const result = await changeCourseAssistant(courseId, change);
      setAssistants(result.assistants);
      if (change.action === 'add-assistant') setAccount('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更新助教名单失败。');
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = account.trim();
    if (!value || busy) return;
    void update({
      action: 'add-assistant',
      account: value.includes('@') ? { email: value } : { userId: value },
    });
  }

  return (
    <section className="tcv-panel grid gap-4" aria-label="课程助教">
      <form className="flex flex-wrap items-center gap-3" onSubmit={add}>
        <label className="phone-search">
          <input
            aria-label="助教邮箱或账号 ID"
            placeholder="助教邮箱或账号 ID"
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            required
          />
        </label>
        <button
          className="tcv-primary"
          type="submit"
          disabled={!assistants || busy || !account.trim()}
        >
          添加助教
        </button>
      </form>
      {error ? (
        <p className="phone-page-error" role="alert">
          {error}
        </p>
      ) : null}
      {!assistants && !error ? <GlassSkeletonRows rows={2} height={48} /> : null}
      {assistants?.length === 0 ? <p className="cp-muted">这门课还没有助教。</p> : null}
      {assistants?.length ? (
        <ul className="divide-y">
          {assistants.map((assistant) => (
            <li className="flex items-center justify-between gap-3 py-3" key={assistant.id}>
              <span className="min-w-0 break-words">
                <strong>{assistant.name || assistant.email || '助教'}</strong>
                {assistant.name && assistant.email ? (
                  <small className="cp-muted block">{assistant.email}</small>
                ) : null}
                {assistant.active ? null : <small className="cp-muted block">资格未启用</small>}
              </span>
              <button
                type="button"
                className="tcv-ghost"
                aria-label={`移除助教 ${assistant.name || assistant.email || ''}`}
                disabled={busy}
                onClick={() => void update({ action: 'remove-assistant', userId: assistant.id })}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
