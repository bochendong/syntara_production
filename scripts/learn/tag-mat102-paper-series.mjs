#!/usr/bin/env node
/** Audited, tags-only staging maintenance. Never changes questions or learner records. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const COURSE_ID = 'cmu0zx9s10007l404smwwr9f7';
const OWNER_ID = 'system:speedup-store-staging';
class SeriesMaintenanceError extends Error {}
const requireValue = (value, message) => {
  if (!value) throw new SeriesMaintenanceError(message);
};
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export function contentDigest(row) {
  const { tags: _tags, updatedAt: _updatedAt, ...content } = row;
  return digest(content);
}

export function paperSource(row) {
  const meta = row.sourceMeta ?? {};
  const match = String(meta.sourceFile ?? '').match(
    /(?:^|[/\\])MAT102_(TT[12])_模拟卷_([A-J])_题目版(_真题优先修订版)?\.pdf$/,
  );
  if (!match) return null;
  const [, exam, paper, revised] = match;
  requireValue(
    (!meta.exam || meta.exam === `MAT102 ${exam}`) &&
      (!meta.mockPaper || meta.mockPaper === paper) &&
      (!meta.paper || meta.paper === paper),
    'Conflicting paper provenance; no tags were written.',
  );
  requireValue(exam !== 'TT1' || (!revised && paper <= 'H'), 'Invalid TT1 paper.');
  if (exam === 'TT1') return { exam, paper, revised: false };
  const item = String(meta.sourceItem ?? '').match(/^(MC|LA)0*([1-9][0-9]*)$/);
  requireValue(item, 'TT2 paper has no unambiguous question slot.');
  return { exam, paper, revised: Boolean(revised), slot: `${item[1]}${Number(item[2])}` };
}

/** Source slots, not titles or generic TT2 tags, determine membership in each edition. */
export function planPaperTags(rows) {
  requireValue(
    rows.every((row) => row.courseId === COURSE_ID),
    'Wrong course in source rows.',
  );
  const tagged = rows.map((row) => ({ row, source: paperSource(row) }));
  const seriesById = new Map();
  const counts = {};
  const add = (row, label) => {
    const labels = seriesById.get(row.id) ?? [];
    labels.push(label);
    seriesById.set(row.id, labels);
    counts[label] = (counts[label] ?? 0) + 1;
  };
  for (const paper of 'ABCDEFGH') {
    const entries = tagged.filter((x) => x.source?.exam === 'TT1' && x.source.paper === paper);
    requireValue(entries.length === 14, `TT1 ${paper} is not a complete 14-question paper.`);
    for (const { row } of entries) add(row, `TT1模拟${paper}卷`);
  }
  for (const paper of 'ABCDEFGHIJ') {
    const entries = tagged.filter((x) => x.source?.exam === 'TT2' && x.source.paper === paper);
    const original = entries.filter((x) => !x.source.revised);
    const revised = entries.filter((x) => x.source.revised);
    requireValue(original.length === 14, `TT2 ${paper} original paper is incomplete.`);
    const slots = new Map();
    for (const entry of original) {
      requireValue(!slots.has(entry.source.slot), 'Duplicate original paper slot.');
      slots.set(entry.source.slot, entry.row);
    }
    const expected = [
      ...Array.from({ length: 10 }, (_, i) => `MC${i + 1}`),
      'LA1',
      'LA2',
      'LA3',
      'LA4',
    ];
    requireValue(
      expected.every((slot) => slots.has(slot)),
      'Unexpected original paper slots.',
    );
    const seen = new Set();
    for (const entry of revised) {
      requireValue(
        slots.has(entry.source.slot) && !seen.has(entry.source.slot),
        'Duplicate or unknown revised paper slot.',
      );
      seen.add(entry.source.slot);
      slots.set(entry.source.slot, entry.row);
    }
    // The plain label selects exactly the current full paper, including unchanged questions.
    for (const row of slots.values()) add(row, `TT2模拟${paper}卷`);
    for (const { row } of original) add(row, `TT2原版模拟${paper}卷`);
  }
  const items = rows
    .filter((row) => seriesById.has(row.id))
    .map((row) => {
      const labels = seriesById.get(row.id);
      const afterTags = [...labels, ...row.tags.filter((tag) => !labels.includes(tag))];
      requireValue(afterTags.length <= 16, 'Adding paper labels would exceed the tag limit.');
      return {
        id: row.id,
        contentHash: contentDigest(row),
        expectedVersion: new Date(row.updatedAt).toISOString(),
        beforeTags: row.tags,
        afterTags,
        labels,
      };
    });
  const data = {
    version: 1,
    courseId: COURSE_ID,
    expectedOwnerId: OWNER_ID,
    counts,
    totalQuestions: rows.length,
    unchangedNonMockQuestions: rows.length - items.length,
    items,
  };
  return { ...data, payloadHash: digest(data) };
}

export async function applyPaperTags(db, plan, authorize) {
  const { payloadHash, ...data } = plan;
  requireValue(digest(data) === payloadHash, 'Plan hash mismatch.');
  requireValue(plan.courseId === COURSE_ID && plan.expectedOwnerId === OWNER_ID, 'Wrong target.');
  return db.$transaction(
    async (tx) => {
      const course = await tx.course.findUnique({ where: { id: COURSE_ID } });
      requireValue(course?.ownerId === OWNER_ID, 'Course owner changed.');
      authorize(course);
      const rows = await tx.notebookProblem.findMany({
        where: { courseId: COURSE_ID },
        orderBy: { id: 'asc' },
      });
      const fresh = planPaperTags(rows);
      requireValue(
        fresh.items.length === plan.items.length && digest(fresh.counts) === digest(plan.counts),
        'Paper membership changed after preview.',
      );
      const current = new Map(rows.map((row) => [row.id, row]));
      const inferred = new Map(fresh.items.map((item) => [item.id, item]));
      requireValue(
        new Set(plan.items.map((item) => item.id)).size === plan.items.length &&
          plan.items.every((item) => inferred.has(item.id)),
        'Plan must contain every source question exactly once.',
      );
      let updated = 0;
      for (const item of plan.items) {
        const row = current.get(item.id);
        const derived = inferred.get(item.id);
        requireValue(
          row &&
            derived &&
            contentDigest(row) === item.contentHash &&
            digest(derived.labels) === digest(item.labels) &&
            digest(item.afterTags) ===
              digest([
                ...item.labels,
                ...item.beforeTags.filter((tag) => !item.labels.includes(tag)),
              ]),
          'Question content or tag plan changed after preview.',
        );
        if (digest(row.tags) === digest(item.afterTags)) continue; // Safe identical replay.
        requireValue(
          digest(row.tags) === digest(item.beforeTags) &&
            new Date(row.updatedAt).toISOString() === item.expectedVersion,
          'Question was edited after preview; no changes committed.',
        );
        const result = await tx.notebookProblem.updateMany({
          where: {
            id: item.id,
            courseId: COURSE_ID,
            updatedAt: new Date(item.expectedVersion),
            tags: { equals: item.beforeTags },
          },
          data: { tags: item.afterTags },
        });
        requireValue(result.count === 1, 'Concurrent edit; no changes committed.');
        updated++;
      }
      if (updated)
        await tx.course.update({
          where: { id: COURSE_ID },
          data: { contentVersion: { increment: 1 } },
        });
      return { updated, alreadyApplied: plan.items.length - updated, counts: plan.counts };
    },
    { isolationLevel: 'Serializable', timeout: 120_000 },
  );
}

async function save(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    requireValue(
      ['--workspace', '--plan', '--receipt', '--apply'].includes(flag),
      'Unknown option.',
    );
    requireValue(options[flag] === undefined, 'Repeated option.');
    options[flag] = flag === '--apply' ? true : args[++i];
  }
  requireValue(
    options['--plan'] && options['--receipt'],
    'A private plan and receipt are required.',
  );
  const workspace = path.resolve(options['--workspace'] ?? '/app');
  const require = createRequire(path.join(workspace, 'package.json'));
  const { createJiti } = require('jiti');
  const jiti = createJiti(path.join(workspace, 'package.json'), { alias: { '@': workspace } });
  const authority = jiti(path.join(workspace, 'lib/server/course-problem-import-operator.ts'));
  // Real Railway environment, service, database host, deployment and owner authority, no impersonation.
  const operator = authority.createStagingProblemImportOperator({
    courseId: COURSE_ID,
    expectedDataOwnerId: OWNER_ID,
  });
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } }, log: [] });
  const receiptPath = path.resolve(options['--receipt']);
  try {
    const course = await db.course.findUnique({ where: { id: COURSE_ID } });
    authority.assertStagingProblemImportOperator(operator, COURSE_ID, course?.ownerId);
    const before = await db.notebookProblem.findMany({
      where: { courseId: COURSE_ID },
      orderBy: { id: 'asc' },
    });
    const notebooks = await db.notebook.findMany({
      where: { courseId: COURSE_ID },
      orderBy: { id: 'asc' },
    });
    const receipt = {
      actor: authority.problemImportOperatorAudit(operator),
      scriptSha256: createHash('sha256')
        .update(await readFile(new URL(import.meta.url)))
        .digest('hex'),
      before: { course, questions: before, notebookHash: digest(notebooks) },
    };
    await save(receiptPath, receipt);
    if (!options['--apply']) {
      const plan = planPaperTags(before);
      await save(path.resolve(options['--plan']), plan);
      receipt.preview = {
        payloadHash: plan.payloadHash,
        counts: plan.counts,
        affected: plan.items.length,
      };
    } else {
      const plan = JSON.parse(await readFile(options['--plan'], 'utf8'));
      receipt.result = await applyPaperTags(db, plan, (current) =>
        authority.assertStagingProblemImportOperator(operator, COURSE_ID, current.ownerId),
      );
      const after = await db.notebookProblem.findMany({
        where: { courseId: COURSE_ID },
        orderBy: { id: 'asc' },
      });
      requireValue(before.length === after.length, 'Question count changed during maintenance.');
      const byId = new Map(after.map((row) => [row.id, row]));
      const planned = new Map(plan.items.map((item) => [item.id, item]));
      for (const row of before) {
        const saved = byId.get(row.id);
        requireValue(
          saved && contentDigest(saved) === contentDigest(row),
          'Non-tag field changed.',
        );
        requireValue(
          digest(saved.tags) === digest(planned.get(row.id)?.afterTags ?? row.tags),
          'Tags readback differs from the reviewed plan.',
        );
      }
      const afterNotebooks = await db.notebook.findMany({
        where: { courseId: COURSE_ID },
        orderBy: { id: 'asc' },
      });
      requireValue(digest(notebooks) === digest(afterNotebooks), 'Notebooks changed.');
      receipt.after = {
        course: await db.course.findUnique({ where: { id: COURSE_ID } }),
        questions: after,
      };
      receipt.verified = true;
    }
    await save(receiptPath, receipt);
    process.stdout.write(
      JSON.stringify({
        mode: options['--apply'] ? 'applied' : 'preview',
        ...receipt.preview,
        ...receipt.result,
        verified: receipt.verified,
      }) + '\n',
    );
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    const detail =
      error instanceof SeriesMaintenanceError
        ? error.message
        : /^P[0-9]{4}$/.test(error?.code ?? '')
          ? error.code
          : 'storage_or_verification_error';
    process.stderr.write(
      `Series maintenance stopped (${detail}). Inspect the private receipt before retrying.\n`,
    );
    process.exitCode = 1;
  });
