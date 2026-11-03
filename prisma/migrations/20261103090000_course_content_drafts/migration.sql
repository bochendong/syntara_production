CREATE TABLE "CourseContentDraft" (
  "courseId" TEXT NOT NULL REFERENCES "Course"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('notes', 'problems')),
  "targetId" TEXT NOT NULL,
  "operation" TEXT NOT NULL CHECK ("operation" IN ('save', 'delete')),
  "payload" JSONB NOT NULL,
  "baseUpdatedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC', CURRENT_TIMESTAMP),
  PRIMARY KEY ("courseId", "kind", "targetId")
);
