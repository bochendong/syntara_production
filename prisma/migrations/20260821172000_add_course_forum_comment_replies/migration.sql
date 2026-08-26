ALTER TABLE "CourseForumComment"
  ADD COLUMN "parentId" TEXT;

CREATE INDEX "CourseForumComment_parentId_createdAt_idx"
  ON "CourseForumComment"("parentId", "createdAt");

ALTER TABLE "CourseForumComment"
  ADD CONSTRAINT "CourseForumComment_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "CourseForumComment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
