import type { MarbleColor } from './learning-action-marbles';
import type { GalaxyNode, MarbleRarity } from './memory-galaxy';

/**
 * 和头像同一套画出来的珠子图。文件放在 assets/marbles/，名字是「等级-颜色-名字」，
 * 比如 r-pink-01.webp、sr-blue-cloud.webp、ssr-any-eclipse.webp（any 表示什么颜色的记忆都能用）。
 * 同一条记忆每次拿到的都是同一张；没有对应的图时返回 null，星图就用代码画的珠子。 */

type ArtColor = MarbleColor | 'silver' | 'any';
type MarbleArt = { url: string; rarity: MarbleRarity; color: ArtColor };

const RARITIES: Record<string, MarbleRarity> = { r: 'R', sr: 'SR', ssr: 'SSR', ex: 'EX' };
const COLORS = new Set<ArtColor>(['blue', 'green', 'amber', 'pink', 'purple', 'silver', 'any']);

const files = import.meta.glob<string>('../assets/marbles/*.{png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
});

const ART: MarbleArt[] = Object.entries(files).flatMap(([path, url]) => {
  const [rarity, color] = (path.split('/').pop() ?? '').toLowerCase().split(/[-.]/);
  const tier = RARITIES[rarity];
  if (!tier || !COLORS.has(color as ArtColor)) return [];
  return [{ url, rarity: tier, color: color as ArtColor }];
});

function seeded(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

export function hasMarbleArt(): boolean {
  return ART.length > 0;
}

/** 这颗球该用哪张图：先找同等级同颜色的；SR 以上的珠子花纹本来就五颜六色，找不到就用同等级任意一张。 */
export function marbleArtFor(node: GalaxyNode): string | null {
  if (!ART.length) return null;
  const color: ArtColor = node.kind === 'core' ? 'purple' : (node.color ?? 'silver');
  const sameTier = ART.filter((art) => art.rarity === node.tier);
  let pool = sameTier.filter((art) => art.color === color || art.color === 'any');
  if (!pool.length && node.tier !== 'R') pool = sameTier;
  if (!pool.length) return null;
  return pool[Math.floor(seeded(`${node.id}:art`) * pool.length) % pool.length].url;
}
