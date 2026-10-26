#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const routePath = path.resolve('app/api/courses/[id]/problem-chapters/[chapterId]/route.ts');
const compiled = ts.transpileModule(fs.readFileSync(routePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const before = new Date('2020-01-01T00:00:00Z');
const initial = () => ({
  chapters: [
    { id: 'chapter', courseId: 'course', name: 'Old name', description: null, position: 0 },
    { id: 'other-chapter', courseId: 'course', name: 'Other', description: null, position: 1 },
    { id: 'foreign-chapter', courseId: 'foreign-course', name: 'Foreign', position: 0 },
  ],
  problems: [
    { id: 'p1', courseId: 'course', chapterId: 'chapter', status: 'published', updatedAt: before },
    { id: 'p2', courseId: 'course', chapterId: 'chapter', status: 'draft', updatedAt: before },
    {
      id: 'p3',
      courseId: 'course',
      chapterId: 'other-chapter',
      status: 'published',
      updatedAt: before,
    },
    {
      id: 'p4',
      courseId: 'foreign-course',
      chapterId: 'foreign-chapter',
      status: 'published',
      updatedAt: before,
    },
  ],
});
function harness({ fail, role = 'owner' } = {}) {
  let state = initial();
  let transactions = 0;
  const matches = (row, where) =>
    Object.entries(where).every(([key, value]) =>
      value && typeof value === 'object' && 'not' in value
        ? row[key] !== value.not
        : row[key] === value,
    );
  const models = (getState) => ({
    courseProblemChapter: {
      async findFirst({ where }) {
        return getState().chapters.find((row) => matches(row, where)) ?? null;
      },
      async update({ where, data }) {
        const chapter = getState().chapters.find((row) => matches(row, where));
        assert(chapter);
        Object.assign(chapter, data);
        return {
          ...chapter,
          _count: {
            problems: getState().problems.filter(
              (p) => p.chapterId === chapter.id && p.status !== 'archived',
            ).length,
          },
        };
      },
      async delete({ where }) {
        if (fail === 'delete') throw new Error('delete failed');
        getState().chapters = getState().chapters.filter((row) => !matches(row, where));
      },
    },
    notebookProblem: {
      async updateMany({ where, data }) {
        if (fail === 'touch') throw new Error('touch failed');
        let count = 0;
        for (const problem of getState().problems)
          if (matches(problem, where)) {
            Object.assign(problem, data);
            count += 1;
          }
        return { count };
      },
    },
  });
  const prisma = {
    ...models(() => state),
    async $transaction(operation) {
      transactions += 1;
      const pending = structuredClone(state);
      const result = await operation(models(() => pending));
      state = pending;
      return result;
    },
  };
  const exports = {};
  const sandbox = {
    exports,
    Date,
    require(specifier) {
      if (specifier === 'next/server')
        return {
          NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) },
        };
      if (specifier === '@/lib/server/prisma') return { prisma };
      if (specifier === '@/lib/server/api-auth')
        return { requireUserId: async () => ({ userId: 'user' }) };
      if (specifier === '@/lib/server/json-error-response')
        return { safeRoute: (operation) => operation() };
      if (specifier === '@/lib/server/repositories/course-enrollment-repository')
        return { findCourseAccessRole: async () => role };
      return require(specifier);
    },
  };
  vm.runInNewContext(compiled, sandbox, { filename: routePath });
  const context = { params: Promise.resolve({ id: 'course', chapterId: 'chapter' }) };
  return { route: exports, context, state: () => state, transactions: () => transactions };
}
function expectUnrelatedUnchanged(state) {
  assert.equal(state.problems[2].chapterId, 'other-chapter');
  assert.equal(state.problems[2].updatedAt.getTime(), before.getTime());
  assert.equal(state.problems[3].chapterId, 'foreign-chapter');
  assert.equal(state.problems[3].updatedAt.getTime(), before.getTime());
}
const renamed = harness();
const response = await renamed.route.PATCH(
  { json: async () => ({ name: 'New name' }) },
  renamed.context,
);
assert.equal(response.status, 200);
assert.equal(response.body.chapter.name, 'New name');
assert.equal(renamed.transactions(), 1);
for (const problem of renamed.state().problems.slice(0, 2)) {
  assert(
    problem.updatedAt.getTime() > before.getTime(),
    'Renamed chapter must reappear through a subsequent problem delta.',
  );
  assert.equal(problem.chapterId, 'chapter');
}
expectUnrelatedUnchanged(renamed.state());
const described = harness();
await described.route.PATCH(
  { json: async () => ({ description: 'New description' }) },
  described.context,
);
assert.equal(described.state().chapters[0].description, 'New description');
assert.equal(
  described.state().problems[0].updatedAt.getTime(),
  before.getTime(),
  'Description is not a native problem metadata field.',
);
const deleted = harness();
assert.equal((await deleted.route.DELETE({}, deleted.context)).status, 200);
assert.equal(deleted.transactions(), 1);
assert.equal(
  deleted.state().chapters.some((chapter) => chapter.id === 'chapter'),
  false,
);
assert.equal(deleted.state().problems.length, 4, 'Deleting a chapter must preserve its questions.');
for (const problem of deleted.state().problems.slice(0, 2)) {
  assert.equal(problem.chapterId, null);
  assert(
    problem.updatedAt.getTime() > before.getTime(),
    'Unassigned chapter must be delivered through a subsequent delta.',
  );
}
expectUnrelatedUnchanged(deleted.state());
for (const [method, fail] of [
  ['PATCH', 'touch'],
  ['DELETE', 'delete'],
]) {
  const failed = harness({ fail });
  await assert.rejects(
    failed.route[method]({ json: async () => ({ name: 'Must roll back' }) }, failed.context),
    /failed/,
  );
  assert.equal(
    JSON.stringify(failed.state()),
    JSON.stringify(initial()),
    'Metadata and delta timestamps must roll back together.',
  );
}
const denied = harness({ role: 'enrolled' });
assert.equal(
  (await denied.route.PATCH({ json: async () => ({ name: 'Unauthorized' }) }, denied.context))
    .status,
  404,
);
assert.equal((await denied.route.DELETE({}, denied.context)).status, 404);
assert.equal(denied.transactions(), 0);
assert.equal(JSON.stringify(denied.state()), JSON.stringify(initial()));
console.log(
  JSON.stringify(
    {
      ok: true,
      renameTouchesProblemDelta: true,
      deleteExplicitlyDetachesAndTouches: true,
      unrelatedProblemsUntouched: true,
      atomicRollback: true,
      enrolledCannotManage: true,
    },
    null,
    2,
  ),
);
