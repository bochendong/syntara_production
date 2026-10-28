import { useState } from 'react';
import { CodeAnswerEditor } from './code-answer-editor';
import './native-code-slots.css';
import {
  assembleCodeFromSlots,
  editableCodeDocument,
  editCodeDocument,
  extractSlotValues,
  type CodeSlotTemplate,
} from '../../../../../lib/problem-bank/code-slots';

/** One editor and one scroll surface. Only the template's answer ranges can change. */
export function NativeCodeSlots({
  template,
  value,
  onChange,
  disabled,
  className,
}: {
  template: CodeSlotTemplate;
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const templateKey = JSON.stringify(template);
  const read = () =>
    editableCodeDocument(
      template,
      extractSlotValues(template.template, template.slots, value) ?? template.initialValues,
    );
  const [draft, setDraft] = useState(() => ({ templateKey, code: value, document: read() }));
  const current =
    draft.templateKey === templateKey && draft.code === value
      ? draft
      : { templateKey, code: value, document: read() };
  if (current !== draft) setDraft(current);

  return (
    <CodeAnswerEditor
      value={current.document.text}
      disabled={disabled}
      locale="zh-CN"
      plain
      emptyRegionHints={current.document.ranges
        .filter((range) => !current.document.text.slice(range.start, range.end).trim())
        .map((range) => ({ offset: range.end, text: '在这里写代码' }))}
      className={`native-unified-code ${className ?? ''}`}
      onChange={(text) => {
        const document = editCodeDocument(current.document, text);
        if (!document) return false;
        const values = Object.fromEntries(
          document.ranges.map((range) => [range.id, text.slice(range.start, range.end)]),
        );
        const code = assembleCodeFromSlots(template.template, template.slots, values);
        setDraft({ templateKey, code, document });
        onChange(code);
        return true;
      }}
    />
  );
}
