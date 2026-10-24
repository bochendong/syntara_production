import {
  MARBLE_AVATAR_CATALOG,
  type MarbleAvatarRarity,
} from '../../../lib/constants/marble-avatars';
import avatarThemeHues from '../../../lib/constants/marble-avatar-theme-hues.json';
import { resolveAccountAvatar } from './lib/account-avatar';

const avatarModules = import.meta.glob('../../../public/avatars/marble-collection-v1/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const avatarUrls = new Map(
  Object.entries(avatarModules).map(([path, url]) => [path.split('/').pop(), url]),
);

const profileBackgroundModules = import.meta.glob(
  '../../../public/avatars/marble-backgrounds-v1/*.webp',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

const profileBackgroundUrls = new Map(
  Object.entries(profileBackgroundModules).map(([path, url]) => [path.split('/').pop(), url]),
);

const sidebarBackgroundModules = import.meta.glob(
  '../../../public/avatars/marble-sidebars-v1/*.webp',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

const sidebarBackgroundUrls = new Map(
  Object.entries(sidebarBackgroundModules).map(([path, url]) => [path.split('/').pop(), url]),
);

const galaxyBackgroundModules = import.meta.glob(
  '../../../public/avatars/marble-galaxies-v1/*.webp',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

const galaxyBackgroundUrls = new Map(
  Object.entries(galaxyBackgroundModules).map(([path, url]) => [path.split('/').pop(), url]),
);

export type CourseAvatarPreset = {
  id: string;
  name: string;
  rarity: MarbleAvatarRarity;
  url: string;
};

/** 和网页端同一份 45 款目录，图片由 Vite 打包到应用内，支持离线显示。 */
export const COURSE_AVATAR_PRESETS: CourseAvatarPreset[] = MARBLE_AVATAR_CATALOG.map((avatar) => ({
  id: avatar.id,
  name: avatar.name,
  rarity: avatar.rarity,
  url: avatarUrls.get(avatar.filename) || '',
}));

function catalogAvatarForUrl(avatarUrl: string | null | undefined) {
  if (!avatarUrl) return undefined;
  let pathname = avatarUrl;
  try {
    pathname = new URL(avatarUrl, 'https://syntara.local').pathname;
  } catch {
    return undefined;
  }
  return MARBLE_AVATAR_CATALOG.find(
    (item) => avatarUrls.get(item.filename) === avatarUrl || item.url === pathname,
  );
}

/** 网页存的弹珠头像地址（/avatars/marble-collection-v1/…）换成 App 打包的那张，并带上它的色相。 */
export function bundledMarbleAvatar(
  avatarUrl: string | null | undefined,
): { url: string; hue: number; sceneUrl?: string } | undefined {
  const avatar = catalogAvatarForUrl(avatarUrl);
  const url = avatar && avatarUrls.get(avatar.filename);
  if (!avatar || !url) return undefined;
  return {
    url,
    hue: avatarThemeHues[avatar.id as keyof typeof avatarThemeHues] ?? 220,
    // 弹珠所在的场景图（3:1），商城精选卡拿来当整张卡的背景。
    sceneUrl: profileBackgroundUrls.get(avatar.filename),
  };
}

/** Resolve separate card and sidebar artwork, including synced web avatar URLs. */
export function profileThemeForAvatar(avatarUrl: string) {
  let pathname = avatarUrl;
  try {
    pathname = new URL(avatarUrl, 'https://syntara.local').pathname;
  } catch {
    // Custom images keep the neutral card background.
  }
  const avatar = MARBLE_AVATAR_CATALOG.find(
    (item) => avatarUrls.get(item.filename) === avatarUrl || item.url === pathname,
  );
  const backgroundUrl = avatar && profileBackgroundUrls.get(avatar.filename);
  if (!avatar || !backgroundUrl) return undefined;
  const hue = avatarThemeHues[avatar.id as keyof typeof avatarThemeHues];
  return {
    backgroundUrl,
    sidebarUrl: sidebarBackgroundUrls.get(avatar.filename),
    galaxyUrl: galaxyBackgroundUrls.get(avatar.filename),
    accent: `hsl(${hue} 50% 32%)`,
  };
}

const courseAvatarByCode: Record<string, string> = {
  CSC148: COURSE_AVATAR_PRESETS.find((item) => item.id === 'SR02')?.url || '',
  MAT136: COURSE_AVATAR_PRESETS.find((item) => item.id === 'R07')?.url || '',
};

const defaultCourseAvatarUrl =
  COURSE_AVATAR_PRESETS.find((item) => item.id === 'R14')?.url || COURSE_AVATAR_PRESETS[0].url;

export function courseAvatarStorageKey(courseId: string): string {
  return `syntara.native.course.${courseId}.avatar`;
}

export function readStoredCourseAvatarId(courseId: string): string | null {
  try {
    return window.localStorage.getItem(courseAvatarStorageKey(courseId));
  } catch {
    return null;
  }
}

export function writeStoredCourseAvatarId(courseId: string, avatarId: string | null): void {
  try {
    if (!avatarId) {
      window.localStorage.removeItem(courseAvatarStorageKey(courseId));
      return;
    }
    window.localStorage.setItem(courseAvatarStorageKey(courseId), avatarId);
    window.dispatchEvent(new Event('syntara-native-course-avatar-changed'));
  } catch {
    // Ignore storage failures; UI can still preview the selected avatar for this session.
  }
}

export function courseAvatarUrlById(avatarId: string | null | undefined): string | null {
  if (!avatarId) return null;
  return COURSE_AVATAR_PRESETS.find((item) => item.id === avatarId)?.url || null;
}

export function nativeAccountAvatarUrl(
  avatarId: string | null,
  accountImage: string | null | undefined,
): string {
  return (
    courseAvatarUrlById(avatarId) ||
    resolveAccountAvatar(accountImage, MARBLE_AVATAR_CATALOG, courseAvatarUrlById) ||
    courseAvatarUrlById('R01') ||
    ''
  );
}

export function pickRandomCourseAvatarId(): string {
  if (!COURSE_AVATAR_PRESETS.length) return 'R01';
  const index = Math.floor(Math.random() * COURSE_AVATAR_PRESETS.length);
  return COURSE_AVATAR_PRESETS[index].id;
}

export function courseAvatarFor(courseCode: string | null): string {
  return (courseCode && courseAvatarByCode[courseCode.toUpperCase()]) || defaultCourseAvatarUrl;
}

export function resolveNativeCourseAvatar(
  courseId: string,
  courseCode: string | null,
  avatarId?: string | null,
): string {
  const resolvedId = avatarId ?? readStoredCourseAvatarId(courseId);
  return courseAvatarUrlById(resolvedId) || courseAvatarFor(courseCode);
}
