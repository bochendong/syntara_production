import Link from 'next/link';
import { ArrowLeft, UsersRound } from 'lucide-react';
import { CommunityCreateDialog } from '@/components/communities/community-create-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

function initials(name: string) {
  const compact = name.trim();
  return compact.slice(0, 2).toUpperCase() || '社';
}

export default async function CommunitiesPage() {
  const auth = await requireUserId({ ensureFallbackUser: false });
  if (auth.response) {
    return (
      <main className="grid min-h-dvh place-items-center bg-slate-50 p-6 text-center dark:bg-slate-950">
        <div>
          <h1 className="text-2xl font-semibold">请先登录</h1>
          <p className="mt-2 text-sm text-slate-500">登录后可以查看你加入的 community。</p>
        </div>
      </main>
    );
  }

  const memberships = await prisma.communityMember.findMany({
    where: { userId: auth.userId },
    orderBy: { joinedAt: 'desc' },
    select: {
      role: true,
      joinedAt: true,
      community: {
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          avatarUrl: true,
          _count: { select: { members: true, posts: true } },
        },
      },
    },
  });

  return (
    <main className="min-h-dvh bg-slate-50 p-4 text-slate-950 dark:bg-slate-950 dark:text-white">
      <div className="mx-auto max-w-5xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-slate-950 sm:p-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Button asChild variant="ghost" size="icon" className="mt-1 rounded-full">
              <Link href="/forum" aria-label="返回论坛">
                <ArrowLeft className="size-5" />
              </Link>
            </Button>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                Communities
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">我的 Community</h1>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                查看已加入的 community，也可以创建新的公开或私密 community。
              </p>
            </div>
          </div>
          <CommunityCreateDialog />
        </header>

        <section className="mt-6">
          {memberships.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {memberships.map(({ community, role }) => (
                <Link
                  key={community.id}
                  href={`/communities/${encodeURIComponent(community.slug)}`}
                  className="group rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-violet-200 hover:bg-violet-50/50 dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-violet-400/10"
                >
                  <div className="flex items-start gap-3">
                    <Avatar className="size-12">
                      {community.avatarUrl ? (
                        <AvatarImage src={community.avatarUrl} alt={community.name} />
                      ) : null}
                      <AvatarFallback className="bg-violet-100 font-semibold text-violet-700">
                        {initials(community.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate font-semibold group-hover:text-violet-700 dark:group-hover:text-violet-200">
                          c/{community.name}
                        </h2>
                        <Badge variant="outline" className="text-[10px]">
                          {role}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        {community.description || '这个 community 还没有介绍。'}
                      </p>
                      <div className="mt-3 flex gap-3 text-xs text-slate-400">
                        <span>{community._count.members} members</span>
                        <span>{community._count.posts} posts</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-400">
              <div>
                <UsersRound className="mx-auto size-8 text-slate-300" />
                <p className="mt-3">你还没有加入任何 community。</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
