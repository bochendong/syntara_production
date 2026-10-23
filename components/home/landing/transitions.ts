/**
 * Marble-driven transitions between story screens, drawn on one overlay
 * canvas. Every frame is a pure function of scroll progress `e` (0..1), so
 * scrubbing backwards plays the same motion in reverse.
 */

import { drawMarble, MARBLE_PALETTE, type MarblePalette } from './hero-canvas';
import { LANDING_MARBLE_ART } from './marble-art';

export type TransitionKind = 'galaxy' | 'lens' | 'roll' | 'pixel' | 'rain' | 'vortex';

/** Where the incoming screen switches on for transitions that cover the whole stage. */
export const COVER_SWITCH = 0.5;
/** The rain pile reaches the top a little later. */
export const RAIN_SWITCH = 0.56;

type ArtName = keyof typeof LANDING_MARBLE_ART;
const ART_NAMES = Object.keys(LANDING_MARBLE_ART) as ArtName[];
const FALLBACK: MarblePalette[] = Object.values(MARBLE_PALETTE);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeIn = (v: number) => v * v * v;
const easeOut = (v: number) => 1 - Math.pow(1 - v, 3);
function bounceOut(x: number) {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}
/** Stable pseudo-random number in [0, 1) for an integer seed. */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function createMarbleSprites(onLoad: () => void) {
  const images = new Map<ArtName, HTMLImageElement>();
  for (const name of ART_NAMES) {
    const img = new Image();
    img.onload = onLoad;
    img.src = LANDING_MARBLE_ART[name].src;
    images.set(name, img);
  }
  const ready = (img: HTMLImageElement | undefined) => !!img?.complete && !!img.naturalWidth;

  return {
    dispose() {
      for (const img of images.values()) img.onload = null;
      images.clear();
    },
    /** Draw marble art `name` (or `seed`-picked art) centred at x, y with visible radius r. */
    draw(
      ctx: CanvasRenderingContext2D,
      art: ArtName | number,
      x: number,
      y: number,
      r: number,
      rot = 0,
      alpha = 1,
    ) {
      if (r < 0.5 || alpha <= 0) return;
      const name =
        typeof art === 'number' ? ART_NAMES[Math.floor(hash(art) * ART_NAMES.length)] : art;
      const img = images.get(name);
      if (!ready(img)) {
        const seed = typeof art === 'number' ? art : ART_NAMES.indexOf(name);
        drawMarble(ctx, x, y, r, FALLBACK[seed % FALLBACK.length], rot, alpha);
        return;
      }
      // Artwork has 5% transparent padding on each side.
      const size = (r * 2) / 0.9;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      if (rot) ctx.rotate(rot);
      ctx.drawImage(img!, -size / 2, -size / 2, size, size);
      ctx.restore();
    },
  };
}

export type MarbleSprites = ReturnType<typeof createMarbleSprites>;

type Stage = { ctx: CanvasRenderingContext2D; w: number; h: number; sprites: MarbleSprites };

/** A giant marble rolls across the stage; the next screen is revealed behind it. Returns the wipe edge x. */
export function drawRoll({ ctx, w, h, sprites }: Stage, e: number) {
  const R = Math.min(h * 0.34, w * 0.42);
  const x = -R + e * (w + 2 * R);
  const y = h * 0.52;
  // Glow along the wipe edge.
  const edge = ctx.createLinearGradient(x - R * 2.2, 0, x, 0);
  edge.addColorStop(0, 'rgba(165,139,255,0)');
  edge.addColorStop(1, 'rgba(165,139,255,.55)');
  ctx.fillStyle = edge;
  ctx.fillRect(x - R * 2.2, 0, R * 2.2, h);
  // Floor shadow.
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.filter = `blur(${R * 0.08}px)`;
  ctx.beginPath();
  ctx.ellipse(x, y + R * 0.98, R * 0.85, R * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Little marbles kicked up behind it.
  for (let i = 0; i < 14; i++) {
    const lag = 0.6 + hash(i) * 2.2;
    const bx = x - R * lag;
    const hop = Math.abs(Math.sin(e * 9 + i * 1.7));
    const by = y + R * 0.95 - hop * R * (0.3 + hash(i + 40) * 0.5) - R * 0.06;
    sprites.draw(ctx, i + 3, bx, by, R * (0.06 + hash(i + 9) * 0.06), e * 20, 1);
  }
  sprites.draw(ctx, 'purple', x, y, R, x / R);
  return x;
}

/** The stage fills with marbles from the centre out, then they pop away from the centre out. */
export function drawPixel({ ctx, w, h, sprites }: Stage, e: number) {
  const cell = Math.max(w, h) / 11;
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;
  const ox = (w - (cols - 1) * cell) / 2;
  const oy = (h - (rows - 1) * cell) / 2;
  const far = Math.hypot(w / 2, h / 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = ox + c * cell;
      const y = oy + r * cell;
      const d = Math.hypot(x - w / 2, y - h / 2) / far;
      const seed = r * 31 + c * 7;
      const jitter = hash(seed) * 0.06;
      const grow = clamp01((e - d * 0.18 - jitter) / 0.24);
      const shrink = clamp01((e - COVER_SWITCH - d * 0.18 - jitter) / 0.26);
      const s = easeOut(grow) * (1 - easeIn(shrink));
      if (s <= 0) continue;
      const pop = shrink > 0 ? 1 + shrink * 0.5 : 1;
      sprites.draw(
        ctx,
        seed,
        x,
        y - shrink * cell * 0.6,
        cell * 0.78 * s * pop,
        hash(seed + 3) * 6 + e * 3,
      );
    }
  }
}

/** Marbles pour in and pile up to the top, then the floor gives way and they fall out. */
export function drawRain({ ctx, w, h, sprites }: Stage, e: number) {
  const R = Math.max(w, h) / 22;
  const colStep = R * 2 * 0.87;
  const cols = Math.ceil(w / colStep) + 2;
  const rows = Math.ceil(h / (R * 2)) + 2;
  const backdrop = clamp01((e - 0.32) / 0.16) * (1 - clamp01((e - 0.62) / 0.14));
  if (backdrop > 0) {
    ctx.fillStyle = `rgba(20,14,36,${backdrop * 0.92})`;
    ctx.fillRect(0, 0, w, h);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const seed = r * 53 + c * 19;
      const x = -R * 0.5 + c * colStep + (hash(seed + 5) - 0.5) * R * 0.12;
      const target = h - R - r * R * 2 - (c % 2 ? R : 0);
      const start = (r / rows) * 0.3 + hash(seed) * 0.1;
      const f = clamp01((e - start) / 0.13);
      if (f <= 0) continue;
      let y =
        -R * 2 -
        hash(seed + 1) * h * 0.4 +
        (target + R * 2 + hash(seed + 1) * h * 0.4) * bounceOut(f);
      const drain = clamp01((e - 0.6 - hash(c + 99) * 0.12) / 0.26);
      y += drain * drain * (h * 2.2);
      const spin = (1 - f) * 4 + drain * 5 + hash(seed + 2) * 6;
      sprites.draw(ctx, seed, x, y, R, spin);
    }
  }
}

/** Marbles spiral into the centre with the old screen, flash, then burst out with the new one. */
export function drawVortex({ ctx, w, h, sprites }: Stage, e: number) {
  const cx = w / 2;
  const cy = h / 2;
  const far = Math.hypot(cx, cy);
  const R0 = Math.max(w, h) / 30;
  for (let i = 0; i < 80; i++) {
    const a0 = hash(i) * Math.PI * 2;
    const r0 = far * (0.45 + hash(i + 1) * 0.75);
    let r: number;
    let a: number;
    let alpha: number;
    let size: number;
    if (e < COVER_SWITCH) {
      const k = e / COVER_SWITCH;
      r = r0 * (1 - easeIn(k));
      a = a0 + k * (3 + hash(i + 2) * 3);
      alpha = clamp01(k * 5);
      size = R0 * (0.5 + hash(i + 3)) * (0.35 + 0.65 * (1 - k));
    } else {
      const k = (e - COVER_SWITCH) / (1 - COVER_SWITCH);
      r = far * easeOut(k) * (0.5 + hash(i + 4) * 0.8);
      a = a0 + 3 + k * 1.5;
      alpha = 1 - k;
      size = R0 * (0.5 + hash(i + 3)) * (0.5 + k);
    }
    sprites.draw(ctx, i, cx + Math.cos(a) * r, cy + Math.sin(a) * r, size, a, alpha);
  }
  const flash = 1 - Math.abs(e - COVER_SWITCH) / 0.14;
  if (flash > 0) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, far * 0.6);
    g.addColorStop(0, `rgba(255,255,255,${flash})`);
    g.addColorStop(0.3, `rgba(111,213,154,${flash * 0.6})`);
    g.addColorStop(1, 'rgba(111,213,154,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
