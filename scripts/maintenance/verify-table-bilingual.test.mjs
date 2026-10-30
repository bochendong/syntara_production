import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { notebookProblemPublicTableSchema } = await jiti.import('../../lib/problem-bank/schema.ts');
const { getLocalizedProblemContent, hasProblemTranslation } = await jiti.import(
  '../../lib/problem-bank/i18n.ts',
);
const { localizeProblem } = await jiti.import('../../apps/native/src/lib/problem-language.ts');
const { tableAnswerKeys, matchTableCellLocally } = await jiti.import(
  '../../lib/problem-bank/table-problem.ts',
);

function fixture() {
  return notebookProblemPublicTableSchema.parse({
    type: 'table',
    stem: 'Complete the table',
    setupCode: 'x = 3',
    columns: [
      { id: 'question', header: 'Description', role: 'given', cellKind: 'text' },
      { id: 'code', header: 'print(x)', role: 'given', cellKind: 'code' },
      { id: 'answer', header: 'Answer', role: 'answer', cellKind: 'text' },
    ],
    rows: [
      { id: 'first', cells: { question: 'First item', code: 'print(x)', answer: 'untouched' } },
      { id: 'second', cells: { question: 'print(x)', code: 'x + 1' } },
      { id: 'third', cells: { question: 'Other item', code: 'x - 1' } },
    ],
    translations: {
      'zh-CN': {
        title: '表格练习',
        stem: '完成表格',
        tableColumns: [
          { id: 'question', header: '说明' },
          { id: 'code', header: '翻译代码' },
          { id: 'answer', header: '答案' },
        ],
        tableCells: [
          { rowId: 'first', colId: 'question', value: '第一项' },
          { rowId: 'first', colId: 'code', value: '错误地翻译代码' },
          { rowId: 'first', colId: 'answer', value: '错误地翻译答案' },
          { rowId: 'second', colId: 'question', value: '错误地翻译文本中的代码' },
          { rowId: 'missing', colId: 'question', value: '不存在的行' },
          { rowId: 'third', colId: 'missing', value: '不存在的列' },
        ],
      },
    },
  });
}

test('schema keeps translations and both clients preserve identifiers, code, grading and base', () => {
  const content = fixture();
  const original = structuredClone(content);
  const localized = getLocalizedProblemContent(content, 'zh-CN');
  assert.equal(localized.columns[0].header, '说明');
  assert.equal(localized.columns[1].header, 'print(x)');
  assert.equal(localized.columns[2].header, '答案');
  assert.deepEqual(localized.rows[0].cells, {
    question: '第一项',
    code: 'print(x)',
    answer: 'untouched',
  });
  assert.deepEqual(localized.rows[1], content.rows[1]);
  assert.deepEqual(localized.rows[2], content.rows[2]);
  assert.equal(localized.setupCode, 'x = 3');
  assert.deepEqual(tableAnswerKeys(localized), tableAnswerKeys(content));
  const grading = { matcher: 'normalized_exact', acceptedAnswers: ['OK'] };
  assert.equal(matchTableCellLocally(grading, 'ok'), true);
  assert.deepEqual(content, original);
  assert.deepEqual(getLocalizedProblemContent(content, 'en-US'), content);
  const problem = { title: 'Table', publicContent: content };
  assert.equal(hasProblemTranslation(problem, 'zh-CN'), true);
  assert.equal(localizeProblem(problem, 'zh-CN').title, '表格练习');
  assert.deepEqual(localizeProblem(problem, 'zh-CN').publicContent, localized);
});

test('duplicate translations and absent values fall back individually', () => {
  const content = fixture();
  content.translations['zh-CN'].tableColumns.push({ id: 'question', header: '重复' });
  content.translations['zh-CN'].tableCells.push({
    rowId: 'first',
    colId: 'question',
    value: '重复',
  });
  const localized = getLocalizedProblemContent(content, 'zh-CN');
  assert.equal(localized.columns[0].header, 'Description');
  assert.equal(localized.columns[2].header, '答案');
  assert.equal(localized.rows[0].cells.question, 'First item');
  assert.equal(localized.rows[2].cells.question, 'Other item');
});

test('nested table translations work without parent translations, old content remains valid', () => {
  const child = fixture();
  const parent = { type: 'multipart', stem: 'Part', parts: [{ label: 'a', content: child }] };
  assert.equal(hasProblemTranslation({ title: 'Part', publicContent: parent }), true);
  assert.equal(
    getLocalizedProblemContent(parent, 'zh-CN').parts[0].content.rows[0].cells.question,
    '第一项',
  );
  delete child.translations;
  assert.deepEqual(
    getLocalizedProblemContent(notebookProblemPublicTableSchema.parse(child), 'zh-CN'),
    child,
  );
});

test('schema validates translation identities and lengths', () => {
  const content = fixture();
  content.translations['zh-CN'].tableCells[0].rowId = 'bad:id';
  assert.equal(notebookProblemPublicTableSchema.safeParse(content).success, false);
  content.translations['zh-CN'].tableCells[0].rowId = 'first';
  content.translations['zh-CN'].tableCells[0].value = 'a'.repeat(8001);
  assert.equal(notebookProblemPublicTableSchema.safeParse(content).success, false);
});

test('non-text and unknown column kinds always retain their original values', () => {
  for (const kind of ['code', 'python_value', 'output', 'unknown']) {
    const content = fixture();
    content.columns[0].cellKind = kind;
    assert.equal(getLocalizedProblemContent(content, 'zh-CN').rows[0].cells.question, 'First item');
  }
});
