export type LocalQuestionWritebackCase = {
  id: string;
  fixtureUserId: string;
  title: string;
  relationLabel: string;
  sourceFilename: string | null;
  sourceTitle: string;
  userMessage: string;
  messageKind:
    | 'direct_question'
    | 'casual_followup'
    | 'pasted_problem'
    | 'pasted_code'
    | 'pasted_error'
    | 'ambiguous'
    | 'outside_course';
  expectedWorkingMemory: 'update' | 'skip';
  expectedDurableMemory: 'create' | 'revise' | 'skip';
  expectedReason: string;
  manualCriteria: string[];
};

export type LocalQuestionDiagnosisResponse = {
  action: 'diagnose_question';
  caseId: string;
  model: string;
  source: {
    filename: string | null;
    title: string;
    matchedSections: string[];
  };
  assistantReply: string;
  diagnosis: {
    category:
      | 'definition'
      | 'clarification'
      | 'pasted_problem'
      | 'code_review'
      | 'error_debug'
      | 'outside_course';
    courseRelevant: boolean;
    knowledgePoint: string;
    masteredSignal: string | null;
    stuckPoint: string | null;
    cause: string | null;
    nextTeachingMove: string;
    confidence: 'low' | 'medium' | 'high';
    evidenceFromMessage: string[];
    workingMemoryAction: 'update' | 'skip';
    durableMemoryAction: 'create' | 'revise' | 'skip';
    durableMemoryReason: string;
    layerRouting: {
      sourceOfTruth: 'conversation_message';
      controlFacts: 'read_only';
      shortTerm: 'overwrite' | 'skip';
      longTerm: 'create' | 'revise' | 'skip';
      knowledgeBase: 'read_only';
      knowledgeCache: 'read_only';
    };
  };
  usage: unknown;
  persistence: 'none';
};

export const CSC148_QUESTION_WRITEBACK_CASES: LocalQuestionWritebackCase[] = [
  {
    id: 'zhou-casual-ri-definition',
    fixtureUserId: 'memory-test-novice-001',
    title: '“RI 到底是啥啊”',
    relationLabel: '口语短问 · 新概念',
    sourceFilename: '3_OOP.md',
    sourceTitle: 'OOP、Representation Invariants 与 Class Design Recipe',
    userMessage: 'RI到底是啥啊，为啥每个class都要写这个',
    messageKind: 'direct_question',
    expectedWorkingMemory: 'update',
    expectedDurableMemory: 'skip',
    expectedReason:
      '能更新当前学习起点，但一次定义性提问不足以证明稳定薄弱点，不应立刻固化为长期记忆。',
    manualCriteria: [
      '识别出 RI 指 Representation Invariants，而不是要求用户补充缩写含义。',
      '回答使用 CSC148 class docstring 与 public method 的课程语境。',
      '记忆记录当前不熟悉 RI，不复制整句聊天作为长期记忆。',
    ],
  },
  {
    id: 'lin-casual-alias-followup',
    fixtureUserId: 'memory-test-foundation-001',
    title: '“直接赋值不行吗”',
    relationLabel: '口语追问 · 暴露心智模型',
    sourceFilename: '1_The_Python_Memory_Model.md',
    sourceTitle: 'Python Memory Model、aliasing 与 mutation',
    userMessage: '这里为啥非要copy啊，直接 self.items = items 不行吗',
    messageKind: 'casual_followup',
    expectedWorkingMemory: 'update',
    expectedDurableMemory: 'create',
    expectedReason:
      '问题直接暴露“赋值会复制对象”的错误心智模型，可形成可教学的 aliasing 薄弱记忆。',
    manualCriteria: [
      '区分变量重新绑定、共享引用和复制对象。',
      '解释是否需要 copy 取决于 class contract，而不是笼统说必须 copy。',
      '诊断包含掌握、薄弱、原因和下一教学动作。',
    ],
  },
  {
    id: 'chen-pastes-class-python-ta-error',
    fixtureUserId: 'memory-test-intermediate-001',
    title: '粘贴 class 问 python_ta',
    relationLabel: '代码粘贴 · 课程格式诊断',
    sourceFilename: '3_OOP.md',
    sourceTitle: 'OOP、Representation Invariants 与 Class Design Recipe',
    userMessage: [
      'python_ta为啥一直说我这个class不对',
      '',
      '```python',
      'class Playlist:',
      '    """A playlist."""',
      '    songs: list[str]',
      '',
      '    def __init__(self, songs: list[str]) -> None:',
      '        self.songs = songs',
      '',
      '    def add(self, song: str) -> None:',
      '        self.songs.append(song)',
      '```',
    ].join('\n'),
    messageKind: 'pasted_code',
    expectedWorkingMemory: 'update',
    expectedDurableMemory: 'create',
    expectedReason:
      '代码提供了缺少课程 docstring sections、RI 与 aliasing 决策的直接证据，足以写入长期诊断。',
    manualCriteria: [
      '发现准确标题 `Representation Invariants:`，而不只给通用 PEP 8 建议。',
      '指出 public/private attribute 命名及传入 list aliasing 的设计选择。',
      '长期记忆保存课程能力缺口而不是整段代码。',
    ],
  },
  {
    id: 'zhou-pastes-queue-assignment',
    fixtureUserId: 'memory-test-novice-001',
    title: '直接粘贴 Queue 题目',
    relationLabel: '题目粘贴 · 尚无作答证据',
    sourceFilename: '4_ADT.md',
    sourceTitle: 'Abstract Data Types、Stacks 与 Queues',
    userMessage: [
      '这题到底让我干嘛',
      '',
      '> Implement the Queue ADT using two Stack objects. Your implementation must provide',
      '> enqueue, dequeue, and is_empty. Do not access the Stack implementation directly.',
      '> State the running time of every public method and describe empty-queue behaviour.',
    ].join('\n'),
    messageKind: 'pasted_problem',
    expectedWorkingMemory: 'update',
    expectedDurableMemory: 'skip',
    expectedReason: '只粘贴题目说明当前任务和需要拆题，但没有学生答案，不能推断稳定掌握或薄弱。',
    manualCriteria: [
      '先把题目拆成接口、表示、异常和复杂度四项，而不是直接替学生交完整答案。',
      '不把“看不懂题目”自动等同于不会 Queue。',
      '工作记忆记录当前任务，长期记忆保持不变。',
    ],
  },
  {
    id: 'lin-pastes-two-stack-queue-code',
    fixtureUserId: 'memory-test-foundation-001',
    title: '粘贴 Queue 实现问“这样不行吗”',
    relationLabel: '代码粘贴 · 接口与顺序误解',
    sourceFilename: '4_ADT.md',
    sourceTitle: 'Abstract Data Types、Stacks 与 Queues',
    userMessage: [
      '我这样不就行了吗，为啥测例顺序反了',
      '',
      '```python',
      'class Queue:',
      '    def __init__(self):',
      '        self._stack = Stack()',
      '',
      '    def enqueue(self, item):',
      '        self._stack.push(item)',
      '',
      '    def dequeue(self):',
      '        return self._stack.pop()',
      '```',
    ].join('\n'),
    messageKind: 'pasted_code',
    expectedWorkingMemory: 'update',
    expectedDurableMemory: 'create',
    expectedReason: '代码清楚显示把 Stack 的 LIFO 当成 Queue 的 FIFO，形成可复用的 ADT 语义缺口。',
    manualCriteria: [
      '明确指出失败来自 LIFO/FIFO 顺序，而不是语法。',
      '解释 two-stack 转移条件与 empty exception。',
      '记忆写的是接口语义误解，不是“测试没过”这一结果。',
    ],
  },
  {
    id: 'gu-pastes-bst-submission',
    fixtureUserId: 'memory-test-advanced-001',
    title: '粘贴 BST 问“这个能交吗”',
    relationLabel: '代码粘贴 · 高阶 review',
    sourceFilename: '8_trees.md',
    sourceTitle: 'Trees、BSTs、RI 与递归 mutation',
    userMessage: [
      '这个能交吗',
      '',
      '```python',
      'class BinarySearchTree:',
      '    def insert(self, item):',
      '        if self._root is None:',
      '            self._root = item',
      '        elif item < self._root:',
      '            self._left = BinarySearchTree(item)',
      '        else:',
      '            self._right = BinarySearchTree(item)',
      '```',
    ].join('\n'),
    messageKind: 'pasted_code',
    expectedWorkingMemory: 'update',
    expectedDurableMemory: 'create',
    expectedReason:
      '实现会覆盖已有 subtree，说明 recursive mutation 与 BST RI 的稳定检查仍有缺口。',
    manualCriteria: [
      '发现 insert 会覆盖已有左右子树，并给出递归插入路径。',
      '结合课程 empty-tree 表示和 BST ordering invariant，而不是只说缺类型标注。',
      '高阶用户的长期记忆只记录新盲点，不降低其全部树知识评价。',
    ],
  },
  {
    id: 'chen-pastes-exception-traceback',
    fixtureUserId: 'memory-test-intermediate-001',
    title: '粘贴 traceback 问“咋还是炸了”',
    relationLabel: '错误粘贴 · exception flow',
    sourceFilename: '5_Exception.md',
    sourceTitle: 'Exceptions、Propagation 与 try-except 设计',
    userMessage: [
      '我都写try了咋还是炸了',
      '',
      '```python',
      'try:',
      '    value = int(text)',
      '    print(10 / value)',
      'except TypeError:',
      '    print("bad input")',
      '```',
      '',
      "`ValueError: invalid literal for int() with base 10: 'abc'`",
    ].join('\n'),
    messageKind: 'pasted_error',
    expectedWorkingMemory: 'update',
    expectedDurableMemory: 'create',
    expectedReason:
      'traceback 与 handler 提供了精确证据：学生尚未建立 raise 类型和 handler matching 的模型。',
    manualCriteria: [
      '根据实际 ValueError 解释 handler 不匹配，并区分随后可能出现的 ZeroDivisionError。',
      '不建议 bare except 或笼统捕获 Exception。',
      '下一教学动作要求逐行追踪 raise 点和匹配顺序。',
    ],
  },
  {
    id: 'zhou-ambiguous-no-context',
    fixtureUserId: 'memory-test-novice-001',
    title: '只有一句“这块没懂”',
    relationLabel: '上下文不足 · 不猜记忆',
    sourceFilename: null,
    sourceTitle: '没有可确认的课程上下文',
    userMessage: '这块还是没懂',
    messageKind: 'ambiguous',
    expectedWorkingMemory: 'skip',
    expectedDurableMemory: 'skip',
    expectedReason: '没有指代对象、题目或作答证据，应先追问，不猜测具体知识缺口。',
    manualCriteria: [
      '回复先询问“哪一块”并邀请粘贴题目、代码或截图。',
      '没有把 baseline 中已有的递归薄弱点擅自当成本轮主题。',
      '短期与长期学习记忆都不发生变化。',
    ],
  },
  {
    id: 'gu-outside-course-question',
    fixtureUserId: 'memory-test-advanced-001',
    title: '提问不在 CSC148 资料范围',
    relationLabel: '范围外 · 不污染课程记忆',
    sourceFilename: null,
    sourceTitle: '现有 CSC148 资料无相关内容',
    userMessage: 'SQL里left join和inner join到底差在哪，我老搞混',
    messageKind: 'outside_course',
    expectedWorkingMemory: 'skip',
    expectedDurableMemory: 'skip',
    expectedReason: '当前测试范围只有 CSC148 资料，不能把 SQL 问题写进该课程的学习记忆。',
    manualCriteria: [
      '明确当前 CSC148 资料不能支持课程特定回答。',
      '可以提供通用解释，但不伪造老师要求或笔记本引用。',
      '不污染 CSC148 的短期或长期学习状态。',
    ],
  },
];

export function getCsc148QuestionWritebackCase(caseId: string) {
  return CSC148_QUESTION_WRITEBACK_CASES.find((item) => item.id === caseId);
}
