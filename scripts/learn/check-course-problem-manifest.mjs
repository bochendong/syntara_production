#!/usr/bin/env node
/** Offline acceptance of prepared manifests. Never loads env, connects DB, or runs code. */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { splitManifest } from './import-course-problems.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
// Load the actual server parser, but block every DB/write/runner dependency.
function parserModules() {
  const cache = new Map();
  const forbidden = () => {
    throw new Error('Side effects forbidden in offline validation');
  };
  const mocks = new Map([
    ['@/lib/server/prisma', { prisma: new Proxy({}, { get: forbidden }) }],
    [
      '@/lib/server/notebook-problems/service',
      { createCourseProblemsFromDraftsWithSummary: forbidden },
    ],
    ['@/lib/server/course-code-preflight', { verifyCodePreflight: forbidden }],
  ]);
  function load(file) {
    let filename = path.resolve(root, file);
    if (!existsSync(filename) || !filename.endsWith('.ts'))
      filename = existsSync(`${filename}.ts`) ? `${filename}.ts` : `${filename}/index.ts`;
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = { exports: {} };
    cache.set(filename, loaded);
    const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: filename,
    });
    const localRequire = (specifier) =>
      mocks.has(specifier)
        ? mocks.get(specifier)
        : specifier.startsWith('@/')
          ? load(specifier.slice(2))
          : specifier.startsWith('.')
            ? load(path.resolve(path.dirname(filename), specifier))
            : require(specifier);
    new Function('require', 'module', 'exports', compiled.outputText)(
      localRequire,
      loaded,
      loaded.exports,
    );
    return loaded.exports;
  }
  return {
    ...load('lib/server/course-problem-import.ts'),
    ...load('lib/problem-bank/code-readiness.ts'),
  };
}

function unknownKeys(input, parsed, location, errors) {
  if (!input || typeof input !== 'object' || !parsed || typeof parsed !== 'object') return;
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(parsed, key))
      errors.push(`${location}.${key}: unknown field would be discarded`);
    else unknownKeys(input[key], parsed[key], `${location}.${key}`, errors);
  }
}

function reviewContent(content, grading, location, errors) {
  if (content.type === 'code' && content.language === 'python') {
    // Private tests are checked with their containing draft below.
    if (/\b(?:import\s+solution\b|from\s+solution\s+import\b)/.test(content.publicTestCode ?? ''))
      errors.push(`${location}: Python tests must import submission, not solution`);
  }
  if (content.type === 'calculation' && grading.type === 'calculation') {
    if (content.showWork === true)
      errors.push(`${location}: calculation cannot grade working; use short_answer with a rubric`);
    if (!grading.acceptedForms.length)
      errors.push(`${location}: calculation needs final-result acceptedForms`);
  }
  if (content.type === 'multipart') {
    const seen = new Set();
    for (const part of content.parts) {
      if (part.dependsOn?.some((label) => !seen.has(label)))
        errors.push(
          `${location}.${part.label}: dependsOn must refer to earlier parts in this group`,
        );
      seen.add(part.label);
      const matches = grading.parts.filter((entry) => entry.label === part.label);
      if (matches.length !== 1)
        errors.push(`${location}.${part.label}: expected exactly one grading entry`);
      if (matches[0])
        reviewContent(part.content, matches[0].grading, `${location}.${part.label}`, errors);
    }
  }
  if (
    grading.rubricCriteria &&
    new Set(grading.rubricCriteria.map((c) => c.id)).size !== grading.rubricCriteria.length
  )
    errors.push(`${location}: rubric criterion IDs must be unique`);
  if (content.type !== 'table' || grading.type !== 'table') return;
  const cols = content.columns.map((c) => c.id);
  const rows = content.rows.map((r) => r.id);
  if (new Set(cols).size !== cols.length || new Set(rows).size !== rows.length)
    errors.push(`${location}: duplicate table row/column IDs`);
  const expected = new Set();
  for (const row of content.rows) {
    for (const key of Object.keys(row.cells))
      if (!cols.includes(key)) errors.push(`${location}: unknown column ${key} in row ${row.id}`);
    for (const column of content.columns.filter((c) => c.role === 'answer')) {
      expected.add(`${row.id}:${column.id}`);
      if (row.cells[column.id]?.trim())
        errors.push(`${location}: public answer cell ${row.id}:${column.id} must be empty`);
    }
  }
  if (!expected.size) errors.push(`${location}: table needs an answer column`);
  const actual = grading.cells.map((cell) => `${cell.rowId}:${cell.colId}`);
  if (
    new Set(actual).size !== actual.length ||
    actual.length !== expected.size ||
    actual.some((key) => !expected.has(key))
  )
    errors.push(`${location}: table grading must cover each answer cell exactly once`);
  for (const cell of grading.cells) {
    if (
      cell.matcher === 'run_check'
        ? !cell.check?.includes('{answer}')
        : !cell.acceptedAnswers.length
    )
      errors.push(
        `${location}: table cell ${cell.rowId}:${cell.colId} needs answers or a run_check expression`,
      );
  }
}

let modules;
export function checkPreparedManifest(input) {
  modules ??= parserModules();
  const errors = [];
  let batches;
  try {
    batches = splitManifest(input);
  } catch (error) {
    return { valid: false, errors: [error.message] };
  }
  let count = 0;
  let executable = 0;
  for (const [index, batch] of batches.entries()) {
    try {
      const parsed = modules.parseStructuredCourseProblemImport(batch);
      for (const item of batch.items) {
        if (
          item.draft.type === 'multipart' &&
          item.draft.publicContent.parts.some((part) => part.content.type === 'code') &&
          item.draft.notebookId !== null
        )
          errors.push(
            `${item.draft.draftId}: executable multipart needs explicit notebookId:null before preflight to preserve its signed fingerprint`,
          );
      }
      unknownKeys(batch, parsed, `batch[${index}]`, errors);
      for (const item of parsed.items) {
        const location = item.draft.draftId;
        const codeErrors = modules.codeDraftReadinessErrors(item.draft);
        errors.push(...codeErrors.map((error) => `${location}: ${error}`));
        reviewContent(item.draft.publicContent, item.draft.grading, location, errors);
        const secrets = item.draft.secretJudge;
        for (const code of [
          secrets?.secretTestCode,
          ...Object.values(secrets?.parts ?? {}).map((part) => part.secretTestCode),
        ]) {
          if (/\b(?:import\s+solution\b|from\s+solution\s+import\b)/.test(code ?? ''))
            errors.push(`${location}: Python tests must import submission, not solution`);
        }
        if (
          item.draft.type === 'code' ||
          (item.draft.publicContent.type === 'multipart' &&
            item.draft.publicContent.parts.some((p) => p.content.type === 'code'))
        )
          executable++;
        count++;
      }
    } catch (error) {
      errors.push(`batch[${index}]: ${error.message}`);
    }
  }
  return {
    valid: !errors.length,
    itemCount: count,
    batchCount: batches.length,
    executableQuestionCount: executable,
    errors,
    scope:
      'Offline schema/content/code-readiness only; no runner, proof, source, correctness, authorization or persistence verification.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new Error('Usage: node scripts/learn/check-course-problem-manifest.mjs MANIFEST.json');
    const result = checkPreparedManifest(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
