#!/usr/bin/env node
/** Explicit, audited Railway staging maintenance. Daily users should use the owner HTTP CLI. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensure, parseArgs, saveReceipt, splitManifest } from './import-course-problems.mjs';

const SOURCES = [
  'lib/server/course-problem-import.ts',
  'lib/server/course-problem-import-operator.ts',
  'lib/server/course-problem-import-admin.ts',
  'lib/server/course-problem-import-grant.ts',
  'lib/server/admin-identity.ts',
  'lib/server/notebook-problems/service.ts',
  'lib/server/notebook-problems/import-batch-store.ts',
];
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function loadOperatorLibraries(workspace, libraryRoot) {
  const require = createRequire(path.join(workspace, 'package.json'));
  const { createJiti } = require('jiti');
  // Exact aliases overlay reviewed new modules while all other dependencies remain in /app.
  const alias = Object.fromEntries(
    SOURCES.map((filename) => [`@/${filename.slice(0, -3)}`, path.join(libraryRoot, filename)]),
  );
  const jiti = createJiti(path.join(workspace, 'package.json'), {
    alias: {
      ...alias,
      zod: require.resolve('zod'),
      './judge': path.join(workspace, 'lib/server/notebook-problems/judge.ts'),
      './import.core.drafts': path.join(
        workspace,
        'lib/server/notebook-problems/import.core.drafts.ts',
      ),
      '@': workspace,
    },
    interopDefault: true,
  });
  const operator = jiti(path.join(libraryRoot, SOURCES[1]));
  const { PrismaClient } = require('@prisma/client');
  return { operator, PrismaClient, loadService: () => jiti(path.join(libraryRoot, SOURCES[0])) };
}

async function baseline(db, courseId) {
  const notebooks = await db.notebook.findMany({
    where: { courseId },
    include: { markdownSections: { orderBy: { id: 'asc' } } },
    orderBy: { id: 'asc' },
  });
  const questions = await db.notebookProblem.findMany({
    where: { courseId },
    orderBy: { id: 'asc' },
  });
  return { notebooks, questions };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args, {
    '--expected-owner-id': 'expectedOwnerId',
    '--workspace': 'workspace',
    '--library-root': 'libraryRoot',
  });
  if (options.help) {
    process.stdout.write(
      'Explicit staging maintenance only; no user impersonation.\n--manifest FILE --expected-owner-id ID [--workspace /app] [--library-root REVIEWED_BUNDLE] [--apply] [--receipt FILE]\nDefault is read-only preview; no environment files are loaded. Use owner HTTP CLI for normal uploads.\n',
    );
    return;
  }
  ensure(
    options.manifest && options.expectedOwnerId,
    '--manifest and --expected-owner-id are required.',
  );
  ensure(
    !options.tokenFile &&
      !options.tokenEnv &&
      !options.origin &&
      !options.credentialFile &&
      !options.listCourses &&
      !options.courseContext,
    'Maintenance does not accept HTTP credentials or origin.',
  );
  const manifest = JSON.parse(await readFile(options.manifest, 'utf8'));
  const batches = splitManifest(manifest);
  const workspace = path.resolve(
    options.workspace || path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  );
  const libraryRoot = path.resolve(options.libraryRoot || workspace);
  const libraries = await loadOperatorLibraries(workspace, libraryRoot);
  // Validate every injected identity BEFORE constructing a database client or importing services.
  const operatorContext = libraries.operator.createStagingProblemImportOperator({
    courseId: manifest.courseId,
    expectedDataOwnerId: options.expectedOwnerId,
  });
  const db = new libraries.PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
    log: [],
  });
  globalThis.__synatraPrisma__ = db;
  globalThis.__synatraPrismaUrl__ = process.env.DATABASE_URL;
  const receiptPath = options.receipt || `${options.manifest}.operator-receipt.json`;
  const receipt = {
    version: 1,
    mode: options.apply ? 'commit' : 'preview',
    actor: libraries.operator.problemImportOperatorAudit(operatorContext),
    courseId: manifest.courseId,
    manifestSha256: createHash('sha256')
      .update(await readFile(options.manifest))
      .digest('hex'),
    sources: {},
    batches: [],
  };
  try {
    for (const filename of SOURCES)
      receipt.sources[filename] = createHash('sha256')
        .update(await readFile(path.join(libraryRoot, filename)))
        .digest('hex');
    const service = libraries.loadService().createStructuredCourseProblemImportService();
    const actor = { operatorContext };
    const before = await baseline(db, manifest.courseId);
    receipt.before = {
      notebookCount: before.notebooks.length,
      notebookHash: digest(before.notebooks),
      questionCount: before.questions.length,
      questionHash: digest(before.questions),
    };
    // Full private backup/readback, including grading. Never include database credentials.
    await saveReceipt(`${receiptPath}.before.json`, before);
    for (const data of batches)
      receipt.batches.push({ preview: await service.preview(data, actor) });
    await saveReceipt(receiptPath, receipt);
    if (options.apply)
      for (let index = 0; index < batches.length; index++) {
        receipt.batches[index].result = await service.commit(
          batches[index],
          actor,
          receipt.batches[index].preview.payloadHash,
        );
        await saveReceipt(receiptPath, receipt);
      }
    const after = await baseline(db, manifest.courseId);
    const previousIds = new Set(before.questions.map((question) => question.id));
    receipt.after = {
      notebookCount: after.notebooks.length,
      notebookHash: digest(after.notebooks),
      questionCount: after.questions.length,
      previousQuestionHash: digest(
        after.questions.filter((question) => previousIds.has(question.id)),
      ),
    };
    await saveReceipt(`${receiptPath}.after.json`, after);
    ensure(
      receipt.after.notebookHash === receipt.before.notebookHash &&
        receipt.after.previousQuestionHash === receipt.before.questionHash,
      'Existing notebook/question baseline changed. Inspect the private before/after records.',
    );
    await saveReceipt(receiptPath, receipt);
    process.stdout.write(
      `${options.apply ? 'Committed and verified' : 'Previewed'} ${batches.length} maintenance batch(es). Private receipt: ${receiptPath}\n`,
    );
  } catch (error) {
    receipt.failed = true;
    await saveReceipt(receiptPath, receipt);
    // ORM errors can contain database URLs or query arguments; never forward them to stdout/stderr.
    throw new Error(
      `Maintenance stopped (${error?.name === 'CourseProblemImportError' ? error.code : 'verification_or_storage_error'}). Inspect the private receipt and reconcile before retrying.`,
    );
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(() => {
    process.stderr.write(
      'Maintenance stopped. Check the selected staging identity, manifest and private receipt; no credentials are printed.\n',
    );
    process.exitCode = 1;
  });
