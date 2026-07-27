#!/usr/bin/env node

import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';
import {
  assertCourseKnowledgeMigrationWriteAllowed,
  databaseHostname,
  hasCourseKnowledgeMigrationFlag,
  loadCourseKnowledgeMigrationEnv,
  selectedCourseId,
} from './course-knowledge-migration-safety.mjs';

loadCourseKnowledgeMigrationEnv();

const SCRIPT_NAME = 'reindex-course-knowledge-chunks';
const EMBEDDING_MODEL =
  process.env.COURSE_KNOWLEDGE_EMBEDDING_MODEL?.trim() ||
  process.env.STUDY_MEMORY_EMBEDDING_MODEL?.trim() ||
  'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const EMBEDDING_BATCH_SIZE = 64;
const apply = hasCourseKnowledgeMigrationFlag('apply');
const courseIdFilter = selectedCourseId();
if (apply) assertCourseKnowledgeMigrationWriteAllowed(SCRIPT_NAME);

const prisma = new PrismaClient();

function numericFlag(name, fallback, min, max) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

const limit = numericFlag('limit', 500, 1, 5000);

function vectorLiteral(values) {
  return `[${values.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}]`;
}

function embeddingClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(`${SCRIPT_NAME} requires OPENAI_API_KEY when --apply is used.`);
  }
  return new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
    timeout: 60_000,
    maxRetries: 2,
  });
}

async function tableExists() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('"KnowledgeChunk"')::text AS "knowledgeChunk"`,
  );
  return Boolean(rows[0]?.knowledgeChunk);
}

async function pendingChunks() {
  return prisma.$queryRawUnsafe(
    `
      SELECT
        c."id",
        c."documentId",
        c."courseId",
        c."courseSourceId",
        c."chunkText",
        c."contentHash"
      FROM "KnowledgeChunk" c
      INNER JOIN "KnowledgeDocument" d ON d."id" = c."documentId"
      WHERE c."embedding" IS NULL
        AND d."status" = 'ready'
        AND c."ownerId" = d."ownerId"
        AND c."courseId" = d."courseId"
        AND c."courseSourceId" IS NOT DISTINCT FROM d."courseSourceId"
        AND c."notebookId" IS NOT DISTINCT FROM d."notebookId"
        AND c."documentType" = d."documentType"
        AND c."visibility" = d."visibility"
        AND d."visibility" = 'course'
        AND (
          c."courseSourceId" IS NULL
          OR EXISTS (
            SELECT 1
            FROM "CourseSource" source
            WHERE source."id" = c."courseSourceId"
              AND source."ownerId" = c."ownerId"
              AND source."courseId" = c."courseId"
              AND source."indexStatus" = 'ready'
          )
        )
        AND ($1::text IS NULL OR c."courseId" = $1)
      ORDER BY c."updatedAt" ASC, c."id" ASC
      LIMIT $2
    `,
    courseIdFilter,
    limit,
  );
}

async function createEmbeddings(client, input) {
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  const embeddings = response.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
  if (
    embeddings.length !== input.length ||
    embeddings.some((embedding) => embedding.length !== EMBEDDING_DIMENSIONS)
  ) {
    throw new Error(
      `Embedding response mismatch: requested ${input.length}, received ${embeddings.length}.`,
    );
  }
  return embeddings;
}

async function writeEmbeddingBatch(rows, embeddings) {
  const updates = await prisma.$transaction(
    rows.map((row, index) =>
      prisma.$executeRawUnsafe(
        `
          UPDATE "KnowledgeChunk"
          SET
            "embedding" = $2::vector,
            "embeddingModel" = $3,
            "embeddingDimensions" = $4,
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = $1
            AND "contentHash" = $5
            AND "embedding" IS NULL
        `,
        row.id,
        vectorLiteral(embeddings[index] || []),
        EMBEDDING_MODEL,
        EMBEDDING_DIMENSIONS,
        row.contentHash,
      ),
    ),
  );
  return updates.reduce((total, count) => total + count, 0);
}

async function settleDocumentStatuses(documentIds) {
  if (documentIds.length > 0) {
    await prisma.$executeRawUnsafe(
      `
        UPDATE "KnowledgeDocument" d
        SET
          "errorReason" = NULL,
          "indexedAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE d."id" = ANY($1::text[])
          AND d."status" = 'ready'
          AND d."chunkCount" > 0
          AND d."chunkCount" = (
            SELECT COUNT(*)
            FROM "KnowledgeChunk" counted_chunk
            WHERE counted_chunk."documentId" = d."id"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "KnowledgeChunk" c
            WHERE c."documentId" = d."id"
              AND (
                c."embedding" IS NULL
                OR c."ownerId" IS DISTINCT FROM d."ownerId"
                OR c."courseId" IS DISTINCT FROM d."courseId"
                OR c."courseSourceId" IS DISTINCT FROM d."courseSourceId"
                OR c."notebookId" IS DISTINCT FROM d."notebookId"
                OR c."documentType" IS DISTINCT FROM d."documentType"
                OR c."visibility" IS DISTINCT FROM d."visibility"
              )
          )
      `,
      documentIds,
    );
  }
}

async function main() {
  if (!(await tableExists())) {
    throw new Error(
      'KnowledgeChunk is not installed. Apply the additive CourseSource/Knowledge migration first.',
    );
  }
  const rows = await pendingChunks();
  const audit = {
    mode: apply ? 'apply' : 'dry-run',
    databaseHost: databaseHostname(),
    courseId: courseIdFilter,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    pendingSelected: rows.length,
    limit,
  };
  if (!apply || rows.length === 0) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }

  const client = embeddingClient();
  let indexed = 0;
  for (let start = 0; start < rows.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = rows.slice(start, start + EMBEDDING_BATCH_SIZE);
    const embeddings = await createEmbeddings(
      client,
      batch.map((row) => row.chunkText),
    );
    indexed += await writeEmbeddingBatch(batch, embeddings);
  }

  const documentIds = [...new Set(rows.map((row) => row.documentId).filter(Boolean))];
  const courseSourceIds = [...new Set(rows.map((row) => row.courseSourceId).filter(Boolean))];
  await settleDocumentStatuses(documentIds);
  console.log(
    JSON.stringify(
      {
        ...audit,
        indexed,
        skippedAfterSourceChange: rows.length - indexed,
        documentsTouched: documentIds.length,
        sourcesTouched: courseSourceIds.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
