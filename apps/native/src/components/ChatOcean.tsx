import { useEffect, useRef } from 'react';
import './chat-ocean.css';

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
