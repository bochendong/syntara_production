import { useEffect, useRef } from 'react';
import { Fish } from 'lucide-react';
import './chat-ocean.css';

export function ChatOceanToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="phone-glass-button chat-ocean-toggle"
      aria-label="鲨鱼背景"
      aria-pressed={enabled}
      title={enabled ? '关闭鲨鱼背景' : '开启鲨鱼背景'}
      onClick={() => onChange(!enabled)}
    >
      <Fish size={19} strokeWidth={1.8} aria-hidden />
    </button>
  );
}

export function ChatOceanBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    // Keep the simulation out of the initial chat bundle and cancel late imports on unmount.
    void import('../vendor/ascii-sharks/engine')
      .then(({ OceanEngine }) => {
        if (cancelled || !canvasRef.current) return;
        const engine = new OceanEngine(canvasRef.current, [
          { kind: 'hammerhead', size: 0.85 },
          { kind: 'classic', size: 0.65 },
        ]);
        destroy = () => engine.destroy();
      })
      .catch(() => {
        // Decoration may fail independently of the conversation (e.g. no Canvas context).
      });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, []);

  return (
    <div className="chat-ocean-background" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
