import catalog from './cards.json';
export type CardRarity = 'R' | 'SR' | 'SSR';
export type CardSeries = 'everyday' | 'mbti' | 'zodiac' | 'dream' | 'city';
export type StudyCard = {
  id: string;
  name: string;
  series: CardSeries;
  rarity: CardRarity;
  caption: string;
  credit?: string;
  art: string;
  index: number;
  artColumns?: number;
  artRows?: number;
};
export const CARD_FINISHES: Record<CardRarity, { name: string; description: string }> = {
  R: { name: '日常画卡', description: '平面插画 · 哑光纸感' },
  SR: { name: '精绘珍藏', description: '细腻线稿 · 层叠光影' },
  SSR: { name: '浮雕典藏', description: '立体鎏金 · 珐琅宝石光泽' },
};
export const STUDY_CARDS = catalog as StudyCard[];
export const CARD_SERIES: { id: CardSeries; name: string; en: string; description: string }[] = [
  {
    id: 'everyday',
    name: '日常微光',
    en: 'EVERYDAY LIGHT',
    description: '那些认真生活的小小瞬间。',
  },
  {
    id: 'mbti',
    name: '内心宇宙',
    en: 'INNER UNIVERSE',
    description: '十六种想象，十六个独特的你。',
  },
  {
    id: 'zodiac',
    name: '星轨来信',
    en: 'LETTERS FROM STARS',
    description: '十二星座，写给夜空的浪漫。',
  },
  {
    id: 'dream',
    name: '梦游动物',
    en: 'DREAM COMPANIONS',
    description: '跟着小动物，走进柔软的梦。',
  },
  { id: 'city', name: '城市夜行', en: 'AFTER HOURS', description: '末班车之后，城市开始做梦。' },
];
export const CARD_RULES = {
  questionsPerDraw: 5,
  rates: { R: 75, SR: 22, SSR: 3 },
  srPity: 10,
  ssrPity: 30,
} as const;
export function cardLevel(copies: number) {
  return [1, 2, 4, 7, 11].filter((n) => copies >= n).length;
}
export function collectorLevel(unique: number) {
  const levels = [
    { min: 0, name: '初遇收藏家' },
    { min: 5, name: '微光拾取者' },
    { min: 15, name: '故事旅行家' },
    { min: 30, name: '星轨漫游者' },
    { min: 60, name: '典藏守护者' },
  ];
  return {
    level: levels.filter((l) => unique >= l.min).length,
    ...[...levels].reverse().find((l) => unique >= l.min)!,
  };
}
/** Pure rarity policy; randomness is supplied only by the authenticated server. */
export function rollStudyCard(
  sinceSR: number,
  sinceSSR: number,
  rarityRoll: number,
  cardRoll: number,
) {
  if (![rarityRoll, cardRoll].every((n) => Number.isFinite(n) && n >= 0 && n < 1))
    throw new Error('Invalid random input');
  const rarity: CardRarity =
    sinceSSR >= CARD_RULES.ssrPity - 1 || rarityRoll < 0.03
      ? 'SSR'
      : sinceSR >= CARD_RULES.srPity - 1 || rarityRoll < 0.25
        ? 'SR'
        : 'R';
  const pool = STUDY_CARDS.filter((card) => card.rarity === rarity);
  return {
    card: pool[Math.floor(cardRoll * pool.length)],
    sinceSR: rarity === 'R' ? sinceSR + 1 : 0,
    sinceSSR: rarity === 'SSR' ? 0 : sinceSSR + 1,
  };
}
export type CardCollection = {
  owned: Record<string, number>;
  favorites: string[];
  totalDraws: number;
  sinceSR: number;
  sinceSSR: number;
  passedQuestions: number;
  availableDraws: number;
  nextDrawProgress: number;
};
export type CardDraw = {
  id: string;
  cardId: string;
  copies: number;
  isNew: boolean;
  rarity: CardRarity;
};
export type CardDrawResponse = { collection: CardCollection; draw: CardDraw };
