-- Persist the administrator-selected semester instead of inferring it from
-- the browser clock when a teacher opens a course.
CREATE TYPE "CourseAcademicTerm" AS ENUM ('winter', 'summer', 'fall');

ALTER TABLE "Course"
ADD COLUMN "academicYear" INTEGER,
ADD COLUMN "academicTerm" "CourseAcademicTerm";

CREATE INDEX "Course_ownerId_academicYear_academicTerm_idx"
ON "Course"("ownerId", "academicYear", "academicTerm");
