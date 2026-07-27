#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function requireMatchCount(source, pattern, expectedCount, message) {
  const count = source.match(pattern)?.length ?? 0;
  if (count < expectedCount) {
    throw new Error(`${message} (found ${count}, expected at least ${expectedCount})`);
  }
}

const ingestion = read('features/memory/server/source-upload-ingestion.ts');
const sourceStore = read('features/memory/server/course-source-store.ts');
const route = read('app/api/courses/[id]/source-ingest/route.ts');
const problemService = read('lib/server/notebook-problems/service.ts');
const schema = read('prisma/schema.prisma');
const migration = read(
  'prisma/migrations/20260727050000_add_course_problem_dedupe_key/migration.sql',
);

const createBatchIndex = ingestion.indexOf('const importBatch = await createProblemImportBatch');
const claimBatchIndex = ingestion.indexOf(
  'const claimedBatch = await claimProblemImportBatchCommit',
);
const writeBatchIndex = ingestion.indexOf(
  'const writeResult = await createCourseProblemsFromDraftsWithSummary',
);
const commitBatchIndex = ingestion.indexOf(
  'const committedBatch = await markProblemImportBatchCommitted',
);
if (
  createBatchIndex < 0 ||
  claimBatchIndex <= createBatchIndex ||
  writeBatchIndex <= claimBatchIndex ||
  commitBatchIndex <= writeBatchIndex
) {
  throw new Error(
    'source problem ingestion must create, claim, transactionally write, then finalize its import batch',
  );
}

requireMatch(
  ingestion,
  /claimProblemImportBatchCommit\(\{[\s\S]*?commitCount:\s*uniqueSourceTaggedDrafts\.length[\s\S]*?payloadHash:\s*hashProblemImportCommitPayload\(uniqueSourceTaggedDrafts\)/,
  'source problem import claims must bind the exact write payload',
);
requireMatch(
  ingestion,
  /createCourseProblemsFromDraftsWithSummary\(\{[\s\S]*?drafts:\s*uniqueSourceTaggedDrafts[\s\S]*?importBatchId,[\s\S]*?importBatchLeaseToken/,
  'the problem writer must receive the claimed import-batch lease token',
);
requireMatch(
  problemService,
  /recordProblemImportBatchPersistedCountTx[\s\S]*?"commitResultJson" = CAST\(\$\{JSON\.stringify\(args\.writeSummary\)\} AS JSONB\)[\s\S]*?"commitLeaseToken" = \$\{leaseToken\}[\s\S]*?"commitLeaseExpiresAt" > CURRENT_TIMESTAMP/,
  'the problem writer transaction must persist its complete result behind the live batch fence',
);
requireMatch(
  ingestion,
  /markProblemImportBatchCommitted\(\{[\s\S]*?batchId:\s*importBatch\.id[\s\S]*?leaseToken:\s*importBatchLeaseToken[\s\S]*?\}\);[\s\S]*?if \(!committedBatch\)/,
  'source problem import finalization must use and verify the same lease token',
);

requireMatch(
  sourceStore,
  /COURSE_SOURCE_INGEST_LEASE_MS[\s\S]*?source_ingest_[\s\S]*?ingestLeaseExpiresAt/,
  'CourseSource processing reservations must mint an expiring lease',
);
requireMatch(
  sourceStore,
  /ON CONFLICT \("courseId", "sourceHash"\) DO UPDATE[\s\S]*?"CourseSource"\."ingestStatus" = 'processing'[\s\S]*?"CourseSource"\."ingestLeaseExpiresAt" <= CURRENT_TIMESTAMP/,
  'CourseSource may be reclaimed only from an expired processing lease',
);
requireMatchCount(
  sourceStore,
  /AND "ingestLeaseToken" = \$\{args\.leaseToken\}\s+AND "ingestLeaseExpiresAt" > CURRENT_TIMESTAMP/g,
  2,
  'CourseSource ready and error transitions must both require the live token and lease',
);
requireMatchCount(
  sourceStore,
  /"ingestLeaseToken" = NULL,[\s\S]*?"ingestLeaseExpiresAt" = NULL/g,
  2,
  'terminal CourseSource transitions must clear the ingest lease',
);

requireMatch(
  route,
  /storedSource\.source\.ingestStatus === 'processing'[\s\S]*?!isCourseSourceIngestLeaseActive\(storedSource\.source\)[\s\S]*?duplicateCourseSourceResponse\(storedSource\.source/,
  'an active same-hash source must remain a 409 conflict while only stale processing is recoverable',
);
const staleClaimIndex = route.indexOf('processingReservation = await markCourseSourceProcessing');
const staleCleanupIndex = route.indexOf('const recovery = await deleteCourseSourceUpload');
if (staleClaimIndex < 0 || staleCleanupIndex <= staleClaimIndex) {
  throw new Error('stale CourseSource recovery must atomically claim its token before cleanup');
}
requireMatch(
  route,
  /processingReservation = await markCourseSourceProcessing\(\{[\s\S]*?openaiFileId:\s*storedSource\.source\.openaiFileId/,
  'stale recovery must not put a newly uploaded retry file into the cleanup set',
);
requireMatchCount(
  route,
  /preserveCatalog:\s*true,\s*preserveProblems:\s*true/g,
  2,
  'stale takeover and failure compensation must preserve every problem',
);
requireMatch(
  route,
  /markCourseSourceReady\(\{[\s\S]*?leaseToken:\s*sourceLeaseToken/,
  'CourseSource ready finalization must carry the processing token',
);
requireMatch(
  route,
  /markCourseSourceError\(\{[\s\S]*?leaseToken:\s*sourceLeaseToken/,
  'CourseSource failure finalization must carry the processing token',
);
requireMatch(
  route,
  /if \(ownsFailedSourceLease\) \{[\s\S]*?deleteCourseSourceUpload\([\s\S]*?preserveProblems:\s*true[\s\S]*?\} else \{[\s\S]*?cleanup was skipped/,
  'a fenced-out request must never clean another ingest owner artifacts',
);

requireMatch(
  schema,
  /ingestLeaseToken\s+String\?[\s\S]*?ingestLeaseExpiresAt\s+DateTime\?/,
  'CourseSource ingest lease fields must exist in the Prisma schema',
);
requireMatch(
  schema,
  /@@index\(\[ingestStatus, ingestLeaseExpiresAt\], map: "CourseSource_ingest_status_lease_idx"\)/,
  'CourseSource stale-lease lookup must be indexed',
);
requireMatch(
  migration,
  /ADD COLUMN IF NOT EXISTS "ingestLeaseToken" TEXT[\s\S]*?ADD COLUMN IF NOT EXISTS "ingestLeaseExpiresAt" TIMESTAMP\(3\)[\s\S]*?CREATE INDEX IF NOT EXISTS "CourseSource_ingest_status_lease_idx"/,
  'the migration must add CourseSource lease columns and the stale lookup index',
);
if (/notebookProblem\.(?:delete|deleteMany)\s*\(/.test(route)) {
  throw new Error('source-ingest route must never directly delete course problems');
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checks: [
        'source problem batch claim before write',
        'transactional problem writer fencing',
        'token-fenced batch finalization',
        'CourseSource active conflict',
        'CourseSource expired takeover',
        'token-fenced ready and error transitions',
        'problem-preserving recovery',
        'stale worker cleanup suppression',
      ],
    },
    null,
    2,
  )}\n`,
);
