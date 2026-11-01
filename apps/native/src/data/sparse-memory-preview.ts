import type { LocalCourse, LocalStudyMemory } from '../domain/models';

const timestamp = Date.UTC(2026, 9, 31, 18);

export const sparseMemoryPreviewCourses: LocalCourse[] = [
  { id: 'preview-memory-single', name: '单球记忆预览', courseCode: 'MEM101' },
  { id: 'preview-memory-few', name: '三球记忆预览', courseCode: 'MEM103' },
].map((course) => ({
  ...course,
  description: '仅用于本地 UI 预览的模拟课程。',
  language: 'zh-CN',
  tags: ['mock', '记忆球预览'],
  purpose: 'university',
  university: null,
  createdAt: timestamp,
  updatedAt: timestamp,
}));

export const sparseMemoryPreviewMemories: LocalStudyMemory[] = [
  {
    courseId: 'preview-memory-single',
    title: '理解函数的输入与输出',
    text: '能够用自己的话解释参数和返回值。',
  },
  {
    courseId: 'preview-memory-few',
    title: '集合与元素',
    text: '已经能区分元素属于集合和集合包含集合。',
  },
  {
    courseId: 'preview-memory-few',
    title: '量词的顺序',
    text: '交换全称量词和存在量词的顺序时，需要重新判断命题。',
  },
  {
    courseId: 'preview-memory-few',
    title: '反例的构造',
    text: '反驳全称命题只需要找到一个满足条件但不满足结论的例子。',
  },
].map((memory, index) => ({
  ...memory,
  id: `preview-sparse-memory-${index + 1}`,
  notebookId: null,
  targetType: 'course',
  scope: 'course',
  kind: 'learner_state',
  status: 'active',
  source: 'local_ui_preview',
  reason: '稀疏记忆球布局的模拟数据。',
  question: null,
  sourceReferences: [`concept:preview-memory-${index + 1}`],
  confidence: 0.9,
  createdAt: timestamp + index,
  updatedAt: timestamp + index,
}));
