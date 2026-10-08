import { useCallback, useRef, useState, type DragEvent as ReactDragEvent } from 'react';

type DropEvent = ReactDragEvent<HTMLElement>;

export function isFileDragEvent(event: Pick<DropEvent, 'dataTransfer'>) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Matches a file against an `<input accept>` string (".pdf,image/*,application/pdf").
 * An empty accept string matches everything.
 */
export function fileMatchesAccept(file: Pick<File, 'name' | 'type'>, accept?: string) {
  const tokens = (accept ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  return tokens.some((token) => {
    if (token.startsWith('.')) return name.endsWith(token);
    if (token.endsWith('/*')) return type.startsWith(token.slice(0, -1));
    return type === token;
  });
}

/**
 * Drag-and-drop file handling for any element. Spread `dropZoneProps` onto the
 * drop target and use `isDragging` for the highlight. Only real file drags
 * react, so dragging text or in-page elements keeps working as before.
 */
export function useFileDrop({
  onFiles,
  disabled = false,
  accept,
  multiple = true,
  onRejected,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** Same format as `<input accept>`; files that don't match go to `onRejected`. */
  accept?: string;
  /** When false, only the first accepted file is passed to `onFiles`. */
  multiple?: boolean;
  onRejected?: (files: File[]) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const depthRef = useRef(0);

  const reset = useCallback(() => {
    depthRef.current = 0;
    setIsDragging(false);
  }, []);

  const onDragEnter = useCallback(
    (event: DropEvent) => {
      if (disabled || !isFileDragEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depthRef.current += 1;
      setIsDragging(true);
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (event: DropEvent) => {
      if (!isFileDragEvent(event)) return;
      // Always claim file drags over the zone so a disabled zone doesn't let
      // the browser navigate away to the dropped file.
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      if (!disabled) setIsDragging(true);
    },
    [disabled],
  );

  const onDragLeave = useCallback((event: DropEvent) => {
    if (!isFileDragEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setIsDragging(false);
  }, []);

  const onDrop = useCallback(
    (event: DropEvent) => {
      if (!isFileDragEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
      reset();
      if (disabled) return;
      const dropped = Array.from(event.dataTransfer.files ?? []);
      if (dropped.length === 0) return;
      const accepted = dropped.filter((file) => fileMatchesAccept(file, accept));
      const rejected = dropped.filter((file) => !accepted.includes(file));
      if (rejected.length > 0) onRejected?.(rejected);
      if (accepted.length === 0) return;
      onFiles(multiple ? accepted : accepted.slice(0, 1));
    },
    [accept, disabled, multiple, onFiles, onRejected, reset],
  );

  return {
    isDragging: isDragging && !disabled,
    dropZoneProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
