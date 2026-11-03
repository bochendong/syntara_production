import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useBackDismiss } from '../lib/use-back-dismiss';
import './course-publication.css';

export function CourseModal({
  title,
  subtitle,
  busy = false,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useBackDismiss(!busy, onClose, 60);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    (dialog.querySelector('input') ?? dialog.querySelector('button'))?.focus();
    return () => dialog.close();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="cp-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (busy || event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <header className="cp-dialog-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <button
          type="button"
          className="cp-close"
          aria-label={`关闭${title}`}
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} aria-hidden />
        </button>
      </header>
      <div className="cp-dialog-body">{children}</div>
    </dialog>,
    document.body,
  );
}
