BEGIN;

-- Keep the legacy source rows and every reference being remapped stable for the
-- duration of the copy. Reads remain available while writes pause briefly.
LOCK TABLE
  "Conversation",
  "Message",
  "CourseQuestionRun",
  "MemoryFact",
  "MemoryFactEvent"
IN SHARE ROW EXCLUSIVE MODE;

-- The dedicated course-conversation store replaces the implicit contract that
-- encoded session identity and sync state in Conversation.targetId/meta.
-- Abort on rows that cannot be migrated without guessing. Duplicate valid
-- sessions are supported and are canonicalized below.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Conversation"
    WHERE "kind" = 'course'
      AND "courseId" IS NOT NULL
      AND (
        "targetId" IS NULL
        OR "targetId" NOT LIKE 'learn:%'
        OR length(substring("targetId" FROM 7)) = 0
        OR length(substring("targetId" FROM 7)) > 160
      )
  ) THEN
    RAISE EXCEPTION
      'Course conversation migration blocked: malformed course conversation identity';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Conversation"
    WHERE "kind" = 'course'
      AND "courseId" IS NOT NULL
      AND "targetId" LIKE 'learn:%'
      AND "meta" ? 'clientRevision'
      AND CASE
        WHEN jsonb_typeof("meta"->'clientRevision') = 'number'
          AND ("meta"->>'clientRevision') ~ '^[0-9]+$'
          THEN ("meta"->>'clientRevision')::numeric > 9007199254740991
        ELSE true
      END
  ) THEN
    RAISE EXCEPTION
      'Course conversation migration blocked: clientRevision is not a non-negative safe integer';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Message" AS message
    INNER JOIN "Conversation" AS conversation
      ON conversation."id" = message."conversationId"
    WHERE conversation."kind" = 'course'
      AND conversation."courseId" IS NOT NULL
      AND conversation."targetId" LIKE 'learn:%'
      AND conversation."meta"->>'deleted' IS DISTINCT FROM 'true'
      AND message."meta"->>'deleted' IS DISTINCT FROM 'true'
      AND message."role" NOT IN ('user', 'assistant')
  ) THEN
    RAISE EXCEPTION
      'Course conversation migration blocked: active course message has an unsupported role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Message" AS message
    INNER JOIN "Conversation" AS conversation
      ON conversation."id" = message."conversationId"
    WHERE conversation."kind" = 'course'
      AND conversation."courseId" IS NOT NULL
      AND conversation."targetId" LIKE 'learn:%'
      AND message."ownerId" <> conversation."ownerId"
  ) THEN
    RAISE EXCEPTION
      'Course conversation migration blocked: message owner differs from conversation owner';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CourseQuestionRun" AS run
    LEFT JOIN "Conversation" AS conversation
      ON conversation."id" = run."conversationId"
    WHERE run."conversationId" IS NOT NULL
      AND (
        conversation."id" IS NULL
        OR conversation."kind" <> 'course'
        OR conversation."courseId" IS NULL
        OR conversation."targetId" NOT LIKE 'learn:%'
        OR run."ownerId" <> conversation."ownerId"
        OR run."courseId" <> conversation."courseId"
        OR run."sessionId" <> substring(conversation."targetId" FROM 7)
      )
  ) THEN
    RAISE EXCEPTION
      'Course conversation migration blocked: CourseQuestionRun conversation scope is invalid';
  END IF;
END
$$;

CREATE TYPE "CourseConversationMessageRole" AS ENUM ('user', 'assistant');

CREATE TABLE "CourseConversation" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "sessionId" VARCHAR(160) NOT NULL,
  "title" VARCHAR(200) NOT NULL DEFAULT '新对话',
  "revision" BIGINT NOT NULL DEFAULT 0,
  "deletedAt" TIMESTAMP(3),
  "lastMessageAt" TIMESTAMP(3),
  "messageCount" INTEGER NOT NULL DEFAULT 0,
  "summaryText" TEXT,
  "summaryThroughSequence" BIGINT NOT NULL DEFAULT 0,
  "summaryVersion" INTEGER NOT NULL DEFAULT 0,
  "summaryUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CourseConversation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourseConversation_revision_check"
    CHECK ("revision" >= 0 AND "revision" <= 9007199254740991),
  CONSTRAINT "CourseConversation_messageCount_check"
    CHECK ("messageCount" >= 0),
  CONSTRAINT "CourseConversation_summaryThroughSequence_check"
    CHECK (
      "summaryThroughSequence" >= 0
      AND "summaryThroughSequence" <= 9007199254740991
    ),
  CONSTRAINT "CourseConversation_summaryVersion_check"
    CHECK ("summaryVersion" >= 0),
  CONSTRAINT "CourseConversation_sessionId_check"
    CHECK (length("sessionId") > 0)
);

CREATE TABLE "CourseConversationMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "sequence" BIGINT NOT NULL,
  "role" "CourseConversationMessageRole",
  "content" JSONB,
  "plainText" TEXT,
  "idempotencyKey" TEXT,
  "requestId" TEXT,
  "requestPayloadHash" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CourseConversationMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourseConversationMessage_sequence_check"
    CHECK ("sequence" > 0 AND "sequence" <= 9007199254740991),
  CONSTRAINT "CourseConversationMessage_active_payload_check"
    CHECK (
      "deletedAt" IS NOT NULL
      OR ("role" IS NOT NULL AND "content" IS NOT NULL)
    ),
  CONSTRAINT "CourseConversationMessage_tombstone_payload_check"
    CHECK (
      "deletedAt" IS NULL
      OR ("content" IS NULL AND "plainText" IS NULL)
    )
);

CREATE UNIQUE INDEX "CourseConversation_owner_course_session_key"
  ON "CourseConversation" ("ownerId", "courseId", "sessionId");

CREATE UNIQUE INDEX "CourseConversation_id_owner_course_key"
  ON "CourseConversation" ("id", "ownerId", "courseId");

CREATE UNIQUE INDEX "CourseConversation_id_owner_course_session_key"
  ON "CourseConversation" ("id", "ownerId", "courseId", "sessionId");

CREATE INDEX "CourseConversation_owner_course_deleted_updated_idx"
  ON "CourseConversation" (
    "ownerId",
    "courseId",
    "deletedAt",
    "updatedAt" DESC,
    "id" DESC
  );

CREATE UNIQUE INDEX "CourseConversationMessage_conversation_sequence_key"
  ON "CourseConversationMessage" ("conversationId", "sequence");

CREATE INDEX "CourseConversationMessage_conversation_deleted_created_idx"
  ON "CourseConversationMessage" (
    "conversationId",
    "deletedAt",
    "createdAt" DESC,
    "id" DESC
  );

CREATE INDEX "CourseConversationMessage_conversation_tombstone_idx"
  ON "CourseConversationMessage" ("conversationId", "deletedAt" DESC, "id" DESC);

CREATE INDEX "CourseConversationMessage_owner_course_deleted_created_idx"
  ON "CourseConversationMessage" (
    "ownerId",
    "courseId",
    "deletedAt",
    "createdAt" DESC,
    "id" DESC
  );

ALTER TABLE "CourseConversation"
  ADD CONSTRAINT "CourseConversation_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseConversation"
  ADD CONSTRAINT "CourseConversation_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseConversationMessage"
  ADD CONSTRAINT "CourseConversationMessage_parent_fkey"
  FOREIGN KEY ("conversationId", "ownerId", "courseId")
  REFERENCES "CourseConversation"("id", "ownerId", "courseId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Map every valid legacy row to the highest-revision row for its scoped
-- session. At equal revisions an active row wins over a deleted row, then the
-- latest update/id breaks the tie. Keeping this map for the whole transaction
-- lets messages, memory references, and CourseQuestionRun share one decision.
CREATE TEMPORARY TABLE "_CourseConversationCanonicalMap"
ON COMMIT DROP
AS
SELECT
  conversation."id" AS "legacyConversationId",
  first_value(conversation."id") OVER (
    PARTITION BY
      conversation."ownerId",
      conversation."courseId",
      substring(conversation."targetId" FROM 7)
    ORDER BY
      CASE
        WHEN conversation."meta" ? 'clientRevision'
          THEN (conversation."meta"->>'clientRevision')::bigint
        ELSE 0
      END DESC,
      CASE WHEN conversation."meta"->>'deleted' = 'true' THEN 1 ELSE 0 END ASC,
      conversation."updatedAt" DESC,
      conversation."id" DESC
  ) AS "canonicalConversationId",
  conversation."ownerId",
  conversation."courseId",
  substring(conversation."targetId" FROM 7) AS "sessionId"
FROM "Conversation" AS conversation
WHERE conversation."kind" = 'course'
  AND conversation."courseId" IS NOT NULL
  AND conversation."targetId" LIKE 'learn:%';

CREATE UNIQUE INDEX "_CourseConversationCanonicalMap_legacy_key"
  ON "_CourseConversationCanonicalMap" ("legacyConversationId");

CREATE INDEX "_CourseConversationCanonicalMap_canonical_idx"
  ON "_CourseConversationCanonicalMap" ("canonicalConversationId");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "MemoryFact" AS fact
    INNER JOIN "_CourseConversationCanonicalMap" AS mapping
      ON mapping."legacyConversationId" = fact."scopeId"
    WHERE fact."scopeType" = 'conversation'
      AND fact."ownerId" <> mapping."ownerId"

    UNION ALL

    SELECT 1
    FROM "MemoryFactEvent" AS event
    INNER JOIN "_CourseConversationCanonicalMap" AS mapping
      ON mapping."legacyConversationId" = event."scopeId"
    WHERE event."scopeType" = 'conversation'
      AND event."ownerId" <> mapping."ownerId"
  ) THEN
    RAISE EXCEPTION
      'Course conversation migration blocked: conversation-scoped memory owner differs from conversation owner';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "MemoryFact" AS fact
    INNER JOIN "_CourseConversationCanonicalMap" AS mapping
      ON mapping."legacyConversationId" = fact."scopeId"
    WHERE fact."scopeType" = 'conversation'
      AND fact."status" = 'active'
    GROUP BY
      fact."ownerId",
      mapping."canonicalConversationId",
      fact."namespace",
      fact."key"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Course conversation migration blocked: canonical remap would collide active MemoryFact keys';
  END IF;
END
$$;

WITH canonical_rows AS (
  SELECT DISTINCT ON (mapping."canonicalConversationId")
    mapping."canonicalConversationId",
    mapping."ownerId",
    mapping."courseId",
    mapping."sessionId",
    conversation."title",
    conversation."meta",
    conversation."createdAt",
    conversation."updatedAt"
  FROM "_CourseConversationCanonicalMap" AS mapping
  INNER JOIN "Conversation" AS conversation
    ON conversation."id" = mapping."canonicalConversationId"
  ORDER BY mapping."canonicalConversationId"
),
canonical_revisions AS (
  SELECT
    mapping."canonicalConversationId",
    max(
      CASE
        WHEN conversation."meta" ? 'clientRevision'
          THEN (conversation."meta"->>'clientRevision')::bigint
        ELSE 0
      END
    ) AS "revision"
  FROM "_CourseConversationCanonicalMap" AS mapping
  INNER JOIN "Conversation" AS conversation
    ON conversation."id" = mapping."legacyConversationId"
  GROUP BY mapping."canonicalConversationId"
)
INSERT INTO "CourseConversation" (
  "id",
  "ownerId",
  "courseId",
  "sessionId",
  "title",
  "revision",
  "deletedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  canonical."canonicalConversationId",
  canonical."ownerId",
  canonical."courseId",
  canonical."sessionId",
  left(COALESCE(NULLIF(btrim(canonical."title"), ''), '新对话'), 200),
  revision."revision",
  CASE
    WHEN canonical."meta"->>'deleted' = 'true' THEN canonical."updatedAt"
    ELSE NULL
  END,
  canonical."createdAt",
  canonical."updatedAt"
FROM canonical_rows AS canonical
INNER JOIN canonical_revisions AS revision
  ON revision."canonicalConversationId" = canonical."canonicalConversationId";

WITH legacy_messages AS (
  SELECT
    message."id",
    mapping."canonicalConversationId",
    mapping."ownerId",
    mapping."courseId",
    message."role",
    message."content",
    message."plainText",
    message."meta",
    message."createdAt",
    canonical."deletedAt" AS "canonicalDeletedAt",
    CASE
      WHEN source_conversation."meta"->>'deleted' = 'true'
        THEN source_conversation."updatedAt"
      ELSE NULL
    END AS "sourceDeletedAt"
  FROM "Message" AS message
  INNER JOIN "_CourseConversationCanonicalMap" AS mapping
    ON mapping."legacyConversationId" = message."conversationId"
  INNER JOIN "Conversation" AS source_conversation
    ON source_conversation."id" = mapping."legacyConversationId"
  INNER JOIN "CourseConversation" AS canonical
    ON canonical."id" = mapping."canonicalConversationId"
),
ranked_messages AS (
  SELECT
    legacy.*,
    row_number() OVER (
      PARTITION BY legacy."canonicalConversationId"
      ORDER BY legacy."createdAt" ASC, legacy."id" ASC
    ) AS "sequence",
    (
      legacy."canonicalDeletedAt" IS NOT NULL
      OR legacy."sourceDeletedAt" IS NOT NULL
      OR legacy."meta"->>'deleted' = 'true'
    ) AS "isDeleted"
  FROM legacy_messages AS legacy
)
INSERT INTO "CourseConversationMessage" (
  "id",
  "conversationId",
  "ownerId",
  "courseId",
  "sequence",
  "role",
  "content",
  "plainText",
  "idempotencyKey",
  "requestId",
  "requestPayloadHash",
  "deletedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  message."id",
  message."canonicalConversationId",
  message."ownerId",
  message."courseId",
  message."sequence",
  CASE
    WHEN message."role" = 'user' THEN 'user'::"CourseConversationMessageRole"
    WHEN message."role" = 'assistant' THEN 'assistant'::"CourseConversationMessageRole"
    ELSE NULL
  END,
  CASE WHEN message."isDeleted" THEN NULL ELSE message."content" END,
  CASE WHEN message."isDeleted" THEN NULL ELSE message."plainText" END,
  CASE
    WHEN jsonb_typeof(message."meta"->'idempotencyKey') = 'string'
      THEN message."meta"->>'idempotencyKey'
    ELSE NULL
  END,
  CASE
    WHEN jsonb_typeof(message."meta"->'requestId') = 'string'
      THEN message."meta"->>'requestId'
    ELSE NULL
  END,
  CASE
    WHEN jsonb_typeof(message."meta"->'requestPayloadHash') = 'string'
      THEN message."meta"->>'requestPayloadHash'
    ELSE NULL
  END,
  CASE
    WHEN message."isDeleted"
      THEN COALESCE(
        message."canonicalDeletedAt",
        message."sourceDeletedAt",
        message."createdAt"
      )
    ELSE NULL
  END,
  message."createdAt",
  CASE
    WHEN message."isDeleted"
      THEN COALESCE(
        message."canonicalDeletedAt",
        message."sourceDeletedAt",
        message."createdAt"
      )
    ELSE message."createdAt"
  END
FROM ranked_messages AS message;

WITH visible_message_stats AS (
  SELECT
    message."conversationId",
    count(*)::integer AS "messageCount",
    max(message."createdAt") AS "lastMessageAt"
  FROM "CourseConversationMessage" AS message
  WHERE message."deletedAt" IS NULL
  GROUP BY message."conversationId"
)
UPDATE "CourseConversation" AS conversation
SET
  "messageCount" = stats."messageCount",
  "lastMessageAt" = stats."lastMessageAt"
FROM visible_message_stats AS stats
WHERE conversation."id" = stats."conversationId";

UPDATE "MemoryFact" AS fact
SET "scopeId" = mapping."canonicalConversationId"
FROM "_CourseConversationCanonicalMap" AS mapping
WHERE fact."scopeType" = 'conversation'
  AND fact."scopeId" = mapping."legacyConversationId"
  AND mapping."legacyConversationId" <> mapping."canonicalConversationId";

UPDATE "MemoryFactEvent" AS event
SET "scopeId" = mapping."canonicalConversationId"
FROM "_CourseConversationCanonicalMap" AS mapping
WHERE event."scopeType" = 'conversation'
  AND event."scopeId" = mapping."legacyConversationId"
  AND mapping."legacyConversationId" <> mapping."canonicalConversationId";

UPDATE "CourseQuestionRun" AS run
SET "conversationId" = mapping."canonicalConversationId"
FROM "_CourseConversationCanonicalMap" AS mapping
WHERE run."conversationId" = mapping."legacyConversationId"
  AND mapping."legacyConversationId" <> mapping."canonicalConversationId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CourseQuestionRun" AS run
    WHERE run."conversationId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "CourseConversation" AS conversation
        WHERE conversation."id" = run."conversationId"
          AND conversation."ownerId" = run."ownerId"
          AND conversation."courseId" = run."courseId"
          AND conversation."sessionId" = run."sessionId"
      )
  ) THEN
    RAISE EXCEPTION
      'Course conversation migration blocked: CourseQuestionRun canonical remap is incomplete';
  END IF;
END
$$;

CREATE INDEX "CourseQuestionRun_conversation_scope_idx"
  ON "CourseQuestionRun" ("conversationId", "ownerId", "courseId", "sessionId");

ALTER TABLE "CourseQuestionRun"
  ADD CONSTRAINT "CourseQuestionRun_conversation_scope_fkey"
  FOREIGN KEY ("conversationId", "ownerId", "courseId", "sessionId")
  REFERENCES "CourseConversation"("id", "ownerId", "courseId", "sessionId")
  ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT;
