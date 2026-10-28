import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { createJiti } from 'jiti';
const require = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url);
const data = await jiti.import('../../apps/native/src/data/multipart-problem.ts');
const codeSlots = await jiti.import('../../lib/problem-bank/code-slots.ts');
let formulaPart;
const stub = () => null;
const visibleTests = await jiti.import('../../lib/problem-bank/visible-code-tests.ts');
const mocks = {
  '../../../../../lib/problem-bank/visible-code-tests': visibleTests,
  '../../data/multipart-problem': data,
  '../../lib/learning-action-marbles': { marbleImages: {} },
  '../GlassLoadMore': { GlassSpinner: stub },
  './answer-sheet': { STATUS_MARBLES: {} },
  './problem-rich-text': {
    ProblemRichText: ({ content }) => React.createElement('p', null, content),
  },
  './native-table-answer': {
    NativeTableAnswer: () => React.createElement('table', { 'data-answer': 'table' }),
  },
  './native-code-slots': {
    NativeCodeSlots: () => React.createElement('div', { 'data-answer': 'code' }),
  },
  './native-code-playground': { NativeCodePlayground: stub },
  './code-answer-editor': { CodeAnswerEditor: stub },
  '../../../../../lib/problem-bank/code-slots': codeSlots,
  '../../../../../lib/problem-bank/use-part-formula-editor': {
    usePartFormulaEditor: ({ visiblePartLabel }) => {
      formulaPart = visiblePartLabel;
      return { insertFormula: stub, registerEditor: stub, activateEditor: stub };
    },
  },
  '../../../../../lib/problem-bank/part-text-answer': {
    PartTextAnswer: ({ label, value }) =>
      React.createElement('textarea', { 'aria-label': label, defaultValue: value }),
  },
};
const source = ts.transpileModule(
  readFileSync('apps/native/src/components/problem-bank/multipart-practice.tsx', 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  },
).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', source)(
  (id) => (id in mocks ? mocks[id] : require(id)),
  mod,
  mod.exports,
);
const { MultipartPractice } = mod.exports;
const types = ['code', 'short_answer', 'proof', 'calculation', 'choice', 'fill_blank', 'table'];
const parts = types.map((type, index) => ({
  label: String.fromCharCode(97 + index),
  type,
  points: 1,
  dependsOn: [],
  prompt: `${type} question {{blank}}`,
  grading: {},
  content: {
    type,
    stem: `${type} question`,
    blanks: [{ id: 'blank' }],
    options: [{ id: 'A', label: 'Option A' }],
    template: 'def answer():\n    {{body}}',
    slots: [{ id: 'body', kind: 'block' }],
  },
}));
for (const paged of [false, true]) {
  test(`${paged ? 'narrow' : 'wide'} layout renders only the selected part with its answer control`, () => {
    for (const part of parts) {
      const html = renderToStaticMarkup(
        React.createElement(MultipartPractice, {
          parts,
          activePartLabel: part.label,
          paged,
          drafts: { [part.label]: { text: 'saved draft' } },
          saved: {},
          results: [],
          submitting: false,
          error: null,
          onChange: stub,
          onSubmit: stub,
        }),
      );
      assert.equal((html.match(/<article/g) ?? []).length, 1);
      assert.match(html, new RegExp(`id="mp-part-${part.label}"`));
      assert.equal(formulaPart, part.label);
      if (['short_answer', 'proof', 'calculation'].includes(part.type))
        assert.match(html, /saved draft/);
      if (part.type === 'code') assert.match(html, /data-answer="code"/);
      if (part.type === 'table') assert.match(html, /data-answer="table"/);
      if (part.type === 'choice') assert.match(html, /Option A/);
      if (part.type === 'fill_blank') assert.match(html, /填这一空/);
    }
  });
}
