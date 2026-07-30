-- Course list cards read the denormalized counter so opening /my-courses does
-- not have to load every notebook or aggregate the full Notebook table.
-- Repair legacy rows once; normal notebook mutations keep this field current
-- through refreshCourseSummaryFields in the repository layer.
UPDATE "Course" AS course
SET "notebookCount" = counts."notebookCount"
FROM (
  SELECT
    course_row."id" AS "courseId",
    COUNT(notebook."id")::integer AS "notebookCount"
  FROM "Course" AS course_row
  LEFT JOIN "Notebook" AS notebook
    ON notebook."courseId" = course_row."id"
  GROUP BY course_row."id"
) AS counts
WHERE course."id" = counts."courseId"
  AND course."notebookCount" IS DISTINCT FROM counts."notebookCount";

CREATE OR REPLACE FUNCTION "sync_course_notebook_count"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."courseId" IS NOT NULL THEN
      UPDATE "Course"
      SET "notebookCount" = "notebookCount" + 1
      WHERE "id" = NEW."courseId";
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."courseId" IS NOT NULL THEN
      UPDATE "Course"
      SET "notebookCount" = GREATEST(0, "notebookCount" - 1)
      WHERE "id" = OLD."courseId";
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."courseId" IS DISTINCT FROM NEW."courseId" THEN
    IF OLD."courseId" IS NOT NULL THEN
      UPDATE "Course"
      SET "notebookCount" = GREATEST(0, "notebookCount" - 1)
      WHERE "id" = OLD."courseId";
    END IF;
    IF NEW."courseId" IS NOT NULL THEN
      UPDATE "Course"
      SET "notebookCount" = "notebookCount" + 1
      WHERE "id" = NEW."courseId";
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Notebook_sync_course_notebook_count" ON "Notebook";
CREATE TRIGGER "Notebook_sync_course_notebook_count"
AFTER INSERT OR DELETE OR UPDATE OF "courseId" ON "Notebook"
FOR EACH ROW
EXECUTE FUNCTION "sync_course_notebook_count"();
