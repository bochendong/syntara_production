import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const app = path.join(
  root,
  'apps/native/src-tauri/target/staging/release/bundle/macos/Syntara Test.app',
);
const plist = path.join(app, 'Contents/Info.plist');
const readPlist = (key) =>
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], {
    encoding: 'utf8',
  }).trim();
assert.equal(readPlist('CFBundleIdentifier'), 'com.syntara.staging');
assert.equal(readPlist('LSMinimumSystemVersion'), '14.0');
const version = readPlist('CFBundleShortVersionString');
assert.match(version, /^\d+\.\d+\.\d+$/);
const binary = path.join(app, 'Contents/MacOS', readPlist('CFBundleExecutable'));
assert.equal(
  execFileSync('/usr/bin/lipo', ['-archs', binary], { encoding: 'utf8' }).trim(),
  'arm64',
);
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });

const directory =
  process.env.SYNTARA_DESKTOP_RELEASES_DIR || path.join(root, '.data/desktop-releases');
await mkdir(directory, { recursive: true });
const builtAt = new Date().toISOString();
const stamp = builtAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const fileName = `Syntara-Test-${version}-macOS-arm64-${stamp}.zip`;
const destination = path.join(directory, fileName);
const temporary = `${destination}.tmp`;
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, temporary], {
  stdio: 'inherit',
});
await rename(temporary, destination);
const hash = createHash('sha256');
for await (const chunk of createReadStream(destination)) hash.update(chunk);
const info = {
  version,
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
  builtAt,
  fileName,
  size: (await stat(destination)).size,
  sha256: hash.digest('hex'),
  channel: 'staging',
  architecture: 'arm64',
  minimumSystemVersion: '14.0',
  notarized: false,
};
const temporaryManifest = path.join(directory, 'macos-arm64.json.tmp');
await writeFile(temporaryManifest, `${JSON.stringify(info, null, 2)}\n`);
await rename(temporaryManifest, path.join(directory, 'macos-arm64.json'));
console.log(JSON.stringify(info, null, 2));
