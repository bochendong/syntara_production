-- Preserve historical score ratios before standardizing every problem to 100 points.
UPDATE "NotebookProblemAttempt" AS attempt
SET
  "score" = ROUND((attempt."score" * 100.0 / problem."points")::numeric, 1)::double precision,
  "resultJson" = CASE
    WHEN attempt."resultJson" IS NULL THEN NULL
    ELSE jsonb_set(
      attempt."resultJson"::jsonb,
      '{earnedPoints}',
      to_jsonb(ROUND((attempt."score" * 100.0 / problem."points")::numeric, 1)::double precision),
      true
    )
  END
FROM "NotebookProblem" AS problem
WHERE attempt."problemId" = problem."id"
  AND attempt."score" IS NOT NULL
  AND problem."points" > 0
  AND problem."points" <> 100;

UPDATE "NotebookProblemProgress" AS progress
SET "score" = ROUND((progress."score" * 100.0 / problem."points")::numeric, 1)::double precision
FROM "NotebookProblem" AS problem
WHERE progress."problemId" = problem."id"
  AND progress."score" IS NOT NULL
  AND problem."points" > 0
  AND problem."points" <> 100;

UPDATE "NotebookProblem"
SET "points" = 100
WHERE "points" <> 100;

ALTER TABLE "NotebookProblem" ALTER COLUMN "points" SET DEFAULT 100;
