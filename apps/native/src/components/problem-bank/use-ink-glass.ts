import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { createInkGlassMap, diffuseInkGlass, refractInkGlass } from '../../lib/ink-glass';

/** Samples only our own answer canvas, so the lens works in WebKit as well as Chromium. */
export function useInkGlass({
  toolbarRef,
  paperRef,
  collapsed,
}: {
  toolbarRef: RefObject<HTMLFieldSetElement | null>;
  paperRef: RefObject<HTMLCanvasElement | null>;
  collapsed: boolean;
}) {
  const glassRef = useRef<HTMLCanvasElement>(null);
  const update = useRef<() => void>(() => {});
  const bounds = useRef<DOMRect | null>(null);
  const refreshGlass = useCallback((point?: { clientX: number; clientY: number }) => {
    const bar = bounds.current;
    if (
      point &&
      bar &&
      (point.clientX < bar.left - 16 ||
        point.clientX > bar.right + 16 ||
        point.clientY < bar.top - 16 ||
        point.clientY > bar.bottom + 16)
    )
      return;
    update.current();
  }, []);
  useEffect(() => {
    const toolbar = toolbarRef.current;
    const paper = paperRef.current;
    const glass = glassRef.current;
    if (collapsed || !toolbar || !paper || !glass) return;
    const context = glass.getContext('2d');
    const sample = document.createElement('canvas');
    const source = sample.getContext('2d', { willReadFrequently: true });
    if (!context || !source) return;
    let frame = 0;
    let transitioning = false;
    let map: ReturnType<typeof createInkGlassMap> | null = null;
    let output = context.createImageData(1, 1);
    let previousSize = '';
    let scratch = new Uint8ClampedArray(0);
    let diffused = new Uint8ClampedArray(0);
    const reduceTransparency = window.matchMedia(
      '(prefers-reduced-transparency: reduce), (forced-colors: active)',
    );
    const paint = () => {
      frame = 0;
      if (reduceTransparency.matches) return;
      const bar = toolbar.getBoundingClientRect();
      const page = paper.getBoundingClientRect();
      bounds.current = bar;
      if (!bar.width || !bar.height || !page.width) return;
      const density = Math.min(window.devicePixelRatio || 1, 1.5);
      const size = `${bar.width}:${bar.height}:${density}`;
      if (!map || previousSize !== size) {
        map = createInkGlassMap(bar.width, bar.height, density);
        glass.width = map.width;
        glass.height = map.height;
        sample.width = map.sampleWidth;
        sample.height = map.sampleHeight;
        output = context.createImageData(map.width, map.height);
        scratch = new Uint8ClampedArray(map.sampleWidth * map.sampleHeight * 4);
        diffused = new Uint8ClampedArray(scratch.length);
        previousSize = size;
      }
      const margin = map.padding / density;
      const x = page.left - bar.left + margin;
      const y = page.top - bar.top + margin;
      const style = getComputedStyle(paper);
      const scale = page.width / paper.offsetWidth;
      const spacing = (parseFloat(style.getPropertyValue('--ink-rule-spacing')) || 28) * scale;
      source.setTransform(density, 0, 0, density, 0, 0);
      source.fillStyle = '#edf1f6';
      source.fillRect(0, 0, map.sampleWidth / density, map.sampleHeight / density);
      source.save();
      source.beginPath();
      source.rect(x, y, page.width, page.height);
      source.clip();
      source.fillStyle = style.backgroundColor;
      source.fillRect(x, y, page.width, page.height);
      source.fillStyle = style.getPropertyValue('--ink-rule-color').trim() || '#e9eef5';
      for (
        let line = y + Math.max(0, Math.floor(-y / spacing)) * spacing;
        line < bar.height + margin * 2;
        line += spacing
      ) {
        source.fillRect(x, line, page.width, scale);
      }
      source.drawImage(paper, x, y, page.width, page.height);
      source.restore();
      const pixels = source.getImageData(0, 0, map.sampleWidth, map.sampleHeight);
      diffuseInkGlass(
        pixels.data,
        map.sampleWidth,
        map.sampleHeight,
        8 * density,
        scratch,
        diffused,
      );
      refractInkGlass(pixels.data, map, output.data, diffused);
      context.putImageData(output, 0, 0);
      if (transitioning) frame = requestAnimationFrame(paint);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    update.current = schedule;
    reduceTransparency.addEventListener('change', schedule);
    const changes = new MutationObserver(schedule);
    changes.observe(paper, { attributes: true, attributeFilter: ['style', 'class'] });
    changes.observe(toolbar, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-corner'],
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(toolbar);
    resize.observe(paper);
    const transitionStart = () => {
      transitioning = true;
      schedule();
    };
    const transitionEnd = () => {
      transitioning = false;
      schedule();
    };
    toolbar.addEventListener('transitionrun', transitionStart);
    toolbar.addEventListener('transitionend', transitionEnd);
    toolbar.addEventListener('transitioncancel', transitionEnd);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      changes.disconnect();
      reduceTransparency.removeEventListener('change', schedule);
      resize.disconnect();
      toolbar.removeEventListener('transitionrun', transitionStart);
      toolbar.removeEventListener('transitionend', transitionEnd);
      toolbar.removeEventListener('transitioncancel', transitionEnd);
      update.current = () => {};
      bounds.current = null;
    };
  }, [toolbarRef, paperRef, collapsed]);
  return { glassRef, refreshGlass };
}
