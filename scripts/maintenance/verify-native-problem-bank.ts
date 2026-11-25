import assert from 'node:assert/strict';
import {
  matchesProblemFilters,
  paperSetKind,
  paperSetPositionTag,
  paperSetPositions,
  problemPaperSeries,
  problemPaperSets,
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

// The teacher choices API carries only public metadata, not full problems.
// Legacy CSC108 papers use two explicit tags and do not always have a Set prefix in their titles.
const oldPaper = { ...problem, tags: ['CSC108', 'set-05', 'midterm', 'set-05'] };
const wrongScope = { ...problem, tags: ['set-05', '函数'] };
assert.deepEqual(
  problemPaperSeries([
    oldPaper,
    wrongScope,
    { tags: ['midterm'] },
    {},
    { tags: ['TT1原版模拟A卷'] },
  ]),
  [
    ['Midterm Set 05', 1],
    ['TT1原版模拟A卷', 1],
  ],
);
assert.equal(
  matchesProblemFilters(oldPaper, {
    ...base,
    series: 'Midterm Set 05',
    chapter: 'functions',
    query: 'injectivity',
  }),
  true,
);
assert.equal(
  matchesProblemFilters(oldPaper, { ...base, series: 'Midterm Set 05', chapter: 'strings' }),
  false,
);
assert.equal(matchesProblemFilters(wrongScope, { ...base, series: 'Midterm Set 05' }), false);

assert.equal(
  matchesProblemFilters(shared, { ...base, chapter: 'functions', series: 'TT2模拟A卷' }),
  true,
);
assert.equal(
  matchesProblemFilters(shared, { ...base, chapter: 'number-theory', series: 'TT2模拟A卷' }),
  false,
);
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
// 套题只引用题目：同一道 Final 题也在 TT2 模考里，两套各有自己的题号。
const finalQ2 = { ...problem, id: 'final-q2', tags: ['CSC108', 'UTM 2023 Final · Q2'] };
const sharedQ5 = {
  ...problem,
  id: 'shared',
  tags: ['UTM 2023 Final · Q5', 'TT2 模考 A · Q1', 'UTM 2023 Final · Q9'],
};
const finalQ3b = { ...problem, id: 'final-q3b', tags: ['UTM 2023 Final · Q3b'] };
const finalQ3a = { ...problem, id: 'final-q3a', tags: ['UTM 2023 Final · Q3a'] };
const mockQ2 = { ...problem, id: 'mock-q2', tags: ['TT2 模考 A · Q2', '2026 UTM TT1 · Crowdmark'] };
assert.deepEqual(paperSetPositions(sharedQ5.tags), [
  { set: 'UTM 2023 Final', number: 5, part: '', label: 'Q5' },
  { set: 'TT2 模考 A', number: 1, part: '', label: 'Q1' },
]);
assert.deepEqual(paperSetPositions(['2026 UTM TT1 · Crowdmark', 'Q3', ' · Q3']), []);
assert.equal(paperSetPositionTag('UTSG 2020W Midterm A', '12'), 'UTSG 2020W Midterm A · Q12');
assert.throws(() => paperSetPositionTag('A paper name that is far too long', '1'));
const sets = problemPaperSets([mockQ2, finalQ3b, sharedQ5, finalQ2, finalQ3a]);
assert.deepEqual(
  sets.map((set) => [set.name, set.kind, set.problems.map((p) => p.id)]),
  [
    ['UTM 2023 Final', 'final', ['final-q2', 'final-q3a', 'final-q3b', 'shared']],
    ['TT2 模考 A', 'test', ['shared', 'mock-q2']],
  ],
);
assert.deepEqual(
  [sharedQ5, finalQ2, mockQ2]
    .filter((p) => matchesProblemFilters(p, { ...base, series: 'TT2 模考 A' }))
    .map((p) => p.id),
  ['shared', 'mock-q2'],
);
assert.equal(paperSetKind('UTSG 2024F TT1 V2'), 'test');
assert.equal(paperSetKind('Worksheet 16'), 'practice');
console.log('Native problem filters, paper sets and reference-proof/rubric requests passed.');
