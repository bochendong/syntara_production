export type NotebookMemoryAnswerCase = {
  id: string;
  title: string;
  shortTitle: string;
  kind: 'direct_recall' | 'implicit_contract' | 'diagnosis' | 'generation' | 'outside_scope';
  question: string;
  purpose: string;
  requiredNotebookGroups: string[][];
  answerSignalGroups: string[][];
  manualCriteria: string[];
};

export type NotebookMemoryCandidate = {
  id: string;
  sourceCaseId: string;
  title: string;
  filename: string;
  content: string;
  generatedAt: number;
};

export type NotebookMemoryAnswerResponse = {
  action: 'answer_from_notebook_memory';
  caseId: string;
  model: string;
  persistence: 'none';
  retrieval: {
    memoryScope: 'supported' | 'partially_supported' | 'outside_notebooks';
    selectedNotebookIds: string[];
    validSelectedNotebookIds: string[];
    selectionReason: string;
    matches: Array<{
      notebookId: string;
      reason: string;
      rememberedRules: string[];
    }>;
    missingKnowledge: string[];
  };
  answer: {
    answerMarkdown: string;
    appliedNotebookIds: string[];
    courseRulesApplied: string[];
    boundaryStatement: string;
    selfChecks: string[];
  };
  machineChecks: Array<{ id: string; label: string; passed: boolean; detail: string }>;
  passedMachineCheck: boolean;
  usage: { retrieval: unknown; answer: unknown };
};

export const CSC148_NOTEBOOK_MEMORY_ANSWER_CASES: NotebookMemoryAnswerCase[] = [
  {
    id: 'define-ri',
    title: '直接询问 RI 是什么',
    shortTitle: 'RI 的含义与生效时机',
    kind: 'direct_recall',
    question:
      'CSC148 里的 RI 到底是什么？它约束一个可变 class 的哪些状态和哪些时刻？请结合一个很小的例子讲清楚。',
    purpose: '检查 AI 能否直接找到 OOP 笔记本，并准确解释课程中的 Representation Invariant。',
    requiredNotebookGroups: [['oop-class-design']],
    answerSignalGroups: [
      ['representation invariant', 'representation invariants', '表示不变量'],
      ['合法状态', '有效状态', '始终满足', '约束'],
      ['__init__', 'public method', 'public methods', '公共方法'],
    ],
    manualCriteria: [
      '解释的是对象表示的合法状态，而不是把 RI 误说成普通 input precondition。',
      '说明 constructor 建立 RI、public method 在返回前恢复 RI。',
      '例子中的约束、初始化和修改操作能够互相对应。',
    ],
  },
  {
    id: 'implicit-class-contract',
    title: '写 class，但不显式提 RI',
    shortTitle: '隐式遵从老师的 class 契约',
    kind: 'implicit_contract',
    question: [
      '请为 CSC148 写一个 `Playlist` class。',
      '',
      '- 每首歌用非空字符串表示，不能重复；',
      '- 支持 `add_track`、`remove_track`、`__contains__` 和 `__len__`；',
      '- 删除不存在的歌曲时抛出一个清楚的自定义异常；',
      '- 给出完整、可运行的实现和两个 pytest 测试。',
    ].join('\n'),
    purpose: '问题不提醒 RI，检查 AI 是否仍会从课程笔记本自动恢复 class 文档与表示约束。',
    requiredNotebookGroups: [['oop-class-design']],
    answerSignalGroups: [
      ['representation invariants:'],
      ['attributes:', 'instance attributes:', 'private attributes:'],
      ['__init__'],
      ['add_track'],
      ['remove_track'],
    ],
    manualCriteria: [
      '没有因为用户未提 RI 就省略老师要求的 class docstring 结构。',
      '所有 public methods 返回前仍保持歌曲非空且不重复。',
      '自定义异常与测试覆盖重复添加、缺失删除等边界。',
    ],
  },
  {
    id: 'detect-missing-ri',
    title: '提交 class，未写 RI',
    shortTitle: '从代码中检测隐藏问题',
    kind: 'diagnosis',
    question: [
      '请按 CSC148 的课程标准 review 下面这段提交，指出会影响正确性或课程规范的问题，并给出修正版。',
      '',
      '```python',
      'class TemperatureLog:',
      '    """A log of temperature readings."""',
      '',
      '    readings: list[float]',
      '',
      '    def __init__(self, readings: list[float]) -> None:',
      '        self.readings = readings',
      '',
      '    def add(self, value: float) -> None:',
      '        self.readings.append(value)',
      '',
      '    def average(self) -> float:',
      '        return sum(self.readings) / len(self.readings)',
      '```',
    ].join('\n'),
    purpose: '检查 AI 能否主动发现缺少课程 RI、外部 alias 和非法温度/空列表状态，而不是只做语法 review。',
    requiredNotebookGroups: [['oop-class-design'], ['python-memory-model']],
    answerSignalGroups: [
      ['representation invariants:'],
      ['alias', 'aliasing', '别名', 'copy', '复制'],
      ['-273.15', 'absolute zero', '绝对零'],
      ['empty', '空列表', '非空'],
    ],
    manualCriteria: [
      '能区分直接保存传入 list 造成的 alias 与普通 reassignment。',
      '修正版明确决定空日志是否允许，并让 average 的行为与该决定一致。',
      '不是只补一段注释，而是让 constructor 和 mutator 真正维护约束。',
    ],
  },
  {
    id: 'detect-bst-course-format',
    title: 'BST 提交未按老师格式',
    shortTitle: '识别 BST 表示与格式偏差',
    kind: 'diagnosis',
    question: [
      '这是我准备提交的 BST。请按老师在 CSC148 笔记本里的标准批改：先列问题，再给出最小修正版。',
      '',
      '```python',
      'class BinarySearchTree:',
      '    """Store values in a binary search tree."""',
      '',
      '    root: object | None',
      '    left: "BinarySearchTree | None"',
      '    right: "BinarySearchTree | None"',
      '',
      '    def __init__(self, root=None) -> None:',
      '        self.root = root',
      '        self.left = None',
      '        self.right = None',
      '',
      '    def insert(self, item: object) -> None:',
      '        if item < self.root:',
      '            self.left = BinarySearchTree(item)',
      '        else:',
      '            self.right = BinarySearchTree(item)',
      '```',
    ].join('\n'),
    purpose: '检查 AI 是否同时取回 class recipe 与 tree/BST 笔记本，发现命名、空树表示、递归 mutation 和 ordering invariant。',
    requiredNotebookGroups: [['oop-class-design'], ['trees-and-bsts']],
    answerSignalGroups: [
      ['representation invariants:'],
      ['_root'],
      ['_left'],
      ['_right'],
      ['ordering', '左', 'right', '右'],
    ],
    manualCriteria: [
      '指出当前 insert 会覆盖已有 subtree，而不是递归插入。',
      '修正版的 empty-tree 表示与 attributes 类型互相一致。',
      'BST ordering invariant、重复值策略和 O(h) 路径被明确说明。',
    ],
  },
  {
    id: 'queue-with-stacks',
    title: '用 Stack 实现 Queue',
    shortTitle: '组合 ADT 时仍遵从 RI',
    kind: 'generation',
    question: [
      '请用两个已有的 `Stack` 实例实现一个 CSC148 `Queue` class。',
      '',
      '需要支持 `enqueue`、`dequeue`、`is_empty`；空 queue 的 `dequeue` 要抛出自定义异常。',
      '请解释每个操作的最坏运行时间与 amortized running time，并给出完整代码。',
    ].join('\n'),
    purpose: '检查 Queue 问题能否同时提取 ADT 接口与 OOP 表示契约，并把两个 Stack 的状态关系写清楚。',
    requiredNotebookGroups: [['abstract-data-types'], ['oop-class-design']],
    answerSignalGroups: [
      ['representation invariants:'],
      ['enqueue'],
      ['dequeue'],
      ['stack', '_in', '_out', 'incoming', 'outgoing'],
      ['amortized', '摊还'],
    ],
    manualCriteria: [
      'client 只通过 Stack public interface 操作，不绕过抽象访问内部 list。',
      '两个 Stack 的顺序关系与转移条件足以说明 Queue 的 FIFO 行为。',
      '最坏复杂度与摊还复杂度没有混为一谈。',
    ],
  },
  {
    id: 'generate-bst-course-format',
    title: '按老师格式写 BST',
    shortTitle: '主动复用 BST 课程模板',
    kind: 'generation',
    question: [
      '请按照老师在 CSC148 课程笔记本中的格式，写一个支持空树、`__contains__` 和 `insert` 的 `BinarySearchTree`。',
      '要求给出完整 class、一个递归 trace，以及平衡树和链状树下的运行时间。',
    ].join('\n'),
    purpose: '检查明确要求课程格式时，AI 能否组合 OOP 与 BST 两份记忆生成完整、可运行的实现。',
    requiredNotebookGroups: [['oop-class-design'], ['trees-and-bsts']],
    answerSignalGroups: [
      ['representation invariants:'],
      ['_root'],
      ['_left'],
      ['_right'],
      ['__contains__'],
      ['insert'],
      ['o(h)', 'height', '高度'],
    ],
    manualCriteria: [
      'class docstring 的标题、attributes 与 RI 使用老师要求的准确格式。',
      '空树、叶节点和递归分支保持同一种表示，不临时切换数据模型。',
      '复杂度先写 O(h)，再分别解释平衡与链状情况。',
    ],
  },
  {
    id: 'outside-notebook-scope',
    title: '问题不在笔记本范围',
    shortTitle: '测试记忆边界与诚实回答',
    kind: 'outside_scope',
    question:
      '请根据老师上传的 CSC148 笔记本，解释 PostgreSQL 的 MVCC、事务快照和 vacuum，并按照老师的固定模板实现一个简化版 transaction manager。',
    purpose: '检查检索器会不会把普通 Python/树笔记本硬套到无关问题，并观察 AI 如何声明记忆边界。',
    requiredNotebookGroups: [],
    answerSignalGroups: [],
    manualCriteria: [
      '明确说明现有 CSC148 笔记本没有 PostgreSQL/MVCC 课程依据。',
      '没有编造“老师固定模板”或伪造笔记本引用。',
      '若继续提供通用知识，会清楚标注其来自通用知识而不是用户记忆。',
    ],
  },
];

export function getNotebookMemoryAnswerCase(caseId: string) {
  return CSC148_NOTEBOOK_MEMORY_ANSWER_CASES.find((item) => item.id === caseId);
}
