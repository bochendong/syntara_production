'use client';

import {
  type CreditsBalances,
  notifyCreditsBalancesChanged,
} from '@/lib/utils/credits-balance-events';

export type BackendRequestInit = RequestInit & {
  /** Optional per-request timeout. Omit (or pass 0) to leave the request unbounded. */
  timeoutMs?: number;
};

export type BackendLoadOptions = Pick<BackendRequestInit, 'signal' | 'timeoutMs'>;

export type BackendApiErrorKind = 'http' | 'timeout' | 'aborted' | 'network' | 'invalid_response';

// Railway's public proxy is intentionally used with a small Prisma pool in
// local development. Keep browser database reads aligned with that capacity so
// several course tabs do not occupy the whole pool at once.
const DATABASE_READ_CONCURRENCY = 1;
const DATABASE_READ_LOCK_NAME = 'syntara:database-read';
const DATABASE_READ_PREFIXES = [
  '/api/courses',
  '/api/course-forum',
  '/api/notebooks',
  '/api/learn/calendar',
  '/api/learn/conversations',
  '/api/memory',
  '/api/study-memory',
] as const;

type BrowserLockManager = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

type QueuedDatabaseRead = {
  path: string;
  signal: AbortSignal | undefined;
  priority: 'high' | 'normal';
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  cancelled: boolean;
  onAbort: () => void;
};

let activeDatabaseReads = 0;
const queuedDatabaseReads: QueuedDatabaseRead[] = [];

export class BackendApiError extends Error {
  readonly kind: BackendApiErrorKind;
  readonly path: string;
  readonly status: number | null;
  readonly backendMessage: string | null;
  readonly timeoutMs: number | null;
  readonly details: unknown;
  readonly cause: unknown;

  constructor(args: {
    kind: BackendApiErrorKind;
    message: string;
    path: string;
    status?: number | null;
    backendMessage?: string | null;
    timeoutMs?: number | null;
    details?: unknown;
    cause?: unknown;
  }) {
    super(args.message);
    this.name = 'BackendApiError';
    this.kind = args.kind;
    this.path = args.path;
    this.status = args.status ?? null;
    this.backendMessage = args.backendMessage ?? null;
    this.timeoutMs = args.timeoutMs ?? null;
    this.details = args.details;
    this.cause = args.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function shouldQueueDatabaseRead(path: string, init?: BackendRequestInit): boolean {
  const method = String(init?.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  const normalizedPath = path.split('?')[0] || path;
  return DATABASE_READ_PREFIXES.some(
    (prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
  );
}

async function withCrossTabDatabaseReadLock<T>(run: () => Promise<T>): Promise<T> {
  const lockManager = (globalThis.navigator as Navigator & { locks?: BrowserLockManager }).locks;
  if (!lockManager) return run();
  return lockManager.request(DATABASE_READ_LOCK_NAME, run);
}

function databaseReadPriority(path: string): QueuedDatabaseRead['priority'] {
  const normalizedPath = path.split('?')[0] || path;
  return normalizedPath.endsWith('/content-state') ? 'high' : 'normal';
}

function queuedReadAbortError(path: string): BackendApiError {
  return new BackendApiError({
    kind: 'aborted',
    message: `请求已取消：${path}`,
    path,
  });
}

function pumpDatabaseReadQueue() {
  while (activeDatabaseReads < DATABASE_READ_CONCURRENCY && queuedDatabaseReads.length > 0) {
    const queued = queuedDatabaseReads.shift();
    if (!queued) return;
    queued.signal?.removeEventListener('abort', queued.onAbort);
    if (queued.cancelled || queued.signal?.aborted) {
      if (!queued.cancelled) queued.reject(queuedReadAbortError(queued.path));
      continue;
    }

    activeDatabaseReads += 1;
    void queued
      .run()
      .then(queued.resolve, queued.reject)
      .finally(() => {
        activeDatabaseReads = Math.max(0, activeDatabaseReads - 1);
        pumpDatabaseReadQueue();
      });
  }
}

function withDatabaseReadSlot<T>(
  path: string,
  init: BackendRequestInit | undefined,
  context: RequestAbortContext,
  run: () => Promise<T>,
): Promise<T> {
  if (!shouldQueueDatabaseRead(path, init)) return run();
  return new Promise<T>((resolve, reject) => {
    const signal = context.signal;
    const queued: QueuedDatabaseRead = {
      path,
      signal,
      priority: databaseReadPriority(path),
      run,
      resolve: (value) => resolve(value as T),
      reject,
      cancelled: false,
      onAbort: () => {
        if (queued.cancelled) return;
        queued.cancelled = true;
        reject(transportError(path, context, signal?.reason));
      },
    };
    if (signal?.aborted) {
      queued.cancelled = true;
      reject(transportError(path, context, signal.reason));
      return;
    }
    signal?.addEventListener('abort', queued.onAbort, { once: true });
    if (queued.priority === 'high') {
      const firstNormalReadIndex = queuedDatabaseReads.findIndex(
        (candidate) => candidate.priority === 'normal',
      );
      if (firstNormalReadIndex === -1) queuedDatabaseReads.push(queued);
      else queuedDatabaseReads.splice(firstNormalReadIndex, 0, queued);
    } else {
      queuedDatabaseReads.push(queued);
    }
    pumpDatabaseReadQueue();
  });
}

type RequestAbortContext = {
  signal: AbortSignal | undefined;
  timeoutMs: number | null;
  abortKind: () => 'timeout' | 'aborted' | null;
  cleanup: () => void;
};

function normalizedTimeoutMs(value: number | undefined): number | null {
  if (value === undefined || value === 0) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('timeoutMs must be a finite, non-negative number.');
  }
  return Math.max(1, Math.floor(value));
}

function createRequestAbortContext(init?: BackendRequestInit): RequestAbortContext {
  const callerSignal = init?.signal ?? undefined;
  const timeoutMs = normalizedTimeoutMs(init?.timeoutMs);
  if (timeoutMs === null) {
    return {
      signal: callerSignal,
      timeoutMs,
      abortKind: () => (callerSignal?.aborted ? 'aborted' : null),
      cleanup: () => {},
    };
  }

  const controller = new AbortController();
  let kind: 'timeout' | 'aborted' | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (timeoutId !== null) clearTimeout(timeoutId);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  };
  const abortFromCaller = () => {
    if (controller.signal.aborted) return;
    kind = 'aborted';
    controller.abort(callerSignal?.reason);
  };

  if (callerSignal?.aborted) {
    abortFromCaller();
  } else if (callerSignal) {
    callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  }

  if (!controller.signal.aborted && timeoutMs !== null) {
    timeoutId = setTimeout(() => {
      if (controller.signal.aborted) return;
      kind = 'timeout';
      controller.abort();
    }, timeoutMs);
  }
  controller.signal.addEventListener('abort', cleanup, { once: true });

  return {
    signal: controller.signal,
    timeoutMs,
    abortKind: () => kind,
    cleanup,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.trim() : String(error || '').trim();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function transportError(
  path: string,
  context: RequestAbortContext,
  cause: unknown,
): BackendApiError {
  const abortKind = context.abortKind();
  if (abortKind === 'timeout') {
    return new BackendApiError({
      kind: 'timeout',
      message: `请求超时（${context.timeoutMs}ms）：${path}`,
      path,
      timeoutMs: context.timeoutMs,
      cause,
    });
  }
  if (abortKind === 'aborted' || isAbortError(cause)) {
    return new BackendApiError({
      kind: 'aborted',
      message: `请求已取消：${path}`,
      path,
      cause,
    });
  }

  const detail = errorMessage(cause);
  return new BackendApiError({
    kind: 'network',
    message: detail ? `网络请求失败：${path} — ${detail}` : `网络请求失败：${path}`,
    path,
    cause,
  });
}

function backendMessageFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  for (const candidate of [record.error, record.message]) {
    if (typeof candidate === 'string' && candidate.trim()) {
      const message = candidate.trim();
      if (
        /Invalid [`'"]?prisma\.|P1001|P1017|P2024|connection pool|Can't reach database|Server has closed the connection/i.test(
          message,
        )
      ) {
        return '数据库连接暂时繁忙，页面会自动重试；本地资料仍可继续查看。';
      }
      return message;
    }
    if (candidate && typeof candidate === 'object') {
      const nestedMessage = (candidate as Record<string, unknown>).message;
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
        const message = nestedMessage.trim();
        if (
          /Invalid [`'"]?prisma\.|P1001|P1017|P2024|connection pool|Can't reach database|Server has closed the connection/i.test(
            message,
          )
        ) {
          return '数据库连接暂时繁忙，页面会自动重试；本地资料仍可继续查看。';
        }
        return message;
      }
    }
  }
  return null;
}

async function readHttpErrorBody(response: Response): Promise<{
  backendMessage: string | null;
  details: unknown;
}> {
  const text = await response.text();
  if (!text.trim()) return { backendMessage: null, details: null };

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const details = JSON.parse(text) as unknown;
      return {
        backendMessage: backendMessageFromPayload(details),
        details,
      };
    } catch {
      // Preserve the actual response text when a server labels invalid JSON as JSON.
    }
  }

  const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 240);
  return { backendMessage: snippet || null, details: snippet || null };
}

function shouldNotifyCreditsAfterRequest(path: string, init?: RequestInit): boolean {
  const method = (init?.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;

  const normalizedPath = path.split('?')[0] || path;
  return [
    '/api/profile/credits/convert',
    '/api/courses/clone',
    '/api/notebooks/clone',
    '/api/gamification/',
    '/api/generate/',
    '/api/learn/turn',
    '/api/learn/action-planner',
    '/api/learn/planning-intent',
    '/api/web-search',
    '/api/notebooks/send-message',
    '/api/classroom/repair-slide-',
    '/api/review-route/generate',
    '/problems/import-preview',
  ].some((pattern) => normalizedPath.includes(pattern));
}

function extractBalancesFromResponse(data: unknown): CreditsBalances | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const maybeRecord = data as {
    balances?: CreditsBalances;
    summary?: { balances?: CreditsBalances };
  };
  return maybeRecord.balances || maybeRecord.summary?.balances;
}

async function performBackendFetch(
  path: string,
  init: BackendRequestInit | undefined,
  context: RequestAbortContext,
): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  const { timeoutMs: _timeoutMs, signal: _callerSignal, ...fetchInit } = init || {};
  try {
    return await fetch(path, {
      credentials: 'include',
      ...fetchInit,
      headers,
      signal: context.signal,
    });
  } catch (error) {
    throw transportError(path, context, error);
  }
}

export async function backendFetch(path: string, init?: BackendRequestInit): Promise<Response> {
  const context = createRequestAbortContext(init);
  try {
    return await withDatabaseReadSlot(path, init, context, async () => {
      return await withCrossTabDatabaseReadLock(() => performBackendFetch(path, init, context));
    });
  } finally {
    context.cleanup();
  }
}

export async function backendJson<T>(path: string, init?: BackendRequestInit): Promise<T> {
  const context = createRequestAbortContext(init);
  try {
    return await withDatabaseReadSlot(path, init, context, async () => {
      const resp = await withCrossTabDatabaseReadLock(() =>
        performBackendFetch(path, init, context),
      );
      if (!resp.ok) {
        let backendMessage: string | null = null;
        let details: unknown = null;
        try {
          ({ backendMessage, details } = await readHttpErrorBody(resp));
        } catch (error) {
          throw transportError(path, context, error);
        }
        const statusLabel = `HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}`;
        throw new BackendApiError({
          kind: 'http',
          message: backendMessage
            ? `请求失败: ${statusLabel} — ${backendMessage}`
            : `请求失败: ${statusLabel}`,
          path,
          status: resp.status,
          backendMessage,
          details,
        });
      }

      let data: T;
      try {
        data = (await resp.json()) as T;
      } catch (error) {
        if (context.abortKind() || isAbortError(error)) {
          throw transportError(path, context, error);
        }
        throw new BackendApiError({
          kind: 'invalid_response',
          message: `响应不是有效 JSON：${path}（HTTP ${resp.status}）`,
          path,
          status: resp.status,
          cause: error,
        });
      }
      if (shouldNotifyCreditsAfterRequest(path, init)) {
        notifyCreditsBalancesChanged(extractBalancesFromResponse(data));
      }
      return data;
    });
  } finally {
    context.cleanup();
  }
}
