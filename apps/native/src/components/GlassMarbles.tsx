import { useMemo } from 'react';

import { marbleImages, type MarbleColor } from '../lib/learning-action-marbles';
import { marbleArtFor } from '../lib/marble-art';
import {
  GALAXY_RADIUS,
  GalaxyLayout,
  galaxyNeighbors,
  type GalaxyNode,
  type MemoryGalaxy,
} from '../lib/memory-galaxy';
import './glass-marbles.css';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/** 设备不支持 3D 时的平面星图：同样的排布，玻璃丝是 SVG 线，珠子是图片。 */
export function MemoryGalaxyFlat({
  galaxy,
  size = 'lg',
  activeId = null,
  filterIds = null,
  label,
  onTap,
  onNodeTap,
}: {
  galaxy: MemoryGalaxy;
  size?: 'lg' | 'sm';
  activeId?: string | null;
  filterIds?: Set<string> | null;
  label: string;
  /** 点哪里都算（小号用）。 */
  onTap?: () => void;
  onNodeTap?: (node: GalaxyNode) => void;
}) {
  const placed = useMemo(() => {
    const layout = new GalaxyLayout();
    layout.setGalaxy(galaxy);
    layout.settle(420);
    return { points: layout.points, box: layout.bounds() };
  }, [galaxy]);
  const highlight = useMemo(() => galaxyNeighbors(galaxy, activeId), [activeId, galaxy]);
  const lit = (node: GalaxyNode) =>
    (!highlight || highlight.has(node.id)) &&
    (!filterIds || filterIds.has(node.id) || (node.kind !== 'memory' && !highlight));
  const { box } = placed;
  const pad = 0.3;
  const viewBox = `${box.minX - pad} ${box.minY - pad} ${box.maxX - box.minX + pad * 2} ${box.maxY - box.minY + pad * 2}`;
  const byId = new Map(galaxy.nodes.map((node) => [node.id, node]));
  const backgroundStyle = galaxy.backgroundUrl
    ? { backgroundImage: `url(${JSON.stringify(galaxy.backgroundUrl)})` }
    : undefined;
  const content = (
    <svg viewBox={viewBox} className="galaxy-flat-svg" aria-hidden>
      {galaxy.links.map((link) => {
        const a = placed.points.get(link.source);
        const b = placed.points.get(link.target);
        const source = byId.get(link.source);
        const target = byId.get(link.target);
        if (!a || !b || !source || !target) return null;
        const color = target.color ?? source.color;
        return (
          <line
            key={`${link.source}-${link.target}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className={`galaxy-flat-link${color ? ` is-${color}` : ''}${lit(source) && lit(target) ? '' : ' is-dim'}`}
          />
        );
      })}
      {galaxy.nodes.map((node) => {
        const point = placed.points.get(node.id);
        if (!point) return null;
        const r = GALAXY_RADIUS[node.kind];
        const dim = !lit(node);
        const art = marbleArtFor(node);
        if (node.kind === 'memory' || art) {
          const imageRadius = r / 0.9;
          return (
            <image
              key={node.id}
              href={art ?? marbleImages[node.color ?? 'purple']}
              x={point.x - imageRadius}
              y={point.y - imageRadius}
              width={imageRadius * 2}
              height={imageRadius * 2}
              className={`galaxy-flat-marble${dim ? ' is-dim' : ''}${node.id === activeId ? ' is-active' : ''}`}
              style={{ opacity: dim ? 0.2 : 0.45 + node.freshness * 0.55 }}
              onClick={
                onNodeTap
                  ? (event) => {
                      event.stopPropagation();
                      onNodeTap(node);
                    }
                  : undefined
              }
            />
          );
        }
        return (
          <circle
            key={node.id}
            cx={point.x}
            cy={point.y}
            r={r}
            className={`galaxy-flat-orb is-${node.kind}${node.color ? ` is-${node.color}` : ''}`}
            onClick={
              onNodeTap
                ? (event) => {
                    event.stopPropagation();
                    onNodeTap(node);
                  }
                : undefined
            }
          />
        );
      })}
    </svg>
  );
  if (onTap) {
    return (
      <button
        type="button"
        className={`galaxy-flat galaxy-flat-${size}`}
        style={backgroundStyle}
        onClick={onTap}
        aria-label={label}
      >
        {content}
      </button>
    );
  }
  return (
    <div
      className={`galaxy-flat galaxy-flat-${size}`}
      style={backgroundStyle}
      role="img"
      aria-label={label}
    >
      {content}
    </div>
  );
}

/** 三颗小弹珠轮流弹起来，代替转圈。 */
export function MarbleThinking() {
  return (
    <span className="marble-thinking" aria-hidden>
      <img src={marbleImages.blue} alt="" />
      <img src={marbleImages.purple} alt="" />
      <img src={marbleImages.pink} alt="" />
    </span>
  );
}

function pickTarget(): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestPriority = -Infinity;
  document.querySelectorAll<HTMLElement>('[data-marble-target]').forEach((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    if (rect.right < 0 || rect.left > window.innerWidth) return;
    const priority = Number(element.dataset.marbleTarget) || 0;
    if (priority > bestPriority) {
      best = element;
      bestPriority = priority;
    }
  });
  return best;
}

function plusOne(x: number, y: number) {
  // 落点上方飘起一个小小的 +1。
  const plus = document.createElement('span');
  plus.className = 'marble-plus-one';
  plus.textContent = '+1';
  plus.style.left = `${x}px`;
  plus.style.top = `${y}px`;
  document.body.appendChild(plus);
  window.setTimeout(() => plus.remove(), 900);
}

function land(target: HTMLElement) {
  target.classList.remove('marble-landed');
  void target.offsetWidth;
  target.classList.add('marble-landed');
  window.setTimeout(() => target.classList.remove('marble-landed'), 700);
  const rect = target.getBoundingClientRect();
  plusOne(rect.left + rect.width / 2, rect.top);
}

/**
 * 把一颗弹珠从 from 抛出去：给了 to 就飞到那个点（比如 3D 罐子的瓶口），
 * 否则飞进页面上标了 data-marble-target 的地方（学习记忆入口或课程头像），落地时目标轻轻一弹。
 */
export function launchMarble(
  from: Element | null,
  color: MarbleColor,
  options: { to?: { x: number; y: number }; onLand?: () => void } = {},
) {
  if (typeof document === 'undefined') return;
  const target = options.to ? null : pickTarget();
  const finishLanding = () => {
    if (target) land(target);
    else if (options.to) plusOne(options.to.x, options.to.y - 18);
    options.onLand?.();
  };
  if (!target && !options.to) {
    options.onLand?.();
    return;
  }
  if (!from || prefersReducedMotion()) {
    finishLanding();
    return;
  }
  const start = from.getBoundingClientRect();
  const end = target?.getBoundingClientRect();
  const size = Math.max(24, Math.min(44, start.width || 34));
  const sx = start.left + start.width / 2;
  const sy = start.top + start.height / 2;
  const ex = end ? end.left + end.width / 2 : (options.to?.x ?? sx);
  const ey = end ? end.top + end.height / 2 : (options.to?.y ?? sy);
  const cx = (sx + ex) / 2 + (ex > sx ? -40 : 40);
  // 抛物线最高点别飞出屏幕。
  const cy = Math.max(size, Math.min(sy, ey) - 120);

  const marble = document.createElement('img');
  marble.src = marbleImages[color];
  marble.alt = '';
  marble.className = 'marble-flight';
  marble.style.width = `${size}px`;
  marble.style.height = `${size}px`;
  document.body.appendChild(marble);

  const frames: Keyframe[] = [];
  const steps = 16;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = (1 - t) ** 2 * sx + 2 * (1 - t) * t * cx + t ** 2 * ex;
    const y = (1 - t) ** 2 * sy + 2 * (1 - t) * t * cy + t ** 2 * ey;
    const scale = 1 + Math.sin(t * Math.PI) * 0.25 - t * 0.55;
    frames.push({
      offset: t,
      transform: `translate(${x - size / 2}px, ${y - size / 2}px) scale(${scale}) rotate(${t * 420}deg)`,
      opacity: t > 0.92 ? 0.4 : 1,
    });
  }
  const animation = marble.animate(frames, {
    duration: 760,
    easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
    fill: 'forwards',
  });
  animation.onfinish = () => {
    marble.remove();
    finishLanding();
  };
  animation.oncancel = () => marble.remove();
}
