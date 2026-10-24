/**
 * The lens screen: a lecture page painted on canvas, small enough that you
 * need the glass marble to read it. The marble follows the pointer and
 * refracts whatever is under it (fisheye magnification + chromatic rim).
 */

import { MARBLE_PALETTE, TITLE_FONT, titleGradient } from './hero-canvas';
import { LANDING_MARBLE_ART } from './marble-art';

export type LensLayout = {
  w: number;
  h: number;
  phone: boolean;
  /** Headline. */
  tx: number;
  ty: number;
  fontSize: number;
  /** Lecture card. */
  cx: number;
  cy: number;
  cw: number;
  ch: number;
  /** Lens radius. */
  R: number;
};

export function computeLensLayout(w: number, h: number): LensLayout {
  if (w >= 900) {
    const fontSize = Math.min(w * 0.052, h * 0.1, 84);
    return {
      w,
      h,
      phone: false,
      tx: Math.max(32, w * 0.07),
      ty: h * 0.3,
      fontSize,
      cx: w * 0.53,
      cy: h * 0.16,
      cw: w * 0.38,
      ch: h * 0.7,
      R: Math.min(w, h) * 0.17,
    };
  }
  const fontSize = Math.min(w * 0.1, 44);
  return {
    w,
    h,
    phone: true,
    tx: 24,
    ty: h * 0.11,
    fontSize,
    cx: 20,
    cy: h * 0.47,
    cw: w - 64,
    ch: h * 0.44,
    R: w * 0.2,
  };
}

const HEADLINE = ['哪儿没看懂，', '就从哪儿问。'] as const;

type Block =
  | { kind: 'title'; text: string }
  | { kind: 'text'; text: string; mark?: boolean }
  | { kind: 'code'; lines: string[] };

const LECTURE: Block[] = [
  { kind: 'title', text: 'Lecture 9 · Recursion · 第 12 页' },
  {
    kind: 'text',
    text: 'Recursion solves a problem by solving smaller copies of the same problem, then combining the answers.',
  },
  { kind: 'text', text: '递归：把问题拆成更小的同类问题，直到小到可以直接回答，再把答案合起来。' },
  {
    kind: 'text',
    text: 'Every recursive function needs a base case, otherwise it keeps calling itself until the stack overflows.',
    mark: true,
  },
  {
    kind: 'code',
    lines: [
      'def total(lst):',
      '    if lst == []:',
      '        return 0',
      '    return lst[0] + total(lst[1:])',
    ],
  },
  {
    kind: 'text',
    text: 'Trace: total([1, 2, 3]) → 1 + total([2, 3]) → 1 + 2 + total([3]) → 1 + 2 + 3 + total([]) → 6',
  },
  { kind: 'text', text: '注意：lst[1:] 每次都会复制一份列表，列表很长时会又慢又占内存。' },
  {
    kind: 'text',
    text: 'Exercise 9.3: rewrite total so that it walks an index instead of slicing the list.',
  },
];

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = '';
  // Break between CJK characters or at spaces in Latin text.
  const tokens = text.match(/[　-鿿＀-￯]|[^\s　-鿿＀-￯]+\s*|\s+/g) ?? [];
  for (const token of tokens) {
    const next = line + token;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line.trimEnd());
      line = token.trimStart();
    } else {
      line = next;
    }
  }
  if (line) lines.push(line.trimEnd());
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paintScene(ctx: CanvasRenderingContext2D, L: LensLayout) {
  // The same illustrated glass backdrop sits beneath every screen.
  ctx.clearRect(0, 0, L.w, L.h);
  const gs = Math.max(22, L.w / 40);
  ctx.strokeStyle = 'rgba(170,180,255,.09)';
  ctx.lineWidth = 1;
  for (let x = 0; x < L.w; x += gs) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, L.h);
    ctx.stroke();
  }
  for (let y = 0; y < L.h; y += gs) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(L.w, y + 0.5);
    ctx.stroke();
  }

  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 ${L.fontSize}px ${TITLE_FONT}`;
  HEADLINE.forEach((line, row) => {
    ctx.fillStyle = row === 0 ? '#eef0ff' : titleGradient(ctx, L.tx, L.fontSize * 7);
    ctx.fillText(line, L.tx, L.ty + L.fontSize * (row + 1) * 1.15);
  });

  // The lecture page: deliberately small print.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#f5f6fd';
  roundRect(ctx, L.cx, L.cy, L.cw, L.ch, 20);
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, L.cx, L.cy, L.cw, L.ch, 20);
  ctx.clip();
  const pad = L.phone ? 14 : 26;
  const size = L.phone ? 9.5 : Math.max(10.5, Math.min(12.5, L.cw / 46));
  const width = L.cw - pad * 2;
  let y = L.cy + pad + size;
  for (const block of LECTURE) {
    if (block.kind === 'title') {
      ctx.font = `700 ${size * 1.25}px ${TITLE_FONT}`;
      ctx.fillStyle = '#1b1d33';
      ctx.fillText(block.text, L.cx + pad, y + size * 0.25);
      y += size * 2.4;
      continue;
    }
    if (block.kind === 'code') {
      const lh = size * 1.55;
      ctx.fillStyle = '#11143a';
      roundRect(ctx, L.cx + pad, y - size, width, lh * block.lines.length + size * 1.1, 8);
      ctx.fill();
      ctx.font = `${size}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillStyle = '#cfe2ff';
      block.lines.forEach((line, i) =>
        ctx.fillText(line, L.cx + pad + size, y + size * 0.4 + i * lh),
      );
      y += lh * block.lines.length + size * 1.6;
      continue;
    }
    ctx.font = `${size}px ${TITLE_FONT}`;
    const lines = wrap(ctx, block.text, width);
    const lh = size * 1.7;
    if (block.mark) {
      ctx.fillStyle = 'rgba(245,185,74,.38)';
      lines.forEach((_, i) =>
        ctx.fillRect(L.cx + pad - 3, y - size * 1.05 + i * lh, width + 6, lh * 0.92),
      );
    }
    ctx.fillStyle = block.mark ? '#3a2600' : '#4b4f70';
    lines.forEach((line, i) => ctx.fillText(line, L.cx + pad, y + i * lh));
    y += lines.length * lh + size * 0.9;
  }
  ctx.restore();
}

export function createLensScene(onTextureLoad: () => void) {
  const artwork = new Image();
  let shell: HTMLCanvasElement | null = null;
  artwork.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = artwork.naturalWidth;
    canvas.height = artwork.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(artwork, 0, 0);
    // Keep the textured rim and highlights; let the refracted page show through.
    const c = canvas.width / 2;
    const mask = ctx.createRadialGradient(c, c, 0, c, c, canvas.width * 0.45);
    mask.addColorStop(0, 'rgba(0,0,0,.94)');
    mask.addColorStop(0.65, 'rgba(0,0,0,.86)');
    mask.addColorStop(0.9, 'rgba(0,0,0,.35)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    shell = canvas;
    onTextureLoad();
  };
  artwork.src = LANDING_MARBLE_ART.blue.src;

  let layer: HTMLCanvasElement | null = null;
  let pixels: ImageData | null = null;
  let lens: HTMLCanvasElement | null = null;
  let lensImg: ImageData | null = null;
  let scale = 1;
  let lx = 0;
  let ly = 0;
  let R = 0;
  const tint = [1, 3, 5].map((s) => parseInt(MARBLE_PALETTE.blue[0].slice(s, s + 2), 16));

  const idle = (L: LensLayout, t: number) => ({
    x: L.cx + L.cw * (0.5 + 0.3 * Math.sin(t * 0.42)),
    y: L.cy + L.ch * (0.45 + 0.28 * Math.sin(t * 0.77 + 1)),
  });

  return {
    dispose() {
      artwork.onload = null;
      shell = null;
    },
    invalidate() {
      layer = null;
    },
    /** Where the marble is now, so the next screen can open out of it. */
    position() {
      return { x: lx, y: ly, r: R };
    },
    /** Bottom edge of the headline, for the DOM copy under it. */
    headlineBottom(L: LensLayout) {
      return L.ty + L.fontSize * 2 * 1.15 + L.fontSize * 0.55;
    },
    /** The glass rim alone, scaled up while the next screen opens through it. */
    drawShell(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number) {
      if (!shell) return;
      const size = (r * 2) / 0.9;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(shell, x - size / 2, y - size / 2, size, size);
      ctx.restore();
    },
    draw(
      ctx: CanvasRenderingContext2D,
      L: LensLayout,
      t: number,
      pointer: { x: number; y: number; inside: boolean },
      opts: { reduced: boolean; frozen: boolean },
    ) {
      if (!layer) {
        scale = Math.min(window.devicePixelRatio || 1, 1.5);
        layer = document.createElement('canvas');
        layer.width = Math.max(1, Math.round(L.w * scale));
        layer.height = Math.max(1, Math.round(L.h * scale));
        const o = layer.getContext('2d')!;
        o.scale(scale, scale);
        paintScene(o, L);
        pixels = o.getImageData(0, 0, layer.width, layer.height);
        lens = null;
        const start = idle(L, t);
        lx = start.x;
        ly = start.y;
      }
      ctx.clearRect(0, 0, L.w, L.h);
      ctx.drawImage(layer, 0, 0, L.w, L.h);
      if (!pixels) return;

      if (!opts.frozen) {
        const target = pointer.inside && !opts.reduced ? pointer : idle(L, opts.reduced ? 0 : t);
        lx += (target.x - lx) * 0.14;
        ly += (target.y - ly) * 0.14;
      }
      R = L.R;
      const RD = Math.round(R * scale);
      const size = RD * 2;
      if (!lens || lens.width !== size) {
        lens = document.createElement('canvas');
        lens.width = lens.height = size;
        lensImg = lens.getContext('2d')!.createImageData(size, size);
      }
      const out = lensImg!.data;
      const src = pixels.data;
      const W = pixels.width;
      const H = pixels.height;
      const cxp = lx * scale;
      const cyp = ly * scale;
      const sample = (x: number, y: number, c: number) => {
        let xi = x | 0;
        let yi = y | 0;
        if (xi < 0) xi = 0;
        else if (xi >= W) xi = W - 1;
        if (yi < 0) yi = 0;
        else if (yi >= H) yi = H - 1;
        return src[(yi * W + xi) * 4 + c];
      };
      for (let j = 0; j < size; j++) {
        const dy = (j - RD) / RD;
        for (let i = 0; i < size; i++) {
          const dx = (i - RD) / RD;
          const r2 = dx * dx + dy * dy;
          const k = (j * size + i) * 4;
          if (r2 > 1) {
            out[k + 3] = 0;
            continue;
          }
          // Fisheye: ~2.6x at the centre, 1x at the rim; channels split towards the rim.
          const m = 0.38 + 0.62 * r2;
          const ca = 0.07 * r2;
          const sx = cxp + dx * RD * m;
          const sy = cyp + dy * RD * m;
          const ox = dx * RD * ca;
          const oy = dy * RD * ca;
          const rim = Math.pow(r2, 3) * 0.8;
          const glass = 0.12;
          out[k] = Math.min(
            255,
            sample(sx + ox, sy + oy, 0) * (1 - glass) + tint[0] * glass + rim * 160,
          );
          out[k + 1] = Math.min(255, sample(sx, sy, 1) * (1 - glass) + tint[1] * glass + rim * 160);
          out[k + 2] = Math.min(
            255,
            sample(sx - ox, sy - oy, 2) * (1 - glass) + tint[2] * glass + rim * 190,
          );
          out[k + 3] = r2 > 0.985 ? Math.round(((1 - r2) / 0.015) * 255) : 255;
        }
      }
      lens.getContext('2d')!.putImageData(lensImg!, 0, 0);

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.5)';
      ctx.shadowBlur = R * 0.4;
      ctx.shadowOffsetY = R * 0.16;
      ctx.fillStyle = '#0b0d1a';
      ctx.beginPath();
      ctx.arc(lx, ly, R * 0.97, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.drawImage(lens, lx - R, ly - R, R * 2, R * 2);
      if (shell) {
        const s = (R * 2) / 0.9;
        ctx.drawImage(shell, lx - s / 2, ly - s / 2, s, s);
        return;
      }
      ctx.lineWidth = Math.max(1.5, R * 0.025);
      ctx.strokeStyle = 'rgba(18,16,40,.9)';
      ctx.beginPath();
      ctx.arc(lx, ly, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.beginPath();
      ctx.ellipse(lx - R * 0.42, ly - R * 0.48, R * 0.22, R * 0.1, -0.7, 0, Math.PI * 2);
      ctx.fill();
    },
  };
}
