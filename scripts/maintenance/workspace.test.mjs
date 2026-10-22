import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./workspace.mjs', import.meta.url));

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'syntara-workspace-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'shared checkout');
  mkdirSync(root);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'SYNTARA_ALLOW_SHARED_COMMIT'])
    delete env[key];
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const run = (cwd, ...args) =>
    spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8' });
  const hook = (cwd, extraEnv = {}) =>
    spawnSync('git', ['hook', 'run', 'pre-commit'], {
      cwd,
      env: { ...env, ...extraEnv },
      encoding: 'utf8',
    });
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'Workspace fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(root, 'old name.txt'), 'baseline\n');
  git('add', '.');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
  return { directory, root, env, git, run, hook };
}

test('protects main and the shared checkout after a branch rename, with an explicit override', (t) => {
  const f = fixture(t);
  const before = f.git('ls-files', '--stage', '-z');
  const installed = f.run(f.root, 'install-guard', f.root);
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(f.hook(f.root).status, 1);
  f.git('switch', '-c', 'codex/a-renamed-shared-branch');
  assert.equal(f.hook(f.root).status, 1);
  assert.equal(f.hook(f.root, { SYNTARA_ALLOW_SHARED_COMMIT: '1' }).status, 0);
  assert.equal(f.git('ls-files', '--stage', '-z'), before);
  const repeated = f.run(f.root, 'install-guard', f.root);
  assert.equal(repeated.status, 0, repeated.stderr);
});

test('allows an isolated task and reports rename, staged, unstaged and new-file counts', (t) => {
  const f = fixture(t);
  assert.equal(f.run(f.root, 'install-guard').status, 0);
  const isolated = path.join(f.directory, 'isolated task');
  f.git('worktree', 'add', '--quiet', '-b', 'codex/task', isolated);
  assert.equal(f.hook(isolated).status, 0);
  f.git('-C', isolated, 'mv', 'old name.txt', 'new name.txt');
  writeFileSync(path.join(isolated, 'new name.txt'), 'baseline\nmore\n');
  writeFileSync(path.join(isolated, 'new.js'), 'export const value = 1;\n');
  const result = f.run(isolated, 'status');
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  const task = status.worktrees.find((tree) => tree.current);
  assert.equal(task.role, 'task');
  assert.deepEqual(task.changes, { staged: 1, unstaged: 1, untracked: 1, conflicts: 0 });
  assert.equal(status.worktrees.find((tree) => !tree.current).role, 'shared-unassigned');
  f.git('-C', isolated, 'switch', '--detach', 'HEAD');
  assert.equal(f.hook(isolated).status, 1);
});

test('never replaces an existing custom hook', (t) => {
  const f = fixture(t);
  const file = path.join(f.root, '.git/hooks/pre-commit');
  const content = '#!/bin/sh\n# custom hook\nexit 0\n';
  writeFileSync(file, content);
  const result = f.run(f.root, 'install-guard');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /existing pre-commit hook was left unchanged/);
  assert.equal(readFileSync(file, 'utf8'), content);
});

test('respects an effective custom hooksPath and rejects an unrelated shared directory', (t) => {
  const f = fixture(t);
  f.git('config', 'core.hooksPath', 'custom-hooks');
  const result = f.run(f.root, 'install-guard');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /custom core.hooksPath/);
  f.git('config', '--unset', 'core.hooksPath');
  const unrelated = f.run(f.root, 'install-guard', os.tmpdir());
  assert.equal(unrelated.status, 1);
  assert.match(unrelated.stderr, /must be a registered worktree/);
});
