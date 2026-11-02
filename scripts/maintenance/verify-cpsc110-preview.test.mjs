import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createJiti } from 'jiti';
import katex from 'katex';

const jiti = createJiti(import.meta.url);
const { notebookProblemPublicContentSchema } = await jiti.import(
  '../../lib/problem-bank/schema.ts',
);
const { getLocalizedProblemContent, hasProblemTranslation } = await jiti.import(
  '../../lib/problem-bank/i18n.ts',
);
const { localizeProblem } = await jiti.import('../../apps/native/src/lib/problem-language.ts');
const { problems } = JSON.parse(
  readFileSync(
    new URL('../../apps/native/src/qa/cpsc110-staging-data.json', import.meta.url),
    'utf8',
  ),
);

test('all 145 supported questions have valid Chinese content and preserve code, tests, grading and identities across languages', () => {
  assert.equal(problems.length, 145);
  for (const problem of problems) {
    assert.doesNotMatch(problem.publicContent.starterCode ?? '', /\(@htdw\b|\(big-bang\b/i);
    assert.doesNotMatch(problem.chapterName ?? '', /HtDW/i);
  }
  for (const problem of problems) {
    const before = structuredClone(problem);
    notebookProblemPublicContentSchema.parse(problem.publicContent);
    assert(hasProblemTranslation(problem, 'zh-CN'), problem.id);
    const zh = localizeProblem(problem, 'zh-CN');
    const en = localizeProblem(problem, 'en-US');
    assert.match(zh.publicContent.stem, /[\u3400-\u9fff]/, problem.id);
    assert.equal(zh.id, en.id);
    assert.deepEqual(zh.grading, en.grading);
    assert.equal(zh.publicContent.starterCode, en.publicContent.starterCode);
    assert.deepEqual(zh.publicContent.publicTests, en.publicContent.publicTests);
    assert.deepEqual(
      zh.publicContent.sampleIO?.map(({ input, output }) => ({ input, output })),
      en.publicContent.sampleIO?.map(({ input, output }) => ({ input, output })),
    );
    if (problem.type === 'table') {
      assert.deepEqual(
        zh.publicContent.rows.map((row) => row.id),
        en.publicContent.rows.map((row) => row.id),
      );
      for (const column of problem.publicContent.columns.filter(
        (c) => c.role === 'answer' || c.cellKind !== 'text',
      )) {
        assert.deepEqual(
          zh.publicContent.rows.map((row) => row.cells[column.id]),
          en.publicContent.rows.map((row) => row.cells[column.id]),
        );
      }
    }
    assert.deepEqual(problem, before);
  }
});

test('all explicit formulas parse in both languages and block formulas use separate double-dollar delimiters', () => {
  let formulas = 0;
  for (const problem of problems)
    for (const language of ['zh-CN', 'en-US']) {
      const content = getLocalizedProblemContent(problem.publicContent, language);
      const prose = [content.stem, ...(content.constraints ?? [])]
        .join('\n\n')
        .replace(/```[^\n]*\n[\s\S]*?```/g, '')
        .replace(/`[^`]*`/g, '');
      assert.doesNotMatch(prose, /^\$$/m, `${problem.id} ${language}`);
      for (const match of prose.matchAll(/\$\$([\s\S]*?)\$\$|(?<!\$)\$([^$\n]+)\$(?!\$)/g)) {
        katex.renderToString(match[1] ?? match[2], {
          throwOnError: true,
          displayMode: Boolean(match[1]),
        });
        formulas++;
      }
    }
  assert(formulas >= 20);
});

test('highest-margin examples are self-contained and match the statement example', () => {
  const content = problems.find((p) => p.title.includes('highest-margin')).publicContent;
  assert.match(content.sampleIO[0].input, /make-product "Laptop" 1250 1000/);
  assert.match(content.sampleIO[0].input, /make-product "Smartphone" 999 800/);
  assert.doesNotMatch(content.sampleIO[0].input, /\bP[01]\b/);
  assert.equal(content.sampleIO[0].output, '0.2');
  assert.deepEqual(content.sampleIO[1], { input: '(highest-margin empty)', output: '0' });
});

test('localized constraints, sample context and figure captions preserve executable and asset data', () => {
  const content = {
    type: 'code',
    stem: 'English task',
    constraints: ['Keep the stub.'],
    starterCode: '(define P1 1)',
    sampleIO: [{ input: '(f MAP)', output: '1' }],
    assets: { images: [{ id: 'graph', src: '/graph.png', caption: 'Graph' }] },
    translations: {
      'zh-CN': {
        stem: '中文题目',
        constraints: ['保留函数桩。'],
        sampleExplanations: [{ index: 0, explanation: 'MAP 是下方的地图。' }],
        assetTexts: [{ id: 'graph', caption: '地图' }],
      },
    },
  };
  const localized = getLocalizedProblemContent(content, 'zh-CN');
  assert.deepEqual(localized.constraints, ['保留函数桩。']);
  assert.equal(localized.sampleIO[0].explanation, 'MAP 是下方的地图。');
  assert.equal(localized.assets.images[0].caption, '地图');
  assert.equal(localized.assets.images[0].src, '/graph.png');
  assert.equal(content.assets.images[0].caption, 'Graph');
  assert.equal(localized.starterCode, content.starterCode);
});

test('grading boilerplate is at the bottom for table and short-answer tasks in both languages', () => {
  let nonCodeWithRules = 0;
  for (const problem of problems)
    for (const language of ['zh-CN', 'en-US']) {
      const content = getLocalizedProblemContent(problem.publicContent, language);
      const [description, rules] = content.stem.split(/\n\n### (?:约束限制条件|Constraints)\n\n/);
      const prose = description.replace(/```[^\n]*\n[\s\S]*?```/g, '');
      assert.doesNotMatch(
        prose,
        /(?:NOTE:\s*|Note that:?\s*)?(?:This|this) (?:problem|question) (?:will be|with be) (?:entirely |substantially )?autograded|(?:本题|此题)[^\n]{0,15}自动评分/,
        `${problem.id} ${language}`,
      );
      if (rules && problem.type !== 'code') nonCodeWithRules++;
    }
  assert(nonCodeWithRules >= 50);
});

test('the four reported tasks state the work, boundaries and submission type explicitly', () => {
  const [lifting, superfact, stack, delivery] = [6, 7, 13, 14].map(
    (n) => problems[n - 1].publicContent,
  );
  assert(lifting.stem.indexOf('What to submit') < lifting.stem.indexOf('Given program'));
  assert.match(lifting.stem, /two local definitions/);
  assert.match(stack.stem, /shorter string above the longer/);
  assert.match(stack.stem, /first argument above the second/);
  assert.match(stack.translations['zh-CN'].stem, /长度相同/);
  assert.match(delivery.stem, /@dd-template-rules/);
  assert.match(delivery.stem, /fn-for-delivery-status/);
  assert.match(delivery.stem, /end of tomorrow/);
  assert.match(delivery.translations['zh-CN'].stem, /两个任务/);
  assert.equal((superfact.stem.match(/### Worked example/g) ?? []).length, 1);
  assert.deepEqual(superfact.sampleIO, [
    { input: '(superfact 4)', output: '288' },
    { input: '(superfact 0)', output: '1' },
  ]);
});

test('code tasks no longer use a function-name-only placeholder as their entire English description', () => {
  for (const p of problems.filter((p) => p.type === 'code')) {
    assert.doesNotMatch(
      p.publicContent.stem.trim(),
      /^Complete the design of [\w, ?=<>-]+\.$/,
      p.id,
    );
  }
});
