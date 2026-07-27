export const academyPaperTheme = {
  ink: '#182033',
  body: '#3f4b63',
  primary: '#4b72e8',
  purple: '#8a6fe8',
  green: '#27b889',
  gold: '#d6a84f',
  cardBorder: 'rgba(188,169,133,0.28)',
  softBorder: 'rgba(151,130,91,0.18)',
  cardShadow:
    '0 10px 24px rgba(92,70,38,0.08), 0 2px 8px rgba(72,54,35,0.05), inset 0 1px 0 rgba(255,255,255,0.82)',
  quietShadow:
    '0 8px 18px rgba(92,70,38,0.07), 0 2px 6px rgba(72,54,35,0.045), inset 0 1px 0 rgba(255,255,255,0.76)',
  formulaFill: 'rgba(248,251,255,0.78)',
  paperFill: 'rgba(255,253,248,0.88)',
} as const;

export function mixHexColor(base: string, target: string, weight: number): string {
  const normalizedWeight = Math.max(0, Math.min(1, weight));
  const hexToRgb = (value: string): [number, number, number] | null => {
    const hex = value.replace('#', '').trim();
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
      return [r, g, b];
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
      return [r, g, b];
    }
    return null;
  };
  const rgbToHex = (r: number, g: number, b: number): string => {
    const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
    return `#${[clamp(r), clamp(g), clamp(b)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')}`;
  };
  const baseRgb = hexToRgb(base);
  const targetRgb = hexToRgb(target);
  if (!baseRgb || !targetRgb) return base;
  return rgbToHex(
    baseRgb[0] * (1 - normalizedWeight) + targetRgb[0] * normalizedWeight,
    baseRgb[1] * (1 - normalizedWeight) + targetRgb[1] * normalizedWeight,
    baseRgb[2] * (1 - normalizedWeight) + targetRgb[2] * normalizedWeight,
  );
}

export function extractLeadingHtmlColor(html: string): string | null {
  const match = html.match(/<p\b[^>]*style=["'][^"']*color:\s*(#[0-9a-fA-F]{3,8})/);
  return match?.[1] ?? null;
}

export function normalizeAccentForAcademyPaper(color: string): string {
  const normalized = color.trim().toLowerCase();
  if (['#2563eb', '#2f6bff', '#1d4ed8', '#007aff', '#0a84ff', '#3b82f6'].includes(normalized)) {
    return academyPaperTheme.primary;
  }
  if (['#7a5af8', '#8b5cf6', '#6d5dfc', '#4f46e5', '#6366f1'].includes(normalized)) {
    return academyPaperTheme.purple;
  }
  if (['#12b76a', '#16a34a', '#10b981', '#059669', '#047857'].includes(normalized)) {
    return academyPaperTheme.green;
  }
  if (['#ea580c', '#f97316', '#d97706', '#f59e0b'].includes(normalized)) {
    return '#d69a45';
  }
  return color;
}

export function academyPaperBackground(accent: string = academyPaperTheme.primary): string {
  return [
    `radial-gradient(circle at 96% 6%, ${mixHexColor(accent, '#fffdf8', 0.9)} 0%, rgba(255,255,255,0) 24%)`,
    'linear-gradient(135deg, rgba(255,253,248,0.95), rgba(250,248,243,0.9))',
  ].join(',');
}

export function isLightPaperColor(color?: string): boolean {
  if (!color) return true;
  const normalized = color.trim().toLowerCase();
  if (normalized === 'transparent') return false;
  if (normalized.startsWith('#')) {
    const hex = normalized.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((part) => part + part)
            .join('')
        : hex.slice(0, 6);
    if (full.length !== 6) return false;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return false;
    return r >= 235 && g >= 235 && b >= 230;
  }
  const rgba = normalized.match(/rgba?\(([^)]+)\)/);
  if (!rgba) return false;
  const [r, g, b, a = '1'] = rgba[1].split(',').map((part) => part.trim());
  const rgb = [Number(r), Number(g), Number(b)];
  const alpha = Number(a);
  return rgb.every((value) => value >= 235) && alpha > 0.25;
}
