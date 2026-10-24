import { createContext, useContext } from 'react';

export type AppNavigationPage = 'chat' | 'calendar' | 'store' | 'settings';

/** 全局页面入口。宽屏放在左侧细导航栏，手机和窄窗口放进抽屉。 */
export type AppNavigation = {
  active: AppNavigationPage;
  avatarUrl?: string;
  onOpenCalendar: () => void;
  onOpenStore: () => void;
  onOpenSettings: () => void;
};

export const AppNavigationContext = createContext<AppNavigation | null>(null);

export function useAppNavigation() {
  return useContext(AppNavigationContext);
}
