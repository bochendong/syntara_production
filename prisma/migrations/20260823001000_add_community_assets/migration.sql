CREATE TABLE IF NOT EXISTS "CommunityAsset" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "uploaderId" TEXT NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "fileName" VARCHAR(255) NOT NULL,
  "mimeType" VARCHAR(100) NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "contentSha" VARCHAR(64) NOT NULL,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommunityAsset_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CommunityAsset_communityId_fkey'
  ) THEN
    ALTER TABLE "CommunityAsset"
      ADD CONSTRAINT "CommunityAsset_communityId_fkey"
      FOREIGN KEY ("communityId") REFERENCES "Community"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "CommunityAsset_communityId_kind_createdAt_idx"
  ON "CommunityAsset"("communityId", "kind", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "CommunityAsset_uploaderId_createdAt_idx"
  ON "CommunityAsset"("uploaderId", "createdAt" DESC);
