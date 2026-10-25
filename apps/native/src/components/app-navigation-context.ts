import { createContext, useContext } from 'react';
import type { LocalCourseSummary } from '../domain/models';

export type AppNavigationPage = 'chat' | 'calendar' | 'store' | 'settings';

/** 全局页面入口。宽屏放在左侧细导航栏，手机和窄窗口放进抽屉。 */
export type AppNavigation = {
  active: AppNavigationPage;
  avatarUrl?: string;
  onOpenCalendar: () => void;
  onOpenStore: () => void;
  onOpenSettings: () => void;
  /** 侧栏课程条目菜单里的编辑、删除。 */
  onManageCourse?: (course: LocalCourseSummary, action: 'edit' | 'delete') => void;
};

export const AppNavigationContext = createContext<AppNavigation | null>(null);

export function useAppNavigation() {
  return useContext(AppNavigationContext);
}
