ALTER TABLE "SystemLLMConfig"
ADD COLUMN "lowModelId" TEXT NOT NULL DEFAULT 'gpt-5.6-luna',
ADD COLUMN "mediumModelId" TEXT NOT NULL DEFAULT 'gpt-5.6-sol',
ADD COLUMN "highModelId" TEXT NOT NULL DEFAULT 'gpt-6-astra';
