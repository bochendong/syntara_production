/** Ink uses deeper shades than the small glass swatches to stay readable on white paper. */
export const INK_PALETTE = [
  { id: 'navy', label: '深蓝', color: '#172b4d', marble: 'blue' },
  { id: 'blue', label: '蓝色', color: '#3b82d0', marble: 'blue' },
  { id: 'purple', label: '紫色', color: '#8965c2', marble: 'purple' },
  { id: 'pink', label: '粉色', color: '#c25f88', marble: 'pink' },
  { id: 'green', label: '绿色', color: '#348b6c', marble: 'green' },
  { id: 'amber', label: '琥珀色', color: '#b17a28', marble: 'amber' },
] as const;

export type InkColor = (typeof INK_PALETTE)[number]['color'];
export const DEFAULT_INK_COLOR: InkColor = INK_PALETTE[0].color;
