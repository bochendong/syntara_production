import { useEffect, useRef } from 'react';

import type { GalaxyNode, MemoryGalaxy } from '../lib/memory-galaxy';
import { MemoryGalaxyScene } from '../lib/memory-galaxy-3d';

/**
 * 立体的玻璃记忆星图。拖空白处平移，双指或滚轮缩放，拖珠子会带着相连的一起动；
 * 点珠子看那条记忆，点章节飞过去，点课程球所有珠子弹开再弹回来。
 */
export default function MemoryGalaxy3D({
  galaxy,
  activeId = null,
  filterIds = null,
  focusId,
  spawnId = null,
  label,
  className = 'memory-galaxy',
  mini = false,
  tilt = false,
  onNodeTap,
  onBackgroundTap,
  onScene,
  onUnavailable,
}: {
  galaxy: MemoryGalaxy;
  activeId?: string | null;
  filterIds?: Set<string> | null;
  /** 镜头飞到这颗球；null 回到全景，undefined 不动镜头。 */
  focusId?: string | null;
  /** 这颗新珠子从课程球里蹦出来。 */
  spawnId?: string | null;
  label: string;
  className?: string;
  mini?: boolean;
  tilt?: boolean;
  onNodeTap?: (node: GalaxyNode) => void;
  onBackgroundTap?: () => void;
  onScene?: (scene: MemoryGalaxyScene | null) => void;
  /** 没有 WebGL 时退回平面版。 */
  onUnavailable: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<MemoryGalaxyScene | null>(null);
  const callbacks = useRef({ onNodeTap, onBackgroundTap, onScene, onUnavailable });

  useEffect(() => {
    callbacks.current = { onNodeTap, onBackgroundTap, onScene, onUnavailable };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let scene: MemoryGalaxyScene;
    try {
      scene = new MemoryGalaxyScene(canvas, {
        mini,
        tilt,
        labelLayer: labelsRef.current,
        reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
        onNodeTap: (node) => callbacks.current.onNodeTap?.(node),
        onBackgroundTap: () => callbacks.current.onBackgroundTap?.(),
      });
    } catch {
      callbacks.current.onUnavailable();
      return;
    }
    sceneRef.current = scene;
    callbacks.current.onScene?.(scene);
    return () => {
      callbacks.current.onScene?.(null);
      sceneRef.current = null;
      scene.dispose();
    };
  }, [mini, tilt]);

  useEffect(() => {
    sceneRef.current?.setGalaxy(galaxy, spawnId);
  }, [galaxy, spawnId, mini, tilt]);

  useEffect(() => {
    sceneRef.current?.setActive(activeId);
  }, [activeId, galaxy, mini, tilt]);

  useEffect(() => {
    sceneRef.current?.setFilter(filterIds);
  }, [filterIds, galaxy, mini, tilt]);

  useEffect(() => {
    if (focusId !== undefined) sceneRef.current?.flyTo(focusId);
  }, [focusId, mini, tilt]);

  return (
    <div
      className={className}
      style={
        galaxy.backgroundUrl
          ? { backgroundImage: `url(${JSON.stringify(galaxy.backgroundUrl)})` }
          : undefined
      }
    >
      <canvas ref={canvasRef} role="img" aria-label={label} />
      {mini ? null : <div ref={labelsRef} className="galaxy-labels" aria-hidden />}
    </div>
  );
}
