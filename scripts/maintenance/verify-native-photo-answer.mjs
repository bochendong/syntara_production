import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { alias: { '@': resolve('.') } });
const responseParser = await jiti.import('../../features/practice/server/grading-response.ts');
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const code = ts.transpileModule(readFileSync(resolve(file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id) =>
      id in mocks
        ? mocks[id]
        : id.startsWith('@/')
          ? (() => {
              throw new Error(`Unmocked ${id}`);
            })()
          : require(id),
    mod,
    mod.exports,
  );
  return mod.exports;
}

const photo = load('lib/problem-bank/photo-answer.ts');
const image = {
  id: 'photo-test',
  name: 'answer.png',
  mimeType: 'image/png',
  size: 3,
  dataUrl: 'data:image/png;base64,YWJj',
};
const grading = load('apps/native/src/data/local-problem-grading.ts');
assert.equal(grading.answerHasContent({ kind: 'text', text: '', images: [image] }), true);
assert.equal(grading.answerHasContent({ kind: 'text', text: '', images: [] }), false);
assert.equal(
  grading.gradeLocalProblem(
    { type: 'calculation', grading: { referenceAnswer: '42' } },
    { kind: 'text', text: 'wrong', images: [image] },
  ).status,
  'pending',
);
let captured;
const service = load('features/practice/server/grade-answer.ts', {
  './grading-response': responseParser,
  '@/lib/problem-bank/photo-answer': photo,
  '@/lib/ai/llm': {
    callLLM: async (args) => {
      captured = args;
      return { text: '{"score":8,"comment":"图片过程正确"}' };
    },
  },
  '@/lib/server/resolve-model': {
    resolveModelFromHeaders: async () => ({ model: { modelId: 'test' } }),
  },
  '@/lib/server/request-context': { runWithRequestContext: (_request, _route, fn) => fn() },
});
await service.gradeQuizAnswer(
  { question: 'Q', userAnswer: '见附图', points: 10, images: [image] },
  {},
);
assert.equal(captured.messages[0].content[1].type, 'image');
assert.equal(captured.messages[0].content[1].mediaType, 'image/png');
assert.equal(captured.messages[0].content[1].image.toString(), 'abc');
await assert.rejects(
  () =>
    service.gradeQuizAnswer(
      { question: 'Q', userAnswer: '', points: 10, images: [{ ...image, size: 8 }] },
      {},
    ),
  /图片/,
);
await service.gradeQuizAnswer({ question: 'Q', userAnswer: '文字答案', points: 10 }, {});
assert.ok(captured.prompt.includes('文字答案'));
assert.equal(captured.messages, undefined);
const values = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  },
};
let uploaded;
let online = false;
const attempt = {
  id: 'attempt-123456',
  problemId: 'problem-1',
  status: 'pending',
  score: null,
  answer: { kind: 'text', text: '', images: [image] },
  createdAt: Date.now(),
};
const sync = load('apps/native/src/data/problem-sync.ts', {
  '../../../../lib/problem-bank/photo-answer': photo,
  './browser-runtime': { accountStorageKey: (key) => key },
  './archive': {},
  './chat-sync': { isPlatformCourse: async () => true },
  './platform-api-client': {
    getNativeProblems: async () => {
      throw new Error('offline');
    },
    uploadNativeProblemAttempts: async (payload) => {
      uploaded = payload;
      if (!online) throw new Error('offline');
      return { saved: payload.attempts.map((a) => a.id), skipped: [] };
    },
  },
  '../lib/course-layers': {},
});
const repository = {
  loadProblemDocument: async () => ({ attempts: [attempt] }),
  loadCourseWorkspace: async () => null,
};
const warn = console.warn;
console.warn = () => {};
await sync.queueProblemAttempt(repository, 'course', attempt);
const queued = JSON.parse(values.get('syntara.problem-attempt-outbox.v1')).course[0];
assert.equal(queued.answer.images, undefined);
assert.equal(queued.photoAttemptId, attempt.id);
assert.deepEqual(uploaded.attempts[0].answer.images, [image]);
online = true;
await sync.syncCourseProblems(repository, 'course');
assert.equal(JSON.parse(values.get('syntara.problem-attempt-outbox.v1')).course, undefined);
console.warn = warn;
console.log(
  'Native photo answers: image-only eligibility, grading payload, validation, text fallback, compact offline queue and image retry passed.',
);
