CREATE TABLE "CourseHardRule" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseHardRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CourseHardRule_courseId_position_createdAt_idx"
ON "CourseHardRule"("courseId", "position", "createdAt");

CREATE INDEX "CourseHardRule_ownerId_updatedAt_idx"
ON "CourseHardRule"("ownerId", "updatedAt" DESC);

ALTER TABLE "CourseHardRule"
ADD CONSTRAINT "CourseHardRule_courseId_fkey"
FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseHardRule"
ADD CONSTRAINT "CourseHardRule_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
