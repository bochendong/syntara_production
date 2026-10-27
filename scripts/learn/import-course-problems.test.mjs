import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server.js';
import { loadOperatorLibraries } from './import-course-problems-operator.mjs';
import {
  importThroughHttp,
  splitManifest,
  validateOrigin,
  parseArgs,
} from './import-course-problems.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const cache = new Map();
const mocks = new Map([
  ['@/lib/server/prisma', { prisma: {} }],
  [
    '@/lib/server/notebook-problems/service',
    {
      createCourseProblemsFromDraftsWithSummary() {
        throw new Error('Real database writes forbidden in offline tests');
      },
    },
  ],
]);
function loadSource(file) {
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
        ? loadSource(specifier.slice(2))
        : specifier.startsWith('.')
          ? loadSource(path.resolve(path.dirname(filename), specifier))
          : require(specifier);
  const inspectPrivateNormalizer =
    filename === path.join(root, 'lib/server/notebook-problems/service.ts')
      ? '\nexports.normalizeDraftForPersistenceForTest = normalizeDraftForPersistence;'
      : '';
  new Function('require', 'module', 'exports', compiled.outputText + inspectPrivateNormalizer)(
    localRequire,
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}
const { createStructuredCourseProblemImportService, parseStructuredCourseProblemImport } =
  loadSource('lib/server/course-problem-import.ts');
const { createStagingProblemImportOperator } = loadSource(
  'lib/server/course-problem-import-operator.ts',
);
const { resolveCourseProblemImportGrant, assertCourseProblemImportGrant } = loadSource(
  'lib/server/course-problem-import-grant.ts',
);
const { courseProblemDedupeKey } = loadSource('features/problems/domain/problem-dedupe.ts');
const { readProblemImportCommitResult } = loadSource(
  'lib/server/notebook-problems/import-batch-store.ts',
);

function manifest() {
  return {
    version: 1,
    courseId: 'course',
    idempotencyKey: 'test-midterm-a',
    chapters: [{ ref: 'sets', name: 'Sets' }],
    items: [
      {
        chapterRef: 'sets',
        draft: {
          draftId: 'A1',
          title: 'A1: Sets',
          type: 'proof',
          status: 'published',
          source: 'pdf',
          points: 100,
          tags: ['A', 'sets'],
          difficulty: 'hard',
          publicContent: {
            type: 'proof',
            stem: 'Prove that $A \\cap B \\subseteq A$.',
            taskKind: 'proof',
            responseKind: 'long_text',
          },
          grading: {
            type: 'proof',
            referenceProof: 'Let $x \\in A \\cap B$. Then $x \\in A$.',
            rubric: 'Use the definition of intersection.',
            rubricCriteria: [
              { id: 'membership', description: 'Correct element argument.', points: 100 },
            ],
          },
          sourceMeta: { file: 'MockA.pdf', page: 1, question: '1', sourceSha256: 'a'.repeat(64) },
          validationErrors: [],
        },
      },
    ],
  };
}

function harness() {
  const chapters = new Map();
  const questions = new Map();
  const batches = new Map();
  const users = new Map([
    ['enrolled', { email: 'student@example.test', role: 'USER' }],
    ['admin', { email: 'admin@example.test', role: 'ADMIN' }],
  ]);
  let writes = 0;
  let lastWrite;
  const db = {
    user: { findUnique: async ({ where }) => users.get(where.id) },
    $queryRaw: async (query) => [{ role: users.get(query.values[0])?.role || 'USER' }],
    course: { findUnique: async () => ({ id: 'course', name: 'MAT102', ownerId: 'owner' }) },
    courseProblemChapter: {
      findUnique: async ({ where }) => chapters.get(where.id),
      findFirst: async ({ where }) =>
        [...chapters.values()].find(
          (row) => row.courseId === where.courseId && row.name === where.name,
        ),
      aggregate: async () => ({ _max: { position: null } }),
      create: async ({ data }) => {
        const row = { id: `chapter${chapters.size}`, ...data };
        chapters.set(row.id, row);
        return row;
      },
    },
    problemImportBatch: { findUnique: async ({ where }) => batches.get(where.id) },
    notebookProblem: {
      findMany: async ({ where }) =>
        [...questions.values()]
          .filter((row) =>
            where.id ? where.id.in.includes(row.id) : where.dedupeKey.in.includes(row.dedupeKey),
          )
          .map((row) => ({ ...row, chapter: chapters.get(row.chapterId) })),
    },
  };
  const store = {
    createProblemImportBatch: async (args) => {
      if (!batches.has(args.batchId))
        batches.set(args.batchId, {
          id: args.batchId,
          ownerId: args.userId,
          courseId: args.courseId,
          targetType: 'course',
          draftSnapshotJson: args.draftSnapshot,
          status: 'previewed',
          commitResultJson: null,
        });
      return batches.get(args.batchId);
    },
    getProblemImportBatchForTarget: async ({ batchId }) => batches.get(batchId),
    claimProblemImportBatchCommit: async ({ batchId }) => {
      const batch = batches.get(batchId);
      if (batch.status === 'committing') return null;
      batch.status = 'committing';
      batch.commitLeaseToken = 'lease';
      return batch;
    },
    markProblemImportBatchCommitted: async ({ batchId, commitResult }) => {
      const batch = batches.get(batchId);
      batch.status = 'committed';
      batch.commitResultJson = commitResult;
      return batch;
    },
    readProblemImportCommitResult,
  };
  const writeDrafts = async (args) => {
    writes++;
    lastWrite = args;
    const insertedProblemIds = [];
    const reusedProblemIds = [];
    const reusedDrafts = [];
    const skippedDraftIds = [];
    for (const draft of args.drafts) {
      const previous = [...questions.values()].find(
        (row) => row.dedupeKey === courseProblemDedupeKey(draft),
      );
      if (previous) args.validateReusedDraft?.(draft, previous);
    }
    for (const draft of args.drafts) {
      const dedupeKey = courseProblemDedupeKey(draft);
      const previous = [...questions.values()].find((row) => row.dedupeKey === dedupeKey);
      if (previous) {
        reusedProblemIds.push(previous.id);
        skippedDraftIds.push(draft.draftId);
        reusedDrafts.push({ draftId: draft.draftId, existingProblemId: previous.id, dedupeKey });
        continue;
      }
      const id = `problem${questions.size}`;
      questions.set(id, {
        id,
        ownerId: null,
        courseId: args.courseId,
        notebookId: null,
        chapterId: args.chapterIdByDraftId[draft.draftId],
        dedupeKey,
        title: draft.title,
        type: draft.type,
        source: draft.source,
        status: draft.status,
        points: draft.points,
        tags: draft.tags,
        difficulty: draft.difficulty,
        publicContentJson: draft.publicContent,
        gradingJson: draft.grading,
        sourceMeta: draft.sourceMeta,
        updatedAt: new Date('2026-10-26T00:00:00Z'),
      });
      insertedProblemIds.push(id);
    }
    const writeSummary = {
      requestedCount: args.drafts.length,
      insertedProblemIds,
      reusedProblemIds,
      skippedDraftIds,
      reusedDrafts,
    };
    batches.get(args.importBatchId).commitResultJson = writeSummary;
    return { problems: [], writeSummary };
  };
  return {
    service: createStructuredCourseProblemImportService({ db, store, writeDrafts }),
    chapters,
    questions,
    batches,
    users,
    get writes() {
      return writes;
    },
    get lastWrite() {
      return lastWrite;
    },
  };
}

test('enrolled user cannot preview or commit; no chapter/batch/question writes', async () => {
  const h = harness();
  await assert.rejects(h.service.preview(manifest(), { userId: 'enrolled' }), { status: 403 });
  await assert.rejects(h.service.commit(manifest(), { userId: 'enrolled' }, 'x'), { status: 403 });
  assert.equal(h.writes, 0);
  assert.equal(h.chapters.size + h.batches.size, 0);
});
test('explicit chapter from another course is rejected in preview', async () => {
  const h = harness();
  h.chapters.set('foreign', { id: 'foreign', name: 'Sets', courseId: 'other' });
  const data = manifest();
  data.chapters[0].id = 'foreign';
  await assert.rejects(h.service.preview(data, { userId: 'owner' }), {
    status: 409,
    code: 'chapter_conflict',
  });
  assert.equal(h.writes, 0);
});
test('preview is read-only; commit preserves proof payload, difficulty, chapter and provenance', async () => {
  const h = harness();
  const data = manifest();
  const preview = await h.service.preview(data, { userId: 'owner' });
  assert.equal(h.batches.size + h.chapters.size + h.writes, 0);
  const result = await h.service.commit(data, { userId: 'owner' }, preview.payloadHash);
  const question = result.items[0].problem;
  assert.equal(result.createsNotebooks, 0);
  assert.equal(question.chapterName, 'Sets');
  assert.equal(question.notebookId, null);
  assert.equal(question.difficulty, 'hard');
  assert.deepEqual(question.grading, data.items[0].draft.grading);
  assert.equal(question.sourceMeta.sourceSha256, 'a'.repeat(64));
  assert.equal(h.lastWrite.userId, 'owner');
  assert.equal(h.lastWrite.operatorContext, undefined);
  assert.equal(h.lastWrite.dedupeReadStrategy, 'indexed_input_keys');
  assert.equal(h.lastWrite.publishCourseVersion, true);
  assert.equal(h.lastWrite.preservePreparedContent, true);
});
test('same batch retry returns exact receipt without another write or chapter', async () => {
  const h = harness();
  const data = manifest();
  const preview = await h.service.preview(data, { userId: 'owner' });
  const first = await h.service.commit(data, { userId: 'owner' }, preview.payloadHash);
  const second = await h.service.commit(data, { userId: 'owner' }, preview.payloadHash);
  assert.equal(second.replayed, true);
  assert.deepEqual(first.items, second.items);
  assert.equal(h.writes, 1);
  assert.equal(h.chapters.size, 1);
});
test('readback refuses a saved shared question changed to a private owner', async () => {
  const h = harness();
  const data = manifest();
  const actor = { userId: 'owner' };
  const preview = await h.service.preview(data, actor);
  const saved = await h.service.commit(data, actor, preview.payloadHash);
  const row = h.questions.get(saved.items[0].problem.id);
  assert.equal(row.ownerId, null);
  row.ownerId = 'enrolled';
  await assert.rejects(h.service.commit(data, actor, preview.payloadHash), {
    status: 409,
    code: 'readback_conflict',
  });
  assert.equal(h.writes, 1);
  assert.equal(row.ownerId, 'enrolled');
});

test('merged bulk service preserves learner-private writes and isolates shared indexed dedupe from private rows', async () => {
  const db = mocks.get('@/lib/server/prisma').prisma;
  const original = { ...db };
  const created = [];
  const queries = [];
  const versionUpdates = [];
  Object.assign(db, {
    course: {
      findUnique: async () => ({ id: 'course', ownerId: 'owner', externalBinding: null }),
      updateMany: async () => ({ count: 1 }),
      update: async (args) => {
        versionUpdates.push(args);
        return {};
      },
    },
    notebook: { findMany: async () => [], aggregate: async () => ({ _sum: {} }) },
    notebookProblem: {
      findMany: async (args) => {
        queries.push(args);
        return [];
      },
      count: async () => 0,
      aggregate: async () => ({ _max: { problemNumber: 0 } }),
      create: async ({ data }) => {
        created.push(data);
        return { id: `row-${created.length}`, ...data };
      },
    },
    $queryRaw: async () => [{ id: 'fixture-enrollment' }],
    $queryRawUnsafe: async () => [],
    $transaction: async (run) => run(db),
  });
  try {
    const { createCourseProblemsFromDraftsWithSummary } = loadSource(
      'lib/server/notebook-problems/service.ts',
    );
    await createCourseProblemsFromDraftsWithSummary({
      userId: 'enrolled',
      courseId: 'course',
      drafts: [manifest().items[0].draft],
      returnProblems: false,
      publishCourseVersion: true,
    });
    assert.equal(created[0].ownerId, 'enrolled');
    assert.equal(created[0].dedupeKey, null);
    assert.equal(created[0].problemNumber, null);
    assert.equal(versionUpdates.length, 0);
    assert.ok(
      queries.some((query) => query.where?.OR?.some((where) => where.ownerId === 'enrolled')),
    );
    queries.length = 0;
    const operatorContext = createStagingProblemImportOperator({
      courseId: 'course',
      expectedDataOwnerId: 'owner',
      env: stagingEnv,
    });
    await createCourseProblemsFromDraftsWithSummary({
      operatorContext,
      courseId: 'course',
      drafts: [manifest().items[0].draft],
      dedupeReadStrategy: 'indexed_input_keys',
      returnProblems: false,
      publishCourseVersion: true,
    });
    assert.equal(created[1].ownerId, null);
    assert.match(created[1].dedupeKey, /^v2:/);
    assert.equal(created[1].problemNumber, 1);
    const dedupeQueries = queries.filter((query) => Object.hasOwn(query.where || {}, 'dedupeKey'));
    assert.equal(dedupeQueries.length, 2);
    assert.ok(dedupeQueries.every((query) => query.where.ownerId === null));
    assert.equal(versionUpdates.length, 1);
  } finally {
    for (const key of Object.keys(db)) delete db[key];
    Object.assign(db, original);
  }
});

// Exact affected canonical stems; reference/rubric fixtures stay independent of private answer files.
const preparedStems = [
  String.raw`Suppose $P,Q,R$ are predicates.

(i) Write the truth table for $P\to Q$.

(ii) Use truth tables to show that $(P\lor Q)\to R$ is equivalent to $(P\to R)\land(Q\to R)$.`,
  String.raw`(a) (4 points) A compound predicate $S$ consists of $P$ and $Q$ and is true precisely when an even number of $P,Q$ are true. Construct $S$ using only $\land,\lor,\neg$ and verify it with a truth table.

(b) (6 points) A compound predicate $U$ consists of $P,Q,R$ and is true precisely when an even number are true. Using only $R$ and the predicate $S$ from (a), together with $\land,\lor,\neg$, construct $U$ and verify it with a truth table.`,
  String.raw`A semi-structured collection (SSC) is a set $X$ together with a relation $\preceq$ which is reflexive, antisymmetric, and transitive. An element $P\in X$ is an optimus of $X$ if whenever $x\in X$ satisfies $P\preceq x$, then $P=x$.

(a) (6 points) If $(X,\preceq)$ is an arbitrary SSC, we say that $Q\in X$ is a qomolangma of $X$ if $x\preceq Q$ for all $x\in X$. Show that if an element of $X$ is a qomolangma, then it is also an optimus.

(b) (4 points) Optima and qomolangmas are trying to capture the idea of being “the biggest element” in an SSC. Suppose that instead we wanted to capture the idea of “the smallest element” in $X$. Based on the definitions above, define a pessimus of $X$ (the dual to optimus) and a mariana of $X$ (the dual to qomolangma).`,
  String.raw`Let

$$A=\{a_1,a_2,a_3\},\quad B=\{b_1,b_2,b_3,b_4,b_5\},\quad C=\{c_1,c_2,c_3,c_4\}.$$

The functions $g:A\to B$ and $f:B\to C$ are specified by

| $x$ | $a_1$ | $a_2$ | $a_3$ |
|---|---|---|---|
| $g(x)$ | $b_2$ | $b_1$ | $b_4$ |

| $y$ | $b_1$ | $b_2$ | $b_3$ | $b_4$ | $b_5$ |
|---|---|---|---|---|---|
| $f(y)$ | $c_2$ | $c_1$ | $c_3$ | $c_3$ | $c_4$ |

Which statement is true of $f\circ g:A\to C$?`,
];
test('reviewed construction tasks, local definitions and two Markdown tables survive parse and persistence unchanged', () => {
  const { normalizeDraftForPersistenceForTest } = loadSource(
    'lib/server/notebook-problems/service.ts',
  );
  for (const stem of preparedStems) {
    const data = manifest();
    data.items[0].draft.publicContent.stem = stem;
    const parsed = parseStructuredCourseProblemImport(data).items[0].draft;
    assert.equal(parsed.publicContent.stem, stem);
    assert.deepEqual(parsed.validationErrors, []);
    const persisted = normalizeDraftForPersistenceForTest(parsed, 0, true);
    const twice = normalizeDraftForPersistenceForTest(persisted, 0, true);
    assert.equal(persisted.publicContent.stem, stem);
    assert.equal(persisted.status, 'published');
    assert.deepEqual(twice, persisted);
    assert.deepEqual(persisted.grading, data.items[0].draft.grading);
  }
  // The legacy extraction path retains its existing heuristic behavior.
  const legacyDraft = manifest().items[0].draft;
  legacyDraft.publicContent.stem = preparedStems[0];
  assert.ok(normalizeDraftForPersistenceForTest(legacyDraft, 0).validationErrors.length > 0);
});
test('same key changed grading/difficulty conflicts and never overwrites', async () => {
  const h = harness();
  const data = manifest();
  const preview = await h.service.preview(data, { userId: 'owner' });
  await h.service.commit(data, { userId: 'owner' }, preview.payloadHash);
  data.items[0].draft.difficulty = 'easy';
  await assert.rejects(h.service.preview(data, { userId: 'owner' }), {
    code: 'idempotency_conflict',
  });
  assert.equal(h.writes, 1);
  assert.equal([...h.questions.values()][0].difficulty, 'hard');
});
test('a new operation with conflicting reused content cannot insert other questions', async () => {
  const h = harness();
  const data = manifest();
  const preview = await h.service.preview(data, { userId: 'owner' });
  await h.service.commit(data, { userId: 'owner' }, preview.payloadHash);
  data.idempotencyKey = 'another-reviewed-operation';
  data.items[0].draft.difficulty = 'easy';
  data.items.push({
    chapterRef: 'sets',
    draft: {
      ...data.items[0].draft,
      draftId: 'A2',
      title: 'A2',
      publicContent: {
        ...data.items[0].draft.publicContent,
        stem: 'Prove that the empty set is a subset of every set.',
      },
    },
  });
  const next = await h.service.preview(data, { userId: 'owner' });
  await assert.rejects(h.service.commit(data, { userId: 'owner' }, next.payloadHash), {
    code: 'readback_conflict',
  });
  assert.equal(h.questions.size, 1);
  assert.equal([...h.questions.values()][0].difficulty, 'hard');
});
test('incorrect accepted hash and proof without reference are refused before writes', async () => {
  const h = harness();
  const data = manifest();
  await assert.rejects(h.service.commit(data, { userId: 'owner' }, '0'.repeat(64)), {
    code: 'preview_conflict',
  });
  delete data.items[0].draft.grading.referenceProof;
  await assert.rejects(h.service.preview(data, { userId: 'owner' }), { code: 'invalid_request' });
  assert.equal(h.writes, 0);
});
const stagingEnv = {
  RAILWAY_PROJECT_ID: '8cddd1ea-24e1-49a9-8d27-dce86069dc8b',
  RAILWAY_ENVIRONMENT_ID: '6697de1f-eb0d-4a6f-8709-cfe477a29f11',
  RAILWAY_ENVIRONMENT_NAME: 'staging',
  RAILWAY_SERVICE_ID: 'fd6afb05-6491-451a-b577-abf15fdc0047',
  RAILWAY_SERVICE_NAME: 'native-api-staging',
  RAILWAY_DEPLOYMENT_ID: 'test-deployment',
  DATABASE_URL: 'postgresql://fixture:fixture@staging-postgres.railway.internal:5432/fixture',
};
test('maintenance authority requires exact environment and cannot be forged by JSON', async () => {
  for (const field of Object.keys(stagingEnv))
    assert.throws(() =>
      createStagingProblemImportOperator({
        courseId: 'course',
        expectedDataOwnerId: 'owner',
        env: { ...stagingEnv, [field]: field === 'RAILWAY_DEPLOYMENT_ID' ? '' : 'wrong' },
      }),
    );
  const h = harness();
  await assert.rejects(
    h.service.preview(manifest(), {
      operatorContext: {
        kind: 'railway-staging-maintenance',
        courseId: 'course',
        expectedDataOwnerId: 'owner',
      },
    }),
  );
});
test('maintenance audit distinguishes Railway operator from course data owner', async () => {
  const h = harness();
  const data = manifest();
  const operatorContext = createStagingProblemImportOperator({
    courseId: 'course',
    expectedDataOwnerId: 'owner',
    env: stagingEnv,
  });
  const actor = { operatorContext };
  const preview = await h.service.preview(data, actor);
  const result = await h.service.commit(data, actor, preview.payloadHash);
  assert.equal(h.lastWrite.userId, undefined);
  assert.equal(h.lastWrite.operatorContext, operatorContext);
  assert.equal(result.actor.dataOwnerId, 'owner');
  assert.match(result.actor.operator, /^railway:/);
  assert.equal(result.actor.userId, undefined);
});
test('existing DB administrators can import system-owned courses with separate actor audit', async () => {
  const h = harness();
  const data = manifest();
  const preview = await h.service.preview(data, { userId: 'admin' });
  assert.deepEqual(preview.difficultyCounts, { easy: 0, medium: 0, hard: 1 });
  assert.deepEqual(preview.typeCounts, { proof: 1 });
  const result = await h.service.commit(data, { userId: 'admin' }, preview.payloadHash);
  assert.deepEqual(result.actor, {
    kind: 'authenticated-admin',
    userId: 'admin',
    dataOwnerId: 'owner',
  });
  assert.equal(h.lastWrite.userId, undefined);
  assert.equal(h.lastWrite.adminContext.userId, 'admin');
});
test('existing email/ID administrator allowlists are reused without accepting payload role flags', async () => {
  const h = harness();
  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = ' STUDENT@example.test ';
  try {
    const preview = await h.service.preview(manifest(), { userId: 'enrolled' });
    assert.equal(preview.actor.kind, 'authenticated-admin');
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previous;
  }
  const data = manifest();
  data.admin = true;
  await assert.rejects(h.service.preview(data, { userId: 'enrolled' }));
});

const scopedGrant = {
  grantId: 'fixture-grant',
  userId: 'enrolled',
  courseId: 'course',
  capability: 'append-reviewed-problems',
  expiresAt: '2099-01-01T00:00:00Z',
};
test('course grant defaults off and rejects expired, cross-course, cross-user, ambiguous and malformed configuration', () => {
  const args = { userId: 'enrolled', courseId: 'course', dataOwnerId: 'owner' };
  assert.equal(resolveCourseProblemImportGrant({ ...args, env: {} }), null);
  for (const entries of [
    [{ ...scopedGrant, expiresAt: '2020-01-01T00:00:00Z' }],
    [{ ...scopedGrant, courseId: 'other' }],
    [{ ...scopedGrant, userId: 'other' }],
    [{ ...scopedGrant, capability: 'edit-lectures' }],
    [scopedGrant, { ...scopedGrant, grantId: 'second' }],
    [scopedGrant, scopedGrant],
  ])
    assert.equal(
      resolveCourseProblemImportGrant({
        ...args,
        env: { SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS: JSON.stringify(entries) },
      }),
      null,
    );
  assert.equal(
    resolveCourseProblemImportGrant({
      ...args,
      env: { SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS: 'invalid JSON' },
    }),
    null,
  );
  assert.throws(() =>
    assertCourseProblemImportGrant(
      { ...scopedGrant, kind: 'course-import-grant', dataOwnerId: 'owner' },
      'course',
      'owner',
    ),
  );
});
test('configured course grant preserves real principal/data owner and only uses append-only question import', async () => {
  const previous = process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS;
  process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS = JSON.stringify([scopedGrant]);
  try {
    const h = harness();
    const data = manifest();
    const preview = await h.service.preview(data, { userId: 'enrolled' });
    const result = await h.service.commit(data, { userId: 'enrolled' }, preview.payloadHash);
    assert.equal(result.actor.kind, 'course-import-grant');
    assert.equal(result.actor.userId, 'enrolled');
    assert.equal(result.actor.dataOwnerId, 'owner');
    assert.equal(result.actor.grantId, 'fixture-grant');
    assert.equal(h.lastWrite.userId, undefined);
    assert.equal(h.lastWrite.adminContext, undefined);
    assert.equal(h.lastWrite.operatorContext, undefined);
    assert.equal(h.lastWrite.grantContext.userId, 'enrolled');
    assert.equal(h.lastWrite.drafts[0].notebookId, null);
    assert.equal(h.lastWrite.dedupeReadStrategy, 'indexed_input_keys');
    assert.equal(h.lastWrite.returnProblems, false);
    assert.equal(typeof h.lastWrite.validateReusedDraft, 'function');
    const inputWithClientGrant = { ...data, grant: scopedGrant };
    await assert.rejects(h.service.preview(inputWithClientGrant, { userId: 'enrolled' }));
    process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS = JSON.stringify([
      { ...scopedGrant, expiresAt: '2020-01-01T00:00:00Z' },
    ]);
    await assert.rejects(h.service.preview(data, { userId: 'enrolled' }), { status: 403 });
  } finally {
    if (previous === undefined) delete process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS;
    else process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS = previous;
  }
});
test('question service propagates native device session binding and audits actual wildcard target course', async () => {
  const previous = process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS;
  process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS = JSON.stringify([
    {
      ...scopedGrant,
      courseId: '*',
      keyId: 'device-1',
      capability: 'append-reviewed-course-materials',
    },
  ]);
  try {
    const h = harness();
    const data = manifest();
    for (const keyId of [undefined, 'browser-session', 'wrong-device'])
      await assert.rejects(h.service.preview(data, { userId: 'enrolled', keyId }), { status: 403 });
    const preview = await h.service.preview(data, { userId: 'enrolled', keyId: 'device-1' });
    assert.equal(preview.actor.courseId, 'course');
    assert.equal(preview.actor.scopeCourseId, '*');
    assert.equal(preview.actor.keyId, 'device-1');
  } finally {
    if (previous === undefined) delete process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS;
    else process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS = previous;
  }
});

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
test('HTTP owner CLI previews all batches then commits, bearer is only in header', async () => {
  const calls = [];
  const token = 'test-private-token';
  await withServer(
    async (req, res) => {
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      assert.ok(!JSON.stringify(body).includes(token));
      calls.push(body.mode);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({ success: true, data: { payloadHash: 'a'.repeat(64), mode: body.mode } }),
      );
    },
    async (origin) => {
      const receipt = await importThroughHttp({
        origin,
        token,
        batches: [manifest(), manifest()],
        apply: true,
      });
      assert.deepEqual(calls, ['preview', 'preview', 'commit', 'commit']);
      assert.ok(!JSON.stringify(receipt).includes(token));
    },
  );
});
test('HTTP CLI clearly rejects unauthorized/enrolled accounts without commit', async () => {
  for (const status of [401, 403])
    await withServer(
      (req, res) => {
        res.statusCode = status;
        res.end('{}');
      },
      async (origin) => {
        await assert.rejects(
          importThroughHttp({ origin, token: 'fixture', batches: [manifest()], apply: true }),
          status === 403 ? /real course owner.*enrolled/ : /Authentication failed/,
        );
      },
    );
});
test('HTTP CLI retries transient gateway failure using the identical commit payload/hash', async () => {
  const bodies = [];
  let failed = false;
  await withServer(
    async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      if (body.mode === 'commit') {
        bodies.push(body);
        if (!failed) {
          failed = true;
          res.statusCode = 503;
          res.end('{}');
          return;
        }
      }
      res.end(
        JSON.stringify({ success: true, data: { payloadHash: 'a'.repeat(64), replayed: true } }),
      );
    },
    async (origin) => {
      await importThroughHttp({ origin, token: 'fixture', batches: [manifest()], apply: true });
    },
  );
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0], bodies[1]);
});
test('stable 112-item chunking and CLI origin/token-argument validation', () => {
  const data = manifest();
  data.items = Array.from({ length: 112 }, (_, index) => ({
    ...data.items[0],
    draft: { ...data.items[0].draft, draftId: `Q${index}` },
  }));
  const batches = splitManifest(data);
  assert.deepEqual(
    batches.map((batch) => batch.items.length),
    [100, 12],
  );
  assert.deepEqual(splitManifest(data), batches);
  assert.equal(batches[1].idempotencyKey, 'test-midterm-a:part:2');
  for (const origin of [
    'http://example.com',
    'https://u:p@example.com',
    'https://example.com/path',
  ])
    assert.throws(() => validateOrigin(origin));
  assert.throws(() => parseArgs(['--token', 'plaintext']));
});

test('native route authenticates, refuses shared-test and enrolled principals and ignores no owner override', async () => {
  const h = harness();
  let principal = { userId: 'enrolled' };
  let authMode = 'device';
  const actual = loadSource('lib/server/course-problem-import.ts');
  mocks.set('@/lib/server/course-problem-import', {
    ...actual,
    createStructuredCourseProblemImportService: () => h.service,
  });
  mocks.set('@/lib/server/prisma-safe', { getOptionalPrisma: () => ({}) });
  mocks.set('@/lib/server/native-platform-access', { nativePlatformApiAuthMode: () => authMode });
  mocks.set('@/lib/server/public-api', {
    requireNativePlatformApi: async () => principal,
    publicApiRequestId: () => 'offline-request',
    publicApiSuccess: (requestId, data) => NextResponse.json({ success: true, data }),
    publicApiError: (requestId, status, code, message) =>
      NextResponse.json({ success: false, error: { code, message } }, { status }),
  });
  const catalogCalls = [];
  mocks.set('@/lib/server/course-import-catalog', {
    listBackendImportCourses: async (db, actor, input) => {
      catalogCalls.push({ actor, input });
      return actor.keyId === 'device-1' ? { courses: [], nextCursor: null } : null;
    },
    getBackendImportCourseContext: async (db, actor, courseId) => {
      catalogCalls.push({ actor, courseId });
      return actor.keyId === 'device-1' && courseId === 'course'
        ? { course: { id: 'course', hardRules: [] } }
        : null;
    },
  });
  const route = loadSource('app/api/native/v1/course-problem-imports/route.ts');
  const request = (extra = {}) =>
    new NextRequest('http://localhost/api/native/v1/course-problem-imports', {
      method: 'POST',
      body: JSON.stringify({ mode: 'preview', data: manifest(), ...extra }),
    });
  assert.equal((await route.POST(request())).status, 403);
  principal = NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  assert.equal((await route.POST(request())).status, 401);
  principal = { userId: 'owner' };
  authMode = 'shared-test';
  assert.equal((await route.POST(request())).status, 403);
  authMode = 'device';
  assert.equal((await route.POST(request({ userId: 'owner', admin: true }))).status, 400);
  assert.equal((await route.POST(request({ preservePreparedContent: true }))).status, 400);
  assert.equal((await route.POST(request())).status, 200);
  assert.equal(h.writes, 0);
  principal = { userId: 'enrolled', keyId: 'browser-session' };
  assert.equal(
    (
      await route.GET(
        new NextRequest('http://localhost/api/native/v1/course-problem-imports?keyId=device-1'),
      )
    ).status,
    403,
  );
  principal = { userId: 'enrolled', keyId: 'device-1' };
  assert.equal(
    (
      await route.GET(
        new NextRequest('http://localhost/api/native/v1/course-problem-imports?courseId=course'),
      )
    ).status,
    200,
  );
  assert.equal(catalogCalls.at(-1).actor.keyId, 'device-1');
  assert.equal(catalogCalls.at(-1).courseId, 'course');
  assert.equal(
    (
      await route.GET(
        new NextRequest('http://localhost/api/native/v1/course-problem-imports?limit=101'),
      )
    ).status,
    400,
  );
  const previousGrants = process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS;
  process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS = JSON.stringify([
    {
      ...scopedGrant,
      courseId: '*',
      keyId: 'device-1',
      capability: 'append-reviewed-course-materials',
    },
  ]);
  try {
    const accepted = await route.POST(request());
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).data.actor.keyId, 'device-1');
    principal = { userId: 'enrolled', keyId: 'browser-session' };
    assert.equal((await route.POST(request())).status, 403);
    assert.equal((await route.POST(request({ keyId: 'device-1' }))).status, 400);
  } finally {
    if (previousGrants === undefined) delete process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS;
    else process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS = previousGrants;
  }
});

test('reviewed eight-file overlay loads from an independent temporary directory using workspace dependencies', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'syntara-import-overlay-test-'));
  try {
    for (const filename of [
      'lib/server/course-problem-import.ts',
      'lib/server/course-problem-import-operator.ts',
      'lib/server/course-problem-import-admin.ts',
      'lib/server/course-problem-import-grant.ts',
      'lib/server/admin-identity.ts',
      'lib/server/notebook-problems/service.ts',
      'lib/server/notebook-problems/import-batch-store.ts',
      'lib/server/course-code-preflight.ts',
    ]) {
      await mkdir(path.dirname(path.join(temp, filename)), { recursive: true });
      await copyFile(path.join(root, filename), path.join(temp, filename));
    }
    const libraries = await loadOperatorLibraries(root, temp);
    assert.equal(
      typeof libraries.loadService().createStructuredCourseProblemImportService,
      'function',
    );
    // Independent of an injected DB: service imports must remain lazy.
    assert.throws(() =>
      libraries.operator.createStagingProblemImportOperator({
        courseId: 'course',
        expectedDataOwnerId: 'owner',
        env: {},
      }),
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('code preflight authenticates and authorizes before executing any code; production stays disabled', async () => {
  const oldStage = process.env.SYNTARA_APP_ENV;
  process.env.SYNTARA_APP_ENV = 'staging';
  let principal = { userId: 'enrolled', keyId: 'device' };
  let executions = 0;
  let allowed = false;
  mocks.set('@/lib/server/prisma-safe', { getOptionalPrisma: () => ({}) });
  mocks.set('@/lib/server/native-platform-access', { nativePlatformApiAuthMode: () => 'device' });
  mocks.set('@/lib/server/public-api', {
    requireNativePlatformApi: async () => principal,
    publicApiRequestId: () => 'fixture',
    publicApiError: (id, status, code) => NextResponse.json({ code }, { status }),
    publicApiSuccess: (id, data) => NextResponse.json({ data }),
  });
  mocks.set('@/lib/server/course-import-catalog', {
    getBackendImportCourseContext: async () => (allowed ? { course: { id: 'course' } } : null),
  });
  mocks.set('@/lib/server/course-code-preflight', {
    codePreflightSchema: require('zod').z.object({ courseId: require('zod').z.string() }),
    validateCodeQuestion: async () => {
      executions++;
      return { valid: true };
    },
  });
  const route = loadSource('app/api/native/v1/course-code-preflight/route.ts');
  const request = () =>
    new NextRequest('http://localhost/api/native/v1/course-code-preflight', {
      method: 'POST',
      body: JSON.stringify({ courseId: 'course' }),
    });
  try {
    assert.equal((await route.POST(request())).status, 403);
    assert.equal(executions, 0);
    principal = NextResponse.json({}, { status: 401 });
    assert.equal((await route.POST(request())).status, 401);
    assert.equal(executions, 0);
    principal = { userId: 'owner', keyId: 'device' };
    allowed = true;
    assert.equal((await route.POST(request())).status, 200);
    assert.equal(executions, 1);
    process.env.SYNTARA_APP_ENV = 'production';
    assert.equal((await route.POST(request())).status, 404);
    assert.equal(executions, 1);
  } finally {
    if (oldStage === undefined) delete process.env.SYNTARA_APP_ENV;
    else process.env.SYNTARA_APP_ENV = oldStage;
  }
});
