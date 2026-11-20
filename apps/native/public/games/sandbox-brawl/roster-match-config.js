import { ALT, BOSSES, WEAPONS } from './combat-catalog.js';

export const ROSTER_FORMS = ['base', 'evo', 'alt', 'fire', 'ice', 'acid', 'elec'];
export const ROSTER_COMBINATIONS = {
  'fire+fire': '双火', 'ice+ice': '双冰 · 冻结', 'acid+acid': '双酸', 'elec+elec': '双电',
  'fire+ice': '火＋冰', 'fire+acid': '火＋酸', 'fire+elec': '火＋电',
  'ice+acid': '冰＋酸', 'ice+elec': '冰＋电', 'acid+elec': '酸＋电',
};
const elementLabels = { fire: '灼烧', ice: '冰缓', acid: '腐蚀', elec: '感电' };

const studentSides = {
  sweep: 11, spin: 10, mop: 12, pencil: 15, plane: 16, slipper: 17,
  stapler: 17, shotgun: 14, bolt: 17, coffee: 15, sock: 12, rollcall: 14,
  minion: 15, lamp: 19, duck: 22,
};
const monsterSides = {
  sleepy: 9, bat: 10, bomber: 12, chalk: 16, cross: 9, mole: 13, clock: 15,
  ink: 10, ghost: 15, phone: 11, snail: 12, hourglass: 11,
  boss: 36, dean: 56, coach: 34, kraken: 34,
};
const wideForms = {
  sweep: { evo: 15, alt: 24 },
  pencil: { evo: 34, alt: 24 },
  plane: { evo: 24 },
  slipper: { evo: 22 },
  stapler: { evo: 36, alt: 37 },
  shotgun: { alt: 23 },
  bolt: { alt: 27 },
  lamp: { evo: 28 },
  duck: { evo: 31 },
};

const studentPartners = {
  sweep: 'sleepy', spin: 'cross', mop: 'ink', pencil: 'bat', plane: 'ghost',
  slipper: 'clock', stapler: 'phone', shotgun: 'chalk', bolt: 'bat', coffee: 'mole',
  sock: 'snail', rollcall: 'ink', minion: 'cross', lamp: 'ghost', duck: 'clock',
};

export function rosterEncounter(hero, monster) {
  if (hero) return {
    hero, skill: hero.start, monster: studentPartners[hero.start], side: studentSides[hero.start],
  };
  return { hero: null, monster, side: monsterSides[monster], boss: !!BOSSES[monster] };
}

export function rosterStartGap({ hero, monster, boss }) {
  const special = { chalk: 6.4, ghost: 6.2, mole: 4.7, clock: 3.8, bomber: 2.85 };
  return boss ? 7.2 : special[monster] ?? (hero ? 1.1 : 2.25);
}

export function rosterSkillForm(skill, form) {
  if (form === 'alt' && !ALT[skill]) return 'base';
  return ROSTER_FORMS.includes(form) || Object.hasOwn(ROSTER_COMBINATIONS, form) || form === 'guard'
    ? form : 'base';
}

export function rosterSkillElements(form) {
  if (Object.hasOwn(ROSTER_COMBINATIONS, form)) return form.split('+');
  return elementLabels[form] ? [form] : [];
}

export function rosterArenaSide(spec, form) {
  return wideForms[spec.skill]?.[form] ?? spec.side;
}

export function rosterSkillLabel(skill, form) {
  const weapon = WEAPONS[skill];
  if (form === 'evo') return weapon.evo.name;
  if (form === 'alt' && ALT[skill]) return ALT[skill].name;
  if (form === 'guard') return `${weapon.name} · 护盾／闪避`;
  if (ROSTER_COMBINATIONS[form]) return `${weapon.name} · ${ROSTER_COMBINATIONS[form]}`;
  return elementLabels[form] ? `${weapon.name} · ${elementLabels[form]}` : weapon.name;
}

const BOSS_ATTACK_LABELS = {
  stamp: '盖章', rush: '冲撞', slash: '打叉', slam: '重砸', missiles: '追踪导弹',
  summon: '召唤小怪', papers: '卷子雨', shout: '喇叭喊话', pull: '没收',
  lane: '巡逻黄线', shout3: '全体罚站', throw: '躲避球', whistle: '哨声内外圈',
  ticks: '点名', ballrain: '落球雨', inkrain: '墨水雨', flood: '墨水泛滥',
  tent: '触手横扫', leap: '泰山压顶', spiral: '墨水弹幕',
};

export function rosterBossSkillLabel(id, attack) {
  if (id === 'coach' && attack === 'rush') return '折返跑';
  if (id === 'dean' && attack === 'missiles') return '粉笔头';
  return BOSS_ATTACK_LABELS[attack];
}
