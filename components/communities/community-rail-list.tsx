'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Compass, Loader2, Plus, UsersRound } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { backendJson } from '@/lib/utils/backend-api';
import { cn } from '@/lib/utils';

type CommunityRailItem = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  role: string;
  memberCount: number;
  postCount: number;
};

type CommunitiesResponse = {
  communities: CommunityRailItem[];
};

function initials(name: string) {
  const compact = name.trim();
  return compact.slice(0, 2).toUpperCase() || '社';
}

export function CommunityRailList({
  collapsed,
  blackSurface,
}: {
  collapsed: boolean;
  blackSurface: boolean;
}) {
  const pathname = usePathname();
  const [communities, setCommunities] = useState<CommunityRailItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    backendJson<CommunitiesResponse>('/api/communities', { timeoutMs: 20_000 })
      .then((payload) => {
        if (!cancelled) setCommunities(payload.communities);
      })
      .catch(() => {
        if (!cancelled) setCommunities([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeBase = blackSurface
    ? 'bg-violet-400/12 text-violet-100 shadow-[inset_2px_0_0_rgba(196,181,253,0.7)]'
    : 'bg-violet-50/80 text-violet-800 shadow-[inset_2px_0_0_rgba(124,58,237,0.5)] dark:bg-violet-400/10 dark:text-violet-100';
  const itemBase = blackSurface
    ? 'text-white/76 hover:bg-white/[0.07] hover:text-white'
    : 'text-slate-700/90 hover:bg-slate-900/[0.04] hover:text-slate-950 dark:text-white/76 dark:hover:bg-white/[0.07] dark:hover:text-white';

  if (collapsed) {
    return (
      <div className="mt-2 flex flex-col gap-1 border-t border-white/10 pt-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/communities"
              className={cn('flex size-9 items-center justify-center rounded-[11px]', itemBase)}
              aria-label="Communities"
            >
              <Compass className="size-[18px]" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">Communities</TooltipContent>
        </Tooltip>
        {communities.slice(0, 6).map((community) => {
          const href = `/communities/${encodeURIComponent(community.slug)}`;
          const active = pathname === href;
          return (
            <Tooltip key={community.id}>
              <TooltipTrigger asChild>
                <Link
                  href={href}
                  className={cn(
                    'grid size-9 place-items-center rounded-[11px] transition',
                    active ? activeBase : itemBase,
                  )}
                  aria-label={community.name}
                >
                  <Avatar className="size-6">
                    {community.avatarUrl ? (
                      <AvatarImage src={community.avatarUrl} alt={community.name} />
                    ) : null}
                    <AvatarFallback className="text-[10px]">
                      {initials(community.name)}
                    </AvatarFallback>
                  </Avatar>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{community.name}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  return (
    <section
      className={cn(
        'mt-2 rounded-[16px] border px-2 py-2',
        blackSurface
          ? 'border-white/10 bg-white/[0.04]'
          : 'border-black/[0.04] bg-black/[0.02] dark:border-white/[0.06] dark:bg-white/[0.03]',
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-2 px-2 pb-1.5 pt-0.5 text-[11px] font-semibold tracking-[0.08em]',
          blackSurface ? 'text-zinc-500' : 'text-muted-foreground/90',
        )}
      >
        <span>COMMUNITIES</span>
        <Link
          href="/communities"
          className={cn(
            'grid size-6 place-items-center rounded-lg opacity-70 transition hover:opacity-100',
            blackSurface ? 'hover:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/10',
          )}
          title="新建 Community"
          aria-label="新建 community"
        >
          <Plus className="size-3.5" />
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 px-2 py-2 text-xs text-slate-400">
          <Loader2 className="size-3 animate-spin" />
          加载 community…
        </div>
      ) : communities.length ? (
        <ul className="space-y-0.5">
          {communities.map((community) => {
            const href = `/communities/${encodeURIComponent(community.slug)}`;
            const active = pathname === href;
            return (
              <li key={community.id}>
                <Link
                  href={href}
                  className={cn(
                    'flex min-h-10 items-center gap-2 rounded-[11px] px-2 py-1.5 text-xs transition',
                    active ? activeBase : itemBase,
                  )}
                >
                  <Avatar className="size-7">
                    {community.avatarUrl ? (
                      <AvatarImage src={community.avatarUrl} alt={community.name} />
                    ) : null}
                    <AvatarFallback className="text-[10px]">
                      {initials(community.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">c/{community.name}</span>
                    <span className="block truncate text-[10px] opacity-60">
                      {community.memberCount} members
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-2 py-2 text-xs text-slate-400">
          <UsersRound className="mb-1 size-4 opacity-70" />
          暂无已加入 community
        </div>
      )}
    </section>
  );
}
