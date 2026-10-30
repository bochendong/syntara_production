import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

/** Shared floating notification for the app and practice submission results. */
export function NativeToast({
  title,
  description,
  tone = 'neutral',
  className = '',
  onDismiss,
}: {
  title: string;
  description?: string;
  tone?: 'success' | 'warning' | 'error' | 'neutral';
  className?: string;
  onDismiss?: () => void;
}) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'neutral' ? Info : AlertCircle;
  return (
    <div className={`native-toast is-${tone} ${className}`} role="status" aria-atomic="true">
      <Icon size={22} aria-hidden className="native-toast-icon" />
      <div className="native-toast-copy">
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="关闭通知">
          <X size={16} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
