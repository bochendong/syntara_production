/**
 * 做题时「问 AI」：网页和 iPad/桌面 App 共用的提示梯子。
 * 默认只给提示，学生主动要「完整解答」才把整道题讲完。
 */

export type ProblemCoachMove = 'hint' | 'next' | 'check' | 'solution' | 'ask';

export const PROBLEM_COACH_CHIPS: ReadonlyArray<{
  move: Exclude<ProblemCoachMove, 'ask'>;
  zh: string;
  en: string;
}> = [
  { move: 'hint', zh: '给点提示', en: 'Hint' },
  { move: 'next', zh: '下一步', en: 'Next step' },
  { move: 'check', zh: '帮我看看', en: 'Check mine' },
  { move: 'solution', zh: '完整解答', en: 'Full solution' },
];

/** 聊天里学生那一侧显示的文字。 */
export function problemCoachUserText(
  move: ProblemCoachMove,
  locale: 'zh-CN' | 'en-US',
  freeText = '',
): string {
  if (move === 'ask') return freeText.trim();
  const chip = PROBLEM_COACH_CHIPS.find((item) => item.move === move);
  return chip ? (locale === 'en-US' ? chip.en : chip.zh) : freeText.trim();
}

/** 整段对话都要遵守的规则（放进第一轮或系统提示里）。 */
export function problemCoachRules(locale: 'zh-CN' | 'en-US'): string {
  return [
    '你是学生做题时旁边的 AI 助教。学生卡住了，点了「问 AI」。',
    locale === 'en-US' ? 'Reply in English.' : '用简体中文回答，术语可以保留英文。',
    '规则：',
    '1. 默认只引导，不直接给最终答案、完整证明或可直接提交的完整代码。学生明确要「完整解答」时才完整讲。',
    '2. 回答要短：两到五句话，或一个很短的列表。不要复述题面，不要以“题目原文”开头。',
    '3. 先看学生当前作答和测试结果，找出他卡在哪一步；有作答时先肯定一处做对的地方，再指出下一个要改的点。',
    '4. 提示是有梯度的：先点方向（考点、该用的工具），再给下一步，最后才给局部示范。每轮只往前走一格，不要重复上一轮已经说过的提示。',
    '5. 下面的「参考答案」只给你判断用，引导阶段不要原样透露它、也不要透露隐藏测试的内容。',
    '6. 数学公式用 $...$ 或 $$...$$；代码、变量名、函数名用反引号；只有真实代码才用代码块。',
    '7. 不要在结尾加“还有什么问题吗”之类的客套话，也不要建议去别的页面。',
  ].join('\n');
}

/** 每一轮附在学生消息后面、告诉模型这次要做什么。 */
export function problemCoachInstruction(move: ProblemCoachMove): string {
  switch (move) {
    case 'hint':
      return '这次：给一个最关键的提示，指出突破口或该用的概念，不要给出步骤结果或答案。';
    case 'next':
      return '这次：在之前提示的基础上，告诉学生下一步具体做什么（一小步），可以给一个局部示范，但仍不给最终答案。';
    case 'check':
      return '这次：检查学生当前的作答/代码和测试结果，指出第一个出错或缺失的地方和原因，给改正方向，不要直接替他改好。如果作答为空，就说明从哪里下手。';
    case 'solution':
      return '这次：学生主动要完整解答。完整讲解这道题：先一句话说清思路，再给步骤、最终答案或完整代码，最后一句点出最容易错的地方。如果学生已经有作答，顺带说清他的作答差在哪里。';
    case 'ask':
    default:
      return '这次：回答学生的追问。仍然遵守“默认只引导”的规则，除非他明确要答案。';
  }
}
