CREATE TABLE "LearningCalendarEvent" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "courseId" TEXT,
  "clientEventId" VARCHAR(200),
  "title" VARCHAR(500) NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "eventDate" DATE NOT NULL,
  "startTime" VARCHAR(5),
  "sourceName" VARCHAR(300) NOT NULL,
  "origin" VARCHAR(32),
  "sourceRefType" VARCHAR(32),
  "sourceRefId" VARCHAR(200),
  "proposalId" VARCHAR(200),
  "durationMinutes" INTEGER,
  "status" VARCHAR(16),
  "week" VARCHAR(120),
  "sourceColumn" VARCHAR(200),
  "rawText" VARCHAR(3000),
  "confidence" DOUBLE PRECISION,
  "version" INTEGER NOT NULL DEFAULT 1,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LearningCalendarEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LearningCalendarEvent_durationMinutes_check"
    CHECK ("durationMinutes" IS NULL OR ("durationMinutes" >= 5 AND "durationMinutes" <= 1440)),
  CONSTRAINT "LearningCalendarEvent_confidence_check"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  CONSTRAINT "LearningCalendarEvent_version_check" CHECK ("version" >= 1),
  CONSTRAINT "LearningCalendarEvent_startTime_check"
    CHECK ("startTime" IS NULL OR "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

CREATE TABLE "LearningCalendarMutation" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "operation" VARCHAR(32) NOT NULL,
  "responseJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LearningCalendarMutation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearningCalendarEvent_ownerId_clientEventId_key"
  ON "LearningCalendarEvent" ("ownerId", "clientEventId");

CREATE INDEX "LearningCalendarEvent_ownerId_deletedAt_eventDate_id_idx"
  ON "LearningCalendarEvent" ("ownerId", "deletedAt", "eventDate", "id");

CREATE INDEX "LearningCalendarEvent_ownerId_courseId_deletedAt_eventDate_id_idx"
  ON "LearningCalendarEvent" ("ownerId", "courseId", "deletedAt", "eventDate", "id");

CREATE UNIQUE INDEX "LearningCalendarMutation_ownerId_idempotencyKey_key"
  ON "LearningCalendarMutation" ("ownerId", "idempotencyKey");

CREATE INDEX "LearningCalendarMutation_ownerId_createdAt_idx"
  ON "LearningCalendarMutation" ("ownerId", "createdAt" DESC);

ALTER TABLE "LearningCalendarEvent"
  ADD CONSTRAINT "LearningCalendarEvent_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LearningCalendarEvent"
  ADD CONSTRAINT "LearningCalendarEvent_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LearningCalendarMutation"
  ADD CONSTRAINT "LearningCalendarMutation_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
