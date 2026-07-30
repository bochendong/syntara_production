\set ON_ERROR_STOP on

BEGIN;

SELECT
  migration_name,
  checksum,
  finished_at,
  rolled_back_at,
  applied_steps_count
FROM "_prisma_migrations"
WHERE migration_name = '20260730010000_repair_course_notebook_counts';

DO $verify_migration$
DECLARE
  applied_count integer;
BEGIN
  SELECT COUNT(*)::integer
  INTO applied_count
  FROM "_prisma_migrations"
  WHERE migration_name = '20260730010000_repair_course_notebook_counts'
    AND finished_at IS NOT NULL
    AND rolled_back_at IS NULL
    AND applied_steps_count = 1;

  IF applied_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one completed 20260730010000 migration, found %',
      applied_count;
  END IF;
END
$verify_migration$;

SELECT
  trigger_row.tgname,
  trigger_row.tgenabled,
  pg_get_triggerdef(trigger_row.oid, true) AS definition
FROM pg_trigger AS trigger_row
JOIN pg_class AS table_row
  ON table_row.oid = trigger_row.tgrelid
JOIN pg_namespace AS namespace_row
  ON namespace_row.oid = table_row.relnamespace
WHERE namespace_row.nspname = current_schema()
  AND table_row.relname = 'Notebook'
  AND trigger_row.tgname = 'Notebook_sync_course_notebook_count'
  AND NOT trigger_row.tgisinternal;

DO $verify_trigger$
DECLARE
  enabled_trigger_count integer;
BEGIN
  SELECT COUNT(*)::integer
  INTO enabled_trigger_count
  FROM pg_trigger AS trigger_row
  JOIN pg_class AS table_row
    ON table_row.oid = trigger_row.tgrelid
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = table_row.relnamespace
  WHERE namespace_row.nspname = current_schema()
    AND table_row.relname = 'Notebook'
    AND trigger_row.tgname = 'Notebook_sync_course_notebook_count'
    AND trigger_row.tgenabled = 'O'
    AND NOT trigger_row.tgisinternal
    AND pg_get_triggerdef(trigger_row.oid, true) LIKE
      'CREATE TRIGGER % AFTER INSERT OR DELETE OR UPDATE OF "courseId" ON "Notebook"%';

  IF enabled_trigger_count <> 1 THEN
    RAISE EXCEPTION
      'Expected one enabled Notebook count trigger, found %',
      enabled_trigger_count;
  END IF;
END
$verify_trigger$;

WITH actual_counts AS (
  SELECT
    course."id",
    course."courseCode",
    course."name",
    course."notebookCount" AS stored_count,
    COUNT(notebook."id")::integer AS actual_count
  FROM "Course" AS course
  LEFT JOIN "Notebook" AS notebook
    ON notebook."courseId" = course."id"
  GROUP BY
    course."id",
    course."courseCode",
    course."name",
    course."notebookCount"
)
SELECT
  *,
  stored_count - actual_count AS delta
FROM actual_counts
WHERE stored_count IS DISTINCT FROM actual_count
ORDER BY ABS(stored_count - actual_count) DESC, "id";

DO $verify_parity$
DECLARE
  mismatch_count integer;
BEGIN
  SELECT COUNT(*)::integer
  INTO mismatch_count
  FROM (
    SELECT
      course."id"
    FROM "Course" AS course
    LEFT JOIN "Notebook" AS notebook
      ON notebook."courseId" = course."id"
    GROUP BY course."id", course."notebookCount"
    HAVING course."notebookCount" IS DISTINCT FROM COUNT(notebook."id")::integer
  ) AS mismatches;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Course notebook count mismatch count is %', mismatch_count;
  END IF;
END
$verify_parity$;

DO $probe_trigger$
DECLARE
  target_course_id text;
  target_owner_id text;
  probe_notebook_id text;
  stored_count integer;
  actual_count integer;
BEGIN
  SELECT course."id", course."ownerId"
  INTO target_course_id, target_owner_id
  FROM "Course" AS course
  ORDER BY course."id"
  LIMIT 1
  FOR UPDATE;

  IF target_course_id IS NULL THEN
    RAISE EXCEPTION 'Cannot probe Notebook count trigger without a Course row';
  END IF;

  probe_notebook_id :=
    'codex_notebook_count_probe_' || md5(clock_timestamp()::text || random()::text);

  INSERT INTO "Notebook" (
    "id",
    "ownerId",
    "courseId",
    "name",
    "tags",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    probe_notebook_id,
    target_owner_id,
    target_course_id,
    'Course notebook count migration probe',
    ARRAY[]::text[],
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );

  SELECT
    course."notebookCount",
    COUNT(notebook."id")::integer
  INTO stored_count, actual_count
  FROM "Course" AS course
  LEFT JOIN "Notebook" AS notebook
    ON notebook."courseId" = course."id"
  WHERE course."id" = target_course_id
  GROUP BY course."id", course."notebookCount";

  IF stored_count IS DISTINCT FROM actual_count THEN
    RAISE EXCEPTION
      'Notebook INSERT trigger probe failed for course %: stored %, actual %',
      target_course_id,
      stored_count,
      actual_count;
  END IF;

  DELETE FROM "Notebook"
  WHERE "id" = probe_notebook_id;

  SELECT
    course."notebookCount",
    COUNT(notebook."id")::integer
  INTO stored_count, actual_count
  FROM "Course" AS course
  LEFT JOIN "Notebook" AS notebook
    ON notebook."courseId" = course."id"
  WHERE course."id" = target_course_id
  GROUP BY course."id", course."notebookCount";

  IF stored_count IS DISTINCT FROM actual_count THEN
    RAISE EXCEPTION
      'Notebook DELETE trigger probe failed for course %: stored %, actual %',
      target_course_id,
      stored_count,
      actual_count;
  END IF;

  RAISE NOTICE
    'Notebook count trigger insert/delete probe passed for course %',
    target_course_id;
END
$probe_trigger$;

ROLLBACK;

WITH actual_counts AS (
  SELECT
    course."id",
    course."notebookCount" AS stored_count,
    COUNT(notebook."id")::integer AS actual_count
  FROM "Course" AS course
  LEFT JOIN "Notebook" AS notebook
    ON notebook."courseId" = course."id"
  GROUP BY course."id", course."notebookCount"
)
SELECT COUNT(*)::integer AS mismatch_count
FROM actual_counts
WHERE stored_count IS DISTINCT FROM actual_count;
