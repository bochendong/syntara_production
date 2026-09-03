-- Course-scoped two-level problem knowledge trees.
CREATE TABLE "CourseProblemTagNode" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" VARCHAR(120) NOT NULL,
  "normalizedName" VARCHAR(120) NOT NULL,
  "level" INTEGER NOT NULL,
  "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "source" VARCHAR(24) NOT NULL DEFAULT 'ai',
  "status" VARCHAR(24) NOT NULL DEFAULT 'active',
  "confidence" DOUBLE PRECISION,
  "position" INTEGER NOT NULL DEFAULT 0,
  "lockedByTeacher" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseProblemTagNode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotebookProblemTagAssignment" (
  "problemId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "source" VARCHAR(24) NOT NULL DEFAULT 'ai',
  "status" VARCHAR(24) NOT NULL DEFAULT 'applied',
  "confidence" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotebookProblemTagAssignment_pkey" PRIMARY KEY ("problemId", "tagId")
);

CREATE UNIQUE INDEX "CourseProblemTagNode_courseId_level_normalizedName_key"
  ON "CourseProblemTagNode"("courseId", "level", "normalizedName");
CREATE INDEX "CourseProblemTagNode_courseId_parentId_position_idx"
  ON "CourseProblemTagNode"("courseId", "parentId", "position");
CREATE INDEX "CourseProblemTagNode_courseId_status_level_idx"
  ON "CourseProblemTagNode"("courseId", "status", "level");
CREATE INDEX "NotebookProblemTagAssignment_tagId_status_problemId_idx"
  ON "NotebookProblemTagAssignment"("tagId", "status", "problemId");
CREATE INDEX "NotebookProblemTagAssignment_problemId_status_idx"
  ON "NotebookProblemTagAssignment"("problemId", "status");

ALTER TABLE "CourseProblemTagNode"
  ADD CONSTRAINT "CourseProblemTagNode_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseProblemTagNode"
  ADD CONSTRAINT "CourseProblemTagNode_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "CourseProblemTagNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotebookProblemTagAssignment"
  ADD CONSTRAINT "NotebookProblemTagAssignment_problemId_fkey"
  FOREIGN KEY ("problemId") REFERENCES "NotebookProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotebookProblemTagAssignment"
  ADD CONSTRAINT "NotebookProblemTagAssignment_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "CourseProblemTagNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing string tags remain the compatibility projection. Seed them under a
-- deterministic “待整理” area so every current problem is immediately visible
-- in the knowledge tree before the AI organizer runs.
WITH tagged_courses AS (
  SELECT DISTINCT COALESCE(problem."courseId", notebook."courseId") AS "courseId"
  FROM "NotebookProblem" problem
  LEFT JOIN "Notebook" notebook ON notebook."id" = problem."notebookId"
  WHERE COALESCE(problem."courseId", notebook."courseId") IS NOT NULL
    AND cardinality(problem."tags") > 0
)
INSERT INTO "CourseProblemTagNode" (
  "id", "courseId", "name", "normalizedName", "level", "aliases",
  "source", "status", "confidence", "position", "lockedByTeacher", "updatedAt"
)
SELECT
  'problem_tag_area_' || md5("courseId" || ':legacy'),
  "courseId", '待整理', '待整理', 0, ARRAY[]::TEXT[],
  'legacy', 'active', NULL, 9999, false, CURRENT_TIMESTAMP
FROM tagged_courses
ON CONFLICT ("courseId", "level", "normalizedName") DO NOTHING;

WITH legacy_tags AS (
  SELECT DISTINCT
    COALESCE(problem."courseId", notebook."courseId") AS "courseId",
    trim(tag) AS "name",
    lower(trim(tag)) AS "normalizedName"
  FROM "NotebookProblem" problem
  LEFT JOIN "Notebook" notebook ON notebook."id" = problem."notebookId"
  CROSS JOIN LATERAL unnest(problem."tags") AS tag
  WHERE COALESCE(problem."courseId", notebook."courseId") IS NOT NULL
    AND trim(tag) <> ''
)
INSERT INTO "CourseProblemTagNode" (
  "id", "courseId", "parentId", "name", "normalizedName", "level", "aliases",
  "source", "status", "confidence", "position", "lockedByTeacher", "updatedAt"
)
SELECT
  'problem_tag_concept_' || md5("courseId" || ':' || "normalizedName"),
  "courseId",
  'problem_tag_area_' || md5("courseId" || ':legacy'),
  "name", "normalizedName", 1, ARRAY[]::TEXT[],
  'legacy', 'active', NULL, 0, false, CURRENT_TIMESTAMP
FROM legacy_tags
ON CONFLICT ("courseId", "level", "normalizedName") DO NOTHING;

WITH problem_tags AS (
  SELECT
    problem."id" AS "problemId",
    COALESCE(problem."courseId", notebook."courseId") AS "courseId",
    lower(trim(tag)) AS "normalizedName"
  FROM "NotebookProblem" problem
  LEFT JOIN "Notebook" notebook ON notebook."id" = problem."notebookId"
  CROSS JOIN LATERAL unnest(problem."tags") AS tag
  WHERE COALESCE(problem."courseId", notebook."courseId") IS NOT NULL
    AND trim(tag) <> ''
)
INSERT INTO "NotebookProblemTagAssignment" (
  "problemId", "tagId", "source", "status", "confidence", "updatedAt"
)
SELECT problem_tags."problemId", node."id", 'legacy', 'applied', NULL, CURRENT_TIMESTAMP
FROM problem_tags
JOIN "CourseProblemTagNode" node
  ON node."courseId" = problem_tags."courseId"
 AND node."level" = 1
 AND node."normalizedName" = problem_tags."normalizedName"
ON CONFLICT ("problemId", "tagId") DO NOTHING;

-- Forum problem cards and submission timing.
ALTER TABLE "CourseForumPost" ADD COLUMN "problemId" TEXT;
ALTER TABLE "CourseForumPost" ADD COLUMN "problemSnapshotJson" JSONB;
CREATE INDEX "CourseForumPost_courseId_problemId_createdAt_idx"
  ON "CourseForumPost"("courseId", "problemId", "createdAt" DESC);
ALTER TABLE "CourseForumPost"
  ADD CONSTRAINT "CourseForumPost_problemId_fkey"
  FOREIGN KEY ("problemId") REFERENCES "NotebookProblem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotebookProblemAttempt" ADD COLUMN "activeDurationMs" INTEGER;
ALTER TABLE "NotebookProblemAttempt" ADD COLUMN "timingSource" VARCHAR(32);
