ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'TEACHER';

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

CREATE INDEX IF NOT EXISTS "User_role_isActive_updatedAt_idx"
  ON "User" ("role", "isActive", "updatedAt" DESC);
