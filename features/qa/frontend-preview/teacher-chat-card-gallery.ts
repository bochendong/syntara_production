import type { MiniLectureDeck, MiniLecturePrompt } from '@/features/learn-core/client-mini-lecture';
import type { LearnProgressProposal } from '@/features/learn-core/client-progress';
import type { PracticePlan } from '@/lib/learning/course-learner-state';
import type { LearnArtifact, LearningAction } from '@/lib/types/chat';

export const TEACHER_CHAT_CARD_GALLERY_USER_ID = 'preview-card-gallery-user';

const PRACTICE_PROBLEM_SELECTION_DECISION_ID = 'learn-practice-problem-selection';

const PREVIEW_LECTURE_IMAGE =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
      <rect width="1280" height="720" fill="#f8fafc"/>
      <rect x="48" y="48" width="1184" height="624" rx="28" fill="#e0f2fe"/>
      <text x="640" y="340" text-anchor="middle" font-size="36" fill="#0f172a" font-family="sans-serif">链表与递归 · 示意页</text>
      <text x="640" y="392" text-anchor="middle" font-size="20" fill="#334155" font-family="sans-serif">预览课堂讲解卡片，不含真实语音</text>
    </svg>`,
  );

export type TeacherChatCardGalleryMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  plan?: PracticePlan;
  progressProposal?: LearnProgressProposal;
  lecturePrompt?: MiniLecturePrompt;
  lectureDeck?: MiniLectureDeck;
  learningActions?: LearningAction[];
  artifacts?: LearnArtifact[];
  publicTrace?: Array<{
    id: string;
    title: string;
    detail: string;
    status: 'done' | 'waiting' | 'blocked';
    evidence?: string[];
  }>;
};

function galleryAction(
  action: Omit<LearningAction, 'status' | 'confirmation'> &
    Partial<Pick<LearningAction, 'status' | 'confirmation'>>,
): LearningAction {
  return {
    status: 'proposed',
    confirmation: 'required',
    ...action,
  };
}

function practicePlan(args: {
  id: string;
  courseId: string;
  courseName: string;
  mode: PracticePlan['mode'];
  title: string;
  createdAt: number;
}): PracticePlan {
  const problemIds = ['demo-csc148-problem-choice-memory', 'demo-csc148-problem-choice-tracing'];
  return {
    version: 1,
    id: args.id,
    userId: 'ui-preview-teacher',
    courseId: args.courseId,
    courseName: args.courseName,
    mode: args.mode,
    title: args.title,
    targetConcepts: ['链表', '递归', '引用'],
    problemIds,
    questions: [
      {
        problemId: problemIds[0],
        title: '对象、变量与 id()',
        href: `/course/${encodeURIComponent(args.courseId)}/problem-bank/${encodeURIComponent(problemIds[0])}`,
        reason: '先确认变量保存的是引用，不是对象本身',
        difficulty: 'easy',
        tags: ['内存模型'],
      },
      {
        problemId: problemIds[1],
        title: ' tracing 一段递归调用',
        href: `/course/${encodeURIComponent(args.courseId)}/problem-bank/${encodeURIComponent(problemIds[1])}`,
        reason: '用调用栈把递归展开，避免只背模板',
        difficulty: 'medium',
        tags: ['递归'],
      },
    ],
    estimatedMinutes: args.mode === 'quiz' ? 18 : 12,
    difficultyMix: { easy: 1, medium: 1, hard: 0 },
    createdFrom: {
      weakPoints: ['递归终止条件'],
      recentAttemptProblemIds: [],
      prompt: args.title,
    },
    status: 'active',
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
    evidence: {
      decisionId: PRACTICE_PROBLEM_SELECTION_DECISION_ID,
      rationale: [
        '最近一次练习在递归展开时漏了终止条件。',
        '题库里这两道都能直接打开，分别覆盖引用模型和调用栈。',
      ],
      gaps: ['还没有做过链表反转的综合题'],
      items: [
        {
          id: `problem-${problemIds[0]}`,
          sourceType: 'problem_bank',
          sourceId: problemIds[0],
          title: '对象、变量与 id()',
          reason: '先确认变量保存的是引用',
          excerpt: '来源：Week 1 · 标签：内存模型',
        },
        {
          id: `problem-${problemIds[1]}`,
          sourceType: 'problem_bank',
          sourceId: problemIds[1],
          title: 'tracing 一段递归调用',
          reason: '练习把递归写成调用栈',
          excerpt: '来源：Week 3 · 标签：递归',
        },
      ],
    },
  };
}

export function buildTeacherChatCardGalleryMessages(args: {
  courseId: string;
  courseName?: string;
  now?: number;
}): TeacherChatCardGalleryMessage[] {
  const courseName = args.courseName?.trim() || args.courseId;
  const now = args.now ?? Date.now();
  const t = (offset: number) => now - (9 - offset) * 60_000;
  const lecturePrompt = {
    id: 'preview-card-gallery-lecture-prompt',
    title: '递归调用栈怎么画',
    question: '怎么把一段递归函数展开成调用栈？',
    answer: '先写清每次调用的参数和返回值，再按进入、处理、返回三步往回填。',
    courseName,
    createdAt: t(5),
  } satisfies MiniLecturePrompt;

  return [
    {
      id: TEACHER_CHAT_CARD_GALLERY_USER_ID,
      role: 'user',
      text: '把这门课里所有确认卡片和动作卡片都展示一遍，方便核对 UI。',
      createdAt: t(0),
    },
    {
      id: 'preview-card-gallery-trace',
      role: 'assistant',
      text: '先看等待确认时的进度条。这条被挡住了，所以预览里也能看到。',
      createdAt: t(1),
      publicTrace: [
        {
          id: 'preview-trace-access',
          title: '已核对课程权限',
          detail: '教师预览会话可以读取笔记本和 Hard Rule。',
          status: 'done',
        },
        {
          id: 'preview-trace-blocked',
          title: '等待确认后继续',
          detail: '下面的卡片都需要你点一次确认或取消，预览模式不会写入真实数据。',
          status: 'blocked',
          evidence: ['确认卡片', '动作卡片', '产物卡片'],
        },
      ],
    },
    {
      id: 'preview-card-gallery-progress',
      role: 'assistant',
      text: '这是学习进度确认卡。',
      createdAt: t(2),
      progressProposal: {
        selection: '',
        label: '正在学习链表',
        reason: '我准备按当前笔记本继续讲解。先确认学生学到哪里，确认后才写入进度。',
        title: '确认学习进度',
        confirmLabel: '确认更新',
        writeMode: 'progress',
      },
    },
    {
      id: 'preview-card-gallery-practice',
      role: 'assistant',
      text: '这是刷题计划卡。',
      createdAt: t(3),
      plan: practicePlan({
        id: 'preview-card-gallery-practice-plan',
        courseId: args.courseId,
        courseName,
        mode: 'practice',
        title: '链表与递归巩固练习',
        createdAt: t(3),
      }),
    },
    {
      id: 'preview-card-gallery-quiz',
      role: 'assistant',
      text: '这是课程测验卡。',
      createdAt: t(4),
      plan: practicePlan({
        id: 'preview-card-gallery-quiz-plan',
        courseId: args.courseId,
        courseName,
        mode: 'quiz',
        title: 'CSC148 递归小测',
        createdAt: t(4),
      }),
    },
    {
      id: 'preview-card-gallery-lecture',
      role: 'assistant',
      text: '这是还没生成的课堂讲解邀请卡。',
      createdAt: t(5),
      lecturePrompt,
    },
    {
      id: 'preview-card-gallery-lecture-ready',
      role: 'assistant',
      text: '这是已经生成好的课堂讲解卡。',
      createdAt: t(6),
      lectureDeck: {
        id: 'preview-card-gallery-lecture-deck',
        title: '递归调用栈怎么画',
        sourceQuestion: lecturePrompt.question,
        sourceAnswer: lecturePrompt.answer,
        pages: [
          {
            id: 'preview-lecture-page-1',
            title: '递归调用栈',
            imageDataUrl: PREVIEW_LECTURE_IMAGE,
            regions: [
              {
                id: 'preview-lecture-region-1',
                label: '调用栈',
                script: '先把每次调用的参数写在一层，再看它返回什么。',
                markerColorHex: '#0ea5e9',
                bbox: [180, 160, 1100, 560],
                markerPoints: [
                  { x: 180, y: 160, corner: 'top-left' },
                  { x: 1100, y: 160, corner: 'top-right' },
                  { x: 180, y: 560, corner: 'bottom-left' },
                  { x: 1100, y: 560, corner: 'bottom-right' },
                ],
              },
            ],
            actions: [
              {
                id: 'preview-lecture-speech-1',
                type: 'speech',
                title: '开场',
                text: '先把递归看成叠盘子：进去一层，处理一层，再返回一层。',
                elementId: 'preview-lecture-region-1',
              },
            ],
          },
        ],
        markerProtocol: {
          type: 'corner-square-markers',
          markerSizePx: 24,
          markerCountPerComponent: 4,
          recoveredFrom: 'client-mini-lecture',
        },
        createdAt: t(6),
      },
    },
    {
      id: 'preview-card-gallery-actions-confirm',
      role: 'assistant',
      text: '这些是需要确认后才会执行的动作卡。',
      createdAt: t(7),
      learningActions: [
        galleryAction({
          id: 'preview-action-calendar-add',
          kind: 'calendar.propose_add',
          label: '添加复习提醒',
          summary: '周五晚上复习链表反转，预计 40 分钟。',
          payload: {
            title: '复习链表反转',
            date: '2026-09-05',
            durationMinutes: 40,
          },
        }),
        galleryAction({
          id: 'preview-action-calendar-update',
          kind: 'calendar.propose_update',
          label: '修改测验时间',
          summary: '把递归小测从周三改到周四下午。',
          payload: {
            title: '递归小测',
            date: '2026-09-04',
          },
        }),
        galleryAction({
          id: 'preview-action-calendar-delete',
          kind: 'calendar.propose_delete',
          label: '删除过期提醒',
          summary: '删除已经过期的“补交作业”提醒。',
          payload: { title: '补交作业' },
        }),
        galleryAction({
          id: 'preview-action-memory-write',
          kind: 'memory.propose_write',
          label: '记录本次学习状态',
          summary: '能画调用栈，但终止条件还容易漏。',
          payload: {
            knowledgePoint: '递归调用栈',
            masteredSignal: '能把一次递归展开成进入、处理、返回三步',
            stuckPoint: '遇到空链表时漏写终止条件',
            nextTeachingMove: '下一题专门练空链表和单节点边界',
          },
          evidence: [{ sourceType: 'notebook', title: 'Week 3 递归', reason: '课堂例题' }],
        }),
        galleryAction({
          id: 'preview-action-review-mode',
          kind: 'review_mode.request_choice',
          label: '选择复习方式',
          summary: '接下来想听讲解、直接练题，还是两个都要？',
          payload: {
            targetText: '递归终止条件',
            options: [
              { value: 'explain', label: '听讲解', followupText: '我想听讲解：递归终止条件' },
              { value: 'practice', label: '练题目', followupText: '我想练题目：递归终止条件' },
              {
                value: 'both',
                label: '讲解 + 练题',
                followupText: '我想讲解和练题都有：递归终止条件',
              },
            ],
          },
        }),
        galleryAction({
          id: 'preview-action-progress',
          kind: 'learner_progress.request_confirmation',
          label: '确认学习进度',
          summary: '把当前进度标到 Week 3 递归。',
        }),
        galleryAction({
          id: 'preview-action-practice',
          kind: 'practice.propose_generation',
          label: '从题库选题',
          summary: '按递归和引用模型再出一组练习。',
        }),
        galleryAction({
          id: 'preview-action-classroom',
          kind: 'classroom.propose_temporary_explanation',
          label: '生成临时课堂',
          summary: '把刚才的递归回答做成 1 页临时候讲解。',
        }),
        galleryAction({
          id: 'preview-action-image',
          kind: 'image.propose_generation',
          label: '生成学习图片',
          summary: '画一张递归调用栈示意图，方便对照讲解。',
          payload: { prompt: '一张简洁的递归调用栈示意图，含进入、处理和返回三层。' },
        }),
      ],
    },
    {
      id: 'preview-card-gallery-actions-view',
      role: 'assistant',
      text: '这些是查看类动作卡，点一下就会打开对应结果。',
      createdAt: t(8),
      learningActions: [
        galleryAction({
          id: 'preview-action-calendar-search',
          kind: 'calendar.search',
          label: '查看本周日程',
          summary: '列出这门课本周已安排的复习和测验。',
          confirmation: 'none',
        }),
        galleryAction({
          id: 'preview-action-calendar-start',
          kind: 'calendar.start_recent',
          label: '开始最近活动',
          summary: '从最近一条“复习链表反转”继续。',
          confirmation: 'none',
        }),
        galleryAction({
          id: 'preview-action-memory-search',
          kind: 'memory.search',
          label: '查看学习记忆',
          summary: '读取这门课里已确认的掌握点和卡点。',
          confirmation: 'none',
        }),
        galleryAction({
          id: 'preview-action-web-search',
          kind: 'web.search',
          label: '联网搜索',
          summary: '补充 Python 递归官方文档里的调用栈说明。',
          confirmation: 'none',
        }),
      ],
    },
    {
      id: 'preview-card-gallery-artifacts',
      role: 'assistant',
      text: '最后是产物卡片：日程草稿、计划、证据、图片和记忆候选。',
      createdAt: t(9),
      artifacts: [
        {
          kind: 'calendar_draft',
          id: 'preview-artifact-calendar',
          title: '本周递归复习安排',
          items: [
            {
              id: 'preview-cal-1',
              title: '画调用栈',
              date: '2026-09-04',
              durationMinutes: 25,
              reason: '先把递归展开写熟',
            },
            {
              id: 'preview-cal-2',
              title: '练终止条件',
              date: '2026-09-05',
              durationMinutes: 30,
              reason: '专门覆盖空链表',
            },
            {
              id: 'preview-cal-3',
              title: '小测回顾',
              date: '2026-09-06',
              durationMinutes: 20,
              reason: '对照错题再看一遍',
            },
          ],
        },
        {
          kind: 'activity_plan',
          id: 'preview-artifact-activity',
          title: '周末补课计划',
          planType: 'study',
          tasks: [
            { title: '重读 Week 3 递归笔记', minutes: 20, kind: 'reading' },
            { title: '手写一次链表反转', minutes: 25, kind: 'practice' },
            { title: '用自己的话讲给同学听', minutes: 15, kind: 'reflection' },
          ],
        },
        {
          kind: 'review_plan',
          id: 'preview-artifact-review',
          title: '递归复习提纲',
          learningGoal: '能独立画出调用栈，并写出空链表终止条件。',
          tasks: [
            { title: '对照例题画栈', minutes: 15, concepts: ['调用栈'] },
            { title: '改写终止条件', minutes: 15, concepts: ['边界情况'] },
          ],
          focusPoints: [
            {
              title: '终止条件',
              explanation: '空链表和单节点要先返回，再处理当前节点。',
              checkQuestion: 'head 为 None 时函数应返回什么？',
            },
          ],
          selfChecks: [
            {
              question: '递归函数至少要有哪两类情况？',
              expectedAnswer: '终止情况和递推情况',
            },
          ],
          practiceBridge: {
            title: '衔接练习',
            summary: '画完调用栈后再做 tracing 题。',
            problemIds: ['demo-csc148-problem-choice-tracing'],
          },
          nextSteps: ['确认进度', '开始今晚的 25 分钟复习'],
        },
        {
          kind: 'web_search_result',
          id: 'preview-artifact-web',
          query: 'Python recursion call stack',
          answer: '每次函数调用都会压入一帧；返回时再弹出。递归深度过大时会触发 RecursionError。',
          sources: [
            {
              title: 'Python 文档：递归限制',
              url: 'https://docs.python.org/3/library/sys.html#sys.setrecursionlimit',
            },
            {
              title: 'Python 教程：定义函数',
              url: 'https://docs.python.org/3/tutorial/controlflow.html#defining-functions',
            },
          ],
        },
        {
          kind: 'image_prompt_draft',
          id: 'preview-artifact-image',
          prompt: '一张简洁的递归调用栈示意图，三层分别写进入、处理和返回，浅色背景，无装饰人物。',
          aspectRatio: '16:9',
          sourceQuestion: '怎么把递归展开成调用栈？',
        },
        {
          kind: 'answer_evidence',
          id: 'preview-artifact-evidence',
          title: '本次回答证据',
          usedFor: '解释递归调用栈和终止条件',
          sources: [
            {
              sourceType: 'notebook',
              id: 'demo-csc148-notebook-3',
              title: 'Week 3 递归',
              previewText: '递归先处理更小的子问题，再组合当前节点。',
            },
            {
              sourceType: 'memory',
              id: 'preview-memory-1',
              title: '终止条件容易漏',
              previewText: '上次练习空链表时没有先 return。',
            },
          ],
        },
        {
          kind: 'memory_candidate',
          id: 'preview-artifact-memory',
          memoryType: 'weakness',
          summary: '递归能讲清调用栈，但空链表终止条件还不稳定。',
          evidence: [' tracing 题漏写 None 判断', '口头讲解时能说出进入和返回'],
        },
      ],
    },
  ];
}
