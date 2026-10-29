import assert from 'node:assert/strict';
import {
  matchesProblemFilters,
  problemPaperSeries,
} from '../../apps/native/src/data/problem-bank-filters';
import { problemAiGradeRequest } from '../../apps/native/src/data/problem-ai-grading';
import type { LocalProblem } from '../../apps/native/src/domain/models';

const problem: LocalProblem = {
  id: 'proof-1',
  courseId: 'course-1',
  notebookId: null,
  chapterId: 'functions',
  chapterName: 'Functions 函数',
  title: 'Injectivity of a composition',
  type: 'proof',
  status: 'published',
  difficulty: 'hard',
  tags: ['TT1', 'mock-G'],
  publicContent: { stem: 'Prove the implication and disprove the converse.' },
  grading: {
    referenceProof: 'Assume h(a)=h(b), then use injectivity. Converse: a counterexample.',
    proof: 'Legacy field must not override the current contract.',
    rubric: 'A valid proof and a counterexample are both required.',
    rubricCriteria: [
      { id: 'proof', description: 'Prove injectivity of the pair.', points: 40 },
      { id: 'counterexample', description: 'Disprove both converse claims.', points: 60 },
    ],
    commentPrompt: 'Accept mathematically equivalent arguments.',
    analysis: 'A pair can distinguish elements even when neither coordinate does.',
  },
  createdAt: 1,
  updatedAt: 1,
};
const base = { query: '', type: 'all', difficulty: 'all', chapter: 'all' };
const currentOnly = { ...problem, id: 'current', tags: ['TT2模拟A卷', '函数', 'TT2'] };
const originalOnly = { ...problem, id: 'original', tags: ['TT2原版模拟A卷'] };
const shared = { ...problem, id: 'shared', tags: ['TT2模拟A卷', 'TT2原版模拟A卷', 'TT2模拟A卷'] };
const paperProblems = [currentOnly, originalOnly, shared, problem];
assert.deepEqual(
  new Map(problemPaperSeries(paperProblems)),
  new Map([
    ['TT2模拟A卷', 2],
    ['TT2原版模拟A卷', 2],
  ]),
);
assert.deepEqual(
  paperProblems
    .filter((p) => matchesProblemFilters(p, { ...base, series: 'TT2模拟A卷' }))
    .map((p) => p.id),
  ['current', 'shared'],
);
assert.deepEqual(
  paperProblems
    .filter((p) => matchesProblemFilters(p, { ...base, series: 'TT2原版模拟A卷' }))
    .map((p) => p.id),
  ['original', 'shared'],
);
assert.equal(
  matchesProblemFilters(currentOnly, { ...base, series: 'TT2模拟A卷', query: '不存在' }),
  false,
);
assert.equal(
  matchesProblemFilters(currentOnly, { ...base, series: 'TT2模拟A卷', query: 'injectivity' }),
  true,
);
assert.equal(
  paperProblems.filter((p) => matchesProblemFilters(p, { ...base, series: '' })).length,
  4,
);
assert.deepEqual(problemPaperSeries([problem]), []);
assert.equal(matchesProblemFilters(problem, base), true);
assert.equal(
  matchesProblemFilters(problem, {
    query: '函数 mock-g injectivity',
    type: 'proof',
    difficulty: 'hard',
    chapter: 'functions',
  }),
  true,
);
for (const mismatch of [
  { type: 'choice' },
  { difficulty: 'easy' },
  { chapter: 'sets' },
  { chapter: 'unassigned' },
  { query: 'sets' },
]) {
  assert.equal(matchesProblemFilters(problem, { ...base, ...mismatch }), false);
}
assert.equal(
  matchesProblemFilters(
    { ...problem, chapterId: null, chapterName: null },
    {
      ...base,
      chapter: 'unassigned',
    },
  ),
  true,
);
assert.equal(
  matchesProblemFilters({ ...problem, chapterId: undefined, chapterName: undefined }, base),
  true,
);

const request = problemAiGradeRequest(problem, 'My proof and counterexample');
assert.equal(request.proof, problem.grading.referenceProof);
assert.equal(request.points, 100);
assert.equal(request.questionType, 'proof');
assert.equal(request.userAnswer, 'My proof and counterexample');
assert.match(request.commentPrompt!, /Accept mathematically equivalent/);
assert.match(request.commentPrompt!, /A valid proof and a counterexample/);
assert.match(request.commentPrompt!, /Prove injectivity of the pair.*40/);
assert.match(request.commentPrompt!, /Disprove both converse claims.*60/);
const scaled = problemAiGradeRequest(
  { ...problem, grading: { ...problem.grading, points: 10 } },
  'proof',
);
assert.equal(scaled.points, 10);
assert.match(scaled.commentPrompt!, /原始总分 100.*本次满分 10/);
const legacy = problemAiGradeRequest(
  { ...problem, grading: { proof: 'Old proof', rubricCriteria: [null, {}] } },
  'proof',
);
assert.equal(legacy.proof, 'Old proof');
assert.equal(legacy.points, 10);
assert.equal(legacy.commentPrompt, undefined);
console.log('Native problem filters and reference-proof/rubric requests passed.');
