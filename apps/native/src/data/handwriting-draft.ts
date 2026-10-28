import { DEFAULT_INK_COLOR, type InkColor } from '../lib/ink-palette';
import Dexie, { type Table } from 'dexie';

export type InkPoint = { x: number; y: number; pressure: number };
export type InkStroke = {
  tool: 'pen' | 'eraser';
  width: number;
  color?: InkColor;
  points: InkPoint[];
};
export type HandwritingPage = { imageId: string; strokes: InkStroke[] };
export type HandwritingDocument = { pages: HandwritingPage[] };
export type HandwritingAnswer = HandwritingPage | HandwritingDocument;
export type HandwritingDraft = HandwritingDocument & {
  key: string;
  activePageId: string;
};
type LegacyHandwritingDraft = HandwritingPage & { key: string };
export const MAX_HANDWRITING_PAGES = 4;

export function handwritingPages(answer: HandwritingAnswer): HandwritingPage[] {
  return ('pages' in answer ? answer.pages : [answer])
    .slice(0, MAX_HANDWRITING_PAGES)
    .map(({ imageId, strokes }) => ({ imageId, strokes }));
}

export function handwritingHasContent(answer: HandwritingAnswer | undefined) {
  return (
    !!answer &&
    handwritingPages(answer).some((page) => page.strokes.some((stroke) => stroke.tool === 'pen'))
  );
}

export function createHandwritingDraft(
  key: string,
  stored?: HandwritingDraft | LegacyHandwritingDraft,
): HandwritingDraft {
  const pages = stored ? handwritingPages(stored) : [];
  if (!pages.length) pages.push({ imageId: crypto.randomUUID(), strokes: [] });
  const activePageId =
    stored && 'activePageId' in stored && pages.some((page) => page.imageId === stored.activePageId)
      ? stored.activePageId
      : pages[0].imageId;
  return { key, pages, activePageId };
}

export function appendHandwritingPage(draft: HandwritingDraft): HandwritingDraft {
  if (draft.pages.length >= MAX_HANDWRITING_PAGES) return draft;
  const page = { imageId: crypto.randomUUID(), strokes: [] };
  return { ...draft, pages: [...draft.pages, page], activePageId: page.imageId };
}
/** Remove one sheet and select its nearest remaining neighbor. */
export function removeHandwritingPage(draft: HandwritingDraft, imageId: string): HandwritingDraft {
  const index = draft.pages.findIndex((page) => page.imageId === imageId);
  if (draft.pages.length <= 1 || index < 0) return draft;
  const pages = draft.pages.filter((item) => item.imageId !== imageId);
  return {
    ...draft,
    pages,
    activePageId:
      draft.activePageId === imageId
        ? pages[Math.min(index, pages.length - 1)].imageId
        : draft.activePageId,
  };
}

export const INK_WIDTH = 1000;
export const INK_HEIGHT = 1200;
export const MAX_INK_POINTS = 100_000;

export function handwritingDraftKey(account: string, course: string, problem: string, part = '') {
  return JSON.stringify([account, course, problem, part]);
}

export function inkPoint(x: number, y: number, pressure: number): InkPoint {
  return {
    x: Math.max(0, Math.min(INK_WIDTH, x)),
    y: Math.max(0, Math.min(INK_HEIGHT, y)),
    pressure: Math.max(0.2, Math.min(1, pressure || 0.5)),
  };
}

export function drawInkSegment(
  context: CanvasRenderingContext2D,
  stroke: InkStroke,
  from: InkPoint,
  to: InkPoint,
) {
  context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  context.strokeStyle = stroke.color ?? DEFAULT_INK_COLOR;
  context.fillStyle = stroke.color ?? DEFAULT_INK_COLOR;
  context.lineWidth = stroke.width * (stroke.tool === 'pen' ? 0.6 + to.pressure : 1);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (from.x === to.x && from.y === to.y) {
    context.beginPath();
    context.arc(to.x, to.y, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }
}

export function redrawInk(context: CanvasRenderingContext2D, strokes: InkStroke[]) {
  context.clearRect(0, 0, INK_WIDTH, INK_HEIGHT);
  for (const stroke of strokes) {
    stroke.points.forEach((point, index) =>
      drawInkSegment(context, stroke, stroke.points[Math.max(0, index - 1)], point),
    );
  }
  context.globalCompositeOperation = 'source-over';
}

let drafts: Table<HandwritingDraft | LegacyHandwritingDraft, string> | undefined;
function table() {
  if (!drafts) {
    const db = new Dexie('syntara-handwriting-drafts-v1');
    db.version(1).stores({ drafts: 'key' });
    drafts = db.table('drafts');
  }
  return drafts;
}
export async function readHandwritingDraft(key: string) {
  return createHandwritingDraft(key, await table().get(key));
}
export function saveHandwritingDraft(draft: HandwritingDraft) {
  return table().put(draft);
}

export function clearHandwritingDrafts(key: string) {
  const partPrefix = JSON.stringify([key]).slice(0, -1) + ',';
  return table()
    .filter((draft) => draft.key === key || draft.key.startsWith(partPrefix))
    .delete();
}
