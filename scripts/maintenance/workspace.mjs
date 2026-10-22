#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

function optionalConfig(name, local = true) {
  const result = spawnSync('git', ['config', ...(local ? ['--local'] : []), '--get', name], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status === 1) return null;
  if (result.status !== 0) throw new Error(result.stderr || `Cannot read ${name}`);
  return result.stdout.trim() || null;
}

function worktrees() {
  return git('worktree', 'list', '--porcelain', '-z')
    .split('\0\0')
    .filter(Boolean)
    .map((record) => {
      const fields = Object.fromEntries(
        record
          .split('\0')
          .filter(Boolean)
          .map((field) => {
            const separator = field.indexOf(' ');
            return separator < 0
              ? [field, true]
              : [field.slice(0, separator), field.slice(separator + 1)];
          }),
      );
      return {
        path: fields.worktree,
        branch: fields.branch?.replace(/^refs\/heads\//, '') ?? null,
        commit: fields.HEAD,
      };
    });
}

function changeCounts(directory) {
  const entries = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: directory,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  const counts = { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 };
  for (let index = 0; index < entries.length; index += 1) {
    const status = entries[index].slice(0, 2);
    if (status === '??') counts.untracked += 1;
    else if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(status)) counts.conflicts += 1;
    else {
      if (status[0] !== ' ') counts.staged += 1;
      if (status[1] !== ' ') counts.unstaged += 1;
    }
    if (/[RC]/.test(status)) index += 1;
  }
  return counts;
}

function status() {
  const shared = optionalConfig('syntara.sharedWorktree');
  const rows = worktrees().map((tree) => {
    const role =
      tree.path === shared || tree.branch?.startsWith('codex/shared-wip-')
        ? 'shared-unassigned'
        : ['main', 'master', null].includes(tree.branch)
          ? 'protected-base'
          : 'task';
    try {
      return { ...tree, current: tree.path === root, role, changes: changeCounts(tree.path) };
    } catch (error) {
      return { ...tree, role, error: error.message };
    }
  });
  console.log(
    JSON.stringify(
      { checkpoint: optionalConfig('syntara.sharedCheckpoint'), worktrees: rows },
      null,
      2,
    ),
  );
}

function installGuard(args) {
  if (args.length > 1) throw new Error('Usage: pnpm workspace:guard [shared-checkout-path]');
  if (optionalConfig('core.hooksPath', false)) {
    throw new Error(
      'A custom core.hooksPath is configured. Existing hooks were left unchanged; integrate .githooks/pre-commit explicitly.',
    );
  }
  const shared = realpathSync(args[0] ?? worktrees()[0].path);
  if (!worktrees().some((tree) => realpathSync(tree.path) === shared)) {
    throw new Error('The shared checkout must be a registered worktree of this repository.');
  }
  const target = path.resolve(root, git('rev-parse', '--git-path', 'hooks/pre-commit').trim());
  const template = readFileSync(new URL('../../.githooks/pre-commit', import.meta.url), 'utf8');
  if (existsSync(target) && readFileSync(target, 'utf8') !== template) {
    throw new Error(
      'An existing pre-commit hook was left unchanged. Integrate .githooks/pre-commit explicitly.',
    );
  }
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.syntara-${process.pid}`;
  writeFileSync(temporary, template, { flag: 'wx', mode: 0o755 });
  chmodSync(temporary, 0o755);
  renameSync(temporary, target);
  git('config', '--local', 'syntara.sharedWorktree', shared);
  console.log(`Installed local worktree guard. Shared checkout: ${shared}`);
}

try {
  const [command = 'status', ...args] = process.argv.slice(2).filter((arg) => arg !== '--');
  if (command === 'status' && !args.length) status();
  else if (command === 'install-guard') installGuard(args);
  else
    throw new Error(
      'Usage: node scripts/maintenance/workspace.mjs status | install-guard [shared-checkout-path]',
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
