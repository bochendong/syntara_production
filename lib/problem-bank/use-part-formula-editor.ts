'use client';

import { useCallback, useRef } from 'react';

export type FormulaEditorOptions = { partLabel?: string; onInsertText?: (text: string) => void };

export type PartFormulaHandle = { insertFormula: (latex: string) => boolean };

/** Routes the left formula sheet to the focused part, or the visible part on narrow screens. */
export function usePartFormulaEditor({
  disabled,
  visiblePartLabel,
  onInsertText,
}: {
  disabled: boolean;
  visiblePartLabel?: string;
  onInsertText: (label: string, text: string) => void;
}) {
  const editors = useRef(
    new Map<string, { editor: HTMLTextAreaElement; options?: FormulaEditorOptions }>(),
  );
  const activeLabel = useRef<string | null>(null);
  const registerEditor = useCallback(
    (label: string, editor: HTMLTextAreaElement | null, options?: FormulaEditorOptions) => {
      if (editor) editors.current.set(label, { editor, options });
      else editors.current.delete(label);
    },
    [],
  );
  const activateEditor = useCallback((label: string) => {
    activeLabel.current = label;
  }, []);
  const insertFormula = useCallback(
    (latex: string) => {
      if (disabled) return false;
      const eligible = [...editors.current.keys()].filter(
        (key) =>
          !visiblePartLabel ||
          (editors.current.get(key)?.options?.partLabel ?? key) === visiblePartLabel,
      );
      const label =
        activeLabel.current && eligible.includes(activeLabel.current)
          ? activeLabel.current
          : eligible[0];
      const entry = label ? editors.current.get(label) : undefined;
      const editor = entry?.editor;
      if (!editor || !label || editor.disabled) return false;
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const scrollTop = editor.scrollTop;
      const text = editor.value.slice(0, start) + latex + editor.value.slice(end);
      if (entry?.options?.onInsertText) entry.options.onInsertText(text);
      else onInsertText(label, text);
      requestAnimationFrame(() => {
        if (!editor.isConnected) return;
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(start + latex.length, start + latex.length);
        editor.scrollTop = scrollTop;
      });
      return true;
    },
    [disabled, visiblePartLabel, onInsertText],
  );
  return { registerEditor, activateEditor, insertFormula };
}
