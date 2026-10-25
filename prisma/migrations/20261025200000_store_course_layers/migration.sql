-- 机构课程的公有层 / 私有层，以及「发布新版」的版本标记。

-- 题目的所有者：null = 公有层，非空 = 学员私有
ALTER TABLE "NotebookProblem" ADD COLUMN "ownerId" TEXT,
ADD COLUMN "releaseAddedIn" INTEGER,
ADD COLUMN "releaseUpdatedIn" INTEGER,
ADD COLUMN "releasedHash" TEXT,
ADD COLUMN "contentUpdatedAt" TIMESTAMP(3);
ALTER TABLE "NotebookProblem" ADD CONSTRAINT "NotebookProblem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "NotebookProblem_courseId_ownerId_idx" ON "NotebookProblem"("courseId", "ownerId");

-- 已有的题：挂在学员自己笔记下的算那个学员的私有题
UPDATE "NotebookProblem" p
SET "ownerId" = n."ownerId", "dedupeKey" = NULL, "problemNumber" = NULL
FROM "Notebook" n, "Course" c
WHERE n."id" = p."notebookId"
  AND c."id" = COALESCE(p."courseId", n."courseId")
  AND n."ownerId" <> c."ownerId";

-- 已有的公有内容算作第 0 版，不会在第一次发布时全变成「新」
UPDATE "NotebookProblem"
SET "releaseAddedIn" = 0,
    "releasedHash" = md5(COALESCE("title", '') || "publicContentJson"::text || "gradingJson"::text)
WHERE "ownerId" IS NULL;

ALTER TABLE "Notebook" ADD COLUMN "releaseAddedIn" INTEGER,
ADD COLUMN "releaseUpdatedIn" INTEGER,
ADD COLUMN "releasedContentVersion" INTEGER;
UPDATE "Notebook" SET "releaseAddedIn" = 0, "releasedContentVersion" = "contentVersion";

ALTER TABLE "Course" ADD COLUMN "lastReleasedAt" TIMESTAMP(3);

ALTER TABLE "CourseEnrollment" ADD COLUMN IF NOT EXISTS "newSinceVersion" INTEGER NOT NULL DEFAULT 0;
UPDATE "CourseEnrollment" SET "newSinceVersion" = "seenContentVersion";

-- 学员隐藏公有内容
CREATE TABLE "CourseContentHide" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "targetType" VARCHAR(16) NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseContentHide_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CourseContentHide_userId_targetType_targetId_key" ON "CourseContentHide"("userId", "targetType", "targetId");
CREATE INDEX "CourseContentHide_userId_courseId_targetType_idx" ON "CourseContentHide"("userId", "courseId", "targetType");
ALTER TABLE "CourseContentHide" ADD CONSTRAINT "CourseContentHide_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseContentHide" ADD CONSTRAINT "CourseContentHide_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
