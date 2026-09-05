import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';

const MAX_OUTPUT_BYTES = 1024 * 1024;
const RUNTIME_START_TIMEOUT_MS = 30_000;

type PythonRunInput = {
  runnerPath: string;
  payload: { codePath: string };
  timeoutMs: number;
};

// Each fallback run owns a fresh interpreter and virtual filesystem. Keep the
// synchronous Python evaluation off the request thread so even an infinite loop
// can be stopped by terminating the worker.
const PYODIDE_WORKER = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { createRequire } = require('node:module');
const path = require('node:path');
// Resolve inside the unbundled worker. Webpack rewrites even createRequire().resolve()
// in the request bundle to a numeric module ID, which Node cannot require.
const modulePath = createRequire(path.join(workerData.cwd, 'package.json')).resolve('pyodide');
const { loadPyodide } = require(modulePath);

async function main() {
  let stdout = '';
  let stderr = '';
  const capture = (stream, line) => {
    if (stream === 'stdout') stdout += line + '\n';
    else stderr += line + '\n';
    if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > workerData.maxOutputBytes) {
      throw new Error('Python runner output exceeded 1 MiB');
    }
  };
  const python = await loadPyodide({
    indexURL: path.dirname(modulePath),
    jsglobals: {},
    stdin: () => null,
    stdout: (line) => capture('stdout', line),
    stderr: (line) => capture('stderr', line),
  });
  // Copy only the submission; never mount the host filesystem into Python.
  python.FS.mkdirTree(path.dirname(workerData.codePath));
  python.FS.writeFile(workerData.codePath, workerData.code);
  python.globals.set('_runner_args_json', JSON.stringify([
    workerData.runnerPath,
    workerData.payload,
  ]));
  python.runPython('import sys, json\nsys.argv = json.loads(_runner_args_json)\ndel _runner_args_json');
  stdout = '';
  stderr = '';
  parentPort.postMessage({ type: 'ready' });
  python.runPython(workerData.runner);
  parentPort.postMessage({ type: 'result', stdout });
}

main().catch((error) => {
  parentPort.postMessage({ type: 'error', message: error.message || String(error) });
});
`;

async function runBundledPython(input: PythonRunInput): Promise<string> {
  const [runner, code] = await Promise.all([
    readFile(input.runnerPath, 'utf8'),
    readFile(input.payload.codePath, 'utf8'),
  ]);
  return new Promise((resolve, reject) => {
    const worker = new Worker(PYODIDE_WORKER, {
      eval: true,
      // Do not inherit application credentials or Node preload hooks.
      env: {},
      execArgv: [],
      workerData: {
        cwd: process.cwd(),
        runner,
        code,
        codePath: input.payload.codePath,
        runnerPath: input.runnerPath,
        payload: JSON.stringify(input.payload),
        maxOutputBytes: MAX_OUTPUT_BYTES,
      },
    });
    let settled = false;
    let timer = setTimeout(
      () => finish(new Error('Python runtime initialization timed out')),
      RUNTIME_START_TIMEOUT_MS,
    );

    function finish(error?: Error, stdout = '') {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().then(() => (error ? reject(error) : resolve(stdout)), reject);
    }

    worker.on('message', (message) => {
      if (settled) return;
      if (message.type === 'ready') {
        clearTimeout(timer);
        timer = setTimeout(() => finish(new Error('Python runner timed out')), input.timeoutMs);
      } else if (message.type === 'result') {
        finish(undefined, message.stdout);
      } else if (message.type === 'error') {
        finish(new Error(message.message));
      }
    });
    worker.on('error', (error) => finish(error));
    worker.on('exit', (code) => {
      if (!settled) finish(new Error(`Python worker exited before returning a result (${code})`));
    });
  });
}

function runNativePython(input: PythonRunInput): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.env.PYTHON_EXECUTABLE?.trim() || 'python3',
      [input.runnerPath, JSON.stringify(input.payload)],
      {
        timeout: input.timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error) {
          if (error.killed) reject(new Error('Python runner timed out'));
          else if (error.code === 'ENOENT') reject(error);
          else reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      },
    );
    child.stdin?.end();
  });
}

/** Vercel's Node runtime does not provide python3. Bundle the interpreter and
 * standard library so judging needs neither a system install nor a CDN fetch. */
export async function runPythonJson<T>(input: PythonRunInput): Promise<T> {
  let stdout: string;
  if (process.env.VERCEL === '1') {
    stdout = await runBundledPython(input);
  } else {
    try {
      stdout = await runNativePython(input);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      stdout = await runBundledPython(input);
    }
  }
  return JSON.parse(stdout) as T;
}
