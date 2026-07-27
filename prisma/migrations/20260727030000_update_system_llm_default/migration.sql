ALTER TABLE "SystemLLMConfig"
ALTER COLUMN "modelId" SET DEFAULT 'gpt-5.6-sol';

ALTER TABLE "ProblemImportBatch"
  ADD COLUMN IF NOT EXISTS "commitPayloadHash" TEXT,
  ADD COLUMN IF NOT EXISTS "commitLeaseToken" TEXT,
  ADD COLUMN IF NOT EXISTS "commitLeaseExpiresAt" TIMESTAMP(3);
