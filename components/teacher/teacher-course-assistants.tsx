'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { backendJson } from '@/lib/utils/backend-api';

type Assistant = { id: string; name: string | null; email: string | null; active: boolean };

export function TeacherCourseAssistants({ courseId }: { courseId: string }) {
  const url = `/api/teacher/courses/${encodeURIComponent(courseId)}/teaching-assistants`;
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [account, setAccount] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void backendJson<{ assistants: Assistant[] }>(url, { signal: controller.signal })
      .then((result) => setAssistants(result.assistants))
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : '读取助教名单失败。');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url]);

  async function updateAssistants(
    method: 'POST' | 'DELETE',
    body: { email: string } | { userId: string },
  ) {
    setBusy(true);
    setError('');
    try {
      await backendJson(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (method === 'POST') setAccount('');
      const result = await backendJson<{ assistants: Assistant[] }>(url);
      setAssistants(result.assistants);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更新助教名单失败。');
    } finally {
      setBusy(false);
    }
  }

  function addAssistant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = account.trim();
    void updateAssistants('POST', value.includes('@') ? { email: value } : { userId: value });
  }

  return (
    <section className="space-y-4 rounded-2xl border bg-background p-4 sm:p-5">
      <h2 className="text-base font-semibold">课程助教</h2>
      <form className="flex flex-wrap items-end gap-3" onSubmit={addAssistant}>
        <div className="w-full space-y-2 sm:w-72">
          <Label htmlFor="course-assistant-account">助教邮箱或账号 ID</Label>
          <Input
            id="course-assistant-account"
            required
            value={account}
            onChange={(event) => setAccount(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={loading || busy || !account.trim()}>
          添加助教
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取助教名单…
        </p>
      ) : assistants.length ? (
        <ul className="divide-y">
          {assistants.map((assistant) => (
            <li key={assistant.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">
                  {assistant.name || assistant.email || '助教'}
                </p>
                {assistant.name && assistant.email ? (
                  <p className="break-words text-xs text-muted-foreground">{assistant.email}</p>
                ) : null}
                {assistant.active ? null : (
                  <p className="text-xs text-muted-foreground">资格未启用</p>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`移除助教 ${assistant.name || assistant.email || ''}`}
                disabled={busy}
                onClick={() => void updateAssistants('DELETE', { userId: assistant.id })}
              >
                移除
              </Button>
            </li>
          ))}
        </ul>
      ) : error ? null : (
        <p className="text-sm text-muted-foreground">这门课还没有助教。</p>
      )}
    </section>
  );
}
