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
