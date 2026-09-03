import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = process.cwd();
const read = (path) => readFileSync(resolve(repositoryRoot, path), 'utf8');

const types = read('lib/types/chat.ts');
const loop = read('lib/chat/run-course-side-chat-loop.ts');
const agent = read('features/chat/server/teacher-course-agent.ts');
const learn = read('components/learn/learn-page-client.tsx');
const context = read('features/chat/server/course-context-compression.ts');
const toolSchemas = read('lib/orchestration/tool-schemas.ts');
const semanticRouter = read('features/learn-core/server/schemas.ts');
const statelessChat = read('features/chat/server/stateless-chat.ts');
const clientCalendarActions = read('features/learn-core/client-calendar-actions.ts');

const courseChatActions = toolSchemas.match(
  /COURSE_CHAT_LEARNING_ACTIONS\s*=\s*\[([\s\S]*?)\]\s*as const/,
)?.[1];
const generatedLearnActions = semanticRouter.match(
  /generatedLearnActionKindSchema\s*=\s*z\.enum\(\[([\s\S]*?)\]\)/,
)?.[1];

assert.ok(courseChatActions, 'missing course-chat action registry');
assert.ok(generatedLearnActions, 'missing generated /learn action registry');
for (const activeActions of [courseChatActions, generatedLearnActions]) {
  assert.doesNotMatch(activeActions, /'web\.search'/);
  assert.doesNotMatch(activeActions, /'learner_progress\.request_confirmation'/);
  assert.doesNotMatch(activeActions, /'practice\.propose_generation'/);
  assert.doesNotMatch(activeActions, /'image\.propose_generation'/);
}

const calendarToolBlock = agent.match(
  /const calendarTools = \{([\s\S]*?)\n  \};\n  const latestStudentMessage/,
)?.[1];
assert.ok(calendarToolBlock, 'missing student calendar tool registry');
assert.deepEqual(
  [...calendarToolBlock.matchAll(/^    ([a-z_]+): tool\(/gm)].map((match) => match[1]),
  ['list_calendar_events', 'propose_calendar_change'],
);

assert.match(types, /CourseChatTeachingMode = 'reply' \| 'guided'/);
assert.match(types, /type: 'context_usage'/);
assert.match(loop, /teachingMode: teachingMode === 'guided' \? 'guided' : 'reply'/);
assert.match(loop, /case 'context_usage'/);

assert.match(agent, /本轮教学方式：引导模式/);
assert.match(agent, /不要在第一步直接给出完整答案/);
assert.match(agent, /一次只给一个关键提示/);
assert.match(agent, /本轮教学方式：回复模式/);
assert.match(agent, /type: 'context_usage'/);
assert.match(agent, /openai\.tools\.webSearch\(/);
assert.match(agent, /externalWebAccess: true/);
assert.match(agent, /await result\.sources/);
assert.match(agent, /list_calendar_events: tool\(/);
assert.match(agent, /propose_calendar_change: tool\(/);
assert.doesNotMatch(agent, /create_calendar_event: tool\(/);
assert.doesNotMatch(agent, /update_calendar_event: tool\(/);
assert.doesNotMatch(agent, /delete_calendar_event: tool\(/);
assert.match(agent, /calendarProposalActionName\(proposal\.operation\)/);
assert.match(agent, /type: 'action'/);
assert.match(agent, /totalActions: calendarProposalEmitted \? 1 : 0/);
assert.match(statelessChat, /usesNativeCourseAgent\(parsedBody\)/);
assert.match(clientCalendarActions, /kind: validEventKind\(item\.kind\) \|\| 'progress'/);
assert.match(clientCalendarActions, /const hasStartUpdate =/);
assert.match(learn, /if \(before\.start !== after\.start\) patch\.start = after\.start \?\? null/);
assert.match(context, /contextTokenBudget: COURSE_CONTEXT_TOKEN_BUDGET/);

assert.match(learn, /data-testid="learn-context-window-usage"/);
assert.match(learn, /data-testid="learn-teaching-mode-trigger"/);
assert.match(learn, /data-testid="learn-teaching-mode-reply"/);
assert.match(learn, /data-testid="learn-teaching-mode-guided"/);
assert.match(learn, /teachingMode: chatTeachingMode/);
assert.match(learn, /setChatContextUsageState\(\{ key: turnStoreKey, usage \}\)/);
assert.doesNotMatch(learn, /if \(action\.kind === 'web\.search'\)/);
assert.doesNotMatch(learn, /'\/api\/web-search'/);

console.log('course chat teaching-mode contracts: ok');
