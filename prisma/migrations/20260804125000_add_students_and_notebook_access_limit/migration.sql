ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'STUDENT';

ALTER TABLE "CourseEnrollment"
  ADD COLUMN IF NOT EXISTS "notebookAccessLimit" INTEGER;

ALTER TABLE "CourseEnrollment"
  DROP CONSTRAINT IF EXISTS "CourseEnrollment_notebookAccessLimit_check";

ALTER TABLE "CourseEnrollment"
  ADD CONSTRAINT "CourseEnrollment_notebookAccessLimit_check"
  CHECK ("notebookAccessLimit" IS NULL OR "notebookAccessLimit" >= 0);
