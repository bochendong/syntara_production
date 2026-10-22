'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  USER_AVATAR_FRAME_OPTIONS,
  type UserAvatarFrameId,
} from '@/lib/constants/user-avatar-frames';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { UserAvatarWithFrame } from './user-avatar-with-frame';

/** All avatar frames are available without purchases or growth-level checks. */
export function ProfileAvatarFramePicker() {
  const avatar = useUserProfileStore((state) => state.avatar);
  const avatarFrameId = useUserProfileStore((state) => state.avatarFrameId);
  const setAvatarFrameId = useUserProfileStore((state) => state.setAvatarFrameId);
  const [draft, setDraft] = useState<UserAvatarFrameId | null>(null);
  const selected = draft ?? avatarFrameId;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm font-medium text-foreground">预览</p>
        <UserAvatarWithFrame
          src={avatar}
          frameId={selected}
          className="size-24 sm:size-28"
          imgClassName="ring-1 ring-black/5 dark:ring-white/10"
          role="img"
          aria-label="头像框预览"
        />
        <p className="text-center text-xs text-muted-foreground">
          所有头像框均可直接选择，点击「应用」后保存。
        </p>
      </div>
      <ul className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {USER_AVATAR_FRAME_OPTIONS.map((option) => (
          <li key={option.id} className="min-w-0">
            <button
              type="button"
              onClick={() => setDraft(option.id)}
              className={cn(
                'flex w-full min-w-0 flex-col items-center gap-2 rounded-2xl border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
                selected === option.id
                  ? 'border-violet-400/80 bg-violet-500/8 dark:border-violet-400/50'
                  : 'border-border/60 bg-muted/30 hover:border-border',
              )}
              aria-pressed={selected === option.id}
              aria-label={`选择头像框：${option.label}`}
            >
              <UserAvatarWithFrame
                src={avatar}
                frameId={option.id}
                className="size-14"
                imgClassName="ring-1 ring-black/5 dark:ring-white/10"
              />
              <span className="w-full truncate text-center text-xs font-medium text-foreground">
                {option.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={selected === avatarFrameId}
          onClick={() => {
            setAvatarFrameId(selected);
            setDraft(null);
          }}
        >
          应用
        </Button>
      </div>
    </div>
  );
}
