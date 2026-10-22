import { useEffect, type RefObject } from 'react';

/**
 * iPhone 键盘弹出时 WebView 不会变矮，只会把整页往上推。这里把页面拉回顶部，
 * 再把键盘高度写进 --phone-keyboard-inset，让输入框自己贴到键盘上面。
 */
export function usePhoneKeyboardInset(
  enabled: boolean,
  targetRef: RefObject<HTMLElement | null>,
  onChange?: (inset: number) => void,
) {
  useEffect(() => {
    const viewport = window.visualViewport;
    const target = targetRef.current;
    if (!enabled || !viewport || !target) return;

    let frame = 0;
    let lastInset = -1;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (window.scrollY !== 0 || document.documentElement.scrollTop !== 0) {
          window.scrollTo(0, 0);
        }
        const inset = Math.max(
          0,
          Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
        );
        if (inset === lastInset) return;
        lastInset = inset;
        target.style.setProperty('--phone-keyboard-inset', `${inset}px`);
        // 用 data 属性而不是 class，React 重新渲染 className 时不会把它冲掉。
        if (inset > 80) target.dataset.phoneKeyboard = 'open';
        else delete target.dataset.phoneKeyboard;
        onChange?.(inset);
      });
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('focusin', update);
    window.addEventListener('focusout', update);
    return () => {
      window.cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('focusin', update);
      window.removeEventListener('focusout', update);
      target.style.removeProperty('--phone-keyboard-inset');
      delete target.dataset.phoneKeyboard;
    };
  }, [enabled, onChange, targetRef]);
}
