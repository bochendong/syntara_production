export type InkToolbarCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type InkToolbarSize = { width: number; height: number };
export type InkToolbarPoint = { x: number; y: number };

export function inkToolbarBounds(area: InkToolbarSize, toolbar: InkToolbarSize) {
  const roomX = Math.max(0, area.width - toolbar.width);
  const roomY = Math.max(0, area.height - toolbar.height);
  const minX = Math.min(10, roomX / 2);
  const minY = Math.min(10, roomY / 2);
  return { minX, minY, maxX: Math.max(minX, roomX - minX), maxY: Math.max(minY, roomY - minY) };
}

export function clampInkToolbar(
  point: InkToolbarPoint,
  area: InkToolbarSize,
  toolbar: InkToolbarSize,
) {
  const bounds = inkToolbarBounds(area, toolbar);
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, point.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, point.y)),
  };
}

export function dockInkToolbar(
  corner: InkToolbarCorner,
  area: InkToolbarSize,
  toolbar: InkToolbarSize,
): InkToolbarPoint {
  const bounds = inkToolbarBounds(area, toolbar);
  return {
    x: corner.endsWith('right') ? bounds.maxX : bounds.minX,
    y: corner.startsWith('bottom') ? bounds.maxY : bounds.minY,
  };
}

export function nearestInkToolbarCorner(
  point: InkToolbarPoint,
  area: InkToolbarSize,
  toolbar: InkToolbarSize,
): InkToolbarCorner {
  const bounds = inkToolbarBounds(area, toolbar);
  const horizontal = point.x > (bounds.minX + bounds.maxX) / 2 ? 'right' : 'left';
  const vertical = point.y > (bounds.minY + bounds.maxY) / 2 ? 'bottom' : 'top';
  return `${vertical}-${horizontal}`;
}
