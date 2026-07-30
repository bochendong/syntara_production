#!/usr/bin/env node

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const previousTypeScriptLoader = require.extensions['.ts'];

require.extensions['.ts'] = function transpileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      target: ts.ScriptTarget.ES2022,
    },
  });
  module._compile(output.outputText, filename);
};

const cases = [
  {
    category: 'ordinary explanation',
    question: '请解释一下强归纳法为什么成立。',
    expected: true,
  },
  {
    category: 'ordinary explanation',
    question: 'What is the difference between breadth-first search and depth-first search?',
    expected: true,
  },
  {
    category: 'calendar mutation',
    question: '把这周的复习任务加入日历，可以吗？',
    expected: false,
  },
  {
    category: 'review planning',
    question: '请制定一个两周的复习计划，并说明每天的目标。',
    expected: false,
  },
  {
    category: 'review planning natural-language variant',
    question: '帮我做一个复习计划，并说明这样安排的原因。',
    expected: false,
  },
  {
    category: 'review planning English plan',
    question: 'Create a two-week review plan and explain why.',
    expected: false,
  },
  {
    category: 'review planning English workflow',
    question: 'How should I review linked lists?',
    expected: false,
  },
  {
    category: 'problem-bank practice',
    question: '给我出 5 道练习题，并从题库里选。',
    expected: false,
  },
  {
    category: 'problem-bank practice natural-language variant',
    question: '给我三道练习题，并讲解答案。',
    expected: false,
  },
  {
    category: 'classroom generation',
    question: '生成一个迷你课堂来讲解数学归纳法。',
    expected: false,
  },
  {
    category: 'classroom generation natural-language variant',
    question: '请做一个五分钟小课堂，讲解二叉树遍历。',
    expected: false,
  },
  {
    category: 'memory write',
    question: '请记住我为什么总在树的递归边界出错。',
    expected: false,
  },
  {
    category: 'learner-state query',
    question: '我目前学到哪了？我的薄弱点是什么？',
    expected: false,
  },
  {
    category: 'learner-state query natural-language variant',
    question: '根据我的历史，分析一下我现在会什么、不会什么。',
    expected: false,
  },
  {
    category: 'learner-state mistake audit',
    question: '分析最近的错题并总结薄弱点。',
    expected: false,
  },
  {
    category: 'proof quality constraints',
    question: '请证明每个正整数都能写成不同 2 的幂之和，并讲解思路。',
    expected: false,
  },
  {
    category: 'short confirmation',
    question: '继续吧',
    expected: false,
  },
  {
    category: 'missing course boundary',
    question: '为什么强归纳法需要假设所有更小的情形？',
    courseId: '',
    expected: false,
  },
];

try {
  const decisionChainPath = path.join(
    repositoryRoot,
    'features',
    'learn-core',
    'server',
    'decision-chain.ts',
  );
  const { shouldUseDirectCourseAnswerFastPath } = require(decisionChainPath);

  if (typeof shouldUseDirectCourseAnswerFastPath !== 'function') {
    throw new TypeError(
      'decision-chain.ts must export shouldUseDirectCourseAnswerFastPath as a function.',
    );
  }

  const failures = [];
  for (const testCase of cases) {
    const actual = shouldUseDirectCourseAnswerFastPath({
      courseId: testCase.courseId ?? 'contract-course',
      question: testCase.question,
    });
    if (actual !== testCase.expected) {
      failures.push({ ...testCase, actual });
      console.error(
        `FAIL [${testCase.category}] expected ${testCase.expected}, got ${actual}: ${testCase.question}`,
      );
    } else {
      console.log(`PASS [${testCase.category}] ${testCase.question}`);
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n${failures.length}/${cases.length} direct course answer fast-path contract checks failed.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `\nPASS ${cases.length}/${cases.length} direct course answer fast-path contract checks.`,
    );
  }
} finally {
  require.extensions['.ts'] = previousTypeScriptLoader;
}
