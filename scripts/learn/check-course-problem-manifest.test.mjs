import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkPreparedManifest } from './check-course-problem-manifest.mjs';

const guide = readFileSync(
  new URL('../../docs/api/ai-course-problem-upload.md', import.meta.url),
  'utf8',
);
const examples = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]));
const example = () => structuredClone(examples[0]);

test('every standalone guide example passes the actual import parser and readiness gates', () => {
  assert.equal(examples.length, 8);
  for (const [index, fragment] of examples.entries()) {
    const data = example();
    if (index) {
      const draft = data.items[0].draft;
      delete draft.publicContent;
      delete draft.grading;
      Object.assign(draft, fragment, { type: fragment.publicContent.type });
    }
    const result = checkPreparedManifest(data);
    assert.equal(result.valid, true, JSON.stringify(result));
  }
});

test('rejects guessed aliases instead of silently stripping them', () => {
  const data = example();
  data.items[0].draft.grading.answer = 'guessed answer';
  assert.match(checkPreparedManifest(data).errors.join('\n'), /grading.answer: unknown field/);
});

test('rejects incomplete table grading and leaked answers', () => {
  const data = example();
  const fragment = structuredClone(examples.find((x) => x.publicContent?.type === 'table'));
  Object.assign(data.items[0].draft, fragment, { type: 'table' });
  data.items[0].draft.grading.cells.pop();
  data.items[0].draft.publicContent.rows[0].cells.out = '4';
  const errors = checkPreparedManifest(data).errors.join('\n');
  assert.match(errors, /cover each answer cell/);
  assert.match(errors, /public answer cell/);
});

test('rejects missing blank IDs, mismatched types, points and future dependencies', () => {
  const data = example();
  data.items[0].draft.points = 5;
  assert.equal(checkPreparedManifest(data).valid, false);
  const blank = example();
  Object.assign(
    blank.items[0].draft,
    structuredClone(examples.find((x) => x.publicContent?.type === 'fill_blank')),
    { type: 'fill_blank' },
  );
  blank.items[0].draft.grading.blanks[0].id = 'missing';
  assert.equal(checkPreparedManifest(blank).valid, false);
  const multi = example();
  Object.assign(
    multi.items[0].draft,
    structuredClone(examples.find((x) => x.publicContent?.type === 'multipart')),
    { type: 'multipart' },
  );
  multi.items[0].draft.publicContent.parts[0].dependsOn = ['b'];
  assert.match(checkPreparedManifest(multi).errors.join('\n'), /earlier parts/);
  const mismatch = example();
  mismatch.items[0].draft.type = 'short_answer';
  assert.equal(checkPreparedManifest(mismatch).valid, false);
});

test('valid code JSON is still explicitly unexecuted; missing private tests are rejected', () => {
  const data = example();
  Object.assign(
    data.items[0].draft,
    structuredClone(examples.find((x) => x.publicContent?.type === 'code')),
    { type: 'code' },
  );
  const result = checkPreparedManifest(data);
  assert.equal(result.valid, true);
  assert.equal(result.executableQuestionCount, 1);
  assert.match(result.scope, /no runner/);
  data.items[0].draft.secretJudge.secretTests = [];
  assert.equal(checkPreparedManifest(data).valid, false);
});

test('rejects calculation used for method credit and missing final accepted forms', () => {
  const data = example();
  Object.assign(
    data.items[0].draft,
    structuredClone(examples.find((x) => x.publicContent?.type === 'calculation')),
    { type: 'calculation' },
  );
  data.items[0].draft.publicContent.showWork = true;
  data.items[0].draft.grading.acceptedForms = [];
  const errors = checkPreparedManifest(data).errors.join('\n');
  assert.match(errors, /cannot grade working/);
  assert.match(errors, /final-result acceptedForms/);
});

test('rejects the wrong Python submission module in public and private test files', () => {
  const data = example();
  Object.assign(
    data.items[0].draft,
    structuredClone(examples.find((x) => x.publicContent?.type === 'code')),
    { type: 'code' },
  );
  data.items[0].draft.publicContent.publicTestCode = 'from solution import twice';
  data.items[0].draft.secretJudge.secretTestCode = 'import solution';
  assert.equal(
    checkPreparedManifest(data).errors.filter((e) => e.includes('must import submission')).length,
    2,
  );
  assert.match(guide, /from submission import/);
  const runner = readFileSync(
    new URL('../../lib/server/notebook-problems/judge.ts', import.meta.url),
    'utf8',
  );
  assert.match(runner, /spec_from_file_location\("submission"/);
});

test('executable multipart must preserve notebookId:null across signing and import', () => {
  const data = example();
  const code = structuredClone(examples.find((x) => x.publicContent?.type === 'code'));
  const multi = structuredClone(examples.find((x) => x.publicContent?.type === 'multipart'));
  multi.publicContent.parts[0].content = code.publicContent;
  multi.grading.parts[0].grading = code.grading;
  Object.assign(data.items[0].draft, multi, {
    type: 'multipart',
    secretJudge: {
      language: 'python',
      parts: { a: { secretTests: code.secretJudge.secretTests } },
    },
  });
  assert.match(checkPreparedManifest(data).errors.join('\n'), /explicit notebookId:null/);
  data.items[0].draft.notebookId = null;
  assert.equal(checkPreparedManifest(data).valid, true);
});

const tinyPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==';
function withImage(src = `data:image/png;base64,${tinyPng}`) {
  const data = example();
  data.items[0].draft.publicContent.assets = {
    images: [{ id: 'given', src, width: 1, height: 1, mimeType: 'image/png' }],
  };
  return data;
}

test('accepts embedded raster assets and reports real HTTP body size', () => {
  const result = checkPreparedManifest(withImage());
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.equal(result.imageCount, 1);
  assert.ok(result.maxRequestBytes > 100);
});

test('rejects local paths, truncated base64, wrong MIME and wrong pixel dimensions', () => {
  for (const src of [
    'file:///tmp/figure.png',
    '/Users/teacher/figure.png',
    'figure.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,AAAA',
  ])
    assert.equal(checkPreparedManifest(withImage(src)).valid, false, src);
  const dimensions = withImage();
  dimensions.items[0].draft.publicContent.assets.images[0].width = 2;
  assert.match(checkPreparedManifest(dimensions).errors.join('\n'), /dimensions/);
  const mime = withImage();
  mime.items[0].draft.publicContent.assets.images[0].mimeType = 'image/jpeg';
  assert.match(checkPreparedManifest(mime).errors.join('\n'), /MIME/);
  const duplicate = withImage();
  duplicate.items[0].draft.publicContent.assets.images.push({
    ...duplicate.items[0].draft.publicContent.assets.images[0],
  });
  assert.match(checkPreparedManifest(duplicate).errors.join('\n'), /image IDs/);
});

test('fewer than 100 questions can still exceed the two-megabyte HTTP import limit', () => {
  const data = withImage(`data:image/png;base64,${tinyPng}`);
  data.items[0].draft.sourceMeta.privateSourceNote = 'x'.repeat(2_000_000);
  assert.match(checkPreparedManifest(data).errors.join('\n'), /request exceeds 2,000,000 bytes/);
});

test('unittest mode does not make multi-statement sampleIO executable', () => {
  const data = example();
  Object.assign(
    data.items[0].draft,
    structuredClone(examples.find((x) => x.publicContent?.type === 'code')),
    { type: 'code' },
  );
  data.items[0].draft.publicContent.publicTestCode =
    'import unittest\nfrom submission import twice\nclass Checks(unittest.TestCase):\n    def test_positive(self): self.assertEqual(twice(2),4)';
  data.items[0].draft.publicContent.sampleIO[0].input = 'values = [2]\ntwice(values[0])';
  assert.match(
    checkPreparedManifest(data).errors.join('\n'),
    /sampleIO is evaluated as a single expression/,
  );
  data.items[0].draft.publicContent.sampleIO[0].input = 'twice(2)';
  assert.equal(checkPreparedManifest(data).valid, true);
});

test('sample expression checking preserves semicolon string data and wrapped calls', () => {
  const data = example();
  Object.assign(
    data.items[0].draft,
    structuredClone(examples.find((x) => x.publicContent?.type === 'code')),
    { type: 'code' },
  );
  for (const input of ["twice(';')", 'twice(\n 2\n)', 'twice("""a;b""")']) {
    data.items[0].draft.publicContent.sampleIO[0].input = input;
    assert.equal(checkPreparedManifest(data).valid, true, input);
  }
  data.items[0].draft.publicContent.sampleIO[0].input = 'twice(2); twice(3)';
  assert.equal(checkPreparedManifest(data).valid, false);
});
