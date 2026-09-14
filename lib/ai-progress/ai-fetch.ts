'use client';

import { useAiActivityStore } from '@/lib/store/ai-activity';

/** Match AI work, excluding ordinary reads and background status polling. */
export function isAiRequest(path: string, init?: RequestInit): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes((init?.method || 'GET').toUpperCase())) return false;
  const pathname = path.split('?')[0];
  return (
    /^\/api\/(?:generate(?:\/|-classroom$)|chat$|pbl\/chat$|quiz-grade$|transcription$|syllabus\/parse$|parse-pdf$|web-search$|verify-(?:model|image-provider|video-provider)$|learn\/(?:turn|action-planner|planning-intent|mini-lectures)$|notebooks\/(?:send-message|micro-lesson(?:\/insert-position)?)$|classroom\/repair-slide-|teaching\/review-plan$|review-route\/)/.test(
      pathname,
    ) ||
    /\/problems\/(?:generate|import-preview|[^/]+\/attempts\/submit)$/.test(pathname) ||
    /\/(?:source-ingest|mind-map)$/.test(pathname)
  );
}

/** One token per request, retained through the response body (including SSE). */
export async function aiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (typeof window === 'undefined' || !isAiRequest(path, init)) return fetch(path, init);
  const id = `request:${crypto.randomUUID()}`;
  const report = useAiActivityStore.getState().report;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    report(id, false);
    init?.signal?.removeEventListener('abort', finish);
  };
  report(id, true);
  init?.signal?.addEventListener('abort', finish, { once: true });
  try {
    if (init?.signal?.aborted) finish();
    const response = await fetch(path, init);
    if (!response.ok || !response.body) {
      finish();
      return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            finish();
            controller.close();
          } else {
            controller.enqueue(value);
          }
        } catch (error) {
          finish();
          controller.error(error);
        }
      },
      cancel(reason) {
        finish();
        return reader.cancel(reason);
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    finish();
    throw error;
  }
}
