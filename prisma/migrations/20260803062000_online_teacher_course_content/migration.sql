-- Teacher course content is authoritative in PostgreSQL. Files, mind maps,
-- and removal state must survive browser, device, and Vercel instance changes.
ALTER TABLE "CourseSource"
ADD COLUMN "fileData" BYTEA,
ADD COLUMN "fileSize" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "sourceCategory" TEXT,
ADD COLUMN "removedAt" TIMESTAMP(3);

ALTER TABLE "Notebook"
ADD COLUMN "mindMapData" BYTEA,
ADD COLUMN "mindMapMime" TEXT,
ADD COLUMN "removedAt" TIMESTAMP(3);

CREATE INDEX "CourseSource_course_removed_updated_idx"
ON "CourseSource"("courseId", "removedAt", "updatedAt" DESC);

CREATE INDEX "Notebook_courseId_removedAt_updatedAt_idx"
ON "Notebook"("courseId", "removedAt", "updatedAt" DESC);

-- Normalize records created by the retired browser-local teacher workflow.
UPDATE "CourseSource"
SET "kind" = 'teacher_upload'
WHERE "kind" = 'local_school_upload';

UPDATE "AgentTask"
SET "taskType" = CASE
  WHEN "taskType" = 'local_school_notebook_generation' THEN 'teacher_notebook_generation'
  WHEN "taskType" = 'local_school_mind_map_generation' THEN 'teacher_mind_map_generation'
  ELSE "taskType"
END
WHERE "taskType" IN ('local_school_notebook_generation', 'local_school_mind_map_generation');

UPDATE "Notebook"
SET "tags" = array_remove("tags", 'local-school')
WHERE 'local-school' = ANY("tags");
