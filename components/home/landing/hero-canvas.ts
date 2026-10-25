/**
 * Canvas drawing for the landing hero: the memory galaxy (course orb, chapter
 * orbs, memory marbles) and the hero title.
 * Galaxy marbles use the native app's transparent artwork as camera-facing
 * sprites. The procedural glass is only a fallback while artwork is loading.
 */

import { LANDING_MARBLE_ART } from './marble-art';

export type MarblePalette = readonly [base: string, light: string, deep: string];

export const MARBLE_PALETTE = {
  pink: ['#f58fb0', '#ffd3e1', '#b44a72'],
  amber: ['#f5b94a', '#ffe6ad', '#b5791a'],
  blue: ['#6fa8ff', '#cfe2ff', '#2f5fc0'],
  green: ['#6fd59a', '#cff5df', '#2b8f58'],
  purple: ['#a58bff', '#e0d6ff', '#5d43c4'],
} as const satisfies Record<string, MarblePalette>;

const PALETTE_LIST: MarblePalette[] = Object.values(MARBLE_PALETTE);
const COURSE_ORB: MarblePalette = ['#7a62e6', '#d9ccff', '#2c1f7a'];

export function drawMarble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  p: MarblePalette,
  rot: number,
  alpha = 1,
) {
  if (r < 0.6) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, p[1]);
  g.addColorStop(0.55, p[0]);
  g.addColorStop(1, p[2]);
  ctx.fillStyle = g;
  ctx.fill();
  if (r > 5) {
    ctx.save();
    ctx.clip();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.strokeStyle = p[1];
    ctx.globalAlpha = alpha * 0.55;
    ctx.lineWidth = r * 0.22;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.8, r * 0.2);
    ctx.bezierCurveTo(-r * 0.2, -r * 0.6, r * 0.2, r * 0.6, r * 0.8, -r * 0.2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = alpha;
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.strokeStyle = 'rgba(18,16,40,.85)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.36, y - r * 0.4, r * 0.26, r * 0.14, -0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - r * 0.05, y - r * 0.6, r * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function seeded(seed: number) {
  let x = seed;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
}

export type HeroLayout = {
  w: number;
  h: number;
  /** Galaxy centre and scale in CSS px. */
  gx: number;
  gy: number;
  gs: number;
  /** Title block. */
  tx: number;
  ty: number;
  fontSize: number;
};

export function computeHeroLayout(w: number, h: number): HeroLayout {
  if (w >= 900) {
    const fontSize = Math.min(w * 0.072, h * 0.13, 112);
    return {
      w,
      h,
      gx: w * 0.68,
      gy: h * 0.5,
      gs: Math.min(w, h) * 0.36,
      tx: Math.max(32, w * 0.07),
      ty: h * 0.36,
      fontSize,
    };
  }
  const fontSize = Math.min(w * 0.14, 64);
  return {
    w,
    h,
    gx: w * 0.5,
    gy: h * 0.8,
    gs: Math.min(w * 0.38, h * 0.2),
    tx: 24,
    ty: h * 0.13,
    fontSize,
  };
}

type Chapter = { a: number; sp: number; inc: number; p: MarblePalette };
type Memory = {
  c: number;
  a: number;
  r: number;
  sp: number;
  inc: number;
  p: MarblePalette;
  sz: number;
  rot: number;
};

export function createGalaxy(onTextureLoad: () => void) {
  const textures = new Map<MarblePalette, HTMLImageElement>();
  for (const [palette, art] of [
    [MARBLE_PALETTE.pink, LANDING_MARBLE_ART.pink],
    [MARBLE_PALETTE.amber, LANDING_MARBLE_ART.amber],
    [MARBLE_PALETTE.blue, LANDING_MARBLE_ART.blue],
    [MARBLE_PALETTE.green, LANDING_MARBLE_ART.green],
    [MARBLE_PALETTE.purple, LANDING_MARBLE_ART.purple],
    [COURSE_ORB, LANDING_MARBLE_ART.cosmos],
  ] as const) {
    const image = new Image();
    image.onload = onTextureLoad;
    image.src = art.src;
    textures.set(palette, image);
  }

  const drawOrb: typeof drawMarble = (ctx, x, y, r, palette, rot, alpha = 1) => {
    if (r < 0.6) return;
    const image = textures.get(palette);
    if (!image?.complete || !image.naturalWidth) {
      drawMarble(ctx, x, y, r, palette, rot, alpha);
      return;
    }
    // Artwork has 5% transparent padding per side; keep the visible orb radius.
    // Keep its painted highlight facing the camera as the galaxy turns.
    const size = (r * 2) / 0.9;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
    ctx.restore();
  };

  const rnd = seeded(11);
  const stars = Array.from({ length: 160 }, () => [rnd(), rnd(), rnd() * 1.2 + 0.2, rnd() * 6]);
  const chapters: Chapter[] = PALETTE_LIST.map((p, i) => ({
    a: (i / 5) * Math.PI * 2,
    sp: 0.12,
    inc: i % 2 ? 0.18 : -0.12,
    p,
  }));
  const memories: Memory[] = Array.from({ length: 80 }, (_, i) => {
    const c = i % 5;
    return {
      c,
      a: rnd() * 7,
      r: 0.17 + rnd() * 0.16,
      sp: 0.4 + rnd() * 0.6,
      inc: rnd() * 1.4 - 0.7,
      p: PALETTE_LIST[(c + (rnd() < 0.3 ? 2 : 0)) % 5],
      sz: 0.022 + rnd() * 0.02,
      rot: rnd() * 6,
    };
  });
  let ry = 0;
  let rx = 0.42;
  let spin = 0;

  return {
    dispose() {
      for (const image of textures.values()) image.onload = null;
      textures.clear();
    },
    /** Drag velocity from the pointer, in px per frame. */
    nudge(dx: number) {
      spin = dx * 0.006;
    },
    draw(
      ctx: CanvasRenderingContext2D,
      L: HeroLayout,
      t: number,
      dt: number,
      pointer: { x: number; y: number; inside: boolean },
    ) {
      spin *= 0.95;
      ry += dt * 0.12 + spin;
      const targetRx = pointer.inside ? 0.42 + (pointer.y / L.h - 0.5) * 0.4 : 0.42;
      rx += (targetRx - rx) * 0.05;

      const { w, h, gx: cx, gy: cy, gs: sc } = L;
      // Keep the separately rendered illustrated backdrop visible beneath the orbs.
      ctx.clearRect(0, 0, w, h);
      const drift = (ry * 8) % 20;
      ctx.fillStyle = '#fff';
      for (const [x, y, r, ph] of stars) {
        ctx.globalAlpha = 0.15 + 0.15 * Math.sin(t * 1.3 + ph);
        ctx.beginPath();
        ctx.arc(x * w - drift, y * h, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const cy0 = Math.cos(ry);
      const sy0 = Math.sin(ry);
      const cx0 = Math.cos(rx);
      const sx0 = Math.sin(rx);
      const proj = (x: number, y: number, z: number) => {
        const X = x * cy0 - z * sy0;
        let Z = x * sy0 + z * cy0;
        const Y = y * cx0 - Z * sx0;
        Z = y * sx0 + Z * cx0;
        const f = 3 / (3 + Z);
        return [cx + X * sc * f, cy + Y * sc * f, Z, f] as const;
      };

      const items: { z: number; d: () => void }[] = [];
      ctx.lineWidth = 1;
      const chapterPos = chapters.map((o) => {
        o.a += dt * o.sp;
        const x = Math.cos(o.a);
        const z = Math.sin(o.a);
        const y = Math.sin(o.a) * o.inc;
        const P = proj(x, y, z);
        ctx.strokeStyle = 'rgba(180,190,255,.18)';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(P[0], P[1]);
        ctx.stroke();
        items.push({
          z: P[2],
          d: () => drawOrb(ctx, P[0], P[1], sc * 0.085 * P[3], o.p, t * 0.3),
        });
        return { x, y, z, P };
      });
      for (const m of memories) {
        m.a += dt * m.sp;
        const c = chapterPos[m.c];
        const P = proj(
          c.x + Math.cos(m.a) * m.r,
          c.y + Math.sin(m.a) * m.r * m.inc,
          c.z + Math.sin(m.a) * m.r,
        );
        ctx.strokeStyle = 'rgba(180,190,255,.08)';
        ctx.beginPath();
        ctx.moveTo(c.P[0], c.P[1]);
        ctx.lineTo(P[0], P[1]);
        ctx.stroke();
        items.push({
          z: P[2],
          d: () => drawOrb(ctx, P[0], P[1], sc * m.sz * P[3], m.p, m.rot, 0.95),
        });
      }
      items.push({
        z: 0,
        d: () => {
          const r = sc * 0.2;
          const glow = ctx.createRadialGradient(
            cx - r * 0.3,
            cy - r * 0.3,
            r * 0.1,
            cx,
            cy,
            r * 1.9,
          );
          glow.addColorStop(0, 'rgba(190,170,255,.9)');
          glow.addColorStop(0.35, 'rgba(110,90,230,.5)');
          glow.addColorStop(1, 'rgba(60,40,160,0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(cx, cy, r * 1.9, 0, Math.PI * 2);
          ctx.fill();
          drawOrb(ctx, cx, cy, r, COURSE_ORB, t * 0.2);
        },
      });
      items.sort((a, b) => b.z - a.z).forEach((i) => i.d());
    },
  };
}

const TITLE_LINES = ['没听懂的，', '回来再问。'] as const;
export const TITLE_FONT = '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif';

export function titleGradient(ctx: CanvasRenderingContext2D, x: number, width: number) {
  const grad = ctx.createLinearGradient(x, 0, x + width, 0);
  grad.addColorStop(0, '#f58fb0');
  grad.addColorStop(0.5, '#a58bff');
  grad.addColorStop(1, '#6fa8ff');
  return grad;
}

/** Hero title painted on canvas with a per-character rise on load. */
export function createHeroTitle() {
  let layer: HTMLCanvasElement | null = null;

  const paintTitle = (
    ctx: CanvasRenderingContext2D,
    L: HeroLayout,
    reveal: (i: number) => number,
  ) => {
    ctx.font = `700 ${L.fontSize}px ${TITLE_FONT}`;
    ctx.textBaseline = 'alphabetic';
    const grad = titleGradient(ctx, L.tx, L.fontSize * 6);
    let idx = 0;
    TITLE_LINES.forEach((line, row) => {
      const baseY = L.ty + L.fontSize * (row + 1) * 1.12;
      let x = L.tx;
      for (const ch of line) {
        const k = reveal(idx++);
        const cw = ctx.measureText(ch).width;
        if (k > 0) {
          ctx.globalAlpha = Math.min(1, k * 1.4);
          ctx.fillStyle = row === 0 ? '#eef0ff' : grad;
          ctx.fillText(ch, x, baseY + (1 - k) * L.fontSize * 0.5);
        }
        x += cw;
      }
    });
    ctx.globalAlpha = 1;
  };

  return {
    /** Bottom edge of the title, for placing the DOM subtitle under it. */
    titleBottom(L: HeroLayout) {
      return L.ty + L.fontSize * 2 * 1.12 + L.fontSize * 0.5;
    },
    invalidate() {
      layer = null;
    },
    draw(ctx: CanvasRenderingContext2D, L: HeroLayout, t: number, reduced: boolean) {
      const intro = reduced ? 10 : t;
      if (intro <= 1.6) {
        paintTitle(ctx, L, (i) => {
          const c = Math.min(1, Math.max(0, (intro - 0.15 - i * 0.07) / 0.5));
          return 1 - Math.pow(1 - c, 3);
        });
        return;
      }
      if (!layer) {
        const scale = Math.min(window.devicePixelRatio || 1, 2);
        layer = document.createElement('canvas');
        layer.width = Math.max(1, Math.round(L.w * scale));
        layer.height = Math.max(1, Math.round(L.h * scale));
        const o = layer.getContext('2d')!;
        o.scale(scale, scale);
        paintTitle(o, L, () => 1);
      }
      ctx.drawImage(layer, 0, 0, L.w, L.h);
    },
  };
}
