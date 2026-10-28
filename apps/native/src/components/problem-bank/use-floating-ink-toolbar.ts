import { useRef, useState, type KeyboardEvent, type PointerEvent, type MouseEvent } from 'react';
import {
  clampInkToolbar,
  dockInkToolbar,
  nearestInkToolbarCorner,
  type InkToolbarCorner,
  type InkToolbarPoint,
} from '../../lib/ink-toolbar-position';

const CORNER_KEY = 'syntara.handwriting-toolbar-corner.v1';
const COLLAPSED_KEY = 'syntara.handwriting-toolbar-collapsed.v1';
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}
function readCorner(): InkToolbarCorner {
  try {
    const value = localStorage.getItem(CORNER_KEY);
    if (
      value === 'top-left' ||
      value === 'top-right' ||
      value === 'bottom-left' ||
      value === 'bottom-right'
    )
      return value;
  } catch {
    /* This preference must not prevent handwriting. */
  }
  return 'top-right';
}

export function useFloatingInkToolbar() {
  const panelRef = useRef<HTMLElement>(null);
  const toolbarRef = useRef<HTMLFieldSetElement>(null);
  const [corner, setCorner] = useState<InkToolbarCorner>(readCorner);
  const [point, setPoint] = useState<InkToolbarPoint | null>(null);
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const suppressClick = useRef(false);
  const setCollapsed = (value: boolean) => {
    setCollapsedState(value);
    try {
      localStorage.setItem(COLLAPSED_KEY, String(value));
    } catch {
      /* Optional UI preference. */
    }
  };
  const drag = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const position = useRef<InkToolbarPoint | null>(null);
  const anchor = useRef(corner);
  const geometry = () => {
    const panel = panelRef.current?.getBoundingClientRect();
    const toolbar = toolbarRef.current?.getBoundingClientRect();
    return panel && toolbar ? { panel, toolbar } : null;
  };
  const move = (next: InkToolbarPoint) => {
    position.current = next;
    setPoint(next);
  };
  const dock = (nextCorner: InkToolbarCorner) => {
    const size = geometry();
    anchor.current = nextCorner;
    setCorner(nextCorner);
    if (size) move(dockInkToolbar(nextCorner, size.panel, size.toolbar));
    try {
      localStorage.setItem(CORNER_KEY, nextCorner);
    } catch {
      /* Optional UI preference. */
    }
  };

  const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    const moved = drag.current.moved;
    drag.current = null;
    const size = geometry();
    if (moved && size && position.current)
      dock(nearestInkToolbarCorner(position.current, size.panel, size.toolbar));
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = anchor.current;
    let next: InkToolbarCorner | undefined;
    if (event.key === 'ArrowLeft') next = current.startsWith('top') ? 'top-left' : 'bottom-left';
    if (event.key === 'ArrowRight') next = current.startsWith('top') ? 'top-right' : 'bottom-right';
    if (event.key === 'ArrowUp') next = current.endsWith('right') ? 'top-right' : 'top-left';
    if (event.key === 'ArrowDown')
      next = current.endsWith('right') ? 'bottom-right' : 'bottom-left';
    if (event.key === 'Home') next = 'top-left';
    if (event.key === 'End') next = 'bottom-right';
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    dock(next);
  };
  return {
    panelRef,
    toolbarRef,
    corner,
    dragging,
    collapsed,
    setCollapsed,
    consumeDragClick: (event: MouseEvent<HTMLButtonElement>) => {
      const consumed = suppressClick.current && event.detail > 0;
      suppressClick.current = false;
      return consumed;
    },
    // Docked controls use CSS corner anchors, so resizing never animates stale coordinates.
    style:
      dragging && point
        ? { left: point.x, top: point.y, right: 'auto', bottom: 'auto' }
        : undefined,
    handleProps: {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0 || drag.current) return;
        const size = geometry();
        if (!size) return;
        event.preventDefault();
        event.stopPropagation();
        drag.current = {
          pointerId: event.pointerId,
          offsetX: event.clientX - size.toolbar.left,
          offsetY: event.clientY - size.toolbar.top,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
        };
        suppressClick.current = false;
        position.current = {
          x: size.toolbar.left - size.panel.left,
          y: size.toolbar.top - size.panel.top,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        if (
          !current.moved &&
          Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6
        )
          return;
        current.moved = true;
        suppressClick.current = true;
        setDragging(true);
        const size = geometry();
        if (!size) return;
        event.preventDefault();
        event.stopPropagation();
        move(
          clampInkToolbar(
            {
              x: event.clientX - size.panel.left - current.offsetX,
              y: event.clientY - size.panel.top - current.offsetY,
            },
            size.panel,
            size.toolbar,
          ),
        );
      },
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
      onLostPointerCapture: finishDrag,
      onKeyDown,
    },
  };
}
