ALTER TABLE "NotebookProblem"
ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "NotebookProblem_course_dedupe_key"
ON "NotebookProblem"("courseId", "dedupeKey");

ALTER TABLE "ProblemImportBatch"
ADD COLUMN IF NOT EXISTS "commitResultJson" JSONB;

ALTER TABLE "CourseSource"
ADD COLUMN IF NOT EXISTS "ingestLeaseToken" TEXT,
ADD COLUMN IF NOT EXISTS "ingestLeaseExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "CourseSource_ingest_status_lease_idx"
ON "CourseSource"("ingestStatus", "ingestLeaseExpiresAt");
