'use client';

import { useEffect, useState } from 'react';

import { SyntaraLanding } from './landing/syntara-landing';
import { SyntaraWorldLanding } from './world/world-landing';

function canRunWorld() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (new URLSearchParams(window.location.search).has('classic')) return false;
  try {
    const probe = document.createElement('canvas');
    return !!probe.getContext('webgl2');
  } catch {
    return false;
  }
}

/**
 * The public home page. Browsers with WebGL 2 get the 3D world; reduced
 * motion, no WebGL, a lost GPU context or `?classic` get the 2D story page.
 */
export function HomeLanding({ googleTest = false }: { googleTest?: boolean }) {
  const [mode, setMode] = useState<'world' | 'classic'>('world');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- capability check needs the browser
    if (!canRunWorld()) setMode('classic');
  }, []);
  return mode === 'world' ? (
    <SyntaraWorldLanding googleTest={googleTest} onFallback={() => setMode('classic')} />
  ) : (
    <SyntaraLanding googleTest={googleTest} />
  );
}
