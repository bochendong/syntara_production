ALTER TABLE "Community" ADD COLUMN "courseId" TEXT;

ALTER TABLE "CourseForumPost" ADD COLUMN "communityId" TEXT;

UPDATE "Community"
SET "courseId" = (
  SELECT "id"
  FROM "Course"
  ORDER BY "updatedAt" DESC
  LIMIT 1
)
WHERE "courseId" IS NULL;

INSERT INTO "CourseForumPost" (
  "id",
  "courseId",
  "communityId",
  "authorId",
  "title",
  "bodyMarkdown",
  "pinnedAt",
  "pinnedById",
  "createdAt",
  "updatedAt"
)
SELECT
  "CommunityPost"."id",
  "Community"."courseId",
  "CommunityPost"."communityId",
  "CommunityPost"."authorId",
  LEFT("CommunityPost"."title", 200),
  "CommunityPost"."bodyMarkdown",
  "CommunityPost"."pinnedAt",
  "CommunityPost"."pinnedById",
  "CommunityPost"."createdAt",
  "CommunityPost"."updatedAt"
FROM "CommunityPost"
JOIN "Community" ON "Community"."id" = "CommunityPost"."communityId"
WHERE "Community"."courseId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

CREATE INDEX "CourseForumPost_communityId_pinnedAt_idx" ON "CourseForumPost"("communityId", "pinnedAt" DESC);
CREATE INDEX "CourseForumPost_communityId_createdAt_idx" ON "CourseForumPost"("communityId", "createdAt" DESC);
CREATE INDEX "Community_courseId_updatedAt_idx" ON "Community"("courseId", "updatedAt" DESC);

ALTER TABLE "Community" ADD CONSTRAINT "Community_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseForumPost" ADD CONSTRAINT "CourseForumPost_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
