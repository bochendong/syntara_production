#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const promptPath = resolve(root, 'features/learn-core/client-mini-lecture.ts');
const promptSource = readFileSync(promptPath, 'utf8');
const clientSource = readFileSync(resolve(root, 'components/learn/learn-page-client.tsx'), 'utf8');
const compiled = ts.transpileModule(promptSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: promptPath,
});
const localModule = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputText)(
  require,
  localModule,
  localModule.exports,
);

const { buildMiniLecturePrompt } = localModule.exports;
const shortExplanation =
  '机会成本是指为了获得一个选择而放弃的最佳替代选择的价值。例如选择读书而放弃兼职，放弃的工资就是机会成本的一部分。';
for (const question of [
  '讲解机会成本',
  '机会成本',
  '解释 hypothesis test 的原理',
  '知识点里进度控制是什么意思',
]) {
  assert.ok(
    buildMiniLecturePrompt({ question, answer: shortExplanation, course: { name: 'BUS200' } }),
    question,
  );
}
const continued = buildMiniLecturePrompt({
  question: '继续讲',
  previousQuestion: '讲解机会成本',
  answer: shortExplanation,
  course: { name: 'BUS200' },
});
assert.equal(continued.question, '讲解机会成本');
for (const question of ['帮我生成学习计划', '修改明天的日程', '我目前的学习进度是什么？']) {
  assert.equal(
    buildMiniLecturePrompt({ question, answer: shortExplanation, course: { name: 'BUS200' } }),
    undefined,
  );
}
assert.equal(
  buildMiniLecturePrompt({
    question: '讲解机会成本',
    answer: '你想先听哪个部分？',
    course: { name: 'BUS200' },
  }),
  undefined,
);

// Run the actual message selector, including reload and streaming states.
const ast = ts.createSourceFile(
  'learn.tsx',
  clientSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const selectedFunctions = ['isProblemSelectionPlan', 'miniLecturePromptForMessage']
  .map((name) => {
    const node = ast.statements.find(
      (item) => ts.isFunctionDeclaration(item) && item.name?.text === name,
    );
    assert.ok(node, name);
    return node.getText(ast);
  })
  .join('\n');
const helperSource = ts.transpileModule(selectedFunctions, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const infer = new Function(
  'buildMiniLecturePrompt',
  'PRACTICE_PROBLEM_SELECTION_DECISION_ID',
  `${helperSource}\nreturn miniLecturePromptForMessage;`,
)(buildMiniLecturePrompt, 'learn-practice-problem-selection');
const restoredMessages = JSON.parse(
  JSON.stringify([
    { id: 'q1', role: 'user', text: '请讲解机会成本', createdAt: 1 },
    { id: 'a1', role: 'assistant', text: '可以，我们接着讲。', createdAt: 2 },
    { id: 'q2', role: 'user', text: '继续讲', createdAt: 3 },
    { id: 'a2', role: 'assistant', text: shortExplanation, createdAt: 4 },
  ]),
);
const recovered = infer({
  messages: restoredMessages,
  messageIndex: 3,
  course: { name: 'BUS200' },
});
assert.equal(recovered.question, '请讲解机会成本');
assert.equal(recovered.id, 'mini-lecture-prompt-a2');
restoredMessages[3].transient = true;
restoredMessages[3].lecturePrompt = recovered;
assert.equal(
  infer({ messages: restoredMessages, messageIndex: 3, course: { name: 'BUS200' } }),
  undefined,
  'The invitation must wait for the completed answer.',
);
const euclideanAnswer =
  '欧几里得算法的关键是：若 a=bq+r，则 a 与 b 的公因数集合，和 b 与 r 的公因数集合完全相同，所以 gcd(a,b)=gcd(b,r)。每一步的余数都会严格变小，过程一定会到达余数为零。此时最后一个非零余数既保留了最初两个数的全部公因数，又是它们最大的公因数，因此算法成立。';

assert.ok(
  buildMiniLecturePrompt({
    question: '为什么欧几里得算法可以求最大公因数？',
    answer: euclideanAnswer,
    course: { name: 'MAT 102' },
  }),
  'A substantive Euclidean-algorithm explanation must offer the classroom card.',
);
assert.equal(
  buildMiniLecturePrompt({
    question: '我目前的学习进度是什么？',
    answer: euclideanAnswer,
    course: { name: 'MAT 102' },
  }),
  undefined,
  'Progress questions must not offer a classroom card.',
);
assert.match(clientSource, /function miniLecturePromptForMessage\(/);
assert.match(
  clientSource,
  /const prompt = miniLecturePromptForMessage\([\s\S]{0,220}if \(!prompt\) return/,
  'Clicking a recovered card must use the same inferred prompt as rendering.',
);
assert.match(
  clientSource,
  /visibleMessages\.map\(\(message, messageIndex\) => \{[\s\S]{0,500}const miniLecturePrompt = miniLecturePromptForMessage\(/,
  'Completed explanation messages must recover missing lecture prompts at render time.',
);
assert.match(clientSource, /prompt=\{miniLecturePrompt\}/);

console.log('PASS: learn mini-lecture cards are inferred, rendered, and actionable.');
