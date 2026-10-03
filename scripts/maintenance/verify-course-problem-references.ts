import assert from 'node:assert/strict';
import { resolveProblemReferences } from '../../features/chat/server/course-agent/problem-references';
import { teacherPreviewCardFromMatches } from '../../features/chat/server/practice-card';
import type { TeacherProblemMatch } from '../../features/chat/server/course-agent/problem-bank-tools';

const courseId = 'course-1';
const match = (number: number, chapterName = '导数'): TeacherProblemMatch => ({
  problemId: `problem-${number}`,
  problemNumber: number,
  title: `Problem ${number}`,
  chapterId: null,
  chapterName,
  problemType: 'short_answer',
  difficulty: 'easy',
  tags: [],
  stemExcerpt: '',
  reason: '',
  href: `/course/${courseId}/problem-bank/problem-${number}`,
});
const candidates = [15, 83, 22, 86, 143, 8, 56, 82, 37].map((n) => match(n));
const desired = [15, 83, 143, 22, 86];
const text = [
  '按下表顺序复习。',
  '| 顺序 | 对应题目 |',
  '| --- | --- |',
  ...desired.map((n, index) => `| ${index + 1} | 《导数》· 题库第 ${n} 题 |`),
  ...desired.map((n, index) => `### ${index + 1}. 题库第 ${n} 题\n说明。`),
].join('\n');
const result = resolveProblemReferences({ text, courseId, candidates });
assert.deepEqual(
  result.selected.map((p) => p.problemNumber),
  desired,
);
assert.equal((result.text.match(/\]\(\/course\//g) || []).length, 10);
const plan = teacherPreviewCardFromMatches({
  matches: result.selected,
  query: 'tangent line equation slope derivative',
  id: 'plan-1',
  userId: 'teacher',
  courseId,
  courseName: 'Calculus',
});
assert.deepEqual(
  plan?.problemIds,
  desired.map((n) => `problem-${n}`),
);
assert.deepEqual(
  plan?.questions?.map((q) => q.problemNumber),
  desired,
);
assert.ok(!plan?.title.includes('tangent'));

// A forged label must not disagree with the actual linked problem.
const canonical = resolveProblemReferences({
  text: `[第 83 题](${match(15).href})`,
  courseId,
  candidates,
});
assert.ok(canonical.text.includes('题库第 15 题'));
assert.deepEqual(
  canonical.selected.map((p) => p.problemNumber),
  [15],
);
assert.equal(
  resolveProblemReferences({ text: result.text, courseId, candidates }).text,
  result.text,
);

const invalid = resolveProblemReferences({
  text: '[未知](/course/course-1/problem-bank/missing) [跨课程](/course/other/problem-bank/problem-15)',
  courseId,
  candidates,
});
assert.equal(invalid.text, '未知 跨课程');
assert.deepEqual(invalid.selected, []);
assert.equal(
  teacherPreviewCardFromMatches({
    matches: [],
    query: '',
    id: '',
    userId: '',
    courseId,
    courseName: '',
  }),
  null,
);

// Code examples and unrelated URLs must not select questions.
const code = '```md\n题库第 15 题\n```\n`第 83 题` [文档](https://example.com)';
assert.deepEqual(resolveProblemReferences({ text: code, courseId, candidates }), {
  text: code,
  selected: [],
});
const ambiguous = { ...match(15, '另一章'), problemId: 'other-15' };
assert.deepEqual(
  resolveProblemReferences({ text: '第 15 题', courseId, candidates: [...candidates, ambiguous] })
    .selected,
  [],
);
assert.equal(
  resolveProblemReferences({
    text: '《导数》· 第 15 题',
    courseId,
    candidates: [...candidates, ambiguous],
  }).selected[0].problemId,
  'problem-15',
);

// Final selection must not be silently truncated to a search's per-call limit.
const many = Array.from({ length: 15 }, (_, i) => match(i + 1));
assert.equal(
  teacherPreviewCardFromMatches({
    matches: many,
    query: '',
    id: '',
    userId: '',
    courseId,
    courseName: '',
  })?.problemIds.length,
  15,
);
console.log('Course problem references: all regression checks passed.');
