#!/usr/bin/env node
/** Reviewed presentation migration. Requires an existing staging tunnel on localhost:15433.
 * node scripts/maintenance/sync-cpsc110-reviewed-staging.mjs BASELINE.json BACKUP_DIR [--apply]
 * Keeps grading, secrets, identities and learner records; archives the eight world programs.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { createJiti } from 'jiti';
const [baselineFile, backupDir, flag] = process.argv.slice(2);
if (!baselineFile || !backupDir || (flag && flag !== '--apply'))
  throw Error('Expected BASELINE.json BACKUP_DIR [--apply]');
const apply = flag === '--apply';
const project = '8cddd1ea-24e1-49a9-8d27-dce86069dc8b';
const environment = '6697de1f-eb0d-4a6f-8709-cfe477a29f11';
const service = 'ce8c8ac4-adfe-4fa3-a6c4-34dafa2bd883';
const courseId = 'cmvt9k1i90001mz01y3j8l01p';
const target = JSON.parse(
  readFileSync(
    new URL('../../apps/native/src/qa/cpsc110-staging-data.json', import.meta.url),
    'utf8',
  ),
);
const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
const original = new Map(baseline.problems.map((p) => [p.id, p]));
assert.equal(original.size, 153);
assert.equal(target.problems.length, 145);
assert(target.problems.every((p) => p.courseId === courseId && original.has(p.id)));
const jiti = createJiti(import.meta.url, { alias: { '@': resolve('.') } });
const { notebookProblemPublicContentSchema } = await jiti.import(
  '../../lib/problem-bank/schema.ts',
);
const planned = new Map(
  target.problems.map((p) => [p.id, notebookProblemPublicContentSchema.parse(p.publicContent)]),
);
const archived = [...original.values()].filter((p) => !planned.has(p.id));
assert.equal(archived.length, 8);
assert(archived.every((p) => /World program/.test(p.title)));
// Read only the staging database service configuration; never print credential-bearing output.
const variables = JSON.parse(
  execFileSync(
    'railway',
    [
      'variable',
      'list',
      '--project',
      project,
      '--environment',
      environment,
      '--service',
      service,
      '--json',
    ],
    { encoding: 'utf8' },
  ),
);
assert.equal(variables.RAILWAY_PROJECT_ID, project);
assert.equal(variables.RAILWAY_ENVIRONMENT_ID, environment);
assert.equal(variables.RAILWAY_SERVICE_ID, service);
const connection = new URL(variables.DATABASE_URL);
connection.hostname = '127.0.0.1';
connection.port = '15433';
const db = new PrismaClient({ datasources: { db: { url: connection.toString() } } });
const snapshot = async (client) => {
  const course = await client.course.findUniqueOrThrow({ where: { id: courseId } });
  const problems = await client.notebookProblem.findMany({
    where: { courseId, ownerId: null },
    include: { secret: true, tagAssignments: true },
    orderBy: { id: 'asc' },
  });
  const attempts = await client.notebookProblemAttempt.findMany({
    where: { problem: { courseId } },
    orderBy: { id: 'asc' },
  });
  const progress = await client.notebookProblemProgress.findMany({
    where: { problem: { courseId } },
    orderBy: { id: 'asc' },
  });
  const notebooks = await client.notebook.findMany({
    where: { courseId },
    select: {
      id: true,
      updatedAt: true,
      contentVersion: true,
      releasedContentVersion: true,
      releaseAddedIn: true,
      releaseUpdatedIn: true,
    },
    orderBy: { id: 'asc' },
  });
  return { course, problems, attempts, progress, notebooks };
};
const dump = (file, value) =>
  writeFileSync(join(backupDir, file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
try {
  const before = await snapshot(db);
  assert.equal(before.course.name, 'UBC-CPSC110');
  assert.equal(before.problems.length, 153);
  for (const p of before.problems) {
    assert.equal(
      p.updatedAt.toISOString(),
      original.get(p.id)?.updatedAt,
      `Concurrent change: ${p.id}`,
    );
    assert.equal(p.type, original.get(p.id).type);
  }
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  dump('before.json', before);
  const report = {
    mode: apply ? 'applied' : 'preview',
    courseId,
    updated: planned.size,
    archived: archived.length,
    attemptsPreserved: before.attempts.length,
    progressPreserved: before.progress.length,
    notebooksPreserved: before.notebooks.length,
  };
  if (apply) {
    await db.$transaction(
      async (tx) => {
        const locked =
          await tx.$queryRaw`SELECT "id" FROM "Course" WHERE "id" = ${courseId} FOR UPDATE`;
        assert.equal(locked.length, 1);
        const currentCourse = await tx.course.findUniqueOrThrow({ where: { id: courseId } });
        assert.equal(
          currentCourse.updatedAt.toISOString(),
          before.course.updatedAt.toISOString(),
          'Concurrent course change',
        );
        const version = currentCourse.contentVersion + 1;
        const now = new Date();
        for (const p of before.problems) {
          const content = planned.get(p.id);
          const data = content
            ? { publicContentJson: content, contentUpdatedAt: now, releaseUpdatedIn: version }
            : { status: 'archived', contentUpdatedAt: now, releaseUpdatedIn: version };
          const saved = await tx.notebookProblem.updateMany({
            where: { id: p.id, courseId, ownerId: null, updatedAt: p.updatedAt },
            data,
          });
          assert.equal(saved.count, 1, `Concurrent change: ${p.id}`);
        }
        const publishedProblemCount = await tx.notebookProblem.count({
          where: { courseId, ownerId: null, status: 'published' },
        });
        assert.equal(publishedProblemCount, 145);
        await tx.course.update({
          where: { id: courseId },
          data: { contentVersion: version, publishedProblemCount },
        });
        // Validate inside the transaction so any mismatch rolls back all question changes.
        const after = await snapshot(tx);
        assert.deepEqual(after.attempts, before.attempts);
        assert.deepEqual(after.progress, before.progress);
        assert.deepEqual(after.notebooks, before.notebooks);
        for (const p of after.problems) {
          const old = before.problems.find((item) => item.id === p.id);
          for (const key of [
            'gradingJson',
            'secret',
            'sourceMeta',
            'chapterId',
            'notebookId',
            'type',
            'title',
            'order',
            'points',
            'tags',
            'tagAssignments',
          ])
            assert(isDeepStrictEqual(p[key], old[key]), `Unexpected change to ${key}: ${p.id}`);
          if (planned.has(p.id)) assert.deepEqual(p.publicContentJson, planned.get(p.id));
          else assert.equal(p.status, 'archived');
        }
      },
      { maxWait: 10000, timeout: 180000 },
    );
    const after = await snapshot(db);
    dump('after.json', after);
    report.version = after.course.contentVersion;
    report.readBackVerified = true;
  }
  dump('report.json', report);
  console.log(JSON.stringify(report));
} finally {
  await db.$disconnect();
}
