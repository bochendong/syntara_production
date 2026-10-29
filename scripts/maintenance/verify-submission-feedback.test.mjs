import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const { submissionFeedback } = createJiti(import.meta.url)(
  '../../apps/native/src/lib/submission-feedback.ts',
);

test('submission notices distinguish passed, failed, partial and pending results', () => {
  for (const [status, tone, title] of [
    ['passed', 'success', '答对了'],
    ['failed', 'error', '答错了'],
    ['partial', 'warning', '部分正确'],
    ['pending', 'warning', '批改未完成'],
  ]) {
    const result = submissionFeedback([{ status, score: status === 'pending' ? null : 0.5 }]);
    assert.equal(result.tone, tone);
    assert.equal(result.title, title);
  }
});

test('multipart notices identify the submitted part and aggregate mixed results', () => {
  assert.equal(
    submissionFeedback([{ label: '(ii)', status: 'passed', score: 1 }], true).title,
    '小问 (ii)：答对了',
  );
  const result = submissionFeedback(
    [
      { label: 'i', status: 'passed', score: 1 },
      { label: 'ii', status: 'failed', score: 0 },
    ],
    true,
  );
  assert.equal(result.title, '本次提交：部分正确');
  assert.equal(result.description.includes('得分'), false);
});

test('an incomplete batch never claims success and an empty batch remains pending', () => {
  assert.equal(
    submissionFeedback([
      { status: 'passed', score: 1 },
      { status: 'pending', score: null },
    ]).title,
    '批改未完成',
  );
  assert.equal(submissionFeedback([]).title, '批改未完成');
  assert.equal(
    submissionFeedback([{ status: 'pending', score: 1 }]).description.includes('得分'),
    false,
  );
});

test('score presentation clamps finite scores and avoids invalid percentages', () => {
  assert.match(submissionFeedback([{ status: 'passed', score: 2 }]).description, /100%/);
  assert.match(submissionFeedback([{ status: 'failed', score: -1 }]).description, /0%/);
  assert.equal(
    submissionFeedback([{ status: 'failed', score: Number.NaN }]).description.includes('得分'),
    false,
  );
});
