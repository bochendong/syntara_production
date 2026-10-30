import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { getLocalizedProblemContent, getLocalizedProblemTitle, hasProblemTranslation } =
  await jiti.import('../../lib/problem-bank/i18n.ts');
const { localizeProblem, hasBilingualProblem } = await jiti.import(
  '../../apps/native/src/lib/problem-language.ts',
);

test('English translation preserves the Chinese base and option identities', () => {
  const content = {
    type: 'choice',
    stem: '选择颜色',
    options: [
      { id: 'a', label: '红' },
      { id: 'b', label: '蓝' },
    ],
    translations: {
      'en-US': {
        title: 'Choose a colour',
        stem: 'Choose a colour',
        options: [
          { id: 'b', label: 'Blue' },
          { id: 'a', label: 'Red' },
        ],
      },
    },
  };
  const before = structuredClone(content);
  const problem = { title: '选择颜色', publicContent: content };
  assert.equal(hasProblemTranslation(problem), true);
  assert.equal(hasProblemTranslation(problem, 'en-US'), true);
  assert.equal(hasProblemTranslation(problem, 'zh-CN'), false);
  assert.equal(getLocalizedProblemTitle(problem, 'en-US'), 'Choose a colour');
  assert.equal(getLocalizedProblemTitle(problem, 'zh-CN'), '选择颜色');
  const en = getLocalizedProblemContent(content, 'en-US');
  assert.equal(en.stem, 'Choose a colour');
  assert.deepEqual(en.options, [
    { id: 'a', label: 'Red' },
    { id: 'b', label: 'Blue' },
  ]);
  assert.deepEqual(content, before);
  assert.deepEqual(getLocalizedProblemContent(content, 'zh-CN').options, content.options);
  assert.equal(hasBilingualProblem(problem), true);
  assert.equal(localizeProblem(problem, 'en-US').title, 'Choose a colour');
});

test('English base and Chinese translations retain existing behavior', () => {
  const problem = {
    title: 'Default title',
    sourceMeta: { translations: { 'zh-CN': { title: '中文标题' } } },
    publicContent: {
      type: 'fill_blank',
      stemTemplate: 'Value: {{x}}',
      translations: { 'zh-CN': { stemTemplate: '数值：{{x}}' } },
    },
  };
  assert.equal(hasProblemTranslation(problem), true);
  assert.equal(getLocalizedProblemTitle(problem, 'zh-CN'), '中文标题');
  assert.equal(
    getLocalizedProblemContent(problem.publicContent, 'zh-CN').stemTemplate,
    '数值：{{x}}',
  );
  assert.equal(
    getLocalizedProblemContent(problem.publicContent, 'en-US').stemTemplate,
    'Value: {{x}}',
  );
});

test('nested translations are detected and recursively localized', () => {
  const publicContent = {
    type: 'multipart',
    stem: '题组',
    parts: [
      {
        label: 'a',
        content: {
          type: 'choice',
          stem: '选一项',
          options: [
            { id: 'a', label: '甲' },
            { id: 'b', label: '乙' },
          ],
          translations: { 'en-US': { stem: 'Choose', options: [{ id: 'a', label: 'A' }] } },
        },
      },
      {
        label: 'b',
        content: {
          type: 'fill_blank',
          stemTemplate: '数：{{x}}',
          translations: { 'en-US': { stemTemplate: 'Number: {{x}}' } },
        },
      },
    ],
  };
  assert.equal(hasProblemTranslation({ title: '题组', publicContent }), true);
  const en = getLocalizedProblemContent(publicContent, 'en-US');
  assert.equal(en.parts[0].content.stem, 'Choose');
  assert.deepEqual(en.parts[0].content.options, [
    { id: 'a', label: 'A' },
    { id: 'b', label: '乙' },
  ]);
  assert.equal(en.parts[1].content.stemTemplate, 'Number: {{x}}');
  assert.equal(publicContent.parts[0].content.stem, '选一项');
});

test('metadata title and missing translations fall back without modifying content', () => {
  const problem = {
    title: '原题',
    sourceMeta: { translations: { 'en-US': { title: 'Original' } } },
    publicContent: { type: 'short_answer', stem: '原题内容' },
  };
  assert.equal(getLocalizedProblemTitle(problem, 'en-US'), 'Original');
  assert.equal(hasProblemTranslation(problem), true);
  assert.equal(getLocalizedProblemContent(problem.publicContent, 'en-US').stem, '原题内容');
  assert.equal(
    hasProblemTranslation({ title: '原题', publicContent: problem.publicContent }),
    false,
  );
});
