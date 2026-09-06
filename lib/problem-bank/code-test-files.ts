function extractExecBody(expression: string) {
  const match = expression.match(/exec\(("(?:(?:\\.)|[^"\\])*")\s*,/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as string;
  } catch {
    return null;
  }
}

type CodeProblemTestCase = {
  id: string;
  description?: string;
  expression: string;
  expected: string;
};

function sanitizePythonIdentifier(value: string | undefined, fallback: string) {
  const normalized = (value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const safe = normalized || fallback;
  const prefixed = /^[a-z_]/.test(safe) ? safe : `case_${safe}`;
  return prefixed.startsWith('test_') ? prefixed : `test_${prefixed}`;
}

function pythonLiteral(value: unknown): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pythonLiteral).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .map(([key, item]) => `${pythonLiteral(key)}: ${pythonLiteral(item)}`)
      .join(', ')}}`;
  }
  return 'None';
}

function formatExpectedForPython(expected: string) {
  try {
    return pythonLiteral(JSON.parse(expected));
  } catch {
    return expected.trim() || 'None';
  }
}

function indentPythonBlock(source: string, spaces = 8) {
  const prefix = ' '.repeat(spaces);
  return source
    .trim()
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `${prefix}${line}` : ''))
    .join('\n');
}

function codeTestMethodSource(testCase: CodeProblemTestCase, index: number) {
  const methodName = sanitizePythonIdentifier(
    testCase.id || testCase.description,
    `case_${index + 1}`,
  );
  const recoveredBody = extractExecBody(testCase.expression);
  const body =
    recoveredBody?.trim() ||
    `self.assertEqual(${testCase.expression.trim()}, ${formatExpectedForPython(testCase.expected)})`;

  return [`    def ${methodName}_${index + 1}(self):`, indentPythonBlock(body)].join('\n');
}

export function buildCodeTestFile(
  testCases: CodeProblemTestCase[],
  fileName: string,
  className: 'PublicTests' | 'SecretTests',
) {
  if (testCases.length === 0) {
    return [`# ${fileName}`, '', '# No tests available.'].join('\n');
  }

  return [
    `# ${fileName}`,
    'import unittest',
    'from submission import *',
    '',
    '',
    `class ${className}(unittest.TestCase):`,
    testCases.map(codeTestMethodSource).join('\n\n'),
    '',
    '',
    'if __name__ == "__main__":',
    '    unittest.main()',
  ].join('\n');
}
