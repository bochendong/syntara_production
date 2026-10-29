/** One refresh at a time; hidden/offline pages sleep, returning pages catch up. */
export function subscribeVisibleRefresh(
  refresh: () => Promise<unknown>,
  interval = 30_000,
  events: string[] = [],
): () => void {
  let disposed = false;
  let running = false;
  let again = false;
  const run = async () => {
    if (disposed || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await refresh();
    } catch (cause) {
      console.warn('[account-sync] refresh deferred', cause);
    } finally {
      running = false;
      if (again && !disposed) {
        again = false;
        void run();
      }
    }
  };
  const trigger = () => {
    void run();
  };
  events.forEach((event) => window.addEventListener(event, trigger));
  window.addEventListener('focus', trigger);
  window.addEventListener('online', trigger);
  document.addEventListener('visibilitychange', trigger);
  const timer = window.setInterval(trigger, interval);
  trigger();
  return () => {
    disposed = true;
    window.clearInterval(timer);
    events.forEach((event) => window.removeEventListener(event, trigger));
    window.removeEventListener('focus', trigger);
    window.removeEventListener('online', trigger);
    document.removeEventListener('visibilitychange', trigger);
  };
}
