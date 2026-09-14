import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const root = new URL('../', import.meta.url).pathname;
const source = readFileSync(root + 'lib/server/notebook-problems/service.ts', 'utf8');
const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(
  (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'createManualCourseProblem',
);
const compiled = ts.transpileModule(fn.getText(ast), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
async function scenario({
  denied = false,
  chapter = true,
  duplicate = false,
  verifiedStatus = 'published',
  requestedStatus = 'published',
} = {}) {
  const calls = [];
  const mod = { exports: {} };
  const tx = {
    courseProblemChapter: {
      findFirst: async () => {
        calls.push('chapter');
        return chapter ? {} : null;
      },
    },
    notebookProblem: { aggregate: async () => ({ _max: { order: 8 } }) },
  };
  const dependencies = {
    requireCourseOwnership: async () => {
      calls.push('auth');
      if (denied) throw Error('Course not found');
    },
    notebookProblemImportDraftSchema: { parse: (x) => x },
    normalizeDraftForPersistence: (x) => x,
    withCodeReferenceVerification: async (x) => {
      calls.push('verify');
      return {
        ...x,
        status: verifiedStatus,
        validationErrors: verifiedStatus === 'draft' ? ['Example failed'] : [],
      };
    },
    prismaDb: {
      $transaction: async (run) => {
        calls.push('transaction');
        return run(tx);
      },
    },
    ensureCourseProblemDedupeStateTx: async () => new Map(duplicate ? [['key', 'existing']] : []),
    courseProblemDedupeKey: () => 'key',
    nextProblemNumberForScopeTx: async () => 12,
    createProblemFromDraftTx: async (data) => {
      calls.push(data);
      return { id: 'new', status: data.draft.status };
    },
    touchOwnersAfterProblemWriteTx: async () => calls.push('summary'),
  };
  new Function('exports', ...Object.keys(dependencies), compiled)(
    mod.exports,
    ...Object.values(dependencies),
  );
  const run = () =>
    mod.exports.createManualCourseProblem({
      userId: 'teacher',
      courseId: 'course',
      chapterId: 'chapter',
      draft: {
        draftId: 'draft',
        type: 'code',
        status: requestedStatus,
        publicContent: { type: 'code' },
        grading: { type: 'code' },
        sourceMeta: { codeVerification: { passed: true } },
        validationErrors: [],
      },
    });
  return { calls, run };
}
let test = await scenario();
assert.deepEqual(await test.run(), { id: 'new', status: 'published' });
assert.deepEqual(test.calls.slice(0, 4), ['auth', 'verify', 'transaction', 'chapter']);
const saved = test.calls.find((x) => typeof x === 'object');
assert.equal(saved.chapterId, 'chapter');
assert.equal(saved.order, 9);
assert.equal(saved.problemNumber, 12);
assert.deepEqual(saved.draft.sourceMeta, {}, 'Do not trust client verification');
for (const options of [
  { denied: true },
  { chapter: false },
  { duplicate: true },
  { verifiedStatus: 'draft' },
]) {
  test = await scenario(options);
  await assert.rejects(test.run());
  assert.ok(!test.calls.some((x) => typeof x === 'object'), 'Invalid request must never write');
}
test = await scenario({ verifiedStatus: 'draft', requestedStatus: 'draft' });
assert.equal((await test.run()).status, 'draft');
const welcome = ts.transpileModule(
  readFileSync(root + 'features/course-forum/server/course-forum-welcome.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
for (const legacy of [true, false]) {
  const writes = [];
  const mod = { exports: {} };
  new Function('require', 'exports', welcome)(
    () => ({
      prisma: {
        courseForumPost: {
          upsert: async (args) => {
            writes.push(args);
            return {
              id: 'welcome',
              title: legacy ? '欢迎使用课程论坛｜发帖前请先阅读' : '老师自定义欢迎',
              bodyMarkdown: '**本机构严禁在公开论坛讨论任何考试或作业内容。**',
            };
          },
          updateMany: async (args) => writes.push(args),
        },
      },
    }),
    mod.exports,
  );
  await mod.exports.ensureCourseForumWelcomePost({
    id: 'course',
    ownerId: 'teacher',
    courseCode: 'UTSG-CSC108',
    name: 'Course',
  });
  assert.equal(writes.length, legacy ? 2 : 1);
  assert.match(writes[0].create.bodyMarkdown, /修改自己的名字/);
  assert.match(writes[0].create.bodyMarkdown, /老师不会回复作业答案/);
  assert.match(writes[0].create.bodyMarkdown, /题库/);
}
console.log(
  'PASS: manual create ownership/chapter/dedupe/publish verification, untrusted verification metadata, draft save, and legacy welcome upgrade preserving customized posts.',
);
