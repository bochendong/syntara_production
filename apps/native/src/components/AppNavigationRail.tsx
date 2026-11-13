import { useState } from 'react';
import {
  CalendarDays,
  Gamepad2,
  GraduationCap,
  Home,
  Radio,
  ShieldCheck,
  UserRound,
  Store,
} from 'lucide-react';
import { nativeAccountAvatarUrl } from '../assets';
import type { AppNavigation } from './app-navigation-context';
import './app-navigation-rail.css';

export function AppNavigationRail({
  active,
  avatarUrl,
  onOpenChat,
  onOpenCalendar,
  onOpenStore,
  onOpenGame,
  onOpenSettings,
  onOpenClassroom,
  onOpenTeach,
  onOpenAdmin,
}: AppNavigation & { onOpenChat: () => void }) {
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const image = avatarUrl || nativeAccountAvatarUrl(null, null);
  return (
    <nav className="app-navigation-rail" aria-label="全局导航">
      <button
        type="button"
        aria-label="首页"
        title="首页"
        aria-current={active === 'chat' ? 'page' : undefined}
        onClick={onOpenChat}
      >
        <Home size={22} strokeWidth={1.7} aria-hidden />
        <span className="app-navigation-label">首页</span>
      </button>
      <button
        type="button"
        aria-label="课程商城"
        title="课程商城"
        data-onboarding="store"
        aria-current={active === 'store' ? 'page' : undefined}
        onClick={onOpenStore}
      >
        <Store size={22} strokeWidth={1.7} aria-hidden />
        <span className="app-navigation-label">商城</span>
      </button>
      <button
        type="button"
        aria-label="总日历"
        title="总日历"
        aria-current={active === 'calendar' ? 'page' : undefined}
        onClick={onOpenCalendar}
      >
        <CalendarDays size={22} strokeWidth={1.7} aria-hidden />
        <span className="app-navigation-label">日历</span>
      </button>
      {onOpenGame ? (
        <button
          type="button"
          aria-label="游戏"
          title="游戏：沙盒期末战"
          aria-current={active === 'game' ? 'page' : undefined}
          onClick={onOpenGame}
        >
          <Gamepad2 size={22} strokeWidth={1.7} aria-hidden />
          <span className="app-navigation-label">游戏</span>
        </button>
      ) : null}
      {onOpenTeach ? (
        <button
          type="button"
          aria-label="教学"
          title="教学：课程管理"
          aria-current={active === 'teach' ? 'page' : undefined}
          onClick={onOpenTeach}
        >
          <GraduationCap size={22} strokeWidth={1.7} aria-hidden />
          <span className="app-navigation-label">教学</span>
        </button>
      ) : null}
      {onOpenClassroom ? (
        <button
          type="button"
          aria-label="上课"
          title="上课和加入课堂"
          aria-current={active === 'classroom' ? 'page' : undefined}
          onClick={onOpenClassroom}
        >
          <Radio size={22} strokeWidth={1.7} aria-hidden />
          <span className="app-navigation-label">上课</span>
        </button>
      ) : null}
      {onOpenAdmin ? (
        <button
          type="button"
          aria-label="管理"
          title="管理：全站模型、Key、账号和用量"
          aria-current={active === 'admin' ? 'page' : undefined}
          onClick={onOpenAdmin}
        >
          <ShieldCheck size={22} strokeWidth={1.7} aria-hidden />
          <span className="app-navigation-label">管理</span>
        </button>
      ) : null}
      <button
        type="button"
        className="app-navigation-settings"
        aria-label="设置"
        title="设置"
        aria-current={active === 'settings' ? 'page' : undefined}
        onClick={onOpenSettings}
      >
        <span className="app-navigation-avatar" aria-hidden>
          {image && failedAvatar !== image ? (
            <img src={image} alt="" onError={() => setFailedAvatar(image)} />
          ) : (
            <UserRound size={20} strokeWidth={1.7} />
          )}
        </span>
      </button>
    </nav>
  );
}
