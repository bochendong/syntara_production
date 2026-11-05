/**
 * One scroll timeline drives the whole landing world. Units are viewport
 * heights of scroll ("u"): the page is TIMELINE_END + 1 screens tall.
 * Chapters are long on purpose so each transition plays out slowly.
 */

export type WorldColor = 'pink' | 'amber' | 'blue' | 'green' | 'purple';

/** Marble color order shared by the shader (aKind) and the DOM. */
export const KIND_ORDER: WorldColor[] = ['pink', 'amber', 'blue', 'green', 'purple'];

export const HERO_END = 1.1;
/** 「很多门课」: the camera drifts across the course sky. */
export const MAP_START = 1.0;
export const MAP_END = 3.0;
/** 「几个 AI 一起帮你」: the helper comets light up. */
export const AGENTS_START = 3.0;
export const AGENTS_END = 4.9;
/** Camera reaches the chapter marble and the lens opens into it. */
export const DIVE_START = 4.9;
export const DIVE_MIX_START = 5.5;
export const DIVE_END = 6.4;
export const FEATURE_START = 6.4;
export const FEATURE_LEN = 2.5;
export const FEATURE_COUNT = 5;
export const CLOSING_START = FEATURE_START + FEATURE_LEN * FEATURE_COUNT;
export const TIMELINE_END = CLOSING_START + 1.5;

/** Index of the memory feature, which fogs the marbles behind its window. */
export const MEMORY_FEATURE = 3;

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const win = (x: number, a: number, b: number) => clamp01((x - a) / (b - a));
export const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export const featureStart = (i: number) => FEATURE_START + i * FEATURE_LEN;

/** Where the rail buttons jump to: a resting point inside each chapter. */
export const RAIL_STOPS = [
  0,
  2.1,
  4.0,
  ...Array.from({ length: FEATURE_COUNT }, (_, i) => featureStart(i) + 1.2),
  CLOSING_START + 1.3,
];

/** Which rail entry the scroll position belongs to. */
export function railIndexAt(u: number) {
  if (u < MAP_START + 0.3) return 0;
  if (u < AGENTS_START) return 1;
  if (u < FEATURE_START) return 2;
  if (u < CLOSING_START)
    return 3 + Math.min(FEATURE_COUNT - 1, Math.floor((u - FEATURE_START) / FEATURE_LEN));
  return 3 + FEATURE_COUNT;
}

/** Visibility windows for the DOM copy, in u. */
export const COPY_WINDOWS = {
  hero: [-1, HERO_END] as const,
  map: [MAP_START + 0.35, MAP_END - 0.1] as const,
  agents: [AGENTS_START + 0.25, AGENTS_END - 0.1] as const,
  feature: (i: number) => [featureStart(i) + 0.55, featureStart(i) + FEATURE_LEN - 0.2] as const,
  closing: [CLOSING_START + 0.6, Infinity] as const,
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

/** The course sky. The first one is the course the camera dives into. */
export const COURSES: { code: string; name: string; note: string; color: WorldColor }[] = [
  { code: 'CSC108', name: '程序设计', note: '286 道题 · 7 章', color: 'purple' },
  { code: 'CSC148', name: '数据结构', note: '298 道题 · 8 本笔记', color: 'blue' },
  { code: 'MAT136', name: '积分学', note: '227 道题 · 3 节课堂', color: 'pink' },
  { code: 'MAT102', name: '数学证明', note: '412 道题', color: 'amber' },
  { code: 'CPSC 110', name: '系统化程序设计', note: 'Racket 代码题', color: 'green' },
  { code: 'CPSC 103', name: '计算机入门', note: 'Python 代码题', color: 'blue' },
  { code: 'MAT137', name: '微积分', note: '证明与计算', color: 'purple' },
  { code: 'STA247', name: '概率论', note: '计算题', color: 'amber' },
  { code: 'MAT223', name: '线性代数', note: '计算与证明', color: 'green' },
  { code: 'ECO101', name: '微观经济学', note: '选择题', color: 'pink' },
  { code: 'PSY100', name: '心理学导论', note: '笔记与选择题', color: 'blue' },
];

/** The helpers that fly between the courses. */
export const AGENTS: { name: string; job: string; color: WorldColor }[] = [
  { name: '笔记助手', job: '把课件整理成笔记', color: 'blue' },
  { name: '讲解助手', job: '把难点做成小课堂', color: 'purple' },
  { name: '出题助手', job: '按章节出练习题', color: 'amber' },
  { name: '批改助手', job: '运行代码、批改步骤', color: 'green' },
  { name: '记忆助手', job: '记下错题和薄弱点', color: 'pink' },
];
