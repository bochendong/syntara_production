import { useMemo } from 'react';
import {
  assembleCodeFromSlots,
  extractSlotValues,
  parseCodeTemplate,
  type CodeSlotTemplate,
} from '../../../../../lib/problem-bank/code-slots';

export function NativeCodeSlots({
  template,
  value,
  onChange,
}: {
  template: CodeSlotTemplate;
  value: string;
  onChange: (code: string) => void;
}) {
  const segments = useMemo(
    () => parseCodeTemplate(template.template, template.slots) ?? [],
    [template],
  );
  const values =
    extractSlotValues(template.template, template.slots, value) ?? template.initialValues;
  return (
    <div
      className="pp-code-editor"
      style={{ overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace', padding: 16 }}
    >
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <span key={`text-${index}`}>{segment.text}</span>
        ) : segment.slot.kind === 'block' ? (
          <div key={segment.slot.id} style={{ paddingLeft: `${segment.indent.length}ch` }}>
            <textarea
              aria-label={segment.slot.placeholder || `代码空位 ${segment.slot.id}`}
              rows={5}
              value={values[segment.slot.id] ?? ''}
              onChange={(event) =>
                onChange(
                  assembleCodeFromSlots(template.template, template.slots, {
                    ...values,
                    [segment.slot.id]: event.target.value,
                  }),
                )
              }
              style={{ width: '90%', fontFamily: 'monospace' }}
            />
          </div>
        ) : (
          <input
            key={segment.slot.id}
            aria-label={segment.slot.placeholder || `代码空位 ${segment.slot.id}`}
            value={values[segment.slot.id] ?? ''}
            onChange={(event) =>
              onChange(
                assembleCodeFromSlots(template.template, template.slots, {
                  ...values,
                  [segment.slot.id]: event.target.value,
                }),
              )
            }
            style={{ fontFamily: 'monospace', minWidth: 80 }}
          />
        ),
      )}
    </div>
  );
}
