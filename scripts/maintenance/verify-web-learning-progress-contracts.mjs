#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const client = read('components/learn/learn-page-client.tsx');
const panel = read('components/learn/course-learning-progress-panel.tsx');
const trustedContext = read('lib/chat/server-course-question-context.ts');
const trustedProgress = read('lib/server/course-learning-progress.ts');
const memoryContext = read('lib/server/study-memory-context.ts');
const promptBuilder = read('lib/orchestration/prompt-builder.ts');

assert.match(
  client,
  /rightRailView !== 'overview'[\s\S]{0,240}ensureNotebooksLoaded\(\)/,
  'The web overview must load the lightweight notebook directory used by the progress slider.',
);
assert.match(panel, /loading && notebookCount === 0/);
assert.match(panel, /AI 只读取蓝色进度点之前的笔记本内容与对应记忆/);
assert.match(
  panel,
  /previewProgressFromClientY[\s\S]{0,420}setDragSelection\(/,
  'Dragging must preview progress locally instead of persisting on every pointer move.',
);
assert.match(
  panel,
  /handlePointerUp[\s\S]{0,420}commitCount\(finalCount\)/,
  'The progress slider must commit once when the student releases the pointer.',
);
assert.match(
  client,
  /progressSavePromiseRef\.current = \{ courseId: activeCourse\.id, promise: savePromise \}[\s\S]{0,450}同步到账号失败/,
  'Progress changes must expose account-sync failures.',
);
assert.match(
  client,
  /savePromise\.then\(\(saved\) => \{[\s\S]{0,160}if \(saved\) \{[\s\S]{0,100}announceLearningMemoryUpdated/,
  'The memory-ball update must only be announced after account memory persistence succeeds.',
);
assert.match(
  client,
  /activity\.layer !== 'study_memory' && activity\.layer !== 'structured_fact'/,
  'The memory ball must exclude source indexing and other non-student activity layers.',
);
assert.match(
  client,
  /turnNotebooks = await ensureNotebooksLoaded\(\)[\s\S]{0,800}await progressSave\.promise/,
  'A web AI turn must resolve notebook metadata and await the latest progress write.',
);
assert.match(
  client,
  /summarizeLearnerCourseState\(\{[\s\S]{0,120}notebooks: turnNotebooks/,
  'The planner snapshot must use the hydrated notebook directory.',
);

assert.match(trustedProgress, /namespace: LEARNER_STATE_NAMESPACE/);
assert.match(trustedProgress, /key: `course:\$\{args\.courseId\}:state`/);
assert.match(trustedProgress, /progressBoundary\(state, notebooks\)/);
assert.match(trustedProgress, /allowedNotebookIds: allowed\.map/);
assert.match(trustedProgress, /futureNotebookNames: future\.map/);
assert.match(
  trustedContext,
  /loadTrustedCourseLearningProgress\([\s\S]{0,500}buildLayeredMemoryRecallContext\(/,
  'The answerer must rebuild trusted progress on the server before memory recall.',
);
assert.match(
  trustedContext,
  /notebookScope:\s*\{[\s\S]{0,100}allowedNotebookIds: trustedProgress\.allowedNotebookIds/,
);
assert.match(
  trustedContext,
  /selectSourceContext\([\s\S]{0,180}trustedProgress\.allowedNotebookIds/,
  'Course-source snippets must use the same progress boundary as memory recall.',
);
assert.match(trustedContext, /learner: trustedProgress\.learner/);

for (const evidenceType of [
  'semanticResult.memories',
  'problemEvidence',
  'markdownEvidence',
  'studentMessages',
  'attemptEvidence',
  'knowledgeCache',
]) {
  assert.match(
    memoryContext,
    new RegExp(`${evidenceType.replace('.', '\\.')}\\.filter\\(.*notebookAllowed`, 's'),
    `${evidenceType} must be filtered by the student-confirmed notebook boundary.`,
  );
}
assert.match(promptBuilder, /Not yet learned; do not use as teaching evidence/);

console.log('PASS: web learning progress is loaded, persisted, trusted, and applied to AI recall.');
