import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function('require', 'module', 'exports', code)(
    (name) => dependencies[name] ?? require(name),
    module,
    module.exports,
  );
  return module.exports;
}
const structure = load('lib/problem-bank/markdown-structure.ts');
const { renderProblemRichTextHtml: render } = load(
  'components/problem-bank/problem-rich-text.tsx',
  {
    '@/lib/problem-bank/markdown-structure': structure,
    '@/lib/render-html-with-latex': { renderHtmlWithLatex: (x) => x },
    '@/lib/math-engine': {},
    '@/lib/utils': {},
  },
);
const legacy = [
  'Preserve the line breaks in each answer.',
  '',
  '| Code | What is printed |',
  '|---|---|',
  '| ```python',
  "for vowel in 'aeiou':",
  '    print(vowel)',
  'print(vowel)',
  '``` | {{first}} |',
  '| ```python',
  "s = 'cat'",
  'for c in s:',
  '    print(c * len(s))',
  '``` | {{second}} |',
].join('\n');
const expanded = structure.expandLegacyCodeTables(legacy);
assert(expanded.includes("for vowel in 'aeiou':\n    print(vowel)\nprint(vowel)"));
assert(expanded.includes('{{first}}') && expanded.includes('{{second}}'));
assert.equal(structure.expandLegacyCodeTables(expanded), expanded);
const html = render(legacy);
assert.equal((html.match(/<pre /g) || []).length, 2);
assert(!html.includes('```') && !html.includes('|---|'));
assert(html.includes('    <span') && html.includes('{{first}}'));
const breaks = render('| Doctest | Answer |\n|---|---|\n| `>>> f()`<br>`1`<BR />`2` | {{a}} |');
assert(breaks.includes('</code><br/><code'));
assert(!breaks.includes('&lt;br'));
const literals = render(
  '`<br>`\n\n```html\n<br>\n```\n\n<img src=x onerror=alert(1)><br onclick=alert(1)>',
);
assert(literals.includes('&lt;br&gt;'));
assert(!literals.includes('<img') && !literals.includes('<br onclick'));
const nested = '````text\n' + legacy + '\n````';
assert.equal(structure.expandLegacyCodeTables(nested), nested);
const incomplete = legacy.replace('``` | {{second}} |', '');
assert.equal(structure.expandLegacyCodeTables(incomplete), incomplete);
const { problemContentReadinessErrors } = load('lib/problem-bank/content-readiness.ts');
const draft = {
  publicContent: { type: 'short_answer', stem: legacy },
  grading: { type: 'short_answer' },
};
assert(problemContentReadinessErrors(draft).some((e) => e.includes('多行代码不得')));
assert.deepEqual(
  problemContentReadinessErrors({
    ...draft,
    publicContent: { ...draft.publicContent, stem: expanded },
  }),
  [],
);
console.log(
  'PASS: legacy code table, indentation, blank preservation, line breaks, escaped HTML, fence protection, incomplete data and generation rejection',
);
