#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';

const LINTABLE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/i;

function commitExists(ref) {
  if (!ref || /^0+$/.test(ref)) return false;
  return (
    spawnSync('git', ['cat-file', '-e', `${ref}^{commit}`], {
      stdio: 'ignore',
    }).status === 0
  );
}

const requestedBase = process.argv
  .slice(2)
  .find((argument) => argument !== '--')
  ?.trim();
const base = commitExists(requestedBase) ? requestedBase : 'HEAD^';
const files = execFileSync(
  'git',
  ['diff', '--name-only', '--diff-filter=ACMR', '-z', `${base}...HEAD`],
  { encoding: 'utf8' },
)
  .split('\0')
  .map((file) => file.trim())
  .filter((file) => LINTABLE_FILE.test(file));

if (files.length === 0) {
  console.log('No added or modified JavaScript or TypeScript files require linting.');
  process.exit(0);
}

console.log(`Linting ${files.length} changed files against ${base}.`);
const result = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'eslint', '--', ...files],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
