import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A local interpreter test is insufficient: Vercel only ships traced files.
// Fail the release build if any judging function loses its bundled runtime.
const routes = [
  'quiz-code-run',
  ...['courses', 'notebooks'].flatMap((scope) =>
    ['run', 'submit'].map((action) => `${scope}/[id]/problems/[problemId]/attempts/${action}`),
  ),
];
const runtimeFiles = [
  'package.json',
  'pyodide.js',
  'pyodide.asm.js',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];
for (const route of routes) {
  const trace = JSON.parse(readFileSync(`.next/server/app/api/${route}/route.js.nft.json`, 'utf8'));
  for (const file of runtimeFiles) {
    assert.ok(
      trace.files.some((path) => path.endsWith(`/pyodide/${file}`)),
      `${route} is missing Python runtime asset ${file}; refusing an incomplete release`,
    );
  }
}
console.log(
  `PASS: all ${routes.length} Python judging functions include the interpreter and standard library.`,
);
