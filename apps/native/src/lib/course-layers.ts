import { useCallback, useSyncExternalStore } from 'react';

import { accountStorageKey } from '../data/browser-runtime';
import type {
  NativeCourseLayers,
  NativeHiddenCourseContent,
  NativeProblemSnapshot,
} from '../data/platform-api-contracts';
import { getNativeCourseLayers, nativeCourseContentAction } from '../data/platform-api-client';

/**
 * 从商城加入的课分两层：发布者的公有层、自己的私有层。
 * 这里记着本机要用的那一点：哪些题 / 笔记是「新」的、哪些是自己的、哪些被自己隐藏了。
 * 题目的层信息跟着题库同步写进来，其余的打开课程页时拉一次。
 */

export type ProblemLayerInfo = {
  layer: 'public' | 'private';
  releaseAddedIn: number | null;
  contentUpdatedAt: number | null;
};

export type CourseLayerState = {
  newSinceVersion: number | null;
  problems: Record<string, ProblemLayerInfo>;
  hidden: NativeHiddenCourseContent[];
  newNotebookIds: string[];
  privateNotebookIds: string[];
};

const STORAGE_PREFIX = 'syntara.course-layers.v1:';
const EMPTY: CourseLayerState = {
  newSinceVersion: null,
  problems: {},
  hidden: [],
  newNotebookIds: [],
  privateNotebookIds: [],
};
const listeners = new Set<(courseId: string) => void>();
const snapshots = new Map<string, { raw: string | null; state: CourseLayerState }>();

function key(courseId: string) {
  return accountStorageKey(`${STORAGE_PREFIX}${courseId}`);
}

export function readCourseLayers(courseId: string): CourseLayerState {
  try {
    const storageKey = key(courseId);
    const raw = window.localStorage.getItem(storageKey);
    const cached = snapshots.get(storageKey);
    if (cached?.raw === raw) return cached.state;
    const parsed = raw ? (JSON.parse(raw) as Partial<CourseLayerState>) : {};
    const state = { ...EMPTY, ...parsed };
    snapshots.set(storageKey, { raw, state });
    return state;
  } catch {
    return EMPTY;
  }
}

function write(courseId: string, next: CourseLayerState) {
  try {
    window.localStorage.setItem(key(courseId), JSON.stringify(next));
  } catch {
    /* 存不下只是少了「新」标记，题库照常可用。 */
  }
  listeners.forEach((listener) => listener(courseId));
}

/** 题库同步时调用：记下每道题是公有还是自己的、哪一版加进来、什么时候改过。 */
export function saveProblemLayers(courseId: string, snapshot: NativeProblemSnapshot) {
  const current = readCourseLayers(courseId);
  const visible = new Set(snapshot.problemIds);
  const problems: Record<string, ProblemLayerInfo> = {};
  for (const [id, info] of Object.entries(current.problems)) {
    if (!snapshot.complete || visible.has(id)) problems[id] = info;
  }
  for (const problem of snapshot.problems) {
    problems[problem.id] = {
      layer: problem.layer ?? 'public',
      releaseAddedIn: problem.releaseAddedIn ?? null,
      contentUpdatedAt: problem.contentUpdatedAt ?? null,
    };
  }
  write(courseId, {
    ...current,
    newSinceVersion: snapshot.newSinceVersion ?? null,
    problems,
  });
}

/** 打开加入的课的笔记 / 题库时拉一次：已隐藏、「新」笔记、自己的笔记。 */
export async function refreshCourseLayers(courseId: string): Promise<NativeCourseLayers> {
  const remote = await getNativeCourseLayers(courseId);
  write(courseId, {
    ...readCourseLayers(courseId),
    hidden: remote.hidden ?? [],
    newNotebookIds: remote.newNotebookIds ?? [],
    privateNotebookIds: remote.privateNotebookIds ?? [],
  });
  return remote;
}

export type CourseContentTarget = { targetType: 'notebook' | 'problem'; targetId: string };

/** 删除：公有内容只对自己隐藏，自己的真删。返回服务器做了哪一种。 */
export async function removeCourseContent(courseId: string, target: CourseContentTarget) {
  const result = await nativeCourseContentAction(courseId, 'remove', target);
  await refreshCourseLayers(courseId).catch(() => undefined);
  return result.result ?? 'hidden';
}

export async function restoreCourseContent(courseId: string, target: CourseContentTarget) {
  await nativeCourseContentAction(courseId, 'restore', target);
  await refreshCourseLayers(courseId).catch(() => undefined);
}

/** 复制到我的：得到一份能改的私有副本，原件对自己收起。 */
export async function copyCourseContent(courseId: string, target: CourseContentTarget) {
  const result = await nativeCourseContentAction(courseId, 'copy', target);
  await refreshCourseLayers(courseId).catch(() => undefined);
  return result.id ?? null;
}

export function isProblemNew(state: CourseLayerState, problemId: string): boolean {
  const info = state.problems[problemId];
  return Boolean(
    info &&
    info.layer === 'public' &&
    state.newSinceVersion !== null &&
    (info.releaseAddedIn ?? 0) > state.newSinceVersion,
  );
}

/** 做过之后发布者又改了题：做题记录留着，提示一下「题目已更新」。 */
export function isProblemContentUpdated(
  state: CourseLayerState,
  problemId: string,
  lastAttemptAt: number | null | undefined,
): boolean {
  const updatedAt = state.problems[problemId]?.contentUpdatedAt;
  return Boolean(updatedAt && lastAttemptAt && lastAttemptAt < updatedAt);
}

export function isPrivateProblem(state: CourseLayerState, problemId: string): boolean {
  return state.problems[problemId]?.layer === 'private';
}

export function useCourseLayers(courseId: string): CourseLayerState {
  const subscribe = useCallback(
    (notify: () => void) => {
      const listener = (changed: string) => {
        if (changed === courseId) notify();
      };
      const storageListener = (event: StorageEvent) => {
        if (event.key === key(courseId)) notify();
      };
      listeners.add(listener);
      window.addEventListener('storage', storageListener);
      return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', storageListener);
      };
    },
    [courseId],
  );
  return useSyncExternalStore(
    subscribe,
    () => readCourseLayers(courseId),
    () => EMPTY,
  );
}
