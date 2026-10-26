import type { PyodideInterface } from 'pyodide';

export type DebugWorkerMessage =
  | { type: 'ready' }
  | { type: 'output'; channel: 'stdout' | 'stderr'; text: string }
  | { type: 'done'; error?: string }
  | { type: 'output-limit' };

const scope = self as unknown as {
  onmessage: (event: MessageEvent<{ code: string; indexURL: string }>) => void;
  postMessage: (message: DebugWorkerMessage) => void;
};
const MAX_OUTPUT_BYTES = 64 * 1024;

scope.onmessage = async ({ data: { code, indexURL } }) => {
  let python: PyodideInterface | undefined;
  let bytes = 0;
  let pending = '';
  let channel: 'stdout' | 'stderr' = 'stdout';
  let limited = false;
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  const flush = () => {
    if (pending) scope.postMessage({ type: 'output', channel, text: pending });
    pending = '';
  };
  const write = (stream: 'stdout' | 'stderr', buffer: Uint8Array) => {
    if (limited) return buffer.length;
    const remaining = Math.max(0, MAX_OUTPUT_BYTES - bytes);
    bytes += buffer.length;
    if (stream !== channel) flush();
    channel = stream;
    pending += decoders[stream].decode(buffer.subarray(0, remaining), { stream: true });
    if (pending.length >= 512 || pending.includes('\n')) flush();
    if (bytes > MAX_OUTPUT_BYTES) {
      limited = true;
      flush();
      scope.postMessage({ type: 'output-limit' });
    }
    return buffer.length;
  };

  try {
    const { loadPyodide } = (await import(
      /* @vite-ignore */ `${indexURL}pyodide.mjs`
    )) as typeof import('pyodide');
    python = await loadPyodide({
      indexURL,
      jsglobals: {},
      stdin: () => null,
      stdout: () => {},
      stderr: () => {},
    });
    python.setStdout({ write: (buffer) => write('stdout', buffer) });
    python.setStderr({ write: (buffer) => write('stderr', buffer) });
    scope.postMessage({ type: 'ready' });
    python.runPython(code, { filename: '<代码>' });
    python.runPython('import sys; sys.stdout.flush(); sys.stderr.flush()');
    flush();
    scope.postMessage({ type: 'done' });
  } catch (error) {
    try {
      python?.runPython('import sys; sys.stdout.flush(); sys.stderr.flush()');
    } catch {
      /* Preserve the original exception. */
    }
    flush();
    scope.postMessage({
      type: 'done',
      error: (error instanceof Error ? error.message : String(error)).slice(0, 8000),
    });
  }
};
