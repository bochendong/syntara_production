import courseJson from '../../../../data/csc148/course.json';
import memoriesJson from '../../../../data/csc148/memories.json';
import additionalContentJson from './snapshots/additional-queue-learning-content.v1.json';
import type { LocalMarkdownSection, LocalNotebook, LocalStudyMemory } from '../domain/models';

type SourceSection = {
  title: string;
  markdown: string;
  summary?: string;
};

type SourceNotebook = {
  topicKey: string;
  sections: SourceSection[];
};

type MemorySource = {
  id: string;
  notebookId: string | null;
  targetType: string;
  kind: string;
  title: string;
  text: string;
  sourceReferences: string[];
};

type NotebookDescriptor = {
  sourceOrder: string;
  topicKey: string;
  id: string;
  name: string;
  description: string;
  tags: string[];
  sourcePath: string;
};

type AdditionalNotebookSource = {
  id: string;
  courseId: string;
  name: string;
  description: string;
  tags: string[];
  sourcePath: string;
  sections: Array<{
    title: string;
    markdown: string;
    summary: string | null;
  }>;
};

type AdditionalMemorySource = MemorySource & {
  courseId: string;
};

const COURSE_ID = 'course-csc148-local';
const timestamp = Date.UTC(2026, 6, 28, 0, 0, 0);

export const bundledLearningContentVersion = 'all-queue-local-content-v2';

const descriptors: NotebookDescriptor[] = [
  {
    sourceOrder: '01',
    topicKey: 'python-memory-model',
    id: 'local-queue-csc148-01-memory-model',
    name: '01 · Python 记忆模型',
    description: '对象、引用、别名、变异，以及浅拷贝与深拷贝。',
    tags: ['Python', 'memory model', 'aliasing'],
    sourcePath: 'queue/CSC148/1_The_Python_Memory_Model.md',
  },
  {
    sourceOrder: '02',
    topicKey: 'testing',
    id: 'local-queue-csc148-02-testing',
    name: '02 · 测试你的代码',
    description: 'doctest、pytest、测试用例选择与变异行为检查。',
    tags: ['testing', 'pytest', 'doctest'],
    sourcePath: 'queue/CSC148/2_Testing_Your_code.md',
  },
  {
    sourceOrder: '03',
    topicKey: 'oop-basics',
    id: 'local-queue-csc148-03-oop',
    name: '03 · 面向对象程序设计',
    description: '类、实例属性、公开接口与表示不变量。',
    tags: ['OOP', 'class', 'RI'],
    sourcePath: 'queue/CSC148/3_OOP.md',
  },
  {
    sourceOrder: '04',
    topicKey: 'adts-stacks-queues',
    id: 'local-queue-csc148-04-adt',
    name: '04 · 抽象数据类型',
    description: 'ADT 与数据结构的边界，以及 Stack、Queue 的接口。',
    tags: ['ADT', 'Stack', 'Queue'],
    sourcePath: 'queue/CSC148/4_ADT.md',
  },
  {
    sourceOrder: '05',
    topicKey: 'exceptions',
    id: 'local-queue-csc148-05-exceptions',
    name: '05 · Exceptions',
    description: '异常的抛出、传播、捕获与控制流。',
    tags: ['exceptions', 'control flow'],
    sourcePath: 'queue/CSC148/5_Exception.md',
  },
  {
    sourceOrder: '06',
    topicKey: 'linked-lists',
    id: 'local-queue-csc148-06-linked-list',
    name: '06 · Linked Lists',
    description: '节点、链接、链表变异与遍历成本。',
    tags: ['LinkedList', 'node', 'mutation'],
    sourcePath: 'queue/CSC148/6_Linked_List.md',
  },
  {
    sourceOrder: '07',
    topicKey: 'recursion',
    id: 'local-queue-csc148-07-recursion',
    name: '07 · Recursion',
    description: '递归结构、base case、递归调用与调用栈。',
    tags: ['recursion', 'call stack'],
    sourcePath: 'queue/CSC148/7_Recursion.md',
  },
  {
    sourceOrder: '08',
    topicKey: 'trees',
    id: 'local-queue-csc148-08-trees',
    name: '08 · Trees',
    description: '递归树结构、术语、表示不变量与遍历。',
    tags: ['Tree', 'recursive data'],
    sourcePath: 'queue/CSC148/8_trees.md',
  },
];

const sourceNotebooks = (courseJson.notebooks as SourceNotebook[]).reduce(
  (result, notebook) => result.set(notebook.topicKey, notebook),
  new Map<string, SourceNotebook>(),
);

function requireSourceNotebook(topicKey: string): SourceNotebook {
  const notebook = sourceNotebooks.get(topicKey);
  if (!notebook) {
    throw new Error(`CSC148 本地内容包缺少 topicKey=${topicKey} 的人工笔记。`);
  }
  return notebook;
}

const csc148LearningNotebooks: LocalNotebook[] = descriptors.map((descriptor, index) => {
  const source = requireSourceNotebook(descriptor.topicKey);
  return {
    id: descriptor.id,
    courseId: COURSE_ID,
    name: descriptor.name,
    description: descriptor.description,
    kind: 'markdown',
    tags: [...descriptor.tags, 'queue', '本地'],
    sectionCount: source.sections.length,
    createdAt: timestamp + index,
    updatedAt: timestamp + index,
  };
});

const csc148LearningMarkdownSections: LocalMarkdownSection[] = descriptors.flatMap(
  (descriptor, notebookIndex) =>
    requireSourceNotebook(descriptor.topicKey).sections.map((section, sectionIndex) => ({
      id: `${descriptor.id}:section:${String(sectionIndex + 1).padStart(2, '0')}`,
      notebookId: descriptor.id,
      courseId: COURSE_ID,
      title: section.title,
      order: sectionIndex,
      markdown: section.markdown,
      summary: section.summary ?? null,
      sourceMeta: {
        sourceKind: 'repo-queue-markdown',
        sourcePath: descriptor.sourcePath,
        sourceOrder: descriptor.sourceOrder,
        importVersion: bundledLearningContentVersion,
        authoredLocally: true,
        generationPipelineUsed: false,
      },
      createdAt: timestamp + notebookIndex,
      updatedAt: timestamp + notebookIndex,
    })),
);

const csc148LearningMemories: LocalStudyMemory[] = (memoriesJson.memories as MemorySource[]).map(
  (memory, index) => ({
    id: memory.id,
    courseId: COURSE_ID,
    notebookId: memory.notebookId,
    targetType: memory.targetType,
    scope: 'public',
    kind: memory.kind,
    status: 'active',
    source: 'local_queue_injection',
    title: memory.title,
    text: memory.text,
    reason: '从 repo 内 queue/CSC148 讲义人工提炼，供本地课程检索与回答使用。',
    question: null,
    sourceReferences: memory.sourceReferences,
    confidence: 1,
    createdAt: timestamp + index,
    updatedAt: timestamp + index,
  }),
);

const additionalNotebooks = additionalContentJson.notebooks as AdditionalNotebookSource[];
const additionalMemories = additionalContentJson.memories as AdditionalMemorySource[];

const additionalLearningNotebooks: LocalNotebook[] = additionalNotebooks.map((notebook, index) => ({
  id: notebook.id,
  courseId: notebook.courseId,
  name: notebook.name,
  description: notebook.description,
  kind: 'markdown',
  tags: notebook.tags,
  sectionCount: notebook.sections.length,
  createdAt: timestamp + 1_000 + index,
  updatedAt: timestamp + 1_000 + index,
}));

const additionalLearningMarkdownSections: LocalMarkdownSection[] = additionalNotebooks.flatMap(
  (notebook, notebookIndex) =>
    notebook.sections.map((section, sectionIndex) => ({
      id: `${notebook.id}:section:${String(sectionIndex + 1).padStart(2, '0')}`,
      notebookId: notebook.id,
      courseId: notebook.courseId,
      title: section.title,
      order: sectionIndex,
      markdown: section.markdown,
      summary: section.summary,
      sourceMeta: {
        sourceKind: 'repo-queue-source',
        sourcePath: notebook.sourcePath,
        importVersion: additionalContentJson.version,
        authoredLocally: true,
        generationPipelineUsed: false,
      },
      createdAt: timestamp + 1_000 + notebookIndex,
      updatedAt: timestamp + 1_000 + notebookIndex,
    })),
);

const additionalLearningMemories: LocalStudyMemory[] = additionalMemories.map((memory, index) => ({
  id: memory.id,
  courseId: memory.courseId,
  notebookId: memory.notebookId,
  targetType: memory.targetType,
  scope: 'public',
  kind: memory.kind,
  status: 'active',
  source: 'local_queue_injection',
  title: memory.title,
  text: memory.text,
  reason: '从 repo 内对应课程 queue 讲义人工整理，供本地课程检索与回答使用。',
  question: null,
  sourceReferences: memory.sourceReferences,
  confidence: 1,
  createdAt: timestamp + 1_000 + index,
  updatedAt: timestamp + 1_000 + index,
}));

export const bundledLearningNotebooks: LocalNotebook[] = [
  ...csc148LearningNotebooks,
  ...additionalLearningNotebooks,
];

export const bundledLearningMarkdownSections: LocalMarkdownSection[] = [
  ...csc148LearningMarkdownSections,
  ...additionalLearningMarkdownSections,
];

export const bundledLearningMemories: LocalStudyMemory[] = [
  ...csc148LearningMemories,
  ...additionalLearningMemories,
];

export const bundledLearningContentStats = {
  notebooks: bundledLearningNotebooks.length,
  markdownSections: bundledLearningMarkdownSections.length,
  studyMemories: bundledLearningMemories.length,
};
