import { useEffect, useState, type RefObject } from 'react';

/** Only accept file drops over the visible chat; never navigate to a dropped file. */
export function useChatFileDrop(
  target: RefObject<HTMLElement | null>,
  enabled: boolean,
  onFiles: (files: File[]) => void,
) {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;
    const isFileDrag = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const isChatTarget = (event: DragEvent) =>
      enabled && event.target instanceof Node && Boolean(target.current?.contains(event.target));
    const reset = () => {
      depth = 0;
      setDragging(false);
    };
    const enter = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(isChatTarget(event));
    };
    const over = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      const accepted = isChatTarget(event);
      if (event.dataTransfer) event.dataTransfer.dropEffect = accepted ? 'copy' : 'none';
      setDragging(accepted);
    };
    const leave = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      const accepted = isChatTarget(event);
      const files = Array.from(event.dataTransfer?.files ?? []);
      reset();
      if (accepted && files.length) onFiles(files);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reset();
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('dragend', reset);
    window.addEventListener('blur', reset);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('blur', reset);
      window.removeEventListener('keydown', escape);
    };
  }, [target, enabled, onFiles]);

  return enabled && dragging;
}
