import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const schema = read('prisma/schema.prisma');
assert.match(schema, /model CourseProblemTagNode/);
assert.match(schema, /model NotebookProblemTagAssignment/);
assert.match(schema, /activeDurationMs\s+Int\?/);
assert.match(schema, /problemSnapshotJson\s+Json\?/);

const forumRoute = read('app/api/course-forum/[courseId]/route.ts');
assert.match(forumRoute, /loadForumProblemCard/);
assert.match(forumRoute, /problemSnapshotJson/);
assert.doesNotMatch(forumRoute, /secretJudgeJson/);
assert.doesNotMatch(forumRoute, /gradingJson/);

const timer = read('components/problem-bank/use-problem-active-timer.ts');
assert.match(timer, /IDLE_AFTER_MS = 60_000/);
assert.match(timer, /visibilitychange/);
assert.match(timer, /window\.localStorage/);

const teacherAttemptRoute = read(
  'app/api/teacher/courses/[courseId]/students/[studentId]/attempts/[attemptId]/route.ts',
);
assert.match(teacherAttemptRoute, /requireTeacher/);
assert.match(teacherAttemptRoute, /teacherCourseAccessWhere/);
assert.match(teacherAttemptRoute, /userId: studentId/);

const teacherAgent = read('features/chat/server/teacher-course-agent.ts');
assert.match(teacherAgent, /get_course_problem_insight/);
assert.match(teacherAgent, /计时样本数/);

console.log('Problem learning system contract checks passed.');
