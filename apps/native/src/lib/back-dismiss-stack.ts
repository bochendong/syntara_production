type Layer = { dismiss: () => void; priority: number };
type HistoryPort = {
  readonly state: unknown;
  pushState(data: unknown, unused: string): void;
  back(): void;
};

/** One history guard for the visible UI stack, including drawer/page swaps. */
export function createBackDismissStack(
  history: HistoryPort,
  schedule: (callback: () => void) => void = queueMicrotask,
) {
  const marker = `syntara-back-${Math.random().toString(36).slice(2)}`;
  const layers: Layer[] = [];
  let guarded = false;
  let rewinding = false;
  let queued = false;
  const reconcile = () => {
    queued = false;
    if (rewinding) return;
    if (layers.length && !guarded) {
      history.pushState({ syntaraBackGuard: marker }, '');
      guarded = true;
    } else if (!layers.length && guarded) {
      guarded = false;
      const state = history.state as { syntaraBackGuard?: string } | null;
      if (state?.syntaraBackGuard === marker) {
        rewinding = true;
        history.back();
      }
    }
  };
  const sync = () => {
    if (queued) return;
    queued = true;
    schedule(reconcile);
  };
  return {
    add(dismiss: () => void, priority = 10) {
      const layer = { dismiss, priority };
      layers.push(layer);
      layers.sort((left, right) => left.priority - right.priority);
      sync();
      return () => {
        const index = layers.indexOf(layer);
        if (index >= 0) layers.splice(index, 1);
        sync();
      };
    },
    pop() {
      if (rewinding) {
        rewinding = false;
        sync();
        return;
      }
      if (!guarded) return;
      guarded = false;
      layers.pop()?.dismiss();
      sync();
    },
  };
}
