import { useEffect, useId, useRef, type CSSProperties } from 'react';
import { ArrowRight, Check, Sparkles, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { ClassStandingArt } from './class-standing';
import { CLASS_STANDING_ILLUSTRATIONS } from './class-standing-art';
import { marbleImages } from '../../lib/learning-action-marbles';
import { PRACTICE_MILESTONE_SIZE } from '../../lib/practice-milestones';
import { useBackDismiss } from '../../lib/use-back-dismiss';
import './practice-celebration.css';

export type PracticeCelebrationSnapshot = {
  newlyPassed: number;
  passed: number;
  attempted: number;
  total: number;
  title: string;
};

const CONFETTI = Array.from({ length: 72 }, (_, index) => ({
  '--x': `${(index * 137.5) % 100}%`,
  '--drift': `${((index * 41) % 280) - 140}px`,
  '--delay': `${(index % 12) * 32}ms`,
  '--duration': `${1800 + ((index * 113) % 1400)}ms`,
  '--spin': `${(index % 2 ? 1 : -1) * (280 + ((index * 29) % 540))}deg`,
  background: ['#8edfb7', '#bba6f2', '#f8cf78', '#90c8f0', '#eea3c2'][index % 5],
  borderRadius: index % 3 ? '2px' : '50%',
})) as CSSProperties[];

/** Local submission results only: class rank is never estimated from local answers. */
export function PracticeCelebration({
  snapshot,
  onClose,
  onContinue,
  onOpenCollection,
}: {
  snapshot: PracticeCelebrationSnapshot;
  onClose: () => void;
  onContinue: () => void;
  onOpenCollection?: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useBackDismiss(true, onClose, 50);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    continueButton.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button');
      const first = buttons?.[0];
      const last = buttons?.[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const remaining = Math.max(0, snapshot.total - snapshot.passed);
  const percent = Math.round((snapshot.passed / Math.max(1, snapshot.total)) * 100);
  const artwork = CLASS_STANDING_ILLUSTRATIONS.find((item) => item.id === '02-create')!;
  return createPortal(
    <div className="pc-layer">
      <div className="pc-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="pc-confetti" aria-hidden="true">
        {CONFETTI.map((style, index) => (
          <i key={index} style={style} />
        ))}
      </div>
      <div
        ref={dialog}
        className="pc-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <ClassStandingArt illustration={artwork} />
        <div className="pc-content">
          <button type="button" className="pc-close" onClick={onClose} aria-label="关闭进度卡片">
            <X size={18} />
          </button>
          <span className="pc-eyebrow">
            <Sparkles size={15} /> {snapshot.title}
          </span>
          <div className="pc-five-marbles" aria-hidden="true">
            {Array.from({ length: PRACTICE_MILESTONE_SIZE }, (_, index) => (
              <img
                key={index}
                src={marbleImages.green}
                alt=""
                style={{ '--index': index } as CSSProperties}
              />
            ))}
            <span>
              <Check size={18} strokeWidth={3} />
            </span>
          </div>
          <h2 id={titleId}>这几题，拿下了。</h2>
          <div className="pc-progress-panel" id={descriptionId}>
            <div className="pc-progress-label">
              <span>{snapshot.title}</span>
              <span>本组进度</span>
            </div>
            <div className="pc-total">
              <strong>{snapshot.passed}</strong>
              <span>/ {snapshot.total} 道已通过</span>
              <b>{percent}%</b>
            </div>
            <div
              className="pc-track"
              role="progressbar"
              aria-label="本组通过进度"
              aria-valuemin={0}
              aria-valuemax={snapshot.total}
              aria-valuenow={snapshot.passed}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            <div className="pc-stat-row">
              <span>
                本轮新通过 <b>{snapshot.newlyPassed} 道</b>
              </span>
              <span>
                本组已作答 <b>{snapshot.attempted} 道</b>
              </span>
            </div>
          </div>
          {onOpenCollection && (
            <button type="button" className="pc-collection-link" onClick={onOpenCollection}>
              <Sparkles size={16} />
              <span>努力有回响，去收藏室看看</span>
              <ArrowRight size={15} />
            </button>
          )}
          <button ref={continueButton} type="button" className="pc-continue" onClick={onContinue}>
            {remaining ? '再做几题' : '回看本组'} <ArrowRight size={17} />
          </button>
          <button type="button" className="pc-rest" onClick={onClose}>
            先歇一下
          </button>
          <small className="pc-saved">
            <Check size={12} /> 作答已保存
          </small>
        </div>
      </div>
    </div>,
    document.body,
  );
}
