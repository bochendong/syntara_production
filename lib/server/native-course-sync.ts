import { createHash } from 'node:crypto';

import {
  createEmptyLearnerCourseState,
  isLearnerCourseState,
  previewLearnerProgressCheckpoint,
  type LearnerCourseState,
  type LearnerProgressCheckpointKind,
} from '@/lib/learning/course-learner-state';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import { upsertMemoryFact } from '@/lib/server/memory-fact-store';

import { listReadableNotebookLibraryItems } from '@/lib/server/repositories/notebook-repository';
import { canReadCourseNotebook } from '@/lib/server/repositories/course-enrollment-repository';
import {
  listStudyMemoriesForViewer,
  resolveReadableStudyMemoryTarget,
} from '@/lib/server/study-memory-store';

/**
 * App 端课程数据同步：字段与 apps/native 的本地模型（SyntaraArchiveV1）一致，
 * 和 scripts/maintenance/export-native-archive.mjs 的导出规则保持同一套。
 */

const CALENDAR_PAST_DAYS = 120;
const CALENDAR_FUTURE_DAYS = 240;
const CALENDAR_EVENT_LIMIT = 400;
const MINI_LECTURE_LIMIT = 60;
/** 网页上的学习记忆整门课同步到 App；超过这个数时 App 不再按「网页已删除」归档本机记忆。 */
export const NATIVE_WEB_MEMORY_LIMIT = 600;
/** 和网页 lib/utils/learner-course-api.ts 存学习进度用的是同一条记录。 */
const LEARNER_STATE_NAMESPACE = 'openmaic.learn.state';

function learnerStateKey(courseId: string): string {
  return `course:${courseId}:state`;
}

function timestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function localAssetPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return null;
  try {
    const pathname = /^https?:\/\//i.test(trimmed) ? new URL(trimmed).pathname : trimmed;
    if (
      pathname.startsWith('/generated-notebooks/') ||
      pathname.startsWith('/api/uploads/images/') ||
      pathname.startsWith('/uploads/')
    ) {
      return pathname.split(/[?#]/, 1)[0];
    }
  } catch {
    return null;
  }
  return null;
}

function collectAssetPaths(value: unknown, output: Set<string>) {
  if (typeof value === 'string') {
    const direct = localAssetPath(value);
    if (direct) output.add(direct);
    for (const match of value.matchAll(
      /(?:https?:\/\/[^\s"'<>)]*)?(\/(?:generated-notebooks|api\/uploads\/images|uploads)\/[^\s"'<>)]*)/g,
    )) {
      const normalized = localAssetPath(match[0] || match[1]);
      if (normalized) output.add(normalized);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAssetPaths(item, output);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectAssetPaths(item, output);
  }
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function calendarStatus(status: string | null): 'active' | 'completed' | 'cancelled' {
  if (status === 'done') return 'completed';
  if (status === 'skipped') return 'cancelled';
  return 'active';
}

const CALENDAR_KINDS = new Set(['assignment', 'exam', 'progress', 'tutorial', 'holiday', 'other']);

/** 课程的笔记列表、学习记忆、日历和课堂清单；笔记正文按需再取。 */
export async function buildNativeCourseData(
  prisma: PrismaClient,
  userId: string,
  courseId: string,
) {
  const memoryTarget = await resolveReadableStudyMemoryTarget(prisma, userId, 'course', courseId);
  if (!memoryTarget) return null;

  const now = Date.now();
  const rangeStart = new Date(now - CALENDAR_PAST_DAYS * 86_400_000);
  const rangeEnd = new Date(now + CALENDAR_FUTURE_DAYS * 86_400_000);

  const [notebooks, memories, events, lectureJobs, learnerState] = await Promise.all([
    listReadableNotebookLibraryItems(prisma, userId, courseId),
    listStudyMemoriesForViewer(
      prisma,
      userId,
      memoryTarget,
      NATIVE_WEB_MEMORY_LIMIT,
      NATIVE_WEB_MEMORY_LIMIT,
    ),
    prisma.learningCalendarEvent.findMany({
      where: {
        ownerId: userId,
        courseId,
        deletedAt: null,
        eventDate: {
          gte: new Date(`${dateKey(rangeStart)}T00:00:00.000Z`),
          lte: new Date(`${dateKey(rangeEnd)}T00:00:00.000Z`),
        },
      },
      orderBy: [{ eventDate: 'asc' }, { id: 'asc' }],
      take: CALENDAR_EVENT_LIMIT,
    }),
    prisma.backgroundJob.findMany({
      where: { ownerId: userId, courseId, kind: 'mini-lecture', status: 'completed' },
      select: { id: true, payload: true, createdAt: true, completedAt: true },
      orderBy: { createdAt: 'desc' },
      take: MINI_LECTURE_LIMIT,
    }),
    loadLearnerState(prisma, userId, courseId),
  ]);

  return {
    courseId,
    notebooks: notebooks.map((notebook) => ({
      id: notebook.id,
      courseId,
      name: notebook.name,
      description: '',
      kind: notebook.notebookKind === 'markdown' ? 'markdown' : 'image',
      tags: notebook.tags,
      sectionCount:
        notebook.notebookKind === 'markdown' ? notebook.sectionCount : notebook.sceneCount,
      contentVersion: notebook.contentVersion,
      createdAt: timestamp(notebook.createdAt),
      updatedAt: timestamp(notebook.updatedAt),
    })),
    memories: memories
      .filter((memory) => memory.status === 'active')
      .map((memory) => ({
        id: memory.id,
        courseId: memory.courseId,
        notebookId: memory.notebookId,
        targetType: memory.targetType,
        scope: memory.scope,
        kind: memory.kind,
        status: memory.status,
        source: memory.source,
        title: memory.title,
        text: memory.text,
        reason: memory.reason,
        question: memory.question,
        sourceReferences: jsonArray(memory.sourceReferences),
        confidence: null,
        createdAt: timestamp(memory.createdAt),
        updatedAt: timestamp(memory.updatedAt),
      })),
    events: events.map((event) => ({
      id: event.id,
      courseId,
      title: event.title,
      date: dateKey(event.eventDate),
      note: [event.startTime, event.week, event.sourceName].filter(Boolean).join(' · '),
      kind: CALENDAR_KINDS.has(event.kind) ? event.kind : 'other',
      source: 'imported',
      status: calendarStatus(event.status),
      createdAt: timestamp(event.createdAt),
      updatedAt: timestamp(event.updatedAt),
    })),
    learningProgress: learningProgressOf(learnerState),
    miniLectures: lectureJobs.map(miniLectureFromJob),
  };
}

type MiniLectureJob = {
  id: string;
  payload: unknown;
  createdAt: Date;
  completedAt: Date | null;
};

function miniLectureFromJob(job: MiniLectureJob) {
  const input = jsonRecord(jsonRecord(job.payload).input);
  const answer = jsonRecord(input.answer);
  const answerMessageId = typeof answer.id === 'string' ? answer.id : `remote-lecture:${job.id}`;
  const summary = jsonRecord(jsonRecord(job.payload).lectureSummary);
  return {
    id: job.id,
    answerMessageId,
    title:
      typeof summary.title === 'string' && summary.title
        ? summary.title
        : typeof answer.title === 'string' && answer.title
          ? answer.title
          : '课堂讲解',
    createdAt: timestamp(job.completedAt ?? job.createdAt),
  };
}

export const MINI_LECTURE_PAGE_LIMIT = 20;
const MAX_MINI_LECTURE_PAGE_LIMIT = 60;

function encodeMiniLectureCursor(job: MiniLectureJob): string {
  return Buffer.from(`${job.createdAt.toISOString()}|${job.id}`).toString('base64url');
}

function decodeMiniLectureCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const date = new Date(createdAt ?? '');
  return id && Number.isFinite(date.getTime()) ? { createdAt: date, id } : null;
}

/** 课堂清单的一页（最新的在前）；App 的课堂页滚到底时用 nextCursor 取下一页。 */
export async function listNativeMiniLecturePage(
  prisma: PrismaClient,
  userId: string,
  courseId: string,
  options: { cursor?: string | null; limit?: number },
) {
  const after = options.cursor ? decodeMiniLectureCursor(options.cursor) : null;
  if (options.cursor && !after) return null;
  const limit = Math.max(
    1,
    Math.min(MAX_MINI_LECTURE_PAGE_LIMIT, Math.trunc(options.limit ?? MINI_LECTURE_PAGE_LIMIT)),
  );
  const jobs = await prisma.backgroundJob.findMany({
    where: {
      ownerId: userId,
      courseId,
      kind: 'mini-lecture',
      status: 'completed',
      ...(after
        ? {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : {}),
    },
    select: { id: true, payload: true, createdAt: true, completedAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const page = jobs.slice(0, limit);
  const last = page[page.length - 1];
  return {
    miniLectures: page.map(miniLectureFromJob),
    nextCursor: jobs.length > limit && last ? encodeMiniLectureCursor(last) : null,
  };
}

/** 单本笔记的完整内容（页面、Markdown 章节和数据库里的图片），供 App 导入本机。 */
export async function buildNativeNotebookArchive(
  prisma: PrismaClient,
  userId: string,
  notebookId: string,
) {
  // Keep downloads independent of counters and store fields unrelated to reading.
  const notebook = await prisma.notebook.findUnique({
    where: { id: notebookId },
    select: {
      id: true,
      ownerId: true,
      courseId: true,
      removedAt: true,
      name: true,
      description: true,
      notebookKind: true,
      tags: true,
      sectionCount: true,
      sceneCount: true,
      contentVersion: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!notebook || notebook.removedAt || !notebook.courseId) return null;
  const courseId = notebook.courseId;
  if (
    notebook.ownerId !== userId &&
    !(await canReadCourseNotebook(prisma, userId, courseId, notebookId))
  ) {
    return null;
  }

  const [modernPages, legacyScenes, markdownSections] = await Promise.all([
    prisma.notebookPage.findMany({
      where: { notebookId },
      include: {
        content: true,
        actions: true,
        assets: { include: { asset: true }, orderBy: { order: 'asc' } },
      },
      orderBy: { order: 'asc' },
    }),
    prisma.scene.findMany({ where: { notebookId }, orderBy: { order: 'asc' } }),
    prisma.markdownNotebookSection.findMany({ where: { notebookId }, orderBy: { order: 'asc' } }),
  ]);

  const pages = modernPages.length
    ? modernPages.map((page) => ({
        id: page.id,
        notebookId,
        courseId: page.courseId,
        sourceSceneId: page.sourceSceneId,
        title: page.title,
        type: page.type,
        order: page.order,
        content: jsonRecord(page.content?.content),
        actions: jsonArray(page.actions?.actions),
        whiteboard: page.content?.whiteboard ? jsonRecord(page.content.whiteboard) : null,
        createdAt: timestamp(page.createdAt),
        updatedAt: timestamp(page.updatedAt),
      }))
    : legacyScenes.map((scene) => ({
        id: scene.id,
        notebookId,
        courseId,
        sourceSceneId: scene.id,
        title: scene.title,
        type: scene.type,
        order: scene.order,
        content: jsonRecord(scene.content),
        actions: jsonArray(scene.actions),
        whiteboard: scene.whiteboard ? jsonRecord(scene.whiteboard) : null,
        createdAt: timestamp(scene.createdAt),
        updatedAt: timestamp(scene.updatedAt),
      }));
  const sections = markdownSections.map((section) => ({
    id: section.id,
    notebookId,
    courseId: section.courseId,
    title: section.title,
    order: section.order,
    markdown: section.markdown,
    summary: section.summary,
    sourceMeta: jsonRecord(section.sourceMeta),
    createdAt: timestamp(section.createdAt),
    updatedAt: timestamp(section.updatedAt),
  }));

  const referencedPaths = new Set<string>();
  for (const page of pages) {
    collectAssetPaths(page.content, referencedPaths);
    collectAssetPaths(page.actions, referencedPaths);
    collectAssetPaths(page.whiteboard, referencedPaths);
  }
  for (const section of sections) {
    collectAssetPaths(section.markdown, referencedPaths);
    collectAssetPaths(section.sourceMeta, referencedPaths);
  }
  const linkedAssets = modernPages.flatMap((page) => page.assets.map((link) => link.asset));
  for (const asset of linkedAssets) referencedPaths.add(asset.path);

  const pathList = [...referencedPaths];
  const binaryAssets = [];
  for (let index = 0; index < pathList.length; index += 500) {
    binaryAssets.push(
      ...(await prisma.notebookImageAsset.findMany({
        where: { path: { in: pathList.slice(index, index + 500) } },
      })),
    );
  }
  const binaryByPath = new Map(binaryAssets.map((asset) => [asset.path, asset]));
  type ArchiveAsset = {
    id: string;
    path: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    source: string | null;
    dataBase64: string | null;
    createdAt: number;
    updatedAt: number;
  };
  const assetByPath = new Map<string, ArchiveAsset>();
  for (const linked of linkedAssets) {
    if (assetByPath.has(linked.path)) continue;
    const bytes = linked.data ?? binaryByPath.get(linked.path)?.data ?? null;
    assetByPath.set(linked.path, {
      id: linked.id,
      path: linked.path,
      mimeType: linked.mimeType,
      sizeBytes: bytes?.length ?? linked.sizeBytes,
      sha256: bytes ? sha256(bytes) : linked.sha256,
      source: linked.source,
      dataBase64: bytes ? Buffer.from(bytes).toString('base64') : null,
      createdAt: timestamp(linked.createdAt),
      updatedAt: timestamp(linked.updatedAt),
    });
  }
  for (const binary of binaryAssets) {
    if (assetByPath.has(binary.path)) continue;
    assetByPath.set(binary.path, {
      id: binary.id,
      path: binary.path,
      mimeType: binary.mimeType,
      sizeBytes: binary.data.length,
      sha256: sha256(binary.data),
      source: binary.source,
      dataBase64: Buffer.from(binary.data).toString('base64'),
      createdAt: timestamp(binary.createdAt),
      updatedAt: timestamp(binary.updatedAt),
    });
  }
  const assets = [...assetByPath.values()];
  const pageAssets = modernPages.flatMap((page) =>
    page.assets.flatMap((link) => {
      const asset = assetByPath.get(link.asset.path);
      if (!asset) return [];
      return [
        {
          id: link.id,
          pageId: link.pageId,
          assetId: asset.id,
          role: link.role,
          order: link.order,
          meta: jsonRecord(link.metaJson),
          createdAt: timestamp(link.createdAt),
          updatedAt: timestamp(link.updatedAt),
        },
      ];
    }),
  );
  const linkedAt = Date.now();
  const notebookAssets = assets.map((asset) => ({
    id: `${notebookId}:${asset.id}`,
    notebookId,
    assetId: asset.id,
    createdAt: linkedAt,
    updatedAt: linkedAt,
  }));

  return {
    notebook: {
      id: notebook.id,
      courseId,
      name: notebook.name,
      description: notebook.description ?? '',
      kind: notebook.notebookKind === 'markdown' ? 'markdown' : 'image',
      tags: notebook.tags,
      sectionCount:
        notebook.notebookKind === 'markdown' ? notebook.sectionCount : notebook.sceneCount,
      contentVersion: notebook.contentVersion,
      createdAt: timestamp(notebook.createdAt),
      updatedAt: timestamp(notebook.updatedAt),
    },
    notebookPages: pages,
    markdownSections: sections,
    assets,
    pageAssets,
    notebookAssets,
    missingAssetPaths: pathList.filter((assetPath) => !assetByPath.get(assetPath)?.dataBase64),
  };
}

/** 网页上生成好的课堂（后台任务结果就是 App 用的课堂清单 manifest）。 */
export async function loadNativeMiniLectureManifest(
  prisma: PrismaClient,
  userId: string,
  jobId: string,
) {
  const job = await prisma.backgroundJob.findFirst({
    where: { id: jobId, ownerId: userId, kind: 'mini-lecture', status: 'completed' },
    select: { result: true },
  });
  return job?.result ?? null;
}

async function loadLearnerState(
  prisma: PrismaClient,
  userId: string,
  courseId: string,
): Promise<LearnerCourseState | null> {
  const fact = await prisma.memoryFact.findFirst({
    where: {
      ownerId: userId,
      scopeType: 'user',
      scopeId: null,
      namespace: LEARNER_STATE_NAMESPACE,
      key: learnerStateKey(courseId),
      status: 'active',
    },
    orderBy: { updatedAt: 'desc' },
    select: { valueJson: true },
  });
  return fact && isLearnerCourseState(fact.valueJson, courseId) ? fact.valueJson : null;
}

/** 网页右侧可拖动的「学习进度」：学到哪一本，或还没开始 / 已学完。 */
function learningProgressOf(state: LearnerCourseState | null) {
  const checkpoint = state?.progressCheckpoint;
  if (!state || !checkpoint) return null;
  return {
    kind: checkpoint.kind,
    notebookId: checkpoint.notebookId ?? state.currentNotebookId ?? null,
    updatedAt: checkpoint.confirmedAt || state.updatedAt,
  };
}

function persistedLearningOrder(value: unknown): number | undefined {
  const learningOrder = jsonRecord(value).learningOrder;
  return typeof learningOrder === 'number' && Number.isInteger(learningOrder) && learningOrder >= 0
    ? learningOrder
    : undefined;
}

/** 手机上拖动学习进度后写回网页，网页和手机看到同一个进度。 */
export async function saveNativeLearningProgress(
  prisma: PrismaClient,
  userId: string,
  input: { courseId: string; kind: LearnerProgressCheckpointKind; notebookId?: string | null },
) {
  const target = await resolveReadableStudyMemoryTarget(prisma, userId, 'course', input.courseId);
  if (!target) return null;
  const [state, notebooks] = await Promise.all([
    loadLearnerState(prisma, userId, input.courseId),
    listReadableNotebookLibraryItems(prisma, userId, input.courseId),
  ]);
  const coverRows = await prisma.notebook.findMany({
    where: { id: { in: notebooks.map((notebook) => notebook.id) } },
    select: { id: true, coverSlideJson: true },
  });
  const learningOrders = new Map(
    coverRows.map((row) => [row.id, persistedLearningOrder(row.coverSlideJson)]),
  );
  const checkpointed = previewLearnerProgressCheckpoint({
    state: state ?? createEmptyLearnerCourseState({ userId, courseId: input.courseId }),
    notebooks: notebooks.map((notebook) => ({
      id: notebook.id,
      courseId: input.courseId,
      name: notebook.name,
      learningOrder: learningOrders.get(notebook.id),
      sceneCount: notebook.sceneCount,
      createdAt: timestamp(notebook.createdAt),
      updatedAt: timestamp(notebook.updatedAt),
    })),
    kind: input.kind,
    notebookId: input.notebookId ?? undefined,
  });
  const next: LearnerCourseState = { ...checkpointed, updatedAt: Date.now() };
  await upsertMemoryFact({
    prisma,
    ownerId: userId,
    scopeType: 'user',
    namespace: LEARNER_STATE_NAMESPACE,
    key: learnerStateKey(input.courseId),
    valueJson: next,
    confidence: 1,
    source: 'native-app',
    sourceRef: { courseId: input.courseId, updatedAt: next.updatedAt },
  });
  return learningProgressOf(next);
}
