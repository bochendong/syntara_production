import { simulateReadableStream } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { runTeacherCourseTurn } from '@/features/chat/server/teacher-course-agent';
import {
  resolveTrustedCourseTurn,
  TrustedCourseTurnError,
  type TrustedCourseAccess,
} from '@/features/chat/server/trusted-course-turn';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import { normalizeModelMessageInlineImages } from '@/lib/orchestration/model-image-content';
import type { StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';

// This is a model/permission contract harness, never a live database test.
process.env.DATABASE_URL = 'postgresql://test@127.0.0.1/teacher_agent_contract_test';
globalThis.__synatraPrismaUrl__ = process.env.DATABASE_URL;
globalThis.__synatraPrisma__ = {
  account: { findFirst: async () => null },
} as unknown as PrismaClient;

const courseId = process.argv[2] || 'local-csc108-2026-summer';
const ownerId = process.argv[3] || 'local-teacher-ada';
const inlineImageDataUrl = `data:image/png;base64,${Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]).toString('base64')}`;

const normalizedAttachmentMessages = normalizeModelMessageInlineImages([
  {
    role: 'user',
    content: [
      {
        type: 'file',
        data: inlineImageDataUrl,
        mediaType: 'image/png',
        filename: 'question.png',
      },
      {
        type: 'file',
        data: 'file-pdf-test',
        mediaType: 'application/pdf',
        filename: 'notes.pdf',
      },
    ],
  },
]);
const normalizedAttachmentContent = normalizedAttachmentMessages[0]?.content;
if (typeof normalizedAttachmentContent === 'string' || !normalizedAttachmentContent) {
  throw new Error('Attachment normalization did not retain user content');
}
const normalizedImage = normalizedAttachmentContent[0];
const retainedPdf = normalizedAttachmentContent[1];
if (normalizedImage?.type !== 'image' || !(normalizedImage.image instanceof Uint8Array)) {
  throw new Error('Inline image data URL was not converted to image bytes');
}
if (retainedPdf?.type !== 'file' || retainedPdf.data !== 'file-pdf-test') {
  throw new Error('Non-image file attachment was unexpectedly changed');
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

let modelCall = 0;
const model = new MockLanguageModelV3({
  doStream: async () => {
    modelCall += 1;
    if (modelCall === 1) {
      return {
        stream: simulateReadableStream({
          chunks: [
            {
              type: 'tool-call' as const,
              toolCallId: 'tool-search-notebooks',
              toolName: 'search_course_notebooks',
              input: '{"query":"Python 变量","maxResults":3}',
            },
            {
              type: 'finish' as const,
              finishReason: { unified: 'tool-calls' as const, raw: undefined },
              usage,
            },
          ],
        }),
      };
    }
    if (modelCall === 2) {
      return {
        stream: simulateReadableStream({
          chunks: [
            {
              type: 'tool-call' as const,
              toolCallId: 'tool-read-notebook-detail',
              toolName: 'search_course_notebooks',
              input:
                '{"query":"Python 变量","notebookId":"nb-python","detail":"full","maxResults":3}',
            },
            {
              type: 'finish' as const,
              finishReason: { unified: 'tool-calls' as const, raw: undefined },
              usage,
            },
          ],
        }),
      };
    }
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start' as const, id: 'teacher-answer' },
          {
            type: 'text-delta' as const,
            id: 'teacher-answer',
            delta: '已根据持久化笔记本目录完成核对。',
          },
          { type: 'text-end' as const, id: 'teacher-answer' },
          {
            type: 'finish' as const,
            finishReason: { unified: 'stop' as const, raw: undefined },
            usage,
          },
        ],
      }),
    };
  },
});

const access: TrustedCourseAccess = {
  userId: ownerId,
  role: 'owner',
  course: {
    id: courseId,
    ownerId,
    name: 'CSC108',
    description: 'Introduction to Computer Programming',
    language: 'zh-CN',
    purpose: 'university',
    tags: ['python'],
    university: 'University of Toronto',
    courseCode: 'CSC108',
    notebookCount: 2,
    problemCount: 0,
  },
};

const fakeDb = {
  studyMemory: { findMany: async () => [] },
  notebook: {
    findMany: async () => [
      {
        id: 'nb-python',
        name: 'Python 基础讲义',
        description: '变量、条件、循环与函数',
        notebookKind: 'markdown',
        tags: ['local-school'],
        sectionCount: 2,
        sceneCount: 0,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-02T00:00:00.000Z'),
        _count: { markdownSections: 2, pages: 0, scenes: 0 },
      },
      {
        id: 'nb-syllabus',
        name: 'CSC108 课程大纲',
        description: '课程安排与评分规则',
        notebookKind: 'markdown',
        tags: ['local-school'],
        sectionCount: 1,
        sceneCount: 0,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        _count: { markdownSections: 1, pages: 0, scenes: 0 },
      },
    ],
  },
  courseEnrollment: { count: async () => 2 },
  courseHardRule: {
    findMany: async () => [{ id: 'rule-1', content: '回答必须引用课程笔记本。' }],
  },
  markdownNotebookSection: {
    findMany: async (query: { where?: { notebookId?: string } }) =>
      query.where?.notebookId === 'nb-python'
        ? [
            {
              id: 'section-variables',
              notebookId: 'nb-python',
              title: '变量与基础类型',
              order: 0,
              summary: '介绍 Python 变量、整数、浮点数和字符串。',
              markdown: '# 变量与基础类型\n变量用于保存值，例如 age = 18。',
            },
            {
              id: 'section-control',
              notebookId: 'nb-python',
              title: '条件控制',
              order: 1,
              summary: '介绍 if、elif 和 else。',
              markdown: '# 条件控制\n使用 if 根据布尔条件选择执行路径。',
            },
          ]
        : [
            {
              id: 'section-variables',
              notebookId: 'nb-python',
              title: '变量与基础类型',
              order: 0,
              summary: '介绍 Python 变量、整数、浮点数和字符串。',
              markdown: '# 变量与基础类型\n变量用于保存值，例如 age = 18。',
            },
            {
              id: 'section-syllabus',
              notebookId: 'nb-syllabus',
              title: '课程安排',
              order: 0,
              summary: 'CSC108 课程安排。',
              markdown: '# 课程安排\n本课程介绍 Python 编程基础。',
            },
          ],
  },
  notebookPage: { findMany: async () => [] },
  scene: { findMany: async () => [] },
} as unknown as PrismaClient;

const body: StatelessChatRequest = {
  messages: [
    {
      id: 'teacher-agent-smoke-user',
      role: 'user',
      parts: [
        {
          type: 'file',
          mediaType: 'image/png',
          filename: 'question.png',
          url: inlineImageDataUrl,
        },
        { type: 'text', text: '这门课有几个笔记本？' },
      ],
    },
  ],
  storeState: {
    stage: null,
    scenes: [],
    currentSceneId: null,
    mode: 'playback',
    whiteboardOpen: false,
  },
  config: {
    agentIds: ['teacher-course-agent'],
    sessionType: 'qa',
    surface: 'teacher-course-chat',
  },
  courseContext: {
    course: { id: courseId, name: access.course.name },
    target: {
      kind: 'orchestrator',
      id: 'teacher-course-agent',
      name: '课程助理',
      role: 'teacher',
    },
    notebooks: [],
  },
  apiKey: '',
};

const trusted = await resolveTrustedCourseTurn({
  body,
  authenticatedUserId: ownerId,
  trustedAccess: access,
});
if (trusted.courseAccess?.role !== 'owner') throw new Error('Teacher owner trust was not retained');
let enrolledRejected = false;
try {
  await resolveTrustedCourseTurn({
    body,
    authenticatedUserId: 'local-student-alex',
    trustedAccess: { ...access, userId: 'local-student-alex', role: 'enrolled' },
  });
} catch (error) {
  enrolledRejected = error instanceof TrustedCourseTurnError && error.status === 403;
}
if (!enrolledRejected) throw new Error('Enrolled user was not rejected from teacher course chat');

const events: StatelessEvent[] = [];
await runTeacherCourseTurn({
  body: trusted.body,
  signal: new AbortController().signal,
  languageModel: model,
  access,
  db: fakeDb,
  onEvent: (event) => {
    events.push(event);
  },
});

const eventTypes = events.map((event) => event.type);
for (const requiredType of ['agent_start', 'public_progress', 'text_delta', 'agent_end', 'done']) {
  if (!eventTypes.includes(requiredType as StatelessEvent['type'])) {
    throw new Error(`Missing ${requiredType} event`);
  }
}
if (model.doStreamCalls.length !== 3) {
  throw new Error(`Expected three model steps, received ${model.doStreamCalls.length}`);
}
const firstCall = model.doStreamCalls[0];
const firstUserPrompt = firstCall.prompt.find((message) => message.role === 'user');
const firstPromptImage = firstUserPrompt?.content.find(
  (part) => part.type === 'file' && part.mediaType === 'image/png',
);
if (firstPromptImage?.type !== 'file' || !(firstPromptImage.data instanceof Uint8Array)) {
  throw new Error('Teacher ToolLoopAgent did not receive inline image bytes');
}
const toolNames = (firstCall.tools || []).map((entry) => entry.name).sort();
const expectedToolNames = [
  'get_course_learning_insight',
  'list_calendar_events',
  'list_course_notebooks',
  'read_selected_context',
  'recall_conversation',
  'search_course_problem_bank',
  'search_course_notebooks',
  'web_search',
].sort();
if (JSON.stringify(toolNames) !== JSON.stringify(expectedToolNames)) {
  throw new Error(`Unexpected teacher tools: ${toolNames.join(', ')}`);
}
const promptText = JSON.stringify(firstCall.prompt);
if (!promptText.includes('Hard Rules') || !promptText.includes('回答必须引用课程笔记本')) {
  throw new Error('Hard Rule instructions were not injected');
}
if (
  /propose_calendar_change|record_my_learning_signal|memory\.propose_write/.test(
    toolNames.join(' '),
  )
) {
  throw new Error('A mutation-capable student-side tool leaked into the teacher agent');
}
const inventoryProgress = events.find(
  (event): event is Extract<StatelessEvent, { type: 'public_progress' }> =>
    event.type === 'public_progress' &&
    event.data.steps.some((step) => step.id === 'teacher-rules' && step.status === 'complete'),
);
if (!inventoryProgress) throw new Error('Inventory progress was not emitted');

const inventoryStep = inventoryProgress.data.steps.find((step) => step.id === 'teacher-inventory');
const rulesStep = inventoryProgress.data.steps.find((step) => step.id === 'teacher-rules');
const answer = events
  .filter(
    (event): event is Extract<StatelessEvent, { type: 'text_delta' }> =>
      event.type === 'text_delta',
  )
  .map((event) => event.data.content)
  .join('');

console.log(
  JSON.stringify(
    {
      ok: true,
      courseId,
      ownerVerified: trusted.courseAccess.role === 'owner',
      enrolledRejected,
      modelSteps: model.doStreamCalls.length,
      tools: toolNames,
      inventory: inventoryStep?.description,
      rules: rulesStep?.description,
      answer,
      eventTypes,
    },
    null,
    2,
  ),
);

// A page-bound submission must be available before the very first model call.
let directCalls = 0;
const directModel = new MockLanguageModelV3({
  doStream: async (call) => {
    directCalls += 1;
    const prompt = JSON.stringify(call.prompt);
    if (!prompt.includes('student_original_answer_42') || !prompt.includes('原始批改反馈_42')) {
      throw new Error('Exact submission evidence was absent from the first prompt');
    }
    if (call.toolChoice?.type === 'required')
      throw new Error('Prepared page context still forced a tool round');
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start' as const, id: 'direct-answer' },
          { type: 'text-delta' as const, id: 'direct-answer', delta: '原始作答与批改反馈已核对。' },
          { type: 'text-end' as const, id: 'direct-answer' },
          {
            type: 'finish' as const,
            finishReason: { unified: 'stop' as const, raw: undefined },
            usage,
          },
        ],
      }),
    };
  },
});
await runTeacherCourseTurn({
  body: {
    ...trusted.body,
    contextSelection: {
      source: 'problem-attempt',
      studentId: 'student-exact',
      attemptId: 'attempt-exact',
    },
  },
  signal: new AbortController().signal,
  languageModel: directModel,
  access,
  db: {
    ...fakeDb,
    courseEnrollment: {
      count: async () => 2,
      findUnique: async () => ({ userId: 'student-exact', user: { isActive: true, name: '小林' } }),
    },
    notebookProblemAttempt: {
      findFirst: async () => ({
        id: 'attempt-exact',
        problemId: 'problem-exact',
        answerJson: { text: 'student_original_answer_42' },
        resultJson: { feedback: '原始批改反馈_42' },
        status: 'failed',
        score: 0,
        activeDurationMs: 30000,
        createdAt: new Date(),
        problem: {
          title: '测试题目',
          notebookId: 'nb-python',
          publicContentJson: { stem: '测试题面' },
        },
      }),
    },
    notebookProblem: { findFirst: async () => ({ id: 'problem-exact' }) },
  } as unknown as PrismaClient,
  onEvent: async () => {},
});
if (directCalls !== 1) throw new Error('Page-bound answer should require one model call');
console.log('PASS: exact attempt is present before a single direct answer call.');
