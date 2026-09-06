import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
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
  id: 'photo-1',
  name: 'answer.png',
  mimeType: 'image/png',
  size: 3,
  dataUrl: 'data:image/png;base64,YWJj',
};
assert.ok(photo.isValidPhotoAnswerUpload(image));
for (const patch of [
  { mimeType: 'image/svg+xml' },
  { size: 4 },
  { dataUrl: 'https://example.com/private' },
  { dataUrl: 'data:image/png;base64,!!!!' },
  { dataUrl: `data:image/png;base64,${'A'.repeat(900000)}`, size: 675000 },
])
  assert.equal(photo.isValidPhotoAnswerUpload({ ...image, ...patch }), false);
const maxImage = {
  ...image,
  mimeType: 'image/jpeg',
  size: photo.MAX_PHOTO_UPLOAD_BYTES,
  dataUrl: `data:image/jpeg;base64,${Buffer.alloc(photo.MAX_PHOTO_UPLOAD_BYTES).toString('base64')}`,
};
assert.ok(photo.isValidPhotoAnswerUpload(maxImage));
assert.ok(
  Buffer.byteLength(JSON.stringify({ images: Array(4).fill(maxImage), text: '答'.repeat(40000) })) <
    4_000_000,
);
const guards = Object.fromEntries(
  ['Calculation', 'Choice', 'FillBlank', 'Proof', 'ShortAnswer'].map((key) => [
    `isNotebook${key}ProblemRecord`,
    (p) =>
      p.type ===
      {
        Calculation: 'calculation',
        Choice: 'choice',
        FillBlank: 'fill_blank',
        Proof: 'proof',
        ShortAnswer: 'short_answer',
      }[key],
  ]),
);
let llmResponse = { score: 80, comment: '计算过程正确，单位遗漏。', readable: true };
let captured;
let modelCalls = 0;
const evaluator = load('lib/server/notebook-problems/evaluate.ts', {
  '@/lib/problem-bank': guards,
  '@/lib/ai/llm': {
    callLLM: async (args) => {
      modelCalls++;
      captured = args;
      if (llmResponse instanceof Error) throw llmResponse;
      return { text: JSON.stringify(llmResponse) };
    },
  },
});
const model = { modelId: 'test-vision' };
const makeProblem = (type) => ({
  id: 'problem-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  type,
  points: 100,
  publicContent: { type, stem: 'Calculate 6 times 7 and explain.' },
  grading: {
    type,
    referenceAnswer: '42',
    referenceProof: '42',
    acceptedForms: ['42'],
    analysis: 'Six groups of seven.',
  },
});
for (const type of ['calculation', 'short_answer', 'proof']) {
  for (const text of [undefined, '补充说明']) {
    const result = await evaluator.evaluateNotebookNonCodeProblem({
      problem: makeProblem(type),
      answer: { images: [image, image], text },
      model,
      language: 'zh-CN',
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.score, 80);
    assert.equal(captured.messages[0].content.filter((p) => p.type === 'image').length, 2);
    assert.match(captured.messages[0].content[0].text, /Calculate 6 times 7/);
    assert.match(captured.messages[0].content[0].text, /42/);
    assert.ok(Buffer.isBuffer(captured.messages[0].content[1].image));
    assert.equal(captured.messages[0].content[1].image.toString(), 'abc');
  }
}
for (const response of [
  { readable: false, score: 0, comment: '模糊' },
  { score: '80', comment: 'invalid' },
  { score: 150, comment: 'invalid' },
  {},
  new Error('private provider URL'),
]) {
  llmResponse = response;
  const result = await evaluator.evaluateNotebookNonCodeProblem({
    problem: makeProblem('proof'),
    answer: { images: [image] },
    model,
    language: 'zh-CN',
  });
  assert.equal(result.status, 'error');
  assert.ok(!result.result.feedback.includes('private provider URL'));
}
llmResponse = { score: 80, comment: '步骤正确。', readable: true };
const schema = load('lib/problem-bank/schema.ts');
const scoring = load('lib/problem-bank/scoring-policy.ts');
for (const scope of ['courses', 'notebooks']) {
  let saved = [];
  let previous = 0;
  const service = {
    countNotebookProblemSubmissions: async () => previous,
    createNotebookProblemAttempt: async (args) => {
      saved.push(args);
      return { id: 'attempt-1', ...args };
    },
    getCourseProblemForUser: async () => ({ problem: makeProblem('calculation') }),
    getNotebookProblemForUser: async () => ({ problem: makeProblem('calculation') }),
  };
  const route = load(`app/api/${scope}/[id]/problems/[problemId]/attempts/submit/route.ts`, {
    '@/lib/problem-bank/photo-answer': photo,
    '@/lib/server/api-auth': { requireUserId: async () => ({ userId: 'student-1' }) },
    '@/lib/server/json-error-response': { safeRoute: async (fn) => fn() },
    '@/lib/server/resolve-model': { resolveModelFromHeaders: async () => ({ model }) },
    '@/lib/server/request-context': { runWithRequestContext: async (_req, _route, fn) => fn() },
    '@/features/problems/server/evaluate': evaluator,
    '@/features/problems/server/judge': {},
    '@/features/problems': schema,
    '@/features/problems/server/service': service,
    '@/lib/server/notebook-problems/course-identity': {
      resolveNotebookProblemCourseIdentity: async () => ({}),
    },
    '@/lib/problem-bank/scoring-policy': scoring,
  });
  const submit = (images = [image]) =>
    route.POST(
      new (require('next/server').NextRequest)('http://localhost/submit', {
        method: 'POST',
        body: JSON.stringify({ images }),
      }),
      { params: Promise.resolve({ id: 'course-1', problemId: 'problem-1' }) },
    );
  const ok = await submit();
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.attempt.score, 80);
  assert.deepEqual(saved[0].answer.images, [image]);
  assert.equal(saved[0].result.feedback.includes('步骤正确'), true);
  previous = 2;
  const penalized = await (await submit()).json();
  assert.equal(penalized.attempt.score, 24);
  const savedCount = saved.length;
  llmResponse = { readable: false, score: 0, comment: '模糊' };
  assert.equal((await submit()).status, 422);
  assert.equal(saved.length, savedCount);
  llmResponse = new Error('network');
  assert.equal((await submit()).status, 422);
  assert.equal(saved.length, savedCount);
  assert.equal((await submit([{ ...image, size: 500 }])).status, 400);
  assert.equal(saved.length, savedCount);
  previous = 3;
  const calls = modelCalls;
  assert.equal((await submit()).status, 409);
  assert.equal(modelCalls, calls);
  llmResponse = { score: 80, comment: '步骤正确。', readable: true };
}
console.log(
  'PASS photo-only and mixed answers: multimodal grading, references, safe errors, both submit routes, saved images/score/feedback, attempt policy, request budget',
);
