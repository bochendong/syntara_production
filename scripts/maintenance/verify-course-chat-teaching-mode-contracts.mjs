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

assert.match(types, /CourseChatTeachingMode = 'reply' \| 'guided'/);
assert.match(types, /type: 'context_usage'/);
assert.match(loop, /teachingMode: teachingMode === 'guided' \? 'guided' : 'reply'/);
assert.match(loop, /case 'context_usage'/);

assert.match(agent, /本轮教学方式：引导模式/);
assert.match(agent, /不要在第一步直接给出完整答案/);
assert.match(agent, /一次只给一个关键提示/);
assert.match(agent, /本轮教学方式：回复模式/);
assert.match(agent, /type: 'context_usage'/);
assert.match(context, /contextTokenBudget: COURSE_CONTEXT_TOKEN_BUDGET/);

assert.match(learn, /data-testid="learn-context-window-usage"/);
assert.match(learn, /data-testid="learn-teaching-mode-trigger"/);
assert.match(learn, /data-testid="learn-teaching-mode-reply"/);
assert.match(learn, /data-testid="learn-teaching-mode-guided"/);
assert.match(learn, /teachingMode: chatTeachingMode/);
assert.match(learn, /setChatContextUsageState\(\{ key: turnStoreKey, usage \}\)/);

console.log('course chat teaching-mode contracts: ok');
