ALTER TABLE "SystemLLMConfig"
ALTER COLUMN "modelId" SET DEFAULT 'gpt-5.6-luna';

UPDATE "SystemLLMConfig"
SET "modelId" = 'gpt-5.6-luna',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE id = 'default'
  AND "modelId" = 'gpt-5.6-terra';
