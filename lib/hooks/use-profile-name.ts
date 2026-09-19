'use client';

import { useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useAuthStore } from '@/lib/store/auth';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { backendJson } from '@/lib/utils/backend-api';

export function useProfileName() {
  const { status, data: session, update } = useSession();
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  async function saveName(value: string): Promise<boolean> {
    if (inFlight.current || status === 'loading') return false;
    const name = value.trim();
    if (!name || name.length > 60) throw new Error('姓名应为 1–60 个字符。');
    inFlight.current = true;
    setSaving(true);
    try {
      if (status === 'authenticated' && !session?.user?.id.startsWith('local-demo-')) {
        const profile = await backendJson<{ id: string; name: string }>('/api/me', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        // Publish only the value the server actually saved.
        if (useAuthStore.getState().userId !== profile.id) return false;
        useUserProfileStore.getState().setAccountNickname(profile.id, profile.name);
        useAuthStore.setState({ name: profile.name });
        await update().catch(() => undefined);
      } else if (session?.user?.id.startsWith('local-demo-')) {
        useUserProfileStore.getState().setNickname(name);
      } else {
        throw new Error('登录已失效，请重新登录后保存姓名。');
      }
      return true;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return { saveName, saving: saving || status === 'loading' };
}
