ALTER TABLE "CourseForumComment"
  ADD COLUMN "qualityAnswerAt" TIMESTAMP(3),
  ADD COLUMN "qualityAnswerById" TEXT;

ALTER TABLE "CourseForumComment"
  ADD CONSTRAINT "CourseForumComment_qualityAnswerById_fkey"
  FOREIGN KEY ("qualityAnswerById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CourseForumComment_postId_qualityAnswerAt_idx"
  ON "CourseForumComment"("postId", "qualityAnswerAt" DESC);
