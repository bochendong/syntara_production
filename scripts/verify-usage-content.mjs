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

const { serializeUsageContent: serialize } = load('lib/server/llm-usage-content.ts');
assert.equal(serialize(null), null);
assert.equal(serialize('line 1\n    indented'), 'line 1\n    indented');
const safe = serialize({
  apiKey: 'private',
  image: 'data:image/png;base64,PRIVATE',
  base64: 'PRIVATE',
  text: 'actual content',
  bytes: new Uint8Array([1, 2]),
});
assert(!safe.includes('PRIVATE'));
assert(!safe.includes('private'));
assert(safe.includes('actual content'));
assert(serialize('x'.repeat(200000)).includes('内容已截断'));
assert(serialize('x'.repeat(200000)).length < 101000);
const records = [];
const logger = { warn() {}, info() {} };
const { recordLLMUsage } = load('lib/server/llm-usage.ts', {
  '@/lib/logger': { createLogger: () => logger },
  '@/lib/server/prisma-safe': {
    getPrismaOrNull: () => ({ lLMUsageLog: { create: async ({ data }) => records.push(data) } }),
  },
  '@/lib/server/credits': { chargeCreditsForTokenUsage: async () => {} },
  '@/lib/server/llm-usage-content': { serializeUsageContent: serialize },
});
await Promise.all(
  ['first', 'second'].map((text) =>
    recordLLMUsage({
      route: '/test',
      source: 'test',
      providerId: 'openai',
      modelId: 'test',
      modelString: 'openai:test',
      inputTokens: 1,
      outputTokens: 2,
      requestContent: text,
      responseContent: text + ' output',
      skipCreditCharge: true,
    }),
  ),
);
assert.equal(records.length, 2);
for (const record of records)
  assert.equal(record.responseContent, record.requestContent + ' output');
let allowed = false;
let reads = 0;
const { GET } = load('app/api/admin/llm-usage/[id]/route.ts', {
  '@/lib/server/admin-auth': {
    requireAdmin: async () => (allowed ? {} : { response: new Response(null, { status: 401 }) }),
  },
  '@/lib/server/api-response': {
    apiSuccess: (data) => Response.json(data),
    apiError: (_code, status, error) => Response.json({ error }, { status }),
  },
  '@/lib/server/prisma-safe': {
    getOptionalPrisma: () => ({
      lLMUsageLog: {
        findUnique: async ({ where }) => {
          reads++;
          return where.id === 'old'
            ? { id: 'old', requestContent: null, responseContent: null }
            : where.id === 'new'
              ? { id: 'new', requestContent: 'input', responseContent: 'output' }
              : null;
        },
      },
    }),
  },
});
const get = (id) => GET(new Request('http://test'), { params: Promise.resolve({ id }) });
assert.equal((await get('new')).status, 401);
assert.equal(reads, 0);
allowed = true;
const response = await get('new');
assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
assert.deepEqual((await response.json()).row, {
  id: 'new',
  requestContent: 'input',
  responseContent: 'output',
});
assert.equal((await (await get('old')).json()).row.requestContent, null);
assert.equal((await get('missing')).status, 404);
console.log(
  'PASS usage content: exact correlation, redaction, bounds, admin authorization, old rows, missing records',
);
