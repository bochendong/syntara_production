'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { SessionProvider, useSession } from 'next-auth/react';
import { usePersistHydrated } from '@/lib/hooks/use-persist-hydrated';
import { useAuthStore } from '@/lib/store/auth';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { backendJson } from '@/lib/utils/backend-api';

function AuthSessionSync() {
  const { data: session, status } = useSession();
  const authHydrated = usePersistHydrated(useAuthStore);
  const syncFromOAuth = useAuthStore((s) => s.syncFromOAuth);
  const logout = useAuthStore((s) => s.logout);
  const profileHydrated = usePersistHydrated(useUserProfileStore);
  const userId = session?.user?.id;

  useEffect(() => {
    if (
      !authHydrated ||
      !profileHydrated ||
      status !== 'authenticated' ||
      !userId ||
      userId.startsWith('local-demo-')
    )
      return;
    const before = useUserProfileStore.getState();
    const controller = new AbortController();
    void backendJson<{ id: string; name: string | null }>('/api/me', { signal: controller.signal })
      .then((profile) => {
        if (controller.signal.aborted || useAuthStore.getState().userId !== profile.id) return;
        const current = useUserProfileStore.getState();
        // A slower initial read must not overwrite a name saved in the meantime.
        if (
          current.nickname !== before.nickname ||
          current.nicknameOwnerId !== before.nicknameOwnerId
        )
          return;
        current.setAccountNickname(profile.id, profile.name || '');
        useAuthStore.setState({ name: profile.name || '' });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [authHydrated, profileHydrated, status, userId]);

  useEffect(() => {
    if (!authHydrated || status === 'loading') return;
    if (session?.user?.id) {
      syncFromOAuth({
        userId: session.user.id,
        name: session.user.name?.trim() ?? '',
        email: session.user.email?.trim().toLowerCase() ?? '',
        role: session.user.role ?? 'USER',
      });
    } else if (status === 'unauthenticated') {
      logout();
    }
  }, [authHydrated, session, status, syncFromOAuth, logout]);

  return null;
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AuthSessionSync />
      {children}
    </SessionProvider>
  );
}
