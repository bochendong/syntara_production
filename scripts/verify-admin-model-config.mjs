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

const policy = load('lib/ai/system-model-policy.ts');
const options = load('lib/ai/admin-model-options.ts');
let row = {
  id: 'default',
  modelId: 'gpt-5.6-sol',
  apiKey: 'encrypted-existing',
  baseUrl: 'https://api.openai.com/v1',
  updatedAt: new Date(),
  lowModelId: 'gpt-5.6-luna',
  mediumModelId: 'gpt-5.6-sol',
  highModelId: 'gpt-6-astra',
};
const config = load('lib/server/system-llm-config.ts', {
  '@/lib/logger': { createLogger: () => ({ warn() {}, error() {} }) },
  '@/lib/ai/system-model-policy': policy,
  '@/lib/server/prisma-safe': {
    getPrismaOrNull: () => ({
      systemLLMConfig: {
        findUnique: async () => row,
        upsert: async ({ update }) => {
          row = { ...row, ...update };
        },
      },
    }),
  },
  '@/lib/server/system-secret-crypto': {
    encryptSystemSecret: (s) => 'encrypted-' + s,
    decryptSystemSecret: () => 'test-server-key',
  },
});
const strengths = load('lib/ai/chat-response-strength.ts', {
  '@/lib/ai/system-model-policy': policy,
});
const factory = (args) => ({ model: { modelId: args.modelId }, modelInfo: null });
const resolver = load('lib/server/resolve-model.ts', {
  '@/lib/ai/providers': {
    parseModelString: (s) => ({ providerId: s.split(':')[0], modelId: s.split(':')[1] }),
  },
  '@/lib/ai/chat-response-strength': strengths,
  '@/lib/ai/server-model': { getServerModel: factory, getServerOpenAIResponsesModel: factory },
  '@/lib/constants/notebook-generation-model-stages': {
    NOTEBOOK_GENERATION_MODEL_STAGE_HEADER_KEYS: {},
  },
  '@/lib/server/system-llm-config': config,
});
const tierModels = { low: 'gpt-6-luna', medium: 'gpt-6-sol', high: 'gpt-6-astra' };
await config.updateSystemLLMConfig({ modelId: 'gpt-5.6-terra', tierModels });
assert.equal(row.apiKey, 'encrypted-existing');
assert.deepEqual((await config.getSystemLLMConfigView()).tierModels, tierModels);
for (const strength of ['low', 'medium', 'high']) {
  const selected = await resolver.resolveModel({
    responseStrength: strength,
    modelString: 'openai:rogue',
    apiKey: 'rogue',
  });
  assert.equal(selected.modelString, 'openai:' + tierModels[strength]);
  assert.equal(selected.apiKey, 'test-server-key');
}
assert.equal(
  (await resolver.resolveModel({ modelString: 'openai:rogue' })).modelString,
  'openai:gpt-5.6-terra',
);
await config.updateSystemLLMConfig({ modelId: 'gpt-6-sol' });
assert.equal(row.lowModelId, tierModels.low);
let authorized = false;
const api = load('app/api/admin/llm-config/route.ts', {
  '@/lib/ai/admin-model-options': options,
  '@/lib/server/admin-auth': {
    requireAdmin: async () => (authorized ? {} : { response: new Response(null, { status: 401 }) }),
  },
  '@/lib/server/api-response': {
    apiSuccess: (d) => Response.json(d),
    apiError: (_c, status, error) => Response.json({ error }, { status }),
  },
  '@/lib/server/system-llm-config': config,
});
const post = (body) =>
  api.POST(new Request('http://test', { method: 'POST', body: JSON.stringify(body) }));
assert.equal((await post({ modelId: 'gpt-6-sol' })).status, 401);
authorized = true;
for (const body of [
  { modelId: 'gpt-image-2.5-flare' },
  { modelId: 'gpt-6-sol', tierModels: { low: 'bad', medium: 'gpt-6-sol', high: 'gpt-6-astra' } },
  { modelId: 1 },
])
  assert.equal((await post(body)).status, 400);
assert.equal((await post({ modelId: 'gpt-6-sol', tierModels, apiKey: '' })).status, 200);
const view = await (await api.GET()).json();
assert.equal(view.config.maskedApiKey.includes('test-server-key'), false);
assert.deepEqual(view.config.tierModels, tierModels);
console.log(
  'PASS model configuration: tier persistence, runtime routing, key preservation, admin authorization and invalid-model rejection',
);
const pricing = load('lib/utils/openai-pricing.ts', {
  '@/lib/utils/credits': { creditsFromUsd: (value) => value },
});
for (const model of options.ADMIN_TEXT_MODEL_OPTIONS) {
  assert(pricing.getOpenAITextPricing(model.id), `${model.id} must have usage pricing`);
}
assert.equal(policy.lowestOpenAIReasoningEffort('gpt-6-sol'), 'none');
assert.equal(policy.lowestOpenAIReasoningEffort('gpt-6-luna'), 'none');
assert.equal(policy.lowestOpenAIReasoningEffort('gpt-6-astra'), 'low');
console.log('PASS model catalog pricing coverage and GPT-6 reasoning compatibility');
