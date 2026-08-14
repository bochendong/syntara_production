'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useAuthStore } from '@/lib/store/auth';

/** 结束 NextAuth 会话并清空本地 auth store，提示用户返回 Speedup 重新登录。 */
export function useAuthSignOut() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);

  return useCallback(async () => {
    await signOut({ redirect: false });
    logout();
    router.replace('/speedup/signed-out');
  }, [logout, router]);
}
