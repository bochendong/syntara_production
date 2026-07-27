#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireText(relativePath, pattern, label) {
  const text = read(relativePath);
  if (!pattern.test(text)) failures.push(`${label}: ${relativePath}`);
}

function forbidText(relativePath, pattern, label) {
  const text = read(relativePath);
  if (pattern.test(text)) failures.push(`${label}: ${relativePath}`);
}

const schemaPath = 'prisma/schema.prisma';
const migrationPath =
  'prisma/migrations/20260723080000_add_course_source_knowledge_search/migration.sql';
const ingestRoutePath = 'app/api/courses/[id]/source-ingest/route.ts';
const sourceStorePath = 'features/memory/server/course-source-store.ts';
const sourceLibraryPath = 'features/memory/server/source-upload-library.ts';
const sourceListRoutePath = 'app/api/courses/[id]/source-uploads/route.ts';
const sourceReindexRoutePath = 'app/api/courses/[id]/source-uploads/[sourceHash]/reindex/route.ts';
const sourceUploadClientPath = 'lib/utils/course-source-upload-api.ts';
const indexPath = 'lib/server/knowledge-document-index.ts';
const unlinkedProjectionPath = 'lib/server/unlinked-course-knowledge-projection.ts';
const notebookRepositoryPath = 'lib/server/repositories/notebook-repository.ts';
const safetyPath = 'scripts/maintenance/course-knowledge-migration-safety.mjs';
const backfillPath = 'scripts/maintenance/backfill-course-source-knowledge.mjs';
const reindexPath = 'scripts/maintenance/reindex-course-knowledge-chunks.mjs';
const learnPagePath = 'components/learn/learn-page-client.tsx';

requireText(schemaPath, /\bmodel CourseSource\s*\{/, 'CourseSource model is missing');
requireText(
  schemaPath,
  /@@unique\(\[courseId,\s*sourceHash\]/,
  'CourseSource must be unique inside one course',
);
requireText(schemaPath, /\bextractedText\s+String\?\s+@db\.Text/, 'source truth text is missing');
requireText(
  schemaPath,
  /\bindexLeaseToken\s+String\?[\s\S]*\bindexLeaseExpiresAt\s+DateTime\?/,
  'source index task lease fields are missing',
);
requireText(schemaPath, /\bmodel KnowledgeDocument\s*\{/, 'KnowledgeDocument model is missing');
requireText(schemaPath, /\bmodel KnowledgeChunk\s*\{/, 'KnowledgeChunk model is missing');

requireText(migrationPath, /CREATE EXTENSION IF NOT EXISTS vector;/, 'pgvector is missing');
requireText(migrationPath, /CREATE EXTENSION IF NOT EXISTS pg_trgm;/, 'pg_trgm is missing');
requireText(migrationPath, /USING GIN \(to_tsvector/, 'lexical GIN index is missing');
requireText(migrationPath, /USING hnsw \("embedding" vector_cosine_ops\)/, 'HNSW is missing');
requireText(
  migrationPath,
  /markCourseKnowledgeProjectionStale/,
  'business-truth staleness trigger is missing',
);
requireText(
  migrationPath,
  /MarkdownNotebookSection_search_projection_insert/,
  'new markdown sections must invalidate their source projection',
);
requireText(
  migrationPath,
  /NotebookProblem_search_projection_insert/,
  'new public problems must invalidate their source projection',
);
requireText(
  migrationPath,
  /entity_type = 'CourseSource'[\s\S]*WHERE "id" = NEW\."id"/,
  'CourseSource must invalidate before its first projection exists',
);
requireText(
  migrationPath,
  /"indexStatus" = 'pending',[\s\S]*"indexLeaseToken" = NULL,[\s\S]*"indexLeaseExpiresAt" = NULL/,
  'business changes must revoke an active source index lease',
);
forbidText(
  migrationPath,
  /^\s*(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE[\s\S]*?DROP\s+COLUMN)\b/im,
  'additive migration contains a destructive statement',
);

requireText(ingestRoutePath, /markCourseSourceProcessing\(/, 'processing state is missing');
requireText(ingestRoutePath, /extractedText:\s*payload\.text/, 'source text is not persisted');
requireText(ingestRoutePath, /markCourseSourceReady\(/, 'ready state is missing');
requireText(ingestRoutePath, /markCourseSourceError\(/, 'error state is missing');
requireText(ingestRoutePath, /after\(async \(\) =>/, 'post-response indexing is missing');
requireText(ingestRoutePath, /indexCourseSourceKnowledge\(/, 'source indexer is not wired');
requireText(
  ingestRoutePath,
  /findOwnedCourse\([\s\S]*if \(!course\)[\s\S]*parseSourceUploadPayload\(/,
  'course ownership must be checked before parsing or remote file work',
);
requireText(
  ingestRoutePath,
  /MAX_SOURCE_TEXT_CHARS\s*=\s*220_000[\s\S]*SOURCE_TEXT_TOO_LARGE/,
  'source text must have an explicit hard size limit',
);

requireText(
  sourceStorePath,
  /listStoredCourseSources[\s\S]*WHERE "courseId" = \$\{args\.courseId\}[\s\S]*AND "ownerId" = \$\{args\.ownerId\}/,
  'CourseSource reads are not owner/course scoped',
);
requireText(
  sourceLibraryPath,
  /course\.ownerId === args\.userId[\s\S]*hasCourseEnrollment\([\s\S]*accessRole: 'enrolled'/,
  'course readers must resolve materials through the course owner',
);
requireText(
  sourceLibraryPath,
  /accessRole === 'owner'[\s\S]*openaiFileIds:\s*\[\]/,
  'enrolled readers must not receive internal source identifiers',
);
requireText(
  sourceLibraryPath,
  /const stored = await listStoredCourseSources\(/,
  'CourseSource catalog is not the primary list path',
);
requireText(
  sourceLibraryPath,
  /COURSE_SOURCE_CATALOG_READ_MODE[\s\S]*=== 'dual'[\s\S]*\? 'dual'\s*:\s*'catalog'/,
  'source catalog read mode must default to catalog',
);
requireText(
  sourceLibraryPath,
  /const \[stored, collection\] = await runDatabaseReads\([\s\S]*listStoredCourseSources[\s\S]*collectCourseSourceUploads[\s\S]*args\.serializeDatabaseReads === true/,
  'dual mode must support serialized deletion snapshots without changing its default read mode',
);
requireText(
  sourceLibraryPath,
  /mergeCatalogAndLegacySourceRecords[\s\S]*new Map\(args\.legacy[\s\S]*mergeStoredSourceWithArtifacts/,
  'dual mode must deduplicate by source hash and preserve catalog state',
);
requireText(
  sourceLibraryPath,
  /if \(!serialize\)[\s\S]*Promise\.all\(reads\.map/,
  'ordinary legacy compatibility aggregation must remain parallelized',
);
requireText(
  sourceListRoutePath,
  /claimCourseSourceKnowledgeIndex\([\s\S]*claim\.claimed[\s\S]*after\(async \(\) =>[\s\S]*leaseToken:\s*source\.leaseToken/,
  'authorized catalog reads must atomically claim retryable source projections',
);
requireText(
  sourceListRoutePath,
  /upload\.indexStatus === 'pending'[\s\S]*upload\.indexStatus === 'indexing'[\s\S]*upload\.indexStatus === 'error'/,
  'authorized catalog reads must retry durable source projection errors',
);
requireText(
  sourceListRoutePath,
  /uploads\.every\([\s\S]*isLegacySectionSourceHash\(upload\.sourceHash\)[\s\S]*upload\.indexStatus === 'ready'[\s\S]*scheduleUnlinkedCourseKnowledgeProjectionReconciliation/,
  'unlinked projection reconciliation must not contend with an unsettled source index',
);
requireText(
  sourceReindexRoutePath,
  /claimCourseSourceKnowledgeIndex\([\s\S]*!claim\.claimed[\s\S]*alreadyQueued:\s*true[\s\S]*leaseToken:\s*claim\.leaseToken/,
  'manual source reindex requests must use the same idempotent task lease',
);
requireText(
  sourceReindexRoutePath,
  /localOnlyParam[\s\S]*localOnly only accepts 1[\s\S]*embeddingMode:\s*localOnly \? 'disabled' : 'provider'/,
  'manual source reindex must expose an explicit local-only embedding mode',
);
requireText(
  sourceUploadClientPath,
  /allowExternalEmbeddings\?:\s*boolean[\s\S]*if \(!args\.allowExternalEmbeddings\) params\.set\('localOnly',\s*'1'\)/,
  'first-party source reindex retries must default to local-only processing',
);

requireText(indexPath, /courseId:\s*string;/, 'courseId must be mandatory for knowledge search');
requireText(
  indexPath,
  /embeddingMode\?:\s*'provider' \| 'disabled'[\s\S]*const embeddingsDisabled = args\.embeddingMode === 'disabled'[\s\S]*\? \{ embeddings:\s*\[\] as number\[\]\[\], reason:\s*'embedding_disabled' as const \}[\s\S]*:\s*await createEmbeddings/,
  'local-only indexing must bypass the external embedding provider',
);
requireText(
  indexPath,
  /p\."publicContentJson"::text AS "publicText"/,
  'public problem content is not indexed',
);
forbidText(indexPath, /p\."gradingJson"/, 'grading content must never enter the projection');
forbidText(
  indexPath,
  /(?:FROM\s+"NotebookProblemSecret"|\.notebookProblemSecret\b)/,
  'problem secrets must never be queried',
);
requireText(
  indexPath,
  /source\."kind" <> 'problem_bank'[\s\S]*allQuestionUpload/,
  'raw problem-bank uploads must not enter AI search',
);
requireText(
  indexPath,
  /indexedCount !== expectedCount[\s\S]*available:\s*false/,
  'partial projection must force legacy fallback',
);
requireText(
  indexPath,
  /d\."chunkCount" = \([\s\S]*COUNT\(\*\)[\s\S]*invalid_chunk\."courseSourceId" IS DISTINCT FROM d\."courseSourceId"/,
  'search coverage must reject incomplete or cross-scope chunk projections',
);
requireText(indexPath, /WITH lexical_candidates AS/, 'lexical candidate CTE is missing');
requireText(indexPath, /semantic_candidates AS/, 'semantic candidate CTE is missing');
requireText(
  indexPath,
  /WITH lexical_candidates AS \([\s\S]*?FROM "CourseSource" lexical_source[\s\S]*?lexical_source\."ownerId" = d\."ownerId"[\s\S]*?lexical_source\."courseId" = d\."courseId"[\s\S]*?lexical_source\."indexStatus" = 'ready'[\s\S]*?semantic_candidates AS/,
  'lexical retrieval must recheck linked source ownership and readiness',
);
requireText(
  indexPath,
  /semantic_candidates AS \([\s\S]*?FROM "CourseSource" semantic_source[\s\S]*?semantic_source\."ownerId" = d\."ownerId"[\s\S]*?semantic_source\."courseId" = d\."courseId"[\s\S]*?semantic_source\."indexStatus" = 'ready'[\s\S]*?candidate_scores AS/,
  'semantic retrieval must recheck linked source ownership and readiness',
);
requireText(
  indexPath,
  /LEFT\(d\."content",\s*9000\) AS "content"/,
  'hybrid retrieval must not transfer an entire knowledge document per candidate',
);

requireText(
  unlinkedProjectionPath,
  /p\."publicContentJson"::text AS "publicText"/,
  'manual problem projection must use public problem content',
);
forbidText(
  unlinkedProjectionPath,
  /(?:p\."gradingJson"|FROM\s+"NotebookProblemSecret"|\.notebookProblemSecret\b)/,
  'manual projection must never read grading or secret problem data',
);
requireText(
  unlinkedProjectionPath,
  /loadUnlinkedCourseDocuments\(tx,[\s\S]*row\.notebookId === expected\.document\.notebookId[\s\S]*row\.contentHash === expected\.document\.contentHash[\s\S]*sameJson\(row\.metadataJson,[\s\S]*dateValue\(row\.publishedAt\)[\s\S]*row\.chunkHashes\.every/,
  'manual projection must compare ready state with current business truth and chunks',
);
requireText(
  unlinkedProjectionPath,
  /NOT EXISTS \([\s\S]*FROM "CourseSource" source[\s\S]*source\."courseId" = \$1[\s\S]*source\."sourceHash"/,
  'source metadata is linked only when the same course owns a matching CourseSource',
);
requireText(
  unlinkedProjectionPath,
  /inspectUnlinkedCourseKnowledgeProjection[\s\S]*pg_advisory_xact_lock[\s\S]*expectedFingerprint/,
  'manual projection inspection must be serialized with its rebuild',
);
requireText(
  unlinkedProjectionPath,
  /ON CONFLICT \("courseId", "documentKey"\)[\s\S]*WHERE "KnowledgeDocument"\."courseSourceId" IS NULL[\s\S]*source_linked_ownership_conflict/,
  'manual projection must never take ownership from a source-linked document',
);
requireText(
  unlinkedProjectionPath,
  /const priorOwners[\s\S]*NOT EXISTS \([\s\S]*FROM "CourseSource" source[\s\S]*UPDATE "CourseSource"[\s\S]*"indexStatus" = 'pending'[\s\S]*UPDATE "KnowledgeDocument" d[\s\S]*NOT EXISTS \(/,
  'linked-to-unlinked handoff must lock source first and recheck business truth before detaching',
);
requireText(
  indexPath,
  /knowledge-course:\$\{args\.courseId\}/,
  'source-linked projection must use the course-level projection lock',
);
requireText(
  unlinkedProjectionPath,
  /knowledge-course:\$\{args\.courseId\}/,
  'manual projection must use the same course-level projection lock',
);
forbidText(
  indexPath,
  /knowledge-source:/,
  'source-linked projection still uses a non-exclusive per-source lock',
);
forbidText(
  unlinkedProjectionPath,
  /knowledge-unlinked:/,
  'manual projection still uses a non-exclusive projection lock',
);
requireText(
  unlinkedProjectionPath,
  /pg_advisory_xact_lock[\s\S]*documentsFingerprint\(freshDocuments\)/,
  'manual projection rebuild must reject concurrent source changes',
);
requireText(
  unlinkedProjectionPath,
  /documentsFingerprint\(settledDocuments\) !== fingerprint[\s\S]*"status" = 'stale'[\s\S]*"courseSourceId" IS NULL/,
  'manual projection must not commit a changed source snapshot as ready',
);
requireText(
  'app/api/courses/[id]/source-uploads/route.ts',
  /scheduleUnlinkedCourseKnowledgeProjectionReconciliation\(/,
  'source reads must retry missing or stale manual projections',
);
requireText(
  unlinkedProjectionPath,
  /inspection failure is not evidence[\s\S]*pending: false/,
  'inspection failures must not be treated as proof that an immediate rebuild is needed',
);
requireText(
  unlinkedProjectionPath,
  /reconciliationFailureBackoffMs[\s\S]*RECONCILIATION_MAX_BACKOFF_MS[\s\S]*inspection\.errorReason[\s\S]*retryAfterMs[\s\S]*state\.retryNotBefore = Date\.now\(\) \+ retryAfterMs/,
  'reconciliation failures must use bounded per-course backoff instead of hot-looping',
);
requireText(
  'app/api/notebooks/route.ts',
  /existing\.courseId[\s\S]*notebook\?\.courseId[\s\S]*scheduleUnlinkedCourseKnowledgeProjectionSync\(/,
  'Notebook upserts must rebuild both old and new course projections',
);
requireText(
  'app/api/notebooks/[id]/route.ts',
  /const courseChanged = existing\.courseId !== notebook\.courseId[\s\S]*const nameChanged = existing\.name !== notebook\.name[\s\S]*affectedCourseIds[\s\S]*notebook_deleted/,
  'Notebook rename, move, and delete mutations must rebuild affected course projections',
);
requireText(
  'app/api/courses/[id]/notebooks/route.ts',
  /findOwnedNotebookId\([\s\S]*existing\.courseId !== id[\s\S]*notebook_detached_from_course[\s\S]*notebook_attached_to_course/,
  'Course notebook assignment must rebuild old and new course projections',
);
requireText(
  notebookRepositoryPath,
  /return await db\.\$transaction\([\s\S]*?const courseChanged[\s\S]*?lockCourseProblemDedupeScopes[\s\S]*?markdownNotebookSection\.updateMany[\s\S]*?notebookProblem\.updateMany/,
  'Notebook course moves must atomically move course-owned child content',
);
requireText(
  notebookRepositoryPath,
  /else if \(nameChanged\)[\s\S]*UPDATE "MarkdownNotebookSection"[\s\S]*SET "courseId" = "courseId"[\s\S]*UPDATE "NotebookProblem"/,
  'Notebook rename must atomically invalidate linked and unlinked child projections',
);
requireText(
  'app/api/courses/[id]/problems/[problemId]/route.ts',
  /scheduleUnlinkedCourseKnowledgeProjectionSync\(/,
  'course problem mutations must schedule projection sync',
);
requireText(
  indexPath,
  /documentsFingerprint\([\s\S]*freshDocuments[\s\S]*source_changed_during_index/,
  'index completion must recheck the current business content fingerprint',
);
requireText(
  indexPath,
  /const COURSE_SOURCE_INDEX_TRANSACTION_OPTIONS = \{[\s\S]*maxWait:\s*30_000,[\s\S]*timeout:\s*300_000,[\s\S]*\} as const;/,
  'source projection transactions must have an explicit remote-database budget',
);
const indexTransactionBudgetUses =
  read(indexPath).match(/COURSE_SOURCE_INDEX_TRANSACTION_OPTIONS/g)?.length || 0;
if (indexTransactionBudgetUses !== 3) {
  failures.push(`both source projection transactions must use the explicit budget: ${indexPath}`);
}
requireText(
  indexPath,
  /UPDATE "CourseSource"[\s\S]*"indexLeaseToken" = \$4[\s\S]*"indexLeaseExpiresAt" = CURRENT_TIMESTAMP \+ INTERVAL '15 minutes'[\s\S]*"indexStatus" IN \('pending', 'error'\)[\s\S]*"indexLeaseExpiresAt" <= CURRENT_TIMESTAMP/,
  'source indexing must atomically claim a bounded lease',
);
requireText(
  indexPath,
  /loadReadyCourseSource[\s\S]*"indexLeaseToken" = \$4[\s\S]*forUpdate[\s\S]*leaseToken/,
  'source indexing must recheck lease ownership inside the projection transaction',
);
requireText(
  indexPath,
  /updateCourseSourceIndexState[\s\S]*"indexLeaseToken" = \$5[\s\S]*indexStatus: 'ready'[\s\S]*leaseToken[\s\S]*indexStatus: 'error'[\s\S]*leaseToken/,
  'every source index completion path must settle with the current lease token',
);
requireText(
  indexPath,
  /hnsw\.iterative_scan = 'strict_order'/,
  'filtered HNSW search must enable iterative scan when pgvector supports it',
);
for (const lockPath of [indexPath, unlinkedProjectionPath, backfillPath]) {
  requireText(
    lockPath,
    /pg_advisory_xact_lock\(hashtext\(\$1\)\)::text AS "locked"/,
    'course projection locks must return a Prisma-deserializable value',
  );
  forbidText(
    lockPath,
    /pg_advisory_xact_lock\(hashtext\(\$1\)\)(?!::text)/,
    'course projection lock still returns PostgreSQL void',
  );
}

requireText(safetyPath, /dry-run by default/, 'maintenance scripts must default to dry-run');
requireText(
  safetyPath,
  /ALLOW_REMOTE_COURSE_KNOWLEDGE_MIGRATION/,
  'remote write acknowledgement is missing',
);
requireText(
  backfillPath,
  /publicContentJson:\s*true/,
  'backfill must select public problem content',
);
forbidText(backfillPath, /gradingJson:\s*true/, 'backfill must not select grading content');
requireText(
  backfillPath,
  /prisma\.\$transaction\([\s\S]*pg_advisory_xact_lock\(hashtext\(\$1\)\)[\s\S]*knowledge-course:\$\{courseHint\.id\}/,
  'each course backfill must use the shared course-level projection lock inside one transaction',
);
requireText(
  backfillPath,
  /const initialSnapshot = await loadCourseSnapshot\(tx,[\s\S]*const finalSnapshot = await loadCourseSnapshot\(tx,[\s\S]*finalSnapshot\.fingerprint !== initialSnapshot\.fingerprint[\s\S]*rolled back course/,
  'backfill must roll back if the legacy course snapshot changes before settlement',
);
requireText(
  backfillPath,
  /const recoveredOnly = \{[\s\S]*extractedTextRecoveredFromLegacyArtifacts[\s\S]*equals:\s*true[\s\S]*courseSource\.updateMany\([\s\S]*where:\s*recoveredOnly[\s\S]*courseSource\.createMany\([\s\S]*skipDuplicates:\s*true/,
  'backfill must update only recovered sources and preserve an authoritative ingestion winner',
);
forbidText(
  backfillPath,
  /courseSource\.upsert\(/,
  'backfill must not overwrite authoritative CourseSource rows with an unconditional upsert',
);
requireText(
  backfillPath,
  /upsertDocument\(tx,[\s\S]*(?:safeDocument|document)\.sourceHash && !courseSourceId[\s\S]*status:\s*'protected_source'/,
  'source-linked documents must be written only for writable recovered sources',
);
forbidText(
  backfillPath,
  /knowledgeDocument\.deleteMany\(/,
  'backfill must not broadly prune projections that concurrent runtime writers may own',
);
requireText(
  backfillPath,
  /finalizeRecoveredSources[\s\S]*metadataJson:[\s\S]*extractedTextRecoveredFromLegacyArtifacts[\s\S]*equals:\s*true[\s\S]*indexStatus:\s*'ready'/,
  'lexical backfill must become usable without embeddings',
);
requireText(
  reindexPath,
  /INNER JOIN "KnowledgeDocument" d[\s\S]*d\."status" = 'ready'/,
  'embedding reindex must not revive stale documents',
);
requireText(
  reindexPath,
  /AND "contentHash" = \$5[\s\S]*AND "embedding" IS NULL/,
  'embedding writes must reject chunks that changed after selection',
);
requireText(
  reindexPath,
  /c\."courseId" = d\."courseId"[\s\S]*c\."courseSourceId" IS NOT DISTINCT FROM d\."courseSourceId"[\s\S]*d\."chunkCount" = \(/,
  'embedding maintenance must preserve denormalized course and document scope',
);

requireText(learnPagePath, /AI 索引中/, 'indexing state is not visible');
requireText(learnPagePath, /AI 索引失败/, 'index error state is not visible');
requireText(learnPagePath, /retryCourseSourceIndex\(/, 'index retry is not wired');
requireText(
  learnPagePath,
  /COURSE_SOURCE_PROCESSING_SLOW_MS\s*=\s*3 \* 60_000[\s\S]*COURSE_SOURCE_PROCESSING_HARD_TIMEOUT_MS\s*=\s*15 \* 60_000/,
  'slow processing must remain distinct from a real hard timeout',
);
requireText(
  learnPagePath,
  /timeoutMs:\s*COURSE_SOURCE_UPLOAD_TIMEOUT_MS/,
  'source upload requests must have a bounded client timeout',
);

if (failures.length > 0) {
  console.error(['Course knowledge contract verification failed:', ...failures].join('\n- '));
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify(
      {
        ok: true,
        contracts: [
          'course-owned source truth',
          'independent ingest/index lifecycle',
          'rebuildable hybrid search projection',
          'public-only problem retrieval',
          'partial-index fallback',
          'truth-derived unlinked entity reconciliation',
          'local-only reindex without external source-text embeddings',
          'dry-run and remote-write safety',
          'visible timeout/error/retry state',
        ],
      },
      null,
      2,
    ),
  );
}
