import { useEffect, useRef } from 'react';

import { MarbleTubeScene } from '../lib/marble-tube-3d';
import type { MarbleColor } from '../lib/learning-action-marbles';

/** 学习进度的立体玻璃管。 */
export default function MarbleTube3D({
  completed,
  total,
  colors,
  onUnavailable,
}: {
  completed: number;
  total: number;
  colors: MarbleColor[];
  onUnavailable: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<MarbleTubeScene | null>(null);
  const unavailableRef = useRef(onUnavailable);
  const colorsRef = useRef(colors);

  useEffect(() => {
    unavailableRef.current = onUnavailable;
    colorsRef.current = colors;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let scene: MarbleTubeScene;
    try {
      scene = new MarbleTubeScene(canvas, colorsRef.current);
    } catch {
      unavailableRef.current();
      return;
    }
    sceneRef.current = scene;
    return () => {
      sceneRef.current = null;
      scene.dispose();
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setProgress(completed, total);
  }, [completed, total]);

  return (
    <div className="marble-tube-frame" style={{ maxWidth: Math.max(120, total * 36 + 32) }}>
      <canvas
        ref={canvasRef}
        className="marble-tube-3d"
        role="img"
        aria-label={`已学完 ${completed} / ${total} 本`}
      />
    </div>
  );
}
