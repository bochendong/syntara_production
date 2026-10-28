import assert from 'node:assert/strict';
import test from 'node:test';
import {
  editableCodeDocument,
  editCodeDocument,
  assembleCodeFromSlots,
} from '../../lib/problem-bank/code-slots.ts';

const template = {
  template: 'def f(x):\n    """Given specification."""\n    {{body}}',
  slots: [{ id: 'body', kind: 'block' }],
  initialValues: {},
  derived: false,
};

test('one document preserves unfinished whitespace and emits runnable code', () => {
  const document = editableCodeDocument(template, {});
  const next = editCodeDocument(document, document.text + 'if x:\n        return x\n    ');
  assert.ok(next);
  assert.ok(next.text.endsWith('\n    '));
  const values = Object.fromEntries(
    next.ranges.map((r) => [r.id, next.text.slice(r.start, r.end)]),
  );
  assert.equal(
    assembleCodeFromSlots(template.template, template.slots, values),
    'def f(x):\n    """Given specification."""\n    if x:\n        return x',
  );
});

test('typing, paste, cut and cross-boundary deletion cannot alter supplied source', () => {
  const document = editableCodeDocument(template, { body: 'return x' });
  assert.equal(editCodeDocument(document, document.text.replace('Given', 'Changed')), null);
  assert.equal(editCodeDocument(document, 'pasted replacement'), null);
  assert.equal(editCodeDocument(document, ''), null);
  assert.equal(
    editCodeDocument(document, document.text.slice(0, document.ranges[0].start - 1)),
    null,
  );
  assert.ok(editCodeDocument(document, document.text.replace('return x', 'return x + 1')));
});

test('multiple blanks keep locked separators and track offsets after editing', () => {
  const document = editableCodeDocument(
    {
      template: 'a = {{first}}\nb = {{second}}',
      slots: [
        { id: 'first', kind: 'expr' },
        { id: 'second', kind: 'expr' },
      ],
      initialValues: {},
      derived: false,
    },
    { first: '1', second: '2' },
  );
  const next = editCodeDocument(document, 'a = 123\nb = 2');
  assert.ok(next);
  assert.equal(next.text.slice(next.ranges[1].start, next.ranges[1].end), '2');
  assert.equal(editCodeDocument(next, 'a = 123\nb = 2\n3'), null);
  assert.equal(editCodeDocument(next, 'a = 1232'), null);
});
