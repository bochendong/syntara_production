import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectWorkingTreeFiles } from './verify-local-changes.mjs';

const script = fileURLToPath(new URL('./verify-local-changes.mjs', import.meta.url));
const repositoryRoot = path.resolve(path.dirname(script), '../..');

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'syntara-verify-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const write = (file, content = 'export const value = 1;\n') => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  const commit = () => {
    git('add', '.');
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
  };
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Local verification fixture');
  return { root, git, write, commit, run };
}

function installTools(f) {
  f.write('package.json', '{"private":true}\n');
  symlinkSync(path.join(repositoryRoot, 'node_modules'), path.join(f.root, 'node_modules'), 'dir');
  f.write(
    'eslint.config.mjs',
    "export default [{ ignores: ['ignored-by-eslint.js'] }, { files: ['**/*.js'], rules: { 'no-unused-vars': 'error' } }];\n",
  );
  f.write('.prettierignore', 'ignored-by-prettier.json\n');
  f.write('tsconfig.json', '{"compilerOptions":{"strict":true,"types":[]},"include":["*.ts"]}\n');
  f.commit();
}

function fingerprint(f, files) {
  return {
    status: f.git('status', '--porcelain=v1', '-z', '--untracked-files=all'),
    index: f.git('ls-files', '--stage', '-z'),
    hashes: files.map((file) =>
      createHash('sha256')
        .update(readFileSync(path.join(f.root, file)))
        .digest('hex'),
    ),
  };
}

test('selects the union of staged, unstaged and new files without modifying them', (t) => {
  const f = fixture(t);
  const tracked = ['staged.js', 'unstaged.js', 'both.js', 'removed.js', 'missing.js', 'old.js'];
  for (const file of tracked) f.write(file);
  f.write('.gitignore', '.env.local\nignored/\n');
  f.commit();
  f.write('staged.js', 'export const value = 2;\n');
  f.git('add', 'staged.js');
  f.write('unstaged.js', 'export const value = 2;\n');
  f.write('both.js', 'export const value = 2;\n');
  f.git('add', 'both.js');
  f.write('both.js', 'export const value = 3;\n');
  f.git('rm', '-q', 'removed.js');
  rmSync(path.join(f.root, 'missing.js'));
  f.git('mv', 'old.js', 'renamed [id] 中文.js');
  f.write('new folder/new.js');
  f.write(' leading and trailing .js ');
  f.write('.env.local', 'fixture-secret');
  f.write('ignored/new.js');
  f.write('staged-then-deleted.js');
  f.git('add', 'staged-then-deleted.js');
  rmSync(path.join(f.root, 'staged-then-deleted.js'));
  symlinkSync(path.join(f.root, '.env.local'), path.join(f.root, 'linked.js'));
  for (const dir of ['node_modules', '.next', 'dist', 'build', 'coverage']) {
    f.write(`nested/${dir}/generated.js`);
  }
  const expected = [
    ' leading and trailing .js ',
    'both.js',
    'new folder/new.js',
    'renamed [id] 中文.js',
    'staged.js',
    'unstaged.js',
  ].sort();
  const before = fingerprint(f, expected);
  assert.deepEqual(collectWorkingTreeFiles(f.root), expected);
  assert.deepEqual(fingerprint(f, expected), before);
});

test('works before the first commit and supports root-relative pathspecs and --list', (t) => {
  const f = fixture(t);
  f.write('staged.js');
  f.git('add', 'staged.js');
  f.write('new folder/[id].js');
  assert.deepEqual(collectWorkingTreeFiles(f.root), ['new folder/[id].js', 'staged.js']);
  const result = f.run('--list', '--', ':(literal)new folder/[id].js');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['new folder/[id].js']);
  const empty = f.run('--list', '--', 'nonexistent');
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout), []);
});

test('rejects unknown options instead of reporting a false success', (t) => {
  const f = fixture(t);
  const result = f.run('--skip-typo');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option/);
});

test('includes regular source files that replace tracked symlinks', (t) => {
  const f = fixture(t);
  f.write('target.js');
  symlinkSync('target.js', path.join(f.root, 'replaced.js'));
  f.commit();
  rmSync(path.join(f.root, 'replaced.js'));
  f.write('replaced.js');
  assert.deepEqual(collectWorkingTreeFiles(f.root), ['replaced.js']);
  f.git('add', 'replaced.js');
  assert.deepEqual(collectWorkingTreeFiles(f.root), ['replaced.js']);
});

test('reports both formatting and lint failures in new files without changing files or index', (t) => {
  const f = fixture(t);
  installTools(f);
  f.write('new file.js', 'const unused=1\n');
  // Tool ignore rules must still apply to explicitly collected files.
  f.write('ignored-by-eslint.js', 'const unused = 1;\n');
  f.write('ignored-by-prettier.json', '{broken json');
  const files = ['new file.js', 'ignored-by-eslint.js', 'ignored-by-prettier.json'];
  const before = fingerprint(f, files);
  const result = f.run('--skip-types');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /Failed: Prettier/);
  assert.match(result.stdout + result.stderr, /Failed: ESLint/);
  assert.doesNotMatch(result.stdout + result.stderr, /SyntaxError.*ignored-by-prettier/);
  assert.deepEqual(fingerprint(f, files), before);
});

test('checks current contents when a staged error has been fixed in the working tree', (t) => {
  const f = fixture(t);
  installTools(f);
  f.write('staged.js', 'const unused=1\n');
  f.git('add', 'staged.js');
  f.write('staged.js', 'export const value = 1;\n');
  const before = fingerprint(f, ['staged.js']);
  const result = f.run('--skip-types', '--', 'staged.js');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Local verification: PASS/);
  assert.deepEqual(fingerprint(f, ['staged.js']), before);
});

test('default entry point reports TypeScript failures without writing build metadata', (t) => {
  const f = fixture(t);
  installTools(f);
  f.write('new.ts', "const value: number = 'wrong';\nvoid value;\n");
  const before = fingerprint(f, ['new.ts']);
  const result = f.run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /TS2322/);
  assert.match(result.stdout + result.stderr, /Failed: TypeScript: full root project/);
  assert.deepEqual(fingerprint(f, ['new.ts']), before);
});
