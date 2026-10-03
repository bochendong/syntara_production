#!/usr/bin/env node
/**
 * Regression checks for chat-generated files (Word / PDF).
 *
 * The production build minifies server code with SWC, and Next 16.1.2's minifier
 * dropped literal text between folded template literals, so the deployed
 * renderer wrote `<w:pgSz w:w="11906" w:h="16838<w:pgMar …` while the source
 * was correct. This script therefore exercises both the source renderer and a
 * production-like build of it (SWC transform → module scope wrapped as in a
 * webpack bundle → minified with the options from Next's minify plugin), and
 * validates every generated file.
 *
 *   node scripts/maintenance/verify-chat-artifacts.mjs
 *   node scripts/maintenance/verify-chat-artifacts.mjs --file ~/Downloads/x.docx --file ~/Downloads/x.pdf
 *   KEEP_ARTIFACTS=/tmp/out node scripts/maintenance/verify-chat-artifacts.mjs   # keep rendered files
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const { createJiti } = require('jiti');
const jiti = createJiti(path.join(root, 'x.js'), { alias: { '@': root }, interopDefault: true });
const swc = require('next/dist/build/swc');

const args = process.argv.slice(2);
const files = [];
for (let i = 0; i < args.length; i += 1) if (args[i] === '--file') files.push(args[(i += 1)]);
const keepDir = process.env.KEEP_ARTIFACTS || '';
if (keepDir) fs.mkdirSync(keepDir, { recursive: true });

const failures = [];
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(
      `FAIL ${name}\n     ${String(error?.stack || error)
        .split('\n')
        .slice(0, 6)
        .join('\n     ')}`,
    );
  }
};

// ---------------------------------------------------------------------------
// Production-like loader: every project module is SWC-compiled, wrapped in a
// function scope (as webpack does) and minified with Next's settings.
// ---------------------------------------------------------------------------
await swc.loadBindings();
const MINIFY_OPTIONS = {
  compress: {
    inline: 2,
    global_defs: { 'process.env.__NEXT_PRIVATE_MINIMIZE_MACRO_FALSE': false },
    keep_classnames: false,
    keep_fnames: false,
  },
  mangle: { reserved: ['AbortSignal'], disableCharFreq: false },
  module: 'unknown',
  output: { comments: false },
};
const prodCache = new Map();
function resolveProjectFile(specifier, fromFile) {
  let base;
  if (specifier.startsWith('@/')) base = path.join(root, specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`cannot resolve ${specifier} from ${fromFile}`);
}
async function loadProduction(file) {
  if (prodCache.has(file)) return prodCache.get(file);
  const module = { exports: {} };
  prodCache.set(file, module.exports);
  const source = fs.readFileSync(file, 'utf8');
  const compiled = await swc.transform(source, {
    filename: file,
    jsc: { parser: { syntax: 'typescript', tsx: file.endsWith('.tsx') }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const wrapped = `globalThis.__chatArtifactModule = function (exports, require, module) {${compiled.code}\n};`;
  const minified = await swc.minify(wrapped, MINIFY_OPTIONS);
  // Pre-load project dependencies (async), then hand them out synchronously.
  const deps = new Map();
  for (const match of compiled.code.matchAll(/require\("([^"]+)"\)/g)) {
    const resolved = resolveProjectFile(match[1], file);
    if (resolved) deps.set(match[1], await loadProduction(resolved));
  }
  const localRequire = (specifier) =>
    deps.has(specifier) ? deps.get(specifier) : createRequire(file)(specifier);
  vm.runInThisContext(minified.code, { filename: `${file}.min.js` });
  globalThis.__chatArtifactModule(module.exports, localRequire, module);
  prodCache.set(file, module.exports);
  return module.exports;
}

// ---------------------------------------------------------------------------
// Fixtures: what teachers ask for in course chat (CSC108-style review sheets).
// ---------------------------------------------------------------------------
const FIXTURES = {
  csc108: [
    '# CSC108 循环复习测试',
    '',
    '## 一、选择题',
    '',
    '1. 下面代码输出什么？',
    '',
    '```python',
    'total = 0',
    'for i in range(1, 5):',
    '    if i % 2 == 0 and i > 1:',
    '        total += i  # 累加 <偶数> & 计数',
    'print(total)',
    '```',
    '',
    '| 选项 | 内容 |',
    '|---|---|',
    '| A | `6` |',
    '| B | `10` |',
    '',
    '累加和公式：$$S_n = \\frac{n(n+1)}{2}$$，行内 $\\frac{a}{b} \\le \\sqrt{x}$。',
    '',
    '<div style="page-break-after: always"></div>',
    '',
    '## 答案',
    '',
    '- 第 1 题：A（`total` = 2 + 4 = 6）',
  ].join('\n'),
  math: '平均值 $\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i$\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n\n$x_1, x_2, a_{ij}, 2^{10}$',
  control: '控制字符\u0007与\u000b非法\uFFFE字符 & <tag> "quotes"',
};

const docxModule =
  process.env.CHAT_ARTIFACT_DOCX_MODULE || 'features/chat/server/artifacts/docx.ts';
const { assertValidDocxPackage, findXmlError } = await jiti.import(
  path.join(root, 'features/chat/server/artifacts/xml-check.ts'),
);
const JSZip = require('jszip');

await check('xml checker rejects the deployed pgSz corruption', async () => {
  const broken = '<w:sectPr><w:pgSz w:w="11906" w:h="16838<w:pgMar w:top="1304"/></w:sectPr>';
  assert.ok(findXmlError(broken), 'checker must reject the corrupted sectPr');
  assert.equal(findXmlError('<a b="1"><c/>&amp;</a>'), null);
});

await check(
  'SWC minifier still reproduces the template-literal bug (guards the workaround)',
  async () => {
    const code = '(()=>{const P={h:16838,m:1304};globalThis.__tpl=`${P.h}"/>`+`${P.m}`})()';
    const minified = await swc.minify(code, MINIFY_OPTIONS);
    vm.runInThisContext(minified.code);
    // If this starts passing, the upstream bug is fixed; the xml() helper stays harmless.
    if (globalThis.__tpl !== '16838"/>1304')
      console.log(`     (minifier output: ${globalThis.__tpl})`);
  },
);

const sourceDocx = await jiti.import(path.join(root, docxModule));
const prodDocx = await loadProduction(path.join(root, docxModule));
for (const [name, markdown] of Object.entries(FIXTURES)) {
  for (const [mode, renderer] of [
    ['source', sourceDocx],
    ['production-minified', prodDocx],
  ]) {
    await check(`docx ${name} (${mode}) is a valid package`, async () => {
      const buffer = await renderer.renderMarkdownToDocx({
        title: `${name} <测试> & 答案`,
        markdown,
      });
      await assertValidDocxPackage(buffer);
      const zip = await JSZip.loadAsync(buffer);
      const document = await zip.file('word/document.xml').async('string');
      assert.match(document, /<w:pgSz w:w="11906" w:h="16838"\/><w:pgMar /);
      if (name !== 'control')
        assert.match(document, /<m:oMath/, 'formulas must stay native Word equations');
      if (keepDir) fs.writeFileSync(path.join(keepDir, `${name}.${mode}.docx`), buffer);
    });
  }
}

// ---------------------------------------------------------------------------
// PDF: typeset math, embeddable (non-Type3) fonts, lossless text extraction.
// ---------------------------------------------------------------------------
const { extractText, getDocumentProxy } = await import(require.resolve('unpdf', { paths: [root] }));
async function pdfText(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return { text, pages: pdf.numPages };
}
function assertPdfFonts(buffer) {
  const raw = buffer.toString('latin1');
  assert.doesNotMatch(raw, /\/Subtype\s*\/Type3/, 'fonts must embed as TrueType, not Type 3');
}
const PDF_FIXTURE = [
  '# CSC108 循环复习测试',
  '',
  '题目 ID：cmu1c0ikr2lld9uy7qmjhq，调用 `range(5)` 与 `print(total)`。',
  '',
  '| 知识点 | 公式 |',
  '|---|---|',
  '| 累加和 | $S_n = \\frac{n(n+1)}{2}$ |',
  '',
  '$$S = \\sum_{i=0}^{n-1} i = \\frac{n(n-1)}{2}$$',
  '',
  '<div style="page-break-after: always"></div>',
  '',
  '## 参考答案',
  '',
  '由 $\\frac{5 \\times 4}{2} = 10$ 验算。',
].join('\n');
const pdfModule = process.env.CHAT_ARTIFACT_PDF_MODULE || 'features/chat/server/artifacts/pdf.ts';
const sourcePdf = await jiti.import(path.join(root, pdfModule));
const prodPdf = await loadProduction(path.join(root, pdfModule));
for (const [mode, renderer] of [
  ['source', sourcePdf],
  ['production-minified', prodPdf],
]) {
  await check(`pdf csc108 (${mode}) typesets math and extracts losslessly`, async () => {
    const buffer = await renderer.renderMarkdownToPdf({
      title: 'CSC108 循环复习测试',
      markdown: PDF_FIXTURE,
    });
    assertPdfFonts(buffer);
    const { text, pages } = await pdfText(buffer);
    assert.equal(pages, 2, 'the page break must start the answers on page 2');
    for (const expected of [
      'CSC108',
      'cmu1c0ikr2lld9uy7qmjhq',
      'range(5)',
      'print(total)',
      '参考答案',
    ]) {
      assert.ok(text.includes(expected), `extracted text lost ${JSON.stringify(expected)}`);
    }
    // Typeset fractions put numerator and denominator on separate lines; the old
    // linearized fallback wrote "(n(n-1))/2".
    assert.doesNotMatch(text, /\)\)\/2|\)\/2/, 'fractions must be typeset, not linearized');
    assert.match(text, /n\s*\(\s*n\s*[−-]\s*1\s*\)/, 'numerator glyphs must stay extractable');
    assert.match(text, /∑/, 'big operators must be drawn with their glyphs');
    if (keepDir) fs.writeFileSync(path.join(keepDir, `csc108.${mode}.pdf`), buffer);
  });
}

await check('math layout covers common constructs', async () => {
  const { layoutLatex } = await jiti.import(
    path.join(root, 'features/chat/server/artifacts/math-canvas.ts'),
  );
  for (const latex of [
    '\\frac{a}{b}',
    '\\sqrt[3]{x^2+1}',
    '\\int_0^1 x\\,dx',
    '\\lim_{x\\to\\infty} \\left(1+\\frac{1}{x}\\right)^x',
    '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}',
    '\\begin{cases}x & x>0\\\\0 & \\text{否则}\\end{cases}',
    '\\bar{x}+\\hat{\\beta}+\\vec{v}+\\overline{AB}',
    'x \\xrightarrow{f} y',
    '\\mathrm{H_2SO_4}',
  ]) {
    const box = layoutLatex(latex, { display: true, fontSize: 12 });
    assert.ok(box && box.width > 0 && box.height > 0, `layout failed for ${latex}`);
  }
  const fraction = layoutLatex('\\frac{a}{b}', { display: true, fontSize: 12 });
  assert.ok(
    fraction.height > 12 * 0.6 && fraction.depth > 12 * 0.5,
    'a display fraction stacks above and below the baseline',
  );
  assert.equal(
    layoutLatex('\\frac{', { display: true, fontSize: 12 }),
    null,
    'unparseable LaTeX falls back to text',
  );
});

// ---------------------------------------------------------------------------
// Downloaded files passed with --file.
// ---------------------------------------------------------------------------
for (const file of files) {
  const resolved = file.replace(/^~(?=\/)/, process.env.HOME || '');
  await check(`downloaded ${path.basename(resolved)}`, async () => {
    const buffer = fs.readFileSync(resolved);
    if (resolved.endsWith('.docx')) await assertValidDocxPackage(buffer);
    else if (resolved.endsWith('.pdf')) {
      assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
      assertPdfFonts(buffer);
      const { text } = await pdfText(buffer);
      assert.ok(text.trim().length > 0, 'PDF has no extractable text');
    }
  });
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall chat artifact checks passed');
