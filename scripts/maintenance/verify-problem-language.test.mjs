import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const i18n = url(compile(read('lib/problem-bank/i18n.ts')));
const source = compile(read('apps/native/src/lib/problem-language.ts')).replaceAll(
  "'../../../../lib/problem-bank/i18n'",
  `'${i18n}'`,
);
const { hasBilingualProblem, localizeProblem } = await import(url(source));
const { gradeLocalProblem, problemOptions } = await import(
  url(compile(read('apps/native/src/data/local-problem-grading.ts')))
);

const problem = {
  id: 'one-question',
  courseId: 'course',
  notebookId: null,
  type: 'choice',
  title: 'Sets',
  publicContent: {
    type: 'choice',
    stem: 'Which is a set?',
    options: [
      { id: 'A', label: 'A set' },
      { id: 'B', label: 'Not a set' },
    ],
    translations: {
      'zh-CN': {
        stem: '哪一个是集合？',
        options: [
          { id: 'B', label: '不是集合' },
          { id: 'A', label: '一个集合' },
        ],
      },
    },
  },
  grading: { correctOptionIds: ['A'] },
};

test('both language views keep one problem ID, grading and option order', () => {
  const before = JSON.stringify(problem);
  assert.equal(hasBilingualProblem(problem), true);
  const zh = localizeProblem(problem, 'zh-CN');
  const en = localizeProblem(problem, 'en-US');
  assert.equal(zh.id, en.id);
  assert.equal(zh.grading, en.grading);
  assert.equal(zh.publicContent.stem, '哪一个是集合？');
  assert.equal(en.publicContent.stem, 'Which is a set?');
  assert.deepEqual(problemOptions(zh), [
    { id: 'A', label: '一个集合' },
    { id: 'B', label: '不是集合' },
  ]);
  assert.deepEqual(
    gradeLocalProblem(zh, { kind: 'choice', selectedOptionIds: ['A'] }),
    gradeLocalProblem(en, { kind: 'choice', selectedOptionIds: ['A'] }),
  );
  assert.equal(JSON.stringify(problem), before);
});

test('proof and code localization changes presentation without replacing grading or starter code', () => {
  for (const type of ['proof', 'code']) {
    const original = {
      ...problem,
      type,
      publicContent: {
        type,
        stem: 'Prove the claim',
        starterCode: 'def solve():\n    pass',
        translations: { 'zh-CN': { stem: '证明此命题', explanation: '使用定义。' } },
      },
    };
    const localized = localizeProblem(original, 'zh-CN');
    assert.equal(localized.publicContent.stem, '证明此命题');
    assert.equal(localized.publicContent.starterCode, original.publicContent.starterCode);
    assert.equal(localized.grading, original.grading);
    assert.equal(localized.id, original.id);
  }
});

test('single-language problems retain their original content', () => {
  const original = {
    ...problem,
    publicContent: { type: 'choice', stem: 'Only English', options: [] },
  };
  assert.equal(hasBilingualProblem(original), false);
  assert.deepEqual(localizeProblem(original, 'zh-CN'), original);
});
