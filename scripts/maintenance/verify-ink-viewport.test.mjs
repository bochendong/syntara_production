import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const viewport = await jiti.import('../../apps/native/src/lib/ink-viewport.ts');
const { clampInkView, inkPaperSize, moveInkGesture, resetInkView, resizeInkView, zoomInkView } =
  viewport;
const size = { width: 800, height: 600 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.00001, `${a} ≠ ${b}`);
const pagePoint = (view, point, area = size) => {
  const paper = inkPaperSize(area, view.zoom);
  return { x: (point.x - view.x) / paper.width, y: (point.y - view.y) / paper.height };
};

test('fit width keeps the complete page accessible and zoom is limited to 50–400%', () => {
  assert.deepEqual(resetInkView(size), { zoom: 1, x: 8, y: 8 });
  const enlarged = zoomInkView(resetInkView(size), 100, { x: 400, y: 300 }, size);
  assert.equal(enlarged.zoom, 4);
  const reduced = zoomInkView(enlarged, 0.01, { x: 400, y: 300 }, size);
  assert.equal(reduced.zoom, 0.5);
  near(reduced.x, (size.width - inkPaperSize(size, 0.5).width) / 2);
  const bottomRight = clampInkView({ zoom: 4, x: -1e6, y: -1e6 }, size);
  const paper = inkPaperSize(size, 4);
  near(bottomRight.x + paper.width, size.width - 8);
  near(bottomRight.y + paper.height, size.height - 8);
});

test('zoom around a pointer preserves its logical page coordinate, including repeated inverse zooms', () => {
  const anchor = { x: 320, y: 240 };
  let view = resetInkView(size);
  const original = pagePoint(view, anchor);
  for (const zoom of [2, 3, 1.25, 4, 1]) {
    view = zoomInkView(view, zoom, anchor, size);
    const actual = pagePoint(view, anchor);
    near(actual.x, original.x);
    near(actual.y, original.y);
  }
});

test('two-finger pinch combines midpoint translation and distance scaling without shifting the anchored ink', () => {
  const before = [
    { x: 200, y: 200 },
    { x: 400, y: 200 },
  ];
  const after = [
    { x: 150, y: 260 },
    { x: 550, y: 260 },
  ];
  const initial = resetInkView(size);
  const next = moveInkGesture(initial, before, after, size);
  assert.equal(next.zoom, 2);
  const anchored = pagePoint(initial, { x: 300, y: 200 });
  const moved = pagePoint(next, { x: 350, y: 260 });
  near(moved.x, anchored.x);
  near(moved.y, anchored.y);
  // After one finger lifts, navigation continues as pan without changing zoom.
  const pan = moveInkGesture(next, [after[0]], [{ x: 110, y: 220 }], size);
  assert.equal(pan.zoom, 2);
  near(pan.x, next.x - 40);
  near(pan.y, next.y - 40);
});

test('pinch limits do not keep moving the page after zoom reaches a bound', () => {
  const view = { zoom: 4, x: -800, y: -900 };
  const next = moveInkGesture(
    view,
    [
      { x: 200, y: 300 },
      { x: 400, y: 300 },
    ],
    [
      { x: 100, y: 300 },
      { x: 500, y: 300 },
    ],
    size,
  );
  assert.deepEqual(next, view);
});

test('resizing the answer pane preserves zoom and the logical point at the viewport center', () => {
  const previous = { zoom: 2, x: -400, y: -600 };
  const nextSize = { width: 600, height: 700 };
  const next = resizeInkView(previous, size, nextSize);
  assert.equal(next.zoom, previous.zoom);
  const from = pagePoint(previous, { x: size.width / 2, y: size.height / 2 });
  const to = pagePoint(next, { x: nextSize.width / 2, y: nextSize.height / 2 }, nextSize);
  near(from.x, to.x);
  near(from.y, to.y);
});

test('touch always navigates while pen and mouse reach the drawing surface without a mode switch', async () => {
  const { readFileSync } = await import('node:fs');
  const { default: ts } = await import('typescript');
  const effects = [],
    states = [];
  const react = {
    useRef: (current) => ({ current }),
    useState: (initial) => {
      const i = states.push(initial) - 1;
      return [initial, (next) => (states[i] = next)];
    },
    useEffect: (effect) => effects.push(effect),
    useLayoutEffect: (effect) => effects.push(effect),
  };
  const mod = { exports: {} };
  const code = ts.transpileModule(
    readFileSync('apps/native/src/components/problem-bank/use-ink-viewport.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  new Function('require', 'module', 'exports', code)(
    (id) => (id === 'react' ? react : viewport),
    mod,
    mod.exports,
  );
  let writing = false;
  const hook = mod.exports.useInkViewport({ disabled: false, penIsDrawing: () => writing });
  const captured = [];
  const area = {
    clientWidth: 1000,
    clientHeight: 700,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: (id) => captured.push(id),
    addEventListener() {},
    removeEventListener() {},
  };
  hook.areaRef.current = area;
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const cleanups = [];
  try {
    for (const effect of effects) cleanups.push(effect());
    const event = (type, id, x, y) => ({
      pointerType: type,
      pointerId: id,
      clientX: x,
      clientY: y,
      currentTarget: area,
      button: 0,
      consumed: false,
      preventDefault() {
        this.consumed = true;
      },
      stopPropagation() {},
    });
    const nav = hook.navigationProps;
    let e = event('touch', 1, 100, 300);
    nav.onPointerDownCapture(e);
    assert.equal(e.consumed, true);
    e = event('touch', 1, 100, 200);
    nav.onPointerMoveCapture(e);
    assert.equal(states[0].y, -92);
    assert.equal(e.consumed, true);
    nav.onPointerDownCapture(event('touch', 2, 300, 200));
    nav.onPointerMoveCapture(event('touch', 2, 500, 200));
    assert.equal(states[0].zoom, 2);
    assert.deepEqual(captured, [1, 2]);
    e = event('pen', 3, 200, 200);
    nav.onPointerDownCapture(e);
    assert.equal(e.consumed, false);
    writing = true;
    const before = { ...states[0] };
    e = event('touch', 4, 300, 300);
    nav.onPointerDownCapture(e);
    assert.equal(e.consumed, true);
    nav.onPointerMoveCapture(event('touch', 1, 100, 100));
    assert.deepEqual(states[0], before);
    writing = false;
    nav.onPointerMoveCapture(event('touch', 1, 100, 50));
    assert.deepEqual(states[0], before, 'resting fingers cleared by the pen cannot resume panning');
    e = event('mouse', 5, 200, 200);
    nav.onPointerDownCapture(e);
    assert.equal(e.consumed, false, 'desktop mouse drawing still works');
    assert.ok(!('hand' in hook));
    assert.ok(!('setHand' in hook));
  } finally {
    for (const cleanup of cleanups) cleanup?.();
    if (original === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = original;
  }
});
