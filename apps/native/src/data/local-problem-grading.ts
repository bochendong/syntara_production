import type { LocalProblem } from '../domain/models';

export type LocalProblemAnswer =
  | { kind: 'choice'; selectedOptionIds: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'code'; code: string };

export type LocalGradeResult = {
  status: 'passed' | 'partial' | 'failed' | 'pending';
  score: number | null;
  feedback: string;
  autoGraded: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function normalizeComparableText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\$/g, '')
    .replace(/\s+/g, '')
    .replace(/[，。；：、“”‘’]/g, (char) => {
      const map: Record<string, string> = {
        '，': ',',
        '。': '.',
        '；': ';',
        '：': ':',
        '“': '"',
        '”': '"',
        '‘': "'",
        '’': "'",
      };
      return map[char] || char;
    })
    .toLowerCase();
}

function textMatchesAccepted(answer: string, accepted: string[], caseSensitive = false): boolean {
  const needle = caseSensitive ? answer.trim() : normalizeComparableText(answer);
  return accepted.some((item) => {
    const hay = caseSensitive ? item.trim() : normalizeComparableText(item);
    return hay.length > 0 && hay === needle;
  });
}

export function problemStem(problem: LocalProblem): string {
  const content = asRecord(problem.publicContent);
  if (typeof content.stem === 'string' && content.stem.trim()) return content.stem;
  return problem.title;
}

export function problemOptions(problem: LocalProblem): Array<{ id: string; label: string }> {
  const content = asRecord(problem.publicContent);
  const options = Array.isArray(content.options) ? content.options : [];
  return options.flatMap((option) => {
    if (!option || typeof option !== 'object') return [];
    const record = option as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const label =
      typeof record.label === 'string'
        ? record.label
        : typeof record.text === 'string'
          ? record.text
          : '';
    return id && label ? [{ id, label }] : [];
  });
}

export function problemSelectionMode(problem: LocalProblem): 'single' | 'multiple' {
  const content = asRecord(problem.publicContent);
  return content.selectionMode === 'multiple' ? 'multiple' : 'single';
}

export function problemStarterCode(problem: LocalProblem): string {
  const content = asRecord(problem.publicContent);
  return typeof content.starterCode === 'string' ? content.starterCode : '';
}

export function problemPublicContent(problem: LocalProblem): Record<string, unknown> {
  return asRecord(problem.publicContent);
}

export function problemIsCode(problem: LocalProblem): boolean {
  return problem.type === 'code' || asRecord(problem.publicContent).type === 'code';
}

export function problemPublicTests(
  problem: LocalProblem,
): Array<{ id: string; expression: string; expected: string; description?: string }> {
  const content = asRecord(problem.publicContent);
  const tests = Array.isArray(content.publicTests) ? content.publicTests : [];
  return tests.flatMap((test, index) => {
    if (!test || typeof test !== 'object') return [];
    const record = test as Record<string, unknown>;
    const expression = typeof record.expression === 'string' ? record.expression : '';
    const expected =
      typeof record.expected === 'string'
        ? record.expected
        : record.expected != null
          ? String(record.expected)
          : '';
    if (!expression) return [];
    return [
      {
        id: typeof record.id === 'string' ? record.id : `t${index + 1}`,
        expression,
        expected,
        description: typeof record.description === 'string' ? record.description : undefined,
      },
    ];
  });
}

export function buildPublicTestsPython(problem: LocalProblem): string {
  const tests = problemPublicTests(problem);
  if (!tests.length) {
    return '# 本题尚未配置公开测试用例\n';
  }
  const lines = ['import unittest', '', 'class PublicTests(unittest.TestCase):'];
  for (const [index, test] of tests.entries()) {
    const method = `test_${index + 1}_${test.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    lines.push(`    def ${method}(self):`);
    if (test.description) {
      lines.push(`        """${test.description.replace(/"""/g, "'''")}"""`);
    }
    lines.push(`        self.assertEqual(${test.expression}, ${JSON.stringify(test.expected)})`);
    lines.push('');
  }
  lines.push("if __name__ == '__main__':");
  lines.push('    unittest.main()');
  lines.push('');
  return lines.join('\n');
}

export function problemTypeLabel(type: string): string {
  switch (type) {
    case 'choice':
      return '选择题';
    case 'short_answer':
      return '简答题';
    case 'calculation':
      return '计算题';
    case 'proof':
      return '证明题';
    case 'code':
      return '编程题';
    default:
      return type || '题目';
  }
}

export function difficultyLabel(difficulty: LocalProblem['difficulty']): string {
  if (difficulty === 'easy') return '基础';
  if (difficulty === 'medium') return '进阶';
  return '挑战';
}

export function emptyAnswerForProblem(problem: LocalProblem): LocalProblemAnswer {
  if (problem.type === 'choice') {
    return { kind: 'choice', selectedOptionIds: [] };
  }
  if (problem.type === 'code') {
    return { kind: 'code', code: problemStarterCode(problem) };
  }
  return { kind: 'text', text: '' };
}

export function answerHasContent(answer: LocalProblemAnswer | null | undefined): boolean {
  if (!answer) return false;
  if (answer.kind === 'choice') return answer.selectedOptionIds.length > 0;
  if (answer.kind === 'code') return answer.code.trim().length > 0;
  return answer.text.trim().length > 0;
}

export function gradeLocalProblem(
  problem: LocalProblem,
  answer: LocalProblemAnswer,
): LocalGradeResult {
  const grading = asRecord(problem.grading);

  if (problem.type === 'choice' && answer.kind === 'choice') {
    const correct = new Set(asStringArray(grading.correctOptionIds));
    const selected = new Set(answer.selectedOptionIds);
    if (!selected.size) {
      return {
        status: 'failed',
        score: 0,
        feedback: '还没有选择选项。',
        autoGraded: true,
      };
    }
    const exact = correct.size === selected.size && [...correct].every((id) => selected.has(id));
    if (exact) {
      return {
        status: 'passed',
        score: 1,
        feedback: '选项正确。',
        autoGraded: true,
      };
    }
    const overlap = [...selected].filter((id) => correct.has(id)).length;
    if (overlap > 0) {
      return {
        status: 'partial',
        score: Math.max(0.25, overlap / Math.max(correct.size, 1)),
        feedback: '部分选项正确。',
        autoGraded: true,
      };
    }
    return {
      status: 'failed',
      score: 0,
      feedback: '选项不正确。',
      autoGraded: true,
    };
  }

  if (problem.type === 'calculation' && answer.kind === 'text') {
    const accepted = [
      ...asStringArray(grading.acceptedForms),
      typeof grading.referenceAnswer === 'string' ? grading.referenceAnswer : '',
    ].filter(Boolean);
    if (!accepted.length) {
      return {
        status: 'pending',
        score: null,
        feedback: '没有本地可核对答案，已保存作答。',
        autoGraded: false,
      };
    }
    if (textMatchesAccepted(answer.text, accepted)) {
      return {
        status: 'passed',
        score: 1,
        feedback: '计算结果匹配参考答案。',
        autoGraded: true,
      };
    }
    return {
      status: 'failed',
      score: 0,
      feedback: '计算结果与参考答案不一致。',
      autoGraded: true,
    };
  }

  return {
    status: 'pending',
    score: null,
    feedback:
      problem.type === 'code'
        ? '编程题已保存作答；本机暂不运行公开测试。'
        : '已保存作答；这道题需要人工核对或后续自动批改。',
    autoGraded: false,
  };
}
