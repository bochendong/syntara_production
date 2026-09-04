CREATE TABLE "CourseProblemChapter" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseProblemChapter_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "NotebookProblem" ADD COLUMN "chapterId" TEXT;

CREATE UNIQUE INDEX "CourseProblemChapter_courseId_name_key"
  ON "CourseProblemChapter"("courseId", "name");
CREATE INDEX "CourseProblemChapter_courseId_position_createdAt_idx"
  ON "CourseProblemChapter"("courseId", "position", "createdAt");
CREATE INDEX "NotebookProblem_courseId_chapterId_problemNumber_idx"
  ON "NotebookProblem"("courseId", "chapterId", "problemNumber");

ALTER TABLE "CourseProblemChapter"
  ADD CONSTRAINT "CourseProblemChapter_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotebookProblem"
  ADD CONSTRAINT "NotebookProblem_chapterId_fkey"
  FOREIGN KEY ("chapterId") REFERENCES "CourseProblemChapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
