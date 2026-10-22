import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Upload a reproducible source snapshot without the legacy production railway.toml.
// Build/deploy settings are configured directly on the staging Railway service.
const root = process.cwd();
const destination = process.argv[2];
if (!destination || !path.isAbsolute(destination))
  throw new Error('Provide a new absolute snapshot directory.');
mkdirSync(destination);
const paths = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const manifest = [];
for (const name of paths) {
  if (name === 'railway.toml' || name === 'railway.json') continue;
  if (/(^|\/)\.env(?:\.|$)/.test(name) && name !== '.env.example')
    throw new Error('Refusing environment file.');
  const source = path.join(root, name);
  const target = path.join(destination, name);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  manifest.push({
    path: name,
    sha256: createHash('sha256').update(readFileSync(source)).digest('hex'),
  });
}
const record = path.join(os.tmpdir(), `${path.basename(destination)}-manifest.json`);
writeFileSync(
  record,
  JSON.stringify(
    {
      source: root,
      destination,
      base: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      files: manifest,
    },
    null,
    2,
  ),
);
console.log(`Prepared ${manifest.length} files. Manifest: ${record}`);
