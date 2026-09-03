#!/usr/bin/env node

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const dedupeModuleUrl = pathToFileURL(
  path.join(process.cwd(), 'features/problems/domain/problem-dedupe.ts'),
).href;
const { contentOnlyProblemFingerprint, courseProblemDedupeKey, normalizeProblemDedupeText } =
  await import(dedupeModuleUrl);

function shortAnswer(title, stem) {
  return {
    title,
    type: 'short_answer',
    publicContent: {
      type: 'short_answer',
      stem,
    },
  };
}

function dedupeKey(publicContent, title = 'Shared imported title') {
  return courseProblemDedupeKey({
    title,
    type: publicContent.type,
    publicContent,
  });
}

function assertSemanticDifference(left, right, message) {
  assert.notEqual(dedupeKey(left), dedupeKey(right), message);
}

function assertSameQuestion(left, right, message) {
  assert.equal(dedupeKey(left), dedupeKey(right), message);
}

const substantiveStem =
  'Prove by mathematical induction that the sum of the first n odd integers equals n squared for every positive integer n.';

assert.match(
  courseProblemDedupeKey(shortAnswer('Induction exercise', substantiveStem)),
  /^v2:(?:content|full):[a-f0-9]{64}$/,
  'course problem dedupe keys must advertise the v2 identity contract',
);

assert.equal(
  courseProblemDedupeKey(shortAnswer('Induction exercise', substantiveStem)),
  courseProblemDedupeKey(shortAnswer('Week 2, Question 7', substantiveStem)),
  'a substantive question must be reused even when its imported title changes',
);

assert.notEqual(
  courseProblemDedupeKey(shortAnswer('Derivative warm-up', 'Solve this problem.')),
  courseProblemDedupeKey(shortAnswer('Induction warm-up', 'Solve this problem.')),
  'short generic prompts must retain the title in their fallback fingerprint',
);

assert.equal(
  normalizeProblemDedupeText('Show that a ≤ b and x × y = z.'),
  normalizeProblemDedupeText('Show that a <= b and x * y = z'),
  'common mathematical symbol variants must normalize identically',
);

assert.equal(
  normalizeProblemDedupeText(String.raw`A \cup B and P \land Q \Rightarrow R`),
  normalizeProblemDedupeText('A ∪ B and P ∧ Q ⇒ R'),
  'LaTeX and Unicode set, logical, and arrow operators must normalize identically',
);

assert.equal(
  courseProblemDedupeKey(
    shortAnswer(
      'Symbol form',
      'For every real number x, show that x ≤ 10 and explain why multiplying x × 1 leaves the value unchanged.',
    ),
  ),
  courseProblemDedupeKey(
    shortAnswer(
      'ASCII form',
      'For every real number x show that x <= 10 and explain why multiplying x * 1 leaves the value unchanged',
    ),
  ),
  'symbol-only and punctuation-only changes must not create another course question',
);

assert.notEqual(
  courseProblemDedupeKey(shortAnswer('Induction exercise', substantiveStem)),
  courseProblemDedupeKey(
    shortAnswer(
      'Different induction exercise',
      'Prove by mathematical induction that two to the power n is at least n plus one for every nonnegative integer n.',
    ),
  ),
  'different substantive stems must remain distinct',
);

assert.notEqual(
  contentOnlyProblemFingerprint({
    type: 'short_answer',
    publicContent: { type: 'short_answer', stem: substantiveStem },
  }),
  contentOnlyProblemFingerprint({
    type: 'proof',
    publicContent: { type: 'proof', stem: substantiveStem },
  }),
  'problem type must remain part of the content-only fingerprint',
);

assertSemanticDifference(
  { type: 'short_answer', stem: 'Find the set A ∪ B and justify every included element.' },
  { type: 'short_answer', stem: 'Find the set A ∩ B and justify every included element.' },
  'set union and intersection must not collide',
);

assertSemanticDifference(
  { type: 'short_answer', stem: 'Determine whether the map A → B is injective.' },
  { type: 'short_answer', stem: 'Determine whether the map A ← B is injective.' },
  'opposite arrow directions must not collide',
);

assertSemanticDifference(
  { type: 'short_answer', stem: 'Explain why the probability is 0.1 in this experiment.' },
  { type: 'short_answer', stem: 'Explain why the probability is 0 1 in this experiment.' },
  'a meaningful decimal point must not be discarded',
);

const choiceQuestion = {
  type: 'choice',
  stem: 'Which statements correctly characterize an injective function from A to B?',
  selectionMode: 'single',
  options: [
    { id: 'option-a', label: 'Every element of A has exactly one image in B.' },
    { id: 'option-b', label: 'Distinct elements of A have distinct images in B.' },
  ],
};

assertSemanticDifference(
  choiceQuestion,
  { ...choiceQuestion, selectionMode: 'multiple' },
  'single-choice and multiple-choice questions must not collide',
);

assertSameQuestion(
  choiceQuestion,
  {
    ...choiceQuestion,
    options: choiceQuestion.options.map((option, index) => ({
      ...option,
      id: `regenerated-option-${index + 1}`,
    })),
  },
  'regenerated choice option IDs must not change a semantic identity',
);

const calculationQuestion = {
  type: 'calculation',
  stem: 'Calculate the displacement after the object travels at constant speed for the given time.',
  unit: 'm',
};

assertSemanticDifference(
  calculationQuestion,
  { ...calculationQuestion, unit: 'km' },
  'calculation units must be part of the public question identity',
);

const codeQuestion = {
  type: 'code',
  stem: 'Implement binary_search so it returns the index of target in a sorted list or -1.',
  language: 'python',
  starterCode: 'def binary_search(values, target):\n    pass',
  functionSignature: 'def binary_search(values: list[int], target: int) -> int:',
  constraints: ['The input list is sorted.', 'The algorithm must run in O(log n) time.'],
  publicTests: [
    {
      id: 'test-found',
      description: 'finds an element in the middle',
      expression: 'binary_search([1, 3, 5], 3)',
      expected: '1',
    },
  ],
  sampleIO: [
    {
      input: 'values = [1, 3, 5], target = 5',
      output: '2',
      explanation: 'The target occurs at index 2.',
    },
  ],
  statementSections: [
    {
      id: 'requirements',
      title: 'Requirements',
      kind: 'requirements',
      body: 'Do not call list.index.',
      items: ['Use the course binary-search invariant.'],
    },
  ],
  starterCodeDescription: 'Complete the function body without changing its signature.',
  secretConfigPresent: false,
};

assertSemanticDifference(
  codeQuestion,
  {
    ...codeQuestion,
    constraints: ['The input list is sorted.', 'The algorithm may run in O(n) time.'],
  },
  'code constraints must be part of the public question identity',
);

assertSemanticDifference(
  codeQuestion,
  {
    ...codeQuestion,
    publicTests: [{ ...codeQuestion.publicTests[0], expected: '-1' }],
  },
  'code public test expressions and expected values must be part of the identity',
);

assertSemanticDifference(
  codeQuestion,
  {
    ...codeQuestion,
    sampleIO: [{ ...codeQuestion.sampleIO[0], output: '-1' }],
  },
  'code sample input/output must be part of the public question identity',
);

assertSemanticDifference(
  codeQuestion,
  {
    ...codeQuestion,
    starterCodeDescription: 'Rewrite the function and return a Boolean result.',
  },
  'starter-code descriptions must be part of the public question identity',
);

assertSemanticDifference(
  codeQuestion,
  {
    ...codeQuestion,
    statementSections: [{ ...codeQuestion.statementSections[0], body: 'You may call list.index.' }],
  },
  'code statement sections must be part of the public question identity',
);

assertSemanticDifference(
  codeQuestion,
  {
    ...codeQuestion,
    starterCode: 'def binary_search(values, target):\n    return values.index(target)',
  },
  'starter code must be part of the public question identity',
);

assertSameQuestion(
  codeQuestion,
  {
    ...codeQuestion,
    publicTests: [{ ...codeQuestion.publicTests[0], id: 'regenerated-test-id' }],
    statementSections: [{ ...codeQuestion.statementSections[0], id: 'regenerated-section-id' }],
    secretConfigPresent: true,
  },
  'volatile code IDs and the private-grading presence flag must not change public semantics',
);

const imageQuestion = {
  type: 'short_answer',
  stem: 'Use the attached graph to identify the interval on which the function is increasing.',
  assets: {
    images: [
      {
        id: 'asset-a',
        src: 'data:image/png;base64,Zmlyc3QtZ3JhcGg=',
        alt: 'Graph of f on the interval from negative two to two.',
        caption: 'Graph used in the question.',
        sourceImageId: 'source-image-a',
        pageNumber: 4,
        width: 760,
        height: 980,
        mimeType: 'image/png',
        role: 'question',
      },
    ],
  },
};

assertSemanticDifference(
  imageQuestion,
  {
    ...imageQuestion,
    assets: {
      images: [
        {
          ...imageQuestion.assets.images[0],
          src: 'data:image/png;base64,c2Vjb25kLWdyYXBo',
        },
      ],
    },
  },
  'different prompt-bearing images must not collide',
);

assertSameQuestion(
  imageQuestion,
  {
    ...imageQuestion,
    assets: {
      images: [
        {
          ...imageQuestion.assets.images[0],
          id: 'regenerated-asset-id',
          sourceImageId: 'regenerated-source-image-id',
          pageNumber: 12,
          width: 1520,
          height: 1960,
          mimeType: 'image/x-png',
        },
      ],
    },
  },
  'regenerated image IDs and storage metadata must not change a semantic identity',
);

assertSemanticDifference(
  {
    type: 'short_answer',
    stem: 'Explain the induction step in your own words.',
    translations: {
      'zh-CN': { stem: '请解释数学归纳法中的归纳步骤。' },
    },
  },
  {
    type: 'short_answer',
    stem: 'Explain the induction step in your own words.',
    translations: {
      'zh-CN': { stem: '请解释数学归纳法中的基础步骤。' },
    },
  },
  'localized prompt text must be part of the public question identity',
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checks: [
        'v2 key contract',
        'title-independent substantive reuse',
        'short generic prompt safety',
        'mathematical symbol normalization',
        'punctuation normalization',
        'distinct-stem separation',
        'problem-type separation',
        'set/operator/arrow/decimal separation',
        'choice mode and volatile option IDs',
        'calculation units',
        'code constraints/tests/sampleIO/descriptions/sections/starter code',
        'prompt-bearing image assets',
        'localized prompt content',
      ],
    },
    null,
    2,
  )}\n`,
);
