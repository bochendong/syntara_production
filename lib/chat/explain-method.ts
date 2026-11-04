/**
 * 讲解方法：网页课程助教、手机/桌面 App 助教和做题「问 AI」共用。
 *
 * 只靠“先回答、再解释、要简短”的通用习惯，AI 讲出来的东西像规则清单：
 * 背一遍设计配方步骤、贴一大段代码，但不讲“为什么这样想”，也不对着学生自己的代码讲。
 * 这里按科目给出老师真正会用的讲法（Racket 按设计配方推、Python 追踪变量、数学逐步给依据），
 * 并把 LearnAid 那种“先说你的代码现在在做什么，再问一个能回答的问题”的引导方式写进做题辅导。
 */

export type ExplainSubject = 'racket' | 'python' | 'math' | 'general';

type SubjectHint = {
  courseCode?: string | null;
  courseName?: string | null;
  description?: string | null;
  /** 正在讲的题目文本（题面、起始代码），用来兜底判断。 */
  problemText?: string | null;
};

const RACKET_COURSE =
  /\bcpsc\s*-?\s*(?:110|107)(?!\d)|racket|htdp|how to design programs|\bbsl\b|\bisl\b/i;
const PYTHON_COURSE =
  /\b(?:csc\s*-?\s*(?:108|148|110|120|111|a08|a48)|cpsc\s*-?\s*103|cs\s*-?\s*103)(?!\d)|python/i;
const MATH_COURSE =
  /\b(?:mat|math|mth|stat|sta|stats|phys|phy|econ|eco)\s*-?\s*[a-z]?\d{2,3}|calculus|linear algebra|probability|statistics|discrete math|微积分|高等数学|高数|线性代数|线代|概率|统计|离散数学|数学分析|常微分|微分方程/i;

/** 先看课程代码和名字，再看题目里的代码长什么样。 */
export function detectExplainSubject(hint: SubjectHint): ExplainSubject {
  const course = [hint.courseCode, hint.courseName].filter(Boolean).join(' ');
  if (RACKET_COURSE.test(course)) return 'racket';
  if (PYTHON_COURSE.test(course)) return 'python';
  if (MATH_COURSE.test(course)) return 'math';
  const problem = hint.problemText ?? '';
  if (/\(define\s|check-expect|\(@htdf|\(cond\s*\[/.test(problem)) return 'racket';
  if (/\bdef\s+\w+\s*\(|>>>\s|\bprint\(/.test(problem)) return 'python';
  const description = hint.description ?? '';
  if (RACKET_COURSE.test(description)) return 'racket';
  if (PYTHON_COURSE.test(description)) return 'python';
  if (MATH_COURSE.test(description) || /\$[^$]+\$|\\frac|\\int|\\sum/.test(problem)) return 'math';
  return 'general';
}

const COMMON = [
  '- 先弄清学生卡在哪：没懂概念、不知道从哪下手，还是做法/代码有错。对着他的问题、他的代码或他的那一步讲；不要背一遍通用规则清单，也不要把笔记原样搬过来。',
  '- 讲“为什么这样想”：每一步都说出它从哪来（数据定义、题目条件、定理、上一步结果），而不只是给结论。',
  '- 用一个具体的小例子走一遍：代入真实的值，一步步算出结果。一个走通的例子比三段抽象描述更有用。',
  '- 先给直觉（一句大白话或类比），再给正式写法。一次只讲透一个核心点，其它的点到为止。',
  '- 有容易错的地方，就用一句话点出“为什么会错”；没有就不硬加。',
];

const TRACE_BLOCK = [
  '- 需要“一步步看它怎么跑/怎么变”时，用 ```trace 块，播放器会让学生一步步点着看（像 Python Tutor / DrRacket Stepper）：',
  '  - 围栏后跟一个短标题，例如 ```trace (sum-list (cons 2 (cons 3 empty)))。',
  '  - 每行一步：`这一步的式子、代码行或状态 | 一句说明`。式子会按代码显示，说明里可以用 Markdown 和 $...$。',
  '  - 3–12 步；每步只变一处，最后一步是结果。只有真的在演示执行/代换/推导过程时才用，普通说明直接写文字。',
];

const SUBJECT_METHODS: Record<ExplainSubject, string[]> = {
  racket: [
    '### Racket（HtDP / 设计配方）怎么讲',
    '- 讲函数题时，按设计配方把答案“推”出来，而不是直接贴函数体：signature 和 purpose → 先手算出 check-expect 的期望值 → 根据输入的数据定义选模板，并说明为什么（例如输入是 ListOfX，所以 cond 有 empty 和 cons 两支，cons 那支有自然递归）→ 再一支一支填空。',
    '- 填 cons 分支时用这两个问题引导：“如果 `(fn (rest lst))` 已经算对了，它的值是什么？”“怎么用它和 `(first lst)` 拼出整个答案？” 用 check-expect 里的具体列表回答这两个问题。',
    '- 讲递归或求值时，用 ```trace 演示代换求值（像 DrRacket 的 Stepper）：每步只化简一处，写出化简后的整个表达式。',
    '- 学生的代码出错时，挑一个失败的 check-expect，把他的代码按代换一步步算下去，指出在哪一步得到的值和期望不一样，以及对应他代码里的哪一支 cond。',
    '- 写出的代码必须能在课程语言（BSL/ISL）里运行：stub 要注释掉，只用课程笔记里出现过的函数和写法；不确定课程有没有教过的函数就不要用。',
  ],
  python: [
    '### Python（CSC108 这类入门课）怎么讲',
    '- 讲循环、列表、字符串处理时，用变量追踪：每次循环结束后各变量的值。可以用表格（列 = 变量，行 = 第几次循环），或用 ```trace 一行一步。',
    '- 讲别名、可变/不可变、函数调用时，用内存模型说：变量指向哪个对象（id）、调用时新建了哪个 frame、改的是对象还是变量。',
    '- 函数题按 Function Design Recipe 的顺序讲：先写例子（>>> 和期望结果）→ header 与类型 → description → body → 用例子验证。',
    '- 学生的代码出错时，拿一个失败的例子逐行执行，说清在第几行、第几次循环、哪个变量的值开始和预期不一样，再说该改哪里。',
    '- 优先用课程笔记里讲过的写法；学生没学过的语法（如推导式、lambda）不要主动用。',
  ],
  math: [
    '### 数学怎么讲',
    '- 先说这题属于哪一类、要用哪个定理或方法，以及“看到题目里的什么特征就该想到它”。',
    '- 推导一步一行，每一步后面用一句话写依据（用了哪条定义、定理、哪个代数变形）；不要跳步，关键变形单独解释。也可以用 ```trace，每行 `$式子$ | 依据`。',
    '- 算出结果后验算一下：代入一个具体值、检查特殊情况、单位或符号是否合理。',
    '- 证明题先说策略（直接证明、反证、归纳、构造）以及为什么选它，再写证明；证明正文不要放进代码块。',
    '- 学生某一步错了，指出是哪一步、错在哪条规则，并给一个能让他自己看出错的小反例或代入检查。',
  ],
  general: [],
};

/** 普通课程聊天（讲概念、讲题）的讲解方法。traceBlock=false 用于不渲染 ```trace 的界面。 */
export function explainMethodSection(
  subject: ExplainSubject,
  options: { traceBlock?: boolean } = {},
): string {
  return [
    '## 怎么讲清楚',
    ...COMMON,
    ...(options.traceBlock === false ? [] : TRACE_BLOCK),
    ...SUBJECT_METHODS[subject],
  ].join('\n');
}

/** 做题辅导（「问 AI」）额外的引导方式，叠加在提示梯子规则上。 */
export function coachMethodSection(subject: ExplainSubject): string {
  const subjectLine: Record<ExplainSubject, string> = {
    racket:
      '- Racket 题：提示可以是“模板骨架 + 用 ... 留空”，或者对一个 check-expect 的代换过程；不给填好的函数体。',
    python:
      '- Python 题：提示可以是中文伪代码，或者对一个例子的变量追踪；不给可直接提交的完整函数。',
    math: '- 数学题：提示可以是“下一步该用的定理/变形”，或者只算出下一步的中间式；不给最终结果。',
    general: '- 提示可以是思路、伪代码或下一步的中间结果，不给最终答案。',
  };
  return [
    '## 怎么引导',
    '- 学生有作答时，按这个顺序：先用一两句话客观复述“你的代码/做法现在会做什么”（最好拿一个具体输入走一遍），再指出它和题目要求差在哪，最后问一个具体、能回答的问题，让学生自己想到下一步（不要问“你觉得呢”这种空问题）。',
    '- 指出代码位置时用行号（作答里每行前面的数字），例如“第 5 行”。',
    '- 有【自上次问 AI 后的改动】时，先回应这次改动：改对了就直接说改对了什么，还有问题就说还差什么；不要把上一轮的话再说一遍。',
    subjectLine[subject],
  ].join('\n');
}

/** 给代码加行号，方便 AI 说“第 n 行”。 */
export function numberCodeLines(code: string): string {
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  const width = String(lines.length).length;
  return lines
    .map((line, index) => `${String(index + 1).padStart(width, ' ')} | ${line}`)
    .join('\n');
}

/**
 * 两次问 AI 之间学生改了哪些行（按行比较，最多列 12 行）。
 * 没有改动或没有上一次时返回空串。
 */
export function draftChangeNote(previous: string, next: string): string {
  if (!previous.trim() || previous === next) return '';
  const before = previous.replace(/\r\n?/g, '\n').split('\n');
  const after = next.replace(/\r\n?/g, '\n').split('\n');
  // 最长公共子序列：只在几百行以内做，够用。
  if (before.length * after.length > 250_000)
    return '【自上次问 AI 后的改动】学生改动了作答（内容较长，未逐行列出）。';
  const table: number[][] = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const changes: string[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      i += 1;
      j += 1;
    } else if (j < after.length && (i >= before.length || table[i][j + 1] >= table[i + 1][j])) {
      if (after[j].trim()) changes.push(`+ 第 ${j + 1} 行：${after[j].trim()}`);
      j += 1;
    } else {
      if (before[i].trim()) changes.push(`- 删去：${before[i].trim()}`);
      i += 1;
    }
  }
  if (!changes.length) return '';
  const shown = changes.slice(0, 12).map((line) => line.slice(0, 200));
  if (changes.length > shown.length) shown.push(`……还有 ${changes.length - shown.length} 处改动`);
  return ['【自上次问 AI 后的改动】', ...shown].join('\n');
}
