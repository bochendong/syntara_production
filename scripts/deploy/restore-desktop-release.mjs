import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

/** Restore the pinned public installer before a GitHub-source staging build. */
export async function restoreDesktopRelease({ manifestPath, directory, fetcher = fetch }) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const { downloadUrl, ...info } = manifest;
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/.test(info.fileName) ||
    !/^[a-f0-9]{64}$/.test(info.sha256) ||
    !Number.isSafeInteger(info.size) ||
    info.size <= 0 ||
    info.size > 200 * 1024 * 1024 ||
    typeof downloadUrl !== 'string'
  )
    throw new Error('Invalid pinned desktop release manifest');
  const url = new URL(downloadUrl);
  if (
    url.origin !== 'https://github.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith('/bochendong/syntara_production/releases/download/') ||
    !url.pathname.endsWith('/' + info.fileName)
  )
    throw new Error('Installer must be a pinned Syntara GitHub Release asset');
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, info.fileName);
  const matches = async () => {
    try {
      let size = 0;
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(target)) {
        size += chunk.length;
        hash.update(chunk);
      }
      return size === info.size && hash.digest('hex') === info.sha256;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  };
  if (!(await matches())) {
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const response = await fetcher(url.href, { signal: AbortSignal.timeout(120000) });
      if (!response.ok || !response.body)
        throw new Error(`Installer download failed (${response.status})`);
      let size = 0;
      const hash = createHash('sha256');
      const verify = new Transform({
        transform(chunk, _encoding, done) {
          size += chunk.length;
          if (size > info.size) return done(new Error('Installer exceeds pinned size'));
          hash.update(chunk);
          done(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body),
        verify,
        createWriteStream(temporary, { flags: 'wx' }),
      );
      if (size !== info.size || hash.digest('hex') !== info.sha256)
        throw new Error('Installer checksum mismatch');
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  const manifestTarget = path.join(directory, 'macos-arm64.json');
  const temporaryManifest = `${manifestTarget}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryManifest, JSON.stringify(info, null, 2) + '\n');
    await rename(temporaryManifest, manifestTarget);
  } finally {
    await rm(temporaryManifest, { force: true });
  }
  return { fileName: info.fileName, sha256: info.sha256, size: info.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.SYNTARA_APP_ENV !== 'staging')
    throw new Error('This restore command is for staging only');
  const result = await restoreDesktopRelease({
    manifestPath: path.resolve('scripts/deploy/desktop-release.json'),
    directory: path.resolve(process.env.SYNTARA_DESKTOP_RELEASES_DIR || '.data/desktop-releases'),
  });
  console.log(`Verified desktop installer: ${result.fileName} (${result.sha256})`);
}
