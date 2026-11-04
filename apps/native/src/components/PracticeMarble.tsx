import { useEffect, useRef } from 'react';
import tealArt from '../assets/practice-intelligence-marble-v1.webp?url';
import blueArt from '../assets/practice-intelligence-marble-ice-blue-v1.webp?url';
import violetArt from '../assets/practice-intelligence-marble-violet-v1.webp?url';
import cosmosArt from '../assets/marbles/ssr-any-cosmos.webp?url';
import champagneArt from '../assets/practice-intelligence-marble-champagne-v1.webp?url';

const MARBLE_ART = [tealArt, blueArt, violetArt, cosmosArt, champagneArt];
const SIZE = 144;

async function loadTextures(): Promise<Uint8ClampedArray[]> {
  const images = await Promise.all(
    MARBLE_ART.map(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    }),
  );
  const surface = document.createElement('canvas');
  surface.width = SIZE;
  surface.height = SIZE;
  const context = surface.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  return images.map((image) => {
    context.clearRect(0, 0, SIZE, SIZE);
    context.drawImage(image, 0, 0, SIZE, SIZE);
    return context.getImageData(0, 0, SIZE, SIZE).data;
  });
}

/** Custom platform-style glass artwork, with refraction moving inside its fixed shell. */
export function PracticeMarble({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsedRef = useRef(0);
  const texturesRef = useRef<Promise<Uint8ClampedArray[]> | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const size = SIZE;
    if (canvas.width !== size) canvas.width = size;
    if (canvas.height !== size) canvas.height = size;
    let frame = 0;
    let elapsed = elapsedRef.current;
    let previous = 0;
    let disposed = false;
    let textures: Uint8ClampedArray[] | undefined;
    const blended = new Uint8ClampedArray(size * size * 4);
    const output = ctx.createImageData(size, size);

    // Precompute the displacement field. The rim and upper-left reflection stay fixed.
    const points: {
      offset: number;
      x: number;
      y: number;
      weight: number;
      a: number;
      b: number;
      c: number;
      d: number;
    }[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x - size / 2) / (size / 2);
        const ny = (y - size / 2) / (size / 2);
        const radius = Math.hypot(nx, ny);
        const edge = Math.max(0, Math.min(1, (0.85 - radius) / 0.3));
        const reflection = Math.exp(-((nx + 0.4) ** 2 + (ny + 0.5) ** 2) / 0.09);
        const weight = edge * edge * (3 - 2 * edge) * (1 - reflection);
        if (weight < 0.001) continue;
        const waveX = nx * 4.5 + ny * 2;
        const waveY = ny * 5 - nx * 1.5;
        points.push({
          offset: (y * size + x) * 4,
          x,
          y,
          weight,
          a: Math.sin(waveX),
          b: Math.cos(waveX),
          c: Math.sin(waveY),
          d: Math.cos(waveY),
        });
      }
    }

    const draw = (time: number) => {
      if (!textures) return;
      // Each finish rests for six seconds, then dissolves into the next over six seconds.
      const index = Math.floor(time / 12) % textures.length;
      const from = textures[index];
      const to = textures[(index + 1) % textures.length];
      const progress = Math.max(0, ((time % 12) - 6) / 6);
      const mix = progress * progress * (3 - 2 * progress);
      let source = from;
      if (mix > 0) {
        for (let i = 0; i < blended.length; i += 4) {
          const alpha = from[i + 3] * (1 - mix) + to[i + 3] * mix;
          // Premultiplied interpolation avoids dark fringes around the transparent shell.
          for (let c = 0; c < 3; c++) {
            blended[i + c] =
              alpha > 0
                ? (from[i + c] * from[i + 3] * (1 - mix) + to[i + c] * to[i + 3] * mix) / alpha
                : 0;
          }
          blended[i + 3] = alpha;
        }
        source = blended;
      }
      output.data.set(source);
      const sx = Math.sin(time * 0.85);
      const cx = Math.cos(time * 0.85);
      const sy = Math.sin(time * 0.63);
      const cy = Math.cos(time * 0.63);
      for (const point of points) {
        const x = point.x + point.weight * 6 * (point.a * sx + point.b * (cx - 1));
        const y = point.y + point.weight * 5 * (point.c * sy + point.d * (cy - 1));
        const left = Math.max(0, Math.min(size - 2, Math.floor(x)));
        const top = Math.max(0, Math.min(size - 2, Math.floor(y)));
        const fx = Math.max(0, Math.min(1, x - left));
        const fy = Math.max(0, Math.min(1, y - top));
        const offset = (top * size + left) * 4;
        // Bilinear sampling keeps curved highlights crisp without pixel stepping.
        for (let channel = 0; channel < 4; channel++) {
          const upper = source[offset + channel] * (1 - fx) + source[offset + 4 + channel] * fx;
          const lower =
            source[offset + size * 4 + channel] * (1 - fx) +
            source[offset + size * 4 + 4 + channel] * fx;
          output.data[point.offset + channel] = upper * (1 - fy) + lower * fy;
        }
      }
      ctx.putImageData(output, 0, 0);
      canvas.parentElement?.style.setProperty('background-image', 'none');

      // A small warm glint follows the inner current, fading before it reaches the shell.
      const travel = (time * 0.13 + 0.16) % 1;
      const glintX = size / 2 + Math.sin(travel * Math.PI * 1.5 - 0.8) * 32;
      const glintY = size / 2 + 42 - travel * 84;
      const glint = ctx.createRadialGradient(glintX, glintY, 0, glintX, glintY, 5);
      glint.addColorStop(0, 'rgba(255, 252, 223, 0.95)');
      glint.addColorStop(0.25, 'rgba(255, 234, 174, 0.6)');
      glint.addColorStop(1, 'rgba(255, 234, 174, 0)');
      ctx.save();
      ctx.globalAlpha = Math.sin(travel * Math.PI) * 0.7;
      ctx.fillStyle = glint;
      ctx.fillRect(glintX - 5, glintY - 5, 10, 10);
      ctx.restore();
    };

    const tick = (now: number) => {
      // Small, local canvas at 24 fps, without React renders or per-pixel trigonometry.
      if (!previous || now - previous >= 1000 / 24) {
        elapsed += previous ? Math.min(now - previous, 100) / 1000 : 0;
        previous = now;
        elapsedRef.current = elapsed;
        draw(elapsed);
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      draw(elapsed);
      if (textures && active && !motion.matches && !document.hidden)
        frame = requestAnimationFrame(tick);
    };
    texturesRef.current ??= loadTextures();
    void texturesRef.current
      .then((loaded) => {
        if (disposed) return;
        textures = loaded;
        sync();
      })
      .catch(() => {
        // Keep the static CSS artwork usable if a texture cannot load; retry next activation.
        texturesRef.current = null;
      });
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      motion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [active]);

  return (
    <span className="practice-marble-glass" aria-hidden="true">
      <canvas ref={canvasRef} className="practice-marble-current" />
    </span>
  );
}
