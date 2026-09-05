CREATE TABLE "BackgroundJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "courseId" TEXT REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "result" BYTEA,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "BackgroundJob_ownerId_dedupeKey_key" ON "BackgroundJob"("ownerId", "dedupeKey");
CREATE INDEX "BackgroundJob_status_availableAt_leaseUntil_idx" ON "BackgroundJob"("status", "availableAt", "leaseUntil");
CREATE INDEX "BackgroundJob_ownerId_courseId_kind_createdAt_idx" ON "BackgroundJob"("ownerId", "courseId", "kind", "createdAt");
CREATE TABLE "BackgroundJobStep" (
  "jobId" TEXT NOT NULL REFERENCES "BackgroundJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "key" TEXT NOT NULL,
  "result" BYTEA NOT NULL,
  PRIMARY KEY ("jobId", "key")
);
