/**
 * Live marble rain behind the closing call to action: marbles drop in,
 * bounce and pile up; the pointer pushes them and a tap shakes the pile.
 */

import type { MarbleSprites } from './transitions';

type Ball = { x: number; y: number; vx: number; vy: number; r: number; art: number; rot: number };

export function createClosingRain(sprites: MarbleSprites) {
  let balls: Ball[] = [];
  let spawnClock = 0;
  let w = 0;
  let h = 0;
  let unit = 20;

  return {
    resize(width: number, height: number) {
      if (Math.abs(width - w) > 1 || Math.abs(height - h) > 1) balls = [];
      w = width;
      h = height;
      unit = Math.min(34, Math.max(15, w / 34));
    },
    shake() {
      for (const b of balls) {
        b.vy -= 300 + Math.random() * 380;
        b.vx += (Math.random() - 0.5) * 320;
      }
    },
    /** Fill the floor at once (reduced motion). */
    settle() {
      balls = [];
      const target = Math.floor((w * h) / (unit * unit * 16));
      const perRow = Math.max(1, Math.floor(w / (unit * 2)));
      for (let i = 0; i < target; i++) {
        const row = Math.floor(i / perRow);
        balls.push({
          x: unit + (i % perRow) * unit * 2 + (row % 2) * unit,
          y: h - unit - row * unit * 1.75,
          vx: 0,
          vy: 0,
          r: unit,
          art: i,
          rot: i,
        });
      }
    },
    step(
      ctx: CanvasRenderingContext2D,
      dt: number,
      pointer: { x: number; y: number; inside: boolean },
    ) {
      const target = Math.floor((w * h) / (unit * unit * 16));
      spawnClock += dt;
      if (balls.length < target && spawnClock > 0.035) {
        spawnClock = 0;
        balls.push({
          x: unit + Math.random() * (w - unit * 2),
          y: -unit * 2,
          vx: (Math.random() - 0.5) * 60,
          vy: 0,
          r: unit * (0.75 + Math.random() * 0.5),
          art: balls.length,
          rot: Math.random() * 6,
        });
      }
      const steps = 3;
      const hs = dt / steps;
      for (let k = 0; k < steps; k++) {
        for (const b of balls) {
          b.vy += 900 * hs;
          if (pointer.inside) {
            const dx = b.x - pointer.x;
            const dy = b.y - pointer.y;
            const d = Math.hypot(dx, dy);
            const reach = unit * 3.4;
            if (d < reach && d > 0) {
              const f = ((reach - d) / reach) * 2400 * hs;
              b.vx += (dx / d) * f;
              b.vy += (dy / d) * f;
            }
          }
          b.x += b.vx * hs;
          b.y += b.vy * hs;
          if (b.y > h - b.r) {
            b.y = h - b.r;
            b.vy *= -0.35;
            b.vx *= 0.98;
          }
          if (b.x < b.r) {
            b.x = b.r;
            b.vx *= -0.5;
          }
          if (b.x > w - b.r) {
            b.x = w - b.r;
            b.vx *= -0.5;
          }
        }
        for (let i = 0; i < balls.length; i++) {
          const a = balls[i];
          for (let j = i + 1; j < balls.length; j++) {
            const b = balls[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const m = a.r + b.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= m * m || d2 === 0) continue;
            const d = Math.sqrt(d2);
            const nx = dx / d;
            const ny = dy / d;
            const o = (m - d) / 2;
            a.x -= nx * o;
            a.y -= ny * o;
            b.x += nx * o;
            b.y += ny * o;
            const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rv < 0) {
              const im = -rv * 0.6;
              a.vx -= im * nx;
              a.vy -= im * ny;
              b.vx += im * nx;
              b.vy += im * ny;
            }
          }
        }
      }
      ctx.clearRect(0, 0, w, h);
      for (const b of balls) {
        b.rot += (b.vx * dt) / b.r;
        sprites.draw(ctx, b.art, b.x, b.y, b.r, b.rot);
      }
    },
  };
}
