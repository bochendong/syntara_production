import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { importSharedLectures, main as lectureCliMain } from './import-course-shared-lectures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const jiti = createJiti(import.meta.url, { alias: { '@': root }, interopDefault: true });
const { uploadNativeMaterial } = jiti(path.join(root, 'lib/server/native-materials.ts'));
const { listBackendImportCourses, getBackendImportCourseContext } = jiti(
  path.join(root, 'lib/server/course-import-catalog.ts'),
);
const {
  resolveCourseProblemImportGrant,
  courseProblemImportGrantAudit,
  assertCourseProblemImportGrant,
} = jiti(path.join(root, 'lib/server/course-problem-import-grant.ts'));
const grant = {
  grantId: 'backend-device',
  userId: 'uploader',
  keyId: 'device-1',
  courseId: '*',
  capability: 'append-reviewed-course-materials',
  expiresAt: '2099-01-01T00:00:00Z',
};
const note = {
  courseId: 'course-a',
  kind: 'notes',
  scope: 'shared',
  mode: 'preview',
  clientId: '34aa1e79-82c5-54b3-8e34-88dbe49ca54d',
  name: '[EN] Sets',
  text: '# Sets\n\n$A \\subseteq B$.\n',
};

function fakeDb() {
  const rows = new Map();
  let versions = 0;
  const catalogQueries = [];
  const ruleQueries = [];
  let role = 'USER';
  let tamper = false;
  const db = {
    user: { findUnique: async () => ({ email: 'uploader@example.test' }) },
    $queryRaw: async () => [{ id: 'enrollment', role }],
    course: {
      findUnique: async ({ where }) => ({
        id: where.id,
        name: 'MAT102',
        language: 'zh-CN',
        description: 'Course formatting requirements',
        tags: [],
        ownerId: 'real-course-owner',
        externalBinding: null,
        problemChapters: [{ id: 'chapter', name: 'Sets', position: 0 }],
      }),
      updateMany: async () => ({ count: 1 }),
      update: async () => {
        versions++;
        return {};
      },
      findMany: async (query) => {
        catalogQueries.push(query);
        return [
          {
            id: 'course-a',
            name: 'MAT102',
            organization: { id: 'org', name: 'Example university' },
            notebookCount: 24,
            problemCount: 112,
            publishedProblemCount: 112,
            updatedAt: new Date(0),
          },
          {
            id: 'course-b',
            name: 'Other course',
            organization: null,
            notebookCount: 0,
            problemCount: 0,
            publishedProblemCount: 0,
            updatedAt: new Date(0),
          },
        ];
      },
    },
    notebook: {
      findUnique: async ({ where }) => {
        const row = rows.get(where.id);
        return row && tamper
          ? {
              ...row,
              markdownSections: row.markdownSections.map((section) => ({
                ...section,
                markdown: 'tampered',
              })),
            }
          : row || null;
      },
      create: async ({ data }) => {
        if (rows.has(data.id)) throw new Error('Unique ID conflict');
        const row = { ...data, removedAt: null, markdownSections: [] };
        rows.set(data.id, row);
        return row;
      },
      aggregate: async () => ({ _sum: {} }),
    },
    markdownNotebookSection: {
      create: async ({ data }) => {
        rows.get(data.notebookId).markdownSections.push(data);
        return data;
      },
    },
    notebookProblem: { count: async () => 0 },
    courseHardRule: {
      findMany: async (query) => {
        ruleQueries.push(query);
        return [{ id: 'hard-rule', content: 'Preserve complete proofs.', position: 0 }];
      },
    },
    courseRulePack: {
      findMany: async (query) => {
        ruleQueries.push(query);
        return [{ id: 'pack', status: 'active', contractJson: { requireProof: true } }];
      },
    },
    $transaction: async (run) => run(db),
  };
  return {
    db,
    rows,
    catalogQueries,
    ruleQueries,
    get versions() {
      return versions;
    },
    setRole(value) {
      role = value;
    },
    tamper() {
      tamper = true;
    },
  };
}
async function configured(run, entries = [grant]) {
  const before = process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS;
  process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS = JSON.stringify(entries);
  try {
    await run();
  } finally {
    if (before === undefined) delete process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS;
    else process.env.SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS = before;
  }
}

test('wildcard grants bind exact device session, resolve actual course in audit and cannot be forged', () => {
  const env = { SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS: JSON.stringify([grant]) };
  for (const keyId of [undefined, 'browser-session', 'device-other'])
    assert.equal(
      resolveCourseProblemImportGrant({
        userId: 'uploader',
        keyId,
        courseId: 'course-a',
        dataOwnerId: 'owner',
        env,
      }),
      null,
    );
  const authority = resolveCourseProblemImportGrant({
    userId: 'uploader',
    keyId: 'device-1',
    courseId: 'course-b',
    dataOwnerId: 'owner',
    purpose: 'notes',
    env,
  });
  const audit = courseProblemImportGrantAudit(authority);
  assert.equal(audit.courseId, 'course-b');
  assert.equal(audit.scopeCourseId, '*');
  assert.equal(audit.keyId, 'device-1');
  assert.throws(() =>
    assertCourseProblemImportGrant(
      { ...JSON.parse(JSON.stringify(authority)) },
      'course-b',
      'owner',
    ),
  );
  const questionOnly = {
    SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS: JSON.stringify([
      { ...grant, capability: 'append-reviewed-problems' },
    ]),
  };
  assert.equal(
    resolveCourseProblemImportGrant({
      userId: 'uploader',
      keyId: 'device-1',
      courseId: 'course-a',
      dataOwnerId: 'owner',
      purpose: 'notes',
      env: questionOnly,
    }),
    null,
  );
});
test('separate device wildcard and browser one-course grants do not broaden browser scope', async () =>
  configured(async () => {
    const a = resolveCourseProblemImportGrant({
      userId: 'uploader',
      keyId: 'browser-session',
      courseId: 'course-a',
      dataOwnerId: 'owner',
    });
    assert.equal(a.scopeCourseId, 'course-a');
    assert.equal(
      resolveCourseProblemImportGrant({
        userId: 'uploader',
        keyId: 'browser-session',
        courseId: 'course-b',
        dataOwnerId: 'owner',
      }),
      null,
    );
  }, [
    grant,
    {
      ...grant,
      grantId: 'browser-one-course',
      courseId: 'course-a',
      keyId: 'browser-session',
      capability: 'append-reviewed-problems',
    },
  ]));

test('shared lecture preview is read-only; fixed-ID commit stores real course owner and exact Markdown; replay does not increment version', async () =>
  configured(async () => {
    const h = fakeDb();
    const principal = { keyId: 'device-1' };
    const preview = await uploadNativeMaterial(h.db, 'uploader', note, principal);
    assert.equal(preview.status, 'preview');
    assert.equal(h.rows.size, 0);
    assert.equal(preview.language, 'zh-CN');
    const input = { ...note, mode: 'commit', expectedHash: preview.payloadHash };
    const saved = await uploadNativeMaterial(h.db, 'uploader', input, principal);
    assert.equal(saved.status, 'saved');
    assert.equal(saved.text, note.text);
    assert.equal(h.versions, 1);
    const row = h.rows.get(note.clientId);
    assert.equal(row.ownerId, 'real-course-owner');
    assert.equal(row.markdownSections[0].markdown, note.text);
    assert.equal(row.markdownSections[0].sourceMeta.actor.userId, 'uploader');
    assert.equal(row.markdownSections[0].sourceMeta.actor.dataOwnerId, 'real-course-owner');
    assert.equal(row.markdownSections[0].sourceMeta.actor.courseId, 'course-a');
    const replay = await uploadNativeMaterial(h.db, 'uploader', input, principal);
    assert.equal(replay.replayed, true);
    assert.equal(h.versions, 1);
    const different = await uploadNativeMaterial(
      h.db,
      'uploader',
      { ...note, text: '# Other' },
      principal,
    );
    assert.equal(different.status, 'conflict');
    assert.equal(row.markdownSections[0].markdown, note.text);
    h.tamper();
    assert.equal(
      (await uploadNativeMaterial(h.db, 'uploader', input, principal)).status,
      'conflict',
    );
  }));
test('shared lecture language is stored and hashed; changing language cannot overwrite a fixed ID', async () =>
  configured(async () => {
    const h = fakeDb();
    const input = { ...note, language: 'en-US' };
    const principal = { keyId: 'device-1' };
    const preview = await uploadNativeMaterial(h.db, 'uploader', input, principal);
    const saved = await uploadNativeMaterial(
      h.db,
      'uploader',
      { ...input, mode: 'commit', expectedHash: preview.payloadHash },
      principal,
    );
    assert.equal(saved.language, 'en-US');
    assert.equal(h.rows.get(note.clientId).language, 'en-US');
    const changed = await uploadNativeMaterial(
      h.db,
      'uploader',
      { ...input, language: 'zh-CN' },
      principal,
    );
    assert.equal(changed.status, 'conflict');
    assert.equal(h.versions, 1);
  }));
test('browser without matching grant cannot append shared notes; ordinary enrolled upload stays private', async () =>
  configured(async () => {
    const h = fakeDb();
    assert.equal(
      (await uploadNativeMaterial(h.db, 'uploader', note, { keyId: 'browser-session' })).status,
      'forbidden',
    );
    assert.equal(
      (
        await uploadNativeMaterial(
          h.db,
          'uploader',
          { ...note, keyId: 'device-1', ownerId: 'real-course-owner' },
          { keyId: 'browser-session' },
        )
      ).status,
      'forbidden',
    );
    const { scope: _scope, mode: _mode, ...privateInput } = note;
    assert.equal(
      (await uploadNativeMaterial(h.db, 'uploader', privateInput, { keyId: 'browser-session' }))
        .status,
      'saved',
    );
    assert.equal(h.rows.get(note.clientId).ownerId, 'uploader');
    assert.equal(h.versions, 0);
  }));
test('catalog requires wildcard device grant or existing admin, excludes students and owner identity fields, paginates', async () =>
  configured(async () => {
    const h = fakeDb();
    assert.equal(
      await listBackendImportCourses(
        h.db,
        { userId: 'uploader', keyId: 'browser-session' },
        { limit: 1 },
      ),
      null,
    );
    assert.equal(h.catalogQueries.length, 0);
    const catalog = await listBackendImportCourses(
      h.db,
      { userId: 'uploader', keyId: 'device-1' },
      { limit: 1 },
    );
    assert.equal(catalog.courses.length, 1);
    assert.equal(catalog.nextCursor, 'course-a');
    const select = h.catalogQueries[0].select;
    assert.equal(select.ownerId, undefined);
    assert.equal(select.enrollments, undefined);
    assert.equal(select.students, undefined);
    h.setRole('ADMIN');
    assert.ok(
      await listBackendImportCourses(
        h.db,
        { userId: 'admin', keyId: 'browser-session' },
        { limit: 1 },
      ),
    );
  }));
test('course context reads course-owned rules and active packs only after actual course authority is verified', async () =>
  configured(async () => {
    const h = fakeDb();
    assert.equal(
      await getBackendImportCourseContext(
        h.db,
        { userId: 'uploader', keyId: 'browser-session' },
        'course-b',
      ),
      null,
    );
    assert.equal(h.ruleQueries.length, 0);
    const context = await getBackendImportCourseContext(
      h.db,
      { userId: 'uploader', keyId: 'device-1' },
      'course-b',
    );
    assert.equal(context.course.id, 'course-b');
    assert.equal(context.actor.courseId, 'course-b');
    assert.equal(context.course.hardRules[0].content, 'Preserve complete proofs.');
    assert.equal(context.course.ownerId, undefined);
    assert.equal(context.course.chapters[0].name, 'Sets');
    assert.deepEqual(h.ruleQueries[0].where, {
      courseId: 'course-b',
      ownerId: 'real-course-owner',
    });
    assert.deepEqual(h.ruleQueries[1].where, { courseId: 'course-b', status: 'active' });
    assert.deepEqual(h.ruleQueries[0].orderBy, [{ position: 'asc' }, { createdAt: 'asc' }]);
  }));
test('lost shared-note commit response reconciles the identical fixed ID and increments version once', async () =>
  configured(async () => {
    const h = fakeDb();
    const material = {
      courseId: note.courseId,
      clientId: note.clientId,
      name: note.name,
      text: note.text,
      language: 'en-US',
    };
    let lost = false;
    const submitted = [];
    const receipt = await importSharedLectures({
      origin: 'https://example.test',
      getToken: async () => 'fixture',
      materials: [material],
      apply: true,
      fetchImpl: async (url, init) => {
        const input = JSON.parse(init.body);
        const data = await uploadNativeMaterial(h.db, 'uploader', input, { keyId: 'device-1' });
        if (input.mode === 'commit') {
          submitted.push(input);
          if (!lost) {
            lost = true;
            return Response.json({}, { status: 503 });
          }
        }
        return Response.json({ success: true, data });
      },
    });
    assert.deepEqual(submitted[0], submitted[1]);
    assert.equal(h.rows.size, 1);
    assert.equal(h.versions, 1);
    assert.equal(receipt.materials[0].result.replayed, true);
  }));
test('shared lecture CLI saves exact requested preparation context using ordinary backend auth helpers', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'shared-lecture-context-'));
  const receipt = path.join(temp, 'context.json');
  const previous = process.env.SYNTARA_TEST_SHARED_TOKEN;
  process.env.SYNTARA_TEST_SHARED_TOKEN = 'fixture-not-a-secret';
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer fixture-not-a-secret');
    assert.equal(new URL(request.url, 'http://localhost').searchParams.get('courseId'), 'course-a');
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        success: true,
        data: {
          course: { id: 'course-a', hardRules: [{ content: 'Use full proofs.' }], rulePacks: [] },
          actor: { userId: 'uploader' },
        },
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await lectureCliMain([
      '--origin',
      `http://127.0.0.1:${server.address().port}`,
      '--token-env',
      'SYNTARA_TEST_SHARED_TOKEN',
      '--course-context',
      'course-a',
      '--receipt',
      receipt,
    ]);
    const saved = JSON.parse(await readFile(receipt, 'utf8'));
    assert.equal(saved.course.id, 'course-a');
    assert.equal(saved.course.hardRules[0].content, 'Use full proofs.');
    assert.equal((await stat(receipt)).mode & 0o777, 0o600);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.SYNTARA_TEST_SHARED_TOKEN;
    else process.env.SYNTARA_TEST_SHARED_TOKEN = previous;
    await rm(temp, { recursive: true, force: true });
  }
});
test('shared lecture client checks complete preview/readback and preserves retry ID without credential leaks', async () => {
  const material = {
    courseId: note.courseId,
    clientId: note.clientId,
    name: note.name,
    text: note.text,
  };
  const h = fakeDb();
  const calls = [];
  let tokens = 0;
  await configured(async () => {
    const receipt = await importSharedLectures({
      origin: 'https://example.test',
      getToken: async () => {
        tokens++;
        return 'private-fixture-token';
      },
      materials: [material],
      apply: true,
      fetchImpl: async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push(body.mode);
        const data = await uploadNativeMaterial(h.db, 'uploader', body, { keyId: 'device-1' });
        return Response.json({ success: true, data });
      },
    });
    assert.deepEqual(calls, ['preview', 'commit']);
    assert.equal(tokens, 2);
    assert.ok(!JSON.stringify(receipt).includes('private-fixture-token'));
    await assert.rejects(
      importSharedLectures({
        origin: 'https://example.test',
        getToken: async () => 'fixture',
        materials: [material],
        fetchImpl: async () =>
          Response.json({ success: true, data: { status: 'preview', text: 'wrong' } }),
      }),
      /differs/,
    );
  });
});
