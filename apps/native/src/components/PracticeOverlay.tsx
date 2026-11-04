import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';

import './course-pages.css';

/** iPad/桌面做题：几乎全屏的玻璃弹窗，盖住侧栏；Esc 或左上角返回回到答题卡。 */
export function PracticeOverlay({
  onClose,
  minimized,
  onRestore,
  children,
}: {
  onClose: () => void;
  minimized: boolean;
  onRestore: () => void;
  children: ReactNode;
}) {
  const [marblePosition, setMarblePosition] = useState<{ right: number; bottom: number }>();
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    right: number;
    bottom: number;
  } | null>(null);
  const didDrag = useRef(false);
  const [dragging, setDragging] = useState(false);
  const marbleStyle = marblePosition
    ? ({
        '--practice-marble-right': `clamp(max(8px, env(safe-area-inset-right)), ${marblePosition.right}px, calc(100dvw - 64px - env(safe-area-inset-left)))`,
        '--practice-marble-bottom': `clamp(max(8px, env(safe-area-inset-bottom)), ${marblePosition.bottom}px, calc(100dvh - 64px - env(safe-area-inset-top)))`,
      } as CSSProperties)
    : undefined;

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    didDrag.current = false;
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      right: window.innerWidth - bounds.right,
      bottom: window.innerHeight - bounds.bottom,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!didDrag.current && Math.hypot(dx, dy) < 5) return;
    if (!didDrag.current) setDragging(true);
    didDrag.current = true;
    setMarblePosition({ right: start.right - dx, bottom: start.bottom - dy });
  };

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  const resumeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (minimized) {
      resumeRef.current?.focus({ preventScroll: true });
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
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
  }, [minimized]);

  return (
    <>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={minimized ? 'practice-overlay is-minimized' : 'practice-overlay'}
        style={marbleStyle}
        role="dialog"
        aria-modal={minimized ? undefined : true}
        aria-label="做题"
        inert={minimized}
      >
        <div className="practice-overlay-backdrop" onClick={() => closeRef.current()} aria-hidden />
        <div className="practice-overlay-card">{children}</div>
      </div>
      <button
        ref={resumeRef}
        type="button"
        className="practice-resume-marble"
        aria-label="继续做题"
        title="继续做题"
        aria-hidden={!minimized}
        data-dragging={dragging || undefined}
        disabled={!minimized}
        style={marbleStyle}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onClick={(event) => {
          if (!didDrag.current || event.detail === 0) onRestore();
        }}
      >
        <span className="practice-marble-glass" aria-hidden="true">
          <span className="practice-marble-current" />
        </span>
      </button>
    </>
  );
}
