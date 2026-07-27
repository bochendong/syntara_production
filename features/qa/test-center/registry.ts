export type PlatformTestCategory =
  | 'notebook'
  | 'calendar'
  | 'practice'
  | 'teaching'
  | 'memory'
  | 'journey';
export type PlatformTestExecutionStatus = 'ready' | 'planned';

export interface PlatformTestStep {
  title: string;
  action: string;
  evidence: string;
}

export interface PlatformTestScenario {
  id: string;
  order: number;
  title: string;
  summary: string;
  category: PlatformTestCategory;
  entryHref: string;
  entryLabel: string;
  setup: string[];
  inputs: string[];
  outputs: string[];
  prompts?: string[];
  steps: PlatformTestStep[];
  passCriteria: string[];
  executionStatus?: PlatformTestExecutionStatus;
  recommended?: boolean;
  recommendationReason?: string;
}

export const PLATFORM_TEST_CATEGORY_LABELS: Record<PlatformTestCategory, string> = {
  notebook: '笔记本生成',
  calendar: '日历计划',
  practice: '题目练习',
  teaching: '知识讲解',
  memory: '记忆与复习',
  journey: '用户旅程',
};

export const CORE_PLATFORM_TEST_SCENARIOS: PlatformTestScenario[] = [
  {
    id: 'notebook-overview-image',
    order: 1,
    title: '上传文件，生成一页式学习 Cheat Sheet',
    summary: '验证资料理解、速查结构提取和正式图片生成能形成独立链路，不创建笔记本内容。',
    category: 'notebook',
    entryHref: '/creator',
    entryLabel: '前往创作入口',
    setup: [
      '准备一份结构清晰的 PDF、PPTX 或 Markdown 课程资料',
      '记录文件名、页数和三个关键知识点',
    ],
    inputs: ['课程资料文件', 'Cheat Sheet 标题（可选）', '资料用途与重点（可选）'],
    outputs: [
      '上传成功状态',
      '可核对的资料摘要',
      '一张包含定义、方法、边界、对照与检索词的 A4 Cheat Sheet',
    ],
    prompts: [
      '请根据上传资料生成一张一页式学习 Cheat Sheet，覆盖定义、方法条件、结论边界、复习路线和检索入口。',
    ],
    steps: [
      {
        title: '上传资料',
        action: '选择文件并等待解析完成。',
        evidence: '文件名、类型、大小和解析状态可见。',
      },
      {
        title: '识别结构',
        action: '检查系统提取的主题、章节和关键概念。',
        evidence: '三个预先记录的关键知识点至少命中两个。',
      },
      {
        title: '生成概览',
        action: '触发 Cheat Sheet 生成并等待任务完成。',
        evidence: '进度、成功或失败状态清楚，不暴露内部推理。',
      },
      {
        title: '验收结果',
        action: '打开 Cheat Sheet，检查定义、方法条件、边界、对照表和检索词。',
        evidence: '图片可读、无截断，并能追溯到上传资料。',
      },
    ],
    passCriteria: [
      '资料没有被错误识别为题库',
      'Cheat Sheet 覆盖资料主线且不编造知识点',
      '刷新后仍能找到生成结果',
      '运行前后都不会创建或修改笔记本内容',
    ],
  },
  {
    id: 'notebook-summary-content',
    order: 2,
    title: '上传文件，AI 路由并生成结构化笔记',
    summary: '验证 AI 能区分课程讲义、研究论文和日常资料，并输出适合快速查阅的对应结构。',
    category: 'notebook',
    entryHref: '/creator',
    entryLabel: '前往创作入口',
    setup: ['至少准备一份课程讲义和一份研究论文', '先使用 AI 自动路由，再用手动路径分别验收生成器'],
    inputs: ['原始资料文件', 'AI 自动路由或手动指定路径', '输出语言'],
    outputs: [
      '路由类型、置信度、判断理由和原文信号',
      '课程型：完整定义、知识脉络、做题想法、选法逻辑、解题格式、代表题型',
      '研究型：研究问题、主张—证据—边界、方法 pipeline、实验指标、局限和复现信息',
      '好笔记的保留、省略和使用规则，以及可折叠的完整 Markdown',
    ],
    prompts: [
      '直接读取原文件，先判断资料用途，再调用对应结构化生成器；不得用课程上下文猜测资料类型。',
    ],
    steps: [
      {
        title: '上传与路由',
        action: '上传资料并选择 AI 自动路由。',
        evidence: '页面显示选中的生成器、置信度、判断理由和原文信号。',
      },
      {
        title: '验收课程路径',
        action: '上传课程讲义，检查定义、方法选择、解题格式和代表题型。',
        evidence: '定义完整；题目经过代表性筛选；做题想法与落笔格式分开显示。',
      },
      {
        title: '验收研究路径',
        action: '上传研究论文，检查研究问题、主张、方法、证据、指标和边界。',
        evidence: '没有套用课程做题模板；每条核心主张能回到证据及其边界。',
      },
      {
        title: '保存与重开',
        action: '刷新浏览器并重新打开运行历史。',
        evidence: '路由判断、结构化字段和完整 Markdown 均未丢失。',
      },
    ],
    passCriteria: [
      'AI 自动路由与资料实际类型一致，并显示可核查依据',
      '课程型结果能先回答定义、选法、做题想法和书写格式，而不是堆叠全文',
      '课程例题只保留能代表方法或边界的题型，且不丢关键步骤',
      '研究型结果以主张、证据、指标、边界和复现为中心，不套课程模板',
      '刷新后仍能查看完整结构化结果，且测试不会写入业务数据库',
    ],
  },
  {
    id: 'calendar-natural-language-crud',
    order: 3,
    title: '上传文件生成日历，并用自然语言增删改日程',
    summary: '覆盖 syllabus 提取、日历草稿确认，以及自然语言添加、修改、删除的完整闭环。',
    category: 'calendar',
    entryHref: '/learn',
    entryLabel: '前往学习工作台',
    setup: ['准备包含作业、考试和日期的课程大纲', '确保至少有两个日期相近但标题不同的事项'],
    inputs: ['课程大纲文件', '新增日程指令', '修改日程指令', '删除日程指令'],
    outputs: ['待确认的日历草稿', '确认后写入的日历事项', '每次变更的明确反馈'],
    prompts: [
      '把这份 syllabus 里的作业和考试整理成日历。',
      '下周三晚上 8 点添加 45 分钟复习。',
      '把刚才的复习改到周四晚上 7 点。',
      '删除刚才创建的复习日程。',
    ],
    steps: [
      {
        title: '导入日期',
        action: '上传大纲并检查提取出的日期事项。',
        evidence: '标题、日期、来源和事项类型可核对。',
      },
      { title: '确认写入', action: '确认日历草稿后再写入。', evidence: '未确认前日历不发生变化。' },
      {
        title: '自然语言增改',
        action: '先添加事项，再用相对指代修改它。',
        evidence: '系统命中唯一事项并显示修改前后差异。',
      },
      {
        title: '自然语言删除',
        action: '请求删除并完成确认。',
        evidence: '删除目标明确，确认后事项消失。',
      },
    ],
    passCriteria: [
      '日期和时区正确',
      '所有写操作都需要确认',
      '歧义目标不会被直接修改或删除',
      '刷新后日历状态与操作结果一致',
    ],
  },
  {
    id: 'question-source-routing',
    order: 4,
    title: '题库与笔记题源路由',
    summary:
      '从左侧选择完整题源样本，只调整请求题量，观察 AI 如何规划检索词、执行本地 RAG、验收候选并在题库不足时保留明确缺口。',
    category: 'practice',
    entryHref: '/learn',
    entryLabel: '前往学习工作台',
    setup: [
      '使用本地 MAT136 / CSC148 脱敏题库快照',
      '从测试样本中切换空题库、充足题库和部分题库',
      '样本会自动带入课程、主题、现有题数和 Mock 笔记',
    ],
    inputs: ['完整题源测试样本', '请求题量'],
    outputs: [
      'AI 检索计划',
      'RAG 候选与混合分数',
      '逐题接受/拒绝理由',
      '重试检索词',
      '最终题库选题与缺口报告',
    ],
    prompts: [
      '题库为空、笔记为空',
      '题库为空、有笔记',
      '题库充足',
      '题库不全、笔记为空',
      '题库不全、有笔记',
    ],
    steps: [
      {
        title: '选择测试样本',
        action: '从左侧选择题源样本，并设置不同请求题量。',
        evidence: '样本明确显示课程、主题、题库状态、候选题数和笔记是否提供。',
      },
      {
        title: '执行题源路由',
        action: '先让 AI 生成检索计划，再执行本地混合 RAG，并由 AI 逐题验收；不允许生成替代题。',
        evidence: '结果展示每条 query、语义/词汇/混合分、拒绝原因与下一轮检索词。',
      },
      {
        title: '切换状态对照',
        action: '在同一页面重复运行其他题源状态。',
        evidence: '所有结果进入同一个本地历史列表，可直接比较。',
      },
    ],
    passCriteria: [
      '题库充足时不额外生成',
      '题库为空时返回 0 道题并明确题量缺口',
      '题库不全时只返回严格命中的原题，不补造题目',
      '即使提供笔记，也只能用于理解检索意图，不能作为出题来源',
      '不虚构题库 ID，结果不写业务数据库',
    ],
  },
  {
    id: 'concept-text-explanation',
    order: 5,
    title: '知识点 / 题目文字讲解',
    summary:
      '用左侧 10 条固定样本比较知识点与题目讲解，并直接展示每条样本实际注入的模拟笔记提取知识。',
    category: 'teaching',
    entryHref: '/learn',
    entryLabel: '前往学习工作台',
    setup: ['直接从左侧选择 5 条知识点样本或 5 条题目样本', '不需要预先生成笔记历史'],
    inputs: ['10 条固定讲解样本', '可见的模拟笔记提取章节', '知识点或完整题面'],
    outputs: ['正式课程总控的文字讲解', '实际注入的模拟笔记知识', '讲解依据边界'],
    prompts: [
      '用文字给我讲清楚“递归为什么需要基线条件”，给出准确条件、例子、误区和自检。',
      '请先重述题意和关键条件，再说明选法、逐步解答、检查方法和常见错误。',
    ],
    steps: [
      {
        title: '选择固定测试',
        action: '从左侧 10 条样本中直接切换，不再使用下拉菜单组装条件。',
        evidence: '每条样本都明确标注知识点/题目以及有笔记/无笔记。',
      },
      {
        title: '核对模拟笔记',
        action: '带笔记的样本会在运行前展示标题、源文件、章节摘要和提取正文。',
        evidence: '人可以直接对照“页面展示的知识”与“模型实际引用的知识”。',
      },
      {
        title: '执行正式讲解',
        action: '把受控上下文交给正式课程总控讲解器。',
        evidence: '无笔记时不暗示读取资料；有笔记时能引用实际笔记内容且不越过证据边界。',
      },
      {
        title: '对照结果',
        action: '保持输入不变，只切换笔记条件后重新生成。',
        evidence: '可以从本地历史直接比较结构、例子、结论和来源差异。',
      },
    ],
    passCriteria: [
      '知识点讲解包含直觉、准确表述、条件、例子、误区和自检',
      '题目讲解准确重述题面，并说明选法、步骤、检查与最终结论',
      '有笔记时引用的是页面已展示的模拟提取知识，不伪造不存在的来源',
      '无笔记时明确使用一般知识，不声称来自课程笔记',
      '10 条固定测试和完整上下文轨迹刷新后仍可查看',
    ],
  },
  {
    id: 'concept-ppt-explanation',
    order: 6,
    title: '讲解某个知识点（PPT 版）',
    summary: '验证用户明确要求后，文字教学目标能被转换成短小、可播放的临时课堂。',
    category: 'teaching',
    entryHref: '/learn',
    entryLabel: '前往学习工作台',
    setup: ['选择一个适合 1–2 页讲清的知识点', '准备必须出现的概念、例子和视觉元素'],
    inputs: ['知识点', 'PPT 形式的明确请求', '页数或讲解时长（可选）'],
    outputs: ['生成前确认动作', '1–2 页临时课堂', '可播放的讲解内容和返回路径'],
    prompts: ['把“二分查找的不变量”做成 2 页以内的 PPT 给我讲解，包含一个数组例子。'],
    steps: [
      {
        title: '明确请求',
        action: '要求用 PPT 讲解并给出页数限制。',
        evidence: '只有明确请求才触发课堂生成。',
      },
      {
        title: '确认生成',
        action: '检查计划并确认消耗型生成动作。',
        evidence: '生成前能看到目标、页数和预期产物。',
      },
      {
        title: '播放课堂',
        action: '打开生成结果并逐页播放。',
        evidence: '文字、图片、公式和讲解顺序一致。',
      },
      { title: '回到对话', action: '返回原对话继续追问。', evidence: '上下文和课堂结果仍可访问。' },
    ],
    passCriteria: [
      '未明确请求时不生成 PPT',
      '默认控制在 1–2 页',
      '每页有明确教学职责且无内容截断',
      '生成失败可恢复到原对话并重试',
    ],
  },
];

export const RECOMMENDED_PLATFORM_TEST_SCENARIOS: PlatformTestScenario[] = [
  {
    id: 'end-to-end-learning-loop',
    order: 9,
    title: 'CSC148 完整学习闭环回归',
    summary:
      '使用真实 CSC148 本地课程包和题库，验证课程检索、AI 问答、题库练习与昂贵结果归档的跨模块交接。',
    category: 'memory',
    entryHref: '/test/end-to-end-learning-loop',
    entryLabel: '进入 CSC148 闭环',
    setup: [
      '使用仓库内 CSC148 课程快照与生产题库快照',
      '登录一个测试用户，确保 AI 费用和结果都归属到该账户',
    ],
    inputs: ['CSC148 学习主题', '一次 AI 知识问答', '一次题库检索或练习', '验收状态与备注'],
    outputs: ['课程证据', 'AI 讲解结果', '匹配题库入口', '可跨刷新恢复的完整测试运行记录'],
    steps: [
      {
        title: '读取课程',
        action: '检索 CSC148 notebook 与章节内容。',
        evidence: '命中结果可回到真实本地课程片段。',
      },
      {
        title: 'AI 课程问答',
        action: '带着课程和题库证据调用正式模型。',
        evidence: '保存完整 prompt、输出、模型、token 和费用。',
      },
      {
        title: '进入题库',
        action: '从问答证据进入匹配题目并检查解析。',
        evidence: '题目来自 CSC148 真实题库快照。',
      },
      {
        title: '归档验收',
        action: '标记通过或失败并保存备注。',
        evidence: '刷新或退出浏览器后仍能恢复历次运行。',
      },
    ],
    passCriteria: [
      '课程、题库和 AI 证据属于同一个 CSC148 测试上下文',
      'AI 回复不能编造本地课程或题库不存在的内容',
      '每次运行追加保存，不覆盖以前付费生成的结果',
      '完整链路失败时能定位到检索、模型、题库或保存阶段',
    ],
    recommended: true,
    recommendationReason:
      'CSC148 已经具备真实课程内容和题库快照，适合作为平台发布前的完整学习闭环基准。',
  },
  {
    id: 'new-user-qualitative-journey',
    order: 10,
    title: '新用户全旅程定性验收',
    summary:
      '用真正零课程、零记忆的测试账号，从首次到访开始，逐项判断注册、建课、资料、学习、计划、题库、商城与个人系统是顺畅、有摩擦、失败还是受阻。',
    category: 'journey',
    entryHref: '/test/new-user-qualitative-journey',
    entryLabel: '进入新用户旅程',
    setup: [
      '使用全新浏览器资料与从未使用过的虚构测试邮箱',
      '从零课程、零资料、零记忆和零会话开始',
      '准备一份小型课程资料、一张非敏感题目图片和一份含日期的 syllabus',
      '本轮不进行真实支付、充值、市场交易或不可逆购买',
    ],
    inputs: [
      '首次到访的桌面端简体中文用户',
      '一门大学课程和一门对照课程',
      '真实的提问、上传、日历、做题与跨页面导航动作',
      '每项操作的定性判定、观察备注和可恢复证据',
    ],
    outputs: [
      '九阶段、50+ 个用户可见操作的逐项判定',
      '可跨刷新恢复的浏览器本地测试进度与备注',
      'P0 失败直接阻断的发布结论',
      '注册、课程、学习、商城和个人系统之间的摩擦地图',
    ],
    steps: [
      {
        title: '建立零状态身份',
        action: '从首页注册虚构测试账号，并确认登录后直接落到 /learn。',
        evidence: '记录最终 URL、空首页理解、身份恢复与退出边界。',
      },
      {
        title: '建立课程与资料',
        action: '创建课程、上传资料并核对课程主页、资料库和知识来源。',
        evidence: '记录空状态、弹窗建课、处理进度、错误反馈与跨课程隔离。',
      },
      {
        title: '完成一次学习闭环',
        action: '完成提问、图片、短课堂、日历、笔记本、做题与复习。',
        evidence: '记录课程证据、确认动作、进度恢复和下一教学动作。',
      },
      {
        title: '覆盖外围与恢复',
        action: '检查商城、积分、个人中心、设置、通知、讲师中心和错误恢复。',
        evidence: '每项标记顺畅、有摩擦、失败、受阻或不适用，并写观察备注。',
      },
    ],
    passCriteria: [
      '所有适用 P0 操作都顺畅完成，没有失败或受阻',
      '用户无需猜 URL、内部模块名或数据层即可找到主要能力',
      '所有写入、删除和有成本操作都有明确目标、影响与确认边界',
      '刷新、返回、切课和重新登录后，身份、课程与学习状态不串线',
      '失败可恢复且不丢已有输入或产物，不暴露内部堆栈、路径或密钥',
    ],
    recommended: true,
    recommendationReason:
      '现有发布回归从已登录的 CSC148 用户开始，缺少注册、空首页、建课、外围系统和失败恢复；这条测试补齐真正的新用户产品旅程。',
  },
];

export type MemorySystemGroup = 'setup' | 'write' | 'manage' | 'ai';

export interface MemorySystemTestScenario extends PlatformTestScenario {
  phaseTwoGroup: MemorySystemGroup;
  shortTitle: string;
}

/** Compatibility names kept for existing workspace imports and saved scenario URLs. */
export type MemoryPhaseTwoGroup = MemorySystemGroup;
export type MemoryPhaseTwoTestScenario = MemorySystemTestScenario;

const MEMORY_TEST_SETUP = [
  '从四个只读人物基线中独立选择本条测试用户',
  '每次运行创建一次性浏览器本地副本，读取结果后立即销毁',
];

const SECOND_PHASE_MEMORY_TEST_SCENARIO_DEFINITIONS: MemorySystemTestScenario[] = [
  {
    id: 'memory-simulated-user',
    order: 8,
    shortTitle: '四档平台使用历史',
    title: '第二阶段 01：四档平台用户与完整使用历史',
    summary:
      '建立新用户、轻度用户、活跃用户和重度用户四份完整本地历史，对照检查题目、作答、聊天、资料、日历、精确事实与分层记忆。',
    category: 'memory',
    phaseTwoGroup: 'setup',
    entryHref: '/test/memory-simulated-user',
    entryLabel: '测试四档平台用户',
    setup: ['浏览器支持 localStorage 与 IndexedDB', '四个 memory-test- userId 相互隔离'],
    inputs: ['刚注册的新用户', '轻度使用者', '持续活跃用户', '长期重度使用者'],
    outputs: [
      '四份独立的题目、逐次作答、聊天、资料与日历记录',
      '短期状态、私有长期记忆、共有课程记忆与精确事实的分层统计',
      '选择后仅显示该人物的只读来源历史与派生记忆',
    ],
    steps: [
      {
        title: '刚注册的新用户',
        action: '加载 3 天内开始使用平台的初学者。',
        evidence: '2 道题、3 次作答、1 段对话，来源与记忆都很少。',
      },
      {
        title: '轻度使用者',
        action: '加载使用 21 天、偶尔学习的基础水平用户。',
        evidence: '9 道题、15 次作答、4 段对话、1 份资料与 6 条私有长期记忆。',
      },
      {
        title: '持续活跃用户',
        action: '加载跨 94 天持续学习的中等水平用户。',
        evidence: '28 道题、54 次作答、14 段对话、3 份资料与 18 条私有长期记忆。',
      },
      {
        title: '长期重度使用者',
        action: '加载跨 286 天高频使用平台的高阶用户。',
        evidence: '72 道题、168 次作答、38 段对话、8 份资料、14 个日历事项与 42 条私有长期记忆。',
      },
    ],
    passCriteria: [
      '四个用户的使用量、学习水平、来源记录与记忆状态明显不同',
      '逐次作答保留为来源记录，长期记忆是跨证据提炼结果',
      '四份信息均来自各自的浏览器本地沙盒',
      '第一条中的选择不会影响任何后续测试',
    ],
  },
  {
    id: 'memory-problem-writeback',
    order: 14,
    shortTitle: '做题后更新记忆',
    title: '第二阶段 07：用户做题后的记忆更新',
    summary:
      '基于 queue/CSC148 课程资料的 8 个独立做题场景，由平台实际判题后决定是否更新工作记忆或长期记忆。',
    category: 'memory',
    phaseTwoGroup: 'write',
    entryHref: '/test/memory-problem-writeback',
    entryLabel: '测试做题写入',
    setup: MEMORY_TEST_SETUP,
    inputs: [
      '8 个固定人物与真实课程题目场景',
      '完整题干、正确答案/评分 rubric 与用户原始提交彼此分离',
      '选项、长简答、代码追踪、证明与无答案边界',
    ],
    outputs: [
      '平台运行时判题分数与反馈',
      '本次实际新增或更新的记忆',
      '写入目标 userId、problemId 与 attemptIds 来源证据',
    ],
    steps: [
      {
        title: 'Python aliasing 选择题',
        action: '周小满混淆浅拷贝与深拷贝。',
        evidence: '平台选项判题后新增对象图薄弱记忆。',
      },
      {
        title: 'Testing 旧题复习',
        action: '陈知遥区分 coverage、边界与 expected value 的证据边界。',
        evidence: '完全匹配正确选项后修正既有记忆。',
      },
      {
        title: 'RI class review',
        action: '林澈 review 缺少 RI 且暴露 alias 的 Playlist class。',
        evidence: 'AI 实际评分学生原始简答后提取诊断。',
      },
      {
        title: 'Stack / Queue ADT 契约',
        action: '周小满在多选题中混淆 LIFO/FIFO 并绕过 public interface。',
        evidence: '平台判题生成 ADT 接口语义薄弱记忆。',
      },
      {
        title: 'Exception flow 追踪',
        action: '陈知遥解释 handler matching、else 与 finally。',
        evidence: 'AI 按 rubric 评分完整控制流解释。',
      },
      {
        title: 'Linked-list mutation',
        action: '林澈修复 front、middle、end 与越界插入。',
        evidence: '记录 predecessor 与保留 suffix 的实际代码证据。',
      },
      {
        title: 'BST 高阶边界',
        action: '顾言川 review 会覆盖 subtree 的 insert，但仍遗漏 duplicate 与退化树。',
        evidence: '把新 problemId 合并进既有边界证明记忆。',
      },
      {
        title: '递归题超时且没有答案',
        action: '周小满打开课程题但未提交任何选项、简答或代码。',
        evidence: '不猜测掌握或薄弱点，保持 0 条学习记忆变化。',
      },
    ],
    passCriteria: [
      '左侧每一项都是可独立运行的测试，不是流程步骤',
      '右侧只展示本次新增或更新的记忆',
      'after 快照 userId 与实际写入目标一致',
      '记忆能回到真实 problemId 与 attemptIds',
      '刷新后恢复 IndexedDB 中该用例的最新结果，重跑覆盖旧结果',
    ],
  },
  {
    id: 'memory-source-upload-writeback',
    order: 9,
    shortTitle: '上传资料后更新',
    title: '第二阶段 02：用户上传资料后的记忆更新',
    summary:
      '逐份处理 queue/CSC148 的 7 份教师笔记本：完整资料留在知识层，课程特有契约去重写入记忆，并生成学习笔记本与封面图。',
    category: 'memory',
    phaseTwoGroup: 'write',
    entryHref: '/test/memory-source-upload-writeback',
    entryLabel: '测试 7 份教师笔记本',
    setup: MEMORY_TEST_SETUP,
    inputs: ['queue/CSC148 中 7 份真实教师 Markdown 笔记本', '四水平模拟人物的既有课程记忆'],
    outputs: [
      '真实源文件、第一阶段结构化笔记本与正式生成封面的 IndexedDB 记录',
      '新增或合并后的课程契约 StudyMemory',
      'queue 行号、materialId、memoryId 与一次性 userId 来源证据',
    ],
    steps: [
      {
        title: 'Python Memory Model',
        action: '上传变量/对象、aliasing、mutation 与 Function Design Recipe 笔记。',
        evidence: '新增引用图与函数设计顺序契约，并生成笔记本和封面。',
      },
      {
        title: 'Testing Your Code',
        action: '上传 doctest、pytest、coverage 与 property-based testing 笔记。',
        evidence: '命中既有测试契约时合并来源，不新增重复记忆。',
      },
      {
        title: 'OOP 与 Class Design Recipe',
        action: '上传 CSC148 class docstring、RI、API-first 与继承接口笔记。',
        evidence: '保留老师要求的 class 格式；已有相同契约时保留原 memoryId 并合并来源。',
      },
      {
        title: 'Abstract Data Types',
        action: '上传 ADT、Stack/Queue、异常与运行时间笔记。',
        evidence: '新增面向接口、异常行为和 operation-specific runtime 契约。',
      },
      {
        title: 'Exceptions',
        action: '上传异常传播、handler 顺序、else/finally 笔记。',
        evidence: '新增精确捕获与逐帧传播的讲解契约。',
      },
      {
        title: 'Linked Lists',
        action: '上传 _first/_Node、traversal template、mutation 与复杂度笔记。',
        evidence: '新增课程模板、corner cases 与 O(min(n,index)) 契约。',
      },
      {
        title: 'Trees 与 BSTs',
        action: '上传通用树递归、RI、BST、遍历顺序与高度分析笔记。',
        evidence: '新增子树模板、ordering invariant 与 O(h) 教学契约。',
      },
    ],
    passCriteria: [
      '侧边栏一份 queue 文件对应一个独立测试',
      '原资料、第一阶段结构化笔记本和正式生成封面都真实写入浏览器 IndexedDB',
      '相同 contractKey 合并来源并保留 memoryId，不产生重复记忆',
      '只提升会改变未来回答形状的课程契约，完整原文留在资料层',
      '所有结果可追溯到 queue 路径、行号、materialId 与一次性 userId',
    ],
  },
  {
    id: 'memory-question-writeback',
    order: 15,
    shortTitle: '提问后更新记忆',
    title: '第二阶段 08：用户提问知识点后的记忆更新',
    summary:
      '用 9 条直白、口语化或直接粘贴题目/代码/报错的学生消息，检查 AI 回答后是否只写入有证据的教学诊断。',
    category: 'memory',
    phaseTwoGroup: 'write',
    entryHref: '/test/memory-question-writeback',
    entryLabel: '测试提问写入',
    setup: MEMORY_TEST_SETUP,
    inputs: [
      '口语短问与上下文不足的追问',
      '直接粘贴的 Queue 题目、class/BST 代码与 exception traceback',
      '不在当前 CSC148 资料范围的 SQL 问题',
    ],
    outputs: [
      '真实 AI 回答与 Conversation/Message',
      '掌握、薄弱、原因、下一教学动作诊断',
      '每用例 IndexedDB 最新结果与记忆写入策略检查',
    ],
    steps: [
      {
        title: '口语短问与追问',
        action: '测试“RI 到底是啥”、“直接赋值不行吗”与“这块没懂”。',
        evidence: '区分定义性学习起点、错误心智模型与证据不足。',
      },
      {
        title: '题目、代码与报错粘贴',
        action: '测试 Queue 作业、two-stack 实现、class/BST 代码与 traceback。',
        evidence: '只有学生自己的代码、推理或报错提供稳定能力证据时才考虑长期记忆。',
      },
      {
        title: '课程边界与最新结果',
        action: '提问 SQL 问题，然后刷新和重跑同一用例。',
        evidence: '不污染 CSC148 记忆，刷新恢复最新结果，重跑不累加历史。',
      },
    ],
    passCriteria: [
      '记录学生会什么、不会什么、为什么和下一步',
      '来源关联到 conversation/message',
      '问题原文不充当主要记忆',
      '只粘贴题目不等于已暴露稳定薄弱点',
      '上下文不足或课程外问题不会污染 CSC148 记忆',
      '每个侧边栏用例只保留本地最新一次结果',
    ],
  },
  {
    id: 'memory-structured-facts-calendar',
    order: 11,
    shortTitle: '两位用户的自然语言记忆写入',
    title: '第二阶段 04：用户记忆、偏好与日历的自然语言写入',
    summary:
      '用两位拥有不同日历与记忆基线的用户，分别验证写入日历、写入学习记忆、写入偏好和修改日历，并对照每条用例的 before / after。',
    category: 'memory',
    phaseTwoGroup: 'manage',
    entryHref: '/test/memory-structured-facts-calendar',
    entryLabel: '运行 8 个自然语言测试',
    setup: MEMORY_TEST_SETUP,
    inputs: [
      '两位用户的独立状态基线',
      '8 段不含产品内部术语的自然语言',
      '当前日历、学习记忆与偏好',
    ],
    outputs: [
      '模型写入提案与原话证据',
      '每条用例的 before / after',
      'created / superseded 与自动验收结果',
    ],
    steps: [
      {
        title: '用户一 · 写日历',
        action: '从 Lab 截止前的自然安排中提取 BST 复习事项。',
        evidence: '创建带日期、时区与时长的新日历事实。',
      },
      {
        title: '用户一 · 写记忆',
        action: '从递归卡点复盘中提取薄弱、原因与下一教学动作。',
        evidence: '新增课程学习记忆，不复制聊天原文。',
      },
      {
        title: '用户一 · 写偏好',
        action: '从讲法反馈中提取中文与讲解顺序。',
        evidence: '新增可跨话题复用的 explanation preference。',
      },
      {
        title: '用户一 · 改日历',
        action: '用“BST 那次”定位并移动已有事项。',
        evidence: '覆盖原 event id，不创建重复事项。',
      },
      {
        title: '用户二 · 写日历',
        action: '在研究会之前创建 amortized analysis 练习。',
        evidence: '按多伦多时区创建独立日历事项。',
      },
      {
        title: '用户二 · 写记忆',
        action: '区分概念掌握与最坏界反例的证明习惯缺口。',
        evidence: '纠正旧判断并写入可执行下一步。',
      },
      {
        title: '用户二 · 写偏好',
        action: '提取 invariant、mutation、complexity 的 code review 顺序。',
        evidence: '保留审查顺序与中英文组合。',
      },
      {
        title: '用户二 · 改日历',
        action: '用“上午那套题”定位并提前已有练习。',
        evidence: '只覆盖开始时间并保持原时长。',
      },
    ],
    passCriteria: [
      '用户不说内部术语也能识别正确写入层',
      '不同用户的日历、记忆与偏好不会串线',
      '日历修改命中原 event id 而不是创建重复项',
      '每条用例都能直接对照之前与之后',
    ],
  },
  {
    id: 'memory-layered-query',
    order: 12,
    shortTitle: '统一 Agent 整体召回',
    title: '第二阶段 05：整体性自然语言查询与召回',
    summary:
      '让同一个大 Agent 从自然语言判断需要读取个人资料、日历、工作/长期记忆、既有笔记本、做题记录或真实题库，并完成回答或安全的日历修改。',
    category: 'memory',
    phaseTwoGroup: 'manage',
    entryHref: '/test/memory-layered-query',
    entryLabel: '测试统一 Agent 召回',
    setup: [
      ...MEMORY_TEST_SETUP,
      '复用第二阶段 01 的四档模拟用户与第二阶段 02 已生成的 CSC148 笔记本',
      '使用本地 298 道已发布 CSC148 真实题库快照，不向模型伪造题目',
    ],
    inputs: [
      '无学习历史、少量历史和大量历史的自然语言查询',
      '隐式个人化、知识点追问与直接粘贴题面',
      '日历相对指代、唯一修改与歧义不写入',
    ],
    outputs: [
      '学生可直接阅读且不暴露内部路径的统一 Agent 回复',
      'QA 可展开的安全调用摘要、真实证据与机器检查',
      '日历修改的一次性副本前后快照与事件账本',
    ],
    steps: [
      {
        title: '无 / 少 / 多记忆',
        action: '分别运行三档历史量，检查结论强度、相关性和新旧证据优先级。',
        evidence: '每档都是侧边栏独立条目，结果 latest-only 保存。',
      },
      {
        title: '知识与题目讲解',
        action: '用普通追问和粘贴题面触发课程知识、个人偏好、笔记本与题库召回。',
        evidence: '真实生成笔记本和真实 problemId 支持回答，学生回复不显示内部来源路径。',
      },
      {
        title: '整体性综合请求',
        action: '用一次小测前请求测试资料、日历、学习状态、课程知识和选题的联合召回。',
        evidence: '一个 Agent 自行选择最小必要来源并给出可执行结果。',
      },
      {
        title: '日历自然修改',
        action: '测试唯一相对指代和双候选歧义。',
        evidence: '唯一目标才写入；歧义时追问且日历账本无变化。',
      },
    ],
    passCriteria: [
      '用户不需要点名资料类型、模块、路径或内部 ID',
      '无记忆不猜，少记忆不过度归纳，多记忆不堆砌无关内容',
      '知识点和题目讲解能分别命中已生成笔记本与真实题库',
      '个人资料只用于稳定背景和讲解偏好，不伪装成近期学习证据',
      '日历当前值优先于旧文本，唯一目标才允许修改',
      '每个小测试独占侧边栏条目、一次性副本和 latest-only 结果',
    ],
  },
  {
    id: 'memory-ai-review-plan',
    order: 13,
    shortTitle: 'Agent 证据化学习计划',
    title: '第二阶段 06：自然语言检索记忆并制定学习计划',
    summary:
      '用四档模拟用户、CSC148 做题记录、课程记忆、日历、笔记本和 298 道已发布真实题库，验证规划器会先决定读取哪些来源，再生成可追溯的复习计划。',
    category: 'memory',
    phaseTwoGroup: 'ai',
    entryHref: '/test/memory-ai-review-plan',
    entryLabel: '测试 Agent 证据化学习计划',
    setup: [
      ...MEMORY_TEST_SETUP,
      '复用结构化事实/日历与分层召回两条前置测试合同',
      '使用本地 CSC148 真实题库快照和浏览器中已有的课程笔记本',
      '系统 LLM 与 embedding 模型可用',
    ],
    inputs: [
      '四条自然语言学习任务与对应模拟用户',
      '考试/作业日历、近期做题记录和课程隔离的学习记忆',
      'CSC148 真实题库 RAG 与课程笔记本 RAG',
      '明确禁止读取某些来源的边界指令',
    ],
    outputs: [
      '只根据来源数量和任务生成的工具读取计划',
      '日历、记忆、作答、题库和笔记本的安全 trace 与 evidenceId',
      '重点知识点、复习理由、日期时间、方法、时长和每次真实题量',
      '每条用例覆盖保存的 latest-only 结果和机器验收',
    ],
    prompts: [
      '我三天后有 CSC148 考试，请结合日历、做题记录、记忆、课程笔记和真实题库安排未来三天复习。',
      '我今天只有 20 分钟；如果日历没有考试，不要假设截止日期。',
      '这次只看近期做题记录和真实题库，不要读取日历、长期记忆或课程笔记。',
    ],
    steps: [
      {
        title: '创建一次性模拟用户',
        action: '从四档基线复制课程内记忆、做题记录和本条用例日历。',
        evidence: '页面显示人物基线与本次 source fingerprint，运行结束立即销毁副本。',
      },
      {
        title: '先规划读取范围',
        action:
          '规划器只看自然语言任务、数据数量和工具合同，决定是否读日历、记忆、作答、题库或笔记本。',
        evidence: '每个工具的选择理由、query、limit 和未调用来源可见。',
      },
      {
        title: '执行证据检索',
        action: '按读取计划执行课程隔离检索，并对 CSC148 题库执行真实混合 RAG。',
        evidence: 'trace 展示耗时、状态、evidenceId 和真实 problemId，不展示隐藏推理。',
      },
      {
        title: '生成并验收学习计划',
        action: '只把已返回证据交给计划生成器，检查重点、理由、时间、方法和每次题量。',
        evidence: '所有计划结论引用真实 evidenceId，题目来自 298 道已发布 CSC148 快照。',
      },
    ],
    passCriteria: [
      'Agent 会按任务选择最小必要来源，而不是固定读取全部数据',
      '用户明确禁止的日历、长期记忆或笔记本不会被调用',
      '三天后考试时，日历时间和做题/记忆证据共同影响复习优先级',
      '每次复习都说明为什么、怎么做、何时开始、持续多久和做几道题',
      '题目 ID 全部来自 CSC148 真实题库，计划不虚构日历或证据',
      '所有记忆按 CSC148 课程隔离，只有基本资料作为全局 profile 证据',
      '结果不写业务数据库；每条用例刷新后只恢复最新一次结果',
    ],
    recommended: true,
    recommendationReason:
      '它把“能正确读取记忆”与“做题/提问后如何写回记忆”分开验收，也为第三阶段真正的 Skills、Function Tool、MCP 和 Agent tracing 提供稳定输入合同。',
  },
  {
    id: 'memory-ai-explanation',
    order: 10,
    shortTitle: 'AI 基于笔记本记忆回答',
    title: '第二阶段 03：AI 基于已生成笔记本回答问题',
    summary:
      '读取第二阶段 02 在当前浏览器生成的最新 CSC148 学习笔记本，分别测试 RI、class、Queue、BST 与范围外问题的真实记忆检索和回答。',
    category: 'memory',
    phaseTwoGroup: 'ai',
    entryHref: '/test/memory-ai-explanation',
    entryLabel: '测试笔记本记忆问答',
    setup: [
      ...MEMORY_TEST_SETUP,
      '第二阶段 02 已在同一浏览器生成所需 CSC148 Markdown 笔记本',
      '系统 LLM 可用',
    ],
    inputs: ['当前浏览器已生成的最新笔记本', '7 条互不影响的真实用户问题'],
    outputs: ['实际检索的笔记本与理由', '只基于检索结果生成的回答', '结构化检查与人工验收'],
    prompts: [
      'RI 是什么？',
      '不显式提醒 RI 时生成或 review class。',
      '按课程记忆处理 Queue/BST，并诚实回答范围外问题。',
    ],
    steps: [
      {
        title: '读取真实本地笔记本',
        action: '加载第二阶段 02 每份资料最新生成的 Markdown 笔记本。',
        evidence: '页面显示实际加载数量、名称与生成时间。',
      },
      {
        title: '先检索再回答',
        action: '模型先选择相关笔记本，回答阶段只接收已选择内容。',
        evidence: '检索理由、笔记本 ID、课程规则与回答分区可见。',
      },
      {
        title: '验证课程遵从与边界',
        action: '检查 RI、class、Queue、BST 格式信号，并人工判断语义质量。',
        evidence: '范围外问题不得伪造老师要求或无关记忆引用。',
      },
    ],
    passCriteria: [
      '检索到与问题真正相关的生成笔记本',
      '隐式课程契约会实际改变代码或 review',
      '范围外问题明确区分用户记忆与通用知识',
    ],
  },
];

export const MEMORY_SYSTEM_TEST_SCENARIOS = [...SECOND_PHASE_MEMORY_TEST_SCENARIO_DEFINITIONS].sort(
  (left, right) => left.order - right.order,
);

/**
 * Compatibility alias. Do not rename the scenarios or their browser-storage
 * keys: existing Phase 2 results are intentionally reused by the refactored UI.
 */
export const SECOND_PHASE_MEMORY_TEST_SCENARIOS = MEMORY_SYSTEM_TEST_SCENARIOS;

export const THIRD_PHASE_AGENT_TEST_SCENARIOS: PlatformTestScenario[] = [
  {
    id: 'agent-memory-skill-function-tool',
    order: 1,
    title: '记忆 Skill 与 Function Tool 合同',
    summary:
      '先验证记忆提取、读取、写入、更新、归档和删除能以严格 schema 调用同一个核心 executor，再允许 Agent 使用。',
    category: 'memory',
    executionStatus: 'planned',
    entryHref: '/test/agent-memory-skill-function-tool',
    entryLabel: '查看测试合同',
    setup: [
      '复用第二阶段四档用户和每个 case 的最新结果作为只读输入基线',
      '为记忆操作准备严格输入/输出 schema、side effect 和 approval policy',
    ],
    inputs: [
      '一个全局基本资料请求',
      '一个 CSC148 课程记忆请求',
      '一次 dry-run 提取',
      '一次经确认的写操作',
    ],
    outputs: [
      '加载的 SKILL.md 与版本',
      'schema 校验结果',
      '统一 result envelope',
      '脱敏 function tool trace',
    ],
    steps: [
      {
        title: '加载记忆 Skill',
        action: '只加载记忆工作流及其直接依赖的说明文档。',
        evidence: 'trace 中可见 skill id、版本、允许调用的 tools 与质量门槛。',
      },
      {
        title: '直调读取工具',
        action: '绕过 Agent，直接执行 profile read 与 course memory search。',
        evidence: '输入输出通过 strict schema，且课程请求强制携带 courseId。',
      },
      {
        title: '直调写入工具',
        action: '先生成 write proposal，确认后执行 create/update/archive/delete。',
        evidence: '未确认无副作用；确认后返回 memory id、版本、证据与 trace id。',
      },
      {
        title: '核对同一执行器',
        action: '检查所有工具最终进入的 executor id 与 schema version。',
        evidence: 'Skill 只负责编排，不复制任何记忆业务实现。',
      },
    ],
    passCriteria: [
      '所有 function tool 使用 strict-compatible schema',
      '只有用户基本资料允许无 courseId 读取',
      '所有写操作均有 approval 与幂等键',
      '第二阶段输入结果未被修改或删除',
    ],
  },
  {
    id: 'agent-memory-api-mcp-parity',
    order: 2,
    title: '记忆 REST、Function Tool 与 MCP 一致性',
    summary:
      '把同一用户的同一条记忆分别从外部 API、内部 function tool 和 MCP 调用，验证身份、scope、schema 和结果完全同源。',
    category: 'memory',
    executionStatus: 'planned',
    entryHref: '/test/agent-memory-api-mcp-parity',
    entryLabel: '查看测试合同',
    setup: [
      '为 sandbox 用户签发只映射到该用户的测试 API key',
      'REST、function tool 与 MCP 都绑定同一个 capability definition 和 executor',
    ],
    inputs: ['同一 memory id', '同一 CSC148 courseId', 'REST 请求', 'MCP tool call'],
    outputs: [
      '三入口 result envelope',
      'principal 与 scope 校验',
      'executor/schema 版本对照',
      'MCP 安全 trace',
    ],
    steps: [
      {
        title: 'REST 读取',
        action: '通过外部 API 读取当前用户当前课程的目标记忆。',
        evidence: '返回 request id、trace id、memory id、course id 与证据摘要。',
      },
      {
        title: 'Function Tool 读取',
        action: '在平台运行时用相同输入调用内部工具。',
        evidence: 'schema version、executor id 与记忆版本和 REST 相同。',
      },
      {
        title: 'MCP 发现与调用',
        action: '先列出 allowlist tools，再调用同一 read capability。',
        evidence: 'MCP 不暴露额外工具，结果 envelope 与前两种入口一致。',
      },
      {
        title: '越权负向测试',
        action: '使用另一 API key 或错误 courseId 重试。',
        evidence: '三个入口都拒绝请求，且 trace 不泄漏私有内容。',
      },
    ],
    passCriteria: [
      '三种入口复用同一个 executor 和 schema version',
      '调用方不能在 body 中覆盖 owner userId',
      '错误 courseId 和错误 principal 都无法读取结果',
      'API/MCP 错误同样返回可关联的 request id 与 trace id',
    ],
  },
  {
    id: 'agent-memory-routing-handoff-trace',
    order: 3,
    title: '记忆 Agent 路由、Agent-as-tool 与 Handoff',
    summary:
      '用真实学习请求区分“专家返回中间诊断”和“专家接管后续对话”，并在 tracing 中显示回复所有权的变化。',
    category: 'memory',
    executionStatus: 'planned',
    entryHref: '/test/agent-memory-routing-handoff-trace',
    entryLabel: '查看测试合同',
    setup: [
      '建立 main agent、memory curator、course tutor 和 review coach 的最小 tool surface',
      '测试 UI 能显示脱敏的 agent/tool/handoff/approval/memory span',
    ],
    inputs: ['“我最近树递归哪里不会？”', '“按 CSC148 老师要求解释 RI”', '“开始一轮期末复习”'],
    outputs: [
      '当前回复 owner',
      'memory curator 结构化诊断',
      'handoff 前后 agent',
      '完整父子 trace 树',
    ],
    steps: [
      {
        title: '总 Agent 读取状态',
        action: '总 Agent 调用 memory curator 作为 agent-as-tool 生成诊断。',
        evidence: 'memory curator 不接管回复；最终答案 owner 仍是 main agent。',
      },
      {
        title: '课程教师接管',
        action: '进入持续 CSC148 教学请求并 handoff 给 course tutor。',
        evidence: 'trace 明确记录 from/to agent，handoff 后 owner 变为 course tutor。',
      },
      {
        title: '复习教练接管',
        action: '用户明确开始复习后 handoff 给 review coach。',
        evidence: '后续选题、判题、诊断均属于同一复习分支。',
      },
      {
        title: '核对安全 Trace',
        action: '检查 skill、memory read、model、tool、handoff、write 与 error spans。',
        evidence: '父子关系完整，不显示隐藏推理、secret 或完整私有原文。',
      },
    ],
    passCriteria: [
      'agent-as-tool 场景中总 Agent 保持最终回复权',
      '只有持续对话所有权变化时才使用 handoff',
      '每个记忆命中都有 courseId、层级和 evidence id',
      '测试 UI 能直接定位 routing、tool、handoff 或 memory 失败',
    ],
  },
  {
    id: 'agent-memory-sandbox-isolation',
    order: 4,
    title: '记忆沙盒、课程隔离与最新结果替换',
    summary:
      '把第二阶段最新 CSC148 产物导入第三阶段沙盒，验证全局基本资料与课程记忆的边界，并只替换本用例最新运行。',
    category: 'memory',
    executionStatus: 'planned',
    entryHref: '/test/agent-memory-sandbox-isolation',
    entryLabel: '查看测试合同',
    setup: [
      'phase3-empty、phase3-csc148-active、phase3-cross-course、phase3-other-user 四个 sandbox 身份',
      '从第二阶段最新 notebook/answer/attempt/calendar 结果导入带 fingerprint 的只读 fixture',
    ],
    inputs: [
      '全局 profile 查询',
      'CSC148 学习状态查询',
      'MAT136 对照查询',
      '同一 case 连续两次运行',
    ],
    outputs: ['scope 命中统计', '跨课程/跨用户负向结果', '稳定 result key', '最新失败或成功 trace'],
    steps: [
      {
        title: '导入最新基线',
        action: '读取现有第二阶段 IndexedDB 最新结果并导入第三阶段 sandbox。',
        evidence: '保留 source case id 与 fingerprint，且不改写第二阶段数据库。',
      },
      {
        title: '验证全局资料',
        action: '在不同课程读取姓名、专业和界面语言。',
        evidence: '只返回 profile allowlist，不夹带任何课程学习状态。',
      },
      {
        title: '验证课程隔离',
        action: '对同一用户分别查询 CSC148 与 MAT136。',
        evidence: 'CSC148 证据不会在 MAT136 查询中命中，所有 SQL/RAG 均带 course filter。',
      },
      {
        title: '覆盖最新结果',
        action: '用同一 sandbox user 与 case 连续运行成功和失败。',
        evidence: '稳定 key 只指向最新一次；其他 case 和第二阶段结果均保留。',
      },
    ],
    passCriteria: [
      '只有基本资料是用户全局信息',
      '课程记忆、提问、做题、资料和日历全部按课程隔离',
      '重跑只覆盖同一 Phase 3 stable key',
      '失败运行不会回退展示旧的通过结果',
    ],
  },
];

export type PlatformTestStageId =
  | 'capability'
  | 'memory-system'
  | 'agent-integration'
  | 'release-regression';

export interface PlatformTestStageDefinition {
  id: PlatformTestStageId;
  number: number;
  anchorId: string;
  label: string;
  title: string;
  acceptanceQuestion: string;
  responsibility: string;
  completionGate: string;
  scenarioIds: string[];
  state: 'ready' | 'next' | 'gate';
  compatibilityNote?: string;
}

export const PLATFORM_TEST_STAGES: PlatformTestStageDefinition[] = [
  {
    id: 'capability',
    number: 1,
    anchorId: 'phase-one-capability-title',
    label: '第一阶段',
    title: '原子业务能力',
    acceptanceQuestion: '单个模块离开总 Agent 后，能否独立产生正确、可保存的结果？',
    responsibility: '业务 service、外部 REST API、输入输出与产物正确性',
    completionGate: '每条核心能力都能独立运行、留证并从失败中恢复。',
    scenarioIds: CORE_PLATFORM_TEST_SCENARIOS.map((scenario) => scenario.id),
    state: 'ready',
  },
  {
    id: 'memory-system',
    number: 2,
    anchorId: 'phase-two-memory-title',
    label: '第二阶段',
    title: '用户状态与记忆系统',
    acceptanceQuestion: '平台知道用户什么，如何提取、写入、更新、查询和隔离这些信息？',
    responsibility: '记忆来源、CRUD、static/dynamic/RAG、用户与课程 scope',
    completionGate: '五类来源可追溯；只有基本资料全局，其余学习记忆全部按课程隔离。',
    scenarioIds: MEMORY_SYSTEM_TEST_SCENARIOS.map((scenario) => scenario.id),
    state: 'ready',
    compatibilityNote:
      '沿用原第二阶段 scenario ID 与浏览器存储契约；已有结果不迁移、不清空，仍按 case 只保留最新结果。',
  },
  {
    id: 'agent-integration',
    number: 3,
    anchorId: 'phase-three-agent-title',
    label: '第三阶段',
    title: 'Agent 调用与协议层',
    acceptanceQuestion:
      'Agent 是否能经由 Skill、function tool、MCP 和 handoff 正确调用第二阶段记忆？',
    responsibility: 'typed executor、外部 API/MCP、agent-as-tool、handoff、approval 与 tracing',
    completionGate: '四个记忆优先工作包通过后，能力才允许加入总 Agent 默认 tool surface。',
    scenarioIds: THIRD_PHASE_AGENT_TEST_SCENARIOS.map((scenario) => scenario.id),
    state: 'next',
    compatibilityNote:
      '第三阶段只读取第二阶段最新产物作为 fixture；自己的结果使用新 stable key，绝不覆盖第二阶段结果。',
  },
  {
    id: 'release-regression',
    number: 4,
    anchorId: 'release-regression-title',
    label: '第四阶段',
    title: '总 Agent 与发布回归',
    acceptanceQuestion: '真实用户任务在总 Agent 中是否端到端可靠，且不会跨模块或跨 scope 跑偏？',
    responsibility: '总 Agent 产品入口、完整学习闭环、成本与发布 gate',
    completionGate: '代表性真实任务、失败恢复、安全隔离与 trace grading 全部通过。',
    scenarioIds: RECOMMENDED_PLATFORM_TEST_SCENARIOS.map((scenario) => scenario.id),
    state: 'gate',
  },
];

export function isMemoryPhaseTwoScenario(
  scenarioId: string,
): scenarioId is MemoryPhaseTwoTestScenario['id'] {
  return MEMORY_SYSTEM_TEST_SCENARIOS.some((scenario) => scenario.id === scenarioId);
}

export function isAgentPhaseThreeScenario(scenarioId: string): boolean {
  return THIRD_PHASE_AGENT_TEST_SCENARIOS.some((scenario) => scenario.id === scenarioId);
}

export const PLATFORM_TEST_SCENARIOS = [
  ...CORE_PLATFORM_TEST_SCENARIOS,
  ...MEMORY_SYSTEM_TEST_SCENARIOS,
  ...THIRD_PHASE_AGENT_TEST_SCENARIOS,
  ...RECOMMENDED_PLATFORM_TEST_SCENARIOS,
];

export const PRESERVED_MEMORY_SCENARIO_IDS = [
  'memory-simulated-user',
  'memory-source-upload-writeback',
  'memory-ai-explanation',
  'memory-problem-writeback',
  'memory-question-writeback',
  'memory-structured-facts-calendar',
  'memory-layered-query',
] as const;

export type PlatformTestRegistryValidation = {
  ok: boolean;
  errors: string[];
};

export function validatePlatformTestRegistry(): PlatformTestRegistryValidation {
  const errors: string[] = [];
  const allScenarioIds = PLATFORM_TEST_SCENARIOS.map((scenario) => scenario.id);
  const uniqueScenarioIds = new Set(allScenarioIds);
  if (uniqueScenarioIds.size !== allScenarioIds.length) {
    errors.push('测试场景 ID 存在重复。');
  }

  for (const scenarioId of PRESERVED_MEMORY_SCENARIO_IDS) {
    if (!MEMORY_SYSTEM_TEST_SCENARIOS.some((scenario) => scenario.id === scenarioId)) {
      errors.push(`兼容场景 ${scenarioId} 已从记忆测试中移除。`);
    }
  }

  if (SECOND_PHASE_MEMORY_TEST_SCENARIOS !== MEMORY_SYSTEM_TEST_SCENARIOS) {
    errors.push('第二阶段兼容导出不再指向原记忆测试数组。');
  }

  const stagedScenarioIds = PLATFORM_TEST_STAGES.flatMap((stage) => stage.scenarioIds);
  for (const scenarioId of uniqueScenarioIds) {
    const stageCount = stagedScenarioIds.filter((stagedId) => stagedId === scenarioId).length;
    if (stageCount !== 1) {
      errors.push(`场景 ${scenarioId} 应且只应属于一个阶段，当前为 ${stageCount} 个。`);
    }
  }
  for (const scenarioId of stagedScenarioIds) {
    if (!uniqueScenarioIds.has(scenarioId)) {
      errors.push(`阶段注册表引用了不存在的场景 ${scenarioId}。`);
    }
  }

  for (const scenario of THIRD_PHASE_AGENT_TEST_SCENARIOS) {
    if (scenario.executionStatus !== 'planned') {
      errors.push(`第三阶段场景 ${scenario.id} 在运行链路完成前必须保持 planned。`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export const PLATFORM_TEST_REGISTRY_VALIDATION = validatePlatformTestRegistry();

if (!PLATFORM_TEST_REGISTRY_VALIDATION.ok) {
  throw new Error(`平台测试注册表无效：${PLATFORM_TEST_REGISTRY_VALIDATION.errors.join('；')}`);
}

export function getPlatformTestScenario(id: string): PlatformTestScenario | undefined {
  return PLATFORM_TEST_SCENARIOS.find((scenario) => scenario.id === id);
}

export function getPlatformTestStageForScenario(
  scenarioId: string,
): PlatformTestStageDefinition | undefined {
  return PLATFORM_TEST_STAGES.find((stage) => stage.scenarioIds.includes(scenarioId));
}
