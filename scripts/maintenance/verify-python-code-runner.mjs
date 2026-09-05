#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

const { judgeNotebookCodeProblem } = loadSource('lib/server/notebook-problems/judge.ts');
const { runQuizCodeSubmission } = loadSource('features/practice/server/code-runner.ts');
const problem = {
  id: 'python-runner-fixture',
  type: 'code',
  title: 'Add two numbers',
  points: 1,
  publicContent: {
    type: 'code',
    language: 'python',
    stem: 'Implement add(a, b).',
    starterCode: 'OFFSET = 0',
    constraints: [],
    publicTests: [{ id: 'positive', expression: 'add(1, 2)', expected: '3' }],
  },
  grading: { type: 'code', publishRequirementsMet: true },
};
const secretJudge = {
  language: 'python',
  timeoutMs: 5000,
  secretTests: [{ id: 'negative', expression: 'add(-2, 1)', expected: '-1' }],
};
const judge = (code, options = {}) =>
  judgeNotebookCodeProblem({
    problem,
    secretJudge,
    kind: 'run',
    runTarget: 'code',
    language: 'zh-CN',
    userAnswer: { code },
    ...options,
  });

const originalEnv = { ...process.env };
const nativePython = process.env.PYTHON_EXECUTABLE || 'python3';
const hasNativePython = spawnSync(nativePython, ['--version']).status === 0;
let checks = 0;
async function check(name, run) {
  await run();
  checks += 1;
  console.log(`PASS ${name}`);
}

try {
  process.env.VERCEL = '1';
  process.env.PATH = '/nonexistent-python-runner-test';
  process.env.PYTHON_EXECUTABLE = '/nonexistent-python-runner-test/python3';

  await check('Vercel runs scripts and the standard library without system Python', async () => {
    const result = await judge('import math\nprint("你好", math.isqrt(81))');
    assert.equal(result.status, 'passed', result.result.feedback);
    assert.equal(result.result.stdout, '你好 9\n');
  });
  await check('public tests preserve starter code and captured output', async () => {
    const result = await judge(
      'print("module output")\ndef add(a, b):\n    print("case output")\n    return a + b + OFFSET',
      { runTarget: 'public' },
    );
    assert.equal(result.status, 'passed', result.result.feedback);
    assert.equal(result.result.publicCases[0].actual, '3');
    assert.equal(result.result.publicCases[0].stdout, 'case output\n');
  });
  await check('secret tests run and submission grading remains server-side', async () => {
    const code = 'def add(a, b):\n    return a + b';
    const secret = await judge(code, { runTarget: 'secret' });
    assert.equal(secret.status, 'passed', secret.result.feedback);
    assert.equal(secret.result.secretSummary.passed, 1);
    const submission = await judge(code, { kind: 'submit' });
    assert.equal(submission.status, 'passed', submission.result.feedback);
    assert.equal(submission.score, 1);
    assert.equal(submission.result.publicSummary.passed, 1);
    assert.equal(submission.result.secretSummary.passed, 1);
  });
  await check('incorrect code fails its test', async () => {
    const result = await judge('def add(a, b):\n    return 0', { runTarget: 'public' });
    assert.equal(result.status, 'failed');
    assert.equal(result.result.publicCases[0].actual, '0');
  });
  await check('syntax errors and exceptions retain Python diagnostics', async () => {
    const syntax = await judge('def broken(');
    assert.equal(syntax.status, 'error');
    assert.match(syntax.result.error, /SyntaxError/);
    const error = await judge('raise ValueError("bad value")', { runTarget: 'public' });
    assert.equal(error.status, 'failed');
    assert.match(error.result.publicCases[0].error, /ValueError: bad value/);
  });
  await check('infinite loops are terminated after runtime initialization', async () => {
    const started = Date.now();
    const result = await judge('while True:\n    pass', {
      secretJudge: { ...secretJudge, timeoutMs: 100 },
    });
    assert.equal(result.status, 'error');
    assert.match(result.result.feedback, /timed out/);
    assert.ok(Date.now() - started < 15_000, 'timeout must terminate the worker');
  });
  await check('classroom quiz uses the same fallback and accepts top-level print', async () => {
    const report = await runQuizCodeSubmission({
      questionId: 'quiz-fixture',
      userCode: 'print("hello")\ndef add(a, b):\n    return a + b',
      testCases: problem.publicContent.publicTests,
    });
    assert.equal(report.passedCount, 1);
    assert.equal(report.totalCount, 1);
  });
  await check('concurrent runs keep separate Python state', async () => {
    const results = await Promise.all([
      judge('value = 1\nprint(value)'),
      judge('print("value" in globals())'),
    ]);
    assert.deepEqual(
      results.map((result) => result.result.stdout),
      ['1\n', 'False\n'],
    );
  });
  await check('ENOENT outside Vercel automatically falls back', async () => {
    delete process.env.VERCEL;
    const result = await judge('print(42)');
    assert.equal(result.status, 'passed', result.result.feedback);
    assert.equal(result.result.stdout, '42\n');
  });
  if (hasNativePython) {
    await check('native Python still runs with a configured executable', async () => {
      process.env.PATH = originalEnv.PATH;
      process.env.PYTHON_EXECUTABLE = nativePython;
      const result = await judge('print(42)');
      assert.equal(result.status, 'passed', result.result.feedback);
      assert.equal(result.result.stdout, '42\n');
    });
  }
} finally {
  for (const name of ['VERCEL', 'PATH', 'PYTHON_EXECUTABLE']) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
}

console.log(`Python code runner: ${checks} behavior checks passed.`);
