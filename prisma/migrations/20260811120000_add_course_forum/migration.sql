CREATE TABLE "CourseForumPost" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "bodyMarkdown" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseForumPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseForumAnswer" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "bodyMarkdown" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "acceptedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseForumAnswer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseForumComment" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseForumComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseForumAttachment" (
  "id" TEXT NOT NULL,
  "postId" TEXT,
  "answerId" TEXT,
  "uploaderId" TEXT NOT NULL,
  "fileName" VARCHAR(255) NOT NULL,
  "mimeType" VARCHAR(100) NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "contentSha" VARCHAR(64) NOT NULL,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourseForumAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourseForumAttachment_parent_check" CHECK (
    (CASE WHEN "postId" IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN "answerId" IS NULL THEN 0 ELSE 1 END) = 1
  )
);

CREATE INDEX "CourseForumPost_courseId_resolvedAt_updatedAt_idx"
  ON "CourseForumPost"("courseId", "resolvedAt", "updatedAt" DESC);
CREATE INDEX "CourseForumPost_authorId_createdAt_idx"
  ON "CourseForumPost"("authorId", "createdAt" DESC);
CREATE INDEX "CourseForumAnswer_postId_acceptedAt_createdAt_idx"
  ON "CourseForumAnswer"("postId", "acceptedAt", "createdAt");
CREATE INDEX "CourseForumAnswer_authorId_createdAt_idx"
  ON "CourseForumAnswer"("authorId", "createdAt" DESC);
CREATE INDEX "CourseForumComment_postId_createdAt_idx"
  ON "CourseForumComment"("postId", "createdAt");
CREATE INDEX "CourseForumComment_authorId_createdAt_idx"
  ON "CourseForumComment"("authorId", "createdAt" DESC);
CREATE INDEX "CourseForumAttachment_postId_createdAt_idx"
  ON "CourseForumAttachment"("postId", "createdAt");
CREATE INDEX "CourseForumAttachment_answerId_createdAt_idx"
  ON "CourseForumAttachment"("answerId", "createdAt");
CREATE INDEX "CourseForumAttachment_uploaderId_createdAt_idx"
  ON "CourseForumAttachment"("uploaderId", "createdAt" DESC);

ALTER TABLE "CourseForumPost"
  ADD CONSTRAINT "CourseForumPost_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseForumPost"
  ADD CONSTRAINT "CourseForumPost_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseForumAnswer"
  ADD CONSTRAINT "CourseForumAnswer_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "CourseForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseForumAnswer"
  ADD CONSTRAINT "CourseForumAnswer_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseForumAnswer"
  ADD CONSTRAINT "CourseForumAnswer_acceptedById_fkey"
  FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CourseForumComment"
  ADD CONSTRAINT "CourseForumComment_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "CourseForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseForumComment"
  ADD CONSTRAINT "CourseForumComment_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseForumAttachment"
  ADD CONSTRAINT "CourseForumAttachment_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "CourseForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseForumAttachment"
  ADD CONSTRAINT "CourseForumAttachment_answerId_fkey"
  FOREIGN KEY ("answerId") REFERENCES "CourseForumAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseForumAttachment"
  ADD CONSTRAINT "CourseForumAttachment_uploaderId_fkey"
  FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
