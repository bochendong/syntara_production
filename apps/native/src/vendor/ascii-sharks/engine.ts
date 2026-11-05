/*!
 * ascii-sharks — https://github.com/stackedlol/ascii-sharks
 * MIT License
 *
 * Copyright (c) 2026 drewdi
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */
// Vendored from stackedlol/ascii-sharks (MIT); see LICENSE and README.md.
import { AsciiRenderer } from './renderer';
import { World, type SharkSpec } from './world';

const STEP = 1 / 60;
const MAX_STEPS = 4;
const FRAME_INTERVAL = 1000 / 30;

/**
 * Wires World + AsciiRenderer to a canvas: fixed-timestep loop, resize,
 * background visibility pausing, and prefers-reduced-motion.
 */
export class OceanEngine {
  private world: World;
  private renderer: AsciiRenderer;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private lastDraw = 0;
  private hasSize = false;
  private visible = true;
  private reducedMotion: MediaQueryList;
  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver;
  private disposed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    sharks?: SharkSpec[],
  ) {
    this.world = new World(sharks);
    this.renderer = new AsciiRenderer(canvas);
    this.renderer.setFontFamily(getComputedStyle(canvas).fontFamily);
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.schedule();
    });
    this.intersectionObserver.observe(canvas);

    this.reducedMotion.addEventListener('change', this.onMotionPreference);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    this.resize();
    // Canvas text can't trigger a webfont load; once the mono face is in, redraw.
    document.fonts?.load(`600 16px ${getComputedStyle(canvas).fontFamily}`).then(() => {
      if (!this.disposed && this.reducedMotion.matches) this.drawStill();
    });
    this.schedule();
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.reducedMotion.removeEventListener('change', this.onMotionPreference);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.hasSize = rect.width >= 1 && rect.height >= 1;
    if (!this.hasSize) {
      this.schedule();
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.resize(rect.width, rect.height, dpr);
    this.world.resize(rect.width, rect.height, this.renderer.cellWidth, this.renderer.cellHeight);
    if (this.reducedMotion.matches) this.drawStill();
    this.schedule();
  }

  private schedule() {
    cancelAnimationFrame(this.raf);
    if (
      this.disposed ||
      !this.visible ||
      !this.hasSize ||
      document.hidden ||
      this.reducedMotion.matches
    )
      return;
    this.last = performance.now();
    this.lastDraw = this.last;
    this.acc = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    if (now - this.lastDraw < FRAME_INTERVAL - 0.5) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    this.lastDraw = now;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.world.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0;
    this.renderer.render(this.world, dt);
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Reduced motion: let the ecosystem settle, then show a single frame. */
  private drawStill() {
    if (!this.hasSize || this.disposed) return;
    if (this.world.time < 4 - 1e-6) {
      for (let i = 0; i < 240; i++) this.world.step(STEP);
    }
    this.renderer.render(this.world, STEP);
  }

  private onMotionPreference = () => {
    if (this.reducedMotion.matches) {
      cancelAnimationFrame(this.raf);
      this.drawStill();
    } else {
      this.schedule();
    }
  };

  private onVisibilityChange = () => this.schedule();
}
