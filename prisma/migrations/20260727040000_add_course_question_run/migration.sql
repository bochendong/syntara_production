CREATE TABLE IF NOT EXISTS "CourseQuestionRun" (
  "id" TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "courseId" TEXT NOT NULL REFERENCES "Course"("id") ON DELETE CASCADE,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "question" TEXT NOT NULL,
  "answer" TEXT,
  "responseJson" JSONB,
  "conversationId" TEXT,
  "userMessageId" TEXT,
  "assistantMessageId" TEXT,
  "model" TEXT,
  "errorReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "CourseQuestionRun_owner_course_key_key"
  ON "CourseQuestionRun" ("ownerId", "courseId", "idempotencyKey");

CREATE INDEX IF NOT EXISTS "CourseQuestionRun_owner_course_updated_idx"
  ON "CourseQuestionRun" ("ownerId", "courseId", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "CourseQuestionRun_status_lease_idx"
  ON "CourseQuestionRun" ("status", "leaseExpiresAt");
