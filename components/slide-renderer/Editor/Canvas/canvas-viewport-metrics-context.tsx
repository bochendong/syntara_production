'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface CanvasViewportMetrics {
  /** CSS `transform: scale(...)` on `.viewport` (container fit × content shrink). */
  fittedCanvasScale: number;
  /** Logical canvas height (≥ standard 16:9 slide height). */
  contentHeight: number;
  /** Logical slide width (e.g. 1000). */
  viewportWidth: number;
}

const CanvasViewportMetricsContext = createContext<CanvasViewportMetrics | null>(null);

export function CanvasViewportMetricsProvider({
  value,
  children,
}: {
  readonly value: CanvasViewportMetrics;
  readonly children: ReactNode;
}) {
  return (
    <CanvasViewportMetricsContext.Provider value={value}>
      {children}
    </CanvasViewportMetricsContext.Provider>
  );
}

export function useCanvasViewportMetrics(): CanvasViewportMetrics {
  const ctx = useContext(CanvasViewportMetricsContext);
  if (!ctx) {
    throw new Error('useCanvasViewportMetrics must be used within CanvasViewportMetricsProvider');
  }
  return ctx;
}

/** Overlay controls use this so handles align with the scaled slide. */
export function useOverlayCanvasScale(): number {
  return useCanvasViewportMetrics().fittedCanvasScale;
}
