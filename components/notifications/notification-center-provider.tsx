'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth';
import { useNotificationStore } from '@/lib/store/notifications';

const GlobalNotificationOverlay = dynamic(
  () =>
    import('@/components/notifications/global-notification-overlay').then(
      (mod) => mod.GlobalNotificationOverlay,
    ),
  { ssr: false },
);

function shouldSuppressNotificationCenter(pathname: string | null): boolean {
  return Boolean(
    pathname === '/' ||
    pathname === '/test' ||
    pathname?.startsWith('/test/') ||
    pathname === '/generation-tests' ||
    pathname === '/generation-quality' ||
    /^\/[^/]+-test(?:\/|$)/.test(pathname || '') ||
    pathname === '/login' ||
    pathname?.startsWith('/login/') ||
    pathname === '/register' ||
    pathname?.startsWith('/register/') ||
    pathname === '/live2d' ||
    pathname?.startsWith('/live2d/'),
  );
}

export function NotificationCenterProvider() {
  const pathname = usePathname();
  const suppressNotificationCenter = shouldSuppressNotificationCenter(pathname);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const userId = useAuthStore((state) => state.userId);
  const clearSession = useNotificationStore((state) => state.clearSession);
  const refreshNotifications = useNotificationStore((state) => state.refreshNotifications);
  const setActiveUser = useNotificationStore((state) => state.setActiveUser);
  const activeBannerCount = useNotificationStore((state) => state.activeBanners.length);

  useEffect(() => {
    if (suppressNotificationCenter) return;
    const normalizedUserId = userId.trim();

    if (!isLoggedIn || !normalizedUserId) {
      clearSession();
      return;
    }

    setActiveUser(normalizedUserId);
    void refreshNotifications({ userId: normalizedUserId });
  }, [
    clearSession,
    isLoggedIn,
    refreshNotifications,
    setActiveUser,
    suppressNotificationCenter,
    userId,
  ]);

  if (suppressNotificationCenter || activeBannerCount === 0) return null;

  return <GlobalNotificationOverlay />;
}
