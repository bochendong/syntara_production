CREATE TABLE IF NOT EXISTS "CloudUsageGlobalLimit" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "monthlyCostLimitUsd" DECIMAL(12, 6),
  "monthlyRequestLimit" INTEGER,
  "periodTimezone" TEXT NOT NULL DEFAULT 'UTC',
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CloudUsageGlobalLimit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CloudUsageGlobalLimit_singleton" CHECK ("id" = 'global')
);

INSERT INTO "CloudUsageGlobalLimit" ("id", "enabled")
VALUES ('global', false)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "CloudUsageUserLimit" (
  "userId" TEXT NOT NULL,
  "monthlyCostLimitUsd" DECIMAL(12, 6),
  "monthlyRequestLimit" INTEGER,
  "disabled" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CloudUsageUserLimit_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "CloudUsageUserLimit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CloudUsageCostLog" (
  "id" BIGSERIAL NOT NULL,
  "userId" TEXT,
  "route" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "estimatedCostUsd" DECIMAL(12, 8) NOT NULL DEFAULT 0,
  "requestCount" INTEGER NOT NULL DEFAULT 1,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CloudUsageCostLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CloudUsageCostLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CloudUsageUserLimit_updatedAt_idx" ON "CloudUsageUserLimit"("updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "CloudUsageCostLog_userId_createdAt_idx" ON "CloudUsageCostLog"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "CloudUsageCostLog_createdAt_idx" ON "CloudUsageCostLog"("createdAt" DESC);
