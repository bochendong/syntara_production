'use client';

/**
 * 在浏览器里跑 Python（Pyodide 0.29.3，和服务器判分同一个版本）。
 * 只给「自己试」和表格题的逐行运行用；提交判分仍在服务器跑隐藏测试。
 * 每次运行一个新的 Worker：超时直接 terminate，死循环也停得下来。
 */

const PYODIDE_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.29.3/full/';
const DEFAULT_TIMEOUT_MS = 5000;
const LOAD_TIMEOUT_MS = 60_000;

export type BrowserPythonFile = { path: string; content: string };

export type BrowserScriptResult = {
  stdout: string;
  error: string | null;
  files: BrowserPythonFile[];
};

export type BrowserRowResult = {
  id: string;
  stdout: string;
  value: string | null;
  errorType: string | null;
};

const RUNNER = String.raw`
import sys, io, os, json, contextlib, traceback, runpy

def write_files(files):
    written = {}
    for item in files or []:
        rel = os.path.normpath(item["path"])
        if rel.startswith("..") or os.path.isabs(rel):
            continue
        folder = os.path.dirname(rel)
        if folder:
            os.makedirs(folder, exist_ok=True)
        with open(rel, "w", encoding="utf-8") as handle:
            handle.write(item["content"])
        written[rel] = item["content"]
    return written

def collect_files(written):
    changed = []
    for root, dirs, names in os.walk("."):
        dirs[:] = [name for name in dirs if name != "__pycache__"]
        for name in names:
            rel = os.path.normpath(os.path.join(root, name))
            if rel == "main.py":
                continue
            try:
                with open(rel, encoding="utf-8") as handle:
                    content = handle.read()
            except Exception:
                continue
            if written.get(rel) != content:
                changed.append({"path": rel, "content": content[:200000]})
    return changed[:8]

def run(payload):
    import shutil
    os.chdir("/")
    shutil.rmtree("/work", ignore_errors=True)
    os.makedirs("/work", exist_ok=True)
    os.chdir("/work")
    if payload["mode"] == "rows":
        rows = []
        for item in payload["rows"]:
            write_files(payload.get("files"))
            namespace = {"__name__": "__main__"}
            capture = io.StringIO()
            error_type = None
            value = None
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    if payload.get("setup"):
                        exec(payload["setup"], namespace)
                with contextlib.redirect_stdout(capture):
                    try:
                        compiled = compile(item["code"], "<row>", "eval")
                    except SyntaxError:
                        compiled = None
                    if compiled is not None:
                        value = repr(eval(compiled, namespace))
                    else:
                        exec(compile(item["code"], "<row>", "exec"), namespace)
            except BaseException as exc:
                error_type = type(exc).__name__
                value = None
            rows.append({"id": item["id"], "stdout": capture.getvalue()[:8000], "value": value, "errorType": error_type})
        return {"rows": rows}
    written = write_files(payload.get("files"))
    with open("main.py", "w", encoding="utf-8") as handle:
        handle.write(payload["code"])
    sys.stdin = io.StringIO(payload.get("stdin") or "")
    capture = io.StringIO()
    error = None
    try:
        with contextlib.redirect_stdout(capture), contextlib.redirect_stderr(capture):
            runpy.run_path("main.py", run_name="__main__")
    except BaseException as exc:
        error = "".join(traceback.format_exception_only(type(exc), exc)).strip()
    return {"stdout": capture.getvalue()[:100000], "error": error, "files": collect_files(written)}

result = json.dumps(run(json.loads(_payload_json)), ensure_ascii=False)
result
`;

const WORKER_SOURCE = `
let ready = null;
self.onmessage = async (event) => {
  const { id, indexURL, runner, payload } = event.data;
  try {
    if (!ready) {
      importScripts(indexURL + 'pyodide.js');
      ready = loadPyodide({ indexURL, jsglobals: {} });
    }
    const pyodide = await ready;
    self.postMessage({ id, type: 'ready' });
    pyodide.globals.set('_payload_json', JSON.stringify(payload));
    const output = pyodide.runPython(runner);
    self.postMessage({ id, type: 'result', output });
  } catch (error) {
    ready = null;
    self.postMessage({ id, type: 'error', message: String((error && error.message) || error) });
  }
};
`;

let workerUrl: string | null = null;
let sharedWorker: Worker | null = null;
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;
let warmed = false;

/** 已经加载过 Pyodide（第一次要下载约 10MB，之后走浏览器缓存、复用同一个 Worker）。 */
export function browserPythonWarm(): boolean {
  return warmed;
}

function getWorker(): Worker {
  if (!workerUrl) {
    workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
  }
  if (!sharedWorker) sharedWorker = new Worker(workerUrl);
  return sharedWorker;
}

function killWorker() {
  sharedWorker?.terminate();
  sharedWorker = null;
  warmed = false;
}

function runOnce<T>(payload: Record<string, unknown>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = getWorker();
    const id = ++nextId;
    let settled = false;
    let timer = setTimeout(() => {
      killWorker();
      finish(new Error('Python 环境加载超时，请检查网络后重试。'));
    }, LOAD_TIMEOUT_MS);
    function finish(error: Error | null, value?: T) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      if (error) reject(error);
      else resolve(value as T);
    }
    function onMessage(event: MessageEvent) {
      const message = event.data as { id: number; type: string; output?: string; message?: string };
      if (message.id !== id) return;
      if (message.type === 'ready') {
        warmed = true;
        clearTimeout(timer);
        // 死循环只能整个停掉 Worker，下次运行重新加载
        timer = setTimeout(() => {
          killWorker();
          finish(new Error(`运行超过 ${Math.round(timeoutMs / 1000)} 秒，可能是死循环。`));
        }, timeoutMs);
      } else if (message.type === 'result') {
        try {
          finish(null, JSON.parse(message.output ?? '{}') as T);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      } else if (message.type === 'error') {
        finish(new Error(message.message || 'Python error'));
      }
    }
    function onError(event: ErrorEvent) {
      killWorker();
      finish(new Error(event.message || 'Python worker error'));
    }
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ id, indexURL: PYODIDE_INDEX_URL, runner: RUNNER, payload });
  });
}

/** 一次只跑一个，避免同一个解释器里状态互相串。 */
function runInWorker<T>(payload: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const run = queue.then(
    () => runOnce<T>(payload, timeoutMs),
    () => runOnce<T>(payload, timeoutMs),
  );
  queue = run.catch(() => undefined);
  return run;
}

/** 跑一整段代码：带题目文件和 stdin，返回 print 输出、报错和程序写出的文件。 */
export function runPythonScriptInBrowser(args: {
  code: string;
  files?: BrowserPythonFile[];
  stdin?: string;
  timeoutMs?: number;
}): Promise<BrowserScriptResult> {
  return runInWorker<BrowserScriptResult>(
    { mode: 'script', code: args.code, files: args.files ?? [], stdin: args.stdin ?? '' },
    args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
}

/** 表格题逐行运行：每行一个新命名空间，先跑 setup。 */
export async function runPythonRowsInBrowser(args: {
  rows: Array<{ id: string; code: string }>;
  setup?: string;
  files?: BrowserPythonFile[];
  timeoutMs?: number;
}): Promise<BrowserRowResult[]> {
  const result = await runInWorker<{ rows?: BrowserRowResult[] }>(
    { mode: 'rows', rows: args.rows, setup: args.setup ?? '', files: args.files ?? [] },
    args.timeoutMs ?? DEFAULT_TIMEOUT_MS + args.rows.length * 300,
  );
  return result.rows ?? [];
}
