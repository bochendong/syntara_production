import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (id in mocks) return mocks[id];
      if (id.startsWith('@/')) throw new Error(`Missing mock: ${id}`);
      return require(id);
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

let authorized = false;
let reads = 0;
const queries = [];
const db = {
  user: {
    findFirst: async ({ where }) => {
      reads++;
      assert.equal(where.role, 'TEACHER');
      return where.id === 'teacher-a' ? { id: 'teacher-a', name: 'A' } : null;
    },
  },
  course: {
    findMany: async ({ where }) => {
      assert.equal(where.ownerId, 'teacher-a');
      return [{ id: 'course-a', name: 'Course A' }];
    },
  },
  notebook: {
    count: async ({ where }) => {
      queries.push(where);
      return 23;
    },
    findMany: async (args) => {
      queries.push(args);
      return [{ id: 'notebook-a', name: 'Notebook A' }];
    },
  },
  notebookProblem: {
    count: async ({ where }) => {
      queries.push(where);
      return 0;
    },
    findMany: async (args) => {
      queries.push(args);
      return [];
    },
  },
};
const { GET } = load('app/api/admin/teachers/[teacherId]/resources/route.ts', {
  '@/lib/server/prisma': { prisma: db },
  '@/lib/server/admin-auth': {
    requireAdmin: async () => (authorized ? {} : { response: new Response(null, { status: 401 }) }),
  },
  '@/lib/server/api-response': {
    apiSuccess: (data) => Response.json(data),
    apiError: (_code, status, error) => Response.json({ error }, { status }),
  },
  '@/lib/server/json-error-response': { safeRoute: (fn) => fn() },
});
const get = (query = '', teacherId = 'teacher-a') =>
  GET(new Request('http://test/api?' + query), { params: Promise.resolve({ teacherId }) });
assert.equal((await get()).status, 401);
assert.equal(reads, 0);
authorized = true;
assert.equal((await get('', 'student-id')).status, 404);
assert.equal((await get('courseId=course-b')).status, 404);
for (const query of ['page=-1', 'page=1.5', 'page=NaN', 'kind=private'])
  assert.equal((await get(query)).status, 400);
const response = await get('page=99');
assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
const data = await response.json();
assert.equal(data.page, 2);
assert.equal(data.total, 23);
assert.equal(data.rows[0].id, 'notebook-a');
assert(queries.some((q) => q.take === 20 && q.skip === 20 && q.where.ownerId === 'teacher-a'));
queries.length = 0;
await get('kind=problems&courseId=unassigned');
const scoped = queries.find((q) => q.OR);
assert.equal(scoped.courseId, null);
assert.deepEqual(scoped.OR, [
  { course: { ownerId: 'teacher-a' } },
  { notebook: { ownerId: 'teacher-a' } },
]);
const empty = await (await get('kind=problems')).json();
assert.equal(empty.pages, 1);
assert.equal(empty.rows.length, 0);
console.log(
  'PASS teacher resources: admin authorization, teacher scope, foreign course rejection, pagination, unassigned resources and empty results',
);
