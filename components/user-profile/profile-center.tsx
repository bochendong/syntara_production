'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, ChevronRight, Gauge, Palette, UserRound } from 'lucide-react';
import { useAuthStore } from '@/lib/store/auth';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { cn } from '@/lib/utils';
import { UserAvatarWithFrame } from './user-avatar-with-frame';
import { UserProfileCard } from './profile-card';
import { ProfileUsageCard } from './profile-usage-card';
import { NotificationCenterUsageCard } from './notification-center-usage-card';
import { ProfileLearningUsageStats } from './profile-learning-usage-stats';
import { ProfilePhoneEditor } from './profile-phone-editor';

type ProfileSection = 'account' | 'appearance' | 'usage';

const PROFILE_SECTIONS: Array<{
  id: ProfileSection;
  label: string;
  description: string;
  Icon: typeof UserRound;
  iconClassName: string;
}> = [
  {
    id: 'account',
    label: '个人资料',
    description: '昵称与个人简介',
    Icon: UserRound,
    iconClassName: 'bg-[#007aff]',
  },
  {
    id: 'appearance',
    label: '头像与外观',
    description: '头像和头像框',
    Icon: Palette,
    iconClassName: 'bg-[#af52de]',
  },
  {
    id: 'usage',
    label: '用量统计',
    description: 'Credits、Token 与学习资产',
    Icon: Gauge,
    iconClassName: 'bg-[#34c759]',
  },
];

export function ProfileCenter() {
  const [activeSection, setActiveSection] = useState<ProfileSection>('account');
  const authName = useAuthStore((state) => state.name);
  const email = useAuthStore((state) => state.email);
  const avatar = useUserProfileStore((state) => state.avatar);
  const avatarFrameId = useUserProfileStore((state) => state.avatarFrameId);
  const nickname = useUserProfileStore((state) => state.nickname);
  const displayName = nickname || authName || '学习者';
  const active = PROFILE_SECTIONS.find((item) => item.id === activeSection) || PROFILE_SECTIONS[0];

  return (
    <div className="flex h-full min-h-[680px] w-full overflow-hidden bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.06)] max-[860px]:flex-col">
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-slate-200 bg-slate-50 p-[22px] max-[860px]:w-full max-[860px]:border-b max-[860px]:border-r-0 max-[860px]:p-4">
        <Link
          href="/learn"
          className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-[7px] text-xs font-semibold text-slate-950 hover:bg-slate-50"
        >
          <ArrowLeft className="size-4" />
          返回主屏
        </Link>

        <div className="mt-7 grid justify-items-center gap-2 text-center max-[860px]:mt-4">
          <div className="grid place-items-center">
            <UserAvatarWithFrame
              src={avatar}
              frameId={avatarFrameId}
              className="size-[86px] bg-slate-100 shadow-[0_10px_28px_rgba(15,23,42,0.12)]"
              imgClassName=""
              role="img"
              aria-label={`${displayName}的头像`}
            />
          </div>
          <strong className="max-w-full truncate text-lg font-bold text-slate-950">
            {displayName}
          </strong>
          <small className="max-w-full truncate text-xs text-slate-500">
            {email || '本地学习账户'}
          </small>
        </div>

        <ProfileLearningUsageStats />

        <nav
          className="mt-5 grid gap-1.5 max-[860px]:mt-4 max-[860px]:grid-cols-3"
          aria-label="个人中心分区"
        >
          {PROFILE_SECTIONS.map(({ id, label, description, Icon, iconClassName }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2.5 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-sky-500',
                activeSection === id
                  ? 'border-sky-200 bg-white shadow-sm'
                  : 'border-transparent hover:bg-white/70',
              )}
              aria-current={activeSection === id ? 'page' : undefined}
            >
              <span
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-[8px] text-white shadow-sm',
                  iconClassName,
                )}
              >
                <Icon className="size-4" strokeWidth={2} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-slate-800">{label}</span>
                <span className="block truncate text-[10px] text-slate-500 max-[860px]:hidden">
                  {description}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
            </button>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto bg-white">
        <header className="sticky top-0 z-10 flex min-h-[78px] items-center justify-between border-b border-slate-200 bg-white/95 px-7 py-4 backdrop-blur">
          <div>
            <p className="text-[11px] font-bold text-slate-400">个人中心</p>
            <h2 className="mt-0.5 text-2xl font-bold tracking-[-0.02em] text-slate-950">
              {active.label}
            </h2>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-[11px] bg-slate-900 px-3.5 py-2.5 text-xs font-bold text-white">
            <Check className="size-[15px]" />
            自动保存
          </span>
        </header>

        <div className="mx-auto w-full max-w-4xl px-5 pb-12 pt-7 sm:px-7 lg:px-10">
          <header className="mb-5">
            <p className="text-xs font-semibold text-sky-600">{active.description}</p>
          </header>

          {activeSection === 'account' ? (
            <div className="space-y-5">
              <UserProfileCard
                showAvatar={false}
                className="rounded-xl border border-slate-200 bg-white shadow-sm backdrop-blur-none"
              />
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-6 px-4 py-3.5 text-sm">
                  <span className="font-medium text-slate-800">账户邮箱</span>
                  <span className="truncate text-slate-500">{email || '未绑定邮箱'}</span>
                </div>
                <ProfilePhoneEditor />
                {[
                  ['资料同步', '当前账户'],
                  ['隐私状态', '完整手机号仅自己可见'],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-6 border-t border-slate-100 px-4 py-3.5 text-sm"
                  >
                    <span className="font-medium text-slate-800">{label}</span>
                    <span className="truncate text-slate-500">{value}</span>
                  </div>
                ))}
              </section>
            </div>
          ) : null}

          {activeSection === 'appearance' ? (
            <ProfileUsageCard className="rounded-xl border border-slate-200 bg-white shadow-sm backdrop-blur-none" />
          ) : null}

          {activeSection === 'usage' ? (
            <NotificationCenterUsageCard className="rounded-xl border border-slate-200 bg-white shadow-sm backdrop-blur-none" />
          ) : null}
        </div>
      </main>
    </div>
  );
}
