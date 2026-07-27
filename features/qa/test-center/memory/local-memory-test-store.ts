'use client';

import {
  clearStudyMemory,
  loadStudyMemory,
  recordNotebookPrivateMemory,
  recordNotebookPublicMemory,
  saveStudyMemory,
  updateNotebookWorkingMemory,
  type NotebookMemoryItem,
  type NotebookWorkingMemory,
  type StudyMemoryProfile,
} from '@/lib/learning/study-memory';
import {
  addCourseMaterials,
  deleteCourseMaterial,
  listCourseMaterials,
  type CourseMaterialListItem,
} from '@/lib/utils/course-material-storage';
import { clearQuestionProgress, setQuestionProgress } from '@/lib/utils/quiz-question-progress';
import {
  gradeObjectiveQuestions,
  gradeTextQuestion,
  isObjectiveQuestion,
  type AnswerValue,
} from '@/components/scene-renderers/quiz-view-utils';
import type { QuizQuestion } from '@/lib/types/stage';
import {
  CSC148_SOURCE_UPLOAD_CASES,
  getCsc148SourceUploadCase,
  type Csc148SourceUploadCase,
} from '@/features/qa/test-center/memory/csc148-source-upload-cases';
import {
  getCsc148QuestionWritebackCase,
  type LocalQuestionDiagnosisResponse,
} from '@/features/qa/test-center/memory/csc148-question-writeback-cases';
import type { PlatformFlowOutput } from '@/features/qa/test-center/workspace/types';
import { MEMORY_TEST_RESULT_STORAGE_CONTRACT } from '@/features/qa/test-center/memory/result-storage-contract';
import { backendJson } from '@/lib/utils/backend-api';
import {
  normalizeAttemptMemoryDiagnosis,
  type AttemptMemoryDiagnosis,
} from '@/features/memory/domain/learner-memory-update';

const STORAGE_PREFIX = MEMORY_TEST_RESULT_STORAGE_CONTRACT.localSandbox.storagePrefix;
const DEFAULT_USER_NAME = '第二阶段本地记忆模拟用户';
const TEST_SCENE_ID = 'memory-local-recursion-scene';
const COHORT_SEED_VERSION = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

export type LocalMemoryLearnerProfile = {
  levelId: 'novice' | 'foundation' | 'intermediate' | 'advanced';
  levelLabel: string;
  masteryPercent: number;
  summary: string;
  mastered: string[];
  weaknesses: string[];
  nextTeachingMove: string;
};

export type LocalMemoryTestUserFixture = {
  userId: string;
  name: string;
  learnerProfile: LocalMemoryLearnerProfile;
  explanationPreference: {
    language: string;
    order: string[];
    avoid: string[];
  };
  studyHabit: {
    preferredMinutes: number;
    preferredTime: string;
    questionCount: number;
  };
  usageProfile: {
    usageTier: 'new' | 'light' | 'active' | 'heavy';
    usageLabel: string;
    accountAgeDays: number;
    activeDays: number;
    studySessions: number;
    problemCount: number;
    attemptCount: number;
    conversationCount: number;
    materialCount: number;
    calendarEventCount: number;
    reviewCount: number;
    durablePrivateMemoryCount: number;
  };
};

export type LocalProblemWritebackCase = {
  id: string;
  fixtureUserId: string;
  title: string;
  description: string;
  relationLabel: string;
  chapter: string;
  sourceFilename?: string;
  sourceTitle?: string;
  problemTitle: string;
  questionPrompt: string;
  questionType: 'single' | 'multiple' | 'short_answer' | 'proof' | 'code_tracing';
  points: number;
  options?: Array<{ id: string; text: string }>;
  referenceAnswer: string | string[];
  rubric: string;
  analysis: string;
  concept: string;
  difficulty: 'intro' | 'core' | 'advanced';
  sourceMode: 'existing_problem' | 'new_problem';
  writeMode:
    | 'create_long_term'
    | 'revise_long_term'
    | 'strengthen_long_term'
    | 'working_only'
    | 'no_memory';
  memoryKind?: 'mistake' | 'knowledge_gap' | 'reflection';
  expectedMemoryChange: string;
  attempts: Array<{
    answer: string;
    selectedOptionIds?: string[];
    submissionContext?: string;
  }>;
  masteredSignal: string;
  stuckPoint?: string;
  cause?: string;
  nextTeachingMove: string;
};

export type LocalAttemptDiagnosisResponse = {
  action: 'diagnose_attempt';
  caseId: string;
  model: string;
  diagnosis: AttemptMemoryDiagnosis;
  usage: unknown;
  persistence: 'none';
};

export const LOCAL_PROBLEM_WRITEBACK_CASES: LocalProblemWritebackCase[] = [
  {
    id: 'zhou-python-alias-object-trace',
    fixtureUserId: 'memory-test-novice-001',
    title: '周小满做 aliasing 选择题',
    description:
      '基于 Python Memory Model 资料，检查错误选项是否产生对象引用与 mutation 的新缺口。',
    relationLabel: '选择题 · 新知识缺口',
    chapter: 'Python Memory Model',
    sourceFilename: '1_The_Python_Memory_Model.md',
    sourceTitle: 'Python Memory Model、aliasing 与 mutation',
    problemTitle: '对象图与 aliasing · 课程题 1',
    questionPrompt: [
      '执行下面代码后，哪一个选项准确描述 `x`、`y`、`z`？',
      '',
      '```python',
      'x = [[1], [2]]',
      'y = x',
      'z = list(x)',
      'y[0].append(9)',
      'z.append([3])',
      '```',
    ].join('\n'),
    questionType: 'single',
    points: 4,
    options: [
      { id: 'A', text: '`x`、`y`、`z` 是三个完全独立的对象图。' },
      {
        id: 'B',
        text: '`x is y` 为 True；`z` 是新的外层 list，但三个变量仍共享原来的两个内层 list。',
      },
      { id: 'C', text: '`list(x)` 会递归复制所有内层 list，所以只有 `x` 与 `y` 共享。' },
      { id: 'D', text: '`z.append([3])` 也会让 `x` 和 `y` 的外层 list 多出 `[3]`。' },
    ],
    referenceAnswer: 'B',
    rubric: '必须选择 B。外层浅拷贝与内层共享引用是本题的两个独立判断点。',
    analysis: '`list(x)` 只创建新的外层 list，元素引用仍指向相同内层对象。',
    concept: '可变对象与 aliasing',
    difficulty: 'core',
    sourceMode: 'new_problem',
    writeMode: 'working_only',
    memoryKind: 'mistake',
    expectedMemoryChange:
      '单次客观错题只更新短期状态；保留 attempt 证据，等待同模式重复或独立题再次暴露后再晋升长期记忆。',
    attempts: [{ answer: '选 C', selectedOptionIds: ['C'] }],
    masteredSignal: '知道 `y = x` 会让两个变量引用同一个外层 list。',
    stuckPoint: '把 `list(x)` 误认为会递归复制所有嵌套对象。',
    cause: '尚未用对象图区分容器对象与容器中保存的引用。',
    nextTeachingMove:
      '画出三个外层变量和两个内层 list 的 object/reference 图，再逐行执行 mutation。',
  },
  {
    id: 'chen-testing-suite-reviews-gap',
    fixtureUserId: 'memory-test-intermediate-001',
    title: '陈知遥用课程标准补全测试集',
    description:
      '复用 baseline 中的测试设计题，正确区分 pytest、输入分区与 code coverage 的证据边界。',
    relationLabel: '旧题答对 · 修正既有记忆',
    chapter: 'Testing Your Code',
    sourceFilename: '2_Testing_Your_code.md',
    sourceTitle: 'pytest、测试分区与 code coverage',
    problemTitle: '测试设计 · 练习 8',
    questionPrompt:
      '一个 `classify_age(age)` 的 pytest suite 达到 100% line coverage。以下哪些内容仍然必须单独检查，才能对正确性形成有说服力的证据？可多选。',
    questionType: 'multiple',
    points: 6,
    options: [
      { id: 'A', text: '既然 line coverage 是 100%，无需再看断言内容。' },
      { id: 'B', text: '年龄分区边界，例如 0、12/13、17/18。' },
      { id: 'C', text: '只要增加更多随机正常年龄，就能替代边界测试。' },
      { id: 'D', text: 'precondition 之外输入应当如何处理，以及测试是否遵从该契约。' },
      { id: 'E', text: '每条执行过的代码行都证明其计算结果正确。' },
      { id: 'F', text: '断言的 expected value 是否真的对应规格，而不是照抄实现。' },
    ],
    referenceAnswer: ['B', 'D', 'F'],
    rubric: '必须且只能选择 B、D、F；平台选项判题不接受部分匹配。',
    analysis: 'coverage 只说明执行过哪些行，不证明分区、边界或 expected values 正确。',
    concept: '测试设计',
    difficulty: 'core',
    sourceMode: 'existing_problem',
    writeMode: 'revise_long_term',
    expectedMemoryChange: '更新短期状态，并原地把“测试只覆盖正常路径”的旧缺口修正为复习进展。',
    attempts: [{ answer: 'B、D、F', selectedOptionIds: ['B', 'D', 'F'] }],
    masteredSignal:
      '能从规格分区、边界与 expected values 评估测试证据，不再把 coverage 当正确性证明。',
    nextTeachingMove: '下一步用 property-based testing 表达跨大量输入成立的性质。',
  },
  {
    id: 'lin-oop-ri-code-review',
    fixtureUserId: 'memory-test-foundation-001',
    title: '林澈批改缺少 RI 的 class',
    description: '基于 OOP 课程格式，AI 实际评分学生能否发现 aliasing、RI 与异常安全问题。',
    relationLabel: '简答题 · AI 判题',
    chapter: 'OOP / Class Design Recipe',
    sourceFilename: '3_OOP.md',
    sourceTitle: 'Representation Invariants 与 Class Design Recipe',
    problemTitle: 'Playlist class 的表示合法性 · 课程题 3',
    questionPrompt: [
      '按 CSC148 的 Class Design Recipe review 下面实现。至少指出三个会影响课程契约或正确性的问题，并给出修复后的 class docstring 与 `__init__`。',
      '',
      '```python',
      'class Playlist:',
      '    """A playlist."""',
      '    songs: list[str]',
      '',
      '    def __init__(self, songs: list[str]) -> None:',
      '        self.songs = songs',
      '```',
      '',
      '要求歌曲必须是非空字符串且不能重复。',
    ].join('\n'),
    questionType: 'short_answer',
    points: 8,
    referenceAnswer: [
      '问题包括：缺少准确的 Attributes/Private Attributes 与 Representation Invariants sections；public `songs` 暴露可变表示；直接保存参数产生 alias，外部可绕过方法破坏 RI；constructor 没有验证非空和唯一性。',
      '修复应使用 `_songs: list[str]`，docstring 中准确写 `Representation Invariants:`，并在修改前验证或复制输入，使 `all(song != "" ...)` 且无重复。',
    ].join('\n'),
    rubric:
      '准确 docstring sections 2 分；写出两个 RI 2 分；识别 aliasing/representation exposure 2 分；给出建立 RI 的 constructor 2 分。只说“加类型标注”不得超过 2 分。',
    analysis: '课程要求的文档格式、内部表示与 constructor 建立 RI 是一个整体。',
    concept: 'Representation Invariants',
    difficulty: 'core',
    sourceMode: 'new_problem',
    writeMode: 'create_long_term',
    expectedMemoryChange: '根据 AI 实际评分写入 class contract 的掌握与薄弱诊断。',
    attempts: [
      {
        answer:
          '我觉得主要问题是 songs 没有写成 private，应该改成 _songs。然后在 docstring 里说明它是 list[str]。__init__ 可以写 self._songs = songs，这样外面就访问不到了。',
      },
    ],
    masteredSignal: '能识别课程倾向使用 private attribute 隐藏内部表示。',
    stuckPoint:
      '没有写 Representation Invariants，也没有意识到下划线命名不会消除传入 list 的 alias。',
    cause: '把 information hiding 当成命名规则，尚未连接到对象合法状态和 representation exposure。',
    nextTeachingMove:
      '用外部代码修改原 `songs` list 的最小反例，检查 constructor 是否真正建立并保护 RI。',
  },
  {
    id: 'zhou-adt-stack-queue-order',
    fixtureUserId: 'memory-test-novice-001',
    title: '周小满区分 Stack 与 Queue',
    description: '通过课程 ADT 接口题判断 LIFO/FIFO、空结构异常与 client 不绕过接口。',
    relationLabel: '多选题 · 重复错误',
    chapter: 'Abstract Data Types',
    sourceFilename: '4_ADT.md',
    sourceTitle: 'ADT、Stack、Queue 与异常契约',
    problemTitle: 'Stack/Queue 接口语义 · 课程题 4',
    questionPrompt:
      '只根据 Stack 与 Queue 的 public interface，以下哪些陈述符合 CSC148 的 ADT 契约？可多选。',
    questionType: 'multiple',
    points: 6,
    options: [
      { id: 'A', text: 'Stack.pop 返回最近 push 的 item。' },
      { id: 'B', text: 'Queue.dequeue 返回最近 enqueue 的 item。' },
      { id: 'C', text: 'Queue.dequeue 返回最早仍在 queue 中的 item。' },
      { id: 'D', text: 'client 可以直接修改 `_items`，只要最后顺序看起来正确。' },
      { id: 'E', text: '空结构操作应遵从文档化异常契约，而不是静默返回任意 sentinel。' },
    ],
    referenceAnswer: ['A', 'C', 'E'],
    rubric: '必须且只能选择 A、C、E。',
    analysis: 'Stack 是 LIFO，Queue 是 FIFO；异常行为和表示独立性都属于 ADT 契约。',
    concept: '抽象与接口契约',
    difficulty: 'intro',
    sourceMode: 'new_problem',
    writeMode: 'create_long_term',
    expectedMemoryChange:
      '两次客观作答都混淆 Queue 顺序或绕过 ADT 接口，更新短期状态并晋升一条长期知识缺口。',
    attempts: [
      { answer: 'A、B、D', selectedOptionIds: ['A', 'B', 'D'] },
      { answer: 'A、B', selectedOptionIds: ['A', 'B'] },
    ],
    masteredSignal: '知道 Stack.pop 与最近一次 push 配对。',
    stuckPoint: '把 Queue 也理解为 LIFO，并认为 client 可以绕过 public interface。',
    cause: '只记住了方法名，没有从 client 可观察行为区分两个 ADT。',
    nextTeachingMove: '用 A、B、C 三个 item 手工追踪 Stack 和 Queue 的移除顺序，再写接口对照表。',
  },
  {
    id: 'chen-exception-flow-trace',
    fixtureUserId: 'memory-test-intermediate-001',
    title: '陈知遥追踪 exception propagation',
    description: 'AI 评分一段包含 handler matching、else 与 finally 的完整控制流追踪。',
    relationLabel: '代码追踪 · AI 判题',
    chapter: 'Exceptions',
    sourceFilename: '5_Exception.md',
    sourceTitle: 'Exceptions、Propagation、else 与 finally',
    problemTitle: '异常传播与 handler 顺序 · 课程题 5',
    questionPrompt: [
      '写出下列代码的精确输出顺序，并解释哪个 handler 匹配、`else` 是否运行、`finally` 为什么运行。然后说明把两个 except 调换是否改变本例。',
      '',
      '```python',
      'try:',
      '    print("start")',
      '    value = int("0")',
      '    print(10 / value)',
      'except ValueError:',
      '    print("value")',
      'except ZeroDivisionError:',
      '    print("zero")',
      'else:',
      '    print("ok")',
      'finally:',
      '    print("done")',
      '```',
    ].join('\n'),
    questionType: 'code_tracing',
    points: 7,
    referenceAnswer:
      '输出 start、zero、done。int("0") 成功，除零在第三条语句 raise ZeroDivisionError，因此匹配第二个 except；try 未正常完成所以 else 不运行；finally 始终运行。两个互不继承的具体异常 handler 调换不改变本例。',
    rubric:
      '三行输出 3 分；raise 点和匹配类型 1 分；else 1 分；finally 1 分；handler 调换分析 1 分。',
    analysis: '控制流由实际 raise 的异常类型决定，finally 与是否捕获无关。',
    concept: '异常传播与 handler matching',
    difficulty: 'core',
    sourceMode: 'new_problem',
    writeMode: 'create_long_term',
    expectedMemoryChange: '按实际得分写入异常类型匹配与 else/finally 控制流诊断。',
    attempts: [
      {
        answer:
          '输出 start、value、done。因为 int 这一行在 try 里面，所以 ValueError 的 except 会先检查并运行。else 不运行，finally 是报错时运行。两个 except 调换后会输出 zero。',
      },
    ],
    masteredSignal: '知道异常发生后会跳过 try 中剩余语句，并知道本例 else 不运行。',
    stuckPoint: '误以为 except 按书写顺序任选，而不是按异常类型匹配；也把 finally 限定为错误路径。',
    cause: '尚未从 raise 点沿调用流程追踪具体异常对象。',
    nextTeachingMove: '逐行标注正常完成、raise、handler matching、else 与 finally 五个控制流节点。',
  },
  {
    id: 'lin-linked-list-insert-review',
    fixtureUserId: 'memory-test-foundation-001',
    title: '林澈修复 linked-list mutation',
    description: '基于 `_first`/`curr` 模板，检查 front、middle 与 out-of-bounds 边界。',
    relationLabel: '代码题 · traversal template',
    chapter: 'Linked Lists',
    sourceFilename: '6_Linked_List.md',
    sourceTitle: 'Linked Lists、Traversal Template 与 Mutation',
    problemTitle: 'LinkedList.insert 的边界与链接 · 课程题 6',
    questionPrompt: [
      '下面 `insert(0, item)` 会失败，且中间插入会丢失剩余链。请基于 CSC148 的 `_first`/`curr` 结构给出完整修复，并分别追踪 empty、front、middle、end、越界五种情况。',
      '',
      '```python',
      'curr = self._first',
      'for _ in range(index):',
      '    curr = curr.next',
      'curr.next = _Node(item)',
      '```',
    ].join('\n'),
    questionType: 'code_tracing',
    points: 9,
    referenceAnswer:
      'index 0 必须令 self._first = _Node(item, self._first)。其他位置应走到 predecessor（移动 index-1 次），验证 curr 与 curr.next 边界，再执行 curr.next = _Node(item, curr.next) 以保留 suffix。允许 index==length 作为 end；index<0 或 index>length 抛 IndexError。',
    rubric:
      'front 特判 2 分；走到 predecessor 2 分；保留 suffix 2 分；empty/end 1 分；越界策略 1 分；五种追踪 1 分。',
    analysis:
      'mutation 正确性取决于 loop 结束时 curr 指向哪个 node，以及新节点是否保留旧 successor。',
    concept: '链表 traversal 与 mutation',
    difficulty: 'advanced',
    sourceMode: 'new_problem',
    writeMode: 'create_long_term',
    expectedMemoryChange: '更新短期状态，并根据实际代码证据记录 predecessor 与链接保持的薄弱点。',
    attempts: [
      {
        answer:
          '如果 index 是 0 就写 self._first = _Node(item)。其他情况循环到 index，然后 curr.next = _Node(item, curr.next)。空链表也走 index 0。越界时 curr 会变成 None，Python 自己会报错。',
      },
    ],
    masteredSignal: '知道中间插入的新节点需要连接原来的 successor。',
    stuckPoint: 'front 插入丢失原 `_first`，且没有把越界行为实现为明确接口契约。',
    cause: '没有在 mutation 前写清 loop 结束位置与五类边界。',
    nextTeachingMove:
      '先画 predecessor/current/successor 三节点图，再分别执行 front 与 end 两条路径。',
  },
  {
    id: 'gu-bst-insert-repeated-boundary',
    fixtureUserId: 'memory-test-advanced-001',
    title: '顾言川在 BST mutation 再漏边界',
    description: '复用高阶用户的正确性证明记忆，用 BST insert 的重复值与空树策略强化原缺口。',
    relationLabel: '跨题重复 · 强化既有记忆',
    chapter: 'Trees / BSTs',
    sourceFilename: '8_trees.md',
    sourceTitle: 'Trees、BSTs、RI 与 height-sensitive runtime',
    problemTitle: '正确性证明与边界 · 练习 7',
    questionPrompt: [
      '按课程 BinarySearchTree 的 recursive representation review 下面 insert，并证明修复后保持 ordering RI。必须处理 empty tree、已有 subtree、重复值和链状树运行时间。',
      '',
      '```python',
      'def insert(self, item: object) -> None:',
      '    if self._root is None:',
      '        self._root = item',
      '    elif item < self._root:',
      '        self._left = BinarySearchTree(item)',
      '    else:',
      '        self._right = BinarySearchTree(item)',
      '```',
    ].join('\n'),
    questionType: 'proof',
    points: 10,
    referenceAnswer:
      '空树插入时除设置 _root 外还要使左右子树符合课程表示；非空时必须递归调用现有 _left.insert 或 _right.insert，不能覆盖 subtree。重复值策略必须与 RI 一致（拒绝、计数或固定一侧）。由递归分支和归纳假设保持 ordering RI。运行时间 O(h)，平衡时 O(log n)，链状最坏 O(n)。',
    rubric:
      'empty-tree 表示 2 分；不覆盖已有 subtree 2 分；重复值策略 2 分；RI 证明 2 分；O(h) 及两种树形 2 分。',
    analysis:
      'BST mutation 必须同时保持 recursive representation、ordering invariant 与 height-sensitive runtime。',
    concept: '正确性证明与边界',
    difficulty: 'advanced',
    sourceMode: 'existing_problem',
    writeMode: 'strengthen_long_term',
    expectedMemoryChange:
      '把新的 BST problemId 与 attempt 合并进既有“证明遗漏边界”记忆，不新增重复条目。',
    attempts: [
      {
        answer:
          '主要改成 self._left.insert(item) 和 self._right.insert(item) 就行。这样每次都往正确方向走，所以 RI 保持。复杂度是 O(log n)。重复值走右边也没关系。',
      },
    ],
    masteredSignal: '能发现不能用新 BST 覆盖已有 subtree，并知道递归选择由 root 比较决定。',
    stuckPoint: '仍遗漏 empty-tree 表示与重复值策略，并把所有 BST 的复杂度都写成 O(log n)。',
    cause: '高阶证明仍从一般平衡情况出发，没有先列退化结构和契约边界。',
    nextTeachingMove: '先用 empty、single-node、duplicate、chain 四个最小结构核对 RI，再写 O(h)。',
  },
  {
    id: 'zhou-pasted-recursion-timeout',
    fixtureUserId: 'memory-test-novice-001',
    title: '周小满打开递归题但没有提交',
    description: '课程题目和超时记录可保留，但没有答案证据时不得猜测学习状态。',
    relationLabel: '空答案 · 不写学习记忆',
    chapter: 'Recursion',
    sourceFilename: '7_Recursion.md',
    sourceTitle: 'Recursive Structure、Base Case 与 Smaller Subproblem',
    problemTitle: '嵌套列表递归 · 课程题 8',
    questionPrompt:
      '实现 `nested_sum(obj)`：整数返回自身，list 返回所有元素递归结果之和。说明 recursive call 为什么处理更小的 recursive value，并覆盖空 list 与三层嵌套。',
    questionType: 'code_tracing',
    points: 7,
    referenceAnswer:
      '若 obj 是 int 返回 obj；否则 return sum(nested_sum(item) for item in obj)。空 list 的 sum 为 0；每次 item 都是当前 recursive list 的直接组成部分。',
    rubric: '两类 base/recursive branch 3 分；递归全部元素 2 分；空 list 1 分；规模解释 1 分。',
    analysis: '没有答案时任何 rubric 都不能产生学习诊断。',
    concept: '递归问题规模缩小',
    difficulty: 'intro',
    sourceMode: 'new_problem',
    writeMode: 'no_memory',
    expectedMemoryChange: '只保留 problem 与未判题 attempt；短期和长期学习记忆都不更新。',
    attempts: [{ answer: '', submissionContext: '学生打开题目后停留 90 秒，没有提交答案。' }],
    masteredSignal: '证据不足，不能判断掌握。',
    nextTeachingMove: '下次重新呈现，不把未提交直接解释成不会。',
  },
];

export const LOCAL_MEMORY_TEST_USER_FIXTURES: LocalMemoryTestUserFixture[] = [
  {
    userId: 'memory-test-novice-001',
    name: '周小满',
    learnerProfile: {
      levelId: 'novice',
      levelLabel: '初学者',
      masteryPercent: 12,
      summary: '刚进入 CSC148，能阅读简单函数，但还没有形成树递归模型。',
      mastered: ['理解普通函数调用', '能辨认空树与叶节点'],
      weaknesses: ['不能独立写出 base case', '不理解递归调用为什么必须缩小问题规模'],
      nextTeachingMove: '先用三节点树和调用箭头建立递归的视觉模型。',
    },
    explanationPreference: {
      language: 'zh-CN',
      order: ['visual_intuition', 'worked_example', 'code'],
      avoid: ['formal_proof_first'],
    },
    studyHabit: { preferredMinutes: 20, preferredTime: '19:30', questionCount: 2 },
    usageProfile: {
      usageTier: 'new',
      usageLabel: '刚注册的新用户',
      accountAgeDays: 3,
      activeDays: 2,
      studySessions: 2,
      problemCount: 2,
      attemptCount: 3,
      conversationCount: 1,
      materialCount: 0,
      calendarEventCount: 0,
      reviewCount: 0,
      durablePrivateMemoryCount: 1,
    },
  },
  {
    userId: 'memory-test-foundation-001',
    name: '林澈',
    learnerProfile: {
      levelId: 'foundation',
      levelLabel: '基础水平',
      masteryPercent: 38,
      summary: '能写出常见 base case，但递归调用仍容易传入原对象。',
      mastered: ['能写空树 base case', '知道递归函数需要终止条件'],
      weaknesses: ['recursive subproblem 缩小不稳定', '无法手工追踪多层调用'],
      nextTeachingMove: '用三节点树逐层标出每次调用收到的 subtree。',
    },
    explanationPreference: {
      language: 'zh-CN',
      order: ['small_example', 'visual_trace', 'code'],
      avoid: ['long_abstract_preamble'],
    },
    studyHabit: { preferredMinutes: 30, preferredTime: '20:00', questionCount: 3 },
    usageProfile: {
      usageTier: 'light',
      usageLabel: '轻度使用者',
      accountAgeDays: 21,
      activeDays: 9,
      studySessions: 11,
      problemCount: 9,
      attemptCount: 15,
      conversationCount: 4,
      materialCount: 1,
      calendarEventCount: 2,
      reviewCount: 3,
      durablePrivateMemoryCount: 6,
    },
  },
  {
    userId: 'memory-test-intermediate-001',
    name: '陈知遥',
    learnerProfile: {
      levelId: 'intermediate',
      levelLabel: '中等水平',
      masteryPercent: 67,
      summary: '能够完成树递归题，正在学习 Representation Invariants 与可变对象设计。',
      mastered: ['能正确缩小递归问题', '能完成常见树遍历', '能解释递归终止性'],
      weaknesses: ['修改对象时容易破坏 Representation Invariants', '边界情况覆盖不完整'],
      nextTeachingMove: '用反例检查 mutation 前后 RI 是否一直成立。',
    },
    explanationPreference: {
      language: 'zh-CN',
      order: ['counterexample', 'code_trace', 'formal_definition'],
      avoid: ['repeat_basic_syntax'],
    },
    studyHabit: { preferredMinutes: 40, preferredTime: '20:30', questionCount: 4 },
    usageProfile: {
      usageTier: 'active',
      usageLabel: '持续活跃用户',
      accountAgeDays: 94,
      activeDays: 43,
      studySessions: 58,
      problemCount: 28,
      attemptCount: 54,
      conversationCount: 14,
      materialCount: 3,
      calendarEventCount: 6,
      reviewCount: 18,
      durablePrivateMemoryCount: 18,
    },
  },
  {
    userId: 'memory-test-advanced-001',
    name: '顾言川',
    learnerProfile: {
      levelId: 'advanced',
      levelLabel: '高阶水平',
      masteryPercent: 89,
      summary: '能综合递归、RI 与复杂度进行设计，需要更高强度的证明和优化任务。',
      mastered: [
        '熟练完成树递归与复杂度分析',
        '能维护 Representation Invariants',
        '能比较多种实现',
      ],
      weaknesses: ['形式化证明仍会省略极端边界', '优化方案缺少可验证的取舍说明'],
      nextTeachingMove: '要求给出正确性证明、反例集合和复杂度取舍。',
    },
    explanationPreference: {
      language: 'en-US',
      order: ['formal_claim', 'counterexample', 'complexity_tradeoff'],
      avoid: ['introductory_analogy', 'step_by_step_syntax'],
    },
    studyHabit: { preferredMinutes: 50, preferredTime: '21:00', questionCount: 5 },
    usageProfile: {
      usageTier: 'heavy',
      usageLabel: '长期重度使用者',
      accountAgeDays: 286,
      activeDays: 147,
      studySessions: 231,
      problemCount: 72,
      attemptCount: 168,
      conversationCount: 38,
      materialCount: 8,
      calendarEventCount: 14,
      reviewCount: 67,
      durablePrivateMemoryCount: 42,
    },
  },
];

export type LocalMemoryTestFact = {
  id: string;
  namespace: string;
  key: string;
  valueJson: unknown;
  source: string;
  sourceRef: unknown;
  validFrom: number;
  updatedAt: number;
};

export type LocalMemoryFactEvent = {
  id: string;
  factId: string | null;
  namespace: string;
  key: string;
  eventType: 'created' | 'superseded' | 'deleted';
  oldValueJson: unknown;
  newValueJson: unknown;
  createdAt: number;
};

type LocalProblem = {
  id: string;
  title: string;
  prompt: string;
  questionType: QuizQuestion['type'];
  sceneId: string;
  concept: string;
  difficulty: 'intro' | 'core' | 'advanced';
  createdAt: number;
};

type LocalAttempt = {
  id: string;
  problemId: string;
  status: 'ungraded' | 'failed' | 'partial' | 'passed';
  score: number;
  maxScore?: number;
  feedback: string;
  answerPreview?: string;
  selectedOptionIds?: string[];
  submissionContext?: string;
  gradingSource?: 'platform_objective' | 'platform_ai' | 'not_graded';
  gradingReliable?: boolean;
  createdAt: number;
};

type LocalConversation = {
  id: string;
  title: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: number;
  }>;
  createdAt: number;
};

type LocalMemoryTestFile = {
  version: 1;
  user: { id: string; name: string; email: string };
  course: { id: string; name: string; courseCode: string };
  notebook: { id: string; name: string };
  facts: LocalMemoryTestFact[];
  factEvents: LocalMemoryFactEvent[];
  problems: LocalProblem[];
  attempts: LocalAttempt[];
  conversations: LocalConversation[];
  materialIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type LocalMemoryTestSnapshot = {
  storage: 'browser-local';
  storageDetails: {
    studyMemory: 'localStorage';
    factsAndSources: 'localStorage';
    uploadedMaterials: 'IndexedDB';
  };
  user: LocalMemoryTestFile['user'];
  course: LocalMemoryTestFile['course'];
  notebook: LocalMemoryTestFile['notebook'];
  counts: {
    studyMemories: number;
    activeFacts: number;
    factEvents: number;
    materials: number;
    problems: number;
    attempts: number;
    conversations: number;
    calendarEvents: number;
  };
  studyMemories: Array<{
    id: string;
    title: string;
    text: string;
    kind: string;
    source: string;
    scope: string;
    status: string;
    sourceReferences: unknown;
    updatedAt: number;
  }>;
  workingMemory: NotebookWorkingMemory | null;
  facts: LocalMemoryTestFact[];
  factEvents: LocalMemoryFactEvent[];
  sources: {
    problems: Array<{
      id: string;
      title: string;
      prompt: string;
      questionType: LocalProblem['questionType'];
      concept: string;
      difficulty: LocalProblem['difficulty'];
      attemptCount: number;
      latestStatus: LocalAttempt['status'] | null;
      latestScore: number | null;
      createdAt: number;
    }>;
    attempts: Array<{
      id: string;
      problemId: string;
      problemTitle: string;
      status: LocalAttempt['status'];
      score: number;
      maxScore: number | null;
      answerPreview: string | null;
      selectedOptionIds: string[];
      submissionContext: string | null;
      gradingSource: LocalAttempt['gradingSource'];
      gradingReliable: boolean;
      feedback: string;
      createdAt: number;
    }>;
    conversations: Array<{
      id: string;
      title: string;
      messageCount: number;
      lastUserMessage: string | null;
      createdAt: number;
    }>;
    materials: CourseMaterialListItem[];
  };
};

export type LocalMemoryMutationResponse = {
  action: string;
  result?: unknown;
  delta: Record<keyof LocalMemoryTestSnapshot['counts'], number>;
  before: LocalMemoryTestSnapshot;
  after: LocalMemoryTestSnapshot;
  snapshot: LocalMemoryTestSnapshot;
};

export type LocalMemoryEvidence = {
  id: string;
  layer: 'profile' | 'exact_fact' | 'working_memory' | 'public_memory' | 'private_memory';
  title: string;
  content: string;
};

function storageAvailable() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function assertTestUserId(value: string) {
  const userId = value.trim();
  if (!/^memory-test-[a-z0-9_-]{1,80}$/i.test(userId)) {
    throw new Error('模拟用户 ID 必须以 memory-test- 开头，并且只能包含字母、数字、_ 或 -。');
  }
  return userId;
}

function stableSuffix(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}:${assertTestUserId(userId)}`;
}

function createId(prefix: string) {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replaceAll('-', '').slice(0, 18)
      : `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${suffix}`;
}

function emptyFile(userId: string, name = DEFAULT_USER_NAME): LocalMemoryTestFile {
  const suffix = stableSuffix(userId);
  const now = Date.now();
  return {
    version: 1,
    user: {
      id: userId,
      name,
      email: `${userId}@local.test`,
    },
    course: {
      id: `memory-local-course-${suffix}`,
      name: '第二阶段本地记忆测试 · CSC148',
      courseCode: 'CSC148',
    },
    notebook: {
      id: `memory-local-notebook-${suffix}`,
      name: '递归、树与表示不变量',
    },
    facts: [],
    factEvents: [],
    problems: [],
    attempts: [],
    conversations: [],
    materialIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function readFile(userId: string): LocalMemoryTestFile | null {
  if (!storageAvailable()) return null;
  const raw = localStorage.getItem(storageKey(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LocalMemoryTestFile;
    return parsed?.version === 1 && parsed.user?.id === userId ? parsed : null;
  } catch {
    return null;
  }
}

function writeFile(file: LocalMemoryTestFile) {
  if (!storageAvailable()) throw new Error('当前浏览器不支持 localStorage。');
  const next = { ...file, updatedAt: Date.now() };
  localStorage.setItem(storageKey(file.user.id), JSON.stringify(next));
  return next;
}

function requireFile(userId: string) {
  const normalized = assertTestUserId(userId);
  const file = readFile(normalized);
  if (!file) throw new Error('请先创建这个本地模拟用户。');
  return file;
}

function memoryReferenceContains(item: NotebookMemoryItem, sourceId: string) {
  return JSON.stringify(item.sourceReferences || []).includes(sourceId);
}

function profileMemoryItems(profile: StudyMemoryProfile): LocalMemoryTestSnapshot['studyMemories'] {
  const items: LocalMemoryTestSnapshot['studyMemories'] = [
    ...profile.publicMemories,
    ...profile.privateMemories,
  ].map((item) => ({
    id: item.id,
    title: item.title,
    text: item.text,
    kind: item.kind || 'knowledge_gap',
    source: item.source,
    scope: item.scope,
    status: item.status || 'active',
    sourceReferences: item.sourceReferences || [],
    updatedAt: item.updatedAt,
  }));
  if (profile.workingMemory) {
    const working = profile.workingMemory;
    items.unshift({
      id: `working-memory:${profile.stageId}`,
      title: working.title,
      text: [
        working.summary,
        working.masteredSignal ? `掌握：${working.masteredSignal}` : '',
        working.stuckPoint ? `薄弱：${working.stuckPoint}` : '',
        working.nextTeachingMove ? `下一步：${working.nextTeachingMove}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      kind: 'working_state',
      source: working.source,
      scope: 'private',
      status: 'active',
      sourceReferences: {
        recentAttempt: working.recentAttempt,
        evidence: working.evidence,
      },
      updatedAt: working.updatedAt,
    });
  }
  return items;
}

export async function ensureLocalMemoryTestSandbox(args: {
  userId: string;
  name?: string;
}): Promise<LocalMemoryTestSnapshot> {
  const userId = assertTestUserId(args.userId);
  const existing = readFile(userId);
  if (!existing) writeFile(emptyFile(userId, args.name?.trim() || DEFAULT_USER_NAME));
  return getLocalMemoryTestSnapshot(userId);
}

export async function getLocalMemoryTestSnapshot(userId: string): Promise<LocalMemoryTestSnapshot> {
  const file = requireFile(userId);
  const profile = loadStudyMemory(file.user.id, file.notebook.id);
  const materials = (await listCourseMaterials(file.course.id)).filter((material) =>
    file.materialIds.includes(material.id),
  );
  const studyMemories = profileMemoryItems(profile);
  const calendarEvents = file.facts.filter((fact) => fact.namespace === 'calendar').length;
  return {
    storage: 'browser-local',
    storageDetails: {
      studyMemory: 'localStorage',
      factsAndSources: 'localStorage',
      uploadedMaterials: 'IndexedDB',
    },
    user: file.user,
    course: file.course,
    notebook: file.notebook,
    counts: {
      studyMemories: studyMemories.length,
      activeFacts: file.facts.length,
      factEvents: file.factEvents.length,
      materials: materials.length,
      problems: file.problems.length,
      attempts: file.attempts.length,
      conversations: file.conversations.length,
      calendarEvents,
    },
    studyMemories,
    workingMemory: profile.workingMemory || null,
    facts: [...file.facts].sort((a, b) => b.updatedAt - a.updatedAt),
    factEvents: [...file.factEvents].sort((a, b) => b.createdAt - a.createdAt),
    sources: {
      problems: file.problems.map((problem) => {
        const attempts = file.attempts
          .filter((attempt) => attempt.problemId === problem.id)
          .sort((a, b) => b.createdAt - a.createdAt);
        return {
          id: problem.id,
          title: problem.title,
          prompt: problem.prompt,
          questionType: problem.questionType,
          concept: problem.concept,
          difficulty: problem.difficulty,
          attemptCount: attempts.length,
          latestStatus: attempts[0]?.status || null,
          latestScore: attempts[0]?.score ?? null,
          createdAt: problem.createdAt,
        };
      }),
      attempts: file.attempts.map((attempt) => ({
        id: attempt.id,
        problemId: attempt.problemId,
        problemTitle:
          file.problems.find((problem) => problem.id === attempt.problemId)?.title || '已删除题目',
        status: attempt.status,
        score: attempt.score,
        maxScore: attempt.maxScore ?? null,
        answerPreview: attempt.answerPreview || null,
        selectedOptionIds: attempt.selectedOptionIds || [],
        submissionContext: attempt.submissionContext || null,
        gradingSource: attempt.gradingSource,
        gradingReliable: attempt.gradingReliable ?? true,
        feedback: attempt.feedback,
        createdAt: attempt.createdAt,
      })),
      conversations: file.conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        messageCount: conversation.messages.length,
        lastUserMessage:
          [...conversation.messages].reverse().find((message) => message.role === 'user')
            ?.content || null,
        createdAt: conversation.createdAt,
      })),
      materials,
    },
  };
}

export async function resetLocalMemoryTestSandbox(userId: string) {
  const file = requireFile(userId);
  const materials = await listCourseMaterials(file.course.id);
  await Promise.all(materials.map((material) => deleteCourseMaterial(material.id)));
  for (const problem of file.problems) {
    clearQuestionProgress(file.notebook.id, file.user.id, problem.sceneId, problem.id);
  }
  clearStudyMemory(file.notebook.id, file.user.id);
  localStorage.removeItem(storageKey(file.user.id));
}

function upsertFactInFile(args: {
  file: LocalMemoryTestFile;
  namespace: string;
  key: string;
  valueJson: unknown;
  source: string;
  sourceRef?: unknown;
}) {
  const now = Date.now();
  const existing = args.file.facts.find(
    (fact) => fact.namespace === args.namespace && fact.key === args.key,
  );
  const fact: LocalMemoryTestFact = existing
    ? {
        ...existing,
        valueJson: args.valueJson,
        source: args.source,
        sourceRef: args.sourceRef || existing.sourceRef,
        updatedAt: now,
      }
    : {
        id: createId('local_fact'),
        namespace: args.namespace,
        key: args.key,
        valueJson: args.valueJson,
        source: args.source,
        sourceRef: args.sourceRef || null,
        validFrom: now,
        updatedAt: now,
      };
  const event: LocalMemoryFactEvent = {
    id: createId('local_fact_event'),
    factId: fact.id,
    namespace: args.namespace,
    key: args.key,
    eventType: existing ? 'superseded' : 'created',
    oldValueJson: existing?.valueJson ?? null,
    newValueJson: args.valueJson,
    createdAt: now,
  };
  return writeFile({
    ...args.file,
    facts: [fact, ...args.file.facts.filter((item) => item.id !== fact.id)],
    factEvents: [event, ...args.file.factEvents].slice(0, 200),
  });
}

const HISTORY_CONCEPTS = [
  {
    id: 'base_case',
    label: '递归 base case',
    mastered: '能识别空树与叶节点的终止条件',
    gap: '在多分支递归中偶尔漏掉空子树',
    next: '用空树、单节点和三节点树做边界回放',
  },
  {
    id: 'recursive_subproblem',
    label: '递归问题规模缩小',
    mastered: '能让 recursive call 接收严格更小的 subtree',
    gap: '仍会把原树传回递归调用，导致问题规模不变',
    next: '逐层标出每次调用收到的 subtree',
  },
  {
    id: 'tree_traversal',
    label: '树遍历与返回值组合',
    mastered: '能组合左右子树的递归返回值',
    gap: '多分支返回值合并时容易遗漏一支',
    next: '先写出左右分支表格，再组合返回值',
  },
  {
    id: 'representation_invariant',
    label: 'Representation Invariants',
    mastered: '能说明 RI 对合法对象状态的约束',
    gap: 'mutation 之后不总会重新检查 RI',
    next: '用破坏性反例检查每个 mutation 边界',
  },
  {
    id: 'mutation',
    label: '可变对象与 aliasing',
    mastered: '能识别共享引用造成的连带修改',
    gap: '浅拷贝与深拷贝的影响判断不稳定',
    next: '画对象图并标注每个变量实际指向的对象',
  },
  {
    id: 'complexity',
    label: '递归复杂度',
    mastered: '能根据访问节点数分析常见树递归复杂度',
    gap: '对不平衡树的最坏情况界限说明不完整',
    next: '分别写出平衡树与链状树的递推关系',
  },
  {
    id: 'proof_boundary',
    label: '正确性证明与边界',
    mastered: '能提出归纳假设并连接到递归实现',
    gap: '形式化证明容易省略空结构和极端输入',
    next: '先列边界反例集合，再补完整证明链',
  },
  {
    id: 'testing',
    label: '测试设计',
    mastered: '能从实现分支反推测试样例',
    gap: '测试集覆盖正常路径多，破坏性反例不足',
    next: '为每个分支增加一个最小失败用例',
  },
  {
    id: 'abstraction',
    label: '抽象与接口契约',
    mastered: '能区分接口承诺与内部表示',
    gap: '设计说明中偶尔泄露不必要的实现细节',
    next: '先写客户端可观察行为，再决定内部结构',
  },
  {
    id: 'optimization',
    label: '优化取舍',
    mastered: '能比较多种实现的时间和空间代价',
    gap: '优化结论有时缺少可测量证据',
    next: '用复杂度、基准输入和内存代价三项说明取舍',
  },
] as const;

function spreadHistoricalTime(now: number, ageDays: number, index: number, count: number) {
  if (count <= 1) return now - Math.min(ageDays, 1) * DAY_MS;
  const fraction = (count - index) / count;
  return now - Math.max(1, Math.round(ageDays * fraction)) * DAY_MS;
}

function buildFixtureHistory(args: {
  fixture: LocalMemoryTestUserFixture;
  file: LocalMemoryTestFile;
  now: number;
}) {
  const { fixture, now } = args;
  const usage = fixture.usageProfile;
  const targetPassed = Math.round(
    (usage.attemptCount * fixture.learnerProfile.masteryPercent) / 100,
  );
  const remaining = usage.attemptCount - targetPassed;
  const targetPartial = Math.round(remaining * 0.55);
  const problems: LocalProblem[] = [];
  const attempts: LocalAttempt[] = [];
  let globalAttemptIndex = 0;

  for (let problemIndex = 0; problemIndex < usage.problemCount; problemIndex += 1) {
    const concept = HISTORY_CONCEPTS[problemIndex % HISTORY_CONCEPTS.length];
    const title = `${concept.label} · 练习 ${problemIndex + 1}`;
    const matchingWritebackCase = LOCAL_PROBLEM_WRITEBACK_CASES.find(
      (testCase) =>
        testCase.fixtureUserId === fixture.userId &&
        testCase.sourceMode === 'existing_problem' &&
        testCase.problemTitle === title,
    );
    const createdAt = spreadHistoricalTime(
      now,
      usage.accountAgeDays,
      problemIndex,
      usage.problemCount,
    );
    const problem: LocalProblem = {
      id: `fixture_problem_${stableSuffix(args.file.user.id)}_${problemIndex + 1}`,
      title,
      prompt:
        matchingWritebackCase?.questionPrompt ||
        `请完成「${concept.label}」练习 ${problemIndex + 1}，写出答案并说明关键边界。`,
      questionType: matchingWritebackCase?.questionType || 'short_answer',
      sceneId: `${TEST_SCENE_ID}-${concept.id}`,
      concept: concept.label,
      difficulty:
        problemIndex / Math.max(usage.problemCount, 1) > 0.72
          ? 'advanced'
          : problemIndex / Math.max(usage.problemCount, 1) > 0.3
            ? 'core'
            : 'intro',
      createdAt,
    };
    problems.push(problem);

    const baseAttemptCount = Math.floor(usage.attemptCount / usage.problemCount);
    const attemptsForProblem =
      baseAttemptCount + (problemIndex < usage.attemptCount % usage.problemCount ? 1 : 0);
    for (let attemptIndex = 0; attemptIndex < attemptsForProblem; attemptIndex += 1) {
      const poolIndex = (globalAttemptIndex * 37) % usage.attemptCount;
      const status: LocalAttempt['status'] =
        poolIndex < targetPassed
          ? 'passed'
          : poolIndex < targetPassed + targetPartial
            ? 'partial'
            : 'failed';
      const feedback =
        status === 'passed'
          ? `${concept.mastered}；本次作答证据通过。`
          : status === 'partial'
            ? `${concept.gap}；已经完成主要步骤，但边界仍需补全。`
            : `${concept.gap}；下一次建议：${concept.next}。`;
      attempts.push({
        id: `fixture_attempt_${stableSuffix(args.file.user.id)}_${globalAttemptIndex + 1}`,
        problemId: problem.id,
        status,
        score: status === 'passed' ? 2 : status === 'partial' ? 1 : 0,
        feedback,
        answerPreview:
          status === 'passed'
            ? `已给出 ${concept.label} 的完整推理和边界检查。`
            : `尝试了 ${concept.label}，但仍有步骤需要修正。`,
        createdAt: createdAt + (attemptIndex + 1) * 45 * 60 * 1000,
      });
      globalAttemptIndex += 1;
    }
  }

  const conversations: LocalConversation[] = Array.from(
    { length: usage.conversationCount },
    (_, conversationIndex) => {
      const concept = HISTORY_CONCEPTS[conversationIndex % HISTORY_CONCEPTS.length];
      const createdAt = spreadHistoricalTime(
        now,
        usage.accountAgeDays,
        conversationIndex,
        usage.conversationCount,
      );
      const id = `fixture_chat_${stableSuffix(args.file.user.id)}_${conversationIndex + 1}`;
      return {
        id,
        title: `${concept.label}答疑 ${conversationIndex + 1}`,
        createdAt,
        messages: [
          {
            id: `${id}_message_1`,
            role: 'user' as const,
            content: `我在${concept.label}这里为什么总是出错？请结合我刚才的作答解释。`,
            createdAt,
          },
          {
            id: `${id}_message_2`,
            role: 'assistant' as const,
            content: `从近期证据看，当前主要问题是：${concept.gap}。`,
            createdAt: createdAt + 60_000,
          },
          {
            id: `${id}_message_3`,
            role: 'user' as const,
            content: `我理解的是“${concept.mastered}”，还缺哪一步？`,
            createdAt: createdAt + 120_000,
          },
          {
            id: `${id}_message_4`,
            role: 'assistant' as const,
            content: `下一步先做这个动作：${concept.next}。`,
            createdAt: createdAt + 180_000,
          },
        ],
      };
    },
  );

  return { problems, attempts, conversations };
}

async function seedLocalMemoryTestUserFixture(
  fixture: LocalMemoryTestUserFixture,
  targetUserId = fixture.userId,
) {
  let file = readFile(targetUserId);
  if (!file) {
    file = writeFile(emptyFile(targetUserId, fixture.name));
  }

  const seededVersion = file.facts.find(
    (fact) => fact.namespace === 'test_fixture' && fact.key === 'cohort_seed_version',
  )?.valueJson;
  if (seededVersion === COHORT_SEED_VERSION) return;

  const now = Date.now();
  const history = buildFixtureHistory({ fixture, file, now });

  file = writeFile({
    ...file,
    user: { ...file.user, name: fixture.name },
    problems: history.problems,
    attempts: history.attempts,
    conversations: history.conversations,
  });
  file = upsertFactInFile({
    file,
    namespace: 'profile',
    key: 'learner_level',
    valueJson: fixture.learnerProfile,
    source: 'local_test_fixture',
    sourceRef: { fixtureUserId: fixture.userId, targetUserId },
  });
  file = upsertFactInFile({
    file,
    namespace: 'preference',
    key: 'explanation_style',
    valueJson: fixture.explanationPreference,
    source: 'local_test_fixture',
    sourceRef: { fixtureUserId: fixture.userId, targetUserId },
  });
  file = upsertFactInFile({
    file,
    namespace: 'habit',
    key: 'study_session',
    valueJson: fixture.studyHabit,
    source: 'local_test_fixture',
    sourceRef: { fixtureUserId: fixture.userId, targetUserId },
  });
  file = upsertFactInFile({
    file,
    namespace: 'profile',
    key: 'student_context',
    valueJson: {
      program: 'University of Toronto Computer Science',
      currentCourse: 'CSC148',
      timezone: 'Asia/Shanghai',
      preferredLanguage: fixture.explanationPreference.language,
    },
    source: 'local_test_fixture',
    sourceRef: { fixtureUserId: fixture.userId, targetUserId },
  });
  file = upsertFactInFile({
    file,
    namespace: 'usage',
    key: 'activity_summary',
    valueJson: {
      ...fixture.usageProfile,
      messageCount: history.conversations.reduce(
        (sum, conversation) => sum + conversation.messages.length,
        0,
      ),
      passedAttempts: history.attempts.filter((attempt) => attempt.status === 'passed').length,
      lastActiveAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    },
    source: 'local_test_fixture',
    sourceRef: { fixtureUserId: fixture.userId, targetUserId },
  });
  file = upsertFactInFile({
    file,
    namespace: 'goal',
    key: 'current_learning_goal',
    valueJson: {
      course: 'CSC148',
      target: fixture.learnerProfile.nextTeachingMove,
      weeklyMinutes: fixture.studyHabit.preferredMinutes * 4,
    },
    source: 'local_test_fixture',
    sourceRef: { fixtureUserId: fixture.userId, targetUserId },
  });

  for (
    let calendarIndex = 0;
    calendarIndex < fixture.usageProfile.calendarEventCount;
    calendarIndex += 1
  ) {
    const startAt = now + (calendarIndex + 1) * DAY_MS;
    file = upsertFactInFile({
      file,
      namespace: 'calendar',
      key: `event:fixture-${calendarIndex + 1}`,
      valueJson: {
        id: `fixture-calendar-${calendarIndex + 1}`,
        title:
          calendarIndex % 3 === 0
            ? '错题复习'
            : calendarIndex % 3 === 1
              ? 'CSC148 小测准备'
              : '递归专项练习',
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(startAt + fixture.studyHabit.preferredMinutes * 60_000).toISOString(),
        status: calendarIndex % 5 === 4 ? 'completed' : 'planned',
      },
      source: 'local_test_fixture',
      sourceRef: { fixtureUserId: fixture.userId, targetUserId },
    });
  }

  for (const problem of history.problems) {
    const latestAttempt = history.attempts
      .filter((attempt) => attempt.problemId === problem.id)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!latestAttempt) continue;
    setQuestionProgress(file.notebook.id, file.user.id, problem.sceneId, problem.id, {
      status: latestAttempt.status === 'passed' ? 'correct' : 'incorrect',
      updatedAt: latestAttempt.createdAt,
      userAnswer: latestAttempt.answerPreview || '',
      result: {
        questionId: problem.id,
        correct: latestAttempt.status === 'passed',
        status: latestAttempt.status === 'passed' ? 'correct' : 'incorrect',
        earned: latestAttempt.score,
        aiComment: latestAttempt.feedback,
      },
    });
  }

  const materialFiles = Array.from(
    { length: fixture.usageProfile.materialCount },
    (_, materialIndex) => {
      const concept = HISTORY_CONCEPTS[materialIndex % HISTORY_CONCEPTS.length];
      return new File(
        [
          [
            `# CSC148 ${concept.label} 学习资料 ${materialIndex + 1}`,
            '',
            `课程要求：${concept.mastered}。`,
            `常见失败：${concept.gap}。`,
            `建议检查：${concept.next}。`,
          ].join('\n'),
        ],
        `CSC148-${concept.id}-${materialIndex + 1}.md`,
        { type: 'text/markdown' },
      );
    },
  );
  const materials = materialFiles.length
    ? await addCourseMaterials(file.course.id, materialFiles)
    : [];
  file = writeFile({
    ...file,
    materialIds: materials.map((material) => material.id),
  });
  const notebookId = file.notebook.id;

  const privateMemories: NotebookMemoryItem[] = Array.from(
    { length: fixture.usageProfile.durablePrivateMemoryCount },
    (_, memoryIndex) => {
      const concept = HISTORY_CONCEPTS[memoryIndex % HISTORY_CONCEPTS.length];
      const problem = history.problems[memoryIndex % history.problems.length];
      const conversation =
        history.conversations[memoryIndex % Math.max(history.conversations.length, 1)];
      const fromChat = memoryIndex % 3 === 0 && Boolean(conversation);
      const phase = Math.floor(memoryIndex / HISTORY_CONCEPTS.length) + 1;
      const isMastery = (memoryIndex * 23) % 100 < fixture.learnerProfile.masteryPercent;
      const createdAt = spreadHistoricalTime(
        now,
        fixture.usageProfile.accountAgeDays,
        memoryIndex,
        fixture.usageProfile.durablePrivateMemoryCount,
      );
      return {
        id: `private_fixture_${stableSuffix(targetUserId)}_${memoryIndex + 1}`,
        scope: 'private' as const,
        kind: isMastery
          ? ('reflection' as const)
          : memoryIndex % 2
            ? ('mistake' as const)
            : ('knowledge_gap' as const),
        status:
          memoryIndex < Math.floor(fixture.usageProfile.durablePrivateMemoryCount * 0.12)
            ? ('archived' as const)
            : ('active' as const),
        source: fromChat ? ('chat' as const) : ('quiz' as const),
        stageId: notebookId,
        title: `${isMastery ? '掌握证据' : '稳定薄弱点'}：${concept.label} · 阶段 ${phase}`,
        text: isMastery
          ? `综合近期题目与对话，${concept.mastered}。这不是单次作答转存，而是跨多次证据形成的稳定结论。`
          : `多次作答与追问共同显示：${concept.gap}。下一教学动作：${concept.next}。`,
        reason: `由该用户的第 ${memoryIndex + 1} 组本地题目、作答或对话证据提炼。`,
        sourceReferences: [
          {
            notebookId,
            order: memoryIndex + 1,
            title: fromChat
              ? `对话：${conversation?.title || '学习答疑'} (${conversation?.id || 'unknown'})`
              : `题目：${problem?.title || '练习记录'} (${problem?.id || 'unknown'})`,
            why: isMastery ? concept.mastered : concept.gap,
          },
        ],
        createdAt,
        updatedAt: createdAt,
      };
    },
  );

  const materialPublicMemories: NotebookMemoryItem[] = materials
    .slice(0, 3)
    .map((material, index) => {
      const concept = HISTORY_CONCEPTS[index % HISTORY_CONCEPTS.length];
      return {
        id: `public_fixture_${stableSuffix(targetUserId)}_${index + 1}`,
        scope: 'public' as const,
        kind: 'manual' as const,
        status: 'active' as const,
        source: 'notebook_generation' as const,
        stageId: notebookId,
        title: `课程资料规则：${concept.label}`,
        text: `来自上传资料的课程本地要求：${concept.mastered}；作答时需检查“${concept.next}”。原始全文保留在资料库，不复制进记忆。`,
        reason: '只提升会改变后续回答方式的课程约束，原资料仍是权威来源。',
        sourceReferences: [
          {
            notebookId,
            order: index + 1,
            title: `资料：${material.name} (${material.id})`,
            why: '该段是课程本地作答约束。',
          },
        ],
        createdAt: material.createdAt,
        updatedAt: material.updatedAt,
      };
    });
  const knownContractKeys =
    fixture.learnerProfile.levelId === 'advanced'
      ? ['csc148-class-design-recipe']
      : fixture.learnerProfile.levelId === 'intermediate'
        ? ['csc148-testing-evidence-standard']
        : [];
  const knownCourseContractMemories: NotebookMemoryItem[] = knownContractKeys.flatMap(
    (contractKey, index) => {
      const sourceCase = CSC148_SOURCE_UPLOAD_CASES.find(
        (item) => item.contractKey === contractKey,
      );
      if (!sourceCase) return [];
      const createdAt = now - (index + 4) * DAY_MS;
      return [
        {
          id: `public_contract_${stableSuffix(targetUserId)}_${index + 1}`,
          scope: 'public' as const,
          kind: 'manual' as const,
          status: 'active' as const,
          source: 'notebook_generation' as const,
          stageId: notebookId,
          title: sourceCase.memoryTitle,
          text: sourceCase.memoryRules.join('\n'),
          reason: '该模拟人物此前使用过相同的 CSC148 课程答题契约。',
          sourceReferences: [
            {
              notebookId,
              order: 1,
              title: '历史课程笔记本',
              why: `contractKey:${sourceCase.contractKey}`,
            },
          ],
          createdAt,
          updatedAt: createdAt,
        },
      ];
    },
  );
  const publicMemories = [...knownCourseContractMemories, ...materialPublicMemories];

  const recentAttempt = [...history.attempts].sort((a, b) => b.createdAt - a.createdAt)[0];
  const recentProblem = recentAttempt
    ? history.problems.find((problem) => problem.id === recentAttempt.problemId)
    : null;
  const nonPassingProblems = history.problems.filter((problem) => {
    const latest = history.attempts
      .filter((attempt) => attempt.problemId === problem.id)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    return latest && latest.status !== 'passed';
  });

  saveStudyMemory({
    userId: file.user.id,
    stageId: file.notebook.id,
    quizAttempts: history.attempts.length,
    quizCorrect: history.attempts.filter((attempt) => attempt.status === 'passed').length,
    reviewCount: fixture.usageProfile.reviewCount,
    lastTouchedAt: now,
    lastStuckPoint: fixture.learnerProfile.weaknesses[0],
    workingMemory: {
      source: recentAttempt ? 'problem_attempt' : 'manual',
      title: `${fixture.learnerProfile.levelLabel}当前学习状态`,
      summary: fixture.learnerProfile.summary,
      currentTask: recentProblem?.title || 'CSC148 树递归与 Representation Invariants',
      masteredSignal: fixture.learnerProfile.mastered.join('；'),
      stuckPoint: fixture.learnerProfile.weaknesses.join('；'),
      nextTeachingMove: fixture.learnerProfile.nextTeachingMove,
      recentAttempt:
        recentAttempt && recentProblem
          ? {
              problemId: recentProblem.id,
              problemTitle: recentProblem.title,
              status: recentAttempt.status,
              score: recentAttempt.score,
              feedback: recentAttempt.feedback,
            }
          : undefined,
      evidence: recentAttempt
        ? [
            {
              type: 'problem_attempt',
              label: `最近作答 ${recentAttempt.id}`,
              text: recentAttempt.feedback,
            },
          ]
        : [],
      updatedAt: now,
    },
    weakPoints: nonPassingProblems.slice(0, 10).map((problem, index) => ({
      id: `${problem.sceneId}:${problem.id}`,
      sceneId: problem.sceneId,
      questionId: problem.id,
      title: problem.title,
      reason:
        HISTORY_CONCEPTS.find((concept) => concept.label === problem.concept)?.gap ||
        '需要继续复习。',
      status: index < Math.min(fixture.usageProfile.reviewCount, 3) ? 'reviewed' : 'open',
      createdAt: problem.createdAt,
      reviewedAt:
        index < Math.min(fixture.usageProfile.reviewCount, 3)
          ? problem.createdAt + DAY_MS
          : undefined,
    })),
    rememberedQuestions: history.conversations.slice(0, 12).map((conversation) => ({
      id: `remembered_${conversation.id}`,
      text:
        conversation.messages.find((message) => message.role === 'user')?.content ||
        conversation.title,
      createdAt: conversation.createdAt,
    })),
    publicMemories,
    privateMemories,
  });

  file = upsertFactInFile({
    file,
    namespace: 'test_fixture',
    key: 'cohort_seed_version',
    valueJson: COHORT_SEED_VERSION,
    source: 'local_test_fixture',
    sourceRef: { fixtureUserId: fixture.userId, targetUserId },
  });
}

export async function ensureLocalMemoryTestUserCohort(): Promise<LocalMemoryTestSnapshot[]> {
  for (const fixture of LOCAL_MEMORY_TEST_USER_FIXTURES) {
    const existing = readFile(fixture.userId);
    const existingVersion = existing?.facts.find(
      (fact) => fact.namespace === 'test_fixture' && fact.key === 'cohort_seed_version',
    )?.valueJson;
    if (existing && existingVersion !== COHORT_SEED_VERSION) {
      await resetLocalMemoryTestSandbox(fixture.userId);
    }
    await seedLocalMemoryTestUserFixture(fixture);
  }
  return Promise.all(
    LOCAL_MEMORY_TEST_USER_FIXTURES.map((fixture) => getLocalMemoryTestSnapshot(fixture.userId)),
  );
}

async function recordProblemAttempts(userId: string) {
  let file = requireFile(userId);
  const now = Date.now();
  const problem: LocalProblem = {
    id: createId('local_problem'),
    title: '递归树遍历：为什么必须正确缩小问题规模',
    prompt: '修复递归树遍历函数，使每个 recursive call 都接收严格更小的 subtree，并说明终止条件。',
    questionType: 'code',
    sceneId: TEST_SCENE_ID,
    concept: '递归问题规模缩小',
    difficulty: 'core',
    createdAt: now,
  };
  const attempts: LocalAttempt[] = [
    {
      id: createId('local_attempt'),
      problemId: problem.id,
      status: 'failed',
      score: 0,
      answerPreview:
        'def size(tree):\n    if tree is None:\n        return 0\n    return 1 + size(tree) + size(tree)',
      feedback: '递归调用仍然传入原树，问题规模没有缩小。',
      createdAt: now + 1,
    },
    {
      id: createId('local_attempt'),
      problemId: problem.id,
      status: 'partial',
      score: 1,
      answerPreview:
        'def size(tree):\n    if tree is None:\n        return 0\n    return 1 + size(tree)  # 我以为有 base case 就会停',
      feedback: 'base case 正确，但递归参数仍未移动到子树。',
      createdAt: now + 2,
    },
  ];
  file = writeFile({
    ...file,
    problems: [problem, ...file.problems],
    attempts: [...attempts, ...file.attempts],
  });
  const latest = attempts[1];
  setQuestionProgress(file.notebook.id, file.user.id, problem.sceneId, problem.id, {
    status: 'incorrect',
    updatedAt: latest.createdAt,
    userAnswer: 'if tree is empty: return 0; return 1 + size(tree)',
    result: {
      questionId: problem.id,
      correct: false,
      status: 'incorrect',
      earned: latest.score,
      aiComment: latest.feedback,
    },
  });
  updateNotebookWorkingMemory({
    userId: file.user.id,
    stageId: file.notebook.id,
    memory: {
      source: 'problem_attempt',
      title: '短期学习状态',
      summary: '学生知道递归需要 base case，但连续两次没有在递归调用中缩小树的问题规模。',
      currentTask: problem.title,
      masteredSignal: '能够识别并写出空树的 base case。',
      stuckPoint: '递归调用仍传入原树，不理解 recursive subproblem 必须严格缩小。',
      nextTeachingMove: '先用三节点树逐步标出每次调用收到的子树，再写递归参数。',
      recentAttempt: {
        problemId: problem.id,
        problemTitle: problem.title,
        status: latest.status,
        score: latest.score,
        feedback: latest.feedback,
      },
      evidence: [
        {
          type: 'problem_attempt',
          label: '两次本地作答',
          text: attempts.map((attempt) => `${attempt.status}: ${attempt.feedback}`).join('\n'),
        },
      ],
    },
  });
  const memory = recordNotebookPrivateMemory({
    userId: file.user.id,
    stageId: file.notebook.id,
    title: `做题记录观察：${problem.title}`,
    text: [
      '掌握：能够识别空树 base case。',
      '薄弱：递归调用没有缩小到子树。',
      '原因：尚未建立 recursive subproblem 必须严格缩小的不变量。',
      '下一步：用三节点树逐步追踪递归参数。',
      `来源题目：${problem.id}`,
    ].join('\n'),
    reason: '连续两次未通过的本地作答形成稳定学习信号。',
    kind: 'mistake',
    source: 'quiz',
    sourceReferences: [
      {
        notebookId: file.notebook.id,
        order: 1,
        title: `problem:${problem.id}`,
        why: `attempts:${attempts.map((attempt) => attempt.id).join(',')}`,
      },
    ],
  });
  return { problem, attempts, memory: memory.item };
}

async function recordProblemWritebackCase(
  userId: string,
  testCaseId: string,
  modelString?: string,
) {
  const testCase = LOCAL_PROBLEM_WRITEBACK_CASES.find((item) => item.id === testCaseId);
  if (!testCase) throw new Error('未知的做题记忆写回测试。');
  const fixture = LOCAL_MEMORY_TEST_USER_FIXTURES.find(
    (item) => item.userId === testCase.fixtureUserId,
  );
  if (!fixture) throw new Error('做题记忆写回测试缺少对应的四水平模拟用户。');

  let file = requireFile(userId);
  const now = Date.now();
  let problem =
    testCase.sourceMode === 'existing_problem'
      ? file.problems.find((item) => item.title === testCase.problemTitle) ||
        file.problems.find((item) => item.concept === testCase.concept)
      : undefined;
  const reusedProblem = Boolean(problem);

  if (!problem) {
    problem = {
      id: createId('local_problem'),
      title: testCase.problemTitle,
      prompt: testCase.questionPrompt,
      questionType: testCase.questionType,
      sceneId: `${TEST_SCENE_ID}-${testCase.id}`,
      concept: testCase.concept,
      difficulty: testCase.difficulty,
      createdAt: now,
    };
    file = writeFile({
      ...file,
      problems: [problem, ...file.problems],
    });
  }

  const quizQuestion: QuizQuestion = {
    id: problem.id,
    type: testCase.questionType,
    question: testCase.questionPrompt,
    options: testCase.options?.map((option) => ({ label: option.text, value: option.id })),
    answer: testCase.referenceAnswer,
    proof:
      testCase.questionType === 'proof' && typeof testCase.referenceAnswer === 'string'
        ? testCase.referenceAnswer
        : undefined,
    commentPrompt: testCase.rubric,
    analysis: testCase.analysis,
    points: testCase.points,
  };
  const attempts: LocalAttempt[] = [];
  for (const [index, submission] of testCase.attempts.entries()) {
    const selectedOptionIds = submission.selectedOptionIds || [];
    const hasSubmittedAnswer = isObjectiveQuestion(quizQuestion)
      ? selectedOptionIds.length > 0
      : submission.answer.trim().length > 0;

    if (!hasSubmittedAnswer) {
      attempts.push({
        id: createId('local_attempt'),
        problemId: problem.id,
        status: 'ungraded',
        score: 0,
        maxScore: testCase.points,
        feedback: '没有收到可判定的答案，平台未执行正误判断。',
        answerPreview: submission.answer,
        selectedOptionIds,
        submissionContext: submission.submissionContext,
        gradingSource: 'not_graded',
        gradingReliable: false,
        createdAt: now + index + 1,
      });
      continue;
    }

    const gradingResult = isObjectiveQuestion(quizQuestion)
      ? gradeObjectiveQuestions([quizQuestion], {
          [quizQuestion.id]: selectedOptionIds as AnswerValue,
        })[0]
      : await gradeTextQuestion(quizQuestion, submission.answer, 'zh-CN');
    const gradingReliable = Boolean(gradingResult && gradingResult.correct !== null);
    const score = gradingReliable && gradingResult ? gradingResult.earned : 0;
    const scoreRatio = score / testCase.points;
    const status: LocalAttempt['status'] = !gradingReliable
      ? 'ungraded'
      : scoreRatio >= 0.8
        ? 'passed'
        : score > 0
          ? 'partial'
          : 'failed';
    const feedback = gradingReliable
      ? gradingResult.aiComment ||
        (gradingResult.correct
          ? '平台按题目保存的正确选项判定：回答正确。'
          : '平台按题目保存的正确选项判定：回答不正确。')
      : gradingResult?.aiComment || '评分服务没有返回可信结果，本次不生成学习记忆。';

    attempts.push({
      id: createId('local_attempt'),
      problemId: problem.id,
      status,
      score,
      maxScore: testCase.points,
      feedback,
      answerPreview: submission.answer,
      selectedOptionIds,
      submissionContext: submission.submissionContext,
      gradingSource: isObjectiveQuestion(quizQuestion) ? 'platform_objective' : 'platform_ai',
      gradingReliable,
      createdAt: now + index + 1,
    });
  }
  file = writeFile({
    ...file,
    attempts: [...attempts, ...file.attempts],
  });

  const latestAttempt = attempts[attempts.length - 1];
  const gradingReliable = attempts.every((attempt) => attempt.gradingReliable === true);
  const baselineProfile = loadStudyMemory(file.user.id, file.notebook.id);
  const existingDurableMemory = baselineProfile.privateMemories.find(
    (memory) =>
      memory.title.toLowerCase().includes(testCase.concept.toLowerCase()) ||
      memory.text.toLowerCase().includes(testCase.concept.toLowerCase()) ||
      memoryReferenceContains(memory, problem.id),
  );
  const submittedAttempts = attempts.filter(
    (attempt) =>
      (attempt.answerPreview?.trim().length || 0) > 0 ||
      (attempt.selectedOptionIds?.length || 0) > 0,
  );
  const diagnosisResponse: LocalAttemptDiagnosisResponse =
    submittedAttempts.length === 0 || !gradingReliable
      ? {
          action: 'diagnose_attempt',
          caseId: testCase.id,
          model: 'deterministic:evidence-gate',
          diagnosis: normalizeAttemptMemoryDiagnosis({
            raw: {
              knowledgePoint: testCase.concept,
              nextTeachingMove: '下次重新呈现题目；没有提交答案时不推断学生会或不会。',
              durableMemoryReason: '没有可靠、已提交且可判定的答案。',
            },
            concept: testCase.concept,
            attempts: attempts.map((attempt) => ({
              status: attempt.status,
              answer: attempt.answerPreview || attempt.selectedOptionIds?.join('、') || '',
              feedback: attempt.feedback,
              gradingSource: attempt.gradingSource || 'not_graded',
              gradingReliable: attempt.gradingReliable === true,
            })),
            hasExistingDurableMemory: Boolean(existingDurableMemory),
          }),
          usage: null,
          persistence: 'none',
        }
      : await backendJson<LocalAttemptDiagnosisResponse>(
          '/api/platform-tests/memory-local-attempt-diagnosis',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-generation-test-no-charge': 'true',
              ...(modelString ? { 'x-model': modelString } : {}),
            },
            body: JSON.stringify({
              action: 'diagnose_attempt',
              caseId: testCase.id,
              problem: {
                id: problem.id,
                title: problem.title,
                prompt: testCase.questionPrompt,
                questionType: testCase.questionType,
                concept: testCase.concept,
                points: testCase.points,
                referenceAnswer: testCase.referenceAnswer,
                rubric: testCase.rubric,
                analysis: testCase.analysis,
              },
              attempts: attempts.map((attempt) => ({
                id: attempt.id,
                status: attempt.status,
                score: attempt.score,
                maxScore: attempt.maxScore || testCase.points,
                answer: attempt.answerPreview || attempt.selectedOptionIds?.join('、') || '',
                feedback: attempt.feedback,
                gradingSource: attempt.gradingSource || 'not_graded',
                gradingReliable: attempt.gradingReliable === true,
              })),
              baseline: {
                level: fixture.learnerProfile.levelLabel,
                summary: fixture.learnerProfile.summary,
                mastered: fixture.learnerProfile.mastered,
                weaknesses: fixture.learnerProfile.weaknesses,
                hasExistingDurableMemory: Boolean(existingDurableMemory),
                existingDurableMemory: existingDurableMemory
                  ? `${existingDurableMemory.title}\n${existingDurableMemory.text}`
                  : null,
              },
            }),
          },
        );
  const diagnosis = diagnosisResponse.diagnosis;
  const canWriteLearningMemory = diagnosis.workingMemoryAction === 'update';
  if (gradingReliable) {
    setQuestionProgress(file.notebook.id, file.user.id, problem.sceneId, problem.id, {
      status: latestAttempt.status === 'passed' ? 'correct' : 'incorrect',
      updatedAt: latestAttempt.createdAt,
      userAnswer: latestAttempt.answerPreview || latestAttempt.selectedOptionIds?.join(', ') || '',
      result: {
        questionId: problem.id,
        correct: latestAttempt.status === 'passed',
        status: latestAttempt.status === 'passed' ? 'correct' : 'incorrect',
        earned: latestAttempt.score,
        aiComment: latestAttempt.feedback,
      },
    });
  }

  const workingResult = !canWriteLearningMemory
    ? null
    : updateNotebookWorkingMemory({
        userId: file.user.id,
        stageId: file.notebook.id,
        memory: {
          source: 'problem_attempt',
          title: `短期学习状态：${testCase.concept}`,
          summary: [
            `${testCase.title}。`,
            `平台最新判题：${latestAttempt.status}，${latestAttempt.score}/${testCase.points} 分。`,
            `判题反馈：${latestAttempt.feedback}`,
          ].join('\n'),
          currentTask: problem.title,
          masteredSignal: diagnosis.masteredSignal || undefined,
          stuckPoint: diagnosis.stuckPoint || undefined,
          probableCause: diagnosis.cause || undefined,
          nextTeachingMove: diagnosis.nextTeachingMove,
          recentAttempt: {
            problemId: problem.id,
            problemTitle: problem.title,
            status: latestAttempt.status,
            score: latestAttempt.score,
            feedback: latestAttempt.feedback,
          },
          evidence: attempts.map((attempt) => ({
            type: 'problem_attempt' as const,
            label: attempt.id,
            text: [
              `${attempt.status} · ${attempt.score}/${testCase.points}: ${attempt.feedback}`,
              attempt.answerPreview ? `提交答案：${attempt.answerPreview}` : '',
              attempt.selectedOptionIds?.length
                ? `提交选项：${attempt.selectedOptionIds.join('、')}`
                : '',
              attempt.submissionContext ? `提交上下文：${attempt.submissionContext}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          })),
        },
      });

  let longTermMemory: NotebookMemoryItem | null = null;
  let longTermChange: 'created' | 'revised' | 'skipped' = 'skipped';
  if (canWriteLearningMemory && diagnosis.durableMemoryAction === 'create') {
    const memoryResult = recordNotebookPrivateMemory({
      userId: file.user.id,
      stageId: file.notebook.id,
      title: `做题写回：${diagnosis.knowledgePoint}`,
      text: [
        diagnosis.masteredSignal ? `掌握：${diagnosis.masteredSignal}` : '',
        diagnosis.stuckPoint ? `薄弱：${diagnosis.stuckPoint}` : '',
        diagnosis.cause ? `原因：${diagnosis.cause}` : '',
        `平台判题：${attempts
          .map(
            (attempt, index) =>
              `第 ${index + 1} 次 ${attempt.score}/${testCase.points} 分，${attempt.feedback}`,
          )
          .join('；')}`,
        `下一步：${diagnosis.nextTeachingMove}`,
        `证据趋势：${diagnosis.trend}`,
      ]
        .filter(Boolean)
        .join('\n'),
      reason: diagnosis.durableMemoryReason,
      kind: latestAttempt.status === 'failed' ? 'mistake' : 'knowledge_gap',
      source: 'quiz',
      sourceReferences: [
        {
          notebookId: file.notebook.id,
          order: 1,
          title: `problem:${problem.id}`,
          why: `attempts:${attempts.map((attempt) => attempt.id).join(',')}`,
        },
      ],
    });
    longTermMemory = memoryResult.item;
    longTermChange = memoryResult.created ? 'created' : 'skipped';
  } else if (
    canWriteLearningMemory &&
    (diagnosis.durableMemoryAction === 'revise' || diagnosis.durableMemoryAction === 'strengthen')
  ) {
    const profile = loadStudyMemory(file.user.id, file.notebook.id);
    const existing = profile.privateMemories.find(
      (memory) =>
        memoryReferenceContains(memory, problem.id) || memory.title.includes(testCase.concept),
    );
    if (existing) {
      const improving = diagnosis.durableMemoryAction === 'revise';
      longTermMemory = {
        ...existing,
        kind: improving ? 'reflection' : 'knowledge_gap',
        status: 'active',
        source: 'quiz',
        title: improving
          ? `复习进展：${diagnosis.knowledgePoint}改善中`
          : `稳定薄弱点：${testCase.concept}跨题重复`,
        text: improving
          ? [
              diagnosis.masteredSignal ? `新证据：${diagnosis.masteredSignal}` : '',
              `本次结果：${latestAttempt.feedback}`,
              '状态：改善中；单次通过不等于稳定掌握。',
              `下一步：${diagnosis.nextTeachingMove}`,
            ]
              .filter(Boolean)
              .join('\n')
          : [
              `新增证据：${diagnosis.stuckPoint || latestAttempt.feedback}`,
              diagnosis.cause ? `原因：${diagnosis.cause}` : '',
              `下一步：${diagnosis.nextTeachingMove}`,
              '处理策略：合并到既有薄弱记忆，不新增重复条目。',
            ]
              .filter(Boolean)
              .join('\n'),
        reason: diagnosis.durableMemoryReason,
        sourceReferences: [
          ...(existing.sourceReferences || []),
          {
            notebookId: file.notebook.id,
            order: (existing.sourceReferences?.length || 0) + 1,
            title: `problem:${problem.id}`,
            why: `${improving ? 'improving' : 'repeated_gap'}_attempts:${attempts
              .map((attempt) => attempt.id)
              .join(',')}`,
          },
        ].slice(-6),
        updatedAt: now,
      };
      saveStudyMemory({
        ...profile,
        privateMemories: profile.privateMemories.map((memory) =>
          memory.id === existing.id ? longTermMemory! : memory,
        ),
        lastTouchedAt: now,
      });
      longTermChange = 'revised';
    }
  }

  const latestProfile = loadStudyMemory(file.user.id, file.notebook.id);
  const weakPointId = `${problem.sceneId}:${problem.id}`;
  const canReviseWeakPoint = diagnosis.durableMemoryAction === 'revise';
  const canOpenWeakPoint =
    diagnosis.durableMemoryAction === 'create' || diagnosis.durableMemoryAction === 'strengthen';
  let weakPoints = latestProfile.weakPoints;
  if (canWriteLearningMemory && latestAttempt.status === 'passed' && canReviseWeakPoint) {
    weakPoints = latestProfile.weakPoints.map((item) =>
      item.questionId === problem.id
        ? { ...item, status: 'reviewed' as const, reviewedAt: now }
        : item,
    );
  } else if (
    canWriteLearningMemory &&
    latestAttempt.status !== 'passed' &&
    canOpenWeakPoint &&
    !latestProfile.weakPoints.some((item) => item.questionId === problem.id)
  ) {
    weakPoints = [
      {
        id: weakPointId,
        sceneId: problem.sceneId,
        questionId: problem.id,
        title: problem.title,
        reason: diagnosis.stuckPoint || latestAttempt.feedback,
        status: 'open' as const,
        createdAt: now,
      },
      ...latestProfile.weakPoints,
    ];
  }
  if (canWriteLearningMemory) {
    saveStudyMemory({
      ...latestProfile,
      quizAttempts: latestProfile.quizAttempts + attempts.length,
      quizCorrect:
        latestProfile.quizCorrect +
        attempts.filter((attempt) => attempt.status === 'passed').length,
      reviewCount: latestProfile.reviewCount + (diagnosis.durableMemoryAction === 'revise' ? 1 : 0),
      lastTouchedAt: now,
      weakPoints: weakPoints.slice(0, 80),
    });
  }

  return {
    testCaseId: testCase.id,
    fixtureUserId: testCase.fixtureUserId,
    reusedProblem,
    problem,
    attempts,
    diagnosisResponse,
    workingMemory: workingResult?.memory || null,
    longTermMemory,
    longTermChange,
    gradingReliable,
  };
}

async function recordSourceUpload(userId: string, sourceTitle?: string, sourceText?: string) {
  let file = requireFile(userId);
  const title = sourceTitle?.trim() || 'CSC148 表示不变量与递归设计资料.md';
  const text =
    sourceText?.trim() ||
    [
      '# CSC148 class contract',
      'A class docstring states the data type, public attributes, and Representation Invariants.',
      'Attribute annotations document expected types; the constructor establishes valid initial state.',
      'For recursive tree methods, every recursive call receives a strictly smaller subtree.',
    ].join('\n\n');
  const [material] = await addCourseMaterials(file.course.id, [
    new File([text], title, { type: 'text/markdown' }),
  ]);
  file = writeFile({
    ...file,
    materialIds: [material.id, ...file.materialIds],
  });
  const memory = recordNotebookPublicMemory({
    userId: file.user.id,
    stageId: file.notebook.id,
    title: 'CSC148 class contract：课程本地约束',
    text: [
      '讲解或批改 class 时，先检查 class docstring、public attributes 与 Representation Invariants。',
      '递归树方法的 recursive call 必须接收严格更小的 subtree。',
      '不要只给通用 OOP 定义，要先遵循这份 CSC148 课程资料中的回答契约。',
      `来源资料：${material.id}`,
    ].join('\n'),
    reason: '只把会改变未来回答形状的课程本地契约提升为公共记忆。',
    kind: 'manual',
    source: 'notebook_generation',
    sourceReferences: [
      {
        notebookId: file.notebook.id,
        order: 1,
        title: `uploaded_material:${material.id}`,
        why: title,
      },
    ],
  });
  return { material, memory: memory.item };
}

type QueueSourceResponse = {
  sourceId: string;
  filename: string;
  queuePath: string;
  content: string;
  size: number;
  modifiedAt: number;
};

type GeneratedSourceNotebook = Extract<PlatformFlowOutput, { kind: 'notebook' }>;
type GeneratedSourceCover = Extract<PlatformFlowOutput, { kind: 'image' }>;

function sourceContractMarker(sourceCase: Csc148SourceUploadCase) {
  return `contractKey:${sourceCase.contractKey}`;
}

function generatedNotebookMarkdown(output: GeneratedSourceNotebook) {
  return [
    `# ${output.title}`,
    '',
    ...output.sections.flatMap((section) => [
      `## ${section.title}`,
      '',
      section.markdown.trim(),
      '',
    ]),
  ]
    .join('\n')
    .trim();
}

async function generatedCoverFile(output: GeneratedSourceCover, basename: string) {
  if (!output.imageUrl) throw new Error('正式图片生成链路没有返回可保存的封面图。');
  const response = await fetch(output.imageUrl);
  if (!response.ok) throw new Error(`无法保存生成封面图：HTTP ${response.status}`);
  const blob = await response.blob();
  const mimeType = blob.type || 'image/png';
  const extension = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
  return new File([blob], `${basename}-cover.${extension}`, { type: mimeType });
}

function upsertSourceContractMemory(args: {
  file: LocalMemoryTestFile;
  sourceCase: Csc148SourceUploadCase;
  material: CourseMaterialListItem;
}) {
  const profile = loadStudyMemory(args.file.user.id, args.file.notebook.id);
  const marker = sourceContractMarker(args.sourceCase);
  const existing = profile.publicMemories.find(
    (memory) =>
      memory.title === args.sourceCase.memoryTitle ||
      memory.sourceReferences?.some((reference) => reference.why?.includes(marker)),
  );
  const sourceReference = {
    notebookId: args.file.notebook.id,
    order: (existing?.sourceReferences?.length || 0) + 1,
    title: `uploaded_material:${args.material.id}`,
    why: `${marker};queue/CSC148/${args.sourceCase.filename}`,
  };

  if (existing) {
    const updatedAt = Date.now();
    const updated: NotebookMemoryItem = {
      ...existing,
      source: 'notebook_generation',
      status: 'active',
      text: args.sourceCase.memoryRules.join('\n'),
      reason: '检测到相同课程契约，保留原 memoryId 并合并新的教师笔记本来源。',
      sourceReferences: [...(existing.sourceReferences || []), sourceReference].slice(-12),
      updatedAt,
    };
    saveStudyMemory({
      ...profile,
      publicMemories: profile.publicMemories.map((memory) =>
        memory.id === existing.id ? updated : memory,
      ),
      lastTouchedAt: updatedAt,
    });
    return { action: 'merged' as const, item: updated, matchedMemoryId: existing.id };
  }

  const result = recordNotebookPublicMemory({
    userId: args.file.user.id,
    stageId: args.file.notebook.id,
    title: args.sourceCase.memoryTitle,
    text: args.sourceCase.memoryRules.join('\n'),
    reason: '只提升会改变未来讲解、代码格式或批改标准的 CSC148 教师课程契约。',
    kind: 'manual',
    source: 'notebook_generation',
    sourceReferences: [{ ...sourceReference, order: 1 }],
  });
  if (!result.item) throw new Error('课程契约记忆内容为空，无法写入。');
  return { action: 'created' as const, item: result.item, matchedMemoryId: null };
}

async function recordSourceUploadMemoryCase(userId: string, testCaseId: string) {
  const sourceCase = getCsc148SourceUploadCase(testCaseId);
  if (!sourceCase) throw new Error('未知的 CSC148 queue 文件测试。');
  let file = requireFile(userId);

  const response = await fetch(
    `/api/platform-tests/memory-local-source?caseId=${encodeURIComponent(sourceCase.id)}`,
    { cache: 'no-store' },
  );
  const payload = (await response.json()) as QueueSourceResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error || '无法读取本地 CSC148 queue 文件。');

  const [sourceMaterial] = await addCourseMaterials(file.course.id, [
    new File([payload.content], sourceCase.filename, { type: 'text/markdown' }),
  ]);
  file = writeFile({ ...file, materialIds: [sourceMaterial.id, ...file.materialIds] });

  const memoryResult = upsertSourceContractMemory({ file, sourceCase, material: sourceMaterial });
  return {
    testCaseId: sourceCase.id,
    fixtureUserId: sourceCase.fixtureUserId,
    source: {
      queuePath: payload.queuePath,
      filename: payload.filename,
      size: payload.size,
      modifiedAt: payload.modifiedAt,
      material: sourceMaterial,
    },
    memory: {
      action: memoryResult.action,
      matchedMemoryId: memoryResult.matchedMemoryId,
      item: memoryResult.item,
      contractKey: sourceCase.contractKey,
    },
  };
}

async function saveSourceUploadNotebook(
  userId: string,
  testCaseId: string,
  output: GeneratedSourceNotebook,
) {
  const sourceCase = getCsc148SourceUploadCase(testCaseId);
  if (!sourceCase) throw new Error('未知的 CSC148 queue 文件测试。');
  let file = requireFile(userId);
  const notebookContent = generatedNotebookMarkdown(output);
  const notebookFilename = `${sourceCase.id}-generated-notebook.md`;
  const [notebookMaterial] = await addCourseMaterials(file.course.id, [
    new File([notebookContent], notebookFilename, { type: 'text/markdown' }),
  ]);
  file = writeFile({ ...file, materialIds: [notebookMaterial.id, ...file.materialIds] });
  return {
    testCaseId: sourceCase.id,
    fixtureUserId: sourceCase.fixtureUserId,
    notebook: {
      material: notebookMaterial,
      filename: notebookFilename,
      content: notebookContent,
      output,
    },
  };
}

async function saveSourceUploadCover(
  userId: string,
  testCaseId: string,
  output: GeneratedSourceCover,
) {
  const sourceCase = getCsc148SourceUploadCase(testCaseId);
  if (!sourceCase) throw new Error('未知的 CSC148 queue 文件测试。');
  let file = requireFile(userId);
  const coverFile = await generatedCoverFile(output, sourceCase.id);
  const [coverMaterial] = await addCourseMaterials(file.course.id, [coverFile]);
  file = writeFile({ ...file, materialIds: [coverMaterial.id, ...file.materialIds] });
  return {
    testCaseId: sourceCase.id,
    fixtureUserId: sourceCase.fixtureUserId,
    cover: {
      material: coverMaterial,
      filename: coverFile.name,
      output,
    },
  };
}

async function recordQuestion(userId: string, customQuestion?: string) {
  let file = requireFile(userId);
  const now = Date.now();
  const conversationId = createId('local_conversation');
  const question =
    customQuestion?.trim() || '树递归里我知道要写 base case，但为什么每次递归都必须缩小问题规模？';
  const conversation: LocalConversation = {
    id: conversationId,
    title: '树递归的规模缩小',
    createdAt: now,
    messages: [
      { id: createId('local_message'), role: 'user', content: question, createdAt: now },
      {
        id: createId('local_message'),
        role: 'assistant',
        content: '先用三节点树观察每次调用收到的 subtree，再把这个变化写成终止性不变量。',
        createdAt: now + 1,
      },
    ],
  };
  file = writeFile({
    ...file,
    conversations: [conversation, ...file.conversations],
  });
  updateNotebookWorkingMemory({
    userId: file.user.id,
    stageId: file.notebook.id,
    memory: {
      source: 'chat_turn',
      title: '短期学习状态',
      summary: '学生掌握 base case 的用途，但尚未把规模严格缩小与递归终止联系起来。',
      currentTask: '理解树递归的终止性与 recursive subproblem',
      masteredSignal: '知道递归函数需要 base case。',
      stuckPoint: '不理解 recursive call 为什么必须处理严格更小的 subtree。',
      nextTeachingMove: '先画三节点树的调用序列，再让学生指出每一步规模如何减少。',
      evidence: [
        {
          type: 'student_message',
          label: `conversation:${conversation.id}`,
          text: question.slice(0, 160),
        },
      ],
    },
  });
  // Legacy explanation fixtures keep this single question in overwriteable
  // working memory only. A direct concept question is not durable evidence of
  // a recurring learner pattern.
  return { conversation, memory: null, durableMemoryAction: 'skip' as const };
}

async function recordQuestionWritebackCase(
  userId: string,
  testCaseId: string,
  diagnosisResponse: LocalQuestionDiagnosisResponse,
) {
  const testCase = getCsc148QuestionWritebackCase(testCaseId);
  if (!testCase) throw new Error('未知的提问记忆写回测试。');
  if (
    diagnosisResponse.action !== 'diagnose_question' ||
    diagnosisResponse.caseId !== testCase.id
  ) {
    throw new Error('提问诊断结果与当前测试不匹配。');
  }

  let file = requireFile(userId);
  const now = Date.now();
  const conversationId = createId('local_conversation');
  const studentMessageId = createId('local_message');
  const assistantMessageId = createId('local_message');
  const conversation: LocalConversation = {
    id: conversationId,
    title: testCase.title,
    createdAt: now,
    messages: [
      {
        id: studentMessageId,
        role: 'user',
        content: testCase.userMessage,
        createdAt: now,
      },
      {
        id: assistantMessageId,
        role: 'assistant',
        content: diagnosisResponse.assistantReply,
        createdAt: now + 1,
      },
    ],
  };
  file = writeFile({ ...file, conversations: [conversation, ...file.conversations] });

  const diagnosis = diagnosisResponse.diagnosis;
  const workingResult =
    diagnosis.workingMemoryAction === 'update'
      ? updateNotebookWorkingMemory({
          userId: file.user.id,
          stageId: file.notebook.id,
          memory: {
            source: 'chat_turn',
            title: `短期学习状态：${diagnosis.knowledgePoint}`,
            summary: [
              diagnosis.masteredSignal ? `掌握：${diagnosis.masteredSignal}` : '',
              diagnosis.stuckPoint ? `薄弱：${diagnosis.stuckPoint}` : '',
              diagnosis.cause ? `原因：${diagnosis.cause}` : '',
              `下一步：${diagnosis.nextTeachingMove}`,
            ]
              .filter(Boolean)
              .join('\n'),
            currentTask: diagnosis.knowledgePoint,
            masteredSignal: diagnosis.masteredSignal || undefined,
            stuckPoint: diagnosis.stuckPoint || undefined,
            probableCause: diagnosis.cause || undefined,
            nextTeachingMove: diagnosis.nextTeachingMove,
            evidence: diagnosis.evidenceFromMessage.map((text, index) => ({
              type: 'student_message' as const,
              label: `conversation:${conversation.id};excerpt:${index + 1}`,
              text,
            })),
          },
        })
      : null;

  let durableMemory: NotebookMemoryItem | null = null;
  let durableMemoryChange: 'created' | 'revised' | 'skipped' = 'skipped';
  if (diagnosis.durableMemoryAction === 'create') {
    const result = recordNotebookPrivateMemory({
      userId: file.user.id,
      stageId: file.notebook.id,
      title: `提问诊断：${diagnosis.knowledgePoint}`,
      text: [
        diagnosis.masteredSignal ? `掌握：${diagnosis.masteredSignal}` : '',
        diagnosis.stuckPoint ? `薄弱：${diagnosis.stuckPoint}` : '',
        diagnosis.cause ? `原因：${diagnosis.cause}` : '',
        `下一步：${diagnosis.nextTeachingMove}`,
        `置信度：${diagnosis.confidence}`,
      ]
        .filter(Boolean)
        .join('\n'),
      reason: diagnosis.durableMemoryReason,
      kind: 'knowledge_gap',
      source: 'chat',
      sourceReferences: [
        {
          notebookId: file.notebook.id,
          order: 1,
          title: `conversation:${conversation.id}`,
          why: `message:${studentMessageId};course_source:${testCase.sourceFilename || 'none'}`,
        },
      ],
    });
    durableMemory = result.item;
    durableMemoryChange = result.created ? 'created' : 'skipped';
  } else if (diagnosis.durableMemoryAction === 'revise') {
    const profile = loadStudyMemory(file.user.id, file.notebook.id);
    const existing = profile.privateMemories.find(
      (memory) =>
        memory.title.includes(diagnosis.knowledgePoint) ||
        memory.text.toLowerCase().includes(diagnosis.knowledgePoint.toLowerCase()),
    );
    if (existing) {
      durableMemory = {
        ...existing,
        title: `提问诊断更新：${diagnosis.knowledgePoint}`,
        text: [
          diagnosis.masteredSignal ? `掌握：${diagnosis.masteredSignal}` : '',
          diagnosis.stuckPoint ? `薄弱：${diagnosis.stuckPoint}` : '',
          diagnosis.cause ? `原因：${diagnosis.cause}` : '',
          `下一步：${diagnosis.nextTeachingMove}`,
          `置信度：${diagnosis.confidence}`,
        ]
          .filter(Boolean)
          .join('\n'),
        reason: diagnosis.durableMemoryReason,
        source: 'chat',
        sourceReferences: [
          ...(existing.sourceReferences || []),
          {
            notebookId: file.notebook.id,
            order: (existing.sourceReferences?.length || 0) + 1,
            title: `conversation:${conversation.id}`,
            why: `message:${studentMessageId};course_source:${testCase.sourceFilename || 'none'}`,
          },
        ].slice(-8),
        updatedAt: now,
      };
      saveStudyMemory({
        ...profile,
        privateMemories: profile.privateMemories.map((memory) =>
          memory.id === existing.id ? durableMemory! : memory,
        ),
        lastTouchedAt: now,
      });
      durableMemoryChange = 'revised';
    }
  }

  return {
    testCaseId: testCase.id,
    fixtureUserId: testCase.fixtureUserId,
    conversation,
    diagnosisResponse,
    workingMemory: workingResult?.memory || null,
    durableMemory,
    durableMemoryChange,
  };
}

function seedPreferences(userId: string) {
  let file = requireFile(userId);
  const facts = [
    ['profile', 'display_name', file.user.name],
    [
      'profile',
      'program',
      { school: 'University of Toronto', program: 'Computer Science', year: 2 },
    ],
    ['preference', 'language', 'zh-CN'],
    [
      'preference',
      'explanation_style',
      {
        order: ['visual_intuition', 'small_example', 'formal_definition', 'code'],
        avoid: ['long_abstract_preamble'],
      },
    ],
    ['habit', 'study_session', { preferredMinutes: 35, preferredTime: '20:00', questionCount: 3 }],
  ] as const;
  for (const [namespace, key, valueJson] of facts) {
    file = upsertFactInFile({
      file,
      namespace,
      key,
      valueJson,
      source: 'memory-phase2-local-explicit',
      sourceRef: { trigger: 'explicit_user' },
    });
  }
  return { facts: file.facts };
}

function upsertFact(args: { userId: string; namespace: string; key: string; valueJson: unknown }) {
  const file = upsertFactInFile({
    file: requireFile(args.userId),
    namespace: args.namespace.trim(),
    key: args.key.trim(),
    valueJson: args.valueJson,
    source: 'memory-phase2-local-manual',
    sourceRef: { trigger: 'manual_test' },
  });
  return {
    fact: file.facts.find((fact) => fact.namespace === args.namespace && fact.key === args.key),
  };
}

function upsertCalendar(args: {
  userId: string;
  eventId?: string;
  title?: string;
  startsAt?: string;
  durationMinutes?: number;
}) {
  const eventId = args.eventId?.trim() || 'recursion-review';
  const file = upsertFactInFile({
    file: requireFile(args.userId),
    namespace: 'calendar',
    key: `event:${eventId}`,
    valueJson: {
      id: eventId,
      title: args.title?.trim() || '复习树递归与 Representation Invariants',
      startsAt: args.startsAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      durationMinutes: args.durationMinutes || 35,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      status: 'confirmed',
    },
    source: 'calendar-memory-local',
    sourceRef: { sourceType: 'calendar', sourceId: eventId },
  });
  return {
    fact: file.facts.find(
      (fact) => fact.namespace === 'calendar' && fact.key === `event:${eventId}`,
    ),
  };
}

function deleteMemory(userId: string, layer: string, memoryId: string) {
  let file = requireFile(userId);
  if (layer === 'structured_fact') {
    const fact = file.facts.find((item) => item.id === memoryId);
    if (!fact) return { deleted: false };
    const now = Date.now();
    file = writeFile({
      ...file,
      facts: file.facts.filter((item) => item.id !== memoryId),
      factEvents: [
        {
          id: createId('local_fact_event'),
          factId: fact.id,
          namespace: fact.namespace,
          key: fact.key,
          eventType: 'deleted' as const,
          oldValueJson: fact.valueJson,
          newValueJson: null,
          createdAt: now,
        },
        ...file.factEvents,
      ].slice(0, 200),
    });
    return { deleted: true, fact };
  }
  const profile = loadStudyMemory(file.user.id, file.notebook.id);
  if (memoryId === `working-memory:${file.notebook.id}`) {
    saveStudyMemory({ ...profile, workingMemory: undefined, lastTouchedAt: Date.now() });
    return { deleted: true, memoryId };
  }
  const beforeCount = profile.publicMemories.length + profile.privateMemories.length;
  const publicMemories = profile.publicMemories.filter((item) => item.id !== memoryId);
  const privateMemories = profile.privateMemories.filter((item) => item.id !== memoryId);
  saveStudyMemory({
    ...profile,
    lastTouchedAt: Date.now(),
    publicMemories,
    privateMemories,
  });
  return {
    deleted: publicMemories.length + privateMemories.length < beforeCount,
    memoryId,
  };
}

async function deleteSource(userId: string, sourceType: string, sourceId: string) {
  let file = requireFile(userId);
  if (sourceType === 'problem') {
    const problem = file.problems.find((item) => item.id === sourceId);
    if (problem) {
      clearQuestionProgress(file.notebook.id, file.user.id, problem.sceneId, problem.id);
    }
    file = writeFile({
      ...file,
      problems: file.problems.filter((item) => item.id !== sourceId),
      attempts: file.attempts.filter((item) => item.problemId !== sourceId),
    });
  } else if (sourceType === 'conversation') {
    file = writeFile({
      ...file,
      conversations: file.conversations.filter((item) => item.id !== sourceId),
    });
  } else if (sourceType === 'uploaded_material') {
    await deleteCourseMaterial(sourceId);
    file = writeFile({
      ...file,
      materialIds: file.materialIds.filter((item) => item !== sourceId),
    });
  }

  const profile = loadStudyMemory(file.user.id, file.notebook.id);
  const workingMatches =
    profile.workingMemory?.recentAttempt?.problemId === sourceId ||
    JSON.stringify(profile.workingMemory?.evidence || []).includes(sourceId);
  const publicMemories = profile.publicMemories.filter(
    (item) => !memoryReferenceContains(item, sourceId),
  );
  const privateMemories = profile.privateMemories.filter(
    (item) => !memoryReferenceContains(item, sourceId),
  );
  const deletedMemories =
    profile.publicMemories.length +
    profile.privateMemories.length -
    publicMemories.length -
    privateMemories.length +
    (workingMatches ? 1 : 0);
  saveStudyMemory({
    ...profile,
    workingMemory: workingMatches ? undefined : profile.workingMemory,
    publicMemories,
    privateMemories,
    lastTouchedAt: Date.now(),
  });
  return { sourceType, sourceId, deletedMemories };
}

function scenarioRunUserId(scenarioId: string, fixture: LocalMemoryTestUserFixture) {
  return `memory-test-run-${fixture.learnerProfile.levelId}-${stableSuffix(scenarioId)}`;
}

export async function disposeLocalMemoryTestScenarioRun(userId: string) {
  if (!readFile(userId)) return;
  await resetLocalMemoryTestSandbox(userId);
}

export async function prepareLocalMemoryTestScenarioRun(args: {
  scenarioId: string;
  fixtureUserId: string;
}): Promise<LocalMemoryTestSnapshot> {
  const fixture = LOCAL_MEMORY_TEST_USER_FIXTURES.find(
    (item) => item.userId === args.fixtureUserId,
  );
  if (!fixture) throw new Error('未知的四水平模拟用户。');

  const runUserId = scenarioRunUserId(args.scenarioId, fixture);
  await disposeLocalMemoryTestScenarioRun(runUserId);
  await seedLocalMemoryTestUserFixture(fixture, runUserId);

  if (args.scenarioId === 'memory-layered-query') {
    await recordProblemAttempts(runUserId);
    upsertCalendar({ userId: runUserId });
  } else if (args.scenarioId === 'memory-source-cascade-delete') {
    await recordProblemAttempts(runUserId);
    await recordQuestion(runUserId);
    await recordSourceUpload(runUserId);
  } else if (args.scenarioId === 'memory-ai-question-generation') {
    await recordProblemAttempts(runUserId);
  } else if (args.scenarioId === 'memory-ai-explanation') {
    await recordQuestion(runUserId);
  } else if (args.scenarioId === 'memory-ai-review-plan') {
    await recordProblemAttempts(runUserId);
  } else if (args.scenarioId === 'memory-ai-next-action') {
    await recordProblemAttempts(runUserId);
    upsertCalendar({ userId: runUserId });
  }

  return getLocalMemoryTestSnapshot(runUserId);
}

function countDelta(
  before: LocalMemoryTestSnapshot['counts'],
  after: LocalMemoryTestSnapshot['counts'],
) {
  return Object.fromEntries(
    (Object.keys(before) as Array<keyof typeof before>).map((key) => [
      key,
      after[key] - before[key],
    ]),
  ) as LocalMemoryMutationResponse['delta'];
}

export async function runLocalMemoryTestAction(input: {
  action: string;
  userId: string;
  [key: string]: unknown;
}): Promise<LocalMemoryMutationResponse> {
  const userId = assertTestUserId(input.userId);
  const before = await getLocalMemoryTestSnapshot(userId);
  let result: unknown;
  if (input.action === 'record_problem_attempts') {
    result =
      typeof input.testCaseId === 'string'
        ? await recordProblemWritebackCase(
            userId,
            input.testCaseId,
            typeof input.modelString === 'string' ? input.modelString : undefined,
          )
        : await recordProblemAttempts(userId);
  } else if (input.action === 'record_source_upload_memory_case') {
    result = await recordSourceUploadMemoryCase(userId, String(input.testCaseId || ''));
  } else if (input.action === 'save_source_upload_notebook') {
    const notebook = input.generatedNotebook as GeneratedSourceNotebook | undefined;
    if (notebook?.kind !== 'notebook') throw new Error('缺少第一阶段结构化笔记本结果。');
    result = await saveSourceUploadNotebook(userId, String(input.testCaseId || ''), notebook);
  } else if (input.action === 'save_source_upload_cover') {
    const cover = input.generatedCover as GeneratedSourceCover | undefined;
    if (cover?.kind !== 'image') throw new Error('缺少第一阶段正式封面图结果。');
    result = await saveSourceUploadCover(userId, String(input.testCaseId || ''), cover);
  } else if (input.action === 'record_source_upload') {
    result = await recordSourceUpload(
      userId,
      typeof input.sourceTitle === 'string' ? input.sourceTitle : undefined,
      typeof input.text === 'string' ? input.text : undefined,
    );
  } else if (input.action === 'record_question') {
    result = await recordQuestion(
      userId,
      typeof input.question === 'string' ? input.question : undefined,
    );
  } else if (input.action === 'record_question_case') {
    if (!input.diagnosisResponse || typeof input.diagnosisResponse !== 'object') {
      throw new Error('缺少模型生成的提问诊断结果。');
    }
    result = await recordQuestionWritebackCase(
      userId,
      String(input.testCaseId || ''),
      input.diagnosisResponse as LocalQuestionDiagnosisResponse,
    );
  } else if (input.action === 'seed_preferences') {
    result = seedPreferences(userId);
  } else if (input.action === 'upsert_fact') {
    result = upsertFact({
      userId,
      namespace: String(input.namespace || ''),
      key: String(input.key || ''),
      valueJson: input.valueJson,
    });
  } else if (input.action === 'upsert_calendar') {
    result = upsertCalendar({
      userId,
      eventId: typeof input.eventId === 'string' ? input.eventId : undefined,
      title: typeof input.title === 'string' ? input.title : undefined,
      startsAt: typeof input.startsAt === 'string' ? input.startsAt : undefined,
      durationMinutes:
        typeof input.durationMinutes === 'number' ? input.durationMinutes : undefined,
    });
  } else if (input.action === 'upsert_calendar_roundtrip') {
    const eventId = typeof input.eventId === 'string' ? input.eventId : 'recursion-review';
    const created = upsertCalendar({
      userId,
      eventId,
      title: '第一次安排：树递归复习',
      startsAt: '2026-07-15T12:00:00.000Z',
      durationMinutes: 20,
    });
    const updated = upsertCalendar({
      userId,
      eventId,
      title: typeof input.title === 'string' ? input.title : undefined,
      startsAt: typeof input.startsAt === 'string' ? input.startsAt : undefined,
      durationMinutes:
        typeof input.durationMinutes === 'number' ? input.durationMinutes : undefined,
    });
    result = { created, updated };
  } else if (input.action === 'delete_memory') {
    result = deleteMemory(userId, String(input.layer || ''), String(input.memoryId || ''));
  } else if (input.action === 'delete_source') {
    result = await deleteSource(
      userId,
      String(input.sourceType || ''),
      String(input.sourceId || ''),
    );
  } else {
    throw new Error(`未知本地测试操作：${input.action}`);
  }
  const after = await getLocalMemoryTestSnapshot(userId);
  return {
    action: input.action,
    result,
    delta: countDelta(before.counts, after.counts),
    before,
    after,
    snapshot: after,
  };
}

function queryTokens(query: string) {
  const lower = query.toLowerCase();
  const latin = lower.match(/[a-z0-9_:-]{2,}/g) || [];
  const cjkRuns = lower.match(/[\u3400-\u9fff]{2,}/g) || [];
  const cjkBigrams = cjkRuns.flatMap((run) =>
    Array.from({ length: Math.max(0, run.length - 1) }, (_, index) => run.slice(index, index + 2)),
  );
  return Array.from(new Set([...latin, ...cjkBigrams])).slice(0, 40);
}

function matchScore(value: unknown, tokens: string[]) {
  const text = JSON.stringify(value).toLowerCase();
  return tokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0);
}

export async function queryLocalMemoryTest(userId: string, query: string) {
  const snapshot = await getLocalMemoryTestSnapshot(userId);
  const tokens = queryTokens(query);
  const facts = snapshot.facts
    .map((fact) => ({ fact, score: matchScore(fact, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const memories = snapshot.studyMemories
    .map((memory) => ({ memory, score: matchScore(memory, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return {
    storage: snapshot.storage,
    query,
    tokens,
    readPlan: [
      '1. 精确当前值：本地 facts（资料、偏好、习惯、日历）',
      '2. 当前学习状态：NotebookWorkingMemory',
      '3. 本地公共/私有 StudyMemory',
      '4. 本地关键词召回；此测试不访问服务端向量库或数据库',
    ],
    counts: {
      exactFacts: facts.length,
      workingMemory: snapshot.workingMemory ? 1 : 0,
      matchedMemories: memories.length,
    },
    facts,
    workingMemory: snapshot.workingMemory,
    memories,
  };
}

export async function buildLocalMemoryEvidence(userId: string): Promise<{
  instruction: string;
  evidence: LocalMemoryEvidence[];
  snapshot: LocalMemoryTestSnapshot;
}> {
  const snapshot = await getLocalMemoryTestSnapshot(userId);
  const evidence: LocalMemoryEvidence[] = [
    {
      id: `local-user:${snapshot.user.id}`,
      layer: 'profile',
      title: '本地模拟用户',
      content: JSON.stringify({
        user: snapshot.user,
        course: snapshot.course,
        notebook: snapshot.notebook,
      }),
    },
    ...snapshot.facts.map((fact) => ({
      id: fact.id,
      layer: 'exact_fact' as const,
      title: `${fact.namespace}:${fact.key}`,
      content: JSON.stringify(fact.valueJson),
    })),
    ...snapshot.studyMemories.map((memory) => ({
      id: memory.id,
      layer:
        memory.kind === 'working_state'
          ? ('working_memory' as const)
          : memory.scope === 'public'
            ? ('public_memory' as const)
            : ('private_memory' as const),
      title: memory.title,
      content: memory.text,
    })),
  ];
  return {
    instruction: [
      '以下证据全部来自浏览器本地模拟用户。',
      '精确事实优先于文本记忆；当前工作记忆优先于较旧的公共/私有记忆。',
      '只能引用下列真实 evidence id，不得编造。',
    ].join('\n'),
    evidence,
    snapshot,
  };
}
