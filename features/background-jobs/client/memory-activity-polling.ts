import {
  memoryActivitySnapshotSchema,
  type MemoryActivitySnapshot,
} from '../domain/memory-activity';

export const MEMORY_ACTIVITY_ACTIVE_POLL_MS = 3_000;
export const MEMORY_ACTIVITY_IDLE_POLL_MS = 20_000;

/** Observation only: leaving the page cancels reads, never the server's memory work. */
export function startMemoryActivityPolling(options: {
  ownerId: string;
  courseId: string;
  isVisible: () => boolean;
  onSnapshot: (snapshot: MemoryActivitySnapshot) => void;
  onUnavailable: () => void;
  fetch?: typeof fetch;
}) {
  let stopped = false;
  let request: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryMs = MEMORY_ACTIVITY_IDLE_POLL_MS;
  let refreshPending = false;

  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (!stopped && options.isVisible()) timer = setTimeout(() => void poll(), delay);
  };
  const poll = async () => {
    if (stopped || request || !options.isVisible()) return;
    const controller = new AbortController();
    request = controller;
    let delay = MEMORY_ACTIVITY_IDLE_POLL_MS;
    try {
      const response = await (options.fetch ?? fetch)(
        `/api/learn/memory-activities?courseId=${encodeURIComponent(options.courseId)}`,
        {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        },
      );
      if (!response.ok) throw new Error('Memory activity unavailable');
      const snapshot = memoryActivitySnapshotSchema.parse(await response.json());
      if (snapshot.ownerId !== options.ownerId) throw new Error('Memory activity owner changed');
      if (snapshot.activities.some((activity) => activity.courseId !== options.courseId))
        throw new Error('Memory activity course changed');
      if (stopped || controller.signal.aborted) return;
      options.onSnapshot(snapshot);
      retryMs = MEMORY_ACTIVITY_IDLE_POLL_MS;
      if (snapshot.activities.some((a) => a.status === 'queued' || a.status === 'running'))
        delay = MEMORY_ACTIVITY_ACTIVE_POLL_MS;
    } catch {
      if (!stopped && !controller.signal.aborted) {
        options.onUnavailable();
        delay = retryMs;
        retryMs = Math.min(retryMs * 2, 60_000);
      }
    } finally {
      request = undefined;
      schedule(refreshPending ? 0 : delay);
      refreshPending = false;
    }
  };

  const refresh = () => {
    clearTimeout(timer);
    if (!options.isVisible()) {
      request?.abort();
      return;
    }
    if (request) refreshPending = true;
    else void poll();
  };
  refresh();
  return {
    refresh,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      request?.abort();
    },
  };
}
