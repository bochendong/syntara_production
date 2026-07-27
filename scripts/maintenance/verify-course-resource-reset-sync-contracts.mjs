#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertMatch(source, pattern, label) {
  if (!pattern.test(source)) {
    throw new Error(`Missing contract: ${label}`);
  }
}

const sourceRoute = read('app/api/courses/[id]/source-uploads/route.ts');
const notebookRoute = read('app/api/notebooks/[id]/route.ts');
const projectionRoute = read('app/api/courses/[id]/knowledge-projection/route.ts');
const resetScript = read('scripts/maintenance/reset-course-resources-via-api.mjs');

assertMatch(
  sourceRoute,
  /export async function GET[\s\S]*?deferKnowledgeSyncParam[\s\S]*?ownerId:\s*auth\.userId[\s\S]*?const retryableSources\s*=\s*[\s\S]*?includeArtifacts && !deferKnowledgeSync/,
  'owner-scoped source GET suppresses pending index claims when explicitly deferred',
);
assertMatch(
  sourceRoute,
  /!deferKnowledgeSync &&[\s\S]*?scheduleUnlinkedCourseKnowledgeProjectionReconciliation/,
  'source GET suppresses projection reconciliation when explicitly deferred',
);
assertMatch(
  sourceRoute,
  /export async function GET[\s\S]*?INVALID_DEFER_KNOWLEDGE_SYNC[\s\S]*?const deferKnowledgeSync = deferKnowledgeSyncParam === '1'/,
  'source GET validates the deferKnowledgeSync flag',
);
assertMatch(
  sourceRoute,
  /export async function DELETE[\s\S]*?INVALID_DEFER_KNOWLEDGE_SYNC[\s\S]*?const deferKnowledgeSync = deferKnowledgeSyncParam === '1'/,
  'bulk source DELETE validates the deferKnowledgeSync flag',
);
assertMatch(
  sourceRoute,
  /if \(results\.length > 0 && !deferKnowledgeSync\) \{[\s\S]*?scheduleUnlinkedCourseKnowledgeProjectionSync/,
  'bulk source DELETE suppresses immediate projection sync when explicitly deferred',
);
assertMatch(
  sourceRoute,
  /knowledgeSyncDeferred:\s*deferKnowledgeSync/,
  'bulk source DELETE reports whether projection sync was deferred',
);

assertMatch(
  notebookRoute,
  /export async function DELETE\(request:[\s\S]*?deferKnowledgeSyncParam[\s\S]*?INVALID_DEFER_KNOWLEDGE_SYNC/,
  'notebook DELETE validates its deferKnowledgeSync flag',
);
assertMatch(
  notebookRoute,
  /if \(!deferKnowledgeSync\) \{[\s\S]*?reason:\s*'notebook_deleted'/,
  'notebook DELETE suppresses immediate projection sync when explicitly deferred',
);
assertMatch(
  notebookRoute,
  /knowledgeSyncDeferred:\s*deferKnowledgeSync/,
  'notebook DELETE reports whether projection sync was deferred',
);

assertMatch(
  projectionRoute,
  /findOwnedCourse\(prisma,\s*auth\.userId,\s*id\)[\s\S]*?await syncUnlinkedCourseKnowledgeProjection/,
  'course projection finalization is owner-scoped',
);
assertMatch(
  projectionRoute,
  /const knowledgeSyncCompleted = result\.available && result\.synced[\s\S]*?status:\s*knowledgeSyncCompleted \? 200 : 503/,
  'course projection finalization waits and returns a retryable failure',
);

assertMatch(
  resetScript,
  /source-uploads\?includeText=0&includeArtifacts=\$\{[\s\S]*?\}&deferKnowledgeSync=1/,
  'reset script makes side-effect-free source catalog reads',
);
assertMatch(
  resetScript,
  /sourceData\?\.knowledgeSyncDeferred !== true/,
  'reset script verifies source read sync deferral',
);
assertMatch(
  resetScript,
  /source-uploads\?preserveProblems=1&deferKnowledgeSync=1/,
  'reset script defers bulk source projection sync',
);
assertMatch(
  resetScript,
  /api\/notebooks\/\$\{encodeURIComponent\(notebook\.id\)\}\?deferKnowledgeSync=1/,
  'reset script defers every notebook projection sync',
);
assertMatch(
  resetScript,
  /sourceReset\?\.knowledgeSyncDeferred !== true/,
  'reset script verifies source sync deferral',
);
assertMatch(
  resetScript,
  /result\?\.knowledgeSyncDeferred !== true/,
  'reset script verifies notebook sync deferral',
);
assertMatch(
  resetScript,
  /if \(!sameIds\(baseline\.problemIds, after\.problemIds\)\)[\s\S]*?if \(after\.notebooks\.length !== 0 \|\| after\.sources\.length !== 0\)[\s\S]*?\/knowledge-projection/,
  'reset script verifies problems and empty resources before final projection sync',
);
assertMatch(
  resetScript,
  /knowledgeProjection\?\.result\?\.available !== true[\s\S]*?knowledgeProjection\?\.result\?\.synced !== true/,
  'reset script requires an available and completed final projection sync',
);
assertMatch(
  resetScript,
  /error instanceof ApiRequestError && error\.status === 404[\s\S]*?alreadyAbsent = true/,
  'reset script reconciles a notebook delete committed before an interrupted response',
);

const finalSyncCalls = resetScript.match(/\/knowledge-projection/g) ?? [];
if (finalSyncCalls.length !== 1) {
  throw new Error(
    `Expected exactly one final projection API call in the per-course reset path; found ${finalSyncCalls.length}.`,
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: [
        'owner-only side-effect-free source catalog reads',
        'pending index and reconciliation suppression during maintenance reads',
        'bulk source defer flag validation and response',
        'notebook defer flag validation and response',
        'owner-scoped awaited final course projection sync',
        'one final sync after resource and problem invariants',
        'idempotent notebook 404 reconciliation remains enabled',
      ],
    },
    null,
    2,
  )}\n`,
);
