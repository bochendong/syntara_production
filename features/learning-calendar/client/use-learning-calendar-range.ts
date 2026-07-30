'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SyllabusCalendarEvent } from '@/features/learn-core/client-calendar-actions';
import {
  createLearningCalendarEvents,
  deleteLearningCalendarEvent,
  learningCalendarCompactRange,
  learningCalendarCreateInput,
  learningCalendarMonthRange,
  makeLearningCalendarIdempotencyKey,
  listLearningCalendarEvents,
  updateLearningCalendarEvent,
  type LearningCalendarEventPatch,
  type LearningCalendarRange,
  type RemoteLearningCalendarEvent,
} from '@/features/learning-calendar/client/calendar-api';

type CalendarRangeMode = 'month' | 'compact';

const DEFAULT_RANGE_CACHE_TTL_MS = 60_000;
const RANGE_CACHE_MAX_ENTRIES = 24;

type CalendarRangeCacheEntry = {
  events: RemoteLearningCalendarEvent[];
  truncated: boolean;
  storedAt: number;
};

const calendarRangeCache = new Map<string, CalendarRangeCacheEntry>();

function writeCalendarRangeCache(key: string, entry: CalendarRangeCacheEntry) {
  calendarRangeCache.delete(key);
  calendarRangeCache.set(key, entry);
  while (calendarRangeCache.size > RANGE_CACHE_MAX_ENTRIES) {
    const oldestKey = calendarRangeCache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    calendarRangeCache.delete(oldestKey);
  }
}

function sortEvents(events: RemoteLearningCalendarEvent[]): RemoteLearningCalendarEvent[] {
  return [...events].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      (left.start || '').localeCompare(right.start || '') ||
      left.title.localeCompare(right.title, 'zh-CN'),
  );
}

function mergeEvents(
  current: RemoteLearningCalendarEvent[],
  incoming: RemoteLearningCalendarEvent[],
): RemoteLearningCalendarEvent[] {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) {
    if (event.clientEventId) {
      for (const [id, candidate] of byId.entries()) {
        if (candidate.clientEventId === event.clientEventId && id !== event.id) byId.delete(id);
      }
    }
    byId.set(event.id, event);
  }
  return sortEvents(Array.from(byId.values()));
}

function optimisticRemoteEvent(
  event: SyllabusCalendarEvent,
  courseId: string | null,
): RemoteLearningCalendarEvent {
  const now = Date.now();
  return {
    ...event,
    id: event.id,
    clientEventId: event.clientEventId || event.id,
    ...(courseId === null ? {} : { courseId }),
    ...(event.start ? { start: event.start } : {}),
    proposalId: event.proposalId ?? null,
    version: event.version ?? 1,
    updatedAt: event.updatedAt ?? now,
    createdAt: event.createdAt || now,
  };
}

export function useLearningCalendarRange(args: {
  referenceDate: Date;
  courseId?: string;
  rangeMode?: CalendarRangeMode;
  enabled?: boolean;
  previewEvents?: SyllabusCalendarEvent[];
  cacheTtlMs?: number;
}) {
  const { courseId, enabled = true, previewEvents, cacheTtlMs = DEFAULT_RANGE_CACHE_TTL_MS } = args;
  const preview = Boolean(previewEvents);
  const range = useMemo<LearningCalendarRange>(
    () =>
      args.rangeMode === 'compact'
        ? learningCalendarCompactRange(args.referenceDate)
        : learningCalendarMonthRange(args.referenceDate),
    [args.rangeMode, args.referenceDate],
  );
  const rangeKey = `${courseId || 'account'}:${range.start}:${range.end}`;
  const initialPreviewEvents = useMemo(
    () =>
      (previewEvents || []).map((event) => optimisticRemoteEvent(event, event.courseId ?? null)),
    [previewEvents],
  );
  const [events, setEvents] = useState<RemoteLearningCalendarEvent[]>(initialPreviewEvents);
  const eventsRef = useRef(events);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const truncatedRef = useRef(false);
  const [mutationCount, setMutationCount] = useState(0);
  const [loadedRangeKey, setLoadedRangeKey] = useState(preview ? rangeKey : '');
  const loadAbortRef = useRef<AbortController | null>(null);
  const mutationQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const commitEvents = useCallback(
    (
      next:
        | RemoteLearningCalendarEvent[]
        | ((current: RemoteLearningCalendarEvent[]) => RemoteLearningCalendarEvent[]),
      options?: { cache?: boolean },
    ) => {
      const resolved = typeof next === 'function' ? next(eventsRef.current) : next;
      eventsRef.current = sortEvents(resolved);
      setEvents(eventsRef.current);
      if (options?.cache && !preview) {
        writeCalendarRangeCache(rangeKey, {
          events: eventsRef.current,
          truncated: truncatedRef.current,
          storedAt: Date.now(),
        });
      }
    },
    [preview, rangeKey],
  );

  useEffect(() => {
    if (!preview) return;
    commitEvents(initialPreviewEvents);
    setLoadedRangeKey(rangeKey);
    setLoading(false);
    setError(null);
    truncatedRef.current = false;
    setTruncated(false);
  }, [commitEvents, initialPreviewEvents, preview, rangeKey]);

  const load = useCallback(async () => {
    if (preview) return eventsRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await listLearningCalendarEvents({
        ...range,
        ...(courseId ? { courseId } : {}),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return eventsRef.current;
      truncatedRef.current = result.truncated;
      setTruncated(result.truncated);
      commitEvents(result.events, { cache: true });
      setLoadedRangeKey(rangeKey);
      return result.events;
    } catch (loadError) {
      if (controller.signal.aborted) return eventsRef.current;
      const message =
        loadError instanceof Error ? loadError.message : '学习日历加载失败，请稍后重试。';
      setError(message);
      throw loadError;
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null;
        setLoading(false);
      }
    }
  }, [commitEvents, courseId, preview, range, rangeKey]);

  useEffect(() => {
    if (!enabled || preview) return;
    const cached = calendarRangeCache.get(rangeKey);
    if (cached) {
      commitEvents(cached.events);
      truncatedRef.current = cached.truncated;
      setTruncated(cached.truncated);
      setLoadedRangeKey(rangeKey);
      setError(null);
      if (Date.now() - cached.storedAt <= Math.max(0, cacheTtlMs)) {
        setLoading(false);
        return;
      }
    }
    void load().catch(() => undefined);
    return () => {
      loadAbortRef.current?.abort();
    };
  }, [cacheTtlMs, commitEvents, enabled, load, preview, rangeKey]);

  const enqueueMutation = useCallback(<T>(mutation: () => Promise<T>): Promise<T> => {
    const queued = mutationQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        setMutationCount((current) => current + 1);
        try {
          return await mutation();
        } finally {
          setMutationCount((current) => Math.max(0, current - 1));
        }
      });
    mutationQueueRef.current = queued;
    return queued;
  }, []);

  const createEvents = useCallback(
    (
      incoming: SyllabusCalendarEvent[],
      options?: { idempotencyKey?: string },
    ): Promise<RemoteLearningCalendarEvent[]> =>
      enqueueMutation(async () => {
        if (!incoming.length) return [];
        if (preview) {
          const next = incoming.map((event) =>
            optimisticRemoteEvent(event, event.courseId ?? null),
          );
          commitEvents((current) => mergeEvents(current, next));
          return next;
        }

        const optimistic = incoming.map((event) =>
          optimisticRemoteEvent(event, courseId ?? event.courseId ?? null),
        );
        const optimisticIds = new Set(optimistic.map((event) => event.id));
        commitEvents((current) => mergeEvents(current, optimistic), { cache: true });
        try {
          const created: RemoteLearningCalendarEvent[] = [];
          for (let index = 0; index < incoming.length; index += 50) {
            const chunk = incoming.slice(index, index + 50);
            const result = await createLearningCalendarEvents({
              events: chunk.map((event) =>
                learningCalendarCreateInput(event, courseId ?? event.courseId ?? null),
              ),
              idempotencyKey:
                options?.idempotencyKey && incoming.length <= 50
                  ? options.idempotencyKey
                  : options?.idempotencyKey
                    ? `${options.idempotencyKey}.${index / 50}`.slice(0, 200)
                    : makeLearningCalendarIdempotencyKey(
                        'calendar.create',
                        `${optimistic[index]?.clientEventId || index}`,
                      ),
            });
            created.push(...result.events);
          }
          commitEvents(
            (current) =>
              mergeEvents(
                current.filter(
                  (event) =>
                    !optimisticIds.has(event.id) &&
                    !optimistic.some(
                      (candidate) =>
                        candidate.clientEventId && candidate.clientEventId === event.clientEventId,
                    ),
                ),
                created,
              ),
            { cache: true },
          );
          setError(null);
          return created;
        } catch (mutationError) {
          commitEvents(
            (current) =>
              current.filter(
                (event) =>
                  !optimisticIds.has(event.id) &&
                  !optimistic.some(
                    (candidate) =>
                      candidate.clientEventId && candidate.clientEventId === event.clientEventId,
                  ),
              ),
            { cache: true },
          );
          setError(
            mutationError instanceof Error ? mutationError.message : '学习日历写入失败，请重试。',
          );
          throw mutationError;
        }
      }),
    [commitEvents, courseId, enqueueMutation, preview],
  );

  const updateEvent = useCallback(
    (
      event: RemoteLearningCalendarEvent,
      patch: LearningCalendarEventPatch,
      options?: { idempotencyKey?: string },
    ): Promise<RemoteLearningCalendarEvent> =>
      enqueueMutation(async () => {
        const previous = eventsRef.current.find((candidate) => candidate.id === event.id) || event;
        const optimistic = {
          ...previous,
          ...patch,
          courseId:
            patch.courseId === undefined ? previous.courseId : (patch.courseId ?? undefined),
          origin: patch.origin === null ? undefined : (patch.origin ?? previous.origin),
          sourceRef: patch.sourceRef === null ? undefined : (patch.sourceRef ?? previous.sourceRef),
          durationMinutes:
            patch.durationMinutes === null
              ? undefined
              : (patch.durationMinutes ?? previous.durationMinutes),
          status: patch.status === null ? undefined : (patch.status ?? previous.status),
          updatedAt: Date.now(),
        } as RemoteLearningCalendarEvent;
        commitEvents(
          (current) =>
            current.map((candidate) => (candidate.id === event.id ? optimistic : candidate)),
          { cache: true },
        );
        if (preview) return optimistic;
        try {
          const result = await updateLearningCalendarEvent({
            eventId: previous.id,
            expectedVersion: previous.version,
            patch,
            idempotencyKey:
              options?.idempotencyKey ||
              makeLearningCalendarIdempotencyKey(
                'calendar.update',
                `${previous.id}-${previous.version}`,
              ),
          });
          commitEvents(
            (current) =>
              current.map((candidate) => (candidate.id === previous.id ? result.event : candidate)),
            { cache: true },
          );
          setError(null);
          return result.event;
        } catch (mutationError) {
          commitEvents(
            (current) =>
              current.map((candidate) => (candidate.id === previous.id ? previous : candidate)),
            { cache: true },
          );
          setError(
            mutationError instanceof Error ? mutationError.message : '学习日历更新失败，请重试。',
          );
          throw mutationError;
        }
      }),
    [commitEvents, enqueueMutation, preview],
  );

  const deleteEvent = useCallback(
    (event: RemoteLearningCalendarEvent, options?: { idempotencyKey?: string }): Promise<void> =>
      enqueueMutation(async () => {
        const previous = eventsRef.current.find((candidate) => candidate.id === event.id) || event;
        commitEvents((current) => current.filter((candidate) => candidate.id !== previous.id), {
          cache: true,
        });
        if (preview) return;
        try {
          await deleteLearningCalendarEvent({
            eventId: previous.id,
            expectedVersion: previous.version,
            idempotencyKey:
              options?.idempotencyKey ||
              makeLearningCalendarIdempotencyKey(
                'calendar.delete',
                `${previous.id}-${previous.version}`,
              ),
          });
          commitEvents((current) => current, { cache: true });
          setError(null);
        } catch (mutationError) {
          commitEvents((current) => mergeEvents(current, [previous]), { cache: true });
          setError(
            mutationError instanceof Error ? mutationError.message : '学习日历删除失败，请重试。',
          );
          throw mutationError;
        }
      }),
    [commitEvents, enqueueMutation, preview],
  );

  const mergeLoadedEvents = useCallback(
    (incoming: RemoteLearningCalendarEvent[]) => {
      commitEvents((current) => mergeEvents(current, incoming), { cache: true });
    },
    [commitEvents],
  );

  return {
    events,
    loading,
    mutating: mutationCount > 0,
    error,
    truncated,
    range,
    loaded: loadedRangeKey === rangeKey,
    reload: load,
    createEvents,
    updateEvent,
    deleteEvent,
    mergeLoadedEvents,
  };
}
