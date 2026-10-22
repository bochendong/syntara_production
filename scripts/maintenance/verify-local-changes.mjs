#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LINTABLE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const GENERATED_DIRECTORY =
  /(?:^|\/)(?:node_modules|\.git|\.next|\.turbo|\.pnpm-store|\.worktrees|dist|build|coverage)(?:\/|$)/;

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

export function collectWorkingTreeFiles(root, pathspecs = []) {
  const conflicts = git(root, ['diff', '--name-only', '--diff-filter=U', '-z', '--', ...pathspecs]);
  if (conflicts) throw new Error('Resolve merge conflicts in the selected paths before verifying.');
  const commands = [
    ['diff', '--cached', '--name-only', '--diff-filter=ACMRT', '-z', '--', ...pathspecs],
    ['diff', '--name-only', '--diff-filter=ACMRT', '-z', '--', ...pathspecs],
    ['ls-files', '--others', '--exclude-standard', '-z', '--', ...pathspecs],
  ];
  const candidates = commands.flatMap((args) => git(root, args).split('\0').filter(Boolean));
  return [...new Set(candidates)]
    .filter((file) => {
      if (GENERATED_DIRECTORY.test(file)) return false;
      try {
        // Never follow a symlink into an unrelated directory or credential file.
        return lstatSync(path.join(root, file)).isFile();
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
        throw error;
      }
    })
    .sort();
}

export async function verifyLocalChanges(argv = process.argv.slice(2)) {
  const flags = new Set();
  const pathspecs = [];
  let pathsOnly = false;
  for (const arg of argv) {
    if (arg === '--' && !pathsOnly) {
      pathsOnly = true;
    } else if (!pathsOnly && arg.startsWith('--')) {
      if (!['--list', '--skip-types', '--help'].includes(arg)) {
        throw new Error(`Unknown option: ${arg}. Use --help for usage.`);
      }
      flags.add(arg);
    } else {
      pathspecs.push(arg);
    }
  }

  if (flags.has('--help')) {
    console.log(`Usage: pnpm verify:local [--list] [--skip-types] [-- pathspec...]
Checks on-disk staged, unstaged, and untracked files without modifying them.
--list        Print selected repository-relative files as JSON; run no checks.
--skip-types  Run only Prettier and ESLint on selected files.
Pathspecs are relative to the repository root; typechecks always cover projects.`);
    return 0;
  }

  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
  const files = collectWorkingTreeFiles(root, pathspecs);
  if (flags.has('--list')) {
    console.log(JSON.stringify(files, null, 2));
    return 0;
  }

  console.log(`Selected ${files.length} staged, unstaged, or untracked files (current contents).`);
  const require = createRequire(path.join(root, 'package.json'));
  const prettier = require('prettier');
  const { ESLint } = require('eslint');
  const eslint = new ESLint({ cwd: root });
  const formattedFiles = [];
  const lintedFiles = [];
  for (const file of files) {
    const absolute = path.join(root, file);
    const info = await prettier.getFileInfo(absolute, {
      ignorePath: [path.join(root, '.gitignore'), path.join(root, '.prettierignore')],
    });
    if (!info.ignored && info.inferredParser) formattedFiles.push(file);
    if (LINTABLE_FILE.test(file) && !(await eslint.isPathIgnored(absolute))) {
      lintedFiles.push(file);
    }
  }

  const results = [];
  function run(label, args) {
    console.log(`\n${label}`);
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
    if (result.error) console.error(result.error.message);
    if (result.signal) console.error(`Terminated by ${result.signal}.`);
    results.push({ label, passed: result.status === 0 });
  }

  function checkFiles(label, toolPath, args, selected) {
    if (selected.length === 0) {
      console.log(`${label}: no applicable files after tool ignore rules.`);
      return;
    }
    // Bound command size even with many pending files and long filenames.
    for (let start = 0; start < selected.length; start += 50) {
      const batch = selected.slice(start, start + 50);
      run(`${label}: files ${start + 1}-${start + batch.length}/${selected.length}`, [
        toolPath,
        ...args,
        '--',
        ...batch.map((file) => path.join(root, file)),
      ]);
    }
  }

  const tool = (name, executable) =>
    path.join(path.dirname(require.resolve(`${name}/package.json`)), executable);
  checkFiles('Prettier', tool('prettier', 'bin/prettier.cjs'), ['--check'], formattedFiles);
  checkFiles('ESLint', tool('eslint', 'bin/eslint.js'), [], lintedFiles);

  if (!flags.has('--skip-types')) {
    const tsc = tool('typescript', 'bin/tsc');
    const typeArgs = ['--noEmit', '--incremental', 'false', '--pretty', 'false'];
    run('TypeScript: full root project', ['--max-old-space-size=4096', tsc, ...typeArgs]);
    if (files.some((file) => file.startsWith('apps/native/') && /\.[cm]?tsx?$/i.test(file))) {
      for (const config of ['apps/native/tsconfig.json', 'apps/native/tsconfig.node.json']) {
        run(`TypeScript: ${config}`, [tsc, ...typeArgs, '--project', config]);
      }
    }
  }

  const failed = results.filter((result) => !result.passed);
  console.log(`\nLocal verification: ${failed.length ? 'FAIL' : 'PASS'}.`);
  for (const { label } of failed) console.error(`  Failed: ${label}`);
  if (flags.has('--skip-types')) console.log('TypeScript was explicitly skipped.');
  return failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = await verifyLocalChanges();
  } catch (error) {
    console.error(`Local verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
