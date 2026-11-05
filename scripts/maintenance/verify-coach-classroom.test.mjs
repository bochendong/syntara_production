import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
  alias: { '@': fileURLToPath(new URL('../../', import.meta.url)) },
});
const { coachAllowsClassroom } = await jiti.import('../../lib/problem-bank/problem-coach.ts');
const { buildNativeChatSystemPrompt } = await jiti.import(
  '../../features/native-ai/server/prompt.ts',
);

test('classroom suggestions respect hint levels and ordinary chat boundaries', () => {
  for (const move of ['hint', 'next', 'check', 'solution', 'ask']) {
    const allowed = move === 'solution' || move === 'ask';
    assert.equal(coachAllowsClassroom(move), allowed);
    const input = {
      scope: 'course',
      surface: 'desktop',
      course: { name: 'CSC108', code: 'CSC108', language: 'zh-CN' },
      context: {
        notes: [],
        memories: [],
        calendar: [],
        attempts: [],
        problems: [],
        problemCoach: { move, problem: 'Explain the loop step by step.' },
      },
    };
    assert.equal(buildNativeChatSystemPrompt(input).includes('- suggest_classroom：'), allowed);
    assert.equal(
      buildNativeChatSystemPrompt({ ...input, scope: 'general' }).includes('suggest_classroom'),
      false,
    );
  }
});
