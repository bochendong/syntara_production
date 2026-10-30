import type { DebugWorkerMessage } from './python-debug.worker';

export type PythonDebugEvent =
  | DebugWorkerMessage
  | { type: 'timeout'; message: string }
  | { type: 'stopped' };

/** A fresh worker per run keeps Python state isolated and makes infinite loops stoppable. */
export function runPythonDebug(
  code: string,
  onEvent: (event: PythonDebugEvent) => void,
  input: { files?: Array<{ path: string; content: string }>; stdin?: string } = {},
) {
  const worker = new Worker(new URL('./python-debug.worker.ts', import.meta.url), {
    type: 'module',
  });
  let finished = false;
  let timer: ReturnType<typeof setTimeout>;
  const finish = (event: PythonDebugEvent) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    worker.terminate();
    onEvent(event);
  };
  timer = setTimeout(
    () => finish({ type: 'timeout', message: 'Python 加载超时，请重试。' }),
    45_000,
  );
  worker.onmessage = ({ data }: MessageEvent<DebugWorkerMessage>) => {
    if (finished) return;
    if (data.type === 'ready') {
      clearTimeout(timer);
      timer = setTimeout(
        () => finish({ type: 'timeout', message: '运行超过 5 秒，已停止。' }),
        5000,
      );
      onEvent(data);
    } else if (data.type === 'done' || data.type === 'output-limit') {
      finish(data);
    } else {
      onEvent(data);
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    finish({ type: 'done', error: event.message || 'Python 无法启动，请重试。' });
  };
  worker.postMessage({
    code,
    files: input.files ?? [],
    stdin: input.stdin ?? '',
    indexURL: new URL(`${import.meta.env.BASE_URL}python-runtime/`, window.location.href).href,
  });
  return () => finish({ type: 'stopped' });
}
