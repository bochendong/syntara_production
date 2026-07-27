export type Csc148SourceUploadCase = {
  id: string;
  fixtureUserId: string;
  filename: string;
  title: string;
  chapter: string;
  description: string;
  topics: string[];
  contractKey: string;
  memoryTitle: string;
  memoryRules: string[];
  learningPath: string[];
  keyTakeaways: string[];
  answerStrategy: string[];
  futureTeachingUse: string;
  evidenceQueries: string[];
  baselineHasContract: boolean;
};

export const CSC148_SOURCE_UPLOAD_CASES: Csc148SourceUploadCase[] = [
  {
    id: 'python-memory-model',
    fixtureUserId: 'memory-test-foundation-001',
    filename: '1_The_Python_Memory_Model.md',
    title: 'Python Memory Model 与 Function Design Recipe',
    chapter: 'Chapter 1',
    description: '变量、对象、aliasing、mutation、函数调用、preconditions 与函数设计步骤。',
    topics: ['object references', 'aliasing', 'mutation', 'function design recipe'],
    contractKey: 'csc148-python-memory-and-function-recipe',
    memoryTitle: 'CSC148 回答契约：内存模型与函数设计步骤',
    memoryRules: [
      '追踪 Python 代码时，把变量画成指向对象的引用，不把变量本身说成保存对象。',
      '函数传参会为同一对象创建 alias；必须区分修改对象、重新绑定变量和复制对象。',
      '设计函数时按 CSC148 顺序组织：示例调用、函数头与类型、描述和 preconditions、函数体、测试。',
      'precondition 是对调用者的假设，不等同于函数已经在运行时检查了输入。',
    ],
    learningPath: [
      '对象与变量',
      '赋值和表达式',
      'mutation 与 aliasing',
      '函数调用帧',
      'Function Design Recipe',
    ],
    keyTakeaways: [
      '对象有类型，变量只是引用。',
      '传入 mutable object 后的 mutation 对 alias 可见。',
      'reassignment 不等于 mutation。',
    ],
    answerStrategy: [
      '先画 object/reference 图，再逐行更新引用。',
      '函数题先写契约与 examples，再实现和选测试。',
    ],
    futureTeachingUse:
      '以后讲参数传递、浅拷贝或副作用时，AI 会主动使用引用图，并按老师的 Function Design Recipe 组织答案。',
    evidenceQueries: [
      'Changing a reference is not the same as mutating a value',
      'Passing an argument creates an alias',
      'The Function Design Recipe by example',
    ],
    baselineHasContract: false,
  },
  {
    id: 'testing-your-code',
    fixtureUserId: 'memory-test-intermediate-001',
    filename: '2_Testing_Your_code.md',
    title: 'Testing、Code Coverage 与 Property-Based Testing',
    chapter: 'Chapter 2',
    description: 'doctest、pytest、测试分区、coverage 的边界与 property-based testing。',
    topics: ['pytest', 'test partitions', 'code coverage', 'properties'],
    contractKey: 'csc148-testing-evidence-standard',
    memoryTitle: 'CSC148 测试契约：pytest、分区与覆盖率证据',
    memoryRules: [
      'docstring 中保留少量基本 doctest，但课程中的完整测试套件主要使用 pytest。',
      '测试选择必须说明输入性质、分区、边界和预期行为，不能只堆正常样例。',
      'line coverage 只能证明代码行被执行过，不能单独证明程序正确。',
      'property-based test 应表达跨大量输入成立的性质，并保留可解释的失败反例。',
    ],
    learningPath: [
      '基本 doctest',
      'pytest 测试套件',
      '选择有说服力的用例',
      'coverage',
      'property-based testing',
    ],
    keyTakeaways: [
      'pytest 是课程主要测试工具。',
      '测试理由来自输入性质与分区。',
      '高覆盖率不是正确性的充分条件。',
    ],
    answerStrategy: [
      '先列行为分区与边界，再写 pytest。',
      '报告 coverage 时同时指出仍未验证的语义性质。',
    ],
    futureTeachingUse:
      '以后用户要求“帮我测试”时，AI 会按课程标准给出分区理由、pytest 结构和 coverage 局限，而不是只生成几个 happy path。',
    evidenceQueries: [
      'continue to put in a few basic doctests',
      'Making a convincing argument',
      'The limits of code coverage',
    ],
    baselineHasContract: true,
  },
  {
    id: 'oop-class-design',
    fixtureUserId: 'memory-test-advanced-001',
    filename: '3_OOP.md',
    title: 'OOP、Representation Invariants 与 Class Design Recipe',
    chapter: 'Chapter 3',
    description: 'CSC148 特有的 class 文档格式、RI、API-first 设计、信息隐藏与继承接口。',
    topics: ['class design recipe', 'Representation Invariants', 'public API', 'inheritance'],
    contractKey: 'csc148-class-design-recipe',
    memoryTitle: 'CSC148 class 格式：API、Attributes 与 Representation Invariants',
    memoryRules: [
      '设计 class 时先定义 public API 和 doctest examples，再实现内部表示。',
      'class docstring 按课程格式区分 Attributes、Private Attributes 与 Representation Invariants。',
      '__init__ 必须建立全部 RI；其他 public methods 可以假设入口满足 RI，但退出前必须恢复 RI。',
      '使用 python_ta 时标题必须精确写成 Representation Invariants:，否则规则不会被检查。',
      '继承在本课程中用于共享 public interface，子类不应随意改变 inherited method 的接口。',
    ],
    learningPath: [
      'attributes 与 methods',
      'Representation Invariants',
      'Class Design Recipe',
      'information hiding',
      'inheritance interface',
    ],
    keyTakeaways: [
      'CSC148 的 class 答案有固定文档与设计顺序。',
      'RI 同时约束 constructor 和每次 public method 的出口。',
      'public interface 与 private implementation 必须分开。',
    ],
    answerStrategy: [
      '先列 client 可观察的 API，再决定 attributes。',
      '代码审查时逐项核对 docstring sections、type annotations、RI 和 mutation 后状态。',
    ],
    futureTeachingUse:
      '以后讲解或生成 class 时，AI 不只讲通用 OOP，而会自动采用老师要求的 class docstring、API-first 顺序和 RI 检查清单。',
    evidenceQueries: [
      'We document representation invariants in the docstring of a class',
      'The Class Design Recipe',
      'is strict with the header',
    ],
    baselineHasContract: true,
  },
  {
    id: 'abstract-data-types',
    fixtureUserId: 'memory-test-novice-001',
    filename: '4_ADT.md',
    title: 'Abstract Data Types、Stacks、Queues 与 Running Time',
    chapter: 'Chapter 4',
    description: 'ADT interface、representation independence、异常策略及运行时间分析。',
    topics: ['ADT interface', 'stack', 'queue', 'custom exceptions', 'runtime'],
    contractKey: 'csc148-adt-interface-and-error-contract',
    memoryTitle: 'CSC148 ADT 契约：面向接口、异常与运行时间',
    memoryRules: [
      'ADT 描述行为与 public interface，不规定底层 representation；client code 不应绕过接口。',
      'Stack 与 Queue 的讲解先给操作契约，再比较不同实现。',
      '空结构操作应使用文档化的 user-defined exception，而不是含义模糊的 sentinel 或静默失败。',
      '运行时间分析必须先明确 operation 与 input size，再忽略常数研究增长率。',
    ],
    learningPath: [
      'ADT 与 interface',
      'Stack/Queue operations',
      'representation independence',
      'custom exceptions',
      'runtime growth',
    ],
    keyTakeaways: [
      '接口与实现分离。',
      '异常也是 ADT 契约的一部分。',
      '复杂度结论必须绑定 operation 和 input size。',
    ],
    answerStrategy: [
      '先写 ADT operation contract，再选实现。',
      '比较实现时分别列时间、空间和异常行为。',
    ],
    futureTeachingUse:
      '以后讲 Stack/Queue 时，AI 会保持接口视角，明确 underflow 异常，并把复杂度绑定到具体操作而不是泛泛说“这个 ADT 是 O(n)”。',
    evidenceQueries: [
      'It is a pure interface',
      'Abstraction is critical',
      'Raise a user-defined exception',
    ],
    baselineHasContract: false,
  },
  {
    id: 'exceptions',
    fixtureUserId: 'memory-test-foundation-001',
    filename: '5_Exception.md',
    title: 'Exceptions、Propagation 与 try-except 设计',
    chapter: 'Chapter 5',
    description: 'raise/catch、handler 顺序、传播、异常与特殊返回值、else/finally。',
    topics: ['raise', 'propagation', 'specific handlers', 'else/finally'],
    contractKey: 'csc148-exception-control-flow',
    memoryTitle: 'CSC148 异常处理契约：精确捕获与传播',
    memoryRules: [
      'except clauses 按 most-specific 到 least-specific 排列，避免 bare except 或过宽的 Exception。',
      '没有合适 handler 时让异常沿调用栈传播，不要静默吞掉未知错误。',
      '异常通常比特殊返回值更能保持正常返回类型与清晰控制流。',
      'else 只在 try 正常完成时运行；finally 无论是否发生异常都运行，适合清理资源。',
    ],
    learningPath: [
      'raise 与 catch',
      'handler matching',
      'stack propagation',
      'exceptions vs sentinel',
      'else/finally',
    ],
    keyTakeaways: [
      '捕获必须具体。',
      '传播是调用栈行为，不等于程序总会崩溃。',
      'finally 用于必做清理。',
    ],
    answerStrategy: [
      '先画异常从 raise 点到 handler 的栈路径。',
      '只捕获当前层真正能处理的异常类型。',
    ],
    futureTeachingUse:
      '以后分析异常代码时，AI 会逐帧追踪 propagation，检查 handler 顺序，并避免建议 bare except 或模糊 sentinel。',
    evidenceQueries: [
      'It is good practice to be as specific as possible',
      'Why Not Just Return a Special Value',
      'A `finally` clause',
    ],
    baselineHasContract: false,
  },
  {
    id: 'linked-lists',
    fixtureUserId: 'memory-test-intermediate-001',
    filename: '6_Linked_List.md',
    title: 'Linked Lists、Traversal Template 与 Mutation',
    chapter: 'Chapter 6',
    description: 'node links、LinkedList wrapper、课程遍历模板、mutation corner cases 与复杂度。',
    topics: ['_Node', '_first', 'traversal template', 'mutation', 'O(min(n,index))'],
    contractKey: 'csc148-linked-list-traversal-template',
    memoryTitle: 'CSC148 链表模板：_first、curr 与边界检查',
    memoryRules: [
      'LinkedList wrapper 通过 _first 指向内部 _Node；client code 不直接操作 nodes。',
      '课程鼓励先使用 linked-list traversal template，再根据任务修改循环状态。',
      'mutation 必须单独处理 empty list、front、end 与 out-of-bounds 等 corner cases。',
      'index 操作的复杂度要写成与 n 和 index 关系一致的 O(min(n, index))，不能一律写 O(n)。',
    ],
    learningPath: [
      'links 与 wrapper',
      'traversal template',
      'append/insert mutation',
      'corner cases',
      'input-size-aware runtime',
    ],
    keyTakeaways: [
      '模板提供结构而不替代推理。',
      'curr 的循环不变量决定 mutation 正确性。',
      '复杂度可能同时依赖 n 与 index。',
    ],
    answerStrategy: [
      '先复制课程 traversal skeleton，再补 accumulator 或 predecessor。',
      'mutation 前列空、头、尾和越界四类边界。',
    ],
    futureTeachingUse:
      '以后生成链表代码时，AI 会从老师的 curr/_first 模板开始，明确循环结束位置，并主动核对空链表和 index 边界。',
    evidenceQueries: [
      'certain code templates',
      'After the loop, curr is the last node',
      'O(min(n, index))',
    ],
    baselineHasContract: false,
  },
  {
    id: 'trees-and-bsts',
    fixtureUserId: 'memory-test-advanced-001',
    filename: '8_trees.md',
    title: 'Trees、BSTs、Traversal 与 Expression Trees',
    chapter: 'Chapter 8',
    description: '通用树递归、empty-tree RI、BST mutation、遍历顺序、height-sensitive runtime。',
    topics: ['tree recursion', 'empty tree RI', 'BST invariant', 'traversal order', 'height'],
    contractKey: 'csc148-tree-recursion-and-bst-contract',
    memoryTitle: 'CSC148 树递归契约：子树模板、RI 与高度',
    memoryRules: [
      '通用树递归应处理 root 的局部贡献，并递归遍历全部 _subtrees；递归参数必须是真子树。',
      'empty tree 的表示必须由明确 RI 约束，不能依赖未写出的隐含假设。',
      'BST 每次 search/mutation 都必须保持左侧小于等于根、右侧大于等于根的 ordering invariant；duplicate 默认允许出现在任一侧。',
      'pre/in/post-order 的选择取决于动作应在子树之前、中间还是之后发生。',
      'BST operation 的最坏时间由 height 决定；链状树与平衡树必须分别讨论。',
    ],
    learningPath: [
      'tree terminology',
      'recursive traversal',
      'mutation 与 empty trees',
      'BST invariants',
      'traversal order',
      'height/runtime',
    ],
    keyTakeaways: [
      '递归必须覆盖所有直接子树。',
      'RI 取代隐含结构假设。',
      'BST 的 O(h) 需要结合树形解释。',
    ],
    answerStrategy: [
      '先写空树/叶节点与 recursive subproblem，再组合返回值。',
      'BST mutation 后逐项重验 ordering invariant。',
    ],
    futureTeachingUse:
      '以后讲树时，AI 会默认采用 CSC148 的子树递归模板，明确 empty-tree RI，并把 BST 复杂度写成 O(h) 后比较平衡与链状情况。',
    evidenceQueries: [
      'Recursion on trees',
      'Implicit assumptions are bad! Representation invariants are good!',
      'Worst-case vs. best-case running time',
    ],
    baselineHasContract: false,
  },
];

export function getCsc148SourceUploadCase(caseId: string) {
  return CSC148_SOURCE_UPLOAD_CASES.find((item) => item.id === caseId);
}
