import { browserAccountId } from '../data/browser-runtime';
import type { NativePlatformCourse } from '../data/platform-api-contracts';

/**
 * 账号课程的附加信息（自己建的还是从商城加入的、机构名、有没有新版），
 * 每次同步课程列表时整体覆盖，只存在本机。
 */
export type PlatformCourseMeta = {
  accessRole: NativePlatformCourse['accessRole'];
  visibility?: NativePlatformCourse['visibility'];
  organizationName: string | null;
  contentVersion?: number;
  seenContentVersion?: number;
  hasUpdate: boolean;
  /** 「+3 题，改了 1 篇笔记」；打开课程时在聊天上方亮一下。 */
  updateSummary?: string | null;
  /** 账号上存的课程头像：商城课程用商城里那颗，自己建的课是创建时随机的那颗。 */
  avatarUrl?: string | null;
};

const STORAGE_KEY = 'syntara.platform-course-meta.v1';
const listeners = new Set<() => void>();

export function readPlatformCourseMeta(): Record<string, PlatformCourseMeta> {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${browserAccountId()}`);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, PlatformCourseMeta>)
      : {};
  } catch {
    return {};
  }
}

function write(next: Record<string, PlatformCourseMeta>) {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${browserAccountId()}`, JSON.stringify(next));
  } catch {
    /* 存不下时只是少了标记，课程照常可用。 */
  }
  listeners.forEach((listener) => listener());
}

export function savePlatformCourseMeta(courses: NativePlatformCourse[]) {
  const previous = readPlatformCourseMeta();
  write(
    Object.fromEntries(
      courses.map((course) => {
        const seenContentVersion = previous[course.id]?.seenContentVersion;
        return [
          course.id,
          {
            accessRole: course.accessRole,
            visibility:
              course.visibility ??
              (course.accessRole === 'enrolled' || course.organizationName ? 'public' : undefined),
            organizationName: course.organizationName ?? null,
            contentVersion: course.contentVersion,
            seenContentVersion,
            hasUpdate:
              Boolean(course.hasUpdate) &&
              (course.contentVersion === undefined ||
                course.contentVersion > (seenContentVersion ?? 0)),
            updateSummary: course.updateSummary || null,
            avatarUrl: course.avatarUrl || null,
          },
        ];
      }),
    ),
  );
}

/** 打开过这门课后先在本机熄灭更新弹珠，服务器那边由调用方告知。 */
export function clearPlatformCourseUpdate(courseId: string) {
  const current = readPlatformCourseMeta();
  const course = current[courseId];
  if (!course?.hasUpdate) return;
  write({
    ...current,
    [courseId]: {
      ...course,
      hasUpdate: false,
      seenContentVersion: course.contentVersion ?? course.seenContentVersion,
    },
  });
}

export function subscribePlatformCourseMeta(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
