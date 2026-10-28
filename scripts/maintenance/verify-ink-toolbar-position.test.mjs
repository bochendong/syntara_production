import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { clampInkToolbar, dockInkToolbar, nearestInkToolbarCorner } = await jiti.import(
  '../../apps/native/src/lib/ink-toolbar-position.ts',
);
const area = { width: 1000, height: 600 };
const toolbar = { width: 500, height: 60 };
test('all four docks keep the complete toolbar inside the canvas', () => {
  const expected = {
    'top-left': { x: 10, y: 10 },
    'top-right': { x: 490, y: 10 },
    'bottom-left': { x: 10, y: 530 },
    'bottom-right': { x: 490, y: 530 },
  };
  for (const [corner, point] of Object.entries(expected)) {
    assert.deepEqual(dockInkToolbar(corner, area, toolbar), point);
    assert.equal(nearestInkToolbarCorner(point, area, toolbar), corner);
  }
});
test('dragging beyond the panel is clamped and snaps to the nearest corner', () => {
  assert.deepEqual(clampInkToolbar({ x: -500, y: 900 }, area, toolbar), { x: 10, y: 530 });
  assert.equal(nearestInkToolbarCorner({ x: 400, y: 480 }, area, toolbar), 'bottom-right');
});
test('resizing reanchors docks and tiny surfaces never produce negative positions', () => {
  assert.deepEqual(
    dockInkToolbar('bottom-right', { width: 360, height: 400 }, { width: 340, height: 100 }),
    { x: 10, y: 290 },
  );
  assert.deepEqual(dockInkToolbar('bottom-right', { width: 100, height: 40 }, toolbar), {
    x: 0,
    y: 0,
  });
});
test('collapse and expansion preserve every corner and the same 10px edge inset', () => {
  const expanded = { width: 812, height: 56 };
  const collapsed = { width: 60, height: 60 };
  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    for (const size of [expanded, collapsed, expanded]) {
      const point = dockInkToolbar(corner, area, size);
      assert.equal(nearestInkToolbarCorner(point, area, size), corner);
      assert.equal(corner.endsWith('left') ? point.x : area.width - point.x - size.width, 10);
      assert.equal(corner.startsWith('top') ? point.y : area.height - point.y - size.height, 10);
      assert.deepEqual(clampInkToolbar(point, area, size), point);
    }
  }
});

test('docked toolbar has no stale measured position through collapse, expansion and dragging', async () => {
  const { readFileSync } = await import('node:fs');
  const { default: ts } = await import('typescript');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const saved = new Map([
    ['syntara.handwriting-toolbar-corner.v1', 'bottom-right'],
    ['syntara.handwriting-toolbar-collapsed.v1', 'true'],
  ]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
    },
  });
  const slots = [];
  let index = 0;
  const react = {
    useRef: (initial) => slots[index++] ?? (slots[index - 1] = { current: initial }),
    useState: (initial) => {
      const at = index++;
      slots[at] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [
        slots[at].value,
        (next) => (slots[at].value = typeof next === 'function' ? next(slots[at].value) : next),
      ];
    },
  };
  const mod = { exports: {} };
  const code = ts.transpileModule(
    readFileSync('apps/native/src/components/problem-bank/use-floating-ink-toolbar.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  new Function('require', 'module', 'exports', code)(
    (id) => (id === 'react' ? react : { clampInkToolbar, dockInkToolbar, nearestInkToolbarCorner }),
    mod,
    mod.exports,
  );
  let hook;
  const render = () => {
    index = 0;
    hook = mod.exports.useFloatingInkToolbar();
    return hook;
  };
  try {
    render();
    hook.panelRef.current = { getBoundingClientRect: () => ({ ...area, left: 100, top: 100 }) };
    hook.toolbarRef.current = {
      getBoundingClientRect: () => {
        const size = hook.collapsed ? { width: 60, height: 60 } : { width: 812, height: 56 };
        const point = hook.style ?? dockInkToolbar(hook.corner, area, size);
        return { ...size, left: 100 + (point.left ?? point.x), top: 100 + (point.top ?? point.y) };
      },
    };
    assert.equal(hook.corner, 'bottom-right');
    assert.equal(hook.style, undefined, 'CSS corner anchors apply on the first render');
    hook.setCollapsed(false);
    render();
    assert.equal(hook.style, undefined, 'expansion cannot retain the marble left/top coordinates');
    hook.setCollapsed(true);
    render();
    assert.equal(hook.style, undefined);
    hook.setCollapsed(false);
    render();
    const target = { setPointerCapture() {}, hasPointerCapture: () => false };
    const event = (x, y) => ({
      button: 0,
      pointerId: 1,
      clientX: x,
      clientY: y,
      currentTarget: target,
      preventDefault() {},
      stopPropagation() {},
    });
    hook.handleProps.onPointerDown(event(290, 646));
    hook.handleProps.onPointerMove(event(122, 122));
    render();
    assert.deepEqual(hook.style, { left: 10, top: 10, right: 'auto', bottom: 'auto' });
    hook.handleProps.onPointerUp(event(122, 122));
    render();
    assert.equal(hook.corner, 'top-left');
    assert.equal(
      hook.style,
      undefined,
      'docking restores CSS positioning before any size measurement',
    );
    hook.setCollapsed(true);
    render();
    hook.setCollapsed(false);
    render();
    assert.equal(hook.corner, 'top-left');
    assert.equal(hook.style, undefined);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});
