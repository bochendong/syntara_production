/** Optical sampling of the live paper beneath a rounded glass control. */
export type InkGlassMap = {
  width: number;
  height: number;
  padding: number;
  sampleWidth: number;
  sampleHeight: number;
  source: Uint32Array;
  light: Float32Array;
  focus: Float32Array;
  alpha: Uint8ClampedArray;
};
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

export function createInkGlassMap(width: number, height: number, density = 1): InkGlassMap {
  const w = Math.max(1, Math.round(width * density));
  const h = Math.max(1, Math.round(height * density));
  const padding = Math.ceil(24 * density);
  const sampleWidth = w + padding * 2;
  const sampleHeight = h + padding * 2;
  const source = new Uint32Array(w * h);
  const light = new Float32Array(w * h);
  const focus = new Float32Array(w * h);
  const alpha = new Uint8ClampedArray(w * h);
  const radius = Math.min(28, width / 2, height / 2);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = py * w + px;
      const x = (px + 0.5) / density;
      const y = (py + 0.5) / density;
      const dx = x - clamp(x, radius, width - radius);
      const dy = y - clamp(y, radius, height - radius);
      const distance = Math.hypot(dx, dy);
      const depth = radius - distance;
      alpha[i] = clamp(depth * density + 0.5, 0, 1) * 255;
      if (!alpha[i]) continue;
      const nx = distance ? dx / distance : 0;
      const ny = distance ? dy / distance : 0;
      const rim = clamp(1 - depth / 12, 0, 1);
      // The rounded rim bends the background; the central lens has mild magnification.
      const bend = Math.sin(rim * Math.PI) * 5;
      focus[i] = rim ** 2;
      const sx = width / 2 + (x - width / 2) * 0.995 - nx * bend;
      const sy = height / 2 + (y - height / 2) * 0.985 - ny * bend;
      const ix = clamp(Math.round(sx * density) + padding, 0, sampleWidth - 1);
      const iy = clamp(Math.round(sy * density) + padding, 0, sampleHeight - 1);
      source[i] = (iy * sampleWidth + ix) * 4;
      const incidence = -nx * 0.55 - ny * 0.83;
      light[i] =
        Math.max(0, incidence) * rim ** 3 * 0.65 - Math.max(0, -incidence) * rim ** 2 * 0.15;
    }
  }
  return { width: w, height: h, padding, sampleWidth, sampleHeight, source, light, focus, alpha };
}

export function refractInkGlass(
  pixels: Uint8ClampedArray,
  map: InkGlassMap,
  output: Uint8ClampedArray,
  diffused: Uint8ClampedArray = pixels,
) {
  for (let i = 0; i < map.source.length; i++) {
    const target = i * 4;
    const from = map.source[i];
    const light = map.light[i];
    for (let channel = 0; channel < 3; channel++) {
      // A neutral veil keeps the controls readable over dark handwriting.
      const backdrop =
        pixels[from + channel] * map.focus[i] + diffused[from + channel] * (1 - map.focus[i]);
      const color = backdrop * 0.56 + 255 * 0.44;
      output[target + channel] = light > 0 ? color + (255 - color) * light : color * (1 + light);
    }
    output[target + 3] = map.alpha[i];
  }
}

/** Small separable diffusion pass; no browser-specific canvas/SVG filter is required. */
export function diffuseInkGlass(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  scratch: Uint8ClampedArray,
  output: Uint8ClampedArray,
) {
  const r = Math.max(1, Math.round(radius));
  const divisor = 1 / (r * 2 + 1);
  for (let y = 0; y < height; y++) {
    let red = 0,
      green = 0,
      blue = 0;
    for (let k = -r; k <= r; k++) {
      const at = (y * width + clamp(k, 0, width - 1)) * 4;
      red += pixels[at];
      green += pixels[at + 1];
      blue += pixels[at + 2];
    }
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      scratch[at] = red * divisor;
      scratch[at + 1] = green * divisor;
      scratch[at + 2] = blue * divisor;
      scratch[at + 3] = 255;
      const before = (y * width + Math.max(0, x - r)) * 4;
      const after = (y * width + Math.min(width - 1, x + r + 1)) * 4;
      red += pixels[after] - pixels[before];
      green += pixels[after + 1] - pixels[before + 1];
      blue += pixels[after + 2] - pixels[before + 2];
    }
  }
  for (let x = 0; x < width; x++) {
    let red = 0,
      green = 0,
      blue = 0;
    for (let k = -r; k <= r; k++) {
      const at = (clamp(k, 0, height - 1) * width + x) * 4;
      red += scratch[at];
      green += scratch[at + 1];
      blue += scratch[at + 2];
    }
    for (let y = 0; y < height; y++) {
      const at = (y * width + x) * 4;
      output[at] = red * divisor;
      output[at + 1] = green * divisor;
      output[at + 2] = blue * divisor;
      output[at + 3] = 255;
      const before = (Math.max(0, y - r) * width + x) * 4;
      const after = (Math.min(height - 1, y + r + 1) * width + x) * 4;
      red += scratch[after] - scratch[before];
      green += scratch[after + 1] - scratch[before + 1];
      blue += scratch[after + 2] - scratch[before + 2];
    }
  }
}
