ALTER TYPE "UserRole" ADD VALUE 'TEACHING_ASSISTANT';

CREATE TABLE "CourseTeachingAssistant" (
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "CourseTeachingAssistant_pkey" PRIMARY KEY ("courseId", "userId"),
    CONSTRAINT "CourseTeachingAssistant_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseTeachingAssistant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CourseTeachingAssistant_userId_removedAt_idx" ON "CourseTeachingAssistant"("userId", "removedAt");
