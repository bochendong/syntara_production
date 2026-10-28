import { useEffect, useId, useRef } from 'react';

export function HandwritingPageDeleteConfirmation({
  pageNumber,
  busy,
  onCancel,
  onConfirm,
}: {
  pageNumber: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      className="pp-solution-confirm"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2 id={titleId}>删除第 {pageNumber} 页？</h2>
      <p id={descriptionId}>这页包含手写内容。删除后无法恢复该页及其笔迹。</p>
      <div className="pp-solution-confirm-actions">
        <button
          ref={cancel}
          type="button"
          className="pp-run-button"
          disabled={busy}
          onClick={onCancel}
        >
          取消
        </button>
        <button type="button" className="pp-submit" disabled={busy} onClick={onConfirm}>
          删除页面
        </button>
      </div>
    </dialog>
  );
}
