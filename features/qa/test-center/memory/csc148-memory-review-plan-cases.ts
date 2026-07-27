import type { MemoryReviewPlanToolId } from '@/features/qa/test-center/memory/memory-review-plan-types';

export type Csc148MemoryReviewPlanCase = {
  id: string;
  title: string;
  shortTitle: string;
  fixtureUserId: string;
  query: string;
  purpose: string;
  calendarEvent: {
    daysFromNow: number;
    title: string;
    durationMinutes: number;
  } | null;
  expectedTools: MemoryReviewPlanToolId[];
  forbiddenTools: MemoryReviewPlanToolId[];
  totalMinutes: number;
  expectedMinSessions: number;
  expectedQuestionCount: number;
};

export const CSC148_MEMORY_REVIEW_PLAN_CASES: Csc148MemoryReviewPlanCase[] = [
  {
    id: 'exam-in-three-days',
    title: '三天后考试：综合日历、错题、记忆和题库',
    shortTitle: '完整证据链与三天计划',
    fixtureUserId: 'memory-test-foundation-001',
    query:
      '我三天后有 CSC148 考试。请结合我的日历、最近做题记录、学习记忆、课程笔记和真实题库，也考虑我平时的学习时段，安排未来三天怎么复习。告诉我重点知识点、为什么复习、每天几点开始、每次多久、怎么复习以及做几道题。',
    purpose: '验证最完整的 Agent 读取计划，以及日历截止时间如何改变知识点和题量分配。',
    calendarEvent: {
      daysFromNow: 3,
      title: 'CSC148 期中考试',
      durationMinutes: 120,
    },
    expectedTools: [
      'read_user_profile',
      'read_calendar',
      'search_learning_memory',
      'search_problem_attempts',
      'search_problem_bank',
      'search_notebooks',
    ],
    forbiddenTools: [],
    totalMinutes: 180,
    expectedMinSessions: 3,
    expectedQuestionCount: 2,
  },
  {
    id: 'twenty-minute-diagnostic',
    title: '今天只有二十分钟：不制造不存在的考试',
    shortTitle: '无日历时按薄弱点诊断',
    fixtureUserId: 'memory-test-novice-001',
    query:
      '我今天只有 20 分钟。先根据我以前做题和记忆判断最薄弱的一个 CSC148 知识点，再从真实题库给我两道题。我的日历里如果没有考试，就不要假设有截止日期。',
    purpose: '验证 Agent 能在没有考试日程时跳过无意义的日历依赖，并明确证据缺口。',
    calendarEvent: null,
    expectedTools: ['search_learning_memory', 'search_problem_attempts', 'search_problem_bank'],
    forbiddenTools: ['search_notebooks'],
    totalMinutes: 20,
    expectedMinSessions: 1,
    expectedQuestionCount: 2,
  },
  {
    id: 'ri-assignment-deadline',
    title: 'RI 作业后天截止：读取课程笔记与近期错误',
    shortTitle: '课程契约影响复习方法',
    fixtureUserId: 'memory-test-intermediate-001',
    query:
      '我的 CSC148 class 作业后天截止。请重点看 Representation Invariants 的近期错误和课程笔记，再决定要复习什么、为什么、每次做几道题；计划要避开我已经掌握的基础递归。',
    purpose: '验证课程笔记 RAG 不只是补充知识，而会改变 RI review 方法和选题理由。',
    calendarEvent: {
      daysFromNow: 2,
      title: 'CSC148 Class Design 与 RI 作业截止',
      durationMinutes: 30,
    },
    expectedTools: [
      'read_calendar',
      'search_learning_memory',
      'search_problem_attempts',
      'search_problem_bank',
      'search_notebooks',
    ],
    forbiddenTools: [],
    totalMinutes: 90,
    expectedMinSessions: 2,
    expectedQuestionCount: 2,
  },
  {
    id: 'recent-attempts-only',
    title: '明确限制来源：只看近期做题记录和题库',
    shortTitle: '遵守工具读取边界',
    fixtureUserId: 'memory-test-advanced-001',
    query:
      '这次只看我最近的做题记录和 CSC148 真实题库，先不要读取日历、长期记忆或课程笔记。给我一轮 45 分钟的高强度复习，说明每道题针对哪条近期证据。',
    purpose: '验证 Agent 不会因为工具可用就全部读取，并遵守用户明确给出的数据边界。',
    calendarEvent: null,
    expectedTools: ['search_problem_attempts', 'search_problem_bank'],
    forbiddenTools: [
      'read_user_profile',
      'read_calendar',
      'search_learning_memory',
      'search_notebooks',
    ],
    totalMinutes: 45,
    expectedMinSessions: 1,
    expectedQuestionCount: 3,
  },
];

export function getCsc148MemoryReviewPlanCase(caseId: string) {
  return CSC148_MEMORY_REVIEW_PLAN_CASES.find((item) => item.id === caseId);
}
