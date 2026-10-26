import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { restoreDesktopRelease } from '../deploy/restore-desktop-release.mjs';

const bytes = Buffer.from('verified installer fixture');
async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'syntara-release-restore-'));
  const manifestPath = path.join(directory, 'pin.json');
  const info = {
    version: '0.1.0',
    builtAt: '2026-10-26T00:01:56Z',
    fileName: 'Syntara-Test.zip',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    channel: 'staging',
    architecture: 'arm64',
    minimumSystemVersion: '14.0',
    notarized: false,
  };
  const manifest = {
    ...info,
    downloadUrl:
      'https://github.com/bochendong/syntara_production/releases/download/test/Syntara-Test.zip',
  };
  await writeFile(manifestPath, JSON.stringify(manifest));
  try {
    await run({ directory, manifestPath, info, manifest });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test('restore pins installer bytes and skips downloading a verified cached package', async () => {
  await fixture(async ({ directory, manifestPath, info }) => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return new Response(bytes);
    };
    await restoreDesktopRelease({ directory, manifestPath, fetcher });
    assert.deepEqual(await readFile(path.join(directory, info.fileName)), bytes);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(directory, 'macos-arm64.json'), 'utf8')),
      info,
    );
    await restoreDesktopRelease({ directory, manifestPath, fetcher });
    assert.equal(calls, 1);
  });
});
test('a corrupt or oversized download cannot replace the last valid release', async () => {
  for (const payload of [Buffer.from('invalid bytes'), Buffer.alloc(100)]) {
    await fixture(async ({ directory, manifestPath }) => {
      const previous = 'previous valid manifest';
      await writeFile(path.join(directory, 'macos-arm64.json'), previous);
      await assert.rejects(
        restoreDesktopRelease({
          directory,
          manifestPath,
          fetcher: async () => new Response(payload),
        }),
      );
      assert.equal(await readFile(path.join(directory, 'macos-arm64.json'), 'utf8'), previous);
      assert.ok(!(await readdir(directory)).some((name) => name.endsWith('.tmp')));
    });
  }
});
test('unsafe names and unexpected download hosts are rejected before networking', async () => {
  await fixture(async ({ directory, manifestPath, manifest }) => {
    for (const patch of [
      { fileName: '../escape.zip' },
      { downloadUrl: 'https://example.com/Syntara-Test.zip' },
      { size: 0 },
    ]) {
      await writeFile(manifestPath, JSON.stringify({ ...manifest, ...patch }));
      await assert.rejects(
        restoreDesktopRelease({
          directory,
          manifestPath,
          fetcher: () => {
            throw Error('must not fetch');
          },
        }),
        /Invalid|pinned/,
      );
    }
  });
});
