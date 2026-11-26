import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Gamepad2, Gift, Sparkles } from 'lucide-react';
import { marbleImages } from '../../lib/learning-action-marbles';
import {
  gameDrawProgress,
  type PracticeGameBanner,
  type PracticeGameReward,
} from '../../lib/practice-game-notify';
import './practice-game-notice.css';

const BANNER_MS = 6_000;

/**
 * 做题页顶部的游戏积分条。`gain` 变了就从题目那边飞来一个「+N」。
 */
export function PracticeGamePoints({
  total,
  gain,
  onOpen,
}: {
  total: number;
  gain: { id: number; points: number } | null;
  onOpen: () => void;
}) {
  const progress = gameDrawProgress(total);
  return (
    <button
      type="button"
      className={`pg-points${gain ? ' is-bumped' : ''}`}
      key={gain?.id ?? 0}
      onClick={onOpen}
      title={`游戏积分 ${progress.total} · ${progress.label}`}
      aria-label={`游戏积分 ${progress.total}，${progress.label}，去游戏`}
    >
      <img src={marbleImages.amber} alt="" aria-hidden="true" />
      <span className="pg-points-main">
        <b>{progress.total}</b>
        <span className="pg-points-bar" aria-hidden="true">
          <i style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
        </span>
      </span>
      <small className="pg-points-label">{progress.label}</small>
      {gain ? (
        <span className="pg-points-gain" aria-live="polite">
          +{gain.points}
        </span>
      ) : null}
    </button>
  );
}

/** 够抽了、十连、免费单抽到账：顶部滑下来一条，过几秒自己收起。 */
export function PracticeGameBannerCard({
  banner,
  onPlay,
  onLater,
}: {
  banner: PracticeGameBanner;
  onPlay: () => void;
  onLater: () => void;
}) {
  const later = useRef(onLater);
  useEffect(() => {
    later.current = onLater;
  });
  // 换一条横幅才重新计时。
  useEffect(() => {
    const timer = window.setTimeout(() => later.current(), BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [banner.key]);
  const Icon = banner.kind === 'free' ? Sparkles : Gamepad2;
  return (
    <div className={`pg-banner is-${banner.kind}`} role="status">
      <span className="pg-banner-marble" aria-hidden="true">
        <img src={marbleImages[banner.kind === 'free' ? 'pink' : 'amber']} alt="" />
        <Icon size={15} strokeWidth={2.2} />
      </span>
      <span className="pg-banner-text">
        <b>{banner.title}</b>
        <small>{banner.detail}</small>
      </span>
      <span className="pg-banner-actions">
        <button type="button" className="pg-banner-go" onClick={onPlay}>
          去游戏
        </button>
        <button type="button" className="pg-banner-later" onClick={onLater}>
          做完这组再去
        </button>
      </span>
    </div>
  );
}

/** 连续学习刚满 3 / 7 / 14 天：居中弹出，告诉学生解锁了什么。 */
export function PracticeGameRewardDialog({
  reward,
  streak,
  onPlay,
  onClose,
}: {
  reward: PracticeGameReward;
  streak: number;
  onPlay: () => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setShown(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return createPortal(
    <div className={`pg-reward-backdrop${shown ? ' is-shown' : ''}`} role="presentation">
      <div className="pg-reward" role="dialog" aria-modal="true" aria-labelledby="pg-reward-title">
        <span className="pg-reward-eyebrow">连续学习 {Math.max(streak, reward.days)} 天</span>
        <span className="pg-reward-marble" aria-hidden="true">
          <img src={marbleImages.amber} alt="" />
          <Gift size={30} strokeWidth={2} />
        </span>
        <h2 id="pg-reward-title">{reward.name}</h2>
        <p>{reward.label}已解锁，去游戏里就能用</p>
        <button type="button" className="pg-reward-go" onClick={onPlay} autoFocus>
          去游戏里领
        </button>
        <button type="button" className="pg-reward-later" onClick={onClose}>
          先接着做题
        </button>
      </div>
    </div>,
    document.body,
  );
}
