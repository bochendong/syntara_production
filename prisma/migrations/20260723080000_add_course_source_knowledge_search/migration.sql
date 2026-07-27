-- This migration is intentionally additive:
--   * it does not rewrite, rename, or delete any legacy table or column;
--   * existing Notebook/Problem/StudyMemory tables remain business sources of truth;
--   * CourseSource and Knowledge* are populated by a later backfill/dual-write step.
--
-- Existing deployments must baseline the legacy schema migration before applying
-- this file. See prisma/migrations/README.md.

-- pgvector is already used by StudyMemoryChunk in deployed environments. Keeping
-- this guard here makes the new search projection safe on a correctly baselined
-- fresh PostgreSQL database as well.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "CourseSource" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'upload',
    "fileMime" TEXT,
    "usageProfile" TEXT,
    "topic" TEXT,
    "storageKey" TEXT,
    "openaiFileId" TEXT,
    "extractedText" TEXT,
    "extractedTextHash" TEXT,
    "ingestStatus" TEXT NOT NULL DEFAULT 'pending',
    "indexStatus" TEXT NOT NULL DEFAULT 'pending',
    "indexLeaseToken" TEXT,
    "indexLeaseExpiresAt" TIMESTAMP(3),
    "errorReason" TEXT,
    "metadataJson" JSONB,
    "artifactCountsJson" JSONB,
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "ingestedAt" TIMESTAMP(3),
    "indexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "courseSourceId" TEXT,
    "notebookId" TEXT,
    "documentKey" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "sourceEntityType" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "language" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'course',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorReason" TEXT,
    "metadataJson" JSONB,
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "indexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "courseSourceId" TEXT,
    "notebookId" TEXT,
    "documentType" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'course',
    "chunkIndex" INTEGER NOT NULL,
    "chunkText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "tokenCount" INTEGER,
    "metadataJson" JSONB,
    "embeddingModel" TEXT,
    "embeddingDimensions" INTEGER,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CourseSource list and lifecycle indexes
CREATE UNIQUE INDEX "CourseSource_course_hash_key"
ON "CourseSource" ("courseId", "sourceHash");

CREATE INDEX "CourseSource_owner_course_updated_idx"
ON "CourseSource" ("ownerId", "courseId", "updatedAt" DESC);

CREATE INDEX "CourseSource_course_status_updated_idx"
ON "CourseSource" ("courseId", "ingestStatus", "indexStatus", "updatedAt" DESC);

CREATE INDEX "CourseSource_course_kind_updated_idx"
ON "CourseSource" ("courseId", "kind", "updatedAt" DESC);

CREATE INDEX "CourseSource_storage_key_idx"
ON "CourseSource" ("storageKey");

CREATE INDEX "CourseSource_openai_file_idx"
ON "CourseSource" ("openaiFileId");

-- KnowledgeDocument identity, state, and source traversal indexes
CREATE UNIQUE INDEX "KnowledgeDocument_course_document_key"
ON "KnowledgeDocument" ("courseId", "documentKey");

CREATE INDEX "KnowledgeDocument_course_status_type_idx"
ON "KnowledgeDocument" ("courseId", "status", "documentType", "updatedAt" DESC);

CREATE INDEX "KnowledgeDocument_course_entity_idx"
ON "KnowledgeDocument" ("courseId", "sourceEntityType", "sourceEntityId");

CREATE INDEX "KnowledgeDocument_source_updated_idx"
ON "KnowledgeDocument" ("courseSourceId", "updatedAt" DESC);

CREATE INDEX "KnowledgeDocument_notebook_type_idx"
ON "KnowledgeDocument" ("notebookId", "documentType", "updatedAt" DESC);

CREATE INDEX "KnowledgeDocument_owner_course_idx"
ON "KnowledgeDocument" ("ownerId", "courseId", "updatedAt" DESC);

-- KnowledgeChunk authorization/filter indexes
CREATE UNIQUE INDEX "KnowledgeChunk_document_chunk_key"
ON "KnowledgeChunk" ("documentId", "chunkIndex");

CREATE INDEX "KnowledgeChunk_course_document_idx"
ON "KnowledgeChunk" ("courseId", "documentId", "chunkIndex");

CREATE INDEX "KnowledgeChunk_owner_course_filter_idx"
ON "KnowledgeChunk" ("ownerId", "courseId", "visibility", "documentType");

CREATE INDEX "KnowledgeChunk_course_notebook_filter_idx"
ON "KnowledgeChunk" ("courseId", "notebookId", "visibility", "documentType");

CREATE INDEX "KnowledgeChunk_source_document_idx"
ON "KnowledgeChunk" ("courseSourceId", "documentId");

-- Lexical retrieval uses the language-neutral "simple" configuration so course
-- material in Chinese, English, code, and mathematical notation shares one index.
-- The exact expression must be repeated in SQL queries for PostgreSQL to use it.
CREATE INDEX "KnowledgeChunk_lexical_gin_idx"
ON "KnowledgeChunk"
USING GIN (to_tsvector('simple'::regconfig, "chunkText"));

-- PostgreSQL's built-in text-search parser does not segment Chinese reliably.
-- The trigram index supports the hybrid retriever's parameterized ILIKE fallback
-- without scanning every chunk in the selected course.
CREATE INDEX "KnowledgeChunk_lexical_trgm_idx"
ON "KnowledgeChunk"
USING GIN ("chunkText" gin_trgm_ops);

-- Embeddings are nullable while indexing is pending or failed. The partial HNSW
-- index contains only ready vectors; course/visibility/documentType remain on the
-- chunk row so every ANN query can apply those authorization filters in SQL.
CREATE INDEX "KnowledgeChunk_embedding_hnsw_idx"
ON "KnowledgeChunk"
USING hnsw ("embedding" vector_cosine_ops)
WHERE "embedding" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "CourseSource"
ADD CONSTRAINT "CourseSource_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseSource"
ADD CONSTRAINT "CourseSource_courseId_fkey"
FOREIGN KEY ("courseId") REFERENCES "Course"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeDocument"
ADD CONSTRAINT "KnowledgeDocument_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeDocument"
ADD CONSTRAINT "KnowledgeDocument_courseId_fkey"
FOREIGN KEY ("courseId") REFERENCES "Course"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeDocument"
ADD CONSTRAINT "KnowledgeDocument_courseSourceId_fkey"
FOREIGN KEY ("courseSourceId") REFERENCES "CourseSource"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeDocument"
ADD CONSTRAINT "KnowledgeDocument_notebookId_fkey"
FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KnowledgeChunk"
ADD CONSTRAINT "KnowledgeChunk_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeChunk"
ADD CONSTRAINT "KnowledgeChunk_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeChunk"
ADD CONSTRAINT "KnowledgeChunk_courseId_fkey"
FOREIGN KEY ("courseId") REFERENCES "Course"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeChunk"
ADD CONSTRAINT "KnowledgeChunk_courseSourceId_fkey"
FOREIGN KEY ("courseSourceId") REFERENCES "CourseSource"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KnowledgeChunk"
ADD CONSTRAINT "KnowledgeChunk_notebookId_fkey"
FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Business tables remain the source of truth. When their searchable public
-- content changes, mark the corresponding projection stale immediately. Search
-- coverage checks then fall back to the live business tables until the
-- projection is rebuilt, so a same-count content edit cannot serve stale text.
CREATE FUNCTION "markCourseKnowledgeProjectionStale"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entity_id TEXT;
  entity_type TEXT;
  old_source_hash TEXT;
  new_source_hash TEXT;
  old_course_id TEXT;
  new_course_id TEXT;
  old_notebook_id TEXT;
  new_notebook_id TEXT;
BEGIN
  entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
  entity_type := CASE TG_TABLE_NAME
    WHEN 'CourseSource' THEN 'CourseSource'
    WHEN 'MarkdownNotebookSection' THEN 'MarkdownNotebookSection'
    WHEN 'NotebookProblem' THEN 'NotebookProblem'
    ELSE NULL
  END;

  IF entity_type IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- CourseSource itself is authoritative even before its first projection
  -- exists. Do not rely on a KnowledgeDocument row to invalidate it.
  IF entity_type = 'CourseSource' THEN
    IF TG_OP <> 'DELETE' THEN
      UPDATE "CourseSource"
      SET
        "indexStatus" = 'pending',
        "indexLeaseToken" = NULL,
        "indexLeaseExpiresAt" = NULL,
        "indexedAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = NEW."id";
      UPDATE "KnowledgeDocument"
      SET
        "status" = 'stale',
        "indexedAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "courseSourceId" = NEW."id";
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Source-linked sections/problems must also invalidate the CourseSource
  -- during their first index, when no KnowledgeDocument exists yet. Resolve
  -- both OLD and NEW identities so moving an entity cannot leave either
  -- projection looking current.
  IF TG_OP <> 'INSERT' THEN
    old_source_hash := CASE entity_type
      WHEN 'MarkdownNotebookSection' THEN OLD."sourceMeta"->>'sourceHash'
      WHEN 'NotebookProblem' THEN COALESCE(
        OLD."sourceMeta"->>'uploadSourceHash',
        OLD."sourceMeta"->>'sourceHash'
      )
      ELSE NULL
    END;
    old_course_id := OLD."courseId";
    old_notebook_id := OLD."notebookId";
    IF old_course_id IS NULL AND old_notebook_id IS NOT NULL THEN
      SELECT "courseId" INTO old_course_id
      FROM "Notebook"
      WHERE "id" = old_notebook_id;
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    new_source_hash := CASE entity_type
      WHEN 'MarkdownNotebookSection' THEN NEW."sourceMeta"->>'sourceHash'
      WHEN 'NotebookProblem' THEN COALESCE(
        NEW."sourceMeta"->>'uploadSourceHash',
        NEW."sourceMeta"->>'sourceHash'
      )
      ELSE NULL
    END;
    new_course_id := NEW."courseId";
    new_notebook_id := NEW."notebookId";
    IF new_course_id IS NULL AND new_notebook_id IS NOT NULL THEN
      SELECT "courseId" INTO new_course_id
      FROM "Notebook"
      WHERE "id" = new_notebook_id;
    END IF;
  END IF;

  UPDATE "CourseSource"
  SET
    "indexStatus" = 'pending',
    "indexLeaseToken" = NULL,
    "indexLeaseExpiresAt" = NULL,
    "indexedAt" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE (
      old_source_hash IS NOT NULL
      AND "courseId" = old_course_id
      AND "sourceHash" = old_source_hash
    )
    OR (
      new_source_hash IS NOT NULL
      AND "courseId" = new_course_id
      AND "sourceHash" = new_source_hash
    )
    OR "id" IN (
      SELECT DISTINCT "courseSourceId"
      FROM "KnowledgeDocument"
      WHERE "sourceEntityType" = entity_type
        AND "sourceEntityId" = entity_id
        AND "courseSourceId" IS NOT NULL
    );

  UPDATE "KnowledgeDocument"
  SET
    "status" = 'stale',
    "indexedAt" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE "sourceEntityType" = entity_type
    AND "sourceEntityId" = entity_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CourseSource_search_projection_stale"
AFTER UPDATE OF "title", "kind", "extractedText", "metadataJson" OR DELETE
ON "CourseSource"
FOR EACH ROW
EXECUTE FUNCTION "markCourseKnowledgeProjectionStale"();

CREATE TRIGGER "MarkdownNotebookSection_search_projection_stale"
AFTER UPDATE OF "courseId", "notebookId", "title", "order", "summary", "markdown", "sourceMeta" OR DELETE
ON "MarkdownNotebookSection"
FOR EACH ROW
EXECUTE FUNCTION "markCourseKnowledgeProjectionStale"();

CREATE TRIGGER "MarkdownNotebookSection_search_projection_insert"
AFTER INSERT
ON "MarkdownNotebookSection"
FOR EACH ROW
EXECUTE FUNCTION "markCourseKnowledgeProjectionStale"();

CREATE TRIGGER "NotebookProblem_search_projection_stale"
AFTER UPDATE OF "courseId", "notebookId", "title", "type", "status", "tags", "difficulty", "publicContentJson", "sourceMeta" OR DELETE
ON "NotebookProblem"
FOR EACH ROW
EXECUTE FUNCTION "markCourseKnowledgeProjectionStale"();

CREATE TRIGGER "NotebookProblem_search_projection_insert"
AFTER INSERT
ON "NotebookProblem"
FOR EACH ROW
EXECUTE FUNCTION "markCourseKnowledgeProjectionStale"();
