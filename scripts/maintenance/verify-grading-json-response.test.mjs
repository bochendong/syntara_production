import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';
import ts from 'typescript';
const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('.') } });
const parser = await jiti.import('../../features/practice/server/grading-response.ts');
const photo = await jiti.import('../../lib/problem-bank/photo-answer.ts');
const code = ts.transpileModule(readFileSync('features/practice/server/grade-answer.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function setup(replies, context) {
  const calls = [];
  const contexts = [];
  const mocks = {
    './grading-response': parser,
    '@/lib/problem-bank/photo-answer': photo,
    '@/lib/ai/llm': {
      callLLM: async (args) => {
        calls.push(args);
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        if (!reply) throw new Error('Unexpected extra LLM request');
        return typeof reply === 'string' ? { text: reply } : reply;
      },
    },
    '@/lib/server/resolve-model': {
      resolveModelFromHeaders: async () => ({ model: { modelId: 'fixture' } }),
    },
    '@/lib/server/request-context': {
      getRequestContext: () => context,
      runWithRequestContext: (_request, route, fn) => {
        contexts.push(route);
        return fn();
      },
    },
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (!(id in mocks)) throw new Error(`Unexpected import: ${id}`);
      return mocks[id];
    },
    mod,
    mod.exports,
  );
  return {
    grade: (input = {}) =>
      mod.exports.gradeQuizAnswer(
        {
          question: 'Prove the claim.',
          userAnswer: 'My proof.',
          points: 100,
          language: 'zh-CN',
          ...input,
        },
        {},
      ),
    calls,
    contexts,
  };
}

test('valid JSON and properly escaped math keep their feedback unchanged', () => {
  const value = {
    score: 85,
    comment: String.raw`Use \frac{a}{b}, \forall x, and \Rightarrow. "quoted"`,
  };
  assert.deepEqual(parser.parseGradingJsonObject(JSON.stringify(value)), value);
});
test('raw LaTeX commands and raw newlines are repaired without corrupting valid escapes', () => {
  const value =
    parser.parseGradingJsonObject(String.raw`{"score":80,"comment":"Use \forall x and \Rightarrow, then \\frac{a}{b}.
Next line."}`);
  assert.equal(value.comment, 'Use \\forall x and \\Rightarrow, then \\frac{a}{b}.\nNext line.');
});
test('Markdown, braces in feedback and trailing commas do not break extraction', () => {
  assert.deepEqual(
    parser.parseGradingJsonObject(
      '```json\n{"score":75,"comment":"Correct for {x}, with a } in text.",}\n```\nextra {explanation}',
    ),
    { score: 75, comment: 'Correct for {x}, with a } in text.' },
  );
});
test('truncated assessments are rejected, never filled in with guessed data', () => {
  for (const text of [
    '{"score":80,"comment":"unfinished',
    '{"score":80,"comment":"unfinished"',
    'not a judgement',
  ])
    assert.throws(() => parser.parseGradingJsonObject(text), parser.GradingResponseError);
});
test('well-formed assessment uses one call and preserves student input', async () => {
  const s = setup(['{"score":88,"comment":"Reasoning is mostly correct."}']);
  assert.deepEqual(await s.grade(), { score: 88, comment: 'Reasoning is mostly correct.' });
  assert.equal(s.calls.length, 1);
  assert.match(s.calls[0].prompt, /My proof/);
});
test('malformed output gets exactly one format retry with the original answer', async () => {
  const s = setup(['not JSON', '{"score":70,"comment":"A step is missing."}']);
  assert.equal((await s.grade()).score, 70);
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[0].prompt, s.calls[1].prompt);
  assert.match(s.calls[1].system, /previous response/);
  assert.equal(s.calls[0].abortSignal, s.calls[1].abortSignal);
});
test('score and feedback validation remain strict after repair and retry', async () => {
  for (const reply of [
    '{"score":101,"comment":"ok"}',
    '{"score":"90","comment":"ok"}',
    '{"score":90,"comment":""}',
    '{"score":1.5,"comment":"ok"}',
  ]) {
    const s = setup([reply, reply]);
    await assert.rejects(s.grade(), /草稿已保留/);
    assert.equal(s.calls.length, 2);
  }
});
test('a model token-limit finish cannot be recorded as a completed assessment', async () => {
  const s = setup([
    { text: '{"score":90,"comment":"partial output"}', finishReason: 'length' },
    '{"score":65,"comment":"Finished assessment."}',
  ]);
  assert.equal((await s.grade()).score, 65);
  assert.equal(s.calls.length, 2);
});
test('provider failures are not mistaken for JSON errors or retried by the format loop', async () => {
  const s = setup([new Error('provider unavailable')]);
  await assert.rejects(s.grade(), /provider unavailable/);
  assert.equal(s.calls.length, 1);
});
test('invalid input fails before requesting a model judgement', async () => {
  const s = setup([]);
  await assert.rejects(s.grade({ points: 0 }), /points/);
  assert.equal(s.calls.length, 0);
});

test('illegible images do not trigger a second guessed assessment', async () => {
  const s = setup(['{"readable":false,"score":0,"comment":"Cannot read the image."}']);
  const image = {
    id: 'fixture',
    name: 'answer.png',
    mimeType: 'image/png',
    size: 3,
    dataUrl: 'data:image/png;base64,YWJj',
  };
  await assert.rejects(s.grade({ images: [image] }), /无法辨认/);
  assert.equal(s.calls.length, 1);
});

test('an already-authenticated native or bearer context is retained', async () => {
  const s = setup(['{"score":90,"comment":"Valid proof."}'], { userId: 'native-user' });
  assert.equal((await s.grade()).score, 90);
  assert.equal(s.calls.length, 1);
  assert.equal(s.contexts.length, 0);
});
