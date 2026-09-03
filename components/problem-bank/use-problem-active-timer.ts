'use client';

import { useCallback, useEffect, useRef } from 'react';

const IDLE_AFTER_MS = 60_000;
const PERSIST_EVERY_MS = 5_000;
const MAX_CLIENT_DURATION_MS = 14_400_000;

function storageKey(courseId: string, problemId: string) {
  return `syntara:problem-active-time:v1:${courseId}:${problemId}`;
}

export function useProblemActiveTimer(args: {
  courseId: string;
  problemId: string | null;
  enabled: boolean;
}) {
  const totalMsRef = useRef(0);
  const runningSinceRef = useRef<number | null>(null);
  const lastInteractionRef = useRef(0);
  const keyRef = useRef<string | null>(null);

  const flush = useCallback(() => {
    const now = Date.now();
    if (runningSinceRef.current !== null) {
      totalMsRef.current = Math.min(
        MAX_CLIENT_DURATION_MS,
        totalMsRef.current + Math.max(0, now - runningSinceRef.current),
      );
      runningSinceRef.current = null;
    }
    if (keyRef.current) {
      window.localStorage.setItem(
        keyRef.current,
        JSON.stringify({ activeDurationMs: totalMsRef.current, savedAt: now }),
      );
    }
  }, []);

  const resume = useCallback(() => {
    if (!args.enabled || !args.problemId || document.hidden || !document.hasFocus()) return;
    lastInteractionRef.current = Date.now();
    if (runningSinceRef.current === null) runningSinceRef.current = Date.now();
  }, [args.enabled, args.problemId]);

  useEffect(() => {
    flush();
    if (!args.enabled || !args.problemId) {
      keyRef.current = null;
      totalMsRef.current = 0;
      return;
    }
    const key = storageKey(args.courseId, args.problemId);
    keyRef.current = key;
    try {
      const saved = JSON.parse(window.localStorage.getItem(key) || '{}') as {
        activeDurationMs?: number;
      };
      totalMsRef.current = Number.isFinite(saved.activeDurationMs)
        ? Math.min(MAX_CLIENT_DURATION_MS, Math.max(0, saved.activeDurationMs || 0))
        : 0;
    } catch {
      totalMsRef.current = 0;
    }
    lastInteractionRef.current = Date.now();
    if (!document.hidden && document.hasFocus()) runningSinceRef.current = Date.now();
    return flush;
  }, [args.courseId, args.enabled, args.problemId, flush]);

  useEffect(() => {
    if (!args.enabled || !args.problemId) return;
    const onActivity = () => resume();
    const onVisibility = () => (document.hidden ? flush() : resume());
    const onBlur = () => flush();
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, onActivity, { passive: true }));
    window.addEventListener('focus', onActivity);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    const interval = window.setInterval(() => {
      if (Date.now() - lastInteractionRef.current >= IDLE_AFTER_MS) flush();
      else if (runningSinceRef.current === null && !document.hidden && document.hasFocus()) {
        runningSinceRef.current = Date.now();
      } else {
        flush();
        if (!document.hidden && document.hasFocus()) runningSinceRef.current = Date.now();
      }
    }, PERSIST_EVERY_MS);
    return () => {
      events.forEach((event) => window.removeEventListener(event, onActivity));
      window.removeEventListener('focus', onActivity);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(interval);
    };
  }, [args.enabled, args.problemId, flush, resume]);

  const getActiveDuration = useCallback(() => {
    flush();
    return Math.min(MAX_CLIENT_DURATION_MS, Math.round(totalMsRef.current));
  }, [flush]);

  const reset = useCallback(() => {
    flush();
    totalMsRef.current = 0;
    if (keyRef.current) window.localStorage.removeItem(keyRef.current);
    lastInteractionRef.current = Date.now();
    runningSinceRef.current =
      args.enabled && args.problemId && !document.hidden && document.hasFocus() ? Date.now() : null;
  }, [args.enabled, args.problemId, flush]);

  return { getActiveDuration, reset, markActive: resume };
}
