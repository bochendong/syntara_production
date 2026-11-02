import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function loadSource(path, mocks = {}) {
  const source = ts.transpileModule(
    readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replaceAll(
      'import.meta.env.DEV',
      'false',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', source)(
    (id) => mocks[id] ?? (id.startsWith('react') ? require(id) : {}),
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}
const history = loadSource('apps/native/src/data/problem-attempt-history.ts');

test('mistakes exclude pending grades and correct-but-incomplete multipart attempts', () => {
  const check = (status, parts) =>
    history.problemAttemptHasMistake({ status, result: parts ? { parts } : null });
  assert.equal(check('failed'), true);
  assert.equal(check('partial'), true);
  assert.equal(check('passed'), false);
  assert.equal(check('pending'), false);
  assert.equal(check('partial', [{ status: 'passed' }, { status: 'pending' }]), false);
  assert.equal(check('partial', [{ status: 'passed' }, { status: 'failed' }]), true);
  assert.equal(check('partial', [{ status: 'partial' }, { status: 'pending' }]), true);
});

test('SQLite preserves a past mistake after passing, scoped to the requested course', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(`
      CREATE TABLE problems (id TEXT, course_id TEXT);
      CREATE TABLE problem_progress (problem_id TEXT, status TEXT, updated_at INTEGER, last_attempt_at INTEGER);
      CREATE TABLE problem_attempts (problem_id TEXT, status TEXT, result_json TEXT);
      INSERT INTO problems VALUES ('recovered', 'a'), ('clean', 'a'), ('incomplete', 'a'), ('other', 'b');
      INSERT INTO problem_progress VALUES ('recovered', 'passed', 2, 2), ('clean', 'passed', 2, 2), ('incomplete', 'passed', 2, 2), ('other', 'passed', 2, 2);
      INSERT INTO problem_attempts VALUES ('recovered', 'failed', NULL), ('recovered', 'passed', NULL), ('clean', 'pending', NULL), ('clean', 'passed', NULL), ('incomplete', 'partial', '{"parts":[{"status":"passed"},{"status":"pending"}]}'), ('incomplete', 'passed', NULL), ('other', 'failed', NULL);
    `);
    const { SqliteLocalRepository } = loadSource('apps/native/src/data/sqlite-repository.ts', {
      './problem-attempt-history': history,
    });
    const repository = Object.create(SqliteLocalRepository.prototype);
    repository.database = async () => ({
      select: async (sql, params) =>
        database
          .prepare(sql)
          .all(Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value]))),
    });
    const progress = await repository.listProblemProgress('a');
    assert.equal(progress.length, 3);
    assert.equal(progress.find((item) => item.problemId === 'recovered').hasIncorrectAttempt, true);
    assert.equal(progress.find((item) => item.problemId === 'recovered').status, 'passed');
    assert.equal(progress.find((item) => item.problemId === 'clean').hasIncorrectAttempt, false);
    assert.equal(
      progress.find((item) => item.problemId === 'incomplete').hasIncorrectAttempt,
      false,
    );
  } finally {
    database.close();
  }
});

test('browser progress reads historical failures without marking other courses or pending work', async () => {
  const { BrowserLocalRepository } = loadSource('apps/native/src/data/browser-repository.ts', {
    dexie: { default: class {} },
    './problem-attempt-history': history,
  });
  const repository = Object.create(BrowserLocalRepository.prototype);
  const table = (rows) => ({
    where: (field) => ({
      equals: (value) => ({ toArray: async () => rows.filter((row) => row[field] === value) }),
      anyOf: (ids) => ({
        toArray: async () => rows.filter((row) => ids.includes(row[field])),
        each: async (visit) => rows.filter((row) => ids.includes(row[field])).forEach(visit),
      }),
    }),
  });
  repository.database = {
    problems: table([
      { id: 'a', courseId: 'course' },
      { id: 'b', courseId: 'course' },
      { id: 'c', courseId: 'other' },
    ]),
    problemProgress: table(['a', 'b', 'c'].map((problemId) => ({ problemId, status: 'passed' }))),
    problemAttempts: table([
      { problemId: 'a', status: 'failed', result: null },
      { problemId: 'a', status: 'passed', result: null },
      { problemId: 'b', status: 'pending', result: null },
      { problemId: 'b', status: 'passed', result: null },
      { problemId: 'c', status: 'failed', result: null },
    ]),
  };
  const progress = await repository.listProblemProgress('course');
  assert.equal(progress.length, 2);
  assert.equal(progress.find((item) => item.problemId === 'a').hasIncorrectAttempt, true);
  assert.equal(progress.find((item) => item.problemId === 'a').status, 'passed');
  assert.equal(progress.find((item) => item.problemId === 'b').hasIncorrectAttempt, false);
  assert.deepEqual(await repository.listProblemProgress('empty'), []);
});

test('the passed ball becomes purple only with mistake history and stays counted as passed', () => {
  const { SheetCell } = loadSource('apps/native/src/components/problem-bank/answer-sheet.tsx', {
    '../../lib/learning-action-marbles': {
      marbleImages: { green: '/green.webp', purple: '/purple.webp', pink: '/pink.webp' },
    },
  });
  const render = (status, previouslyIncorrect) =>
    renderToStaticMarkup(SheetCell({ number: 5, status, previouslyIncorrect, onClick() {} }));
  const recovered = render('passed', true);
  assert.match(recovered, /purple\.webp/);
  assert.match(recovered, /曾经做错过，现已通过/);
  assert.match(recovered, /is-passed/);
  assert.match(render('passed', false), /green\.webp/);
  assert.match(render('failed', true), /pink\.webp/);
});
