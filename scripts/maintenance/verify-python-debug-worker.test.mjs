import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import test, { after } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(resolve(root, 'apps/native/src/data/python-debug.worker.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const temporary = mkdtempSync(resolve(tmpdir(), 'syntara-debug-worker-'));
const modulePath = resolve(temporary, 'worker.mjs');
writeFileSync(modulePath, compiled);
const moduleURL = pathToFileURL(modulePath).href;
const indexURL = `${dirname(require.resolve('pyodide/package.json'))}/`;
after(() => rmSync(temporary, { recursive: true, force: true }));

// Execute the browser worker's real code and installed Python runtime. Only the
// worker message bridge is adapted to Node; submitted code sees no host globals.
function execute(code) {
  return new Promise((resolveResult, reject) => {
    const worker = new Worker(
      `
      const {parentPort} = require('node:worker_threads');
      globalThis.self = {postMessage: message => parentPort.postMessage(message)};
      import(${JSON.stringify(moduleURL)}).then(() => {
        parentPort.on('message', data => self.onmessage({data}));
      });
    `,
      { eval: true, env: {}, execArgv: [] },
    );
    const messages = [];
    let settled = false;
    let timer = setTimeout(() => finish(new Error('runtime initialization timed out')), 30_000);
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker
        .terminate()
        .then(() => (error ? reject(error) : resolveResult({ messages, ...result })));
    }
    worker.on('message', (message) => {
      messages.push(message);
      if (message.type === 'ready') {
        clearTimeout(timer);
        timer = setTimeout(() => finish(undefined, { timedOut: true }), 1500);
      }
      if (message.type === 'done' || message.type === 'output-limit') finish(undefined, message);
    });
    worker.on('error', (error) => finish(error));
    worker.postMessage({ code, indexURL });
  });
}

const output = (result, channel = 'stdout') =>
  result.messages
    .filter((message) => message.type === 'output' && message.channel === channel)
    .map((message) => message.text)
    .join('');

test('print captures Unicode, numbers and a final partial line', async () => {
  const result = await execute('print("你好", 2 + 3)\nprint("done", end="!")');
  assert.equal(result.error, undefined);
  assert.equal(output(result), '你好 5\ndone!');
});

test('stdout and stderr survive a Python exception with its traceback', async () => {
  const result = await execute(
    'import sys\nprint("before")\nprint("stderr", file=sys.stderr)\nraise ValueError("example")',
  );
  assert.equal(output(result), 'before\n');
  assert.equal(output(result, 'stderr'), 'stderr\n');
  assert.match(result.error, /ValueError: example/);
});

test('normal Python modules and the main entry point work', async () => {
  const result = await execute(
    'import math\nif __name__ == "__main__":\n    print(math.isqrt(81))',
  );
  assert.equal(output(result), '9\n');
});

test('output is capped before an unbounded print loop can flood the UI', async () => {
  const result = await execute('while True:\n    print("x" * 1024)');
  assert.equal(result.type, 'output-limit');
  assert(Buffer.byteLength(output(result)) <= 64 * 1024);
});

test('a worker stuck in Python can be terminated and the next run succeeds', async () => {
  const stuck = await execute('while True:\n    pass');
  assert.equal(stuck.timedOut, true);
  const next = await execute('print("recovered")');
  assert.equal(output(next), 'recovered\n');
});

test('runs have fresh Python globals and input fails instead of hanging', async () => {
  await execute('secret = 42');
  const fresh = await execute('print("secret" in globals())');
  assert.equal(output(fresh), 'False\n');
  const input = await execute('input("name: ")');
  assert.match(input.error, /EOFError/);
});
