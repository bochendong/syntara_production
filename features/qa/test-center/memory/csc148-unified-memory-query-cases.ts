import type {
  UnifiedMemoryQueryEvidence,
  UnifiedMemoryQueryIntent,
  UnifiedMemoryQueryToolId,
} from '@/features/qa/test-center/memory/unified-memory-query-types';

export type UnifiedMemoryHistoryMode = 'none' | 'sparse' | 'full';

export type Csc148UnifiedMemoryQueryCase = {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  fixtureUserId: string;
  historyMode: UnifiedMemoryHistoryMode;
  query: string;
  expectedIntents: UnifiedMemoryQueryIntent[];
  requiredTools: UnifiedMemoryQueryToolId[];
  forbiddenTools: UnifiedMemoryQueryToolId[];
  requiredCitedEvidenceSources?: UnifiedMemoryQueryEvidence['sourceType'][];
  expectedProblemIds?: string[];
  maxCitedEvidence?: number;
  requiresRawAttemptDiscovery?: boolean;
  requiresGeneratedNotebooks: boolean;
  expectedEvidenceState?: 'sufficient' | 'partial' | 'insufficient';
  expectedCalendarAction?: 'none' | 'needs_clarification' | 'ready';
  calendarSetup: Array<{
    id: string;
    title: string;
    daysFromNow: number;
    hour: number;
    minute: number;
    durationMinutes: number;
  }>;
  manualCriteria: string[];
};

export const CSC148_UNIFIED_MEMORY_QUERY_CASES: Csc148UnifiedMemoryQueryCase[] = [
  {
    id: 'no-learning-history',
    title: '无学习记忆：先承认证据不足',
    shortTitle: '无记忆，不猜学习状态',
    description: '只保留稳定个人资料，不提供历史记忆、做题、日历或笔记本。',
    fixtureUserId: 'memory-test-novice-001',
    historyMode: 'none',
    query: '我最近总觉得学得没底，你觉得我现在最该补哪一块？别给我一个听起来很像我的泛泛答案。',
    expectedIntents: ['learning_state', 'mixed'],
    requiredTools: ['read_user_profile'],
    forbiddenTools: [
      'read_calendar',
      'search_working_memory',
      'search_learning_memory',
      'search_problem_attempts',
      'search_notebooks',
    ],
    requiresGeneratedNotebooks: false,
    expectedEvidenceState: 'insufficient',
    expectedCalendarAction: 'none',
    calendarSetup: [],
    manualCriteria: [
      '没有把个人水平标签伪装成近期掌握或薄弱证据。',
      '明确说明还缺少什么观察，给出低风险的下一步诊断动作。',
      '回答中不出现内部工具、存储层、文件路径或测试 ID。',
    ],
  },
  {
    id: 'sparse-learning-history',
    title: '少量记忆：从几条近期证据归纳',
    shortTitle: '少记忆，控制结论强度',
    description: '只提供少量工作记忆、长期记忆与近期作答，检查 agent 是否谨慎归纳。',
    fixtureUserId: 'memory-test-foundation-001',
    historyMode: 'sparse',
    query:
      '我这阵子怎么老在递归题上卡住？你就结合你真正知道的情况告诉我卡在哪，别把一次失误说成长期问题。',
    expectedIntents: ['learning_state', 'mixed'],
    requiredTools: ['search_working_memory', 'search_learning_memory', 'search_problem_attempts'],
    forbiddenTools: ['read_calendar', 'search_problem_bank'],
    requiredCitedEvidenceSources: ['working_memory', 'learning_memory', 'attempt'],
    requiresGeneratedNotebooks: false,
    expectedEvidenceState: 'partial',
    expectedCalendarAction: 'none',
    calendarSetup: [],
    manualCriteria: [
      '区分单次作答、当前工作状态和较稳定的长期模式。',
      '结论范围与少量证据相称，不使用“总是”“已经掌握”等过强措辞。',
      '下一教学动作能对应实际错误，而不是固定套话。',
    ],
  },
  {
    id: 'raw-attempt-discovery',
    title: '原始作答：由 Agent 自己发现',
    shortTitle: '只给原始答案，自己归纳',
    description: '不提供工作记忆或长期诊断，只给近期原始答案和判分结果。',
    fixtureUserId: 'memory-test-foundation-001',
    historyMode: 'sparse',
    query: '只看我最近几次实际怎么答的，你觉得我在递归树题里到底卡在哪？别把两次表现说成长期能力。',
    expectedIntents: ['learning_state', 'mixed'],
    requiredTools: ['search_problem_attempts'],
    forbiddenTools: [
      'read_user_profile',
      'read_calendar',
      'search_working_memory',
      'search_learning_memory',
      'search_notebooks',
      'search_problem_bank',
    ],
    requiredCitedEvidenceSources: ['attempt'],
    requiresRawAttemptDiscovery: true,
    requiresGeneratedNotebooks: false,
    expectedEvidenceState: 'partial',
    expectedCalendarAction: 'none',
    calendarSetup: [],
    manualCriteria: [
      '根据原始代码自行发现：虽然写了 base case，但递归调用仍传入原树，问题规模没有缩小。',
      '没有声称读取到既有薄弱点、长期诊断或连续历史记忆。',
      '明确把结论限制在这两次原始作答，并给出能直接检查递归参数的下一步。',
    ],
  },
  {
    id: 'rich-learning-history',
    title: '大量记忆：在噪声中找当前重点',
    shortTitle: '多记忆，不做全量堆砌',
    description: '提供重度用户的完整长期记忆与作答历史，检查相关性和新旧证据优先级。',
    fixtureUserId: 'memory-test-advanced-001',
    historyMode: 'full',
    query:
      '我一路学下来内容挺多的。现在如果只看最值得继续打磨的地方，哪两个点最关键？要分清已经稳定的能力和仍缺证据的边界。',
    expectedIntents: ['learning_state', 'mixed'],
    requiredTools: ['search_working_memory', 'search_learning_memory', 'search_problem_attempts'],
    forbiddenTools: [
      'read_user_profile',
      'read_calendar',
      'search_notebooks',
      'search_problem_bank',
    ],
    requiredCitedEvidenceSources: ['working_memory', 'learning_memory', 'attempt'],
    maxCitedEvidence: 6,
    requiresGeneratedNotebooks: false,
    expectedEvidenceState: 'sufficient',
    expectedCalendarAction: 'none',
    calendarSetup: [],
    manualCriteria: [
      '没有把 42 条长期记忆和 168 次作答逐条塞进回答。',
      '近期、直接、可判分的证据优先于陈旧文本。',
      '已掌握与待验证边界都能回到真实证据。',
    ],
  },
  {
    id: 'implicit-profile-concept',
    title: '隐式个人化：按习惯讲 RI',
    shortTitle: '不说资料，也能个人化',
    description: '用户只说“还是按我习惯的方式”，由 agent 自行决定是否读取个人资料和课程知识。',
    fixtureUserId: 'memory-test-intermediate-001',
    historyMode: 'full',
    query:
      'RI 我还是有点绕。还是按我平时比较听得进去的方式讲，让我能判断一个 public method 有没有把对象状态搞坏。',
    expectedIntents: ['concept_explanation', 'mixed'],
    requiredTools: ['read_user_profile', 'search_notebooks'],
    forbiddenTools: [
      'read_calendar',
      'search_working_memory',
      'search_learning_memory',
      'search_problem_attempts',
      'search_problem_bank',
    ],
    requiredCitedEvidenceSources: ['profile', 'notebook'],
    requiresGeneratedNotebooks: true,
    expectedEvidenceState: 'sufficient',
    expectedCalendarAction: 'none',
    calendarSetup: [],
    manualCriteria: [
      '先用反例和代码追踪，再落到 RI 定义，符合已有讲解偏好。',
      '说明 constructor 建立 RI、public method 返回前恢复 RI。',
      '自然使用个人化结果，不对用户复述“我读取了你的个人资料”。',
    ],
  },
  {
    id: 'concept-smaller-subproblem',
    title: '知识点提问：递归为什么必须缩小',
    shortTitle: '自然追问，召回课程知识',
    description: '问题不说笔记本或记忆路径，只描述已有理解和真正卡点。',
    fixtureUserId: 'memory-test-foundation-001',
    historyMode: 'full',
    query:
      '我知道递归要有 base case，可我还是不明白：函数里明明写了空树就 return，为什么 recursive call 传回原来的 tree 还是一定会出问题？',
    expectedIntents: ['concept_explanation', 'mixed'],
    requiredTools: ['search_notebooks'],
    forbiddenTools: [
      'read_user_profile',
      'read_calendar',
      'search_working_memory',
      'search_learning_memory',
      'search_problem_attempts',
      'search_problem_bank',
    ],
    requiredCitedEvidenceSources: ['notebook'],
    requiresGeneratedNotebooks: true,
    expectedEvidenceState: 'sufficient',
    expectedCalendarAction: 'none',
    calendarSetup: [],
    manualCriteria: [
      '解释“存在 base case”与“调用链能到达 base case”的区别。',
      '使用严格更小的 subtree 或规模函数给出可检查的解释。',
      '不会为了个人化而注入无关课程记忆。',
    ],
  },
  {
    id: 'problem-private-attribute',
    title: '题目讲解：识别真实题面并教学',
    shortTitle: '贴题面，不说题库路径',
    description: '用户粘贴真实题库问题并暴露部分理解，由 agent 判断是否需要题目和课程依据。',
    fixtureUserId: 'memory-test-novice-001',
    historyMode: 'sparse',
    query:
      '这题我知道大概和封装有关，但不知道要答到哪一层：“为什么在类中使用私有属性（如 __password）？” 你别只给结论，按批题的方式讲清楚。',
    expectedIntents: ['problem_explanation', 'mixed'],
    requiredTools: ['search_problem_bank', 'search_notebooks'],
    forbiddenTools: [
      'read_user_profile',
      'read_calendar',
      'search_working_memory',
      'search_learning_memory',
      'search_problem_attempts',
    ],
    requiredCitedEvidenceSources: ['problem', 'notebook'],
    expectedProblemIds: ['notebook_499'],
    requiresGeneratedNotebooks: true,
    expectedEvidenceState: 'sufficient',
    expectedCalendarAction: 'none',
    calendarSetup: [],
    manualCriteria: [
      '命中 CSC148 真实题目，而不是生成一条长得相似的假题。',
      '先指出题目在考什么，再给答题层次、反例和自检。',
      '能利用用户已经知道“封装”这一点，避免从零重复。',
    ],
  },
  {
    id: 'mixed-exam-recall',
    title: '整体召回：小测前的个人化复习',
    shortTitle: '一次自然请求，综合全部来源',
    description:
      '不点名任何数据路径，让统一 agent 自行组合个人习惯、日程、学习状态、课程知识与题目。',
    fixtureUserId: 'memory-test-intermediate-001',
    historyMode: 'full',
    query:
      '后天那个 CSC148 小测之前，我今晚和明晚该怎么准备？最近 class 和树的题让我不太放心，按我平时能坚持的节奏安排，也给我两道真正对症的题。',
    expectedIntents: ['mixed'],
    requiredTools: [
      'read_user_profile',
      'read_calendar',
      'search_working_memory',
      'search_learning_memory',
      'search_problem_attempts',
      'search_notebooks',
      'search_problem_bank',
    ],
    forbiddenTools: [],
    requiredCitedEvidenceSources: [
      'profile',
      'schedule',
      'working_memory',
      'learning_memory',
      'attempt',
      'notebook',
      'problem',
    ],
    maxCitedEvidence: 12,
    requiresGeneratedNotebooks: true,
    expectedEvidenceState: 'sufficient',
    expectedCalendarAction: 'none',
    calendarSetup: [
      {
        id: 'csc148-quiz',
        title: 'CSC148 Class 与 Tree 小测',
        daysFromNow: 2,
        hour: 10,
        minute: 0,
        durationMinutes: 60,
      },
    ],
    manualCriteria: [
      '计划同时受小测时间、个人节奏和真实学习证据影响。',
      '两道题来自真实 CSC148 题库，且各自说明针对的薄弱证据。',
      '用户回复不罗列内部来源路径，只呈现综合后的判断与动作。',
    ],
  },
  {
    id: 'calendar-update-natural-reference',
    title: '日历修改：理解相对指代',
    shortTitle: '把那场复习挪到后天',
    description: '用户不提供 eventId，只通过日期、时间和主题自然指代唯一日程。',
    fixtureUserId: 'memory-test-foundation-001',
    historyMode: 'sparse',
    query: '明天晚上八点那场递归复习我赶不上。确认帮我挪到后天晚上九点，仍然 30 分钟。',
    expectedIntents: ['calendar_update', 'mixed'],
    requiredTools: ['read_calendar'],
    forbiddenTools: [
      'read_user_profile',
      'search_working_memory',
      'search_learning_memory',
      'search_problem_attempts',
      'search_notebooks',
      'search_problem_bank',
    ],
    requiredCitedEvidenceSources: ['schedule'],
    requiresGeneratedNotebooks: false,
    expectedEvidenceState: 'sufficient',
    expectedCalendarAction: 'ready',
    calendarSetup: [
      {
        id: 'recursive-review',
        title: '递归专项复习',
        daysFromNow: 1,
        hour: 20,
        minute: 0,
        durationMinutes: 30,
      },
    ],
    manualCriteria: [
      '只修改唯一匹配的事件，不要求用户提供内部 ID。',
      '修改后日期、21:00、30 分钟和时区都正确。',
      '事件账本保留修改前后的精确值。',
    ],
  },
  {
    id: 'calendar-update-ambiguous',
    title: '日历歧义：不擅自修改',
    shortTitle: '两场复习，先问清楚',
    description: '同一天有两场复习，用户的自然指代不足以唯一定位。',
    fixtureUserId: 'memory-test-foundation-001',
    historyMode: 'sparse',
    query: '把明天那场复习往后挪一个小时。',
    expectedIntents: ['calendar_update', 'mixed'],
    requiredTools: ['read_calendar'],
    forbiddenTools: [
      'read_user_profile',
      'search_working_memory',
      'search_learning_memory',
      'search_problem_attempts',
      'search_notebooks',
      'search_problem_bank',
    ],
    requiredCitedEvidenceSources: ['schedule'],
    requiresGeneratedNotebooks: false,
    expectedEvidenceState: 'partial',
    expectedCalendarAction: 'needs_clarification',
    calendarSetup: [
      {
        id: 'recursive-review-morning',
        title: '递归错题复习',
        daysFromNow: 1,
        hour: 10,
        minute: 0,
        durationMinutes: 30,
      },
      {
        id: 'ri-review-evening',
        title: 'RI 代码复习',
        daysFromNow: 1,
        hour: 20,
        minute: 0,
        durationMinutes: 30,
      },
    ],
    manualCriteria: [
      '识别到两个候选事件，没有任选一个写入。',
      '追问包含足以让用户区分事件的自然信息。',
      '运行前后日历事实与事件账本均无修改。',
    ],
  },
];

export function getCsc148UnifiedMemoryQueryCase(caseId: string) {
  return CSC148_UNIFIED_MEMORY_QUERY_CASES.find((item) => item.id === caseId);
}
