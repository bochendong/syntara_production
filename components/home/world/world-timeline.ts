/**
 * One scroll timeline drives the whole landing world. Units are viewport
 * heights of scroll ("u"): the page is TIMELINE_END + 1 screens tall.
 */

export type WorldColor = 'pink' | 'amber' | 'blue' | 'green' | 'purple';

/** Marble color order shared by the shader (aKind) and the DOM. */
export const KIND_ORDER: WorldColor[] = ['pink', 'amber', 'blue', 'green', 'purple'];

export const HERO_END = 0.9;
export const MAP_START = 0.75;
export const MAP_END = 2.35;
/** Camera reaches the chapter marble and the lens opens into it. */
export const DIVE_START = 2.35;
export const DIVE_MIX_START = 2.7;
export const DIVE_END = 3.3;
export const FEATURE_START = 3.3;
export const FEATURE_LEN = 1.7;
export const FEATURE_COUNT = 5;
export const CLOSING_START = FEATURE_START + FEATURE_LEN * FEATURE_COUNT;
export const TIMELINE_END = CLOSING_START + 1.3;

/** Index of the memory feature, which runs the fog / revive demo. */
export const MEMORY_FEATURE = 3;

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const win = (x: number, a: number, b: number) => clamp01((x - a) / (b - a));
export const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export const featureStart = (i: number) => FEATURE_START + i * FEATURE_LEN;

/** Where the rail buttons jump to: a resting point inside each chapter. */
export const RAIL_STOPS = [
  0,
  1.5,
  ...Array.from({ length: FEATURE_COUNT }, (_, i) => featureStart(i) + 0.75),
  CLOSING_START + 1.1,
];

/** Which rail entry the scroll position belongs to. */
export function railIndexAt(u: number) {
  if (u < MAP_START + 0.2) return 0;
  if (u < FEATURE_START) return 1;
  if (u < CLOSING_START)
    return 2 + Math.min(FEATURE_COUNT - 1, Math.floor((u - FEATURE_START) / FEATURE_LEN));
  return 2 + FEATURE_COUNT;
}

/** Visibility windows for the DOM copy, in u. */
export const COPY_WINDOWS = {
  hero: [-1, HERO_END] as const,
  map: [MAP_START + 0.35, MAP_END - 0.05] as const,
  feature: (i: number) => [featureStart(i) + 0.35, featureStart(i) + FEATURE_LEN - 0.15] as const,
  closing: [CLOSING_START + 0.45, Infinity] as const,
};

export const COURSE_NAME = 'CSC108';
export const CHAPTERS = [
  '列表与循环',
  '字典',
  '函数设计',
  '递归',
  '复杂度',
  '测试与调试',
  '类与对象',
];
