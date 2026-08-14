import { Prisma } from '@/lib/server/generated-prisma';
import { summarizeSpeechScriptReadinessFromScenes } from '@/lib/audio/speech-readiness-summary';
import type { DbClient, RootDbClient } from '@/lib/server/repositories/types';
import {
  canReadCourseNotebook,
  resolveCourseNotebookAccess,
} from '@/lib/server/repositories/course-enrollment-repository';
import type { Action } from '@/lib/types/action';
import { notebookProblemPublicContentSchema } from '@/lib/problem-bank';
import { courseProblemDedupeKey } from '@/features/problems/domain/problem-dedupe';

export type CreateOwnedNotebookData = Omit<
  Prisma.NotebookUncheckedCreateInput,
  'ownerId' | 'createdAt' | 'updatedAt'
>;

export type UpdateOwnedNotebookData = Omit<
  Prisma.NotebookUncheckedUpdateManyInput,
  'id' | 'ownerId' | 'createdAt' | 'updatedAt'
>;

export type ReplaceNotebookSceneData = Omit<Prisma.SceneCreateManyInput, 'notebookId'>;
export type IncrementalNotebookSceneData = ReplaceNotebookSceneData & { id: string };

export type NotebookSceneGenerationFence = {
  courseId: string | null;
  contentVersion: number;
};

export class NotebookSceneGenerationWriteError extends Error {
  readonly code:
    | 'NOTEBOOK_NOT_FOUND'
    | 'NOTEBOOK_COURSE_MISMATCH'
    | 'NOTEBOOK_CONTENT_VERSION_CONFLICT'
    | 'NOTEBOOK_SCENE_ID_CONFLICT'
    | 'NOTEBOOK_SCENE_COUNT_MISMATCH';
  readonly currentContentVersion?: number;
  readonly actualSceneCount?: number;

  constructor(
    code: NotebookSceneGenerationWriteError['code'],
    options: { currentContentVersion?: number; actualSceneCount?: number } = {},
  ) {
    super(code);
    this.name = 'NotebookSceneGenerationWriteError';
    this.code = code;
    this.currentContentVersion = options.currentContentVersion;
    this.actualSceneCount = options.actualSceneCount;
  }
}

export type ReplaceMarkdownNotebookSectionData = Omit<
  Prisma.MarkdownNotebookSectionCreateManyInput,
  'notebookId' | 'courseId'
>;

export const MARKDOWN_SECTION_LIST_DEFAULT_LIMIT = 20;
export const MARKDOWN_SECTION_LIST_MAX_LIMIT = 50;
export const MARKDOWN_SECTION_TITLE_MAX_CHARS = 200;
export const MARKDOWN_SECTION_SUMMARY_MAX_CHARS = 400;

export type MarkdownSectionPageCursor = {
  order: number;
  id: string;
};

export type MarkdownSectionListItem = {
  id: string;
  title: string;
  order: number;
  summary: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MarkdownSectionDetail = MarkdownSectionListItem & {
  notebookId: string;
  courseId: string | null;
  markdown: string;
};

type ReplaceMarkdownNotebookSectionOptions = {
  preserveScenes?: boolean;
  notebookKind?: 'image' | 'markdown';
};

type NotebookSceneMetadataInput = {
  content: unknown;
  actions?: unknown;
  order: number;
};

type NotebookSceneMetadataSummary = {
  sceneCount: number;
  speechReadyCount: number;
  speechTotalCount: number;
  speechStatus: string;
  coverSlideJson: Prisma.InputJsonValue | null;
  coverImagePath: string | null;
};

export type NotebookCourseMoveDedupeConflict = {
  kind: 'target_course' | 'moving_notebook' | 'concurrent_unique_conflict';
  movingProblemId: string | null;
  existingProblemId: string | null;
  dedupeKey: string | null;
};

export class NotebookCourseMoveDedupeError extends Error {
  readonly code: 'NOTEBOOK_COURSE_MOVE_DEDUPE_CONFLICT' | 'NOTEBOOK_COURSE_MOVE_DEDUPE_UNAVAILABLE';
  readonly notebookId: string;
  readonly sourceCourseId: string | null;
  readonly targetCourseId: string;
  readonly conflicts: NotebookCourseMoveDedupeConflict[];
  readonly invalidProblemIds: string[];

  constructor(args: {
    code: 'NOTEBOOK_COURSE_MOVE_DEDUPE_CONFLICT' | 'NOTEBOOK_COURSE_MOVE_DEDUPE_UNAVAILABLE';
    notebookId: string;
    sourceCourseId: string | null;
    targetCourseId: string;
    conflicts?: NotebookCourseMoveDedupeConflict[];
    invalidProblemIds?: string[];
  }) {
    super(
      args.code === 'NOTEBOOK_COURSE_MOVE_DEDUPE_CONFLICT'
        ? 'Notebook problems conflict with the target course problem bank.'
        : 'Notebook problems could not be validated for a safe course move.',
    );
    this.name = 'NotebookCourseMoveDedupeError';
    this.code = args.code;
    this.notebookId = args.notebookId;
    this.sourceCourseId = args.sourceCourseId;
    this.targetCourseId = args.targetCourseId;
    this.conflicts = args.conflicts || [];
    this.invalidProblemIds = args.invalidProblemIds || [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requestedCourseIdUpdate(
  data: UpdateOwnedNotebookData,
): { specified: false } | { specified: true; courseId: string | null } {
  if (!Object.prototype.hasOwnProperty.call(data, 'courseId')) return { specified: false };
  const value = data.courseId;
  if (typeof value === 'string' || value === null) {
    return { specified: true, courseId: value };
  }
  if (isRecord(value) && (typeof value.set === 'string' || value.set === null)) {
    return { specified: true, courseId: value.set };
  }
  throw new TypeError('Unsupported notebook courseId update');
}

async function lockCourseProblemDedupeScopes(
  tx: Prisma.TransactionClient,
  courseIds: Array<string | null>,
): Promise<void> {
  const sortedCourseIds = Array.from(
    new Set(courseIds.filter((courseId): courseId is string => Boolean(courseId))),
  ).sort();
  for (const courseId of sortedCourseIds) {
    await tx.$queryRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "locked"',
      `course-problem-dedupe:${courseId}`,
    );
  }
}

type NotebookProblemDedupeRow = {
  id: string;
  title: string;
  type: string;
  publicContentJson: Prisma.JsonValue;
};

function dedupeKeysForCourseMove(args: {
  rows: NotebookProblemDedupeRow[];
  notebookId: string;
  sourceCourseId: string | null;
  targetCourseId: string;
}): Map<string, string> {
  const invalidProblemIds: string[] = [];
  const keys = new Map<string, string>();
  for (const row of args.rows) {
    const parsed = notebookProblemPublicContentSchema.safeParse(row.publicContentJson);
    if (!parsed.success || parsed.data.type !== row.type) {
      invalidProblemIds.push(row.id);
      continue;
    }
    keys.set(
      row.id,
      courseProblemDedupeKey({
        title: row.title,
        type: parsed.data.type,
        publicContent: parsed.data,
      }),
    );
  }
  if (invalidProblemIds.length > 0) {
    throw new NotebookCourseMoveDedupeError({
      code: 'NOTEBOOK_COURSE_MOVE_DEDUPE_UNAVAILABLE',
      notebookId: args.notebookId,
      sourceCourseId: args.sourceCourseId,
      targetCourseId: args.targetCourseId,
      invalidProblemIds,
    });
  }
  return keys;
}

async function planNotebookProblemCourseMove(args: {
  tx: Prisma.TransactionClient;
  notebookId: string;
  sourceCourseId: string | null;
  targetCourseId: string;
}): Promise<Map<string, string>> {
  const movingRows = await args.tx.notebookProblem.findMany({
    where: { notebookId: args.notebookId },
    select: {
      id: true,
      title: true,
      type: true,
      publicContentJson: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const targetRows = await args.tx.notebookProblem.findMany({
    where: {
      ...(movingRows.length > 0 ? { id: { notIn: movingRows.map((row) => row.id) } } : {}),
      OR: [
        { courseId: args.targetCourseId },
        {
          courseId: null,
          notebook: { courseId: args.targetCourseId },
        },
      ],
    },
    select: {
      id: true,
      title: true,
      type: true,
      publicContentJson: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const movingKeys = dedupeKeysForCourseMove({
    rows: movingRows,
    notebookId: args.notebookId,
    sourceCourseId: args.sourceCourseId,
    targetCourseId: args.targetCourseId,
  });
  const targetKeys = dedupeKeysForCourseMove({
    rows: targetRows,
    notebookId: args.notebookId,
    sourceCourseId: args.sourceCourseId,
    targetCourseId: args.targetCourseId,
  });

  const targetProblemByKey = new Map<string, string>();
  for (const [problemId, dedupeKey] of targetKeys) {
    if (!targetProblemByKey.has(dedupeKey)) targetProblemByKey.set(dedupeKey, problemId);
  }
  const movingProblemByKey = new Map<string, string>();
  const conflicts: NotebookCourseMoveDedupeConflict[] = [];
  for (const [movingProblemId, dedupeKey] of movingKeys) {
    const targetProblemId = targetProblemByKey.get(dedupeKey);
    if (targetProblemId) {
      conflicts.push({
        kind: 'target_course',
        movingProblemId,
        existingProblemId: targetProblemId,
        dedupeKey,
      });
    }
    const earlierMovingProblemId = movingProblemByKey.get(dedupeKey);
    if (earlierMovingProblemId) {
      conflicts.push({
        kind: 'moving_notebook',
        movingProblemId,
        existingProblemId: earlierMovingProblemId,
        dedupeKey,
      });
    } else {
      movingProblemByKey.set(dedupeKey, movingProblemId);
    }
  }
  if (conflicts.length > 0) {
    throw new NotebookCourseMoveDedupeError({
      code: 'NOTEBOOK_COURSE_MOVE_DEDUPE_CONFLICT',
      notebookId: args.notebookId,
      sourceCourseId: args.sourceCourseId,
      targetCourseId: args.targetCourseId,
      conflicts,
    });
  }
  return movingKeys;
}

function isPreviewableImageSrc(src: unknown): src is string {
  const value = typeof src === 'string' ? src.trim() : '';
  return value.startsWith('/') || value.startsWith('http://') || value.startsWith('https://');
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function imageArea(image: Record<string, unknown>): number {
  return toFiniteNumber(image.width, 0) * toFiniteNumber(image.height, 0);
}

function findCoverSlideJson(
  scenes: NotebookSceneMetadataInput[],
): Pick<NotebookSceneMetadataSummary, 'coverSlideJson' | 'coverImagePath'> {
  const orderedScenes = [...scenes].sort((a, b) => Number(a.order) - Number(b.order));

  for (const scene of orderedScenes) {
    const content = scene.content as unknown;
    if (!isRecord(content) || content.type !== 'slide') continue;
    if (!isRecord(content.canvas)) continue;

    const canvas = content.canvas;
    const elements = Array.isArray(canvas.elements) ? canvas.elements : [];
    const image = elements
      .filter(isRecord)
      .filter((element) => element.type === 'image' && isPreviewableImageSrc(element.src))
      .sort((a, b) => imageArea(b) - imageArea(a))[0];
    if (!image) continue;

    return {
      coverSlideJson: {
        id: typeof canvas.id === 'string' ? canvas.id : 'cover-preview',
        type: 'content',
        theme: {
          fontName: 'Inter',
          fontColor: '#0f172a',
          themeColors: ['#0f766e', '#334155', '#a16207', '#0f172a'],
          backgroundColor: '#ffffff',
        },
        background: { type: 'solid', color: '#ffffff' },
        viewportSize: toFiniteNumber(canvas.viewportSize, 1000),
        viewportRatio: toFiniteNumber(canvas.viewportRatio, 1.777777777777778),
        elements: [image],
      } as Prisma.InputJsonValue,
      coverImagePath: typeof image.src === 'string' ? image.src : null,
    };
  }

  return { coverSlideJson: null, coverImagePath: null };
}

export function summarizeNotebookScenesForMetadata(
  scenes: NotebookSceneMetadataInput[],
): NotebookSceneMetadataSummary {
  const speech = summarizeSpeechScriptReadinessFromScenes(
    scenes.map((scene) => ({
      actions: (Array.isArray(scene.actions) ? scene.actions : undefined) as Action[] | undefined,
    })),
  );
  const cover = findCoverSlideJson(scenes);
  return {
    sceneCount: scenes.length,
    speechReadyCount: speech.ready,
    speechTotalCount: speech.total,
    speechStatus: speech.status,
    ...cover,
  };
}

export async function refreshCourseSummaryFields(db: DbClient, courseId: string) {
  const notebookAggregate = await db.notebook.aggregate({
    where: { courseId },
    _sum: {
      sceneCount: true,
      speechReadyCount: true,
      speechTotalCount: true,
    },
  });
  // Keep summary refreshes connection-light. Managed Postgres proxies can
  // retire every idle pool connection while a long AI generation is running;
  // acquiring both counters concurrently then exhausts the pool before Prisma
  // has a chance to replace the stale connections.
  const problemCount = await db.notebookProblem.count({
    where: { OR: [{ courseId }, { notebook: { courseId } }] },
  });
  const publishedProblemCount = await db.notebookProblem.count({
    where: {
      status: 'published',
      OR: [{ courseId }, { notebook: { courseId } }],
    },
  });

  await db.course.updateMany({
    where: { id: courseId },
    data: {
      // Course.notebookCount has one authoritative runtime writer: the
      // Notebook_sync_course_notebook_count database trigger. Re-applying an
      // earlier aggregate here can overwrite a concurrent trigger increment.
      sceneCount: notebookAggregate._sum.sceneCount ?? 0,
      problemCount,
      publishedProblemCount,
      speechReadyCount: notebookAggregate._sum.speechReadyCount ?? 0,
      speechTotalCount: notebookAggregate._sum.speechTotalCount ?? 0,
    },
  });
}

const notebookListSelect = {
  id: true,
  ownerId: true,
  courseId: true,
  name: true,
  description: true,
  tags: true,
  avatarUrl: true,
  language: true,
  style: true,
  notebookKind: true,
  listedInNotebookStore: true,
  notebookPriceCents: true,
  storePublishedAt: true,
  sourceNotebookId: true,
  sceneCount: true,
  sectionCount: true,
  problemCount: true,
  publishedProblemCount: true,
  speechReadyCount: true,
  speechTotalCount: true,
  speechStatus: true,
  coverImagePath: true,
  contentVersion: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.NotebookSelect;

const notebookLibraryListSelect = {
  id: true,
  courseId: true,
  name: true,
  tags: true,
  notebookKind: true,
  sceneCount: true,
  sectionCount: true,
  coverImagePath: true,
  mindMapMime: true,
  contentVersion: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.NotebookSelect;

export function listOwnedNotebooks(db: DbClient, userId: string, courseId?: string) {
  return db.notebook.findMany({
    where: {
      ownerId: userId,
      removedAt: null,
      ...(courseId ? { courseId } : {}),
    },
    select: notebookListSelect,
    orderBy: { updatedAt: 'desc' },
  });
}

function listOwnedNotebookLibraryItems(db: DbClient, userId: string, courseId?: string) {
  return db.notebook.findMany({
    where: {
      ownerId: userId,
      removedAt: null,
      ...(courseId ? { courseId } : {}),
    },
    select: notebookLibraryListSelect,
    orderBy: { updatedAt: 'desc' },
  });
}

export async function listReadableNotebooks(db: DbClient, userId: string, courseId?: string) {
  if (!courseId) return listOwnedNotebooks(db, userId);

  // The normal /learn path reads the current user's own course. Resolve that
  // common case in one round trip; only fall back to enrollment checks when no
  // owned notebook exists for the course.
  const ownedNotebooks = await listOwnedNotebooks(db, userId, courseId);
  if (ownedNotebooks.length > 0) return ownedNotebooks;

  const access = await resolveCourseNotebookAccess(db, userId, courseId);
  if (!access || access.role === 'owner') return [];
  const notebooks = await db.notebook.findMany({
    where: { courseId, removedAt: null },
    select: notebookListSelect,
    orderBy: { createdAt: 'asc' },
  });
  const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
  return access.allowedNotebookIds.flatMap((id) => {
    const notebook = byId.get(id);
    return notebook ? [notebook] : [];
  });
}

/**
 * Course notebook popup projection. Covers and notebook bodies are fetched only
 * after a user selects one item; the list response remains metadata-only.
 */
export async function listReadableNotebookLibraryItems(
  db: DbClient,
  userId: string,
  courseId: string,
) {
  const ownedNotebooks = await listOwnedNotebookLibraryItems(db, userId, courseId);
  if (ownedNotebooks.length > 0) return ownedNotebooks;

  const access = await resolveCourseNotebookAccess(db, userId, courseId);
  if (!access || access.role === 'owner') return [];
  const notebooks = await db.notebook.findMany({
    where: { courseId, removedAt: null },
    select: notebookLibraryListSelect,
    orderBy: { createdAt: 'asc' },
  });
  const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
  return access.allowedNotebookIds.flatMap((id) => {
    const notebook = byId.get(id);
    return notebook ? [notebook] : [];
  });
}

export function listOwnedNotebooksWithSpeechActions(
  db: DbClient,
  userId: string,
  courseId?: string,
) {
  return db.notebook.findMany({
    where: {
      ownerId: userId,
      ...(courseId ? { courseId } : {}),
    },
    include: {
      _count: {
        select: { scenes: true },
      },
      scenes: {
        select: { actions: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function listReadableNotebooksWithSpeechActions(
  db: DbClient,
  userId: string,
  courseId?: string,
) {
  if (!courseId) return listOwnedNotebooksWithSpeechActions(db, userId);
  const access = await resolveCourseNotebookAccess(db, userId, courseId);
  if (!access) return [];
  const notebooks = await db.notebook.findMany({
    where: { courseId },
    include: {
      _count: {
        select: { scenes: true },
      },
      scenes: {
        select: { actions: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (access.role === 'owner') return notebooks;
  const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
  return access.allowedNotebookIds.flatMap((id) => {
    const notebook = byId.get(id);
    return notebook ? [notebook] : [];
  });
}

export function findNotebookOwner(db: DbClient, notebookId: string) {
  return db.notebook.findFirst({
    where: { id: notebookId },
    select: { id: true, ownerId: true, courseId: true, name: true },
  });
}

export function findOwnedNotebookWithScenes(db: DbClient, userId: string, notebookId: string) {
  return db.notebook.findFirst({
    where: { id: notebookId, ownerId: userId },
    include: {
      scenes: {
        orderBy: { order: 'asc' },
      },
    },
  });
}

export async function findReadableNotebook(db: DbClient, userId: string, notebookId: string) {
  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
  });
  if (!notebook) return null;
  if (notebook.ownerId === userId) return notebook;
  if (!notebook.courseId) return null;
  return (await canReadCourseNotebook(db, userId, notebook.courseId, notebook.id))
    ? notebook
    : null;
}

export async function findReadableNotebookWithMarkdownSections(
  db: DbClient,
  userId: string,
  notebookId: string,
) {
  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    include: {
      markdownSections: {
        orderBy: { order: 'asc' },
      },
    },
  });
  if (!notebook) return null;
  if (notebook.ownerId === userId) return notebook;
  if (!notebook.courseId) return null;
  return (await canReadCourseNotebook(db, userId, notebook.courseId, notebook.id))
    ? notebook
    : null;
}

export async function findReadableNotebookWithScenes(
  db: DbClient,
  userId: string,
  notebookId: string,
) {
  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    include: {
      course: { select: { id: true } },
      scenes: {
        orderBy: { order: 'asc' },
      },
      markdownSections: {
        orderBy: { order: 'asc' },
      },
    },
  });
  if (!notebook) return null;
  if (notebook.ownerId === userId) return notebook;
  if (!notebook.courseId) return null;
  return (await canReadCourseNotebook(db, userId, notebook.courseId, notebook.id))
    ? notebook
    : null;
}

export function findOwnedNotebookForStoreUpdate(db: DbClient, userId: string, notebookId: string) {
  return db.notebook.findFirst({
    where: { id: notebookId, ownerId: userId },
    select: { id: true, sourceNotebookId: true, courseId: true, name: true },
  });
}

export function findOwnedNotebookId(db: DbClient, userId: string, notebookId: string) {
  return db.notebook.findFirst({
    where: { id: notebookId, ownerId: userId },
    select: { id: true, courseId: true },
  });
}

export async function findReadableNotebookId(db: DbClient, userId: string, notebookId: string) {
  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    select: { id: true, ownerId: true, courseId: true },
  });
  if (!notebook) return null;
  if (notebook.ownerId === userId) return { id: notebook.id };
  if (!notebook.courseId) return null;
  return (await canReadCourseNotebook(db, userId, notebook.courseId, notebook.id))
    ? { id: notebook.id }
    : null;
}

export async function createOwnedNotebook(
  db: DbClient,
  userId: string,
  data: CreateOwnedNotebookData,
) {
  const notebook = await db.notebook.create({
    data: {
      ownerId: userId,
      ...data,
    },
  });
  if (notebook.courseId) {
    await refreshCourseSummaryFields(db, notebook.courseId);
  }
  return notebook;
}

export async function updateOwnedNotebook(
  db: RootDbClient,
  userId: string,
  notebookId: string,
  data: UpdateOwnedNotebookData,
) {
  const courseUpdate = requestedCourseIdUpdate(data);
  let lockedSourceCourseId: string | null = null;
  try {
    return await db.$transaction(
      async (tx) => {
        // Serialize moves of the same notebook before resolving the old course.
        // Course-level advisory locks below then serialize different notebooks
        // moving into or out of the same problem-bank scope.
        await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "Notebook"
        WHERE "id" = ${notebookId} AND "ownerId" = ${userId}
        FOR UPDATE
      `);
        const current = await tx.notebook.findFirst({
          where: { id: notebookId, ownerId: userId },
          select: { courseId: true, name: true },
        });
        if (!current) return null;
        lockedSourceCourseId = current.courseId;

        const targetCourseId = courseUpdate.specified ? courseUpdate.courseId : current.courseId;
        const courseChanged = current.courseId !== targetCourseId;
        let movingProblemKeys = new Map<string, string>();
        if (courseChanged) {
          await lockCourseProblemDedupeScopes(tx, [current.courseId, targetCourseId]);
          if (targetCourseId) {
            movingProblemKeys = await planNotebookProblemCourseMove({
              tx,
              notebookId,
              sourceCourseId: current.courseId,
              targetCourseId,
            });
          }

          // The uniqueness key belongs to a course scope. Clear it before any
          // courseId changes so neither the old nor target scope sees a stale key.
          // A move out of a course intentionally stops here and leaves every key null.
          await tx.notebookProblem.updateMany({
            where: { notebookId },
            data: { dedupeKey: null },
          });
        }

        const result = await tx.notebook.updateMany({
          where: { id: notebookId, ownerId: userId },
          data,
        });
        if (result.count === 0) return null;
        const updated = await tx.notebook.findFirst({
          where: { id: notebookId, ownerId: userId },
        });
        if (!updated) return null;

        const nameChanged = current.name !== updated.name;
        if (courseChanged) {
          // Child courseId is authoritative in course-scoped reads. Move it in the
          // same transaction as the notebook so old/new courses cannot disagree.
          await Promise.all([
            tx.markdownNotebookSection.updateMany({
              where: { notebookId },
              data: { courseId: updated.courseId },
            }),
            tx.notebookProblem.updateMany({
              where: { notebookId },
              data: { courseId: updated.courseId },
            }),
            tx.notebookPage.updateMany({
              where: { notebookId },
              data: { courseId: updated.courseId },
            }),
            tx.problemImportBatch.updateMany({
              where: { notebookId },
              data: { courseId: updated.courseId },
            }),
          ]);

          // Reclaim the freshly computed target-course keys only after every
          // problem has entered the target scope. Any failure rolls back the
          // key clear, notebook move, child move, and key writes together.
          if (updated.courseId) {
            const keyAssignments = Array.from(movingProblemKeys);
            for (let offset = 0; offset < keyAssignments.length; offset += 200) {
              const batch = keyAssignments.slice(offset, offset + 200);
              await tx.$executeRaw(Prisma.sql`
              UPDATE "NotebookProblem" AS problem
              SET "dedupeKey" = assignment."dedupeKey"
              FROM (
                VALUES ${Prisma.join(
                  batch.map(([problemId, dedupeKey]) => Prisma.sql`(${problemId}, ${dedupeKey})`),
                )}
              ) AS assignment("id", "dedupeKey")
              WHERE problem."id" = assignment."id"
                AND problem."notebookId" = ${notebookId}
                AND problem."courseId" = ${updated.courseId}
            `);
            }
          }
        } else if (nameChanged) {
          // Notebook name is part of the search projection. Listing courseId in
          // SET (without changing its value) activates the existing staleness
          // triggers for both linked and unlinked child entities atomically.
          await Promise.all([
            tx.$executeRaw(Prisma.sql`
            UPDATE "MarkdownNotebookSection"
            SET "courseId" = "courseId"
            WHERE "notebookId" = ${notebookId}
          `),
            tx.$executeRaw(Prisma.sql`
            UPDATE "NotebookProblem"
            SET "courseId" = "courseId"
            WHERE "notebookId" = ${notebookId}
          `),
          ]);
        }

        const courseIds = Array.from(
          new Set(
            [current.courseId, updated.courseId].filter((value): value is string => Boolean(value)),
          ),
        );
        for (const courseId of courseIds) {
          await refreshCourseSummaryFields(tx, courseId);
        }
        return updated;
      },
      {
        maxWait: 15_000,
        timeout: 60_000,
      },
    );
  } catch (error) {
    if (error instanceof NotebookCourseMoveDedupeError) throw error;
    if (
      isRecord(error) &&
      error.code === 'P2002' &&
      courseUpdate.specified &&
      courseUpdate.courseId
    ) {
      throw new NotebookCourseMoveDedupeError({
        code: 'NOTEBOOK_COURSE_MOVE_DEDUPE_CONFLICT',
        notebookId,
        sourceCourseId: lockedSourceCourseId,
        targetCourseId: courseUpdate.courseId,
        conflicts: [
          {
            kind: 'concurrent_unique_conflict',
            movingProblemId: null,
            existingProblemId: null,
            dedupeKey: null,
          },
        ],
      });
    }
    throw error;
  }
}

export async function deleteOwnedNotebook(db: RootDbClient, userId: string, notebookId: string) {
  const notebook = await db.notebook.findFirst({
    where: { id: notebookId, ownerId: userId },
    select: { id: true, courseId: true },
  });
  if (!notebook) return null;

  await db.$transaction(
    async (tx) => {
      await tx.conversation.deleteMany({
        where: {
          ownerId: userId,
          OR: [{ notebookId }, { kind: 'notebook', targetId: notebookId }],
        },
      });
      await tx.notebook.deleteMany({ where: { id: notebookId, ownerId: userId } });
    },
    {
      maxWait: 20_000,
      timeout: 60_000,
    },
  );
  if (notebook.courseId) {
    try {
      await refreshCourseSummaryFields(db, notebook.courseId);
    } catch (error) {
      console.warn('[notebook-delete] course summary refresh failed after deletion', {
        courseId: notebook.courseId,
        notebookId,
        error,
      });
    }
  }
  return { id: notebook.id };
}

export function listNotebookScenes(db: DbClient, notebookId: string) {
  return db.scene.findMany({
    where: { notebookId },
    orderBy: { order: 'asc' },
  });
}

export async function findOwnedNotebookSceneGenerationFence(
  db: DbClient,
  userId: string,
  notebookId: string,
): Promise<NotebookSceneGenerationFence | null> {
  return db.notebook.findFirst({
    where: { id: notebookId, ownerId: userId },
    select: { courseId: true, contentVersion: true },
  });
}

export function listMarkdownNotebookSections(db: DbClient, notebookId: string) {
  return db.markdownNotebookSection.findMany({
    where: { notebookId },
    orderBy: { order: 'asc' },
  });
}

export function encodeMarkdownSectionPageCursor(cursor: MarkdownSectionPageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeMarkdownSectionPageCursor(raw: string): MarkdownSectionPageCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      order?: unknown;
      id?: unknown;
    };
    if (
      !Number.isInteger(parsed.order) ||
      Number(parsed.order) < 0 ||
      typeof parsed.id !== 'string' ||
      !parsed.id.trim()
    ) {
      return null;
    }
    return { order: Number(parsed.order), id: parsed.id };
  } catch {
    return null;
  }
}

export async function listReadableMarkdownSectionPage(args: {
  db: DbClient;
  userId: string;
  notebookId: string;
  cursor?: MarkdownSectionPageCursor | null;
  limit?: number;
}): Promise<{
  sections: MarkdownSectionListItem[];
  hasMore: boolean;
  nextCursor: string | null;
} | null> {
  const readable = await findReadableNotebookId(args.db, args.userId, args.notebookId);
  if (!readable) return null;
  const requestedLimit = Number.isFinite(args.limit) ? Math.trunc(args.limit ?? 0) : 0;
  const limit = Math.max(
    1,
    Math.min(
      requestedLimit || MARKDOWN_SECTION_LIST_DEFAULT_LIMIT,
      MARKDOWN_SECTION_LIST_MAX_LIMIT,
    ),
  );
  const cursorFilter = args.cursor
    ? Prisma.sql`
        AND (
          section."order" > ${args.cursor.order}
          OR (
            section."order" = ${args.cursor.order}
            AND section."id" > ${args.cursor.id}
          )
        )
      `
    : Prisma.empty;
  const rows = await args.db.$queryRaw<MarkdownSectionListItem[]>(Prisma.sql`
    SELECT
      section."id",
      LEFT(section."title", ${MARKDOWN_SECTION_TITLE_MAX_CHARS}::integer) AS "title",
      section."order",
      LEFT(section."summary", ${MARKDOWN_SECTION_SUMMARY_MAX_CHARS}::integer) AS "summary",
      section."createdAt",
      section."updatedAt"
    FROM "MarkdownNotebookSection" AS section
    WHERE section."notebookId" = ${args.notebookId}
    ${cursorFilter}
    ORDER BY section."order" ASC, section."id" ASC
    LIMIT ${limit + 1}
  `);
  const hasMore = rows.length > limit;
  const sections = hasMore ? rows.slice(0, limit) : rows;
  const last = sections.at(-1);
  return {
    sections,
    hasMore,
    nextCursor:
      hasMore && last ? encodeMarkdownSectionPageCursor({ order: last.order, id: last.id }) : null,
  };
}

export async function findReadableMarkdownSectionDetail(args: {
  db: DbClient;
  userId: string;
  notebookId: string;
  sectionId: string;
}): Promise<MarkdownSectionDetail | null> {
  const readable = await findReadableNotebookId(args.db, args.userId, args.notebookId);
  if (!readable) return null;
  const rows = await args.db.$queryRaw<MarkdownSectionDetail[]>(Prisma.sql`
    SELECT
      section."id",
      section."notebookId",
      section."courseId",
      LEFT(section."title", ${MARKDOWN_SECTION_TITLE_MAX_CHARS}::integer) AS "title",
      section."order",
      LEFT(section."summary", ${MARKDOWN_SECTION_SUMMARY_MAX_CHARS}::integer) AS "summary",
      section."markdown",
      section."createdAt",
      section."updatedAt"
    FROM "MarkdownNotebookSection" AS section
    WHERE section."notebookId" = ${args.notebookId}
      AND section."id" = ${args.sectionId}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function replaceOwnedNotebookScenes(
  db: RootDbClient,
  userId: string,
  notebookId: string,
  scenes: ReplaceNotebookSceneData[],
) {
  const notebook = await findOwnedNotebookId(db, userId, notebookId);
  if (!notebook) return null;

  const summary = summarizeNotebookScenesForMetadata(scenes);

  await db.$transaction(async (tx) => {
    await tx.scene.deleteMany({ where: { notebookId } });
    await tx.scene.createMany({
      data: scenes.map((scene) => ({
        ...scene,
        notebookId,
      })),
    });
    await tx.notebook.update({
      where: { id: notebookId },
      data: {
        notebookKind: 'image',
        sceneCount: summary.sceneCount,
        speechReadyCount: summary.speechReadyCount,
        speechTotalCount: summary.speechTotalCount,
        speechStatus: summary.speechStatus,
        coverSlideJson: summary.coverSlideJson ?? Prisma.DbNull,
        coverImagePath: summary.coverImagePath,
        contentVersion: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (notebook.courseId) {
      await refreshCourseSummaryFields(tx, notebook.courseId);
    }
  });

  return listNotebookScenes(db, notebookId);
}

function assertNotebookGenerationCourse(
  actualCourseId: string | null,
  expectedCourseId: string | null,
) {
  if (actualCourseId !== expectedCourseId) {
    throw new NotebookSceneGenerationWriteError('NOTEBOOK_COURSE_MISMATCH');
  }
}

/**
 * Starts one fenced generation session. This is the only incremental-generation
 * operation that clears the notebook. Page writes keep this returned version
 * stable so retries can safely upsert the same deterministic scene ids.
 */
export async function beginOwnedNotebookSceneGeneration(
  db: RootDbClient,
  userId: string,
  notebookId: string,
  expectedCourseId: string | null,
  expectedContentVersion: number,
): Promise<NotebookSceneGenerationFence> {
  return db.$transaction(async (tx) => {
    const notebook = await tx.notebook.findFirst({
      where: { id: notebookId, ownerId: userId },
      select: { courseId: true, contentVersion: true },
    });
    if (!notebook) {
      throw new NotebookSceneGenerationWriteError('NOTEBOOK_NOT_FOUND');
    }
    assertNotebookGenerationCourse(notebook.courseId, expectedCourseId);
    if (notebook.contentVersion !== expectedContentVersion) {
      throw new NotebookSceneGenerationWriteError('NOTEBOOK_CONTENT_VERSION_CONFLICT', {
        currentContentVersion: notebook.contentVersion,
      });
    }

    await tx.scene.deleteMany({ where: { notebookId } });
    const updated = await tx.notebook.updateMany({
      where: {
        id: notebookId,
        ownerId: userId,
        courseId: expectedCourseId,
        contentVersion: expectedContentVersion,
      },
      data: {
        notebookKind: 'image',
        sceneCount: 0,
        speechReadyCount: 0,
        speechTotalCount: 0,
        speechStatus: 'no_speech',
        coverSlideJson: Prisma.DbNull,
        coverImagePath: null,
        contentVersion: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new NotebookSceneGenerationWriteError('NOTEBOOK_CONTENT_VERSION_CONFLICT');
    }
    return {
      courseId: notebook.courseId,
      contentVersion: expectedContentVersion + 1,
    };
  });
}

/**
 * Idempotently writes a small generated-page batch. The notebook version does
 * not change until finalization; a competing begin/replace invalidates the
 * fence before any scene mutation can commit.
 */
export async function upsertOwnedNotebookGenerationScenes(
  db: RootDbClient,
  userId: string,
  notebookId: string,
  expectedCourseId: string | null,
  expectedContentVersion: number,
  scenes: IncrementalNotebookSceneData[],
): Promise<NotebookSceneGenerationFence> {
  return db.$transaction(async (tx) => {
    const locked = await tx.notebook.updateMany({
      where: {
        id: notebookId,
        ownerId: userId,
        courseId: expectedCourseId,
        contentVersion: expectedContentVersion,
      },
      data: { updatedAt: new Date() },
    });
    if (locked.count !== 1) {
      throw new NotebookSceneGenerationWriteError('NOTEBOOK_CONTENT_VERSION_CONFLICT');
    }

    const sceneIds = scenes.map((scene) => scene.id).filter((id): id is string => Boolean(id));
    const existingScenes = await tx.scene.findMany({
      where: { id: { in: sceneIds } },
      select: { id: true, notebookId: true },
    });
    if (existingScenes.some((scene) => scene.notebookId !== notebookId)) {
      throw new NotebookSceneGenerationWriteError('NOTEBOOK_SCENE_ID_CONFLICT');
    }

    await Promise.all(
      scenes.map((scene) =>
        tx.scene.upsert({
          where: { id: scene.id },
          create: { ...scene, notebookId },
          update: {
            title: scene.title,
            type: scene.type,
            order: scene.order,
            content: scene.content,
            actions: scene.actions,
            whiteboard: scene.whiteboard,
          },
        }),
      ),
    );
    return { courseId: expectedCourseId, contentVersion: expectedContentVersion };
  });
}

/**
 * Performs the one O(N) metadata reconciliation after all O(1)-sized page
 * writes. Any later content mutation invalidates the session fence.
 */
export async function finalizeOwnedNotebookSceneGeneration(
  db: RootDbClient,
  userId: string,
  notebookId: string,
  expectedCourseId: string | null,
  expectedContentVersion: number,
  expectedSceneCount: number,
): Promise<NotebookSceneGenerationFence> {
  return db.$transaction(async (tx) => {
    const notebook = await tx.notebook.findFirst({
      where: { id: notebookId, ownerId: userId },
      select: {
        courseId: true,
        contentVersion: true,
        sceneCount: true,
      },
    });
    if (!notebook) {
      throw new NotebookSceneGenerationWriteError('NOTEBOOK_NOT_FOUND');
    }
    assertNotebookGenerationCourse(notebook.courseId, expectedCourseId);
    if (notebook.contentVersion !== expectedContentVersion) {
      throw new NotebookSceneGenerationWriteError('NOTEBOOK_CONTENT_VERSION_CONFLICT', {
        currentContentVersion: notebook.contentVersion,
      });
    }

    const scenes = await tx.scene.findMany({
      where: { notebookId },
      select: { content: true, actions: true, order: true },
      orderBy: { order: 'asc' },
    });
    if (scenes.length !== expectedSceneCount) {
      throw new NotebookSceneGenerationWriteError('NOTEBOOK_SCENE_COUNT_MISMATCH', {
        actualSceneCount: scenes.length,
      });
    }
    const summary = summarizeNotebookScenesForMetadata(scenes);
    const updated = await tx.notebook.updateMany({
      where: {
        id: notebookId,
        ownerId: userId,
        courseId: expectedCourseId,
        contentVersion: expectedContentVersion,
      },
      data: {
        notebookKind: 'image',
        sceneCount: summary.sceneCount,
        speechReadyCount: summary.speechReadyCount,
        speechTotalCount: summary.speechTotalCount,
        speechStatus: summary.speechStatus,
        coverSlideJson: summary.coverSlideJson ?? Prisma.DbNull,
        coverImagePath: summary.coverImagePath,
        contentVersion: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new NotebookSceneGenerationWriteError('NOTEBOOK_CONTENT_VERSION_CONFLICT');
    }
    if (notebook.courseId) {
      await refreshCourseSummaryFields(tx, notebook.courseId);
    }
    return {
      courseId: notebook.courseId,
      contentVersion: expectedContentVersion + 1,
    };
  });
}

export async function replaceOwnedMarkdownNotebookSections(
  db: RootDbClient,
  userId: string,
  notebookId: string,
  sections: ReplaceMarkdownNotebookSectionData[],
  options: ReplaceMarkdownNotebookSectionOptions = {},
) {
  const notebook = await findOwnedNotebookId(db, userId, notebookId);
  if (!notebook) return null;

  await db.$transaction(async (tx) => {
    if (!options.preserveScenes) {
      await tx.scene.deleteMany({ where: { notebookId } });
    }
    await tx.markdownNotebookSection.deleteMany({ where: { notebookId } });
    if (sections.length > 0) {
      await tx.markdownNotebookSection.createMany({
        data: sections.map((section) => ({
          ...section,
          notebookId,
          courseId: notebook.courseId,
        })),
      });
    }
    await tx.notebook.update({
      where: { id: notebookId },
      data: {
        notebookKind: options.notebookKind ?? 'markdown',
        ...(options.preserveScenes ? {} : { sceneCount: sections.length }),
        sectionCount: sections.length,
        ...(options.preserveScenes
          ? {}
          : {
              speechReadyCount: 0,
              speechTotalCount: 0,
              speechStatus: 'no_speech',
              coverSlideJson: Prisma.DbNull,
              coverImagePath: null,
            }),
        contentVersion: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (notebook.courseId) {
      await refreshCourseSummaryFields(tx, notebook.courseId);
    }
  });

  return listMarkdownNotebookSections(db, notebookId);
}
