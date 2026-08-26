'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ellipsis, Loader2, Pin, PinOff } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/notifications/client-toast';
import { backendJson } from '@/lib/utils/backend-api';

export function CommunityPostPinButton({
  communitySlug,
  postId,
  pinned,
}: {
  communitySlug: string;
  postId: string;
  pinned: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const togglePin = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await backendJson(
        `/api/communities/${encodeURIComponent(communitySlug)}/posts/${encodeURIComponent(
          postId,
        )}/pin`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinned: !pinned }),
          timeoutMs: 20_000,
        },
      );
      toast.success(pinned ? '已取消置顶' : '已置顶');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新置顶状态失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white"
          aria-label="帖子操作"
          title="帖子操作"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Ellipsis className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>管理操作</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={saving} onSelect={() => void togglePin()}>
          {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          {pinned ? '取消置顶' : '置顶帖子'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
