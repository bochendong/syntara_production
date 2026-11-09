CREATE TABLE "StudyCardAlbum" (
  "userId" TEXT NOT NULL PRIMARY KEY, "owned" JSONB NOT NULL DEFAULT '{}',
  "favorites" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "totalDraws" INTEGER NOT NULL DEFAULT 0, "sinceSR" INTEGER NOT NULL DEFAULT 0,
  "sinceSSR" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyCardAlbum_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "StudyCardDraw" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
  "cardId" TEXT NOT NULL, "rarity" TEXT NOT NULL, "copies" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudyCardDraw_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StudyCardDraw_userId_requestId_key" ON "StudyCardDraw"("userId", "requestId");
CREATE INDEX "StudyCardDraw_userId_createdAt_idx" ON "StudyCardDraw"("userId", "createdAt");
