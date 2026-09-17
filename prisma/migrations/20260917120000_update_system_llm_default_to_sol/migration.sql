ALTER TABLE "SystemLLMConfig"
ALTER COLUMN "modelId" SET DEFAULT 'gpt-5.6-sol';

UPDATE "SystemLLMConfig"
SET "modelId" = 'gpt-5.6-sol',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE id = 'default'
  AND "modelId" IN ('gpt-5.6-luna', 'gpt-5.6-terra');
