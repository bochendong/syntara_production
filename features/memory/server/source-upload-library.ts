import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@/lib/server/generated-prisma';
import { refreshCourseSummaryFields } from '@/lib/server/repositories/notebook-repository';
import { ensureKnowledgeCacheTable } from '@/features/memory/server/knowledge-cache';
import { getSystemLLMRuntimeConfig } from '@/lib/server/system-llm-config';
import { proxyFetch } from '@/lib/server/proxy-fetch';
import {
  deleteStoredCourseSource,
  findStoredCourseSource,
  listStoredCourseSources,
  type CourseSourceIndexStatus,
  type CourseSourceIngestStatus,
  type StoredCourseSource,
} from '@/features/memory/server/course-source-store';
import {
  hasCourseEnrollment,
  type CourseAccessRole,
} from '@/lib/server/repositories/course-enrollment-repository';
import { detachCourseProblemSource } from '@/features/memory/server/detach-course-problem-source.mjs';

export type CourseSourceUploadRecord = {
  courseId: string;
  sourceHash: string;
  title: string;
  kind: string;
  fileMime: string | null;
  usageProfile: string | null;
  topic: string | null;
  coverImagePath: string | null;
  coverStatus: string | null;
  allQuestionUpload: boolean | null;
  ingestStatus: CourseSourceIngestStatus;
  indexStatus: CourseSourceIndexStatus;
  errorReason: string | null;
  contentVersion: number;
  notebookIds: string[];
  sectionIds: string[];
  problemIds: string[];
  reusedProblemIds: string[];
  importBatchIds: string[];
  memoryIds: string[];
  templateMemoryIds: string[];
  knowledgeGraphFactIds: string[];
  ragEntryIds: string[];
  openaiFileIds: string[];
  textSections: Array<{
    id: string;
    notebookId: string;
    title: string;
    order: number;
    markdown: string;
  }>;
  createdAt: string;
  updatedAt: string;
  stats: {
    notebookCount: number;
    sectionCount: number;
    problemCount: number;
    importBatchCount: number;
    memoryCount: number;
    templateMemoryCount: number;
    knowledgeGraphFactCount: number;
    ragEntryCount: number;
    openaiFileCount: number;
  };
};

export type DeleteCourseSourceUploadResult = {
  source: CourseSourceUploadRecord;
  cleanupErrors: string[];
  preservedProblems: number;
  detachedProblemProvenance: number;
  deleted: {
    notebooks: number;
    sections: number;
    problems: number;
    importBatches: number;
    memories: number;
    templateMemories: number;
    memoryFacts: number;
    memoryFactEvents: number;
    ragEntries: number;
    openaiFiles: number;
  };
};

type SourceUploadAccumulator = {
  sourceHash: string;
  title: string | null;
  kind: string | null;
  fileMime: string | null;
  usageProfile: string | null;
  topic: string | null;
  coverImagePath: string | null;
  coverStatus: string | null;
  allQuestionUpload: boolean | null;
  notebookIds: Set<string>;
  sectionIds: Set<string>;
  problemIds: Set<string>;
  reusedProblemIds: Set<string>;
  importBatchIds: Set<string>;
  memoryIds: Set<string>;
  templateMemoryIds: Set<string>;
  knowledgeGraphFactIds: Set<string>;
  ragEntryIds: Set<string>;
  openaiFileIds: Set<string>;
  textSections: Array<{
    id: string;
    notebookId: string;
    title: string;
    order: number;
    markdown: string;
  }>;
  createdAtMs: number | null;
  updatedAtMs: number | null;
};

type SourceUploadCollection = {
  records: CourseSourceUploadRecord[];
  byHash: Map<string, CourseSourceUploadRecord>;
};

type DatabaseRead<T> = () => Promise<T>;
type DatabaseReadResults<T extends readonly DatabaseRead<unknown>[]> = {
  [K in keyof T]: T[K] extends DatabaseRead<infer TResult> ? TResult : never;
};

async function runDatabaseReads<T extends readonly DatabaseRead<unknown>[]>(
  reads: T,
  serialize: boolean,
): Promise<DatabaseReadResults<T>> {
  if (!serialize) {
    return (await Promise.all(reads.map((read) => read()))) as DatabaseReadResults<T>;
  }

  const results: unknown[] = [];
  for (const read of reads) {
    results.push(await read());
  }
  return results as DatabaseReadResults<T>;
}

type RawMemoryKnowledgeCacheRow = {
  id: string;
  sourceId: string;
  sourceType: string;
  title: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

const SOURCE_KEY_PREFIX = 'source:';
const SOURCE_MEMORY_SOURCES = ['source-upload-ingestion', 'source-ingestion-plan'];
const LEGACY_SECTION_SOURCE_HASH_PREFIX = 'legacy-section-';

export function isLegacySectionSourceHash(sourceHash: string): boolean {
  return sourceHash.startsWith(LEGACY_SECTION_SOURCE_HASH_PREFIX);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)),
  );
}

function dateMs(value: Date | string | number | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function isoFromMs(value: number | null): string {
  return new Date(value ?? Date.now()).toISOString();
}

function addDate(acc: SourceUploadAccumulator, createdAt: Date, updatedAt: Date) {
  const created = dateMs(createdAt);
  const updated = dateMs(updatedAt);
  if (created !== null) acc.createdAtMs = Math.min(acc.createdAtMs ?? created, created);
  if (updated !== null) acc.updatedAtMs = Math.max(acc.updatedAtMs ?? updated, updated);
}

function addIfPresent(target: Set<string>, value: string | null | undefined) {
  const trimmed = value?.trim();
  if (trimmed) target.add(trimmed);
}

function readSourceHashFromKey(key: string | null | undefined): string | null {
  const value = key?.trim() || '';
  return value.startsWith(SOURCE_KEY_PREFIX) ? value.slice(SOURCE_KEY_PREFIX.length) || null : null;
}

function readJsonString(value: unknown, path: string[]): string | null {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return stringValue(current);
}

function readJsonBoolean(value: unknown, path: string[]): boolean | null {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return booleanValue(current);
}

function readJsonStringArray(value: unknown, path: string[]): string[] {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return [];
    current = current[key];
  }
  return stringArray(current);
}

function legacySectionSource(meta: unknown): {
  sourceHash: string;
  title: string;
  kind: string | null;
} | null {
  const sourcePath = readJsonString(meta, ['sourcePath']);
  const lectureLabel = readJsonString(meta, ['lectureLabel']);
  if (!sourcePath && !lectureLabel) return null;

  const normalizedSourcePath = sourcePath
    ?.normalize('NFKC')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .trim();
  const identityType = normalizedSourcePath ? 'sourcePath' : 'lectureLabel';
  const identity =
    normalizedSourcePath || lectureLabel!.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const sourceHash = `${LEGACY_SECTION_SOURCE_HASH_PREFIX}${createHash('sha256')
    .update(`${identityType}\0${identity}`)
    .digest('hex')}`;
  const pathFileName = normalizedSourcePath?.split('/').filter(Boolean).at(-1) || null;

  return {
    sourceHash,
    title: lectureLabel || pathFileName || identity,
    kind: readJsonString(meta, ['sourceKind']),
  };
}

function findSourceHash(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSourceHash(item);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  const direct = stringValue(value.sourceHash) || stringValue(value.uploadSourceHash);
  if (direct) return direct;
  for (const nested of Object.values(value)) {
    const found = findSourceHash(nested);
    if (found) return found;
  }
  return null;
}

function findSourceTitle(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSourceTitle(item);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  const title =
    stringValue(value.sourceTitle) ||
    stringValue(value.uploadSourceTitle) ||
    stringValue(value.title);
  if (title) return title;
  for (const nested of Object.values(value)) {
    const found = findSourceTitle(nested);
    if (found) return found;
  }
  return null;
}

function normalizeTitle(input: string | null): string {
  return (input || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function finalizeRecord(acc: SourceUploadAccumulator, courseId: string): CourseSourceUploadRecord {
  const notebookIds = Array.from(acc.notebookIds);
  const sectionIds = Array.from(acc.sectionIds);
  const problemIds = Array.from(acc.problemIds);
  const reusedProblemIds = Array.from(acc.reusedProblemIds);
  const importBatchIds = Array.from(acc.importBatchIds);
  const memoryIds = Array.from(acc.memoryIds);
  const templateMemoryIds = Array.from(acc.templateMemoryIds);
  const knowledgeGraphFactIds = Array.from(acc.knowledgeGraphFactIds);
  const ragEntryIds = Array.from(acc.ragEntryIds);
  const openaiFileIds = Array.from(acc.openaiFileIds);
  const textSections = acc.textSections
    .slice()
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN'));
  const createdAt = isoFromMs(acc.createdAtMs ?? acc.updatedAtMs);
  const updatedAt = isoFromMs(acc.updatedAtMs ?? acc.createdAtMs);

  return {
    courseId,
    sourceHash: acc.sourceHash,
    title: acc.title || `上传文件 ${acc.sourceHash.slice(0, 8)}`,
    kind: acc.kind || 'other',
    fileMime: acc.fileMime,
    usageProfile: acc.usageProfile,
    topic: acc.topic,
    coverImagePath: acc.coverImagePath,
    coverStatus: acc.coverStatus,
    allQuestionUpload: acc.allQuestionUpload,
    ingestStatus: 'ready',
    indexStatus: 'pending',
    errorReason: null,
    contentVersion: 1,
    notebookIds,
    sectionIds,
    problemIds,
    reusedProblemIds,
    importBatchIds,
    memoryIds,
    templateMemoryIds,
    knowledgeGraphFactIds,
    ragEntryIds,
    openaiFileIds,
    textSections,
    createdAt,
    updatedAt,
    stats: {
      notebookCount: notebookIds.length,
      sectionCount: sectionIds.length,
      problemCount: problemIds.length,
      importBatchCount: importBatchIds.length,
      memoryCount: memoryIds.length,
      templateMemoryCount: templateMemoryIds.length,
      knowledgeGraphFactCount: knowledgeGraphFactIds.length,
      ragEntryCount: ragEntryIds.length,
      openaiFileCount: openaiFileIds.length,
    },
  };
}

function storedSourceRecord(source: StoredCourseSource): CourseSourceUploadRecord {
  const metadata = isRecord(source.metadataJson) ? source.metadataJson : {};
  const counts = isRecord(source.artifactCountsJson) ? source.artifactCountsJson : {};
  const notebookIds = stringArray(metadata.notebookIds);
  const sectionIds = stringArray(metadata.sectionIds);
  const reusedProblemIds = stringArray(metadata.reusedProblemIds);
  const problemIds = Array.from(
    new Set([...stringArray(metadata.problemIds), ...reusedProblemIds]),
  );
  const importBatchIds = stringArray(metadata.importBatchIds);
  const memoryIds = stringArray(metadata.memoryIds);
  const templateMemoryIds = stringArray(metadata.templateMemoryIds);
  const knowledgeGraphFactIds = stringArray(metadata.knowledgeGraphFactIds);
  const ragEntryIds = stringArray(metadata.ragEntryIds);
  const openaiFileIds = Array.from(
    new Set([
      ...stringArray(metadata.openaiFileIds),
      ...(source.openaiFileId ? [source.openaiFileId] : []),
    ]),
  );

  return {
    courseId: source.courseId,
    sourceHash: source.sourceHash,
    title: source.title,
    kind: source.kind,
    fileMime: source.fileMime,
    usageProfile: source.usageProfile,
    topic: source.topic,
    coverImagePath: stringValue(metadata.coverImagePath),
    coverStatus: stringValue(metadata.coverStatus),
    allQuestionUpload: booleanValue(metadata.allQuestionUpload),
    ingestStatus: source.ingestStatus,
    indexStatus: source.indexStatus,
    errorReason: source.errorReason,
    contentVersion: source.contentVersion,
    notebookIds,
    sectionIds,
    problemIds,
    reusedProblemIds,
    importBatchIds,
    memoryIds,
    templateMemoryIds,
    knowledgeGraphFactIds,
    ragEntryIds,
    openaiFileIds,
    textSections: [],
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
    stats: {
      notebookCount: numberValue(counts.notebookCount),
      sectionCount: numberValue(counts.sectionCount),
      problemCount: Math.max(numberValue(counts.problemCount), problemIds.length),
      importBatchCount: numberValue(counts.importBatchCount),
      memoryCount: numberValue(counts.memoryCount),
      templateMemoryCount: numberValue(counts.templateMemoryCount),
      knowledgeGraphFactCount: numberValue(counts.knowledgeGraphFactCount),
      ragEntryCount: numberValue(counts.ragEntryCount),
      openaiFileCount: numberValue(counts.openaiFileCount),
    },
  };
}

async function hydrateStoredSourceTextSections(args: {
  prisma: PrismaClient;
  userId: string;
  courseId: string;
  records: CourseSourceUploadRecord[];
  includeTextSections?: boolean;
}): Promise<CourseSourceUploadRecord[]> {
  if (args.includeTextSections === false || args.records.length === 0) return args.records;
  const sourceHashes = new Set(args.records.map((record) => record.sourceHash));
  const sections = await args.prisma.markdownNotebookSection.findMany({
    where: {
      notebook: { ownerId: args.userId, courseId: args.courseId },
      OR: [{ courseId: args.courseId }, { courseId: null }],
    },
    select: {
      id: true,
      notebookId: true,
      title: true,
      order: true,
      markdown: true,
      sourceMeta: true,
    },
  });
  const sectionsByHash = new Map<string, CourseSourceUploadRecord['textSections']>();
  for (const section of sections) {
    const sourceHash = readJsonString(section.sourceMeta, ['sourceHash']);
    if (!sourceHash || !sourceHashes.has(sourceHash)) continue;
    const entries = sectionsByHash.get(sourceHash) || [];
    entries.push({
      id: section.id,
      notebookId: section.notebookId,
      title: section.title,
      order: section.order,
      markdown: section.markdown,
    });
    sectionsByHash.set(sourceHash, entries);
  }
  return args.records.map((record) => ({
    ...record,
    textSections: (sectionsByHash.get(record.sourceHash) || []).sort(
      (a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN'),
    ),
  }));
}

function mergeStoredSourceWithArtifacts(
  stored: CourseSourceUploadRecord,
  artifacts: CourseSourceUploadRecord | null,
): CourseSourceUploadRecord {
  if (!artifacts) return stored;
  const mergeIds = (left: string[], right: string[]) => Array.from(new Set([...left, ...right]));
  const notebookIds = mergeIds(stored.notebookIds, artifacts.notebookIds);
  const sectionIds = mergeIds(stored.sectionIds, artifacts.sectionIds);
  const reusedProblemIds = mergeIds(stored.reusedProblemIds, artifacts.reusedProblemIds);
  const problemIds = mergeIds(mergeIds(stored.problemIds, artifacts.problemIds), reusedProblemIds);
  const importBatchIds = mergeIds(stored.importBatchIds, artifacts.importBatchIds);
  const memoryIds = mergeIds(stored.memoryIds, artifacts.memoryIds);
  const templateMemoryIds = mergeIds(stored.templateMemoryIds, artifacts.templateMemoryIds);
  const knowledgeGraphFactIds = mergeIds(
    stored.knowledgeGraphFactIds,
    artifacts.knowledgeGraphFactIds,
  );
  const ragEntryIds = mergeIds(stored.ragEntryIds, artifacts.ragEntryIds);
  const openaiFileIds = mergeIds(stored.openaiFileIds, artifacts.openaiFileIds);
  return {
    ...stored,
    notebookIds,
    sectionIds,
    problemIds,
    reusedProblemIds,
    importBatchIds,
    memoryIds,
    templateMemoryIds,
    knowledgeGraphFactIds,
    ragEntryIds,
    openaiFileIds,
    textSections: artifacts.textSections,
    stats: {
      notebookCount: Math.max(
        stored.stats.notebookCount,
        artifacts.stats.notebookCount,
        notebookIds.length,
      ),
      sectionCount: Math.max(
        stored.stats.sectionCount,
        artifacts.stats.sectionCount,
        sectionIds.length,
      ),
      problemCount: Math.max(
        stored.stats.problemCount,
        artifacts.stats.problemCount,
        problemIds.length,
      ),
      importBatchCount: Math.max(
        stored.stats.importBatchCount,
        artifacts.stats.importBatchCount,
        importBatchIds.length,
      ),
      memoryCount: Math.max(
        stored.stats.memoryCount,
        artifacts.stats.memoryCount,
        memoryIds.length,
      ),
      templateMemoryCount: Math.max(
        stored.stats.templateMemoryCount,
        artifacts.stats.templateMemoryCount,
        templateMemoryIds.length,
      ),
      knowledgeGraphFactCount: Math.max(
        stored.stats.knowledgeGraphFactCount,
        artifacts.stats.knowledgeGraphFactCount,
        knowledgeGraphFactIds.length,
      ),
      ragEntryCount: Math.max(
        stored.stats.ragEntryCount,
        artifacts.stats.ragEntryCount,
        ragEntryIds.length,
      ),
      openaiFileCount: Math.max(
        stored.stats.openaiFileCount,
        artifacts.stats.openaiFileCount,
        openaiFileIds.length,
      ),
    },
  };
}

type CourseSourceCatalogReadMode = 'dual' | 'catalog';

function courseSourceCatalogReadMode(): CourseSourceCatalogReadMode {
  return process.env.COURSE_SOURCE_CATALOG_READ_MODE?.trim().toLowerCase() === 'dual'
    ? 'dual'
    : 'catalog';
}

function sortCourseSourceRecords(records: CourseSourceUploadRecord[]): CourseSourceUploadRecord[] {
  return records.sort(
    (a, b) =>
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.title.localeCompare(b.title, 'zh-CN'),
  );
}

function mergeCatalogAndLegacySourceRecords(args: {
  stored: StoredCourseSource[] | null;
  legacy: CourseSourceUploadRecord[];
}): CourseSourceUploadRecord[] {
  if (!args.stored) return args.legacy;
  const byHash = new Map(args.legacy.map((record) => [record.sourceHash, record] as const));
  for (const source of args.stored) {
    const stored = storedSourceRecord(source);
    byHash.set(
      stored.sourceHash,
      mergeStoredSourceWithArtifacts(stored, byHash.get(stored.sourceHash) ?? null),
    );
  }
  return sortCourseSourceRecords(Array.from(byHash.values()));
}

async function requireOwnedCourse(args: {
  prisma: PrismaClient;
  userId: string;
  courseId: string;
}) {
  const course = await args.prisma.course.findFirst({
    where: { id: args.courseId, ownerId: args.userId },
    select: { id: true },
  });
  if (!course) throw new Error('Course not found');
  return course;
}

async function requireReadableCourse(args: {
  prisma: PrismaClient;
  userId: string;
  courseId: string;
}): Promise<{ ownerId: string; accessRole: CourseAccessRole }> {
  const course = await args.prisma.course.findUnique({
    where: { id: args.courseId },
    select: { ownerId: true },
  });
  if (!course) throw new Error('Course not found');
  if (course.ownerId === args.userId) {
    return { ownerId: course.ownerId, accessRole: 'owner' };
  }
  const enrolled = await hasCourseEnrollment(args.prisma, args.userId, args.courseId);
  if (!enrolled) throw new Error('Course not found');
  return { ownerId: course.ownerId, accessRole: 'enrolled' };
}

function sourceRecordForReader(
  record: CourseSourceUploadRecord,
  accessRole: CourseAccessRole,
): CourseSourceUploadRecord {
  if (accessRole === 'owner') return record;
  return {
    ...record,
    errorReason: record.errorReason ? '资料暂时不可用，请联系课程创建者。' : null,
    importBatchIds: [],
    memoryIds: [],
    templateMemoryIds: [],
    knowledgeGraphFactIds: [],
    ragEntryIds: [],
    openaiFileIds: [],
  };
}

function ensureSourceUpload(
  uploads: Map<string, SourceUploadAccumulator>,
  sourceHash: string,
): SourceUploadAccumulator {
  const existing = uploads.get(sourceHash);
  if (existing) return existing;
  const created: SourceUploadAccumulator = {
    sourceHash,
    title: null,
    kind: null,
    fileMime: null,
    usageProfile: null,
    topic: null,
    coverImagePath: null,
    coverStatus: null,
    allQuestionUpload: null,
    notebookIds: new Set(),
    sectionIds: new Set(),
    problemIds: new Set(),
    reusedProblemIds: new Set(),
    importBatchIds: new Set(),
    memoryIds: new Set(),
    templateMemoryIds: new Set(),
    knowledgeGraphFactIds: new Set(),
    ragEntryIds: new Set(),
    openaiFileIds: new Set(),
    textSections: [],
    createdAtMs: null,
    updatedAtMs: null,
  };
  uploads.set(sourceHash, created);
  return created;
}

async function collectCourseSourceUploads(args: {
  prisma: PrismaClient;
  userId: string;
  courseId: string;
  includeTextSections?: boolean;
  includeArtifacts?: boolean;
  ownershipVerified?: boolean;
  serializeDatabaseReads?: boolean;
}): Promise<SourceUploadCollection> {
  if (!args.ownershipVerified) {
    await requireOwnedCourse(args);
  }

  const uploads = new Map<string, SourceUploadAccumulator>();
  const includeTextSections = args.includeTextSections !== false;
  const includeArtifacts = args.includeArtifacts !== false;
  if (includeArtifacts) {
    await ensureKnowledgeCacheTable(args.prisma);
  }

  const [sections, problems, importBatches, facts, cacheEntries, memories] = await runDatabaseReads(
    [
      () =>
        args.prisma.markdownNotebookSection.findMany({
          where: {
            notebook: { ownerId: args.userId, courseId: args.courseId },
            OR: [{ courseId: args.courseId }, { courseId: null }],
          },
          select: {
            id: true,
            notebookId: true,
            title: true,
            order: true,
            ...(includeTextSections ? { markdown: true } : {}),
            sourceMeta: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      () =>
        includeArtifacts
          ? args.prisma.notebookProblem.findMany({
              where: {
                OR: [
                  { courseId: args.courseId },
                  {
                    courseId: null,
                    notebook: { courseId: args.courseId, ownerId: args.userId },
                  },
                ],
              },
              select: {
                id: true,
                notebookId: true,
                title: true,
                sourceMeta: true,
                createdAt: true,
                updatedAt: true,
              },
            })
          : Promise.resolve([]),
      () =>
        includeArtifacts
          ? args.prisma.problemImportBatch.findMany({
              where: {
                ownerId: args.userId,
                courseId: args.courseId,
              },
              select: {
                id: true,
                source: true,
                sourceFileName: true,
                sourceFileMime: true,
                draftSnapshotJson: true,
                createdAt: true,
                updatedAt: true,
              },
            })
          : Promise.resolve([]),
      () =>
        includeArtifacts
          ? args.prisma.memoryFact.findMany({
              where: {
                ownerId: args.userId,
                scopeType: 'course',
                scopeId: args.courseId,
                namespace: 'knowledge_graph',
                key: { startsWith: SOURCE_KEY_PREFIX },
              },
              select: {
                id: true,
                key: true,
                valueJson: true,
                createdAt: true,
                updatedAt: true,
              },
            })
          : Promise.resolve([]),
      () =>
        includeArtifacts
          ? args.prisma.$queryRaw<RawMemoryKnowledgeCacheRow[]>(Prisma.sql`
                SELECT "id", "sourceId", "sourceType", "title", "metadata", "createdAt", "updatedAt"
                FROM "MemoryKnowledgeCache"
                WHERE "ownerId" = ${args.userId}
                  AND "courseId" = ${args.courseId}
              `)
          : Promise.resolve([] as RawMemoryKnowledgeCacheRow[]),
      () =>
        includeArtifacts
          ? args.prisma.studyMemory.findMany({
              where: {
                ownerId: args.userId,
                source: { in: SOURCE_MEMORY_SOURCES },
                OR: [
                  { courseId: args.courseId },
                  {
                    courseId: null,
                    notebook: { courseId: args.courseId, ownerId: args.userId },
                  },
                ],
              },
              select: {
                id: true,
                source: true,
                kind: true,
                title: true,
                notebookId: true,
                sourceReferences: true,
                createdAt: true,
                updatedAt: true,
              },
            })
          : Promise.resolve([]),
    ] as const,
    args.serializeDatabaseReads === true,
  );

  for (const section of sections) {
    const meta = section.sourceMeta;
    const explicitSourceHash = readJsonString(meta, ['sourceHash']);
    const legacySource = explicitSourceHash ? null : legacySectionSource(meta);
    const sourceHash = explicitSourceHash || legacySource?.sourceHash;
    if (!sourceHash) continue;
    const acc = ensureSourceUpload(uploads, sourceHash);
    acc.sectionIds.add(section.id);
    acc.notebookIds.add(section.notebookId);
    if (includeTextSections) {
      acc.textSections.push({
        id: section.id,
        notebookId: section.notebookId,
        title: section.title,
        order: section.order,
        markdown:
          typeof (section as { markdown?: unknown }).markdown === 'string'
            ? (section as { markdown: string }).markdown
            : '',
      });
    }
    acc.title ||= readJsonString(meta, ['sourceTitle']) || legacySource?.title || section.title;
    acc.kind ||= readJsonString(meta, ['sourceKind']) || legacySource?.kind || null;
    acc.fileMime ||= readJsonString(meta, ['sourceFileMime']);
    acc.usageProfile ||= readJsonString(meta, ['usageProfile']);
    addIfPresent(acc.openaiFileIds, readJsonString(meta, ['openaiFileId']));
    addDate(acc, section.createdAt, section.updatedAt);
  }

  for (const problem of problems) {
    const meta = problem.sourceMeta;
    const sourceHash = readJsonString(meta, ['uploadSourceHash']);
    if (!sourceHash) continue;
    const acc = ensureSourceUpload(uploads, sourceHash);
    acc.problemIds.add(problem.id);
    addIfPresent(acc.notebookIds, problem.notebookId);
    const importBatchId = readJsonString(meta, ['importBatchId']);
    addIfPresent(acc.importBatchIds, importBatchId);
    acc.title ||= readJsonString(meta, ['sourceTitle']);
    addDate(acc, problem.createdAt, problem.updatedAt);
  }

  const batchById = new Map(importBatches.map((batch) => [batch.id, batch] as const));
  for (const acc of uploads.values()) {
    for (const batchId of acc.importBatchIds) {
      const batch = batchById.get(batchId);
      if (!batch) continue;
      acc.title = batch.sourceFileName || acc.title;
      acc.kind = batch.source || acc.kind;
      acc.fileMime = batch.sourceFileMime || acc.fileMime;
      addDate(acc, batch.createdAt, batch.updatedAt);
    }
  }
  for (const batch of importBatches) {
    const sourceHash = findSourceHash(batch.draftSnapshotJson);
    if (!sourceHash) continue;
    const acc = ensureSourceUpload(uploads, sourceHash);
    acc.importBatchIds.add(batch.id);
    acc.title = batch.sourceFileName || acc.title;
    acc.kind = batch.source || acc.kind;
    acc.fileMime = batch.sourceFileMime || acc.fileMime;
    addDate(acc, batch.createdAt, batch.updatedAt);
  }

  for (const fact of facts) {
    const sourceHash =
      readSourceHashFromKey(fact.key) || readJsonString(fact.valueJson, ['source', 'hash']);
    if (!sourceHash) continue;
    const acc = ensureSourceUpload(uploads, sourceHash);
    acc.knowledgeGraphFactIds.add(fact.id);
    acc.title = readJsonString(fact.valueJson, ['source', 'title']) || acc.title;
    acc.kind = readJsonString(fact.valueJson, ['source', 'kind']) || acc.kind;
    acc.usageProfile = readJsonString(fact.valueJson, ['usageProfile']) || acc.usageProfile;
    acc.topic = readJsonString(fact.valueJson, ['topic']) || acc.topic;
    acc.coverImagePath =
      readJsonString(fact.valueJson, ['cover', 'imagePath']) || acc.coverImagePath;
    acc.coverStatus = readJsonString(fact.valueJson, ['cover', 'status']) || acc.coverStatus;
    acc.allQuestionUpload = readJsonBoolean(fact.valueJson, ['allQuestionUpload']);
    addIfPresent(acc.openaiFileIds, readJsonString(fact.valueJson, ['source', 'openaiFileId']));
    addIfPresent(acc.notebookIds, readJsonString(fact.valueJson, ['notebookId']));
    addIfPresent(acc.sectionIds, readJsonString(fact.valueJson, ['sectionId']));
    for (const problemId of readJsonStringArray(fact.valueJson, ['problemIds'])) {
      acc.problemIds.add(problemId);
    }
    for (const problemId of readJsonStringArray(fact.valueJson, ['reusedProblemIds'])) {
      acc.problemIds.add(problemId);
      acc.reusedProblemIds.add(problemId);
    }
    addDate(acc, fact.createdAt, fact.updatedAt);
  }

  for (const cacheEntry of cacheEntries) {
    const sourceHash =
      readJsonString(cacheEntry.metadata, ['sourceHash']) ||
      readSourceHashFromKey(cacheEntry.sourceId);
    if (!sourceHash) continue;
    const acc = ensureSourceUpload(uploads, sourceHash);
    acc.ragEntryIds.add(cacheEntry.id);
    acc.title ||= cacheEntry.title;
    acc.kind =
      readJsonString(cacheEntry.metadata, ['sourceKind']) || acc.kind || cacheEntry.sourceType;
    acc.usageProfile = readJsonString(cacheEntry.metadata, ['usageProfile']) || acc.usageProfile;
    acc.topic = readJsonString(cacheEntry.metadata, ['topic']) || acc.topic;
    acc.coverImagePath =
      readJsonString(cacheEntry.metadata, ['coverImagePath']) || acc.coverImagePath;
    acc.coverStatus = readJsonString(cacheEntry.metadata, ['coverStatus']) || acc.coverStatus;
    addIfPresent(acc.openaiFileIds, readJsonString(cacheEntry.metadata, ['openaiFileId']));
    addIfPresent(acc.notebookIds, readJsonString(cacheEntry.metadata, ['notebookId']));
    addIfPresent(acc.sectionIds, readJsonString(cacheEntry.metadata, ['sectionId']));
    for (const problemId of readJsonStringArray(cacheEntry.metadata, ['problemIds'])) {
      acc.problemIds.add(problemId);
    }
    for (const problemId of readJsonStringArray(cacheEntry.metadata, ['reusedProblemIds'])) {
      acc.problemIds.add(problemId);
      acc.reusedProblemIds.add(problemId);
    }
    addDate(acc, cacheEntry.createdAt, cacheEntry.updatedAt);
  }

  for (const memory of memories) {
    const sourceHash = findSourceHash(memory.sourceReferences);
    if (!sourceHash) continue;
    const acc = ensureSourceUpload(uploads, sourceHash);
    acc.memoryIds.add(memory.id);
    if (memory.kind === 'course_template') acc.templateMemoryIds.add(memory.id);
    addIfPresent(acc.notebookIds, memory.notebookId);
    acc.title ||= findSourceTitle(memory.sourceReferences) || memory.title;
    addDate(acc, memory.createdAt, memory.updatedAt);
  }

  // Backfill old source-ingestion-plan template memories that predate sourceHash tagging.
  const titleToAcc = new Map<string, SourceUploadAccumulator>();
  for (const acc of uploads.values()) {
    const key = normalizeTitle(acc.title);
    if (key) titleToAcc.set(key, acc);
  }
  for (const memory of memories) {
    if (memoryIdsContainAny(uploads, memory.id)) continue;
    if (memory.source !== 'source-ingestion-plan') continue;
    const sourceTitle = findSourceTitle(memory.sourceReferences);
    const acc = titleToAcc.get(normalizeTitle(sourceTitle));
    if (!acc) continue;
    acc.memoryIds.add(memory.id);
    if (memory.kind === 'course_template') acc.templateMemoryIds.add(memory.id);
    addIfPresent(acc.notebookIds, memory.notebookId);
    addDate(acc, memory.createdAt, memory.updatedAt);
  }

  const records = Array.from(uploads.values())
    .map((acc) => finalizeRecord(acc, args.courseId))
    .sort(
      (a, b) =>
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
        a.title.localeCompare(b.title, 'zh-CN'),
    );
  return {
    records,
    byHash: new Map(records.map((record) => [record.sourceHash, record] as const)),
  };
}

function memoryIdsContainAny(uploads: Map<string, SourceUploadAccumulator>, memoryId: string) {
  for (const acc of uploads.values()) {
    if (acc.memoryIds.has(memoryId)) return true;
  }
  return false;
}

async function refreshNotebookSummariesAfterSourceDelete(args: {
  tx: Prisma.TransactionClient;
  ownerId: string;
  courseId: string;
  sourceHash: string;
  notebookIds: string[];
}) {
  const notebookIds = Array.from(new Set(args.notebookIds.filter(Boolean)));
  if (notebookIds.length === 0) return 0;

  let deletedNotebookCount = 0;
  for (const notebookId of notebookIds) {
    const notebook = await args.tx.notebook.findFirst({
      where: { id: notebookId, ownerId: args.ownerId, courseId: args.courseId },
      select: { id: true, notebookKind: true, coverSlideJson: true },
    });
    if (!notebook) continue;

    const [sectionCount, pageCount, sceneCount, problemCount, publishedProblemCount] =
      await Promise.all([
        args.tx.markdownNotebookSection.count({ where: { notebookId } }),
        args.tx.notebookPage.count({ where: { notebookId } }),
        args.tx.scene.count({ where: { notebookId } }),
        args.tx.notebookProblem.count({ where: { notebookId } }),
        args.tx.notebookProblem.count({ where: { notebookId, status: 'published' } }),
      ]);

    if (
      notebook.notebookKind === 'markdown' &&
      sectionCount === 0 &&
      pageCount === 0 &&
      sceneCount === 0 &&
      problemCount === 0
    ) {
      await args.tx.notebook.delete({ where: { id: notebookId } });
      deletedNotebookCount += 1;
      continue;
    }

    const coverSourceHash = readJsonString(notebook.coverSlideJson, ['sourceCover', 'sourceHash']);
    const shouldClearSourceCover = coverSourceHash === args.sourceHash;

    await args.tx.notebook.update({
      where: { id: notebookId },
      data: {
        sectionCount,
        problemCount,
        publishedProblemCount,
        ...(shouldClearSourceCover
          ? {
              coverSlideJson: Prisma.DbNull,
              coverImagePath: null,
            }
          : {}),
        contentVersion: { increment: 1 },
        updatedAt: new Date(),
      },
    });
  }

  return deletedNotebookCount;
}

export async function deleteOpenAIUserFiles(
  fileIds: string[],
): Promise<{ deletedCount: number; errors: string[] }> {
  const uniqueFileIds = Array.from(new Set(fileIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueFileIds.length === 0) return { deletedCount: 0, errors: [] };
  const config = await getSystemLLMRuntimeConfig();
  if (!config.apiKey) {
    return {
      deletedCount: 0,
      errors: ['OpenAI file cleanup skipped because the system API key is missing.'],
    };
  }
  const baseUrl = config.baseUrl?.replace(/\/+$/, '') || 'https://api.openai.com/v1';
  if (!/api\.openai\.com\/v1$/.test(baseUrl)) {
    return {
      deletedCount: 0,
      errors: ['OpenAI file cleanup skipped because the configured endpoint is not OpenAI.'],
    };
  }

  let deleted = 0;
  const errors: string[] = [];
  for (const fileId of uniqueFileIds) {
    try {
      const response = await proxyFetch(`${baseUrl}/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) {
        deleted += 1;
      } else if (response.status !== 404) {
        const responseText = await response.text().catch(() => '');
        errors.push(
          `OpenAI file ${fileId} cleanup failed (${response.status})${
            responseText ? `: ${responseText.slice(0, 240)}` : ''
          }`,
        );
      }
    } catch (error) {
      errors.push(
        `OpenAI file ${fileId} cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return { deletedCount: deleted, errors };
}

export async function listCourseSourceUploads(args: {
  prisma: PrismaClient;
  userId: string;
  courseId: string;
  includeTextSections?: boolean;
  includeArtifacts?: boolean;
  serializeDatabaseReads?: boolean;
}): Promise<CourseSourceUploadRecord[]> {
  const { ownerId, accessRole } = await requireReadableCourse(args);
  const storedArgs = {
    prisma: args.prisma,
    ownerId,
    courseId: args.courseId,
  };

  if (courseSourceCatalogReadMode() === 'catalog') {
    const stored = await listStoredCourseSources(storedArgs);
    if (stored !== null) {
      const records = await hydrateStoredSourceTextSections({
        prisma: args.prisma,
        userId: ownerId,
        courseId: args.courseId,
        includeTextSections: args.includeTextSections,
        records: stored.map(storedSourceRecord),
      });
      return records.map((record) => sourceRecordForReader(record, accessRole));
    }
    const collection = await collectCourseSourceUploads({
      prisma: args.prisma,
      userId: ownerId,
      courseId: args.courseId,
      includeTextSections: args.includeTextSections,
      includeArtifacts: args.includeArtifacts,
      ownershipVerified: true,
      serializeDatabaseReads: args.serializeDatabaseReads,
    });
    return collection.records.map((record) => sourceRecordForReader(record, accessRole));
  }

  const [stored, collection] = await runDatabaseReads(
    [
      () => listStoredCourseSources(storedArgs),
      () =>
        collectCourseSourceUploads({
          prisma: args.prisma,
          userId: ownerId,
          courseId: args.courseId,
          includeTextSections: args.includeTextSections,
          includeArtifacts: args.includeArtifacts,
          ownershipVerified: true,
          serializeDatabaseReads: args.serializeDatabaseReads,
        }),
    ] as const,
    args.serializeDatabaseReads === true,
  );
  const records = mergeCatalogAndLegacySourceRecords({
    stored,
    legacy: collection.records,
  });
  return records.map((record) => sourceRecordForReader(record, accessRole));
}

export async function deleteCourseSourceUpload(args: {
  prisma: PrismaClient;
  userId: string;
  courseId: string;
  sourceHash: string;
  preserveCatalog?: boolean;
  preserveProblems?: boolean;
}): Promise<DeleteCourseSourceUploadResult> {
  const sourceHash = args.sourceHash.trim();
  if (!sourceHash) throw new Error('Source upload not found');

  // Deletion immediately opens an interactive transaction after this snapshot.
  // Keep the preflight reads serialized so a small Prisma pool (for example,
  // connection_limit=3 in local Railway development) cannot be exhausted by
  // the catalog read plus the six legacy-artifact reads.
  const [stored, storedSources, collection] = await runDatabaseReads(
    [
      () => findStoredCourseSource({ ...args, sourceHash }),
      () =>
        listStoredCourseSources({
          prisma: args.prisma,
          ownerId: args.userId,
          courseId: args.courseId,
        }),
      () =>
        collectCourseSourceUploads({
          prisma: args.prisma,
          userId: args.userId,
          courseId: args.courseId,
          serializeDatabaseReads: true,
        }),
    ] as const,
    true,
  );
  const legacySource = collection.byHash.get(sourceHash) ?? null;
  const source = stored.source
    ? mergeStoredSourceWithArtifacts(storedSourceRecord(stored.source), legacySource)
    : legacySource;
  if (!source) throw new Error('Source upload not found');

  const notebookIds = Array.from(new Set(source.notebookIds.filter(Boolean)));
  const reusedProblemIdSet = new Set(source.reusedProblemIds);
  for (const otherStoredSource of storedSources ?? []) {
    if (otherStoredSource.sourceHash === sourceHash) continue;
    for (const problemId of storedSourceRecord(otherStoredSource).problemIds) {
      reusedProblemIdSet.add(problemId);
    }
  }
  for (const otherArtifactSource of collection.records) {
    if (otherArtifactSource.sourceHash === sourceHash) continue;
    for (const problemId of otherArtifactSource.problemIds) {
      reusedProblemIdSet.add(problemId);
    }
  }
  const retainedProblemIds = source.problemIds.filter((problemId) =>
    reusedProblemIdSet.has(problemId),
  );
  const deletableProblemIds = source.problemIds.filter(
    (problemId) => !reusedProblemIdSet.has(problemId),
  );
  let deletedNotebookCount = 0;
  let deletedSectionCount = 0;
  let deletedProblemCount = 0;
  let deletedImportBatchCount = 0;
  let deletedMemoryCount = 0;
  let deletedTemplateMemoryCount = 0;
  let deletedMemoryFactCount = 0;
  let deletedRagEntryCount = 0;
  let deletedFactEventCount = 0;
  let deletedOpenAIFileCount = 0;
  let preservedProblemCount = 0;
  let detachedProblemProvenanceCount = 0;

  await args.prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      await deleteStoredCourseSource({
        prisma: tx,
        userId: args.userId,
        courseId: args.courseId,
        sourceHash,
        preserveSource: args.preserveCatalog,
      });
      const memoryFactEvents = await tx.memoryFactEvent.deleteMany({
        where: {
          ownerId: args.userId,
          scopeType: 'course',
          scopeId: args.courseId,
          namespace: 'knowledge_graph',
          key: `${SOURCE_KEY_PREFIX}${sourceHash}`,
        },
      });
      deletedFactEventCount = memoryFactEvents.count;

      if (source.memoryIds.length > 0) {
        const templateIds = new Set(source.templateMemoryIds);
        const templateMemoryIds = source.memoryIds.filter((id) => templateIds.has(id));
        const otherMemoryIds = source.memoryIds.filter((id) => !templateIds.has(id));
        const memoryCourseScope: Prisma.StudyMemoryWhereInput[] = [
          { courseId: args.courseId },
          {
            courseId: null,
            notebook: { courseId: args.courseId, ownerId: args.userId },
          },
        ];
        if (templateMemoryIds.length > 0) {
          const deletedTemplateMemories = await tx.studyMemory.deleteMany({
            where: {
              id: { in: templateMemoryIds },
              ownerId: args.userId,
              OR: memoryCourseScope,
            },
          });
          deletedTemplateMemoryCount = deletedTemplateMemories.count;
        }
        if (otherMemoryIds.length > 0) {
          const deletedOtherMemories = await tx.studyMemory.deleteMany({
            where: {
              id: { in: otherMemoryIds },
              ownerId: args.userId,
              OR: memoryCourseScope,
            },
          });
          deletedMemoryCount = deletedOtherMemories.count;
        }
        deletedMemoryCount += deletedTemplateMemoryCount;
      }

      if (source.ragEntryIds.length > 0) {
        deletedRagEntryCount = await tx.$executeRaw(Prisma.sql`
          DELETE FROM "MemoryKnowledgeCache"
          WHERE "ownerId" = ${args.userId}
            AND "courseId" = ${args.courseId}
            AND "id" IN (${Prisma.join(source.ragEntryIds)})
        `);
      }

      if (source.knowledgeGraphFactIds.length > 0) {
        const deletedFacts = await tx.memoryFact.deleteMany({
          where: {
            id: { in: source.knowledgeGraphFactIds },
            ownerId: args.userId,
            scopeType: 'course',
            scopeId: args.courseId,
          },
        });
        deletedMemoryFactCount = deletedFacts.count;
      } else {
        const deletedFacts = await tx.memoryFact.deleteMany({
          where: {
            ownerId: args.userId,
            scopeType: 'course',
            scopeId: args.courseId,
            namespace: 'knowledge_graph',
            key: `${SOURCE_KEY_PREFIX}${sourceHash}`,
          },
        });
        deletedMemoryFactCount = deletedFacts.count;
      }

      if (!args.preserveProblems && retainedProblemIds.length > 0) {
        const retainedProblems = await tx.notebookProblem.findMany({
          where: {
            id: { in: retainedProblemIds },
            OR: [
              { courseId: args.courseId },
              {
                courseId: null,
                notebook: { courseId: args.courseId, ownerId: args.userId },
              },
            ],
          },
          select: {
            id: true,
            sourceMeta: true,
          },
        });
        const detachedAt = new Date().toISOString();
        for (const problem of retainedProblems) {
          preservedProblemCount += 1;
          const detached = detachCourseProblemSource({
            sourceMeta: problem.sourceMeta,
            sourceDigest: sourceHash,
            sourceTitle: source.title,
            detachedAt,
          });
          if (!detached.changed) continue;
          await tx.notebookProblem.update({
            where: { id: problem.id },
            data: { sourceMeta: detached.sourceMeta as Prisma.InputJsonValue },
          });
          detachedProblemProvenanceCount += 1;
        }
      }

      if (args.preserveProblems) {
        const courseProblems = await tx.notebookProblem.findMany({
          where: {
            OR: [
              { courseId: args.courseId },
              {
                courseId: null,
                notebook: { courseId: args.courseId, ownerId: args.userId },
              },
            ],
          },
          select: {
            id: true,
            sourceMeta: true,
          },
        });
        const linkedProblemIds = new Set(source.problemIds);
        const detachedAt = new Date().toISOString();
        for (const problem of courseProblems) {
          const detached = detachCourseProblemSource({
            sourceMeta: problem.sourceMeta,
            sourceDigest: sourceHash,
            sourceTitle: source.title,
            detachedAt,
          });
          if (linkedProblemIds.has(problem.id) || detached.changed) {
            preservedProblemCount += 1;
          }
          if (!detached.changed) continue;
          await tx.notebookProblem.update({
            where: { id: problem.id },
            data: { sourceMeta: detached.sourceMeta as Prisma.InputJsonValue },
          });
          detachedProblemProvenanceCount += 1;
        }
      } else if (deletableProblemIds.length > 0) {
        const deletedProblems = await tx.notebookProblem.deleteMany({
          where: {
            id: { in: deletableProblemIds },
            OR: [
              { courseId: args.courseId },
              {
                courseId: null,
                notebook: { courseId: args.courseId, ownerId: args.userId },
              },
            ],
          },
        });
        deletedProblemCount = deletedProblems.count;
      }

      if (source.importBatchIds.length > 0) {
        const deletedImportBatches = await tx.problemImportBatch.deleteMany({
          where: {
            id: { in: source.importBatchIds },
            ownerId: args.userId,
            courseId: args.courseId,
          },
        });
        deletedImportBatchCount = deletedImportBatches.count;
      }

      if (source.sectionIds.length > 0) {
        const deletedSections = await tx.markdownNotebookSection.deleteMany({
          where: {
            id: { in: source.sectionIds },
            notebook: { ownerId: args.userId, courseId: args.courseId },
            OR: [{ courseId: args.courseId }, { courseId: null }],
          },
        });
        deletedSectionCount = deletedSections.count;
      }

      deletedNotebookCount = await refreshNotebookSummariesAfterSourceDelete({
        tx,
        ownerId: args.userId,
        courseId: args.courseId,
        sourceHash,
        notebookIds,
      });
      await refreshCourseSummaryFields(tx, args.courseId);
    },
    {
      maxWait: 30_000,
      timeout: 120_000,
    },
  );
  const openAICleanup = await deleteOpenAIUserFiles(source.openaiFileIds);
  deletedOpenAIFileCount = openAICleanup.deletedCount;

  return {
    source,
    cleanupErrors: openAICleanup.errors,
    preservedProblems: preservedProblemCount,
    detachedProblemProvenance: detachedProblemProvenanceCount,
    deleted: {
      notebooks: deletedNotebookCount,
      sections: deletedSectionCount,
      problems: deletedProblemCount,
      importBatches: deletedImportBatchCount,
      memories: deletedMemoryCount,
      templateMemories: deletedTemplateMemoryCount,
      memoryFacts: deletedMemoryFactCount,
      memoryFactEvents: deletedFactEventCount,
      ragEntries: deletedRagEntryCount,
      openaiFiles: deletedOpenAIFileCount,
    },
  };
}
