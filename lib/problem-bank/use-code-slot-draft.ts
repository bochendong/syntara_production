import { useState } from 'react';
import { assembleCodeFromSlots, extractSlotValues, type CodeSlotTemplate } from './code-slots';

/** Keep unfinished whitespace in the editor while emitting normalized executable code. */
export function useCodeSlotDraft(
  template: CodeSlotTemplate,
  value: string,
  onChange: (code: string) => void,
) {
  const templateKey = JSON.stringify([template.template, template.slots, template.initialValues]);
  const readValues = () =>
    extractSlotValues(template.template, template.slots, value) ?? template.initialValues;
  const [draft, setDraft] = useState(() => ({
    templateKey,
    code: value,
    values: readValues(),
  }));
  // A reset, another question, or an externally loaded answer replaces the draft.
  // Our own normalized echo keeps the raw text (including trailing spaces/blank lines).
  const current =
    draft.templateKey === templateKey && draft.code === value
      ? draft
      : { templateKey, code: value, values: readValues() };
  if (current !== draft) setDraft(current);

  const update = (id: string, next: string) => {
    const values = { ...current.values, [id]: next };
    const code = assembleCodeFromSlots(template.template, template.slots, values);
    setDraft({ templateKey, code, values });
    onChange(code);
  };
  return { values: current.values, update };
}
