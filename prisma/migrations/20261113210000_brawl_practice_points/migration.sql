ALTER TABLE "User" ADD COLUMN "brawlPracticePoints" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NotebookProblemAttempt" ADD COLUMN "brawlVerified" BOOLEAN;

CREATE TABLE "BrawlProblemReward" (
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "problemId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("userId", "problemId")
);

CREATE TABLE "BrawlPointTransfer" (
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "id" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("userId", "id")
);
