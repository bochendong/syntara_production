#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';
import { loadMaintenanceEnvFiles } from './teaching-control-update-safety.mjs';

const HELP = `
Usage:
  node scripts/maintenance/preflight-course-conversation-migration.mjs [--json]

Runs a read-only, repeatable-read audit before
20260730020000_add_course_conversation_store.

Options:
  --json     Print one machine-readable JSON object.
  --help     Show this help.

Environment:
  DATABASE_URL is loaded from the current environment, .env, or .env.local.

This script never creates, updates, or deletes database rows.
`.trim();

function parseArgs(argv) {
  const options = { json: false, help: false };
  for (const argument of argv) {
    if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function databaseLabel() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}/...`;
  } catch {
    return 'invalid DATABASE_URL';
  }
}

function jsonSafe(value) {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
  }
  return value;
}

// Keep every audit query aligned with the migration's canonical-row policy.
// Invalid or oversized revisions fall back to zero here so the audit can still
// finish and report them as blockers instead of failing during a diagnostic.
const CANONICAL_MAPPING_CTE = `
  WITH eligible_conversations AS (
    SELECT
      conversation."id",
      conversation."ownerId",
      conversation."courseId",
      substring(conversation."targetId" FROM 7) AS "sessionId",
      conversation."meta",
      conversation."updatedAt",
      CASE
        WHEN jsonb_typeof(conversation."meta"->'clientRevision') = 'number'
          AND (conversation."meta"->>'clientRevision') ~ '^[0-9]+$'
          THEN CASE
            WHEN (conversation."meta"->>'clientRevision')::numeric <= 9007199254740991
              THEN (conversation."meta"->>'clientRevision')::bigint
            ELSE 0
          END
        ELSE 0
      END AS "revision",
      CASE
        WHEN conversation."meta"->>'deleted' = 'true' THEN 1
        ELSE 0
      END AS "deletionRank"
    FROM "Conversation" AS conversation
    WHERE conversation."kind" = 'course'
      AND conversation."courseId" IS NOT NULL
      AND conversation."targetId" LIKE 'learn:%'
  ),
  canonical_mapping AS (
    SELECT
      eligible."id" AS "legacyConversationId",
      first_value(eligible."id") OVER (
        PARTITION BY eligible."ownerId", eligible."courseId", eligible."sessionId"
        ORDER BY
          eligible."revision" DESC,
          eligible."deletionRank" ASC,
          eligible."updatedAt" DESC,
          eligible."id" DESC
      ) AS "canonicalConversationId",
      eligible."ownerId",
      eligible."courseId",
      eligible."sessionId"
    FROM eligible_conversations AS eligible
  )
`;

async function inspectDatabase(prisma) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');

      const targetTables = await tx.$queryRawUnsafe(
        `
          SELECT
            to_regclass('"CourseConversation"')::text AS "conversationTable",
            to_regclass('"CourseConversationMessage"')::text AS "messageTable"
        `,
      );

      const conversationStats = await tx.$queryRawUnsafe(
        `
          WITH learn_conversations AS (
            SELECT
              conversation."id",
              conversation."ownerId",
              conversation."courseId",
              substring(conversation."targetId" FROM 7) AS "sessionId",
              conversation."meta"
            FROM "Conversation" AS conversation
            WHERE conversation."kind" = 'course'
              AND conversation."courseId" IS NOT NULL
              AND conversation."targetId" LIKE 'learn:%'
          )
          SELECT
            count(*)::bigint AS "legacyConversationCount",
            count(*) FILTER (
              WHERE "meta"->>'deleted' = 'true'
            )::bigint AS "deletedConversationCount",
            count(DISTINCT ("ownerId", "courseId", "sessionId"))::bigint
              AS "canonicalConversationCount"
          FROM learn_conversations
        `,
      );

      const messageStats = await tx.$queryRawUnsafe(
        `
          SELECT
            count(*)::bigint AS "legacyMessageCount",
            count(*) FILTER (
              WHERE conversation."meta"->>'deleted' = 'true'
                OR message."meta"->>'deleted' = 'true'
            )::bigint AS "tombstoneMessageCount",
            count(*) FILTER (
              WHERE conversation."meta"->>'deleted' IS DISTINCT FROM 'true'
                AND message."meta"->>'deleted' IS DISTINCT FROM 'true'
            )::bigint AS "visibleMessageCount"
          FROM "Message" AS message
          INNER JOIN "Conversation" AS conversation
            ON conversation."id" = message."conversationId"
          WHERE conversation."kind" = 'course'
            AND conversation."courseId" IS NOT NULL
            AND conversation."targetId" LIKE 'learn:%'
        `,
      );

      const duplicateGroups = await tx.$queryRawUnsafe(
        `
          ${CANONICAL_MAPPING_CTE}
          SELECT
            conversation."ownerId",
            conversation."courseId",
            conversation."sessionId",
            count(*)::bigint AS "rowCount",
            (
              array_agg(
                conversation."id"
                ORDER BY
                  conversation."revision" DESC,
                  conversation."deletionRank" ASC,
                  conversation."updatedAt" DESC,
                  conversation."id" DESC
              )
            )[1] AS "canonicalConversationId",
            bool_or(conversation."deletionRank" = 0)
              AND bool_or(conversation."deletionRank" = 1)
              AS "statusConflict",
            jsonb_agg(
              jsonb_build_object(
                'id', conversation."id",
                'revision', conversation."revision",
                'deleted', conversation."deletionRank" = 1,
                'updatedAt', conversation."updatedAt"
              )
              ORDER BY
                conversation."revision" DESC,
                conversation."deletionRank" ASC,
                conversation."updatedAt" DESC,
                conversation."id" DESC
            ) AS "rows"
          FROM eligible_conversations AS conversation
          GROUP BY
            conversation."ownerId",
            conversation."courseId",
            conversation."sessionId"
          HAVING count(*) > 1
          ORDER BY count(*) DESC, conversation."ownerId", conversation."courseId", "sessionId"
          LIMIT 25
        `,
      );

      const malformedConversations = await tx.$queryRawUnsafe(
        `
          SELECT
            "id",
            "ownerId",
            "courseId",
            "targetId",
            "updatedAt"
          FROM "Conversation"
          WHERE "kind" = 'course'
            AND "courseId" IS NOT NULL
            AND (
              "targetId" IS NULL
              OR "targetId" NOT LIKE 'learn:%'
              OR length(substring("targetId" FROM 7)) = 0
              OR length(substring("targetId" FROM 7)) > 160
            )
          ORDER BY "updatedAt" DESC, "id" DESC
          LIMIT 25
        `,
      );

      const unscopedLegacyStats = await tx.$queryRawUnsafe(
        `
          SELECT
            count(DISTINCT conversation."id")::bigint AS "conversationCount",
            count(message."id")::bigint AS "messageCount"
          FROM "Conversation" AS conversation
          LEFT JOIN "Message" AS message
            ON message."conversationId" = conversation."id"
          WHERE conversation."kind" = 'course'
            AND conversation."courseId" IS NULL
            AND conversation."targetId" LIKE 'learn:%'
        `,
      );

      const unscopedLegacyConversations = await tx.$queryRawUnsafe(
        `
          SELECT
            "id",
            "ownerId",
            "targetId",
            "updatedAt"
          FROM "Conversation"
          WHERE "kind" = 'course'
            AND "courseId" IS NULL
            AND "targetId" LIKE 'learn:%'
          ORDER BY "updatedAt" DESC, "id" DESC
          LIMIT 25
        `,
      );

      const invalidRevisions = await tx.$queryRawUnsafe(
        `
          SELECT "id", "ownerId", "courseId", "targetId", "meta"->'clientRevision' AS "revision"
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
          ORDER BY "updatedAt" DESC, "id" DESC
          LIMIT 25
        `,
      );

      const unsupportedActiveRoles = await tx.$queryRawUnsafe(
        `
          SELECT
            message."id",
            message."conversationId",
            message."ownerId",
            message."role"
          FROM "Message" AS message
          INNER JOIN "Conversation" AS conversation
            ON conversation."id" = message."conversationId"
          WHERE conversation."kind" = 'course'
            AND conversation."courseId" IS NOT NULL
            AND conversation."targetId" LIKE 'learn:%'
            AND conversation."meta"->>'deleted' IS DISTINCT FROM 'true'
            AND message."meta"->>'deleted' IS DISTINCT FROM 'true'
            AND message."role" NOT IN ('user', 'assistant')
          ORDER BY message."createdAt" DESC, message."id" DESC
          LIMIT 25
        `,
      );

      const mismatchedMessageOwners = await tx.$queryRawUnsafe(
        `
          SELECT
            message."id",
            message."conversationId",
            message."ownerId" AS "messageOwnerId",
            conversation."ownerId" AS "conversationOwnerId"
          FROM "Message" AS message
          INNER JOIN "Conversation" AS conversation
            ON conversation."id" = message."conversationId"
          WHERE conversation."kind" = 'course'
            AND conversation."courseId" IS NOT NULL
            AND conversation."targetId" LIKE 'learn:%'
            AND message."ownerId" <> conversation."ownerId"
          ORDER BY message."createdAt" DESC, message."id" DESC
          LIMIT 25
        `,
      );

      const invalidQuestionRunConversationScopes = await tx.$queryRawUnsafe(
        `
          SELECT
            run."id",
            run."ownerId",
            run."courseId",
            run."sessionId",
            run."conversationId",
            run."status",
            conversation."ownerId" AS "conversationOwnerId",
            conversation."courseId" AS "conversationCourseId",
            substring(conversation."targetId" FROM 7) AS "conversationSessionId",
            conversation."kind" AS "conversationKind"
          FROM "CourseQuestionRun" AS run
          LEFT JOIN "Conversation" AS conversation
            ON conversation."id" = run."conversationId"
          WHERE run."conversationId" IS NOT NULL
            AND (
              conversation."id" IS NULL
              OR conversation."kind" <> 'course'
              OR conversation."courseId" IS NULL
              OR conversation."targetId" IS NULL
              OR conversation."targetId" NOT LIKE 'learn:%'
              OR length(substring(conversation."targetId" FROM 7)) = 0
              OR length(substring(conversation."targetId" FROM 7)) > 160
              OR run."ownerId" <> conversation."ownerId"
              OR run."courseId" <> conversation."courseId"
              OR run."sessionId" <> substring(conversation."targetId" FROM 7)
            )
          ORDER BY run."updatedAt" DESC, run."id" DESC
          LIMIT 25
        `,
      );

      const longTitles = await tx.$queryRawUnsafe(
        `
          SELECT "id", length("title")::integer AS "titleLength"
          FROM "Conversation"
          WHERE "kind" = 'course'
            AND "courseId" IS NOT NULL
            AND "targetId" LIKE 'learn:%'
            AND length("title") > 200
          ORDER BY length("title") DESC, "id" DESC
          LIMIT 25
        `,
      );

      const questionRunStats = await tx.$queryRawUnsafe(
        `
          SELECT
            count(*)::bigint AS "runCount",
            count(*) FILTER (
              WHERE "conversationId" IS NOT NULL
            )::bigint AS "linkedRunCount"
          FROM "CourseQuestionRun"
        `,
      );

      const memoryReferenceStats = await tx.$queryRawUnsafe(
        `
          ${CANONICAL_MAPPING_CTE},
          memory_refs AS (
            SELECT
              'fact'::text AS "referenceType",
              fact."id",
              fact."ownerId",
              fact."scopeId"
            FROM "MemoryFact" AS fact
            WHERE fact."scopeType" = 'conversation'

            UNION ALL

            SELECT
              'event'::text AS "referenceType",
              event."id",
              event."ownerId",
              event."scopeId"
            FROM "MemoryFactEvent" AS event
            WHERE event."scopeType" = 'conversation'
          ),
          resolved_refs AS (
            SELECT
              reference.*,
              legacy."id" AS "resolvedLegacyConversationId",
              mapping."canonicalConversationId"
            FROM memory_refs AS reference
            LEFT JOIN "Conversation" AS legacy
              ON legacy."id" = reference."scopeId"
            LEFT JOIN canonical_mapping AS mapping
              ON mapping."legacyConversationId" = reference."scopeId"
          )
          SELECT
            count(*) FILTER (
              WHERE "referenceType" = 'fact'
            )::bigint AS "totalFactReferenceCount",
            count(*) FILTER (
              WHERE "referenceType" = 'event'
            )::bigint AS "totalEventReferenceCount",
            count(*) FILTER (
              WHERE "referenceType" = 'fact'
                AND "canonicalConversationId" IS NOT NULL
            )::bigint AS "eligibleFactReferenceCount",
            count(*) FILTER (
              WHERE "referenceType" = 'event'
                AND "canonicalConversationId" IS NOT NULL
            )::bigint AS "eligibleEventReferenceCount",
            count(*) FILTER (
              WHERE "referenceType" = 'fact'
                AND "scopeId" <> "canonicalConversationId"
            )::bigint AS "remappedFactReferenceCount",
            count(*) FILTER (
              WHERE "referenceType" = 'event'
                AND "scopeId" <> "canonicalConversationId"
            )::bigint AS "remappedEventReferenceCount",
            count(*) FILTER (
              WHERE "referenceType" = 'fact'
                AND "resolvedLegacyConversationId" IS NOT NULL
                AND "canonicalConversationId" IS NULL
            )::bigint AS "untouchedLegacyFactReferenceCount",
            count(*) FILTER (
              WHERE "referenceType" = 'event'
                AND "resolvedLegacyConversationId" IS NOT NULL
                AND "canonicalConversationId" IS NULL
            )::bigint AS "untouchedLegacyEventReferenceCount",
            count(*) FILTER (
              WHERE "referenceType" = 'fact'
                AND (
                  "scopeId" IS NULL
                  OR "resolvedLegacyConversationId" IS NULL
                )
            )::bigint AS "danglingFactReferenceCount",
            count(*) FILTER (
              WHERE "referenceType" = 'event'
                AND (
                  "scopeId" IS NULL
                  OR "resolvedLegacyConversationId" IS NULL
                )
            )::bigint AS "danglingEventReferenceCount"
          FROM resolved_refs
        `,
      );

      const mismatchedMemoryReferenceOwners = await tx.$queryRawUnsafe(
        `
          ${CANONICAL_MAPPING_CTE}
          SELECT *
          FROM (
            SELECT
              'fact'::text AS "referenceType",
              fact."id",
              fact."ownerId" AS "referenceOwnerId",
              mapping."ownerId" AS "conversationOwnerId",
              fact."scopeId" AS "legacyConversationId",
              mapping."canonicalConversationId"
            FROM "MemoryFact" AS fact
            INNER JOIN canonical_mapping AS mapping
              ON mapping."legacyConversationId" = fact."scopeId"
            WHERE fact."scopeType" = 'conversation'
              AND fact."ownerId" <> mapping."ownerId"

            UNION ALL

            SELECT
              'event'::text AS "referenceType",
              event."id",
              event."ownerId" AS "referenceOwnerId",
              mapping."ownerId" AS "conversationOwnerId",
              event."scopeId" AS "legacyConversationId",
              mapping."canonicalConversationId"
            FROM "MemoryFactEvent" AS event
            INNER JOIN canonical_mapping AS mapping
              ON mapping."legacyConversationId" = event."scopeId"
            WHERE event."scopeType" = 'conversation'
              AND event."ownerId" <> mapping."ownerId"
          ) AS mismatch
          ORDER BY mismatch."referenceType", mismatch."id"
          LIMIT 25
        `,
      );

      const activeMemoryFactCollisions = await tx.$queryRawUnsafe(
        `
          ${CANONICAL_MAPPING_CTE}
          SELECT
            fact."ownerId",
            mapping."canonicalConversationId",
            fact."namespace",
            fact."key",
            count(*)::bigint AS "rowCount",
            array_agg(fact."id" ORDER BY fact."updatedAt" DESC, fact."id" DESC)
              AS "factIds"
          FROM "MemoryFact" AS fact
          INNER JOIN canonical_mapping AS mapping
            ON mapping."legacyConversationId" = fact."scopeId"
          WHERE fact."scopeType" = 'conversation'
            AND fact."status" = 'active'
          GROUP BY
            fact."ownerId",
            mapping."canonicalConversationId",
            fact."namespace",
            fact."key"
          HAVING count(*) > 1
          ORDER BY count(*) DESC, fact."ownerId", mapping."canonicalConversationId"
          LIMIT 25
        `,
      );

      const untouchedMemoryConversationReferences = await tx.$queryRawUnsafe(
        `
          ${CANONICAL_MAPPING_CTE},
          memory_refs AS (
            SELECT
              'fact'::text AS "referenceType",
              fact."id",
              fact."ownerId",
              fact."scopeId"
            FROM "MemoryFact" AS fact
            WHERE fact."scopeType" = 'conversation'

            UNION ALL

            SELECT
              'event'::text AS "referenceType",
              event."id",
              event."ownerId",
              event."scopeId"
            FROM "MemoryFactEvent" AS event
            WHERE event."scopeType" = 'conversation'
          )
          SELECT
            reference."referenceType",
            reference."id",
            reference."ownerId",
            reference."scopeId",
            CASE
              WHEN reference."scopeId" IS NULL OR legacy."id" IS NULL
                THEN 'dangling'
              ELSE 'non_migrated_legacy_conversation'
            END AS "reason",
            legacy."kind" AS "legacyConversationKind",
            legacy."courseId" AS "legacyCourseId",
            legacy."targetId" AS "legacyTargetId"
          FROM memory_refs AS reference
          LEFT JOIN "Conversation" AS legacy
            ON legacy."id" = reference."scopeId"
          LEFT JOIN canonical_mapping AS mapping
            ON mapping."legacyConversationId" = reference."scopeId"
          WHERE mapping."canonicalConversationId" IS NULL
          ORDER BY "reason", reference."referenceType", reference."id"
          LIMIT 25
        `,
      );

      return {
        targetTables: targetTables[0] ?? {},
        conversationStats: conversationStats[0] ?? {},
        messageStats: messageStats[0] ?? {},
        duplicateGroups,
        malformedConversations,
        unscopedLegacyStats: unscopedLegacyStats[0] ?? {},
        unscopedLegacyConversations,
        invalidRevisions,
        unsupportedActiveRoles,
        mismatchedMessageOwners,
        invalidQuestionRunConversationScopes,
        longTitles,
        questionRunStats: questionRunStats[0] ?? {},
        memoryReferenceStats: memoryReferenceStats[0] ?? {},
        mismatchedMemoryReferenceOwners,
        activeMemoryFactCollisions,
        untouchedMemoryConversationReferences,
      };
    },
    {
      isolationLevel: 'RepeatableRead',
      maxWait: 10_000,
      timeout: 30_000,
    },
  );
}

function buildReport(raw) {
  const audit = jsonSafe(raw);
  const blockers = [];
  const warnings = [];

  if (audit.targetTables.conversationTable || audit.targetTables.messageTable) {
    blockers.push({
      code: 'target_tables_exist',
      count:
        Number(Boolean(audit.targetTables.conversationTable)) +
        Number(Boolean(audit.targetTables.messageTable)),
      details: audit.targetTables,
    });
  }
  for (const [code, rows] of [
    ['malformed_conversations', audit.malformedConversations],
    ['invalid_revisions', audit.invalidRevisions],
    ['unsupported_active_roles', audit.unsupportedActiveRoles],
    ['mismatched_message_owners', audit.mismatchedMessageOwners],
    ['invalid_question_run_conversation_scopes', audit.invalidQuestionRunConversationScopes],
    ['mismatched_memory_reference_owners', audit.mismatchedMemoryReferenceOwners],
    ['active_memory_fact_collisions_after_remap', audit.activeMemoryFactCollisions],
  ]) {
    if (rows.length > 0) blockers.push({ code, count: rows.length, details: rows });
  }
  if (audit.duplicateGroups.length > 0) {
    warnings.push({
      code: 'duplicate_sessions_will_be_merged',
      count: audit.duplicateGroups.length,
      details: audit.duplicateGroups,
    });
  }
  const duplicateStatusConflicts = audit.duplicateGroups.filter((group) => group.statusConflict);
  if (duplicateStatusConflicts.length > 0) {
    warnings.push({
      code: 'duplicate_session_status_conflicts_use_revision_first_canonical_choice',
      count: duplicateStatusConflicts.length,
      details: duplicateStatusConflicts,
    });
  }
  const unscopedLegacyConversationCount = Number(audit.unscopedLegacyStats.conversationCount ?? 0);
  if (unscopedLegacyConversationCount > 0) {
    warnings.push({
      code: 'unscoped_legacy_conversations_left_in_legacy_store',
      count: unscopedLegacyConversationCount,
      details: {
        messageCount: Number(audit.unscopedLegacyStats.messageCount ?? 0),
        conversations: audit.unscopedLegacyConversations,
      },
    });
  }
  if (audit.longTitles.length > 0) {
    warnings.push({
      code: 'titles_will_be_truncated_to_200_characters',
      count: audit.longTitles.length,
      details: audit.longTitles,
    });
  }
  const untouchedLegacyMemoryReferences =
    Number(audit.memoryReferenceStats.untouchedLegacyFactReferenceCount ?? 0) +
    Number(audit.memoryReferenceStats.untouchedLegacyEventReferenceCount ?? 0);
  const danglingMemoryReferences =
    Number(audit.memoryReferenceStats.danglingFactReferenceCount ?? 0) +
    Number(audit.memoryReferenceStats.danglingEventReferenceCount ?? 0);
  if (untouchedLegacyMemoryReferences > 0) {
    warnings.push({
      code: 'non_course_conversation_memory_references_left_untouched',
      count: untouchedLegacyMemoryReferences,
      details: audit.untouchedMemoryConversationReferences.filter(
        (reference) => reference.reason === 'non_migrated_legacy_conversation',
      ),
    });
  }
  if (danglingMemoryReferences > 0) {
    warnings.push({
      code: 'unresolved_conversation_memory_references_left_untouched',
      count: danglingMemoryReferences,
      details: audit.untouchedMemoryConversationReferences.filter(
        (reference) => reference.reason === 'dangling',
      ),
    });
  }

  return {
    ready: blockers.length === 0,
    readOnly: true,
    migration: '20260730020000_add_course_conversation_store',
    database: databaseLabel(),
    inspectedAt: new Date().toISOString(),
    counts: {
      legacyConversations: Number(audit.conversationStats.legacyConversationCount ?? 0),
      canonicalConversations: Number(audit.conversationStats.canonicalConversationCount ?? 0),
      deletedConversations: Number(audit.conversationStats.deletedConversationCount ?? 0),
      duplicateSessionGroups: audit.duplicateGroups.length,
      legacyMessages: Number(audit.messageStats.legacyMessageCount ?? 0),
      visibleMessages: Number(audit.messageStats.visibleMessageCount ?? 0),
      tombstoneMessages: Number(audit.messageStats.tombstoneMessageCount ?? 0),
      unscopedLegacyConversations: unscopedLegacyConversationCount,
      unscopedLegacyMessages: Number(audit.unscopedLegacyStats.messageCount ?? 0),
      courseQuestionRuns: Number(audit.questionRunStats.runCount ?? 0),
      linkedCourseQuestionRuns: Number(audit.questionRunStats.linkedRunCount ?? 0),
      conversationScopedMemoryFacts: Number(
        audit.memoryReferenceStats.totalFactReferenceCount ?? 0,
      ),
      conversationScopedMemoryEvents: Number(
        audit.memoryReferenceStats.totalEventReferenceCount ?? 0,
      ),
      migratableMemoryFacts: Number(audit.memoryReferenceStats.eligibleFactReferenceCount ?? 0),
      migratableMemoryEvents: Number(audit.memoryReferenceStats.eligibleEventReferenceCount ?? 0),
      remappedMemoryFacts: Number(audit.memoryReferenceStats.remappedFactReferenceCount ?? 0),
      remappedMemoryEvents: Number(audit.memoryReferenceStats.remappedEventReferenceCount ?? 0),
      untouchedLegacyMemoryReferences,
      unresolvedMemoryReferences: danglingMemoryReferences,
    },
    blockers,
    warnings,
  };
}

function printText(report) {
  console.log('Course conversation migration preflight (read-only)');
  console.log(`Database: ${report.database ?? 'DATABASE_URL missing'}`);
  console.log(`Migration: ${report.migration}`);
  console.log('');
  console.log('Counts');
  for (const [key, value] of Object.entries(report.counts)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log('');
  if (report.warnings.length > 0) {
    console.log('Warnings');
    for (const warning of report.warnings) {
      console.log(`  ${warning.code}: ${warning.count}`);
    }
    console.log('');
  }
  if (report.blockers.length > 0) {
    console.log('Blockers');
    for (const blocker of report.blockers) {
      console.log(`  ${blocker.code}: ${blocker.count}`);
    }
    console.log('');
  }
  console.log(
    report.ready ? 'READY: migration preflight passed.' : 'BLOCKED: resolve blockers first.',
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }

  loadMaintenanceEnvFiles(process.cwd(), ['.env', '.env.local']);
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the read-only preflight.');
  }

  const prisma = new PrismaClient();
  try {
    const report = buildReport(await inspectDatabase(prisma));
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else printText(report);
    if (!report.ready) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    `[preflight-course-conversation-migration] ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
