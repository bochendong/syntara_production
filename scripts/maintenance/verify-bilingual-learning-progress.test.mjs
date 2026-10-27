import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import path from 'node:path';
const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('.') } });
const { loadTrustedCourseLearningProgress } = await jiti.import(
  '../../lib/server/course-learning-progress.ts',
);
const { createEmptyLearnerCourseState } = await jiti.import(
  '../../lib/learning/course-learner-state.ts',
);
const notebook = (id, language, number) => ({
  id,
  name: `[${language === 'en' ? 'EN' : '中文'}] 0${number} ${language === 'en' ? 'Sets' : '集合'}`,
  language,
  notebookKind: 'markdown',
  tags: [],
  coverSlideJson: { sourceSha256: String(number).padStart(64, '0') },
  createdAt: new Date(number * 1000),
  updatedAt: new Date(number * 1000),
});
const rows = [
  notebook('en-1', 'en', 1),
  notebook('zh-1', 'zh-CN', 1),
  notebook('en-2', 'en', 2),
  notebook('zh-2', 'zh-CN', 2),
];
const base = createEmptyLearnerCourseState({ userId: 'user', courseId: 'course' });
function prisma(state) {
  return {
    memoryFact: { findFirst: async () => (state ? { valueJson: state } : null) },
    notebook: { findMany: async () => rows },
  };
}
for (const id of ['en-1', 'zh-1'])
  test(`checkpoint ${id} includes both first editions and excludes the future lecture`, async () => {
    const state = {
      ...base,
      progressCheckpoint: { kind: 'notebook', source: 'student', notebookId: id },
      currentNotebookId: id,
    };
    const result = await loadTrustedCourseLearningProgress({
      prisma: prisma(state),
      userId: 'user',
      courseId: 'course',
    });
    assert.equal(result.learner.progressPercent, 50);
    assert.equal(result.learner.courseNotebookIds.length, 2);
    assert.deepEqual(new Set(result.allowedNotebookIds), new Set(['zh-1', 'en-1']));
    assert.deepEqual(new Set(result.futureNotebookIds), new Set(['zh-2', 'en-2']));
  });
test('completed all and not started treat editions as one lecture', async () => {
  for (const [kind, percent, expected] of [
    ['completed_all', 100, 4],
    ['not_started', 0, 0],
  ]) {
    const state = { ...base, progressCheckpoint: { kind, source: 'student' } };
    const result = await loadTrustedCourseLearningProgress({
      prisma: prisma(state),
      userId: 'user',
      courseId: 'course',
    });
    assert.equal(result.learner.progressPercent, percent);
    assert.equal(result.allowedNotebookIds.length, expected);
  }
});
