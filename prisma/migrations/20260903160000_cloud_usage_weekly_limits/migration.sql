ALTER TABLE "CloudUsageGlobalLimit"
RENAME COLUMN "monthlyCostLimitUsd" TO "weeklyCostLimitUsd";

ALTER TABLE "CloudUsageGlobalLimit"
RENAME COLUMN "monthlyRequestLimit" TO "weeklyRequestLimit";

ALTER TABLE "CloudUsageUserLimit"
RENAME COLUMN "monthlyCostLimitUsd" TO "weeklyCostLimitUsd";

ALTER TABLE "CloudUsageUserLimit"
RENAME COLUMN "monthlyRequestLimit" TO "weeklyRequestLimit";
