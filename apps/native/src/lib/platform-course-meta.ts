import type { NativePlatformCourse } from '../data/platform-api-contracts';

/**
 * 账号课程的附加信息（自己建的还是从商城加入的、机构名、有没有新版），
 * 每次同步课程列表时整体覆盖，只存在本机。
 */
export type PlatformCourseMeta = {
  accessRole: NativePlatformCourse['accessRole'];
  organizationName: string | null;
  hasUpdate: boolean;
};

const STORAGE_KEY = 'syntara.platform-course-meta.v1';
const listeners = new Set<() => void>();

export function readPlatformCourseMeta(): Record<string, PlatformCourseMeta> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, PlatformCourseMeta>) : {};
  } catch {
    return {};
  }
}

function write(next: Record<string, PlatformCourseMeta>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 存不下时只是少了标记，课程照常可用。 */
  }
  listeners.forEach((listener) => listener());
}

export function savePlatformCourseMeta(courses: NativePlatformCourse[]) {
  write(
    Object.fromEntries(
      courses.map((course) => [
        course.id,
        {
          accessRole: course.accessRole,
          organizationName: course.organizationName ?? null,
          hasUpdate: Boolean(course.hasUpdate),
        },
      ]),
    ),
  );
}

/** 打开过这门课后先在本机熄灭更新弹珠，服务器那边由调用方告知。 */
export function clearPlatformCourseUpdate(courseId: string) {
  const current = readPlatformCourseMeta();
  if (!current[courseId]?.hasUpdate) return;
  write({ ...current, [courseId]: { ...current[courseId], hasUpdate: false } });
}

export function subscribePlatformCourseMeta(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
