'use client';

import { startTransition, useEffect, useMemo, useState } from 'react';
import type { MemoryActivityRecord } from '@/lib/store/memory-activity';
import type { TaskHistoryRecord } from '@/lib/store/task-history';
import {
  MEMORY_ACTIVITY_RECENT_MS,
  MEMORY_JOB_ACTIVITY_PREFIX,
  type MemoryActivitySnapshot,
} from '../domain/memory-activity';
import { startMemoryActivityPolling } from './memory-activity-polling';

export function projectMemoryActivities(snapshot: MemoryActivitySnapshot | undefined, now: number) {
  const history: TaskHistoryRecord[] = (snapshot?.activities ?? []).map((activity) => ({
    ...activity,
    id: `memory_activity:${MEMORY_JOB_ACTIVITY_PREFIX}${activity.id}`,
    source: 'memory_activity',
    sourceId: `${MEMORY_JOB_ACTIVITY_PREFIX}${activity.id}`,
    courseId: activity.courseId ?? undefined,
    kind: 'study_memory',
  }));
  const activities: MemoryActivityRecord[] = history
    .filter((record) => !record.finishedAt || now - record.finishedAt <= MEMORY_ACTIVITY_RECENT_MS)
    .map((record) => ({
      ...record,
      id: record.sourceId,
      status:
        record.status === 'queued'
          ? 'detecting'
          : record.status === 'running'
            ? 'writing_study_memory'
            : (record.status as 'completed' | 'failed' | 'skipped'),
      layer: 'study_memory',
    }));
  return { activities, history };
}

function snapshotVersion(snapshot: MemoryActivitySnapshot | undefined, now: number) {
  return JSON.stringify(
    snapshot?.activities.map((activity) => ({
      ...activity,
      // Lease heartbeats do not represent another memory update.
      updatedAt: activity.finishedAt ? activity.updatedAt : undefined,
      recent: !activity.finishedAt || now - activity.finishedAt <= MEMORY_ACTIVITY_RECENT_MS,
    })),
  );
}

export function useMemoryJobActivities(args: {
  ownerId: string | null;
  courseId: string | null;
  enabled: boolean;
  dialogOpen: boolean;
}) {
  const { ownerId, courseId, enabled, dialogOpen } = args;
  const scope = enabled && ownerId && courseId ? JSON.stringify([ownerId, courseId]) : '';
  const [state, setState] = useState<{
    scope: string;
    snapshot?: MemoryActivitySnapshot;
    unavailable: boolean;
    observedAt: number;
  }>({ scope: '', unavailable: false, observedAt: 0 });

  useEffect(() => {
    if (!scope || !ownerId || !courseId) return;
    const polling = startMemoryActivityPolling({
      ownerId,
      courseId,
      isVisible: () => document.visibilityState !== 'hidden',
      onSnapshot: (snapshot) =>
        startTransition(() =>
          setState((previous) => {
            const observedAt = Date.now();
            if (
              previous.scope === scope &&
              !previous.unavailable &&
              snapshotVersion(previous.snapshot, previous.observedAt) ===
                snapshotVersion(snapshot, observedAt)
            )
              return previous;
            return { scope, snapshot, unavailable: false, observedAt };
          }),
        ),
      onUnavailable: () =>
        setState((previous) => ({
          scope,
          snapshot: previous.scope === scope ? previous.snapshot : undefined,
          unavailable: true,
          observedAt: Date.now(),
        })),
    });
    document.addEventListener('visibilitychange', polling.refresh);
    window.addEventListener('online', polling.refresh);
    return () => {
      polling.stop();
      document.removeEventListener('visibilitychange', polling.refresh);
      window.removeEventListener('online', polling.refresh);
    };
    // Opening the history also refreshes it immediately.
  }, [scope, ownerId, courseId, dialogOpen]);

  // Scope the render as well as the request: an old response must never flash after switching accounts/courses.
  const current = scope && state.scope === scope ? state : undefined;
  const projected = useMemo(
    () => projectMemoryActivities(current?.snapshot, current?.observedAt ?? 0),
    [current],
  );
  return { ...projected, unavailable: current?.unavailable ?? false };
}
