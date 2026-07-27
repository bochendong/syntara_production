-- A notebook cover is presentation metadata. Updating only these fields must
-- not invalidate the course-source search projection or spend embedding tokens
-- rebuilding unchanged lecture text.
--
-- Keep DELETE as an unconditional trigger, and gate UPDATE invalidation on the
-- searchable source fields plus metadata with presentation-only cover keys
-- removed.
BEGIN;

DROP TRIGGER IF EXISTS "CourseSource_search_projection_stale" ON "CourseSource";
DROP TRIGGER IF EXISTS "CourseSource_search_projection_delete" ON "CourseSource";

CREATE TRIGGER "CourseSource_search_projection_stale"
AFTER UPDATE OF "title", "kind", "extractedText", "metadataJson"
ON "CourseSource"
FOR EACH ROW
WHEN (
  OLD."title" IS DISTINCT FROM NEW."title"
  OR OLD."kind" IS DISTINCT FROM NEW."kind"
  OR OLD."extractedText" IS DISTINCT FROM NEW."extractedText"
  OR (
    CASE
      WHEN OLD."metadataJson" IS NULL OR OLD."metadataJson" = 'null'::jsonb
      THEN '{}'::jsonb
      WHEN jsonb_typeof(OLD."metadataJson") = 'object'
      THEN
        OLD."metadataJson"
          - ARRAY[
              'coverImagePath',
              'coverStatus',
              'coverProviderId',
              'coverModel',
              'coverPromptHash',
              'coverSpec',
              'coverUpdatedAt'
            ]::text[]
      ELSE OLD."metadataJson"
    END
  ) IS DISTINCT FROM (
    CASE
      WHEN NEW."metadataJson" IS NULL OR NEW."metadataJson" = 'null'::jsonb
      THEN '{}'::jsonb
      WHEN jsonb_typeof(NEW."metadataJson") = 'object'
      THEN
        NEW."metadataJson"
          - ARRAY[
              'coverImagePath',
              'coverStatus',
              'coverProviderId',
              'coverModel',
              'coverPromptHash',
              'coverSpec',
              'coverUpdatedAt'
            ]::text[]
      ELSE NEW."metadataJson"
    END
  )
)
EXECUTE FUNCTION "markCourseKnowledgeProjectionStale"();

CREATE TRIGGER "CourseSource_search_projection_delete"
AFTER DELETE
ON "CourseSource"
FOR EACH ROW
EXECUTE FUNCTION "markCourseKnowledgeProjectionStale"();

COMMIT;
