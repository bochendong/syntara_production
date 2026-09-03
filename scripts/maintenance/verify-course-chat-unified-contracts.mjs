import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const agent = read('features/chat/server/teacher-course-agent.ts');
const stateless = read('features/chat/server/stateless-chat.ts');
const learn = read('components/learn/learn-page-client.tsx');
const loop = read('lib/chat/run-course-side-chat-loop.ts');
const scenarios = JSON.parse(read('scripts/maintenance/course-chat-unified-scenarios.json'));

assert.equal(scenarios.length, 15, 'the unified course-chat suite must contain 15 daily cases');
assert.equal(scenarios.filter((item) => item.role === 'student').length, 9);
assert.equal(scenarios.filter((item) => item.role === 'teacher').length, 6);
assert.equal(scenarios.filter((item) => item.confirmation).length, 1);
assert.equal(
  scenarios.find((item) => item.confirmation)?.expectedTools?.[0],
  'propose_calendar_change',
  'calendar mutation must be the only confirmation scenario',
);

const expectedTools = new Set(scenarios.flatMap((item) => item.expectedTools));
for (const toolName of expectedTools) {
  assert.match(agent, new RegExp(`${toolName}:\\s*(?:tool|openai\\.tools\\.webSearch)\\(`));
}

for (const removedTool of [
  'read_course_notebook',
  'record_my_learning_signal',
  'get_my_learning_state',
  'get_course_student_insight',
  'get_class_learning_overview',
  'get_course_problem_insight',
]) {
  assert.doesNotMatch(agent, new RegExp(`${removedTool}:\\s*tool\\(`));
}

assert.match(agent, /export async function runCourseTurn/);
assert.match(agent, /const sharedTools =/);
assert.match(
  agent,
  /\? \{ \.\.\.sharedTools, \.\.\.learningReadTools, \.\.\.calendarMutationTools \}/,
);
assert.match(agent, /: \{ \.\.\.sharedTools, \.\.\.teacherInsightTools \}/);
assert.match(agent, /This tool never writes memory/);
assert.match(agent, /Never invent replacement questions/);
assert.match(agent, /written: false/);
assert.match(agent, /requiresConfirmation: true/);

assert.match(stateless, /body\.config\.surface === 'course-chat'/);
assert.match(stateless, /const courseAgentMode =/);
assert.match(stateless, /await runCourseTurn\(/);
assert.doesNotMatch(stateless, /buildTrustedCourseQuestionContext/);
assert.doesNotMatch(stateless, /shouldUseDirectCourseAnswerFastPath/);

assert.doesNotMatch(learn, /['"]\/api\/learn\/turn/);
assert.doesNotMatch(learn, /learner_progress\.request_confirmation/);
assert.doesNotMatch(learn, /practice\.propose_generation/);
assert.doesNotMatch(learn, /image\.propose_generation/);
assert.match(
  learn,
  /surface: isTeacherCourseChat \? 'teacher-course-chat' : 'student-course-chat'/,
);
assert.match(learn, /CONFIRMABLE_COURSE_CHAT_ACTIONS\.has\(action\.kind\)/);
assert.match(learn, /当前聊天只允许确认日历变更/);

const acceptedActions = loop.match(
  /const LEARNING_ACTION_KINDS = new Set<LearningActionKind>\(\[([\s\S]*?)\]\);/,
)?.[1];
assert.ok(acceptedActions, 'missing learning action allowlist');
assert.deepEqual(
  [...acceptedActions.matchAll(/'([^']+)'/g)].map((match) => match[1]),
  ['calendar.propose_add', 'calendar.propose_update', 'calendar.propose_delete'],
);
assert.match(loop, /confirmation: 'required'/);

console.log('unified course-chat contracts: 15/15 scenarios mapped');
