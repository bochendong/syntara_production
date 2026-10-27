'use client';

import { useCallback, useRef } from 'react';

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
  const editors = useRef(new Map<string, HTMLTextAreaElement>());
  const activeLabel = useRef<string | null>(null);
  const registerEditor = useCallback((label: string, editor: HTMLTextAreaElement | null) => {
    if (editor) editors.current.set(label, editor);
    else editors.current.delete(label);
  }, []);
  const activateEditor = useCallback((label: string) => {
    activeLabel.current = label;
  }, []);
  const insertFormula = useCallback(
    (latex: string) => {
      if (disabled) return false;
      const label =
        visiblePartLabel ??
        (activeLabel.current && editors.current.has(activeLabel.current)
          ? activeLabel.current
          : editors.current.keys().next().value);
      const editor = label ? editors.current.get(label) : undefined;
      if (!editor || !label || editor.disabled) return false;
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const scrollTop = editor.scrollTop;
      onInsertText(label, editor.value.slice(0, start) + latex + editor.value.slice(end));
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
