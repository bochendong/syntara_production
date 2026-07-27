#!/usr/bin/env node

import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  assertCourseKnowledgeMigrationWriteAllowed,
  databaseHostname,
  hasCourseKnowledgeMigrationFlag,
  loadCourseKnowledgeMigrationEnv,
  selectedCourseId,
} from './course-knowledge-migration-safety.mjs';

const SCRIPT_NAME = 'backfill-course-source-knowledge';
const MAX_CHUNK_CHARS = 1200;
const CHUNK_OVERLAP_CHARS = 180;
const SOURCE_MEMORY_SOURCES = ['source-upload-ingestion', 'source-ingestion-plan'];

loadCourseKnowledgeMigrationEnv();

const apply = hasCourseKnowledgeMigrationFlag('apply');
const courseIdFilter = selectedCourseId();
if (apply) assertCourseKnowledgeMigrationWriteAllowed(SCRIPT_NAME);

const prisma = new PrismaClient();

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function replaceLoneSurrogates(value) {
  const input = String(value || '');
  let output = '';
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += input[index] + input[index + 1];
        index += 1;
      } else {
        output += '\ufffd';
      }
      continue;
    }
    output += code >= 0xdc00 && code <= 0xdfff ? '\ufffd' : input[index];
  }
  return output;
}

function sanitizeLoneSurrogates(value) {
  if (typeof value === 'string') return replaceLoneSurrogates(value);
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(sanitizeLoneSurrogates);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      replaceLoneSurrogates(key),
      sanitizeLoneSurrogates(nested),
    ]),
  );
}

function normalizeText(value) {
  return replaceLoneSurrogates(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function snapshotFingerprint(course, artifacts) {
  const sortedArtifacts = Object.fromEntries(
    Object.entries(artifacts).map(([key, rows]) => [
      key,
      [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id))),
    ]),
  );
  return sha256(JSON.stringify(stableValue({ course, artifacts: sortedArtifacts })));
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function jsonStringAt(value, path) {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) return null;
    current = current[segment];
  }
  return stringValue(current);
}

function jsonBooleanAt(value, path) {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) return null;
    current = current[segment];
  }
  return typeof current === 'boolean' ? current : null;
}

function findSourceHash(value, depth = 0, seen = new Set()) {
  if (depth > 8 || value == null) return null;
  if (typeof value === 'string') {
    const direct = value.match(/^source:([A-Za-z0-9_-]{8,})$/)?.[1];
    return direct || null;
  }
  if (typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSourceHash(item, depth + 1, seen);
      if (found) return found;
    }
    return null;
  }

  for (const key of ['sourceHash', 'uploadSourceHash']) {
    const found = stringValue(value[key]);
    if (found) return found;
  }
  const sourceHash = jsonStringAt(value, ['source', 'hash']);
  if (sourceHash) return sourceHash;
  for (const nested of Object.values(value)) {
    const found = findSourceHash(nested, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

function sourceHashFromFactKey(key) {
  const value = stringValue(key);
  return value?.startsWith('source:') ? value.slice('source:'.length).trim() || null : null;
}

function timestampMs(value) {
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

function addDate(accumulator, createdAt, updatedAt) {
  const created = timestampMs(createdAt);
  const updated = timestampMs(updatedAt);
  if (created != null) {
    accumulator.createdAtMs =
      accumulator.createdAtMs == null ? created : Math.min(accumulator.createdAtMs, created);
  }
  if (updated != null) {
    accumulator.updatedAtMs =
      accumulator.updatedAtMs == null ? updated : Math.max(accumulator.updatedAtMs, updated);
  }
}

function ensureSource(sources, sourceHash) {
  const existing = sources.get(sourceHash);
  if (existing) return existing;
  const created = {
    sourceHash,
    title: null,
    kind: null,
    fileMime: null,
    usageProfile: null,
    topic: null,
    openaiFileId: null,
    coverImagePath: null,
    coverStatus: null,
    allQuestionUpload: null,
    notebookIds: new Set(),
    sectionIds: new Set(),
    problemIds: new Set(),
    importBatchIds: new Set(),
    memoryIds: new Set(),
    factIds: new Set(),
    cacheIds: new Set(),
    extractedTextParts: [],
    createdAtMs: null,
    updatedAtMs: null,
  };
  sources.set(sourceHash, created);
  return created;
}

function publicProblemText(problem) {
  const raw = problem.publicContentJson;
  const serialized = (() => {
    try {
      return JSON.stringify(raw);
    } catch {
      return '';
    }
  })();
  return normalizeText(
    [
      problem.title,
      Array.isArray(problem.tags) && problem.tags.length > 0
        ? `Tags: ${problem.tags.join(', ')}`
        : '',
      serialized,
    ]
      .filter(Boolean)
      .join('\n\n'),
  );
}

function splitText(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  if (normalized.length <= MAX_CHUNK_CHARS) return [normalized];

  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    const hardEnd = Math.min(normalized.length, start + MAX_CHUNK_CHARS);
    const slice = normalized.slice(start, hardEnd);
    const softBreak = Math.max(
      slice.lastIndexOf('\n\n'),
      slice.lastIndexOf('。'),
      slice.lastIndexOf('. '),
    );
    let end = softBreak > MAX_CHUNK_CHARS * 0.55 ? start + softBreak + 1 : hardEnd;
    if (
      end < normalized.length &&
      normalized.charCodeAt(end - 1) >= 0xd800 &&
      normalized.charCodeAt(end - 1) <= 0xdbff &&
      normalized.charCodeAt(end) >= 0xdc00 &&
      normalized.charCodeAt(end) <= 0xdfff
    ) {
      end += 1;
    }
    const chunk = replaceLoneSurrogates(normalized.slice(start, end)).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP_CHARS);
    if (
      start > 0 &&
      normalized.charCodeAt(start - 1) >= 0xd800 &&
      normalized.charCodeAt(start - 1) <= 0xdbff &&
      normalized.charCodeAt(start) >= 0xdc00 &&
      normalized.charCodeAt(start) <= 0xdfff
    ) {
      start -= 1;
    }
  }
  return chunks;
}

function artifactCounts(accumulator) {
  return {
    notebookCount: accumulator.notebookIds.size,
    sectionCount: accumulator.sectionIds.size,
    problemCount: accumulator.problemIds.size,
    importBatchCount: accumulator.importBatchIds.size,
    memoryCount: accumulator.memoryIds.size,
    knowledgeGraphFactCount: accumulator.factIds.size,
    ragEntryCount: accumulator.cacheIds.size,
    openaiFileCount: accumulator.openaiFileId ? 1 : 0,
  };
}

function sourceMetadata(accumulator) {
  return {
    notebookIds: [...accumulator.notebookIds],
    sectionIds: [...accumulator.sectionIds],
    problemIds: [...accumulator.problemIds],
    importBatchIds: [...accumulator.importBatchIds],
    memoryIds: [...accumulator.memoryIds],
    knowledgeGraphFactIds: [...accumulator.factIds],
    ragEntryIds: [...accumulator.cacheIds],
    openaiFileIds: accumulator.openaiFileId ? [accumulator.openaiFileId] : [],
    coverImagePath: accumulator.coverImagePath,
    coverStatus: accumulator.coverStatus,
    allQuestionUpload: accumulator.allQuestionUpload,
    extractedTextRecoveredFromLegacyArtifacts: true,
  };
}

function recoveredSourceText(accumulator) {
  return Array.from(
    new Set(accumulator.extractedTextParts.map(normalizeText).filter(Boolean)),
  ).join('\n\n');
}

async function tableAvailability() {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        to_regclass('"CourseSource"')::text AS "courseSource",
        to_regclass('"KnowledgeDocument"')::text AS "knowledgeDocument",
        to_regclass('"KnowledgeChunk"')::text AS "knowledgeChunk"
    `,
  );
  return rows[0] || {};
}

async function loadLegacyCourseArtifacts(db, course) {
  const [sections, problems, importBatches, facts, memories, cacheEntries] = await Promise.all([
    db.markdownNotebookSection.findMany({
      where: {
        notebook: { ownerId: course.ownerId, courseId: course.id },
        OR: [{ courseId: course.id }, { courseId: null }],
      },
      select: {
        id: true,
        notebookId: true,
        title: true,
        order: true,
        markdown: true,
        summary: true,
        sourceMeta: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.notebookProblem.findMany({
      where: {
        status: { not: 'archived' },
        OR: [
          { courseId: course.id },
          {
            courseId: null,
            notebook: { ownerId: course.ownerId, courseId: course.id },
          },
        ],
      },
      select: {
        id: true,
        notebookId: true,
        title: true,
        tags: true,
        publicContentJson: true,
        sourceMeta: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.problemImportBatch.findMany({
      where: { courseId: course.id },
      select: {
        id: true,
        source: true,
        sourceFileName: true,
        sourceFileMime: true,
        draftSnapshotJson: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.memoryFact.findMany({
      where: {
        ownerId: course.ownerId,
        scopeType: 'course',
        scopeId: course.id,
        namespace: 'knowledge_graph',
        key: { startsWith: 'source:' },
      },
      select: {
        id: true,
        key: true,
        valueJson: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.studyMemory.findMany({
      where: {
        ownerId: course.ownerId,
        source: { in: SOURCE_MEMORY_SOURCES },
        OR: [
          { courseId: course.id },
          {
            courseId: null,
            notebook: { ownerId: course.ownerId, courseId: course.id },
          },
        ],
      },
      select: {
        id: true,
        notebookId: true,
        title: true,
        text: true,
        reason: true,
        scope: true,
        sourceReferences: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db
      .$queryRawUnsafe(
        `
          SELECT
            "id", "sourceId", "sourceType", "title", "previewText",
            "metadata", "createdAt", "updatedAt"
          FROM "MemoryKnowledgeCache"
          WHERE "courseId" = $1
            AND "ownerId" = $2
        `,
        course.id,
        course.ownerId,
      )
      .catch(() => []),
  ]);
  return { sections, problems, importBatches, facts, memories, cacheEntries };
}

async function loadCourseSnapshot(db, courseId) {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      ownerId: true,
      name: true,
      language: true,
    },
  });
  if (!course) throw new Error(`Course disappeared during backfill: ${courseId}`);

  const artifacts = await loadLegacyCourseArtifacts(db, course);
  const sources = aggregateSources(artifacts);
  const documents = documentCandidates(course, artifacts, sources);
  return {
    course,
    artifacts,
    sources,
    documents,
    fingerprint: snapshotFingerprint(course, artifacts),
  };
}

function aggregateSources(artifacts) {
  const sources = new Map();

  for (const section of artifacts.sections) {
    const sourceHash = findSourceHash(section.sourceMeta);
    if (!sourceHash) continue;
    const acc = ensureSource(sources, sourceHash);
    acc.sectionIds.add(section.id);
    acc.notebookIds.add(section.notebookId);
    acc.title ||= jsonStringAt(section.sourceMeta, ['sourceTitle']) || section.title;
    acc.kind ||= jsonStringAt(section.sourceMeta, ['sourceKind']);
    acc.fileMime ||= jsonStringAt(section.sourceMeta, ['sourceFileMime']);
    acc.usageProfile ||= jsonStringAt(section.sourceMeta, ['usageProfile']);
    acc.openaiFileId ||= jsonStringAt(section.sourceMeta, ['openaiFileId']);
    acc.extractedTextParts.push(section.markdown);
    addDate(acc, section.createdAt, section.updatedAt);
  }

  for (const problem of artifacts.problems) {
    const sourceHash = findSourceHash(problem.sourceMeta);
    if (!sourceHash) continue;
    const acc = ensureSource(sources, sourceHash);
    acc.problemIds.add(problem.id);
    if (problem.notebookId) acc.notebookIds.add(problem.notebookId);
    acc.title ||= jsonStringAt(problem.sourceMeta, ['uploadSourceTitle']) || problem.title;
    acc.extractedTextParts.push(publicProblemText(problem));
    addDate(acc, problem.createdAt, problem.updatedAt);
  }

  for (const batch of artifacts.importBatches) {
    const sourceHash = findSourceHash(batch.draftSnapshotJson);
    if (!sourceHash) continue;
    const acc = ensureSource(sources, sourceHash);
    acc.importBatchIds.add(batch.id);
    acc.title = batch.sourceFileName || acc.title;
    acc.kind = batch.source || acc.kind;
    acc.fileMime = batch.sourceFileMime || acc.fileMime;
    addDate(acc, batch.createdAt, batch.updatedAt);
  }

  for (const fact of artifacts.facts) {
    const sourceHash = sourceHashFromFactKey(fact.key) || findSourceHash(fact.valueJson);
    if (!sourceHash) continue;
    const acc = ensureSource(sources, sourceHash);
    acc.factIds.add(fact.id);
    acc.title = jsonStringAt(fact.valueJson, ['source', 'title']) || acc.title;
    acc.kind = jsonStringAt(fact.valueJson, ['source', 'kind']) || acc.kind;
    acc.usageProfile = jsonStringAt(fact.valueJson, ['usageProfile']) || acc.usageProfile;
    acc.topic = jsonStringAt(fact.valueJson, ['topic']) || acc.topic;
    acc.openaiFileId = jsonStringAt(fact.valueJson, ['source', 'openaiFileId']) || acc.openaiFileId;
    acc.coverImagePath = jsonStringAt(fact.valueJson, ['cover', 'imagePath']) || acc.coverImagePath;
    acc.coverStatus = jsonStringAt(fact.valueJson, ['cover', 'status']) || acc.coverStatus;
    acc.allQuestionUpload =
      jsonBooleanAt(fact.valueJson, ['allQuestionUpload']) ?? acc.allQuestionUpload;
    const notebookId = jsonStringAt(fact.valueJson, ['notebookId']);
    if (notebookId) acc.notebookIds.add(notebookId);
    const sectionId = jsonStringAt(fact.valueJson, ['sectionId']);
    if (sectionId) acc.sectionIds.add(sectionId);
    addDate(acc, fact.createdAt, fact.updatedAt);
  }

  for (const memory of artifacts.memories) {
    const sourceHash = findSourceHash(memory.sourceReferences);
    if (!sourceHash) continue;
    const acc = ensureSource(sources, sourceHash);
    acc.memoryIds.add(memory.id);
    if (memory.notebookId) acc.notebookIds.add(memory.notebookId);
    acc.title ||= memory.title;
    if (memory.scope === 'public') acc.extractedTextParts.push(memory.text);
    addDate(acc, memory.createdAt, memory.updatedAt);
  }

  for (const cache of artifacts.cacheEntries) {
    const sourceHash = findSourceHash(cache.metadata) || sourceHashFromFactKey(cache.sourceId);
    if (!sourceHash) continue;
    const acc = ensureSource(sources, sourceHash);
    acc.cacheIds.add(cache.id);
    acc.title ||= cache.title;
    acc.kind ||= jsonStringAt(cache.metadata, ['sourceKind']) || cache.sourceType;
    acc.usageProfile ||= jsonStringAt(cache.metadata, ['usageProfile']);
    acc.topic ||= jsonStringAt(cache.metadata, ['topic']);
    acc.openaiFileId ||= jsonStringAt(cache.metadata, ['openaiFileId']);
    acc.coverImagePath ||= jsonStringAt(cache.metadata, ['coverImagePath']);
    acc.coverStatus ||= jsonStringAt(cache.metadata, ['coverStatus']);
    if (cache.previewText) acc.extractedTextParts.push(cache.previewText);
    const notebookId = jsonStringAt(cache.metadata, ['notebookId']);
    if (notebookId) acc.notebookIds.add(notebookId);
    const sectionId = jsonStringAt(cache.metadata, ['sectionId']);
    if (sectionId) acc.sectionIds.add(sectionId);
    addDate(acc, cache.createdAt, cache.updatedAt);
  }

  return sources;
}

function documentCandidates(course, artifacts, sources) {
  const documents = [];
  for (const source of sources.values()) {
    const content = recoveredSourceText(source);
    if (!content || source.kind === 'problem_bank' || source.allQuestionUpload === true) continue;
    documents.push({
      sourceHash: source.sourceHash,
      documentKey: `course_source:${source.sourceHash}`,
      documentType: 'course_source',
      sourceEntityType: 'CourseSource',
      sourceEntityId: source.sourceHash,
      notebookId: null,
      title: source.title || `上传文件 ${source.sourceHash.slice(0, 8)}`,
      summary: null,
      content,
      language: course.language,
      metadataJson: {
        sourceHash: source.sourceHash,
        sourceKind: source.kind,
        recoveredFromLegacyArtifacts: true,
      },
    });
  }

  for (const section of artifacts.sections) {
    const sourceHash = findSourceHash(section.sourceMeta);
    if (!normalizeText(section.markdown)) continue;
    documents.push({
      sourceHash,
      documentKey: `markdown_section:${section.id}`,
      documentType: 'markdown_section',
      sourceEntityType: 'MarkdownNotebookSection',
      sourceEntityId: section.id,
      notebookId: section.notebookId,
      title: section.title,
      summary: section.summary,
      content: normalizeText(section.markdown),
      language: course.language,
      metadataJson: {
        sourceHash,
        order: section.order,
      },
    });
  }

  for (const problem of artifacts.problems) {
    const sourceHash = findSourceHash(problem.sourceMeta);
    const content = publicProblemText(problem);
    if (!content) continue;
    documents.push({
      sourceHash,
      documentKey: `problem:${problem.id}`,
      documentType: 'problem',
      sourceEntityType: 'NotebookProblem',
      sourceEntityId: problem.id,
      notebookId: problem.notebookId,
      title: problem.title,
      summary: null,
      content,
      language: course.language,
      metadataJson: {
        sourceHash: sourceHash || null,
        tags: problem.tags,
      },
    });
  }

  for (const memory of artifacts.memories) {
    if (memory.scope !== 'public') continue;
    const sourceHash = findSourceHash(memory.sourceReferences);
    const content = normalizeText(memory.text);
    if (!sourceHash || !content) continue;
    documents.push({
      sourceHash,
      documentKey: `study_memory:${memory.id}`,
      documentType: 'source_summary',
      sourceEntityType: 'StudyMemory',
      sourceEntityId: memory.id,
      notebookId: memory.notebookId,
      title: memory.title,
      summary: memory.reason,
      content,
      language: course.language,
      metadataJson: {
        sourceHash,
      },
    });
  }
  return documents;
}

function isRecoveredCourseSource(row) {
  return (
    isRecord(row?.metadataJson) &&
    row.metadataJson.extractedTextRecoveredFromLegacyArtifacts === true
  );
}

async function upsertDocument(tx, course, sourceIdByHash, document) {
  const safeDocument = sanitizeLoneSurrogates(document);
  const chunks = splitText(
    [safeDocument.title, safeDocument.summary || '', safeDocument.content]
      .filter(Boolean)
      .join('\n\n'),
  );
  const contentHash = sha256(safeDocument.content);
  const courseSourceId = safeDocument.sourceHash
    ? sourceIdByHash.get(safeDocument.sourceHash) || null
    : null;
  if (safeDocument.sourceHash && !courseSourceId) {
    return { chunks: 0, status: 'protected_source' };
  }

  const sourceEntityId =
    safeDocument.documentType === 'course_source'
      ? courseSourceId || safeDocument.sourceEntityId
      : safeDocument.sourceEntityId;
  const existing = await tx.knowledgeDocument.findUnique({
    where: {
      courseId_documentKey: {
        courseId: course.id,
        documentKey: safeDocument.documentKey,
      },
    },
    select: {
      courseSourceId: true,
    },
  });
  if (existing?.courseSourceId && (!courseSourceId || existing.courseSourceId !== courseSourceId)) {
    return { chunks: 0, status: 'ownership_conflict' };
  }

  const row = await tx.knowledgeDocument.upsert({
    where: {
      courseId_documentKey: {
        courseId: course.id,
        documentKey: document.documentKey,
      },
    },
    create: {
      ownerId: course.ownerId,
      courseId: course.id,
      courseSourceId,
      notebookId: safeDocument.notebookId,
      documentKey: safeDocument.documentKey,
      documentType: safeDocument.documentType,
      sourceEntityType: safeDocument.sourceEntityType,
      sourceEntityId,
      title: safeDocument.title,
      summary: safeDocument.summary,
      content: safeDocument.content,
      contentHash,
      language: safeDocument.language,
      visibility: 'course',
      status: 'ready',
      errorReason: null,
      metadataJson: safeDocument.metadataJson,
      chunkCount: chunks.length,
      indexedAt: new Date(),
    },
    update: {
      ownerId: course.ownerId,
      courseSourceId,
      notebookId: safeDocument.notebookId,
      documentType: safeDocument.documentType,
      sourceEntityType: safeDocument.sourceEntityType,
      sourceEntityId,
      title: safeDocument.title,
      summary: safeDocument.summary,
      content: safeDocument.content,
      contentHash,
      language: safeDocument.language,
      visibility: 'course',
      status: 'ready',
      errorReason: null,
      metadataJson: safeDocument.metadataJson,
      chunkCount: chunks.length,
      indexedAt: new Date(),
    },
    select: { id: true },
  });

  await tx.knowledgeChunk.deleteMany({ where: { documentId: row.id } });
  if (chunks.length > 0) {
    await tx.knowledgeChunk.createMany({
      data: chunks.map((chunkText, chunkIndex) => ({
        documentId: row.id,
        ownerId: course.ownerId,
        courseId: course.id,
        courseSourceId,
        notebookId: safeDocument.notebookId,
        documentType: safeDocument.documentType,
        visibility: 'course',
        chunkIndex,
        chunkText,
        contentHash: sha256(`${contentHash}\n${chunkIndex}\n${chunkText}`),
        tokenCount: Math.ceil(chunkText.length / 3),
        metadataJson: safeDocument.metadataJson,
      })),
    });
  }
  return { chunks: chunks.length, status: 'written' };
}

function summarizeSnapshot(snapshot) {
  const expectedChunkCount = snapshot.documents.reduce(
    (total, document) =>
      total +
      splitText(
        [document.title, document.summary || '', document.content].filter(Boolean).join('\n\n'),
      ).length,
    0,
  );
  return {
    courseId: snapshot.course.id,
    courseName: snapshot.course.name,
    sources: snapshot.sources.size,
    documents: snapshot.documents.length,
    chunks: expectedChunkCount,
    sectionsScanned: snapshot.artifacts.sections.length,
    problemsScanned: snapshot.artifacts.problems.length,
  };
}

function recoveredSourceWriteData(course, accumulator) {
  const updatedAt = new Date(accumulator.updatedAtMs || accumulator.createdAtMs || Date.now());
  const extractedText = recoveredSourceText(accumulator);
  return sanitizeLoneSurrogates({
    ownerId: course.ownerId,
    courseId: course.id,
    sourceHash: accumulator.sourceHash,
    title: accumulator.title || `上传文件 ${accumulator.sourceHash.slice(0, 8)}`,
    kind: accumulator.kind || 'other',
    fileMime: accumulator.fileMime,
    usageProfile: accumulator.usageProfile,
    topic: accumulator.topic,
    openaiFileId: accumulator.openaiFileId,
    extractedText: extractedText || null,
    extractedTextHash: extractedText ? sha256(extractedText) : null,
    ingestStatus: 'ready',
    indexStatus: 'pending',
    indexLeaseToken: null,
    indexLeaseExpiresAt: null,
    errorReason: null,
    metadataJson: sourceMetadata(accumulator),
    artifactCountsJson: artifactCounts(accumulator),
    ingestedAt: updatedAt,
  });
}

async function ensureWritableRecoveredSource(tx, course, accumulator) {
  const data = recoveredSourceWriteData(course, accumulator);
  const recoveredOnly = {
    courseId: course.id,
    sourceHash: accumulator.sourceHash,
    metadataJson: {
      path: ['extractedTextRecoveredFromLegacyArtifacts'],
      equals: true,
    },
  };

  const updated = await tx.courseSource.updateMany({
    where: recoveredOnly,
    data,
  });
  if (updated.count === 0) {
    await tx.courseSource.createMany({
      data: [data],
      skipDuplicates: true,
    });
  }

  const row = await tx.courseSource.findUnique({
    where: {
      courseId_sourceHash: {
        courseId: course.id,
        sourceHash: accumulator.sourceHash,
      },
    },
    select: {
      id: true,
      metadataJson: true,
    },
  });
  return isRecoveredCourseSource(row) ? row : null;
}

async function applyCourseSnapshot(tx, snapshot) {
  const { course, sources, documents } = snapshot;

  const sourceIdByHash = new Map();
  for (const accumulator of sources.values()) {
    const row = await ensureWritableRecoveredSource(tx, course, accumulator);
    if (row) sourceIdByHash.set(accumulator.sourceHash, row.id);
  }

  let writtenChunks = 0;
  let writtenDocuments = 0;
  let protectedDocuments = 0;
  let ownershipConflicts = 0;
  for (const document of documents) {
    const result = await upsertDocument(tx, course, sourceIdByHash, document);
    writtenChunks += result.chunks;
    if (result.status === 'written') writtenDocuments += 1;
    if (result.status === 'protected_source') protectedDocuments += 1;
    if (result.status === 'ownership_conflict') ownershipConflicts += 1;
  }

  return {
    sourceIdByHash,
    writtenChunks,
    writtenDocuments,
    protectedDocuments,
    ownershipConflicts,
  };
}

async function finalizeRecoveredSources(tx, courseId, sourceIds) {
  if (sourceIds.length === 0) return 0;
  const settled = await tx.courseSource.updateMany({
    where: {
      id: { in: sourceIds },
      courseId,
      metadataJson: {
        path: ['extractedTextRecoveredFromLegacyArtifacts'],
        equals: true,
      },
    },
    data: {
      indexStatus: 'ready',
      indexLeaseToken: null,
      indexLeaseExpiresAt: null,
      errorReason: null,
      indexedAt: new Date(),
    },
  });
  if (settled.count !== sourceIds.length) {
    throw new Error(
      `Recovered CourseSource ownership changed before ready settlement for course ${courseId}.`,
    );
  }
  return settled.count;
}

async function processCourse(courseHint) {
  if (!apply) {
    return summarizeSnapshot(await loadCourseSnapshot(prisma, courseHint.id));
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))::text AS "locked"',
        `knowledge-course:${courseHint.id}`,
      );

      const initialSnapshot = await loadCourseSnapshot(tx, courseHint.id);
      const summary = summarizeSnapshot(initialSnapshot);
      const writes = await applyCourseSnapshot(tx, initialSnapshot);

      const finalSnapshot = await loadCourseSnapshot(tx, courseHint.id);
      if (finalSnapshot.fingerprint !== initialSnapshot.fingerprint) {
        throw new Error(
          `Legacy course snapshot changed during backfill; rolled back course ${courseHint.id}.`,
        );
      }

      const writableSourceIds = [...writes.sourceIdByHash.values()];
      const finalizedSources = await finalizeRecoveredSources(
        tx,
        initialSnapshot.course.id,
        writableSourceIds,
      );
      return {
        ...summary,
        writtenSources: writes.sourceIdByHash.size,
        protectedSources: initialSnapshot.sources.size - writes.sourceIdByHash.size,
        writtenDocuments: writes.writtenDocuments,
        protectedDocuments: writes.protectedDocuments,
        ownershipConflicts: writes.ownershipConflicts,
        writtenChunks: writes.writtenChunks,
        finalizedSources,
      };
    },
    {
      maxWait: 10_000,
      timeout: 300_000,
      isolationLevel: 'ReadCommitted',
    },
  );
}

async function main() {
  const availability = await tableAvailability();
  if (
    apply &&
    (!availability.courseSource || !availability.knowledgeDocument || !availability.knowledgeChunk)
  ) {
    throw new Error(
      'CourseSource/KnowledgeDocument/KnowledgeChunk are not installed. Apply the additive Prisma migration first.',
    );
  }

  const courses = await prisma.course.findMany({
    where: courseIdFilter ? { id: courseIdFilter } : undefined,
    select: {
      id: true,
      ownerId: true,
      name: true,
      language: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (courseIdFilter && courses.length === 0) {
    throw new Error(`Course not found: ${courseIdFilter}`);
  }

  const results = [];
  for (const course of courses) {
    results.push(await processCourse(course));
  }
  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        databaseHost: databaseHostname(),
        tableAvailability: availability,
        courseId: courseIdFilter,
        totals: results.reduce(
          (total, result) => ({
            courses: total.courses + 1,
            sources: total.sources + result.sources,
            documents: total.documents + result.documents,
            chunks: total.chunks + result.chunks,
          }),
          { courses: 0, sources: 0, documents: 0, chunks: 0 },
        ),
        courses: results,
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
