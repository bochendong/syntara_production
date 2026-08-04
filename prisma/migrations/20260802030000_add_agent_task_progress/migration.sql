ALTER TABLE "AgentTask"
ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'queued',
ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "AgentTask"
SET
  "stage" = CASE
    WHEN "status" = 'completed' THEN 'completed'
    WHEN "status" = 'failed' THEN 'failed'
    WHEN "status" = 'cancelled' THEN 'cancelled'
    WHEN "status" = 'running' THEN 'running'
    WHEN "status" = 'waiting' THEN 'waiting'
    ELSE 'queued'
  END,
  "progress" = CASE
    WHEN "status" IN ('completed', 'failed', 'cancelled') THEN 100
    WHEN "status" = 'running' THEN 1
    ELSE 0
  END,
  "attemptCount" = CASE
    WHEN "status" IN ('running', 'waiting', 'completed', 'failed', 'cancelled') THEN 1
    ELSE 0
  END;

ALTER TABLE "AgentTask"
ADD CONSTRAINT "AgentTask_progress_check" CHECK ("progress" >= 0 AND "progress" <= 100),
ADD CONSTRAINT "AgentTask_attemptCount_check" CHECK ("attemptCount" >= 0);
