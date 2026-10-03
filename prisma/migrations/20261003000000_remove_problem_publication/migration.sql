BEGIN;

-- Imported problems are available to teachers and students without publication.
-- Preserve search invalidation while removing its dependency on the old column.
DROP TRIGGER "NotebookProblem_search_projection_stale" ON "NotebookProblem";
DROP INDEX IF EXISTS "NotebookProblem_courseId_status_order_idx";
ALTER TABLE "NotebookProblem" DROP COLUMN "status";
DROP TYPE "NotebookProblemStatus";
ALTER TABLE "Course" DROP COLUMN "publishedProblemCount";
ALTER TABLE "Notebook" DROP COLUMN "publishedProblemCount";

CREATE TRIGGER "NotebookProblem_search_projection_stale"
AFTER UPDATE OF "courseId", "notebookId", "title", "type", "tags", "difficulty", "publicContentJson", "sourceMeta" OR DELETE
ON "NotebookProblem"
FOR EACH ROW
EXECUTE FUNCTION "markCourseKnowledgeProjectionStale"();

COMMIT;
