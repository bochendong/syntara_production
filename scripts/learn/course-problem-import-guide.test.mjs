import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { '@': root } });
const { GET } = jiti(root + '/app/api/native/v1/import-docs/[document]/route.ts');
const { COURSE_PROBLEM_IMPORT_GUIDE: guide } = jiti(root + '/lib/course-problem-import-guide.ts');
const request = new Request('http://localhost' + guide.path);
const get = (document) => GET(request, { params: Promise.resolve({ document }) });

test('public guide serves the exact frozen source bytes with verifiable uncached headers', async () => {
  const expected = await readFile(path.join(root, 'docs/api/ai-course-problem-upload.md'));
  const response = await get('ai-course-problem-upload.md');
  assert.equal(response.status, 200);
  const actual = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(actual, expected);
  assert.equal(createHash('sha256').update(actual).digest('hex'), guide.sha256);
  assert.equal(response.headers.get('x-content-sha256'), guide.sha256);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /^text\/markdown; charset=utf-8$/);
  assert.equal(response.headers.get('etag'), `"sha256-${guide.sha256}"`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('the relative transport link resolves to the published, exact transport document', async () => {
  const content = await (await get('ai-course-problem-upload.md')).text();
  assert.ok(content.includes('](./course-problem-import-transport.md)'));
  assert.equal(
    new URL('./course-problem-import-transport.md', request.url).pathname,
    guide.transportPath,
  );
  const response = await get('course-problem-import-transport.md');
  assert.equal(response.status, 200);
  assert.equal(
    await response.text(),
    await readFile(path.join(root, 'docs/api/course-problem-import-transport.md'), 'utf8'),
  );
});

test('the public documentation endpoint refuses private and arbitrary filesystem paths', async () => {
  for (const name of ['.env.local', '../.env.local', '/etc/passwd', 'native-staging.md']) {
    assert.equal((await get(name)).status, 404);
  }
});

test('relative Markdown links in the guide and transport resolve to exact published documents', async () => {
  for (const name of ['ai-course-problem-upload.md', 'course-problem-import-transport.md']) {
    const text = await (await get(name)).text();
    for (const match of text.matchAll(/\]\(\.\/([^/)]+\.md)\)/g)) {
      const response = await get(match[1]);
      assert.equal(response.status, 200, match[1]);
      assert.equal(
        await response.text(),
        await readFile(path.join(root, 'docs/api', match[1]), 'utf8'),
      );
    }
  }
});

test('an unreviewed changed guide cannot masquerade as the frozen version', async () => {
  const previous = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'syntara-guide-'));
  try {
    await mkdir(path.join(dir, 'docs/api'), { recursive: true });
    await writeFile(path.join(dir, 'docs/api/ai-course-problem-upload.md'), 'unreviewed');
    process.chdir(dir);
    const response = await get('ai-course-problem-upload.md');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(!(await response.text()).includes('unreviewed'));
  } finally {
    process.chdir(previous);
    await rm(dir, { recursive: true, force: true });
  }
});
