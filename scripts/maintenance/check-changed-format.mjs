#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';

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
const files = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`], {
  encoding: 'utf8',
})
  .split('\n')
  .map((file) => file.trim())
  .filter(Boolean);

if (files.length === 0) {
  console.log('No added or modified files require a formatting check.');
  process.exit(0);
}

console.log(`Checking formatting for ${files.length} changed files against ${base}.`);
const result = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'prettier', '--check', '--ignore-unknown', '--', ...files],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
