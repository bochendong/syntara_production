import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const output = ts.transpileModule(
  readFileSync('components/problem-bank/code-answer-editor.tsx', 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  },
).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', output)(
  (name) => {
    if (name === 'react') return { ...require('react'), useRef: () => ({ current: null }) };
    if (name === '@/lib/utils') return { cn: (...values) => values.filter(Boolean).join(' ') };
    return require(name);
  },
  loaded,
  loaded.exports,
);
globalThis.requestAnimationFrame = (callback) => callback();
const findTextarea = (node) => {
  if (node?.type === 'textarea') return node;
  for (const child of [node?.props?.children].flat(Infinity)) {
    if (child && typeof child === 'object') {
      const found = findTextarea(child);
      if (found) return found;
    }
  }
};
function key(value, start, end, key, flags = {}) {
  let nextValue = value;
  const element = loaded.exports.CodeAnswerEditor({
    value,
    onChange: (next) => {
      nextValue = next;
    },
    locale: 'zh-CN',
  });
  const target = { selectionStart: start, selectionEnd: end };
  let prevented = false;
  findTextarea(element).props.onKeyDown({
    key,
    currentTarget: target,
    nativeEvent: {},
    preventDefault: () => {
      prevented = true;
    },
    ...flags,
  });
  return { value: nextValue, start: target.selectionStart, end: target.selectionEnd, prevented };
}
for (const [open, close] of Object.entries({ '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" })) {
  assert.deepEqual(key('', 0, 0, open), { value: open + close, start: 1, end: 1, prevented: true });
  assert.equal(key('name', 0, 4, open).value, open + 'name' + close);
  assert.equal(key(open + close, 1, 1, close).start, 2);
  assert.equal(key(open + close, 1, 1, 'Backspace').value, '');
}
assert.equal(key('def run():', 10, 10, 'Enter').value, 'def run():\n    ');
assert.equal(key('[]', 1, 1, 'Enter').value, '[\n    \n]');
assert.equal(key('x', 1, 1, 'Backspace').prevented, false);
assert.equal(key('', 0, 0, 'Tab').value, '    ');
assert.equal(key('    x', 5, 5, 'Tab', { shiftKey: true }).value, 'x');
assert.equal(key('', 0, 0, '(', { nativeEvent: { isComposing: true } }).prevented, false);
assert.equal(key('', 0, 0, '[', { metaKey: true }).prevented, false);
console.log(
  'PASS editor pairs, selection wrapping, skip closing, paired deletion, auto-indent, Tab and IME/shortcut handling',
);
