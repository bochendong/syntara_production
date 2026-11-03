ALTER TABLE "Course" ADD COLUMN "campus" VARCHAR(120), ADD COLUMN "admissionConfig" JSONB;

CREATE TABLE "CourseJoinApplication" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "answersJson" JSONB NOT NULL,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseJoinApplication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourseJoinApplication_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected')),
  CONSTRAINT "CourseJoinApplication_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourseJoinApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourseJoinApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CourseJoinApplication_courseId_userId_key" ON "CourseJoinApplication"("courseId", "userId");
CREATE INDEX "CourseJoinApplication_courseId_status_createdAt_idx" ON "CourseJoinApplication"("courseId", "status", "createdAt");
CREATE INDEX "CourseJoinApplication_userId_status_idx" ON "CourseJoinApplication"("userId", "status");
