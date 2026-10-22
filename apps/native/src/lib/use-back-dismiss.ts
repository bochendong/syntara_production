import { useEffect, useRef } from 'react';
import { createBackDismissStack } from './back-dismiss-stack';

let stack: ReturnType<typeof createBackDismissStack> | undefined;

/** Batch UI closes before touching history, so replacing a drawer cannot leave the app. */
export function useBackDismiss(open: boolean, onDismiss: () => void, priority = 10) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);
  useEffect(() => {
    if (!open) return;
    if (!stack) {
      stack = createBackDismissStack(window.history);
      window.addEventListener('popstate', () => stack?.pop());
    }
    return stack.add(() => dismissRef.current(), priority);
  }, [open, priority]);
}
