import { useMemo, useState } from 'react';
import { CodeAnswerEditor, highlightPython } from './code-answer-editor';
import './native-code-slots.css';
import { useCodeSlotDraft } from '../../../../../lib/problem-bank/use-code-slot-draft';
import {
  assembleCodeFromSlots,
  editableCodeDocument,
  editCodeDocument,
  extractSlotValues,
  parseCodeTemplate,
  type CodeSlotTemplate,
} from '../../../../../lib/problem-bank/code-slots';

type SlotProps = {
  template: CodeSlotTemplate;
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  className?: string;
  locale: 'zh-CN' | 'en-US';
};

export function NativeCodeSlots(props: SlotProps) {
  const segments = useMemo(
    () => parseCodeTemplate(props.template.template, props.template.slots) ?? [],
    [props.template],
  );
  if (segments.some((part) => part.kind === 'slot' && part.slot.kind !== 'block'))
    return <InlineCodeSlots {...props} segments={segments} />;
  return <BlockCodeSlots {...props} />;
}

function InlineCodeSlots({
  template,
  value,
  onChange,
  disabled,
  className,
  locale,
  segments,
}: SlotProps & { segments: NonNullable<ReturnType<typeof parseCodeTemplate>> }) {
  const { values, update } = useCodeSlotDraft(template, value, onChange);
  const slots = segments.filter((part) => part.kind === 'slot');
  return (
    <div className={`native-slot-sheet ${className ?? ''}`}>
      <div className="native-slot-numbers" aria-hidden="true">
        {value.split('\n').map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <pre className="native-slot-source">
        {segments.map((part, i) => {
          if (part.kind === 'text') return <span key={i}>{highlightPython(part.text)}</span>;
          const ordinal = slots.indexOf(part) + 1;
          const text = values[part.slot.id] ?? '';
          const label = locale === 'zh-CN' ? `第 ${ordinal} 空` : `Blank ${ordinal}`;
          const attributes = {
            'aria-label': label,
            placeholder: part.slot.placeholder ?? `〔${ordinal}〕`,
            title: part.slot.hint ?? label,
            value: text,
            disabled,
            spellCheck: false,
            autoCapitalize: 'off',
            autoComplete: 'off',
          };
          return part.slot.kind === 'block' ? (
            <span key={i}>
              {part.indent}
              <textarea
                {...attributes}
                rows={Math.max(1, text.split('\n').length)}
                onChange={(e) => update(part.slot.id, e.target.value)}
              />
            </span>
          ) : (
            <input
              key={i}
              {...attributes}
              style={{
                width: `${Math.min(80, Math.max(part.slot.kind === 'line' ? 18 : 6, (part.slot.placeholder?.length ?? 0) + 2, text.length + 2))}ch`,
              }}
              onChange={(e) => update(part.slot.id, e.target.value)}
            />
          );
        })}
      </pre>
    </div>
  );
}

/** Block answers keep the full editor, including indentation and multiline editing. */
function BlockCodeSlots({ template, value, onChange, disabled, className, locale }: SlotProps) {
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
      locale={locale}
      plain
      emptyRegionHints={current.document.ranges
        .filter((range) => !current.document.text.slice(range.start, range.end).trim())
        .map((range) => ({
          offset: range.end,
          text: locale === 'zh-CN' ? '在这里写代码' : 'Write code here',
        }))}
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
