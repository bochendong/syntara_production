CREATE TABLE "CourseRulePack" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "ruleSetKey" TEXT NOT NULL,
    "evaluatorKey" TEXT NOT NULL,
    "artifactKind" TEXT NOT NULL,
    "appliesTo" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "contractJson" JSONB NOT NULL,
    "sourceRefs" JSONB,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseRulePack_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourseRulePack_courseId_ruleSetKey_key"
ON "CourseRulePack"("courseId", "ruleSetKey");

CREATE INDEX "CourseRulePack_courseId_status_artifactKind_idx"
ON "CourseRulePack"("courseId", "status", "artifactKind");

CREATE INDEX "CourseRulePack_evaluatorKey_status_idx"
ON "CourseRulePack"("evaluatorKey", "status");

ALTER TABLE "CourseRulePack"
ADD CONSTRAINT "CourseRulePack_courseId_fkey"
FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
