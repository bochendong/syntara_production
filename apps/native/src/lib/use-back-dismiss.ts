import { useEffect, useRef } from 'react';

/**
 * 安卓的返回键 / 返回手势（以及桌面鼠标的后退键）关闭最上层的面板，而不是退出 App。
 * 每打开一层就压一条历史记录；按返回时只关最上面那一层。
 */
type Layer = { token: number; dismiss: () => void };

const layers: Layer[] = [];
let ignoredPops = 0;
let nextToken = 1;
let listening = false;

function listenOnce() {
  if (listening) return;
  listening = true;
  window.addEventListener('popstate', () => {
    if (ignoredPops > 0) {
      ignoredPops -= 1;
      return;
    }
    layers.pop()?.dismiss();
  });
}

export function useBackDismiss(open: boolean, onDismiss: () => void) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    listenOnce();
    const token = nextToken++;
    layers.push({ token, dismiss: () => dismissRef.current() });
    window.history.pushState({ syntaraLayer: token }, '');
    return () => {
      const index = layers.findIndex((layer) => layer.token === token);
      if (index < 0) return; // 已经被返回键关掉，历史记录也已退掉。
      // 在界面上关掉的：把这一层的历史记录也退掉，别让下一次返回落空。
      layers.splice(index, 1);
      ignoredPops += 1;
      window.history.back();
    };
  }, [open]);
}
