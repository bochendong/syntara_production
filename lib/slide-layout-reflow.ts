import type { PPTElement } from '@/lib/types/slides';

type BoxElement = PPTElement & { left: number; top: number; width: number; height: number };

function hasBoxGeometry(element: PPTElement): element is BoxElement {
  return (
    typeof (element as { left?: unknown }).left === 'number' &&
    typeof (element as { top?: unknown }).top === 'number' &&
    typeof (element as { width?: unknown }).width === 'number' &&
    typeof (element as { height?: unknown }).height === 'number'
  );
}

function overlapsHorizontally(a: BoxElement, b: BoxElement): boolean {
  const aRight = a.left + a.width;
  const bRight = b.left + b.width;
  return Math.max(a.left, b.left) < Math.min(aRight, bRight);
}

export function applyAutoHeightReflow(args: {
  elements: PPTElement[];
  requestedHeights: Record<string, number>;
}): PPTElement[] {
  const cloned = args.elements.map((element) => ({ ...element })) as PPTElement[];
  const candidateIds = Object.keys(args.requestedHeights);
  if (candidateIds.length === 0) return cloned;

  for (const elementId of candidateIds) {
    const index = cloned.findIndex((element) => element.id === elementId);
    if (index < 0) continue;
    const target = cloned[index];
    if (!hasBoxGeometry(target)) continue;

    const desired = Math.ceil(args.requestedHeights[elementId] || 0);
    if (!Number.isFinite(desired)) continue;
    if (desired <= target.height + 1) continue;

    const oldHeight = target.height;
    const delta = desired - oldHeight;
    const oldBottom = target.top + oldHeight;
    target.height = desired;

    for (let i = 0; i < cloned.length; i += 1) {
      if (i === index) continue;
      const candidate = cloned[i];
      if (!hasBoxGeometry(candidate)) continue;
      if (candidate.top < oldBottom - 1) continue;
      if (!overlapsHorizontally(target, candidate)) continue;
      candidate.top += delta;
    }
  }

  return cloned;
}
