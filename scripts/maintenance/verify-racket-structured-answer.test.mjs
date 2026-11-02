import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { racketTableAnswerSource, parseRacketTableAnswer, checkRacketTemplate, readRacketForms } =
  await jiti.import('../../lib/problem-bank/racket-answer.ts');
const { gradeNativeTable } = await jiti.import('../../apps/native/src/data/table-grading.ts');
const { problems } = JSON.parse(
  readFileSync(
    new URL('../../apps/native/src/qa/cpsc110-staging-data.json', import.meta.url),
    'utf8',
  ),
);

test('all 46 structured tables accept reference code and reject wrong, incomplete and malformed answers', async () => {
  const tables = problems.filter((p) => p.type === 'table');
  assert.equal(tables.length, 46);
  for (const p of tables) {
    const c = p.publicContent,
      spec = c.racketAnswer;
    assert(spec, p.id);
    const expected = Object.fromEntries(
      p.grading.cells.map((cell) => [`${cell.rowId}:${cell.colId}`, cell.acceptedAnswers[0]]),
    );
    const code = racketTableAnswerSource(c, spec, expected);
    const parsed = parseRacketTableAnswer(c, spec, code);
    assert.equal(parsed.missing, 0, p.id);
    assert.equal((await gradeNativeTable(c, p.grading, parsed.cells)).status, 'passed', p.id);
    const wrong = Object.fromEntries(
      p.grading.cells.map((cell) => [
        `${cell.rowId}:${cell.colId}`,
        spec.mode === 'signatures'
          ? '(@signature Wrong -> Wrong)'
          : spec.mode === 'expressions'
            ? '(wrong-answer)'
            : 'deliberately wrong',
      ]),
    );
    const wrongParsed = parseRacketTableAnswer(c, spec, racketTableAnswerSource(c, spec, wrong));
    assert.notEqual(
      (await gradeNativeTable(c, p.grading, wrongParsed.cells)).status,
      'passed',
      p.id,
    );
    assert.notEqual((await gradeNativeTable(c, p.grading, {})).status, 'passed', p.id);
    assert.throws(() => parseRacketTableAnswer(c, spec, code + '\n('), undefined, p.id);
  }
});

test('constants require unique known names, valid strings and well-formed expressions', () => {
  const p = problems.find((p) => p.publicContent.racketAnswer?.mode === 'constants');
  const c = p.publicContent,
    s = c.racketAnswer;
  const starter = racketTableAnswerSource(c, s);
  const name = starter.match(/\(define ([^ ]+)/)[1];
  assert.throws(
    () => parseRacketTableAnswer(c, s, `(define ${name} true)\n(define ${name} false)`),
    /重复/,
  );
  assert.throws(() => parseRacketTableAnswer(c, s, '(define unknown true)'), /没有需要填写/);
  assert.throws(() => parseRacketTableAnswer(c, s, `(define ${name} unbound)`), /双引号/);
  assert.throws(() => readRacketForms('([)]'), /括号/);
  assert.throws(() => readRacketForms('"unterminated'), /引号/);
  assert.equal(readRacketForms('#| ignore ( #| nested |# ) |#\n(define A ";") ; )').length, 1);
});

test('Waldo template checks catch missing guards, wrong rules, missing fields and wrong recursion', () => {
  const p = problems.find((p) => p.publicContent.racketAnswer?.mode === 'template'),
    spec = p.publicContent.racketAnswer,
    reference = p.grading.referenceAnswer;
  const pass = (code) => checkRacketTemplate(code, reference, spec).every((c) => c.passed);
  assert(pass(reference));
  assert(
    pass(
      reference.replaceAll(' w', ' student').replace('(fn-for-waldo w)', '(fn-for-waldo student)'),
    ),
  );
  assert(
    pass(reference.replace('[(string? w) (...)]', '[(and (string? w) (string=? w "floo")) (...)]')),
  );
  assert(!pass(reference.replace('(and (string? w) (string=? w "fee"))', '(string=? w "fee")')));
  assert(!pass(reference.replace('(fie-a w)', 'w')));
  assert(!pass(reference.replace('(fn-for-waldo (foe-d w))', '(foe-d w)')));
  assert(!pass(reference.replace('self-ref', 'ref')));
  assert(!pass(spec.starterCode));
  assert(!pass(reference.replace('(fie? w)', '(made-up-predicate? w)')));
  assert(!pass(reference + '\n(display missing-variable)'));
});
