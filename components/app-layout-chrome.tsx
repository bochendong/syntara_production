'use client';

import type { ReactNode } from 'react';
import { Suspense, useState, useLayoutEffect } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  CHAT_RIGHT_RAIL_COLLAPSED_STORAGE_KEY,
  LEFT_RAIL_COLLAPSED_STORAGE_KEY,
} from '@/lib/constants/app-rail-storage';

const AppLeftRail = dynamic(
  () => import('@/components/app-left-rail').then((mod) => mod.AppLeftRail),
  { ssr: false },
);
const ChatRightRail = dynamic(
  () => import('@/components/chat-right-rail').then((mod) => mod.ChatRightRail),
  { ssr: false },
);
/** 侧栏 inset left-4 / right-4 各 16px；左侧导航略宽，右侧聊天栏保持紧凑。 */
const SIDEBAR_GAP = 12;
const LEFT_RAIL_EXPANDED_WIDTH = 280;
const RIGHT_RAIL_EXPANDED_WIDTH = 330;
const RAIL_COLLAPSED_WIDTH = 78;
const GLOBAL_HEADER_OFFSET_PX = 76;
const COMPACT_RAIL_BREAKPOINT_PX = 1024;
const COMPACT_PAGE_INSET_PX = 16;

function railOuterPaddingPx(collapsed: boolean, expandedWidth: number): number {
  const maxW = typeof window !== 'undefined' ? Math.max(0, window.innerWidth - 32) : expandedWidth;
  const w = collapsed ? RAIL_COLLAPSED_WIDTH : Math.min(expandedWidth, maxW);
  return 16 + w + SIDEBAR_GAP;
}

function shouldUseCompactRailLayout(hasRightRail: boolean): boolean {
  if (typeof window === 'undefined' || hasRightRail) return false;
  return window.innerWidth < COMPACT_RAIL_BREAKPOINT_PX;
}

function getInitialSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(LEFT_RAIL_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function getInitialChatRightCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(CHAT_RIGHT_RAIL_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function isTestSurface(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === '/test' ||
    pathname.startsWith('/test/') ||
    pathname === '/generation-quality' ||
    pathname === '/generation-tests' ||
    /^\/[^/]+-test(?:\/|$)/.test(pathname)
  );
}

function MainShellNoRail({
  children,
  balancedInset = false,
  edgeToEdge = false,
}: {
  children: ReactNode;
  balancedInset?: boolean;
  edgeToEdge?: boolean;
}) {
  return (
    <div
      className={cn(
        'fixed inset-0 box-border overflow-hidden',
        edgeToEdge ? 'p-0' : 'px-4',
        !edgeToEdge && (balancedInset ? 'py-4' : 'pt-4 pb-0'),
      )}
    >
      <div
        className={cn(
          'flex min-h-0 w-full min-w-0 flex-col gap-3',
          edgeToEdge ? 'h-dvh' : balancedInset ? 'h-[calc(100dvh-2rem)]' : 'h-[calc(100dvh-1rem)]',
        )}
      >
        <div
          className={cn(
            'min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto',
            !edgeToEdge && 'rounded-[20px]',
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function AppLayoutChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isLogin = pathname === '/login' || pathname?.startsWith('/login/');
  const isTeacherLogin =
    pathname === '/teacher/login' || Boolean(pathname?.startsWith('/teacher/login/'));
  const isSpeedupSignedOut = pathname === '/speedup/signed-out';
  const isTeacherPortal = pathname === '/teacher' || Boolean(pathname?.startsWith('/teacher/'));
  const isStudentPortal = pathname === '/student' || Boolean(pathname?.startsWith('/student/'));
  const isRegister = pathname === '/register' || pathname?.startsWith('/register/');
  const isLanding = pathname === '/';
  const isClassroom = pathname?.startsWith('/classroom/');
  const isAdmin = pathname?.startsWith('/admin');
  const isProfile = pathname === '/profile' || pathname?.startsWith('/profile/');
  const isSettings = pathname === '/settings' || pathname?.startsWith('/settings/');
  const isCalendar = pathname === '/calendar' || pathname?.startsWith('/calendar/');
  const isStore = pathname === '/store' || Boolean(pathname?.startsWith('/store/'));
  const isCommunitiesPage =
    pathname === '/communities' || Boolean(pathname?.startsWith('/communities/'));
  const isForumPage = pathname === '/forum' || Boolean(pathname?.startsWith('/forum/'));
  const isTestPage = isTestSurface(pathname);
  const isCsc148LocalPage = pathname === '/csc148' || Boolean(pathname?.startsWith('/csc148/'));
  const isCourseHome = pathname != null && /^\/course\/[^/]+\/?$/.test(pathname);
  const isCourseForum = pathname != null && /^\/course\/[^/]+\/forum(?:\/|$)/.test(pathname);
  const isCourseProblemDetail =
    pathname != null && /^\/course\/[^/]+\/problem-bank\/[^/]+\/?$/.test(pathname);
  const isCourseProblemBank =
    pathname != null && /^\/course\/[^/]+\/problem-bank(?:\/|$)/.test(pathname);
  const isCourseMemory = pathname != null && /^\/course\/[^/]+\/memory(?:\/|$)/.test(pathname);
  const isCourseResources =
    pathname != null && /^\/course\/[^/]+\/resources(?:\/|$)/.test(pathname);
  const isNotebookCreatePage =
    pathname != null && /^\/course\/[^/]+\/create-notebook(?:\/|$)/.test(pathname);
  const isReviewPage = pathname != null && /^\/review\/[^/]+(?:\/|$)/.test(pathname);
  const isLearnV2 =
    pathname === '/learn' ||
    Boolean(pathname?.startsWith('/learn/')) ||
    pathname === '/practice' ||
    Boolean(pathname?.startsWith('/practice/'));
  const isLearnHome =
    pathname === '/learn' &&
    !searchParams.has('courseId') &&
    !searchParams.has('sessionId') &&
    !searchParams.has('debugNoCourses');
  const isCreatorV2 = pathname === '/creator' || Boolean(pathname?.startsWith('/creator/'));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getInitialSidebarCollapsed);
  const [chatRightCollapsed, setChatRightCollapsed] = useState(getInitialChatRightCollapsed);

  const persistSidebarCollapsed = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    try {
      localStorage.setItem(LEFT_RAIL_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const persistChatRightCollapsed = (collapsed: boolean) => {
    setChatRightCollapsed(collapsed);
    try {
      localStorage.setItem(CHAT_RIGHT_RAIL_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  /** 独立聊天页使用右侧信息栏；创建笔记本页的设置已并入主工作台。 */
  const isChatPage = pathname === '/chat';
  const hasRightRail = isChatPage;
  const hasGlobalHeader = false;
  if (isLogin || isTeacherLogin || isSpeedupSignedOut || isRegister || isLanding) {
    return <>{children}</>;
  }

  if (isTeacherPortal) {
    return (
      <MainShellNoRail balancedInset edgeToEdge>
        {children}
      </MainShellNoRail>
    );
  }

  if (isStudentPortal) {
    return (
      <MainShellNoRail balancedInset edgeToEdge>
        {children}
      </MainShellNoRail>
    );
  }

  if (isReviewPage) {
    return <MainShellNoRail balancedInset>{children}</MainShellNoRail>;
  }

  if (isLearnV2) {
    return (
      <MainShellNoRail balancedInset edgeToEdge={isLearnHome}>
        {children}
      </MainShellNoRail>
    );
  }

  if (isCreatorV2) {
    return <MainShellNoRail balancedInset>{children}</MainShellNoRail>;
  }

  if (isStore) {
    return <MainShellNoRail balancedInset>{children}</MainShellNoRail>;
  }

  if (isCommunitiesPage) {
    return <MainShellNoRail edgeToEdge>{children}</MainShellNoRail>;
  }

  if (isForumPage) {
    return <MainShellNoRail edgeToEdge>{children}</MainShellNoRail>;
  }

  if (isTestPage) {
    return <MainShellNoRail balancedInset>{children}</MainShellNoRail>;
  }

  if (isCsc148LocalPage) {
    return <MainShellNoRail balancedInset>{children}</MainShellNoRail>;
  }

  if (isNotebookCreatePage) {
    return <MainShellNoRail balancedInset>{children}</MainShellNoRail>;
  }

  if (isCourseHome) {
    return <MainShellNoRail balancedInset>{children}</MainShellNoRail>;
  }

  if (isCourseForum) {
    return <MainShellNoRail edgeToEdge>{children}</MainShellNoRail>;
  }

  if (isCourseProblemDetail) {
    return <MainShellNoRail balancedInset>{children}</MainShellNoRail>;
  }

  if (isCourseProblemBank) {
    return <MainShellNoRail balancedInset>{children}</MainShellNoRail>;
  }

  if (isCourseMemory) {
    return <MainShellNoRail balancedInset>{children}</MainShellNoRail>;
  }

  if (isCourseResources) {
    return <MainShellNoRail balancedInset>{children}</MainShellNoRail>;
  }

  if (isProfile || isSettings || isCalendar) {
    return <MainShellNoRail balancedInset>{children}</MainShellNoRail>;
  }

  if (isAdmin) {
    return <MainShellNoRail>{children}</MainShellNoRail>;
  }

  if (isClassroom) {
    return <MainShellNoRail>{children}</MainShellNoRail>;
  }

  return (
    <>
      <AppLeftRail
        collapsed={sidebarCollapsed}
        hasGlobalHeader={hasGlobalHeader}
        hideBelowLg={!hasRightRail}
        onCollapsedChange={persistSidebarCollapsed}
      />
      <SidebarInset
        leftCollapsed={sidebarCollapsed}
        rightCollapsed={chatRightCollapsed}
        hasRightRail={hasRightRail}
        hasGlobalHeader={hasGlobalHeader}
        lockContentScroll={isChatPage}
      >
        {children}
      </SidebarInset>
      {hasRightRail ? (
        <Suspense fallback={null}>
          <ChatRightRail
            collapsed={chatRightCollapsed}
            hasGlobalHeader={hasGlobalHeader}
            onCollapsedChange={persistChatRightCollapsed}
            mode="chat"
          />
        </Suspense>
      ) : null}
    </>
  );
}

function SidebarInset({
  leftCollapsed,
  rightCollapsed,
  hasRightRail,
  hasGlobalHeader = true,
  lockContentScroll = false,
  children,
}: {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  hasRightRail: boolean;
  hasGlobalHeader?: boolean;
  lockContentScroll?: boolean;
  children: ReactNode;
}) {
  const [compactLayout, setCompactLayout] = useState(() =>
    shouldUseCompactRailLayout(hasRightRail),
  );
  const [padLeft, setPadLeft] = useState(() =>
    shouldUseCompactRailLayout(hasRightRail)
      ? COMPACT_PAGE_INSET_PX
      : railOuterPaddingPx(false, LEFT_RAIL_EXPANDED_WIDTH),
  );
  const [padRight, setPadRight] = useState(() => {
    if (shouldUseCompactRailLayout(hasRightRail)) return COMPACT_PAGE_INSET_PX;
    return hasRightRail ? railOuterPaddingPx(false, RIGHT_RAIL_EXPANDED_WIDTH) : 16;
  });

  useLayoutEffect(() => {
    const sync = () => {
      const compact = shouldUseCompactRailLayout(hasRightRail);
      setCompactLayout(compact);
      setPadLeft(
        compact
          ? COMPACT_PAGE_INSET_PX
          : railOuterPaddingPx(leftCollapsed, LEFT_RAIL_EXPANDED_WIDTH),
      );
      setPadRight(
        compact
          ? COMPACT_PAGE_INSET_PX
          : hasRightRail
            ? railOuterPaddingPx(rightCollapsed, RIGHT_RAIL_EXPANDED_WIDTH)
            : 16,
      );
    };
    sync();
    const frame = window.requestAnimationFrame(sync);
    const timer = window.setTimeout(sync, 120);
    window.addEventListener('resize', sync);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener('resize', sync);
    };
  }, [leftCollapsed, rightCollapsed, hasRightRail]);

  return (
    <div
      className={cn(
        'box-border pb-0 transition-[padding-left,padding-right] duration-300 ease-in-out',
        !hasRightRail && 'app-sidebar-inset-compactable',
        lockContentScroll ? 'h-dvh overflow-hidden' : 'min-h-dvh',
      )}
      style={{
        paddingLeft: padLeft,
        paddingRight: padRight,
        paddingTop: hasGlobalHeader || compactLayout ? GLOBAL_HEADER_OFFSET_PX : 16,
      }}
    >
      {/* 与侧栏一致：有全局 header 时从 header 下方开始；无 header 时回到普通页面 inset。 */}
      <div
        className="app-sidebar-inset-content flex w-full min-w-0 flex-col gap-3 overflow-hidden"
        style={{
          height: `calc(100dvh - ${hasGlobalHeader || compactLayout ? GLOBAL_HEADER_OFFSET_PX : 32}px)`,
        }}
      >
        <div
          className={cn(
            'min-h-0 w-full min-w-0 flex-1 overflow-x-hidden rounded-[20px]',
            lockContentScroll ? 'overflow-y-hidden' : 'overflow-y-auto',
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
