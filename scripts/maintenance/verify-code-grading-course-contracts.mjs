#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function compile(file) {
  const path = resolve(root, file);
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.equal(errors.length, 0, errors.map((error) => error.messageText).join('\n'));
  return { path, output: compiled.outputText };
}

function evaluate(compiled, customRequire = require) {
  const loadedModule = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', compiled.output)(
    customRequire,
    loadedModule,
    loadedModule.exports,
    compiled.path,
    dirname(compiled.path),
  );
  return loadedModule.exports;
}

const contract = evaluate(compile('features/memory/domain/course-answer-contract.ts'));
const judge = evaluate(compile('lib/server/notebook-problems/judge.ts'), (specifier) => {
  if (specifier === '@/features/memory/domain/course-answer-contract') return contract;
  if (specifier === '@/lib/problem-bank') {
    return {
      isNotebookCodeProblemRecord: (problem) =>
        problem?.type === 'code' &&
        problem?.publicContent?.type === 'code' &&
        problem?.grading?.type === 'code',
    };
  }
  if (specifier === '@/lib/server/notebook-problems/course-identity') return {};
  return require(specifier);
});

const baseProblem = {
  id: 'fixture-problem',
  courseId: 'fixture-course',
  notebookId: 'fixture-notebook',
  notebookName: 'Functions',
  title: 'Implement is_even',
  type: 'code',
  points: 5,
  publicContent: {
    type: 'code',
    stem: 'Implement is_even.',
    constraints: [],
    publicTests: [],
    sampleIO: [],
    secretConfigPresent: true,
  },
  grading: { type: 'code', publishRequirementsMet: true },
};
const passed = {
  status: 'passed',
  score: 5,
  result: {
    correct: true,
    feedback: 'All tests passed.',
    earnedPoints: 5,
    publicCases: [],
  },
};

const missingDocstring = judge.enforceCodeSubmissionCourseContract({
  problem: baseProblem,
  userAnswer: { code: 'def is_even(value: int) -> bool:\n    return value % 2 == 0' },
  courseIdentity: { id: 'fixture-course', name: 'Programming', courseCode: 'CSC108' },
  locale: 'en-US',
  evaluated: passed,
});
assert.equal(missingDocstring.status, 'failed');
assert.equal(missingDocstring.score, 0);
assert.match(missingDocstring.result.feedback, /csc108\.function\.docstring\.present/);

const unrelatedCsc148Function = judge.enforceCodeSubmissionCourseContract({
  problem: { ...baseProblem, title: 'Add two numbers' },
  userAnswer: { code: 'def add(left: int, right: int) -> int:\n    return left + right' },
  courseIdentity: { id: 'fixture-course', name: 'Computer Science', courseCode: 'CSC148' },
  locale: 'en-US',
  evaluated: passed,
});
assert.equal(unrelatedCsc148Function.status, 'passed');

const visibleNodeRepresentation = judge.enforceCodeSubmissionCourseContract({
  problem: {
    ...baseProblem,
    title: 'BinarySearchTree contains',
    publicContent: {
      ...baseProblem.publicContent,
      stem: 'Complete contains using the supplied Node representation.',
      starterCode:
        'class Node:\n    def __init__(self, item: int) -> None:\n        self.item = item\n        self.left: Node | None = None\n        self.right: Node | None = None',
    },
  },
  userAnswer: {
    code: 'def contains(root: Node | None, item: int) -> bool:\n    return root is not None and root.item == item',
  },
  courseIdentity: { id: 'fixture-course', name: 'Computer Science', courseCode: 'CSC148' },
  locale: 'en-US',
  evaluated: passed,
});
assert.equal(visibleNodeRepresentation.status, 'passed');

for (const route of [
  'app/api/courses/[id]/problems/[problemId]/attempts/submit/route.ts',
  'app/api/notebooks/[id]/problems/[problemId]/attempts/submit/route.ts',
]) {
  const source = readFileSync(resolve(root, route), 'utf8');
  assert.match(source, /resolveNotebookProblemCourseIdentity\s*\(/);
  assert.match(source, /courseIdentity,/);
}

console.log('PASS code grading course-contract enforcement (3 behavior checks, 2 route checks)');
