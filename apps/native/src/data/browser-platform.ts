import type {
  NativeChatTurnResult,
  NativePlatformStreamEvent,
  PlatformJsonCommandRequest,
} from './platform-api-contracts';
import { browserAccountId } from './browser-runtime';

export async function browserRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await browserFetch(path, init);
  const body = await response.json();
  if (body.success === false || body.ok === false)
    throw new Error(body.error?.message || body.error || '请求失败。');
  return body.data ?? body;
}

/** Standalone browser previews still use the authenticated, same-origin grader. */
export async function browserGrade<T>(payload: unknown, headers: HeadersInit): Promise<T> {
  const response = await fetch('/api/native/v1/grade', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success === false || body?.ok === false) {
    const message = body?.error?.message || (typeof body?.error === 'string' && body.error);
    throw new Error(
      message ||
        (response.status === 401
          ? '请先登录网页版后再提交评分。'
          : response.status === 404
            ? '当前预览尚未连接平台评分服务。'
            : `评分请求失败 (${response.status})`),
    );
  }
  if (!body) throw new Error('平台评分没有返回有效结果，请重试。');
  return body.data ?? body;
}

export async function browserFetch(path: string, init: RequestInit = {}) {
  if (!path.startsWith('/api/native/')) throw new Error('Unsupported platform endpoint.');
  const headers = new Headers(init.headers);
  headers.set('X-Syntara-User', browserAccountId());
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (response.status === 401) {
    window.location.replace('/test');
    throw new Error('请重新登录。');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message || `服务请求失败 (${response.status})`);
  }
  return response;
}

export const browserEndpoints: Record<string, { path: string; method?: string }> = {
  native_get_general_conversations: { path: '/api/native/v2/general-conversations' },
  native_save_general_conversation: {
    path: '/api/native/v2/general-conversations',
    method: 'POST',
  },
  native_delete_general_conversation: {
    path: '/api/native/v2/general-conversations',
    method: 'DELETE',
  },
  native_create_mini_lecture: { path: '/api/native/v1/mini-lectures', method: 'POST' },
  native_grade_answer: { path: '/api/native/v1/grade', method: 'POST' },
  native_grade_code: { path: '/api/native/v1/problem-code', method: 'POST' },
  native_get_hidden_tests: { path: '/api/native/v1/hidden-tests', method: 'POST' },
  native_transcribe_audio: { path: '/api/native/v1/transcriptions', method: 'POST' },
  native_start_realtime_transcription: {
    path: '/api/native/v1/realtime-transcription',
    method: 'POST',
  },
  native_parse_syllabus: { path: '/api/native/v1/syllabus/parse', method: 'POST' },
  native_get_conversations: { path: '/api/native/v1/conversations' },
  native_sync_conversation: { path: '/api/native/v1/conversations', method: 'POST' },
  native_delete_conversation: { path: '/api/native/v1/conversations', method: 'DELETE' },
  native_get_course_data: { path: '/api/native/v1/course-data' },
  native_get_notebook: { path: '/api/native/v1/notebooks' },
  native_get_mini_lecture: { path: '/api/native/v1/mini-lectures' },
  native_save_learning_progress: { path: '/api/native/v1/learning-progress', method: 'POST' },
  native_get_memories: { path: '/api/native/v1/memories' },
  native_sync_memories: { path: '/api/native/v1/memories', method: 'POST' },
  native_sync_calendar: { path: '/api/native/v1/calendar', method: 'POST' },
  native_sync_preferences: { path: '/api/native/v1/preferences', method: 'POST' },
  native_get_problems: { path: '/api/native/v1/problems' },
  native_upload_problem_attempts: { path: '/api/native/v1/problems', method: 'POST' },
  native_get_store: { path: '/api/native/v1/store' },
  native_store_action: { path: '/api/native/v1/store', method: 'POST' },
  native_upload_material: { path: '/api/native/v1/materials', method: 'POST' },
  native_delete_course: { path: '/api/native/v1/courses', method: 'DELETE' },
  native_edit_course: { path: '/api/native/v1/courses', method: 'PATCH' },
  native_get_onboarding: { path: '/api/native/v1/onboarding' },
  native_onboarding_action: { path: '/api/native/v1/onboarding', method: 'POST' },
};

export function browserCommand<T>(
  command: string,
  payload?: unknown,
  query?: Record<string, string>,
  headers?: HeadersInit,
): Promise<T> {
  const endpoint = browserEndpoints[command];
  if (!endpoint) throw new Error(`Unsupported platform command: ${command}`);
  return browserRequest(endpoint.path + (query ? `?${new URLSearchParams(query)}` : ''), {
    method: endpoint.method || 'GET',
    headers,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}

export async function browserChat<T>(
  request: PlatformJsonCommandRequest<T>,
  onEvent?: (event: NativePlatformStreamEvent) => void,
  signal?: AbortSignal,
): Promise<NativeChatTurnResult> {
  const response = await browserFetch('/api/native/v2/chat', {
    signal,
    method: 'POST',
    headers: browserCommandHeaders(request),
    body: JSON.stringify(request.payload),
  });
  if (!response.body) throw new Error('回复没有数据。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '',
    text = '',
    sequence = 0;
  let finalEvent: unknown = null;
  let finished = false;
  const consume = (block: string) => {
    const lines = block.split('\n');
    const event =
      lines
        .find((l) => l.startsWith('event:'))
        ?.slice(6)
        .trim() || 'message';
    const raw = lines
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!raw) return;
    const data = JSON.parse(raw);
    if (event === 'error') throw new Error(data.error?.message || '助教回复失败。');
    if (event === 'text_delta') text += data.delta || '';
    if (event === 'done') {
      finalEvent = data;
      text = data.assistantMessage?.text || text;
      finished = true;
    }
    onEvent?.({ requestId: request.requestId, sequence: ++sequence, event, data });
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      // CRLF normalization after buffering preserves split CR/LF boundaries.
      buffer = buffer.replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        consume(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!finished || !text.trim()) throw new Error('回复中断，请重试。');
  return {
    requestId: request.requestId,
    text: text.trim(),
    model: null,
    responseId: null,
    inputTokens: null,
    outputTokens: null,
    finalEvent,
  };
}
export function browserCommandHeaders(request: {
  requestId?: string;
  model?: string;
  responseStrength?: string;
  idempotencyKey?: string;
}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (request.requestId) headers['X-Request-Id'] = request.requestId;
  if (request.model) headers['X-Model'] = request.model;
  if (request.responseStrength) headers['X-Response-Strength'] = request.responseStrength;
  if (request.idempotencyKey) headers['Idempotency-Key'] = request.idempotencyKey;
  return headers;
}
