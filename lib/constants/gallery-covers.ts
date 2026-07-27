/**
 * 课程/笔记本卡片顶部封面用图（与头像素材无关）；按 seed 稳定映射。
 * 优先使用课程自己的 `avatarUrl`（在 CourseGalleryCard 内），否则使用此处稳定壁纸。
 *
 * 使用 `public/covers/*.svg` 本地资源，避免依赖外网图床（部分网络环境下 Pexels 无法加载会导致卡片封面空白）。
 */
const FILES: readonly string[] = [
  '/covers/cover-01.svg',
  '/covers/cover-02.svg',
  '/covers/cover-03.svg',
  '/covers/cover-04.svg',
  '/covers/cover-05.svg',
  '/covers/cover-06.svg',
  '/covers/cover-07.svg',
  '/covers/cover-08.svg',
] as const;

function hashStringToUint32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 按 id 稳定选择一张封面图（无课件缩略图时使用） */
export function pickStableGalleryCoverUrl(seed: string): string {
  if (FILES.length === 0) return '';
  const i = hashStringToUint32(seed) % FILES.length;
  return FILES[i];
}
