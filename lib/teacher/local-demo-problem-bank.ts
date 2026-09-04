import type { NotebookProblemPublicCode } from '@/lib/problem-bank/schema';
import type {
  CourseProblemChapter,
  NotebookProblemClientRecord,
} from '@/lib/utils/notebook-problem-api';
import type { CourseRecord } from '@/lib/utils/database';

const LOCAL_DEMO_PROBLEM_BANK_COURSE_IDS = new Set(['demo-csc148']);

const CSC148_NOTEBOOKS = {
  memory: {
    id: 'demo-csc148-notebook-1',
    name: 'Python 内存模型与对象管理',
  },
  oop: {
    id: 'demo-csc148-notebook-3',
    name: '类与对象 (Class and Object)',
  },
  adt: {
    id: 'demo-csc148-notebook-5',
    name: '抽象数据类型、栈与队列',
  },
  linkedList: {
    id: 'demo-csc148-notebook-7',
    name: 'Linked List',
  },
  recursion: {
    id: 'demo-csc148-notebook-8',
    name: '递归学习笔记',
  },
  trees: {
    id: 'demo-csc148-notebook-9',
    name: '树（Trees）',
  },
} as const;

const LOCAL_DEMO_PROBLEM_NOW = Date.UTC(2026, 7, 11, 9, 0, 0);

function baseProblem(
  partial: Omit<NotebookProblemClientRecord, 'courseId' | 'createdAt' | 'updatedAt' | 'sourceMeta'>,
): NotebookProblemClientRecord {
  return {
    ...partial,
    courseId: 'demo-csc148',
    sourceMeta: { localDemo: true },
    createdAt: LOCAL_DEMO_PROBLEM_NOW - partial.order * 86_400_000,
    updatedAt: LOCAL_DEMO_PROBLEM_NOW - partial.order * 3_600_000,
  };
}

const CSC148_DEMO_PROBLEMS: NotebookProblemClientRecord[] = [
  baseProblem({
    id: 'demo-csc148-problem-choice-memory',
    notebookId: CSC148_NOTEBOOKS.memory.id,
    notebookName: CSC148_NOTEBOOKS.memory.name,
    title: 'Python 对象三要素与变量关系',
    type: 'choice',
    status: 'published',
    source: 'manual',
    order: 1,
    problemNumber: 1,
    points: 100,
    tags: ['对象三要素', '变量', 'id', '类型'],
    difficulty: 'easy',
    publicContent: {
      type: 'choice',
      stem: '关于 Python 对象的「三要素」（id、类型、值）和变量的关系，下列哪一项描述是正确的？',
      selectionMode: 'single',
      options: [
        { id: 'a', label: '变量直接保存对象的具体数据（值），不是对对象的引用' },
        { id: 'b', label: '内置函数 `id()` 返回对象的唯一标识符（在对象生命周期内唯一）' },
        { id: 'c', label: '可以通过给变量重新赋值直接改变某个已存在对象的类型' },
        { id: 'd', label: '如果两个对象的值相同，则它们的 id 必然相同' },
      ],
      explanation:
        '变量是引用；`id()` 在对象存活期间唯一；赋值只是改变引用目标，不会修改原对象类型；值相同不保证 id 相同。',
    },
    grading: {
      type: 'choice',
      correctOptionIds: ['b'],
    },
  }),
  baseProblem({
    id: 'demo-csc148-problem-choice-tracing',
    notebookId: CSC148_NOTEBOOKS.memory.id,
    notebookName: CSC148_NOTEBOOKS.memory.name,
    title: '代码追踪：列表引用与浅拷贝',
    type: 'choice',
    status: 'published',
    source: 'manual',
    order: 2,
    problemNumber: 2,
    points: 100,
    tags: ['代码追踪', '引用', '浅拷贝'],
    difficulty: 'easy',
    publicContent: {
      type: 'choice',
      stem: `运行下面代码，输出结果是什么？（注意每一行的输出顺序和格式）

\`\`\`python
a = [1, 2]
b = a
c = a[:]
print(a, b, c)
print(a is b, a is c)
a[0] = 9
print(a, b, c)
print(id(a) == id(b), id(a) == id(c))
\`\`\``,
      selectionMode: 'single',
      options: [
        {
          id: 'a',
          label: '[1, 2] [1, 2] [1, 2]\nTrue False\n[9, 2] [9, 2] [1, 2]\nTrue False',
        },
        {
          id: 'b',
          label: '[1, 2] [1, 2] [1, 2]\nFalse False\n[9, 2] [9, 2] [9, 2]\nFalse False',
        },
        {
          id: 'c',
          label: '[1, 2] [1, 2] [1, 2]\nTrue True\n[9, 2] [9, 2] [9, 2]\nTrue True',
        },
        {
          id: 'd',
          label: '[1, 2] [1, 2] [1, 2]\nTrue False\n[9, 2] [1, 2] [1, 2]\nTrue False',
        },
      ],
      explanation:
        'b 与 a 引用同一对象；c 是浅拷贝。修改 a 会影响 b，但不影响 c；因此第三行输出中 c 仍为 [1, 2]。',
    },
    grading: {
      type: 'choice',
      correctOptionIds: ['a'],
    },
  }),
  baseProblem({
    id: 'demo-csc148-problem-short-oop',
    notebookId: CSC148_NOTEBOOKS.oop.id,
    notebookName: CSC148_NOTEBOOKS.oop.name,
    title: '解释 Representation Invariant 的作用',
    type: 'short_answer',
    status: 'published',
    source: 'manual',
    order: 3,
    problemNumber: 3,
    points: 100,
    tags: ['OOP', 'Representation Invariant', 'docstring'],
    difficulty: 'medium',
    publicContent: {
      type: 'short_answer',
      stem: '在 CSC148 的类设计中，为什么要在 docstring 里单独写出 **Representation Invariants**？它和方法前后需要满足的不变式有什么关系？',
      explanation:
        'RI 描述对象内部表示必须始终满足的条件；`__init__` 负责建立 RI，每个会改变表示的公开方法在退出时都要恢复 RI。',
    },
    grading: {
      type: 'short_answer',
      referenceAnswer:
        'Representation Invariants 描述对象内部表示始终为真的条件。初始化方法负责建立 RI，每个会修改内部状态的公开方法在返回前必须恢复 RI，这样客户端才能安全使用对象。',
      rubric: '需提到 RI 是表示层不变式，并区分建立（init）与恢复（mutator exit）。',
    },
  }),
  baseProblem({
    id: 'demo-csc148-problem-proof-linked-list',
    notebookId: CSC148_NOTEBOOKS.linkedList.id,
    notebookName: CSC148_NOTEBOOKS.linkedList.name,
    title: '证明：有序单链表插入保持有序',
    type: 'proof',
    status: 'published',
    source: 'manual',
    order: 4,
    problemNumber: 4,
    points: 100,
    tags: ['Linked List', '证明', '有序链表'],
    difficulty: 'medium',
    publicContent: {
      type: 'proof',
      stem: '设 `L` 是按非降序排列的单链表。证明：若按 CSC148 课程讲义中的标准插入算法，将元素 `x` 插入到正确位置，则结果链表仍按非降序排列。',
      explanation:
        '对插入位置分「空表 / 头部 / 中间 / 尾部」讨论，每种情况都保持相邻结点值关系不变。',
    },
    grading: {
      type: 'proof',
      referenceProof:
        '归纳或分情形：插入前链表有序；新结点只插入到第一个不小于 x 的位置之前，因此左邻 ≤ x ≤ 右邻，局部与全局有序性均保持。',
      rubric: '需覆盖头部插入、中间插入与尾部插入，并说明有序性未被破坏。',
    },
  }),
  baseProblem({
    id: 'demo-csc148-problem-calculation-bst',
    notebookId: CSC148_NOTEBOOKS.trees.id,
    notebookName: CSC148_NOTEBOOKS.trees.name,
    title: 'BST 查找的比较次数',
    type: 'calculation',
    status: 'published',
    source: 'manual',
    order: 5,
    problemNumber: 5,
    points: 100,
    tags: ['BST', '复杂度', '比较次数'],
    difficulty: 'medium',
    publicContent: {
      type: 'calculation',
      stem: '在一棵**平衡**二叉搜索树中查找一个存在的键，最坏情况下需要进行多少次键比较？（只计比较次数，给出数值）',
      unit: '次',
      explanation: '平衡 BST 高度为 O(log n)；最坏比较次数等于树高。',
    },
    grading: {
      type: 'calculation',
      referenceAnswer: 'log2(n) 上取整',
      acceptedForms: ['⌈log2 n⌉', 'ceil(log2(n))', 'O(log n)'],
      analysis: '课程语境下接受以树高表示的最坏比较次数。',
    },
  }),
  baseProblem({
    id: 'demo-csc148-problem-calculation-recursion',
    notebookId: CSC148_NOTEBOOKS.recursion.id,
    notebookName: CSC148_NOTEBOOKS.recursion.name,
    title: '递归调用次数',
    type: 'calculation',
    status: 'published',
    source: 'manual',
    order: 6,
    problemNumber: 6,
    points: 100,
    tags: ['递归', 'trace', '调用栈'],
    difficulty: 'easy',
    publicContent: {
      type: 'calculation',
      stem: '执行 `f(4)` 时，下面递归函数一共会调用多少次 `f`（包含最初那次）？\n\n```python\ndef f(n: int) -> int:\n    if n <= 1:\n        return 1\n    return f(n - 1) + f(n - 2)\n```',
      explanation: '画出递归树或列出调用序列：f(4) → f(3)+f(2) → …',
    },
    grading: {
      type: 'calculation',
      referenceAnswer: '9',
      acceptedForms: ['9', '九'],
    },
  }),
  baseProblem({
    id: 'demo-csc148-problem-fill-adt',
    notebookId: CSC148_NOTEBOOKS.adt.id,
    notebookName: CSC148_NOTEBOOKS.adt.name,
    title: '栈操作结果',
    type: 'fill_blank',
    status: 'published',
    source: 'manual',
    order: 7,
    problemNumber: 7,
    points: 100,
    tags: ['栈', 'ADT', 'LIFO'],
    difficulty: 'easy',
    publicContent: {
      type: 'fill_blank',
      stemTemplate:
        '对空栈依次执行 `push(3)`、`push(7)`、`pop()`、`push(1)`、`pop()` 后，栈顶元素是 {{top}}，栈的大小是 {{size}}。',
      blanks: [
        { id: 'top', placeholder: '栈顶元素' },
        { id: 'size', placeholder: '栈的大小' },
      ],
      explanation: 'pop 两次后栈中仅剩 3，因此 top=3，size=1。',
    },
    grading: {
      type: 'fill_blank',
      blanks: [
        { id: 'top', acceptedAnswers: ['3'], caseSensitive: false },
        { id: 'size', acceptedAnswers: ['1', '一'], caseSensitive: false },
      ],
    },
  }),
  baseProblem({
    id: 'demo-csc148-problem-fill-bst',
    notebookId: CSC148_NOTEBOOKS.trees.id,
    notebookName: CSC148_NOTEBOOKS.trees.name,
    title: 'BST 中序遍历性质',
    type: 'short_answer',
    status: 'published',
    source: 'manual',
    order: 8,
    problemNumber: 8,
    points: 100,
    tags: ['BST', '中序遍历', '有序性'],
    difficulty: 'easy',
    publicContent: {
      type: 'short_answer',
      stem: '对一棵合法 BST 做中序遍历（inorder traversal），得到的键序列具有什么性质？',
      explanation: 'BST 的中序遍历会按非降序输出所有键。',
    },
    grading: {
      type: 'short_answer',
      referenceAnswer: '键序列按非降序排列。',
    },
  }),
  baseProblem({
    id: 'demo-csc148-problem-code-sum-list',
    notebookId: CSC148_NOTEBOOKS.linkedList.id,
    notebookName: CSC148_NOTEBOOKS.linkedList.name,
    title: '实现 sum_list',
    type: 'code',
    status: 'published',
    source: 'manual',
    order: 9,
    problemNumber: 9,
    points: 100,
    tags: ['Linked List', '迭代', '函数设计'],
    difficulty: 'medium',
    publicContent: {
      type: 'code',
      stem: '实现函数 `sum_list(nums)`，返回整数列表 `nums` 中所有元素之和。不得使用内置 `sum()`。',
      language: 'python',
      constraints: [],
      starterCode: `def sum_list(nums: list[int]) -> int:
    """Return the sum of all integers in nums.

    >>> sum_list([1, 2, 3])
    6
    >>> sum_list([])
    0
    """
    pass`,
      publicTests: [
        { id: 'empty', expression: 'sum_list([])', expected: '0' },
        { id: 'basic', expression: 'sum_list([1, 2, 3])', expected: '6' },
        { id: 'negative', expression: 'sum_list([-2, 5])', expected: '3' },
      ],
      sampleIO: [],
      secretConfigPresent: false,
      explanation: '用累加器遍历列表即可；空列表返回 0。',
    } satisfies NotebookProblemPublicCode,
    grading: {
      type: 'code',
      solutionCode: `def sum_list(nums: list[int]) -> int:
    total = 0
    for value in nums:
        total += value
    return total`,
      publishRequirementsMet: true,
    },
    secretJudge: {
      language: 'python',
      secretTests: [{ id: 'large', expression: 'sum_list(list(range(100)))', expected: '4950' }],
      timeoutMs: 5000,
    },
  }),
  baseProblem({
    id: 'demo-csc148-problem-code-reverse',
    notebookId: CSC148_NOTEBOOKS.recursion.id,
    notebookName: CSC148_NOTEBOOKS.recursion.name,
    title: '递归反转字符串',
    type: 'code',
    status: 'published',
    source: 'manual',
    order: 10,
    problemNumber: 10,
    points: 100,
    tags: ['递归', '字符串', 'base case'],
    difficulty: 'medium',
    publicContent: {
      type: 'code',
      stem: '用**递归**实现 `reverse_text(text)`，返回字符串 `text` 的反转结果。不得使用切片 `[::-1]`。',
      language: 'python',
      constraints: [],
      starterCode: `def reverse_text(text: str) -> str:
    """Return the reverse of text.

    >>> reverse_text('abc')
    'cba'
    >>> reverse_text('')
    ''
    """
    pass`,
      publicTests: [
        { id: 'basic', expression: "reverse_text('abc')", expected: "'cba'" },
        { id: 'empty', expression: "reverse_text('')", expected: "''" },
      ],
      sampleIO: [],
      secretConfigPresent: false,
      explanation: 'Base case: 空串或单字符；递归步：最后一个字符 + reverse(前缀)。',
    } satisfies NotebookProblemPublicCode,
    grading: {
      type: 'code',
      solutionCode: `def reverse_text(text: str) -> str:
    if len(text) <= 1:
        return text
    return reverse_text(text[1:]) + text[0]`,
      publishRequirementsMet: true,
    },
  }),
  baseProblem({
    id: 'demo-csc148-problem-choice-inheritance',
    notebookId: CSC148_NOTEBOOKS.oop.id,
    notebookName: CSC148_NOTEBOOKS.oop.name,
    title: '继承与方法解析顺序',
    type: 'choice',
    status: 'published',
    source: 'manual',
    order: 11,
    problemNumber: 11,
    points: 100,
    tags: ['继承', '方法重写', 'super'],
    difficulty: 'medium',
    publicContent: {
      type: 'choice',
      stem: '关于 Python 继承，下列哪一项最符合 CSC148 课堂要求？',
      selectionMode: 'single',
      options: [
        { id: 'a', label: '子类可以直接访问父类的所有私有属性 `_name`' },
        { id: 'b', label: '重写方法时，应通过 `super()` 调用父类实现以复用公共行为' },
        { id: 'c', label: 'Python 支持多重继承，因此不需要考虑方法解析顺序（MRO）' },
        { id: 'd', label: '子类构造函数不必调用父类 `__init__`' },
      ],
      explanation:
        'CSC148 强调通过 super() 复用父类逻辑；私有属性有名称改写；多重继承仍需理解 MRO。',
    },
    grading: {
      type: 'choice',
      correctOptionIds: ['b'],
    },
  }),
  baseProblem({
    id: 'demo-csc148-problem-short-exception',
    notebookId: CSC148_NOTEBOOKS.adt.id,
    notebookName: CSC148_NOTEBOOKS.adt.name,
    title: '何时抛出 EmptyStackError',
    type: 'short_answer',
    status: 'published',
    source: 'manual',
    order: 12,
    problemNumber: 12,
    points: 100,
    tags: ['异常', '栈', '契约'],
    difficulty: 'easy',
    publicContent: {
      type: 'short_answer',
      stem: '为栈 ADT 实现 `pop()` 时，什么情况下应该抛出 `EmptyStackError`？客户端应如何理解这个异常？',
      explanation: '空栈 pop 违反前置条件，应通过异常明确失败，而不是静默返回。',
    },
    grading: {
      type: 'short_answer',
      referenceAnswer:
        '当栈为空仍调用 pop() 时抛出 EmptyStackError；它表示客户端违反了「只能在非空栈上 pop」的前置条件。',
    },
  }),
  baseProblem({
    id: 'demo-csc148-problem-draft-preview',
    notebookId: CSC148_NOTEBOOKS.trees.id,
    notebookName: CSC148_NOTEBOOKS.trees.name,
    title: '【草稿】BST 删除两子结点情形',
    type: 'proof',
    status: 'draft',
    source: 'manual',
    order: 13,
    problemNumber: 13,
    points: 100,
    tags: ['BST', '删除', '草稿'],
    difficulty: 'hard',
    publicContent: {
      type: 'proof',
      stem: '证明：在 BST 中删除有两个非空子结点的键时，用中序后继替换被删键可保持 BST 性质。（本地预览草稿）',
    },
    grading: {
      type: 'proof',
      referenceProof: '中序后继是右子树最小值，替换后左右子树性质均保持。',
    },
  }),
];

export const LOCAL_DEMO_CSC148_PROBLEM_COUNT = CSC148_DEMO_PROBLEMS.filter(
  (problem) => problem.status === 'published',
).length;

export function isLocalDemoProblemBankCourse(courseId: string): boolean {
  return LOCAL_DEMO_PROBLEM_BANK_COURSE_IDS.has(courseId);
}

export function listLocalDemoProblemBank(courseId: string): NotebookProblemClientRecord[] | null {
  if (!isLocalDemoProblemBankCourse(courseId)) return null;
  return CSC148_DEMO_PROBLEMS.map((problem) => ({
    ...problem,
    tags: [...problem.tags],
    chapterId: problem.notebookId ? `chapter-${problem.notebookId}` : null,
    chapterName: problem.notebookName,
  }));
}

export function listLocalDemoProblemChapters(courseId: string): CourseProblemChapter[] {
  if (!isLocalDemoProblemBankCourse(courseId)) return [];
  return Object.values(CSC148_NOTEBOOKS).map((notebook, index) => ({
    id: `chapter-${notebook.id}`,
    name: notebook.name,
    description: '',
    position: index + 1,
    problemCount: CSC148_DEMO_PROBLEMS.filter(
      (problem) => problem.notebookId === notebook.id && problem.status !== 'archived',
    ).length,
  }));
}

export function resolveLocalDemoProblemBankCourse(
  courseId: string,
  previewAsTeacher: boolean,
): Pick<
  CourseRecord,
  'name' | 'courseCode' | 'academicYear' | 'academicTerm' | 'accessRole' | 'problemCount'
> | null {
  if (!isLocalDemoProblemBankCourse(courseId)) return null;
  return {
    name: '程序设计基础',
    courseCode: 'CSC148',
    academicYear: 2026,
    academicTerm: 'summer',
    accessRole: previewAsTeacher ? 'owner' : 'enrolled',
    problemCount: LOCAL_DEMO_CSC148_PROBLEM_COUNT,
  };
}
