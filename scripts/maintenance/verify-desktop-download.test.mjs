import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const root = path.resolve(import.meta.dirname, '../..');
const jiti = createJiti(import.meta.url, { alias: { '@': root } });
const { parseDownloadRange, readDesktopRelease } = jiti('../../lib/server/desktop-release.ts');
const { GET, HEAD } = jiti('../../app/api/downloads/macos/route.ts');
const payload = Buffer.from('test-installer-fixture');

async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'syntara-download-test-'));
  const info = {
    version: '0.1.0',
    builtAt: '2026-10-24T12:00:00Z',
    fileName: 'Syntara-test.zip',
    size: payload.length,
    sha256: createHash('sha256').update(payload).digest('hex'),
    channel: 'staging',
    architecture: 'arm64',
    minimumSystemVersion: '14.0',
    notarized: false,
  };
  try {
    await writeFile(path.join(directory, info.fileName), payload);
    await writeFile(path.join(directory, 'macos-arm64.json'), JSON.stringify(info));
    await run(directory, info);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('release availability requires a real, correctly sized installer and a safe manifest', async () => {
  await fixture(async (directory, info) => {
    assert.equal((await readDesktopRelease(directory)).info.version, info.version);
    await writeFile(path.join(directory, 'macos-arm64.json'), JSON.stringify({ ...info, size: 1 }));
    assert.equal(await readDesktopRelease(directory), null);
    await writeFile(
      path.join(directory, 'macos-arm64.json'),
      JSON.stringify({ ...info, fileName: '../outside.zip' }),
    );
    assert.equal(await readDesktopRelease(directory), null);
    await rm(path.join(directory, 'macos-arm64.json'));
    assert.equal(await readDesktopRelease(directory), null);
  });
});

test('download ranges support resume and suffix requests, rejecting unsafe or unsatisfiable ranges', () => {
  assert.deepEqual(parseDownloadRange('bytes=3-8', 12), { start: 3, end: 8 });
  assert.deepEqual(parseDownloadRange('bytes=3-', 12), { start: 3, end: 11 });
  assert.deepEqual(parseDownloadRange('bytes=-4', 12), { start: 8, end: 11 });
  assert.deepEqual(parseDownloadRange('bytes=3-99', 12), { start: 3, end: 11 });
  for (const range of [
    'bytes=12-',
    'bytes=8-3',
    'bytes=-0',
    'bytes=-',
    'bytes=0-1,3-4',
    'bytes=99999999999999999999-',
  ]) {
    assert.equal(parseDownloadRange(range, 12), null, range);
  }
});

test('download handler streams the file, supports HEAD and resume, and never returns a fake installer', async () => {
  await fixture(async (directory, info) => {
    const before = process.env.SYNTARA_DESKTOP_RELEASES_DIR;
    process.env.SYNTARA_DESKTOP_RELEASES_DIR = directory;
    const request = (headers) =>
      new Request('https://fixture.invalid/api/downloads/macos', { headers });
    try {
      const response = await GET(request());
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/zip');
      assert.match(
        response.headers.get('content-disposition'),
        /attachment; filename="Syntara-test.zip"/,
      );
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);
      const head = await HEAD(request());
      assert.equal(head.headers.get('content-length'), String(payload.length));
      assert.equal(await head.text(), '');
      const resumed = await GET(request({ range: 'bytes=5-9' }));
      assert.equal(resumed.status, 206);
      assert.equal(resumed.headers.get('content-range'), `bytes 5-9/${payload.length}`);
      assert.deepEqual(Buffer.from(await resumed.arrayBuffer()), payload.subarray(5, 10));
      const invalid = await GET(request({ range: 'bytes=999-' }));
      assert.equal(invalid.status, 416);
      assert.equal(invalid.headers.get('content-range'), `bytes */${payload.length}`);
      assert.equal((await GET(request({ 'if-none-match': `"${info.sha256}"` }))).status, 304);
      await rm(path.join(directory, info.fileName));
      assert.equal((await GET(request())).status, 404);
    } finally {
      if (before === undefined) delete process.env.SYNTARA_DESKTOP_RELEASES_DIR;
      else process.env.SYNTARA_DESKTOP_RELEASES_DIR = before;
    }
  });
});
