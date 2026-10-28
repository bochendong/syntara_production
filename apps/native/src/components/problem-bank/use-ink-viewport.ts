import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  clampInkView,
  inkPaperSize,
  moveInkGesture,
  resetInkView,
  resizeInkView,
  zoomInkView,
  type InkView,
  type InkViewPoint,
  type InkViewportSize,
} from '../../lib/ink-viewport';

export function useInkViewport({
  disabled,
  penIsDrawing,
}: {
  disabled: boolean;
  penIsDrawing: () => boolean;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef<InkViewportSize>({ width: 1, height: 1 });
  const viewRef = useRef<InkView>({ zoom: 1, x: 8, y: 8 });
  const [view, setView] = useState<InkView>({ zoom: 1, x: 8, y: 8 });
  const [paperWidth, setPaperWidth] = useState(1);
  const pointers = useRef(new Map<number, InkViewPoint>());
  const update = (next: InkView) => {
    viewRef.current = next;
    setView(next);
  };
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    let initialized = false;
    const resize = () => {
      const previous = sizeRef.current;
      const next = { width: area.clientWidth, height: area.clientHeight };
      sizeRef.current = next;
      setPaperWidth(inkPaperSize(next, 1).width);
      const nextView = initialized
        ? resizeInkView(viewRef.current, previous, next)
        : resetInkView(next);
      initialized = true;
      viewRef.current = nextView;
      setView(nextView);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (disabled || penIsDrawing()) return;
      const size = sizeRef.current;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
      const rect = area.getBoundingClientRect();
      const current = viewRef.current;
      update(
        event.ctrlKey || event.metaKey
          ? zoomInkView(
              current,
              current.zoom * Math.exp(-event.deltaY * unit * 0.01),
              { x: event.clientX - rect.left, y: event.clientY - rect.top },
              size,
            )
          : clampInkView(
              {
                ...current,
                x: current.x - event.deltaX * unit,
                y: current.y - event.deltaY * unit,
              },
              size,
            ),
      );
    };
    area.addEventListener('wheel', wheel, { passive: false });
    return () => area.removeEventListener('wheel', wheel);
  }, [disabled, penIsDrawing]);
  const point = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const consume = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointers.current.delete(event.pointerId)) consume(event);
  };
  return {
    areaRef,
    zoom: view.zoom,
    paperStyle: {
      width: paperWidth,
      transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
    },
    zoomBy: (factor: number) => {
      if (penIsDrawing()) return;
      const size = sizeRef.current;
      update(
        zoomInkView(
          viewRef.current,
          viewRef.current.zoom * factor,
          { x: size.width / 2, y: size.height / 2 },
          size,
        ),
      );
    },
    resetView: () => {
      if (!penIsDrawing()) update(resetInkView(sizeRef.current));
    },
    navigationProps: {
      onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget || disabled || penIsDrawing()) return;
        const current = viewRef.current;
        const size = sizeRef.current;
        const step = event.shiftKey ? 120 : 40;
        const directions: Record<string, [number, number]> = {
          ArrowLeft: [step, 0],
          ArrowRight: [-step, 0],
          ArrowUp: [0, step],
          ArrowDown: [0, -step],
        };
        if (directions[event.key]) {
          event.preventDefault();
          const [x, y] = directions[event.key];
          update(clampInkView({ ...current, x: current.x + x, y: current.y + y }, size));
        } else if (['+', '=', '-', '0'].includes(event.key)) {
          event.preventDefault();
          update(
            event.key === '0'
              ? resetInkView(size)
              : zoomInkView(
                  current,
                  current.zoom * (event.key === '-' ? 1 / 1.25 : 1.25),
                  { x: size.width / 2, y: size.height / 2 },
                  size,
                ),
          );
        }
      },
      onPointerDownCapture: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.pointerType === 'pen') {
          // A pen takes priority over any fingers already resting on the paper.
          pointers.current.clear();
          return;
        }
        if (event.pointerType !== 'touch') return;
        consume(event);
        if (disabled || penIsDrawing()) return;
        pointers.current.set(event.pointerId, point(event));
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMoveCapture: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== 'touch') return;
        consume(event);
        if (disabled || penIsDrawing() || !pointers.current.has(event.pointerId)) return;
        const before = [...pointers.current.values()];
        pointers.current.set(event.pointerId, point(event));
        update(
          moveInkGesture(viewRef.current, before, [...pointers.current.values()], sizeRef.current),
        );
      },
      onPointerUpCapture: finish,
      onPointerCancelCapture: finish,
      onLostPointerCapture: finish,
    },
  };
}
