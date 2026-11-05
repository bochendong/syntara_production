import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { hasBilingualProblem, localizeProblem } = await jiti.import(
  '../../apps/native/src/lib/problem-language.ts',
);
const { gradeLocalProblem, problemOptions } = await jiti.import(
  '../../apps/native/src/data/local-problem-grading.ts',
);

const problem = {
  id: 'one-question',
  courseId: 'course',
  notebookId: null,
  type: 'choice',
  title: 'Sets',
  chapterId: 'chapter-sets',
  chapterName: 'Sets',
  publicContent: {
    type: 'choice',
    stem: 'Which is a set?',
    options: [
      { id: 'A', label: 'A set' },
      { id: 'B', label: 'Not a set' },
    ],
    translations: {
      'zh-CN': {
        title: '集合选择题',
        chapterName: '集合',
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
  assert.equal(zh.title, '集合选择题');
  assert.equal(zh.chapterName, '集合');
  assert.equal(en.title, 'Sets');
  assert.equal(en.chapterName, 'Sets');
  assert.equal(zh.chapterId, en.chapterId);
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

test('a numbered course chapter survives stale per-question chapter translations', () => {
  const reclassified = { ...problem, chapterName: '08 Abstract Functions 抽象函数' };
  for (const language of ['zh-CN', 'en-US']) {
    const localized = localizeProblem(reclassified, language);
    assert.equal(localized.chapterId, reclassified.chapterId);
    assert.equal(localized.chapterName, reclassified.chapterName);
    assert.equal(localized.grading, reclassified.grading);
  }
  assert.equal(localizeProblem(reclassified, 'zh-CN').title, '集合选择题');
  assert.equal(localizeProblem(reclassified, 'zh-CN').publicContent.stem, '哪一个是集合？');
  // Unlinked personal questions keep their existing localized presentation.
  assert.equal(localizeProblem({ ...reclassified, chapterId: null }, 'zh-CN').chapterName, '集合');
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
