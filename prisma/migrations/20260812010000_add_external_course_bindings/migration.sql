CREATE TABLE "ExternalCourseBinding" (
  "id" TEXT NOT NULL,
  "provider" VARCHAR(40) NOT NULL,
  "externalCourseId" VARCHAR(120) NOT NULL,
  "courseId" TEXT NOT NULL,
  "activatedById" TEXT NOT NULL,
  "externalCourseName" VARCHAR(240) NOT NULL,
  "externalCourseCode" VARCHAR(120),
  "termName" VARCHAR(160),
  "universityAbbrs" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExternalCourseBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalCourseBinding_courseId_key"
  ON "ExternalCourseBinding"("courseId");
CREATE UNIQUE INDEX "ExternalCourseBinding_provider_externalCourseId_key"
  ON "ExternalCourseBinding"("provider", "externalCourseId");
CREATE INDEX "ExternalCourseBinding_activatedById_updatedAt_idx"
  ON "ExternalCourseBinding"("activatedById", "updatedAt" DESC);

ALTER TABLE "ExternalCourseBinding"
  ADD CONSTRAINT "ExternalCourseBinding_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalCourseBinding"
  ADD CONSTRAINT "ExternalCourseBinding_activatedById_fkey"
  FOREIGN KEY ("activatedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
