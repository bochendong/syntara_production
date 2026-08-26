ALTER TABLE "CommunityPost"
  ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pinnedById" TEXT;

CREATE INDEX IF NOT EXISTS "CommunityPost_communityId_pinnedAt_idx"
  ON "CommunityPost"("communityId", "pinnedAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CommunityPost_pinnedById_fkey'
  ) THEN
    ALTER TABLE "CommunityPost"
      ADD CONSTRAINT "CommunityPost_pinnedById_fkey"
      FOREIGN KEY ("pinnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
