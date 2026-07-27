import type { PPTElement } from '@/lib/types/slides';
import { stripLegacyVerticalFlowMarkers } from '@/lib/utils/legacy-flow-markers';

const TITLE_BASELINE_LEFT = 64;
const FULL_ROW_BASELINE_WIDTH = 872;
const FULL_ROW_SNAP_MIN_WIDTH = 800;
const LEGACY_FULL_ROW_MIN_LEFT = 80;
const LEGACY_FULL_ROW_MAX_LEFT = 100;

type BoxGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function hasSlideBoxGeometry(element: PPTElement): element is PPTElement & BoxGeometry {
  return (
    typeof (element as { left?: unknown }).left === 'number' &&
    typeof (element as { top?: unknown }).top === 'number' &&
    typeof (element as { width?: unknown }).width === 'number' &&
    typeof (element as { height?: unknown }).height === 'number'
  );
}

function alignTwoCardLayoutRows(elements: PPTElement[]): PPTElement[] {
  const groups = new Map<string, Array<{ id: string; left: number; top: number; width: number }>>();
  elements.forEach((element) => {
    if (!hasSlideBoxGeometry(element)) return;
    if (!element.groupId?.startsWith('layout_cards_')) return;
    const list = groups.get(element.groupId) || [];
    list.push({ id: element.id, left: element.left, top: element.top, width: element.width });
    groups.set(element.groupId, list);
  });
  if (groups.size === 0) return elements;

  const next = elements.map((element) => ({ ...element })) as PPTElement[];
  const byId = new Map(next.map((element) => [element.id, element] as const));
  for (const cards of groups.values()) {
    if (cards.length !== 2) continue;
    const [a, b] = cards;
    const horizontalSplit = Math.abs(a.left - b.left) > Math.min(a.width, b.width) * 0.45;
    if (!horizontalSplit) continue;
    const oldBottom =
      Math.max(a.top, b.top) +
      Math.max(
        byId.get(a.id) && hasSlideBoxGeometry(byId.get(a.id) as PPTElement)
          ? (byId.get(a.id) as PPTElement & BoxGeometry).height
          : 0,
        byId.get(b.id) && hasSlideBoxGeometry(byId.get(b.id) as PPTElement)
          ? (byId.get(b.id) as PPTElement & BoxGeometry).height
          : 0,
      );
    const top = Math.min(a.top, b.top);
    const ae = byId.get(a.id);
    const be = byId.get(b.id);
    if (ae && hasSlideBoxGeometry(ae)) ae.top = top;
    if (be && hasSlideBoxGeometry(be)) be.top = top;
    const newBottom = Math.max(
      ae && hasSlideBoxGeometry(ae) ? ae.top + ae.height : oldBottom,
      be && hasSlideBoxGeometry(be) ? be.top + be.height : oldBottom,
    );
    const collapseDelta = Math.max(0, Math.round(oldBottom - newBottom));
    if (collapseDelta <= 0) continue;
    next.forEach((element) => {
      if (element.groupId === (ae?.groupId || be?.groupId)) return;
      if (element.type === 'line') {
        const minY = Math.min(element.start[1], element.end[1]);
        if (minY >= oldBottom - 1) {
          element.start = [element.start[0], element.start[1] - collapseDelta];
          element.end = [element.end[0], element.end[1] - collapseDelta];
        }
        return;
      }
      if (!hasSlideBoxGeometry(element)) return;
      if (element.top >= oldBottom - 1) {
        element.top -= collapseDelta;
      }
    });
  }
  return next;
}

export function prepareSlideDisplayElements(rawElements: PPTElement[]): PPTElement[] {
  const elements = stripLegacyVerticalFlowMarkers(rawElements);
  if (!elements.length) return elements;

  const baselineAdjusted = elements.map((element) => {
    if (!hasSlideBoxGeometry(element)) return element;
    const isTextFullRow =
      element.type === 'text' && (element.textType === 'title' || element.textType === 'notes');
    const isLatexFullRow = element.type === 'latex';
    if (!isTextFullRow && !isLatexFullRow) return element;
    if (element.width < FULL_ROW_SNAP_MIN_WIDTH) return element;
    if (element.left < LEGACY_FULL_ROW_MIN_LEFT || element.left > LEGACY_FULL_ROW_MAX_LEFT) {
      return element;
    }
    return {
      ...element,
      left: TITLE_BASELINE_LEFT,
      width: FULL_ROW_BASELINE_WIDTH,
    };
  });

  return alignTwoCardLayoutRows(baselineAdjusted);
}
