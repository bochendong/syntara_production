-- Imported problems are available to teachers and students without publication.
DROP INDEX IF EXISTS "NotebookProblem_courseId_status_order_idx";
ALTER TABLE "NotebookProblem" DROP COLUMN "status";
DROP TYPE "NotebookProblemStatus";
ALTER TABLE "Course" DROP COLUMN "publishedProblemCount";
ALTER TABLE "Notebook" DROP COLUMN "publishedProblemCount";
