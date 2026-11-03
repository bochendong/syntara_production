import { createContext, useContext } from 'react';
import type { LocalCourseSummary } from '../domain/models';

export type AppNavigationPage =
  | 'chat'
  | 'calendar'
  | 'store'
  | 'teach'
  | 'classroom'
  | 'admin'
  | 'settings';

/** 全局页面入口。宽屏放在左侧细导航栏，手机和窄窗口放进抽屉。 */
export type AppNavigation = {
  active: AppNavigationPage;
  avatarUrl?: string;
  onOpenCalendar: () => void;
  onOpenStore: () => void;
  onOpenSettings: () => void;
  /** 输课堂码 / 班级码。手机上没有（undefined）。 */
  onOpenClassroom?: () => void;
  /** 老师的「教学」页。不能开班的账号和手机上没有（undefined）。 */
  onOpenTeach?: () => void;
  /** 测试服管理员控制台。只有管理员账号有。 */
  onOpenAdmin?: () => void;
  /** 侧栏课程条目菜单里的编辑、删除。 */
  onManageCourse?: (course: LocalCourseSummary, action: 'edit' | 'delete' | 'publish') => void;
};

export const AppNavigationContext = createContext<AppNavigation | null>(null);

export function useAppNavigation() {
  return useContext(AppNavigationContext);
}
