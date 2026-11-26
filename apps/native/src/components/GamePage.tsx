import { useEffect, useRef } from 'react';
import { ChevronLeft } from 'lucide-react';
import { withAppBase } from '../data/app-base';
import { browserAccountId, browserApp } from '../data/browser-runtime';
import './game-page.css';

/**
 * 「游戏」页：沙盒期末战。游戏是一个独立的 three.js 页面（public/games/sandbox-brawl），
 * 用 iframe 整页嵌进来，自己管存档（localStorage）。离开页面时 iframe 卸载，这一局就结束了。
 */
export function GamePage({
  onBack,
  onOpenPractice,
}: {
  onBack?: () => void;
  /** 游戏里积分不够时点「去做题」：回 App 的题库。 */
  onOpenPractice?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!onOpenPractice) return;
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.origin !== location.origin) return;
      if ((event.data as { type?: unknown } | null)?.type === 'sandbox-brawl:open-practice')
        onOpenPractice();
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [onOpenPractice]);
  const gameUrl = withAppBase('/games/sandbox-brawl/index.html');
  const source = browserApp
    ? `${gameUrl}?account=${encodeURIComponent(browserAccountId())}`
    : gameUrl;
  return (
    <section className="game-page" aria-label="游戏：沙盒期末战">
      {onBack ? (
        <div className="game-page-controls">
          <button type="button" className="game-page-back" onClick={onBack} aria-label="返回">
            <ChevronLeft size={20} strokeWidth={2} aria-hidden />
          </button>
        </div>
      ) : null}
      <iframe
        ref={frame}
        className="game-page-frame"
        title="沙盒期末战"
        src={source}
        allow="autoplay; fullscreen; gamepad"
        allowFullScreen
      />
    </section>
  );
}
