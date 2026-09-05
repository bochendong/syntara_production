#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const cache = new Map();
const mocks = new Map();

function loadSource(file) {
  let filename = resolve(root, file);
  if (!existsSync(filename) || !filename.endsWith('.ts')) {
    filename = existsSync(`${filename}.ts`) ? `${filename}.ts` : `${filename}/index.ts`;
  }
  if (cache.has(filename)) return cache.get(filename).exports;
  const loaded = { exports: {} };
  cache.set(filename, loaded);
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const localRequire = (specifier) => {
    if (mocks.has(specifier)) return mocks.get(specifier);
    if (specifier.startsWith('@/')) return loadSource(specifier.slice(2));
    if (specifier.startsWith('.')) return loadSource(resolve(dirname(filename), specifier));
    return require(specifier);
  };
  new Function('require', 'module', 'exports', compiled.outputText)(
    localRequire,
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const publicTests = [
  {
    id: 'groups_words_and_preserves_order',
    expression: "group_words_by_length(['hi', 'cat', 'go', 'dog'])",
    expected: "{2: ['hi', 'go'], 3: ['cat', 'dog']}",
  },
  { id: 'empty_input', expression: 'group_words_by_length([])', expected: '{}' },
];
const secretJudge = {
  language: 'python',
  timeoutMs: 5000,
  secretTests: [
    {
      id: 'single_character_and_longer_words',
      expression: "group_words_by_length(['a', 'to', 'be', 'sun', 'i', 'cat'])",
      expected: "{1: ['a', 'i'], 2: ['to', 'be'], 3: ['sun', 'cat']}",
    },
    {
      id: 'repeated_words',
      expression: "group_words_by_length(['same', 'same', 'x', 'test'])",
      expected: "{4: ['same', 'same', 'test'], 1: ['x']}",
    },
    {
      id: 'empty_strings',
      expression: "group_words_by_length(['', 'a', '', 'bb'])",
      expected: "{0: ['', ''], 1: ['a'], 2: ['bb']}",
    },
  ],
};
const code = `def group_words_by_length(words: list[str]) -> dict[int, list[str]]:
    rtn = {}
    for word in words:
        length = len(word)
        if length in rtn:
            rtn[length].append(word)
        else:
            rtn[length] = [word]
    return rtn
`;
const problem = {
  id: 'group-words-fixture',
  courseId: 'course-fixture',
  notebookId: 'notebook-fixture',
  title: 'Group Words by Length',
  type: 'code',
  status: 'published',
  source: 'manual',
  order: 0,
  points: 100,
  difficulty: 'easy',
  tags: [],
  publicContent: {
    type: 'code',
    language: 'python',
    stem: 'Group words.',
    constraints: [],
    publicTests,
  },
  grading: { type: 'code', publishRequirementsMet: true },
  sourceMeta: {},
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
const { judgeNotebookCodeProblem } = loadSource('lib/server/notebook-problems/judge.ts');

let failures = 0;
let checks = 0;
async function check(name, run) {
  checks += 1;
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

await check('separate runs and submission execute all five supplied tests', async () => {
  for (const options of [
    { kind: 'run', runTarget: 'public' },
    { kind: 'run', runTarget: 'secret' },
    { kind: 'submit' },
  ]) {
    const result = await judgeNotebookCodeProblem({
      problem,
      secretJudge,
      userAnswer: { code },
      language: 'zh-CN',
      ...options,
    });
    assert.equal(result.status, 'passed', result.result.feedback);
    if (options.runTarget !== 'secret') assert.equal(result.result.publicSummary.passed, 2);
    if (options.runTarget !== 'public') assert.equal(result.result.secretSummary.passed, 3);
  }
});

await check('zero hidden tests never claim that all tests passed', async () => {
  for (const language of ['zh-CN', 'en-US']) {
    const result = await judgeNotebookCodeProblem({
      problem,
      secretJudge: undefined,
      userAnswer: { code },
      kind: 'submit',
      language,
    });
    assert.equal(result.status, 'error');
    assert.equal(result.score, 0);
    assert.equal(result.result.secretSummary.total, 0);
    assert.doesNotMatch(result.result.secretSummary.failureSummary, /全部通过|all .*tests passed/i);
  }
});

await check(
  'historical 0/0 summaries show tests not run and retain the error feedback',
  async () => {
    const { codeTestSummaryFeedback, shouldShowAttemptFeedback } = loadSource(
      'lib/problem-bank/attempt-feedback.ts',
    );
    const summary = { total: 0, passed: 0, failed: 0, failureSummary: '隐藏测试 全部通过。' };
    const attempt = {
      kind: 'submit',
      status: 'error',
      result: { secretSummary: summary, feedback: '这道代码题缺少隐藏测试。' },
    };
    assert.equal(codeTestSummaryFeedback(summary, 'secret', 'zh-CN'), '未执行隐藏测试。');
    assert.equal(codeTestSummaryFeedback(summary, 'secret', 'en-US'), 'No secret tests were run.');
    assert.equal(shouldShowAttemptFeedback(attempt), true);
    assert.equal(shouldShowAttemptFeedback({ ...attempt, status: 'passed' }), true);
    const completed = { total: 3, passed: 3, failed: 0 };
    assert.equal(codeTestSummaryFeedback(completed, 'secret', 'zh-CN'), '隐藏测试 全部通过。');
    assert.equal(
      shouldShowAttemptFeedback({
        ...attempt,
        status: 'passed',
        result: { secretSummary: completed, feedback: '全部通过。' },
      }),
      false,
    );
    assert.equal(
      shouldShowAttemptFeedback({
        ...attempt,
        result: { publicSummary: completed, feedback: '运行器出错。' },
      }),
      true,
    );
  },
);

// Keep real access checks, problem parsing, routes, and Python grading. Only
// replace external persistence, authentication, maintenance, and LLM services.
let accessRole = 'enrolled';
let storedSecret = secretJudge;
const db = {
  notebook: {
    findFirst: async () => ({
      id: problem.notebookId,
      name: 'Fixture',
      courseId: problem.courseId,
      ownerId: 'teacher',
    }),
  },
  notebookProblem: {
    findFirst: async ({ where }) =>
      where.id === problem.id
        ? {
            ...problem,
            publicContentJson: problem.publicContent,
            gradingJson: problem.grading,
            secret: storedSecret ? { secretJudgeJson: storedSecret } : null,
            createdAt: new Date(problem.createdAt),
            updatedAt: new Date(problem.updatedAt),
          }
        : null,
  },
};
mocks.set('@/lib/server/prisma', { prisma: db });
mocks.set('@/lib/server/repositories/course-enrollment-repository', {
  findCourseAccessRole: async () => accessRole,
});
for (const specifier of [
  '@/features/background-jobs/server/store',
  '@/lib/server/repositories/notebook-repository',
  './import.core.drafts',
])
  mocks.set(specifier, {});
const service = loadSource('lib/server/notebook-problems/service.ts');

await check(
  'public-test gate uses the latest run for the same user, problem and exact code',
  async () => {
    let latest = null;
    db.notebookProblemAttempt = {
      findFirst: async (query) => {
        assert.equal(query.where.userId, 'student');
        assert.equal(query.where.problemId, problem.id);
        assert.equal(query.where.kind, 'run');
        assert.deepEqual(query.where.AND, [
          { answerJson: { path: ['code'], equals: code } },
          { resultJson: { path: ['runTarget'], equals: 'public' } },
        ]);
        assert.equal(query.where.status, undefined, 'A failed newer run must not be filtered out');
        assert.deepEqual(query.orderBy, { createdAt: 'desc' });
        return latest;
      },
    };
    const args = { userId: 'student', problemId: problem.id, code };
    assert.equal(await service.hasPassedPublicCodeRun(args), false);
    latest = { status: 'passed' };
    assert.equal(await service.hasPassedPublicCodeRun(args), true);
    latest = { status: 'failed' };
    assert.equal(await service.hasPassedPublicCodeRun(args), false);
  },
);

await check('student detail reads omit hidden tests; evaluation reads include them', async () => {
  for (const [getProblem, scopeId] of [
    [service.getCourseProblemForUser, problem.courseId],
    [service.getNotebookProblemForUser, problem.notebookId],
  ]) {
    const visible = await getProblem('student', scopeId, problem.id);
    assert.equal(visible.secretJudge, undefined);
    const evaluation = await getProblem('student', scopeId, problem.id, {
      includeSecretJudgeForEvaluation: true,
    });
    assert.equal(evaluation.secretJudge?.secretTests.length, 3);
  }
});

await check('evaluation access still rejects students outside the course', async () => {
  accessRole = null;
  try {
    await assert.rejects(
      service.getCourseProblemForUser('outsider', problem.courseId, problem.id, {
        includeSecretJudgeForEvaluation: true,
      }),
      /Course not found/,
    );
    await assert.rejects(
      service.getNotebookProblemForUser('outsider', problem.notebookId, problem.id, {
        includeSecretJudgeForEvaluation: true,
      }),
      /Notebook not found/,
    );
  } finally {
    accessRole = 'enrolled';
  }
});

mocks.set('@/lib/server/api-auth', { requireUserId: async () => ({ userId: 'student' }) });
mocks.set('@/lib/server/json-error-response', { safeRoute: (run) => run() });
mocks.set('@/lib/server/request-context', { runWithRequestContext: (_req, _route, run) => run() });
mocks.set('@/lib/server/resolve-model', {});
mocks.set('@/features/problems/server/evaluate', {});
mocks.set('@/lib/server/notebook-problems/course-identity', {
  resolveNotebookProblemCourseIdentity: async () => undefined,
});
let publicRunPassed = true;
let submissionWrites = 0;
mocks.set('@/features/problems/server/service', {
  ...service,
  hasPassedPublicCodeRun: async () => publicRunPassed,
  countNotebookProblemSubmissions: async () => 0,
  createNotebookProblemAttempt: async ({ result, ...attempt }) => {
    submissionWrites++;
    return { ...attempt, result };
  },
});
const { NextRequest } = require('next/server');
for (const [scope, scopeId] of [
  ['courses', problem.courseId],
  ['notebooks', problem.notebookId],
]) {
  const { POST } = loadSource(
    `app/api/${scope}/[id]/problems/[problemId]/attempts/submit/route.ts`,
  );
  await check(`${scope} blocks untested code without consuming a submission`, async () => {
    publicRunPassed = false;
    const before = submissionWrites;
    try {
      const response = await POST(
        new NextRequest('http://localhost/submit', {
          method: 'POST',
          body: JSON.stringify({ code, language: 'zh-CN' }),
        }),
        { params: Promise.resolve({ id: scopeId, problemId: problem.id }) },
      );
      assert.equal(response.status, 409);
      const body = await response.json();
      assert.equal(body.code, 'PUBLIC_TESTS_REQUIRED');
      assert.match(body.error, /测试用例/);
      assert.equal(submissionWrites, before);
    } finally {
      publicRunPassed = true;
    }
  });
  const submit = async (submittedCode) => {
    const response = await POST(
      new NextRequest('http://localhost/submit', {
        method: 'POST',
        body: JSON.stringify({ code: submittedCode, language: 'zh-CN' }),
      }),
      { params: Promise.resolve({ id: scopeId, problemId: problem.id }) },
    );
    assert.equal(response.status, 200);
    return response.json();
  };
  await check(`${scope} student submission returns public 2/2 and hidden 3/3`, async () => {
    const { attempt, result } = await submit(code);
    assert.equal(attempt.status, 'passed', result.feedback);
    assert.equal(result.publicSummary.total, 2);
    assert.equal(result.publicSummary.passed, 2);
    assert.equal(result.secretSummary.total, 3);
    assert.equal(result.secretSummary.passed, 3);
    assert.equal(attempt.score, 100);
    assert.deepEqual(attempt.result, result);
    assert.equal(result.caseResults, undefined);
    assert.equal(result.secretCases, undefined);
  });
  await check(`${scope} rejects a solution that fails only hidden tests`, async () => {
    const { attempt, result } = await submit(
      code.replace(
        'for word in words:',
        'for word in words:\n        if not word:\n            continue',
      ),
    );
    assert.equal(attempt.status, 'partial', result.feedback);
    assert.equal(result.publicSummary.passed, 2);
    assert.equal(result.secretSummary.passed, 2);
    assert.equal(result.secretSummary.failed, 1);
    assert.equal(attempt.score, 0);
  });
  await check(`${scope} reports genuinely missing hidden tests as an error`, async () => {
    storedSecret = undefined;
    try {
      const { attempt, result } = await submit(code);
      assert.equal(attempt.status, 'error');
      assert.match(result.feedback, /缺少隐藏测试/);
      assert.doesNotMatch(result.secretSummary.failureSummary, /全部通过/);
    } finally {
      storedSecret = secretJudge;
    }
  });
}

console.log(`Code submission: ${checks - failures}/${checks} checks passed.`);
if (failures) process.exitCode = 1;
