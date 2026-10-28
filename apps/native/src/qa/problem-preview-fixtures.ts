import type {
  NotebookProblemGrading,
  NotebookProblemPublicContent,
} from '../../../../lib/problem-bank/schema';
import type { LocalProblem } from '../domain/models';

type PreviewFixture = {
  id: string;
  title: string;
  publicContent: NotebookProblemPublicContent;
  grading: NotebookProblemGrading;
};

const figure = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="240" viewBox="0 0 720 240"><rect width="720" height="240" rx="20" fill="#f5f7fc"/><g fill="none" stroke="#415478" stroke-width="3"><rect x="60" y="75" width="160" height="90" rx="14"/><rect x="280" y="75" width="160" height="90" rx="14"/><rect x="500" y="75" width="160" height="90" rx="14"/><path d="M220 120h60m-12-9 12 9-12 9M440 120h60m-12-9 12 9-12 9"/></g><g fill="#172b50" font-family="sans-serif" font-size="26" text-anchor="middle"><text x="140" y="130">x = 3</text><text x="360" y="130">× 2</text><text x="580" y="130">[1]</text><text x="360" y="45">f(x) = 2x</text></g></svg>',
)}`;

export const problemPreviewFixtures: PreviewFixture[] = [
  {
    id: 'short-answer',
    title: '简答题 · 解释单射',
    publicContent: {
      type: 'short_answer',
      stem: '用自己的话解释函数的「单射」性质，并给出一个单射和一个非单射的例子。可以使用文字、公式、图片或手写。',
    },
    grading: {
      type: 'short_answer',
      referenceAnswer: '不同输入对应不同输出。例如实数集上的 f(x)=2x 是单射，f(x)=x² 不是单射。',
      rubric: '定义正确，两个例子正确，并说明非单射例子中不同输入产生相同输出。',
    },
  },
  {
    id: 'calculation',
    title: '计算题 · 定积分',
    publicContent: {
      type: 'calculation',
      stem: '计算定积分 $\\displaystyle\\int_0^2(3x^2+1)\\,dx$。请给出计算过程与最终结果。',
      showWork: true,
    },
    grading: {
      type: 'calculation',
      referenceAnswer: '10',
      acceptedForms: ['10', '10.0'],
      tolerance: 0.001,
      analysis: '原函数为 $x^3+x$，代入上下限得 $8+2=10$。',
    },
  },
  {
    id: 'single-choice',
    title: '单选题 · 函数值',
    publicContent: {
      type: 'choice',
      stem: '设 $f(x)=2x+1$，则 $f(3)$ 等于多少？',
      selectionMode: 'single',
      options: [
        { id: 'A', label: '$5$' },
        { id: 'B', label: '$6$' },
        { id: 'C', label: '$7$' },
        { id: 'D', label: '$8$' },
      ],
    },
    grading: { type: 'choice', correctOptionIds: ['C'], analysis: '$f(3)=2\\cdot3+1=7$。' },
  },
  {
    id: 'multiple-choice',
    title: '多选题 · 单射函数',
    publicContent: {
      type: 'choice',
      stem: '以下函数的定义域均为 $\\mathbb R$。选择所有单射函数。',
      selectionMode: 'multiple',
      options: [
        { id: 'A', label: '$f(x)=2x+1$' },
        { id: 'B', label: '$f(x)=x^2$' },
        { id: 'C', label: '$f(x)=x^3$' },
        { id: 'D', label: '$f(x)=\\sin x$' },
      ],
    },
    grading: {
      type: 'choice',
      correctOptionIds: ['A', 'C'],
      analysis: '一次函数与立方函数严格递增；平方函数和正弦函数存在不同输入对应相同输出。',
    },
  },
  {
    id: 'true-false',
    title: '判断题 · 连续与可导',
    publicContent: {
      type: 'choice',
      stem: '判断：函数在一点连续，则它在该点一定可导。',
      selectionMode: 'single',
      options: [
        { id: 'A', label: '正确' },
        { id: 'B', label: '错误' },
      ],
    },
    grading: {
      type: 'choice',
      correctOptionIds: ['B'],
      analysis: '反例：$f(x)=|x|$ 在 $0$ 处连续但不可导。',
    },
  },
  {
    id: 'fill-inline',
    title: '填空题 · 行内多空',
    publicContent: {
      type: 'fill_blank',
      blankLayout: 'inline',
      stemTemplate:
        "设 $f(x)=x^2$。则 $f(3)=$ {{value}}，导函数 $f'(x)=$ {{derivative}}，且 $f'(2)=$ {{slope}}。",
      blanks: [
        { id: 'value', placeholder: '函数值', answerKind: 'number' },
        { id: 'derivative', placeholder: '导函数', answerKind: 'math_expression' },
        { id: 'slope', placeholder: '斜率', answerKind: 'number' },
      ],
    },
    grading: {
      type: 'fill_blank',
      blanks: [
        { id: 'value', acceptedAnswers: ['9'], caseSensitive: false },
        { id: 'derivative', acceptedAnswers: ['2x', '2*x'], caseSensitive: false },
        { id: 'slope', acceptedAnswers: ['4'], caseSensitive: false },
      ],
      analysis: "$f(3)=9$，$f'(x)=2x$，$f'(2)=4$。",
    },
  },
  {
    id: 'fill-figure',
    title: '填空题 · 看图填写',
    publicContent: {
      type: 'fill_blank',
      blankLayout: 'figure',
      stemTemplate: '根据下图的函数流程，填写编号 [1] 处的结果。',
      assets: {
        images: [
          {
            id: 'function-flow',
            src: figure,
            alt: '输入 x=3，乘以 2，输出为编号 1 的空格',
            role: 'question',
          },
        ],
      },
      blanks: [{ id: 'output', placeholder: '[1] 的值', answerKind: 'number' }],
    },
    grading: {
      type: 'fill_blank',
      blanks: [{ id: 'output', acceptedAnswers: ['6'], caseSensitive: false }],
      analysis: '$2\\cdot3=6$。',
    },
  },
  {
    id: 'code',
    title: '代码题 · 完整函数',
    publicContent: {
      type: 'code',
      stem: '实现 `sum_positive(numbers)`，返回列表中所有正数的和。空列表返回 `0`，并且不要修改输入列表。',
      language: 'python',
      starterCode:
        'def sum_positive(numbers: list[int]) -> int:\n    """Return the sum of positive numbers in numbers."""\n    # 在这里完成函数\n    pass\n',
      functionSignature: 'sum_positive(numbers: list[int]) -> int',
      constraints: ['输入为整数列表。', '函数应返回整数，不需要 print。'],
      publicTests: [
        {
          id: 'mixed',
          expression: 'sum_positive([-2, 3, 0, 5])',
          expected: '8',
          description: '包含正数、负数与零',
        },
        { id: 'empty', expression: 'sum_positive([])', expected: '0', description: '空列表' },
      ],
      sampleIO: [{ input: '[-2, 3, 0, 5]', output: '8', explanation: '只累加 3 与 5。' }],
      secretConfigPresent: false,
    },
    grading: {
      type: 'code',
      solutionCode:
        'def sum_positive(numbers: list[int]) -> int:\n    return sum(number for number in numbers if number > 0)\n',
      publishRequirementsMet: false,
      analysis: '遍历列表，仅累加大于零的元素。',
    },
  },
  {
    id: 'code-slots',
    title: '代码补全 · 固定代码与空位',
    publicContent: {
      type: 'code',
      stem: '补全 `count_even(numbers)`，返回列表中偶数的个数。只需编辑高亮空位。',
      language: 'python',
      template:
        'def count_even(numbers: list[int]) -> int:\n    count = 0\n    for number in numbers:\n        if {{condition}}:\n            {{increment}}\n    return count\n',
      slots: [
        { id: 'condition', kind: 'expr', placeholder: '判断 number 为偶数', hint: '使用取余运算' },
        { id: 'increment', kind: 'line', placeholder: '更新 count' },
      ],
      constraints: ['保留已有循环和返回语句。'],
      publicTests: [
        {
          id: 'mixed',
          expression: 'count_even([1, 2, 3, 4, 0])',
          expected: '3',
          description: '零也是偶数',
        },
        { id: 'empty', expression: 'count_even([])', expected: '0', description: '空列表' },
      ],
      sampleIO: [],
      secretConfigPresent: false,
    },
    grading: {
      type: 'code',
      solutionSlots: { condition: 'number % 2 == 0', increment: 'count += 1' },
      solutionCode:
        'def count_even(numbers: list[int]) -> int:\n    count = 0\n    for number in numbers:\n        if number % 2 == 0:\n            count += 1\n    return count\n',
      publishRequirementsMet: false,
      analysis: '取余结果为零时，将计数器加一。',
    },
  },
  {
    id: 'table',
    title: '表格题 · Python 输出追踪',
    publicContent: {
      type: 'table',
      stem: '各行代码独立运行，填写输出结果。如果发生错误，填写 `ERROR`；没有输出，填写 `NOTHING`。',
      setupCode: 'values = [2, 4, 6]',
      columns: [
        { id: 'code', header: '代码', role: 'given', cellKind: 'code' },
        { id: 'output', header: '输出', role: 'answer', cellKind: 'output' },
      ],
      rows: [
        { id: 'r1', cells: { code: 'print(values[1])' } },
        { id: 'r2', cells: { code: 'print(values[-1] + len(values))' } },
        { id: 'r3', cells: { code: 'values.append(8)' } },
        { id: 'r4', cells: { code: 'print(values[3])' } },
      ],
      quickAnswers: ['ERROR', 'NOTHING'],
      runnable: true,
    },
    grading: {
      type: 'table',
      cells: ['4', '9', 'NOTHING', 'ERROR'].map((value, index) => ({
        rowId: `r${index + 1}`,
        colId: 'output',
        acceptedAnswers: [value],
        matcher: 'output',
      })),
      analysis: '索引从零开始；append 修改列表但不打印；索引 3 超出初始列表范围。',
    },
  },
];

/** Reuse the same type examples inside a mixed problem to review each subquestion layout. */
export function buildAdditionalPreviewProblems(
  common: Omit<LocalProblem, 'id' | 'title' | 'type' | 'publicContent' | 'grading'>,
  prefix: string,
): LocalProblem[] {
  const mixedIds = [
    'single-choice',
    'fill-inline',
    'calculation',
    'short-answer',
    'table',
    'code-slots',
  ];
  const mixedParts = mixedIds.map((id, index) => {
    const fixture = problemPreviewFixtures.find((item) => item.id === id)!;
    return {
      label: String.fromCharCode(97 + index),
      points: 5,
      content: fixture.publicContent,
      grading: fixture.grading,
    };
  });
  mixedParts.push({
    label: 'g',
    points: 5,
    content: { type: 'proof', stem: '证明：对于任意偶整数 $n$，$n^2$ 仍然是偶数。' },
    grading: {
      type: 'proof',
      referenceProof: '设 n=2k，其中 k 为整数。则 n²=4k²=2(2k²)，所以 n² 为偶数。',
    },
  });
  return [
    ...problemPreviewFixtures.map((fixture) => ({
      ...common,
      ...fixture,
      id: `${prefix}-${fixture.id}`,
      type: fixture.publicContent.type,
    })),
    {
      ...common,
      id: `${prefix}-mixed-parts`,
      title: '综合大题 · 全部小问题型',
      type: 'multipart',
      publicContent: {
        type: 'multipart',
        stem: '本题包含选择、填空、计算、简答、表格、代码补全与证明七种小问。请在左侧逐问切换，检查各自的作答界面。',
        parts: mixedParts.map(({ grading: _grading, ...part }) => part),
      },
      grading: {
        type: 'multipart',
        parts: mixedParts.map(({ label, grading }) => ({ label, grading })),
      },
    },
  ];
}
