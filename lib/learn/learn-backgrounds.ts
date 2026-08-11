export type LearnBackground = {
  id: string;
  name: string;
  description: string;
  tone: 'light' | 'dark';
  imageUrl: string;
  previewUrl: string;
};

export const LEARN_BACKGROUNDS = [
  {
    id: 'cloud-kingdom',
    name: '云上王国',
    description: '明亮、轻盈的蓝粉天空',
    imageUrl: '/background/cloud-kingdom.webp',
    previewUrl: '/background/previews/cloud-kingdom.webp',
    tone: 'light',
  },
  {
    id: 'sunrise-lake',
    name: '晨光湖畔',
    description: '安静柔和的山湖日出',
    imageUrl: '/background/sunrise-lake.webp',
    previewUrl: '/background/previews/sunrise-lake.webp',
    tone: 'light',
  },
  {
    id: 'twilight-city',
    name: '暮色海湾',
    description: '粉紫晚霞下的滨水城市',
    imageUrl: '/background/twilight-city.webp',
    previewUrl: '/background/previews/twilight-city.webp',
    tone: 'light',
  },
  {
    id: 'coral-waves',
    name: '珊瑚流光',
    description: '温暖克制的抽象流线',
    imageUrl: '/background/coral-waves.webp',
    previewUrl: '/background/previews/coral-waves.webp',
    tone: 'light',
  },
  {
    id: 'cosmic-nebula',
    name: '星河云海',
    description: '深蓝与紫色交织的星空',
    imageUrl: '/background/cosmic-nebula.webp',
    previewUrl: '/background/previews/cosmic-nebula.webp',
    tone: 'dark',
  },
  {
    id: 'neon-metropolis',
    name: '霓虹新城',
    description: '蓝紫色未来都市夜景',
    imageUrl: '/background/neon-metropolis.webp',
    previewUrl: '/background/previews/neon-metropolis.webp',
    tone: 'dark',
  },
] as const satisfies readonly LearnBackground[];

export type LearnBackgroundId = (typeof LEARN_BACKGROUNDS)[number]['id'];

export const DEFAULT_LEARN_BACKGROUND_ID: LearnBackgroundId = 'coral-waves';

export function isLearnBackgroundId(value: unknown): value is LearnBackgroundId {
  return LEARN_BACKGROUNDS.some((background) => background.id === value);
}

export function getLearnBackground(value: unknown): (typeof LEARN_BACKGROUNDS)[number] {
  return (
    LEARN_BACKGROUNDS.find((background) => background.id === value) ||
    LEARN_BACKGROUNDS.find((background) => background.id === DEFAULT_LEARN_BACKGROUND_ID)!
  );
}
