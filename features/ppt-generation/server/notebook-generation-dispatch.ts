import { NextRequest } from 'next/server';
import { readApiErrorMessage } from '@/lib/create/api-errors';

type GenerationPath =
  | '/api/generate/image'
  | '/api/generate/scene-content'
  | '/api/generate/scene-actions';

async function dispatch(path: GenerationPath, request: NextRequest): Promise<Response> {
  switch (path) {
    case '/api/generate/image':
      return (await import('@/app/api/generate/image/route')).POST(request);
    case '/api/generate/scene-content':
      return (await import('./scene-content-route')).POST(request);
    case '/api/generate/scene-actions':
      return (await import('./scene-actions-route')).POST(request);
  }
}

/** Keep nested generation in the worker; its request URL is not an HTTP server. */
export async function postNotebookGenerationJson<T>(
  request: NextRequest,
  path: GenerationPath,
  payload: unknown,
  headers: Headers,
): Promise<T> {
  // Preserve the original authentication/trust boundary. Never mint internal
  // credentials here: both browser requests and trusted jobs use these handlers.
  const response = await dispatch(
    path,
    new NextRequest(new URL(path, request.url), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }),
  );
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, `${path} failed`));
  }
  return (await response.json()) as T;
}
