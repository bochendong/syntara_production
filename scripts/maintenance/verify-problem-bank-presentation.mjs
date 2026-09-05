import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
  alias: { '@': process.cwd() },
  jsx: { runtime: 'automatic' },
});
const { AttemptHistoryList, latestScoreLabel } = await jiti.import(
  '../../components/problem-bank/course-problem-bank-helpers.tsx',
);
const { listLocalDemoProblemBank } = await jiti.import(
  '../../lib/teacher/local-demo-problem-bank.ts',
);
const problem = listLocalDemoProblemBank('demo-csc148')[0];
assert.equal(latestScoreLabel(problem, 'zh-CN'), '没做过');
for (const score of [0, 60, 100]) {
  assert.equal(latestScoreLabel({ ...problem, latestAttempt: { score } }, 'zh-CN'), `${score}/100`);
}
assert.equal(
  latestScoreLabel({ ...problem, latestAttempt: { score: null } }, 'zh-CN'),
  '已做 · 待评分',
);

const attempts = [
  { id: 'run-only', kind: 'run', status: 'passed', score: 0, createdAt: 3000 },
  { id: 'submitted', kind: 'submit', status: 'partial', score: 60, createdAt: 2000 },
  { id: 'answered', kind: 'answer', status: 'failed', score: 0, createdAt: 1000 },
];
const renderHistory = (props) =>
  renderToStaticMarkup(
    createElement(AttemptHistoryList, {
      attempts,
      loading: false,
      points: 100,
      locale: 'zh-CN',
      ...props,
    }),
  );
const history = renderHistory();
assert.match(history, /role="menu"/);
assert.equal((history.match(/role="menuitem"/g) ?? []).length, 2);
assert.match(history, /60\/100/);
assert.match(history, /0\/100/);
assert.doesNotMatch(history, /aria-haspopup="menu"/);
assert.match(renderHistory({ attempts: [] }), /还没有提交记录/);
assert.match(renderHistory({ loading: true }), /正在加载/);
console.log('PASS problem scores, unattempted state, and inline submission-history menu list');
