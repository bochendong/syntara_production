'use client';

import { useNotificationStore } from '@/lib/store/notifications';

export function notifyTaskResult(input: {
  id: string;
  title: string;
  status: string;
  href?: string;
  ownerId?: string;
}) {
  const store = useNotificationStore.getState();
  if (!store.activeUserId || (input.ownerId && input.ownerId !== store.activeUserId)) return;
  if (!['completed', 'failed', 'needs_attention'].includes(input.status)) return;
  const completed = input.status === 'completed';
  store.enqueueBanner({
    id: `task:${input.id}:${input.status}`,
    kind: 'study_nudge',
    title: `${input.title} · ${completed ? '已完成' : input.status === 'failed' ? '未能完成' : '需要确认'}`,
    body: completed ? '结果已准备好，点击查看。' : '请打开任务查看详情，确认后可以继续处理。',
    tone: completed ? 'positive' : 'negative',
    presentation: 'banner',
    amountLabel: 'AI 任务',
    delta: 0,
    balanceAfter: 0,
    accountType: 'COMPUTE',
    sourceKind: 'AI_TASK_RESULT',
    sourceLabel: 'AI 任务',
    createdAt: new Date().toISOString(),
    details: [],
    showBalance: false,
    href: input.href || '/notifications',
  });
}

const snapshots = new Map<string, Map<string, string>>();
/** First snapshot is a baseline: opening a course never replays old results. */
export function observeTeacherTaskResults(
  ownerId: string,
  courseId: string,
  tasks: { id: string; status: string }[],
) {
  const key = `${ownerId}:${courseId}`;
  const previous = snapshots.get(key);
  snapshots.set(key, new Map(tasks.map((task) => [task.id, task.status])));
  if (snapshots.size > 100) snapshots.delete(snapshots.keys().next().value!);
  if (!previous) return;
  for (const task of tasks) {
    const before = previous.get(task.id);
    if (before && before !== task.status && ['queued', 'running'].includes(before)) {
      notifyTaskResult({
        id: `teacher:${task.id}`,
        title: '课程资料处理',
        status: task.status,
        ownerId,
        href: `/teacher/courses/${encodeURIComponent(courseId)}`,
      });
    }
  }
}
