-- 商城只展示机构课程；从商城添加 = CourseEnrollment 引用，不复制内容。

-- CreateEnum
CREATE TYPE "OrganizationMemberRole" AS ENUM ('owner', 'editor');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "logoUrl" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrganizationMemberRole" NOT NULL DEFAULT 'editor',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("organizationId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Course
ALTER TABLE "Course" ADD COLUMN "organizationId" TEXT,
ADD COLUMN "contentVersion" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "Course_organizationId_listedInCourseStore_updatedAt_idx" ON "Course"("organizationId", "listedInCourseStore", "updatedAt" DESC);
ALTER TABLE "Course" ADD CONSTRAINT "Course_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: CourseEnrollment
ALTER TABLE "CourseEnrollment" ADD COLUMN IF NOT EXISTS "source" VARCHAR(24) NOT NULL DEFAULT 'store',
ADD COLUMN IF NOT EXISTS "seenContentVersion" INTEGER NOT NULL DEFAULT 0;

-- 机构删笔记不能连带删学生的学习记忆
ALTER TABLE "StudyMemory" DROP CONSTRAINT "StudyMemory_notebookId_fkey";
ALTER TABLE "StudyMemory" ADD CONSTRAINT "StudyMemory_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 学生在机构课程里上传和机构同一份文件时不再冲突
DROP INDEX "CourseSource_course_hash_key";
CREATE UNIQUE INDEX "CourseSource_course_owner_hash_key" ON "CourseSource"("courseId", "ownerId", "sourceHash");
