import type { LocalProblem } from '../domain/models';

/**
 * 学生在聊天里点名题库里的某道题（「2024W1 MT1 第一题」「drop-until-odd 这题」）时，
 * 找出那道题，把题面原文带给助教；否则助教只看得到题目标题，会自己编题目内容。
 */

const CHINESE_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function chineseNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === '十') return 10;
  if (value.startsWith('十')) return 10 + (CHINESE_DIGITS[value[1]] ?? 0);
  if (value.endsWith('十')) return (CHINESE_DIGITS[value[0]] ?? 0) * 10;
  return CHINESE_DIGITS[value] ?? 0;
}

/** 统一写法：小写、去空格，期中/midterm → mt，期末 → final，第一题/Q1 → p1。 */
export function examKey(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(
      /第\s*([0-9一二三四五六七八九十]+)\s*(?:题|問|问|道)/g,
      (_, n: string) => ` p${chineseNumber(n)} `,
    )
    .replace(/\b(?:q|question|problem)\s*(\d+)/g, ' p$1 ')
    .replace(/midterm|期中考试|期中/g, 'mt')
    .replace(/期末考试|期末|final exam/g, 'final')
    .replace(/winter/g, 'w')
    .replace(/summer/g, 's')
    .replace(/\s+/g, '');
}

/** 标题里像函数名的词（drop-until-odd、valid-password?、count_vowels）。 */
function identifiers(title: string): string[] {
  const tail = title.split('·').at(-1) ?? title;
  return (tail.match(/[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+[?!]?|[a-z]{4,}[?!]/gi) ?? []).map((word) =>
    word.toLowerCase(),
  );
}

/** 标题里的考试场次（2024w1mt1）和题号（p2-3 → p2、p3）。 */
function examParts(title: string): { sitting: string; numbers: string[] } | null {
  const [head, tail = ''] = title.split('·');
  const sitting = examKey(head);
  const numbers = [...examKey(tail).matchAll(/p(\d+(?:-\d+)*)/g)].flatMap((match) =>
    match[1].split('-').map((n) => `p${n}`),
  );
  return sitting && numbers.length ? { sitting, numbers } : null;
}

function score(problem: LocalProblem, text: string, key: string): number {
  const lower = text.toLowerCase();
  let value = 0;
  if (identifiers(problem.title).some((word) => lower.includes(word))) value += 10;
  const exam = examParts(problem.title);
  if (exam && key.includes(exam.sitting)) {
    value += 3;
    if (exam.numbers.some((n) => new RegExp(`${n}(?!\\d)`).test(key.split(exam.sitting)[1] ?? '')))
      value += 6;
  }
  return value;
}

/** 这次问题明确点名的一道题；没有点名或点名不唯一时返回 null。先看这次问题，再看上一轮。 */
export function findFocusedProblem(
  problems: LocalProblem[],
  question: string,
  earlier = '',
): LocalProblem | null {
  for (const text of [question, earlier]) {
    if (!text.trim()) continue;
    const key = examKey(text);
    const ranked = problems
      .filter((problem) => problem.status !== 'archived')
      .map((problem) => ({ problem, value: score(problem, text, key) }))
      .filter(({ value }) => value >= 9)
      .sort((left, right) => right.value - left.value);
    if (ranked.length && (ranked.length === 1 || ranked[0].value > ranked[1].value))
      return ranked[0].problem;
    if (ranked.length) return null;
  }
  return null;
}

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max)}\n…（后面省略）` : value;

/** 题面原文（不含答案）：题干、表格陈述、选项、小问、起始代码、要求、样例。 */
export function focusedProblemText(problem: LocalProblem): string {
  const content = (problem.publicContent ?? {}) as Record<string, unknown>;
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  const rows = list(content.rows)
    .map((row) => {
      const cells = (row as { cells?: Record<string, unknown> }).cells ?? {};
      return Object.values(cells).map(str).filter(Boolean).join(' | ');
    })
    .filter(Boolean);
  const options = list(content.options)
    .map((option) => {
      const record = option as Record<string, unknown>;
      return `${str(record.id)}. ${str(record.label) || str(record.text)}`;
    })
    .filter((line) => line.length > 2);
  const parts = list(content.parts)
    .map((part) => {
      const record = part as { label?: string; content?: Record<string, unknown> };
      return `(${record.label ?? ''}) ${str(record.content?.stem) || str(record.content?.prompt)}`;
    })
    .filter((line) => line.length > 4);
  const constraints = list(content.constraints).map(str).filter(Boolean);
  const samples = list(content.sampleIO)
    .map((sample) => {
      const record = sample as Record<string, unknown>;
      return `${str(record.input)} → ${str(record.output)}`;
    })
    .filter((line) => line.length > 3);
  return clip(
    [
      `标题：${problem.title}（id=${problem.id}）`,
      `题面：\n${str(content.stem) || str(content.stemTemplate) || problem.title}`,
      rows.length ? `要判断的陈述：\n${rows.map((row) => `- ${row}`).join('\n')}` : '',
      options.length ? `选项：\n${options.join('\n')}` : '',
      parts.length ? `小问：\n${parts.join('\n')}` : '',
      str(content.starterCode) ? `起始代码：\n\`\`\`\n${str(content.starterCode)}\n\`\`\`` : '',
      constraints.length ? `要求：\n${constraints.map((line) => `- ${line}`).join('\n')}` : '',
      samples.length ? `样例：\n${samples.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    9000,
  );
}
