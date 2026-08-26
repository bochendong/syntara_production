'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/notifications/client-toast';
import { backendJson } from '@/lib/utils/backend-api';

export function CommunityJoinButton({
  communitySlug,
  isJoined,
  visibility,
}: {
  communitySlug: string;
  isJoined: boolean;
  visibility: string;
}) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);

  const join = async () => {
    if (joining) return;
    if (isJoined) {
      setJoining(true);
      try {
        await backendJson(`/api/communities/${encodeURIComponent(communitySlug)}/join`, {
          method: 'DELETE',
          timeoutMs: 20_000,
        });
        toast.success('已退出 community');
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '退出失败');
      } finally {
        setJoining(false);
      }
      return;
    }
    if (visibility !== 'public') {
      toast.error('Private community 需要邀请才能加入');
      return;
    }
    setJoining(true);
    try {
      await backendJson(`/api/communities/${encodeURIComponent(communitySlug)}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
        timeoutMs: 20_000,
      });
      toast.success('已加入 community');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加入失败');
    } finally {
      setJoining(false);
    }
  };

  return (
    <Button
      type="button"
      className="rounded-full bg-slate-950 px-6 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
      disabled={joining || (visibility !== 'public' && !isJoined)}
      onClick={join}
    >
      {joining ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
      {isJoined ? 'Joined' : 'Join'}
    </Button>
  );
}
