'use client';

import { useEffect } from 'react';
import { useTaskHistoryStore } from '@/lib/store/task-history';
import { notifyTaskResult } from '@/lib/notifications/task-notifications';

const QUIET_TASKS = new Set([
  'chat-reply',
  'pbl-chat',
  'speech-generation',
  'quiz-grading',
  'problem-evaluation',
]);

export function TaskNotificationObserver() {
  useEffect(
    () =>
      useTaskHistoryStore.subscribe((state, previous) => {
        for (const task of state.records) {
          if (task.source !== 'ai_task' || QUIET_TASKS.has(task.kind)) continue;
          const before = previous.records.find((item) => item.id === task.id);
          if (
            !before ||
            before.status === task.status ||
            !['queued', 'running'].includes(before.status)
          )
            continue;
          notifyTaskResult({
            id: task.id,
            title: task.title,
            status: task.status,
            href: task.detailHref || task.contextPath,
          });
        }
      }),
    [],
  );
  return null;
}
