import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const dataUrl = (value) => 'data:text/javascript;base64,' + Buffer.from(value).toString('base64');
const file = new URL('../../apps/native/src/components/CourseToolsMenu.tsx', import.meta.url);
let source = ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
source = source.replace(/from ['"]([^'"]+)['"]/g, (_, name) => {
  if (name === 'react-dom')
    return `from '${dataUrl('export const createPortal=(children)=>children;')}'`;
  if (name.endsWith('use-back-dismiss'))
    return `from '${dataUrl('export const useBackDismiss=()=>{};')}'`;
  if (name.endsWith('LearningToolIcon'))
    return `from '${dataUrl('export const LearningToolIcon=()=>null;')}'`;
  return `from '${import.meta.resolve(name)}'`;
});
const { CourseToolsMenu } = await import(dataUrl(source));
for (const width of [390, 834, 1440]) {
  test(`actual course menu exposes all six tools at ${width}px`, () => {
    const previous = globalThis.window;
    const previousDocument = globalThis.document;
    globalThis.document = { body: {} };
    globalThis.window = { innerWidth: width, innerHeight: 844 };
    try {
      const html = renderToStaticMarkup(
        React.createElement(CourseToolsMenu, {
          anchor: {
            getBoundingClientRect: () => ({
              left: 50,
              right: 180,
              top: 10,
              bottom: 44,
              width: 130,
            }),
          },
          courseName: 'Fixture',
          onSelect() {},
          onClose() {},
        }),
      );
      assert.equal((html.match(/role="menuitem"/g) ?? []).length, 6);
      for (const name of ['资料', '笔记', '学习进度', '学习记忆', '课堂', '题库'])
        assert.ok(html.includes(`>${name}<`));
    } finally {
      globalThis.window = previous;
      globalThis.document = previousDocument;
    }
  });
}
