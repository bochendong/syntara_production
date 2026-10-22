/** Offline retirement checks. No server, environment, database or provider requests. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
for (const path of [
  'app/chat/page.tsx',
  'app/chat/private-memory/page.tsx',
  'components/chat/chat-page-client.tsx',
  'features/chat/components/index.ts',
  'app/api/native/v1/turn/route.ts',
  'app/api/native/v1/review-plans/route.ts',
  'features/native-api/server/teaching-turn.ts',
]) {
  assert.equal(existsSync(new URL(path, root)), false, `${path} remains retired`);
}
assert.doesNotMatch(
  read('apps/native/src/data/ai-client.ts'),
  /streamAssistantReply|runNativeTeachingTurn/,
);
assert.doesNotMatch(
  read('apps/native/src/data/platform-api-client.ts'),
  /native_teaching_turn|createNativeReviewPlan/,
);
assert.doesNotMatch(
  read('apps/native/src-tauri/src/lib.rs'),
  /native_teaching_turn|stream_ai_response|native_create_review_plan/,
);
assert.doesNotMatch(
  read('apps/native/src-tauri/src/platform_api.rs'),
  /\/api\/native\/v1\/(?:turn|review-plans)/,
);
assert.match(read('apps/native/src/ai/chat.ts'), /runNativeChatTurn\(/);
assert.match(read('apps/native/src/components/CourseWorkspace.tsx'), /capabilities\.chat === true/);

// Run the real capability handler against in-memory auth/config adapters.
const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const configUrl = moduleUrl(
  'let configured = true; export function setConfigured(value) { configured = value; } export async function getSystemLLMRuntimeConfig() { return { apiKey: configured ? "fixture-only" : "", modelId: "fixture-model" }; }',
);
const stubs = {
  'next/server': moduleUrl('export const NextResponse = Response;'),
  '@/lib/server/native-platform-access': moduleUrl(
    'export const nativePlatformApiAuthMode = () => "authenticated";',
  ),
  '@/lib/server/public-api': moduleUrl(
    'export const publicApiRequestId = () => "fixture-request"; export const publicApiSuccess = (_, data) => Response.json({ ok: true, data }); export const requireNativePlatformApi = async request => request.headers.has("reject") ? new Response(null, { status: 401 }) : { userId: "fixture-user" };',
  ),
  '@/lib/server/system-llm-config': configUrl,
  '@/lib/ai/system-model-policy': moduleUrl(
    'export const SYSTEM_OPENAI_IMAGE_MODEL = "fixture-image";',
  ),
};
let source = ts.transpileModule(read('app/api/native/v1/capabilities/route.ts'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: fileURLToPath(new URL('app/api/native/v1/capabilities/route.ts', root)),
}).outputText;
for (const [specifier, url] of Object.entries(stubs))
  source = source.replaceAll(`'${specifier}'`, `'${url}'`);
const { GET } = await import(moduleUrl(source));
const config = await import(configUrl);
for (const available of [true, false]) {
  config.setConfigured(available);
  const response = await GET(new Request('http://fixture.invalid/api/native/v1/capabilities'));
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.capabilities.chat, available);
  assert.equal('teachingTurn' in data.capabilities, false);
  assert.equal('reviewPlan' in data.capabilities, false);
  assert.deepEqual(data.details.chat, { path: '/api/native/v2/chat', transport: ['sse'] });
  assert.equal('teachingTurn' in data.details, false);
}
assert.equal(
  (
    await GET(
      new Request('http://fixture.invalid/api/native/v1/capabilities', {
        headers: { reject: '1' },
      }),
    )
  ).status,
  401,
);
console.log(
  'Retired chat: old routes/commands absent; native-v2 capability, disabled-provider and unauthorized requests passed offline.',
);
