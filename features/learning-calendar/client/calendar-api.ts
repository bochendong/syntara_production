'use client';

import type {
  SyllabusCalendarEvent,
  SyllabusEventKind,
} from '@/features/learn-core/client-calendar-actions';
import { BackendApiError, backendJson, type BackendLoadOptions } from '@/lib/utils/backend-api';

const CALENDAR_API_PATH = '/api/learn/calendar/events';
const CALENDAR_API_TIMEOUT_MS = 15_000;
const CALENDAR_EVENT_LIST_LIMIT = 120;

const EVENT_KINDS = new Set<SyllabusEventKind>([
  'assignment',
  'exam',
  'progress',
  'tutorial',
  'holiday',
  'other',
]);
const EVENT_ORIGINS = new Set(['syllabus', 'ai_plan', 'manual', 'practice', 'exam_prep'] as const);
const EVENT_STATUSES = new Set(['planned', 'done', 'skipped'] as const);
const SOURCE_REF_TYPES = new Set(['plan', 'action', 'syllabus', 'manual'] as const);

type CalendarEventOrigin = NonNullable<SyllabusCalendarEvent['origin']>;
type CalendarEventStatus = NonNullable<SyllabusCalendarEvent['status']>;
type CalendarSourceRef = NonNullable<SyllabusCalendarEvent['sourceRef']>;

export type RemoteLearningCalendarEvent = SyllabusCalendarEvent & {
  clientEventId: string | null;
  sourceRef?: CalendarSourceRef;
  proposalId: string | null;
  durationMinutes?: number;
  status?: CalendarEventStatus;
  week?: string | null;
  sourceColumn?: string | null;
  rawText?: string | null;
  confidence?: number | null;
  version: number;
  updatedAt: number;
};

export type LearningCalendarEventCreateInput = {
  clientEventId?: string;
  courseId?: string | null;
  title: string;
  kind: SyllabusEventKind;
  date: string;
  start?: string | null;
  sourceName: string;
  origin?: CalendarEventOrigin | null;
  sourceRef?: CalendarSourceRef | null;
  proposalId?: string | null;
  durationMinutes?: number | null;
  status?: CalendarEventStatus | null;
  week?: string | null;
  sourceColumn?: string | null;
  rawText?: string | null;
  confidence?: number | null;
};

export type LearningCalendarEventPatch = Omit<
  Partial<LearningCalendarEventCreateInput>,
  'clientEventId'
>;

export type LearningCalendarRange = {
  start: string;
  end: string;
};

type CalendarListResponse = {
  storage: 'database';
  range: LearningCalendarRange;
  limit: number;
  events: RemoteLearningCalendarEvent[];
  truncated: boolean;
};

export type LearningCalendarSearchResult = {
  events: RemoteLearningCalendarEvent[];
  scannedCount: number;
  truncated: boolean;
  range: LearningCalendarRange;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function invalidResponse(path: string, detail: string): never {
  throw new BackendApiError({
    kind: 'invalid_response',
    message: `学习日历响应不符合客户端契约：${detail}`,
    path,
  });
}

function requiredString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    return invalidResponse(path, `${key} 必须是非空字符串`);
  }
  return value;
}

function nullableString(record: Record<string, unknown>, key: string, path: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== 'string') return invalidResponse(path, `${key} 必须是字符串或 null`);
  return value;
}

function nullableNumber(record: Record<string, unknown>, key: string, path: string): number | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return invalidResponse(path, `${key} 必须是有限数字或 null`);
  }
  return value;
}

function parseTimestamp(value: unknown, key: string, path: string): number {
  if (typeof value !== 'string') return invalidResponse(path, `${key} 必须是 ISO 时间`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return invalidResponse(path, `${key} 不是有效时间`);
  return timestamp;
}

function parseRemoteEvent(value: unknown, path: string): RemoteLearningCalendarEvent {
  if (!isRecord(value)) return invalidResponse(path, 'event 必须是对象');

  const id = requiredString(value, 'id', path);
  const title = requiredString(value, 'title', path);
  const date = requiredString(value, 'date', path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return invalidResponse(path, `无效 date: ${date}`);
  }
  const sourceName = requiredString(value, 'sourceName', path);
  const kindValue = requiredString(value, 'kind', path);
  if (!EVENT_KINDS.has(kindValue as SyllabusEventKind)) {
    return invalidResponse(path, `未知 kind: ${kindValue}`);
  }

  const originValue = nullableString(value, 'origin', path);
  if (originValue !== null && !EVENT_ORIGINS.has(originValue as CalendarEventOrigin)) {
    return invalidResponse(path, `未知 origin: ${originValue}`);
  }
  const statusValue = nullableString(value, 'status', path);
  if (statusValue !== null && !EVENT_STATUSES.has(statusValue as CalendarEventStatus)) {
    return invalidResponse(path, `未知 status: ${statusValue}`);
  }

  let sourceRef: CalendarSourceRef | undefined;
  if (value.sourceRef !== null) {
    if (!isRecord(value.sourceRef)) return invalidResponse(path, 'sourceRef 必须是对象或 null');
    const type = requiredString(value.sourceRef, 'type', path);
    if (!SOURCE_REF_TYPES.has(type as CalendarSourceRef['type'])) {
      return invalidResponse(path, `未知 sourceRef.type: ${type}`);
    }
    sourceRef = {
      type: type as CalendarSourceRef['type'],
      id: requiredString(value.sourceRef, 'id', path),
    };
  }

  const version = value.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return invalidResponse(path, 'version 必须是正整数');
  }
  const start = nullableString(value, 'start', path);
  if (start !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start)) {
    return invalidResponse(path, `无效 start: ${start}`);
  }
  const durationMinutes = nullableNumber(value, 'durationMinutes', path);
  if (
    durationMinutes !== null &&
    (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 1440)
  ) {
    return invalidResponse(path, 'durationMinutes 必须是 5 到 1440 的整数或 null');
  }
  const confidence = nullableNumber(value, 'confidence', path);
  if (confidence !== null && (confidence < 0 || confidence > 1)) {
    return invalidResponse(path, 'confidence 必须介于 0 和 1 之间或为 null');
  }

  const courseId = nullableString(value, 'courseId', path);

  return {
    id,
    clientEventId: nullableString(value, 'clientEventId', path),
    ...(courseId === null ? {} : { courseId }),
    title,
    kind: kindValue as SyllabusEventKind,
    date,
    ...(start === null ? {} : { start }),
    sourceName,
    createdAt: parseTimestamp(value.createdAt, 'createdAt', path),
    updatedAt: parseTimestamp(value.updatedAt, 'updatedAt', path),
    version,
    ...(originValue === null ? {} : { origin: originValue as CalendarEventOrigin }),
    ...(sourceRef ? { sourceRef } : {}),
    proposalId: nullableString(value, 'proposalId', path),
    ...(durationMinutes === null ? {} : { durationMinutes }),
    ...(statusValue === null ? {} : { status: statusValue as CalendarEventStatus }),
    week: nullableString(value, 'week', path),
    sourceColumn: nullableString(value, 'sourceColumn', path),
    rawText: nullableString(value, 'rawText', path),
    confidence,
  };
}

function parseListResponse(value: unknown, path: string): CalendarListResponse {
  if (!isRecord(value) || value.storage !== 'database' || !isRecord(value.range)) {
    return invalidResponse(path, '列表响应缺少 database storage 或 range');
  }
  if (!Array.isArray(value.events) || typeof value.truncated !== 'boolean') {
    return invalidResponse(path, '列表响应缺少 events 或 truncated');
  }
  const limit = value.limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    return invalidResponse(path, 'limit 必须是正整数');
  }
  return {
    storage: 'database',
    range: {
      start: requiredString(value.range, 'start', path),
      end: requiredString(value.range, 'end', path),
    },
    limit,
    events: value.events.map((event, index) => parseRemoteEvent(event, `${path}#events[${index}]`)),
    truncated: value.truncated,
  };
}

function parseMutationResponse(
  value: unknown,
  path: string,
): { events: RemoteLearningCalendarEvent[]; idempotentReplay: boolean } {
  if (!isRecord(value) || !Array.isArray(value.events)) {
    return invalidResponse(path, '写入响应缺少 events');
  }
  if (typeof value.idempotentReplay !== 'boolean') {
    return invalidResponse(path, '写入响应缺少 idempotentReplay');
  }
  return {
    events: value.events.map((event, index) => parseRemoteEvent(event, `${path}#events[${index}]`)),
    idempotentReplay: value.idempotentReplay,
  };
}

function parseSingleMutationResponse(
  value: unknown,
  path: string,
): { event: RemoteLearningCalendarEvent; idempotentReplay: boolean } {
  if (!isRecord(value)) return invalidResponse(path, '写入响应必须是对象');
  if (typeof value.idempotentReplay !== 'boolean') {
    return invalidResponse(path, '写入响应缺少 idempotentReplay');
  }
  return {
    event: parseRemoteEvent(value.event, `${path}#event`),
    idempotentReplay: value.idempotentReplay,
  };
}

function parseDeleteResponse(
  value: unknown,
  path: string,
): { eventId: string; deleted: boolean; idempotentReplay: boolean } {
  if (!isRecord(value)) return invalidResponse(path, '删除响应必须是对象');
  if (
    value.deleted !== true ||
    typeof value.idempotentReplay !== 'boolean' ||
    !isRecord(value.event)
  ) {
    return invalidResponse(path, '删除响应缺少 deleted 或 idempotentReplay');
  }
  return {
    eventId: requiredString(value.event, 'id', path),
    deleted: true,
    idempotentReplay: value.idempotentReplay,
  };
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function learningCalendarMonthRange(referenceDate: Date): LearningCalendarRange {
  const first = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  return { start: localDateKey(start), end: localDateKey(addDays(start, 41)) };
}

export function learningCalendarCompactRange(referenceDate: Date): LearningCalendarRange {
  const start = addDays(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1), -31);
  return { start: localDateKey(start), end: localDateKey(addDays(start, 365)) };
}

export function makeLearningCalendarIdempotencyKey(prefix: string, stablePart?: string): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 60) || 'calendar';
  const safeStablePart = stablePart?.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 100);
  const randomPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return [safePrefix, safeStablePart || randomPart].join('.').slice(0, 200);
}

export function learningCalendarCreateInput(
  event: SyllabusCalendarEvent,
  courseId: string | null,
): LearningCalendarEventCreateInput {
  return {
    clientEventId: event.clientEventId || event.id,
    courseId,
    title: event.title.trim(),
    kind: event.kind,
    date: event.date,
    start: event.start ?? null,
    sourceName: event.sourceName.trim() || '学习日历',
    origin: event.origin ?? null,
    sourceRef: event.sourceRef ?? null,
    proposalId: event.proposalId ?? null,
    durationMinutes: event.durationMinutes ?? null,
    status: event.status ?? null,
    week: event.week ?? null,
    sourceColumn: event.sourceColumn ?? null,
    rawText: event.rawText ?? null,
    confidence: event.confidence ?? null,
  };
}

export async function listLearningCalendarEvents(
  args: LearningCalendarRange & {
    courseId?: string;
    limit?: number;
  } & BackendLoadOptions,
): Promise<CalendarListResponse> {
  const query = new URLSearchParams({
    start: args.start,
    end: args.end,
    limit: String(args.limit ?? CALENDAR_EVENT_LIST_LIMIT),
  });
  if (args.courseId) query.set('courseId', args.courseId);
  const path = `${CALENDAR_API_PATH}?${query.toString()}`;
  const response = await backendJson<unknown>(path, {
    signal: args.signal,
    timeoutMs: args.timeoutMs ?? CALENDAR_API_TIMEOUT_MS,
  });
  return parseListResponse(response, path);
}

export async function createLearningCalendarEvents(args: {
  events: LearningCalendarEventCreateInput[];
  idempotencyKey: string;
  signal?: AbortSignal;
}): Promise<{ events: RemoteLearningCalendarEvent[]; idempotentReplay: boolean }> {
  const response = await backendJson<unknown>(CALENDAR_API_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': args.idempotencyKey,
    },
    body: JSON.stringify({ events: args.events }),
    signal: args.signal,
    timeoutMs: CALENDAR_API_TIMEOUT_MS,
  });
  return parseMutationResponse(response, CALENDAR_API_PATH);
}

export async function updateLearningCalendarEvent(args: {
  eventId: string;
  expectedVersion: number;
  patch: LearningCalendarEventPatch;
  idempotencyKey: string;
  signal?: AbortSignal;
}): Promise<{ event: RemoteLearningCalendarEvent; idempotentReplay: boolean }> {
  const path = `${CALENDAR_API_PATH}/${encodeURIComponent(args.eventId)}`;
  const response = await backendJson<unknown>(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': args.idempotencyKey,
    },
    body: JSON.stringify({ expectedVersion: args.expectedVersion, ...args.patch }),
    signal: args.signal,
    timeoutMs: CALENDAR_API_TIMEOUT_MS,
  });
  return parseSingleMutationResponse(response, path);
}

export async function deleteLearningCalendarEvent(args: {
  eventId: string;
  expectedVersion: number;
  idempotencyKey: string;
  signal?: AbortSignal;
}): Promise<{ eventId: string; deleted: boolean; idempotentReplay: boolean }> {
  const query = new URLSearchParams({ expectedVersion: String(args.expectedVersion) });
  const path = `${CALENDAR_API_PATH}/${encodeURIComponent(args.eventId)}?${query.toString()}`;
  const response = await backendJson<unknown>(path, {
    method: 'DELETE',
    headers: { 'Idempotency-Key': args.idempotencyKey },
    signal: args.signal,
    timeoutMs: CALENDAR_API_TIMEOUT_MS,
  });
  return parseDeleteResponse(response, path);
}

function normalizedSearchTerms(query: string): string[] {
  const stopWords = new Set(['查看', '查找', '搜索', '日历', '课程', '安排', '事项', '我的']);
  return Array.from(
    new Set(
      query
        .toLocaleLowerCase('zh-CN')
        .split(/[\s,，。:：;；/]+/)
        .map((term) => term.trim())
        .filter((term) => term && !stopWords.has(term)),
    ),
  ).slice(0, 8);
}

export async function searchLearningCalendarEvents(args: {
  courseId: string;
  query: string;
  referenceDate?: Date;
  signal?: AbortSignal;
}): Promise<LearningCalendarSearchResult> {
  const range = learningCalendarCompactRange(args.referenceDate ?? new Date());
  const result = await listLearningCalendarEvents({
    ...range,
    courseId: args.courseId,
    limit: CALENDAR_EVENT_LIST_LIMIT,
    signal: args.signal,
  });
  const terms = normalizedSearchTerms(args.query);
  const events =
    terms.length === 0
      ? result.events
      : result.events.filter((event) => {
          const haystack = [
            event.title,
            event.sourceName,
            event.rawText,
            event.date,
            event.kind,
            event.week,
          ]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase('zh-CN');
          return terms.every((term) => haystack.includes(term));
        });
  return {
    events: events.slice(0, 20),
    scannedCount: result.events.length,
    truncated: result.truncated || events.length > 20,
    range: result.range,
  };
}
