import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadRoute(mocks) {
  const path = 'app/api/admin/courses/[id]/sources/[sourceId]/file/route.ts';
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (name) => {
      assert.ok(name in mocks, `Unexpected import: ${name}`);
      return mocks[name];
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

class FakeResponse {
  constructor(body, options = {}) {
    this.body = body;
    this.status = options.status || 200;
    this.headers = new Headers(options.headers);
  }
  static json(body, options) {
    return new FakeResponse(body, options);
  }
}

let authorized = false;
let queried = false;
const route = loadRoute({
  'next/server': { NextResponse: FakeResponse },
  '@/lib/server/admin-auth': {
    requireAdmin: async () =>
      authorized
        ? { identity: { userId: 'admin' } }
        : { response: new FakeResponse({}, { status: 401 }) },
  },
  '@/lib/server/prisma-safe': {
    getOptionalPrisma: () => ({
      courseSource: {
        findFirst: async ({ where }) => {
          queried = true;
          assert.deepEqual(where, { id: 'source-a', courseId: 'course-a' });
          return null;
        },
      },
    }),
  },
});

const request = new Request('http://localhost/test');
const context = { params: Promise.resolve({ id: 'course-a', sourceId: 'source-a' }) };
assert.equal((await route.GET(request, context)).status, 401);
assert.equal(queried, false, 'unauthorized request must not query course files');
authorized = true;
assert.equal((await route.GET(request, context)).status, 404);
assert.equal(queried, true, 'authorized lookup must require both source and course IDs');
console.log('PASS admin course read-only file access: authentication and course scoping');
