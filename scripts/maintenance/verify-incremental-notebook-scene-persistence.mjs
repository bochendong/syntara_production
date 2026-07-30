#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const route = read('app/api/notebooks/[id]/scenes/route.ts');
const repository = read('lib/server/repositories/notebook-repository.ts');
const stageStorage = read('lib/utils/stage-storage.ts');
const generationTask = read('lib/create/run-notebook-generation-task.ts');

assert.match(route, /export async function POST\(/);
assert.match(route, /operation:\s*z\.literal\('begin'\)/);
assert.match(route, /operation:\s*z\.literal\('upsert'\)/);
assert.match(route, /operation:\s*z\.literal\('finalize'\)/);
assert.match(route, /z\.array\(incrementalSceneInputSchema\)\.min\(1\)\.max\(8\)/);
assert.match(route, /MAX_INCREMENTAL_REQUEST_BYTES/);
assert.match(route, /SCENE_PAYLOAD_TOO_LARGE/);
assert.match(route, /findOwnedNotebookSceneGenerationFence\(prisma,\s*userId,\s*id\)/);

const beginBody = repository.match(
  /export async function beginOwnedNotebookSceneGeneration[\s\S]*?\n}\n\n\/\*\*/,
)?.[0];
assert.ok(beginBody, 'missing beginOwnedNotebookSceneGeneration');
assert.equal(
  (beginBody.match(/scene\.deleteMany/g) || []).length,
  1,
  'generation begin must clear scenes exactly once',
);
assert.match(beginBody, /contentVersion:\s*\{\s*increment:\s*1\s*\}/);

const upsertBody = repository.match(
  /export async function upsertOwnedNotebookGenerationScenes[\s\S]*?\n}\n\n\/\*\*/,
)?.[0];
assert.ok(upsertBody, 'missing upsertOwnedNotebookGenerationScenes');
assert.match(upsertBody, /contentVersion:\s*expectedContentVersion/);
assert.match(upsertBody, /tx\.scene\.upsert/);
assert.doesNotMatch(upsertBody, /scene\.deleteMany|scene\.createMany|listNotebookScenes/);

const finalizeBody = repository.match(
  /export async function finalizeOwnedNotebookSceneGeneration[\s\S]*?\n}\n/,
)?.[0];
assert.ok(finalizeBody, 'missing finalizeOwnedNotebookSceneGeneration');
assert.match(finalizeBody, /summarizeNotebookScenesForMetadata\(scenes\)/);
assert.match(finalizeBody, /expectedSceneCount/);
assert.match(finalizeBody, /contentVersion:\s*\{\s*increment:\s*1\s*\}/);

assert.match(stageStorage, /\?includeScenes=0/);
assert.match(stageStorage, /export async function beginIncrementalStageSceneGeneration/);
assert.match(stageStorage, /export async function upsertIncrementalStageScenes/);
assert.match(stageStorage, /persistedScenes\.slice\(offset,\s*offset \+ 8\)/);
assert.match(stageStorage, /export async function finalizeIncrementalStageSceneGeneration/);

assert.match(
  generationTask,
  /slideGenerationRoute === 'image-ppt'[\s\S]*?beginIncrementalStageSceneGeneration/,
);
assert.match(
  generationTask,
  /upsertIncrementalStageScenes\(stage\.id,\s*result\.scenes,\s*incrementalSceneFence\)/,
);
assert.match(generationTask, /finalizeIncrementalStageSceneGeneration\(/);
assert.doesNotMatch(
  generationTask,
  /upsertIncrementalStageScenes\(stage\.id,\s*scenes,/,
  'page persistence must not resend the cumulative scene array',
);

assert.match(
  route,
  /export async function PUT[\s\S]*?replaceOwnedNotebookScenes/,
  'manual whole-notebook replacement must remain available',
);
assert.match(repository, /replaceOwnedNotebookScenes[\s\S]*?scene\.deleteMany/);

console.log('incremental notebook scene persistence contracts: OK');
