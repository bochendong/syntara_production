import type { ReactNode } from 'react';

/** Shared shell size for Learn workspace panels (problem bank, calendar, memory, …). */
export const NATIVE_WORKSPACE_DIALOG_CLASS = 'native-workspace-dialog';

export function NativeWorkspaceDialog({
  open,
  onClose,
  title,
  description,
  labelledBy,
  describedBy,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  labelledBy?: string;
  describedBy?: string;
  className?: string;
  children: ReactNode;
}) {
  if (!open) return null;

  const titleId = labelledBy ?? 'native-workspace-dialog-title';
  const descriptionId = description
    ? (describedBy ?? 'native-workspace-dialog-description')
    : describedBy;

  return (
    <div className="native-workspace-dialog-layer" role="presentation">
      <button
        type="button"
        className="native-dialog-backdrop"
        aria-label="关闭"
        onClick={onClose}
      />
      <div
        className={[NATIVE_WORKSPACE_DIALOG_CLASS, className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <span id={titleId} className="sr-only">
          {title}
        </span>
        {description ? (
          <span id={descriptionId} className="sr-only">
            {description}
          </span>
        ) : null}
        {children}
      </div>
    </div>
  );
}
