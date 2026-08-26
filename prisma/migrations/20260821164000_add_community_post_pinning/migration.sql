ALTER TABLE "CommunityPost"
  ADD COLUMN "pinnedAt" TIMESTAMP(3),
  ADD COLUMN "pinnedById" TEXT;

CREATE INDEX "CommunityPost_communityId_pinnedAt_idx"
  ON "CommunityPost"("communityId", "pinnedAt" DESC);

ALTER TABLE "CommunityPost"
  ADD CONSTRAINT "CommunityPost_pinnedById_fkey"
  FOREIGN KEY ("pinnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
