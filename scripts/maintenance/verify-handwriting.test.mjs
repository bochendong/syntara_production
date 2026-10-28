import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { createCanvas } from '@napi-rs/canvas';
const jiti = createJiti(import.meta.url);
const ink = await jiti.import('../../apps/native/src/data/handwriting-draft.ts');
const parts = await jiti.import('../../apps/native/src/data/multipart-problem.ts');
const photo = await jiti.import('../../lib/problem-bank/photo-answer.ts');
const capture = await jiti.import('../../apps/native/src/data/handwriting-answer.ts');

test('draft keys separate accounts, courses, problems and parts without delimiter collisions', () => {
  const keys = [
    ['a', 'c', 'p', 'i'],
    ['b', 'c', 'p', 'i'],
    ['a', 'd', 'p', 'i'],
    ['a', 'c', 'q', 'i'],
    ['a', 'c', 'p', 'ii'],
    ['a:c', 'p', 'i', ''],
  ].map((args) => ink.handwritingDraftKey(...args));
  assert.equal(new Set(keys).size, keys.length);
});
test('stroke coordinates stay inside the logical page, with bounded pressure', () => {
  assert.deepEqual(ink.inkPoint(-30, 1400, 0), { x: 0, y: 1200, pressure: 0.5 });
  assert.deepEqual(ink.inkPoint(500, 500, 2), { x: 500, y: 500, pressure: 1 });
});
test('pen taps and lines render, eraser removes ink, replay restores the exact image', () => {
  const canvas = createCanvas(ink.INK_WIDTH, ink.INK_HEIGHT);
  const context = canvas.getContext('2d');
  const pen = {
    tool: 'pen',
    width: 6,
    points: [
      { x: 100, y: 100, pressure: 0.5 },
      { x: 200, y: 100, pressure: 0.5 },
    ],
  };
  ink.redrawInk(context, [pen]);
  const original = canvas.toDataURL();
  assert.ok(context.getImageData(150, 100, 1, 1).data[3] > 0);
  const eraser = {
    tool: 'eraser',
    width: 30,
    points: [
      { x: 150, y: 80, pressure: 0.5 },
      { x: 150, y: 120, pressure: 0.5 },
    ],
  };
  ink.redrawInk(context, [pen, eraser]);
  assert.equal(context.getImageData(150, 100, 1, 1).data[3], 0);
  ink.redrawInk(context, [pen]);
  assert.equal(canvas.toDataURL(), original);
  ink.redrawInk(context, []);
  assert.equal(context.getImageData(150, 100, 1, 1).data[3], 0);
});
test('highlighter remains translucent across joints and survives replay and export', () => {
  const canvas = createCanvas(ink.INK_WIDTH, ink.INK_HEIGHT);
  const context = canvas.getContext('2d');
  const highlight = {
    tool: 'highlighter',
    color: '#e7a313',
    width: 30,
    points: [
      { x: 100, y: 100, pressure: 0.5 },
      { x: 150, y: 100, pressure: 0.5 },
      { x: 200, y: 100, pressure: 0.5 },
    ],
  };
  const page = { imageId: 'highlight', strokes: [highlight] };
  assert.equal(ink.handwritingHasContent(page), true);
  ink.redrawInk(context, page.strokes);
  const alpha = context.getImageData(125, 100, 1, 1).data[3];
  assert.ok(alpha > 0 && alpha < 255);
  assert.equal(context.getImageData(150, 100, 1, 1).data[3], alpha);
  const original = canvas.toDataURL();
  ink.redrawInk(context, []);
  ink.redrawInk(context, page.strokes);
  assert.equal(canvas.toDataURL(), original);
  assert.equal(capture.renderHandwritingPage(canvas, page), true);
  assert.equal(context.getImageData(125, 100, 1, 1).data[3], 255);
});
test('white-background handwriting export fits the existing image contract', () => {
  const canvas = createCanvas(ink.INK_WIDTH, ink.INK_HEIGHT);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, ink.INK_WIDTH, ink.INK_HEIGHT);
  context.fillStyle = 'black';
  context.fillText('x + y = 2', 100, 100);
  const dataUrl = canvas.toDataURL('image/jpeg');
  assert.equal(
    photo.isValidPhotoAnswerUpload({
      dataUrl,
      mimeType: 'image/jpeg',
      size: Buffer.from(dataUrl.split(',')[1], 'base64').length,
    }),
    true,
  );
});
test('image-only multipart answers count as content and defer calculation grading', () => {
  const image = {
    id: 'ink',
    name: 'ink.jpg',
    mimeType: 'image/jpeg',
    size: 3,
    dataUrl: 'data:image/jpeg;base64,YWJj',
  };
  assert.equal(parts.partAnswerHasContent({ images: [image] }), true);
  assert.equal(parts.partAnswerHasContent({ images: [] }), false);
  const result = parts.gradeLocalPart(
    { id: 'p' },
    { type: 'calculation', content: {}, grading: { referenceAnswer: '2' } },
    { text: 'wrong', images: [image] },
  );
  assert.equal(result.status, 'pending');
});

const grading = await jiti.import('../../apps/native/src/data/local-problem-grading.ts');
test('submission captures ink at the bottom of the full page, with a white background', () => {
  const page = {
    imageId: 'ink-page',
    strokes: [
      {
        tool: 'pen',
        width: 6,
        points: [
          { x: 100, y: 1150, pressure: 0.5 },
          { x: 800, y: 1150, pressure: 0.5 },
        ],
      },
    ],
  };
  const canvas = createCanvas(100, 100);
  assert.equal(capture.renderHandwritingPage(canvas, page), true);
  assert.equal(canvas.width, 1000);
  assert.equal(canvas.height, 1200);
  assert.deepEqual(
    [...canvas.getContext('2d').getImageData(20, 20, 1, 1).data],
    [255, 255, 255, 255],
  );
  assert.ok(canvas.getContext('2d').getImageData(400, 1150, 1, 1).data[0] < 100);
  assert.equal(grading.answerHasContent({ kind: 'text', text: '', handwriting: page }), true);
  assert.equal(parts.partAnswerHasContent({ handwriting: page }), true);
  assert.equal(capture.renderHandwritingPage(canvas, { imageId: 'empty', strokes: [] }), false);
});

const palette = await jiti.import('../../apps/native/src/lib/ink-palette.ts');
test('each ink color survives stroke replay and whole-page submission', () => {
  const canvas = createCanvas(1000, 1200);
  const context = canvas.getContext('2d');
  const strokes = palette.INK_PALETTE.map((ink, index) => ({
    tool: 'pen',
    width: 6,
    color: ink.color,
    points: [
      { x: 100, y: 100 + index * 100, pressure: 0.5 },
      { x: 800, y: 100 + index * 100, pressure: 0.5 },
    ],
  }));
  const page = { imageId: 'colored-page', strokes: JSON.parse(JSON.stringify(strokes)) };
  assert.equal(capture.renderHandwritingPage(canvas, page), true);
  palette.INK_PALETTE.forEach((ink, index) => {
    const expected = ink.color
      .slice(1)
      .match(/../g)
      .map((value) => parseInt(value, 16));
    assert.deepEqual(
      [...context.getImageData(400, 100 + index * 100, 1, 1).data],
      [...expected, 255],
    );
  });
  ink.redrawInk(context, [{ tool: 'pen', width: 6, points: [{ x: 100, y: 100, pressure: 0.5 }] }]);
  assert.deepEqual([...context.getImageData(100, 100, 1, 1).data], [23, 43, 77, 255]);
});

test('legacy one-page drafts migrate without changing their page ID or ink', () => {
  const old = {
    key: 'legacy',
    imageId: 'old-page',
    strokes: [{ tool: 'pen', width: 3, points: [{ x: 120, y: 1100, pressure: 0.5 }] }],
  };
  const migrated = ink.createHandwritingDraft(old.key, JSON.parse(JSON.stringify(old)));
  assert.equal(migrated.activePageId, 'old-page');
  assert.deepEqual(migrated.pages, [{ imageId: old.imageId, strokes: old.strokes }]);
  assert.deepEqual(old.strokes[0].points[0], { x: 120, y: 1100, pressure: 0.5 });
});

test('adding sheets is capped at four and preserves every prior page and its active-page selection on reload', () => {
  let draft = ink.createHandwritingDraft('four-pages');
  draft.pages[0].strokes.push({
    tool: 'pen',
    width: 3,
    points: [{ x: 100, y: 100, pressure: 0.5 }],
  });
  const first = structuredClone(draft.pages[0]);
  for (let i = 0; i < 3; i++) {
    const previous = draft;
    draft = ink.appendHandwritingPage(draft);
    assert.equal(draft.pages.length, previous.pages.length + 1);
    assert.equal(draft.activePageId, draft.pages.at(-1).imageId);
    assert.notEqual(draft, previous);
  }
  assert.deepEqual(draft.pages[0], first);
  assert.equal(new Set(draft.pages.map((page) => page.imageId)).size, 4);
  assert.equal(ink.appendHandwritingPage(draft), draft);
  assert.deepEqual(ink.createHandwritingDraft(draft.key, JSON.parse(JSON.stringify(draft))), draft);
});

test('ink on page four alone counts as content for single and multipart submissions', () => {
  let draft = ink.createHandwritingDraft('last-page');
  for (let i = 0; i < 3; i++) draft = ink.appendHandwritingPage(draft);
  assert.equal(ink.handwritingHasContent(draft), false);
  draft.pages[3].strokes.push({
    tool: 'pen',
    width: 3,
    points: [{ x: 200, y: 1150, pressure: 0.5 }],
  });
  const document = { pages: draft.pages };
  assert.equal(grading.answerHasContent({ kind: 'text', text: '', handwriting: document }), true);
  assert.equal(parts.partAnswerHasContent({ handwriting: document }), true);
  assert.equal(
    grading.answerHasContent({ kind: 'parts', parts: { i: { handwriting: document } } }),
    true,
  );
  assert.deepEqual(
    ink.handwritingPages(document).map((page) => page.imageId),
    draft.pages.map((page) => page.imageId),
  );
  const lastCanvas = createCanvas(100, 100);
  assert.equal(capture.renderHandwritingPage(lastCanvas, document.pages[3]), true);
  assert.ok(lastCanvas.getContext('2d').getImageData(200, 1150, 1, 1).data[0] < 100);
});

test('deleting an active first, middle or last sheet selects a neighbor and preserves all other ink', () => {
  let draft = ink.createHandwritingDraft('delete-pages');
  for (let i = 0; i < 3; i++) draft = ink.appendHandwritingPage(draft);
  draft.pages.forEach((page, index) =>
    page.strokes.push({
      tool: 'pen',
      width: 3,
      points: [{ x: 100, y: 100 + index * 100, pressure: 0.5 }],
    }),
  );
  const original = structuredClone(draft);
  for (const index of [0, 1, 3]) {
    const selected = { ...draft, activePageId: draft.pages[index].imageId };
    const removed = ink.removeHandwritingPage(selected, selected.activePageId);
    assert.deepEqual(
      removed.pages,
      draft.pages.filter((_, i) => i !== index),
    );
    assert.equal(removed.activePageId, removed.pages[Math.min(index, 2)].imageId);
    assert.equal('deletedPage' in removed, false);
  }
  assert.deepEqual(draft, original);
});

test('the last sheet and unknown page IDs cannot be removed', () => {
  const single = ink.createHandwritingDraft('minimum-page');
  assert.equal(ink.removeHandwritingPage(single, single.activePageId), single);
  const two = ink.appendHandwritingPage(single);
  assert.equal(ink.removeHandwritingPage(two, 'missing-id'), two);
});

test('normalizing older drafts ignores obsolete deletion-recovery metadata', () => {
  const draft = ink.createHandwritingDraft('old-recovery');
  const stored = {
    ...draft,
    deletedPage: {
      page: {
        imageId: 'old-deleted-page',
        strokes: [{ tool: 'pen', width: 3, points: [{ x: 100, y: 100, pressure: 0.5 }] }],
      },
      index: 1,
    },
  };
  const normalized = ink.createHandwritingDraft(draft.key, JSON.parse(JSON.stringify(stored)));
  assert.deepEqual(normalized, draft);
  assert.equal(ink.handwritingHasContent(normalized), false);
  assert.ok(!JSON.stringify(normalized).includes('old-deleted-page'));
});

test('deleted ink is excluded from submission content and page lists; adding after deletion still respects the four-page limit', () => {
  let draft = ink.createHandwritingDraft('deleted-content');
  for (let i = 0; i < 3; i++) draft = ink.appendHandwritingPage(draft);
  draft.pages[3].strokes.push({
    tool: 'pen',
    width: 3,
    points: [{ x: 200, y: 1150, pressure: 0.5 }],
  });
  const removed = ink.removeHandwritingPage(draft, draft.activePageId);
  assert.equal(ink.handwritingHasContent(removed), false);
  assert.equal(ink.handwritingPages(removed).length, 3);
  assert.ok(!ink.handwritingPages(removed).some((page) => page.imageId === draft.activePageId));
  const added = ink.appendHandwritingPage(removed);
  assert.equal(added.pages.length, 4);
  assert.equal(ink.appendHandwritingPage(added), added);
});
