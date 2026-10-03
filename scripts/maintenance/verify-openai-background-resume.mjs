import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ai = require('ai');
let transport;
const source = fs.readFileSync('lib/ai/server-model.ts', 'utf8');
const code = ts.transpileModule(source + '\nexport { createBackgroundResponsesFetch };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiled = { exports: {} };
vm.runInNewContext(code, {
  module: compiled,
  exports: compiled.exports,
  require: (id) => {
    if (id === '@/lib/server/proxy-fetch') return { proxyFetch: (...args) => transport(...args) };
    if (id === '@/lib/logger') return { createLogger: () => ({ info() {}, warn() {} }) };
    if (id === '@/lib/ai/providers') return { getProvider: () => ({ models: [] }) };
    return require(id);
  },
  AbortSignal,
  URL,
  Request,
  Response,
  Headers,
  Date,
  process,
});
const { createBackgroundResponsesFetch, getServerOpenAIResponsesModel } = compiled.exports;
const durable = {};
const hooks = {
  loadResponseId: (key) => durable[key],
  saveResponseId: async (key, id) => {
    durable[key] = id;
  },
};
const calls = [];
const json = (payload) => new Response(JSON.stringify(payload));
const pending = { id: 'resp_saved', status: 'in_progress', created_at: Date.now() / 1000 };
const complete = { ...pending, status: 'completed', output: [] };
transport = async (url, init) => {
  calls.push({ url, init });
  return json(pending);
};
const body = JSON.stringify({ model: 'test', input: 'questions' });
const url = 'https://api.openai.com/v1/responses';
const abort = new AbortController();
const first = createBackgroundResponsesFetch(hooks)(url, {
  method: 'POST',
  body,
  signal: abort.signal,
});
// Attach the rejection handler before aborting to avoid an unhandled rejection.
const stopped = assert.rejects(first, (error) => error.name === 'AbortError');
await delay(20);
abort.abort();
await stopped;
assert.equal(Object.values(durable)[0], 'resp_saved', 'Save the ID before waiting for completion');
assert.equal(calls.length, 1, 'Abort interrupts the polling delay, not just the HTTP request');
transport = async (url, init) => {
  calls.push({ url, init });
  return json(complete);
};
const resumed = await createBackgroundResponsesFetch(hooks)(url, { method: 'POST', body });
assert.equal((await resumed.json()).status, 'completed');
assert.equal(calls.at(-1).init.method, 'GET');
assert.match(calls.at(-1).url, /responses\/resp_saved$/);
assert.equal(
  calls.filter((call) => call.init.method === 'POST').length,
  1,
  'Resume never resubmits',
);
await createBackgroundResponsesFetch(hooks)(url, {
  method: 'POST',
  body: JSON.stringify({ model: 'test', input: 'different questions' }),
});
assert.equal(calls.at(-1).init.method, 'POST', 'Changed input must not reuse another response');

// A worker deadline must apply even when an individual SDK caller omits abortSignal.
const worker = new AbortController();
transport = async (url, init) => {
  if (init.method === 'GET') {
    assert.ok(init.signal, 'Every retrieval receives the combined cancellation signal');
    worker.abort();
    throw worker.signal.reason;
  }
  return json(pending);
};
const { model } = getServerOpenAIResponsesModel(
  { providerId: 'openai', modelId: 'gpt-4o-mini', apiKey: 'test-only' },
  { ...hooks, signal: worker.signal },
);
await assert.rejects(
  ai.generateText({ model, prompt: 'A fresh request', maxRetries: 0 }),
  (error) => error.name === 'AbortError',
  'Polling cancellation propagates through the SDK rather than being retried forever',
);
console.log(
  'PASS: abortable polling, durable response IDs, GET-only resume, input isolation and worker deadline through the AI SDK',
);
