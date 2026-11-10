BEGIN;

SET LOCAL lock_timeout = '5s';

-- The former production release removed these fields and made existing
-- problems available without a publication filter. Preserve that visibility.
DO $$
BEGIN
  IF to_regtype('"NotebookProblemStatus"') IS NULL THEN
    CREATE TYPE "NotebookProblemStatus" AS ENUM ('draft', 'published', 'archived');
  END IF;
END;
$$;

ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "publishedProblemCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Notebook" ADD COLUMN IF NOT EXISTS "publishedProblemCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NotebookProblem"
  ADD COLUMN IF NOT EXISTS "status" "NotebookProblemStatus" NOT NULL DEFAULT 'published';
ALTER TABLE "NotebookProblem" ALTER COLUMN "status" SET DEFAULT 'draft';

CREATE INDEX IF NOT EXISTS "NotebookProblem_courseId_status_order_idx"
ON "NotebookProblem" ("courseId", "status", "order");

CREATE OR REPLACE TRIGGER "NotebookProblem_search_projection_stale"
AFTER UPDATE OF "courseId", "notebookId", "title", "type", "status", "tags", "difficulty", "publicContentJson", "sourceMeta" OR DELETE
ON "NotebookProblem"
FOR EACH ROW EXECUTE FUNCTION "markCourseKnowledgeProjectionStale"();

-- A problem can belong to a course directly, through a notebook, or both.
WITH course_problems AS (
  SELECT "courseId", "id" FROM "NotebookProblem"
  WHERE "status" = 'published' AND "courseId" IS NOT NULL
  UNION
  SELECT notebook."courseId", problem."id" FROM "NotebookProblem" AS problem
  JOIN "Notebook" AS notebook ON notebook."id" = problem."notebookId"
  WHERE problem."status" = 'published' AND notebook."courseId" IS NOT NULL
), course_counts AS (
  SELECT "courseId", COUNT(*)::INTEGER AS count FROM course_problems GROUP BY "courseId"
)
UPDATE "Course" AS course
SET "publishedProblemCount" = COALESCE(counts.count, 0)
FROM "Course" AS target
LEFT JOIN course_counts AS counts ON counts."courseId" = target."id"
WHERE course."id" = target."id"
  AND course."publishedProblemCount" IS DISTINCT FROM COALESCE(counts.count, 0);

WITH notebook_counts AS (
  SELECT "notebookId", COUNT(*)::INTEGER AS count FROM "NotebookProblem"
  WHERE "status" = 'published' AND "notebookId" IS NOT NULL
  GROUP BY "notebookId"
)
UPDATE "Notebook" AS notebook
SET "publishedProblemCount" = COALESCE(counts.count, 0)
FROM "Notebook" AS target
LEFT JOIN notebook_counts AS counts ON counts."notebookId" = target."id"
WHERE notebook."id" = target."id"
  AND notebook."publishedProblemCount" IS DISTINCT FROM COALESCE(counts.count, 0);

COMMIT;
