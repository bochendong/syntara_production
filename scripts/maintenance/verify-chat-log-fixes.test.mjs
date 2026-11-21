// Regressions found in the 2026-11 staging chat logs: the AI could not see indentation-only
// edits, table rows and part options, apologised for "misreading" fixed code, and called
// itself ChatGPT.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
  alias: { '@': fileURLToPath(new URL('../../', import.meta.url)) },
});
const { draftChangeNote, coachMethodSection } = await jiti.import(
  '../../lib/chat/explain-method.ts',
);
const { buildNativeChatSystemPrompt } = await jiti.import(
  '../../features/native-ai/server/prompt.ts',
);
const { fileTextBlock } = await jiti.import('../../features/native-ai/server/attachments.ts');

test('an indentation-only edit is reported as one indentation change', () => {
  const before = 'def f(x):\n    acc = []\n        return acc\n';
  const after = 'def f(x):\n    acc = []\n    return acc\n';
  const note = draftChangeNote(before, after);
  assert.match(note, /第 3 行只改了缩进（行首空格 8 → 4）：return acc/);
  assert.doesNotMatch(note, /删去/);
});

test('added lines keep their indentation width', () => {
  const note = draftChangeNote('def f():\n    pass\n', 'def f():\n    pass\n    return 1\n');
  assert.match(note, /\+ 第 3 行（行首空格 4）：return 1/);
});

test('coach guidance says "you fixed it" instead of apologising', () => {
  const section = coachMethodSection('python');
  assert.match(section, /这处你改对了/);
  assert.match(section, /作答没有改动/);
});

test('course and general prompts carry the Syntara identity rule', () => {
  const course = buildNativeChatSystemPrompt({
    surface: 'desktop',
    scope: 'course',
    course: { name: 'CSC108', language: 'zh-CN' },
    context: { notes: [], memories: [], calendar: [], attempts: [], problems: [] },
  });
  const general = buildNativeChatSystemPrompt({
    surface: 'phone',
    scope: 'general',
    course: { name: 'General', language: 'zh-CN' },
    context: { notes: [], memories: [], calendar: [], attempts: [], problems: [] },
  });
  for (const prompt of [course, general]) {
    assert.match(prompt, /Syntara 的 AI 助教/);
    assert.match(prompt, /不要自称 ChatGPT/);
  }
  assert.match(course, /只有这一轮真的调用了工具/);
  assert.match(course, /直接给出答案/);
});

test('a truncated PDF says which page it stopped at', () => {
  const block = fileTextBlock({
    kind: 'text',
    name: 'week8.pdf',
    text: '--- 第 1 页 ---\nhello',
    truncated: true,
    pages: { shown: 38, total: 53 },
  });
  assert.match(block, /共 53 页，只发过来到第 38 页/);
});
