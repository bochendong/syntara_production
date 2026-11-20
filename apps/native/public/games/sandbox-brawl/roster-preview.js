import { CLASSES } from './classmates.js';
import { ALT, BOSSES, WEAPONS } from './combat-catalog.js';
import { campusMatchHalfHeight } from './campus-map-plan.js?v=match-camera';
import { createGameAudio } from './game-audio.js?v=pickup-audio';
import { studentIcon } from './student-chibi.js?v=hit-feel';
import { ROSTER_MONSTERS } from './roster-match-art.js';
import { createRosterActions } from './roster-actions.js?v=workbench';
import {
  ROSTER_COMBINATIONS, ROSTER_FORMS, rosterArenaSide, rosterBossSkillLabel,
  rosterEncounter, rosterSkillLabel,
} from './roster-match-config.js?v=workbench';

const get = (id) => document.getElementById(id);
const stage = get('stage');
const arena = get('arena');
const status = get('status');
const retry = get('retry');
const search = get('search');
const pause = get('pause');
const replay = get('replay');
const camera = get('camera');
const form = get('form');
const bossMove = get('boss-move');
const sound = get('sound');
const speed = get('speed');
const activeSkill = get('active-skill');
const selectionName = get('selection-name');
const selectionOpponent = get('selection-opponent');
const audio = createGameAudio({ effectsOnly: true });
const combatSounds = new Set(['hit', 'crit', 'kill', 'bigKill', 'hurt', 'down']);
const monsterMoves = {
  sleepy: '贴身伤害 · 打盹', bat: '摆动追击', bomber: '倒计时自爆', chalk: '瞄准射击',
  cross: '贴身伤害', mole: '钻地突袭', clock: '铃声冲刺', ink: '贴身伤害 · 分裂',
  ghost: '远程纸团', phone: '分心减速', snail: '贴身伤害', hourglass: '贴身伤害',
};

let selected, iframe, actions;
let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let soundEnabled = false;

function send(changes) {
  iframe?.contentWindow?.postMessage({ type: 'sandbox-brawl:roster-control', ...changes }, location.origin);
}

function formsFor(skill) {
  return ROSTER_FORMS.filter((value) => value !== 'alt' || ALT[skill]);
}

function currentForm() {
  if (!selected?.spec.hero) return 'base';
  const forms = formsFor(selected.spec.skill);
  return selected.form === 'cycle' ? forms[selected.formIndex % forms.length] : selected.form;
}

function currentAttack() {
  return !selected?.spec.boss || selected.attack === 'auto' ? null : Number(selected.attack);
}

function syncMatch(changes = {}) {
  send({
    playing, audible: soundEnabled && playing && !document.hidden,
    form: currentForm(), attack: currentAttack(), rate: Number(speed.value),
    detail: camera.value === 'close', closeUp: camera.value === 'close',
    ...changes,
  });
}

function layoutArena(center = false) {
  if (!selected) return;
  const side = rosterArenaSide(selected.spec, currentForm());
  const scale = innerHeight / (2 * campusMatchHalfHeight(innerWidth / innerHeight));
  const fullSize = side * scale;
  const fitSize = Math.min(stage.clientWidth, stage.clientHeight) - 4;
  const size = camera.value === 'match' ? fullSize
    : camera.value === 'full' ? Math.min(fullSize, fitSize) : fitSize;
  arena.style.setProperty('--arena-size', `${Math.max(0, size)}px`);
  if (center) {
    stage.scrollTo((stage.scrollWidth - stage.clientWidth) / 2,
      (stage.scrollHeight - stage.clientHeight) / 2);
  }
}

function updateSkill() {
  if (selected.spec.hero) activeSkill.textContent = rosterSkillLabel(selected.spec.skill, currentForm());
  else if (selected.spec.boss) activeSkill.textContent = selected.moves[currentAttack()] ?? '技能轮播';
  else activeSkill.textContent = selected.moves[0];
}

function configureSkills() {
  const { spec, moves } = selected;
  form.hidden = !spec.hero;
  bossMove.hidden = !spec.boss;
  if (spec.hero) {
    const skill = spec.skill;
    const options = [
      new Option(`基础 · ${WEAPONS[skill].name}`, 'base'),
      new Option(`终极 · ${WEAPONS[skill].evo.name}`, 'evo'),
    ];
    if (ALT[skill]) options.push(new Option(`第二终极 · ${ALT[skill].name}`, 'alt'));
    options.push(new Option('护盾与闪避', 'guard'), new Option('技能自动轮播', 'cycle'));
    const elements = document.createElement('optgroup');
    elements.label = '单元素';
    for (const [key, name] of Object.entries({ fire: '火 · 灼烧', ice: '冰 · 冰缓', acid: '酸 · 腐蚀', elec: '电 · 感电' })) {
      elements.append(new Option(name, key));
    }
    const dual = document.createElement('optgroup');
    dual.label = '双元素';
    for (const [key, name] of Object.entries(ROSTER_COMBINATIONS)) dual.append(new Option(name, key));
    form.replaceChildren(...options, elements, dual);
    form.value = selected.form;
  } else if (spec.boss) {
    bossMove.replaceChildren(new Option('技能轮播', 'auto'), ...moves.map((move, index) => new Option(move, index)));
    bossMove.value = selected.attack;
  }
  updateSkill();
}

function loadMatch() {
  replay.disabled = true;
  retry.hidden = true;
  status.hidden = false;
  status.textContent = '正在加载实战…';
  arena.classList.remove('is-ready');
  const url = new URL('./index.html', location.href);
  url.searchParams.set('roster-match', '1');
  url.searchParams.set('v', 'target-no-flash');
  url.searchParams.set(selected.spec.hero ? 'hero' : 'monster', selected.id);
  url.searchParams.set('form', currentForm());
  url.searchParams.set('paused', '1');
  iframe = document.createElement('iframe');
  iframe.className = 'match-engine';
  iframe.title = `${selected.name}实战`;
  iframe.src = url.href;
  arena.replaceChildren(iframe);
  layoutArena(true);
}

function selectEntry(entry) {
  const move = entry.matchIndex;
  if (move >= 0) {
    if (entry.spec.hero) {
      entry.form = ['base', 'evo', 'alt'][move];
      entry.formIndex = 0;
    }
    if (entry.spec.boss) entry.attack = String(move);
  }
  if (selected === entry) {
    configureSkills();
    layoutArena(true);
    syncMatch();
    return;
  }
  selected?.button.removeAttribute('aria-current');
  selected = entry;
  selected.button.setAttribute('aria-current', 'true');
  selectionName.textContent = selected.name;
  selectionOpponent.textContent = selected.spec.hero ? `对战 ${ROSTER_MONSTERS[selected.spec.monster].name}` : '对练习靶出招';
  const showActions = !!selected.spec.hero;
  get('action-roster').hidden = !showActions;
  get('workspace-panels').classList.toggle('with-actions', showActions);
  if (showActions) actions.setHero(selected.id);
  actions.setVisible(showActions);
  configureSkills();
  loadMatch();
}

function makeEntry(id, spec, atlas) {
  const name = spec.hero ? spec.hero.name : ROSTER_MONSTERS[id].name;
  const boss = BOSSES[id];
  const moves = spec.hero ? [WEAPONS[spec.skill].name, WEAPONS[spec.skill].evo.name, ALT[spec.skill]?.name].filter(Boolean)
    : boss ? [...boss.atk, boss.wide].map((move) => rosterBossSkillLabel(id, move)) : [monsterMoves[id]];
  const subtitle = boss ? `首领 · ${moves.length} 招` : moves[0];
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'catalog-item';
  let portrait;
  if (spec.hero) {
    portrait = document.createElement('img');
    portrait.alt = '';
    portrait.loading = 'lazy';
    portrait.src = studentIcon(spec.hero.look);
  } else {
    portrait = document.createElement('canvas');
    portrait.width = portrait.height = 68;
    portrait.setAttribute('aria-hidden', 'true');
    const [left, top, right, bottom] = ROSTER_MONSTERS[id].crop;
    const width = right - left, height = bottom - top;
    const resize = 62 / Math.max(width, height);
    portrait.getContext('2d').drawImage(atlas, left, top, width, height,
      (68 - width * resize) / 2, (68 - height * resize) / 2, width * resize, height * resize);
  }
  const description = document.createElement('span');
  const label = document.createElement('strong');
  label.textContent = name;
  const skill = document.createElement('small');
  skill.textContent = subtitle;
  description.append(label, skill);
  button.append(portrait, description);
  const entry = {
    id, spec, name, moves, button, subtitle, skill,
    form: 'base', formIndex: 0, attack: 'auto', matchIndex: -1,
  };
  button.addEventListener('click', () => selectEntry(entry));
  return entry;
}

function setPlayback(value) {
  playing = value;
  pause.textContent = playing ? '暂停' : '继续';
  actions.setPlaying(playing);
  syncMatch();
}

async function openWorkbench() {
  const atlas = new Image();
  atlas.src = new URL('./monster-art.png', import.meta.url).href;
  await atlas.decode();
  const heroes = Object.entries(CLASSES).map(([id, hero]) => makeEntry(id, rosterEncounter(hero), atlas));
  const monsters = Object.keys(ROSTER_MONSTERS).map((id) => makeEntry(id, rosterEncounter(null, id), atlas));
  get('hero-list').append(...heroes.map((entry) => entry.button));
  get('monster-list').append(...monsters.map((entry) => entry.button));
  actions = createRosterActions(CLASSES);
  actions.setPlaying(playing);
  pause.textContent = playing ? '暂停' : '继续';

  addEventListener('message', ({ source, origin, data }) => {
    if (origin !== location.origin || !iframe || source !== iframe.contentWindow || data?.type !== 'sandbox-brawl:roster-event') return;
    if (data.event === 'ready') {
      arena.classList.add('is-ready');
      status.hidden = true;
      replay.disabled = false;
      syncMatch();
    } else if (data.event === 'attack' && typeof data.label === 'string') {
      activeSkill.textContent = data.label;
    } else if (data.event === 'round' && selected.spec.hero && selected.form === 'cycle') {
      selected.formIndex++;
      updateSkill();
      layoutArena(true);
      syncMatch();
    } else if (data.event === 'sound' && soundEnabled && playing && combatSounds.has(data.name)) {
      audio.play(data.name);
    } else if (data.event === 'error') {
      iframe.remove();
      iframe = null;
      status.textContent = '实战画面加载失败。';
      status.hidden = retry.hidden = false;
      replay.disabled = true;
    }
  });

  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    for (const entry of [...heroes, ...monsters]) {
      entry.matchIndex = query ? entry.moves.findIndex((move) => move.toLowerCase().includes(query)) : -1;
      entry.button.hidden = !!query && !entry.name.toLowerCase().includes(query) && entry.matchIndex < 0;
      entry.skill.textContent = entry.moves[entry.matchIndex] ?? entry.subtitle;
    }
    get('hero-group').hidden = heroes.every((entry) => entry.button.hidden);
    get('monster-group').hidden = monsters.every((entry) => entry.button.hidden);
    get('empty-search').hidden = !get('hero-group').hidden || !get('monster-group').hidden;
  });

  form.addEventListener('change', () => {
    selected.form = form.value;
    selected.formIndex = 0;
    updateSkill();
    layoutArena(true);
    syncMatch({ replay: true });
  });
  bossMove.addEventListener('change', () => {
    selected.attack = bossMove.value;
    updateSkill();
    syncMatch();
  });
  camera.addEventListener('change', () => { layoutArena(true); syncMatch(); });
  speed.addEventListener('change', () => { actions.setRate(Number(speed.value)); syncMatch(); });
  replay.addEventListener('click', () => { setPlayback(true); syncMatch({ replay: true }); });
  get('action-replay').addEventListener('click', () => { if (!playing) setPlayback(true); });
  pause.addEventListener('click', () => setPlayback(!playing));
  sound.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    if (soundEnabled) audio.unlock();
    audio.setHidden(!soundEnabled || document.hidden);
    sound.setAttribute('aria-pressed', String(soundEnabled));
    sound.textContent = soundEnabled ? '静音' : '开启音效';
    syncMatch();
  });
  document.addEventListener('visibilitychange', () => {
    audio.setHidden(!soundEnabled || document.hidden);
    syncMatch();
  });
  retry.addEventListener('click', loadMatch);
  new ResizeObserver(() => layoutArena()).observe(stage);
  addEventListener('resize', () => layoutArena(true));
  search.disabled = form.disabled = camera.disabled = speed.disabled = pause.disabled = sound.disabled = false;
  selectEntry(heroes[0]);
}

openWorkbench().catch((error) => {
  console.error(error);
  status.hidden = false;
  status.textContent = '预览素材加载失败，刷新可重试。';
});
