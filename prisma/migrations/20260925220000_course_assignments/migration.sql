CREATE TABLE "CourseAssignment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "instructions" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "exemplarFileName" VARCHAR(255),
    "exemplarMimeType" VARCHAR(120),
    "exemplarFileData" BYTEA,
    "exemplarText" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CourseAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseAssignmentSubmission" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "fileData" BYTEA NOT NULL,
    "extractedText" TEXT NOT NULL,
    "feedbackJson" JSONB,
    "reviewStatus" VARCHAR(24) NOT NULL DEFAULT 'pending',
    "reviewError" TEXT,
    "sourceVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CourseAssignmentSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CourseAssignment_courseId_createdAt_idx" ON "CourseAssignment"("courseId", "createdAt" DESC);
CREATE INDEX "CourseAssignmentSubmission_assignmentId_createdAt_idx" ON "CourseAssignmentSubmission"("assignmentId", "createdAt" DESC);
CREATE INDEX "CourseAssignmentSubmission_studentId_assignmentId_createdAt_idx" ON "CourseAssignmentSubmission"("studentId", "assignmentId", "createdAt" DESC);

ALTER TABLE "CourseAssignment" ADD CONSTRAINT "CourseAssignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseAssignmentSubmission" ADD CONSTRAINT "CourseAssignmentSubmission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CourseAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseAssignmentSubmission" ADD CONSTRAINT "CourseAssignmentSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
