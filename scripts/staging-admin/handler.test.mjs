import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { createHandler } from './handler.mjs';

const updatedAt = new Date('2026-01-01T00:00:00.000Z');
function fixture() {
  const calls = [];
  const row = { id: 'p1', courseId: 'c1', ownerId: null, updatedAt, _count: { attempts: 0 } };
  const notebook = {
    id: 'n1',
    courseId: 'c1',
    ownerId: 'owner',
    updatedAt,
    notebookKind: 'markdown',
    pages: [],
    scenes: [],
    markdownSections: [],
  };
  const db = {
    course: {
      findUnique: async () => ({ id: 'c1', name: 'Course', ownerId: 'owner' }),
      findMany: async () => [],
    },
    notebookProblem: {
      findMany: async (args) => {
        calls.push(['list', args]);
        return [row];
      },
      findFirst: async (args) => {
        calls.push(['findProblem', args]);
        return row;
      },
    },
    notebook: { findMany: async () => [notebook], findFirst: async () => notebook },
  };
  const problems = {
    createManualCourseProblem: async (args) => {
      calls.push(['createProblem', args]);
      return { id: 'new' };
    },
    updateCourseProblem: async (args) => {
      calls.push(['updateProblem', args]);
      return { id: 'p1' };
    },
    deleteCourseProblem: async (args) => {
      calls.push(['deleteProblem', args]);
    },
  };
  const notebooks = {
    createOwnedNotebook: async (...args) => {
      calls.push(['createNotebook', args]);
      return { id: 'new' };
    },
    updateOwnedNotebook: async (...args) => {
      calls.push(['updateNotebook', args]);
      return notebook;
    },
    deleteOwnedNotebook: async (...args) => {
      calls.push(['deleteNotebook', args]);
      return { id: 'n1' };
    },
    replaceOwnedMarkdownNotebookSections: async (...args) => {
      calls.push(['sections', args]);
      return [];
    },
    replaceOwnedNotebookScenes: async (...args) => {
      calls.push(['scenes', args]);
      return [];
    },
  };
  const handler = createHandler({
    db,
    Prisma: { DbNull: null },
    problems,
    notebooks,
    notebookProblemImportDraftSchema: z.object({ title: z.string() }),
    syncUnlinkedCourseKnowledgeProjection: async () => {},
    token: Buffer.from('secret'),
  });
  async function request(method, path, body, headers = {}) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.url = path;
    req.method = method;
    req.headers = { authorization: 'Bearer secret', host: '127.0.0.1:8766', ...headers };
    const res = {
      writeHead(status) {
        this.status = status;
      },
      end(data) {
        this.data = JSON.parse(data);
      },
    };
    await handler(req, res);
    return res;
  }
  return { calls, row, notebook, request };
}

test('rejects unauthenticated and browser-origin requests', async () => {
  const f = fixture();
  assert.equal(
    (await f.request('GET', '/v1/courses/c1', undefined, { authorization: 'Bearer bad' })).status,
    403,
  );
  assert.equal(
    (await f.request('GET', '/v1/courses/c1', undefined, { origin: 'https://attacker.example' }))
      .status,
    403,
  );
});
test('queries only public course questions and owner notebooks', async () => {
  const f = fixture();
  assert.equal((await f.request('GET', '/v1/courses/c1/problems')).status, 200);
  assert.equal(f.calls[0][1].where.ownerId, null);
  assert.equal(f.calls[0][1].where.OR[1].notebook.ownerId, 'owner');
});
test('problem writes use course owner and reject stale revisions or attempts', async () => {
  const f = fixture();
  await assert.rejects(
    f.request('PATCH', '/v1/courses/c1/problems/p1', {
      expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
      patch: { title: 'new' },
    }),
    /changed since/,
  );
  f.row._count.attempts = 1;
  await assert.rejects(
    f.request('DELETE', '/v1/courses/c1/problems/p1', {
      expectedUpdatedAt: updatedAt.toISOString(),
    }),
    /student attempts/,
  );
  assert(!f.calls.some(([name]) => name === 'deleteProblem'));
  f.row._count.attempts = 0;
  const r = await f.request('PATCH', '/v1/courses/c1/problems/p1', {
    expectedUpdatedAt: updatedAt.toISOString(),
    patch: { title: 'new' },
  });
  assert.equal(r.status, 200);
  assert.equal(f.calls.find(([name]) => name === 'updateProblem')[1].userId, 'owner');
  assert.equal(f.calls.find(([name]) => name === 'updateProblem')[1].preservePreparedContent, true);
});
test('notebook section replacement rejects existing pages', async () => {
  const f = fixture();
  f.notebook.pages = [{ id: 'page' }];
  await assert.rejects(
    f.request('PUT', '/v1/courses/c1/notebooks/n1/sections', {
      expectedUpdatedAt: updatedAt.toISOString(),
      sections: [],
    }),
    /page records/,
  );
  assert(!f.calls.some(([name]) => name === 'sections'));
  f.notebook.pages = [];
  assert.equal(
    (
      await f.request('PUT', '/v1/courses/c1/notebooks/n1/sections', {
        expectedUpdatedAt: updatedAt.toISOString(),
        sections: [{ title: 'Section', order: 0, markdown: 'Text' }],
      })
    ).status,
    200,
  );
  assert(f.calls.some(([name]) => name === 'sections'));
});

test('chapter edits are course scoped, version checked and touch native question deltas', async () => {
  const calls = [];
  const chapter = { id: 'ch', courseId: 'c1', name: 'Old', updatedAt };
  const db = {
    course: { findUnique: async () => ({ id: 'c1', ownerId: 'owner' }) },
    courseProblemChapter: {
      findMany: async () => [chapter],
      findFirst: async (args) =>
        args.where.id?.not
          ? null
          : args.where.courseId === 'c1' && args.where.id === 'ch'
            ? chapter
            : null,
      updateMany: async (args) => {
        calls.push(['chapter', args]);
        return { count: args.where.updatedAt.getTime() === updatedAt.getTime() ? 1 : 0 };
      },
    },
    notebookProblem: {
      updateMany: async (args) => {
        calls.push(['deltas', args]);
        return { count: 2 };
      },
    },
  };
  db.$transaction = async (fn) => fn(db);
  const run = createHandler({
    db,
    Prisma: {},
    problems: {},
    notebooks: {},
    notebookProblemImportDraftSchema: z.any(),
    syncUnlinkedCourseKnowledgeProjection: async () => {},
    token: Buffer.from('secret'),
  });
  async function request(id, expected) {
    const req = Readable.from([
      Buffer.from(JSON.stringify({ expectedUpdatedAt: expected, patch: { name: 'Loops' } })),
    ]);
    req.url = '/v1/courses/c1/chapters/' + id;
    req.method = 'PATCH';
    req.headers = { authorization: 'Bearer secret', host: '127.0.0.1:8766' };
    const res = {
      writeHead(s) {
        this.status = s;
      },
      end(s) {
        this.data = JSON.parse(s);
      },
    };
    await run(req, res);
    return res;
  }
  assert.equal((await request('ch', updatedAt.toISOString())).status, 200);
  assert.equal(calls[1][1].where.courseId, 'c1');
  assert.equal(calls[1][1].where.chapterId, 'ch');
  await assert.rejects(request('other', updatedAt.toISOString()), (e) => e.status === 404);
  const before = calls.filter((c) => c[0] === 'deltas').length;
  await assert.rejects(request('ch', '2020-01-01T00:00:00.000Z'), (e) => e.status === 409);
  assert.equal(calls.filter((c) => c[0] === 'deltas').length, before);
});
