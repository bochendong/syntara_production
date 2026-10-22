import catalog from './marble-avatar-catalog.json';

export type MarbleAvatarRarity = 'R' | 'SR' | 'SSR' | 'EX';
export type MarbleAvatar = {
  id: string;
  name: string;
  rarity: MarbleAvatarRarity;
  species: string;
  filename: string;
  url: string;
};

export const MARBLE_AVATAR_PUBLIC_PREFIX = '/avatars/marble-collection-v1/';
export const MARBLE_AVATAR_CATALOG: readonly MarbleAvatar[] = catalog as MarbleAvatar[];
export const MARBLE_AVATAR_URLS = MARBLE_AVATAR_CATALOG.map((avatar) => avatar.url);
export const DEFAULT_MARBLE_AVATAR = MARBLE_AVATAR_CATALOG[0];

const byUrl = new Map(MARBLE_AVATAR_CATALOG.map((avatar) => [avatar.url, avatar]));

export function marbleAvatarLabel(url: string): string {
  const avatar = byUrl.get(url);
  return avatar ? `${avatar.rarity} · ${avatar.name}` : '自定义头像';
}
