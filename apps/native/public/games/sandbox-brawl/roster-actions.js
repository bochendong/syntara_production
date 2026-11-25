import * as THREE from './vendor/three.module.js';
import { CHIBI_CELL, poseChibi, studentTexture } from './student-chibi.js?v=ghost-grey';

const clips = {
  attack: { name: '蓄力 → 挥出 → 收招', length: 0.86 },
  hurt: { name: '受击后仰', length: 1 },
  recover: { name: '倒地 → 起身', length: 2.5 },
  wave: { name: '挥手', length: 2.1 },
  cheer: { name: '跳起来欢呼', length: 1.9 },
  stretch: { name: '伸懒腰', length: 2.2 },
  look: { name: '东张西望', length: 2.65 },
  flourish: { name: '耍武器', length: 1.7 },
  swing: { name: '挥武器后得意', length: 1.8 },
  startle: { name: '吓一跳', length: 1.5 },
};

const poses = {
  windup: ['蓄力', 'attack'], strike: ['挥出', 'attack'],
  follow: ['收招', 'attack'], hurt: ['受击', 'hurt'],
  down: ['倒地', 'recover'], cheer: ['欢呼', 'cheer'],
  wave1: ['挥手一', 'wave'], wave2: ['挥手二', 'wave'],
  lookL: ['向左看', 'look'], lookR: ['向右看', 'look'],
  stretch: ['伸懒腰', 'stretch'], crouch: ['屈膝', 'recover'],
  air: ['跳起', 'cheer'], flourish: ['耍武器', 'flourish'],
  proud: ['得意', 'swing'], startle: ['吓一跳', 'startle'],
};

function actorAt(clip, time) {
  const start = 0.12;
  if (time < start) return {};
  if (clip === 'attack') return { atkAt: start, atkFaceLeft: false };
  if (clip === 'hurt') return { hurtAt: start };
  if (clip === 'recover') {
    const riseAt = start + 1.25;
    return time < riseAt ? { downAt: start } : { riseAt };
  }
  return { act: clip, actAt: start };
}

export function createRosterActions(classes) {
  const clip = document.getElementById('action-clip');
  const replay = document.getElementById('action-replay');
  const caption = document.getElementById('action-caption');
  const grid = document.getElementById('pose-grid');
  const canvas = document.getElementById('action-canvas');
  const context = canvas.getContext('2d');
  const world = new THREE.Matrix4();
  const camera = { quaternion: new THREE.Quaternion() };
  const matrix = new THREE.Matrix4();
  const cell = new THREE.BufferAttribute(new Float32Array(3), 3);
  const screenSize = 305;
  const worldToPixels = screenSize / 2.12;
  let heroId = Object.keys(classes)[0];
  let visible = false, playing = true, rate = 1;
  let frame = 0, fixedPose = 'windup', last = null, elapsed = 0;

  for (const [id, { name }] of Object.entries(clips)) clip.add(new Option(name, id));

  function drawCell(ctx, col, row, x, y, size) {
    const { image, repeat } = studentTexture(classes[heroId].look);
    const tile = image.width * repeat.x;
    ctx.drawImage(image, col * tile, row * tile, tile, tile, x, y, size, size);
  }

  const buttons = new Map();
  for (const [id, [name, animation]] of Object.entries(poses)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    const thumb = document.createElement('canvas');
    thumb.width = thumb.height = 128;
    thumb.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = name;
    button.append(thumb, label);
    button.addEventListener('click', () => {
      clip.value = animation;
      fixedPose = id;
      cancelAnimationFrame(frame);
      frame = 0;
      updateSelection();
      render();
    });
    buttons.set(id, { button, thumb });
    grid.append(button);
  }

  function refreshThumbnails() {
    for (const [id, { thumb }] of buttons) {
      const ctx = thumb.getContext('2d');
      ctx.clearRect(0, 0, thumb.width, thumb.height);
      drawCell(ctx, ...CHIBI_CELL[id], 0, 0, thumb.width);
    }
  }

  function updateSelection() {
    for (const [id, { button }] of buttons) button.setAttribute('aria-pressed', String(id === fixedPose));
    const actionName = fixedPose ? poses[fixedPose][0] : clips[clip.value].name;
    caption.textContent = actionName;
    replay.textContent = fixedPose ? '播放动作' : '重播动作';
  }

  function render() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const center = canvas.width / 2;
    const floor = canvas.height - 170;
    context.fillStyle = '#59425729';
    context.beginPath();
    context.ellipse(center, floor, 72, 11, 0, 0, Math.PI * 2);
    context.fill();
    const top = -232 / 256 * screenSize;
    if (fixedPose && fixedPose !== 'down') {
      drawCell(context, ...CHIBI_CELL[fixedPose], center - screenSize / 2, floor + top, screenSize);
      return;
    }
    const time = fixedPose === 'down' ? 0.9 : elapsed % clips[clip.value].length;
    poseChibi(matrix, cell, 0, world, camera, actorAt(clip.value, time), time);
    const m = matrix.elements;
    const mirror = cell.getZ(0) ? -1 : 1;
    const { repeat } = studentTexture(classes[heroId].look);
    const col = Math.round(cell.getX(0) / repeat.x);
    const row = Math.round(-cell.getY(0) / repeat.y);
    context.save();
    // Convert the game renderer's camera-facing matrix to canvas coordinates.
    context.transform(m[0] * mirror, -m[1] * mirror, -m[4], m[5],
      center + m[12] * worldToPixels, floor - m[13] * worldToPixels);
    drawCell(context, col, row, -screenSize / 2, top, screenSize);
    context.restore();
  }

  function tick(now) {
    if (last !== null) elapsed += Math.min(50, now - last) / 1000 * rate;
    last = now;
    render();
    frame = requestAnimationFrame(tick);
  }

  function syncPlayback() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = null;
    if (visible && playing && !fixedPose) frame = requestAnimationFrame(tick);
  }

  function start() {
    fixedPose = null;
    elapsed = 0;
    updateSelection();
    render();
    syncPlayback();
  }

  clip.addEventListener('change', start);
  replay.addEventListener('click', start);
  refreshThumbnails();
  updateSelection();
  render();

  return {
    setHero(id) {
      if (heroId === id) return;
      heroId = id;
      elapsed = 0;
      refreshThumbnails();
      render();
    },
    setVisible(value) {
      if (visible === value) return;
      visible = value;
      syncPlayback();
    },
    setPlaying(value) {
      playing = value;
      syncPlayback();
    },
    setRate(value) {
      rate = value;
    },
  };
}
