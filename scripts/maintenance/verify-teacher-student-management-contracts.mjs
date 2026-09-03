import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const schema = read('prisma/schema.prisma');
assert.match(schema, /phone\s+String\?\s+@db\.VarChar\(24\)/);

const meRoute = read('app/api/me/route.ts');
assert.match(meRoute, /parsePhoneNumber/);
assert.match(meRoute, /phone: true/);

const rosterRoute = read('app/api/teacher/courses/[courseId]/students/route.ts');
assert.match(rosterRoute, /phoneLast4: phoneLastFour/);
assert.doesNotMatch(rosterRoute, /email: enrollment\.user\.email/);

const roster = read('components/teacher/teacher-course-students-client.tsx');
assert.match(roster, /搜索姓名或手机号后四位/);
assert.match(roster, /手机号尾号/);
assert.doesNotMatch(roster, /近期未活跃|活跃学生|student\.email/);

const analytics = read('features/teacher-analytics/server/course-learning-analytics.ts');
assert.match(analytics, /phoneLast4: phoneLastFour/);
assert.match(analytics, /sort\(\(left, right\) => right\.latestAttempt\.createdAt/);
assert.doesNotMatch(analytics, /activeStudentCount/);

const detail = read('components/teacher/teacher-course-student-detail-client.tsx');
assert.match(detail, /ProblemAttemptReviewDialog/);
assert.match(detail, /这个时间范围内还没有做题记录/);
assert.doesNotMatch(detail, /JSON\.stringify\(attempt|problem\.problemNumber/);

const attemptRoute = read(
  'app/api/teacher/courses/[courseId]/students/[studentId]/attempts/[attemptId]/route.ts',
);
assert.match(attemptRoute, /publicContent: attempt\.problem\.publicContentJson/);
assert.match(attemptRoute, /answer: attempt\.answerJson/);
assert.doesNotMatch(attemptRoute, /gradingJson|secretJudgeJson/);

const reviewDialog = read('components/problem-bank/problem-attempt-review-dialog.tsx');
assert.match(reviewDialog, /CodeProblemStatement/);
assert.match(reviewDialog, /ProblemRichText/);
assert.match(reviewDialog, /selectedOptionIds/);

console.log('Teacher student management contract checks passed.');
