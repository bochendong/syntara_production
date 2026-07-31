ALTER TABLE "SystemLLMConfig"
ALTER COLUMN "modelId" SET DEFAULT 'gpt-5.6-terra';

UPDATE "SystemLLMConfig"
SET "modelId" = 'gpt-5.6-terra',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE id = 'default'
  AND "modelId" = 'gpt-5.6-sol';
