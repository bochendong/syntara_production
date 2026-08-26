-- Bootstrap the standalone forum tables that were previously created only by
-- development-time schema pushes. Production databases need these base tables
-- before the follow-up community, reply, attachment, and account-scope migrations.

CREATE TABLE IF NOT EXISTS "Community" (
  "id" TEXT NOT NULL,
  "slug" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(600),
  "avatarUrl" VARCHAR(2000),
  "bannerUrl" VARCHAR(2000),
  "visibility" VARCHAR(32) NOT NULL DEFAULT 'public',
  "ownerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Community_slug_key" ON "Community"("slug");
CREATE INDEX IF NOT EXISTS "Community_ownerId_createdAt_idx"
  ON "Community"("ownerId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Community_visibility_updatedAt_idx"
  ON "Community"("visibility", "updatedAt" DESC);

CREATE TABLE IF NOT EXISTS "CommunityMember" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" VARCHAR(32) NOT NULL DEFAULT 'member',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommunityMember_communityId_userId_key"
  ON "CommunityMember"("communityId", "userId");
CREATE INDEX IF NOT EXISTS "CommunityMember_userId_joinedAt_idx"
  ON "CommunityMember"("userId", "joinedAt" DESC);
CREATE INDEX IF NOT EXISTS "CommunityMember_communityId_joinedAt_idx"
  ON "CommunityMember"("communityId", "joinedAt" DESC);

CREATE TABLE IF NOT EXISTS "CommunityPost" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "title" VARCHAR(220) NOT NULL,
  "bodyMarkdown" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityPost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CommunityPost_communityId_createdAt_idx"
  ON "CommunityPost"("communityId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "CommunityPost_authorId_createdAt_idx"
  ON "CommunityPost"("authorId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "DirectMessageThread" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "userAId" TEXT NOT NULL,
  "userBId" TEXT NOT NULL,
  "lastMessageAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DirectMessageThread_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DirectMessageThread_courseId_userAId_userBId_key"
  ON "DirectMessageThread"("courseId", "userAId", "userBId");
CREATE INDEX IF NOT EXISTS "DirectMessageThread_userAId_lastMessageAt_idx"
  ON "DirectMessageThread"("userAId", "lastMessageAt" DESC);
CREATE INDEX IF NOT EXISTS "DirectMessageThread_userBId_lastMessageAt_idx"
  ON "DirectMessageThread"("userBId", "lastMessageAt" DESC);
CREATE INDEX IF NOT EXISTS "DirectMessageThread_courseId_lastMessageAt_idx"
  ON "DirectMessageThread"("courseId", "lastMessageAt" DESC);

CREATE TABLE IF NOT EXISTS "DirectMessage" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DirectMessage_threadId_createdAt_idx"
  ON "DirectMessage"("threadId", "createdAt");
CREATE INDEX IF NOT EXISTS "DirectMessage_senderId_createdAt_idx"
  ON "DirectMessage"("senderId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Community_ownerId_fkey') THEN
    ALTER TABLE "Community"
      ADD CONSTRAINT "Community_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunityMember_communityId_fkey') THEN
    ALTER TABLE "CommunityMember"
      ADD CONSTRAINT "CommunityMember_communityId_fkey"
      FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunityMember_userId_fkey') THEN
    ALTER TABLE "CommunityMember"
      ADD CONSTRAINT "CommunityMember_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunityPost_communityId_fkey') THEN
    ALTER TABLE "CommunityPost"
      ADD CONSTRAINT "CommunityPost_communityId_fkey"
      FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommunityPost_authorId_fkey') THEN
    ALTER TABLE "CommunityPost"
      ADD CONSTRAINT "CommunityPost_authorId_fkey"
      FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectMessageThread_courseId_fkey') THEN
    ALTER TABLE "DirectMessageThread"
      ADD CONSTRAINT "DirectMessageThread_courseId_fkey"
      FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectMessageThread_userAId_fkey') THEN
    ALTER TABLE "DirectMessageThread"
      ADD CONSTRAINT "DirectMessageThread_userAId_fkey"
      FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectMessageThread_userBId_fkey') THEN
    ALTER TABLE "DirectMessageThread"
      ADD CONSTRAINT "DirectMessageThread_userBId_fkey"
      FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectMessage_threadId_fkey') THEN
    ALTER TABLE "DirectMessage"
      ADD CONSTRAINT "DirectMessage_threadId_fkey"
      FOREIGN KEY ("threadId") REFERENCES "DirectMessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirectMessage_senderId_fkey') THEN
    ALTER TABLE "DirectMessage"
      ADD CONSTRAINT "DirectMessage_senderId_fkey"
      FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
