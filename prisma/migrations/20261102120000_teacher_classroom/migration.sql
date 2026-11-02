-- CreateTable
CREATE TABLE "CourseClass" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "academicYear" INTEGER NOT NULL,
    "academicTerm" "CourseAcademicTerm" NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "teacherId" TEXT NOT NULL,
    "joinCode" VARCHAR(12) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseClassMember" (
    "classId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" VARCHAR(16) NOT NULL DEFAULT 'code',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseClassMember_pkey" PRIMARY KEY ("classId","userId")
);

-- CreateTable
CREATE TABLE "ClassSession" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "code" VARCHAR(6),
    "status" VARCHAR(12) NOT NULL DEFAULT 'live',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ClassSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassSessionParticipant" (
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "via" VARCHAR(12) NOT NULL DEFAULT 'code',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassSessionParticipant_pkey" PRIMARY KEY ("sessionId","userId")
);

-- CreateTable
CREATE TABLE "ClassSessionItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "pushedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "answerRevealedAt" TIMESTAMP(3),

    CONSTRAINT "ClassSessionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseClass_joinCode_key" ON "CourseClass"("joinCode");

-- CreateIndex
CREATE INDEX "CourseClass_teacherId_updatedAt_idx" ON "CourseClass"("teacherId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CourseClass_courseId_academicYear_academicTerm_key" ON "CourseClass"("courseId", "academicYear", "academicTerm");

-- CreateIndex
CREATE INDEX "CourseClassMember_userId_joinedAt_idx" ON "CourseClassMember"("userId", "joinedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ClassSession_code_key" ON "ClassSession"("code");

-- CreateIndex
CREATE INDEX "ClassSession_classId_startedAt_idx" ON "ClassSession"("classId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "ClassSession_status_startedAt_idx" ON "ClassSession"("status", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "ClassSessionParticipant_userId_joinedAt_idx" ON "ClassSessionParticipant"("userId", "joinedAt" DESC);

-- CreateIndex
CREATE INDEX "ClassSessionItem_sessionId_position_idx" ON "ClassSessionItem"("sessionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ClassSessionItem_sessionId_problemId_key" ON "ClassSessionItem"("sessionId", "problemId");

-- AddForeignKey
ALTER TABLE "CourseClass" ADD CONSTRAINT "CourseClass_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseClass" ADD CONSTRAINT "CourseClass_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseClassMember" ADD CONSTRAINT "CourseClassMember_classId_fkey" FOREIGN KEY ("classId") REFERENCES "CourseClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseClassMember" ADD CONSTRAINT "CourseClassMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_classId_fkey" FOREIGN KEY ("classId") REFERENCES "CourseClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSessionParticipant" ADD CONSTRAINT "ClassSessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSessionParticipant" ADD CONSTRAINT "ClassSessionParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSessionItem" ADD CONSTRAINT "ClassSessionItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSessionItem" ADD CONSTRAINT "ClassSessionItem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "NotebookProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
