import { accountStorageKey } from './browser-runtime';
import { checkpointProgressCount, groupNotebookTranslations } from '../lib/notebook-translations';
import type { LocalNotebook, LocalNotebookDocument, LocalStudyMemory } from '../domain/models';
import { mergeReviewedMap, readReviewedMap } from '../lib/memory-freshness';
import { SYNTARA_ARCHIVE_FORMAT, SYNTARA_ARCHIVE_VERSION, type SyntaraArchiveV1 } from './archive';
import { isPlatformCourse } from './chat-sync';
import { miniLectureManifestToPersistence } from './mini-lecture-persistence';
import type { NativeSyncedNotebook } from './platform-api-contracts';
import {
  getNativeCourseData,
  getNativeMiniLecture,
  getNativeNotebook,
  saveNativeLearningProgress,
  syncNativeMemories,
} from './platform-api-client';
import { syncCourseProblems } from './problem-sync';
import type { LocalRepository } from './repository';

/** 每次打开课程最多下载几份网页课堂，避免一次拉太多图片和音频。 */
const MAX_LECTURE_DOWNLOADS_PER_SYNC = 6;
/** 和服务器 NATIVE_WEB_MEMORY_LIMIT 一致。 */
const WEB_MEMORY_SYNC_LIMIT = 600;
const SYNC_STATE_PREFIX = 'syntara.course-sync.v1:';
const NOTEBOOK_VERSION_KEY = 'syntara.notebook-sync.v1';

type CourseSyncState = {
  /** 从网页同步下来的笔记 id；网页上删掉或自己隐藏后只收回这些，手机自己导入的不动。 */
  notebookIds: string[];
  memoryIds: string[];
  eventIds: string[];
  lectureIds: string[];
};

export type CourseDataSyncResult = {
  notebooks: boolean;
  memories: boolean;
  events: boolean;
  lectures: boolean;
  progress: boolean;
  problems: boolean;
};

const NOTHING_CHANGED: CourseDataSyncResult = {
  notebooks: false,
  memories: false,
  events: false,
  lectures: false,
  progress: false,
  problems: false,
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(accountStorageKey(key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(accountStorageKey(key), JSON.stringify(value));
  } catch {
    // 存不下时下次打开课程会重新比对，不影响使用。
  }
}

function readCourseState(courseId: string): CourseSyncState {
  const state = readJson<Partial<CourseSyncState>>(`${SYNC_STATE_PREFIX}${courseId}`, {});
  return {
    notebookIds: Array.isArray(state.notebookIds) ? state.notebookIds : [],
    memoryIds: Array.isArray(state.memoryIds) ? state.memoryIds : [],
    eventIds: Array.isArray(state.eventIds) ? state.eventIds : [],
    lectureIds: Array.isArray(state.lectureIds) ? state.lectureIds : [],
  };
}

type NotebookVersions = Record<string, { remote?: string; local?: string }>;

function notebookVersion(notebook: NativeSyncedNotebook): string {
  return `${notebook.contentVersion}:${notebook.updatedAt}`;
}

function archiveOf(parts: Partial<SyntaraArchiveV1>): SyntaraArchiveV1 {
  return {
    format: SYNTARA_ARCHIVE_FORMAT,
    version: SYNTARA_ARCHIVE_VERSION,
    exportedAt: Date.now(),
    source: { kind: 'postgresql' },
    courses: [],
    notebooks: [],
    notebookPages: [],
    markdownSections: [],
    problems: [],
    problemAttempts: [],
    problemProgress: [],
    conversations: [],
    messages: [],
    studyMemories: [],
    assets: [],
    pageAssets: [],
    notebookAssets: [],
    missingAssetPaths: [],
    ...parts,
  };
}

function toLocalNotebook(notebook: NativeSyncedNotebook): LocalNotebook {
  return {
    id: notebook.id,
    courseId: notebook.courseId,
    name: notebook.name,
    description: notebook.description,
    kind: notebook.kind,
    tags: notebook.tags,
    sectionCount: notebook.sectionCount,
    createdAt: notebook.createdAt,
    updatedAt: notebook.updatedAt,
  };
}

/**
 * 网页上的课程：把笔记列表、学习记忆、日历、已生成的课堂和题库拉到本机。
 * 笔记正文较大，只记下网页版本，打开时再用 ensureNotebookContent 下载。
 */
export async function syncCourseData(
  repository: LocalRepository,
  courseId: string,
): Promise<CourseDataSyncResult> {
  if (!(await isPlatformCourse(repository, courseId))) return NOTHING_CHANGED;
  const remote = await getNativeCourseData(courseId);
  const local = await repository.loadCourseWorkspace(courseId);
  if (!local) return NOTHING_CHANGED;
  const state = readCourseState(courseId);
  const result: CourseDataSyncResult = { ...NOTHING_CHANGED };

  // 笔记：先同步列表，正文按版本号在打开时下载。
  const localNotebooks = new Map(local.notebooks.map((notebook) => [notebook.id, notebook]));
  const changedNotebooks = remote.notebooks.filter((notebook) => {
    const existing = localNotebooks.get(notebook.id);
    return (
      !existing ||
      existing.name !== notebook.name ||
      existing.updatedAt !== notebook.updatedAt ||
      JSON.stringify(existing.tags) !== JSON.stringify(notebook.tags) ||
      existing.sectionCount !== notebook.sectionCount
    );
  });
  if (changedNotebooks.length) {
    await repository.importArchive(archiveOf({ notebooks: changedNotebooks.map(toLocalNotebook) }));
    result.notebooks = true;
  }
  const versions = readJson<NotebookVersions>(NOTEBOOK_VERSION_KEY, {});
  for (const notebook of remote.notebooks) {
    versions[notebook.id] = { ...versions[notebook.id], remote: notebookVersion(notebook) };
  }
  const remoteNotebookIdSet = new Set(remote.notebooks.map((notebook) => notebook.id));
  for (const notebookId of state.notebookIds) {
    if (remoteNotebookIdSet.has(notebookId) || !localNotebooks.has(notebookId)) continue;
    await repository.removeNotebook(notebookId);
    delete versions[notebookId];
    result.notebooks = true;
  }
  writeJson(NOTEBOOK_VERSION_KEY, versions);

  // 学习记忆：网页上新增或改过的写进本机，网页上删掉的在本机归档。
  const localMemories = new Map(local.memories.map((memory) => [memory.id, memory]));
  const remoteNotebookIds = new Set(remote.notebooks.map((notebook) => notebook.id));
  for (const memory of remote.memories) {
    const existing = localMemories.get(memory.id);
    if (existing && existing.updatedAt >= memory.updatedAt) continue;
    const notebookId =
      memory.notebookId &&
      (remoteNotebookIds.has(memory.notebookId) || localNotebooks.has(memory.notebookId))
        ? memory.notebookId
        : null;
    await repository.upsertStudyMemory({ ...memory, notebookId });
    result.memories = true;
  }
  const remoteMemoryIds = new Set(remote.memories.map((memory) => memory.id));
  // 服务器最多给 600 条；给满了说明可能截断，没出现的不一定是网页上删掉的，先不归档。
  const remoteMemoriesComplete = remote.memories.length < WEB_MEMORY_SYNC_LIMIT;
  for (const memoryId of remoteMemoriesComplete ? state.memoryIds : []) {
    if (remoteMemoryIds.has(memoryId) || !localMemories.has(memoryId)) continue;
    await repository.archiveStudyMemory(memoryId);
    result.memories = true;
  }

  // 日历：网页日程整体覆盖上一次同步下来的那部分，手机自己加的不动。
  const localEvents = new Map(
    (await repository.listCourseEvents(courseId)).map((event) => [event.id, event]),
  );
  const changedEvents = remote.events.filter((event) => {
    const existing = localEvents.get(event.id);
    return (
      !existing ||
      existing.updatedAt !== event.updatedAt ||
      existing.status !== event.status ||
      existing.date !== event.date
    );
  });
  if (changedEvents.length) {
    await repository.upsertCourseEvents(changedEvents);
    result.events = true;
  }
  const remoteEventIds = new Set(remote.events.map((event) => event.id));
  for (const eventId of state.eventIds) {
    if (remoteEventIds.has(eventId) || !localEvents.has(eventId)) continue;
    await repository.deleteCourseEvent(courseId, eventId);
    result.events = true;
  }

  // 学习进度：网页上拖动得更晚就用网页的，换算成手机上「完成到第几本」。
  const progress = remote.learningProgress;
  if (progress) {
    const localProgress = await repository.getCourseLearningState(courseId);
    if (!localProgress || localProgress.updatedAt < progress.updatedAt) {
      const notebookById = new Map(local.notebooks.map((notebook) => [notebook.id, notebook]));
      for (const notebook of remote.notebooks)
        notebookById.set(notebook.id, toLocalNotebook(notebook));
      const allNotebooks = [...notebookById.values()];
      const ordered = groupNotebookTranslations(allNotebooks);
      const completedNotebookCount = checkpointProgressCount(
        allNotebooks,
        progress.kind,
        progress.notebookId,
      );
      await repository.saveCourseLearningState({
        courseId,
        completedNotebookCount,
        currentNotebookId: completedNotebookCount
          ? (ordered[completedNotebookCount - 1]?.id ?? null)
          : null,
        updatedAt: progress.updatedAt,
      });
      result.progress = true;
    }
  }

  // 课堂：挂在已同步到本机的那条老师回复上；还没同步到的下次再试。
  const syncedLectureIds = new Set(state.lectureIds);
  const pendingLectures = remote.miniLectures.filter(
    (lecture) => !syncedLectureIds.has(lecture.id),
  );
  if (pendingLectures.length) {
    const anchors = await repository.findLectureAnchors(
      pendingLectures.map((lecture) => lecture.answerMessageId),
    );
    const messagesById = new Map(anchors.messages.map((message) => [message.id, message]));
    const messageIdsWithDeck = new Set(anchors.messageIdsWithDeck);
    let downloads = 0;
    for (const lecture of pendingLectures) {
      if (messageIdsWithDeck.has(lecture.answerMessageId)) {
        syncedLectureIds.add(lecture.id);
        continue;
      }
      const message = messagesById.get(lecture.answerMessageId);
      if (!message || downloads >= MAX_LECTURE_DOWNLOADS_PER_SYNC) continue;
      downloads += 1;
      try {
        const manifest = await getNativeMiniLecture(lecture.id);
        const deck = await repository.saveMiniLectureDocument(
          miniLectureManifestToPersistence(manifest, message.id),
        );
        await repository.updateMessageMetadata(message.id, {
          ...(message.metadata ?? {}),
          schemaVersion: 1,
          lectureDeckId: deck.id,
        });
        syncedLectureIds.add(lecture.id);
        messageIdsWithDeck.add(message.id);
        result.lectures = true;
      } catch (cause) {
        console.warn('[course-sync] mini-lecture import failed', lecture.id, cause);
      }
    }
  }

  writeJson(`${SYNC_STATE_PREFIX}${courseId}`, {
    notebookIds: [...remoteNotebookIdSet],
    memoryIds: remoteMemoriesComplete
      ? [...remoteMemoryIds]
      : [...new Set([...state.memoryIds, ...remoteMemoryIds])],
    eventIds: remote.events.map((event) => event.id),
    lectureIds: [...syncedLectureIds],
  } satisfies CourseSyncState);

  // App 自己写的记忆：和服务器双向合并（网页看不到），手机 / iPad / 电脑互通。
  try {
    if (await syncAppMemories(repository, courseId)) result.memories = true;
  } catch (cause) {
    console.warn('[course-sync] app memory sync failed', cause);
  }

  // 题库：网页上改过的题拉下来，手机上的作答传上去。
  try {
    result.problems = await syncCourseProblems(repository, courseId);
  } catch (cause) {
    console.warn('[course-sync] problem sync failed', cause);
  }
  return result;
}

function appMemoryForSync(memory: LocalStudyMemory): LocalStudyMemory {
  return {
    ...memory,
    title: memory.title.slice(0, 300),
    text: memory.text.slice(0, 4000),
    reason: memory.reason?.slice(0, 2000) ?? null,
    question: memory.question?.slice(0, 4000) ?? null,
    // 星图只用字符串引用连线；旧版写进来的 evidence 对象不上传。
    sourceReferences: memory.sourceReferences
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.slice(0, 300))
      .slice(0, 40),
    confidence:
      typeof memory.confidence === 'number' ? Math.max(0, Math.min(1, memory.confidence)) : null,
  };
}

// ---- 跟着对话一起删掉的记忆 ----

const DELETED_MEMORIES_KEY = 'syntara.memory-deleted.v1';

/** 课程 id → { 记忆 id → 删除时间 }。推到服务器之前先记在这里，别的设备才知道要删。 */
type DeletedMemories = Record<string, Record<string, number>>;

function deletedMemoriesFor(courseId: string): Record<string, number> {
  return readJson<DeletedMemories>(DELETED_MEMORIES_KEY, {})[courseId] ?? {};
}

function forgetDeletedMemories(courseId: string, memoryIds: string[]) {
  if (!memoryIds.length) return;
  const all = readJson<DeletedMemories>(DELETED_MEMORIES_KEY, {});
  const course = { ...all[courseId] };
  memoryIds.forEach((id) => delete course[id]);
  if (Object.keys(course).length) all[courseId] = course;
  else delete all[courseId];
  writeJson(DELETED_MEMORIES_KEY, all);
}

/** 推给服务器的“这条已经删了”：归档状态、不带内容，更新时间是删除那一刻，合并时会盖过旧的。 */
function deletedMemory(id: string, courseId: string, at: number): LocalStudyMemory {
  return {
    id,
    courseId,
    notebookId: null,
    targetType: 'course',
    scope: 'course',
    kind: 'deleted',
    status: 'archived',
    source: 'app',
    title: '',
    text: '',
    reason: null,
    question: null,
    sourceReferences: [],
    confidence: null,
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * 删对话时调用：这条对话里记下的记忆一起删掉，并告诉服务器，
 * 免得 iPad / 电脑上还留着，或者下次同步又拉回来。网页同步下来的记忆不受影响。
 */
export async function deleteConversationMemories(
  repository: LocalRepository,
  conversationId: string,
): Promise<boolean> {
  const archived = await repository.archiveConversationMemories(conversationId);
  if (!archived.length) return false;
  const all = readJson<DeletedMemories>(DELETED_MEMORIES_KEY, {});
  const at = Date.now();
  const courseIds = new Set<string>();
  for (const memory of archived) {
    if (!memory.courseId) continue;
    courseIds.add(memory.courseId);
    all[memory.courseId] = { ...all[memory.courseId], [memory.id]: at };
  }
  writeJson(DELETED_MEMORIES_KEY, all);
  for (const courseId of courseIds) {
    void syncAppMemories(repository, courseId).catch((cause) =>
      console.warn('[memory-sync] push deletion failed', cause),
    );
  }
  return true;
}

/**
 * 推上本机写的记忆和复习时间，拿回服务器合并后的版本写进本机。
 * 从网页同步下来的记忆不算 App 记忆，不往回推。返回本机记忆有没有变。
 */
export async function syncAppMemories(
  repository: LocalRepository,
  courseId: string,
): Promise<boolean> {
  if (!(await isPlatformCourse(repository, courseId))) {
    // 只在本机的课不用告诉服务器。
    forgetDeletedMemories(courseId, Object.keys(deletedMemoriesFor(courseId)));
    return false;
  }
  const local = await repository.loadCourseWorkspace(courseId);
  if (!local) return false;
  const webMemoryIds = new Set(readCourseState(courseId).memoryIds);
  const appMemories = local.memories.filter((memory) => !webMemoryIds.has(memory.id));
  const deleted = Object.entries(deletedMemoriesFor(courseId))
    .filter(([id]) => !appMemories.some((memory) => memory.id === id))
    .map(([id, at]) => deletedMemory(id, courseId, at));
  const remote = await syncNativeMemories({
    courseId,
    memories: [...deleted, ...appMemories.map(appMemoryForSync)].slice(0, 600),
    reviews: Object.fromEntries(
      Object.entries(readReviewedMap()).filter(([memoryId]) =>
        local.memories.some((memory) => memory.id === memoryId),
      ),
    ),
  });
  mergeReviewedMap(remote.reviews ?? {});
  // 服务器已经记下删除了，别的设备会从那里拿到。
  forgetDeletedMemories(
    courseId,
    deleted.map((memory) => memory.id),
  );
  const localById = new Map(local.memories.map((memory) => [memory.id, memory]));
  let changed = false;
  for (const memory of remote.memories ?? []) {
    const existing = localById.get(memory.id);
    if (existing && existing.updatedAt >= memory.updatedAt) continue;
    if (webMemoryIds.has(memory.id)) continue;
    const notebookId =
      memory.notebookId && local.notebooks.some((notebook) => notebook.id === memory.notebookId)
        ? memory.notebookId
        : null;
    await repository.upsertStudyMemory({ ...memory, courseId, notebookId });
    changed = true;
  }
  return changed;
}

/** 打开笔记前调用：网页上的笔记本机还没有正文或版本落后时，先下载最新内容。 */
export async function ensureNotebookContent(
  repository: LocalRepository,
  notebookId: string,
): Promise<void> {
  const versions = readJson<NotebookVersions>(NOTEBOOK_VERSION_KEY, {});
  const version = versions[notebookId];
  if (!version?.remote || version.local === version.remote) return;
  const archive = await getNativeNotebook(notebookId);
  await repository.clearNotebookContent(notebookId);
  await repository.importArchive(
    archiveOf({
      notebooks: [toLocalNotebook(archive.notebook)],
      notebookPages: archive.notebookPages,
      markdownSections: archive.markdownSections,
      assets: archive.assets,
      pageAssets: archive.pageAssets,
      notebookAssets: archive.notebookAssets,
      missingAssetPaths: archive.missingAssetPaths,
    }),
  );
  const latest = readJson<NotebookVersions>(NOTEBOOK_VERSION_KEY, {});
  const remoteVersion = notebookVersion(archive.notebook);
  latest[notebookId] = { remote: remoteVersion, local: remoteVersion };
  writeJson(NOTEBOOK_VERSION_KEY, latest);
}

/** 打开笔记：先尽量拿到网页上的最新正文，网络不通时退回本机已有的版本。 */
export async function loadNotebookForReading(
  repository: LocalRepository,
  notebookId: string,
): Promise<LocalNotebookDocument | null> {
  let downloadError: unknown = null;
  try {
    await ensureNotebookContent(repository, notebookId);
  } catch (cause) {
    downloadError = cause;
    console.warn('[course-sync] notebook download failed', notebookId, cause);
  }
  const document = await repository.loadNotebookDocument(notebookId);
  if (downloadError && document && !document.pages.length && !document.markdownSections.length) {
    throw new Error('这本笔记还没下载到手机，请联网后再打开。');
  }
  return document;
}

/** 手机上改了学习进度后写回账号；不是网页课程时什么都不做。 */
export async function pushLearningProgress(
  repository: LocalRepository,
  courseId: string,
  completedNotebookCount: number,
  currentNotebookId: string | null,
): Promise<void> {
  if (!(await isPlatformCourse(repository, courseId))) return;
  const workspace = await repository.loadCourseWorkspace(courseId);
  const ordered = groupNotebookTranslations(workspace?.notebooks ?? []);
  const kind =
    completedNotebookCount <= 0
      ? 'not_started'
      : completedNotebookCount >= ordered.length
        ? 'completed_all'
        : 'notebook';
  await saveNativeLearningProgress({
    courseId,
    kind,
    notebookId:
      kind === 'notebook'
        ? (currentNotebookId ?? ordered[completedNotebookCount - 1]?.id ?? null)
        : null,
  });
}
