import { useState } from 'react';
import { CalendarDays, Home, Radio, UserRound, Store } from 'lucide-react';
import { nativeAccountAvatarUrl } from '../assets';
import type { AppNavigation } from './app-navigation-context';
import './app-navigation-rail.css';

export function AppNavigationRail({
  active,
  avatarUrl,
  onOpenChat,
  onOpenCalendar,
  onOpenStore,
  onOpenSettings,
  onOpenClassroom,
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
      {onOpenClassroom ? (
        <button
          type="button"
          aria-label="进入课堂"
          title="输课堂码进入课堂"
          onClick={onOpenClassroom}
        >
          <Radio size={22} strokeWidth={1.7} aria-hidden />
          <span className="app-navigation-label">上课</span>
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
