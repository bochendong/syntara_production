#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function functionText(relativePath, functionName) {
  const sourceText = read(relativePath);
  const source = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let result = '';
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      result = node.getText(source);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(result, `Missing function ${functionName} in ${relativePath}`);
  return result;
}

const createMemory = functionText('lib/server/study-memory-store.ts', 'createStudyMemory');
const updateMemory = functionText('lib/server/study-memory-store.ts', 'updateStudyMemoryStatus');
const deleteMemory = functionText('lib/server/study-memory-store.ts', 'deleteStudyMemory');
const indexMemory = functionText(
  'lib/server/study-memory-vector-store.ts',
  'indexStudyMemoryRecord',
);
const memoryWriteRoute = read('app/api/memory/write/route.ts');
const learnPage = read('components/learn/learn-page-client.tsx');

for (const source of [createMemory, updateMemory, deleteMemory, indexMemory]) {
  assert.doesNotMatch(
    source,
    /\bensureStudyMemory(?:Table|VectorIndex)\b/,
    'Request-time memory writes must rely on migrations instead of runtime DDL.',
  );
}

assert.match(indexMemory, /jsonb_to_recordset\(\$1::jsonb\)/);
assert.match(indexMemory, /await prisma\.\$transaction\(async \(tx\) =>/);
assert.match(indexMemory, /FOR UPDATE/);
assert.match(indexMemory, /if \(!source\.length\) return false/);
assert.doesNotMatch(
  indexMemory,
  /for\s*\([^)]*chunk[^)]*\)\s*\{[\s\S]*?INSERT INTO "StudyMemoryChunk"/,
  'Vector chunks must be inserted in one batch, not one SQL statement per chunk.',
);

assert.match(memoryWriteRoute, /indexStudyMemory:\s*false/);
assert.match(memoryWriteRoute, /after\(async \(\) => \{[\s\S]*indexStudyMemoryRecords/);
assert.match(memoryWriteRoute, /indexingScheduled:\s*memoriesToIndex\.length/);

const memoryActionBranch =
  learnPage.match(
    /if \(action\.kind === 'memory\.propose_write'\) \{([\s\S]*?)\n\s{8}\}\n\s{6}\} catch/,
  )?.[1] || '';
assert.ok(memoryActionBranch, 'Unable to locate the memory confirmation action branch.');
assert.doesNotMatch(memoryActionBranch, /await saveRemoteLearnerCourseState/);
assert.match(memoryActionBranch, /completionResult\(shadowStateNeedsSync \? 'pending' : true\)/);
assert.match(memoryActionBranch, /long-term memory|canonical StudyMemory|canonical/i);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: [
        'no runtime DDL on memory writes',
        'one batch insert for vector chunks',
        'post-response vector indexing',
        'canonical-memory success boundary',
      ],
    },
    null,
    2,
  )}\n`,
);
