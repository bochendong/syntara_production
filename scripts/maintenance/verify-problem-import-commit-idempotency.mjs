#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertMatch(source, pattern, message) {
  if (!pattern.test(source)) {
    throw new Error(message);
  }
}

function assertMatchCount(source, pattern, expectedCount, message) {
  const matches = source.match(pattern) ?? [];
  if (matches.length < expectedCount) {
    throw new Error(`${message} (found ${matches.length}, expected at least ${expectedCount})`);
  }
}

const store = read('lib/server/notebook-problems/import-batch-store.ts');
const courseRoute = read('app/api/courses/[id]/problems/import-commit/route.ts');
const notebookRoute = read('app/api/notebooks/[id]/problems/import-commit/route.ts');
const problemService = read('lib/server/notebook-problems/service.ts');
const problemDedupe = read('features/problems/domain/problem-dedupe.ts');
const sourceIngestion = read('features/memory/server/source-upload-ingestion.ts');
const coursePreviewRoute = read('app/api/courses/[id]/problems/import-preview/route.ts');
const notebookDirectRoute = read('app/api/notebooks/[id]/problems/route.ts');
const courseProblemController = read(
  'components/problem-bank/use-course-problem-bank-controller.ts',
);
const schema = read('prisma/schema.prisma');
const dedupeMigration = read(
  'prisma/migrations/20260727050000_add_course_problem_dedupe_key/migration.sql',
);
const client = read('lib/utils/notebook-problem-api.ts');
const docs = read('docs/api/problem-bank.md');

for (const [label, route] of [
  ['course import commit', courseRoute],
  ['notebook import commit', notebookRoute],
]) {
  assertMatch(
    route,
    /request\.headers\.get\('idempotency-key'\)[\s\S]*?idempotencyKey !== importBatchId/,
    `${label} must bind Idempotency-Key to importBatchId`,
  );
  assertMatch(
    route,
    /claimProblemImportBatchCommit\([\s\S]*?IMPORT_BATCH_COMMITTING/,
    `${label} must atomically claim a batch before writing`,
  );
  assertMatch(
    route,
    /importBatch\.status === 'committed'[\s\S]*?committedBatchResponse\(/,
    `${label} must replay committed batches`,
  );
  assertMatch(
    route,
    /state\.batchProblems\.length === importBatch\.committedCount[\s\S]*?markProblemImportBatchCommitted/,
    `${label} must reconcile a lost response after problem persistence`,
  );
  assertMatch(
    route,
    /readProblemImportCommitResult\(batch\)[\s\S]*?insertedCount:\s*replayed \? 0 : originalInsertedCount[\s\S]*?persistedInsertedCount:\s*originalInsertedCount[\s\S]*?reusedCount[\s\S]*?skippedCount:[\s\S]*?reusedProblemIds/,
    `${label} must restore and distinguish inserted, reused, and replay-skipped drafts`,
  );
  assertMatch(
    route,
    /problems:\s*problems\.map\(toClientProblem\)[\s\S]*?problemIds:\s*insertedProblemIds/,
    `${label} must keep the full UI list while reporting exact batch IDs separately`,
  );
  assertMatch(
    route,
    /commitPayloadHash && importBatch\.commitPayloadHash !== payloadHash[\s\S]*?IDEMPOTENCY_PAYLOAD_MISMATCH/,
    `${label} must reject idempotency-key payload drift`,
  );
  assertMatch(
    route,
    /status === 'committing'[\s\S]*?state\.batchProblems\.length > 0[\s\S]*?IMPORT_BATCH_PARTIAL_RESULT[\s\S]*?claimProblemImportBatchCommit/,
    `${label} must fail closed on partial rows and reclaim only an empty stale lease`,
  );
  assertMatch(
    route,
    /importBatchLeaseToken:\s*importBatch\?\.commitLeaseToken/,
    `${label} must pass its claim token into the write transaction`,
  );
}

assertMatch(
  store,
  /"status" = 'committing'[\s\S]*?"commitPayloadHash" = \$4[\s\S]*?"commitLeaseExpiresAt" = \$6[\s\S]*?"status" = 'previewed'[\s\S]*?"commitLeaseExpiresAt" <= CURRENT_TIMESTAMP[\s\S]*?RETURNING \*/,
  'batch claim must atomically bind the payload and support expired-lease takeover',
);
assertMatch(
  problemService,
  /assertProblemImportBatchCommitLeaseTx[\s\S]*?"commitLeaseToken" = \$\{leaseToken\}[\s\S]*?"commitLeaseExpiresAt" > CURRENT_TIMESTAMP[\s\S]*?FOR UPDATE/,
  'the problem write service must validate the live commit lease under row lock',
);
assertMatchCount(
  problemService,
  /await assertProblemImportBatchCommitLeaseTx\(tx, args\);/g,
  2,
  'both notebook and course writes must fence stale lease holders inside their insert transaction',
);
assertMatch(
  problemDedupe,
  /COURSE_PROBLEM_DEDUPE_VERSION\s*=\s*'v2'[\s\S]*?contentOnlyProblemFingerprint[\s\S]*?courseProblemDedupeKey[\s\S]*?:content:[\s\S]*?:full:/,
  'course dedupe keys must use one versioned canonical fingerprint contract',
);
assertMatch(
  schema,
  /dedupeKey\s+String\?[\s\S]*?@@unique\(\[courseId, dedupeKey\], map: "NotebookProblem_course_dedupe_key"\)/,
  'NotebookProblem must enforce course-level dedupe keys in the Prisma schema',
);
assertMatch(
  dedupeMigration,
  /ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT[\s\S]*?CREATE UNIQUE INDEX IF NOT EXISTS "NotebookProblem_course_dedupe_key"[\s\S]*?\("courseId", "dedupeKey"\)/,
  'the migration must add the nullable key and database uniqueness index without deleting problems',
);
assertMatch(
  problemService,
  /ensureCourseProblemDedupeStateTx[\s\S]*?pg_advisory_xact_lock[\s\S]*?SET "courseId" = notebook\."courseId"[\s\S]*?dedupeKey: null[\s\S]*?existingProblemIdByKey\.has\(dedupeKey\)[\s\S]*?skippedDraftIds\.push/,
  'course imports must serialize, backfill legacy scope, claim canonical keys, and skip duplicates',
);
assertMatch(
  problemService,
  /recordProblemImportBatchPersistedCountTx[\s\S]*?"committedCount" = \$\{args\.persistedCount\}[\s\S]*?"commitResultJson" = CAST\(\$\{JSON\.stringify\(args\.writeSummary\)\} AS JSONB\)[\s\S]*?persistedCount: insertedProblemIds\.length[\s\S]*?writeSummary:/,
  'deduped commits must persist their exact result inside the fenced write transaction',
);
assertMatch(
  coursePreviewRoute,
  /previewCourseProblemDraftDedupe[\s\S]*?draftSnapshot: dedupe\.uniqueDrafts[\s\S]*?duplicateCount: dedupe\.duplicates\.length/,
  'course preview must expose and remove existing or same-preview duplicates before commit',
);
assertMatch(
  coursePreviewRoute,
  /dedupe\.uniqueDrafts\.length === 0[\s\S]*?markProblemImportBatchCommitted[\s\S]*?requestedCount: result\.drafts\.length[\s\S]*?reusedProblemIds: dedupe\.reusedProblemIds/,
  'an all-duplicate preview must finish as a committed no-op with reusable IDs',
);
assertMatch(
  sourceIngestion,
  /createCourseProblemsFromDraftsWithSummary[\s\S]*?atomicDuplicateMatches[\s\S]*?insertedProblemCount \+ atomicDuplicateMatches\.length[\s\S]*?duplicateMatches/,
  'source ingestion must reconcile preflight dedupe with the atomic database write result',
);
assertMatch(
  store,
  /releaseProblemImportBatchCommit[\s\S]*?"status" = 'previewed'[\s\S]*?"status" = 'committing'/,
  'a failed pre-write commit must be safely releasable',
);
assertMatch(
  docs,
  /Idempotency-Key: batch_[\s\S]*?previewed → committing → committed[\s\S]*?IDEMPOTENCY_PAYLOAD_MISMATCH[\s\S]*?五分钟租约[\s\S]*?replayed=true/,
  'problem-bank docs must explain the retry contract',
);
assertMatch(
  client,
  /commitNotebookProblemImport[\s\S]*?'Idempotency-Key': args\.importBatchId[\s\S]*?commitCourseProblemImport[\s\S]*?'Idempotency-Key': args\.importBatchId/,
  'first-party commit clients must send the batch idempotency key',
);
assertMatch(
  notebookDirectRoute,
  /createNotebookProblemsFromDraftsWithSummary[\s\S]*?insertedCount:\s*writeResult\.writeSummary\.insertedProblemIds\.length[\s\S]*?reusedCount:\s*writeResult\.writeSummary\.reusedProblemIds\.length[\s\S]*?skippedCount:\s*writeResult\.writeSummary\.skippedDraftIds\.length/,
  'direct notebook inserts must report actual deduped write counts',
);
assertMatch(
  courseProblemController,
  /previewResult\.dedupe\.duplicateCount[\s\S]*?新增 0 道[\s\S]*?commitCourseProblemImportWithSummary[\s\S]*?importSummary\.insertedCount[\s\S]*?importSummary\.reusedCount/,
  'course problem UI must surface preview and commit dedupe results',
);
assertMatch(
  schema,
  /commitResultJson\s+Json\?/,
  'ProblemImportBatch must persist exact commit results',
);
assertMatch(
  dedupeMigration,
  /ALTER TABLE "ProblemImportBatch"[\s\S]*?ADD COLUMN IF NOT EXISTS "commitResultJson" JSONB/,
  'the migration must add durable import commit results',
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checks: [
        'course batch claim and replay',
        'notebook batch claim and replay',
        'lost-response reconciliation',
        'expired-lease recovery',
        'transactional lease fencing',
        'payload hash conflict',
        'full-list UI compatibility',
        'Idempotency-Key binding',
        'first-party idempotency header',
        'inserted/skipped retry accounting',
        'course-level atomic fingerprint uniqueness',
        'legacy problem scope preservation',
        'preview and source-ingest dedupe parity',
      ],
    },
    null,
    2,
  )}\n`,
);
