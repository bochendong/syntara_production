import type { PyodideInterface } from 'pyodide';

export type DebugWorkerMessage =
  | { type: 'ready' }
  | { type: 'output'; channel: 'stdout' | 'stderr'; text: string }
  | { type: 'done'; error?: string }
  | { type: 'output-limit' };

const scope = self as unknown as {
  onmessage: (
    event: MessageEvent<{
      code: string;
      indexURL: string;
      files?: Array<{ path: string; content: string }>;
      stdin?: string;
    }>,
  ) => void;
  postMessage: (message: DebugWorkerMessage) => void;
};
const MAX_OUTPUT_BYTES = 64 * 1024;

scope.onmessage = async ({ data: { code, indexURL, files = [], stdin = '' } }) => {
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
    // Each debug run owns a fresh virtual filesystem, never the host's files.
    python.FS.mkdirTree('/work');
    python.FS.chdir('/work');
    for (const file of files) {
      if (
        !file.path ||
        file.path.startsWith('/') ||
        file.path.includes('\\') ||
        file.path.split('/').some((part) => part === '..' || part === '.')
      ) {
        throw new Error('题目文件必须使用安全的相对路径。');
      }
      const folder = file.path.slice(0, file.path.lastIndexOf('/'));
      if (file.path.includes('/')) python.FS.mkdirTree(folder);
      python.FS.writeFile(file.path, file.content, { encoding: 'utf8' });
    }
    python.globals.set('_syntara_stdin', stdin);
    python.runPython('import sys, io; sys.stdin = io.StringIO(_syntara_stdin); del _syntara_stdin');
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
