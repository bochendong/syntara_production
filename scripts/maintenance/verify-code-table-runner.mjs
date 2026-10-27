#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const cache = new Map();

// Load the real server modules without Next.js, database access, or an LLM.
function loadSource(file) {
  let filename = resolve(root, file);
  if (!existsSync(filename) || !filename.endsWith('.ts')) {
    filename = existsSync(`${filename}.ts`) ? `${filename}.ts` : `${filename}/index.ts`;
  }
  if (cache.has(filename)) return cache.get(filename).exports;
  const loadedModule = { exports: {} };
  cache.set(filename, loadedModule);
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const localRequire = (specifier) => {
    if (specifier.startsWith('@/')) return loadSource(specifier.slice(2));
    if (specifier.startsWith('.')) return loadSource(resolve(dirname(filename), specifier));
    return require(specifier);
  };
  new Function('require', 'module', 'exports', compiled.outputText)(
    localRequire,
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const { runTableRows, runTableCellChecks } = loadSource('lib/server/notebook-problems/judge.ts');
const { codeSlotTemplateFor, assembleCodeFromSlots, extractSlotValues } = loadSource(
  'lib/problem-bank/code-slots.ts',
);
const template = codeSlotTemplateFor({
  starterCode: 'def f(x: int) -> int:\n    """Example."""\n    pass',
});
assert.ok(template);
const code = assembleCodeFromSlots(template.template, template.slots, { body: 'return x + 1' });
assert.deepEqual(extractSlotValues(template.template, template.slots, code), {
  body: 'return x + 1',
});
assert.equal(
  extractSlotValues(template.template, template.slots, code.replace('def f', 'def g')),
  null,
);
const rows = await runTableRows({
  rows: [
    { id: 'a', code: 'print(open("data.txt").read())' },
    { id: 'b', code: '2 + 3' },
  ],
  files: [{ path: 'data.txt', content: 'hello', role: 'input', visible: true }],
});
assert.equal(rows[0].stdout.trim(), 'hello');
assert.equal(rows[1].value, '5');
const verdicts = await runTableCellChecks({
  items: [{ key: 'x', matcher: 'python_value', answer: '5', accepted: ['5'] }],
});
assert.equal(verdicts.get('x'), true);
console.log('PASS slots, file input, table row execution, and cell grading');

const { verifyImportedTableDrafts } = loadSource('lib/server/notebook-problems/table-verify.ts');
const draft = {
  status: 'published',
  publicContent: { type: 'table', runnable: false, rows: [], columns: [] },
  grading: { type: 'table', cells: [] },
  validationErrors: [],
  sourceMeta: { tableVerification: { checkedBy: 'python-runner', corrected: 0 } },
};
const [unverified] = await verifyImportedTableDrafts([draft]);
assert.equal(unverified.status, 'draft');
assert.ok(unverified.validationErrors.some((message) => message.includes('核对未完成')));
assert.equal(unverified.sourceMeta.tableVerification, undefined);
console.log('PASS unavailable table verification stays in teacher review');

const { judgeNotebookCodeProblem } = loadSource('lib/server/notebook-problems/judge.ts');
const publicCode = `import unittest\nfrom submission import f\nclass Tests(unittest.TestCase):\n    def test_public(self): self.assertEqual(f(1), 2)\n`;
const secretCode = `import unittest\nfrom submission import f\nclass Tests(unittest.TestCase):\n    def test_secret(self): self.assertEqual(f(3), 4)\n`;
const problem = {
  id: 'fixture',
  type: 'code',
  points: 100,
  publicContent: {
    type: 'code',
    language: 'python',
    stem: 'Implement f',
    starterCode: template.template.replace('{{body}}', 'pass'),
    constraints: [],
    publicTests: [],
    publicTestCode: publicCode,
  },
  grading: { type: 'code' },
};
const secretJudge = { language: 'python', secretTests: [], secretTestCode: secretCode };
const run = await judgeNotebookCodeProblem({
  problem,
  secretJudge,
  kind: 'run',
  runTarget: 'public',
  userAnswer: { code },
  language: 'zh-CN',
});
assert.equal(run.status, 'passed', run.result.feedback);
const submitted = await judgeNotebookCodeProblem({
  problem,
  secretJudge,
  kind: 'submit',
  userAnswer: { code },
  language: 'zh-CN',
});
assert.equal(submitted.status, 'passed', submitted.result.feedback);
assert.equal(submitted.result.secretSummary.passed, 1);
const tampered = await judgeNotebookCodeProblem({
  problem,
  secretJudge,
  kind: 'submit',
  userAnswer: { code: code.replace('def f', 'def g') },
  language: 'zh-CN',
});
assert.equal(tampered.status, 'error');
console.log('PASS public and hidden code tests and locked header enforcement');

const stdinProblem = {
  ...problem,
  publicContent: {
    ...problem.publicContent,
    starterCode: 'def read():\n    pass',
    stdin: '42\n',
    files: [{ path: 'data.txt', content: 'item', role: 'input', visible: true }],
    publicTestCode: `import unittest\nfrom submission import read\nclass Tests(unittest.TestCase):\n    def test_a(self): self.assertEqual(read(), '42 item')\n    def test_b(self): self.assertEqual(read(), '42 item')\n`,
  },
};
const stdinSecret = {
  ...secretJudge,
  secretTestCode: `import unittest\nfrom submission import read\nclass Tests(unittest.TestCase):\n    def test_secret(self): self.assertEqual(read(), '42 item')\n`,
};
const inputResult = await judgeNotebookCodeProblem({
  problem: stdinProblem,
  secretJudge: stdinSecret,
  kind: 'submit',
  userAnswer: { code: "def read():\n    return input() + ' ' + open('data.txt').read()" },
  language: 'zh-CN',
});
assert.equal(inputResult.status, 'passed', inputResult.result.feedback);
assert.equal(inputResult.result.publicSummary.passed, 2);
console.log('PASS stdin and input file in both public and hidden tests');
