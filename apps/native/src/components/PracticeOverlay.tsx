import { useEffect, useRef, type ReactNode } from 'react';

import './course-pages.css';

/** iPad/桌面做题：几乎全屏的玻璃弹窗，盖住侧栏；Esc 或左上角返回回到答题卡。 */
export function PracticeOverlay({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const items = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]',
          ) ?? [],
        ).filter((item) => item.getClientRects().length);
        const first = items[0];
        const last = items.at(-1);
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === dialogRef.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === dialogRef.current)
        ) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      // 正在写答案时第一下 Esc 只是离开输入框，免得一不小心丢了草稿。
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        target.blur();
        return;
      }
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="practice-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="做题"
    >
      <div className="practice-overlay-backdrop" onClick={() => closeRef.current()} aria-hidden />
      <div className="practice-overlay-card">{children}</div>
    </div>
  );
}
