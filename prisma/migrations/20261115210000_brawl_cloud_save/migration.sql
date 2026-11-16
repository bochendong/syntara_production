CREATE TABLE "BrawlCloudSave" (
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "data" JSONB NOT NULL,
  "legacyBalance" INTEGER NOT NULL DEFAULT 0,
  "growthTouched" BOOLEAN NOT NULL DEFAULT false,
  "imported" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("userId")
);

CREATE TABLE "BrawlCloudWrite" (
  "userId" TEXT NOT NULL REFERENCES "BrawlCloudSave"("userId") ON DELETE CASCADE ON UPDATE CASCADE,
  "id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  PRIMARY KEY ("userId", "id")
);
