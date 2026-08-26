-- Make forum/community data account-scoped instead of course-owned.
-- Existing course-linked rows keep their courseId as historical context, but
-- course deletion no longer cascades into forum posts, communities, or DMs.

-- Collapse duplicate course-scoped DM threads into one global thread per pair
-- before enforcing the new account-level uniqueness.
WITH ranked_threads AS (
  SELECT
    id,
    "userAId",
    "userBId",
    ROW_NUMBER() OVER (
      PARTITION BY "userAId", "userBId"
      ORDER BY COALESCE("lastMessageAt", "updatedAt", "createdAt") DESC, "createdAt" DESC, id
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY "userAId", "userBId"
      ORDER BY COALESCE("lastMessageAt", "updatedAt", "createdAt") DESC, "createdAt" DESC, id
    ) AS keep_id
  FROM "DirectMessageThread"
)
UPDATE "DirectMessage"
SET "threadId" = ranked_threads.keep_id
FROM ranked_threads
WHERE "DirectMessage"."threadId" = ranked_threads.id
  AND ranked_threads.rn > 1;

DELETE FROM "DirectMessageThread"
USING (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "userAId", "userBId"
      ORDER BY COALESCE("lastMessageAt", "updatedAt", "createdAt") DESC, "createdAt" DESC, id
    ) AS rn
  FROM "DirectMessageThread"
) duplicates
WHERE "DirectMessageThread".id = duplicates.id
  AND duplicates.rn > 1;

ALTER TABLE "CourseForumPost" DROP CONSTRAINT IF EXISTS "CourseForumPost_courseId_fkey";
ALTER TABLE "Community" DROP CONSTRAINT IF EXISTS "Community_courseId_fkey";
ALTER TABLE "DirectMessageThread" DROP CONSTRAINT IF EXISTS "DirectMessageThread_courseId_fkey";

DROP INDEX IF EXISTS "DirectMessageThread_courseId_userAId_userBId_key";

ALTER TABLE "CourseForumPost" ALTER COLUMN "courseId" DROP NOT NULL;
ALTER TABLE "DirectMessageThread" ALTER COLUMN "courseId" DROP NOT NULL;

ALTER TABLE "CourseForumPost"
  ADD CONSTRAINT "CourseForumPost_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Community"
  ADD CONSTRAINT "Community_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DirectMessageThread"
  ADD CONSTRAINT "DirectMessageThread_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "DirectMessageThread_userAId_userBId_key"
  ON "DirectMessageThread"("userAId", "userBId");
