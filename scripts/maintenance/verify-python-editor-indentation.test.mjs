import assert from 'node:assert/strict';
import test from 'node:test';
import { pythonNewlineEdit } from '../../apps/native/src/components/problem-bank/python-editor-indentation.ts';

test('new Python blocks add one indent level, including trailing comments', () => {
  for (const line of ['def solve():', 'if ready: # start here', '    else:']) {
    const indent = line.startsWith('    ') ? '        ' : '    ';
    const edit = pythonNewlineEdit(line, line.length);
    assert.equal(edit.value, `${line}\n${indent}`);
    assert.equal(edit.caret, edit.value.length);
  }
});

test('ordinary lines retain their current indentation', () => {
  const line = '        result = compute()';
  assert.equal(pythonNewlineEdit(line, line.length).value, `${line}\n        `);
});

test('colons in comments and strings do not open blocks', () => {
  for (const line of ['    # example:', '    print("提示:")', "    text = 'it\\'s:'"]) {
    assert.equal(pythonNewlineEdit(line, line.length).value, `${line}\n    `);
  }
});

test('multiline docstrings do not treat their text as Python blocks', () => {
  const value = 'def solve():\n    """\n    Examples:';
  assert.equal(pythonNewlineEdit(value, value.length).value, `${value}\n    `);
});

test('existing tab indentation keeps its style', () => {
  const value = '\tif ready:';
  assert.equal(pythonNewlineEdit(value, value.length).value, `${value}\n\t\t`);
});

test('Enter replaces the selection without discarding following code', () => {
  const value = '    result = old_value + suffix';
  const start = value.indexOf('old_value');
  const edit = pythonNewlineEdit(value, start, start + 'old_value'.length);
  assert.equal(edit.value, '    result = \n     + suffix');
  assert.equal(edit.caret, start + 5);
});

test('empty documents, blank lines and Unicode retain correct caret offsets', () => {
  assert.deepEqual(pythonNewlineEdit('', 0), { value: '\n', caret: 1 });
  const value = '    提示 = "你好"';
  const edit = pythonNewlineEdit(value, value.length);
  assert.equal(edit.value, `${value}\n    `);
  assert.equal(edit.caret, edit.value.length);
  assert.equal(pythonNewlineEdit('    ', 4).value, '    \n    ');
});
