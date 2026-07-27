#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = process.cwd();
const relativePath = 'lib/server/unlinked-course-knowledge-projection.ts';
const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];

function requirePattern(pattern, label) {
  if (!pattern.test(source)) failures.push(label);
}

function forbidPattern(pattern, label) {
  if (pattern.test(source)) failures.push(label);
}

requirePattern(
  /PROJECTION_SYNC_QUIET_MS\s*=\s*750[\s\S]*PROJECTION_SYNC_MAX_DEBOUNCE_MS\s*=\s*2_500/,
  'mutation sync must use a short quiet window with a bounded maximum delay',
);
requirePattern(
  /globalProjectionPermitActive[\s\S]*globalProjectionWaiters[\s\S]*withGlobalProjectionPermit/,
  'projection database work must use a process-wide concurrency-one permit',
);
requirePattern(
  /projectionSyncInFlightByCourse\.get\(args\.courseId\)[\s\S]*if \(existing\) return existing/,
  'direct finalizer retries must await the same per-course in-flight promise',
);
requirePattern(
  /scheduledProjectionByCourse[\s\S]*mutationVersion[\s\S]*dirty[\s\S]*callbackScheduled/,
  'scheduled mutation work must have a per-course coalescing state',
);
requirePattern(
  /passCount < PROJECTION_SYNC_MAX_PASSES_PER_RUNNER[\s\S]*lastPassSawNewMutation[\s\S]*needsContinuation/,
  'the runner must provide one trailing pass and preserve a mutation arriving during it',
);
requirePattern(
  /retryNotBefore[\s\S]*reconciliationFailureBackoffMs[\s\S]*encounteredFailure = true/,
  'projection failures must stop the runner and enter backoff',
);
requirePattern(
  /scheduleUnlinkedCourseKnowledgeProjectionReconciliation[\s\S]*getOrCreateScheduledProjectionState[\s\S]*ensureScheduledProjectionRunner/,
  'read reconciliation must share the mutation coordinator',
);
requirePattern(
  /JSONB_AGG\([\s\S]*'chunkText', c\."chunkText"[\s\S]*AS "chunks"/,
  'the incremental plan must inspect complete persisted chunk state',
);
requirePattern(
  /isProjectionDocumentCurrent[\s\S]*areProjectionChunksCurrent[\s\S]*const documentWrites = writePlan\.filter/,
  'unchanged documents and chunks must be classified before writes',
);
requirePattern(
  /VALUES \$\{Prisma\.join\(values\)\}[\s\S]*RETURNING "id", "documentKey"/,
  'changed knowledge documents must use a batched upsert',
);
requirePattern(
  /DELETE FROM "KnowledgeChunk" WHERE "documentId" = ANY\(\$1::text\[\]\)[\s\S]*VALUES \$\{Prisma\.join\(batch\)\}/,
  'changed chunks must use batched delete and insert operations',
);
requirePattern(
  /const content = normalizeText\(\s*\[row\.title, row\.tags\.join\(' '\), publicContent\]/,
  'problem search content must not churn when only its notebook label changes',
);
requirePattern(
  /metadataJson:\s*\{\s*notebookName: row\.notebookName/,
  'the notebook label must remain available as projection metadata',
);
forbidPattern(
  /for \(const item of prepared\)[\s\S]*INSERT INTO "KnowledgeDocument"/,
  'projection sync must not issue one document upsert per prepared item',
);
forbidPattern(
  /UPDATE "KnowledgeChunk"\s+SET/,
  'unchanged chunks must not receive blanket metadata updates',
);

const pureFunctionNames = [
  'canonicalJson',
  'sameJson',
  'dateValue',
  'inBatches',
  'expectedChunkState',
  'isProjectionDocumentCurrent',
  'areProjectionChunksCurrent',
];
const parsed = ts.createSourceFile(
  relativePath,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const declarations = new Map(
  parsed.statements
    .filter((statement) => ts.isFunctionDeclaration(statement) && statement.name)
    .map((statement) => [statement.name.text, statement]),
);
const missingPureFunctions = pureFunctionNames.filter((name) => !declarations.has(name));
if (missingPureFunctions.length > 0) {
  failures.push(`missing pure planning functions: ${missingPureFunctions.join(', ')}`);
} else {
  const extracted = pureFunctionNames
    .map((name) => declarations.get(name).getText(parsed))
    .join('\n\n');
  const transpiled = ts.transpileModule(
    `${extracted}\n\nglobalThis.projectionHooks = { ${pureFunctionNames.join(', ')} };`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    },
  ).outputText;
  const context = {};
  vm.runInNewContext(transpiled, context);
  const hooks = context.projectionHooks;

  const item = {
    document: {
      documentKey: 'problem:p1',
      documentType: 'problem',
      sourceEntityType: 'NotebookProblem',
      sourceEntityId: 'p1',
      notebookId: null,
      title: 'Binary search tree',
      summary: 'Public summary',
      content: 'Binary search tree\n\npublic prompt',
      contentHash: 'doc-hash',
      metadataJson: {
        tags: ['bst'],
        notebookName: null,
        difficulty: 'medium',
      },
      publishedAt: '2026-07-26T00:00:00.000Z',
    },
    chunks: [
      {
        chunkIndex: 0,
        chunkText: 'Binary search tree\n\npublic prompt',
        contentHash: 'chunk-hash',
        tokenCount: 10,
      },
    ],
  };
  const chunks = hooks.expectedChunkState({
    item,
    ownerId: 'owner-1',
    courseId: 'course-1',
  });
  const existing = {
    id: 'document-1',
    documentKey: item.document.documentKey,
    ownerId: 'owner-1',
    notebookId: null,
    documentType: item.document.documentType,
    sourceEntityType: item.document.sourceEntityType,
    sourceEntityId: item.document.sourceEntityId,
    visibility: 'course',
    title: item.document.title,
    summary: item.document.summary,
    content: item.document.content,
    contentHash: item.document.contentHash,
    language: 'en',
    status: 'ready',
    errorReason: null,
    metadataJson: {
      difficulty: 'medium',
      notebookName: null,
      tags: ['bst'],
    },
    chunkCount: 1,
    publishedAt: item.document.publishedAt,
    indexedAt: '2026-07-26T00:01:00.000Z',
    chunks,
  };

  if (
    !hooks.isProjectionDocumentCurrent({
      existing,
      item,
      ownerId: 'owner-1',
      language: 'en',
    })
  ) {
    failures.push('an exact document state must take the zero-write fast path');
  }
  if (
    !hooks.areProjectionChunksCurrent({
      existing,
      item,
      ownerId: 'owner-1',
      courseId: 'course-1',
    })
  ) {
    failures.push('an exact chunk state must take the zero-write fast path');
  }
  if (
    hooks.isProjectionDocumentCurrent({
      existing: { ...existing, indexedAt: null },
      item,
      ownerId: 'owner-1',
      language: 'en',
    })
  ) {
    failures.push('a non-indexed document must be repaired');
  }
  if (
    hooks.areProjectionChunksCurrent({
      existing: {
        ...existing,
        chunks: [{ ...chunks[0], notebookId: 'stale-notebook' }],
      },
      item,
      ownerId: 'owner-1',
      courseId: 'course-1',
    })
  ) {
    failures.push('a stale chunk ownership field must be repaired');
  }
  if (
    hooks.areProjectionChunksCurrent({
      existing: {
        ...existing,
        chunks: [{ ...chunks[0], chunkText: 'corrupted public text' }],
      },
      item,
      ownerId: 'owner-1',
      courseId: 'course-1',
    })
  ) {
    failures.push('corrupted chunk text must never take the zero-write fast path');
  }
  const batches = hooks.inBatches(
    Array.from({ length: 417 }, (_, index) => index),
    400,
  );
  if (batches.length !== 2 || batches[0].length !== 400 || batches[1].length !== 17) {
    failures.push('the write planner must safely batch more than 400 changed records');
  }
}

if (failures.length > 0) {
  console.error('Unlinked projection scheduler verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  'Unlinked projection scheduler verification passed: coalescing, single-flight, backoff, and incremental writes are present.',
);
