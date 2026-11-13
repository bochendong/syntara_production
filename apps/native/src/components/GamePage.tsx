import { ChevronLeft } from 'lucide-react';
import { withAppBase } from '../data/app-base';
import './game-page.css';

/**
 * 「游戏」页：沙盒期末战。游戏是一个独立的 three.js 页面（public/games/sandbox-brawl），
 * 用 iframe 整页嵌进来，自己管存档（localStorage）。离开页面时 iframe 卸载，这一局就结束了。
 */
export function GamePage({ onBack }: { onBack: () => void }) {
  return (
    <section className="game-page" aria-label="游戏：沙盒期末战">
      <header className="game-page-bar">
        <button type="button" className="game-page-back" onClick={onBack} aria-label="返回">
          <ChevronLeft size={20} strokeWidth={2} aria-hidden />
        </button>
        <h1>沙盒期末战</h1>
      </header>
      <iframe
        className="game-page-frame"
        title="沙盒期末战"
        src={withAppBase('/games/sandbox-brawl/index.html')}
        allow="fullscreen; gamepad"
        allowFullScreen
      />
    </section>
  );
}
