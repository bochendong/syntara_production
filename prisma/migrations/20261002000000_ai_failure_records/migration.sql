CREATE TABLE "AiFailureRecord" (
  "id" TEXT PRIMARY KEY,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AiFailureRecord_createdAt_idx" ON "AiFailureRecord" ("createdAt" DESC);
CREATE INDEX "AiFailureRecord_userId_idx" ON "AiFailureRecord" (("data"->>'userId'), "createdAt" DESC);
