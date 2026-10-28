import { INK_HEIGHT, INK_WIDTH } from '../data/handwriting-draft';

export type InkViewportSize = { width: number; height: number };
export type InkView = { zoom: number; x: number; y: number };
export type InkViewPoint = { x: number; y: number };
export const MIN_INK_ZOOM = 0.5;
export const MAX_INK_ZOOM = 4;
const EDGE = 8;

export function inkPaperSize(size: InkViewportSize, zoom: number) {
  const width = Math.max(1, size.width - EDGE * 2) * zoom;
  return { width, height: (width * INK_HEIGHT) / INK_WIDTH };
}

export function clampInkView(view: InkView, size: InkViewportSize): InkView {
  const zoom = Math.min(MAX_INK_ZOOM, Math.max(MIN_INK_ZOOM, view.zoom));
  const paper = inkPaperSize(size, zoom);
  const clampAxis = (offset: number, viewport: number, page: number) =>
    page + EDGE * 2 <= viewport
      ? (viewport - page) / 2
      : Math.min(EDGE, Math.max(viewport - page - EDGE, offset));
  return {
    zoom,
    x: clampAxis(view.x, size.width, paper.width),
    y: clampAxis(view.y, size.height, paper.height),
  };
}

export function resetInkView(size: InkViewportSize): InkView {
  return clampInkView({ zoom: 1, x: EDGE, y: EDGE }, size);
}

export function zoomInkView(
  view: InkView,
  zoom: number,
  anchor: InkViewPoint,
  size: InkViewportSize,
) {
  const nextZoom = Math.min(MAX_INK_ZOOM, Math.max(MIN_INK_ZOOM, zoom));
  const ratio = nextZoom / view.zoom;
  return clampInkView(
    {
      zoom: nextZoom,
      x: anchor.x - (anchor.x - view.x) * ratio,
      y: anchor.y - (anchor.y - view.y) * ratio,
    },
    size,
  );
}

/** Translate the midpoint and preserve the logical page point under a two-finger pinch. */
export function moveInkGesture(
  view: InkView,
  before: InkViewPoint[],
  after: InkViewPoint[],
  size: InkViewportSize,
): InkView {
  if (!before.length || before.length !== after.length) return view;
  const midpoint = (points: InkViewPoint[]) =>
    points.length > 1
      ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
      : points[0];
  const from = midpoint(before);
  const to = midpoint(after);
  const distance = (points: InkViewPoint[]) =>
    Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  const ratio = before.length > 1 ? distance(after) / Math.max(1, distance(before)) : 1;
  const zoom = Math.min(MAX_INK_ZOOM, Math.max(MIN_INK_ZOOM, view.zoom * ratio));
  const actualRatio = zoom / view.zoom;
  return clampInkView(
    { zoom, x: to.x - (from.x - view.x) * actualRatio, y: to.y - (from.y - view.y) * actualRatio },
    size,
  );
}

export function resizeInkView(view: InkView, previous: InkViewportSize, next: InkViewportSize) {
  const ratio = inkPaperSize(next, view.zoom).width / inkPaperSize(previous, view.zoom).width;
  return clampInkView(
    {
      zoom: view.zoom,
      x: next.width / 2 - (previous.width / 2 - view.x) * ratio,
      y: next.height / 2 - (previous.height / 2 - view.y) * ratio,
    },
    next,
  );
}
