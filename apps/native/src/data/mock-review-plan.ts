import type { NativeReviewPlan } from '../domain/teaching';

export const NATIVE_MAT136_REVIEW_PLAN_ASSISTANT_MESSAGE_ID =
  'message-mat136-review-plan-assistant-local';

export const NATIVE_MAT136_REVIEW_PLAN_PROBLEM_IDS = [
  'snapshot:cmqaq7urs00018ouch8lb2u0m',
  'snapshot:cmqaq7uty00038ouczmdns0y9',
  'snapshot:cmpwoe89700058onom0sixb14',
] as const;

export type NativeReviewPlanDay = {
  id: string;
  date: string;
  dateLabel: string;
  weekday: string;
  minutes: number;
  title: string;
  summary: string;
  reasons: string[];
  problemIds: string[];
};

export const NATIVE_MAT136_REVIEW_PLAN_DAYS: NativeReviewPlanDay[] = [
  {
    id: 'native-mat136-review-2026-07-29',
    date: '2026-07-29',
    dateLabel: '7月29日',
    weekday: '周三',
    minutes: 40,
    title: '复习黎曼和的采样点与左右端点',
    summary: '先用 15 分钟重建“分割—采样—求和”链条，再完成两道针对题。',
    reasons: [
      '7月25日的作答中，你把左端点列表写成 0.5、1、1.5、2，漏掉了 0。',
      '学习记忆将“左右端点采样混淆”标记为当前薄弱点。',
    ],
    problemIds: ['snapshot:cmqaq7urs00018ouch8lb2u0m', 'snapshot:cmqaq7uty00038ouczmdns0y9'],
  },
  {
    id: 'native-mat136-review-2026-07-30',
    date: '2026-07-30',
    dateLabel: '7月30日',
    weekday: '周四',
    minutes: 45,
    title: '复习黎曼和与定积分的转换',
    summary: '从 Δx 和采样点反推区间，再把有限和的结构翻译成定积分。',
    reasons: [
      '第一天先修正采样点，第二天再连接到定积分，避免一次处理两个缺口。',
      'MAT136 课程资料把“从黎曼和到定积分”列为下一节的必备连接。',
    ],
    problemIds: ['snapshot:cmpwoe89700058onom0sixb14'],
  },
  {
    id: 'native-mat136-review-2026-07-31',
    date: '2026-07-31',
    dateLabel: '7月31日',
    weekday: '周五',
    minutes: 25,
    title: '考前轻量回顾与错题复述',
    summary: '不再加新题；口头复述左右端点规则，并重做仍显示错误的题。',
    reasons: [
      '日历显示 7月31日 14:00 有 MAT136 阶段测验，上午只安排低负荷回顾。',
      '前两天若有错题，优先复盘错误原因，不用随机新题打乱节奏。',
    ],
    problemIds: [],
  },
];

export const NATIVE_MAT136_REVIEW_PLAN: NativeReviewPlan = {
  id: 'native-mat136-review-plan-2026-07-29',
  title: '三天复习计划',
  summary: '共 110 分钟 · 3 道针对题',
  learningGoal: '测验前修正黎曼和采样点的核心误区',
  estimatedMinutes: 110,
  gaps: ['左右端点采样仍不稳定', '黎曼和到定积分的连接需要独立验证'],
  rationale: [
    '先处理最近作答中已经出现的采样点错误，再连接到定积分。',
    '考试当天只安排低负荷回顾，避免新增认知负担。',
  ],
  evidence: [
    {
      id: 'mat136-exam-evidence',
      sourceType: 'calendar',
      sourceId: 'native-mat136-stage-exam-2026-07-31',
      title: '7月31日 14:00 阶段测验',
      excerpt: '距离测验还有三天，需要把每天的复习限制在 45 分钟内。',
      reason: '决定计划的截止时间与最后一天的负荷。',
      confidence: 1,
      occurredAt: '2026-07-31',
    },
    {
      id: 'mat136-attempt-evidence',
      sourceType: 'problem_attempt',
      sourceId: 'snapshot:cmqaq7urs00018ouch8lb2u0m',
      title: '7月25日黎曼和题答错',
      excerpt: '把左端点写成 0.5、1、1.5、2，实际使用了右端点。',
      reason: '这是当前最具体、可复现的错误证据。',
      confidence: 0.98,
      conceptTags: ['Riemann sum', 'left endpoint', 'right endpoint'],
    },
    {
      id: 'mat136-memory-evidence',
      sourceType: 'memory',
      sourceId: 'memory-mat136-riemann-sampling-local',
      title: '薄弱点：左右端点采样',
      excerpt: '理解黎曼和的整体目的，但把区间分点转换为采样点时仍不稳定。',
      reason: '用于确定第一天的复习优先级。',
      confidence: 0.9,
      conceptTags: ['Riemann sum'],
    },
  ],
  tasks: NATIVE_MAT136_REVIEW_PLAN_DAYS.map((day, index) => ({
    id: day.id,
    title: day.title,
    activity: index === 2 ? 'reflection' : index === 1 ? 'practice' : 'template_drill',
    date: day.date,
    concepts: index === 1 ? ['Riemann sum', 'definite integral'] : ['Riemann sum'],
    minutes: day.minutes,
    reason: day.summary,
    evidenceIds:
      index === 0
        ? ['mat136-attempt-evidence', 'mat136-memory-evidence']
        : index === 1
          ? ['mat136-memory-evidence']
          : ['mat136-exam-evidence'],
    problemIds: day.problemIds,
  })),
  calendarItems: NATIVE_MAT136_REVIEW_PLAN_DAYS.map((day) => ({
    id: day.id,
    title: day.title,
    date: day.date,
    durationMinutes: day.minutes,
    reason: day.summary,
  })),
  nextSteps: ['完成后根据本机真实作答状态更新薄弱点，再决定是否进入换元法。'],
};

export const NATIVE_MAT136_MOCK_EXAM = {
  id: 'native-mat136-stage-exam-2026-07-31',
  title: 'MAT136 阶段测验 · 14:00',
  date: '2026-07-31',
  note: '内置复习计划 Mock 使用的日历证据。',
} as const;
