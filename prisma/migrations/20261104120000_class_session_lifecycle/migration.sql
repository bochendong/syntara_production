BEGIN;

-- Number every session within its class; earliest session is 第 1 节.
ALTER TABLE "ClassSession" ADD COLUMN "number" INTEGER;

UPDATE "ClassSession" AS session
SET "number" = numbered.position
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "classId" ORDER BY "startedAt", "id") AS position
  FROM "ClassSession"
) AS numbered
WHERE session."id" = numbered."id";

ALTER TABLE "ClassSession" ALTER COLUMN "number" SET NOT NULL;

-- Draft sessions have not started.
ALTER TABLE "ClassSession" ALTER COLUMN "startedAt" DROP NOT NULL;
ALTER TABLE "ClassSession" ALTER COLUMN "startedAt" DROP DEFAULT;

-- Only the newest live session of a class can stay live.
UPDATE "ClassSession" AS session
SET "status" = 'ended', "endedAt" = COALESCE(session."endedAt", CURRENT_TIMESTAMP), "code" = NULL
WHERE session."status" = 'live'
  AND EXISTS (
    SELECT 1 FROM "ClassSession" AS newer
    WHERE newer."classId" = session."classId"
      AND newer."status" = 'live'
      AND (newer."startedAt", newer."id") > (session."startedAt", session."id")
  );

CREATE UNIQUE INDEX "ClassSession_classId_number_key" ON "ClassSession"("classId", "number");

-- Prisma cannot declare a partial unique index, so it is maintained here only.
CREATE UNIQUE INDEX "ClassSession_one_live_per_class" ON "ClassSession"("classId") WHERE "status" = 'live';

ALTER TABLE "NotebookProblemAttempt" ADD COLUMN "classSessionId" TEXT;

-- Retain old statistics. If class windows overlapped, prefer the last time the problem was pushed.
WITH assignment AS (
  SELECT DISTINCT ON (attempt."id") attempt."id", item."sessionId"
  FROM "ClassSessionItem" AS item
  JOIN "ClassSession" AS session ON session."id" = item."sessionId"
  JOIN "ClassSessionParticipant" AS participant ON participant."sessionId" = session."id"
  JOIN "NotebookProblemAttempt" AS attempt
    ON attempt."problemId" = item."problemId" AND attempt."userId" = participant."userId"
  WHERE attempt."kind" IN ('submit', 'answer')
    AND COALESCE(attempt."timingSource", '') <> 'native-learning-snapshot'
    AND attempt."createdAt" >= item."pushedAt"
    AND attempt."createdAt" <= COALESCE(item."closedAt", session."endedAt", CURRENT_TIMESTAMP)
  ORDER BY attempt."id", item."pushedAt" DESC, session."startedAt" DESC, session."id" DESC
)
UPDATE "NotebookProblemAttempt" AS attempt
SET "classSessionId" = assignment."sessionId"
FROM assignment
WHERE attempt."id" = assignment."id";

CREATE INDEX "NotebookProblemAttempt_classSessionId_problemId_userId_crea_idx" ON "NotebookProblemAttempt"("classSessionId", "problemId", "userId", "createdAt" DESC);

ALTER TABLE "NotebookProblemAttempt" ADD CONSTRAINT "NotebookProblemAttempt_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "ClassSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
