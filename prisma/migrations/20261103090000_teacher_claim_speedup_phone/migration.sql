-- 老师认领课程（一门课一位老师）+ 学生的 Speedup 手机尾号
ALTER TABLE "User" ADD COLUMN "speedupPhoneLast4" VARCHAR(4);
ALTER TABLE "User" ADD COLUMN "speedupPhoneSavedAt" TIMESTAMP(3);

ALTER TABLE "Course" ADD COLUMN "claimedTeacherId" TEXT;
ALTER TABLE "Course" ADD COLUMN "claimedAt" TIMESTAMP(3);
CREATE INDEX "Course_claimedTeacherId_idx" ON "Course"("claimedTeacherId");
ALTER TABLE "Course" ADD CONSTRAINT "Course_claimedTeacherId_fkey" FOREIGN KEY ("claimedTeacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
