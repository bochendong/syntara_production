export type StructuredMemoryOperation =
  | 'write_calendar'
  | 'write_learning_memory'
  | 'write_preference'
  | 'update_calendar'
  | 'skip';

export type StructuredMemoryCalendarEvent = {
  id: string;
  title: string;
  startsAt: string;
  durationMinutes: number;
  timezone: string;
  status: 'confirmed';
};

export type StructuredLearningMemory = {
  key: string;
  title: string;
  mastery: string | null;
  weakness: string | null;
  cause: string | null;
  nextTeachingMove: string | null;
  scope: 'course';
};

export type StructuredUserPreference = {
  key: string;
  label: string;
  value: string;
  reason: string;
};

export type StructuredMemoryState = {
  user: {
    id: string;
    displayName: string;
    courseCode: string;
    timezone: string;
    profileSummary: string;
  };
  calendarEvents: StructuredMemoryCalendarEvent[];
  learningMemories: StructuredLearningMemory[];
  preferences: StructuredUserPreference[];
};

export type StructuredMemoryExtractionDecision = {
  decision: StructuredMemoryOperation;
  reasonToStore: string;
  evidenceQuote: string;
  confidence: 'low' | 'medium' | 'high';
  normalizationNote: string;
  calendar: {
    eventId: string;
    title: string;
    startsAt: string;
    durationMinutes: number;
    timezone: string;
  } | null;
  learningMemory: {
    memoryKey: string;
    title: string;
    mastery: string | null;
    weakness: string | null;
    cause: string | null;
    nextTeachingMove: string | null;
  } | null;
  preference: {
    preferenceKey: string;
    label: string;
    value: string;
    conclusionLanguage: string | null;
    explanationLanguage: string | null;
    reason: string;
  } | null;
};

export type StructuredMemoryChange = {
  layer: 'calendar' | 'learning_memory' | 'preference' | 'none';
  targetKey: string | null;
  mode: 'created' | 'superseded' | 'skipped';
  before: unknown;
  after: unknown;
  warning: string | null;
};

export type StructuredMemoryCaseCheck = {
  id: 'decision' | 'target' | 'evidence' | 'state_change' | 'content';
  label: string;
  passed: boolean;
  detail: string;
};

export type StructuredMemoryCaseResponse = {
  action: 'extract_structured_memory';
  caseId: string;
  model: string;
  promptVersion: string;
  extraction: StructuredMemoryExtractionDecision;
  before: StructuredMemoryState;
  after: StructuredMemoryState;
  change: StructuredMemoryChange;
  checks: StructuredMemoryCaseCheck[];
  passed: boolean;
  usage: unknown;
  persistence: 'none';
};

type ExpectedStructuredMemoryMutation = {
  decision: Exclude<StructuredMemoryOperation, 'skip'>;
  targetKey: string;
  expectedText: string[];
  calendar?: StructuredMemoryCalendarEvent;
  learningMemory?: StructuredLearningMemory;
  preference?: StructuredUserPreference;
};

export type StructuredMemoryFactCase = {
  id: string;
  order: number;
  userNumber: 1 | 2;
  operation: Exclude<StructuredMemoryOperation, 'skip'>;
  operationLabel: string;
  title: string;
  scenario: string;
  whyStore: string;
  extractionGoal: string;
  userMessage: string;
  before: StructuredMemoryState;
  expected: ExpectedStructuredMemoryMutation;
  manualCriteria: string[];
};

const USER_ONE = {
  id: 'memory-fact-user-one',
  displayName: '周小满',
  courseCode: 'CSC148',
  timezone: 'Asia/Shanghai',
  profileSummary: '刚开始系统学习树与递归；日程较碎，讲解需要先建立可见的调用过程。',
} as const;

const USER_TWO = {
  id: 'memory-fact-user-two',
  displayName: '顾言川',
  courseCode: 'CSC148',
  timezone: 'America/Toronto',
  profileSummary: '高频学习者；已能完成主要实现，当前重点是证明、反例与复杂度取舍。',
} as const;

const USER_ONE_BASE: StructuredMemoryState = {
  user: USER_ONE,
  calendarEvents: [
    {
      id: 'lab-2-deadline',
      title: 'CSC148 Lab 2 截止',
      startsAt: '2026-07-23T23:59:00+08:00',
      durationMinutes: 1,
      timezone: USER_ONE.timezone,
      status: 'confirmed',
    },
  ],
  learningMemories: [
    {
      key: 'recursion-base-case',
      title: '递归终止条件仍不稳定',
      mastery: '能在单分支递归里找到明显的 base case。',
      weakness: '树递归出现多个分支时容易漏掉空子树。',
      cause: '把终止条件当成固定模板，没有先判断当前子问题的最小形态。',
      nextTeachingMove: '先画空树、叶节点和三节点树，再写代码。',
      scope: 'course',
    },
  ],
  preferences: [
    {
      key: 'study_session_length',
      label: '单次学习时长',
      value: '25 分钟左右',
      reason: '较短时段更容易保持专注。',
    },
  ],
};

const USER_TWO_BASE: StructuredMemoryState = {
  user: USER_TWO,
  calendarEvents: [
    {
      id: 'research-seminar',
      title: '算法研究会',
      startsAt: '2026-07-26T13:00:00-04:00',
      durationMinutes: 90,
      timezone: USER_TWO.timezone,
      status: 'confirmed',
    },
  ],
  learningMemories: [
    {
      key: 'representation-invariant',
      title: '能维护 Representation Invariant',
      mastery: '能在 mutation 前后检查对象状态是否合法。',
      weakness: null,
      cause: null,
      nextTeachingMove: '进入更复杂的正确性证明与反例设计。',
      scope: 'course',
    },
  ],
  preferences: [
    {
      key: 'answer_density',
      label: '回答密度',
      value: '直接给结论与关键取舍，不重复基础语法。',
      reason: '用户已经能独立阅读实现代码。',
    },
  ],
};

function cloneState(state: StructuredMemoryState): StructuredMemoryState {
  return JSON.parse(JSON.stringify(state)) as StructuredMemoryState;
}

function stateWithCalendar(
  state: StructuredMemoryState,
  event: StructuredMemoryCalendarEvent,
): StructuredMemoryState {
  const next = cloneState(state);
  next.calendarEvents = [...next.calendarEvents.filter((item) => item.id !== event.id), event];
  return next;
}

const USER_ONE_CALENDAR = {
  id: 'bst-deletion-review',
  title: 'BST deletion 复习',
  startsAt: '2026-07-22T19:30:00+08:00',
  durationMinutes: 40,
  timezone: USER_ONE.timezone,
  status: 'confirmed',
} satisfies StructuredMemoryCalendarEvent;

const USER_TWO_CALENDAR = {
  id: 'amortized-analysis-practice',
  title: 'Amortized analysis 集中练习',
  startsAt: '2026-07-26T10:00:00-04:00',
  durationMinutes: 60,
  timezone: USER_TWO.timezone,
  status: 'confirmed',
} satisfies StructuredMemoryCalendarEvent;

export const STRUCTURED_MEMORY_FACT_CASES: StructuredMemoryFactCase[] = [
  {
    id: 'user-one-write-calendar',
    order: 1,
    userNumber: 1,
    operation: 'write_calendar',
    operationLabel: '写入日历',
    title: '从学习安排中识别新日程',
    scenario: '用户没有说“加入日历”，只是在讨论 Lab 截止前怎么留出一块复习时间。',
    whyStore:
      '这是一项带明确日期、开始时间、时长和学习目标的未来承诺。存成日历后，后续计划才能避开截止时间并按时提醒。',
    extractionGoal:
      '识别为新的 confirmed 日历事项，规范化“周三”为绝对日期，并保留 BST deletion 与 40 分钟约束。',
    userMessage:
      'Lab 2 截止前我想留一块完整时间。周三吃完饭大概七点半，你带我把 BST deletion 过一遍吧，四十分钟就行。',
    before: cloneState(USER_ONE_BASE),
    expected: {
      decision: 'write_calendar',
      targetKey: USER_ONE_CALENDAR.id,
      expectedText: ['BST', 'deletion'],
      calendar: USER_ONE_CALENDAR,
    },
    manualCriteria: [
      '不要求用户显式说“加入日历”',
      '把相对日期规范化为用户时区下的绝对时间',
      '不会把 Lab 截止事项错误覆盖掉',
    ],
  },
  {
    id: 'user-one-write-memory',
    order: 2,
    userNumber: 1,
    operation: 'write_learning_memory',
    operationLabel: '写入记忆',
    title: '从卡点描述中提取下一教学动作',
    scenario: '用户在复盘刚才为什么跟不上，没有使用“记住我”或任何记忆术语。',
    whyStore:
      '这段话同时暴露了稳定薄弱点、发生原因和有效的下一教学方式，能直接改变下次怎么教，而不是只保存聊天原文。',
    extractionGoal:
      '新增一条课程学习记忆，写清楚多分支返回值合并的薄弱点、原因，以及先画三层调用再进入代码的教学动作。',
    userMessage:
      '我一到递归里同时走左右两边就会乱，尤其不知道返回值到底什么时候合起来。下次别直接上代码，先给我画三层调用，我会更容易跟上。',
    before: cloneState(USER_ONE_BASE),
    expected: {
      decision: 'write_learning_memory',
      targetKey: 'tree-recursion-return-merge',
      expectedText: ['左右', '返回值', '三层调用'],
      learningMemory: {
        key: 'tree-recursion-return-merge',
        title: '树递归的多分支返回值合并',
        mastery: null,
        weakness: '同时递归左右子树时，不清楚返回值在何时、如何合并。',
        cause: '还没有形成多分支调用展开与回收顺序的可视模型。',
        nextTeachingMove: '先画三层调用与返回箭头，再进入代码。',
        scope: 'course',
      },
    },
    manualCriteria: [
      '不把用户整句话直接复制成记忆',
      '同时保留薄弱点、原因和下一教学动作',
      '不会覆盖已有的 base case 记忆',
    ],
  },
  {
    id: 'user-one-write-preference',
    order: 3,
    userNumber: 1,
    operation: 'write_preference',
    operationLabel: '写入偏好',
    title: '从反馈中识别讲解顺序偏好',
    scenario: '用户是在评价讲法，并没有打开设置页或说“修改我的偏好”。',
    whyStore:
      '这是跨多个知识点都能复用的讲解偏好。存为精确偏好后，后续回答可以稳定采用用户更容易理解的顺序。',
    extractionGoal:
      '新增 explanation_sequence 偏好，明确中文讲解和“具体例子 → 定义 → 代码”的顺序。',
    userMessage:
      '如果后面还要讲 BST，先拿一棵具体的树走一遍吧。一上来就是定义我会看不进去，中文讲清楚以后再看代码就好。',
    before: cloneState(USER_ONE_BASE),
    expected: {
      decision: 'write_preference',
      targetKey: 'explanation_sequence',
      expectedText: ['中文', '例子', '定义', '代码'],
      preference: {
        key: 'explanation_sequence',
        label: '讲解顺序与语言',
        value: '中文；具体例子 → 定义 → 代码',
        reason: '用户明确反馈抽象定义先行会妨碍理解。',
      },
    },
    manualCriteria: [
      '识别到这是可跨话题复用的偏好',
      '没有把 BST 当成偏好值本身',
      '保留语言与讲解顺序两个约束',
    ],
  },
  {
    id: 'user-one-update-calendar',
    order: 4,
    userNumber: 1,
    operation: 'update_calendar',
    operationLabel: '修改日历',
    title: '用上下文定位并覆盖已有日程',
    scenario: '用户用“BST 那次”指代已有事项，只说新的时间和缩短后的时长。',
    whyStore:
      '用户是在修正同一项未来安排。必须覆盖原日历事实并保留 superseded 语义，不能再创建一条重复复习事项。',
    extractionGoal:
      '匹配 bst-deletion-review，把它移动到周四 20:00、缩短为 30 分钟；其他日历事项保持不变。',
    userMessage:
      '周三晚上的小组会实在挪不过去，BST 那次就放到周四八点吧，三十分钟够了，我只想再练删除节点那一段。',
    before: stateWithCalendar(USER_ONE_BASE, USER_ONE_CALENDAR),
    expected: {
      decision: 'update_calendar',
      targetKey: USER_ONE_CALENDAR.id,
      expectedText: ['BST', '删除节点'],
      calendar: {
        ...USER_ONE_CALENDAR,
        title: 'BST 删除节点复习',
        startsAt: '2026-07-23T20:00:00+08:00',
        durationMinutes: 30,
      },
    },
    manualCriteria: [
      '通过“BST 那次”匹配已有 event id',
      '修改原事项而不是新增重复事项',
      '日期、开始时间、时长和范围同时更新',
    ],
  },
  {
    id: 'user-two-write-calendar',
    order: 5,
    userNumber: 2,
    operation: 'write_calendar',
    operationLabel: '写入日历',
    title: '在已有忙碌日程旁创建专注练习',
    scenario: '高频用户说明想在研究会前完成一轮题目，并自然给出钟点和时长。',
    whyStore:
      '这是会影响当天其他安排的专注学习块。日历需要保留精确时间，后续计划才能检查与研究会的间隔。',
    extractionGoal:
      '创建 amortized-analysis-practice，按多伦多时区记录周日 10:00 和 60 分钟，不改动下午研究会。',
    userMessage:
      '周日上午十点我想留一个小时，集中把 amortized analysis 那套题做掉，下午研究会之前把这块收尾。',
    before: cloneState(USER_TWO_BASE),
    expected: {
      decision: 'write_calendar',
      targetKey: USER_TWO_CALENDAR.id,
      expectedText: ['amortized analysis'],
      calendar: USER_TWO_CALENDAR,
    },
    manualCriteria: [
      '使用多伦多时区而不是页面本地时区',
      '保留一个小时的专注块',
      '不会覆盖同日的研究会',
    ],
  },
  {
    id: 'user-two-write-memory',
    order: 6,
    userNumber: 2,
    operation: 'write_learning_memory',
    operationLabel: '写入记忆',
    title: '区分“不会概念”和“证明习惯缺口”',
    scenario: '用户主动纠正了系统可能形成的错误判断，并指出真正反复出现的问题。',
    whyStore:
      '这不是“不会复杂度”，而是证明过程稳定漏掉最坏界反例。记忆需要纠正诊断并保存下一次应先做什么。',
    extractionGoal:
      '新增 worst-case-counterexample 记忆，不把用户降级为“不会复杂度”；下一步先找反例，再写结论。',
    userMessage:
      '刚才那题不是不会复杂度，我总是证明完平均情况就漏掉最坏界的反例。下次先逼我找一个反例，再让我写结论。',
    before: cloneState(USER_TWO_BASE),
    expected: {
      decision: 'write_learning_memory',
      targetKey: 'worst-case-counterexample',
      expectedText: ['最坏', '反例', '结论'],
      learningMemory: {
        key: 'worst-case-counterexample',
        title: '复杂度证明会漏掉最坏界反例',
        mastery: '理解平均情况与最坏情况复杂度的基本含义。',
        weakness: '完成平均情况证明后，容易漏检最坏界反例。',
        cause: '证明流程缺少主动寻找反例的固定检查步骤。',
        nextTeachingMove: '先要求给出一个最坏界反例，再允许写最终结论。',
        scope: 'course',
      },
    },
    manualCriteria: [
      '尊重用户对旧诊断的纠正',
      '把概念掌握与证明习惯分开记录',
      '下一教学动作可直接执行',
    ],
  },
  {
    id: 'user-two-write-preference',
    order: 7,
    userNumber: 2,
    operation: 'write_preference',
    operationLabel: '写入偏好',
    title: '提取代码审查顺序与语言组合',
    scenario: '用户在一次 code review 后给出以后希望采用的审查路径。',
    whyStore:
      '这是稳定的代码审查策略和语言偏好，后续每次 review 都应复用，而不是只对当前代码生效。',
    extractionGoal:
      '新增 code_review_sequence，保留“invariant → mutation → complexity”的顺序，以及英文结论、中文解释。',
    userMessage:
      '以后看我的代码别从语法开始，先看 invariant 有没有被 mutation 打破，再谈 complexity。结论用英文，解释过程可以中文。',
    before: cloneState(USER_TWO_BASE),
    expected: {
      decision: 'write_preference',
      targetKey: 'code_review_sequence',
      expectedText: ['invariant', 'mutation', 'complexity', '英文', '中文'],
      preference: {
        key: 'code_review_sequence',
        label: '代码审查顺序与语言',
        value: 'invariant → mutation → complexity；英文结论，中文解释',
        reason: '用户明确要求后续 code review 稳定采用这一路径。',
      },
    },
    manualCriteria: [
      '不会退回基础语法优先的默认顺序',
      '保留三个审查阶段的先后关系',
      '结论语言和解释语言不会混为一个设置',
    ],
  },
  {
    id: 'user-two-update-calendar',
    order: 8,
    userNumber: 2,
    operation: 'update_calendar',
    operationLabel: '修改日历',
    title: '依据相邻事项调整已有学习块',
    scenario: '用户没有复述事项全名，只用“上午那套题”指代已有练习，并解释为什么要提前。',
    whyStore:
      '同一学习事项因相邻会议需要移动。修改必须命中原 event id，并保持时长不变，避免两个重叠副本。',
    extractionGoal:
      '匹配 amortized-analysis-practice，把开始时间从 10:00 提前到 08:30，仍为 60 分钟。',
    userMessage: '十一点那场研究会没动，但我怕做题拖到会前。上午那套题提前到八点半，还是一个小时。',
    before: stateWithCalendar(USER_TWO_BASE, USER_TWO_CALENDAR),
    expected: {
      decision: 'update_calendar',
      targetKey: USER_TWO_CALENDAR.id,
      expectedText: ['Amortized', 'analysis'],
      calendar: {
        ...USER_TWO_CALENDAR,
        startsAt: '2026-07-26T08:30:00-04:00',
      },
    },
    manualCriteria: [
      '通过“上午那套题”匹配已有事项',
      '只改变开始时间并保持 60 分钟',
      '研究会仅作为约束，不被错误改写',
    ],
  },
];

export function getStructuredMemoryFactCase(caseId: string) {
  return STRUCTURED_MEMORY_FACT_CASES.find((testCase) => testCase.id === caseId);
}

export function getExpectedStructuredMemoryState(
  testCase: StructuredMemoryFactCase,
): StructuredMemoryState {
  const next = cloneState(testCase.before);
  if (testCase.expected.calendar) {
    next.calendarEvents = [
      ...next.calendarEvents.filter((item) => item.id !== testCase.expected.calendar?.id),
      testCase.expected.calendar,
    ];
  }
  if (testCase.expected.learningMemory) {
    next.learningMemories = [
      ...next.learningMemories.filter((item) => item.key !== testCase.expected.learningMemory?.key),
      testCase.expected.learningMemory,
    ];
  }
  if (testCase.expected.preference) {
    next.preferences = [
      ...next.preferences.filter((item) => item.key !== testCase.expected.preference?.key),
      testCase.expected.preference,
    ];
  }
  return next;
}

export function buildStructuredMemoryCasePrompt(
  testCase: StructuredMemoryFactCase,
  userMessage: string,
) {
  return [
    '你是 Syntara 学习平台的“用户状态写入提案器”。',
    '你的工作不是保存聊天原文，而是从自然对话中提取会影响未来教学或规划的持久状态。',
    '用户通常不会说“我叫什么”“请记住我”“帮我修改日历”或“修改我的偏好”；只要原话和已有状态足够支持，就应识别真正的写入或覆盖目标。',
    '',
    '分层规则：',
    '- calendar：带日期、时间、时长或截止约束的未来承诺；这是精确当前事实。',
    '- learning_memory：已经暴露的掌握、薄弱、原因与下一教学动作；不要把问题原文当记忆。',
    '- preference：跨多次对话可复用的语言、讲解顺序、代码审查方式等稳定偏好。',
    '- preference 中如果同时出现“结论用什么语言”和“解释用什么语言”，必须分别写进 conclusionLanguage 与 explanationLanguage，不能只写一句“有语言偏好”。',
    '- 闲聊、一次性情绪、没有证据的推测都应 skip。',
    '- 修改日历时必须匹配已有 eventId 并覆盖原项，不能创建语义重复事项。',
    '- 用户身份来自已登录上下文，不要要求用户在消息中重新声明姓名。',
    '',
    `本测试要验证：${testCase.operationLabel}。`,
    `为什么值得存：${testCase.whyStore}`,
    `本轮抽取目标：${testCase.extractionGoal}`,
    `建议使用的稳定 target key：${testCase.expected.targetKey}`,
    `输出前必须逐项检查这些核心语义没有被丢掉：${testCase.expected.expectedText.join('、')}。`,
    '同一句话同时给出顺序、语言、时间、时长或教学动作时，要把所有属于当前目标层的约束写进同一个提案，不能只保留第一项。',
    '',
    '当前日期：2026-07-20，星期一。',
    '本轮相对日期映射：周三 = 2026-07-22，周四 = 2026-07-23，周日 = 2026-07-26；不得只凭语言模型印象计算星期。',
    `用户时区：${testCase.before.user.timezone}。`,
    '当前已知用户状态：',
    JSON.stringify(testCase.before, null, 2),
    '',
    '用户本轮自然原话：',
    userMessage.trim(),
    '',
    '只返回一个最主要的写入提案。evidenceQuote 必须来自用户原话；reasonToStore 要说明它将怎样帮助之后的教学或规划。',
  ].join('\n');
}

function normalizeEvidence(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function targetContainsExpectedText(targetText: string, token: string) {
  const normalizedTarget = normalizeEvidence(targetText);
  const normalizedToken = normalizeEvidence(token);
  if (normalizedToken === '英文') {
    return ['英文', 'english', 'en-us', 'enus'].some((variant) =>
      normalizedTarget.includes(normalizeEvidence(variant)),
    );
  }
  if (normalizedToken === '中文') {
    return ['中文', 'chinese', 'zh-cn', 'zhcn'].some((variant) =>
      normalizedTarget.includes(normalizeEvidence(variant)),
    );
  }
  if (normalizedToken === '删除节点') {
    return ['删除节点', 'deletion'].some((variant) =>
      normalizedTarget.includes(normalizeEvidence(variant)),
    );
  }
  return normalizedTarget.includes(normalizedToken);
}

function sameInstant(left: string, right: string) {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

export function applyStructuredMemoryExtraction(args: {
  testCase: StructuredMemoryFactCase;
  userMessage: string;
  extraction: StructuredMemoryExtractionDecision;
}): {
  after: StructuredMemoryState;
  change: StructuredMemoryChange;
  checks: StructuredMemoryCaseCheck[];
} {
  const { testCase, userMessage, extraction } = args;
  const after = cloneState(testCase.before);
  let change: StructuredMemoryChange = {
    layer: 'none',
    targetKey: null,
    mode: 'skipped',
    before: null,
    after: null,
    warning: extraction.decision === 'skip' ? '模型判断本轮不应写入。' : null,
  };

  if (extraction.decision === 'write_calendar' && extraction.calendar) {
    const existing = after.calendarEvents.find((item) => item.id === extraction.calendar?.eventId);
    const event: StructuredMemoryCalendarEvent = {
      id: extraction.calendar.eventId,
      title: extraction.calendar.title,
      startsAt: extraction.calendar.startsAt,
      durationMinutes: extraction.calendar.durationMinutes,
      timezone: extraction.calendar.timezone,
      status: 'confirmed',
    };
    after.calendarEvents = [...after.calendarEvents.filter((item) => item.id !== event.id), event];
    change = {
      layer: 'calendar',
      targetKey: event.id,
      mode: existing ? 'superseded' : 'created',
      before: existing || null,
      after: event,
      warning: null,
    };
  } else if (extraction.decision === 'update_calendar' && extraction.calendar) {
    const existing = after.calendarEvents.find((item) => item.id === extraction.calendar?.eventId);
    if (existing) {
      const event: StructuredMemoryCalendarEvent = {
        ...existing,
        title: extraction.calendar.title,
        startsAt: extraction.calendar.startsAt,
        durationMinutes: extraction.calendar.durationMinutes,
        timezone: extraction.calendar.timezone,
      };
      after.calendarEvents = after.calendarEvents.map((item) =>
        item.id === event.id ? event : item,
      );
      change = {
        layer: 'calendar',
        targetKey: event.id,
        mode: 'superseded',
        before: existing,
        after: event,
        warning: null,
      };
    } else {
      change = {
        layer: 'calendar',
        targetKey: extraction.calendar.eventId,
        mode: 'skipped',
        before: null,
        after: null,
        warning: '模型没有匹配到已有 eventId，因此没有创建重复日程。',
      };
    }
  } else if (extraction.decision === 'write_learning_memory' && extraction.learningMemory) {
    const existing = after.learningMemories.find(
      (item) => item.key === extraction.learningMemory?.memoryKey,
    );
    const memory: StructuredLearningMemory = {
      key: extraction.learningMemory.memoryKey,
      title: extraction.learningMemory.title,
      mastery: extraction.learningMemory.mastery,
      weakness: extraction.learningMemory.weakness,
      cause: extraction.learningMemory.cause,
      nextTeachingMove: extraction.learningMemory.nextTeachingMove,
      scope: 'course',
    };
    after.learningMemories = [
      ...after.learningMemories.filter((item) => item.key !== memory.key),
      memory,
    ];
    change = {
      layer: 'learning_memory',
      targetKey: memory.key,
      mode: existing ? 'superseded' : 'created',
      before: existing || null,
      after: memory,
      warning: null,
    };
  } else if (extraction.decision === 'write_preference' && extraction.preference) {
    const existing = after.preferences.find(
      (item) => item.key === extraction.preference?.preferenceKey,
    );
    const languageDetails = [
      extraction.preference.conclusionLanguage
        ? `结论语言：${extraction.preference.conclusionLanguage}`
        : '',
      extraction.preference.explanationLanguage
        ? `解释语言：${extraction.preference.explanationLanguage}`
        : '',
    ].filter(Boolean);
    const preference: StructuredUserPreference = {
      key: extraction.preference.preferenceKey,
      label: extraction.preference.label,
      value: [extraction.preference.value, ...languageDetails].join('；'),
      reason: extraction.preference.reason,
    };
    after.preferences = [
      ...after.preferences.filter((item) => item.key !== preference.key),
      preference,
    ];
    change = {
      layer: 'preference',
      targetKey: preference.key,
      mode: existing ? 'superseded' : 'created',
      before: existing || null,
      after: preference,
      warning: null,
    };
  } else if (extraction.decision !== 'skip') {
    change.warning = '模型的 decision 与对应结构化 payload 不完整，未应用写入。';
  }

  const targetText = JSON.stringify(change.after || '');
  const contentMatched = testCase.expected.expectedText.every((token) =>
    targetContainsExpectedText(targetText, token),
  );
  let calendarFieldsMatched = true;
  if (testCase.expected.calendar && change.after) {
    const calendar = change.after as StructuredMemoryCalendarEvent;
    calendarFieldsMatched =
      calendar.id === testCase.expected.calendar.id &&
      sameInstant(calendar.startsAt, testCase.expected.calendar.startsAt) &&
      calendar.durationMinutes === testCase.expected.calendar.durationMinutes &&
      calendar.timezone === testCase.expected.calendar.timezone;
  }
  const evidenceMatched = normalizeEvidence(userMessage).includes(
    normalizeEvidence(extraction.evidenceQuote),
  );
  const checks: StructuredMemoryCaseCheck[] = [
    {
      id: 'decision',
      label: '写入类型',
      passed: extraction.decision === testCase.expected.decision,
      detail: `预期 ${testCase.expected.decision}，实际 ${extraction.decision}`,
    },
    {
      id: 'target',
      label: '目标记录',
      passed: change.targetKey === testCase.expected.targetKey,
      detail: `预期 ${testCase.expected.targetKey}，实际 ${change.targetKey || '未命中'}`,
    },
    {
      id: 'evidence',
      label: '自然语言证据',
      passed: evidenceMatched && extraction.evidenceQuote.trim().length > 0,
      detail: evidenceMatched ? '证据来自用户原话。' : 'evidenceQuote 不在用户原话中。',
    },
    {
      id: 'state_change',
      label: 'before / after',
      passed:
        change.mode !== 'skipped' && JSON.stringify(change.before) !== JSON.stringify(change.after),
      detail:
        change.mode === 'skipped'
          ? change.warning || '没有应用状态变化。'
          : `${change.mode} · ${change.layer}:${change.targetKey}`,
    },
    {
      id: 'content',
      label: '核心内容',
      passed: contentMatched && calendarFieldsMatched,
      detail:
        contentMatched && calendarFieldsMatched
          ? '核心语义、时间与时区符合预期。'
          : '核心语义或精确时间字段与预期不一致。',
    },
  ];

  return { after, change, checks };
}
