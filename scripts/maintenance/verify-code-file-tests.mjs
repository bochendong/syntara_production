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
const mocks = new Map();

function loadSource(file) {
  let filename = resolve(root, file);
  if (!existsSync(filename) || !filename.endsWith('.ts')) {
    filename = existsSync(`${filename}.ts`) ? `${filename}.ts` : `${filename}/index.ts`;
  }
  if (cache.has(filename)) return cache.get(filename).exports;
  const loaded = { exports: {} };
  cache.set(filename, loaded);
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const localRequire = (specifier) => {
    if (mocks.has(specifier)) return mocks.get(specifier);
    if (specifier.startsWith('@/')) return loadSource(specifier.slice(2));
    if (specifier.startsWith('.')) return loadSource(resolve(dirname(filename), specifier));
    return require(specifier);
  };
  new Function('require', 'module', 'exports', compiled.outputText)(
    localRequire,
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const { judgeNotebookCodeProblem, verifyNotebookCodeDraftReferenceAnswer } = loadSource(
  'lib/server/notebook-problems/judge.ts',
);
const { LOCAL_DEMO_CODE_FIXTURES } = loadSource('lib/teacher/local-demo-code-fixtures.ts');
const { notebookProblemImportDraftSchema } = loadSource('lib/problem-bank/schema.ts');
const { problemDraftToPatch } = loadSource('lib/problem-bank/editor.ts');
const makeProblem = (fixture) => ({
  id: fixture.slug,
  type: 'code',
  title: fixture.title,
  points: 100,
  publicContent: {
    type: 'code',
    language: 'python',
    stem: fixture.stem,
    starterCode: fixture.starterCode,
    publicTestCode: fixture.publicTestCode,
    publicTests: [],
  },
  grading: { type: 'code', solutionCode: fixture.solutionCode },
});
for (const fixture of LOCAL_DEMO_CODE_FIXTURES) {
  const problem = makeProblem(fixture);
  const secretJudge = {
    language: 'python',
    secretTests: [],
    secretTestCode: fixture.secretTestCode,
    timeoutMs: 5000,
  };
  const run = (code, extra = {}) =>
    judgeNotebookCodeProblem({
      problem,
      secretJudge,
      userAnswer: { code },
      kind: 'submit',
      ...extra,
    });
  const good = await run(fixture.solutionCode);
  assert.equal(good.status, 'passed', JSON.stringify(good));
  assert.equal(good.result.publicSummary.total, 2);
  assert.equal(good.result.secretSummary.total, 3);
  assert.equal(
    good.result.caseResults?.some((row) => row.id.includes('ranges')),
    undefined,
  );
  assert(!JSON.stringify(good.result).includes('test_ranges'));
  const empty = await run(fixture.starterCode);
  assert.notEqual(empty.status, 'passed');
  const draft = notebookProblemImportDraftSchema.parse({
    draftId: fixture.slug,
    title: fixture.title,
    type: 'code',
    source: 'manual',
    publicContent: {
      ...problem.publicContent,
      statementSections: ['overview', 'requirements', 'interface', 'examples', 'constraints'].map(
        (kind) => ({ id: kind, kind, title: kind, body: fixture.stem }),
      ),
    },
    grading: problem.grading,
    secretJudge,
  });
  assert.equal(problemDraftToPatch(draft).secretJudge.secretTestCode, fixture.secretTestCode);
  const verified = await verifyNotebookCodeDraftReferenceAnswer(draft);
  assert.equal(verified.passed, true, JSON.stringify(verified));
  console.log(
    'PASS reference, starter rejection, schema/patch roundtrip, hidden redaction:',
    fixture.slug,
  );
  if (fixture.slug === 'regex-dates') {
    const wrong = fixture.solutionCode.replace(
      '(?<!\\d)(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])(?!\\d)',
      '(\\d{4})-(\\d{2})-(\\d{2})',
    );
    assert.notEqual(wrong, fixture.solutionCode);
    const bad = await run(wrong);
    assert.notEqual(bad.status, 'passed');
    assert.equal(bad.result.publicSummary.failed, 0);
    assert(bad.result.secretSummary.failed > 0);
    console.log('PASS loose date regex rejected by hidden tests');
  }
  for (const testCode of [
    '',
    'invalid python !',
    'import unittest\nclass Tests(unittest.TestCase):\n    @unittest.skip("skip")\n    def test_skip(self): pass',
    'import unittest\nclass Tests(unittest.TestCase):\n    def test_sub(self):\n        with self.subTest(x=1): self.assertEqual(1, 2)',
    'import unittest\nclass Tests(unittest.TestCase):\n    @classmethod\n    def setUpClass(cls): raise RuntimeError("fixture failure")\n    def test_one(self): pass',
  ]) {
    const result = await run(fixture.solutionCode, {
      kind: 'run',
      problem: {
        ...problem,
        publicContent: { ...problem.publicContent, publicTestCode: testCode },
      },
    });
    assert.notEqual(result.status, 'passed', testCode);
  }
  console.log('PASS empty, syntax, skip, subtest and fixture failures');
}

const fixture = LOCAL_DEMO_CODE_FIXTURES[0];
const base = makeProblem(fixture);
const runPublic = (code, testCode, timeoutMs = 5000) =>
  judgeNotebookCodeProblem({
    problem: { ...base, publicContent: { ...base.publicContent, publicTestCode: testCode } },
    secretJudge: { language: 'python', timeoutMs, secretTests: [] },
    userAnswer: { code },
    kind: 'run',
  });
const timeout = await runPublic('while True: pass', fixture.publicTestCode, 100);
assert.equal(timeout.status, 'error');
assert.match(timeout.result.feedback, /timed out/);
console.log('PASS infinite submission is terminated');
const { buildCodeTestFile } = loadSource('lib/problem-bank/code-test-files.ts');
const legacyFile = buildCodeTestFile(
  [
    { id: 'same-name', expression: 'double(2)', expected: '4' },
    { id: 'same_name', expression: 'double(0)', expected: '0' },
  ],
  'public_tests.py',
  'PublicTests',
);
const migrated = await runPublic('def double(x): return x * 2', legacyFile);
assert.equal(migrated.status, 'passed', JSON.stringify(migrated));
assert.equal(migrated.result.publicSummary.total, 2);
console.log('PASS legacy conversion retains both tests after identifier normalization');
console.log('All code-file checks passed');
