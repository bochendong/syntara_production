'use client';

import { useCallback } from 'react';
import type { FormulaEditorOptions } from './use-part-formula-editor';

export type PartEditorRegistration = {
  onEditorReady?: (
    label: string,
    editor: HTMLTextAreaElement | null,
    options?: FormulaEditorOptions,
  ) => void;
  onEditorFocus?: (label: string) => void;
};

/** Plain answer input; its formula tools live in the left reference pane. */
export function PartTextAnswer({
  value,
  onChange,
  disabled = false,
  editorKey,
  label,
  rows,
  placeholder,
  className,
  onEditorReady,
  onEditorFocus,
}: {
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
  editorKey: string;
  label: string;
  rows: number;
  placeholder: string;
  className?: string;
} & PartEditorRegistration) {
  const attachEditor = useCallback(
    (editor: HTMLTextAreaElement | null) => {
      onEditorReady?.(editorKey, editor);
    },
    [editorKey, onEditorReady],
  );
  return (
    <textarea
      ref={attachEditor}
      aria-label={label}
      value={value}
      disabled={disabled}
      rows={rows}
      placeholder={placeholder}
      onFocus={() => onEditorFocus?.(editorKey)}
      onChange={(event) => onChange(event.target.value)}
      className={className}
    />
  );
}
