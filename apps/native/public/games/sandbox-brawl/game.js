import { DEATH_TAUNTS } from './death-taunts.js';
import * as THREE from './vendor/three.module.js';
import { EffectComposer } from './vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from './vendor/addons/postprocessing/ShaderPass.js';
import { OutputPass } from './vendor/addons/postprocessing/OutputPass.js';

const $ = (id) => document.getElementById(id);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const skillDemoMode = window.parent !== window && new URLSearchParams(location.search).has('skill-demo');
const HX = 40, HZ = 34, CORR = 5, WT = 1.2, HALF = 34, RCX = 20.3, RCZ = 19.8, TX = -20.3, TZ = -19.8, PI = Math.PI, HP_ = PI / 2, TAU = PI * 2;
const AZ = PI / 4; // 斜 45° 俯视

/* ================= 数据 ================= */
const TAGS = {
  melee:  { name: '近战', c: '#e0473c' },
  ranged: { name: '远程', c: '#3f97e8' },
  gun:    { name: '枪械', c: '#9aa3b5' },
  magic:  { name: '魔法', c: '#a46bff' },
  summon: { name: '召唤', c: '#f0a623' },
};
// 流派羁绊：武器 + 饰品凑齐 2 / 4 / 6 个同系
const SETS = {
  melee:  ['近战命中回一点血，每秒最多 0.8', '挥砍外圈再炸一圈冲击波', '无双：挥砍冷却减半，移速 +20%'],
  ranged: ['所有远程投射物穿透 +1', '投射物第一次命中后一分为二', '弹射：投射物会在怪之间再弹 3 次，数量 +1'],
  gun:    ['枪械冷却 -20%', '暴击引发小爆炸', '弹幕：每 1.2 秒向四周扫射一圈订书钉'],
  magic:  ['魔法命中会点燃敌人', '燃烧的怪死掉时把火传给周围', '天雷：每 0.5 秒落下一道雷'],
  summon: ['召唤物 +1', '召唤物攻击带溅射，台灯光束穿透', '大军：召唤物数量翻倍，伤害 +50%'],
};
const CLASSES = {
  brawler:  { name: '体育委员', tag: 'melee',  hp: 150, spd: 5.7, start: 'sweep',   desc: '血厚腿长，原地抡一圈大尺子，周围全砍', look: { style: 'spiky', outfit: 'track', skin: 0xf2c49a, hair: 0x2b1d18, top: 0xd8423a, pants: 0x2b3a5c, iris: 0x7a3a22, item: 'bat', band: 0xffffff, big: true } },
  geo:      { name: '数学课代表', short: '课代表', tag: 'melee', hp: 120, spd: 5.4, start: 'spin', desc: '三角尺绕着自己转，站着不动也在算账', look: { style: 'bob', outfit: 'vest', hair: 0x3a2a20, top: 0xfaf8f2, pants: 0x4a5568, iris: 0x4a6a8a, accent: 0x3f7ad8, item: 'tri', glasses: true } },
  duty:     { name: '值日生',   tag: 'melee',  hp: 130, spd: 5.5, start: 'mop',     desc: '拖把一拖一大片，地板湿了怪就打滑', look: { style: 'bun', outfit: 'apron', girl: true, hair: 0x6a4630, top: 0x7cc8e8, pants: 0x3a6a9a, iris: 0x3a8ab8, accent: 0xffffff, scarf: 0xff8fa8, item: 'mop' } },
  scholar:  { name: '学霸',     tag: 'ranged', hp: 95,  spd: 5.3, start: 'pencil',  desc: '铅笔百发百中，开局暴击率 12%，基础攻速和伤害各低 20%', crit: 0.07, baseDmg: -0.20, baseAtkSpd: -0.20, look: { style: 'long', outfit: 'sailor', girl: true, hair: 0x1e1a2e, top: 0xfaf8f2, pants: 0x2c3a6e, iris: 0x3a6ad8, accent: 0xe2453a, item: 'pencil', glasses: true } },
  paper:    { name: '后排同学', tag: 'ranged', hp: 100, spd: 5.8, start: 'plane',   desc: '上课折的纸飞机会自己追怪，跑得还最快', look: { style: 'messy', outfit: 'hoodie', hair: 0x4a3426, top: 0x38b2c9, pants: 0x3a3f4a, iris: 0x2a8aa0, accent: 0xffffff, cap: 0xf2f2f2, item: 'plane' } },
  dorm:     { name: '住校生',   tag: 'ranged', hp: 115, spd: 5.2, start: 'slipper', desc: '穿着睡衣就来了，拖鞋扔出去还会飞回来', look: { style: 'bun2', outfit: 'pajama', girl: true, hair: 0xe8a0b8, top: 0xffd9e4, pants: 0xffd9e4, iris: 0xd85a8a, accent: 0xff7a5a, mask: 0x8a7ad8, item: 'slipper' } },
  engineer: { name: '理科生',   tag: 'gun',    hp: 110, spd: 5.2, start: 'stapler', desc: '订书机枪高速连发，越升级射得越快', look: { style: 'messy', outfit: 'labcoat', hair: 0x2e3a48, top: 0x3faa6a, pants: 0x34495e, iris: 0x2a8a6a, item: 'gun', goggles: true } },
  artist:   { name: '美术生',   tag: 'gun',    hp: 100, spd: 5.3, start: 'shotgun', desc: '橡皮屑一喷一大片，贴脸最疼', look: { style: 'pony', outfit: 'apron', girl: true, hair: 0xd8503a, top: 0xfaf8f2, pants: 0x3a3a4a, iris: 0x2aa88a, accent: 0xffd23f, beret: 0x2a2a3a, paint: true, item: 'blaster' } },
  poet:     { name: '文科生',   tag: 'magic',  hp: 90,  spd: 5.1, start: 'bolt',    desc: '荧光笔召来连锁闪电，打一大片', look: { style: 'wavy', outfit: 'cardigan', girl: true, hair: 0xc9a8f0, top: 0xb69cff, pants: 0x5a4a9a, iris: 0x9a5ae0, accent: 0xff8fb8, item: 'wand', beret: 0x6a3ad0, flower: true } },
  owl:      { name: '夜猫子',   tag: 'magic',  hp: 100, spd: 5.0, start: 'coffee',  desc: '咖啡不离手，扔出去就是一个旋风，又伤又减速', look: { style: 'messy', outfit: 'hoodie', hair: 0x24202e, top: 0x6a4a3a, pants: 0x2e2a36, iris: 0xb8742a, accent: 0xf5e6c8, tired: true, item: 'mug' } },
  jock:     { name: '体育生',   tag: 'magic',  hp: 140, spd: 5.6, start: 'sock',    desc: '训练完没换袜子，怪一靠近就被熏到', look: { style: 'buzz', outfit: 'jersey', skin: 0xe8b88a, hair: 0x2a2a2a, top: 0x5fb04f, pants: 0xffffff, iris: 0x3a5a2a, band2: 0xff5f5f, item: 'sock', big: true } },
  monitor:  { name: '班长',     tag: 'magic',  hp: 105, spd: 5.2, start: 'rollcall', desc: '点到谁谁倒霉，专挑血最厚的砸', look: { style: 'pony', outfit: 'sailor', girl: true, hair: 0x3a2618, top: 0xfaf8f2, pants: 0x8a2a3a, iris: 0xb83a4a, accent: 0xffc93c, armband: 0xe2453a, item: 'book' } },
  captain:  { name: '社团长',   tag: 'summon', hp: 105, spd: 5.4, start: 'minion',  desc: '招一群便利贴小人替你冲，基础攻速低 15%，开局暴击率 3%', crit: -0.02, baseAtkSpd: -0.15, look: { style: 'twin', outfit: 'cheer', girl: true, hair: 0xf08a3a, top: 0xffb22a, pants: 0xffffff, iris: 0xe0602a, accent: 0xff5f9e, item: 'flag' } },
  techie:   { name: '电教委员', tag: 'summon', hp: 100, spd: 5.2, start: 'lamp',    desc: '放下台灯就是炮台，基础攻速低 20%，开局暴击率 2%', crit: -0.03, baseAtkSpd: -0.20, look: { style: 'bob', outfit: 'hoodie', hair: 0x5a6a7a, top: 0xffd84d, pants: 0x3a4658, iris: 0xc89a00, accent: 0x3a3f4a, phones: 0x3a3f4a, item: 'lamp' } },
  swimmer:  { name: '游泳队员', tag: 'summon', hp: 115, spd: 5.5, start: 'duck',    desc: '带着橡皮鸭下水，怪全被鸭子引走', look: { style: 'pony', outfit: 'track', girl: true, hair: 0x2a4a6a, top: 0x4aa8ff, pants: 0x2a3a6a, iris: 0x2a8ad8, accent: 0xffd23f, swimcap: 0xffffff, goggles2: true, item: 'duck' } },
};
const isOpen = (id) => meta.heroes.includes(id);
const WEAPONS = {
  sweep:    { name: '尺子挥砍',   tag: 'melee',  c: '#e0473c', ch: '砍', ups: ['lv'],       desc: '朝最近的怪挥出一大片扇形，击退很强', evo: { relic: 'dumbbell', name: '旋风斩', desc: '变成原地抡整圈，每 0.3 秒转一圈，范围 ×1.5，还会把怪往里吸' } },
  spin:     { name: '尺子回旋',   tag: 'melee',  c: '#f08a24', ch: '旋', ups: ['lv'],          nText: '多一把尺子绕着转', desc: '几把尺子一直绕着你转，不用瞄准，贴身持续伤害', evo: { relic: 'wrist', name: '尺阵', desc: '尺子翻倍，转得更大更快' } },
  mop:      { name: '拖把',       tag: 'melee',  c: '#4aa8c8', ch: '拖', ups: ['lv'],       funny: 1, desc: '朝前一拖一大片，地上留下水渍，踩进去的怪减速并持续掉血。擦地任务擦得飞快', evo: { relic: 'bucket', name: '洪水拖把', desc: '水渍变成大水洼，范围更大，伤害 2.5 倍' } },
  pencil:   { name: '铅笔飞镖',   tag: 'ranged', c: '#3f97e8', ch: '铅', ups: ['lv'], nText: '每次多射一支', desc: '射出会穿透的铅笔，一条直线清一排', evo: { relic: 'scratch', name: '铅笔暴雨', desc: '每次出手额外向四周射出 10 支铅笔' } },
  plane:    { name: '纸飞机',     tag: 'ranged', c: '#38b2c9', ch: '纸', ups: ['lv'],          nText: '每次多一架', desc: '会自己拐弯追怪，边跑边打最省心', evo: { relic: 'scope', name: '纸鹤群', desc: '数量 +3，命中不消失，能连穿 4 只' } },
  slipper:  { name: '妈妈的拖鞋', tag: 'ranged', c: '#ff7a5a', ch: '鞋', ups: ['lv'],          nText: '每次多扔一只', funny: 1, desc: '扔出去还会飞回来，来回各打一次，击退超远', evo: { relic: 'mom', name: '拖鞋连环', desc: '拖鞋飞到头时再分出两只' } },
  stapler:  { name: '订书机枪',   tag: 'gun',    c: '#7a8394', ch: '钉', ups: ['lv'],          nText: '并排多射一发', desc: '高速连发，单体输出最高', evo: { relic: 'dual', name: '钉枪风暴', desc: '再加四道旋转弹流，扫遍全场' } },
  shotgun:  { name: '橡皮霰弹',   tag: 'gun',    c: '#e05a8a', ch: '霰', ups: ['lv'],          nText: '一次多喷两块', desc: '贴脸喷一扇橡皮块，近身爆发加击退', evo: { relic: 'reddot', name: '橡皮加农', desc: '每颗橡皮命中都会爆炸' } },
  bolt:     { name: '荧光闪电',   tag: 'magic',  c: '#a46bff', ch: '电', ups: ['lv'],          nText: '多跳 2 次', desc: '闪电在怪之间来回跳，专打扎堆的', evo: { relic: 'ink', name: '荧光雷暴', desc: '跳 14 次，每一跳还会电到旁边的怪' } },
  coffee:   { name: '咖啡旋风',   tag: 'magic',  c: '#8a5a2b', ch: '咖', ups: ['lv'],       desc: '自动朝最近的怪扔一杯咖啡，落地变成旋风，持续伤害并减速', evo: { relic: 'caffeine', name: '咖啡龙卷', desc: '冷却减半，旋风更大更久，还会把怪往中心吸' } },
  sock:     { name: '臭袜子',     tag: 'magic',  c: '#8ab84a', ch: '袜', ups: ['lv'],       funny: 1, desc: '身边一直飘着一圈臭气，怪进来就掉血还变慢', evo: { relic: 'laundry', name: '生化危机', desc: '臭气范围 ×1.6，熏到的怪受到的所有伤害 +25%' } },
  rollcall: { name: '点名册',     tag: 'magic',  c: '#c84a4a', ch: '点', ups: ['lv'],          nText: '每次多点一个', funny: 1, desc: '专挑血最厚的怪点名，一本书砸下去。打精英和大魔王伤害翻倍', evo: { relic: 'redpen', name: '全班点名', desc: '一次点 5 个，书落地还有冲击波' } },
  minion:   { name: '便利贴小人', tag: 'summon', c: '#f0a623', ch: '贴', ups: ['lv'],     nText: '每次多召一个', desc: '召唤冲上去打架的小人，到时间就散掉', evo: { relic: 'poster', name: '便利贴军团', desc: '每次召唤数量翻倍，小人击杀时再分裂出一个' } },
  lamp:     { name: '台灯炮台',   tag: 'summon', c: '#d4a000', ch: '灯', ups: ['lv'],     nText: '每次多放一盏', desc: '放下会自动射光束的台灯，原地守点', evo: { relic: 'banner', name: '探照灯', desc: '光束变成一整条，直线上的怪全中' } },
  duck:     { name: '橡皮鸭',     tag: 'summon', c: '#ffd23f', ch: '鸭', ups: ['lv'],     nText: '每次多放一只', funny: 1, desc: '嘎嘎叫，把附近的怪全引过去，时间到了炸成彩带', evo: { relic: 'bath', name: '鸭鸭大军', desc: '每次放 3 倍数量，爆炸范围翻倍' } },
};
// 饰品：每件效果都很小，同一件可以一直叠。r = 稀有度（0 普通 / 1 稀有 / 2 传奇），curse = 有代价
const RELICS = {
  wrist:    { name: '护腕',       tag: 'melee',  r: 0, desc: '近战伤害 +8%' },
  drink:    { name: '运动饮料',   tag: 'melee',  r: 0, desc: '生命上限 +10，每秒多回 0.05 血' },
  dumbbell: { name: '哑铃',       tag: 'melee',  r: 0, desc: '近战范围 +8%' },
  bucket:   { name: '水桶',       tag: 'melee',  r: 0, desc: '近战范围 +5%，水渍多留 1 秒' },
  sharpener:{ name: '削笔刀',     tag: 'ranged', r: 1, desc: '远程穿透 +1' },
  scratch:  { name: '草稿纸',     tag: 'ranged', r: 2, desc: '铅笔、纸飞机、拖鞋数量 +1' },
  scope:    { name: '望远镜',     tag: 'ranged', r: 1, desc: '暴击率 +5%，暴击伤害 +20%' },
  mom:      { name: '妈妈的怒吼', tag: 'ranged', r: 0, desc: '所有击退 +15%' },
  mag:      { name: '大弹匣',     tag: 'gun',    r: 0, desc: '枪械冷却 -7%' },
  dual:     { name: '双持',       tag: 'gun',    r: 2, desc: '订书机枪一次多射一发' },
  reddot:   { name: '红点瞄具',   tag: 'gun',    r: 0, desc: '枪械暴击率 +5%' },
  caffeine: { name: '咖啡因',     tag: 'magic',  r: 0, desc: '魔法冷却 -7%' },
  ink:      { name: '荧光墨水',   tag: 'magic',  r: 1, desc: '魔法范围 +10%，闪电多跳 1 次' },
  grimoire: { name: '魔导笔记',   tag: 'magic',  r: 1, desc: '燃烧伤害 +35%' },
  laundry:  { name: '脏衣篮',     tag: 'magic',  r: 0, desc: '臭气、旋风、燃烧这些持续伤害 +10%' },
  redpen:   { name: '红笔',       tag: 'magic',  r: 0, desc: '对精英和大魔王伤害 +10%' },
  poster:   { name: '招新海报',   tag: 'summon', r: 2, desc: '每次多召唤一个' },
  snack:    { name: '团建零食',   tag: 'summon', r: 0, desc: '召唤物伤害 +10%' },
  banner:   { name: '加油横幅',   tag: 'summon', r: 0, desc: '召唤物攻速 +10%' },
  bath:     { name: '浴缸',       tag: 'summon', r: 0, desc: '召唤物存在时间 +10%' },
  allnight: { name: '通宵',       tag: '', curse: 1, desc: '所有伤害 +15%，生命上限 -10%' },
  slack:    { name: '摸鱼',       tag: '', curse: 1, desc: '移速 +10%，拾取范围 +20%，伤害 -4%' },
  glass:    { name: '玻璃心',     tag: '', curse: 1, desc: '暴击伤害 +50%，生命上限 -15%' },
  bonusStamp: { name: '加分印章', tag: '', r: 0, icon: 'redpen', pointsRate: 10, desc: '结算积分 +10%，每件叠加' },
  mealVoucher: { name: '食堂饭票', tag: '', r: 1, icon: 'snack', pointsFlat: 3, desc: '结算额外获得 3 积分，每件叠加' },
};
const RAR = [['普通', '#b9ad98', 'q0'], ['稀有', '#3fae5a', 'rare'], ['传奇', '#e0473c', 'legend']], RAR3 = [0xf2ead8, 0x5fd07a, 0xff5a4a];
const rarOf = (id) => (RELICS[id].curse ? { n: '代价', c: '#4a6ad8', k: 'curse' } : { n: RAR[RELICS[id].r][0], c: RAR[RELICS[id].r][1], k: RAR[RELICS[id].r][2] });
// 按稀有度抽一件解锁过的饰品。w = [普通, 稀有, 传奇] 的权重，curse = 抽到代价饰品的概率
function rollRelic(w, curse = 0, skip = []) {
  const open = Object.keys(RELICS).filter((id) => meta.relics.includes(id) && !skip.includes(id));
  const cur = open.filter((id) => RELICS[id].curse); if (cur.length && Math.random() < curse) return cur[(Math.random() * cur.length) | 0];
  for (let t = 0; t < 4; t++) { let r = Math.random() * (w[0] + w[1] + w[2]), k = 0; while ((r -= w[k]) > 0 && k < 2) k++; const p = open.filter((id) => !RELICS[id].curse && RELICS[id].r === k); if (p.length) return p[(Math.random() * p.length) | 0]; }
  const p = open.filter((id) => !RELICS[id].curse); return p.length ? p[(Math.random() * p.length) | 0] : null;
}
const DUOS = {
  zapcafe:  { a: 'coffee', b: 'bolt',     name: '电咖啡',   desc: '咖啡旋风会不停电里面的怪' },
  parry:    { a: 'sweep',  b: 'shotgun',  name: '弹反尺',   desc: '每次挥砍向四周弹出 8 块橡皮' },
  binder:   { a: 'minion', b: 'stapler',  name: '装订小队', desc: '便利贴小人也会远程射订书钉' },
  harbor:   { a: 'lamp',   b: 'plane',    name: '灯塔航线', desc: '台灯每 1.5 秒放出一架纸飞机' },
  boomer:   { a: 'spin',   b: 'pencil',   name: '回旋铅笔', desc: '尺子砍中怪时顺手甩出一支铅笔' },
  cleanup:  { a: 'mop',    b: 'sock',     name: '大扫除',   desc: '湿地板也冒臭气，踩上去的怪持续掉血' },
  quack:    { a: 'duck',   b: 'rollcall', name: '点名鸭',   desc: '橡皮鸭爆炸时，顺便把附近血最厚的怪点名' },
};
const MAXW = 4, EVO_L = 6, SKILL_LV = [4, 8, 12];
// 元素注入：技能 4 / 8 级各选一次，两次的元素会组合
const ELEMS = {
  fire: { name: '火', c: '#ff6a2a', desc: '命中后灼烧 3 秒，持续掉血' },
  ice:  { name: '冰', c: '#4ab8ee', desc: '命中后减速' },
  acid: { name: '酸', c: '#7ab82e', desc: '命中后 4 秒内，怪受到的所有伤害 +25%' },
  elec: { name: '电', c: '#2f86f0', desc: '25% 概率把伤害传导给旁边一只怪' },
};
const COMBOS = {
  'fire+fire': ['烈焰', '灼烧伤害大幅提高，烧着的怪死掉会爆炸'],
  'ice+ice':   ['冻伤', '附加冻伤持续掉血，15% 概率直接冻住'],
  'acid+acid': ['强酸', '伤害加深提高到 +50%，怪死后酸液溅到周围'],
  'elec+elec': ['雷暴', '传导概率 50%，连跳 3 只'],
  'elec+fire': ['导火索', '电流把灼烧一起传过去，连跳 2 只'],
  'fire+ice':  ['蒸汽爆', '20% 概率炸出一团蒸汽，伤到一小片'],
  'acid+fire': ['毒焰', '灼烧伤害翻倍，烧着的怪死掉把火传给周围'],
  'elec+ice':  ['超导', '被电到的怪会冻住 0.6 秒'],
  'acid+ice':  ['脆化', '怪变脆：更容易被暴击，死掉时碎裂伤到周围'],
  'acid+elec': ['腐蚀电流', '传导伤害提高到 100%，并带上酸'],
};
// 地图遗物：在地图上找到祭台，三选一
const ARTS = {
  vamp:   { name: '吸血红笔',   c: '#e0473c', ic: 'curse',   desc: '暴击吸血：每次暴击回复伤害的 2%，单次最多 3 点' },
  mirror: { name: '反光镜',     c: '#38b2c9', ic: 's_dodge', desc: '闪避成功时，回复等同于这次伤害的血，单次最多生命上限的 15%' },
  plate:  { name: '铁饭盒',     c: '#7a8394', ic: 's_armor', desc: '护甲 +3。每 1 点护甲让基础伤害 +1%' },
  koi:    { name: '锦鲤挂件',   c: '#ff6fa8', ic: 's_luck',  desc: '升级时每抽到一张普通属性卡，幸运 +1%，最多 +10%' },
  thorn:  { name: '仙人掌盆栽', c: '#5fb04f', ic: 'sparkle', desc: '受伤时把 3 倍伤害反弹给身边的怪' },
  watch:  { name: '停走的怀表', c: '#a46bff', ic: 'watch',   desc: '每 12 秒时间暂停 1.5 秒，小怪全部定住' },
  copier: { name: '复印机',     c: '#3f97e8', ic: 'link',    desc: '每次攻击有 20% 概率马上再来一次' },
  grant:  { name: '奖学金',     c: '#ffab2e', ic: 'star',    desc: '经验 +30%，拾取范围 +50%' },
  last:   { name: '最后一搏',   c: '#ff7a3a', ic: 's_dmg',   desc: '生命低于 35% 时，伤害 +60%' },
  bubble: { name: '橡皮护盾',   c: '#4ab8ee', ic: 'bubble',  desc: '每 10 秒获得一层护盾，挡掉一次伤害' },
  judge:  { name: '红叉判官',   c: '#c84a4a', ic: 'target',  desc: '小怪血量低于 15% 时直接打倒' },
  fourth: { name: '第四个选项', c: '#3fc98a', ic: 'plus',    desc: '升级时多一张卡可选' },
  honorRoll: { name: '荣誉证书', c: '#ed9b32', icon: 'grant', pointsRate: 25, desc: '结算积分 +25%' },
  finalVoucher: { name: '通关奖券', c: '#4aa8ff', icon: 'fourth', pointsWin: 12, desc: '通关时额外获得 12 积分' },
};
const MON_INFO = {
  cross: ['小红叉', '跑得快，喜欢成群包围'], bomber: ['自爆闹钟', '靠近 1.5 秒后爆炸，会炸到旁边的怪，还会连锁'], chalk: ['粉笔射手', '站在远处瞄准你，看到红线就横着走'],
  mole: ['钻地鼹鼠', '靠近后钻地冲过来再跳出来顶你。跳出来会晕一会，趁这时候打它'], clock: ['闹钟仔', '响完铃会猛冲过来'], ink: ['墨水史莱姆', '打死会分裂成两只'],
  ghost: ['纸团幽灵', '飘在空中扔纸团'], phone: ['手机精', '靠近会让你分心变慢'], snail: ['拖延蜗牛', '又慢又肉，一路留黏液'],
};
// 每分钟一个事件，下标是第几分钟
const TIMELINE = [null, ['mon', 'bomber'], ['mon', 'chalk'], ['task'], ['mon', 'cross'], ['relic'], ['mon', 'mole'], ['task'], ['mon', 'clock'], ['relic'], ['elite'], ['mon', 'ink'], ['relic'], ['mon', 'ghost'], ['task'], ['mon', 'phone'], ['relic'], ['mon', 'snail'], ['task'], ['rush']];
const EV_NAME = { mon: '新怪物', task: '新任务', relic: '遗物', elite: '期中考', rush: '考前冲刺' };
// 每把武器自己的升级项
const UPS = {
  dmg:    { name: '伤害', fl: '更痛', desc: '伤害 +25%',          max: 6 },
  rate:   { name: '攻击速度', fl: '更快', desc: '攻速 +20%',          max: 5 },
  area:   { name: '攻击范围', fl: '范围更大', desc: '范围 +18%',          max: 5 },
  n:      { name: '数量', fl: '数量更多', desc: '',                   max: 3 },
  pierce: { name: '穿透', fl: '多穿一只', desc: '每支多穿一只怪',     max: 3 },
  cd:     { name: '召唤冷却', fl: '召唤更快', desc: '召唤冷却 -15%',      max: 4 },
  dur:    { name: '存在时间', fl: '待得更久', desc: '召唤物存在时间 +30%', max: 4 },
  lv:     { name: '升级', fl: '', desc: '', max: 9 },
};
const WBASE = {
  sweep:    { cd: 1.0, dmg: 22, range: 2.6 },
  spin:     { n: 2, dmg: 10, spin: 3, rad: 2.5 },
  mop:      { cd: 0.9, dmg: 16, range: 3.2 },
  pencil:   { cd: 0.7, n: 1, dmg: 12, pierce: 1 },
  plane:    { cd: 1.2, n: 1, dmg: 18 },
  slipper:  { cd: 1.3, n: 1, dmg: 22 },
  stapler:  { cd: 0.2, n: 1, dmg: 6 },
  shotgun:  { cd: 1.2, n: 5, dmg: 9 },
  bolt:     { cd: 1.4, n: 3, dmg: 16 },
  coffee:   { cd: 3.0, rad: 2.5, dmg: 10 },
  sock:     { cd: 0.5, rad: 2.2, dmg: 5 },
  rollcall: { cd: 4, n: 1, dmg: 110 },
  minion:   { cd: 4.5, n: 2, dmg: 8, atk: 0.55, dur: 8 },
  lamp:     { cd: 7, n: 1, dmg: 14, atk: 0.9, dur: 10 },
  duck:     { cd: 8, n: 1, dmg: 40, dur: 5 },
};
// 技能升级：每升一级只加一样东西。Lv 4 和 Lv 8 注入元素，Lv 10 变成终极形态
const LVUP = {
  sweep: ['dmg', 0.3, '伤害 +30%'], spin: ['n', 1, '多一把尺子'], mop: ['dmg', 0.3, '伤害 +30%'], pencil: ['n', 1, '多射一支铅笔'], plane: ['n', 1, '多一架纸飞机'], slipper: ['n', 1, '多扔一只拖鞋'],
  stapler: ['rate', 0.15, '射速 +15%'], shotgun: ['n', 1, '多喷一块橡皮'], bolt: ['n', 1, '闪电多跳一次'], coffee: ['dmg', 0.3, '伤害 +30%'], sock: ['area', 0.1, '臭气范围 +10%'], rollcall: ['dmg', 0.3, '伤害 +30%'],
  minion: ['n', 1, '多召一个小人'], lamp: ['rate', 0.15, '台灯射速 +15%'], duck: ['dmg', 0.3, '爆炸伤害 +30%'],
};
const MAXLV = 10, INF_LV = [4, 8];
// 特殊升级：只能靠完成地图任务开宝箱拿到，每个技能 8 种
const G = { big: '范围 +30%', cd: '冷却 -25%', twice: '25% 概率马上再放一次', crit: '这个技能的暴击率 +20%', exec: '对血量低于 30% 的怪伤害 +80%', first: '对满血的怪伤害 +60%', kb: '击退翻倍', stun: '命中有 15% 概率把怪打晕 0.8 秒', mark: '打中的怪 3 秒内受到的所有伤害 +25%', elite: '对精英和大魔王伤害 +60%', boom: '用它打倒的怪会爆炸，伤到周围', leech: '用它打倒怪有 8% 概率回 2 点血', gem: '用它打倒的怪 20% 多掉一颗经验', long: '存在时间 +50%' };
const SP = {
  sweep:    [['wave', '剑气', '每次挥砍向前甩出一道会穿透的气刃'], ['again', '二连斩', '挥完马上再挥一次，第二下伤害 60%'], ['block', '格挡', '挥砍会打掉范围内的粉笔和子弹'], ['big', '加长尺'], ['kb', '一尺拍飞'], ['exec', '收卷'], ['crit', '划重点'], ['leech', '越打越精神']],
  spin:     [['fast', '加速', '尺子转速 +40%'], ['outer', '双圈', '一半尺子绕到外圈，打得更远'], ['fling', '甩尺', '每 4 秒所有尺子向外甩一下再收回来'], ['big', '大三角尺', '绕圈半径 +30%'], ['stun', '敲脑门'], ['mark', '画记号'], ['boom', '碎尺'], ['crit', '棱角']],
  mop:      [['trail', '边走边拖', '你走过的地方也会留下水渍'], ['deep', '深水渍', '水渍更大，多留 3 秒'], ['slip', '打滑', '踩进水渍的怪有概率滑倒 0.6 秒'], ['big', '加宽拖把'], ['cd', '手脚麻利'], ['kb', '一拖到底'], ['exec', '擦干净'], ['first', '泼水']],
  pencil:   [['split', '断铅', '铅笔命中后分裂成两支'], ['bounce', '弹射', '铅笔穿完后弹向下一只怪，最多 2 次'], ['back', '回马枪', '同时向背后射出同样多的铅笔'], ['pierce', '削尖', '每支多穿 2 只怪'], ['crit', '笔尖'], ['twice', '连射'], ['elite', '专治难题'], ['boom', '炸铅']],
  plane:    [['split', '双机编队', '纸飞机命中后分裂成两架小飞机'], ['loop', '特技飞行', '命中后不消失，掉头再打 2 只'], ['bomb', '轰炸机', '命中时小范围爆炸'], ['life', '长途航线', '飞得更久，追得更远'], ['crit', '机头加固'], ['twice', '连续起飞'], ['first', '先手'], ['gem', '侦察机']],
  slipper:  [['huge', '43 码', '拖鞋变大，更容易打中'], ['hover', '悬停', '飞到最远处原地转 1 秒，持续打周围的怪'], ['ret', '回程加速', '飞回来的那一下伤害翻倍'], ['kb', '一鞋抽飞'], ['stun', '打懵'], ['crit', '鞋底纹'], ['cd', '顺手'], ['leech', '解气']],
  stapler:  [['pierce', '长钉', '钉子多穿 2 只怪'], ['bounce', '跳弹', '钉子打中后弹向下一只怪，最多 2 次'], ['heavy', '大号钉', '每第 8 发是一颗大钉，伤害 4 倍'], ['crit', '瞄准'], ['exec', '补订'], ['elite', '装订重点'], ['mark', '钉住'], ['boom', '爆钉']],
  shotgun:  [['back', '前后开花', '同时向背后也喷一扇'], ['pierce', '硬橡皮', '橡皮多穿 1 只怪'], ['near', '贴脸', '离你 3 米内的怪受到的伤害 +70%'], ['kb', '崩飞'], ['stun', '砸晕'], ['cd', '快速装填'], ['twice', '双响'], ['first', '开门红']],
  bolt:     [['fork', '分叉', '每一跳有 35% 概率多电旁边一只'], ['back', '回路', '最后一跳电回第一只怪，伤害 150%'], ['far', '远距放电', '起手距离和跳跃距离 +60%'], ['stun', '麻痹'], ['mark', '感电'], ['crit', '高压'], ['cd', '快充'], ['elite', '避雷针']],
  coffee:   [['two', '续杯', '一次扔两杯'], ['long', '慢慢喝', '旋风多留 2.5 秒'], ['pull', '搅拌', '旋风把怪往中心吸得更狠'], ['big', '大杯'], ['cd', '速溶'], ['exec', '提神'], ['mark', '咖啡渍'], ['boom', '烫嘴']],
  sock:     [['pulse', '抖一抖', '每 3 秒臭气猛地爆开一次，范围翻倍，伤害 4 倍'], ['close', '贴身', '离你越近的怪掉血越快，最多 2.5 倍'], ['linger', '余味', '被熏到的怪减速延长到 2 秒'], ['big', '陈年袜子'], ['mark', '熏透'], ['stun', '熏晕'], ['leech', '神清气爽'], ['gem', '臭名远扬']],
  rollcall: [['two', '点两个', '每次多点一个'], ['again', '留堂', '被点名没倒下的怪，1 秒后再砸一次，伤害 60%'], ['fear', '杀鸡儆猴', '书落地时把周围的怪吓晕 1 秒'], ['next', '下一个', '点名打倒怪后马上再点一个，最多连点 3 次'], ['cd', '点得勤'], ['crit', '红笔圈出'], ['elite', '重点关照'], ['boom', '厚书']],
  minion:   [['two', '多贴一张', '每次多召一个'], ['long', '强力胶', '小人存在时间 +50%'], ['burst', '自爆便利贴', '小人消失时会爆炸'], ['fast', '打鸡血', '小人跑得更快，出手快 25%'], ['crit', '尖角'], ['stun', '糊脸'], ['mark', '贴标签'], ['leech', '加油打气']],
  lamp:     [['two', '多一盏', '每次多放一盏'], ['long', '充满电', '台灯存在时间 +50%'], ['far', '远光灯', '射程 +50%'], ['flash', '闪光', '台灯放下时闪一下，把周围的怪晃晕 1.5 秒'], ['crit', '聚光'], ['exec', '照妖镜'], ['elite', '追光'], ['mark', '曝光']],
  duck:     [['two', '多一只', '每次多放一只'], ['big', '大黄鸭', '爆炸范围 +30%'], ['echo', '回声', '爆炸后 0.5 秒原地再炸一次，伤害 50%'], ['lure', '嘎嘎嘎', '吸引怪的范围扩大到 14 米'], ['long', '耐泡', '橡皮鸭多待 50% 时间'], ['stun', '震晕'], ['mark', '沾水'], ['gem', '捞到宝']],
};
for (const w in SP) for (const x of SP[w]) if (!x[2]) x[2] = G[x[0]];
const SPX = (w, k) => !!(player.sp[w] && player.sp[w][k]);
function ws(id, extra) {
  const b = WBASE[id], u = Object.assign({}, player.wup[id] || {}, extra || {}), L = u.lv || 0, [ty, st] = LVUP[id], X = player.sp[id] || {};
  const dm = ty === 'dmg' ? 1 + st * L : 1, rt = (ty === 'rate' ? 1 + st * L : 1) * (X.cd ? 1.33 : 1), ar = (ty === 'area' ? 1 + st * L : 1) * (X.big ? 1.3 : 1);
  return { ...b, dmg: b.dmg * dm, cd: b.cd / rt, atk: b.atk ? b.atk / rt : 0, range: (b.range || 0) * ar, rad: (b.rad || 0) * ar, n: (b.n || 0) + (ty === 'n' ? st * L : 0) + (X.two ? 1 : 0),
    pierce: b.pierce || 0, dur: (b.dur || 0) * (X.long ? 1.5 : 1) * (1 + 0.1 * R('bath')) };
}
const wLevel = (id) => 1 + Object.values(player.wup[id] || {}).reduce((a, b) => a + b, 0);
function upPreview(id, u, n = 1) {
  const L = (player.wup[id] || {}).lv || 0, a = ws(id), b = ws(id, { lv: L + n }), ty = LVUP[id][0];
  if (ty === 'dmg') return `伤害 ${Math.round(a.dmg)} → ${Math.round(b.dmg)}`;
  if (ty === 'rate') return a.atk ? `间隔 ${a.atk.toFixed(2)} → ${b.atk.toFixed(2)} 秒` : `冷却 ${a.cd.toFixed(2)} → ${b.cd.toFixed(2)} 秒`;
  if (ty === 'area') return `范围 ${(a.rad || a.range).toFixed(1)} → ${(b.rad || b.range).toFixed(1)}`;
  return `数量 ${a.n} → ${b.n}`;
}
// 通用属性
const signedPercent = (value) => {
  const percent = Math.round(value * 100);
  return `${percent >= 0 ? '+' : ''}${percent}%`;
};
const STATS = {
  dmg:     { name: '基础伤害', fl: '熬夜刷题', c: '#e0473c', ch: '力', step: 0.04, show: signedPercent },
  crit:    { name: '暴击率',   fl: '灵光一闪', c: '#ffb020', ch: '暴', step: 0.01, max: 1, show: (v) => `${Math.round(v * 100)}%` },
  critDmg: { name: '暴击伤害', fl: '满分卷子', c: '#ff7a3a', ch: '伤', step: 0.08, show: (v) => `×${v.toFixed(1)}` },
  atkSpd:  { name: '攻速',     fl: '手速',     c: '#3f97e8', ch: '速', step: 0.04, show: signedPercent },
  luck:    { name: '幸运',     fl: '锦鲤',     c: '#ff6fa8', ch: '运', step: 0.01, max: 0.2, show: (v) => `${Math.round(v * 100)}%` },
  dodge:   { name: '闪避',     fl: '溜得快',   c: '#38b2c9', ch: '闪', step: 0.02, max: 0.8, show: (v) => `${Math.round(v * 100)}%` },
  armor:   { name: '护甲',     fl: '厚外套',   c: '#7a8394', ch: '甲', step: 1, show: (v) => `${Math.round(v)}（受伤 -${Math.round(v / (v + 10) * 100)}%）` },
  regen:   { name: '回复速度', fl: '保温杯',   c: '#3faa6a', ch: '回', step: 0.04, show: (v) => `${v.toFixed(2)}/秒` },
  speed:   { name: '移动速度', fl: '新球鞋',   c: '#5fb04f', ch: '跑', step: 0.03, show: (v) => `+${Math.round(v * 100)}%` },
  xp:      { name: '经验效率', fl: '课堂笔记', c: '#3fc98a', ch: '学', step: 0.04, show: (v) => `+${Math.round(v * 100)}%` },
  maxHp:   { name: '生命上限', fl: '早餐吃饱', c: '#ff8a6b', ch: '命', step: 8, show: () => `${Math.round(player.maxHp)}` },
};
// 普通 / 稀有 / 史诗 / 传奇：数值是 1 / 2 / 3 / 4 倍
const TIER = [{ k: 1, n: '普通' }, { k: 2, n: '稀有' }, { k: 3, n: '史诗' }, { k: 4, n: '传奇' }];
function rollTier() { const L = player.st.luck || 0, r = Math.random(); return r < 0.015 + L * 0.25 ? 3 : r < 0.07 + L * 0.6 ? 2 : r < 0.27 + L * 1.2 ? 1 : 0; }
const statVal = (id, tier) => { const v = STATS[id].step * TIER[tier].k; return id === 'armor' || id === 'maxHp' ? Math.round(v) : v; };
const ET = {
  sleepy:    { hp: 16,  spd: 2.0, r: 0.5,  size: 1,    dps: 9,  xp: 1 },
  cross:     { hp: 11,  spd: 3.2, r: 0.42, size: 0.95, dps: 8,  xp: 1 },
  bat:       { hp: 8,   spd: 4.2, r: 0.36, size: 0.9,  dps: 6,  xp: 1, fly: 1 },
  clock:     { hp: 26,  spd: 1.9, r: 0.55, size: 1,    dps: 12, xp: 3 },
  ink:       { hp: 30,  spd: 1.8, r: 0.6,  size: 1,    dps: 10, xp: 3 },
  inkmini:   { hp: 8,   spd: 3.1, r: 0.34, size: 0.55, dps: 6,  xp: 1 },
  ghost:     { hp: 22,  spd: 2.3, r: 0.5,  size: 1,    dps: 6,  xp: 3, fly: 1 },
  phone:     { hp: 70,  spd: 1.6, r: 0.7,  size: 1.1,  dps: 14, xp: 5 },
  snail:     { hp: 140, spd: 1.05, r: 0.85, size: 1.2, dps: 16, xp: 10 },
  bomber:    { hp: 110, spd: 1.8, r: 1.0,  size: 1.9,  dps: 8,  xp: 12 },
  chalk:     { hp: 20,  spd: 2.4, r: 0.45, size: 1,    dps: 5,  xp: 3 },
  mole:      { hp: 46,  spd: 1.7, r: 0.55, size: 1,    dps: 10, xp: 4 },
  hourglass: { hp: 380, spd: 1.6, r: 1.1,  size: 1,    dps: 22, xp: 25 },
  boss:      { hp: 4600, spd: 1.9, r: 3.5, size: 2.0,  dps: 44, xp: 60 },
};

/* ================= 渲染器、灯光、后期 ================= */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
$('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeadcc2);
scene.fog = new THREE.Fog(0xeadcc2, 50, 110);
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
scene.add(new THREE.AmbientLight(0xfff4e6, 1.35));
const moon = new THREE.DirectionalLight(0xfff0d8, 1.7); moon.position.set(-12, 16, -4); scene.add(moon);
const torch = new THREE.PointLight(0xffd8a0, 8, 10, 1.6); scene.add(torch);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.4, 0.95);
composer.addPass(bloom);
const uTime = { value: 0 };
const SCREEN_RIPS = Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -1, 0));
const finalPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uRip: { value: SCREEN_RIPS }, uChroma: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uHurt: { value: 0 }, uTime },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `
  uniform sampler2D tDiffuse; uniform vec4 uRip[6]; uniform float uChroma; uniform vec2 uRes; uniform float uHurt; uniform float uTime; varying vec2 vUv;
  void main(){
    vec2 uv=vUv; float asp=uRes.x/uRes.y;
    for(int i=0;i<6;i++){ vec4 r=uRip[i]; if(r.z<0.0||r.z>0.6) continue;
      vec2 d=uv-r.xy; d.x*=asp; float L=length(d); float front=r.z*0.6;
      float w=exp(-pow((L-front)*20.0,2.0))*(1.0-r.z/0.6)*r.w; vec2 dir=normalize(d+1e-5); dir.x/=asp; uv-=dir*w*0.03; }
    vec2 c=uv-0.5; float ch=uChroma*0.012+0.0006;
    vec3 col; col.r=texture2D(tDiffuse,uv+c*ch).r; col.g=texture2D(tDiffuse,uv).g; col.b=texture2D(tDiffuse,uv-c*ch).b;
    // 墨线：亮度突变的地方压一道黑线，像漫画勾边
    vec2 px=1.0/uRes; float l0=dot(col,vec3(0.3,0.59,0.11));
    float lx=dot(texture2D(tDiffuse,uv+vec2(px.x,0.)).rgb,vec3(0.3,0.59,0.11)), ly=dot(texture2D(tDiffuse,uv+vec2(0.,px.y)).rgb,vec3(0.3,0.59,0.11));
    float lx2=dot(texture2D(tDiffuse,uv-vec2(px.x,0.)).rgb,vec3(0.3,0.59,0.11)), ly2=dot(texture2D(tDiffuse,uv-vec2(0.,px.y)).rgb,vec3(0.3,0.59,0.11));
    float ed=abs(lx-lx2)+abs(ly-ly2); col*=1.0-smoothstep(0.12,0.3,ed)*0.16*step(l0,0.7);
    // 调色：暗部偏青绿，亮部偏暖金，整体压饱和
    float L=dot(col,vec3(0.3,0.59,0.11));
    col=mix(vec3(L),col,1.16);
    col=mix(col*vec3(0.92,0.9,1.04),col*vec3(1.04,1.0,0.94),smoothstep(0.15,0.7,L));
    float paper=fract(sin(dot(floor(uv*uRes*0.5),vec2(12.9898,78.233)))*43758.5453);
    col*=0.985+0.025*paper;
    float vig=smoothstep(1.1,0.28,length(c*vec2(asp*0.7,1.0)));
    col*=mix(0.86,1.0,vig);
    col=mix(col,vec3(0.7,0.05,0.05),uHurt*(1.0-vig)*0.7);
    gl_FragColor=vec4(col,1.0);
  }`,
});
composer.addPass(finalPass);
composer.addPass(new OutputPass());

/* ================= 卡通墨线材质 + 拟人骨架 ================= */
const grad = new THREE.DataTexture(new Uint8Array([45, 120, 255]), 3, 1, THREE.RedFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
const RIM = { value: new THREE.Color(0xfff3d6) };
function inkToon(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = RIM;
    sh.fragmentShader = 'uniform vec3 uRim;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
      { vec3 vd=normalize(vViewPosition); float rim=pow(1.0-clamp(dot(normal,vd),0.0,1.0),3.0);
        float lum=dot(outgoingLight,vec3(0.3,0.59,0.11));
        float hatch=step(0.6,fract((gl_FragCoord.x-gl_FragCoord.y)*0.2));
        float sh=smoothstep(0.22,0.06,lum);
        outgoingLight=mix(outgoingLight,outgoingLight*vec3(0.85,0.75,1.0),sh*0.6);
        outgoingLight*=1.0-hatch*sh*0.25;
        outgoingLight+=uRim*step(0.6,rim)*0.18; }
      #include <opaque_fragment>`);
  };
  return mat;
}
const toonMat = inkToon(new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: grad }));
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x3a2228, side: THREE.BackSide });
const toonOf = (c) => inkToon(new THREE.MeshToonMaterial({ color: c, gradientMap: grad }));
const GEO = {
  sph: new THREE.SphereGeometry(0.5, 20, 14), box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 18),
  cone: new THREE.ConeGeometry(0.5, 1, 18), tor: new THREE.TorusGeometry(0.5, 0.14, 8, 22), cap: new THREE.CapsuleGeometry(0.5, 0.6, 6, 14),
  tet: new THREE.TetrahedronGeometry(0.6, 0), bowl: new THREE.CylinderGeometry(0.7, 0.4, 0.5, 16),
};
const eyes = (y, z, sp = 0.16, s = 0.2, pu = 0.11, k = 'eye', pc = 0x1a1020) => [
  ['sph', 0xffffff, [-sp, y, z], [s, s * 1.15, s * 0.6], 0, k, 0], ['sph', 0xffffff, [sp, y, z], [s, s * 1.15, s * 0.6], 0, k, 0],
  ['sph', pc, [-sp, y - 0.01, z + s * 0.26], [pu, pu * 1.25, pu * 0.6], 0, k, 0], ['sph', pc, [sp, y - 0.01, z + s * 0.26], [pu, pu * 1.25, pu * 0.6], 0, k, 0],
  ['sph', 0xffffff, [-sp + pu * 0.3, y + pu * 0.34, z + s * 0.26 + pu * 0.27], [pu * 0.46, pu * 0.46, pu * 0.24], 0, k, 0], ['sph', 0xffffff, [sp + pu * 0.3, y + pu * 0.34, z + s * 0.26 + pu * 0.27], [pu * 0.46, pu * 0.46, pu * 0.24], 0, k, 0],
];
const brows = (y, z, sp, w = 0.18, ang = 0.45, k = '') => [['box', 0x1a1020, [-sp, y, z], [w, 0.05, 0.04], [0, 0, -ang], k, 0], ['box', 0x1a1020, [sp, y, z], [w, 0.05, 0.04], [0, 0, ang], k, 0]];
const legs = (c, sp = 0.14, h = 0.26, w = 0.15) => [['cap', c, [-sp, h * 0.55, 0], [w, h, w], 0, 'legL', 1], ['cap', c, [sp, h * 0.55, 0], [w, h, w], 0, 'legR', 1]];
function heroParts(look) {
  // Q 版：头身比约 1:1。每个角色有自己的发型、衣服和眼睛颜色，女生有睫毛、裙子和发饰
  const skin = look.skin || 0xffdcbc, H = look.hair, T = look.top, B = look.pants, G = !!look.girl, W = look.big ? 1.15 : 1;
  const bow = (x, y, z, c, sc = 1, k = '') => [['cone', c, [x - 0.13 * sc, y, z], [0.18 * sc, 0.26 * sc, 0.12 * sc], [0, 0, HP_], k, 1], ['cone', c, [x + 0.13 * sc, y, z], [0.18 * sc, 0.26 * sc, 0.12 * sc], [0, 0, -HP_], k, 1], ['sph', c, [x, y, z + 0.02], [0.1 * sc, 0.1 * sc, 0.1 * sc], 0, k, 0]];
  const P = [
    ['cap', G ? 0xffffff : B, [-0.12, 0.11, 0], [0.19, 0.18, 0.19], 0, 'legL', 1], ['cap', G ? 0xffffff : B, [0.12, 0.11, 0], [0.19, 0.18, 0.19], 0, 'legR', 1],
    ['sph', look.outfit === 'track' ? 0xffffff : 0x4a2e2a, [-0.12, 0.03, 0.05], [0.2, 0.1, 0.26], 0, 'legL', 0], ['sph', look.outfit === 'track' ? 0xffffff : 0x4a2e2a, [0.12, 0.03, 0.05], [0.2, 0.1, 0.26], 0, 'legR', 0],
    ['cap', T, [0, 0.46, 0], [0.5 * W, 0.26, 0.42 * W], 0, '', 1],
    ['cap', T, [-0.3 * W, 0.48, 0], [0.13, 0.16, 0.13], 0, 'armL', 1], ['cap', T, [0.3 * W, 0.48, 0], [0.13, 0.16, 0.13], 0, 'armR', 1],
    ['sph', skin, [-0.32 * W, 0.33, 0.03], [0.13, 0.13, 0.13], 0, 'armL', 0], ['sph', skin, [0.32 * W, 0.33, 0.03], [0.13, 0.13, 0.13], 0, 'armR', 0],
    ['sph', skin, [0, 1.16, 0], [1.16, 1.04, 1.06], 0, '', 1],
  ];
  // 衣服
  if (look.outfit === 'track') P.push(['box', B, [0, 0.27, 0], [0.5 * W, 0.16, 0.4 * W], 0, '', 1], ['box', 0xffffff, [-0.31 * W, 0.5, 0.07], [0.05, 0.22, 0.05], 0, 'armL', 0], ['box', 0xffffff, [0.31 * W, 0.5, 0.07], [0.05, 0.22, 0.05], 0, 'armR', 0], ['box', 0xffffff, [0, 0.52, 0.2], [0.06, 0.24, 0.04], 0, '', 0], ['box', 0x3a5ad0, [0, 0.52, -0.24], [0.36, 0.34, 0.16], 0, '', 1]);
  if (look.outfit === 'sailor') P.push(['bowl', B, [0, 0.27, 0], [0.74, 0.5, 0.68], [PI, 0, 0], '', 1], ['box', B, [0, 0.6, -0.04], [0.56, 0.08, 0.46], 0, '', 0], ['box', B, [0, 0.52, -0.2], [0.46, 0.2, 0.06], 0, '', 0], ...bow(0, 0.52, 0.23, look.accent, 0.9));
  if (look.outfit === 'labcoat') P.push(['bowl', 0xfafafa, [0, 0.28, 0], [0.72, 0.58, 0.66], [PI, 0, 0], '', 1], ['box', T, [0, 0.5, 0.2], [0.16, 0.26, 0.04], 0, '', 0], ['cap', 0xfafafa, [-0.3, 0.48, 0], [0.14, 0.17, 0.14], 0, 'armL', 1], ['cap', 0xfafafa, [0.3, 0.48, 0], [0.14, 0.17, 0.14], 0, 'armR', 1], ['box', 0xe2453a, [0.14, 0.52, 0.21], [0.03, 0.12, 0.03], 0, '', 0], ['box', 0x3a6ad8, [0.18, 0.52, 0.21], [0.03, 0.12, 0.03], 0, '', 0]);
  if (look.outfit === 'cardigan') P.push(['bowl', B, [0, 0.27, 0], [0.76, 0.5, 0.7], [PI, 0, 0], '', 1], ['box', 0xffffff, [0, 0.5, 0.2], [0.14, 0.24, 0.04], 0, '', 0], ['sph', 0xfff1a8, [0, 0.42, 0.22], [0.05, 0.05, 0.03], 0, '', 0], ['sph', 0xfff1a8, [0, 0.52, 0.22], [0.05, 0.05, 0.03], 0, '', 0]);
  if (look.outfit === 'cheer') P.push(['bowl', 0xffffff, [0, 0.27, 0], [0.78, 0.5, 0.72], [PI, 0, 0], '', 1], ['bowl', T, [0, 0.21, 0], [0.8, 0.14, 0.74], [PI, 0, 0], '', 0], ['box', 0xffffff, [-0.08, 0.5, 0.21], [0.05, 0.24, 0.04], [0, 0, 0.5], '', 0], ['box', 0xffffff, [0.08, 0.5, 0.21], [0.05, 0.24, 0.04], [0, 0, -0.5], '', 0]);
  // 脸：大眼睛 + 两颗高光；女生眼睛更大、带睫毛
  const ew = G ? 0.23 : 0.2, eh = G ? 0.34 : 0.3, ey = G ? 1.08 : 1.1;
  P.push(
    ['sph', 0x2a1a22, [-0.2, ey, 0.47], [ew, eh, 0.1], 0, 'eye', 0], ['sph', 0x2a1a22, [0.2, ey, 0.47], [ew, eh, 0.1], 0, 'eye', 0],
    ['sph', look.iris, [-0.2, ey - 0.06, 0.5], [ew * 0.7, eh * 0.5, 0.06], 0, 'eye', 0], ['sph', look.iris, [0.2, ey - 0.06, 0.5], [ew * 0.7, eh * 0.5, 0.06], 0, 'eye', 0],
    ['sph', 0xffffff, [-0.15, ey + 0.07, 0.52], [0.09, 0.1, 0.04], 0, 'eye glow', 0], ['sph', 0xffffff, [0.25, ey + 0.07, 0.52], [0.09, 0.1, 0.04], 0, 'eye glow', 0],
    ['sph', 0xffffff, [-0.24, ey - 0.08, 0.52], [0.045, 0.045, 0.03], 0, 'eye', 0], ['sph', 0xffffff, [0.16, ey - 0.08, 0.52], [0.045, 0.045, 0.03], 0, 'eye', 0],
    ['sph', 0xff8fa3, [-0.37, 0.95, 0.4], [0.17, 0.08, 0.05], 0, '', 0], ['sph', 0xff8fa3, [0.37, 0.95, 0.4], [0.17, 0.08, 0.05], 0, '', 0],
    ['tor', G ? 0xd8506a : 0x8a3a3a, [0, 0.93, 0.5], [G ? 0.06 : 0.07, 0.05, 0.05], [0, 0, PI], '', 0],
  );
  if (G) P.push(['box', 0x2a1a22, [-0.33, ey + 0.14, 0.47], [0.12, 0.035, 0.03], [0, 0, -0.55], 'eye', 0], ['box', 0x2a1a22, [0.33, ey + 0.14, 0.47], [0.12, 0.035, 0.03], [0, 0, 0.55], 'eye', 0],
    ['box', 0x2a1a22, [-0.34, ey + 0.06, 0.46], [0.1, 0.03, 0.03], [0, 0, -0.2], 'eye', 0], ['box', 0x2a1a22, [0.34, ey + 0.06, 0.46], [0.1, 0.03, 0.03], [0, 0, 0.2], 'eye', 0],
    ['box', 0x5a3a3a, [-0.2, 1.31, 0.5], [0.15, 0.028, 0.03], [0, 0, 0.15], '', 0], ['box', 0x5a3a3a, [0.2, 1.31, 0.5], [0.15, 0.028, 0.03], [0, 0, -0.15], '', 0]);
  else P.push(...brows(1.32, 0.5, 0.2, 0.18, look.style === 'spiky' ? 0.25 : -0.1));
  // 发型
  const cap = ['sph', H, [0, 1.34, -0.1], [1.24, 0.92, 1.12], 0, '', 1];
  if (look.style === 'spiky') P.push(cap, ...[[-0.3, 1.72, 0, 0.5], [0, 1.82, -0.05, 0], [0.3, 1.72, 0, -0.5], [-0.2, 1.62, -0.4, 0.4], [0.2, 1.62, -0.4, -0.4]].map(([x, y, z, r]) => ['cone', H, [x, y, z], [0.3, 0.42, 0.3], [-0.3, 0, r], '', 1]),
    ['cone', H, [-0.22, 1.5, 0.42], [0.26, 0.3, 0.2], [2.2, 0, 0.3], '', 0], ['cone', H, [0.18, 1.5, 0.44], [0.26, 0.3, 0.2], [2.2, 0, -0.3], '', 0]);
  if (look.style === 'long') P.push(cap, ['cap', H, [0, 0.82, -0.3], [1.14, 0.62, 0.5], 0, 'sway', 1], ['cap', H, [-0.54, 0.84, 0.16], [0.22, 0.5, 0.2], 0, '', 1], ['cap', H, [0.54, 0.84, 0.16], [0.22, 0.5, 0.2], 0, '', 1],
    ['box', H, [0, 1.5, 0.42], [0.96, 0.22, 0.22], [0.35, 0, 0], '', 0], ...bow(0.42, 1.62, 0.1, look.accent, 0.7));
  if (look.style === 'messy') P.push(cap, ...[[-0.35, 1.55, 0.3], [0.1, 1.62, 0.38], [0.4, 1.5, 0.28], [-0.1, 1.75, 0.1], [0.3, 1.72, -0.2], [-0.4, 1.6, -0.3]].map(([x, y, z], n) => ['sph', H, [x, y, z], [0.42, 0.3, 0.36], [n, n * 0.7, 0], '', 1]), ['cone', H, [0.08, 1.95, 0], [0.12, 0.34, 0.12], [0, 0, -0.6], '', 1]);
  if (look.style === 'wavy') P.push(cap, ...[[-0.38, 1.0, -0.28], [0.38, 1.0, -0.28], [-0.44, 0.66, -0.2], [0.44, 0.66, -0.2], [0, 0.8, -0.42], [-0.2, 0.55, -0.35], [0.2, 0.55, -0.35]].map(([x, y, z]) => ['sph', H, [x, y, z], [0.5, 0.48, 0.42], 0, 'sway', 1]),
    ['sph', H, [-0.3, 1.5, 0.4], [0.56, 0.28, 0.26], [0, 0, 0.45], '', 0], ['sph', H, [0.32, 1.46, 0.38], [0.36, 0.24, 0.24], [0, 0, -0.3], '', 0]);
  const fringe = ['box', H, [0, 1.5, 0.42], [0.96, 0.22, 0.22], [0.35, 0, 0], '', 0];
  if (look.style === 'bob') P.push(cap, fringe, ['cap', H, [-0.56, 1.02, 0.02], [0.26, 0.42, 0.46], 0, '', 1], ['cap', H, [0.56, 1.02, 0.02], [0.26, 0.42, 0.46], 0, '', 1], ['cap', H, [0, 0.98, -0.4], [1.0, 0.4, 0.3], 0, '', 1]);
  if (look.style === 'pony') P.push(cap, fringe, ['cap', H, [-0.54, 0.98, 0.16], [0.18, 0.36, 0.18], 0, '', 1], ['cap', H, [0.54, 0.98, 0.16], [0.18, 0.36, 0.18], 0, '', 1],
    ['sph', H, [0, 1.62, -0.6], [0.34, 0.34, 0.34], 0, '', 1], ['cap', H, [0, 1.12, -0.82], [0.34, 0.66, 0.34], [0.35, 0, 0], 'sway', 1], ...bow(0, 1.66, -0.5, look.accent, 0.8));
  if (look.style === 'bun') P.push(cap, fringe, ['sph', H, [0, 1.92, -0.2], [0.5, 0.44, 0.5], 0, '', 1], ['cap', H, [-0.54, 0.98, 0.16], [0.18, 0.34, 0.18], 0, '', 1], ['cap', H, [0.54, 0.98, 0.16], [0.18, 0.34, 0.18], 0, '', 1]);
  if (look.style === 'bun2') P.push(cap, fringe, ['sph', H, [-0.52, 1.82, -0.1], [0.42, 0.42, 0.42], 0, '', 1], ['sph', H, [0.52, 1.82, -0.1], [0.42, 0.42, 0.42], 0, '', 1], ['cap', H, [-0.54, 0.98, 0.16], [0.18, 0.34, 0.18], 0, 'sway', 1], ['cap', H, [0.54, 0.98, 0.16], [0.18, 0.34, 0.18], 0, 'sway', 1]);
  if (look.style === 'buzz') P.push(['sph', H, [0, 1.38, -0.08], [1.2, 0.82, 1.1], 0, '', 1]);
  if (look.style === 'twin') P.push(cap, ['cap', H, [-0.74, 0.98, -0.08], [0.36, 0.5, 0.36], [0, 0, -0.35], 'sway', 1], ['cap', H, [0.74, 0.98, -0.08], [0.36, 0.5, 0.36], [0, 0, 0.35], 'sway', 1],
    ...bow(-0.6, 1.42, -0.02, look.accent, 1.1), ...bow(0.6, 1.42, -0.02, look.accent, 1.1),
    ['sph', H, [-0.25, 1.52, 0.4], [0.44, 0.26, 0.26], [0, 0, 0.3], '', 0], ['sph', H, [0.25, 1.52, 0.4], [0.44, 0.26, 0.26], [0, 0, -0.3], '', 0], ['sph', H, [0, 1.58, 0.42], [0.34, 0.24, 0.24], 0, '', 0]);
  if (look.flower) P.push(...[0, 1, 2, 3, 4].map((n) => ['sph', look.accent, [-0.45 + Math.cos(n * 1.257) * 0.09, 1.42 + Math.sin(n * 1.257) * 0.09, 0.36], [0.11, 0.11, 0.06], 0, '', 0]), ['sph', 0xfff1a8, [-0.45, 1.42, 0.39], [0.08, 0.08, 0.05], 0, '', 0]);
  if (look.cap) P.push(['sph', look.cap, [0, 1.52, -0.04], [1.28, 0.66, 1.18], 0, '', 1], ['box', look.cap, [0, 1.52, 0.66], [0.8, 0.07, 0.5], [0.18, 0, 0], '', 1], ['sph', look.top, [0, 1.86, -0.04], [0.14, 0.1, 0.14], 0, '', 0]);
  if (look.swimcap) P.push(['sph', look.swimcap, [0, 1.38, -0.06], [1.3, 0.96, 1.18], 0, '', 1], ['cyl', look.top, [0, 1.42, -0.06], [1.31, 0.1, 1.19], 0, '', 0]);
  if (look.goggles2) P.push(['cyl', 0x2a2f3a, [0, 1.62, -0.04], [1.24, 0.08, 1.12], 0, '', 0], ['cyl', 0xff8fb8, [-0.2, 1.64, 0.5], [0.24, 0.1, 0.2], [HP_, 0, 0], '', 1], ['cyl', 0xff8fb8, [0.2, 1.64, 0.5], [0.24, 0.1, 0.2], [HP_, 0, 0], '', 1]);
  if (look.scarf) P.push(['sph', look.scarf, [0, 1.6, -0.06], [1.3, 0.56, 1.2], [0.12, 0, 0], '', 1], ['cone', look.scarf, [0, 1.42, -0.62], [0.3, 0.36, 0.14], [PI - 0.5, 0, 0], 'sway', 0]);
  if (look.mask) P.push(['box', look.mask, [0, 1.56, 0.4], [0.86, 0.2, 0.32], [0.3, 0, 0], '', 1], ['sph', 0xffffff, [-0.2, 1.58, 0.56], [0.12, 0.05, 0.04], 0, '', 0], ['sph', 0xffffff, [0.2, 1.58, 0.56], [0.12, 0.05, 0.04], 0, '', 0]);
  if (look.phones) P.push(['box', look.phones, [0, 1.86, -0.02], [1.24, 0.09, 0.18], 0, '', 0], ['cyl', look.phones, [-0.63, 1.22, 0], [0.4, 0.16, 0.4], [0, 0, HP_], '', 1], ['cyl', look.phones, [0.63, 1.22, 0], [0.4, 0.16, 0.4], [0, 0, HP_], '', 1], ['cyl', look.top, [-0.72, 1.22, 0], [0.22, 0.04, 0.22], [0, 0, HP_], 'glow', 0], ['cyl', look.top, [0.72, 1.22, 0], [0.22, 0.04, 0.22], [0, 0, HP_], 'glow', 0]);
  if (look.band2) P.push(['cyl', look.band2, [0, 1.5, -0.04], [1.22, 0.13, 1.12], 0, '', 1]);
  if (look.armband) P.push(['box', look.armband, [-0.31 * W, 0.53, 0], [0.18, 0.1, 0.18], 0, 'armL', 0]);
  if (look.tired) P.push(['box', 0xb89a9a, [-0.2, 0.94, 0.5], [0.16, 0.03, 0.03], 0, '', 0], ['box', 0xb89a9a, [0.2, 0.94, 0.5], [0.16, 0.03, 0.03], 0, '', 0]);
  if (look.paint) P.push(['sph', 0xff6b6b, [0.36, 1.0, 0.5], [0.1, 0.07, 0.04], 0, '', 0], ['sph', 0x4aa8ff, [-0.1, 0.5, 0.25], [0.08, 0.08, 0.03], 0, '', 0], ['sph', 0xffd23f, [0.1, 0.38, 0.25], [0.07, 0.07, 0.03], 0, '', 0]);
  if (look.outfit === 'vest') P.push(['box', look.accent, [0, 0.46, 0.0], [0.53, 0.3, 0.45], 0, '', 0], ['box', 0xe2453a, [0, 0.52, 0.23], [0.06, 0.2, 0.03], 0, '', 0], ['box', B, [0, 0.27, 0], [0.5, 0.14, 0.4], 0, '', 1]);
  if (look.outfit === 'apron') P.push(['bowl', B, [0, 0.27, 0], [0.76, 0.5, 0.7], [PI, 0, 0], '', 1], ['box', look.accent, [0, 0.4, 0.22], [0.38, 0.4, 0.05], 0, '', 1], ['box', look.accent, [0, 0.62, 0.1], [0.5, 0.05, 0.3], 0, '', 0]);
  if (look.outfit === 'hoodie') P.push(['sph', T, [0, 0.72, -0.2], [0.62, 0.34, 0.4], 0, '', 1], ['box', look.accent, [0, 0.38, 0.2], [0.3, 0.1, 0.04], 0, '', 0], ['box', look.accent, [-0.07, 0.56, 0.21], [0.025, 0.14, 0.03], 0, '', 0], ['box', look.accent, [0.07, 0.56, 0.21], [0.025, 0.14, 0.03], 0, '', 0], ['box', B, [0, 0.27, 0], [0.5, 0.14, 0.4], 0, '', 1]);
  if (look.outfit === 'pajama') P.push(...[[-0.14, 0.52], [0.12, 0.42], [0.02, 0.58], [-0.04, 0.36]].map(([x, y]) => ['sph', look.accent, [x, y, 0.2], [0.07, 0.07, 0.04], 0, '', 0]), ['box', 0xffffff, [0, 0.64, 0.12], [0.36, 0.06, 0.24], 0, '', 0], ['bowl', T, [0, 0.27, 0], [0.7, 0.4, 0.64], [PI, 0, 0], '', 1]);
  if (look.outfit === 'jersey') P.push(['box', 0xffffff, [0, 0.5, 0.21], [0.2, 0.2, 0.03], 0, '', 0], ['box', T, [0, 0.5, 0.225], [0.05, 0.14, 0.02], 0, '', 0], ['box', B, [0, 0.27, 0], [0.56, 0.18, 0.46], 0, '', 1], ['box', T, [-0.29, 0.27, 0], [0.03, 0.18, 0.47], 0, '', 0], ['box', T, [0.29, 0.27, 0], [0.03, 0.18, 0.47], 0, '', 0]);
  if (look.glasses) P.push(['tor', 0x8a3a4a, [-0.2, ey, 0.53], [0.36, 0.38, 0.4], 0, '', 0], ['tor', 0x8a3a4a, [0.2, ey, 0.53], [0.36, 0.38, 0.4], 0, '', 0]);
  if (look.goggles) P.push(['box', 0x2a2f3a, [0, 1.48, 0.0], [1.22, 0.12, 1.12], 0, '', 0], ['cyl', 0x7fc8e8, [-0.2, 1.5, 0.52], [0.26, 0.1, 0.26], [HP_, 0, 0], '', 1], ['cyl', 0x7fc8e8, [0.2, 1.5, 0.52], [0.26, 0.1, 0.26], [HP_, 0, 0], '', 1]);
  if (look.band) P.push(['box', look.band, [0, 1.46, 0.0], [1.26, 0.12, 1.16], 0, '', 0]);
  if (look.beret) P.push(['cyl', look.beret, [0.12, 1.8, -0.04], [1.0, 0.16, 0.94], [0, 0, -0.22], '', 1], ['sph', look.beret, [0.2, 1.9, -0.04], [0.14, 0.14, 0.14], 0, '', 0]);
  const hx = 0.34, hy = 0.42, hz = 0.16;
  if (look.item === 'bat') P.push(['box', 0xffd84d, [hx, hy + 0.3, hz + 0.2], [0.09, 0.95, 0.2], [0.8, 0, 0], 'armR', 1], ['box', 0x3a2416, [hx + 0.05, hy + 0.3, hz + 0.24], [0.02, 0.6, 0.04], [0.8, 0, 0], 'armR', 0]);
  if (look.item === 'pencil') P.push(['cyl', 0xffc83d, [hx, hy + 0.1, hz + 0.15], [0.08, 0.6, 0.08], [1.2, 0, 0], 'armR', 1], ['cone', 0xf5d7a1, [hx, hy + 0.2, hz + 0.45], [0.08, 0.14, 0.08], [1.2, 0, 0], 'armR', 0]);
  if (look.item === 'gun') P.push(['box', 0x5a6170, [hx, hy, hz + 0.2], [0.15, 0.17, 0.46], 0, 'armR', 1], ['box', 0x3a3f4a, [hx, hy - 0.13, hz + 0.08], [0.1, 0.18, 0.1], 0, 'armR', 0], ['box', 0xe2453a, [hx, hy + 0.09, hz + 0.1], [0.12, 0.04, 0.22], 0, 'armR', 0]);
  if (look.item === 'wand') P.push(['cyl', 0xffffff, [hx, hy + 0.15, hz + 0.15], [0.05, 0.6, 0.05], [0.9, 0, 0], 'armR', 0], ['tet', 0xffe14d, [hx, hy + 0.38, hz + 0.4], [0.32, 0.32, 0.32], [0.6, 0.4, 0.8], 'armR glow spin', 1], ['sph', 0xff8fb8, [hx, hy + 0.12, hz + 0.08], [0.1, 0.1, 0.1], 0, 'armR', 0]);
  if (look.item === 'tri') P.push(['box', 0x7fd8c8, [hx, hy + 0.2, hz + 0.25], [0.05, 0.5, 0.08], [0.9, 0, 0], 'armR', 1], ['box', 0x7fd8c8, [hx, hy + 0.02, hz + 0.38], [0.05, 0.08, 0.46], [0.9, 0, 0], 'armR', 1], ['box', 0x7fd8c8, [hx, hy + 0.2, hz + 0.44], [0.05, 0.62, 0.07], [1.6, 0, 0], 'armR', 0]);
  if (look.item === 'mop') P.push(['cyl', 0xc9a06a, [hx, hy + 0.4, hz + 0.05], [0.06, 1.5, 0.06], [0.25, 0, 0], 'armR', 1], ['box', 0x9fe0ff, [hx, hy - 0.32, hz - 0.14], [0.46, 0.14, 0.2], [0.25, 0, 0], 'armR', 1], ['box', 0xffffff, [hx, hy - 0.4, hz - 0.16], [0.5, 0.1, 0.24], [0.25, 0, 0], 'armR', 0]);
  if (look.item === 'plane') P.push(['cone', 0xffffff, [hx, hy + 0.34, hz + 0.24], [0.36, 0.56, 0.06], [1.3, 0, 0], 'armR', 1], ['box', 0xd8e8f0, [hx, hy + 0.3, hz + 0.2], [0.04, 0.12, 0.5], [-0.27, 0, 0], 'armR', 0]);
  if (look.item === 'slipper') P.push(['sph', 0xff7a5a, [hx, hy + 0.14, hz + 0.24], [0.26, 0.1, 0.5], [0.5, 0, 0], 'armR', 1], ['sph', 0xfff1a8, [hx, hy + 0.24, hz + 0.34], [0.28, 0.16, 0.28], [0.5, 0, 0], 'armR', 1]);
  if (look.item === 'blaster') P.push(['box', 0xff8fb8, [hx, hy, hz + 0.24], [0.2, 0.2, 0.5], 0, 'armR', 1], ['box', 0x4aa8ff, [hx, hy, hz + 0.02], [0.21, 0.21, 0.14], 0, 'armR', 0], ['box', 0x3a3f4a, [hx, hy - 0.15, hz + 0.1], [0.1, 0.16, 0.1], 0, 'armR', 0], ['box', 0xffffff, [hx, hy, hz + 0.5], [0.16, 0.16, 0.04], 0, 'armR', 0]);
  if (look.item === 'mug') P.push(['cyl', 0xffffff, [hx, hy + 0.1, hz + 0.2], [0.26, 0.28, 0.26], 0, 'armR', 1], ['cyl', 0x6a3f1e, [hx, hy + 0.25, hz + 0.2], [0.22, 0.02, 0.22], 0, 'armR', 0], ['tor', 0xffffff, [hx + 0.16, hy + 0.1, hz + 0.2], [0.14, 0.14, 0.2], 0, 'armR', 0], ['sph', 0xffffff, [hx, hy + 0.5, hz + 0.2], [0.1, 0.16, 0.1], 0, 'armR hover', 0]);
  if (look.item === 'sock') P.push(['cap', 0xf2f2e6, [hx, hy + 0.22, hz + 0.18], [0.16, 0.34, 0.16], 0, 'armR', 1], ['sph', 0x9ac84a, [hx, hy + 0.02, hz + 0.3], [0.18, 0.15, 0.32], 0, 'armR', 1], ['box', 0xe2453a, [hx, hy + 0.36, hz + 0.18], [0.17, 0.05, 0.17], 0, 'armR', 0]);
  if (look.item === 'book') P.push(['box', 0xc84a4a, [hx, hy + 0.1, hz + 0.2], [0.34, 0.44, 0.1], [0.3, 0.4, 0], 'armR', 1], ['box', 0xffffff, [hx + 0.02, hy + 0.1, hz + 0.2], [0.3, 0.4, 0.07], [0.3, 0.4, 0], 'armR', 0], ['box', 0xffc93c, [hx - 0.04, hy + 0.14, hz + 0.27], [0.18, 0.06, 0.02], [0.3, 0.4, 0], 'armR', 0]);
  if (look.item === 'lamp') P.push(['cyl', 0x3a3f4a, [hx, hy - 0.04, hz + 0.2], [0.24, 0.06, 0.24], 0, 'armR', 1], ['cyl', 0x3a3f4a, [hx, hy + 0.16, hz + 0.2], [0.04, 0.4, 0.04], 0, 'armR', 0], ['cone', 0xffd84d, [hx, hy + 0.42, hz + 0.26], [0.34, 0.26, 0.34], [0.5, 0, 0], 'armR', 1], ['sph', 0xfff6c0, [hx, hy + 0.34, hz + 0.32], [0.14, 0.14, 0.14], 0, 'armR glow', 0]);
  if (look.item === 'duck') P.push(['sph', 0xffd23f, [hx, hy + 0.06, hz + 0.2], [0.36, 0.28, 0.42], 0, 'armR', 1], ['sph', 0xffd23f, [hx, hy + 0.28, hz + 0.32], [0.24, 0.24, 0.24], 0, 'armR', 1], ['cone', 0xff8a2a, [hx, hy + 0.26, hz + 0.46], [0.1, 0.12, 0.08], [HP_, 0, 0], 'armR', 0], ['sph', 0x2a1a22, [hx + 0.07, hy + 0.32, hz + 0.41], [0.04, 0.04, 0.03], 0, 'armR', 0]);
  if (look.item === 'flag') P.push(['cyl', 0x7a5a40, [hx, hy + 0.35, hz], [0.05, 1.2, 0.05], 0, 'armR', 0], ['box', 0xff7eb6, [hx, hy + 0.78, hz - 0.22], [0.03, 0.32, 0.42], 0, 'armR flagw', 1]);
  return P;
}
const RIGS_DEF = {
  sleepy: [['sph', 0xe8dcff, [0, 0.42, 0], [1, 0.85, 0.95], 0, '', 1], ['cone', 0x7c6cff, [0.1, 0.95, -0.05], [0.45, 0.55, 0.45], [0, 0, -0.45], '', 1], ['sph', 0xffffff, [0.33, 1.13, -0.05], [0.17, 0.17, 0.17], 0, '', 1],
    ['box', 0x2a1a22, [-0.17, 0.5, 0.45], [0.17, 0.035, 0.03], [0, 0, 0.12], '', 0], ['box', 0x2a1a22, [0.17, 0.5, 0.45], [0.17, 0.035, 0.03], [0, 0, -0.12], '', 0],
    ['sph', 0xff7a8a, [0, 0.31, 0.46], [0.12, 0.13, 0.05], 0, 'yawn', 0], ['sph', 0xffb3c6, [-0.3, 0.38, 0.38], [0.12, 0.06, 0.04], 0, '', 0], ['sph', 0xffb3c6, [0.3, 0.38, 0.38], [0.12, 0.06, 0.04], 0, '', 0],
    ['sph', 0xd8c8f0, [-0.22, 0.06, 0.1], [0.28, 0.14, 0.32], 0, 'legL', 1], ['sph', 0xd8c8f0, [0.22, 0.06, 0.1], [0.28, 0.14, 0.32], 0, 'legR', 1]],
  cross: [['box', 0xff4d5e, [0, 0.66, 0], [0.24, 0.95, 0.24], [0, 0, 0.75], '', 1], ['box', 0xff4d5e, [0, 0.66, 0], [0.24, 0.95, 0.24], [0, 0, -0.75], '', 1],
    ...eyes(0.72, 0.13, 0.12, 0.18, 0.1), ...brows(0.88, 0.16, 0.13, 0.17, -0.45),
    ['cyl', 0x2a1a22, [-0.12, 0.13, 0], [0.06, 0.28, 0.06], 0, 'legL', 0], ['cyl', 0x2a1a22, [0.12, 0.13, 0], [0.06, 0.28, 0.06], 0, 'legR', 0],
    ['sph', 0x2a1a22, [-0.12, 0.02, 0.05], [0.15, 0.08, 0.22], 0, 'legL', 0], ['sph', 0x2a1a22, [0.12, 0.02, 0.05], [0.15, 0.08, 0.22], 0, 'legR', 0]],
  bat: [['sph', 0x6a4cff, [0, 1.2, 0], [0.55, 0.55, 0.5], 0, 'hover', 1], ['cone', 0x4a32c9, [-0.42, 1.25, 0], [0.32, 0.55, 0.1], [0, 0, HP_], 'hover flap', 1], ['cone', 0x4a32c9, [0.42, 1.25, 0], [0.32, 0.55, 0.1], [0, 0, -HP_], 'hover flap', 1],
    ['tor', 0xffd84d, [0, 1.66, -0.02], [0.24, 0.24, 0.3], 0, 'hover glow', 1], ['sph', 0xffd84d, [0, 1.47, 0], [0.08, 0.08, 0.08], 0, 'hover glow', 0],
    ...eyes(1.26, 0.2, 0.1, 0.14, 0.08, 'hover eye'), ['cone', 0xffffff, [-0.06, 1.06, 0.22], [0.05, 0.09, 0.05], [PI, 0, 0], 'hover', 0], ['cone', 0xffffff, [0.06, 1.06, 0.22], [0.05, 0.09, 0.05], [PI, 0, 0], 'hover', 0]],
  clock: [['cyl', 0xffc83d, [0, 0.62, 0], [0.9, 0.32, 0.9], [HP_, 0, 0], '', 1], ['cyl', 0xfffaf0, [0, 0.62, 0.17], [0.74, 0.03, 0.74], [HP_, 0, 0], '', 0], ['box', 0x2a1a22, [0.07, 0.62, 0.19], [0.03, 0.2, 0.02], [0, 0, -0.9], 'spin', 0],
    ['sph', 0xffc83d, [-0.27, 1.06, 0], [0.3, 0.24, 0.3], 0, 'ring', 1], ['sph', 0xffc83d, [0.27, 1.06, 0], [0.3, 0.24, 0.3], 0, 'ring', 1], ['box', 0x8a5a2b, [0, 1.08, 0], [0.45, 0.05, 0.05], 0, 'ring', 0],
    ...eyes(0.7, 0.2, 0.15, 0.17, 0.1), ['box', 0x2a1a22, [0, 0.46, 0.2], [0.18, 0.035, 0.02], 0, '', 0],
    ['cyl', 0x2a1a22, [-0.18, 0.12, 0], [0.06, 0.28, 0.06], 0, 'legL', 0], ['cyl', 0x2a1a22, [0.18, 0.12, 0], [0.06, 0.28, 0.06], 0, 'legR', 0], ['sph', 0x2a1a22, [-0.18, 0.02, 0.05], [0.15, 0.08, 0.22], 0, 'legL', 0], ['sph', 0x2a1a22, [0.18, 0.02, 0.05], [0.15, 0.08, 0.22], 0, 'legR', 0]],
  ink: [['sph', 0x5b6cf0, [0, 0.36, 0], [1.15, 0.75, 1.1], 0, 'squish', 1], ['cone', 0x5b6cf0, [0, 0.84, 0], [0.3, 0.36, 0.3], 0, 'squish', 1], ['sph', 0x5b6cf0, [0.38, 0.1, 0.35], [0.28, 0.2, 0.28], 0, 'legR', 0], ['sph', 0x5b6cf0, [-0.4, 0.1, -0.2], [0.24, 0.18, 0.24], 0, 'legL', 0],
    ['sph', 0xe6eaff, [-0.26, 0.56, 0.36], [0.16, 0.1, 0.06], 0, 'squish glow', 0], ...eyes(0.46, 0.44, 0.2, 0.25, 0.14, 'eye squish'), ['tor', 0x2a2f7a, [0, 0.24, 0.52], [0.16, 0.12, 0.2], 0, 'squish', 0]],
  ghost: [['sph', 0xf7f4ea, [0, 0.95, 0], [0.95, 1.0, 0.9], 0, 'hover', 1], ['cone', 0xf7f4ea, [0, 0.38, -0.08], [0.62, 0.55, 0.62], [PI, 0, 0], 'hover', 1], ['box', 0xe3dcc6, [0.22, 1.18, 0.22], [0.3, 0.26, 0.28], [0.5, 0.6, 0.2], 'hover', 0], ['box', 0xe3dcc6, [-0.26, 0.82, 0.18], [0.28, 0.24, 0.26], [0.3, -0.5, 0.4], 'hover', 0],
    ['box', 0x8aa0c8, [0.05, 0.72, 0.44], [0.36, 0.03, 0.02], 0, 'hover', 0], ['box', 0x8aa0c8, [0.0, 0.66, 0.43], [0.28, 0.03, 0.02], 0, 'hover', 0], ...eyes(0.98, 0.42, 0.16, 0.2, 0.12, 'hover eye'),
    ['sph', 0xf7f4ea, [-0.5, 0.82, 0.05], [0.22, 0.15, 0.15], 0, 'hover armL', 1], ['sph', 0xf7f4ea, [0.5, 0.82, 0.05], [0.22, 0.15, 0.15], 0, 'hover armR', 1]],
  phone: [['box', 0x26283a, [0, 0.88, 0], [0.82, 1.42, 0.18], 0, '', 1], ['box', 0x5fd3ff, [0, 0.9, 0.095], [0.7, 1.16, 0.02], 0, 'glow', 0], ['sph', 0x0b1630, [-0.15, 1.05, 0.11], [0.14, 0.2, 0.04], 0, 'eye', 0], ['sph', 0x0b1630, [0.15, 1.05, 0.11], [0.14, 0.2, 0.04], 0, 'eye', 0],
    ['tor', 0x0b1630, [0, 0.78, 0.11], [0.2, 0.1, 0.1], 0, '', 0], ['sph', 0xff3b4f, [0.4, 1.58, 0.06], [0.26, 0.26, 0.26], 0, 'pulse glow', 1], ['cap', 0x26283a, [-0.5, 0.86, 0], [0.12, 0.22, 0.12], 0, 'armL', 1], ['cap', 0x26283a, [0.5, 0.86, 0], [0.12, 0.22, 0.12], 0, 'armR', 1], ...legs(0x26283a, 0.18, 0.2, 0.14)],
  snail: [['cap', 0x9fd38a, [0, 0.2, 0.1], [0.55, 0.75, 0.5], [HP_, 0, 0], 'squish', 1], ['sph', 0xc98a4b, [0, 0.66, -0.2], [0.98, 0.98, 0.82], 0, '', 1], ['tor', 0x8a5a2b, [0.42, 0.66, -0.2], [0.55, 0.55, 0.55], [0, HP_, 0], '', 0], ['tor', 0x8a5a2b, [0.43, 0.66, -0.2], [0.25, 0.25, 0.3], [0, HP_, 0], '', 0],
    ['sph', 0x9fd38a, [0, 0.48, 0.55], [0.44, 0.44, 0.44], 0, '', 1], ['cyl', 0x9fd38a, [-0.1, 0.78, 0.6], [0.05, 0.36, 0.05], [0.15, 0, 0.15], '', 0], ['cyl', 0x9fd38a, [0.1, 0.78, 0.6], [0.05, 0.36, 0.05], [0.15, 0, -0.15], '', 0],
    ['sph', 0xffffff, [-0.13, 0.98, 0.63], [0.17, 0.17, 0.17], 0, 'eye', 1], ['sph', 0xffffff, [0.13, 0.98, 0.63], [0.17, 0.17, 0.17], 0, 'eye', 1], ['sph', 0x1a1020, [-0.13, 0.96, 0.71], [0.08, 0.06, 0.04], 0, 'eye', 0], ['sph', 0x1a1020, [0.13, 0.96, 0.71], [0.08, 0.06, 0.04], 0, 'eye', 0], ['box', 0x3a6a2a, [0, 0.42, 0.77], [0.14, 0.03, 0.02], 0, '', 0]],
  hourglass: [['cone', 0xd6f0ff, [0, 1.55, 0], [1.0, 0.9, 1.0], [PI, 0, 0], '', 1], ['cone', 0xd6f0ff, [0, 0.75, 0], [1.0, 0.9, 1.0], 0, '', 1], ['cone', 0xf2c46d, [0, 1.47, 0], [0.72, 0.5, 0.72], [PI, 0, 0], 'sandtop glow', 0], ['cyl', 0xf2c46d, [0, 0.46, 0], [0.86, 0.26, 0.86], 0, 'glow', 0],
    ['cyl', 0x8a5a2b, [0, 2.05, 0], [1.0, 0.14, 1.0], 0, '', 1], ['cyl', 0x8a5a2b, [0, 0.27, 0], [1.0, 0.14, 1.0], 0, '', 1], ...eyes(1.6, 0.36, 0.2, 0.22, 0.12), ...brows(1.78, 0.4, 0.2, 0.22, -0.5), ['box', 0xe2453a, [0, 1.72, 0.0], [0.5, 0.18, 0.02], 0, '', 0],
    ['cap', 0x8a5a2b, [-0.78, 1.2, 0], [0.18, 0.4, 0.18], [0, 0, 0.3], 'armL', 1], ['cap', 0x8a5a2b, [0.78, 1.2, 0], [0.18, 0.4, 0.18], [0, 0, -0.3], 'armR', 1], ...legs(0x8a5a2b, 0.32, 0.22, 0.2)],
  boss: [['box', 0x8b1e3f, [0, 1.2, 0], [1.7, 2.0, 0.52], 0, '', 1], ['box', 0xfffaf0, [0, 1.2, 0.04], [1.58, 1.88, 0.46], 0, '', 0], ['box', 0x8b1e3f, [0, 2.2, 0.08], [1.7, 0.14, 0.9], [-0.25, 0, 0], 'jaw', 1],
    ['cone', 0xffffff, [-0.5, 2.0, 0.34], [0.14, 0.22, 0.14], [PI, 0, 0], 'jaw', 0], ['cone', 0xffffff, [-0.17, 2.0, 0.34], [0.14, 0.22, 0.14], [PI, 0, 0], 'jaw', 0], ['cone', 0xffffff, [0.17, 2.0, 0.34], [0.14, 0.22, 0.14], [PI, 0, 0], 'jaw', 0], ['cone', 0xffffff, [0.5, 2.0, 0.34], [0.14, 0.22, 0.14], [PI, 0, 0], 'jaw', 0],
    ...eyes(1.45, 0.27, 0.36, 0.4, 0.2, 'eye glow', 0xff2a4a), ...brows(1.76, 0.3, 0.36, 0.42, -0.4), ['box', 0xe2453a, [0, 0.9, 0.28], [0.9, 0.06, 0.02], 0, '', 0], ['box', 0x8aa0c8, [0, 0.75, 0.28], [1.1, 0.04, 0.02], 0, '', 0], ['box', 0x8aa0c8, [0, 0.62, 0.28], [1.0, 0.04, 0.02], 0, '', 0],
    ['cone', 0xffd84d, [0, 2.55, 0], [0.55, 0.4, 0.55], 0, 'jaw glow', 1], ['cap', 0x8b1e3f, [-1.05, 1.1, 0], [0.32, 0.5, 0.32], [0, 0, 0.25], 'armL', 1], ['cap', 0x8b1e3f, [1.05, 1.1, 0], [0.32, 0.5, 0.32], [0, 0, -0.25], 'armR', 1], ...legs(0x8b1e3f, 0.48, 0.3, 0.34)],
  minion: [['box', 0xffe14d, [0, 0.5, 0], [0.62, 0.62, 0.1], 0, 'tint', 1], ['box', 0xffd000, [0, 0.77, 0.02], [0.62, 0.08, 0.11], 0, 'tint', 0], ...eyes(0.55, 0.06, 0.11, 0.13, 0.08), ...brows(0.66, 0.08, 0.11, 0.11, -0.4),
    ['cyl', 0x2a1a22, [-0.12, 0.12, 0], [0.04, 0.24, 0.04], 0, 'legL', 0], ['cyl', 0x2a1a22, [0.12, 0.12, 0], [0.04, 0.24, 0.04], 0, 'legR', 0], ['cyl', 0xffc83d, [0.36, 0.5, 0.1], [0.05, 0.42, 0.05], [1.0, 0, 0], 'armR swing', 1]],
  lamp: [['cyl', 0x3a3f4a, [0, 0.06, 0], [0.8, 0.12, 0.8], 0, '', 1], ['cyl', 0x3a3f4a, [0, 0.5, 0], [0.08, 0.8, 0.08], [0, 0, 0.2], '', 0], ['cone', 0x3faa6a, [0.12, 0.98, 0.15], [0.55, 0.42, 0.55], [-0.6, 0, 0], '', 1], ['sph', 0xfff1a8, [0.12, 0.86, 0.3], [0.24, 0.24, 0.24], 0, 'glow', 0], ...eyes(1.02, 0.36, 0.1, 0.11, 0.07)],
  pencilP: [['cyl', 0xffc83d, [0, 0, 0], [0.12, 0.7, 0.12], [HP_, 0, 0], '', 1], ['cone', 0xf5d7a1, [0, 0, 0.45], [0.12, 0.2, 0.12], [HP_, 0, 0], '', 0], ['cone', 0x2a1a22, [0, 0, 0.53], [0.05, 0.06, 0.05], [HP_, 0, 0], '', 0], ['cyl', 0xff9aa8, [0, 0, -0.39], [0.12, 0.1, 0.12], [HP_, 0, 0], '', 0]],
  planeP: [['tet', 0xffffff, [0, 0, 0], [0.5, 0.2, 1.0], [0, PI / 4, 0], '', 1]],
  staple: [['box', 0xdfe6ef, [0, 0, 0], [0.22, 0.06, 0.06], 0, 'glow', 0], ['box', 0xdfe6ef, [-0.1, 0, -0.07], [0.04, 0.06, 0.16], 0, 'glow', 0], ['box', 0xdfe6ef, [0.1, 0, -0.07], [0.04, 0.06, 0.16], 0, 'glow', 0]],
  eraser: [['box', 0xff8fb1, [0, 0, 0], [0.3, 0.16, 0.2], 0, 'tint', 1]],
  ruler: [['box', 0xffd84d, [0, 0, 0], [1.6, 0.06, 0.32], 0, '', 1], ['box', 0xfff3b8, [0, 0.035, -0.08], [1.52, 0.01, 0.1], 0, '', 0], ...Array.from({ length: 11 }, (_, k) => ['box', 0x3a2416, [-0.7 + k * 0.14, 0.036, 0.1], [0.018, 0.01, k % 5 === 0 ? 0.12 : 0.07], 0, '', 0]), ['cyl', 0x3a2416, [0.7, 0.036, -0.08], [0.07, 0.01, 0.07], 0, '', 0]],
  paper: [['sph', 0xf7f4ea, [0, 0, 0], [0.42, 0.38, 0.4], 0, '', 1], ['box', 0xe3dcc6, [0.08, 0.08, 0], [0.2, 0.2, 0.2], [0.5, 0.5, 0], '', 0]],
  chest: [['box', 0x7a3a22, [0, 0.35, 0], [1.0, 0.6, 0.7], 0, '', 1], ['box', 0x5a2a18, [0, 0.72, 0], [1.04, 0.22, 0.74], 0, 'lid', 1], ['box', 0xffd23f, [0, 0.5, 0.36], [0.2, 0.26, 0.06], 0, 'glow', 1], ['box', 0xffd23f, [0, 0.35, 0], [1.06, 0.1, 0.76], 0, 'glow', 0]],
  gem: [['tet', 0x5fe08a, [0, 0, 0], [0.26, 0.34, 0.26], 0, 'glow', 0]],
  gem2: [['tet', 0x4aa8ff, [0, 0.05, 0], [0.4, 0.54, 0.4], 0, 'glow', 1], ['sph', 0xffffff, [0.08, 0.16, 0.1], [0.1, 0.1, 0.06], 0, '', 0]],
  gem3: [['tet', 0xffc93c, [0, 0.12, 0], [0.6, 0.8, 0.6], 0, 'glow', 1], ['tet', 0xfff3b8, [0, 0.12, 0], [0.3, 0.4, 0.3], [0.6, 0.8, 0], 'glow spin', 0], ['tor', 0xff8a2a, [0, 0.1, 0], [0.9, 0.9, 0.5], [HP_, 0, 0], 'glow spin', 0]],
  bomber: [['cone', 0xffe4d8, [0, 0.98, 0], [0.82, 0.6, 0.82], [PI, 0, 0], '', 1], ['cone', 0xffe4d8, [0, 0.44, 0], [0.82, 0.6, 0.82], 0, '', 1], ['cone', 0xff5a2a, [0, 0.92, 0], [0.56, 0.34, 0.56], [PI, 0, 0], 'glow', 0], ['cyl', 0xff5a2a, [0, 0.26, 0], [0.68, 0.18, 0.68], 0, 'glow', 0],
    ['cyl', 0x8a5a3a, [0, 1.32, 0], [0.75, 0.1, 0.75], 0, '', 1], ['cyl', 0x8a5a3a, [0, 0.12, 0], [0.75, 0.1, 0.75], 0, '', 1], ['cyl', 0x2a1a1a, [0.08, 1.52, 0], [0.06, 0.38, 0.06], [0, 0, -0.35], '', 0], ['sph', 0xffd84d, [0.16, 1.72, 0], [0.18, 0.18, 0.18], 0, 'glow pulse', 0],
    ...eyes(1.0, 0.33, 0.14, 0.17, 0.1), ...brows(1.16, 0.36, 0.15, 0.17, -0.6), ['box', 0x2a1a22, [0, 0.8, 0.3], [0.16, 0.035, 0.02], 0, '', 0], ...legs(0x3a2a2a, 0.22, 0.14, 0.14)],
  slipperP: [['box', 0xff7a5a, [0, 0, 0], [0.46, 0.09, 0.95], 0, '', 1], ['box', 0xffffff, [0, 0.07, 0.08], [0.4, 0.05, 0.14], 0, '', 0], ['box', 0x3a6ad8, [0, 0.07, 0.2], [0.42, 0.06, 0.08], 0, '', 0]],
  duck: [['sph', 0xffd23f, [0, 0.36, 0], [0.78, 0.62, 0.9], 0, '', 1], ['sph', 0xffd23f, [0, 0.84, 0.2], [0.52, 0.5, 0.5], 0, '', 1], ['cone', 0xff8a2a, [0, 0.8, 0.52], [0.2, 0.26, 0.12], [HP_, 0, 0], '', 1],
    ['sph', 0x2a1a22, [-0.13, 0.92, 0.4], [0.09, 0.12, 0.06], 0, 'eye', 0], ['sph', 0x2a1a22, [0.13, 0.92, 0.4], [0.09, 0.12, 0.06], 0, 'eye', 0], ['sph', 0xff9ab0, [-0.2, 0.8, 0.38], [0.1, 0.05, 0.04], 0, '', 0], ['sph', 0xff9ab0, [0.2, 0.8, 0.38], [0.1, 0.05, 0.04], 0, '', 0],
    ['sph', 0xffe98a, [0.34, 0.42, -0.05], [0.2, 0.3, 0.46], [0, 0, -0.4], 'flap', 0], ['sph', 0xffe98a, [-0.34, 0.42, -0.05], [0.2, 0.3, 0.46], [0, 0, 0.4], 'flap', 0], ['cone', 0xffd23f, [0, 0.5, -0.44], [0.26, 0.3, 0.2], [-1.1, 0, 0], '', 0]],
  bookP: [['box', 0xc84a4a, [0, 0, 0], [0.95, 0.24, 1.25], 0, '', 1], ['box', 0xfaf6ea, [0.06, 0, 0], [0.86, 0.18, 1.16], 0, '', 0], ['box', 0xffd84d, [-0.2, 0.125, 0], [0.08, 0.01, 1.05], 0, '', 0]],
};
Object.assign(RIGS_DEF, {
  chalk: [['cyl', 0xfafafa, [0, 0.78, 0], [0.52, 1.1, 0.52], 0, '', 1], ['cyl', 0xffa8c0, [0, 1.36, 0], [0.53, 0.14, 0.53], 0, '', 0], ...eyes(0.95, 0.22, 0.12, 0.17, 0.1), ...brows(1.1, 0.25, 0.12, 0.15, -0.4), ['box', 0x2a1a22, [0, 0.74, 0.26], [0.12, 0.03, 0.02], 0, '', 0],
    ['cap', 0xfafafa, [-0.34, 0.7, 0], [0.11, 0.2, 0.11], 0, 'armL', 1], ['cap', 0xfafafa, [0.34, 0.7, 0.1], [0.11, 0.2, 0.11], [0.9, 0, 0], 'armR', 1],
    ['cyl', 0x8a5a2b, [0.36, 0.8, 0.32], [0.05, 0.3, 0.05], 0, 'armR', 0], ['cyl', 0x8a5a2b, [0.29, 0.98, 0.32], [0.04, 0.2, 0.04], [0, 0, 0.6], 'armR', 0], ['cyl', 0x8a5a2b, [0.43, 0.98, 0.32], [0.04, 0.2, 0.04], [0, 0, -0.6], 'armR', 0], ...legs(0x2a1a22, 0.13, 0.22, 0.12)],
  chalkP: [['cyl', 0xfafafa, [0, 0, 0], [0.16, 0.62, 0.16], [HP_, 0, 0], '', 1], ['cyl', 0xffa8c0, [0, 0, 0.3], [0.165, 0.1, 0.165], [HP_, 0, 0], 'glow', 0]],
  mole: [['sph', 0x9a8272, [0, 0.46, 0], [1.0, 0.88, 1.0], 0, '', 1], ['sph', 0xe8d8c4, [0, 0.36, 0.2], [0.7, 0.6, 0.7], 0, '', 0], ['sph', 0xff8fa3, [0, 0.5, 0.52], [0.18, 0.14, 0.14], 0, '', 0], ['box', 0xffffff, [0, 0.36, 0.5], [0.14, 0.12, 0.04], 0, '', 0],
    ...eyes(0.62, 0.42, 0.17, 0.13, 0.09), ['sph', 0xffc93c, [0, 0.82, -0.02], [0.82, 0.5, 0.82], 0, '', 1], ['box', 0xffc93c, [0, 0.78, 0.36], [0.5, 0.06, 0.24], 0, '', 0], ['sph', 0xfff1a8, [0, 0.95, 0.34], [0.16, 0.16, 0.12], 0, 'glow', 0],
    ['cone', 0xf2e6d8, [-0.5, 0.36, 0.2], [0.22, 0.34, 0.14], [1.3, 0, 0.5], 'armL', 1], ['cone', 0xf2e6d8, [0.5, 0.36, 0.2], [0.22, 0.34, 0.14], [1.3, 0, -0.5], 'armR', 1], ['sph', 0x7a6456, [-0.22, 0.06, 0.1], [0.26, 0.13, 0.3], 0, 'legL', 0], ['sph', 0x7a6456, [0.22, 0.06, 0.1], [0.26, 0.13, 0.3], 0, 'legR', 0]],
  mound: [['sph', 0xa87848, [0, 0.02, 0], [1.2, 0.6, 1.2], 0, '', 1], ['sph', 0x8a5a34, [0.3, 0.2, 0.2], [0.3, 0.24, 0.3], 0, '', 0], ['sph', 0x8a5a34, [-0.32, 0.16, -0.1], [0.26, 0.2, 0.26], 0, '', 0], ['sph', 0xc8a070, [-0.05, 0.27, 0.1], [0.3, 0.14, 0.24], 0, '', 0]],
  vac: [['box', 0x4a6ad8, [0, 0.3, 0], [0.95, 0.12, 0.68], 0, '', 1], ['box', 0xffffff, [0, 0.38, 0], [0.84, 0.07, 0.6], 0, '', 0], ['sph', 0x7fe0ff, [0, 0.95, 0], [0.42, 0.42, 0.42], 0, 'glow pulse', 0], ['tor', 0x7fe0ff, [0, 0.95, 0], [0.8, 0.8, 0.5], [HP_, 0, 0], 'glow', 0]],
  altar: [['cyl', 0xe8dcc4, [0, 0.2, 0], [1.5, 0.4, 1.5], 0, '', 1], ['cyl', 0xfff3d0, [0, 0.55, 0], [1.1, 0.3, 1.1], 0, '', 1], ['tet', 0xffc93c, [0, 1.5, 0], [0.7, 0.9, 0.7], 0, 'glow hover', 1], ['tor', 0xffe07a, [0, 0.78, 0], [1.0, 1.0, 0.4], [HP_, 0, 0], 'glow', 0]],
});
// 自爆闹钟：大号红色闹钟，头顶一颗会闪的灯，凶眉毛
RIGS_DEF.bomber = RIGS_DEF.clock.map((p) => { const q = p.slice(); if (q[1] === 0xffc83d) q[1] = 0xe2453a; return q; }).concat([
  ['sph', 0xffe14d, [0, 1.3, 0], [0.2, 0.2, 0.2], 0, 'glow pulse', 1], ['cyl', 0x2a1a22, [0, 1.18, 0], [0.06, 0.16, 0.06], 0, '', 0],
  ...brows(0.88, 0.21, 0.15, 0.17, 0.55), ['cyl', 0x2a1a22, [0, 0.62, -0.02], [0.96, 0.1, 0.96], [HP_, 0, 0], '', 0],
  ['box', 0xffe14d, [0, 0.34, 0.2], [0.3, 0.1, 0.02], 0, 'glow', 0], ['cap', 0x8a2a2a, [-0.26, 0.14, 0], [0.16, 0.2, 0.16], 0, 'legL', 1], ['cap', 0x8a2a2a, [0.26, 0.14, 0], [0.16, 0.2, 0.16], 0, 'legR', 1],
]);
RIGS_DEF.cup = [['cyl', 0xffffff, [0, 0, 0], [0.4, 0.44, 0.4], 0, '', 1], ['cyl', 0x6a3f1e, [0, 0.21, 0], [0.34, 0.04, 0.34], 0, '', 0], ['tor', 0xffffff, [0.24, 0, 0], [0.2, 0.2, 0.3], 0, '', 0]];
RIGS_DEF.sockP = [['cap', 0xf2f2e6, [0, 0.16, 0], [0.2, 0.42, 0.2], 0, '', 1], ['sph', 0x9ac84a, [0, -0.08, 0.14], [0.22, 0.18, 0.4], 0, '', 1], ['box', 0xe2453a, [0, 0.32, 0], [0.21, 0.06, 0.21], 0, '', 0], ['sph', 0x9ac84a, [0, 0.7, 0], [0.1, 0.16, 0.1], 0, 'hover glow', 0]];
for (const id in CLASSES) RIGS_DEF['hero_' + id] = heroParts(CLASSES[id].look);
const RIG_CAP = { cup: 8, sockP: 6, gem2: 420, gem3: 160, sleepy: 260, cross: 300, bat: 220, clock: 120, ink: 260, ghost: 100, phone: 90, snail: 60, hourglass: 6, boss: 1, minion: 24, lamp: 6, pencilP: 400, planeP: 120, staple: 500, eraser: 260, ruler: 48, paper: 100, chest: 12, gem: 600, bomber: 160, slipperP: 40, duck: 12, bookP: 12, chalk: 90, chalkP: 80, mole: 60, mound: 60, vac: 6, altar: 4 };
const tP = new THREE.Vector3(), tQ = new THREE.Quaternion(), tS = new THREE.Vector3(), tE = new THREE.Euler();
const wP = new THREE.Vector3(), wQ = new THREE.Quaternion(), wS = new THREE.Vector3(), wE = new THREE.Euler(0, 0, 0, 'YXZ');
const PM = new THREE.Matrix4(), WM = new THREE.Matrix4(), CM = new THREE.Matrix4(), OM = new THREE.Matrix4();
const OUT_S = new THREE.Matrix4().makeScale(1.15, 1.15, 1.15);
const REDC = new THREE.Color(1.5, 0.15, 0.1), ICEC = new THREE.Color(0.6, 0.9, 1.3), ACIDC = new THREE.Color(0.5, 1.0, 0.2);
const WHITE = new THREE.Color(1, 1, 1), ORANGE = new THREE.Color(1.6, 0.6, 0.15), tC = new THREE.Color(), tC2 = new THREE.Color();
let realTime = 0;
function partMatrix(pt, e) {
  const p = pt[2], s = pt[3], r = pt[4] || [0, 0, 0], k = pt[5] || '';
  let px = p[0], py = p[1], pz = p[2], sx = s[0], sy = s[1], sz = s[2], rx = r[0], ry = r[1], rz = r[2];
  const ph = e.ph || 0, t = realTime + (e.seed || 0) * 7, st = Math.sin(ph), mv = e.moving ?? 1;
  if (k.includes('legL') || k.includes('legR')) { const g = k.includes('legL') ? 1 : -1; pz += st * 0.14 * g * mv; py += Math.max(0, Math.cos(ph) * g) * 0.06 * mv; }
  else py += Math.abs(st) * 0.06 * mv;
  if (k.includes('armL') || k.includes('armR')) { const g = k.includes('armL') ? -1 : 1; pz += st * 0.09 * g * mv; }
  if (k.includes('swing') && e.swing > 0) { rx -= Math.sin(e.swing * PI) * 2.0; ry += Math.sin(e.swing * PI) * 1.2; }
  if (k.includes('eye') && t % 3.3 < 0.12) sy *= 0.15;
  if (k.includes('hover')) py += Math.sin(t * 3) * 0.12;
  if (k.includes('flap')) rz += Math.sin(t * 16) * 0.7 * (px < 0 ? -1 : 1);
  if (k.includes('jaw')) { const a = Math.abs(Math.sin(t * 3.5)) * 0.18; py += a; rx -= a * 1.6; }
  if (k.includes('pulse')) { const q = 1 + Math.max(0, Math.sin(t * 6)) * 0.3; sx *= q; sy *= q; sz *= q; }
  if (k.includes('ring') && e.ringing) rz += Math.sin(t * 70) * 0.35;
  if (k.includes('spin')) rz -= t * 2;
  if (k.includes('yawn')) sy *= 0.5 + 0.7 * Math.max(0, Math.sin(t * 1.3));
  if (k.includes('squish')) { const q = Math.sin(t * 5) * 0.06; sx *= 1 + q; sy *= 1 - q; }
  if (k.includes('flagw')) rz += Math.sin(t * 8) * 0.25;
  if (k.includes('sway')) { rz += Math.sin(t * 3 + px * 2) * 0.08 + Math.sin(ph) * 0.05 * mv; rx += Math.cos(t * 2.6) * 0.04; }
  if (k.includes('sandtop')) { const f = 0.6 + 0.4 * Math.cos(t * 0.2); sx *= f; sz *= f; }
  if (k.includes('lid')) { rx -= Math.abs(Math.sin(t * 2.5)) * 0.25; pz -= Math.abs(Math.sin(t * 2.5)) * 0.08; }
  tQ.setFromEuler(tE.set(rx, ry, rz));
  return PM.compose(tP.set(px, py, pz), tQ, tS.set(sx, sy, sz));
}
class Rig {
  constructor(parts, cap) {
    this.n = 0; this.cap = cap;
    this.parts = parts.map((pt) => {
      const m = new THREE.InstancedMesh(GEO[pt[0]], toonMat, cap); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = 0; m.setColorAt(0, WHITE); scene.add(m);
      let ol = null; if (pt[6]) { ol = new THREE.InstancedMesh(GEO[pt[0]], outlineMat, cap); ol.instanceMatrix.setUsage(THREE.DynamicDrawUsage); ol.frustumCulled = false; ol.count = 0; scene.add(ol); }
      const k = pt[5] || '';
      return { pt, m, ol, color: new THREE.Color(pt[1]), glow: k.includes('glow'), tint: k.includes('tint') };
    });
  }
  push(e, world) {
    if (this.n >= this.cap) return; const i = this.n++;
    for (const P of this.parts) {
      CM.multiplyMatrices(world, partMatrix(P.pt, e)); P.m.setMatrixAt(i, CM);
      tC.copy(P.tint && e.tint ? e.tint : P.color); if (e.etint) tC.lerp(e.etint, 0.72).multiplyScalar(1.3);
      if (P.glow) tC.multiplyScalar(e.glowMul || 2.6);
      if (e.burn > 0) tC.lerp(ORANGE, 0.6 + 0.25 * Math.sin(realTime * 20 + i));
      if (e.hit) tC.lerp(WHITE, Math.min(1, e.hit) * 0.85);
      if (e.dark) tC.multiplyScalar(0.035);
      if (e.warn) tC.lerp(REDC, e.warn); if (e.frz > 0) tC.lerp(ICEC, 0.85); else { if (e.chill > 0) tC.lerp(ICEC, 0.55); if (e.acid > 0) tC.lerp(ACIDC, 0.62 + 0.12 * Math.sin(realTime * 9)); }
      P.m.setColorAt(i, tC);
      if (P.ol) { OM.multiplyMatrices(CM, OUT_S); P.ol.setMatrixAt(i, OM); }
    }
  }
  end() {
    for (const P of this.parts) { P.m.count = this.n; P.m.instanceMatrix.needsUpdate = true; if (P.m.instanceColor) P.m.instanceColor.needsUpdate = true; if (P.ol) { P.ol.count = this.n; P.ol.instanceMatrix.needsUpdate = true; } }
    this.n = 0;
  }
}
const RIGS = {}; for (const id in RIGS_DEF) RIGS[id] = new Rig(RIGS_DEF[id], RIG_CAP[id] ?? (id.startsWith('hero_') ? 4 : 1));
const RIG_OF = (type) => type === 'inkmini' ? 'ink' : type;
function worldM(x, y, z, yaw, sx, sy = sx, sz = sx, pitch = 0, roll = 0) { wE.set(pitch, yaw, roll, 'YXZ'); wQ.setFromEuler(wE); return WM.compose(wP.set(x, y, z), wQ, wS.set(sx, sy, sz)); }

/* ================= 放学后的教室 ================= */
const MK = document.createElement('canvas'); MK.width = MK.height = 1024; const mctx = MK.getContext('2d');
const markTex = new THREE.CanvasTexture(MK);
let marksDirty = false, marksClock = 0, fadeClock = 0;
const MS = 1024 / 96; const mk = (x, z) => [(x + 48) * MS, (z + 48) * MS];
function blot(x, z, r, color, n = 1, spread = 0) { const [cx, cz] = mk(x, z); mctx.fillStyle = color; for (let i = 0; i < n; i++) { const a = Math.random() * TAU, d = Math.random() * spread * MS; mctx.beginPath(); mctx.ellipse(cx + Math.cos(a) * d, cz + Math.sin(a) * d, r * MS * rnd(0.6, 1.1), r * MS * rnd(0.6, 1.1), rnd(0, 3), 0, TAU); mctx.fill(); } marksDirty = true; }
function ringMark(x, z, r, color, w = 4) { const [cx, cz] = mk(x, z); mctx.strokeStyle = color; mctx.lineWidth = w; mctx.beginPath(); mctx.arc(cx, cz, r * MS, 0, TAU); mctx.stroke(); marksDirty = true; }
function footprint(x, z, yaw, side) { const ox = Math.cos(yaw) * 0.16 * side, oz = -Math.sin(yaw) * 0.16 * side; const [cx, cz] = mk(x + ox, z + oz); mctx.save(); mctx.translate(cx, cz); mctx.rotate(-yaw); mctx.fillStyle = 'rgba(70,44,24,.14)'; mctx.beginPath(); mctx.ellipse(0, 0, 2.6, 4.2, 0, 0, TAU); mctx.fill(); mctx.restore(); marksDirty = true; }
const RIPS = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -100, 0));
const BRAZ = [[-38.6, -32.6], [38.6, -32.6], [-38.6, 32.6], [38.6, 32.6], [-2.4, -32.6], [2.4, -32.6], [-2.4, 32.6], [2.4, 32.6]];
const SNOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;} vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);} vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){ const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
 vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx); vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
 vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy; i=mod289(i);
 vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
 float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx; vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
 vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y); vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
 vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0)); vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
 vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
 vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3))); p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
 vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m; return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3))); }`;
const sandMat = new THREE.ShaderMaterial({
  uniforms: { uMarks: { value: markTex }, uTime, uRip: { value: RIPS }, uPlayer: { value: new THREE.Vector3() }, uBraz: { value: BRAZ.map(([x, z]) => new THREE.Vector2(x, z)) }, uTorch: { value: 1 } },
  vertexShader: `varying vec3 vW; varying vec2 vUv; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
  fragmentShader: SNOISE + `
  uniform sampler2D uMarks; uniform float uTime; uniform vec4 uRip[8]; uniform vec3 uPlayer; uniform vec2 uBraz[8]; uniform float uTorch; varying vec3 vW; varying vec2 vUv;
  void main(){
    vec2 p=vW.xz;
    // 木地板：0.9 宽的长条，错缝，木纹 + 小节疤
    float bw=0.9; float row=floor(p.y/bw); float off=fract(sin(row*91.7)*437.5)*4.0;
    float bx=(p.x+off)/4.0; float bid=floor(bx); float fx=fract(bx), fz=fract(p.y/bw);
    float tr=fract(sin(dot(vec2(bid,row),vec2(12.9898,78.233)))*43758.5453);
    float seam=min(min(fz,1.0-fz)*bw,min(fx,1.0-fx)*4.0);
    float grain=snoise(vec3(p.x*0.5,p.y*7.0+tr*20.0,tr*5.0))*0.5+0.5;
    float knots=smoothstep(0.78,0.95,snoise(vec3(p*0.8,tr*3.0))*0.5+0.5);
    vec3 base=mix(vec3(0.83,0.62,0.4),vec3(0.9,0.7,0.47),tr);
    base*=0.95+0.06*grain; base*=1.0-knots*0.07;
    base*=1.0-smoothstep(0.035,0.0,seam)*0.22;
    // 中间一块圆地毯
    vec2 rp=vec2(abs(p.x)-20.3,abs(p.y)-19.8); float rr=length(rp); float th=atan(rp.y,rp.x); float sc=6.7+0.2*cos(th*26.0); float rug=smoothstep(sc+0.04,sc-0.04,rr);
    vec3 rugc=vec3(0.99,0.95,0.86);
    rugc=mix(rugc,vec3(1.0,0.56,0.5),smoothstep(0.62,0.56,sc-rr));
    float band=smoothstep(4.95,5.0,rr)*smoothstep(5.45,5.4,rr); rugc=mix(rugc,vec3(0.5,0.8,0.76),band*step(0.3,fract(th/6.28318*20.0)));
    float pet=smoothstep(0.05,-0.05,rr-(2.3+0.75*cos(th*8.0))); rugc=mix(rugc,vec3(1.0,0.83,0.42),pet);
    rugc=mix(rugc,vec3(1.0,0.6,0.52),smoothstep(1.05,0.98,rr)); rugc=mix(rugc,vec3(1.0),smoothstep(0.42,0.38,rr));
    rugc=mix(rugc,vec3(0.23,0.13,0.16),smoothstep(0.07,0.02,abs(sc-rr))*0.8);
    rugc*=mix(vec3(1.0),vec3(0.88,0.97,1.1),step(0.0,p.x)); rugc*=mix(vec3(1.0),vec3(1.06,1.0,0.86),step(0.0,p.y));
    base=mix(base,rugc*(0.8+0.04*grain),rug);
    // 走廊：浅色方砖
    float cor=step(abs(p.y),5.0); vec2 tl=floor(p/2.5); vec2 tf=fract(p/2.5); float ck=mod(tl.x+tl.y,2.0);
    vec3 tile=mix(vec3(0.9,0.92,0.86),vec3(0.72,0.84,0.8),ck); tile*=1.0-smoothstep(0.03,0.0,min(min(tf.x,1.0-tf.x),min(tf.y,1.0-tf.y)))*0.2; tile*=0.96+0.05*grain;
    float stripe=smoothstep(0.5,0.42,abs(abs(p.y)-4.2)); tile=mix(tile,vec3(0.98,0.74,0.36),stripe*0.85);
    base=mix(base,tile,cor);
    vec4 mkc=texture2D(uMarks,vec2((p.x+48.0)/96.0,1.0-(p.y+48.0)/96.0)); base=mix(base,mkc.rgb,mkc.a);
    vec3 light=vec3(1.0,0.96,0.9)*0.72;
    // 西墙窗户投下来的斜阳光斑
    float dx=p.x+43.0; float pz=p.y+dx*0.35; float lw=mod(pz+22.0+7.0,14.0)-7.0;
    float pane=step(abs(lw),3.6)*step(0.18,abs(lw))*step(0.18,abs(fract(dx*0.12)-0.5)*8.0);
    light+=vec3(1.0,0.86,0.6)*0.42*pane*exp(-dx/26.0);
    float dp=length(p-uPlayer.xz); light+=vec3(1.0,0.85,0.6)*0.12*exp(-dp*dp/30.0)*uTorch;
    float rip=0.0; for(int i=0;i<8;i++){ vec4 r=uRip[i]; float age=uTime-r.z; if(age<0.0||age>1.0) continue; float L=length(p-r.xy); rip+=exp(-pow((L-age*9.0)*1.3,2.0))*(1.0-age)*r.w; }
    light+=vec3(1.0,0.85,0.5)*min(rip,1.0)*0.4;
    vec3 col=base*light*1.25;
    gl_FragColor=vec4(pow(col,vec3(2.2)),1.0);
  }`,
});
const sand = new THREE.Mesh(new THREE.PlaneGeometry(2 * HX + 6, 2 * HZ + 6.8), sandMat); sand.rotation.x = -HP_; scene.add(sand);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), toonOf(0xd9c8a8)); ground.rotation.x = -HP_; ground.position.y = -0.05; scene.add(ground);
function solid(geo, color, pos, scale, rot = [0, 0, 0], outline = true) {
  const g = new THREE.Group(); g.add(new THREE.Mesh(geo, toonOf(color)));
  if (outline) { const o = new THREE.Mesh(geo, outlineMat); o.scale.setScalar(1.09); g.add(o); }
  g.position.set(...pos); g.scale.set(...scale); g.rotation.set(rot[0], rot[1], rot[2], 'YXZ'); scene.add(g); return g;
}
const WOOD = 0xa8743f;
const PROPS = []; const prop = (x, z, r) => PROPS.push({ x, z, r });
// 四个教室 + 中间一条走廊。墙做矮，不挡视线；门洞可以走
const WALLS = [];
function wall(x0, x1, z0, z1) { WALLS.push({ x0, x1, z0, z1 }); const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  solid(GEO.box, 0xf3e7cc, [cx, 0.7, cz], [w, 1.4, d]); solid(GEO.box, 0x9a6a3e, [cx, 1.47, cz], [w + 0.18, 0.14, d + 0.18], [0, 0, 0], false); }
const DOORS_X = [-30, -12, 12, 30], DOOR_W = 6;
for (const sg of [-1, 1]) {
  const z0 = sg > 0 ? CORR : -CORR - WT, z1 = z0 + WT; let x = -HX - 2.6;
  for (const dx of DOORS_X) { wall(x, dx - DOOR_W / 2, z0, z1); x = dx + DOOR_W / 2; } wall(x, HX + 2.6, z0, z1);
  for (const [p, q] of [[CORR + WT, 17], [23, HZ + 2.6]]) wall(-WT / 2, WT / 2, sg > 0 ? p : -q, sg > 0 ? q : -p);
  for (const dx of DOORS_X) for (const e of [-1, 1]) solid(GEO.box, 0x9a6a3e, [dx + e * (DOOR_W / 2 + 0.05), 1.15, sg * (CORR + WT / 2)], [0.55, 2.3, WT + 0.3]);
  for (const zz of [17, 23]) solid(GEO.box, 0x9a6a3e, [0, 1.15, sg * zz], [WT + 0.3, 2.3, 0.55]);
}
const inWall = (x, z, m = 0) => WALLS.some((w) => x > w.x0 - m && x < w.x1 + m && z > w.z0 - m && z < w.z1 + m);
function pushOutWalls(o, r) {
  for (const w of WALLS) {
    const nx = clamp(o.x, w.x0, w.x1), nz = clamp(o.z, w.z0, w.z1), dx = o.x - nx, dz = o.z - nz, d2 = dx * dx + dz * dz; if (d2 >= r * r) continue;
    if (d2 > 1e-6) { const d = Math.sqrt(d2); o.x = nx + dx / d * r; o.z = nz + dz / d * r; }
    else { const l = o.x - w.x0, rr = w.x1 - o.x, t = o.z - w.z0, b = w.z1 - o.z, m = Math.min(l, rr, t, b); if (m === l) o.x = w.x0 - r; else if (m === rr) o.x = w.x1 + r; else if (m === t) o.z = w.z0 - r; else o.z = w.z1 + r; }
  }
}
// 寻路：从玩家所在格子做一次广度优先，怪不在同一个房间时顺着格子走门
const FW = 2 * HX, FH = 2 * HZ, fBlock = new Uint8Array(FW * FH), fDist = new Int16Array(FW * FH), fQ = new Int32Array(FW * FH), FD = [0, 0];
{ const pil = (x, z, w = 1.3) => wall(x - w / 2, x + w / 2, z - w / 2, z + w / 2);
  // 一班（左上，也是首页合影的教室）：靠黑板一侧两根柱子
  pil(-RCX - 7.5, -RCZ - 4); pil(-RCX + 7.5, -RCZ - 4); pil(-RCX - 4, -RCZ + 9.5); pil(-RCX + 4, -RCZ + 9.5);
  // 二班（右上）：两道错开的竖隔断
  wall(RCX - 7.9, RCX - 7.2, -RCZ - 6, -RCZ + 1.5); wall(RCX + 7.2, RCX + 7.9, -RCZ - 1.5, -RCZ + 6); pil(RCX, -RCZ + 9.5);
  // 三班（左下）：两道错开的横隔断
  wall(-RCX - 7, -RCX + 1, RCZ - 5.2, RCZ - 4.5); wall(-RCX - 1, -RCX + 7, RCZ + 4.5, RCZ + 5.2); pil(-RCX - 7.5, RCZ + 8); pil(-RCX + 7.5, RCZ - 8.5);
  // 四班（右下）：四根柱子围一圈，中间再围半圈矮墙
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pil(RCX + a * 5.5, RCZ + b * 5.5);
  wall(RCX - 2.6, RCX + 2.6, RCZ - 8.6, RCZ - 8); wall(RCX - 2.6, RCX + 2.6, RCZ + 8, RCZ + 8.6);
  // 走廊：长椅左右交错，不能直线冲到底
  wall(-22, -18.5, 1.9, 3.1); wall(-6.5, -3, -3.1, -1.9); wall(3, 6.5, 1.9, 3.1); wall(18.5, 22, -3.1, -1.9); wall(-37, -34.5, -1, 1); wall(34.5, 37, -1, 1); }
for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) if (inWall(i - HX + 0.5, j - HZ + 0.5, 0.4)) fBlock[j * FW + i] = 1;
const lineBlocked = (x0, z0, x1, z1) => { for (let k = 1; k < 6; k++) if (inWall(x0 + (x1 - x0) * k / 6, z0 + (z1 - z0) * k / 6, 0.25)) return true; return false; };
function buildFlow(px, pz) {
  fDist.fill(-1); const ci = clamp(Math.floor(px + HX), 0, FW - 1), cj = clamp(Math.floor(pz + HZ), 0, FH - 1); let h = 0, t = 0; fQ[t++] = cj * FW + ci; fDist[cj * FW + ci] = 0;
  while (h < t) { const c = fQ[h++], i = c % FW, j = (c / FW) | 0, d = fDist[c] + 1;
    if (i > 0 && fDist[c - 1] < 0 && !fBlock[c - 1]) { fDist[c - 1] = d; fQ[t++] = c - 1; } if (i < FW - 1 && fDist[c + 1] < 0 && !fBlock[c + 1]) { fDist[c + 1] = d; fQ[t++] = c + 1; }
    if (j > 0 && fDist[c - FW] < 0 && !fBlock[c - FW]) { fDist[c - FW] = d; fQ[t++] = c - FW; } if (j < FH - 1 && fDist[c + FW] < 0 && !fBlock[c + FW]) { fDist[c + FW] = d; fQ[t++] = c + FW; } }
}
const regionOf = (x, z) => (Math.abs(z) < CORR + WT ? 0 : (z < 0 ? 1 : 3) + (x < 0 ? 0 : 1));
function flowDir(e) {
  const i = clamp(Math.floor(e.x + HX), 0, FW - 1), j = clamp(Math.floor(e.z + HZ), 0, FH - 1); let best = fDist[j * FW + i], bi = 0, bj = 0; if (best < 0) best = 30000;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= FW || b >= FH) continue; const d = fDist[b * FW + a]; if (d < 0 || d >= best) continue; if (di && dj && (fBlock[j * FW + a] || fBlock[b * FW + i])) continue; best = d; bi = di; bj = dj; }
  if (!bi && !bj) return false;
  const dx = i + bi - HX + 0.5 - e.x, dz = j + bj - HZ + 0.5 - e.z, L = Math.hypot(dx, dz) || 1; FD[0] = dx / L; FD[1] = dz / L; return true;
}
let flowT = 0;
for (let i = 0; i < 26; i++) { const x = rnd(-HX + 2, HX - 2), z = rnd(-HZ + 2, HZ - 2); if (!inWall(x, z, 0.8)) solid(GEO.sph, 0xe8e2d4, [x, 0.06, z], [rnd(0.4, 0.9), 0.35, rnd(0.4, 0.8)], [0, rnd(0, 3), 0], false); }
// 火盆
const orbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff6c8).multiplyScalar(1.4), toneMapped: false });
for (const [x, z] of BRAZ) { solid(GEO.bowl, 0xd0683e, [x, 0.5, z], [1.1, 1.6, 1.1]); for (let k = 0; k < 4; k++) solid(GEO.sph, k % 2 ? 0x5fb04f : 0x4a9a44, [x + rnd(-0.4, 0.4), 1.5 + k * 0.25, z + rnd(-0.4, 0.4)], [1.1, 0.9, 1.1]); prop(x, z, 1.0); }
// 北墙：黑板（粉笔字用 canvas 画）、时钟、海报；西墙：一排窗户
const bbCv = document.createElement('canvas'); bbCv.width = 1024; bbCv.height = 192;
{ const c = bbCv.getContext('2d'); c.fillStyle = '#2f5a46'; c.fillRect(0, 0, 1024, 192); for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; c.fillRect(Math.random() * 1024, Math.random() * 192, rnd(4, 40), rnd(1, 6)); }
  c.fillStyle = 'rgba(250,248,235,.92)'; c.font = '700 54px "Ma Shan Zheng", "Noto Sans SC", sans-serif'; c.fillText('期末加油！', 40, 82); c.font = '600 34px "Noto Sans SC", sans-serif'; c.fillText('距离期末还有 3 天', 44, 150);
  c.font = 'italic 40px serif'; c.fillText("f(x) = x² · sin x", 420, 70); c.fillText('lim sin(3x)/x = 3', 420, 140); c.fillStyle = 'rgba(255,214,120,.9)'; c.fillText('s[1:4] → "ynt"', 760, 70);
  c.strokeStyle = 'rgba(255,170,190,.9)'; c.lineWidth = 5; c.beginPath(); c.arc(900, 132, 34, 0, TAU); c.stroke(); c.beginPath(); c.arc(900, 140, 18, 0.2, PI - 0.2); c.stroke(); c.fillStyle = 'rgba(255,170,190,.9)'; c.fillRect(886, 118, 6, 8); c.fillRect(908, 118, 6, 8); }
const bbTex = new THREE.CanvasTexture(bbCv); bbTex.colorSpace = THREE.SRGBColorSpace;
if (document.fonts) document.fonts.ready.then(() => { const c = bbCv.getContext('2d'); c.fillStyle = '#2f5a46'; c.fillRect(30, 30, 360, 70); c.fillStyle = 'rgba(250,248,235,.92)'; c.font = '700 54px "Ma Shan Zheng", sans-serif'; c.fillText('期末加油！', 40, 82); bbTex.needsUpdate = true; });
const WALLC = 0xf3e7cc, TRIM = 0x9a6a3e, NZ_ = -(HZ + 3.4), WX_ = HX + 3.4;
const paneMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd8f0ff).multiplyScalar(1.15), toneMapped: false });
solid(GEO.box, WOOD, [0, 0.55, HZ + 1.9], [2 * WX_, 1.3, 1.4]);
solid(GEO.box, WALLC, [0, 3.6, NZ_], [2 * WX_ + 1.6, 7.2, 1.6]); solid(GEO.box, TRIM, [0, 0.8, NZ_ + 0.9], [2 * WX_, 1.6, 0.3]); solid(GEO.box, 0xffffff, [0, 7.3, NZ_ + 1.0], [2 * WX_, 0.3, 0.5], [0, 0, 0], false);
solid(GEO.cyl, 0xffffff, [0, 5.4, NZ_ + 1.0], [1.8, 0.2, 1.8], [HP_, 0, 0]); solid(GEO.box, 0x2a1a22, [0, 5.65, NZ_ + 1.15], [0.08, 0.6, 0.05], [0, 0, 0], false); solid(GEO.box, 0x2a1a22, [0.2, 5.4, NZ_ + 1.15], [0.45, 0.08, 0.05], [0, 0, 0.3], false);
for (const sx of [-1, 1]) {
  solid(GEO.box, WALLC, [sx * WX_, 3.6, 0], [1.6, 7.2, 2 * HZ + 8]); solid(GEO.box, TRIM, [sx * (WX_ - 0.9), 0.8, 0], [0.3, 1.6, 2 * HZ + 8]); solid(GEO.box, 0xffffff, [sx * (WX_ - 1.0), 7.3, 0], [0.5, 0.3, 2 * HZ + 8], [0, 0, 0], false);
  const bx = sx * RCX;
  solid(GEO.box, 0x8a5a34, [bx, 4.4, NZ_ + 1.0], [25, 5.4, 0.3]);
  { const bb = new THREE.Mesh(new THREE.PlaneGeometry(24, 4.5), new THREE.MeshToonMaterial({ map: bbTex, gradientMap: grad })); bb.position.set(bx, 4.4, NZ_ + 1.2); scene.add(bb); }
  solid(GEO.box, 0x8a5a34, [bx, 1.7, NZ_ + 1.4], [25, 0.15, 0.6]);
  for (let i = 0; i < 6; i++) solid(GEO.cyl, [0xffffff, 0xffd84d, 0xff9ab0][i % 3], [bx - 8 + i * 0.6, 1.83, NZ_ + 1.5], [0.1, 0.5, 0.1], [0, 0, HP_], false);
  for (const [dx, c] of [[-15.6, sx < 0 ? 0xff9ab0 : 0x9fe08a], [15.6, sx < 0 ? 0x7fc8ff : 0xffd84d]]) { solid(GEO.box, 0xffffff, [bx + dx, 4.2, NZ_ + 0.9], [3.2, 4.2, 0.12], [0, 0, 0], false); solid(GEO.box, c, [bx + dx, 4.5, NZ_ + 1.0], [2.6, 2.4, 0.12], [0, 0, 0], false); solid(GEO.box, 0x3a2a2a, [bx + dx, 3.0, NZ_ + 1.0], [2.2, 0.15, 0.12], [0, 0, 0], false); }
  for (const z of [-26, -13, 13, 26]) {
    const wx = sx * (WX_ - 1.0);
    solid(GEO.box, 0xffffff, [wx, 4.2, z], [0.4, 4.6, 7.8]);
    const pn = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 4.0), paneMat); pn.position.set(sx * (WX_ - 1.25), 4.2, z); pn.rotation.y = -sx * HP_; scene.add(pn);
    solid(GEO.box, 0xffffff, [sx * (WX_ - 1.3), 4.2, z], [0.15, 4.0, 0.2], [0, 0, 0], false); solid(GEO.box, 0xffffff, [sx * (WX_ - 1.3), 4.2, z], [0.15, 0.2, 7.2], [0, 0, 0], false);
    solid(GEO.box, 0xffffff, [sx * (WX_ - 1.4), 1.95, z], [0.6, 0.18, 8.2]);
    solid(GEO.box, 0xffb8a0, [sx * (WX_ - 1.4), 4.3, z - 4.3], [0.2, 4.8, 0.9]); solid(GEO.box, 0xffb8a0, [sx * (WX_ - 1.4), 4.3, z + 4.3], [0.2, 4.8, 0.9]);
  }
}
// 班牌：挂在走廊墙上的门边
for (const [k, name] of ['一班', '二班', '三班', '四班'].entries()) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const c = cv.getContext('2d'); c.fillStyle = ['#ff8a7a', '#4aa8ff', '#3fc98a', '#ffb81c'][k]; c.fillRect(0, 0, 256, 128); c.strokeStyle = '#3a2228'; c.lineWidth = 14; c.strokeRect(0, 0, 256, 128);
  c.fillStyle = '#fff'; c.font = '700 76px "ZCOOL KuaiLe", "Noto Sans SC", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(name, 128, 68);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; if (document.fonts) document.fonts.ready.then(() => { c.fillStyle = ['#ff8a7a', '#4aa8ff', '#3fc98a', '#ffb81c'][k]; c.fillRect(10, 10, 236, 108); c.fillStyle = '#fff'; c.fillText(name, 128, 68); t.needsUpdate = true; });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), new THREE.MeshBasicMaterial({ map: t })); const sx = k % 2 ? 1 : -1, sz = k < 2 ? -1 : 1;
  m.position.set(sx * 21, 2.5, sz * CORR + (sz < 0 ? 0.05 : WT + 0.05)); scene.add(m); solid(GEO.box, 0x3a2228, [sx * 21, 1.9, sz * (CORR + WT / 2)], [0.2, 1.2, 0.2], [0, 0, 0], false);
}
// 课桌椅（障碍物）、讲台、书架
function desk(x, z, yaw) {
  const c = Math.cos(yaw), s_ = Math.sin(yaw), at = (dx, dz) => [x + dx * c + dz * s_, z - dx * s_ + dz * c];
  let [a, b] = at(0, 0); solid(GEO.box, 0xe0b070, [a, 1.25, b], [2.4, 0.16, 1.4], [0, yaw, 0]);
  for (const [lx, lz] of [[-1, -0.55], [1, -0.55], [-1, 0.55], [1, 0.55]]) { [a, b] = at(lx, lz); solid(GEO.cyl, 0x8a94a4, [a, 0.6, b], [0.12, 1.2, 0.12], [0, 0, 0], false); }
  [a, b] = at(0, 1.3); solid(GEO.box, 0x4a8ad8, [a, 0.72, b], [1.1, 0.14, 1.0], [0, yaw, 0]); [a, b] = at(0, 1.78); solid(GEO.box, 0x4a8ad8, [a, 1.25, b], [1.1, 0.9, 0.14], [0, yaw, 0]);
  [a, b] = at(-0.5, 0); solid(GEO.box, [0xff8fb1, 0x7fc8ff, 0xffd84d][(Math.random() * 3) | 0], [a, 1.4, b], [0.7, 0.14, 0.5], [0, yaw + rnd(-0.3, 0.3), 0]);
  prop(x, z, 1.4); [a, b] = at(0, 1.4); prop(a, b, 0.7);
}
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  const cx = sx * RCX, cz = sz * RCZ;
  for (const dx of [-11, 11]) for (const dz of [-7, 0, 7]) desk(cx + dx + rnd(-0.5, 0.5), cz + dz + rnd(-0.5, 0.5), rnd(-0.25, 0.25));
  if (sz < 0) { solid(GEO.box, 0xa8743f, [cx + 6, 1.0, -HZ + 1.2], [4.2, 2.0, 1.6]); solid(GEO.box, 0xc89058, [cx + 6, 2.05, -HZ + 1.2], [4.6, 0.15, 1.9]); prop(cx + 6, -HZ + 1.2, 2.2); }
  const sxw = sx * (HX + 0.9), szb = cz + sz * 0.5;
  solid(GEO.box, 0x9a6a3e, [sxw, 2.2, szb], [1.4, 4.4, 5]); for (let i = 0; i < 3; i++) for (let k = 0; k < 6; k++) solid(GEO.box, [0xe25a4a, 0x4a8ad8, 0xffd84d, 0x5fb04f, 0xff9ab0][(i + k) % 5], [sxw - sx * 0.4, 0.9 + i * 1.4, szb - 2.2 + k * 0.8], [0.8, 1.0, 0.5], [0, 0, rnd(-0.1, 0.1)], false); prop(sxw, szb, 2.7);
}
// 走廊两头的储物柜
for (const sx of [-1, 1]) { for (let k = 0; k < 3; k++) solid(GEO.box, [0x7fc8ff, 0xffb8a0, 0x9fe08a][k], [sx * (HX + 0.8), 1.6, -2.9 + k * 2.9], [1.4, 3.2, 2.7]); prop(sx * (HX + 2.4), 0, 4.6); }
for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) { const x = i - HX + 0.5, z = j - HZ + 0.5; if (PROPS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 0.25)) fBlock[j * FW + i] = 1; }
const shCanvas = document.createElement('canvas'); shCanvas.width = shCanvas.height = 64;
{ const c = shCanvas.getContext('2d'); const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.6, 'rgba(0,0,0,.65)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); }
const shadowMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shCanvas), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }), 1400);
shadowMesh.frustumCulled = false; shadowMesh.count = 0; scene.add(shadowMesh);
const GZ = -80, GPX = 1.7, gStage = new THREE.Group(); gStage.position.set(0, 0, GZ); gStage.visible = false; scene.add(gStage);
const GACHA_PILLAR_SCALE = 1.76;
const gAdd = (geo, c, pos, sc, rot = [0, 0, 0], ol = true, par = gStage) => { const m = solid(geo, c, pos, sc, rot || [0, 0, 0], ol); par.add(m); return m; };
const GS = {};
{
  gAdd(GEO.cyl, 0xff8a7a, [0, 0.03, 0], [17, 0.06, 17], 0, false); gAdd(GEO.cyl, 0xfff3d0, [0, 0.07, 0], [15.6, 0.06, 15.6], 0, false); gAdd(GEO.cyl, 0xfffbe8, [0.4, 0.11, 0], [7.5, 0.02, 7.5], 0, false);
  gAdd(GEO.box, 0xc8323a, [0, 4.6, -5.2], [20, 9.2, 0.3], 0, false); for (let x = -9; x <= 9; x += 1.5) gAdd(GEO.cyl, 0xa8262e, [x, 4.6, -5.0], [0.55, 9.2, 0.3], 0, false);
  gAdd(GEO.box, 0xffc93c, [0, 8.9, -4.8], [20.4, 1.0, 0.5]); for (let x = -9; x <= 9; x += 1.5) gAdd(GEO.sph, 0xffc93c, [x, 8.35, -4.6], [0.5, 0.5, 0.3], 0, false);
  for (const sx of [-1, 1]) gAdd(GEO.cone, 0xb02a32, [sx * 8.6, 4.4, -3.6], [3.4, 8.8, 0.6], 0, false);
  const P = GS.pillar = new THREE.Group(); P.position.set(GPX, 0, 0); gStage.add(P);
  gAdd(GEO.cyl, 0x8d7268, [0, 0.16, 0], [1.5, 0.3, 1.5], 0, true, P); gAdd(GEO.cyl, 0xffffff, [0, 0.95, 0], [1.0, 1.6, 1.0], 0, true, P);
  for (let k = 0; k < 4; k++) gAdd(GEO.cyl, 0xff5f6a, [0, 0.35 + k * 0.4, 0], [1.03, 0.16, 1.03], 0, false, P);
  gAdd(GEO.cyl, 0xffc93c, [0, 1.8, 0], [1.25, 0.18, 1.25], 0, true, P); gAdd(GEO.sph, 0xffe07a, [0, 1.92, 0], [0.9, 0.22, 0.9], 0, false, P);
  // 大鹅：白身子、橙嘴橙脚、凶眉毛
  const g = GS.goose = new THREE.Group(); g.position.set(-1.0, 0, 0); gStage.add(g);
  for (const sx of [-1, 1]) { gAdd(GEO.cyl, 0xff9a2e, [sx * 0.26, 0.36, 0], [0.12, 0.7, 0.12], 0, true, g); gAdd(GEO.box, 0xff9a2e, [sx * 0.26, 0.05, 0.14], [0.32, 0.08, 0.42], 0, true, g); }
  gAdd(GEO.sph, 0xffffff, [0, 1.05, -0.1], [1.3, 1.0, 1.75], 0, true, g); gAdd(GEO.cone, 0xf0ede6, [0, 1.3, -1.0], [0.55, 0.6, 0.3], [-1.1, 0, 0], true, g);
  GS.wL = gAdd(GEO.sph, 0xefeae0, [-0.6, 1.15, -0.15], [0.26, 0.62, 1.15], 0, true, g); GS.wR = gAdd(GEO.sph, 0xefeae0, [0.6, 1.15, -0.15], [0.26, 0.62, 1.15], 0, true, g);
  const nk = GS.neck = new THREE.Group();
  nk.position.set(0, 1.35, 0.55);
  nk.rotation.order = 'YXZ';
  g.add(nk);
  GS.neckMesh = gAdd(GEO.cap, 0xffffff, [0, 0.45, 0.05], [0.36, 0.55, 0.36], [0.2, 0, 0], true, nk);
  const hd = GS.head = new THREE.Group(); hd.position.set(0, 1.0, 0.2); nk.add(hd);
  gAdd(GEO.sph, 0xffffff, [0, 0, 0], [0.62, 0.58, 0.74], 0, true, hd); gAdd(GEO.cone, 0xff9a2e, [0, -0.06, 0.5], [0.28, 0.5, 0.22], [HP_, 0, 0], true, hd); gAdd(GEO.sph, 0xff9a2e, [0, 0.2, 0.3], [0.17, 0.17, 0.17], 0, false, hd);
  for (const sx of [-1, 1]) { gAdd(GEO.sph, 0x2a1a22, [sx * 0.23, 0.1, 0.24], [0.12, 0.15, 0.08], 0, false, hd); gAdd(GEO.box, 0x2a1a22, [sx * 0.21, 0.25, 0.27], [0.24, 0.06, 0.05], [0, 0, sx * -0.45], false, hd); }
  // 黄鼠狼：被叼着脖子，身子往下垂；转起来就甩平
  const wz = GS.weasel = new THREE.Group(); wz.position.set(0, -0.12, 0.66); hd.add(wz);
  gAdd(GEO.sph, 0xa8703a, [0, 0.12, 0.06], [0.44, 0.4, 0.42], 0, true, wz); gAdd(GEO.sph, 0x2a1a22, [0, 0.08, 0.28], [0.08, 0.07, 0.06], 0, false, wz);
  for (const sx of [-1, 1]) { gAdd(GEO.sph, 0xa8703a, [sx * 0.16, 0.32, 0.02], [0.13, 0.13, 0.08], 0, true, wz); gAdd(GEO.box, 0x2a1a22, [sx * 0.1, 0.16, 0.26], [0.1, 0.025, 0.02], [0, 0, 0.8], false, wz); gAdd(GEO.box, 0x2a1a22, [sx * 0.1, 0.16, 0.26], [0.1, 0.025, 0.02], [0, 0, -0.8], false, wz); }
  gAdd(GEO.cap, 0xa8703a, [0, -0.62, 0], [0.34, 0.62, 0.3], 0, true, wz); gAdd(GEO.cap, 0xf4dcb4, [0, -0.55, 0.09], [0.24, 0.5, 0.2], 0, false, wz);
  for (const sx of [-1, 1]) { gAdd(GEO.cap, 0x8a5a2a, [sx * 0.17, -0.25, 0.1], [0.1, 0.12, 0.1], [0, 0, sx * 0.4], true, wz); gAdd(GEO.cap, 0x8a5a2a, [sx * 0.15, -1.05, 0.06], [0.1, 0.14, 0.1], [0, 0, sx * 0.3], true, wz); }
  gAdd(GEO.cap, 0xa8703a, [0, -1.45, -0.06], [0.16, 0.42, 0.16], [0.15, 0, 0], true, wz); gAdd(GEO.sph, 0x4a2e1a, [0, -1.82, -0.1], [0.2, 0.28, 0.2], 0, false, wz);
}
const GACHA_PILLAR_YAW = Math.atan2(
  GS.pillar.position.x - GS.goose.position.x,
  GS.pillar.position.z - GS.goose.position.z,
);
const podium = new THREE.Group(); { const a = new THREE.Mesh(GEO.cyl, toonOf(0xff8a7a)); a.scale.set(3.0, 0.14, 3.0); a.position.y = 0.07; const b = new THREE.Mesh(GEO.cyl, toonOf(0xfff3d0)); b.scale.set(2.5, 0.1, 2.5); b.position.y = 0.17; const o = new THREE.Mesh(GEO.cyl, outlineMat); o.scale.set(3.14, 0.2, 3.14); o.position.y = 0.06; podium.add(a, b, o); } podium.position.set(TX, 0, TZ - 1); podium.visible = false; scene.add(podium);
let shN = 0; const SH_ROT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-HP_, 0, 0));
function shadow(x, z, r) { if (shN >= 1400) return; shadowMesh.setMatrixAt(shN++, WM.compose(wP.set(x, 0.02, z), SH_ROT, wS.set(r * 2.2, r * 2.2, 1))); }

/* ================= 粒子（普通 + 发光） ================= */
function makeParticles(N, additive) {
  const geo = new THREE.BufferGeometry();
  const P = { N, head: 0, pos: new Float32Array(N * 3), col: new Float32Array(N * 3), size: new Float32Array(N), a: new Float32Array(N), vel: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N), grav: new Float32Array(N), geo };
  geo.setAttribute('position', new THREE.BufferAttribute(P.pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(P.col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(P.size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(P.a, 1).setUsage(THREE.DynamicDrawUsage));
  P.mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 300 } },
    vertexShader: `attribute float aSize; attribute vec3 aColor; attribute float aAlpha; uniform float uScale; varying vec3 vC; varying float vA; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize*uScale/-mv.z; gl_Position=projectionMatrix*mv; vC=aColor; vA=aAlpha; }`,
    fragmentShader: additive
      ? `varying vec3 vC; varying float vA; void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.0,d); gl_FragColor=vec4(vC*a*a*vA*2.5,1.0); }`
      : `varying vec3 vC; varying float vA; void main(){ float d=length(gl_PointCoord-0.5); if(d>0.5) discard; gl_FragColor=vec4(vC,smoothstep(0.5,0.38,d)*vA); }`,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, P.mat); pts.frustumCulled = false; scene.add(pts); P.pts = pts;
  return P;
}
const PART = makeParticles(2400, false), GLOW = makeParticles(2600, true);
function emit(S, x, y, z, color, n, spd, size, life, grav, mul = 1, up = 1) {
  tC2.set(color).multiplyScalar(mul);
  for (let k = 0; k < n; k++) {
    const i = S.head; S.head = (S.head + 1) % S.N; const a = Math.random() * TAU, s = spd * rnd(0.3, 1);
    S.pos[i * 3] = x; S.pos[i * 3 + 1] = y; S.pos[i * 3 + 2] = z;
    S.vel[i * 3] = Math.cos(a) * s; S.vel[i * 3 + 1] = (rnd(0.2, 1) * s * 0.9 + 1.5) * up; S.vel[i * 3 + 2] = Math.sin(a) * s;
    S.col[i * 3] = tC2.r; S.col[i * 3 + 1] = tC2.g; S.col[i * 3 + 2] = tC2.b; S.size[i] = size * rnd(0.5, 1.3); S.life[i] = S.max[i] = life * rnd(0.6, 1.2); S.grav[i] = grav;
  }
}
const burst = (x, y, z, c, n, spd = 5, size = 0.3, life = 0.6, grav = 9) => emit(PART, x, y, z, c, n, spd, size, life, grav);
const spark = (x, y, z, c, n, spd = 5, size = 0.35, life = 0.5, grav = 4, up = 1) => emit(GLOW, x, y, z, c, n, spd, size, life, grav, 1, up);
const dust = (x, z, n = 10, s = 3) => burst(x, 0.2, z, 0x8a6a48, n, s, 0.45, 0.6, 3);
function stepParticles(S, dt) {
  for (let i = 0; i < S.N; i++) {
    if (S.life[i] <= 0) { S.a[i] = 0; continue; }
    S.life[i] -= dt; const k = i * 3; S.vel[k + 1] -= S.grav[i] * dt;
    S.pos[k] += S.vel[k] * dt; S.pos[k + 1] += S.vel[k + 1] * dt; S.pos[k + 2] += S.vel[k + 2] * dt;
    if (S.pos[k + 1] < 0.05) { S.pos[k + 1] = 0.05; S.vel[k + 1] *= -0.35; S.vel[k] *= 0.6; S.vel[k + 2] *= 0.6; }
    S.a[i] = Math.max(0, S.life[i] / S.max[i]);
  }
  const at = S.geo.attributes; at.position.needsUpdate = at.aAlpha.needsUpdate = at.aColor.needsUpdate = at.aSize.needsUpdate = true;
}

/* 闪电/光束 */
const LMAX = 9000;
const lGeo = new THREE.BufferGeometry(); const lPos = new Float32Array(LMAX * 3), lCol = new Float32Array(LMAX * 3);
lGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3).setUsage(THREE.DynamicDrawUsage)); lGeo.setAttribute('color', new THREE.BufferAttribute(lCol, 3).setUsage(THREE.DynamicDrawUsage));
const lines = new THREE.LineSegments(lGeo, new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false })); lines.frustumCulled = false; scene.add(lines);
let bolts = [];
function zap(path, color, life = 0.2, jit = 0.35, w = 1) { bolts.push({ path, life, max: life, color: new THREE.Color(color).multiplyScalar(3), jit, w });
  if (w > 1) for (let k = 0; k < path.length - 1; k++) { const a = path[k], b = path[k + 1]; for (let q = 0; q < 4; q++) { const t = Math.random(); spark(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, color, 1, 2.5, 0.3, 0.3); } } }

/* 360 度挥砍：一圈扫过去的刀光 */
const slashMat = () => new THREE.ShaderMaterial({
  uniforms: { uProg: { value: 0 }, uFade: { value: 0 }, uStart: { value: 0 }, uArc: { value: 1 }, uColor: { value: new THREE.Color(1.6, 1.25, 0.7) } },
  vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform float uProg; uniform float uFade; uniform float uStart; uniform float uArc; uniform vec3 uColor; varying vec3 vP;
    void main(){ float a=fract(atan(vP.y,vP.x)/6.28318+0.5-uStart)/uArc; if(a>1.0) discard; float r=length(vP.xy); float d=uProg-a; if(d<0.0){ if(uArc<0.999) discard; d+=1.0; }
      float trail=smoothstep(0.6,0.0,d); float band=smoothstep(0.35,0.8,r)*smoothstep(1.0,0.93,r); float edge=smoothstep(0.9,0.97,r)*smoothstep(1.0,0.97,r);
      float tick=step(0.55,fract(a*40.0))*smoothstep(0.8,0.84,r)*smoothstep(0.95,0.9,r); float lead=smoothstep(0.07,0.0,d)*smoothstep(0.25,0.5,r)*smoothstep(1.0,0.96,r);
      float al=(band*0.5+edge*1.3+tick*0.55)*trail*uFade+lead*uFade*1.4; gl_FragColor=vec4(mix(uColor,vec3(2.2,2.1,1.8),lead)*(1.0+edge*1.6),al); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
});
const slashes = [];
for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(new THREE.RingGeometry(0.2, 1, 96, 1), slashMat()); m.rotation.x = -HP_; m.visible = false; scene.add(m); slashes.push({ m, t: 1, dur: 0.22 }); }
function slashFx(x, z, rad, color, dur = 0.2, start = Math.random(), arc = 1) {
  const s = slashes.find((q) => q.t >= 1.6) || slashes[0];
  s.t = 0; s.dur = dur; s.m.position.set(x, 0.55, z); s.m.scale.setScalar(rad); s.m.rotation.z = 0; s.m.material.uniforms.uStart.value = start; s.m.material.uniforms.uArc.value = arc; s.m.material.uniforms.uColor.value.set(color).multiplyScalar(1.6); s.m.visible = true;
}
/* 圆环冲击 */
const rings = [];
for (let k = 0; k < 12; k++) { const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); m.rotation.x = -HP_; m.visible = false; scene.add(m); rings.push({ m, t: 1, dur: 0.3, rad: 1, op: 1 }); }
function ringFx(x, z, rad, color, dur = 0.4, op = 0.9) { const r = rings.find((q) => q.t >= 1) || rings[0]; Object.assign(r, { t: 0, dur, rad, op }); r.m.position.set(x, 0.1, z); r.m.material.color.set(color).multiplyScalar(1.4); r.m.visible = true; }
const tele = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
tele.rotation.x = -HP_; tele.position.y = 0.05; tele.visible = false; scene.add(tele);
const fuseDiscs = Array.from({ length: 8 }, (_, k) => { const m = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: k % 2 ? 0.3 : 0.13, depthWrite: false })); m.rotation.x = -HP_; m.visible = false; m.renderOrder = 2; scene.add(m); return m; });
/* 地上的法阵（咖啡海 / 电咖啡） */
const POOL_MAX = 10, pools = []; let cups = [];
// 水渍：一摊一摊的水，边缘亮一圈
const wetTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,255,255,.34)'); gr.addColorStop(0.7, 'rgba(255,255,255,.5)'); gr.addColorStop(0.88, 'rgba(255,255,255,.95)'); gr.addColorStop(0.96, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); for (let k = 0; k <= 40; k++) { const a = k / 40 * Math.PI * 2, r = 56 + 6 * Math.sin(a * 5) + 3 * Math.sin(a * 9 + 1); g[k ? 'lineTo' : 'moveTo'](64 + Math.cos(a) * r, 64 + Math.sin(a) * r); } g.fill();
  g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.ellipse(44, 40, 13, 5, -0.6, 0, 7); g.fill(); g.beginPath(); g.ellipse(84, 80, 6, 3, -0.6, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const wetMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: wetTex, transparent: true, opacity: 0.62, depthWrite: false, toneMapped: false }), 64);
wetMesh.frustumCulled = false; wetMesh.count = 0; wetMesh.renderOrder = 1; scene.add(wetMesh);
const WET_C = new THREE.Color(0x9fdcff), wetC = new THREE.Color(), wetM = new THREE.Matrix4(), wetQ = new THREE.Quaternion(), wetE = new THREE.Euler(), wetS = new THREE.Vector3(), wetP = new THREE.Vector3();
function drawWet() {
  let n = 0;
  for (const w of wet) { if (n >= 64) break; const k = Math.min(1, (w.max - w.life) * 5 + 0.15, w.life * 1.6) * w.r * (1 + 0.04 * Math.sin(realTime * 3 + w.rot));
    wetE.set(-HP_, 0, w.rot); wetQ.setFromEuler(wetE); wetP.set(w.x, 0.035 + n * 0.0004, w.z); wetS.set(k, k, 1); wetM.compose(wetP, wetQ, wetS); wetMesh.setMatrixAt(n, wetM); { const ec = elT('mop', n); wetMesh.setColorAt(n, ec ? wetC.copy(ec).lerp(WET_C, 0.3) : WET_C); } n++; }
  wetMesh.count = state === 'title' ? 0 : n; wetMesh.instanceMatrix.needsUpdate = true; if (wetMesh.instanceColor) wetMesh.instanceColor.needsUpdate = true;
}
const coffeeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.translate(128, 128);
  const rg = g.createRadialGradient(0, 0, 4, 0, 0, 126); rg.addColorStop(0, '#1e0f05'); rg.addColorStop(0.5, '#5a3418'); rg.addColorStop(0.86, 'rgba(122,74,36,.9)'); rg.addColorStop(1, 'rgba(122,74,36,0)'); g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 127, 0, TAU); g.fill();
  g.lineCap = 'round'; for (let k = 0; k < 3; k++) { g.rotate(TAU / 3); g.strokeStyle = 'rgba(248,230,196,.85)'; g.lineWidth = 11; g.beginPath(); for (let t = 0; t <= 1; t += 0.03) { const r = 10 + t * 100, a = t * 3.6; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.stroke();
    g.strokeStyle = 'rgba(200,150,90,.6)'; g.lineWidth = 5; g.beginPath(); for (let t = 0; t <= 1; t += 0.03) { const r = 20 + t * 96, a = t * 3.6 + 0.5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const stinkTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.translate(128, 128);
  const rg = g.createRadialGradient(0, 0, 30, 0, 0, 120); rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(0.7, 'rgba(255,255,255,.34)'); rg.addColorStop(1, 'rgba(235,235,235,.62)'); g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 108, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,.55)'; for (let k = 0; k < 14; k++) { const a = k / 14 * TAU; g.beginPath(); g.arc(Math.cos(a) * 104, Math.sin(a) * 104, 20 + (k % 3) * 4, 0, TAU); g.fill(); }
  g.strokeStyle = 'rgba(120,120,120,.8)'; g.lineWidth = 6; g.lineCap = 'round'; for (let k = 0; k < 7; k++) { const a = k / 7 * TAU + 0.2; g.save(); g.rotate(a); g.translate(78, 0); g.beginPath(); g.moveTo(-14, 0); g.bezierCurveTo(-7, -14, 0, 14, 7, 0); g.bezierCurveTo(10, -6, 13, -6, 16, 0); g.stroke(); g.restore(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const poolMeshes = Array.from({ length: POOL_MAX }, () => { const m = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ map: coffeeTex, transparent: true, opacity: 0.9, depthWrite: false })); m.rotation.x = -HP_; m.position.y = 0.04; m.visible = false; scene.add(m); return m; });

let ripI = 0, sripI = 0, shake = 0, chroma = 0, hurt = 0;
const sripStart = new Float32Array(6).fill(-99); const v3 = new THREE.Vector3();
function ripple(x, z, s = 1) {
  RIPS[ripI].set(x, z, realTime, s); ripI = (ripI + 1) % 8;
  v3.set(x, 0.3, z).project(camera); SCREEN_RIPS[sripI].set(v3.x * 0.5 + 0.5, v3.y * 0.5 + 0.5, 0, s * (REDUCED ? 0.3 : 0.8)); sripStart[sripI] = realTime; sripI = (sripI + 1) % 6;
}
const NUMS = []; for (let k = 0; k < 60; k++) { const s = document.createElement('span'); s.style.opacity = 0; $('nums').appendChild(s); NUMS.push({ el: s, life: 0, x: 0, y: 0, z: 0 }); }
let numI = 0;
function dmgNum(x, z, v, cls = '', y = 1.3) { const n = NUMS[numI]; numI = (numI + 1) % NUMS.length; n.x = x + rnd(-0.3, 0.3); n.z = z; n.y = y; n.life = 0.7; n.el.textContent = typeof v === 'number' ? Math.round(v) : v; n.el.className = cls; }

/* ================= 空间网格 ================= */
const CELL = 1.6; let grid = new Map();
const key = (cx, cz) => (cx + 4096) * 8192 + (cz + 4096);
function buildGrid() { grid = new Map(); for (const e of enemies) { const k = key(Math.floor(e.x / CELL), Math.floor(e.z / CELL)); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(e); } }
function query(x, z, R, cb) {
  const c0 = Math.floor((x - R - 2.3) / CELL), c1 = Math.floor((x + R + 2.3) / CELL), r0 = Math.floor((z - R - 2.3) / CELL), r1 = Math.floor((z + R + 2.3) / CELL);
  for (let cx = c0; cx <= c1; cx++) for (let cz = r0; cz <= r1; cz++) { const a = grid.get(key(cx, cz)); if (!a) continue; for (const e of a) { if (e.dead || e.inv || e.spawn > 0.3) continue; const dx = e.x - x, dz = e.z - z, rr = R + e.r; if (dx * dx + dz * dz < rr * rr) cb(e, dx, dz); } }
}
function nearest(x, z, maxD = 14, skip) { let best = null, bd = maxD * maxD; for (const e of enemies) { if (e.dead || e.inv || e.spawn > 0.3 || (skip && skip.has(e))) continue; const dx = e.x - x, dz = e.z - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = e; } } return best; }
function pushOutProps(o, r) { for (const p of PROPS) { const dx = o.x - p.x, dz = o.z - p.z, d = Math.hypot(dx, dz), m = p.r + r; if (d < m && d > 0.001) { o.x = p.x + dx / d * m; o.z = p.z + dz / d * m; } } pushOutWalls(o, r); o.x = clamp(o.x, -HX, HX); o.z = clamp(o.z, -HZ, HZ); }

/* ================= 状态 + 流派计算 ================= */
const DIFFS = {
  easy:   { name: '简单', hp: 0.85, dmg: 0.8,  rate: 0.9,  boss: 32000, cd: 4.2, enrage: false, storm: false, revive: 2, elite: 90, note: '大魔王会砸地、叫小怪和冲撞。每局 2 次复活' },
  normal: { name: '中等', hp: 1,    dmg: 1,    rate: 1,    boss: 48000, cd: 3.6, enrage: true,  storm: false, revive: 1, elite: 75, note: '大魔王半血后发怒，多一招卷子雨。每局 1 次复活' },
  hard:   { name: '困难', hp: 1.35, dmg: 1.35, rate: 1.25, boss: 72000, cd: 3.0, enrage: true,  storm: true, revive: 1, elite: 60, note: '怪多血厚，大魔王一开场就下卷子雨。每局 1 次复活' },
};
const MODES = {
  std:     { name: '标准', note: '每 30 秒一个新事件，10:00 期末大魔王出场，打倒它通关' },
  endless: { name: '无尽', note: '没有终点，5 分钟起每 5 分钟来一次大魔王，一次比一次强' },
};
const BOSS_T = 600, EVT = 30;   // 一局 10 分钟，每 30 秒一个事件
let diffId = 'normal', modeId = 'std'; const DF = () => DIFFS[diffId];
const UNLOCK_ORDER = ['gun', 'magic', 'summon'];   // 通关一次解锁下一个流派的全部同学
// 局外进度：开局有 3 位同学、5 个技能、4 件遗物、6 件饰品
const localPreview = location.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const SAVE_PREFIX = localPreview ? 'syntara.brawl.preview' : 'syntara.brawl';
let META_KEY = `${SAVE_PREFIX}.meta`;
let BEST_KEY = `${SAVE_PREFIX}.best`;
const practicePointsUrl = '/api/native/v1/games/brawl/points';
const hostedGame = !skillDemoMode && location.pathname.startsWith('/native-web/games/sandbox-brawl/');
const expectedGameAccount = hostedGame ? new URLSearchParams(location.search).get('account') : null;
const PRICE = { heroes: 150 }, FREE_SKILLS = ['mop', 'plane'];
const DEF0 = { heroes: ['brawler', 'scholar', 'jock'], arts: ['vamp', 'mirror', 'plate', 'koi'], relics: ['dumbbell', 'wrist', 'mom', 'bucket', 'scope', 'drink'] };
const meta = { pts: 0, heroes: [...DEF0.heroes], arts: [...DEF0.arts], relics: [...DEF0.relics], seen: [], ach: [], skins: [], ults: [], weapons: [], top: [], skinOn: {}, growth: {}, fragments: {}, itemLevels: {}, practiceTransfer: '', stat: { runs: 0, kills: 0, wins: 0, hardWin: 0, pulls: 0, pity: 0 } };
let legacyPreviewUnlocks = false;
function loadMeta() {
  try {
  const saved = skillDemoMode ? null : JSON.parse(localStorage.getItem(META_KEY) || 'null');
  if (saved) {
    legacyPreviewUnlocks = localPreview && !saved.fragments
      && Object.keys(ARTS).filter((id) => !ARTS[id].icon).every((id) => saved.arts?.includes(id))
      && Object.keys(RELICS).filter((id) => !RELICS[id].icon).every((id) => saved.relics?.includes(id));
    for (const key in meta) {
      if (saved[key] == null) continue;
      if (legacyPreviewUnlocks && (key === 'arts' || key === 'relics')) continue;
      if (Array.isArray(meta[key])) meta[key] = key === 'top' ? saved[key] : [...new Set([...meta[key], ...saved[key]])];
      else if (typeof meta[key] === 'object') Object.assign(meta[key], saved[key]);
      else if (key === 'practiceTransfer') meta[key] = typeof saved[key] === 'string' ? saved[key] : '';
      else meta[key] = +saved[key] || 0;
    }
  }
  } catch (e) {}
}
if (!hostedGame) loadMeta();
const saveMeta = () => { if (skillDemoMode) return; try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {} };
const GROWTH_STATS = {
  maxHp: 5,
  points: 20,
  regen: 0.05,
  dmg: 0.02,
  crit: 0.01,
  critDmg: 0.05,
  atkSpd: 0.02,
  speed: 0.015,
  luck: 0.01,
  xp: 0.03,
};
const GROWTH_CAP = 5;
function migrateGrowth() {
  if (meta.growth.armor != null) {
    meta.growth.points ??= meta.growth.armor;
    delete meta.growth.armor;
    saveMeta();
  }
}
if (!hostedGame) migrateGrowth();
const GROWTH_BASE_COST = 20, GROWTH_COST_STEP = 10;
const growthLevel = (id) => clamp(Math.floor(Number(meta.growth[id]) || 0), 0, GROWTH_CAP);
const growthBonus = (id, level = growthLevel(id)) => GROWTH_STATS[id] * level;
function growthBonusLabel(id, level) {
  const bonus = growthBonus(id, level);
  if (id === 'maxHp') return `+${bonus}`;
  if (id === 'points') return `+${bonus}%`;
  if (id === 'regen') return `+${bonus.toFixed(2)} 生命/秒`;
  const percent = Number((bonus * 100).toFixed(1));
  if (id === 'crit' || id === 'luck') return `+${percent} 个百分点`;
  return `+${percent}%`;
}
const growthTotal = () => Object.keys(GROWTH_STATS).reduce((total, id) => total + growthLevel(id), 0);
const growthCost = () => GROWTH_BASE_COST + GROWTH_COST_STEP * growthTotal();
function growthRefund() {
  const levels = growthTotal();
  return levels * GROWTH_BASE_COST + GROWTH_COST_STEP * levels * (levels - 1) / 2;
}
function resetGrowth() {
  const refund = growthRefund();
  if (!refund) return 0;
  meta.pts += refund;
  meta.growth = {};
  saveMeta();
  return refund;
}
function buyGrowth(id) {
  if (!Object.hasOwn(GROWTH_STATS, id)) return false;
  const level = growthLevel(id), cost = growthCost();
  if (level >= GROWTH_CAP || meta.pts < cost) return false;
  meta.pts -= cost;
  meta.growth[id] = level + 1;
  saveMeta();
  return true;
}
const skillOpen = (w) => FREE_SKILLS.includes(w) || meta.weapons.includes(w)
  || Object.keys(CLASSES).some((id) => CLASSES[id].start === w && isOpen(id));
let settled = false;
function runPoints(win) {
  let base = Math.floor(player.kills / 25) + Math.floor(T / 30) + (win ? 45 : 0);
  let rate = 100 + growthBonus('points');
  for (const [id, count] of Object.entries(player.relics)) {
    const item = RELICS[id];
    if (item.pointsFlat) base += (item.pointsFlat + itemExtraLevels('relics', id)) * count;
    if (item.pointsRate) rate += (item.pointsRate + itemExtraLevels('relics', id)) * count;
  }
  for (const id of Object.keys(player.arts)) {
    const item = ARTS[id];
    if (win && item.pointsWin) base += item.pointsWin + itemExtraLevels('arts', id);
    if (item.pointsRate) rate += item.pointsRate + itemExtraLevels('arts', id);
  }
  return Math.floor(base * rate / 100);
}
function settle(win) {
  if (settled) return 0; settled = true; const p = runPoints(win); meta.pts += p;
  const st = meta.stat; st.runs++; st.kills += player.kills; if (win) { st.wins++; if (diffId === 'hard') st.hardWin++; }
  if (modeId === 'endless' && T > 30) { meta.top.push({ t: Math.floor(T), h: clsId, d: diffId }); meta.top.sort((a, b) => b.t - a.t); meta.top.length = Math.min(5, meta.top.length); }
  saveMeta(); checkAch(true, win ? 'win' : 'lose'); return p;
}
/* ---------- 成就 ---------- */
// get = 达成后送的同学或饰品；pts = 送积分
const ACH = [
  { id: 'first', n: '第一节课', d: '完成任意一局', ic: 'flag', pts: 15 },
  { id: 'pass', n: '期末及格', d: '通关一次标准模式', ic: 'crown', pts: 55, note: '同时解锁无尽模式' },
  { id: 'k500', n: '清扫走廊', d: '一局击倒 500 个怪', ic: 's_dmg', get: ['relics', 'redpen'] },
  { id: 'task3', n: '热心肠', d: '一局完成 3 个地图任务', ic: 'chest', get: ['relics', 'dual'] },
  { id: 'ddl3', n: 'DDL 克星', d: '一局打倒 3 个 DDL 沙漏人', ic: 'watch', get: ['relics', 'poster'] },
  { id: 'clean', n: '毫发无伤', d: '开局 2 分钟内一点伤都没受', ic: 's_armor', get: ['relics', 'sharpener'] },
  { id: 'stack5', n: '囤囤鼠', d: '一局里同一件饰品叠到 5 件', ic: 'charm', get: ['relics', 'scratch'] },
  { id: 'elem2', n: '双元素', d: '一个技能注入两种元素', ic: 'fire', pts: 35 },
  { id: 'lv10', n: '满级', d: '把一个技能升到 Lv 10', ic: 'star', pts: 40 },
  { id: 'k5000', n: '千人斩', d: '累计击倒 5000 个怪', ic: 'target', pts: 90, goal: () => [meta.stat.kills + liveKills(), 5000] },
  { id: 'hard', n: '学神', d: '困难难度通关一次', ic: 'crown', get: ['heroes', 'monitor'] },
  { id: 'win3', n: '老油条', d: '累计通关 3 次', ic: 'flag', get: ['relics', 'ink'], goal: () => [meta.stat.wins, 3] },
  { id: 'e15', n: '熬夜冠军', d: '无尽模式坚持 15 分钟', ic: 'watch', get: ['heroes', 'swimmer'] },
  { id: 'e20', n: '不眠不休', d: '无尽模式坚持 20 分钟', ic: 'bubble', pts: 120 },
  { id: 'pull10', n: '大鹅饲养员', d: '抽卡累计 10 次', ic: 'sparkle', pts: 30, goal: () => [meta.stat.pulls, 10] },
  { id: 'class10', n: '全班到齐', d: '拥有 10 位同学', ic: 'grid', pts: 90, goal: () => [meta.heroes.length, 10] },
];
const ACH_LOCK = {}; for (const a of ACH) if (a.get) ACH_LOCK[a.get[0] + ':' + a.get[1]] = a;
if (legacyPreviewUnlocks) {
  for (const a of ACH) {
    if (a.get?.[0] === 'relics' && meta.ach.includes(a.id)) meta.relics.push(a.get[1]);
  }
  saveMeta();
}
const achFor = (kind, id) => ACH_LOCK[kind + ':' + id];
const achReward = (a) => a.get ? `${a.get[0] === 'heroes' ? '同学' : '饰品'}「${(a.get[0] === 'heroes' ? CLASSES : RELICS)[a.get[1]].name}」` : `${a.pts} 积分`;
const liveKills = () => (state === 'play' || state === 'paused' || state === 'dead') && !settled ? player.kills : 0;
const endlessOpen = () => meta.ach.includes('pass') || meta.stat.wins > 0 || bestEndless > 0;
let run = { tasks: 0, hg: 0, hit: -1 }, achClock = 0, NET = null;
function checkAch(inRun, final) {
  const P = inRun ? player : null, c = {
    first: !!final, pass: final === 'win', hard: final === 'win' && diffId === 'hard',
    k500: P && P.kills >= 500, task3: P && run.tasks >= 3, ddl3: P && run.hg >= 3, clean: P && T >= 120 && run.hit < 0,
    stack5: P && Object.values(P.relics).some((v) => v >= 5), elem2: P && Object.values(P.elem).some((a) => a.length >= 2), lv10: P && Object.keys(P.weapons).some((w) => wLevel(w) >= MAXLV),
    e15: P && modeId === 'endless' && T >= 900, e20: P && modeId === 'endless' && T >= 1200,
    k5000: meta.stat.kills + liveKills() >= 5000, win3: meta.stat.wins >= 3, pull10: meta.stat.pulls >= 10, class10: meta.heroes.length >= 10,
  };
  for (const a of ACH) if (c[a.id] && !meta.ach.includes(a.id)) { meta.ach.push(a.id); if (a.pts) meta.pts += a.pts; if (a.get && !meta[a.get[0]].includes(a.get[1])) meta[a.get[0]].push(a.get[1]); saveMeta(); achToast(a); }
}
const achEl = document.createElement('div'); achEl.id = 'achT'; document.body.appendChild(achEl); const achQ = []; let achBusy = false;
function achToast(a) { achQ.push(a); if (!achBusy) nextToast(); }
function nextToast() { const a = achQ.shift(); if (!a) { achBusy = false; return; } achBusy = true; achEl.innerHTML = `${illustration('ach', a.id)}<div><b>成就达成：${a.n}</b><small>获得${achReward(a)}${a.note ? '，' + a.note : ''}</small></div>`; achEl.classList.add('on'); setTimeout(() => { achEl.classList.remove('on'); setTimeout(nextToast, 450); }, 2800); }
/* ---------- 皮肤 + 抽卡才有的终极形态 ---------- */
// 第二种终极形态：只能抽卡拿到。抽到后技能升到 Lv 10 时，原来的终极形态和它二选一
const ALT = {
  sweep:   { name: '地裂斩',     desc: '每次挥砍顺着方向劈出一道地裂，前方 9 米直线上的怪都挨一下' },
  pencil:  { name: '自动铅笔',   desc: '出手快一倍，每支铅笔多穿透 3 只' },
  stapler: { name: '订书钉狙击', desc: '改成一次射一枚巨型钉，伤害很高，一路穿到底' },
  shotgun: { name: '橡皮花洒',   desc: '改成朝四面八方喷一整圈橡皮' },
  bolt:    { name: '雷劈',       desc: '改成从天上劈下 6 道雷，每道落地炸开一小圈' },
  coffee:  { name: '三杯连饮',   desc: '一次扔 3 杯，分给 3 个不同的怪' },
  sock:    { name: '臭气加倍',   desc: '身边多出一层臭气圈。圈内怪物减速 75%，离开后仍减速 1 秒。圈内其他队友每秒回复 4 点生命' },
};
const GACHA_ULT = Object.keys(ALT);
const altOwned = (w) => !!ALT[w] && meta.ults.includes(w);
const RC = ['#b9a898', '#4aa8ff', '#ffaa1e'], RN = ['普通', '稀有', '传说'];
const RARE_SK = {
  brawler: ['冬季校服', { top: 0x3a6ad8, pants: 0x1e2a44, band: 0xffd23f }], geo: ['毕业照', { top: 0x2a2a3a, pants: 0x2a2a3a, accent: 0xffc93c }], duty: ['樱花值日', { top: 0xffc2d6, pants: 0xd86a8a, scarf: 0xffffff }],
  scholar: ['夏日海风', { top: 0x9fe0ff, pants: 0x3a8ab8, accent: 0xffd23f }], paper: ['夜跑', { top: 0x2a2a3a, accent: 0xff5f5f, cap: 0xff5f5f }], dorm: ['小熊睡衣', { top: 0xc89a6a, pants: 0xc89a6a, hair: 0x6a4630 }],
  engineer: ['实验室事故', { top: 0xa8e05a, hair: 0xf4f4f4 }], artist: ['油画', { top: 0x3a6ad8, beret: 0xe2453a, hair: 0x2a1a22 }], poet: ['秋叶', { top: 0xe88a3a, beret: 0x8a3a1e, hair: 0xf2c27a }],
  owl: ['通宵紫', { top: 0x2a2a4a, hair: 0x8a5ad8 }], jock: ['客场队服', { top: 0xe2453a, pants: 0x2a2a2a }], monitor: ['值周生', { top: 0xffffff, pants: 0x2a3a6e, armband: 0x3fc98a }],
  captain: ['蓝队应援', { top: 0x4aa8ff, accent: 0xffffff, hair: 0xffd23f }], techie: ['极客黑', { top: 0x2a2a3a, phones: 0x3fe0ff, hair: 0x3fe0ff }], swimmer: ['救生员', { top: 0xff5f5f, swimcap: 0xffd23f }],
};
const LEG_SK = {
  brawler: ['金牌冠军', { top: 0xffc93c, pants: 0xfff3d0, band: 0xff5f5f }, 0xffc93c], scholar: ['星空学霸', { top: 0x2a2a5a, pants: 0x1a1a3a, accent: 0xffe07a, hair: 0x8ab8ff }, 0x8ab8ff],
  poet: ['花神', { top: 0xffb0d0, hair: 0xffffff, beret: 0xff5f9e }, 0xff8fc8], captain: ['应援偶像', { top: 0xff5f9e, hair: 0xb69cff, accent: 0x7fd3ff }, 0xff5f9e], owl: ['月夜', { top: 0x1e1a3a, hair: 0xe8e8ff, accent: 0xffe07a }, 0x9fb8ff],
};
const SKINS = {};
for (const h in RARE_SK) SKINS[h + '_r'] = { h, n: RARE_SK[h][0], r: 1, over: RARE_SK[h][1] };
for (const h in LEG_SK) SKINS[h + '_l'] = { h, n: LEG_SK[h][0], r: 2, over: LEG_SK[h][1], aura: LEG_SK[h][2] };
const skinOf = (h) => { const k = meta.skinOn[h]; return k && SKINS[k] && meta.skins.includes(k) ? k : ''; };
function heroSkinParts(hero, skin) {
  const parts = heroParts({ ...CLASSES[hero].look, ...skin.over });
  if (skin.aura) parts.push(
    ['tor', skin.aura, [0, 2.02, 0], [0.64, 0.64, 0.42], [HP_, 0, 0], 'glow hover', 0],
    ['tor', skin.aura, [0, 0.05, 0], [1.8, 1.8, 0.2], [HP_, 0, 0], 'glow pulse', 0],
    ['sph', 0xffffff, [0, 2.02, 0.32], [0.1, 0.1, 0.1], 0, 'glow hover', 0],
  );
  return parts;
}
function heroRig(h, sk = skinOf(h)) {
  const S = sk && SKINS[sk]; if (!S) return RIGS['hero_' + h];
  const key = 'hero_' + h + '_' + sk;
  if (!RIGS[key]) RIGS[key] = new Rig(heroSkinParts(h, S), 4);
  return RIGS[key];
}
/* ---------- 大鹅抽卡与碎片成长 ---------- */
const GACHA = { one: 30, ten: 270, pity: 80, legendary: 0.05, rareSkin: 0.05, rareFragment: 0.30, duplicateBack: { 1: 10, 2: 25 } };
const G_LEG = [...Object.keys(SKINS).filter((k) => SKINS[k].r === 2), ...GACHA_ULT.map((w) => 'ult_' + w)], G_RARE = Object.keys(SKINS).filter((k) => SKINS[k].r === 1);
const FRAGMENT_POOLS = { skills: WEAPONS, relics: RELICS, arts: ARTS };
const FRAGMENT_LABEL = { skills: '武器', relics: '饰品', arts: '遗物' };
const FRAGMENT_UNLOCK = 10, ITEM_MAX_LEVEL = 20, FRAGMENT_REFUND = 2;
const RELIC_LEVEL_DAMAGE = 0.005, ART_LEVEL_HP = 1;
const fragmentKey = (kind, id) => `${kind}:${id}`;
const fragmentCount = (kind, id) => meta.fragments[fragmentKey(kind, id)] || 0;
const fragmentName = (kind, id) => FRAGMENT_POOLS[kind][id].name;
const fragmentOwned = (kind, id) => kind === 'skills' ? skillOpen(id) : meta[kind].includes(id);
const itemLevel = (kind, id) => fragmentOwned(kind, id)
  ? clamp(Math.floor(Number(meta.itemLevels[fragmentKey(kind, id)])) || 1, 1, ITEM_MAX_LEVEL)
  : 0;
const FRAGMENT_COSTS = [FRAGMENT_UNLOCK];
for (let level = 1; level < ITEM_MAX_LEVEL; level++) {
  FRAGMENT_COSTS.push(Math.ceil(FRAGMENT_COSTS[level - 1] * 1.2));
}
const fragmentCost = (level) => FRAGMENT_COSTS[level];
const fragmentComplete = (kind, level) => level >= (kind === 'skills' ? 1 : ITEM_MAX_LEVEL);
const itemExtraLevels = (kind, id) => Math.max(0, itemLevel(kind, id) - 1);
const relicLevelDamage = (id) => RELICS[id].pointsRate || RELICS[id].pointsFlat ? 0 : itemExtraLevels('relics', id) * RELIC_LEVEL_DAMAGE;
const artLevelHp = (id) => ARTS[id].pointsRate || ARTS[id].pointsWin ? 0 : itemExtraLevels('arts', id) * ART_LEVEL_HP;

function grantFragments(kind, id, amount) {
  const key = fragmentKey(kind, id);
  const from = itemLevel(kind, id);
  let level = from;
  let remaining = fragmentCount(kind, id) + amount;
  while (!fragmentComplete(kind, level) && remaining >= fragmentCost(level)) {
    remaining -= fragmentCost(level);
    if (level === 0) meta[kind === 'skills' ? 'weapons' : kind].push(id);
    level++;
  }
  if (kind !== 'skills' && level > from) meta.itemLevels[key] = level;
  const complete = fragmentComplete(kind, level);
  const back = complete ? remaining * FRAGMENT_REFUND : 0;
  meta.fragments[key] = complete ? 0 : remaining;
  return { kind, id, amount, from, level, remaining: meta.fragments[key], back };
}

function gachaRoll(atLeastRare) {
  const st = meta.stat;
  st.pity = clamp(Math.floor(Number(st.pity)) || 0, 0, GACHA.pity - 1) + 1;
  const roll = Math.random();
  const legendary = st.pity === GACHA.pity || roll < GACHA.legendary;
  const rareSkin = roll < GACHA.legendary + GACHA.rareSkin;
  if (!legendary && !rareSkin) {
    const rare = atLeastRare || roll < GACHA.legendary + GACHA.rareSkin + GACHA.rareFragment;
    const categories = Object.keys(FRAGMENT_POOLS);
    const kind = categories[Math.floor(Math.random() * categories.length)];
    const ids = Object.keys(FRAGMENT_POOLS[kind]);
    const id = ids[Math.floor(Math.random() * ids.length)];
    return { tier: rare ? 1 : 0, ...grantFragments(kind, id, rare ? 8 : 4) };
  }
  if (legendary) st.pity = 0;
  const tier = legendary ? 2 : 1;
  const pool = tier === 2 ? G_LEG : G_RARE, id = pool[Math.floor(Math.random() * pool.length)], ult = id.startsWith('ult_');
  const own = ult ? meta.ults.includes(id.slice(4)) : meta.skins.includes(id);
  if (!own) (ult ? meta.ults : meta.skins).push(ult ? id.slice(4) : id);
  return { tier, id, dup: own, back: own ? GACHA.duplicateBack[tier] : 0 };
}
function gachaPull(n) {
  if (n !== 1 && n !== 10) return null;
  const cost = n === 10 ? GACHA.ten : GACHA.one; if (meta.pts < cost) return null; meta.pts -= cost;
  const res = []; for (let i = 0; i < n; i++) res.push(gachaRoll(n === 10 && i === n - 1 && !res.some((q) => q.tier >= 1)));
  for (const q of res) meta.pts += q.back; meta.stat.pulls += n; saveMeta(); checkAch(false); return res;
}
function gItem(q) {
  if (q.kind) return { name: `${fragmentName(q.kind, q.id)}碎片 ×${q.amount}`, sub: FRAGMENT_LABEL[q.kind], ic: q.id };
  if (q.id.startsWith('ult_')) { const w = WEAPONS[q.id.slice(4)]; return { name: ALT[q.id.slice(4)].name, sub: `${w.name}的第二种终极形态`, ic: q.id.slice(4) }; }
  const S = SKINS[q.id]; return { name: S.n, sub: `${CLASSES[S.h].name}的皮肤`, ic: CLASSES[S.h].start };
}
function buy(kind, id) { if (!PRICE[kind] || meta[kind].includes(id) || achFor(kind, id) || meta.pts < PRICE[kind]) return false; meta.pts -= PRICE[kind]; meta[kind].push(id); saveMeta(); checkAch(false); return true; }
let bestEndless = 0;
function loadBestEndless() {
  try { if (!skillDemoMode) bestEndless = +localStorage.getItem(BEST_KEY) || 0; } catch (e) {}
}
if (!hostedGame) loadBestEndless();
let state = 'title', T = 0, timeScale = 1, spawnAcc = 0, nextElite = 75, nextBats = 25, nextBomb = 90, nextBoss = BOSS_T, bossCount = 0, boss = null, ev = {};
let pendingUlt = [], gifts = [], corpses = [], drops = [], altars = [], pendingInfuse = [], CW = null, watchT = 12, shieldT = 10;
let enemies = [], eid = 0, shots = [], planes = [], gems = [], chests = [], eshots = [], minions = [], lamps = [], ducks = [], slippers = [], books = [], wet = [], blasts = [], pendingLevels = 0;
let cls = CLASSES.brawler, clsId = 'brawler', selIdx = 0;
const cds = {};
const BASE_ST = { dmg: 0, crit: 0.05, critDmg: 1.5, atkSpd: 0, luck: 0, dodge: 0, armor: 0, regen: 0, speed: 0, xp: 0, maxHp: 0 };
function classBaseStats(hero) {
  return {
    ...BASE_ST,
    dmg: BASE_ST.dmg + (hero.baseDmg ?? 0),
    atkSpd: BASE_ST.atkSpd + (hero.baseAtkSpd ?? 0),
    crit: BASE_ST.crit + (hero.crit ?? 0),
  };
}
const player = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, hp: 100, maxHp: 100, speed: 5.4, magnet: 2.4, lvl: 1, xp: 0, need: 6, kills: 0, weapons: {}, wup: {}, st: { ...BASE_ST }, relics: {}, evo: {}, alt: {}, duos: {}, elem: {}, sp: {}, arts: {}, revives: 1, koi: 0, shield: false, ph: 0, hit: 0, seed: 0.2, moving: 0, spinT: 0, slowT: 0, stepAcc: 0, stepSide: 1, healAcc: 0, iframe: 0 };
const R = (id) => player.relics[id] || 0;
const A = (id) => !!player.arts[id];
const W = (id) => player.weapons[id] || 0;
const tagPts = (tag) => Object.keys(player.weapons).filter((w) => WEAPONS[w].tag === tag).length + Object.keys(player.relics).filter((r) => RELICS[r].tag === tag).length;
const tierOf = (p) => (p >= 6 ? 3 : p >= 4 ? 2 : p >= 2 ? 1 : 0);
let SL = { melee: 0, ranged: 0, gun: 0, magic: 0, summon: 0 };
function refreshSets() {
  const old = SL; SL = {}; for (const t in TAGS) SL[t] = tierOf(tagPts(t));
  for (const t in TAGS) if (SL[t] > (old[t] || 0) && state !== 'title') banner(`${TAGS[t].name}流派 ${'Ⅰ Ⅱ Ⅲ'.split(' ')[SL[t] - 1]}`, SETS[t][SL[t] - 1]);
  renderBuilds();
}
// 时间越久怪越强
const tHp = () => (1 + T / 30 * 0.32) * (1 + Math.max(0, T - BOSS_T) / 60 * 0.25);
const tDmg = () => 1 + T / 30 * 0.06 + Math.max(0, T - BOSS_T) / 60 * 0.05;
const tSpd = () => Math.min(1.4, 1 + T / BOSS_T * 0.35);
function dmgMul(tag) {
  let m = (1 + player.st.dmg) * (tag === cls.tag ? 1.2 : 1);
  if (tag === 'melee') m *= 1 + 0.08 * R('wrist');
  if (tag === 'summon') { m *= 1 + 0.1 * R('snack'); if (SL.summon >= 3) m *= 1.5; }
  m *= (1 + 0.15 * R('allnight')) * Math.pow(0.96, R('slack'));
  if (A('plate')) m *= 1 + Math.max(0, player.st.armor) * 0.01; if (A('last') && player.hp < player.maxHp * 0.35) m *= 1.6;
  return m;
}
function cdMul(tag) {
  let m = 1 / (1 + player.st.atkSpd);
  if (tag === 'gun') { m *= Math.pow(0.93, R('mag')); if (SL.gun >= 1) m *= 0.8; }
  if (tag === 'magic') m *= Math.pow(0.93, R('caffeine'));
  if (tag === 'summon') m /= 1 + 0.1 * R('banner');
  if (tag === 'melee' && SL.melee >= 3) m *= 0.5;
  return m;
}
const area = (tag) => (tag === 'melee' ? (1 + 0.08 * R('dumbbell') + 0.05 * R('bucket')) : 1) * (tag === 'magic' ? 1 + 0.1 * R('ink') : 1);
const KNOCK = () => (1 + 0.15 * R('mom'));
function hitEnemy(e, dmg, kx = 0, kz = 0, tag = '', opts = {}) {
  if (e.dead || e.inv) return;
  const els = !opts.noElem && CW ? player.elem[CW] : null, xs = (!opts.raw && CW && player.sp[CW]) || null;
  const critRate = (xs && xs.crit ? 0.2 : 0) + player.st.crit + (tag === 'gun' ? 0.05 * R('reddot') : 0) + (e.brittle > 0 ? 0.3 : 0);
  const crit = !opts.noCrit && Math.random() < critRate;
  const critX = player.st.critDmg + 0.2 * R('scope') + 0.5 * R('glass');
  const elite = e.type === 'boss' || e.type === 'hourglass';
  let xm = 1;
  if (xs) { if (xs.exec && e.hp < e.maxHp * 0.3) xm *= 1.8; if (xs.first && e.hp >= e.maxHp) xm *= 1.6; if (xs.elite && elite) xm *= 1.6; if (xs.near && Math.hypot(e.x - player.x, e.z - player.z) < 3) xm *= 1.7; if (xs.kb) { kx *= 2; kz *= 2; } }
  const v = xm * (opts.raw ? dmg : dmg * dmgMul(tag) * (crit ? critX : 1) * (elite ? 1 + 0.1 * R('redpen') : 1)) * (e.stink > 0 ? 1.25 : 1) * (e.acid > 0 ? 1 + (e.acidK || 0.25) : 1);
  e.hp -= v; e.hit = 1; const kr = (e.giant ? 0.25 : 1) * (e.type === 'boss' ? 0.05 : e.type === 'hourglass' || e.type === 'bomber' ? 0.25 : 1) * KNOCK(); e.kx += kx * kr; e.kz += kz * kr;
  if (Math.random() < 0.5 || crit) dmgNum(e.x, e.z, v, crit ? 'crit' : '', e.r * 2 + 0.6);
  if (crit && A('vamp')) player.hp = Math.min(player.maxHp, player.hp + Math.min(1, v * 0.008));
  if (tag === 'melee' && SL.melee >= 1) { player.healAcc += 0.2; }
  if (tag === 'magic' && SL.magic >= 1) { e.burn = 3; e.burnDps = Math.max(e.burnDps || 0, v * 0.3 * (1 + 0.35 * R('grimoire')) * (1 + 0.1 * R('laundry'))); }
  if (tag === 'gun' && crit && SL.gun >= 2 && !opts.noChain) { boom(e.x, e.z, 1.6, v * 0.6, 'gun', 0xffd27a); }
  if (xs) { if (xs.stun && e.type !== 'boss' && Math.random() < 0.15) { e.frz = Math.max(e.frz || 0, 0.8); spark(e.x, e.r * 2 + 0.5, e.z, 0xffe07a, 5, 2, 0.3, 0.5, 0); } if (xs.mark) e.stink = Math.max(e.stink || 0, 3); }
  if (els && els.length && !e.dead) applyElems(e, v, els);
  if (!elite && !e.dead && e.hp > 0 && A('judge') && e.hp < e.maxHp * 0.15) { e.hp = 0; dmgNum(e.x, e.z, '✗', 'crit', e.r * 2 + 1); }
  if (e.hp <= 0 && !e.dead) { killEnemy(e, tag);
    if (xs) { if (xs.boom && !opts.noChain) boom(e.x, e.z, 1.9, dmg * 0.6, tag, 0xffb04a); if (xs.leech && Math.random() < 0.08) { player.hp = Math.min(player.maxHp, player.hp + 2); dmgNum(player.x, player.z, '+2', 'tag', 2.6); }
      if (xs.gem && Math.random() < 0.2) gems.push({ x: e.x + rnd(-0.4, 0.4), z: e.z + rnd(-0.4, 0.4), v: 1 + Math.floor(T / 90), sz: 0, pull: false, s: 0, ph: Math.random() * 6 }); } }
}
// 元素效果：单个元素各管各的，两个元素再叠一层组合效果
// 闪电跳过去时，把上一只怪身上的状态一起带过去（灼烧、酸、减速、冻伤、脆化、臭气）
function carry(a, b) {
  if (a.burn > 0) { b.burn = Math.max(b.burn || 0, a.burn); b.burnDps = Math.max(b.burnDps || 0, a.burnDps || 0); if (a.fireBomb) b.fireBomb = 1; if (a.spreadBurn) b.spreadBurn = 1; }
  if (a.acid > 0) { b.acid = Math.max(b.acid || 0, a.acid); b.acidK = Math.max(b.acidK || 0, a.acidK || 0.25); if (a.acidSpread) b.acidSpread = 1; }
  if (a.chill > 0) { b.chill = Math.max(b.chill || 0, a.chill); b.slow = Math.max(b.slow, a.slow); }
  if (a.fb > 0) { b.fb = Math.max(b.fb || 0, a.fb); b.fbDps = Math.max(b.fbDps || 0, a.fbDps || 0); }
  if (a.brittle > 0) b.brittle = Math.max(b.brittle || 0, a.brittle); if (a.stink > 0) b.stink = Math.max(b.stink || 0, a.stink);
}
function applyElems(e, v, els) {
  spark(e.x, e.r + 0.5, e.z, ELC[els[(Math.random() * els.length) | 0]], 4, 3.5, 0.4, 0.3);
  const F = els.includes('fire'), I = els.includes('ice'), AC = els.includes('acid'), E = els.includes('elec'), dbl = els.length === 2 && els[0] === els[1], RAW = { noElem: true, noCrit: true, raw: true };
  if (F) { e.burn = 3; e.burnDps = Math.max(e.burnDps || 0, v * (dbl ? 0.6 : 0.25) * (AC ? 2 : 1)); if (dbl) e.fireBomb = 1; if (AC) e.spreadBurn = 1; }
  if (I) { e.slow = Math.max(e.slow, 1.5); e.chill = 1.5; if (dbl) { e.fb = 3; e.fbDps = Math.max(e.fbDps || 0, v * 0.25); if (Math.random() < 0.15 && e.type !== 'boss') e.frz = 1.2; } }
  if (AC) { e.acid = 4; e.acidK = dbl ? 0.5 : 0.25; if (dbl) e.acidSpread = 1; }
  if (I && AC) e.brittle = 3;
  if (F && I && Math.random() < 0.2) { ringFx(e.x, e.z, 1.9, 0xffffff, 0.3, 0.7); burst(e.x, 0.6, e.z, 0xffffff, 14, 4, 0.5, 0.6, -1); query(e.x, e.z, 1.9, (o) => { if (o !== e) hitEnemy(o, v * 0.6, 0, 0, '', RAW); }); }
  if (E && Math.random() < (dbl ? 0.6 : 0.35)) {
    let cur = e; const seen = new Set([e]), path = [{ x: e.x, y: 0.7, z: e.z }], jumps = dbl ? 4 : F ? 3 : 2;
    for (let j = 0; j < jumps; j++) {
      const n = nearest(cur.x, cur.z, 4.5, seen); if (!n) break; seen.add(n); path.push({ x: n.x, y: 0.7, z: n.z });
      if (F) { n.burn = 3; n.burnDps = Math.max(n.burnDps || 0, v * 0.25); } if (I && n.type !== 'boss') n.frz = Math.max(n.frz, 0.6); if (AC) { n.acid = 4; n.acidK = Math.max(n.acidK || 0, 0.25); }
      carry(cur, n); spark(n.x, 0.9, n.z, 0xbfe4ff, 8, 5, 0.34, 0.3); ringFx(n.x, n.z, 0.9, 0x7fc4ff, 0.2, 0.8); hitEnemy(n, v * (AC ? 1 : 0.4), 0, 0, '', RAW); cur = n;
    }
    if (path.length > 1) { const zc = F ? 0xffb04a : I ? 0x9fe0ff : AC ? 0xb8f04a : 0x4aa8ff; zap(path, zc, 0.4, 0.28, 6); zap(path, 0xffffff, 0.25, 0.12, 3); spark(e.x, 0.9, e.z, zc, 8, 5, 0.34, 0.3); }
  }
}
function boom(x, z, rad, dmg, tag, color) {
  ringFx(x, z, rad, color, 0.25); spark(x, 0.6, z, color, 16, rad * 3, 0.4, 0.35, 2);
  query(x, z, rad, (o, dx, dz) => { const L = Math.hypot(dx, dz) || 1; hitEnemy(o, dmg, dx / L * 5, dz / L * 5, tag, { noCrit: true, noChain: true }); });
}
// 受伤：先判闪避（最高 80%），再看护盾，再按护甲减伤
let defeatSource = null, deathTaunt = null;
function hurtPlayer(v, source) {
  if (player.ghost || (NET && NET.on && state !== 'play')) return false;
  if (Math.random() < Math.min(0.8, player.st.dodge)) {
    dmgNum(player.x, player.z, '闪避', 'tag', 2.2);
    if (A('mirror')) { const h = Math.min(v, player.maxHp * 0.15); player.hp = Math.min(player.maxHp, player.hp + h); dmgNum(player.x, player.z, '+' + Math.round(h), 'tag', 2.9); }
    return false;
  }
  if (player.shield) { player.shield = false; shieldT = 10; dmgNum(player.x, player.z, '挡住', 'tag', 2.2); ringFx(player.x, player.z, 1.6, 0x9fe0ff, 0.3); return false; }
  if (run.hit < 0) run.hit = T;
  v *= 10 / (10 + Math.max(0, player.st.armor));
  const big = Math.min(1, v / (player.maxHp * 0.08));
  const wasStanding = player.hp > 0;
  player.hp -= v;
  if (wasStanding && player.hp <= 0) defeatSource = source || null;
  player.hit = 1; player.warn = 1; bump($('pcard'), 'hurt'); $('hurtFx').style.setProperty('--k', (0.5 + big * 0.5).toFixed(2)); bump($('hurtFx'), 'hit'); hurt = Math.min(1, hurt + 0.55 + big * 0.4); chroma = Math.max(chroma, 0.35 + big * 0.4); shake = Math.max(shake, 0.14 + big * 0.22);
  dmgNum(player.x, player.z, '-' + Math.max(1, Math.round(v)), 'hurt', 2.5); spark(player.x, 1, player.z, 0xff4a58, 10 + Math.round(big * 14), 6, 0.35, 0.4); ringFx(player.x, player.z, 1.3 + big, 0xff4a58, 0.25);
  if (A('thorn')) { const cw = CW; CW = null; ringFx(player.x, player.z, 3, 0x6fd04a, 0.3); query(player.x, player.z, 3, (o, dx, dz) => { const L = Math.hypot(dx, dz) || 1; hitEnemy(o, v * 3, dx / L * 8, dz / L * 8, '', { noCrit: true }); }); CW = cw; }
  return true;
}
// 自爆闹钟：个头大、单个出现。靠近后鼓起来闪红 1.5 秒再炸，会炸到周围的怪，别的自爆闹钟被波及会连锁
const BLAST_R = 3.8, FUSE = 1.5;
function explodeAt(x, z) {
  ringFx(x, z, BLAST_R, 0xff6a2a, 0.4); ringFx(x, z, BLAST_R * 0.55, 0xfff1a8, 0.28);
  spark(x, 0.8, z, 0xff8a3a, 70, 11, 0.5, 0.7); spark(x, 0.8, z, 0xfff1a8, 26, 7, 0.4, 0.45); burst(x, 0.5, z, 0x5a4a44, 26, 7, 0.45, 0.8, 6);
  ripple(x, z, 1.5); shake = Math.max(shake, 0.45); chroma = Math.max(chroma, 0.5); blot(x, z, 1.8, 'rgba(60,40,30,.28)', 5, 1.2);
  if (Math.hypot(player.x - x, player.z - z) < BLAST_R) hurtPlayer(34 * tDmg() * DF().dmg, 'bomber');
  query(x, z, BLAST_R, (o, dx, dz) => {
    if (o.dead) return;
    if (o.type === 'bomber') { if (!(o.fuse > 0) || o.fuse > 0.35) { o.fuse = 0.35; o.fuseMax = 0.35; } return; }
    const L = Math.hypot(dx, dz) || 1, el = o.type === 'boss' || o.type === 'hourglass';
    hitEnemy(o, el ? 150 * tDmg() : Math.max(60, o.maxHp * 0.7), dx / L * 12, dz / L * 12, '', { noCrit: true, noElem: true, raw: true });
  });
}
const RIMC = { sleepy: 0xc9b8ff, cross: 0xff4d5e, bat: 0x6a4cff, clock: 0xffc83d, ink: 0x5b6cf0, inkmini: 0x5b6cf0, ghost: 0xf7f4ea, phone: 0x5fd3ff, snail: 0x9fd38a, hourglass: 0xf2c46d, bomber: 0xff6a2a, boss: 0x8b1e3f, chalk: 0xfafafa, mole: 0x9a8272 };
function killEnemy(e, tag) {
  e.dead = true; player.kills++; if (NET && NET.on && NET.host) NET.K.push(e.id);
  if (e.type !== 'boss' && corpses.length < 90) corpses.push({ type: e.type, x: e.x, z: e.z, yaw: Math.atan2(player.x - e.x, player.z - e.z), size: e.size, seed: e.seed, t: 0 });
  const big = e.type === 'boss' ? 260 : e.type === 'hourglass' ? 70 : 14;
  burst(e.x, 0.6, e.z, RIMC[e.type], big, e.r * 6 + 3, e.r * 0.4 + 0.25, 0.8);
  spark(e.x, 0.6, e.z, 0xffd9a0, 5, 4, 0.3, 0.3);
  if (gems.length < 580) gems.push({ x: e.x, z: e.z, v: e.xp * (NET && NET.on && NET.n > 1 ? 0.75 : 1), sz: gemSize(e.xp), pull: false, s: 0, ph: Math.random() * 6 }); else { const g = gems[(Math.random() * gems.length) | 0]; g.v += e.xp; g.sz = Math.max(g.sz, gemSize(g.v)); }
  if (e.type === 'ink') { blot(e.x, e.z, 0.9, 'rgba(70,84,220,.5)', 5, 0.9); for (const s of [-1, 1]) { const m = spawn('inkmini', e.x + s * 0.4, e.z); if (m) { m.spawn = 0; m.kx = s * 6; m.kz = rnd(-3, 3); } } }
  else if (e.type === 'snail') blot(e.x, e.z, 1.2, 'rgba(90,140,80,.6)', 4, 1);
  else if (e.type === 'bomber') blasts.push({ x: e.x, z: e.z, t: e.fuse === -1 ? 0 : 0.2 });
  else blot(e.x, e.z, e.r * 0.8, 'rgba(120,80,50,.1)', 2, 0.4);
  // 元素的死亡效果
  const RAWK = { noElem: true, noCrit: true, raw: true };
  if (e.burn > 0 && e.fireBomb) { ringFx(e.x, e.z, 1.9, 0xff7a2a, 0.3); spark(e.x, 0.6, e.z, 0xff7a2a, 16, 6, 0.4, 0.4); query(e.x, e.z, 1.9, (o) => hitEnemy(o, (e.burnDps || 5) * 2.5, 0, 0, '', RAWK)); }
  if (e.burn > 0 && e.spreadBurn) { ringFx(e.x, e.z, 2.5, 0xb8f04a, 0.3); query(e.x, e.z, 2.5, (o) => { o.burn = 3; o.burnDps = Math.max(o.burnDps || 0, e.burnDps || 5); o.spreadBurn = 1; }); }
  if (e.acid > 0 && e.acidSpread) { ringFx(e.x, e.z, 2.5, 0x8ac83a, 0.3); burst(e.x, 0.4, e.z, 0x9ad04a, 10, 5, 0.35, 0.5); query(e.x, e.z, 2.5, (o) => { o.acid = 4; o.acidK = 0.5; }); }
  if (e.brittle > 0) { ringFx(e.x, e.z, 1.7, 0x9fe0ff, 0.25); spark(e.x, 0.6, e.z, 0xd8f4ff, 12, 7, 0.35, 0.35); query(e.x, e.z, 1.7, (o) => hitEnemy(o, e.maxHp * 0.3, 0, 0, '', RAWK)); }
  // 知识吸取：把全场经验吸过来
  if ((Math.random() < 0.012 || e.type === 'hourglass') && drops.length < 3) drops.push({ x: e.x, z: e.z });
  if (e.type !== 'boss' && e.type !== 'hourglass' && Math.random() < (e.giant ? 0.06 : 0.005) && gifts.length < 3) { const id = rollRelic([78, 20, 2]); if (id) gifts.push({ x: e.x, z: e.z, id, t: 0 }); }
  if (e.burn > 0 && SL.magic >= 2) { ringFx(e.x, e.z, 2.5, 0xff7a2a, 0.3); spark(e.x, 0.6, e.z, 0xff7a2a, 14, 5, 0.4, 0.4); query(e.x, e.z, 2.5, (o) => { o.burn = 3; o.burnDps = Math.max(o.burnDps || 0, e.burnDps || 5); }); }
  if (tag === 'summon' && player.evo.minion && minions.length < 30) addMinion(3, e.x, e.z);
  if (task && task.type === 'kill' && Math.hypot(e.x - task.x, e.z - task.z) < task.rad) { task.prog++; spark(e.x, 0.8, e.z, 0xff5a5a, 6, 3, 0.3, 0.4); }
  if (e.type === 'snail' || e.type === 'phone' || e.type === 'hourglass') { ripple(e.x, e.z, 0.6); shake = Math.max(shake, 0.12); }
  if (e.type === 'hourglass') run.hg++;
  if (e.type === 'hourglass' && Math.random() < 0.4) chests.push({ x: e.x, z: e.z });
  if (e.type === 'boss') {
    boss = null; $('bossBar').hidden = true; $('hud').classList.remove('boss'); ripple(e.x, e.z, 1.6); shake = 0.8; chroma = 1; bossCount++;
    if (modeId === 'std') { timeScale = 0.25; setTimeout(() => { timeScale = 1; showWin(); }, 1400); }
    else { banner('大魔王倒下了', '它还会回来，而且更强'); chests.push({ x: e.x, z: e.z }); }
  }
}
// 经验球分三档：小怪掉小的，中等怪掉中的，大怪和精英掉大的
const gemSize = (v) => (v >= 10 ? 2 : v >= 3 ? 1 : 0);
const GIANT_OK = ['sleepy', 'cross', 'ink', 'snail', 'clock'], GIANT_T = 420; let forceGiant = false;
function spawn(type, x, z) {
  if (enemies.length >= 460) return null;
  if (NET && NET.on && !NET.host && !NET.mirroring) return null;
  if (state === 'play' && !meta.seen.includes(type)) meta.seen.push(type);
  const t = ET[type], hpMul = tHp() * DF().hp * netHp();
  const e = { id: eid++, type, x, z, r: t.r, size: t.size, hp: t.hp * hpMul, maxHp: t.hp * hpMul, spd: t.spd * rnd(0.9, 1.1) * tSpd(), dps: t.dps * DF().dmg * tDmg(), xp: t.xp, fly: t.fly, hit: 0, seed: Math.random(), slow: 0, kx: 0, kz: 0, cdA: rnd(1, 3), ringing: 0, dash: 0, dx: 0, dz: 0, ph: Math.random() * 6, moving: 1, spawn: 1, dead: false, sleep: 0, burn: 0, burnDps: 0, burnTick: 0, stink: 0, fuse: 0, acid: 0, frz: 0, fb: 0, brittle: 0, warn: 0 };
  if (type === 'mole') { e.ms = 'walk'; e.mcd = rnd(0.8, 2); }
  // 7 分钟后开始混进大块头：个头是 2.4 倍，血厚、走得慢、推不太动，专门挤占走位空间
  if (GIANT_OK.includes(type) && state === 'play' && (forceGiant || (!(NET && NET.mirroring) && T >= GIANT_T && Math.random() < 0.08 && enemies.filter((q) => q.giant && !q.dead).length < 7))) { e.giant = 1; e.size *= 2.4; e.r *= 2.4; e.hp = e.maxHp = e.hp * 9; e.spd *= 0.6; e.dps *= 1.6; e.xp *= 6; }
  if (type === 'boss') { e.hp = e.maxHp = DF().boss * (1 + bossCount * 0.7) * netHp(); e.spd = t.spd; e.atk = 0; e.enraged = false; boss = e; }
  enemies.push(e); return e;
}
function spawnNear(type, minR = 10, maxR = 17) {
  for (let k = 0; k < 8; k++) {
    const a = Math.random() * TAU, Rr = rnd(minR, maxR), x = player.x + Math.cos(a) * Rr, z = player.z + Math.sin(a) * Rr;
    if (Math.abs(x) > HX - 0.5 || Math.abs(z) > HZ - 0.5 || inWall(x, z, 1)) continue;
    if (PROPS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 1)) continue;
    const e = spawn(type, x, z); if (e && !e.fly) blot(x, z, e.r * 0.9, 'rgba(120,80,50,.12)'); return e;
  }
  return null;
}

/* ================= 武器 ================= */
function spinPos(i, n, s, rr, evo) {
  const X = player.sp.spin || {}, a = realTime * s.spin * (evo ? 1.3 : 1) * (X.fast ? 1.4 : 1) + i / n * TAU, ph = realTime % 4;
  const r = rr * (X.outer && i % 2 ? 1.6 : 1) * (X.fling && ph < 0.7 ? 1 + 0.9 * Math.sin(ph / 0.7 * PI) : 1);
  return [player.x + Math.cos(a) * r, player.z + Math.sin(a) * r, a];
}
const hand = () => ({ x: player.x + Math.sin(player.yaw) * 0.35 + Math.cos(player.yaw) * 0.35, y: 0.85, z: player.z + Math.cos(player.yaw) * 0.35 - Math.sin(player.yaw) * 0.35 });
function shoot(rig, x, y, z, yaw, sp, life, dmg, tag, o = {}) {
  const ec_ = ecRand(CW); if (ec_ != null) o = { el: ec_, tint: new THREE.Color(ec_), elc: ELT[ec_] || (ELT[ec_] = new THREE.Color(ec_)), ...o };
  const xs = player.sp[CW]; if (xs) { o = { ...o }; if (xs.pierce) o.pierce = (o.pierce || 0) + (CW === 'shotgun' ? 1 : 2); if (xs.split) o.split = true; if (xs.bounce) o.bounce = Math.max(o.bounce || 0, 2); }
  shots.push(Object.assign({ rig, x, y, z, vx: Math.sin(yaw) * sp, vz: Math.cos(yaw) * sp, life, dmg, tag, pierce: 0, hit: new Set(), r: 0.25, spin: 0, split: false, bounce: 0, boom: false, w: CW }, o));
}
const rangedMods = () => ({ pierce: R('sharpener') + (SL.ranged >= 1 ? 1 : 0), split: SL.ranged >= 2, bounce: SL.ranged >= 3 ? 3 : 0, extra: R('scratch') + (SL.ranged >= 3 ? 1 : 0) });
const summonExtra = () => R('poster') + (SL.summon >= 1 ? 1 : 0);
const sweepFx = { t: 0, r: 2 };
const ELC = { fire: 0xff6a2a, ice: 0x7fd4ff, acid: 0x8fd83a, elec: 0x3f9bff }, WHITE_C = new THREE.Color(1, 1, 1), ELT = {};
const elT = (id, k = 0) => { const c = EC(id, k % 2); return c == null ? null : (ELT[c] || (ELT[c] = new THREE.Color(c))); };
let sweepAgain = 0, mopTrail = 0, stapleN = 0, sockPulse = 3;
const WPC = { sweep: [0xffe07a, 0xfff3b8], spin: [0xffd84d, 0xffb04a], mop: [0xbfe6ff, 0xffffff], pencil: [0xffc83d, 0x8fc4ff], plane: [0xbfe0ff, 0xffffff], slipper: [0xff9a7a, 0xffd0b8], stapler: [0xdfe6ef, 0xffe9a0], shotgun: [0xff8fb1, 0x8fd3ff],
  bolt: [0x4aa8ff, 0xbfe4ff], coffee: [0xf2e0c0, 0xb07a3a], sock: [0x9ad04a, 0xd0ec7a], rollcall: [0xffd84d, 0xff8a6b], minion: [0xffe14d, 0xff9ac1], lamp: [0xfff1a8, 0xffd23f], duck: [0xffd23f, 0xff6fa8] };
const pc = (id) => ecRand(id) ?? (WPC[id] ? WPC[id][(Math.random() * 2) | 0] : 0xffffff);
// 技能粒子：平时是技能自己的颜色，带元素后是元素的颜色（火往上飘，酸往下滴）
function puff(id, x, y, z, n = 1, spd = 0.6, size = 0.34, life = 0.4) { for (let k = 0; k < n; k++) { const c = pc(id); spark(x, y, z, c, 1, spd, size, life, c === ELC.fire ? -3 : c === ELC.acid ? 4 : 0); } }
const elOf = (id) => player.elem[id] || [];
const EC = (id, k = 0) => { const e = elOf(id); return e.length ? ELC[e[Math.min(k, e.length - 1)]] : null; };
const ecRand = (id) => { const e = elOf(id); return e.length ? ELC[e[(Math.random() * e.length) | 0]] : null; };
// 范围技能的元素装饰：火是一圈火苗和焦痕，冰是冰环和冰屑，酸是地上的酸液，电是往外劈的电弧
function elemBurst(id, x, z, r) {
  for (const el of new Set(elOf(id))) {
    if (el === 'fire') { ringFx(x, z, r, 0xff6a2a, 0.4); for (let k = 0; k < 20; k++) { const a = k / 20 * TAU; spark(x + Math.cos(a) * r * 0.9, 0.3, z + Math.sin(a) * r * 0.9, k % 2 ? 0xff7a2a : 0xffd23f, 2, 2, 0.55, 0.55, -5); } ringMark(x, z, r * 0.92, 'rgba(70,30,15,.4)', 5); }
    if (el === 'ice') { ringFx(x, z, r * 1.05, 0xbfeaff, 0.5); ringFx(x, z, r * 0.6, 0xffffff, 0.35, 0.6); for (let k = 0; k < 14; k++) { const a = k / 14 * TAU + 0.2; spark(x + Math.cos(a) * r * 0.85, 0.5, z + Math.sin(a) * r * 0.85, 0xe8f8ff, 2, 3, 0.45, 0.6, 3); } ringMark(x, z, r * 0.9, 'rgba(210,240,255,.6)', 7); }
    if (el === 'acid') { ringFx(x, z, r, 0x9be03a, 0.4); for (let k = 0; k < 8; k++) { const a = rnd(0, TAU), q = rnd(0.4, 1) * r; blot(x + Math.cos(a) * q, z + Math.sin(a) * q, rnd(0.25, 0.5), 'rgba(120,190,40,.5)'); spark(x + Math.cos(a) * q, 0.3, z + Math.sin(a) * q, 0x9be03a, 2, 2, 0.45, 0.5, 6); } }
    if (el === 'elec') for (let k = 0; k < 5; k++) { const a = rnd(0, TAU); zap([{ x, y: 0.8, z }, { x: x + Math.cos(a) * r * 0.55, y: 0.9, z: z + Math.sin(a) * r * 0.55 }, { x: x + Math.cos(a + 0.3) * r, y: 0.4, z: z + Math.sin(a + 0.3) * r }], 0x6ab8ff, 0.24, 0.3, 3); }
  }
}
const SW_ARC = 2.7;
function slash(range, dmg, full, yaw = player.yaw) {
  const pull = full, arc = full ? TAU : SW_ARC, st = full ? Math.random() : (yaw - HP_ - arc / 2) / TAU + 0.5, af = arc / TAU;
  player.spinT = full ? 1 : 0; if (!full) player.yaw = yaw; sweepFx.t = 1; sweepFx.r = range; sweepFx.yaw = yaw; sweepFx.arc = arc;
  slashFx(player.x, player.z, range, EC('sweep') ?? 0xffe0a0, 0.26, st, af); if (elOf('sweep').length > 1) slashFx(player.x, player.z, range * 1.12, EC('sweep', 1), 0.32, st, af);
  if (full) elemBurst('sweep', player.x, player.z, range); else elemBurst('sweep', player.x + Math.sin(yaw) * range * 0.5, player.z + Math.cos(yaw) * range * 0.5, range * 0.6);
  query(player.x, player.z, range, (o, dx, dz) => { const L = Math.hypot(dx, dz) || 1, k = pull ? -4 : 12;
    if (!full) { let da = Math.atan2(dx, dz) - yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); if (Math.abs(da) > arc / 2 && L > 1) return; }
    hitEnemy(o, dmg, dx / L * k, dz / L * k, 'melee'); spark(o.x, 0.7, o.z, ecRand('sweep') ?? 0xffd27a, 3, 3, 0.25, 0.2); });
  for (let k = 0; k < (full ? 26 : 14); k++) { const a = yaw - arc / 2 + arc * (k + Math.random()) / (full ? 26 : 14), rr = range * rnd(0.75, 1); puff('sweep', player.x + Math.sin(a) * rr, rnd(0.5, 0.9), player.z + Math.cos(a) * rr, 1, 2.2, 0.36, 0.45); }
  if (SPX('sweep', 'wave')) shoot('ruler', player.x + Math.sin(yaw) * 0.8, 0.8, player.z + Math.cos(yaw) * 0.8, yaw, 16, 0.6, dmg * 0.6, 'melee', { pierce: 99, r: 1.1, sc: 1.5 });
  if (SPX('sweep', 'block')) for (const b of eshots) if (Math.hypot(b.x - player.x, b.z - player.z) < range) { b.life = 0; spark(b.x, 0.8, b.z, 0xffffff, 6, 4, 0.3, 0.3); }
  if (SL.melee >= 2) { ringFx(player.x, player.z, range * 1.9, 0xffb04a, 0.35); query(player.x, player.z, range * 1.9, (o, dx, dz) => { const L = Math.hypot(dx, dz); if (L > range) hitEnemy(o, dmg * 0.5, dx / L * 6, dz / L * 6, 'melee', { noChain: true }); }); }
  if (player.duos.parry) for (let k = 0; k < 8; k++) shoot('eraser', player.x, 0.8, player.z, k / 8 * TAU + rnd(-0.1, 0.1), 15, 0.45, 8 + 3 * W('shotgun'), 'gun', { tint: new THREE.Color([0xff8fb1, 0x8fd3ff, 0xffffff][k % 3]), spin: 9 });
  shake = Math.max(shake, 0.1); ripple(player.x, player.z, 0.35);
}
// 拖把的水渍：留在地上，踩进去的怪减速并持续掉血
function addWet(x, z, s, evo) {
  const X = player.sp.mop || {}, life = 4 + R('bucket') + (X.deep ? 3 : 0);
  if (wet.length >= 64) wet.shift();
  wet.push({ x, z, life, max: life, tick: 0, evo, dmg: s.dmg * 0.22 * (evo ? 2.5 : 1), r: (evo ? 1.7 : 1.2) * (X.deep ? 1.35 : 1), rot: rnd(0, TAU) });
}
// 拖把：朝前方 110° 拖一下，留下水渍
function mopSwipe(s, evo) {
  const range = s.range * area('melee'), yaw = player.yaw;
  query(player.x, player.z, range, (o, dx, dz) => {
    const L = Math.hypot(dx, dz) || 1; let da = Math.atan2(dx, dz) - yaw; da = Math.atan2(Math.sin(da), Math.cos(da));
    if (Math.abs(da) > 0.96) return; hitEnemy(o, s.dmg, Math.sin(yaw) * 9, Math.cos(yaw) * 9, 'melee'); o.slow = 1.5;
  });
  for (let k = -2; k <= 2; k++) {
    const a = yaw + k * 0.4, r = range * 0.65, x = player.x + Math.sin(a) * r, z = player.z + Math.cos(a) * r;
    addWet(x, z, s, evo);
    spark(x, 0.4, z, ecRand('mop') ?? 0xbfe6ff, 5, 4, 0.3, 0.35, 6);
  }
  elemBurst('mop', player.x + Math.sin(yaw) * range * 0.6, player.z + Math.cos(yaw) * range * 0.6, range * 0.7);
  if (task && task.type === 'mop') for (const d of task.dirt) if (d.on && Math.hypot(d.x - player.x, d.z - player.z) < range) cleanDirt(d);
  player.spinT = 0.35; shake = Math.max(shake, 0.06);
}
function fire(dt) {
  const h = hand(), RM = rangedMods();
  for (const id in player.weapons) {
    CW = id; const s = ws(id), tag = WEAPONS[id].tag, evo = player.evo[id];
    if (id === 'spin') continue;
    if (id === 'sock') { sockTick(dt, s, evo); continue; }
    if (id === 'mop' && SPX('mop', 'trail') && player.moving > 0.3) { mopTrail -= dt; if (mopTrail <= 0) { mopTrail = 0.3; addWet(player.x, player.z, s, evo); } }
    cds[id] = (cds[id] ?? 0.3) - dt; if (cds[id] > 0) continue;
    cds[id] = (evo && id === 'sweep' ? 0.3 / (SL.melee >= 3 ? 0.5 : 1) : evo && id === 'coffee' ? s.cd * 0.5 : s.cd) * cdMul(tag); if (A('copier') && Math.random() < 0.2) cds[id] = Math.min(cds[id], 0.12); if (SPX(id, 'twice') && Math.random() < 0.25) cds[id] = Math.min(cds[id], 0.15); if (id === 'pencil' && player.alt.pencil) cds[id] *= 0.5;
    if (id === 'sweep') {
      const range = s.range * area('melee') * (evo ? 1.5 : 1);
      const tg = nearest(player.x, player.z, range + 1.5); if (!tg) { cds[id] = 0.1; sweepAgain = 0; continue; }
      const second = sweepAgain === 1; sweepAgain = SPX('sweep', 'again') && !second ? 1 : 0;
      slash(range, s.dmg * (evo ? 0.8 : 1) * (second ? 0.6 : 1), !!evo, Math.atan2(tg.x - player.x, tg.z - player.z)); if (player.alt.sweep && !second) quake(Math.atan2(tg.x - player.x, tg.z - player.z), s.dmg); if (sweepAgain) cds[id] = Math.min(cds[id], 0.24);
    } else if (id === 'mop') {
      if (!nearest(player.x, player.z, s.range + 1) && !(task && task.type === 'mop')) { cds[id] = 0.1; continue; }
      mopSwipe(s, evo);
    } else if (id === 'pencil') {
      const used = new Set(), n = s.n + RM.extra;
      for (let k = 0; k < n; k++) { const e = nearest(h.x, h.z, 14, used) || nearest(h.x, h.z, 14); if (!e) { cds[id] = 0.15; break; } used.add(e); shoot('pencilP', h.x, h.y, h.z, Math.atan2(e.x - h.x, e.z - h.z), 18, 1.1, s.dmg, 'ranged', { pierce: s.pierce + RM.pierce + (player.alt.pencil ? 3 : 0), split: RM.split, bounce: RM.bounce }); }
      if (SPX('pencil', 'back')) { const e0 = nearest(h.x, h.z, 14); if (e0) { const yb = Math.atan2(e0.x - h.x, e0.z - h.z) + PI; for (let k = 0; k < n; k++) shoot('pencilP', h.x, h.y, h.z, yb + (k - (n - 1) / 2) * 0.14, 18, 1.1, s.dmg, 'ranged', { pierce: s.pierce + RM.pierce }); } }
      if (evo) for (let k = 0; k < 10; k++) shoot('pencilP', player.x, 0.85, player.z, k / 10 * TAU + realTime, 16, 0.9, s.dmg * 0.7, 'ranged', { pierce: 1 + RM.pierce, bounce: RM.bounce });
    } else if (id === 'slipper') {
      const e = nearest(h.x, h.z, 12); if (!e) { cds[id] = 0.15; continue; }
      const n = s.n + RM.extra, yaw0 = Math.atan2(e.x - h.x, e.z - h.z);
      for (let k = 0; k < n; k++) { const yaw = yaw0 + (k - (n - 1) / 2) * 0.35; slippers.push({ x: h.x, z: h.z, vx: Math.sin(yaw) * 17, vz: Math.cos(yaw) * 17, t: 0, out: true, dmg: s.dmg, hit: new Set(), spinA: 0, evo, small: false }); }
    } else if (id === 'stapler') {
      if (player.alt.stapler) { const e = nearest(h.x, h.z, 18); if (!e) { cds[id] = 0.1; continue; } const yaw = Math.atan2(e.x - h.x, e.z - h.z); shoot('staple', h.x, h.y, h.z, yaw, 32, 1.0, s.dmg * 2.6 * (s.n + R('dual')), 'gun', { sc: 3.2, r: 0.7, pierce: 99 }); cds[id] *= 2.4; shake = Math.max(shake, 0.18); spark(h.x + Math.sin(yaw) * 0.5, h.y, h.z + Math.cos(yaw) * 0.5, 0xffe9a0, 14, 4, 0.3, 0.2, 0); continue; }
      const e = nearest(h.x, h.z, 13);
      const n = s.n + R('dual');
      if (e) { const yaw = Math.atan2(e.x - h.x, e.z - h.z); for (let k = 0; k < n; k++) { const big = SPX('stapler', 'heavy') && ++stapleN % 8 === 0; shoot('staple', h.x, h.y, h.z, yaw + (k - (n - 1) / 2) * 0.12 + rnd(-0.06, 0.06), 24, 0.7, s.dmg * (big ? 4 : 1), 'gun', big ? { sc: 2.4, r: 0.5 } : {}); } spark(h.x + Math.sin(yaw) * 0.4, h.y, h.z + Math.cos(yaw) * 0.4, 0xffe9a0, 3, 2, 0.25, 0.1, 0); }
      if (evo) for (let k = 0; k < 4; k++) shoot('staple', player.x, 0.85, player.z, realTime * 3 + k * HP_, 22, 0.8, s.dmg, 'gun');
      if (!e && !evo) cds[id] = 0.1;
    } else if (id === 'shotgun') {
      const e = nearest(h.x, h.z, 9); if (!e) { cds[id] = 0.15; continue; }
      const yaw = Math.atan2(e.x - h.x, e.z - h.z);
      if (player.alt.shotgun) { const m = s.n * 3; for (let k = 0; k < m; k++) shoot('eraser', h.x, h.y, h.z, yaw + k / m * TAU, rnd(13, 16), 0.5, s.dmg, 'gun', { tint: new THREE.Color([0xff8fb1, 0x8fd3ff, 0xffffff][k % 3]), spin: rnd(5, 12) }); ringFx(player.x, player.z, 3, 0xff8fb1, 0.3); continue; }
      for (let k = 0; k < s.n; k++) shoot('eraser', h.x, h.y, h.z, yaw + (k / (s.n - 1) - 0.5) * 0.9 + rnd(-0.05, 0.05), rnd(14, 18), 0.42, s.dmg, 'gun', { tint: new THREE.Color([0xff8fb1, 0x8fd3ff, 0xffffff][k % 3]), spin: rnd(5, 12), boom: !!evo });
      if (SPX('shotgun', 'back')) for (let k = 0; k < s.n; k++) shoot('eraser', h.x, h.y, h.z, yaw + PI + (k / (s.n - 1) - 0.5) * 0.9 + rnd(-0.05, 0.05), rnd(14, 18), 0.42, s.dmg, 'gun', { tint: new THREE.Color([0xff8fb1, 0x8fd3ff, 0xffffff][k % 3]), spin: rnd(5, 12), boom: !!evo });
      shake = Math.max(shake, 0.1); spark(h.x, h.y, h.z, 0xffffff, 8, 4, 0.3, 0.15, 0);
    } else if (id === 'plane') {
      const n = s.n + RM.extra + (evo ? 3 : 0);
      for (let k = 0; k < n; k++) planes.push({ x: h.x, y: 1.2, z: h.z, yaw: player.yaw + (k - (n - 1) / 2) * 0.5, sp: 9, life: (evo ? 5 : 3) * (SPX('plane', 'life') ? 1.7 : 1), dmg: s.dmg, target: null, pierce: (evo ? 4 : 0) + (SPX('plane', 'loop') ? 2 : 0), hit: new Set() });
    } else if (id === 'bolt') {
      let cur = nearest(h.x, h.z, SPX('bolt', 'far') ? 16 : 10); if (!cur) { cds[id] = 0.2; continue; }
      if (player.alt.bolt) thunder(s); else chain({ x: h.x, y: 1.1, z: h.z }, cur, evo ? 14 : s.n + R('ink'), s.dmg, evo);
    } else if (id === 'coffee') {
      const tg = nearest(player.x, player.z, 9); if (!tg) { cds[id] = 0.3; continue; }
      cups.push({ x0: h.x, z0: h.z, x: tg.x, z: tg.z, t: 0, rad: s.rad * area('magic') * (evo ? 1.35 : 1), dmg: s.dmg, evo });
      if (player.alt.coffee) { const used = new Set([tg]); for (let k = 0; k < 2; k++) { const t2 = nearest(player.x, player.z, 11, used); if (!t2) break; used.add(t2); cups.push({ x0: h.x, z0: h.z, x: t2.x, z: t2.z, t: -0.15 * (k + 1), rad: s.rad * area('magic'), dmg: s.dmg, evo }); } }
      if (SPX('coffee', 'two')) { const t2 = nearest(player.x, player.z, 11, new Set([tg])), a2 = rnd(0, TAU); cups.push({ x0: h.x, z0: h.z, x: t2 ? t2.x : tg.x + Math.cos(a2) * 3, z: t2 ? t2.z : tg.z + Math.sin(a2) * 3, t: -0.25, rad: s.rad * area('magic') * (evo ? 1.35 : 1), dmg: s.dmg, evo }); }
    } else if (id === 'rollcall') {
      const n = evo ? 5 : s.n; if (!rollCall(n, s.dmg, evo)) cds[id] = 0.3;
    } else if (id === 'minion') {
      const n = Math.min(30 - minions.length, (s.n + summonExtra()) * (evo ? 2 : 1) * (SL.summon >= 3 ? 2 : 1));
      for (let k = 0; k < n; k++) addMinion(s.dur);
      if (n > 0) ripple(player.x, player.z, 0.5);
    } else if (id === 'lamp') {
      const n = Math.min(8 - lamps.length, s.n + (SL.summon >= 1 ? 1 : 0));
      for (let k = 0; k < n; k++) { const a = rnd(0, TAU); const L = { x: clamp(player.x + Math.cos(a) * 2, -HX + 0.6, HX - 0.6), z: clamp(player.z + Math.sin(a) * 2, -HZ + 0.6, HZ - 0.6), life: s.dur, cd: 0.5, aim: 0, seed: Math.random(), drop: 1, planeCd: 1 }; lamps.push(L); dust(L.x, L.z, 14); ripple(L.x, L.z, 0.4); if (SPX('lamp', 'flash')) { ringFx(L.x, L.z, 3.6, 0xffffff, 0.35); spark(L.x, 1.2, L.z, 0xfff6c8, 30, 8, 0.4, 0.4); query(L.x, L.z, 3.6, (o) => { if (o.type !== 'boss') o.frz = Math.max(o.frz || 0, 1.5); }); } }
    } else if (id === 'duck') {
      const n = Math.min(12 - ducks.length, (s.n + summonExtra()) * (evo ? 3 : 1));
      for (let k = 0; k < n; k++) { const a = rnd(0, TAU), r = rnd(2, 4); ducks.push({ x: clamp(player.x + Math.cos(a) * r, -HX + 0.6, HX - 0.6), z: clamp(player.z + Math.sin(a) * r, -HZ + 0.6, HZ - 0.6), life: s.dur, max: s.dur, dmg: s.dmg, evo, ph: rnd(0, 6), seed: Math.random(), moving: 1, hit: 0, drop: 1 }); }
      if (n > 0) dmgNum(player.x, player.z, '嘎！', 'tag', 2.4);
    }
  }
}
function quake(yaw, dmg) {
  const hit = new Set(), sx = Math.sin(yaw), sz = Math.cos(yaw), c = pc('sweep');
  const demoRound = skillDemoRound;
  for (let k = 1; k <= 5; k++) { const x = player.x + sx * k * 1.8, z = player.z + sz * k * 1.8; if (inWall(x, z)) break; setTimeout(() => { if (skillDemoMode && demoRound !== skillDemoRound) return; ringFx(x, z, 1.7, 0xd89a4a, 0.3); spark(x, 0.3, z, c, 8, 3, 0.35, 0.4, 2); dust(x, z, 4); }, k * 40);
    query(x, z, 1.6, (o) => { if (hit.has(o)) return; hit.add(o); hitEnemy(o, dmg * 0.8, sx * 4, sz * 4, 'melee', { noChain: true }); }); }
}
function thunder(s) {
  const cand = shuffle(enemies.filter((e) => !e.dead && !e.inv && e.spawn <= 0 && Math.hypot(e.x - player.x, e.z - player.z) < 12)).slice(0, 6);
  for (const e of cand) { chain({ x: e.x + rnd(-1, 1), y: 9, z: e.z + rnd(-1, 1) }, e, 1, s.dmg * 1.6, false); ringFx(e.x, e.z, 2.2, EC('bolt') ?? 0x4aa8ff, 0.3); spark(e.x, 0.4, e.z, pc('bolt'), 10, 4, 0.35, 0.35, 0);
    query(e.x, e.z, 2.2, (o) => { if (o !== e) hitEnemy(o, s.dmg * 0.7, 0, 0, 'magic', { noChain: true }); }); }
  if (!cand.length) cds.bolt = 0.2;
}
function rollCall(n, dmg, evo) {
  const cand = enemies.filter((e) => !e.dead && !e.inv && e.spawn <= 0 && Math.hypot(e.x - player.x, e.z - player.z) < 15).sort((a, b) => b.hp - a.hp).slice(0, n);
  for (const e of cand) { books.push({ x: e.x, z: e.z, target: e, t: 0.45, dmg, evo, done: false, after: 0 }); dmgNum(e.x, e.z, '点名！', 'tag', e.r * 2 + 1.2); }
  return cand.length > 0;
}
const SOCK_ALT_RADIUS = 1.35;
const SOCK_ALT_SPEED = 0.25;
const SOCK_ALT_HEAL = 4;
const SOCK_AURA_TIMEOUT = 600;
const inSockAura = (target, aura) => (target.x - aura.x) ** 2 + (target.z - aura.z) ** 2 <= aura.radius ** 2;
function sockSupport(target, auras, dt) {
  if (target.hp <= 0 || target.hp >= target.maxHp || !auras.some((aura) => inSockAura(target, aura))) return;
  const healed = Math.min(target.maxHp - target.hp, SOCK_ALT_HEAL * dt);
  target.hp += healed;
  target.sockHealShown = (target.sockHealShown || 0) + healed;
  if (target.sockHealShown >= 2) {
    dmgNum(target.x, target.z, '+' + Math.floor(target.sockHealShown), 'heal', 2.3);
    spark(target.x, 0.9, target.z, 0x55db91, 5, 1.6, 0.25, 0.45, -2);
    target.sockHealShown %= 1;
  }
}
const sockAuraRadius = () => ws('sock').rad * area('magic') * SOCK_ALT_RADIUS;
function remoteSockAuras() {
  if (!NET?.on || state === 'title') return [];
  const now = performance.now();
  return Object.values(NET.peers).filter((peer) => !peer.dead && peer.radius > 0 && now - peer.sockSeen <= SOCK_AURA_TIMEOUT);
}
let sockR = 0;
function sockTick(dt, s, evo) {
  const rad = s.rad * area('magic') * (evo ? 1.6 : 1); sockR = rad;
  const doubleStink = player.alt.sock;
  if (Math.random() < dt * 16) { const a = rnd(0, TAU), r = rnd(0.3, rad); spark(player.x + Math.cos(a) * r, rnd(0.2, 0.9), player.z + Math.sin(a) * r, ecRand('sock') ?? (Math.random() < 0.5 ? 0x9ad04a : 0xd0ec7a), 1, 0.4, 0.4, 1.0, -0.6); }
  if (doubleStink) {
    query(player.x, player.z, rad * SOCK_ALT_RADIUS, (enemy) => {
      enemy.sockSlow = 1;
    });
  }
  cds.sock = (cds.sock ?? 0) - dt; if (cds.sock > 0) return; cds.sock = s.cd * cdMul('magic');
  const X = player.sp.sock || {};
  query(player.x, player.z, rad, (e, dx, dz) => { e.slow = X.linger ? 2 : 0.6; if (evo) e.stink = 1.0; hitEnemy(e, s.dmg * (1 + 0.1 * R('laundry')) * (X.close ? 1 + 1.5 * Math.max(0, 1 - Math.hypot(dx, dz) / rad) : 1), 0, 0, 'magic', { noCrit: true }); });
  if (X.pulse) { sockPulse -= cds.sock; if (sockPulse <= 0) { sockPulse = 3; ringFx(player.x, player.z, rad * 2, EC('sock') ?? 0xa8e04a, 0.45); burst(player.x, 0.5, player.z, EC('sock') ?? 0x9ad04a, 40, rad * 4, 0.5, 0.6, -1); query(player.x, player.z, rad * 2, (e, dx, dz) => { const L = Math.hypot(dx, dz) || 1; hitEnemy(e, s.dmg * 4, dx / L * 5, dz / L * 5, 'magic'); }); } }
}
function chain(from, cur, jumps, dmg, splash) {
  const seen = new Set(), path = [from], X = player.sp.bolt || {}, first = cur; let prevC = null;
  for (let j = 0; j < jumps && cur; j++) {
    seen.add(cur); if (prevC) carry(prevC, cur); prevC = cur; path.push({ x: cur.x, y: 0.7, z: cur.z }); hitEnemy(cur, dmg * (1 - j * 0.04), 0, 0, 'magic');
    if (splash) query(cur.x, cur.z, 2, (o) => { if (o !== cur) hitEnemy(o, dmg * 0.4, 0, 0, 'magic', { noCrit: true }); });
    if (X.fork && Math.random() < 0.35) { const f = nearest(cur.x, cur.z, 3.5, seen); if (f) { zap([{ x: cur.x, y: 0.7, z: cur.z }, { x: f.x, y: 0.7, z: f.z }], EC('bolt') ?? 0x4aa8ff, 0.25, 0.3, 3); hitEnemy(f, dmg * 0.6, 0, 0, 'magic'); } }
    spark(cur.x, 0.7, cur.z, EC('bolt') ?? 0x4aa8ff, 6, 3, 0.3, 0.3); cur = nearest(cur.x, cur.z, X.far ? 8 : 5, seen);
  }
  if (X.back && path.length > 2 && !first.dead) { path.push({ x: first.x, y: 0.7, z: first.z }); hitEnemy(first, dmg * 1.5, 0, 0, 'magic'); spark(first.x, 0.8, first.z, 0xffffff, 10, 5, 0.35, 0.3); }
  zap(path, EC('bolt') ?? 0x4aa8ff, 0.3, 0.3, 5); zap(path, elOf('bolt').length > 1 ? EC('bolt', 1) : 0xffffff, 0.18, 0.1, 2);
}
function addMinion(life, x, z) {
  const TINTS = [0xffe14d, 0xff9ac1, 0x8ee39a, 0x8fd3ff, 0xffb86b, 0xc9a7ff];
  const a = Math.random() * TAU;
  const m = { x: x ?? player.x + Math.cos(a) * 1.5, z: z ?? player.z + Math.sin(a) * 1.5, yaw: 0, ph: 0, moving: 1, seed: Math.random(), atk: 0, shootCd: rnd(0, 1), swing: 0, tint: new THREE.Color(TINTS[minions.length % 6]), temp: life, max: life };
  minions.push(m); spark(m.x, 0.5, m.z, TINTS[minions.length % 6], 14, 4, 0.35, 0.5);
}
function updateSummons(dt) {
  const ms = player.weapons.minion ? ws('minion') : WBASE.minion, big = SL.summon >= 3 ? 1.4 : 1;
  CW = 'minion';
  for (const m of minions) {
    if (Math.random() < dt * (EC('minion') != null ? 9 : 5)) puff('minion', m.x, 0.7, m.z, 1, 0.5, 0.3, 0.4);
    m.temp -= dt;
    const tgt = nearest(m.x, m.z, 9);
    let tx = player.x + Math.cos(m.seed * 20 + realTime * 0.5) * 1.8, tz = player.z + Math.sin(m.seed * 20 + realTime * 0.5) * 1.8;
    if (tgt && Math.hypot(tgt.x - player.x, tgt.z - player.z) < 12) { tx = tgt.x; tz = tgt.z; }
    const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz), reach = tgt ? tgt.r + 0.45 * big : 0.3;
    if (d > reach) { const sp = Math.min(SPX('minion', 'fast') ? 10 : 7, d * 4); m.x += dx / d * sp * dt; m.z += dz / d * sp * dt; m.yaw = Math.atan2(dx, dz); m.ph += sp * dt * 3; m.moving = 1; } else m.moving = 0;
    m.atk -= dt; m.swing = Math.max(0, m.swing - dt * 4); m.big = big;
    if (tgt && d <= reach + 0.2 && m.atk <= 0) {
      m.atk = ms.atk * cdMul('summon') * (SPX('minion', 'fast') ? 0.75 : 1); m.swing = 1;
      hitEnemy(tgt, ms.dmg, dx / (d || 1) * 3, dz / (d || 1) * 3, 'summon');
      if (SL.summon >= 2) query(tgt.x, tgt.z, 1.2, (o) => { if (o !== tgt) hitEnemy(o, ms.dmg * 0.5, 0, 0, 'summon', { noCrit: true }); });
      spark(tgt.x, 0.6, tgt.z, 0xffe14d, 4, 3, 0.25, 0.25);
    }
    if (player.duos.binder) { m.shootCd -= dt; const e = tgt && d < 7 ? tgt : null; if (e && m.shootCd <= 0) { m.shootCd = 1; shoot('staple', m.x, 0.6, m.z, Math.atan2(e.x - m.x, e.z - m.z), 20, 0.5, 4 + 2 * W('stapler'), 'gun'); } }
    pushOutProps(m, 0.3);
  }
  minions = minions.filter((m) => { if (m.temp <= 0) { spark(m.x, 0.5, m.z, 0xffe14d, 8, 3, 0.3, 0.3); if (SPX('minion', 'burst')) boom(m.x, m.z, 1.9, ms.dmg * 2.5, 'summon', EC('minion') ?? 0xffe14d); return false; } return true; });
  const ls = player.weapons.lamp ? ws('lamp') : WBASE.lamp;
  CW = 'lamp';
  for (const L of lamps) {
    if (Math.random() < dt * (EC('lamp') != null ? 14 : 7)) puff('lamp', L.x + rnd(-0.3, 0.3), 1.4, L.z + rnd(-0.3, 0.3), 1, 0.5, 0.32, 0.45);
    L.life -= dt; L.drop = Math.max(0, L.drop - dt * 3); L.cd -= dt; L.planeCd -= dt;
    const e = nearest(L.x, L.z, SPX('lamp', 'far') ? 16.5 : 11); if (e) L.aim = Math.atan2(e.x - L.x, e.z - L.z);
    if (e && L.cd <= 0) {
      L.cd = ls.atk * cdMul('summon');
      const ox = L.x + Math.sin(L.aim) * 0.35, oz = L.z + Math.cos(L.aim) * 0.35;
      if (player.evo.lamp || SL.summon >= 2) {
        const len = player.evo.lamp ? 14 : Math.hypot(e.x - L.x, e.z - L.z) + 2, ex = ox + Math.sin(L.aim) * len, ez = oz + Math.cos(L.aim) * len;
        for (const o of enemies) { if (o.dead) continue; const t = clamp(((o.x - ox) * (ex - ox) + (o.z - oz) * (ez - oz)) / (len * len), 0, 1); const px = ox + (ex - ox) * t, pz = oz + (ez - oz) * t; if (Math.hypot(o.x - px, o.z - pz) < o.r + 0.3) hitEnemy(o, ls.dmg, 0, 0, 'summon'); }
        zap([{ x: ox, y: 0.9, z: oz }, { x: ex, y: 0.5, z: ez }], EC('lamp') ?? 0xfff1a8, 0.14, 0, EC('lamp') != null ? 4 : 1);
      } else { hitEnemy(e, ls.dmg, 0, 0, 'summon'); zap([{ x: ox, y: 0.9, z: oz }, { x: e.x, y: 0.6, z: e.z }], EC('lamp') ?? 0xfff1a8, 0.12, 0, EC('lamp') != null ? 4 : 1); }
      spark(e.x, 0.6, e.z, 0xfff1a8, 5, 3, 0.3, 0.25);
    }
    if (player.duos.harbor && L.planeCd <= 0) { L.planeCd = 1.5; planes.push({ x: L.x, y: 1.2, z: L.z, yaw: L.aim, sp: 9, life: 3, dmg: 16 + 6 * W('plane'), target: null, pierce: 0, hit: new Set() }); }
  }
  lamps = lamps.filter((L) => { if (L.life <= 0) { spark(L.x, 0.5, L.z, 0x3faa6a, 14, 4, 0.3, 0.4); return false; } return true; });
  CW = 'duck';
  for (const dk of ducks) {
    dk.life -= dt; dk.ph += dt * 7; dk.drop = Math.max(0, dk.drop - dt * 3);
    if (Math.random() < dt * 0.9) dmgNum(dk.x, dk.z, '嘎', 'tag', 1.3); if (Math.random() < dt * 8) puff('duck', dk.x + rnd(-0.4, 0.4), 0.9, dk.z + rnd(-0.4, 0.4), 1, 0.8, 0.3, 0.5);
    if (dk.life <= 0) {
      const rad = (dk.evo ? 5 : 2.6) * (SPX('duck', 'big') ? 1.3 : 1); ringFx(dk.x, dk.z, rad, EC('duck') ?? 0xffd23f, 0.35); elemBurst('duck', dk.x, dk.z, rad); ripple(dk.x, dk.z, 0.9);
      for (const c of [0xff6fa8, 0x8fd3ff, 0xffd23f, 0x8ee39a]) spark(dk.x, 0.8, dk.z, ecRand('duck') ?? c, 10, 7, 0.35, 0.7, 5);
      query(dk.x, dk.z, rad, (o, dx, dz) => { const L = Math.hypot(dx, dz) || 1; hitEnemy(o, dk.dmg, dx / L * 8, dz / L * 8, 'summon'); });
      if (player.duos.quack && player.weapons.rollcall) rollCall(1, ws('rollcall').dmg, false);
      if (SPX('duck', 'echo') && !dk.echoed) { dk.echoed = true; dk.life = 0.5; dk.dmg *= 0.5; }
    }
  }
  ducks = ducks.filter((d) => d.life > 0);
}

/* ================= 地图任务 ================= */
const TASKS = {
  mop:   { name: '把地板擦干净', desc: '走过脏地板就能擦掉', c: 0x3fc98a, ic: 'sparkle' },
  kill:  { name: '清场',         desc: '在圈里打倒 25 只怪', c: 0xff5a5a, ic: 'target' },
  hold:  { name: '守住讲台',     desc: '在圈里站满 8 秒', c: 0x4aa8ff, ic: 'flag' },
  traps: { name: '机关地砖',     desc: '按正确顺序踩，踩错重来', c: 0xffab2e, ic: 'grid' },
};
const PLATE_C = [0xf0564a, 0x3f97e8, 0xffc93c, 0x4fbf6a];
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
let task = null, nextTask = 50, taskHudT = 0;
// 任务圈：转动的虚线边 + 往外扩的波纹 + 扇形进度
const zoneMat = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color() }, uProg: { value: 0 }, uTime }, transparent: true, depthWrite: false, toneMapped: false,
  vertexShader: `varying vec2 vP; void main(){ vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform vec3 uColor; uniform float uProg; uniform float uTime; varying vec2 vP;
    void main(){ float r=length(vP); if(r>1.0) discard; float a=atan(vP.x,vP.y)/6.28318+0.5;
      float dash=step(0.45,fract(a*20.0+uTime*0.22)); float ring=smoothstep(0.9,0.915,r)*dash; float inner=smoothstep(0.87,0.85,r);
      float pie=step(a,uProg)*inner; float glow=smoothstep(0.2,0.86,r)*inner*0.2;
      float pulse=smoothstep(0.035,0.0,abs(r-fract(uTime*0.45)*0.86))*inner*0.35;
      float al=ring+pie*0.4+glow+pulse+inner*0.07; vec3 col=mix(uColor,vec3(1.0),ring*0.25+pulse*0.8+pie*0.15);
      gl_FragColor=vec4(col,al); }`,
});
const zone = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), zoneMat); zone.rotation.x = -HP_; zone.position.y = 0.06; zone.visible = false; zone.renderOrder = 2; scene.add(zone);
const beamMat = new THREE.ShaderMaterial({
  uniforms: { uColor: zoneMat.uniforms.uColor, uTime }, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform vec3 uColor; uniform float uTime; varying vec2 vUv; void main(){ float s=0.75+0.25*sin(vUv.x*50.0+uTime*2.0); float f=pow(1.0-vUv.y,2.2); gl_FragColor=vec4(uColor*f*s*0.16,1.0); }`,
});
const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true), beamMat); beam.visible = false; scene.add(beam);
// 脏污：一团带墨线的泥点
const dirtCv = document.createElement('canvas'); dirtCv.width = dirtCv.height = 128;
{ const c = dirtCv.getContext('2d'); const bl = [[64, 66, 34], [36, 50, 20], [92, 48, 22], [44, 90, 18], [88, 88, 20], [64, 30, 16], [22, 74, 10], [106, 70, 9]];
  c.fillStyle = '#3a2228'; for (const [x, y, r] of bl) { c.beginPath(); c.arc(x, y, r + 5, 0, TAU); c.fill(); }
  c.fillStyle = '#8a6238'; for (const [x, y, r] of bl) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
  c.fillStyle = '#a57a48'; c.beginPath(); c.ellipse(54, 54, 16, 9, -0.6, 0, TAU); c.fill(); c.fillStyle = '#fff'; c.globalAlpha = 0.7; c.beginPath(); c.ellipse(50, 50, 6, 3.5, -0.6, 0, TAU); c.fill(); }
const dirtTex = new THREE.CanvasTexture(dirtCv); dirtTex.colorSpace = THREE.SRGBColorSpace;
const dirtMat = new THREE.MeshBasicMaterial({ map: dirtTex, transparent: true, depthWrite: false });
const dirtMeshes = Array.from({ length: 20 }, (_, i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dirtMat); m.rotation.set(-HP_, 0, i * 1.7); m.position.y = 0.05; m.visible = false; m.renderOrder = 3; scene.add(m); return m; });
// 机关地砖：四种颜色 + 四种符号
function symTex(k) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d');
  c.strokeStyle = '#fff'; c.lineWidth = 13; c.lineJoin = c.lineCap = 'round'; c.beginPath();
  if (k === 0) c.arc(64, 64, 34, 0, TAU);
  else if (k === 1) { c.moveTo(64, 26); c.lineTo(102, 96); c.lineTo(26, 96); c.closePath(); }
  else if (k === 2) c.rect(30, 30, 68, 68);
  else { for (let i = 0; i < 10; i++) { const a = -HP_ + i * PI / 5, r = i % 2 ? 18 : 42; c[i ? 'lineTo' : 'moveTo'](64 + Math.cos(a) * r, 64 + Math.sin(a) * r); } c.closePath(); }
  c.stroke(); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const plateMeshes = PLATE_C.map((c, k) => {
  const g = new THREE.Group(); const top = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.2, 1.35), new THREE.MeshToonMaterial({ color: c, gradientMap: grad })); g.add(top);
  const o = new THREE.Mesh(top.geometry, outlineMat); o.scale.set(1.07, 1.3, 1.07); g.add(o);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: symTex(k), transparent: true, depthWrite: false, toneMapped: false })); s.rotation.x = -HP_; s.position.y = 0.105; g.add(s);
  g.visible = false; g.userData = { top, s }; scene.add(g); return g;
});
const sockRing = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ map: stinkTex, transparent: true, opacity: 0.7, depthWrite: false }));
sockRing.rotation.x = -HP_; sockRing.position.y = 0.035; sockRing.visible = false; scene.add(sockRing);
const outerSockMaterial = new THREE.MeshBasicMaterial({ map: stinkTex, color: 0xc1f05c, transparent: true, depthWrite: false });
const sockAuraMeshes = Array.from({ length: 4 }, () => {
  const mesh = new THREE.Mesh(sockRing.geometry, outerSockMaterial);
  mesh.rotation.x = -HP_;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
});
const SYM = ['○', '△', '□', '☆'];
function taskHud() {
  const D = TASKS[task.type], el = $('task'), c = hex(D.c);
  el.className = 'task frame'; el.style.setProperty('--c', c); el.hidden = false; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  el.innerHTML = `${ico(c, D.ic)}<div class="tn">${D.name}<small>${D.desc} · 奖励宝箱</small></div><span class="tt" id="tkT"></span>
    <div class="tp">${task.type === 'traps' ? `<div class="dots" id="tkD">${[0, 1, 2, 3].map(() => '<i></i>').join('')}</div>` : '<div class="bar"><i id="tkB" style="width:0"></i></div>'}<span id="tkN"></span></div>`;
  $('tmark').innerHTML = `<div class="pin frame" style="--c:${c}">${ico(c, D.ic)}<span id="tkM"></span></div><i class="arr" hidden></i>`;
  task.shown = -1;
}
function startTask(force) {
  const types = Object.keys(TASKS), type = TASKS[force] ? force : types[(Math.random() * types.length) | 0];
  let x = 0, z = 0;
  for (let k = 0; k < 30; k++) { const a = rnd(0, TAU), r = rnd(8, 13); x = clamp(player.x + Math.cos(a) * r, -HX + 5, HX - 5); z = clamp(player.z + Math.sin(a) * r, -HZ + 5, HZ - 5); if (!inWall(x, z, 4) && !PROPS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 4)) break; }
  task = { type, x, z, t: type === 'traps' ? 60 : 45, max: type === 'traps' ? 60 : 45, prog: 0, need: type === 'mop' ? 18 : type === 'kill' ? 25 : type === 'hold' ? 8 : 4, rad: type === 'kill' ? 4.5 : type === 'hold' ? 2.4 : 3.3, age: 0 };
  if (type === 'mop') task.dirt = Array.from({ length: 18 }, () => { const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * 2.8; return { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, s: rnd(0.4, 0.62), on: true }; });
  if (type === 'traps') { task.plates = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b], i) => ({ x: x + a * 1.1, z: z + b * 1.1, i, lit: false, inside: false, flash: 0, bad: 0 })); task.order = shuffle([0, 1, 2, 3]); task.step = 0; task.rad = 2.6; }
  banner('新任务', TASKS[type].name); ripple(x, z, 1); taskHud(); taskHudT = 0;
}
function cleanDirt(d) { d.on = false; task.prog++; spark(d.x, 0.3, d.z, 0xffffff, 10, 3.5, 0.32, 0.45); burst(d.x, 0.2, d.z, 0x8fe6ff, 4, 2, 0.3, 0.5, 2); }
function endTask(ok) {
  const el = $('task'); el.classList.add(ok ? 'done' : 'fail'); el.insertAdjacentHTML('beforeend', `<span class="stamp">${ok ? '完成' : '超时'}</span>`); taskHudT = 1.6; $('tmark').hidden = true;
  if (ok) { run.tasks++; chests.push({ x: task.x, z: task.z, sp: 1 }); for (let k = 0; k < 6; k++) gems.push({ x: task.x + rnd(-1, 1), z: task.z + rnd(-1, 1), v: 3 + Math.floor(T / 90), sz: 1, pull: false, s: 0, ph: Math.random() * 6 }); banner('任务完成', '走过去开宝箱，选一个技能的特殊升级'); spark(task.x, 1, task.z, 0xffd23f, 70, 8, 0.4, 0.9); ringFx(task.x, task.z, task.rad * 1.5, 0xffe07a, 0.5); ripple(task.x, task.z, 1.4); nextTask = T + 70; }
  else { nextTask = T + 55; }
  task = null;
}
function updateTask(dt) {
  if (!task) return;
  task.t -= dt; task.age += dt; const d = Math.hypot(player.x - task.x, player.z - task.z);
  if (task.type === 'mop') { for (const q of task.dirt) if (q.on && Math.hypot(q.x - player.x, q.z - player.z) < 0.9) cleanDirt(q); }
  else if (task.type === 'hold') { if (d < task.rad) { task.prog += dt; if (Math.random() < dt * 8) spark(player.x + rnd(-0.5, 0.5), 0.2, player.z + rnd(-0.5, 0.5), 0x8fd0ff, 1, 1, 0.3, 0.7, -3); } }
  else if (task.type === 'traps') {
    for (const p of task.plates) {
      p.flash = Math.max(0, p.flash - dt * 3); p.bad = Math.max(0, p.bad - dt * 2.5);
      const inside = Math.abs(player.x - p.x) < 0.7 && Math.abs(player.z - p.z) < 0.7;
      if (inside && !p.inside && !p.lit) {
        if (task.order[task.step] === p.i) { p.lit = true; p.flash = 1; task.step++; task.prog = task.step; spark(p.x, 0.5, p.z, PLATE_C[p.i], 24, 5, 0.38, 0.55); ringFx(p.x, p.z, 1.4, PLATE_C[p.i], 0.3); dmgNum(p.x, p.z, '对！', 'tag', 1.6); }
        else { hurtPlayer(8 * DF().dmg); zap([{ x: p.x, y: 3, z: p.z }, { x: player.x, y: 0.6, z: player.z }], 0xfff1a8, 0.2, 0.5); dmgNum(p.x, p.z, '不对，重来', 'tag', 1.6); for (const q of task.plates) { q.lit = false; q.bad = 1; } task.step = 0; task.prog = 0; shake = Math.max(shake, 0.15); }
      }
      p.inside = inside;
    }
  }
  if (task.prog >= task.need) endTask(true); else if (task.t <= 0) endTask(false);
}
function drawTask(dt) {
  dirtMeshes.forEach((m) => (m.visible = false)); plateMeshes.forEach((m) => (m.visible = false));
  const tEl = $('task'), mk = $('tmark');
  if (taskHudT > 0) { taskHudT -= dt; if (taskHudT <= 0 && !task) tEl.hidden = true; }
  zone.visible = !!task && state !== "title"; beam.visible = zone.visible && task.type !== "traps";
  if (!task || state === 'title') { mk.hidden = true; if (state === 'title') tEl.hidden = true; return; }
  const col = TASKS[task.type].c, grow = 1 - Math.pow(1 - Math.min(1, task.age * 2.2), 3), frac = Math.min(1, task.prog / task.need);
  zoneMat.uniforms.uColor.value.set(col); zoneMat.uniforms.uProg.value = task.type === 'traps' ? 0 : frac;
  zone.position.set(task.x, 0.06, task.z); zone.scale.setScalar(task.rad * 1.12 * grow);
  beam.position.set(task.x, 3.5, task.z); beam.scale.set(task.rad * 0.96 * grow, 7, task.rad * 0.96 * grow);
  if (task.type === 'mop') task.dirt.forEach((q, i) => { const m = dirtMeshes[i]; m.visible = q.on; m.position.set(q.x, 0.05, q.z); m.scale.setScalar(q.s * grow * (1 + 0.05 * Math.sin(realTime * 3 + i))); });
  if (task.type === 'traps') task.plates.forEach((p, i) => {
    const m = plateMeshes[i], u = m.userData; m.visible = true;
    m.position.set(p.x + (p.bad > 0 ? Math.sin(realTime * 60) * 0.06 * p.bad : 0), (p.lit ? 0.05 : 0.13 + Math.sin(realTime * 3 + i * 1.6) * 0.03) * grow, p.z); m.scale.setScalar(grow * (1 + p.flash * 0.15));
    u.top.material.emissive.set(p.bad > 0 ? 0xff2a2a : p.lit ? PLATE_C[i] : 0xffffff).multiplyScalar(p.bad > 0 ? p.bad * 0.7 : p.lit ? 0.55 : p.flash * 0.6); u.s.material.opacity = p.lit ? 1 : 0.85;
  });
  // 任务卡片上的数字和进度
  const left = Math.ceil(task.t), unit = task.type === 'hold' ? `${task.prog.toFixed(1)} / ${task.need} 秒` : `${task.prog} / ${task.need}`, sig = unit + left;
  if (task.shown !== sig) {
    if (task.shownP !== undefined && task.shownP !== Math.floor(task.prog)) bump(tEl, 'bump'); task.shownP = Math.floor(task.prog); task.shown = sig;
    const tt = $('tkT'); tt.textContent = fmt(left); tt.classList.toggle('hot', left <= 10); $('tkN').textContent = unit; $('tkM').textContent = task.type === 'hold' ? `${Math.floor(task.prog)}/${task.need}` : unit.replace(/ /g, '');
    if (task.type === 'traps') [...$('tkD').children].forEach((d, k) => { const on = k < task.step; d.classList.toggle('on', on); d.style.setProperty('--c', on ? hex(PLATE_C[task.order[k]]) : ''); d.textContent = ''; }); else $('tkB').style.width = frac * 100 + '%';
  }
  // 浮在任务点上方的标记；出了屏幕就贴边并带箭头
  v3.set(task.x, 3.4, task.z).project(camera);
  const Wd = innerWidth, Hd = innerHeight; let sx = (v3.x * 0.5 + 0.5) * Wd, sy = (-v3.y * 0.5 + 0.5) * Hd;
  const off = sx < 50 || sx > Wd - 50 || sy < 130 || sy > Hd - 120, arr = mk.lastElementChild;
  mk.hidden = false; arr.hidden = !off;
  if (off) { const ang = Math.atan2(sy - Hd / 2, sx - Wd / 2); sx = clamp(sx, 60, Wd - 60); sy = clamp(sy, 140, Hd - 130); arr.style.transform = `rotate(${ang + HP_}rad) translateY(-30px)`; }
  mk.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
}

/* ================= 地图遗物 ================= */
const rBeam = new THREE.Mesh(beam.geometry, new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(0xffc93c) }, uTime }, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, vertexShader: beamMat.vertexShader, fragmentShader: beamMat.fragmentShader }));
rBeam.visible = false; scene.add(rBeam);
// 四个角落各有一个出怪口：每隔几秒轮流涌出一小队，朝玩家走过来
const PORTALS = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: a * (HX - 5), z: b * (HZ - 5), flash: 0 }));
const portalTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.translate(128, 128);
  const rg = g.createRadialGradient(0, 0, 8, 0, 0, 124); rg.addColorStop(0, '#120a1e'); rg.addColorStop(0.62, '#3a1f5e'); rg.addColorStop(0.86, '#8a4ad8'); rg.addColorStop(1, 'rgba(138,74,216,0)'); g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 126, 0, TAU); g.fill();
  g.lineCap = 'round'; for (let k = 0; k < 5; k++) { g.rotate(TAU / 5); g.strokeStyle = k % 2 ? 'rgba(255,200,255,.55)' : 'rgba(160,220,255,.5)'; g.lineWidth = 7; g.beginPath(); for (let t = 0; t <= 1; t += 0.04) { const r = 14 + t * 96, a = t * 3.2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
for (const p of PORTALS) {
  p.mesh = new THREE.Mesh(new THREE.CircleGeometry(2.6, 40), new THREE.MeshBasicMaterial({ map: portalTex, transparent: true, depthWrite: false })); p.mesh.rotation.x = -HP_; p.mesh.position.set(p.x, 0.06, p.z); p.mesh.renderOrder = 2; scene.add(p.mesh);
  p.rim = new THREE.Mesh(new THREE.RingGeometry(2.45, 2.75, 48), new THREE.MeshBasicMaterial({ color: 0xc89aff, transparent: true, opacity: 0.8, depthWrite: false })); p.rim.rotation.x = -HP_; p.rim.position.set(p.x, 0.07, p.z); scene.add(p.rim);
}
let portalAcc = 0, portalI = 0;
function portalWave() {
  const p = PORTALS[portalI++ % 4], pool = SPAWN_TABLE.filter((t) => T >= t[1] && !['bomber', 'chalk', 'mole', 'snail'].includes(t[0])), n = Math.min(12, 4 + Math.floor(T / 50));
  for (let k = 0; k < n; k++) { const a = rnd(0, TAU), r = rnd(0.2, 1.9), e = spawn(pool[(Math.random() * pool.length) | 0][0], p.x + Math.cos(a) * r, p.z + Math.sin(a) * r); if (e) e.spawn = 1 + k * 0.12; }
  p.flash = 1; ringFx(p.x, p.z, 3.4, 0xc89aff, 0.6); spark(p.x, 0.6, p.z, 0xc89aff, 30, 7, 0.4, 0.7); dust(p.x, p.z, 16, 5);
}
function drawPortals(dt) {
  for (const p of PORTALS) { p.mesh.visible = p.rim.visible = state !== 'title'; p.flash = Math.max(0, p.flash - dt * 1.2); p.mesh.rotation.z -= dt * (0.7 + p.flash * 5); const k = 1 + Math.sin(realTime * 2.2 + p.x) * 0.04 + p.flash * 0.25; p.mesh.scale.setScalar(k); p.rim.scale.setScalar(k); p.rim.material.opacity = 0.55 + p.flash * 0.45; }
}
function spawnAltar() {
  let x = 0, z = 0;
  for (let k = 0; k < 40; k++) { const a = rnd(0, TAU), r = rnd(14, 22); x = clamp(player.x + Math.cos(a) * r, -HX + 4, HX - 4); z = clamp(player.z + Math.sin(a) * r, -HZ + 4, HZ - 4); if (Math.hypot(x - player.x, z - player.z) > 11 && !inWall(x, z, 2.8) && !PROPS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 2.5)) break; }
  altars.push({ x, z, age: 0 }); banner('遗物出现', '跟着金色标记去找，三选一');
  $('rmark').innerHTML = `<div class="pin frame">${ico('#ffab2e', 'charm')}<span>遗物</span></div><i class="arr" hidden></i>`;
}
function drawAltarMark() {
  const mk = $('rmark'), a = altars[0]; rBeam.visible = !!a && state !== 'title';
  if (!rBeam.visible) { mk.hidden = true; return; }
  rBeam.position.set(a.x, 4.5, a.z); rBeam.scale.set(1.2, 9, 1.2);
  v3.set(a.x, 3.6, a.z).project(camera);
  const Wd = innerWidth, Hd = innerHeight; let sx = (v3.x * 0.5 + 0.5) * Wd, sy = (-v3.y * 0.5 + 0.5) * Hd;
  const off = sx < 50 || sx > Wd - 50 || sy < 130 || sy > Hd - 120, arr = mk.lastElementChild; if (!arr) { mk.hidden = true; return; }
  mk.hidden = false; arr.hidden = !off;
  if (off) { const ang = Math.atan2(sy - Hd / 2, sx - Wd / 2); sx = clamp(sx, 60, Wd - 60); sy = clamp(sy, 140, Hd - 130); arr.style.transform = `rotate(${ang + HP_}rad) translateY(-30px)`; }
  mk.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
}

/* ================= 输入（斜 45° 视角下的方向） ================= */
const keys = {};
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Tab' && state === 'play' && ov.hidden && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    if (!e.repeat) showRunItems();
    return;
  }
  if (e.code === 'Escape' || e.code === 'KeyP') { if (state === 'play') pause(); else if (state === 'paused') resume(); }
  if (state === 'title' && titleStep === 'prep' && ov.hidden && (e.code === 'ArrowRight' || e.code === 'ArrowLeft')) pickHero(selIdx + (e.code === 'ArrowRight' ? 1 : 4));
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
let joy = null; const joyEl = $('joy'), knob = joyEl.firstElementChild; const cv = renderer.domElement;
cv.addEventListener('pointerdown', (e) => { if (state !== 'play') return; joy = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 }; joyEl.style.left = e.clientX + 'px'; joyEl.style.top = e.clientY + 'px'; joyEl.hidden = false; knob.style.transform = ''; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', (e) => { if (!joy || e.pointerId !== joy.id) return; let dx = e.clientX - joy.x0, dy = e.clientY - joy.y0; const L = Math.hypot(dx, dy), M = 42; if (L > M) { dx = dx / L * M; dy = dy / L * M; } joy.dx = dx / M; joy.dy = dy / M; knob.style.transform = `translate(${dx}px, ${dy}px)`; });
const endJoy = () => { joy = null; joyEl.hidden = true; }; cv.addEventListener('pointerup', endJoy); cv.addEventListener('pointercancel', endJoy);
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pause(); });

/* ================= 界面 ================= */
const hud = { lv: 1, points: 0 };
const ov = $('ov'), panel = $('panel'), titleEl = $('title');
// 线条小图标：武器、属性、杂项都画成一套
const IC = {
  sweep: '<path d="M4 17 17 4l3 3L7 20z"/><path d="M8 13l1.5 1.5M11 10l1.5 1.5M14 7l1.5 1.5"/>',
  spin: '<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 3v5h-5"/><path d="M9 15l6-6"/>',
  mop: '<path d="M15 3 11 12"/><path d="M6 12h10l2 8H4z"/><path d="M9 16v4M13 16v4"/>',
  pencil: '<path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M14 6l4 4"/>',
  plane: '<path d="M3 11 21 3l-6 18-3-8z"/><path d="M12 13 21 3"/>',
  slipper: '<path d="M5 14c0-5 3-10 7-10s7 5 7 10c0 3-3 6-7 6s-7-3-7-6z"/><path d="M6.5 11c3.5-2.5 7.5-2.5 11 0"/>',
  stapler: '<path d="M3 17h18v3H3z"/><path d="M4 17 6 9l14 3v5"/><path d="M6 9l11-3 3 6"/>',
  shotgun: '<rect x="4" y="8" width="16" height="9" rx="2" transform="rotate(-20 12 12)"/><path d="M9.5 7.5l3 9"/>',
  bolt: '<path d="M13 2 5 14h6l-1 8 9-13h-6z"/>',
  coffee: '<path d="M5 9h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 11h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M8 3v3M12 3v3"/>',
  sock: '<path d="M9 3h6v9l4 4a3 3 0 0 1-4 4l-6-5z"/><path d="M9 7h6"/>',
  rollcall: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9z"/><path d="M8 11l2 2 3-3M8 17h8"/>',
  minion: '<path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/><path d="M9 9v2M14 9v2"/>',
  lamp: '<path d="M8 3h8l3 8H5z"/><path d="M12 11v8M8 21h8"/>',
  duck: '<path d="M9 9a4 4 0 1 1 7 2c3 0 5 2 5 5s-3 4-8 4-9-1-9-5c0-2 2-3 5-2"/><path d="M9 8H5l2 3"/>',
  s_dmg: '<path d="M20 4 9 15M20 4h-5M20 4v5M6 12l6 6M4 20l4-4"/>',
  s_crit: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  s_critDmg: '<path d="M12 2l2.9 6.2 6.6.8-4.9 4.6 1.3 6.6L12 17l-5.9 3.2 1.3-6.6L2.5 9l6.6-.8z"/>',
  s_atkSpd: '<path d="M4 6l7 6-7 6zM13 6l7 6-7 6z"/>',
  s_xp: '<path d="M12 3l2.6 5.6 6 .7-4.4 4.2 1.1 6L12 16.6 6.7 19.5l1.1-6L3.4 9.3l6-.7z"/>',
  s_luck: '<circle cx="8.5" cy="8.5" r="3.5"/><circle cx="15.5" cy="8.5" r="3.5"/><circle cx="8.5" cy="15.5" r="3.5"/><circle cx="15.5" cy="15.5" r="3.5"/>',
  s_dodge: '<path d="M3 8h10a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 18h7"/>',
  s_armor: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  s_regen: '<path d="M12 20s-8-4.6-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.4 12 20 12 20z"/><path d="M12 10v5M9.5 12.5h5"/>',
  s_speed: '<path d="M3 18v-7l5 1 3 3 7 1a3 3 0 0 1 3 2H3z"/><path d="M8 12l1-4"/>',
  s_maxHp: '<path d="M12 20s-8-4.6-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.4 12 20 12 20z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
  charm: '<path d="M12 2v4"/><path d="M12 6l7 6-7 10-7-10z"/><path d="M5 12h14"/>',
  curse: '<path d="M12 21C6 17 4 13.5 4 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5c0 4-2 7.5-8 11.5z"/><path d="M12 7l-2 4 4 2-2 4"/>',
  crown: '<path d="M3 18 5 7l5 5 2-7 2 7 5-5 2 11z"/>',
  sparkle: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  flag: '<path d="M5 21V4h13l-3 4 3 4H5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  chest: '<path d="M3 10a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v9H3z"/><path d="M3 12h18M12 10v4"/>',
  fire: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  ice: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3"/>',
  acid: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  watch: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  bubble: '<circle cx="12" cy="12" r="9"/><path d="M8 9a5 5 0 0 1 4-3"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
};
IC.star = IC.s_critDmg; IC.target = IC.s_crit; IC.elec = IC.bolt;
const ico = (c, key, s) => `<span class="ico" style="--c:${c}${s ? `;--s:${s}px` : ''}">${IC[key] ? `<svg viewBox="0 0 24 24">${IC[key]}</svg>` : key}</span>`;
const STAR = `<svg viewBox="0 0 24 24" fill="#ffc93c" stroke="#3a2228" stroke-width="2" stroke-linejoin="round"><path d="${IC.star.slice(9, -3)}"/></svg>`;
const bump = (el, c) => { if (!el) return; el.classList.remove(c); void el.offsetWidth; el.classList.add(c); };
function show(html, cls = '') { panel.className = 'panel ' + (cls || 'frame'); panel.innerHTML = html; ov.hidden = false; panel.style.animation = 'none'; void panel.offsetWidth; panel.style.animation = ''; }
function hide() { panel.querySelector('.codex-skill-preview')?.remove(); ov.hidden = true; }
const wipeEl = $('wipe');
function wipe(fn) { if (REDUCED) return fn(); wipeEl.classList.add('close'); setTimeout(() => { fn(); requestAnimationFrame(() => requestAnimationFrame(() => wipeEl.classList.remove('close'))); }, 420); }
let bannerT = 0;
function banner(text, sub = '', image = '') { const b = $('banner'); b.innerHTML = `<b>${image}${text}</b>` + (sub ? `<small>${sub}</small>` : ''); b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); bannerT = 2.4; }
const CLS_IDS = Object.keys(CLASSES);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const confetti = (n = 36) => `<div class="confetti">${Array.from({ length: n }, (_, i) => `<i style="left:${(i * 37 % 100)}%;background:${['#ffc93c', '#ff6b6b', '#4aa8ff', '#3fc98a', '#a98bff', '#fff'][i % 6]};animation-duration:${2.2 + (i * 13 % 10) / 5}s;animation-delay:${-(i * 7 % 30) / 10}s"></i>`).join('')}</div>`;

/* ---------- 首页 → 准备页 → 开局 ---------- */
let titleStep = 'home', selF = 0;
function clearField() { gifts = []; enemies = []; shots = []; planes = []; gems = []; chests = []; eshots = []; minions = []; lamps = []; ducks = []; slippers = []; books = []; wet = []; blasts = []; bolts = []; corpses = []; drops = []; altars = []; pendingInfuse = []; pools.length = 0; cups = []; pendingUlt = []; tele.visible = false; task = null; taskHudT = 0; boss = null; }
function showTitle(step) {
  if (state !== 'title') { clearField(); camPos.copy(camera.position); camTgt.copy(camLook); }
  if (typeof step === 'string') titleStep = step; else if (state !== 'title') titleStep = 'prep';
  state = 'title'; $('hud').hidden = true; hide(); $('stage').classList.remove('dead'); titleEl.hidden = false;
  if (titleStep === 'home') renderHome(); else renderPrep(true);
}
function backToTitle() { titleEl.hidden = false; if (titleStep === 'home') renderHome(); else if (titleStep === 'gacha') renderGacha(); else renderPrep(true); }
function renderHome(focusId = 'hGo') {
  titleEl.className = 'home';
  titleEl.innerHTML = `<div class="homeTop"><div class="logo" role="heading" aria-level="1" aria-label="${document.title}">${[...document.title].map((ch, i) => `<span aria-hidden="true" style="--i:${i}">${ch}</span>`).join('')}</div>
    <div class="tagline">拖延、错题、手机、DDL 都长出了腿</div></div>
    <button class="homeHelp" id="hHow">怎么玩</button>
    <nav class="homeLinks homeLinksLeft" aria-label="成就和图鉴">
      <button id="hAch">${ico('#eaa43a', 'star')}成就</button>
      <button id="hBook">${ico('#5289dc', 'rollcall')}图鉴</button>
    </nav>
    <nav class="homeLinks homeLinksRight" aria-label="排行、抽卡和成长">
      <button id="hRank">${ico('#36a680', 'crown')}排行</button>
      <button id="hGacha">${ico('#d86f93', 'sparkle')}抽卡</button>
      <button id="hGrowth">${illustratedBadge('stats', 'xp', STATS.xp.c)}成长</button>
    </nav>
    <div class="homeBot"><button class="primary big" id="hGo">开始</button><button id="hNet">联机</button></div>`;
  $('hGo').onclick = () => { titleStep = 'prep'; renderPrep(true); };
  $('hNet').onclick = netLobby;
  $('hHow').onclick = showHow;
  $('hBook').onclick = () => showCodex();
  $('hAch').onclick = showAch;
  $('hRank').onclick = showRanking;
  $('hGacha').onclick = () => openGacha();
  $('hGrowth').onclick = showGrowth;
  $(focusId).focus({ preventScroll: true });
}
function showGrowth() {
  titleEl.hidden = true;
  show(`<div class="chead"><h2>成长</h2><span class="pts" id="growthBalance"></span></div>
    <p>永久提升所有同学的开局属性和对局结算积分。每买一次，下一次升级就贵 ${GROWTH_COST_STEP} 积分。</p>
    <div class="growth-list" aria-label="基础属性"></div>
    <p id="growthResetNote" role="status" hidden></p>
    <div class="actions" id="growthActions">
      <button class="primary" id="growthClose">关闭</button>
      <button id="growthReset">重置</button>
    </div>
    <div class="actions" id="growthConfirm" hidden>
      <button id="growthCancel">取消</button>
      <button class="primary" id="growthApplyReset">确认重置</button>
    </div>`, 'frame growth');
  const list = panel.querySelector('.growth-list');
  const close = $('growthClose');
  const reset = $('growthReset');
  const note = $('growthResetNote');
  const actions = $('growthActions');
  const confirm = $('growthConfirm');
  const cancel = $('growthCancel');
  function showResetConfirmation(open) {
    actions.hidden = open;
    confirm.hidden = !open;
    note.hidden = !open;
    list.inert = open;
  }
  function renderGrowth() {
    const cost = growthCost();
    $('growthBalance').textContent = `积分 ${meta.pts}`;
    reset.disabled = growthTotal() === 0;
    list.innerHTML = Object.keys(GROWTH_STATS).map((id) => {
      const name = id === 'points' ? '积分获取倍率' : STATS[id].name;
      const level = growthLevel(id), maxed = level >= GROWTH_CAP;
      const current = growthBonusLabel(id, level);
      const next = maxed ? '' : ` → ${growthBonusLabel(id, level + 1)}`;
      const label = maxed ? '已满级' : `${cost} 积分升级`;
      return `<div class="growth-row">
        ${id === 'points' ? ico('#ed9b32', 'star', 30) : illustration('stats', id)}
        <div><b>${name}</b> <small>${level} / ${GROWTH_CAP} 级</small><span>${current}${next}</span></div>
        <button type="button" data-growth="${id}" aria-label="${name}，${label}" ${maxed || meta.pts < cost ? 'disabled' : ''}>${label}</button>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-growth]').forEach((button) => {
      button.onclick = () => {
        const id = button.dataset.growth;
        if (!buyGrowth(id)) return;
        note.hidden = true;
        renderGrowth();
        const next = list.querySelector(`[data-growth="${id}"]:enabled`) || close;
        next.focus({ preventScroll: true });
      };
    });
  }
  reset.onclick = () => {
    note.textContent = `重置会清空所有成长等级，返还 ${growthRefund()} 积分。`;
    showResetConfirmation(true);
    cancel.focus({ preventScroll: true });
  };
  cancel.onclick = () => {
    showResetConfirmation(false);
    reset.focus({ preventScroll: true });
  };
  $('growthApplyReset').onclick = () => {
    const refund = resetGrowth();
    showResetConfirmation(false);
    renderGrowth();
    note.textContent = `已返还 ${refund} 积分。`;
    note.hidden = false;
    close.focus({ preventScroll: true });
  };
  close.onclick = () => { hide(); titleEl.hidden = false; renderHome('hGrowth'); };
  renderGrowth();
  close.focus({ preventScroll: true });
}
function showRanking() {
  const rows = meta.top.map(({ h, d, t }, index) => {
    const hero = CLASSES[h]?.name || '同学';
    const difficulty = DIFFS[d]?.name;
    return `<li><span>${index + 1}. ${hero}${difficulty ? ` · ${difficulty}` : ''}</span><b>${fmt(t)}</b></li>`;
  });
  const empty = endlessOpen() ? '还没有无尽记录' : '通关一次标准模式后开放无尽';
  titleEl.hidden = true;
  show(`<h2>无尽排行</h2>
    ${rows.length ? `<ol class="lb">${rows.join('')}</ol>` : `<p>${empty}</p>`}
    <div class="actions"><button class="primary" id="rankClose">关闭</button></div>`, 'frame ranking');
  $('rankClose').onclick = () => { hide(); titleEl.hidden = false; renderHome('hRank'); };
  $('rankClose').focus();
}
function showAch() {
  if (state === 'title') titleEl.hidden = true;
  const doneCount = ACH.filter((a) => meta.ach.includes(a.id)).length;
  show(`<div class="chead"><h2>成就</h2><span class="pts">已达成 ${doneCount} / ${ACH.length}</span></div>
    <div class="codex-columns ach-columns">
      <section class="cgrid" aria-label="选择成就">${ACH.map((a) => {
        const done = meta.ach.includes(a.id);
        return `<button type="button" class="ctile${done ? '' : ' lock'}" aria-pressed="false" aria-controls="achDetail">
          <span class="crelic">${illustration('ach', a.id)}</span><span>${a.n}</span>
        </button>`;
      }).join('')}</section>
      <section id="achDetail" class="cdetail ach-detail" aria-label="成就详情" aria-live="polite" tabindex="0"></section>
    </div>
    <div class="actions"><button class="primary" id="aok">关闭</button></div>`, 'frame codex achievements');
  const tiles = panel.querySelectorAll('.ctile');
  const detail = $('achDetail');
  let selected = -1;
  function select(index) {
    if (index === selected) return;
    if (selected >= 0) {
      tiles[selected].classList.remove('sel');
      tiles[selected].setAttribute('aria-pressed', 'false');
    }
    selected = index;
    tiles[index].classList.add('sel');
    tiles[index].setAttribute('aria-pressed', 'true');
    const a = ACH[index];
    const done = meta.ach.includes(a.id);
    const goal = !done && a.goal?.();
    const progress = goal ? Math.min(goal[0], goal[1]) : 0;
    detail.innerHTML = `
      <div class="codex-art ach-art${done ? '' : ' locked'}">${illustration('ach', a.id)}</div>
      <div class="ach-detail-head"><h3>${a.n}</h3><span class="ach-status${done ? ' done' : ''}">${done ? '已达成' : '未达成'}</span></div>
      <dl class="ach-facts">
        <div><dt>达成条件</dt><dd>${a.d}${goal ? `
          <div class="ach-progress"><div class="mini" role="progressbar" aria-label="成就进度" aria-valuenow="${progress}" aria-valuemax="${goal[1]}"><i style="width:${progress / goal[1] * 100}%"></i></div><small>${progress} / ${goal[1]}</small></div>` : ''}</dd></div>
        <div><dt>奖励</dt><dd>${achReward(a)}${a.note ? `<small>${a.note}</small>` : ''}</dd></div>
      </dl>`;
    detail.scrollTop = 0;
  }
  tiles.forEach((tile, index) => tile.onclick = () => select(index));
  select(0);
  $('aok').onclick = () => { hide(); if (state === 'title') { backToTitle(); $('hAch')?.focus(); } };
  tiles[0].focus({ preventScroll: true });
}
const MON_ORDER = ['sleepy', 'bat', 'bomber', 'chalk', 'cross', 'mole', 'clock', 'ink', 'ghost', 'phone', 'snail', 'hourglass', 'boss'];
const MON_MORE = { sleepy: ['瞌睡团子', '最常见，慢吞吞地围上来'], bat: ['问号蝙蝠', '成群飞过来，不怕桌椅挡路'], hourglass: ['DDL 沙漏人', '精英，血很厚，打倒会掉宝箱'], boss: ['期末大魔王', '10:00 出场，打倒它就通关'] };
const MON_C = { sleepy: '#a98bd8', bat: '#7a5ad8', bomber: '#e2453a', chalk: '#e88aa0', cross: '#e0473c', mole: '#b8843a', clock: '#e0a800', ink: '#3a3f6a', ghost: '#9aa3b5', phone: '#3f97e8', snail: '#5fb04f', hourglass: '#c98a2e', boss: '#8a2a3a' };
if (localPreview) meta.seen = [...MON_ORDER];

const ICON_DIRECTORIES = {
  ach: 'achievement-icons',
  heroes: 'classmate-icons',
  skills: 'skill-icons',
  arts: 'art-icons',
  relics: 'relic-icons',
  mons: 'monster-icons',
  stats: 'stat-icons',
  elements: 'element-icons',
  duos: 'duo-icons',
  ultimates: 'ultimate-icons',
  alternateUltimates: 'alternate-ultimate-icons',
};
const SKILL_FORM_ICONS = { base: 'skills', evo: 'ultimates', alt: 'alternateUltimates' };
const illustration = (category, id) => `<img class="item-illustration" src="./${ICON_DIRECTORIES[category]}/${FRAGMENT_POOLS[category]?.[id]?.icon ?? id}.webp" width="48" height="48" alt="">`;
const illustratedBadge = (category, id, color, size) =>
  `<span class="ico illustrated" style="--c:${color}${size ? `;--s:${size}px` : ''}">${illustration(category, id)}</span>`;

function codexIcon(item, tab) {
  if (tab === 'skills' || tab === 'ach') return `<span class="crelic">${illustration(tab, item.id)}</span>`;
  if (tab === 'gacha') {
    return `<span class="crelic">${illustration(item.iconCategory, item.ic)}${item.open ? '' : ico('#a89a92', 'lock', 18)}</span>`;
  }
  if (ICON_DIRECTORIES[tab] && (!item.mon || item.open)) {
    return `<span class="crelic">${illustration(tab, item.id)}${item.open ? '' : ico('#a89a92', 'lock', 18)}</span>`;
  }
  return ico(item.open ? item.c : '#a89a92', item.open || item.mon ? item.ic : 'lock');
}

const skinPortraits = new Map();
function skinPortrait(hero, skinId) {
  const key = skinId || hero;
  if (skinPortraits.has(key)) return skinPortraits.get(key);

  const parts = skinId ? heroSkinParts(hero, SKINS[skinId]) : RIGS_DEF['hero_' + hero];
  const portrait = new THREE.Scene();
  const model = new THREE.Group();
  const materials = new Map();
  for (const [shape, color, position, scale, rotation, effect, outlined] of parts) {
    const glow = effect.includes('glow');
    const materialKey = glow ? color + 0x1000000 : color;
    if (!materials.has(materialKey)) materials.set(materialKey, glow ? new THREE.MeshBasicMaterial({ color }) : toonOf(color));
    const part = new THREE.Mesh(GEO[shape], materials.get(materialKey));
    part.position.fromArray(position);
    part.scale.fromArray(scale);
    if (rotation) part.rotation.fromArray(rotation);
    if (outlined) {
      const outline = new THREE.Mesh(part.geometry, outlineMat);
      outline.scale.setScalar(1.15);
      part.add(outline);
    }
    model.add(part);
  }
  portrait.add(model, new THREE.AmbientLight(0xfff4e6, 1.35));
  const light = new THREE.DirectionalLight(0xfff0d8, 1.7);
  light.position.set(-3, 6, 5);
  portrait.add(light);
  const view = new THREE.OrthographicCamera(-1.3, 1.3, 1.3, -1.3, 0.1, 20);
  view.position.set(1.6, 2, 5);
  view.lookAt(0, 1.04, 0);

  const size = 256;
  const target = new THREE.WebGLRenderTarget(size, size);
  const previousTarget = renderer.getRenderTarget();
  const previousColor = renderer.getClearColor(new THREE.Color());
  const previousAlpha = renderer.getClearAlpha();
  const pixels = new Uint8Array(size * size * 4);
  try {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0, 0);
    renderer.render(portrait, view);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousColor, previousAlpha);
    target.dispose();
    materials.forEach((material) => material.dispose());
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const srgb = Uint8ClampedArray.from({ length: 256 }, (_, channel) => {
    const value = channel / 255;
    return 255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);
  });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = ((size - 1 - y) * size + x) * 4;
      const to = (y * size + x) * 4;
      image.data.set([srgb[pixels[from]], srgb[pixels[from + 1]], srgb[pixels[from + 2]], pixels[from + 3]], to);
    }
  }
  context.putImageData(image, 0, 0);
  const url = canvas.toDataURL();
  skinPortraits.set(key, url);
  return url;
}

let cdxTab = 'heroes';
function heroStats(hero) {
  const maxHp = Math.max(...CLS_IDS.map((id) => CLASSES[id].hp));
  const speedFill = (hero.spd - 4.6) / 1.2;
  const weapon = WEAPONS[hero.start];
  return `<div class="hstats" style="--c:${TAGS[hero.tag].c}">
    <div><span>生命</span><div class="mini"><i style="width:${hero.hp / maxHp * 100}%"></i></div><b>${hero.hp}</b></div>
    <div><span>移速</span><div class="mini"><i style="width:${speedFill * 100}%"></i></div><b>${hero.spd.toFixed(1)}</b></div>
    <div class="wp"><span>武器</span>${illustratedBadge('skills', hero.start, weapon.c)}<span>${weapon.name}</span></div>
  </div>`;
}
const howGet = (kind, id) => { const a = achFor(kind, id); return DEF0[kind] && DEF0[kind].includes(id) ? '一开始就有' : a ? `达成成就「${a.n}」：${a.d}` : `用 ${PRICE[kind]} 积分兑换`; };
const tagOf = (kind, id) => achFor(kind, id) ? '成就' : `${PRICE[kind]} 积分`;
function itemLevelBonus(kind, id) {
  const item = FRAGMENT_POOLS[kind][id];
  if (item.pointsRate || item.pointsFlat || item.pointsWin) {
    const extra = itemExtraLevels(kind, id);
    if (!extra) return '';
    const bonus = item.pointsRate ? `+${extra}% 结算积分` : `+${extra} 积分`;
    return `${kind === 'relics' ? '每件' : ''}${item.pointsWin ? '通关时' : ''}额外提供 ${bonus}`;
  }
  if (kind === 'relics') {
    const damage = relicLevelDamage(id);
    return damage ? `每件额外提供 +${Number((damage * 100).toFixed(1))}% 基础伤害` : '';
  }
  if (kind === 'arts') {
    const hp = artLevelHp(id);
    return hp ? `拾取时额外提供 +${hp} 生命上限` : '';
  }
  return '';
}
function fragmentProgress(kind, id) {
  const level = itemLevel(kind, id);
  const count = fragmentCount(kind, id);
  const complete = fragmentComplete(kind, level);
  const next = level ? `升到 Lv ${level + 1}` : '解锁';
  const bonus = itemLevelBonus(kind, id);
  return `<div class="fragment-progress">${kind !== 'skills' && level ? `<b>Lv ${level} / ${ITEM_MAX_LEVEL}</b>` : ''}
    ${complete ? `<span>${kind === 'skills' ? '已解锁' : '已满级'} · 再抽到返 ${FRAGMENT_REFUND} 积分 / 碎片</span>` : `<span>${next} · ${count} / ${fragmentCost(level)} 碎片</span><progress aria-label="${next}所需碎片" value="${count}" max="${fragmentCost(level)}"></progress>`}
    ${bonus ? `<small>局内${bonus}</small>` : ''}</div>`;
}
function codexItems(tab) {
  if (tab === 'gacha') {
    const prizes = [...G_LEG, ...G_RARE].map((id) => { const ult = id.startsWith('ult_'), q = gItem({ id }), r = ult ? 2 : SKINS[id].r, w = ult && WEAPONS[id.slice(4)];
    return { id, name: q.name, c: RC[r], ic: ult ? q.ic : SKINS[id].h, iconCategory: ult ? 'alternateUltimates' : 'heroes', open: ult ? meta.ults.includes(id.slice(4)) : meta.skins.includes(id), tag: RN[r], desc: ult
      ? `传说 · ${w.name}的第二种终极形态：${ALT[id.slice(4)].desc}。<b>怎么获得：</b>只能在大鹅抽卡里抽到。抽到以后，这个技能升到 Lv 10 时可以在原来的「${w.evo.name}」和它之间二选一。`
      : `${RN[r]}皮肤 · ${CLASSES[SKINS[id].h].name}。${SKINS[id].aura ? '换一套配色，头顶光环，脚下一圈光。' : '换一套配色。'}<b>怎么获得：</b>只能在大鹅抽卡里抽到。抽到后在准备页选这位同学时换上。` }; });
    const fragments = Object.entries(FRAGMENT_POOLS).flatMap(([kind, pool]) => Object.keys(pool).map((id) => ({
      id: fragmentKey(kind, id), name: `${fragmentName(kind, id)}碎片`, c: pool[id].c ?? RC[1], ic: id,
      iconCategory: kind, open: fragmentOwned(kind, id), progress: fragmentProgress(kind, id),
      desc: `${FRAGMENT_LABEL[kind]}碎片。普通掉落 4 枚，稀有掉落 8 枚。`,
    })));
    return [...prizes, ...fragments];
  }
  if (tab === 'ach') return ACH.map((a) => ({ id: a.id, name: a.n, c: '#ffaa1e', ic: a.ic, open: meta.ach.includes(a.id), mon: true, desc: `${a.d}${a.note ? '，' + a.note : ''}。奖励：${achReward(a)}。${meta.ach.includes(a.id) ? '已达成。' : ''}` }));
  if (tab === 'heroes') return CLS_IDS.map((id) => { const c = CLASSES[id]; const sk = Object.keys(SKINS).filter((k) => SKINS[k].h === id).map((k) => `${SKINS[k].n}（${RN[SKINS[k].r]}）`).join('、'); return { id, name: c.name, short: c.short, c: TAGS[c.tag].c, ic: c.start, open: isOpen(id), kind: achFor('heroes', id) ? null : 'heroes', tag: tagOf('heroes', id), hint: howGet('heroes', id), desc: `${TAGS[c.tag].name} · ${c.desc}。加入后这个技能也会进入技能池。<b>怎么获得：</b>${howGet('heroes', id)}。皮肤（抽卡）：${sk}。` }; });
  if (tab === 'skills') return Object.entries(WEAPONS).map(([id, weapon]) => {
    const open = skillOpen(id);
    const item = { id, name: weapon.name, c: weapon.c, ic: id, open, progress: fragmentProgress('skills', id) };
    if (!open) return item;
    const alt = ALT[id];
    const altDesc = alt && (altOwned(id)
      ? `<b>第二种终极形态「${alt.name}」</b>：${alt.desc}。Lv 10 时二选一。`
      : `第二种终极形态「${alt.name}」可通过大鹅抽卡解锁。`);
    return { ...item, desc: `${TAGS[weapon.tag].name}。${weapon.desc}。每升一级：${LVUP[id][2]}。Lv 4 和 Lv 8 各注入一次元素，Lv 10 变成终极形态「${weapon.evo.name}」：${weapon.evo.desc}。${altDesc || ''}特殊升级（完成地图任务开宝箱拿）：${SP[id].map((x) => x[1]).join('、')}。` };
  });
  if (tab === 'arts' || tab === 'relics') return Object.entries(FRAGMENT_POOLS[tab]).map(([id, item]) => {
    const level = itemLevel(tab, id);
    const achievement = achFor(tab, id);
    const pickup = tab === 'arts' ? '对局里在金色光柱下三选一。' : '对局里通过怪物掉落或精英宝箱三选一。同一件可以叠加。';
    return {
      id, name: item.name, c: item.c ?? TAGS[item.tag]?.c ?? '#b8433a', open: level > 0,
      level, progress: fragmentProgress(tab, id), tag: `${fragmentCount(tab, id)} / ${FRAGMENT_UNLOCK} 碎片`,
      desc: `${item.desc}。${pickup}${achievement && !level ? `达成成就「${achievement.n}」也能解锁。` : ''}`,
    };
  });
  return MON_ORDER.map((id) => { const m = MON_INFO[id] || MON_MORE[id], seen = meta.seen.includes(id); return { id, name: seen ? m[0] : '？？？', c: seen ? MON_C[id] : '#a89a92', ic: seen ? m[0][0] : '?', open: seen, mon: true, desc: seen ? m[1] + '。' : '还没遇到过，对局里见到一次就会记下来。' }; });
}
function sendSkillDemo(frame, skill, form) {
  const origin = location.origin === 'null' ? '*' : location.origin;
  frame.contentWindow?.postMessage({ type: 'sandbox-brawl:skill-demo', skill, form }, origin);
}

function showCodex(tab = cdxTab, sel) {
  if (state === 'title') titleEl.hidden = true;
  const tabs = { heroes: '同学', skills: '技能', arts: '遗物', relics: '饰品', gacha: '抽卡奖池', ach: '成就', mons: '怪物' };
  show(`<div class="chead"><h2>图鉴</h2><span class="pts">积分 <b>${meta.pts}</b></span></div>
    <div class="codex-columns">
      <section class="codex-selection" aria-label="图鉴选择">
        <div class="ctabs">${Object.entries(tabs).map(([key, name]) => `<button data-t="${key}" aria-pressed="false">${name}</button>`).join('')}<span></span></div>
        <div class="cgrid"></div>
      </section>
      <section class="cdetail" aria-label="图鉴预览" tabindex="0">
        <div class="codex-art"></div>
      </section>
    </div>
    <div class="actions"><button class="primary" id="cok">关闭</button></div>`, 'frame codex');
  const tabButtons = panel.querySelectorAll('[data-t]');
  const grid = panel.querySelector('.cgrid');
  const detail = panel.querySelector('.cdetail');
  const art = detail.querySelector('.codex-art');
  let previewFrame = null;
  let previewSkill = null;
  let previewForm = 'base';

  function select(item, tile) {
    const previous = grid.querySelector('.ctile.sel');
    if (previous === tile) return;
    previous?.classList.remove('sel');
    previous?.setAttribute('aria-pressed', 'false');
    tile.classList.add('sel');
    tile.setAttribute('aria-pressed', 'true');

    const price = PRICE[item.kind];
    const nameOnly = cdxTab === 'skills' && !item.open;
    const canPreviewSkill = cdxTab === 'skills' && item.open;
    const animateSkill = canPreviewSkill && !REDUCED;
    previewForm = 'base';
    art.hidden = nameOnly;
    art.classList.toggle('locked', !item.open);
    art.style.setProperty('--preview-color', item.c);
    if (animateSkill) {
      previewSkill = item.id;
      if (!previewFrame) {
        previewFrame = document.createElement('iframe');
        previewFrame.className = 'codex-skill-preview';
        previewFrame.src = './index.html?skill-demo';
        previewFrame.tabIndex = -1;
        const frame = previewFrame;
        frame.onload = () => {
          if (frame === previewFrame && frame.isConnected) sendSkillDemo(frame, previewSkill, previewForm);
        };
        art.replaceChildren(previewFrame);
      } else {
        sendSkillDemo(previewFrame, previewSkill, previewForm);
      }
      previewFrame.title = `${item.name}技能动画`;
    } else {
      previewFrame = null;
      previewSkill = null;
      art.innerHTML = nameOnly ? '' : codexIcon(item, cdxTab);
    }
    while (art.nextElementSibling) art.nextElementSibling.remove();
    art.insertAdjacentHTML('afterend', `<h3>${item.name}${item.open && !item.mon ? '<em>已拥有</em>' : ''}</h3>`);
    detail.scrollTop = 0;
    if (item.progress) detail.insertAdjacentHTML('beforeend', item.progress);
    if (nameOnly) return;
    detail.insertAdjacentHTML('beforeend', `
      ${cdxTab === 'heroes' ? heroStats(CLASSES[item.id]) : ''}
      <p>${item.desc}</p>${!item.open && price ? `<button class="primary" id="cbuy" ${meta.pts < price ? 'disabled' : ''}>${meta.pts < price ? `还差 ${price - meta.pts} 积分` : `兑换 · ${price} 积分`}</button>` : !item.open && item.hint ? `<p><b>${item.hint}</b></p>` : ''}`);
    if (canPreviewSkill) {
      const weapon = WEAPONS[item.id];
      const forms = { base: { name: '基础形态', desc: item.desc }, evo: weapon.evo };
      if (ALT[item.id]) forms.alt = ALT[item.id];
      const description = detail.querySelector('p');
      const controls = document.createElement('div');
      controls.className = 'skins codex-skins codex-forms';
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', '预览技能形态');
      controls.innerHTML = Object.entries(forms).map(([key, form]) => {
        const isBase = key === 'base';
        const icon = illustration(SKILL_FORM_ICONS[key], item.id);
        const locked = key === 'alt' && !altOwned(item.id);
        return `<button type="button" class="sk${isBase ? ' on' : ''}" data-form="${key}" aria-pressed="${isBase}"${locked ? ' disabled' : ''}>${icon}<span>${form.name}</span></button>`;
      }).join('');
      detail.append(controls);
      const buttons = controls.querySelectorAll('button');
      buttons.forEach((button) => button.onclick = () => {
        const key = button.dataset.form;
        if (previewForm === key) return;
        previewForm = key;
        const form = forms[key];
        buttons.forEach((candidate) => {
          const active = candidate === button;
          candidate.classList.toggle('on', active);
          candidate.setAttribute('aria-pressed', String(active));
        });
        description.innerHTML = key === 'base' ? form.desc : `<b>终极形态 · ${form.name}</b>。${form.desc}。`;
        if (previewFrame) {
          previewFrame.title = `${key === 'base' ? item.name : form.name}技能动画`;
          sendSkillDemo(previewFrame, item.id, key);
        } else if (key !== 'base') {
          art.innerHTML = `<span class="crelic">${illustration(SKILL_FORM_ICONS[key], item.id)}</span>`;
        } else {
          art.innerHTML = codexIcon(item, cdxTab);
        }
      });
    }
    if (cdxTab === 'heroes') {
      const choices = ['', ...Object.keys(SKINS).filter((id) => SKINS[id].h === item.id)];
      const controls = document.createElement('div');
      controls.className = 'skins codex-skins';
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', '预览皮肤');
      controls.innerHTML = choices.map((id) => {
        const skin = SKINS[id];
        const locked = skin && !meta.skins.includes(id);
        return `<button type="button" class="sk" data-skin="${id}" aria-pressed="false"${locked ? ' disabled' : ''}>${skin?.n || '默认'}</button>`;
      }).join('');
      detail.append(controls);
      const buttons = controls.querySelectorAll('button');
      const preview = (button) => {
        if (button.classList.contains('on')) return;
        const skinId = button.dataset.skin;
        const name = SKINS[skinId]?.n || '默认';
        art.innerHTML = `<img class="codex-skin-model" src="${skinPortrait(item.id, skinId)}" alt="${item.name} · ${name}">`;
        buttons.forEach((candidate) => {
          const active = candidate === button;
          candidate.classList.toggle('on', active);
          candidate.setAttribute('aria-pressed', String(active));
        });
      };
      buttons.forEach((button) => button.onclick = () => preview(button));
      preview(buttons[0]);
    }
    const buyButton = $('cbuy');
    if (buyButton) buyButton.onclick = () => {
      if (!buy(item.kind, item.id)) return;
      const scroll = grid.scrollTop;
      panel.querySelector('.pts b').textContent = meta.pts;
      renderCategory(cdxTab, item.id).focus({ preventScroll: true });
      grid.scrollTop = scroll;
    };
  }

  function renderCategory(category, selectedId) {
    cdxTab = category;
    const items = codexItems(category);
    tabButtons.forEach((button) => {
      const active = button.dataset.t === category;
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', String(active));
    });
    panel.querySelector('.ctabs span').textContent = `${items.filter((item) => item.open).length} / ${items.length}`;
    grid.innerHTML = items.map((item) => `<button class="ctile ${item.open ? '' : 'lock'}" data-id="${item.id}" aria-label="${item.name}${(category === 'arts' || category === 'relics') && !item.open ? '，未解锁' : ''}" aria-pressed="false">${codexIcon(item, category)}<span>${item.short || item.name}</span>${item.level ? `<small>Lv ${item.level}</small>` : !item.open && item.tag ? `<small>${item.tag}</small>` : ''}</button>`).join('');
    grid.scrollTop = 0;
    const tiles = grid.querySelectorAll('.ctile');
    tiles.forEach((tile, index) => tile.onclick = () => select(items[index], tile));
    const index = Math.max(0, items.findIndex((item) => item.id === selectedId));
    select(items[index], tiles[index]);
    return tiles[index];
  }

  tabButtons.forEach((button) => button.onclick = () => {
    if (button.dataset.t !== cdxTab) renderCategory(button.dataset.t);
  });
  renderCategory(tab, sel);
  $('cok').onclick = () => { hide(); if (state === 'title') backToTitle(); };
}
function showHow() {
  const row = (c, k, a, b) => `<div>${ico(c, k)}<span><b>${a}</b>${b}</span></div>`;
  show(`<h2>怎么玩</h2><div class="how">
    ${row('#4aa8ff', 'move', '只管走位', '键盘 WASD，手机按住拖动。武器会自己打')}
    ${row('#ff6b6b', 'sweep', '升级三选一', '4、8、12 级各拿一个新技能；技能每级只加一样，4 级和 8 级注入元素，10 级变终极形态；完成地图任务能拿特殊升级')}
    ${row('#3fc98a', 'flag', '每 30 秒一个新事件', '新怪物、小任务、地图遗物轮着来，10:00 大魔王出场')}
    ${row('#a98bff', 'move', '四个教室一条走廊', '从走廊的门进出教室，怪也得走门。四个教室最外面的角落会一直出怪')}
    ${row('#ffab2e', 'charm', '去找遗物', '金色光柱下面有遗物，三选一，效果很强')}
    ${row('#ffaa1e', 'crown', '成就和抽卡', '大鹅抽卡可获得皮肤、第二种终极形态和碎片。集齐碎片会自动解锁武器、饰品或遗物，饰品和遗物还能继续升级。通关一次标准模式才开放无尽')}
  </div><div class="actions"><button class="primary" id="ok">知道了</button></div>`);
  $('ok').onclick = hide; $('ok').focus();
}
function renderPrep(fresh) {
  clsId = CLS_IDS[selIdx]; cls = CLASSES[clsId]; if (modeId === 'endless' && !endlessOpen()) modeId = 'std';
  const locked = !isOpen(clsId), t = TAGS[cls.tag], aL = locked && achFor('heroes', clsId), mySk = Object.keys(SKINS).filter((k) => SKINS[k].h === clsId), on = skinOf(clsId);
  const side = `
    <h3>选同学</h3>
    <div class="chips">${CLS_IDS.map((id, i) => { const c = CLASSES[id], lk = !isOpen(id); return `<button class="chip ${i === selIdx ? 'sel' : ''} ${lk ? 'locked' : ''}" data-i="${i}" aria-label="${c.name}">${lk ? ico(TAGS[c.tag].c, 'lock') : illustration('heroes', id)}${c.short || c.name}</button>`; }).join('')}</div>
    <div class="hinfo"><p>${aL ? `还没加入。达成成就「${aL.n}」（${aL.d}）后加入。` : locked ? `还没加入。用 ${PRICE.heroes} 积分兑换，现在有 ${meta.pts} 积分。每局结束都会拿到积分。` : cls.desc}</p>
      ${heroStats(cls)}</div>
    <h3>皮肤</h3>
    <div class="skins"><button class="sk ${on ? '' : 'on'}" data-sk="">${ico(t.c, cls.start)}默认</button>${mySk.map((k) => { const own = meta.skins.includes(k); return `<button class="sk ${on === k ? 'on' : ''} ${own ? '' : 'lk'}" data-sk="${k}" ${own ? '' : 'disabled'}>${ico(own ? RC[SKINS[k].r] : '#a89a92', own ? cls.start : 'lock')}${SKINS[k].n}${own ? '' : ' · 抽卡'}</button>`; }).join('')}</div>
    <h3>模式</h3>
    <div class="opts2">${Object.keys(MODES).map((m) => { const lk = m === 'endless' && !endlessOpen(); return `<button class="opt ${m === modeId ? 'on' : ''} ${lk ? 'lk' : ''}" data-m="${m}" ${lk ? 'disabled' : ''}><b>${MODES[m].name}</b><small>${lk ? '通关一次标准模式解锁' : m === 'std' ? '10:00 打倒大魔王' : bestEndless ? `最好 ${fmt(bestEndless)}` : '能撑多久算多久'}</small></button>`; }).join('')}</div>
    <h3>难度</h3>
    <div class="opts3">${Object.keys(DIFFS).map((d, k) => `<button class="opt ${d === diffId ? 'on' : ''}" data-d="${d}" style="--c:${['#b8f0cf', '#ffe07a', '#ffb0a8'][k]}"><b>${DIFFS[d].name}</b><span class="pep">${[0, 1, 2].map((q) => `<i class="${q <= k ? 'on' : ''}"></i>`).join('')}</span></button>`).join('')}</div>
    <p class="note">${MODES[modeId].note}。${DF().note}。</p>
    <div class="actions"><button id="pBack">返回</button><button class="primary big" id="go" ${locked && (aL || meta.pts < PRICE.heroes) ? 'disabled' : ''}>${aL ? '靠成就加入' : locked ? (meta.pts < PRICE.heroes ? `还差 ${PRICE.heroes - meta.pts} 积分` : `兑换 · ${PRICE.heroes} 积分`) : '出发！'}</button></div>`;
  const plate = `<div class="plate frame ${locked ? 'locked' : ''}"><b>${locked ? '？？？' : cls.name}</b>${locked ? `<small>${aL ? '成就解锁' : PRICE.heroes + ' 积分兑换'}</small>` : `<span class="role" style="--c:${t.c}">${t.name}</span>`}</div>`;
  if (fresh || titleEl.className !== 'prep') {
    titleEl.className = 'prep';
    titleEl.innerHTML = `<div class="stageUI"><button class="arrow l" id="pl" aria-label="上一位">‹</button><button class="arrow r" id="pr" aria-label="下一位">›</button><div id="plateBox">${plate}</div></div><div class="side frame" id="side">${side}</div>`;
    $('pl').onclick = () => pickHero(selIdx + CLS_IDS.length - 1); $('pr').onclick = () => pickHero(selIdx + 1);
  } else { $('plateBox').innerHTML = plate; const sc = $('side').scrollTop; $('side').innerHTML = side; $('side').scrollTop = sc; }
  titleEl.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { diffId = b.dataset.d; renderPrep(); });
  titleEl.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { modeId = b.dataset.m; renderPrep(); });
  titleEl.querySelectorAll('.chip').forEach((b) => b.onclick = () => pickHero(+b.dataset.i));
  titleEl.querySelectorAll('[data-sk]').forEach((b) => b.onclick = () => { meta.skinOn[clsId] = b.dataset.sk; saveMeta(); renderPrep(); if (b.dataset.sk) spark(TX, 1.5, TZ - 1, 0xffd23f, 50, 6, 0.4, 0.7); });
  $('pBack').onclick = () => { titleStep = 'home'; renderHome(); };
  $('go').onclick = () => { if (!isOpen(clsId)) { if (buy('heroes', clsId)) { renderPrep(); spark(TX, 1.5, TZ - 1, 0xffd23f, 80, 7, 0.4, 0.8); } return; } wipe(startRun); };
}
const GACHA_TURN_TIME = 0.65;
const GACHA_HIT_PHASE = 0.67;
const GACHA_HIT_RECOIL = 0.32;
const gch = { on: false, res: [], i: 0, t: 0, beat: 1, turnFrom: 0, hitT: 0, n: 1, hero: null, snap: false };
function openGacha(n) { wipe(() => { titleStep = 'gacha'; gch.snap = true; gch.hero = null; renderGacha(); if (n) gachaStart(n); }); }
function renderGacha() {
  titleEl.className = 'gacha'; titleEl.hidden = false; const p = GACHA.pity - (meta.stat.pity || 0);
  titleEl.innerHTML = `<div class="gTop"><button id="gBack" ${gch.on ? 'hidden' : ''}>返回</button><span class="pill">积分 ${meta.pts}</span></div>
    <div class="gTitle">大鹅抽卡</div>
    <div class="gSlots">${gch.on ? gch.res.map((q, i) => `<i class="gs" data-i="${i}"></i>`).join('') : ''}</div>
    <div class="gBot">${gch.on ? '<div class="row"><button id="gSkip">跳过动画</button></div>' : `<div class="row"><button class="big" id="g1" ${meta.pts < GACHA.one ? 'disabled' : ''}>单抽 · ${GACHA.one}</button><button class="primary big" id="g10" ${meta.pts < GACHA.ten ? 'disabled' : ''}>十连 · ${GACHA.ten}</button></div>
      <div class="row"><small>传说皮肤或终极形态 ${GACHA.legendary * 100}% · 80 抽保底 · 最多再抽 ${p} 次<br>稀有皮肤 ${GACHA.rareSkin * 100}% · 稀有碎片 ${GACHA.rareFragment * 100}% · 十连至少一张稀有或以上</small><button id="gPool">看奖池</button></div>`}</div>`;
  if (gch.on) $('gSkip').onclick = () => {
    if (!gch.on) return;
    gch.i = gch.res.length;
    gch.on = false;
    gch.hitT = 0;
    showGachaResults();
  };
  else { $('gBack').onclick = () => wipe(() => { titleStep = 'home'; gch.hero = null; renderHome(); }); $('g1').onclick = () => gachaStart(1); $('g10').onclick = () => gachaStart(10); $('gPool').onclick = () => showCodex('gacha'); }
}
function gachaStart(n) {
  const res = gachaPull(n);
  if (!res) return;
  Object.assign(gch, {
    on: true, res, i: 0, t: 0, hitT: 0, n, hero: null,
    beat: n > 1 ? 0.72 : 1.35,
    turnFrom: GS.goose.rotation.y,
  });
  renderGacha();
}
function gachaIcon(reward, item, color) {
  if (reward.kind) return illustratedBadge(reward.kind, reward.id, color);
  if (reward.id.startsWith('ult_')) return illustratedBadge('alternateUltimates', item.ic, color);
  return illustratedBadge('heroes', SKINS[reward.id].h, color);
}
function gImpact(q) {
  const c = new THREE.Color(RC[q.tier]).getHex(), el = titleEl.querySelector(`.gs[data-i="${gch.i - 1}"]`), it = gItem(q);
  if (el) { el.classList.add('on'); el.style.setProperty('--c', RC[q.tier]); el.innerHTML = gachaIcon(q, it, '#fff'); }
  const x = GPX, y = 2 * GACHA_PILLAR_SCALE, z = GZ;
  spark(x - 0.3, y, z, c, q.tier === 2 ? 150 : q.tier ? 70 : 30, q.tier === 2 ? 10 : 7, 0.45, 0.8);
  spark(x - 0.3, y, z, 0xffffff, 16, 5, 0.35, 0.5);
  ringFx(x, z, q.tier === 2 ? 7 : q.tier ? 4.5 : 3, c, 0.5); shake = q.tier === 2 ? 0.5 : 0.25; if (q.tier === 2) { chroma = 0.6; ringFx(x, z, 10, 0xffe07a, 0.8); }
}
function updateGacha(dt) {
  if (!gch.on) return;
  gch.t += dt;
  gch.hitT = Math.max(0, gch.hitT - dt);
  const elapsedBeats = (gch.t - GACHA_TURN_TIME) / gch.beat;
  if (gch.i < gch.res.length && elapsedBeats >= gch.i + GACHA_HIT_PHASE) {
    gImpact(gch.res[gch.i++]);
    gch.hitT = GACHA_HIT_RECOIL;
  }
  if (elapsedBeats >= gch.res.length + 0.5 && gch.hitT === 0) {
    gch.on = false;
    showGachaResults();
  }
}
function gachaResultStatus(reward) {
  const refund = reward.back ? `<em>返 ${reward.back} 积分</em>` : '';
  if (!reward.kind) return reward.dup ? refund : '<em class="new">新</em>';
  const { kind, from, level, remaining } = reward;
  const change = level > from
    ? `<em class="new">${from === 0 ? '已解锁' : `Lv ${from} → ${level}`}</em>`
    : '';
  const progress = fragmentComplete(kind, level)
    ? `<small>${kind === 'skills' ? '已解锁' : `Lv ${ITEM_MAX_LEVEL} 已满级`}</small>`
    : `<small>${level ? `升 Lv ${level + 1}` : '解锁'} · ${remaining} / ${fragmentCost(level)} 碎片</small>`;
  return change + progress + refund;
}
function showGachaResults() {
  const res = gch.res;
  const best = res.filter((q) => !q.kind && !q.dup && SKINS[q.id]).sort((a, b) => b.tier - a.tier)[0];
  $('gSkip').hidden = true;
  show(`${res.some((q) => q.tier === 2) ? confetti(30) : ''}<h2>抽到了</h2>
    <div class="gcards ${res.length === 1 ? 'one' : ''}">${res.map((q, i) => { const it = gItem(q); return `<div class="gcard t${q.tier}" style="--i:${i};--c:${RC[q.tier]}"><span class="rr">${RN[q.tier]}</span>${gachaIcon(q, it, RC[q.tier])}<b>${it.name}</b><small>${it.sub}</small>${gachaResultStatus(q)}</div>`; }).join('')}</div>
    ${res.some((q) => !q.kind && q.id.startsWith('ult_') && !q.dup) ? '<p>抽到的终极形态可在对局中技能升到 Lv 10 后选择。</p>' : ''}${best ? '<p>皮肤在准备页选同学时换上。</p>' : ''}
    <div class="actions"><button class="primary" id="gOk">收下</button><button id="gAgain" ${meta.pts < (gch.n === 10 ? GACHA.ten : GACHA.one) ? 'disabled' : ''}>再来${gch.n === 10 ? '十连' : '一次'}</button></div>`, 'frame gres');
  if (best) gch.hero = { h: SKINS[best.id].h, sk: best.id, t: 0 };
  $('gOk').onclick = () => { hide(); renderGacha(); }; $('gAgain').onclick = () => { hide(); gachaStart(gch.n); }; $('gOk').focus();
}
/* ================= 联机：最多 4 人，同一张地图 =================
 * 房主跑整局（刷怪、怪的走位、大魔王、时间线），每 0.1 秒把怪、怪的子弹、击倒名单发给队友。
 * 每个人自己的技能在自己这边打：打掉的血每 0.1 秒报给房主。经验、宝箱、遗物各拿各的。
 * 倒下后 12 秒在原地复活（还有队友站着时）；全员倒下这局结束。 */
const NET_API = (new URLSearchParams(location.search).get('api') || '/api/native/v1/games/brawl') + '/room';
const NET_TYPES = Object.keys(ET), NET_TI = Object.fromEntries(NET_TYPES.map((t, i) => [t, i]));
const ptags = document.createElement('div'); ptags.id = 'ptags'; document.body.appendChild(ptags);
let netName = ''; try { netName = localStorage.getItem('syntara.brawl.name') || ''; } catch (e) {}
const netHp = () => (NET && NET.on && NET.host ? 1 + 0.5 * (NET.n - 1) : 1);
async function netPost(body) {
  let r; try { r = await fetch(NET_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); } catch (e) { throw new Error('连不上联机服务器。网页版和 iPad 可以联机，桌面 App 暂时不行'); }
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!r.ok || !j) throw new Error((j && j.error) || '连不上联机服务器。网页版和 iPad 可以联机，桌面 App 暂时不行');
  return j;
}
const netSend = (m) => { if (NET) netPost({ op: 'send', code: NET.code, key: NET.key, m }).catch(() => {}); };
const myHero = () => (isOpen(CLS_IDS[selIdx]) ? CLS_IDS[selIdx] : meta.heroes[0]);
function netOpen(res, host) {
  if (NET && NET.es) NET.es.close();
  NET = { code: res.code, key: res.key, id: res.id, host, room: res.room, on: false, n: 1, peers: {}, mir: new Map(), K: [], used: new Set(), sendT: 0, sid: 0 };
  const es = new EventSource(`${NET_API}?code=${encodeURIComponent(res.code)}&key=${encodeURIComponent(res.key)}`);
  es.onmessage = (ev) => { try { netRecv(JSON.parse(ev.data)); } catch (e) { console.warn(e); } };
  es.onerror = () => { if (es.readyState === 2) netLost('和房间的连接断了'); };
  NET.es = es;
}
addEventListener('pagehide', () => { if (NET) { try { navigator.sendBeacon(NET_API, JSON.stringify({ op: 'leave', code: NET.code, key: NET.key })); } catch (e) {} } });
function netRecv(ev) {
  if (!NET) return;
  if (ev.t === 'closed') return netLost(ev.reason || '房间关闭了');
  if (ev.t === 'room') { const gone = NET.room.players.filter((p) => !ev.room.players.some((q) => q.id === p.id)); NET.room = ev.room; if (NET.on) for (const p of gone) { delete NET.peers[p.id]; banner(p.name + ' 离开了'); } else if (lobbyOpen()) renderLobby(); return; }
  if (ev.t === 'start') { NET.room = ev.room; return netBegin(ev.m || {}); }
  if (ev.t !== 'm' || !ev.m) return;
  const m = ev.m, from = ev.from;
  if (m.k === 'p' || m.k === 's') { if (m.p && NET.on) netPeer(from, m.p); if (m.k === 's' && !NET.host && NET.on) netApply(m); if (m.D && NET.host && NET.on) netDamage(m.D); }
  else if (m.k === 'end' && NET.on && !NET.host) { if (m.win) { if (state !== 'win') showWin(); } else netOver(); }
}
function netPeer(id, p) {
  const room = NET.room.players.find((q) => q.id === id); if (!room) return;
  let q = NET.peers[id]; if (!q) q = NET.peers[id] = { id, name: room.name, x: p.x, z: p.z, ps: { ph: 0, hit: 0, seed: Math.random(), moving: 0, glowMul: 2.4 } };
  const radius = [p.x, p.z, p.sockAura].every(Number.isFinite) && p.hp > 0
    ? clamp(p.sockAura, 0, Math.hypot(2 * HX, 2 * HZ)) : 0;
  Object.assign(q, { tx: p.x, tz: p.z, yaw: p.y, mv: p.m, hp: p.hp, mh: p.mh, lv: p.lv, h: p.h, sk: p.sk, dead: !!p.d, name: room.name, radius, sockSeen: performance.now() });
}
// 房主：队友打掉的血
function netDamage(Dm) {
  const by = new Map(); for (const e of enemies) if (!e.dead) by.set(e.id, e);
  for (let i = 0; i < Dm.length; i += 2) { const e = by.get(Dm[i]); if (!e || e.dead) continue; e.hp -= Dm[i + 1]; e.hit = 1; if (e.hp <= 0) killEnemy(e, ''); }
}
// 怪追最近的、还站着的玩家
function netTarget(e) {
  let best = player.ghost ? null : player, bd = best ? (player.x - e.x) ** 2 + (player.z - e.z) ** 2 : Infinity;
  for (const id in NET.peers) { const p = NET.peers[id]; if (p.dead || p.x == null) continue; const d = (p.x - e.x) ** 2 + (p.z - e.z) ** 2; if (d < bd) { bd = d; best = p; } }
  return best || player;
}
const r1 = (v) => Math.round(v * 10), r2 = (v) => Math.round(v * 100) / 100;
function netTick(dt) {
  if (!NET || !NET.on) return;
  for (const id in NET.peers) { const p = NET.peers[id]; if (p.tx == null) continue; const k = Math.min(1, dt * 10), dx = p.tx - p.x, dz = p.tz - p.z; if (Math.hypot(dx, dz) > 8) { p.x = p.tx; p.z = p.tz; } else { p.x += dx * k; p.z += dz * k; } p.ps.moving = p.mv || 0; p.ps.ph += (p.mv || 0) * dt * 14; p.ps.dark = p.dead; }
  player.dark = !!player.ghost;
  NET.sendT -= dt; if (NET.sendT > 0) return; NET.sendT = 0.1;
  const me = { x: r2(player.x), z: r2(player.z), y: r2(player.yaw), m: r2(player.moving), hp: Math.ceil(player.hp), mh: Math.ceil(player.maxHp), lv: player.lvl, h: clsId, sk: skinOf(clsId), d: player.ghost ? 1 : 0 };
  if (!player.ghost && player.hp > 0 && player.weapons.sock && player.alt.sock &&
      (state === 'play' || state === 'levelup' || state === 'paused')) me.sockAura = r2(sockAuraRadius());
  if (!NET.host) {
    const Dm = []; for (const [nid, e] of NET.mir) { const d = e.base - e.hp; if (d > 0.5) { Dm.push(nid, Math.round(d)); e.base = e.hp; } if (e.dead && !e.gone) { e.gone = 1; e.deadAt = realTime; } }
    return netSend({ k: 'p', p: me, D: Dm });
  }
  const E = []; for (const e of enemies) { if (e.dead) continue; E.push(e.id, NET_TI[e.type], r1(e.x), r1(e.z), Math.max(1, Math.round(e.hp / e.maxHp * 1000)), (e.giant ? 1 : 0) | (e.inv ? 2 : 0), e.fuse > 0 ? r1(e.fuse) : 0); }
  const S = []; for (const b of eshots) { if (!b.nid) b.nid = ++NET.sid; S.push(b.nid, r1(b.x), r1(b.z), r1(b.vx), r1(b.vz), r1(b.life), b.rig === 'chalkP' ? 1 : b.source === 'boss' ? 2 : 0, b.dmg || 8); }
  const B = boss && !boss.dead ? [boss.id, boss.atkN || 0, r2(boss.slam || 0), r2(boss.rushW || 0), r2(boss.rushT || 0), r2(boss.ax || 0), r2(boss.az || 0), boss.enraged ? 1 : 0] : null;
  netSend({ k: 's', p: me, T: r2(T), E, S, B, K: NET.K.splice(0) });
  // 全员倒下：这局结束
  if (player.ghost && Object.values(NET.peers).every((p) => p.dead)) { netSend({ k: 'end', win: 0 }); netOver(); }
}
// 队友：用房主发来的快照更新本地的怪
function netApply(m) {
  if (state === 'win' || state === 'dead') return;
  if (Math.abs(T - m.T) > 0.4) T = m.T;
  const E = m.E || [], seen = new Set();
  for (let i = 0; i < E.length; i += 7) {
    const nid = E[i], x = E[i + 2] / 10, z = E[i + 3] / 10; seen.add(nid);
    let e = NET.mir.get(nid);
    if (e && e.dead && (!e.deadAt || realTime - e.deadAt > 1.5)) { NET.mir.delete(nid); e = null; }
    if (!e) { NET.mirroring = true; e = spawn(NET_TYPES[E[i + 1]], x, z); NET.mirroring = false; if (!e) continue; e.nid = nid; e.spawn = 0; if (E[i + 5] & 1) { e.giant = 1; e.size *= 2.4; e.r *= 2.4; } e.hp = e.maxHp * E[i + 4] / 1000; e.base = e.hp; NET.mir.set(nid, e); }
    if (e.dead) continue;
    const hostHp = e.maxHp * E[i + 4] / 1000, unsent = Math.max(0, e.base - e.hp); e.hp = Math.min(e.hp, hostHp - unsent); e.base = e.hp + unsent;
    e.nx = x; e.nz = z; e.inv = !!(E[i + 5] & 2); e.under = e.inv; if (E[i + 6]) { e.fuse = E[i + 6] / 10; e.fuseMax = e.fuseMax || FUSE; } else e.fuse = 0;
  }
  for (const nid of m.K || []) { const e = NET.mir.get(nid); if (e && !e.dead) killEnemy(e, ''); }
  for (const [nid, e] of NET.mir) if (!seen.has(nid)) { if (!e.dead) e.dead = true; NET.mir.delete(nid); }
  const B = m.B; if (B) { const e = NET.mir.get(B[0]); if (e && !e.dead) { boss = e; $('bossBar').hidden = false; $('hud').classList.add('boss'); if (B[1] !== e.atkN) { e.atkN = B[1]; e.slam = B[2]; e.rushW = B[3]; e.rushT = B[4]; e.ax = B[5]; e.az = B[6]; e.rushHit = false; } e.enraged = !!B[7]; } }
  else if (boss && !boss.dead) { boss = null; $('bossBar').hidden = true; $('hud').classList.remove('boss'); }
  const S = m.S || [], out = [];
  for (let i = 0; i < S.length; i += 8) { if (NET.used.has(S[i])) continue; const old = eshots.find((b) => b.nid === S[i]); const b = old || { nid: S[i] }; Object.assign(b, { x: S[i + 1] / 10, y: 1, z: S[i + 2] / 10, vx: S[i + 3] / 10, vz: S[i + 4] / 10, life: S[i + 5] / 10, rig: S[i + 6] === 1 ? 'chalkP' : undefined, dmg: S[i + 7], source: S[i + 6] === 1 ? 'chalk' : S[i + 6] === 2 ? 'boss' : 'ghost' }); out.push(b); }
  for (const b of eshots) if (b.life <= 0 && b.nid) NET.used.add(b.nid);
  eshots = out; if (NET.used.size > 4000) NET.used.clear();
}
// 队友这边的怪：平滑跟到房主给的位置；大魔王的砸地和冲撞在本地按时间结算
function netMirrorStep(e, dt) {
  if (e.nx != null) { const dx = e.nx - e.x, dz = e.nz - e.z, d = Math.hypot(dx, dz); if (d > 6) { e.x = e.nx; e.z = e.nz; } else { const k = Math.min(1, dt * 10); e.x += dx * k; e.z += dz * k; } e.moving = d > 0.05 ? 1 : 0; e.ph += Math.min(d, 1) * dt * 30; }
  if (e.fuse > 0) e.fuse = Math.max(0.01, e.fuse - dt);
  if (e.type !== 'boss') return;
  const pd = Math.hypot(player.x - e.x, player.z - e.z);
  if (e.slam > 0) { e.slam -= dt; tele.visible = true; tele.position.set(e.x, 0.05, e.z); tele.scale.setScalar(6.8 * (1 - e.slam / 0.9) + 0.5); tele.material.opacity = 0.15 + 0.25 * (1 - e.slam / 0.9);
    if (e.slam <= 0) { tele.visible = false; ripple(e.x, e.z, 1.8); shake = 0.6; dust(e.x, e.z, 50, 9); ringFx(e.x, e.z, 7, 0xff5a4a, 0.4); if (pd < 7.2) hurtPlayer(32 * DF().dmg * tDmg(), e.type); } }
  if (e.rushW > 0) { e.rushW -= dt; if (e.rushW <= 0) e.rushT = 0.75; }
  else if (e.rushT > 0) { e.rushT -= dt; dust(e.x, e.z, 3, 5); if (!e.rushHit && pd < e.r + 1) { e.rushHit = true; hurtPlayer(34 * DF().dmg * tDmg(), e.type); } }
}
function netDie() {
  player.ghost = 1;
  player.ghostT = 12;
  player.hp = 0;
  hide();
  state = 'play';
  deathTaunt = pickDeathTaunt();
  const reviveHint = '队友还站着的话，12 秒后原地复活';
  banner('你倒下了', deathTaunt
    ? `<span class="down-taunt">${deathTaunt.speaker}：「${deathTaunt.line}」</span>${reviveHint}`
    : reviveHint);
}
function netGhostStep(dt) {
  player.ghostT -= dt;
  if (player.ghostT <= 0 && Object.values(NET.peers).some((p) => !p.dead)) { player.ghost = 0; player.dark = false; deathTaunt = null; defeatSource = null; player.hp = player.maxHp * 0.5; player.iframe = 2; ripple(player.x, player.z, 1.4); spark(player.x, 0.8, player.z, 0xffd23f, 90, 9, 0.45, 0.9); banner('复活了'); }
}
function drawPeers() {
  const W_ = innerWidth, H_ = innerHeight, live = new Set();
  for (const id in NET.peers) {
    const p = NET.peers[id]; if (p.x == null || !CLASSES[p.h]) continue; live.add(id);
    heroRig(p.h, SKINS[p.sk] ? p.sk : '').push(p.ps, worldM(p.x, 0, p.z, p.yaw || 0, 1, 1 + Math.sin(p.ps.ph * 2) * 0.02 * (p.mv || 0))); shadow(p.x, p.z, 0.55);
    let el = ptags.querySelector(`[data-id="${id}"]`); if (!el) { el = document.createElement('span'); el.dataset.id = id; el.innerHTML = '<em></em><i><b></b></i>'; ptags.appendChild(el); }
    el.firstChild.textContent = `${p.name} · Lv ${p.lv || 1}`; el.querySelector('b').style.width = (p.mh ? Math.max(0, p.hp / p.mh) * 100 : 0) + '%'; el.classList.toggle('dead', p.dead);
    v3.set(p.x, 2.9, p.z).project(camera); el.style.transform = `translate(${(v3.x * 0.5 + 0.5) * W_}px, ${(-v3.y * 0.5 + 0.5) * H_}px) translate(-50%, -100%)`;
  }
  for (const el of [...ptags.children]) if (!live.has(el.dataset.id)) el.remove();
}
function netBegin(m) {
  diffId = DIFFS[m.d] ? m.d : 'normal'; modeId = m.mode === 'endless' ? 'endless' : 'std';
  const me = NET.room.players.find((p) => p.id === NET.id), hero = me && CLASSES[me.hero] && isOpen(me.hero) ? me.hero : myHero();
  selIdx = CLS_IDS.indexOf(hero); NET.n = NET.room.players.length; NET.on = true; NET.peers = {}; NET.mir.clear(); NET.K = []; NET.used.clear();
  const idx = NET.room.players.findIndex((p) => p.id === NET.id);
  hide(); titleEl.hidden = true;
  wipe(() => { startRun(); player.ghost = 0; player.dark = false; player.x = (idx - (NET.n - 1) / 2) * 1.8; banner(NET.n > 1 ? `${NET.n} 人联机` : '联机（一个人）', modeId === 'std' ? '一起撑到 10:00，打倒期末大魔王' : '无尽模式：一起撑得越久越好'); });
}
function netOver() {
  if (state === 'dead' || state === 'win') return;
  state = 'dead'; $('stage').classList.add('dead'); const gain = settle(false);
  show(`<div class="eyebrow">联机 · ${MODES[modeId].name} · ${DF().name}</div><h2>全员倒下了</h2>
    ${deathTauntCard(deathTaunt)}
    <div class="stats"><div style="--i:0"><b>${fmt(T)}</b><small>撑了</small></div><div style="--i:1"><b>${player.kills}</b><small>击倒</small></div><div style="--i:2"><b>${player.lvl}</b><small>等级</small></div><div style="--i:3"><b>+${gain}</b><small>积分</small></div></div>
    ${buildSummary()}<div class="actions"><button class="primary" id="nback">回联机大厅</button><button id="nhome">离开房间</button></div>`);
  $('nback').onclick = () => netToLobby(); $('nhome').onclick = () => netLeave();
}
function netToLobby() { if (NET) { NET.on = false; NET.peers = {}; if (NET.host) netPost({ op: 'reset', code: NET.code, key: NET.key }).catch(() => {}); } wipe(() => { showTitle('home'); netLobby(); }); }
function netLeave() {
  const was = NET; NET = null; if (was) { was.es && was.es.close(); netPost({ op: 'leave', code: was.code, key: was.key }).catch(() => {}); }
  if (state !== 'title') { settle(false); wipe(() => showTitle('home')); } else { hide(); backToTitle(); }
}
function netLost(reason) {
  const was = NET; if (!was) return; NET = null; was.es && was.es.close();
  const inRun = state !== 'title';
  show(`<h2>联机断开了</h2><p>${reason}。</p><div class="actions"><button class="primary" id="nlok">回首页</button></div>`);
  $('nlok').onclick = () => { hide(); if (inRun) { settle(false); wipe(() => showTitle('home')); } else backToTitle(); };
}
const lobbyOpen = () => !ov.hidden && panel.classList.contains('lobby');
function netLobby() { if (state === 'title') titleEl.hidden = true; renderLobby(); }
function renderLobby(err = '') {
  if (!NET) {
    show(`<h2>联机</h2><p>最多 4 人一起打同一局。房主负责刷怪和大魔王，大家的技能各打各的，经验都能拿到。</p>
      <div class="nrow"><input id="nName" maxlength="12" placeholder="你的名字" value="${netName.replace(/"/g, '')}"><button class="primary" id="nCreate">建房间</button></div>
      <div class="nrow"><input id="nCode" maxlength="4" placeholder="房间码" autocomplete="off"><button id="nJoin">加入</button></div>
      <p class="err" id="nErr">${err}</p><div class="actions"><button id="nClose">返回</button></div>`, 'frame lobby');
    const nm = () => { netName = $('nName').value.trim().slice(0, 12) || '同学'; try { localStorage.setItem('syntara.brawl.name', netName); } catch (e) {} return netName; };
    const busy = (b) => { $('nCreate').disabled = $('nJoin').disabled = b; };
    $('nCreate').onclick = async () => { busy(true); try { const h = myHero(); const r = await netPost({ op: 'create', name: nm(), hero: h, skin: skinOf(h) }); netOpen(r, true); renderLobby(); } catch (e) { renderLobby(e.message); } };
    $('nJoin').onclick = async () => { const code = $('nCode').value.trim().toUpperCase(); if (code.length !== 4) return renderLobby('房间码是 4 位'); busy(true); try { const h = myHero(); const r = await netPost({ op: 'join', code, name: nm(), hero: h, skin: skinOf(h) }); netOpen(r, false); renderLobby(); } catch (e) { renderLobby(e.message); } };
    $('nCode').onkeydown = (e) => { if (e.key === 'Enter') $('nJoin').click(); };
    $('nClose').onclick = () => { hide(); backToTitle(); };
    return;
  }
  const R_ = NET.room, me = R_.players.find((p) => p.id === NET.id), host = NET.id === R_.host, mine = me ? me.hero : myHero();
  const slot = (p) => { const c = CLASSES[p.hero] || CLASSES.brawler; return `<div class="pl ${p.id === NET.id ? 'me' : ''}">${ico(TAGS[c.tag].c, c.start)}<div>${p.name}${p.id === R_.host ? '（房主）' : ''}<small>${c.name}${SKINS[p.skin] ? ' · ' + SKINS[p.skin].n : ''}</small></div></div>`; };
  show(`<h2>房间 <span class="code">${R_.code}</span></h2><p>把房间码告诉同学，他们在首页点「联机」输入就能进来。最多 4 人。</p>
    <div class="plist">${R_.players.map(slot).join('')}${Array.from({ length: 4 - R_.players.length }, () => '<div class="pl empty">等人加入</div>').join('')}</div>
    <h3>我用</h3><div class="chips">${CLS_IDS.filter(isOpen).map((id) => `<button class="chip ${id === mine ? 'sel' : ''}" data-h="${id}">${ico(TAGS[CLASSES[id].tag].c, CLASSES[id].start)}${CLASSES[id].short || CLASSES[id].name}</button>`).join('')}</div>
    ${host ? `<h3>难度</h3><div class="opts3">${Object.keys(DIFFS).map((d, k) => `<button class="opt ${d === diffId ? 'on' : ''}" data-d="${d}" style="--c:${['#b8f0cf', '#ffe07a', '#ffb0a8'][k]}"><b>${DIFFS[d].name}</b></button>`).join('')}</div>
      <h3>模式</h3><div class="opts2">${Object.keys(MODES).map((m) => { const lk = m === 'endless' && !endlessOpen(); return `<button class="opt ${m === modeId && !lk ? 'on' : ''} ${lk ? 'lk' : ''}" data-m="${m}" ${lk ? 'disabled' : ''}><b>${MODES[m].name}</b>${lk ? '<small>通关一次标准模式解锁</small>' : ''}</button>`; }).join('')}</div>` : `<p>房主选难度后开局。</p>`}
    <p class="err">${err}</p>
    <div class="actions">${host ? `<button class="primary big" id="nGo" ${R_.started ? 'disabled' : ''}>开局${R_.players.length > 1 ? `（${R_.players.length} 人）` : ''}</button>` : '<button class="primary" disabled>等房主开局…</button>'}<button id="nLeave">离开房间</button></div>`, 'frame lobby');
  panel.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => { selIdx = CLS_IDS.indexOf(b.dataset.h); netPost({ op: 'hello', code: NET.code, key: NET.key, hero: b.dataset.h, skin: skinOf(b.dataset.h) }).then((r) => { if (NET) { NET.room = r.room; renderLobby(); } }).catch((e) => renderLobby(e.message)); });
  panel.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { diffId = b.dataset.d; renderLobby(); });
  panel.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { modeId = b.dataset.m; renderLobby(); });
  if ($('nGo')) $('nGo').onclick = () => { if (modeId === 'endless' && !endlessOpen()) modeId = 'std'; $('nGo').disabled = true; netPost({ op: 'start', code: NET.code, key: NET.key, m: { d: diffId, mode: modeId } }).catch((e) => renderLobby(e.message)); };
  $('nLeave').onclick = () => netLeave();
}
function pickHero(i) { selIdx = i % CLS_IDS.length; if (state === 'title') { titleStep = 'prep'; renderPrep(); } }
function startRun() {
  clsId = CLS_IDS[selIdx]; cls = CLASSES[clsId]; if (!isOpen(clsId)) return;
  clearField();
  defeatSource = deathTaunt = null;
  const st = classBaseStats(cls);
  const maxHp = cls.hp + growthBonus('maxHp');
  for (const id of Object.keys(GROWTH_STATS)) {
    if (id !== 'maxHp' && id !== 'points') st[id] += growthBonus(id);
  }
  Object.assign(player, { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, hp: maxHp, maxHp, speed: cls.spd, magnet: 2.4, lvl: 1, xp: 0, need: 5, kills: 0, weapons: { [cls.start]: 1 }, wup: {}, elem: {}, sp: {}, arts: {}, koi: 0, shield: false, st, relics: {}, evo: {}, alt: {}, duos: {}, spinT: 0, slowT: 0, healAcc: 0, sockHealShown: 0, iframe: 0, ghost: 0, dark: false });
  rerollCost = REROLL_BASE_COST; player.revives = DF().revive; watchT = 12; shieldT = 10; $('rmark').hidden = true;
  mctx.clearRect(0, 0, 1024, 1024); marksDirty = true;
  T = 0; spawnAcc = 0; settled = false; run = { tasks: 0, hg: 0, hit: -1 }; achClock = 0; nextElite = DF().elite * 1.8; nextBats = 25; nextBomb = 90; nextBoss = modeId === 'std' ? BOSS_T : 300; bossCount = 0; boss = null; ev = {}; timeScale = 1; pendingLevels = 0; task = null; nextTask = 50;
  for (const k in cds) delete cds[k];
  $('bossBar').hidden = true; $('hud').classList.remove('boss'); $('hud').hidden = false; titleEl.hidden = true; titleEl.innerHTML = ''; hide(); $('stage').classList.remove('dead'); $('task').hidden = true;
  $('who').innerHTML = illustratedBadge('heroes', clsId, TAGS[cls.tag].c, 40); $('pname').textContent = cls.name; hud.lv = 1; hud.points = meta.pts; $('lv').textContent = 1; $('score').textContent = meta.pts;
  camLook.set(0, 0, 0);
  for (let k = 0; k < 6; k++) spawnNear('sleepy', 8, 13);
  state = 'play'; SL = {}; refreshSets(); renderSlots(); renderItems(); banner('第一波', modeId === 'std' ? '撑到 10:00，期末大魔王会出现' : '无尽模式：撑得越久越好');
}
$('pauseBtn').onclick = () => { if (state === 'play') pause(); };
function pause() {
  if (NET && NET.on) { state = 'paused'; show(`<h2>暂停</h2><p>联机时世界不会停，怪也不会打你，但别离开太久。</p>${statsHtml()}${buildSummary()}<div class="actions"><button class="primary" id="rs">继续</button><button id="qt">离开联机</button></div>`); $('rs').onclick = resume; $('qt').onclick = () => netLeave(); $('rs').focus(); return; } state = 'paused'; show(`<h2>暂停</h2>${statsHtml()}${buildSummary()}<div class="actions"><button class="primary" id="rs">继续</button><button id="qt">换个同学</button></div>`); $('rs').onclick = resume; $('qt').onclick = () => { settle(false); wipe(() => showTitle('prep')); }; $('rs').focus(); }
function resume() { hide(); state = 'play'; }
function statsHtml() {
  return `<div class="stats-grid">${Object.keys(STATS).map((id) => `<div>${illustratedBadge('stats', id, STATS[id].c)}<span>${STATS[id].name}</span><b>${STATS[id].show(player.st[id])}</b></div>`).join('')}</div>`;
}
function buildSummary() {
  const rows = Object.keys(TAGS).filter((t) => tagPts(t) > 0).map((t) => `<div><span class="role" style="--c:${TAGS[t].c}">${TAGS[t].name} ${tagPts(t)}</span> ${SL[t] ? SETS[t].slice(0, SL[t]).join('；') : '凑齐 2 件解锁第一阶'}</div>`);
  const ex = [...Object.keys(player.arts).map((a) => `遗物：${ARTS[a].name}`), ...Object.keys(player.relics).map((r) => `${RELICS[r].name}×${R(r)}`), ...Object.keys(player.elem).map((w) => `${WEAPONS[w].name}：${player.elem[w].map((e) => ELEMS[e].name).join('+')}`), ...Object.keys(player.evo).map((w) => `终极：${WEAPONS[w].evo.name}`), ...Object.keys(player.alt).map((w) => `终极：${ALT[w].name}`), ...Object.keys(player.sp).flatMap((w) => Object.keys(player.sp[w]).map((k) => `${WEAPONS[w].name}·${SP[w].find((q) => q[0] === k)[1]}`)), ...Object.keys(player.duos).map((d) => `联动：${DUOS[d].name}`)];
  return `<div class="summary">${rows.join('')}${ex.length ? `<div style="color:#9a5a12;font-weight:800">${ex.join(' · ')}</div>` : ''}</div>`;
}
let slotSig = {};
function renderSlots() {
  const ids = Object.keys(player.weapons), sig = {};
  const activeDuos = Object.keys(player.duos).filter((id) => player.duos[id]);
  const duoBar = $('activeDuos');
  duoBar.hidden = !activeDuos.length;
  duoBar.innerHTML = activeDuos.map((id) => {
    const duo = DUOS[id];
    const label = `${duo.name} · ${WEAPONS[duo.a].name} × ${WEAPONS[duo.b].name}`;
    return `<span class="duo-badge" role="img" aria-label="${label}" title="${label}">${illustratedBadge('duos', id, '#2a9a86', 32)}</span>`;
  }).join('');
  $('slots').innerHTML = Array.from({ length: MAXW }, (_, i) => {
    const id = ids[i]; if (!id) return `<div class="slot empty">${ico('#fff', 'lock')}<span class="wn">Lv ${SKILL_LV[i - 1] ?? ''}</span></div>`;
    const w = WEAPONS[id], l = wLevel(id), evo = player.evo[id], alt = player.alt[id], name = evo ? w.evo.name : alt ? ALT[id].name : w.name;
    const elements = player.elem[id] || [];
    const badges = elements.map((element) => illustratedBadge('elements', element, ELEMS[element].c)).join('');
    const label = elements.length ? `${name} · ${elements.map((element) => ELEMS[element].name).join(' + ')}` : name;
    sig[id] = `${l}:${evo ? 'base' : alt ? 'alt' : ''}:${elements.join('+')}`;
    const changed = slotSig[id] !== sig[id];
    const form = evo ? 'evo' : alt ? 'alt' : 'base';
    return `<div class="slot ${evo || alt ? 'evo' : ''}  ${changed ? 'bump' : ''}" title="${label}">${illustratedBadge(SKILL_FORM_ICONS[form], id, w.c)}<b class="lv">${evo || alt ? '★' : l}</b>${badges ? `<span class="els" role="img" aria-label="${label}">${badges}</span>` : ''}<span class="wn">${name}</span></div>`;
  }).join('');
  slotSig = sig;
}
function showRunItems(selected) {
  if (state !== 'play' || !ov.hidden) return;
  state = 'paused';
  endJoy();
  const items = Object.keys(player.relics);
  show(`<div class="chead"><h2>本局饰品</h2><span class="pts">${items.length} 种</span></div>
    ${items.length ? `<ul class="inventory-list" aria-label="本局获得的饰品">${items.map((id) => {
      const item = RELICS[id];
      return `<li id="inventory-${id}" tabindex="-1">${illustration('relics', id)}
        <div><b>${item.name} Lv ${itemLevel('relics', id)}<span>×${R(id)}</span></b><small>${item.desc}${itemLevelBonus('relics', id) ? '。' + itemLevelBonus('relics', id) : ''}</small></div>
      </li>`;
    }).join('')}</ul>` : '<p>本局还没有获得饰品。</p>'}
    <div class="actions"><button class="primary" id="itemsClose">继续</button></div>`, 'frame inventory');
  const close = $('itemsClose');
  close.onclick = resume;
  // The room keeps running while the local player is paused.
  if (NET?.on) close.insertAdjacentHTML('beforebegin', '<small>联机时，房间仍在进行。</small>');
  ($('inventory-' + selected) || close).focus();
}
$('itemsOpen').onclick = () => showRunItems();
function renderItems() {
  const items = Object.keys(player.relics);
  $('items').hidden = !items.length;
  const strip = $('itemStrip');
  strip.innerHTML = items.map((id) => {
    const item = RELICS[id], count = R(id);
    const label = `${item.name} Lv ${itemLevel('relics', id)} ×${count}，${item.desc}`;
    return `<button type="button" class="item-chip" data-item="${id}" style="--item-color:${rarOf(id).c}" title="${label}" aria-label="${label}">
      ${illustration('relics', id)}<b class="item-stack" aria-hidden="true">×${count}</b>
    </button>`;
  }).join('');
  strip.querySelectorAll('[data-item]').forEach((button) => {
    button.onclick = () => showRunItems(button.dataset.item);
  });
}
function renderBuilds() {
  $('builds').innerHTML = Object.keys(TAGS).filter((t) => tagPts(t) > 0).map((t) => `<div class="bchip frame" style="--c:${TAGS[t].c}">${TAGS[t].name} ${tagPts(t)}<span class="tiers">${[1, 2, 3].map((k) => `<i class="${SL[t] >= k ? 'on' : ''}"></i>`).join('')}</span></div>`).join('');
}
function evoReady() { return []; }
function duoReady() { return Object.keys(DUOS).filter((d) => !player.duos[d] && W(DUOS[d].a) && W(DUOS[d].b)); }
function upgradeOptions(n = A('fourth') ? 4 : 3) {
  const pool = [], nW = Object.keys(player.weapons).length;
  for (const w of evoReady()) pool.push({ kind: 'e', id: w, w: 8 });
  for (const d of duoReady()) pool.push({ kind: 'd', id: d, w: 5 });
  for (const id in player.weapons) for (const u of WEAPONS[id].ups) { const k = (player.wup[id] || {})[u] || 0; if (k < UPS[u].max) pool.push({ kind: 'u', id, u, tier: 0, w: 1.3 }); }
  for (const id in STATS) { const S = STATS[id]; if (S.max != null && player.st[id] >= S.max - 1e-6) continue; pool.push({ kind: 's', id, tier: rollTier(), w: 0.75 }); }
  const out = [];
  while (out.length < n && pool.length) { let r = Math.random() * pool.reduce((a, b) => a + b.w, 0), i = 0; while ((r -= pool[i].w) > 0 && i < pool.length - 1) i++; out.push(pool.splice(i, 1)[0]); }
  return out;
}
// 4 / 8 / 12 级固定拿一个新技能：从没有的武器里抽三把
function weaponOptions(n = 3) {
  const pool = []; for (const id in WEAPONS) if (!W(id) && skillOpen(id)) { const t = WEAPONS[id].tag; pool.push({ kind: 'w', id, w: (t === cls.tag ? 1.6 : 1) * (tagPts(t) > 0 ? 1.3 : 1) }); }
  const out = [];
  while (out.length < n && pool.length) { let r = Math.random() * pool.reduce((a, b) => a + b.w, 0), i = 0; while ((r -= pool[i].w) > 0 && i < pool.length - 1) i++; out.push(pool.splice(i, 1)[0]); }
  return out;
}
function buildLine(tag) {
  if (!tag) return '';
  const p = tagPts(tag), next = p + 1, tier = tierOf(next);
  if (tier > tierOf(p)) return `<span class="build">${TAGS[tag].name} ${p}→${next}：解锁「${SETS[tag][tier - 1]}」</span>`;
  const need = next < 2 ? 2 : next < 4 ? 4 : next < 6 ? 6 : 0;
  return `<span class="build">${TAGS[tag].name}流派 ${p}→${next}${need ? `，再 ${need - next} 件到下一阶` : ''}</span>`;
}
const deltaHtml = (s) => { const m = s.match(/^(.*?)\s*(\S+) → (.+)$/); return m ? `<span class="delta">${m[1]} <s>${m[2]}</s><em>→</em><b>${m[3]}</b></span>` : `<span class="delta">${s}</span>`; };
const OPTION_ICON_CATEGORIES = { w: 'skills', u: 'skills', e: 'ultimates', d: 'duos', x: 'skills', r: 'relics', a: 'arts', s: 'stats' };
// 饰品和特殊升级使用固定的展示品质，保留原有的效果和掉落权重。
const EPIC_CHEST_RELICS = new Set(['grimoire', 'ink']);
const SPECIAL_CARD_TIERS = {
  sweep:    [2, 3, 2, 0, 0, 1, 1, 1],
  spin:     [1, 2, 3, 0, 1, 0, 2, 1],
  mop:      [3, 2, 1, 0, 0, 0, 1, 2],
  pencil:   [3, 2, 3, 1, 0, 1, 0, 2],
  plane:    [3, 2, 2, 0, 0, 1, 0, 1],
  slipper:  [1, 3, 2, 0, 1, 0, 0, 2],
  stapler:  [1, 2, 3, 0, 1, 0, 0, 2],
  shotgun:  [3, 1, 2, 0, 1, 0, 2, 0],
  bolt:     [3, 2, 2, 1, 0, 0, 1, 0],
  coffee:   [3, 1, 2, 0, 0, 1, 0, 2],
  sock:     [3, 2, 1, 0, 0, 1, 2, 0],
  rollcall: [2, 2, 1, 3, 0, 0, 1, 2],
  minion:   [2, 1, 3, 2, 0, 0, 0, 1],
  lamp:     [3, 1, 1, 2, 0, 0, 1, 0],
  duck:     [2, 1, 3, 2, 1, 0, 0, 0],
};
function choiceCardTier(option, rarity) {
  if (option.kind === 'r') {
    const relic = RELICS[option.id];
    if (relic.r === 2) return 3;
    if (relic.curse || EPIC_CHEST_RELICS.has(option.id)) return 2;
    return relic.r;
  }
  if (option.kind === 'x') {
    const index = SP[option.w].findIndex(([id]) => id === option.id);
    return SPECIAL_CARD_TIERS[option.w][index];
  }
  if (rarity === 'legend') return 3;
  if (rarity === 'duo') return 2;
  if (option.kind === 'w') return 1;
  return option.tier ?? 0;
}
function optionCard(o, i, theme) {
  let c, kind, rar = '', rn = '', stars = 0, name, sub = '', desc = '', delta = '', pips = '', foot = '';
  let elementIcon;
  let category = OPTION_ICON_CATEGORIES[o.kind];
  if (o.kind === 'e') { const w = WEAPONS[o.id]; c = w.c; kind = '武器进化'; rar = 'legend'; rn = '传说'; name = w.evo.name; sub = `${w.name} + ${RELICS[w.evo.relic].name}`; desc = w.evo.desc; }
  else if (o.kind === 'd') { const d = DUOS[o.id]; c = '#2a9a86'; kind = '武器联动'; rar = 'duo'; rn = '联动'; name = d.name; sub = `${WEAPONS[d.a].name} × ${WEAPONS[d.b].name}`; desc = d.desc; }
  else if (o.kind === 'w') { const w = WEAPONS[o.id], t = TAGS[w.tag]; c = w.c; kind = `新技能 ${Object.keys(player.weapons).length + 1}/${MAXW}`; rar = w.funny ? 'funny' : 'rare'; rn = w.funny ? '搞笑' : t.name; name = w.name; desc = w.desc; foot = buildLine(w.tag); }
  else if (o.kind === 'u') {
    const w = WEAPONS[o.id], k = (player.wup[o.id] || {})[o.u] || 0, l = wLevel(o.id), mx = UPS[o.u].max;
    const n = (o.tier || 0) + 1; c = w.c; kind = `${w.name} Lv ${l}→${l + n}`; rn = TIER[o.tier || 0].n; rar = 'q' + (o.tier || 0); stars = n; name = LVUP[o.id][2]; sub = ''; rn = ''; rar = ''; stars = 0; delta = deltaHtml(upPreview(o.id, o.u, n));
    pips = `<span class="pips">${Array.from({ length: mx }, (_, q) => `<i class="${q < k ? 'on' : q < k + n ? 'new' : ''}"></i>`).join('')}</span>`;
    if (l + n >= MAXLV && altOwned(o.id)) { kind = `${w.name} 满级`; rar = 'legend'; rn = '终极形态'; name = '两种终极形态'; desc = `升到 Lv 10 时，在「${w.evo.name}」和「${ALT[o.id].name}」里选一个`; }
    else if (l + n >= MAXLV) { kind = `${w.name} 满级`; rar = 'legend'; rn = '终极形态'; category = 'ultimates'; name = w.evo.name; desc = w.evo.desc; }
    else if (INF_LV.includes(l + 1)) foot = '<span class="build">升到这一级会注入一次元素</span>';
    else if (l + 2 >= MAXLV) foot = `<span class="build">再升一级变成终极形态「${altOwned(o.id) ? w.evo.name + '」或「' + ALT[o.id].name : w.evo.name}」</span>`;
    if (theme === 'upgrade') {
      sub = rar === 'legend' ? kind : `Lv ${l} → ${l + n} · ${name}`;
      if (rar !== 'legend') name = w.name;
      kind = '技能强化';
    }
  } else if (o.kind === 'r') {
    const r = RELICS[o.id], t = TAGS[r.tag];
    const ra = rarOf(o.id), have = R(o.id), bonus = itemLevelBonus('relics', o.id);
    c = ra.c; kind = (r.curse ? '代价饰品' : '饰品') + (t ? ' · ' + t.name : ''); rar = ra.k; rn = ra.n; name = r.name;
    sub = `Lv ${itemLevel('relics', o.id)} · ${have ? `已有 ${have} 件` : '可以叠加'}`;
    desc = r.desc + (bonus ? '。' + bonus : '');
    foot = have ? '' : buildLine(r.tag);
  } else if (o.kind === 'a') {
    const a = ARTS[o.id], bonus = itemLevelBonus('arts', o.id);
    c = a.c; kind = '遗物'; rar = 'legend'; rn = '强力'; name = a.name;
    sub = `Lv ${itemLevel('arts', o.id)}`;
    desc = a.desc + (bonus ? '。' + bonus : '');
  }
  else if (o.kind === 'el') {
    const E = ELEMS[o.id], cur = player.elem[o.w] || [], cb = cur.length ? COMBOS[[cur[0], o.id].sort().join('+')] : null;
    c = E.c; kind = WEAPONS[o.w].name; rar = cb ? 'epic' : 'rare'; rn = cb ? '组合' : '元素'; name = cb ? cb[0] : E.name + '元素'; sub = cb ? `${ELEMS[cur[0]].name} + ${E.name}` : ''; desc = cb ? `${cb[1]}。${E.name}：${E.desc}` : E.desc;
    elementIcon = cb
      ? `<span class="ico element-pair">${illustration('elements', cur[0])}${illustration('elements', o.id)}</span>`
      : illustratedBadge('elements', o.id, E.c);
    if (!cb) foot = '<span class="build">这个技能到 Lv 8 再注入一次，两种元素会组合</span>';
  } else if (o.kind === 'x') {
    const w = WEAPONS[o.w], x = SP[o.w].find((q) => q[0] === o.id); c = w.c; kind = w.name; rar = 'epic'; rn = '特殊升级'; name = x[1]; desc = x[2];
  } else {
    const S = STATS[o.id], v = statVal(o.id, o.tier), after = Math.min(S.max ?? Infinity, player.st[o.id] + v);
    c = S.c; kind = '通用属性'; rar = 'q' + o.tier; rn = TIER[o.tier].n; stars = o.tier + 1; name = S.name; sub = S.fl;
    delta = o.id === 'maxHp' ? deltaHtml(`${S.name} ${Math.round(player.maxHp)} → ${Math.round(player.maxHp + v)}`) : deltaHtml(`${S.name} ${S.show(player.st[o.id]).replace(/（.*/, '')} → ${S.show(after).replace(/（.*/, '')}`);
    if (o.id === 'armor') desc = `受到的伤害 -${Math.round(after / (after + 10) * 100)}%`; else if (S.max != null && S.max < 1) desc = `最高 ${S.show(S.max)}`;
  }
  const icon = elementIcon ?? illustratedBadge(category, o.kind === 'x' ? o.w : o.id, c);
  const tier = theme ? choiceCardTier(o, rar) : null;
  const themeAttr = theme ? ` data-card-tier="${tier}"` : '';
  const upgradeType = theme === 'upgrade' ? (o.kind === 's' ? 'stat' : 'skill') : '';
  const typeAttr = upgradeType ? ` data-upgrade-type="${upgradeType}"` : '';
  if (theme) rn = TIER[tier].n;
  return `<button class="card ucard ${rar ? 'r-' + rar : ''}" data-i="${i}"${themeAttr}${typeAttr} style="--c:${c};--i:${i}"><span class="kind"><i>${kind}</i>${rn ? `<em>${rn}</em>` : ''}</span>${icon}${stars ? `<span class="stars">${'<i></i>'.repeat(stars)}</span>` : ''}<span class="name">${name}</span>${sub ? `<span class="sub">${sub}</span>` : ''}${desc ? `<span class="desc">${desc}</span>` : ''}${delta}${pips}${foot}<kbd>${i + 1}</kbd></button>`;
}
function applyUpgrade(o) {
  if (o.kind === 'w') player.weapons[o.id] = 1;
  else if (o.kind === 'u') { const u = (player.wup[o.id] = player.wup[o.id] || {}); const l0 = wLevel(o.id); u[o.u] = Math.min(UPS[o.u].max, (u[o.u] || 0) + (o.tier || 0) + 1); const l = (player.weapons[o.id] = wLevel(o.id)); for (const q of INF_LV) if (l0 < q && l >= q && (player.elem[o.id] || []).length + pendingInfuse.filter((w) => w === o.id).length < 2) pendingInfuse.push(o.id);
    if (l >= MAXLV && !player.evo[o.id] && !player.alt[o.id] && altOwned(o.id)) { if (!pendingUlt.includes(o.id)) pendingUlt.push(o.id); }
    if (l >= MAXLV && !player.evo[o.id] && !player.alt[o.id] && !altOwned(o.id)) { player.evo[o.id] = 1; banner(WEAPONS[o.id].evo.name, '终极形态', illustration('ultimates', o.id)); ripple(player.x, player.z, 1.5); spark(player.x, 1, player.z, 0xffc24a, 120, 9, 0.45, 0.9); shake = 0.4; } }
  else if (o.kind === 's') { const v = statVal(o.id, o.tier); if (o.id === 'maxHp') { player.maxHp += v; player.hp += v; } else player.st[o.id] = Math.min(STATS[o.id].max ?? Infinity, player.st[o.id] + v); }
  else if (o.kind === 'r') { player.relics[o.id] = R(o.id) + 1; player.st.dmg += relicLevelDamage(o.id); if (o.id === 'drink') { player.maxHp += 10; player.hp += 10; player.st.regen += 0.05; } if (o.id === 'allnight') { player.maxHp *= 0.9; player.hp = Math.min(player.hp, player.maxHp); } if (o.id === 'glass') { player.maxHp *= 0.85; player.hp = Math.min(player.hp, player.maxHp); } if (o.id === 'slack') { player.st.speed += 0.1; player.magnet *= 1.2; } if (o.id === 'scope') player.st.crit += 0.05; renderItems(); }
  else if (o.kind === 'ult') {
    const form = o.v === 'b' ? 'alt' : 'evo';
    const name = form === 'alt' ? ALT[o.id].name : WEAPONS[o.id].evo.name;
    player[form][o.id] = 1;
    banner(name, '终极形态', illustration(SKILL_FORM_ICONS[form], o.id));
    ripple(player.x, player.z, 1.5);
    spark(player.x, 1, player.z, 0xffc24a, 120, 9, 0.45, 0.9);
    shake = 0.4;
  }
  else if (o.kind === 'e') { player.evo[o.id] = 1; banner(WEAPONS[o.id].evo.name, '武器进化', illustration('ultimates', o.id)); ripple(player.x, player.z, 1.5); spark(player.x, 1, player.z, 0xffc24a, 120, 9, 0.45, 0.9); shake = 0.4; }
  else if (o.kind === 'd') { player.duos[o.id] = 1; banner(DUOS[o.id].name, '联动', illustration('duos', o.id)); spark(player.x, 1, player.z, 0x4fe0c0, 80, 8, 0.4, 0.8); }
  else if (o.kind === 'a') { player.arts[o.id] = 1; const hpBonus = artLevelHp(o.id); player.maxHp += hpBonus; player.hp += hpBonus; if (o.id === 'plate') player.st.armor += 3; if (o.id === 'grant') player.magnet *= 1.5; banner(ARTS[o.id].name, '获得遗物', illustration('arts', o.id)); spark(player.x, 1, player.z, 0xffc93c, 90, 9, 0.45, 0.9); ripple(player.x, player.z, 1.2); }
  else if (o.kind === 'x') { (player.sp[o.w] = player.sp[o.w] || {})[o.id] = 1; const x = SP[o.w].find((q) => q[0] === o.id); banner(x[1], WEAPONS[o.w].name + ' · 特殊升级'); spark(player.x, 1, player.z, 0xc9a7ff, 80, 8, 0.4, 0.8); ripple(player.x, player.z, 1); }
  else if (o.kind === 'el') { (player.elem[o.w] = player.elem[o.w] || []).push(o.id); spark(player.x, 1, player.z, +('0x' + ELEMS[o.id].c.slice(1)), 70, 8, 0.4, 0.8); }
  refreshSets(); renderSlots();
}
// 三选一：点了以后被选中的卡放大，其余收走，再回到游戏
function cardPick(opts, done) {
  const wrap = panel.querySelector('.ucards');
  const first = wrap.querySelector('.ucard');
  let busy = false;
  panel.querySelectorAll('.ucard').forEach((b) => b.onclick = () => {
    if (busy) return; busy = true; b.classList.add('picked'); wrap.classList.add('picking');
    const reroll = panel.querySelector('#rr');
    if (reroll) reroll.disabled = true;
    setTimeout(() => {
      if (wrap.isConnected && state === 'levelup') done(opts[+b.dataset.i]);
    }, REDUCED ? 0 : 300);
  });
  first?.focus({ preventScroll: true });
}
function illustratedChoiceCards(options, theme) {
  const cards = options.map((option, index) => optionCard(option, index, theme)).join('');
  return `<div class="ucards" data-card-theme="${theme}" style="--n:${options.length}">${cards}</div>`;
}
function nextChoice() { if (pendingUlt.length) showUltPick(); else if (pendingInfuse.length) showInfuse(); else if (pendingLevels > 0) showLevelUp(); else { hide(); state = 'play'; } }
const lvHead = (text, small, bg) => `<div class="lvhead"><div class="sunburst"></div><div class="ribbon"${bg ? ` style="background:${bg}"` : ''}>${text}${small ? `<small>${small}</small>` : ''}</div></div>`;
const REROLL_BASE_COST = 100;
let rerollCost = REROLL_BASE_COST;
const rerollFooter = (extra = '') => `<div class="lvfoot">
  <button id="rr" ${meta.pts < rerollCost || !Number.isSafeInteger(rerollCost) ? 'disabled' : ''}>刷新 · ${rerollCost} 积分</button>
  <span id="rrBalance" role="status">持有 ${meta.pts} 积分</span>${extra}
</div>`;
function bindReroll(options, roll, render) {
  const key = (cards) => cards.map(({ kind, id, w, u, tier }) =>
    [kind, id, kind === 'x' ? w : '', u, tier].join(':')).sort().join('|');
  const previous = key(options);
  $('rr').onclick = () => {
    if (state !== 'levelup' || !Number.isSafeInteger(rerollCost) || meta.pts < rerollCost) return;
    for (let attempt = 0; attempt < 12; attempt++) {
      const next = roll();
      if (!next.length || key(next) === previous) continue;
      meta.pts -= rerollCost;
      rerollCost = Math.ceil(rerollCost * 1.5);
      saveMeta();
      render(next);
      return;
    }
    $('rrBalance').textContent = `没有刷出新选项，持有 ${meta.pts} 积分`;
  };
}
function showLevelUp(replacement) {
  state = 'levelup'; const L = player.lvl - pendingLevels + 1, skill = SKILL_LV.includes(L) && Object.keys(player.weapons).length < MAXW;
  const roll = () => {
    const weapons = skill ? weaponOptions() : [];
    return weapons.length ? weapons : upgradeOptions();
  };
  const opts = replacement ?? roll();
  if (!skill && A('koi')) { const add = Math.min(opts.filter((o) => o.kind === 's' && o.tier === 0).length, 10 - player.koi); if (add > 0) { player.koi += add; player.st.luck = Math.min(STATS.luck.max, player.st.luck + add * 0.01); } }
  const learningSkill = opts.some((o) => o.kind === 'w');
  show(`${lvHead(learningSkill ? '选一个新技能' : '选择升级', `Lv ${L}`, learningSkill ? '#a53e31' : '')}
    ${illustratedChoiceCards(opts, 'upgrade')}
    ${rerollFooter(`<details class="statsBox"><summary>当前属性</summary>${statsHtml()}</details>`)}`, 'bare');
  cardPick(opts, (o) => { applyUpgrade(o); spark(player.x, 1, player.z, 0xffd23f, 30, 6, 0.35, 0.6); ripple(player.x, player.z, 0.8); pendingLevels--; nextChoice(); });
  bindReroll(opts, roll, showLevelUp);
}
function showUltPick() {
  state = 'levelup'; const id = pendingUlt[0], w = WEAPONS[id];
  const opts = [{ kind: 'ult', id, v: 'a' }, { kind: 'ult', id, v: 'b' }];
  const card = (o, i) => {
    const alternate = o.v === 'b';
    const form = alternate ? ALT[id] : w.evo;
    const icon = illustratedBadge(SKILL_FORM_ICONS[alternate ? 'alt' : 'evo'], id, w.c);
    return `<button class="card ucard r-legend" data-i="${i}" style="--c:${w.c};--i:${i}"><span class="kind"><i>${w.name} 满级</i><em>${alternate ? '抽卡得到' : '原版'}</em></span>${icon}<span class="name">${form.name}</span><span class="desc">${form.desc}</span><kbd>${i + 1}</kbd></button>`;
  };
  show(`${lvHead('选一个终极形态', w.name + ' Lv 10', 'var(--sun2)')}<div class="ucards" style="--n:2">${opts.map(card).join('')}</div>`, 'bare');
  cardPick(opts, (o) => { pendingUlt.shift(); applyUpgrade(o); nextChoice(); });
}
function showInfuse() {
  state = 'levelup'; const id = pendingInfuse[0], opts = Object.keys(ELEMS).map((el) => ({ kind: 'el', id: el, w: id }));
  show(`${lvHead('元素注入', `${WEAPONS[id].name} Lv ${wLevel(id)}`, 'var(--lilac)')}<div class="ucards" style="--n:4">${opts.map((option, index) => optionCard(option, index)).join('')}</div>`, 'bare');
  cardPick(opts, (o) => { const cur = player.elem[id] || [], cb = cur.length ? COMBOS[[cur[0], o.id].sort().join('+')] : null; pendingInfuse.shift(); applyUpgrade(o); banner(cb ? cb[0] : ELEMS[o.id].name + '元素', WEAPONS[id].name); nextChoice(); });
}
function showArts() {
  const pool = shuffle(Object.keys(ARTS).filter((a) => !A(a) && meta.arts.includes(a)));
  if (!pool.length) { player.hp = player.maxHp; banner('遗物已经拿完了', '生命回满'); return; }
  const opts = pool.slice(0, Math.random() < player.st.luck * 2 ? 4 : 3).map((id) => ({ kind: 'a', id }));
  state = 'levelup'; show(`${lvHead('发现遗物！', '', 'var(--sun2)')}<div class="ucards" style="--n:${opts.length}">${opts.map((option, index) => optionCard(option, index)).join('')}</div>`, 'bare');
  cardPick(opts, (o) => { applyUpgrade(o); nextChoice(); });
}
addEventListener('keydown', (e) => { if (state === 'levelup' && /^[1-4]$/.test(e.key)) { const b = panel.querySelectorAll('.ucard')[+e.key - 1]; if (b) b.click(); } });
function specialOptions(n = 3) {
  // 尽量每个技能各出一张，不够再补
  const by = shuffle(Object.keys(player.weapons)).map((w) => shuffle(SP[w].filter((x) => !SPX(w, x[0])).map((x) => ({ kind: 'x', w, id: x[0] })))), out = [];
  for (let r = 0; r < 8 && out.length < n; r++) for (const q of by) if (q[r] && out.length < n) out.push(q[r]);
  return out;
}
function chestOptions(special, gift, firstRelic) {
  const options = special ? specialOptions(3) : [];
  const relicIds = firstRelic ? [firstRelic] : [];
  if (firstRelic) options.push({ kind: 'r', id: firstRelic });
  const weights = gift ? [78, 20, 2] : [50, 40, 10];
  while (options.length < 3) {
    const id = rollRelic(weights, gift || relicIds.length ? 0 : 0.12, relicIds);
    if (!id) break;
    relicIds.push(id);
    options.push({ kind: 'r', id });
  }
  if (!special && options.length < 3) options.push(...specialOptions(3 - options.length));
  const stats = shuffle(Object.keys(STATS).filter((id) => STATS[id].max == null || player.st[id] < STATS[id].max - 1e-6));
  for (const id of stats.slice(0, 3 - options.length)) options.push({ kind: 's', id, tier: 2 });
  return options;
}
function openChest(chest, replacement) {
  state = 'levelup';
  const special = !!chest?.sp;
  const gift = chest?.relic;
  const roll = () => chestOptions(special, gift);
  const options = replacement ?? chestOptions(special, gift, gift);
  show(`${lvHead(gift ? '发现饰品！' : '宝箱开了！', special ? '任务奖励' : '三选一', special ? 'var(--lilac)' : 'var(--sun2)')}
    ${illustratedChoiceCards(options, special ? 'task' : 'chest')}${rerollFooter()}`, 'bare');
  cardPick(options, (o) => { applyUpgrade(o); nextChoice(); });
  bindReroll(options, roll, (next) => openChest(chest, next));
}
function pickDeathTaunt() {
  const type = defeatSource === 'inkmini' ? 'ink' : defeatSource;
  const speaker = (MON_INFO[type] || MON_MORE[type])?.[0];
  const lines = DEATH_TAUNTS[clsId];
  if (!speaker || !lines?.length) return null;
  return { type, speaker, line: lines[Math.floor(Math.random() * lines.length)] };
}
function deathTauntCard(taunt) {
  if (!taunt) return '';
  return `<figure class="death-taunt">
    ${illustration('mons', taunt.type)}
    <div><figcaption>${taunt.speaker}</figcaption><blockquote>「${taunt.line}」</blockquote></div>
  </figure>`;
}
function showDeath() {
  state = 'dead'; $('stage').classList.add('dead');
  if (modeId === 'endless' && T > bestEndless) { bestEndless = T; try { localStorage.setItem(BEST_KEY, String(Math.floor(T))); } catch (e) {} }
  show(`<div class="eyebrow">${MODES[modeId].name} · ${DF().name}</div><h2>${cls.name}被淹没了</h2>
    ${deathTauntCard(pickDeathTaunt())}
    <div class="stats"><div style="--i:0"><b>${fmt(T)}</b><small>撑了</small></div><div style="--i:1"><b>${player.kills}</b><small>击倒</small></div><div style="--i:2"><b>${player.lvl}</b><small>等级</small></div><div style="--i:3"><b>${Object.keys(player.arts).length}</b><small>遗物</small></div></div>
    ${modeId === 'endless' ? `<p>无尽最好成绩 ${fmt(bestEndless)}。</p>` : ''}${buildSummary()}
    <p>现在结束可以拿到 ${runPoints(false)} 积分。</p>
    <p>${player.revives > 0 ? `这局还能原地复活 ${player.revives} 次，起来时把身边的怪全震飞。` : '这局的复活已经用完了。'}</p>
    <div class="actions"><button class="primary" id="rv" ${player.revives < 1 ? 'disabled' : ''}>复活</button><button id="again">换个同学</button></div>`);
  $('rv').onclick = revive; $('again').onclick = () => { settle(false); wipe(() => showTitle('prep')); };
  (player.revives > 0 ? $('rv') : $('again')).focus();
}
function revive() {
  defeatSource = null;
  player.revives--; player.hp = player.maxHp; player.iframe = 1.5; $('stage').classList.remove('dead');
  buildGrid(); query(player.x, player.z, 7, (e, dx, dz) => { const L = Math.hypot(dx, dz) || 1; e.kx += dx / L * 20; e.kz += dz / L * 20; hitEnemy(e, 60); });
  eshots = []; ripple(player.x, player.z, 2); spark(player.x, 0.8, player.z, 0xffd23f, 160, 12, 0.45, 1); shake = 0.5; chroma = 0.6; hide(); state = 'play';
}
function showWin() {
  if (NET && NET.on && NET.host) netSend({ k: 'end', win: 1 });
  state = 'win';
  const gain = settle(true), nxt = null;
  show(`${confetti()}<div class="eyebrow">${MODES[modeId].name} · ${DF().name}</div><h1>通关！</h1>
    <div class="unlock">${ico('#ffab2e', 'charm')}<div><b>积分 +${gain}</b><small>现在有 ${meta.pts} 积分，可以去大鹅抽卡或升级成长</small></div></div>
    <div class="stats"><div style="--i:0"><b>${fmt(T)}</b><small>用时</small></div><div style="--i:1"><b>${player.kills}</b><small>击倒</small></div><div style="--i:2"><b>${player.lvl}</b><small>等级</small></div><div style="--i:3"><b>${Object.keys(player.arts).length}</b><small>遗物</small></div></div>
    ${buildSummary()}<div class="actions"><button class="primary" id="again">再来一局</button><button id="wbook">去图鉴</button></div>`);
  $('again').onclick = () => wipe(() => { if (nxt) selIdx = CLS_IDS.findIndex((id) => CLASSES[id].tag === nxt); showTitle('prep'); }); $('again').focus(); $('wbook').onclick = () => wipe(() => { showTitle('home'); showCodex(); });
  if (NET) { $('again').textContent = '回联机大厅'; $('again').onclick = () => netToLobby(); $('wbook').textContent = '离开房间'; $('wbook').onclick = () => netLeave(); }
}

/* ================= 主循环 ================= */
const camLook = new THREE.Vector3(), camPos = new THREE.Vector3(TX, 9, TZ + 26), camTgt = new THREE.Vector3(TX, 1, TZ - 1), tV = new THREE.Vector3(), tL = new THREE.Vector3(); let camK = 1;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  camK = w / h < 0.8 ? 1.55 : w / h < 1.2 ? 1.2 : 1; finalPass.uniforms.uRes.value.set(w, h);
  PART.mat.uniforms.uScale.value = GLOW.mat.uniforms.uScale.value = h * 0.9;
}
addEventListener('resize', resize); resize();

// Run the real combat and renderer in a repeatable encounter, isolated from
// the player's match and progression by the preview frame.
let demoSkill = null;
let demoForm = 'base';
let demoSockAlly = null;
let skillDemoRound = 0;
const DEMO_X = RCX - 2, DEMO_Z = RCZ;
const DEMO_TARGETS = {
  sweep: [[2.2, -.65], [2.4, .8]],
  spin: [[2.4, .2], [-2.4, -.4]],
  mop: [[2.7, .1], [3.1, -1.1]],
  pencil: [[3.2, -.3], [5.7, -.3], [8.1, -.3]],
  plane: [[4.9, -3.1], [7.2, .1]],
  shotgun: [[2.9, -.5], [3.7, .1], [4.7, 1]],
  bolt: [[3.1, -.8], [5.5, .8], [8, -.7]],
  rollcall: [[3.4, .65], [5.7, -.8], [7.7, 0, 'hourglass']],
  duck: [[5.5, -.7], [6.5, 0], [8.2, -1.1]],
};
const DEMO_DURATION = { coffee: 5, rollcall: 4.5, minion: 6, lamp: 6, duck: 6.3 };
const DEMO_ULT_TARGETS = {
  sweep: [[2.3, -.7], [3.3, .8], [-2.5, -.2], [.3, -3]],
  shotgun: [[2.4, 0], [0, 2.4], [-2.4, 0], [0, -2.4]],
  bolt: [[2.5, -2], [3.1, .2], [3, 2.2], [5.7, -2.4], [5.8, 0], [6.3, 2.1]],
  rollcall: [[2.2, -2], [3.1, .5], [4.2, 2], [5.2, -1.5], [6.6, 0, 'hourglass']],
};
const DEMO_ALT_TARGETS = {
  sweep: [[2.4, 0], [4.8, 0], [7.1, 0]],
  shotgun: DEMO_ULT_TARGETS.shotgun,
  bolt: DEMO_ULT_TARGETS.bolt,
  sock: [[2.9, -.6], [4.7, 1], [-4.6, -.8], [.1, -4.5]],
};

function resetSkillDemo() {
  skillDemoRound++;
  clearField();
  for (const id of Object.keys(cds)) delete cds[id];
  for (const effect of slashes) effect.t = 1.6;
  for (const effect of rings) effect.t = 1;
  for (const particles of [PART, GLOW]) particles.life.fill(0);
  for (const number of NUMS) { number.life = 0; number.el.style.opacity = 0; }
  sripStart.fill(-99);
  for (const rip of RIPS) rip.z = -100;
  mctx.clearRect(0, 0, 1024, 1024);
  marksDirty = true;
  shake = chroma = hurt = sweepFx.t = 0;
  T = 0;
  state = 'demo';
  const level = demoForm === 'base' ? 1 : MAXLV;
  demoSockAlly = demoSkill === 'sock' && demoForm === 'alt'
    ? { x: DEMO_X - 2.3, z: DEMO_Z + 1.2, hp: 60, maxHp: 100 }
    : null;
  Object.assign(player, {
    x: DEMO_X, z: DEMO_Z, yaw: HP_, hp: cls.hp, maxHp: cls.hp,
    weapons: { [demoSkill]: level },
    wup: { [demoSkill]: { lv: level - 1 } },
    evo: demoForm === 'evo' ? { [demoSkill]: 1 } : {},
    alt: demoForm === 'alt' ? { [demoSkill]: 1 } : {},
    st: classBaseStats(cls),
    kills: 0, hit: 0, spinT: 0, moving: 0,
  });
  const formTargets = demoForm === 'evo' ? DEMO_ULT_TARGETS : demoForm === 'alt' ? DEMO_ALT_TARGETS : {};
  const targets = formTargets[demoSkill] || DEMO_TARGETS[demoSkill] || [[5.2, -.45], [7.3, -1.3], [8.6, .5]];
  for (const [x, z, type = 'sleepy'] of targets) {
    const enemy = spawn(type, DEMO_X + x, DEMO_Z + z);
    enemy.spawn = 0;
    enemy.dps = 0;
    enemy.cdA = 4;
    enemy.spd *= demoSkill === 'duck' || (demoSkill === 'sock' && demoForm === 'alt') ? .9 : .45;
    if (type === 'sleepy') enemy.hp = enemy.maxHp *= demoForm === 'base' ? 4 : 12;
  }
}

if (skillDemoMode) {
  document.body.classList.add('skill-demo');
  addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    if (event.data?.type !== 'sandbox-brawl:skill-demo') return;
    const { skill, form } = event.data;
    if (typeof skill !== 'string' || !Object.hasOwn(WEAPONS, skill)) return;
    if (form !== 'base' && form !== 'evo' && !(form === 'alt' && Object.hasOwn(ALT, skill))) return;
    if (skill === demoSkill && form === demoForm) return;
    demoSkill = skill;
    demoForm = form;
    clsId = CLS_IDS.find((id) => CLASSES[id].start === skill);
    cls = CLASSES[clsId];
    resetSkillDemo();
  });
}
const SPAWN_TABLE = [['sleepy', 0, 5], ['bomber', 30, 0.3], ['chalk', 60, 1.4], ['cross', 120, 4], ['mole', 180, 0.5], ['clock', 240, 2], ['ink', 330, 2], ['ghost', 390, 1.5], ['phone', 450, 1.1], ['snail', 510, 0.9]];
// 每分钟一个事件：新怪物登场、任务、地图遗物、期中考、考前冲刺
function minuteEvent(m) {
  let E = TIMELINE[m]; if (!E) { if (m < TIMELINE.length || modeId === 'std') return; E = [['task'], ['relic'], ['rush']][m % 3]; }
  const k = E[0], ringSpawn = (type, n, rad = 12) => { for (let q = 0; q < n; q++) { const a = q / n * TAU + rnd(0, 0.3); spawn(type, clamp(player.x + Math.cos(a) * rad, -HX + 0.6, HX - 0.6), clamp(player.z + Math.sin(a) * rad, -HZ + 0.6, HZ - 0.6)); } };
  if (k === 'mon') { const [nm, tip] = MON_INFO[E[1]]; banner('新怪物：' + nm, tip, illustration('mons', E[1])); ringSpawn(E[1], E[1] === 'bomber' ? 1 : E[1] === 'mole' ? 3 : E[1] === 'snail' || E[1] === 'phone' ? 5 : 10, E[1] === 'bomber' ? 9 : 12); }
  else if (k === 'task') { if (!task) startTask(); else spawnAltar(); }
  else if (k === 'relic') spawnAltar();
  else if (k === 'elite') { banner('期中考', '两只 DDL 沙漏人，打倒有机会掉宝箱', illustration('mons', 'hourglass')); spawnNear('hourglass', 12, 15); spawnNear('hourglass', 12, 15); }
  else if (k === 'rush') { banner('考前冲刺', '所有怪一起涌上来'); for (const t of SPAWN_TABLE) if (T >= t[1] && t[0] !== 'bomber') ringSpawn(t[0], 5, rnd(11, 14)); ringSpawn('bomber', 2, 10); }
}
function nextEventText() {
  const m = Math.floor(T / EVT) + 1, left = m * EVT - T;
  const E = TIMELINE[m] || (modeId === 'std' ? (m * EVT === BOSS_T ? ['boss'] : null) : [['task'], ['relic'], ['rush']][m % 3]);
  return E ? `下一个：${E[0] === 'boss' ? '大魔王' : EV_NAME[E[0]]} ${fmt(left)}` : `${MODES[modeId].name} · ${DF().name}`;
}
let thunderCd = 0, ringCd = 0;
function updateMatch(dt) {
  achClock += dt; if (achClock > 0.5) { achClock = 0; checkAch(true); }
  T += dt;
  let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let mz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  if (joy) { mx = joy.dx; mz = joy.dy; }
  if (state !== 'play') mx = mz = 0;
  if (player.ghost) netGhostStep(dt);
  const L = Math.hypot(mx, mz); if (L > 1) { mx /= L; mz /= L; }
  const wx = mx * Math.cos(AZ) + mz * Math.sin(AZ), wz = -mx * Math.sin(AZ) + mz * Math.cos(AZ);
  player.slowT -= dt; player.iframe -= dt;
  const spd = player.speed * (1 + player.st.speed) * (player.slowT > 0 ? 0.7 : 1) * (SL.melee >= 3 ? 1.2 : 1);
  player.vx += (wx * spd - player.vx) * Math.min(1, dt * 14); player.vz += (wz * spd - player.vz) * Math.min(1, dt * 14);
  player.x += player.vx * dt; player.z += player.vz * dt; pushOutProps(player, 0.45);
  const sp = Math.hypot(player.vx, player.vz); player.moving = clamp(sp / 3, 0, 1); player.ph += sp * dt * 2.6;
  if (sp > 0.5) { const ty = Math.atan2(player.vx, player.vz); let d = ty - player.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); player.yaw += d * Math.min(1, dt * 12); }
  player.spinT = Math.max(0, player.spinT - dt * 5); player.hit = Math.max(0, player.hit - dt * 5);
  player.stepAcc += sp * dt; if (player.stepAcc > 0.5) { player.stepAcc = 0; player.stepSide *= -1; footprint(player.x, player.z, player.yaw, player.stepSide); }
  // 回血：回复属性 + 近战一阶吸血（每秒最多 3）
  let heal = player.st.regen * dt;
  if (player.healAcc > 0) { const h = Math.min(player.healAcc, 0.8 * dt); heal += h; player.healAcc = Math.max(0, player.healAcc - h - 2 * dt); }
  if (!player.ghost) player.hp = Math.min(player.maxHp, player.hp + heal);
  if (NET?.on && !player.ghost) sockSupport(player, remoteSockAuras(), dt);

  if (!NET || !NET.on || NET.host) {
  // 刷怪：越往后越多越强
  const rate = (1.6 + Math.min(T, 1500) * 0.011) * DF().rate * (boss ? 0.5 : 1) * (NET && NET.on ? 1 + 0.4 * (NET.n - 1) : 1);
  spawnAcc += dt * rate;
  const table = SPAWN_TABLE.filter((s) => T >= s[1]), tw = table.reduce((a, b) => a + b[2], 0);
  while (spawnAcc > 1) { spawnAcc--; let r = Math.random() * tw, i = 0; while ((r -= table[i][2]) > 0) i++; let ty = table[i][0]; const capN = { bomber: 3, chalk: 10, mole: 3 }[ty]; if (capN && enemies.filter((q) => q.type === ty && !q.dead).length >= capN) ty = T >= 60 && Math.random() < 0.4 ? 'cross' : 'sleepy'; spawnNear(ty); }
  if (T >= nextBats && !boss) { nextBats += 25; const a = Math.random() * TAU; for (let k = 0; k < 7; k++) { const e = spawn('bat', clamp(player.x + Math.cos(a) * 15 + rnd(-1.5, 1.5), -HX + 0.6, HX - 0.6), clamp(player.z + Math.sin(a) * 15 + rnd(-1.5, 1.5), -HZ + 0.6, HZ - 0.6)); if (e) e.spawn = 0; } }
  flowT -= dt; if (flowT <= 0) { flowT = 0.2; buildFlow(player.x, player.z); }
  portalAcc += dt; if (portalAcc >= (T < 20 ? 20 : 7) && !boss) { portalAcc = 0; if (!ev.portal) { ev.portal = true; banner('角落的洞开了', '怪会从四个角落一队一队走出来'); } portalWave(); }
  }
  const minute = Math.floor(T / EVT);
  if (minute > 0 && !ev['m' + minute] && !boss) { ev['m' + minute] = true; minuteEvent(minute); }
  if (!NET || !NET.on || NET.host) {
  if (T >= GIANT_T && !ev.giant) { ev.giant = true; banner('大块头来了', '个头很大的怪会挤占你的走位空间'); forceGiant = true; for (const ty of ['sleepy', 'cross', 'sleepy']) spawnNear(ty, 11, 14); forceGiant = false; shake = Math.max(shake, 0.3); }
  if (T >= nextElite && !boss) { nextElite += DF().elite * 1.8; spawnNear('hourglass', 12, 15); banner('DDL 沙漏人', '打倒它有机会掉宝箱', illustration('mons', 'hourglass')); }
  if (T >= nextBoss - 10 && !ev['warn' + nextBoss]) { ev['warn' + nextBoss] = true; banner('期末大魔王', '还有 10 秒', illustration('mons', 'boss')); }
  if (T >= nextBoss && !boss) { spawnNear('boss', 12, 14); $('bossBar').hidden = false; $('hud').classList.add('boss'); shake = 0.5; banner(bossCount ? `期末大魔王 · 第 ${bossCount + 1} 次` : '期末大魔王', '', illustration('mons', 'boss')); nextBoss = modeId === 'endless' ? nextBoss + 300 : Infinity; if (task) endTask(false); }
  }
}

function update(dt) {
  if (skillDemoMode) {
    T += dt;
    player.spinT = Math.max(0, player.spinT - dt * 5);
  } else {
    updateMatch(dt);
  }
  buildGrid(); if (!player.ghost) fire(dt); CW = null; updateSummons(dt); CW = null; updateTask(dt);
  if (NET?.on && NET.host) {
    for (const aura of remoteSockAuras()) {
      query(aura.x, aura.z, aura.radius, (enemy) => { enemy.sockSlow = 1; });
    }
  }
  if (demoSockAlly) sockSupport(demoSockAlly, [{ x: player.x, z: player.z, radius: sockAuraRadius() }], dt);
  // 流派三阶的全场效果
  if (SL.magic >= 3) { thunderCd -= dt; if (thunderCd <= 0) { thunderCd = 0.5; const e = nearest(player.x + rnd(-6, 6), player.z + rnd(-6, 6), 9); if (e) { zap([{ x: e.x + rnd(-1, 1), y: 12, z: e.z + rnd(-1, 1) }, { x: e.x, y: 0.4, z: e.z }], 0xc9b8ff, 0.18, 0.8); hitEnemy(e, 40, 0, 0, 'magic'); ripple(e.x, e.z, 0.4); spark(e.x, 0.5, e.z, 0xc9b8ff, 14, 5, 0.35, 0.35); } } }
  if (SL.gun >= 3) { ringCd -= dt; if (ringCd <= 0) { ringCd = 1.2; for (let k = 0; k < 16; k++) shoot('staple', player.x, 0.85, player.z, k / 16 * TAU, 20, 0.6, 6 + 2 * W('stapler'), 'gun'); } }
  // 尺子回旋
  CW = 'spin';
  if (player.weapons.spin) {
    const s = ws('spin'), evo = player.evo.spin, n = s.n * (evo ? 2 : 1), rr = s.rad * area('melee') * (evo ? 1.3 : 1);
    for (let i = 0; i < n; i++) {
      const [x, z] = spinPos(i, n, s, rr, evo);
      query(x, z, 0.6, (e, dx, dz) => { if (e.spinCd > 0) return; e.spinCd = 0.3; const L = Math.hypot(dx, dz) || 1; hitEnemy(e, s.dmg, dx / L * 6, dz / L * 6, 'melee'); spark(e.x, 0.6, e.z, ecRand('spin') ?? 0xffd84d, 4, 3, 0.25, 0.2);
        if (player.duos.boomer && Math.random() < 0.35) shoot('pencilP', x, 0.7, z, Math.atan2(x - player.x, z - player.z), 16, 0.8, 10 + 4 * W('pencil'), 'ranged', { pierce: 1 }); });
    }
  }
  // 地上的法阵、湿地板、爆炸
  CW = 'coffee';
  for (const c of cups) {
    c.t += dt / 0.5; if (c.t < 1) { if (c.t > 0 && Math.random() < dt * 40) puff('coffee', c.x0 + (c.x - c.x0) * c.t, 0.9 + Math.sin(c.t * PI) * 3, c.z0 + (c.z - c.z0) * c.t, 1, 0.5, 0.32, 0.4); continue; } c.done = true; const CX = player.sp.coffee || {};
    elemBurst('coffee', c.x, c.z, c.rad); ringFx(c.x, c.z, c.rad, EC('coffee') ?? 0xc08040, 0.4); burst(c.x, 0.3, c.z, 0x5a3418, 20, c.rad * 2, 0.35, 0.5, 9); ringMark(c.x, c.z, c.rad * 0.9, 'rgba(45,25,10,.35)', 5); shake = Math.max(shake, 0.05);
    query(c.x, c.z, c.rad, (e) => { e.slow = 2; hitEnemy(e, c.dmg, 0, 0, 'magic'); });
    if (pools.length >= POOL_MAX) pools.shift(); pools.push({ x: c.x, z: c.z, rad: c.rad, life: (c.evo ? 5 : 3.2) + (CX.long ? 2.5 : 0), max: (c.evo ? 5 : 3.2) + (CX.long ? 2.5 : 0), dmg: c.dmg * 0.4 * (1 + 0.1 * R('laundry')), tick: 0, zap: !!player.duos.zapcafe, pull: (c.evo ? 3.5 : 1.2) * (CX.pull ? 2.6 : 1) });
  }
  cups = cups.filter((c) => !c.done);
  for (const p of pools) {
    p.life -= dt; p.tick -= dt;
    if (p.tick <= 0) { p.tick = 0.3; query(p.x, p.z, p.rad, (e, dx, dz) => { e.slow = 0.5; if (p.pull && e.type !== 'boss') { const L = Math.hypot(dx, dz) || 1; e.kx -= dx / L * p.pull; e.kz -= dz / L * p.pull; } hitEnemy(e, p.dmg, 0, 0, 'magic', { noCrit: true }); });
      if (p.zap) { const e = nearest(p.x + rnd(-p.rad, p.rad), p.z + rnd(-p.rad, p.rad), p.rad); if (e) { zap([{ x: p.x, y: 0.3, z: p.z }, { x: e.x, y: 0.5, z: e.z }], 0x4aa8ff, 0.12, 0.3); hitEnemy(e, p.dmg * 2, 0, 0, 'magic'); } } }
  }
  for (let i = pools.length - 1; i >= 0; i--) if (pools[i].life <= 0) pools.splice(i, 1);
  CW = 'mop';
  for (const w of wet) {
    w.life -= dt; w.tick -= dt; if (w.tick > 0) continue; w.tick = 0.4;
    const dmgW = w.dmg + (player.duos.cleanup ? 6 : 0), slip = SPX('mop', 'slip');
    query(w.x, w.z, w.r, (e) => { e.slow = 0.5; hitEnemy(e, dmgW, 0, 0, 'melee', { noCrit: true }); if (Math.random() < 0.5) spark(e.x, 0.25, e.z, ecRand('mop') ?? 0xbfe6ff, 2, 2.5, 0.28, 0.35, 7); if (slip && e.type !== 'boss' && Math.random() < 0.1) { e.frz = Math.max(e.frz || 0, 0.6); dmgNum(e.x, e.z, '滑倒', 'tag', e.r * 2 + 1); } });
    if (player.duos.cleanup && Math.random() < 0.5) spark(w.x, 0.3, w.z, 0x9ad04a, 2, 1, 0.35, 0.8, -0.5);
  }
  wet = wet.filter((w) => w.life > 0);
  CW = null;
  for (const b of blasts) { b.t -= dt; if (b.t <= 0) explodeAt(b.x, b.z); }
  blasts = blasts.filter((b) => b.t > 0);
  // 拖鞋：飞出去，再飞回来
  const bornS = [];
  CW = 'slipper';
  for (const sl of slippers) {
    if (Math.random() < dt * (EC('slipper') != null ? 40 : 26)) puff('slipper', sl.x, 0.8, sl.z, 1, 0.6, 0.34, 0.35);
    sl.t += dt; sl.spinA += dt * 18;
    if (sl.out && !sl.hd && !sl.small && sl.t > 0.42 && SPX('slipper', 'hover')) { sl.hd = 1; sl.hov = 1; sl.sv = [sl.vx, sl.vz]; sl.vx = sl.vz = 0; }
    if (sl.hov > 0) { sl.hov -= dt; sl.t -= dt; sl.ht = (sl.ht || 0) - dt; if (sl.ht <= 0) { sl.ht = 0.25; sl.hit = new Set(); ringFx(sl.x, sl.z, 1.2, EC('slipper') ?? 0xff9a7a, 0.2, 0.6); } if (sl.hov <= 0) { sl.vx = sl.sv[0]; sl.vz = sl.sv[1]; } }
    if (sl.out && !(sl.hov > 0) && sl.t > (sl.small ? 0.3 : 0.42)) { sl.out = false; sl.hit = new Set(); if (SPX('slipper', 'ret')) sl.dmg *= 2; if (sl.evo && !sl.small) for (const da of [-0.7, 0.7]) { const a = Math.atan2(sl.vx, sl.vz) + da; bornS.push({ x: sl.x, z: sl.z, vx: Math.sin(a) * 14, vz: Math.cos(a) * 14, t: 0, out: true, dmg: sl.dmg * 0.6, hit: new Set(), spinA: 0, evo: false, small: true }); } }
    if (!sl.out) { const dx = player.x - sl.x, dz = player.z - sl.z, Lp = Math.hypot(dx, dz) || 1; sl.vx += (dx / Lp * 20 - sl.vx) * Math.min(1, dt * 6); sl.vz += (dz / Lp * 20 - sl.vz) * Math.min(1, dt * 6); if (Lp < 0.8 || sl.t > 2.6) sl.done = true; }
    sl.x += sl.vx * dt; sl.z += sl.vz * dt;
    query(sl.x, sl.z, sl.hov > 0 ? 1.3 : SPX('slipper', 'huge') ? 1.15 : 0.6, (e) => { if (sl.hit.has(e)) return; sl.hit.add(e); const Lv = Math.hypot(sl.vx, sl.vz) || 1; hitEnemy(e, sl.dmg, sl.vx / Lv * 14, sl.vz / Lv * 14, 'ranged'); spark(e.x, 0.7, e.z, 0xff9a7a, 5, 4, 0.3, 0.3); if (Math.random() < 0.15) dmgNum(e.x, e.z, '啪！', 'tag', e.r * 2 + 1); });
  }
  slippers = slippers.filter((s) => !s.done).concat(bornS);
  // 点名册：书从天上砸下来
  CW = 'rollcall';
  for (const bk of books) {
    if (bk.done) { bk.after += dt; continue; }
    if (bk.target && !bk.target.dead) { bk.x = bk.target.x; bk.z = bk.target.z; } if (bk.t < 0.45 && Math.random() < dt * 40) puff('rollcall', bk.x + rnd(-0.3, 0.3), bk.t / 0.45 * 7 + 0.3, bk.z + rnd(-0.3, 0.3), 1, 0.5, 0.32, 0.4);
    bk.t -= dt;
    if (bk.t <= 0) {
      bk.done = true; ripple(bk.x, bk.z, 0.8); shake = Math.max(shake, 0.15); dust(bk.x, bk.z, 16, 5); puff('rollcall', bk.x, 0.4, bk.z, 18, 5, 0.36, 0.45);
      query(bk.x, bk.z, 1.3, (o) => hitEnemy(o, bk.dmg * (o.type === 'boss' || o.type === 'hourglass' ? 2 : 1), 0, 0, 'magic'));
      { const X = player.sp.rollcall || {}; elemBurst('rollcall', bk.x, bk.z, 1.6);
        if (X.fear) { ringFx(bk.x, bk.z, 3.2, 0xffffff, 0.3, 0.7); query(bk.x, bk.z, 3.2, (o) => { if (o.type !== 'boss') o.frz = Math.max(o.frz || 0, 1); }); }
        if (X.again && !bk.re && bk.target && !bk.target.dead) books.push({ x: bk.x, z: bk.z, target: bk.target, t: 1.45, dmg: bk.dmg * 0.6, evo: bk.evo, done: false, after: 0, re: true });
        if (X.next && bk.target && bk.target.dead && (bk.ch || 0) < 3 && rollCall(1, bk.dmg, bk.evo)) books[books.length - 1].ch = (bk.ch || 0) + 1; }
      if (bk.evo) { ringFx(bk.x, bk.z, 2.8, 0xff8a6b, 0.3); query(bk.x, bk.z, 2.8, (o, dx, dz) => { const Lb = Math.hypot(dx, dz) || 1; if (Lb > 1.3) hitEnemy(o, bk.dmg * 0.4, dx / Lb * 6, dz / Lb * 6, 'magic', { noCrit: true }); }); }
    }
  }
  books = books.filter((b) => !b.done || b.after < 0.5);

  CW = null;
  let touching = 0, contactSource = null;
  function addContact(enemy) {
    touching += enemy.dps;
    if (!contactSource || enemy.dps > contactSource.dps) contactSource = enemy;
  }
  for (const e of enemies) {
    if (e.dead) continue;
    e.hit = Math.max(0, e.hit - dt * 7); e.slow -= dt; e.spinCd = (e.spinCd || 0) - dt; e.stink -= dt;
    if (e.sockSlow > 0) e.sockSlow -= dt;
    if (e.burn > 0) { e.burn -= dt; e.burnTick -= dt; if (e.burnTick <= 0) { e.burnTick = 0.5; e.hp -= e.burnDps * 0.5; if (Math.random() < 0.4) dmgNum(e.x, e.z, e.burnDps * 0.5, 'burn', e.r * 2 + 0.3); spark(e.x, e.r + 0.4, e.z, 0xff7a2a, 3, 1, 0.35, 0.5, -2); if (e.hp <= 0) { killEnemy(e, 'magic'); continue; } } }
    e.acid -= dt; e.brittle -= dt; e.chill = (e.chill || 0) - dt;
    if (e.burn > 0 && Math.random() < dt * 10) spark(e.x + rnd(-0.3, 0.3), e.r + 0.5, e.z + rnd(-0.3, 0.3), Math.random() < 0.5 ? 0xff7a2a : 0xffd23f, 1, 1.2, 0.46, 0.45, -4);
    if (e.acid > 0 && Math.random() < dt * 8) { spark(e.x + rnd(-0.4, 0.4), e.r + 0.7, e.z + rnd(-0.4, 0.4), 0x9be03a, 1, 0.6, 0.42, 0.5, 5); if (Math.random() < 0.2) blot(e.x + rnd(-0.3, 0.3), e.z + rnd(-0.3, 0.3), 0.22, 'rgba(120,190,40,.4)'); }
    if (e.chill > 0 && Math.random() < dt * 6) spark(e.x + rnd(-0.4, 0.4), e.r + 0.8, e.z + rnd(-0.4, 0.4), 0xd8f2ff, 1, 0.5, 0.32, 0.6, 2);
    if (NET && NET.on && !NET.host) { netMirrorStep(e, dt); if (!e.inv && !player.ghost && e.spawn <= 0 && Math.hypot(player.x - e.x, player.z - e.z) < e.r + 0.45) addContact(e); continue; }
    if (e.fb > 0) { e.fb -= dt; e.hp -= e.fbDps * dt; if (Math.random() < dt * 3) spark(e.x, e.r + 0.3, e.z, 0x9fe0ff, 1, 1, 0.3, 0.5, -1); if (e.hp <= 0) { killEnemy(e, ''); continue; } }
    if (e.frz > 0) { e.frz -= dt; e.moving = 0; continue; }
    if (e.spawn > 0) { e.spawn -= dt * 1.7; if (Math.random() < 0.3 && !e.fly) dust(e.x, e.z, 2, 2); if (e.spawn > 0) continue; }
    const tg = NET && NET.on ? netTarget(e) : player, pdx = tg.x - e.x, pdz = tg.z - e.z, pd = Math.hypot(pdx, pdz) || 1;
    // 橡皮鸭会把附近的怪吸引过去（大魔王不吃这一套）
    let tx = tg.x, tz = tg.z;
    if (ducks.length && e.type !== 'boss') { let bd = SPX('duck', 'lure') ? 196 : 81; for (const dk of ducks) { const q = (dk.x - e.x) ** 2 + (dk.z - e.z) ** 2; if (q < bd) { bd = q; tx = dk.x; tz = dk.z; } } }
    const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz) || 1;
    const sockSlowed = e.sockSlow > 0;
    let s = e.spd * (!sockSlowed && e.slow > 0 ? 0.45 : 1), ux = dx / d, uz = dz / d;
    if (!e.fly && (regionOf(e.x, e.z) !== regionOf(tx, tz) || (d > 2.5 && lineBlocked(e.x, e.z, tx, tz))) && flowDir(e)) { ux = FD[0]; uz = FD[1]; }
    e.cdA -= dt;
    switch (e.type) {
      case 'sleepy': if (e.sleep > 0) { e.sleep -= dt; s = 0; if (Math.random() < 0.02) burst(e.x, 1.2, e.z, 0x9a8cff, 1, 0.5, 0.25, 1.2, -1); } else if (e.cdA <= 0) { e.cdA = rnd(5, 9); e.sleep = 1.2; } break;
      case 'bat': { const w = Math.sin(realTime * 5 + e.seed * 20) * 0.8; ux += -uz * w; uz += (dx / d) * w; break; }
      case 'clock':
        if (e.dash > 0) { e.dash -= dt; ux = e.dx; uz = e.dz; s = 10; if (Math.random() < 0.5) dust(e.x, e.z, 1, 1); }
        else if (e.ringing > 0) { e.ringing -= dt; s = 0; if (e.ringing <= 0) { e.dash = 0.45; e.dx = ux; e.dz = uz; } }
        else if (e.cdA <= 0 && d < 9) { e.cdA = 3.5; e.ringing = 0.7; dmgNum(e.x, e.z, '叮铃!', 'tag', 1.6); }
        break;
      case 'ghost': if (pd < 6) { ux = -pdx / pd; uz = -pdz / pd; s *= 0.6; } if (e.cdA <= 0 && pd < 12) { e.cdA = 2.6; eshots.push({ x: e.x, y: 1.0, z: e.z, vx: pdx / pd * 8, vz: pdz / pd * 8, life: 2.2, source: e.type }); } break;
      case 'phone': if (pd < 4) { player.slowT = 0.3; if (Math.random() < 0.02) dmgNum(player.x, player.z, '分心', 'tag', 2.2); } break;
      case 'snail': if (Math.random() < dt * 3) blot(e.x, e.z, 0.5, 'rgba(90,140,80,.4)'); break;
      case 'bomber':
        if (e.fuse > 0) {
          s = 0; e.fuse -= dt; const fk = 1 - e.fuse / (e.fuseMax || FUSE); e.warn = (realTime * (5 + fk * 16)) % 1 < 0.5 ? 0.85 : 0.1;
          if (Math.random() < 0.6) spark(e.x + rnd(-0.4, 0.4), 2.6, e.z + rnd(-0.4, 0.4), 0xffd84d, 1, 3, 0.35, 0.3, -1);
          if (e.fuse <= 0) { e.fuse = -1; killEnemy(e, ''); continue; }
        } else if (pd < 3.2) { e.fuse = e.fuseMax = FUSE; dmgNum(e.x, e.z, '要炸了！', 'tag', 3.6); ripple(e.x, e.z, 0.5); }
        break;
      case 'chalk':
        if (e.aim > 0) { s = 0; e.aim -= dt; if (e.aim <= 0) { eshots.push({ x: e.x + e.ax * 0.5, y: 0.9, z: e.z + e.az * 0.5, vx: e.ax * 13, vz: e.az * 13, life: 1.5, rig: 'chalkP', dmg: 10, source: e.type }); e.cdA = 2.6; spark(e.x + e.ax * 0.5, 0.9, e.z + e.az * 0.5, 0xffffff, 6, 3, 0.3, 0.2, 0); } }
        else if (pd < 5) { ux = -pdx / pd; uz = -pdz / pd; }
        else if (pd < 10.5) { if (pd < 8.5) s = 0; if (e.cdA <= 0) { e.aim = 0.75; e.ax = pdx / pd; e.az = pdz / pd; zap([{ x: e.x, y: 0.9, z: e.z }, { x: e.x + e.ax * 11, y: 0.9, z: e.z + e.az * 11 }], 0xff4a4a, 0.75, 0); } }
        break;
      case 'mole':
        if (e.ms === 'wind') { s = 0; e.pop -= dt; if (Math.random() < dt * 30) dust(e.x, e.z, 1, 2.5); if (e.pop <= 0) { e.ms = 'dig'; e.inv = true; e.ut = 1.5; dust(e.x, e.z, 16, 4); blot(e.x, e.z, 0.6, 'rgba(120,80,50,.22)'); } }
        else if (e.ms === 'dig') {
          s = 6.5; e.ut -= dt; if (Math.random() < dt * 30) dust(e.x, e.z, 1, 1.5); if (Math.random() < dt * 12) blot(e.x, e.z, 0.32, 'rgba(120,80,50,.16)');
          if (pd < 1.1 || e.ut <= 0) { e.ms = 'pop'; e.pop = 0.65; ringFx(e.x, e.z, 1.7, 0xffb04a, 0.65, 0.8); ringFx(e.x, e.z, 1.7, 0xff5a4a, 0.3, 0.6); }
        } else if (e.ms === 'pop') {
          s = 0; e.pop -= dt;
          if (e.pop <= 0) { e.inv = false; e.ms = 'dizzy'; e.dz = 2.4; e.up = 4; dust(e.x, e.z, 22, 6); ripple(e.x, e.z, 0.6); shake = Math.max(shake, 0.12); if (pd < 1.6) hurtPlayer(11 * DF().dmg * tDmg(), e.type); }
        } else if (e.ms === 'dizzy') {
          s = 0; e.dz -= dt; e.up -= dt; if (Math.random() < dt * 9) { const a = realTime * 6 + Math.random(); spark(e.x + Math.cos(a) * 0.5, e.r * 2 + 0.55, e.z + Math.sin(a) * 0.5, 0xffe07a, 1, 0.3, 0.3, 0.45, 0); }
          if (e.dz <= 0) { e.ms = 'walk'; e.mcd = 8; }
        } else { e.up = 0; e.mcd -= dt; if (e.mcd <= 0 && pd < 8.5 && pd > 2 && regionOf(e.x, e.z) === regionOf(player.x, player.z)) { e.ms = 'wind'; e.pop = 0.7; ringFx(e.x, e.z, 1.2, 0xffb04a, 0.7, 0.7); dmgNum(e.x, e.z, '！', 'tag', e.r * 2 + 1); } }
        break;
      case 'boss':
        if (e.rushW > 0) { e.rushW -= dt; s = 0; if (Math.random() < dt * 30) dust(e.x, e.z, 2, 4); if (e.rushW <= 0) { e.rushT = 0.75; e.rushHit = false; shake = Math.max(shake, 0.3); } }
        else if (e.rushT > 0) { e.rushT -= dt; s = 17; ux = e.ax; uz = e.az; dust(e.x, e.z, 3, 5); if (!e.rushHit && pd < e.r + 1) { e.rushHit = true; hurtPlayer(34 * DF().dmg * tDmg(), e.type); } }
        else if (e.slam > 0) { e.slam -= dt; s = 0; tele.visible = true; tele.position.set(e.x, 0.05, e.z); tele.scale.setScalar(6.8 * (1 - e.slam / 0.9) + 0.5); tele.material.opacity = 0.15 + 0.25 * (1 - e.slam / 0.9);
          if (e.slam <= 0) { tele.visible = false; ripple(e.x, e.z, 1.8); shake = 0.6; chroma = 0.5; dust(e.x, e.z, 50, 9); ringMark(e.x, e.z, 6.2, 'rgba(20,10,5,.5)', 12); ringFx(e.x, e.z, 7, 0xff5a4a, 0.4); if (pd < 7.2) hurtPlayer(32 * DF().dmg * tDmg(), e.type); } }
        else if (e.cdA <= 0) {
          if (!e.enraged && DF().enrage && e.hp < e.maxHp * 0.5) { e.enraged = true; banner('大魔王发怒了', '攻击更快，招式更多'); shake = 0.6; chroma = 0.8; ripple(e.x, e.z, 2); spark(e.x, 2, e.z, 0xff3a4a, 90, 9, 0.4, 0.9); }
          const nAtk = (DF().storm || e.enraged) ? 4 : 3; e.atk = (e.atk + 1) % nAtk; e.atkN = (e.atkN || 0) + 1;
          if (e.atk === nAtk - 1) { e.rushW = 0.85; e.ax = pdx / pd; e.az = pdz / pd; dmgNum(e.x, e.z, '冲撞!', 'tag', 5); zap([{ x: e.x, y: 0.6, z: e.z }, { x: e.x + e.ax * 13, y: 0.6, z: e.z + e.az * 13 }], 0xff4a4a, 0.85, 0, 4); }
          else if (e.atk === 0) e.slam = 0.9;
          else if (e.atk === 1) { const usePhone = diffId === 'hard' && e.enraged, cnt = diffId === 'easy' ? 6 : 10; for (let k = 0; k < cnt; k++) { const a = k / cnt * TAU; const n = spawn(k % 2 && usePhone ? 'phone' : 'cross', clamp(e.x + Math.cos(a) * 4.6, -HX + 0.6, HX - 0.6), clamp(e.z + Math.sin(a) * 4.6, -HZ + 0.6, HZ - 0.6)); if (n) n.spawn = 0.4; } ripple(e.x, e.z, 1); }
          else { // 卷子雨：两圈纸团往外飞，第二圈错开半格
            const n = diffId === 'hard' ? 18 : 14; dmgNum(e.x, e.z, '卷子雨!', 'tag', 3.2);
            for (let w = 0; w < 2; w++) setTimeout(() => { if (!boss) return; for (let k = 0; k < n; k++) { const a = (k + w * 0.5) / n * TAU; eshots.push({ x: e.x, y: 1.2, z: e.z, vx: Math.cos(a) * 7, vz: Math.sin(a) * 7, life: 3, source: e.type }); } ripple(e.x, e.z, 0.8); }, w * 450);
          }
          e.cdA = DF().cd * (e.enraged ? 0.7 : 1);
        }
        break;
    }
    if (sockSlowed) s *= SOCK_ALT_SPEED;
    let ax = ux * s, az = uz * s;
    query(e.x, e.z, e.r * 0.9, (o, ox, oz) => { if (o === e || o.fly !== e.fly) return; const L2 = Math.hypot(ox, oz) || 0.01, push = (e.r + o.r - L2) * 2.4; if (push > 0) { ax -= ox / L2 * push; az -= oz / L2 * push; } });
    e.x += (ax + e.kx) * dt; e.z += (az + e.kz) * dt; e.kx *= Math.pow(0.02, dt); e.kz *= Math.pow(0.02, dt);
    if (!e.fly) pushOutProps(e, e.r); else { e.x = clamp(e.x, -HX, HX); e.z = clamp(e.z, -HZ, HZ); }
    e.moving = s > 0 ? 1 : 0; e.ph += s * dt * 3.2;
    if (tg === player && pd < e.r + 0.45 && !e.inv) addContact(e);
  }
  // 贴身伤害按 0.45 秒结算一次，每次都能闪避
  if (touching && player.iframe <= 0) { player.iframe = 0.45; hurtPlayer(touching * 0.45, contactSource.type); }
  for (const b of eshots) { b.x += b.vx * dt; b.z += b.vz * dt; b.life -= dt; if (b.life > 0 && inWall(b.x, b.z, 0.05)) { b.life = 0; burst(b.x, 1, b.z, 0xf7f4ea, 8, 3, 0.28, 0.3); dust(b.x, b.z, 3, 2); } else if (Math.hypot(b.x - player.x, b.z - player.z) < 0.6) { b.life = 0; hurtPlayer((b.dmg || 8) * DF().dmg * tDmg(), b.source); burst(b.x, 1, b.z, 0xf7f4ea, 10, 3, 0.3, 0.3); } }
  eshots = eshots.filter((b) => b.life > 0);
  if (player.hp <= 0 && !player.ghost) { player.hp = 0; burst(player.x, 0.8, player.z, 0xd8423a, 60, 7, 0.35, 0.8); if (NET && NET.on) netDie(); else { showDeath(); return; } }

  // 我方子弹：穿透、分裂、弹射、爆炸
  const born = [];
  for (const s of shots) {
    if (s.el != null ? Math.random() < dt * 40 : WPC[s.w] && Math.random() < dt * 24) { const c = s.el ?? WPC[s.w][(Math.random() * 2) | 0]; spark(s.x + rnd(-0.1, 0.1), s.y, s.z + rnd(-0.1, 0.1), c, 1, 0.5, s.el != null ? 0.36 : 0.28, 0.35, c === ELC.fire ? -3 : c === ELC.acid ? 4 : 0); }
    s.x += s.vx * dt; s.z += s.vz * dt; s.life -= dt; s.spinA = (s.spinA || 0) + s.spin * dt;
    query(s.x, s.z, s.r, (e) => {
      if (s.life <= 0 || s.hit.has(e)) return;
      s.hit.add(e); CW = s.w; hitEnemy(e, s.dmg, s.vx * 0.12, s.vz * 0.12, s.tag);
      spark(s.x, 0.8, s.z, s.rig === 'pencilP' ? 0xffc83d : s.rig === 'staple' ? 0xdfe6ef : 0xff8fb1, 3, 3, 0.25, 0.2);
      if (s.boom) boom(s.x, s.z, 1.3, s.dmg * 0.8, 'gun', 0xff8fb1);
      if (s.split) { s.split = false; const a = Math.atan2(s.vx, s.vz), sp = Math.hypot(s.vx, s.vz); for (const da of [-0.5, 0.5]) born.push({ ...s, vx: Math.sin(a + da) * sp, vz: Math.cos(a + da) * sp, life: 0.6, dmg: s.dmg * 0.6, hit: new Set(s.hit), split: false }); }
      if (--s.pierce < 0) { if (s.bounce > 0) { const n = nearest(s.x, s.z, 7, s.hit); if (n) { s.bounce--; s.pierce = 0; const L = Math.hypot(n.x - s.x, n.z - s.z) || 1, sp = Math.hypot(s.vx, s.vz); s.vx = (n.x - s.x) / L * sp; s.vz = (n.z - s.z) / L * sp; s.life = 0.8; return; } } s.life = 0; }
    });
  }
  shots = shots.filter((s) => s.life > 0).concat(born);
  CW = 'plane';
  const bornP = [], PX = player.sp.plane || {};
  for (const p of planes) {
    if (Math.random() < dt * (EC('plane') != null ? 45 : 28)) puff('plane', p.x, p.y, p.z, 1, 0.4, 0.3, 0.4);
    p.life -= dt;
    if (!p.target || p.target.dead) p.target = nearest(p.x, p.z, 12, p.hit);
    if (p.target) { const ty = Math.atan2(p.target.x - p.x, p.target.z - p.z); let dd = ty - p.yaw; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); p.yaw += clamp(dd, -5 * dt, 5 * dt); }
    p.sp = Math.min(15, p.sp + dt * 10); p.x += Math.sin(p.yaw) * p.sp * dt; p.z += Math.cos(p.yaw) * p.sp * dt;
    query(p.x, p.z, 0.3, (e) => { if (p.life <= 0 || p.hit.has(e)) return; p.hit.add(e); hitEnemy(e, p.dmg, Math.sin(p.yaw) * 5, Math.cos(p.yaw) * 5, 'ranged'); spark(p.x, 0.8, p.z, ecRand('plane') ?? 0xffffff, 8, 4, 0.3, 0.3); if (PX.bomb) boom(p.x, p.z, 1.6, p.dmg * 0.5, 'ranged', EC('plane') ?? 0xbfe0ff);
      if (PX.split && !p.small) for (const da of [-0.9, 0.9]) bornP.push({ x: p.x, y: p.y, z: p.z, yaw: p.yaw + da, sp: 9, life: 1.8, dmg: p.dmg * 0.5, target: null, pierce: 0, hit: new Set(p.hit), small: true });
      if (--p.pierce < 0) p.life = 0; else p.target = null; });
  }
  planes = planes.filter((p) => p.life > 0).concat(bornP); CW = null;
  if (skillDemoMode) {
    enemies = enemies.filter((e) => !e.dead);
    return;
  }
  for (const g of gems) { const dx = player.x - g.x, dz = player.z - g.z, d = Math.hypot(dx, dz) || 0.01; if (d < player.magnet) g.pull = true; if (g.pull) { g.s = Math.min(g.s + dt * 40, g.vac ? 48 : 22); g.x += dx / d * g.s * dt; g.z += dz / d * g.s * dt; } if (d < 0.6) { g.got = true; player.xp += g.v * (1 + player.st.xp) * (A('grant') ? 1.3 : 1); } }
  gems = gems.filter((g) => !g.got);
  while (player.xp >= player.need) { player.xp -= player.need; player.lvl++; player.need = Math.round(3 + player.lvl * 2 + 0.2 * Math.pow(player.lvl, 2.25)); pendingLevels++; }
  if (state === 'play') for (const c of chests) if (Math.hypot(player.x - c.x, player.z - c.z) < 1.3) { chests = chests.filter((q) => q !== c); openChest(c); break; }
  for (const d of drops) if (Math.hypot(player.x - d.x, player.z - d.z) < 1.1) { d.got = true; for (const g of gems) { g.pull = true; g.vac = true; } ringFx(player.x, player.z, 9, 0x7fe0ff, 0.6); ripple(player.x, player.z, 1.2); banner('知识吸取', '全场经验都飞过来了'); }
  drops = drops.filter((d) => !d.got);
  for (const g of gifts) g.t += dt;
  gifts = gifts.filter((g) => g.t <= 40);
  if (state === 'play') {
    const gift = gifts.findIndex((g) => Math.hypot(player.x - g.x, player.z - g.z) < 1.1);
    if (gift !== -1) {
      const [pickup] = gifts.splice(gift, 1);
      openChest({ relic: pickup.id });
    }
  }
  for (const a of altars) { a.age += dt; if (state === 'play' && Math.hypot(player.x - a.x, player.z - a.z) < 1.6) { altars = altars.filter((q) => q !== a); showArts(); break; } }
  if (A('watch')) { watchT -= dt; if (watchT <= 0) { watchT = 12; for (const e of enemies) if (e.type !== 'boss' && !e.inv) e.frz = 1.5; ringFx(player.x, player.z, 12, 0x9fe0ff, 0.6); dmgNum(player.x, player.z, '时停！', 'tag', 2.6); } }
  if (A('bubble')) { if (!player.shield) { shieldT -= dt; if (shieldT <= 0) { player.shield = true; spark(player.x, 1, player.z, 0x9fe0ff, 20, 3, 0.3, 0.6, 0); } } else if (Math.random() < 0.4) spark(player.x + Math.cos(realTime * 5) * 0.8, 0.9, player.z + Math.sin(realTime * 5) * 0.8, 0x9fe0ff, 1, 0.2, 0.3, 0.4, 0); }
  enemies = enemies.filter((e) => !e.dead);
  if (pendingLevels > 0 && state === 'play') showLevelUp();
}

const STILL = { ph: 0, hit: 0, seed: 0, moving: 0 };
function drawGacha(dt) {
  const h = gch.hitT / GACHA_HIT_RECOIL;
  const turn = THREE.MathUtils.smoothstep(gch.t, 0, GACHA_TURN_TIME);
  if (gch.on) GS.goose.rotation.y = THREE.MathUtils.lerp(gch.turnFrom, GACHA_PILLAR_YAW, turn);
  else GS.goose.rotation.y *= Math.max(0, 1 - dt * 5);

  // 转身站定后，从脖子根部转一整圈，头和黄鼠狼跟着脖子走。
  const elapsedBeats = (gch.t - GACHA_TURN_TIME) / gch.beat;
  const phase = gch.on && elapsedBeats >= 0 && elapsedBeats < gch.res.length ? elapsedBeats % 1 : 0;
  const windup = THREE.MathUtils.smoothstep(phase, 0, 0.2);
  const spin = THREE.MathUtils.smootherstep(phase, 0.2, GACHA_HIT_PHASE);
  const reach = THREE.MathUtils.smoothstep(phase, 0.51, GACHA_HIT_PHASE)
    * (1 - THREE.MathUtils.smoothstep(phase, GACHA_HIT_PHASE, 0.92));
  const lean = windup * (1 - THREE.MathUtils.smoothstep(phase, GACHA_HIT_PHASE, 1));
  GS.neck.rotation.y = TAU * spin - 0.45 * windup * (1 - spin);
  GS.neck.rotation.x = 0.1 + 0.68 * lean - 0.55 * reach;

  // 碰到柱顶时脖子拉长，黄鼠狼甩平，随后弹回。
  const neckLength = 1 + 1.55 * reach;
  GS.neckMesh.position.y = 0.45 * neckLength;
  GS.neckMesh.scale.y = 0.55 * neckLength;
  GS.head.position.y = neckLength;
  GS.weasel.rotation.x = -0.15 - 1.42 * lean - GS.neck.rotation.x;
  GS.weasel.rotation.z = 0.38 * Math.sin(TAU * spin) * lean + Math.sin(realTime * 5) * 0.12 * (1 - lean);
  const wing = 0.1 + 0.22 * Math.sin(turn * PI) + 0.24 * h;
  GS.wL.rotation.z = wing; GS.wR.rotation.z = -wing;
  GS.weasel.scale.set(1 + h * 0.5, 1 - h * 0.35, 1 + h * 0.5);
  GS.pillar.rotation.z = Math.sin(realTime * 45) * h * 0.08; GS.pillar.scale.y = GACHA_PILLAR_SCALE * (1 - h * 0.12);
  if (gch.hero) { gch.hero.t += dt; const k = Math.min(1, gch.hero.t * 2.5), pseudo = { ph: realTime * 6, hit: 0, seed: 0.3, moving: 0.4, glowMul: 2.4 };
    heroRig(gch.hero.h, gch.hero.sk).push(pseudo, worldM(-3.9, Math.abs(Math.sin(realTime * 4)) * 0.2, GZ + 1.6, 0.5 + Math.sin(realTime * 1.2) * 0.3, 1.3 * (0.4 + 0.6 * k))); shadow(-3.9, GZ + 1.6, 0.7); }
}
let fireClock = 0;
function draw(dt) {
  shN = 0;
  if (state !== 'title') {
    player.glowMul = 2.4; const yaw = player.yaw + (player.spinT > 0 ? (1 - player.spinT) * TAU : 0);
    heroRig(clsId).push(player, worldM(player.x, 0, player.z, yaw, 1, 1 + Math.sin(player.ph * 2) * 0.02 * player.moving)); shadow(player.x, player.z, 0.55);
    if (sweepFx.t > 0) { sweepFx.t -= dt * 4.2; const p = 1 - sweepFx.t, arc = sweepFx.arc || TAU, a0 = HP_ - (sweepFx.yaw || 0) + arc / 2, r = sweepFx.r, sc = r / 1.6; STILL.etint = elT('sweep');
      // 尺子本体加几道残影，注入元素后本体和残影都变成元素的颜色
      for (let g = 0; g < 4; g++) { const pp = p - g * 0.08; if (pp < 0) break; const a = a0 - pp * arc, k = 1 - g * 0.17; if (g) STILL.etint = elT('sweep', g) || STILL.etint; RIGS.ruler.push(STILL, worldM(player.x + Math.cos(a) * r * 0.52, 0.8 - g * 0.03, player.z + Math.sin(a) * r * 0.52, -a, sc * k, 1.6 * k, sc * 0.8 * k)); }
      STILL.etint = null; const a = a0 - p * arc;
      spark(player.x + Math.cos(a) * r * 0.98, 0.8, player.z + Math.sin(a) * r * 0.98, pc('sweep'), EC('sweep') != null ? 6 : 4, 2.5, 0.38, 0.35, EC('sweep') === ELC.fire ? -3 : 0); }
  } else {
    const port = innerWidth < 860, prep = titleStep === 'prep'; selF += (selIdx - selF) * Math.min(1, dt * 9);
    podium.visible = prep;
    if (titleStep === 'gacha') drawGacha(dt); else CLS_IDS.forEach((id, i) => {
      const lk = !isOpen(id), sel = prep && i === selIdx; let x, z, sc, yaw, y = 0, base = 0;
      if (!prep) { const col = Math.floor(i / 3), row = i % 3, sp = port ? 1.15 : 1.6; x = (col - 2 + (row === 1 ? 0.5 : 0)) * sp * (1 + row * 0.06); z = -0.2 - row * 1.5; base = row * 0.62; sc = port ? 0.95 : 1.0; yaw = Math.sin(realTime * 0.8 + i) * 0.25; y = Math.pow(Math.max(0, Math.sin(realTime * 2.4 - i * 0.8)), 10) * 0.6; }
      else if (Math.abs(i - selF) > 2.6) return;
      else { const a = (i - selF) * 0.6, f = Math.max(0, 1 - Math.abs(i - selF)); x = Math.sin(a) * 3.6; z = -1 - (1 - Math.cos(a)) * 5; sc = 0.9 + 0.6 * f; yaw = f > 0.5 ? Math.sin(realTime * 1.3) * 0.4 : -a * 0.5; y = f * 0.22 + (sel && !lk ? Math.abs(Math.sin(realTime * 4.5)) * 0.22 : 0); }
      const pseudo = { ph: sel && !lk ? realTime * 8 : 0, hit: 0, seed: i * 0.13, moving: sel && !lk ? 0.6 : 0, glowMul: 2.4, dark: lk && prep };
      heroRig(id).push(pseudo, worldM(x + TX, y + base, z + TZ, yaw, sc)); if (!base) shadow(x + TX, z + TZ, 0.55 * sc);
    });
  }
  if (state !== 'title') podium.visible = false;
  if (state !== 'title' && NET && NET.on) drawPeers(); else if (ptags.childElementCount) ptags.innerHTML = '';
  if (demoSockAlly) {
    const { x, z } = demoSockAlly;
    heroRig('scholar', '').push(STILL, worldM(x, 0, z, HP_, 1));
    shadow(x, z, 0.55);
  }
  gStage.visible = state === 'title' && titleStep === 'gacha';
  let fi = 0;
  for (const e of enemies) {
    if (e.type === 'mole' && e.inv) { const pk = e.ms === 'pop' ? 1 - e.pop / 0.65 : 0; RIGS.mound.push(e, worldM(e.x + (pk ? Math.sin(realTime * 50) * 0.05 : 0), 0, e.z, e.seed * 6, 1 + pk * 0.5, 1 + pk * 0.9, 1 + pk * 0.5)); continue; }
    const fz = e.fuse > 0 ? 1 - e.fuse / (e.fuseMax || FUSE) : 0, sw = e.size * (1 + fz * 0.4 + (fz ? Math.sin(realTime * 45) * 0.05 : 0)) , popY = e.type === 'mole' && e.up > 3.75 ? -(e.up - 3.75) * 4 : 0;
    if (e.fuse > 0 && fi < 4) { const a = fuseDiscs[fi * 2], b = fuseDiscs[fi * 2 + 1]; fi++; a.visible = b.visible = true; a.position.set(e.x, 0.07, e.z); b.position.set(e.x, 0.075, e.z); a.scale.setScalar(BLAST_R); b.scale.setScalar(Math.max(0.01, BLAST_R * fz)); }
    if (!(e.fuse > 0)) e.warn = 0;
    const rise = e.spawn > 0 ? e.spawn : 0, hopOk = !e.fly && rise <= 0 && e.type !== 'snail' && e.type !== 'boss', y = e.fly ? 0 : -rise * e.size * 1.3 + (hopOk ? Math.abs(Math.sin(e.ph)) * 0.13 * e.moving : 0), yaw = Math.atan2(player.x - e.x, player.z - e.z), sq = 1 + Math.sin(e.ph * 2) * 0.07 * e.moving;
    RIGS[RIG_OF(e.type)].push(e, worldM(e.x + (fz ? Math.sin(realTime * 60) * 0.06 * fz : 0), y + popY, e.z, yaw, sw * (1 + e.hit * 0.15), sw * (sq - e.hit * 0.1), sw * (1 + e.hit * 0.15)));
    shadow(e.x, e.z, e.r * (e.fly ? 0.7 : 1) * (1 - rise * 0.7));
  }
  for (let k = fi * 2; k < 8; k++) fuseDiscs[k].visible = false;
  for (const c of corpses) { c.t += dt / 0.2; const k = Math.min(1, c.t); RIGS[RIG_OF(c.type)].push({ ph: 0, hit: 1 - k * 0.4, seed: c.seed, moving: 0 }, worldM(c.x, 0, c.z, c.yaw, c.size * (1 + k * 0.7), c.size * Math.max(0.04, 1 - k), c.size * (1 + k * 0.7))); }
  corpses = corpses.filter((c) => c.t < 1);
  for (const m of minions) { m.glowMul = 1; m.etint = elT('minion', (m.seed * 10) | 0); const f = Math.min(1, m.temp * 3, (m.max - m.temp) * 6 + 0.2); RIGS.minion.push(m, worldM(m.x, Math.abs(Math.sin(m.ph)) * 0.15 * m.moving, m.z, m.yaw, 1.1 * (m.big || 1) * f)); shadow(m.x, m.z, 0.35); }
  for (const dk of ducks) { dk.etint = elT('duck'); const f = Math.min(1, dk.life * 4) * (1 + (dk.life < 0.8 ? Math.sin(realTime * 40) * 0.08 : 0)); RIGS.duck.push(dk, worldM(dk.x, dk.drop * 3 + Math.abs(Math.sin(dk.ph)) * 0.12, dk.z, Math.sin(dk.ph * 0.7) * 0.6 + dk.seed * 6, 1.1 * f, 1.1 * f, 1.1 * f, 0, Math.sin(dk.ph) * 0.15)); shadow(dk.x, dk.z, 0.45); }
  slippers.forEach((sl, i) => { STILL.etint = elT('slipper', i); RIGS.slipperP.push(STILL, worldM(sl.x, 0.8, sl.z, sl.spinA, (sl.small ? 0.7 : 1) * (SPX('slipper', 'huge') ? 1.7 : 1))); }); STILL.etint = null;
  STILL.etint = elT('rollcall'); for (const bk of books) { const y = bk.done ? 0.13 : bk.t / 0.45 * 7 + 0.13; RIGS.bookP.push(STILL, worldM(bk.x, y, bk.z, bk.x * 3, 1.2, 1.2, 1.2, bk.done ? 0 : bk.t * 6)); if (!bk.done) shadow(bk.x, bk.z, 0.6 * Math.max(0, 1 - bk.t)); }
  STILL.etint = null;
  sockRing.visible = !!player.weapons.sock && state !== 'title';
  const auras = remoteSockAuras();
  if (sockRing.visible && player.alt.sock && !player.ghost && player.hp > 0)
    auras.unshift({ x: player.x, z: player.z, radius: sockAuraRadius() });
  outerSockMaterial.opacity = 0.64 + 0.16 * Math.sin(realTime * 3);
  sockAuraMeshes.forEach((mesh, i) => {
    const aura = auras[i];
    mesh.visible = !!aura;
    if (aura) {
      mesh.position.set(aura.x, 0.032, aura.z);
      mesh.scale.setScalar(aura.radius * 1.12);
      mesh.rotation.z -= dt * 0.65;
    }
  });
  if (sockRing.visible) { const R0 = sockR || 2; sockRing.position.set(player.x, 0.04, player.z); sockRing.scale.setScalar(R0 * 1.12 * (1 + 0.04 * Math.sin(realTime * 4))); sockRing.rotation.z += dt * 0.5; sockRing.material.opacity = 0.62 + 0.14 * Math.sin(realTime * 3); sockRing.material.color.set(EC('sock') ?? 0xa8e04a); if (EC('sock') != null && state === 'play' && Math.random() < dt * 1.4) elemBurst('sock', player.x, player.z, R0);
    const nS = player.evo.sock ? 4 : 3; for (let k = 0; k < nS; k++) { const a = -realTime * 1.6 + k / nS * TAU; RIGS.sockP.push({ ph: realTime * 3 + k, hit: 0, seed: k * 0.3, moving: 0, glowMul: 2, etint: elT('sock', k) }, worldM(player.x + Math.cos(a) * R0 * 0.78, 0.75 + Math.sin(realTime * 3 + k * 2) * 0.18, player.z + Math.sin(a) * R0 * 0.78, a + realTime * 2, 1.25)); }
    if (state === 'play' && Math.random() < dt * 16) { const a = rnd(0, TAU), r = rnd(0.4, 1) * R0; spark(player.x + Math.cos(a) * r, 0.3, player.z + Math.sin(a) * r, ecRand('sock') ?? (Math.random() < 0.7 ? 0xa8d84a : 0xd8f08a), 1, 0.8, 0.42, 0.7, -2.5); } }
  drawTask(dt); drawWet();
  for (const Lp of lamps) { Lp.etint = elT('lamp'); Lp.glowMul = 3; Lp.ph = 0; Lp.moving = 0; Lp.hit = 0; RIGS.lamp.push(Lp, worldM(Lp.x, Lp.drop * 4, Lp.z, Lp.aim, 1.15 * (Lp.life < 1 ? Lp.life : 1))); shadow(Lp.x, Lp.z, 0.5); }
  for (const s of shots) { STILL.tint = s.tint; STILL.etint = s.elc || null; const k = s.sc || 1; RIGS[s.rig].push(STILL, worldM(s.x, s.y, s.z, Math.atan2(s.vx, s.vz), k, k, k, s.spinA || 0, s.spinA ? s.spinA * 0.7 : 0)); }
  STILL.tint = null; STILL.etint = null;
  planes.forEach((p, i) => { STILL.etint = elT('plane', i); const k = p.small ? 0.6 : 0.9; RIGS.planeP.push(STILL, worldM(p.x, p.y + Math.sin(realTime * 8 + p.life) * 0.08, p.z, p.yaw, k, k, k, 0, Math.sin(realTime * 6) * 0.3)); }); STILL.etint = null;
  for (const b of eshots) { if (b.rig) RIGS[b.rig].push(STILL, worldM(b.x, b.y, b.z, Math.atan2(b.vx, b.vz), 1.2)); else RIGS.paper.push(STILL, worldM(b.x, b.y, b.z, b.life * 6, 1, 1, 1, b.life * 4)); }
  if (player.weapons.spin && state !== 'title') {
    const s = ws('spin'), evo = player.evo.spin, n = s.n * (evo ? 2 : 1), rr = s.rad * area('melee') * (evo ? 1.3 : 1);
    for (let i = 0; i < n; i++) { const [sx_, sz_, a] = spinPos(i, n, s, rr, evo); STILL.etint = elT('spin', i); RIGS.ruler.push(STILL, worldM(sx_, 0.6, sz_, -a + HP_ * 0.5, evo ? 1.3 : 1)); STILL.etint = null; if (STILL.etint === null && elOf('spin').includes('elec') && state === 'play' && Math.random() < dt * 5) { const [bx, bz] = spinPos((i + 1) % n, n, s, rr, evo); zap([{ x: sx_, y: 0.7, z: sz_ }, { x: bx, y: 0.7, z: bz }], 0x8fd0ff, 0.12, 0.25, 2); } const sc_ = ecRand('spin'); if (state === 'play' && Math.random() < dt * (sc_ != null ? 60 : 14)) spark(player.x + Math.cos(a) * (rr + rnd(-0.6, 0.8)), 0.6, player.z + Math.sin(a) * (rr + rnd(-0.6, 0.8)), sc_ ?? 0xffe07a, 1, 0.6, sc_ != null ? 0.42 : 0.3, sc_ != null ? 0.5 : 0.3, sc_ === ELC.fire ? -3 : 0); }
    if (state === 'play' && EC('spin') != null && Math.random() < dt * 2.5) { ringFx(player.x, player.z, rr + 0.8, ecRand('spin'), 0.45, 0.6); if (elOf('spin').includes('elec')) elemBurst('spin', player.x, player.z, rr + 0.8); }
  }
  for (const c of chests) { RIGS.chest.push({ ph: 0, hit: 0, seed: 0.5, moving: 0 }, worldM(c.x, Math.abs(Math.sin(realTime * 3)) * 0.2, c.z, realTime * 0.8, 1)); shadow(c.x, c.z, 0.7); if (Math.random() < 0.4) spark(c.x, 1, c.z, 0xffd23f, 1, 1.2, 0.35, 0.9, -2); }
  for (const g of gifts) { const col = RELICS[g.id].curse ? 0x6a8aff : RAR3[RELICS[g.id].r], bl = g.t > 34 ? (Math.sin(realTime * 20) > 0 ? 1 : 0.3) : 1; RIGS.chest.push({ ph: 0, hit: 0, seed: 0.5, moving: 0 }, worldM(g.x, 0.15 + Math.abs(Math.sin(realTime * 4 + g.x)) * 0.15, g.z, realTime * 1.6, 0.5 * bl)); shadow(g.x, g.z, 0.35); if (Math.random() < 0.5) spark(g.x + rnd(-0.2, 0.2), 0.7, g.z + rnd(-0.2, 0.2), col, 1, 1, 0.4, 0.8, -3); }
  for (const d of drops) { RIGS.vac.push({ ph: 0, hit: 0, seed: 0.3, moving: 0, glowMul: 2.4 }, worldM(d.x, 0.2 + Math.sin(realTime * 3) * 0.12, d.z, realTime * 1.5, 1.1)); shadow(d.x, d.z, 0.5); }
  for (const a of altars) { RIGS.altar.push({ ph: 0, hit: 0, seed: 0.1, moving: 0, glowMul: 2.6 }, worldM(a.x, 0, a.z, realTime * 0.6, Math.min(1, a.age * 2))); shadow(a.x, a.z, 0.9); if (Math.random() < 0.3) spark(a.x, 1.6, a.z, 0xffd23f, 1, 1.2, 0.3, 0.9, -2); }
  drawAltarMark(); drawPortals(dt);
  const gemObj = { ph: 0, hit: 0, seed: 0, moving: 0, glowMul: 2 };
  for (const g of gems) { const z = g.sz || 0; gemObj.glowMul = z === 2 ? 1.6 : 2; gemObj.ph = g.ph; RIGS[z === 2 ? 'gem3' : z === 1 ? 'gem2' : 'gem'].push(gemObj, worldM(g.x, 0.4 + z * 0.12 + Math.sin(realTime * 4 + g.ph) * 0.1, g.z, realTime * (2 - z * 0.5) + g.ph, 1)); if (z === 2 && Math.random() < dt * 3) spark(g.x, 0.9, g.z, 0xffe07a, 1, 1, 0.3, 0.5, -1); }
  for (const id in RIGS) RIGS[id].end();
  shadowMesh.count = shN; shadowMesh.instanceMatrix.needsUpdate = true;
  // 法阵
  poolMeshes.forEach((m, i) => { const p = pools[i]; m.visible = !!p; if (!p) return; const grow = Math.min(1, ((p.max || 3) - p.life) * 5 + 0.2); m.position.set(p.x, 0.045, p.z); m.scale.setScalar(p.rad * grow); m.rotation.z -= dt * 6; m.material.color.set(p.zap ? 0x9fd0ff : 0xffffff); { const pc = EC('coffee'); if (pc != null) m.material.color.set(pc).lerp(WHITE_C, 0.35); } m.material.opacity = Math.min(0.9, p.life * 1.5);
    if (Math.random() < dt * 14) { const a = rnd(0, TAU), r = rnd(0.3, 1) * p.rad; spark(p.x + Math.cos(a) * r, 0.25, p.z + Math.sin(a) * r, ecRand('coffee') ?? (Math.random() < 0.5 ? 0xf2e0c0 : 0x8a5a2b), 1, 1.2, 0.36, 0.45, -3); }
    if (EC('coffee') != null && Math.random() < dt * 1.6) ringFx(p.x, p.z, p.rad, ecRand('coffee'), 0.5, 0.55); });
  STILL.etint = elT('coffee'); for (const c of cups) if (c.t >= 0) RIGS.cup.push(STILL, worldM(c.x0 + (c.x - c.x0) * c.t, 0.9 + Math.sin(c.t * PI) * 3, c.z0 + (c.z - c.z0) * c.t, c.t * 9, 1.3)); STILL.etint = null;
  // 火盆的火 + 漂浮的火星
  fireClock += dt;
  while (fireClock > 0.03) { fireClock -= 0.03; if (Math.random() < 0.25) emit(GLOW, camLook.x + rnd(-15, 15), rnd(0.5, 3), camLook.z + rnd(-15, 15), 0xfff1c8, 1, 0.15, 0.12, 3, -0.1, 1, 0.25); }
  stepParticles(PART, dt); stepParticles(GLOW, dt);
  let li = 0;
  for (const b of bolts) {
    b.life -= dt; const a = Math.max(0, b.life / b.max);
    for (let w = 0; w < (b.w || 1); w++) for (let s = 0; s < b.path.length - 1; s++) {
      const p0 = b.path[s], p1 = b.path[s + 1], seg = b.jit ? 6 : 1, oy = w * 0.03; let px = p0.x, py = p0.y + oy, pz = p0.z;
      for (let q = 1; q <= seg && li < LMAX - 2; q++) { const t = q / seg, j = q === seg ? 0 : b.jit; const nx = p0.x + (p1.x - p0.x) * t + rnd(-j, j), ny = p0.y + oy + (p1.y - p0.y) * t + rnd(-j, j) * 0.5, nz = p0.z + (p1.z - p0.z) * t + rnd(-j, j); lPos.set([px, py, pz, nx, ny, nz], li * 3); const r = b.color.r * a, g = b.color.g * a, bb = b.color.b * a; lCol.set([r, g, bb, r, g, bb], li * 3); li += 2; px = nx; py = ny; pz = nz; }
    }
  }
  bolts = bolts.filter((b) => b.life > 0); lGeo.setDrawRange(0, li); lGeo.attributes.position.needsUpdate = lGeo.attributes.color.needsUpdate = true;
  for (const r of rings) { if (r.t >= 1) { r.m.visible = false; continue; } r.t += dt / r.dur; const e = 1 - Math.pow(1 - Math.min(r.t, 1), 3); r.m.scale.setScalar(0.2 + e * r.rad); r.m.material.opacity = (1 - r.t) * r.op; }
  for (const s of slashes) { if (s.t >= 1.6) { s.m.visible = false; continue; } s.t += dt / s.dur; const u = s.m.material.uniforms; u.uProg.value = Math.min(1, s.t); u.uFade.value = s.t < 1 ? 1 : Math.max(0, 1 - (s.t - 1) / 0.6); s.m.position.set(player.x, 0.55, player.z); }
  fadeClock += dt; if (fadeClock > 0.4) { fadeClock = 0; mctx.globalCompositeOperation = 'destination-out'; mctx.fillStyle = 'rgba(0,0,0,.025)'; mctx.fillRect(0, 0, 1024, 1024); mctx.globalCompositeOperation = 'source-over'; marksDirty = true; }
  marksClock += dt; if (marksDirty && marksClock > 0.1) { markTex.needsUpdate = true; marksDirty = false; marksClock = 0; }
  const Wd = innerWidth, Hd = innerHeight;
  for (const nm of NUMS) { if (nm.life <= 0) continue; nm.life -= dt; nm.y += dt * 1.4; v3.set(nm.x, nm.y, nm.z).project(camera); const pop = nm.life > 0.55 ? 1 + (nm.life - 0.55) * 4 : 1; nm.el.style.transform = `translate(${(v3.x * 0.5 + 0.5) * Wd}px, ${(-v3.y * 0.5 + 0.5) * Hd}px) translate(-50%, -50%) scale(${pop})`; nm.el.style.opacity = Math.min(1, nm.life * 3); }
  // 镜头 + 火把光
  const shk = REDUCED ? 0 : shake;
  if (state === 'title') {
    camLook.set(TX, 0, TZ); const port = innerWidth < 860;
    if (titleStep === 'home') { tV.set(Math.sin(realTime * 0.15) * 0.8, port ? 6 : 3.0, port ? 29 : 12.5); tL.set(0, port ? 3.4 : 1.6, -1); }
    else if (!port) { tV.set(2.2, 2.4, 8); tL.set(2.2, 1.3, -1); } else { tV.set(0, 3, 20); tL.set(0, -2.0, -1); }
    tV.x += TX; tV.z += TZ; tL.x += TX; tL.z += TZ;
    if (titleStep === 'gacha') { tV.set(0.2 + rnd(-shk, shk) * 0.4, port ? 4.6 : 3.4, GZ + (port ? 19 : 11)); tL.set(port ? -0.4 : -0.4, port ? 1.3 : 1.8, GZ); if (gch.snap) { gch.snap = false; camPos.copy(tV); camTgt.copy(tL); } }
    const ck = Math.min(1, dt * 4); camPos.lerp(tV, ck); camTgt.lerp(tL, ck); camera.position.copy(camPos); camera.lookAt(camTgt);
    if (titleStep === 'gacha') torch.position.set(0.2, 4.6, GZ + 4); else torch.position.set(TX, 4.2, TZ + 4.5); sandMat.uniforms.uPlayer.value.set(TX, 0, TZ);
  } else if (skillDemoMode) {
    const closeRange = ['sweep', 'mop', 'spin', 'sock'].includes(demoSkill) &&
      !(demoForm === 'alt' && demoSkill === 'sweep') &&
      !(demoForm !== 'base' && demoSkill === 'sock');
    const targetX = DEMO_X + (closeRange ? .8 : 3.1);
    const zoom = Math.max(1, 1.65 / camera.aspect);
    const distance = closeRange && demoForm === 'base' ? .78 : 1;
    camera.position.set(targetX + 8 * zoom * distance, 13 * zoom * distance, DEMO_Z + 10 * zoom * distance);
    camera.lookAt(targetX, .8, DEMO_Z - .6);
    torch.position.set(player.x, 3.2, player.z);
    sandMat.uniforms.uPlayer.value.set(player.x, 0, player.z);
  } else {
    camLook.lerp(v3.set(player.x, 0, player.z), Math.min(1, dt * 6));
    const D = 17.5 * camK, H = 18.5 * camK;
    camera.position.set(camLook.x + Math.sin(AZ) * D + rnd(-shk, shk), H, camLook.z + Math.cos(AZ) * D + rnd(-shk, shk)); camera.lookAt(camLook.x, 0, camLook.z);
    torch.position.set(player.x, 3.2, player.z); sandMat.uniforms.uPlayer.value.set(player.x, 0, player.z);
  }
  torch.intensity = 8 * (0.92 + 0.08 * Math.sin(realTime * 11) * Math.sin(realTime * 7.3));
  shake = Math.max(0, shake - dt * 1.8); chroma = Math.max(0, chroma - dt * 2.2); hurt = Math.max(0, hurt - dt * 1.4); player.warn = Math.max(0, (player.warn || 0) - dt * 4.5); $('hurtFx').classList.toggle('low', state === 'play' && player.hp < player.maxHp * 0.3);
  finalPass.uniforms.uChroma.value = REDUCED ? chroma * 0.3 : chroma; finalPass.uniforms.uHurt.value = hurt;
  for (let i = 0; i < 6; i++) SCREEN_RIPS[i].z = sripStart[i] < 0 ? -1 : realTime - sripStart[i];
  if (state !== 'title' && !skillDemoMode) {
    $('hpFill').style.width = (player.hp / player.maxHp * 100) + '%'; $('hpText').textContent = Math.ceil(player.hp);
    $('xpFill').style.width = (player.xp / player.need * 100) + '%'; $('clock').textContent = fmt(T); $('wave').textContent = boss ? (boss.enraged ? '大魔王发怒' : '首领战') : nextEventText();
    if (hud.points !== meta.pts) { hud.points = meta.pts; $('score').textContent = meta.pts; bump($('scPill'), 'pop'); }
    if (hud.lv !== player.lvl) { hud.lv = player.lvl; $('lv').textContent = player.lvl; bump($('lvb'), 'pop'); }
    $('kills').textContent = player.kills; $('hpGhost').style.width = (player.hp / player.maxHp * 100) + '%'; $('pcard').classList.toggle('low', player.hp < player.maxHp * 0.3);
    if (boss) $('bossFill').style.width = (Math.max(0, boss.hp) / boss.maxHp * 100) + '%';
  }
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('banner').classList.remove('on'); }
}
const TITLE_TYPES = ['sleepy', 'cross', 'bat', 'clock', 'chalk', 'ink', 'ghost', 'mole', 'phone', 'snail', 'bomber', 'hourglass'];
function titleAmbience(dt) {
  if (enemies.length < TITLE_TYPES.length * 2) { const type = TITLE_TYPES[enemies.length % TITLE_TYPES.length]; const e = spawn(type, TX + rnd(-12, 12), TZ + rnd(-13, -6)); if (e) { e.spawn = 0; e.wt = 0; e.inv = e.under = false; e.up = 99; } }
  for (const e of enemies) {
    e.wt -= dt; if (e.wt <= 0) { e.wt = rnd(1.5, 4); e.tx = clamp(e.x + rnd(-4, 4), TX - 13, TX + 13); e.tz = clamp(e.z + rnd(-3, 3), TZ - 13.5, TZ - 5); }
    const dx = e.tx - e.x, dz = e.tz - e.z, d = Math.hypot(dx, dz);
    if (d > 0.2) { e.x += dx / d * e.spd * 0.5 * dt; e.z += dz / d * e.spd * 0.5 * dt; e.moving = 1; e.ph += e.spd * dt * 2; } else e.moving = 0;
    e.hit = Math.max(0, e.hit - dt * 5);
  }
}
let last = performance.now();
function frame(now) {
  const raw = Math.min(0.05, (now - last) / 1000); last = now;
  realTime += raw; uTime.value = realTime;
  const dt = raw * timeScale;
  if (skillDemoMode && !demoSkill) { requestAnimationFrame(frame); return; }
  if (skillDemoMode) {
    if (T >= (DEMO_DURATION[demoSkill] || 3.6)) resetSkillDemo();
    update(raw);
  } else {
    if (NET?.on && state !== 'title') netTick(raw);
    if (state === 'play' || (NET?.on && (state === 'levelup' || state === 'paused'))) update(dt); else if (state === 'title') { titleAmbience(raw); if (titleStep === 'gacha') updateGacha(raw); }
  }
  draw(skillDemoMode || state === 'play' || state === 'title' ? dt : raw * 0.12);
  composer.render(); requestAnimationFrame(frame);
}
window.__game = { get chests() { return chests; }, openChest2: openChest, SP, LVUP, WALLS, regionOf, inWall, HX, HZ, portalWave, PORTALS, get gems() { return gems; }, hurtPlayer, TIER, CLS_IDS, minuteEvent, spawnAltar, showArts, get altars() { return altars; }, get drops() { return drops; }, infuse(id) { pendingInfuse.push(id); showInfuse(); },
  get state() { return state; }, startRun, setDiff(d) { diffId = d; }, setMode(m) { modeId = m; }, unlockAll() { meta.heroes = [...CLS_IDS]; meta.arts = Object.keys(ARTS); meta.relics = Object.keys(RELICS); }, meta, showCodex, settle, get cups() { return cups; }, get pools() { return pools; }, get bolts() { return bolts; }, startTask, get task() { return task; }, get enemies() { return enemies; }, spawn, upgradeOptions, get boss() { return boss; }, get T() { return T; }, set T(v) { T = v; }, player, applyUpgrade, showTitle,
  pick(i) { pickHero(i); }, get NET() { return NET; }, netLobby, renderLobby, ACH, SKINS, ALT, gch, showUltPick, get pendingUlt() { return pendingUlt; }, openGacha, gachaStart, gachaPull, showAch, checkAch, get run() { return run; }, renderHome, renderGacha, showLevelUp, showWin, showDeath, openChest, get step_() { return titleStep; },
  step(s) { for (let k = 0; k < s * 30; k++) { update(1 / 30); realTime += 1 / 30; uTime.value = realTime; draw(1 / 30); if (state !== 'play') break; } },
};
function useGameAccount(account) {
  const accountKey = encodeURIComponent(account);
  META_KEY = `${SAVE_PREFIX}.meta:${accountKey}`;
  BEST_KEY = `${SAVE_PREFIX}.best:${accountKey}`;
}

function loadGameSave() {
  loadMeta();
  migrateGrowth();
  loadBestEndless();
}

async function syncPracticePoints() {
  const headers = new Headers();
  if (expectedGameAccount) {
    headers.set('X-Syntara-User', expectedGameAccount);
    useGameAccount(expectedGameAccount);
  }
  let data;
  try {
    const response = await fetch(practicePointsUrl, { headers, signal: AbortSignal.timeout(8000) });
    if (response.status === 401 && !expectedGameAccount) {
      loadGameSave();
      return 0;
    }
    if (!response.ok) throw new Error('积分同步失败');
    ({ data } = await response.json());
  } catch (error) {
    loadGameSave();
    throw error;
  }
  headers.set('X-Syntara-User', data.account);
  useGameAccount(data.account);

  const transfer = async () => {
    if (!localStorage.getItem(META_KEY)) {
      const ownerKey = `${SAVE_PREFIX}.legacyAccount`;
      const previousOwner = localStorage.getItem(ownerKey);
      if (!previousOwner || previousOwner === data.account) {
        const oldSave = localStorage.getItem(`${SAVE_PREFIX}.meta`);
        const oldBest = localStorage.getItem(`${SAVE_PREFIX}.best`);
        if (oldSave || oldBest) localStorage.setItem(ownerKey, data.account);
        if (oldSave) localStorage.setItem(META_KEY, oldSave);
        if (oldBest) localStorage.setItem(BEST_KEY, oldBest);
      }
    }
    loadGameSave();
    if (!data.balance && !meta.practiceTransfer) return 0;

    // Save the transfer ID before the request. A lost response can be retried with the same ID.
    const id = meta.practiceTransfer || crypto.randomUUID();
    meta.practiceTransfer = id;
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    headers.set('Content-Type', 'application/json');
    const claimed = await fetch(practicePointsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(8000),
    });
    if (!claimed.ok) throw new Error('积分同步失败');
    const { data: { points } } = await claimed.json();
    const updated = { ...meta, pts: meta.pts + points, practiceTransfer: '' };
    localStorage.setItem(META_KEY, JSON.stringify(updated));
    Object.assign(meta, updated);
    return points;
  };
  return navigator.locks ? navigator.locks.request(META_KEY, transfer) : transfer();
}

if (hostedGame) {
  syncPracticePoints().then((points) => {
    showTitle();
    if (points) banner(`做题积分 +${points}`, `当前有 ${meta.pts} 积分`);
  }).catch(() => {
    showTitle();
    banner('做题积分同步失败', '重新进入游戏后重试');
  });
} else if (!skillDemoMode) showTitle();
requestAnimationFrame(frame);
