'use client';

import { useState } from 'react';
import { ChevronRight, Gauge, Palette, UserRound } from 'lucide-react';
import { useAuthStore } from '@/lib/store/auth';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { cn } from '@/lib/utils';
import { UserAvatarWithFrame } from './user-avatar-with-frame';
import { UserProfileCard } from './profile-card';
import { ProfileUsageCard } from './profile-usage-card';
import { NotificationCenterUsageCard } from './notification-center-usage-card';

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
    label: '额度与用量',
    description: 'Credits 与 Token',
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
    <div className="ipados-profile flex h-full min-h-[680px] w-full overflow-hidden rounded-[22px] border border-black/[0.08] bg-white shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
      <aside className="w-[286px] shrink-0 border-r border-black/[0.09] bg-[#f2f2f7] px-4 py-5 max-md:w-[230px] max-sm:hidden">
        <h1 className="px-2 text-2xl font-bold tracking-[-0.04em] text-slate-950">个人中心</h1>

        <div className="mt-4 rounded-[15px] bg-white p-3 shadow-sm ring-1 ring-black/[0.04]">
          <div className="flex items-center gap-3">
            <UserAvatarWithFrame
              src={avatar}
              frameId={avatarFrameId}
              className="size-14 bg-slate-100"
              imgClassName=""
              role="img"
              aria-label={`${displayName}的头像`}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-slate-950">{displayName}</p>
              <p className="mt-0.5 truncate text-xs text-slate-500">{email || '本地学习账户'}</p>
            </div>
          </div>
        </div>

        <nav className="mt-5 space-y-1" aria-label="个人中心分区">
          {PROFILE_SECTIONS.map(({ id, label, description, Icon, iconClassName }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-[11px] px-2 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500',
                activeSection === id ? 'bg-black/[0.08]' : 'hover:bg-black/[0.04]',
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
                <span className="block truncate text-sm font-semibold text-slate-800">{label}</span>
                <span className="block truncate text-[11px] text-slate-500">{description}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
            </button>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto bg-[#f2f2f7]">
        <div className="mx-auto w-full max-w-5xl px-5 pb-12 pt-7 sm:px-7 lg:px-10">
          <div className="mb-5 hidden max-sm:block">
            <h1 className="text-3xl font-bold tracking-[-0.04em] text-slate-950">个人中心</h1>
            <div className="mt-3 flex gap-1 overflow-x-auto rounded-[12px] bg-black/[0.06] p-1">
              {PROFILE_SECTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className={cn(
                    'min-w-max rounded-[9px] px-3 py-1.5 text-xs font-semibold outline-none',
                    activeSection === item.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <header className="mb-5">
            <p className="text-xs font-semibold text-[#007aff]">{active.description}</p>
            <h2 className="mt-1 text-3xl font-bold tracking-[-0.04em] text-slate-950 sm:text-4xl">
              {active.label}
            </h2>
          </header>

          {activeSection === 'account' ? (
            <div className="space-y-5">
              <UserProfileCard
                showAvatar={false}
                className="rounded-[16px] border-0 bg-white shadow-sm ring-1 ring-black/[0.04] backdrop-blur-none"
              />
              <section className="overflow-hidden rounded-[16px] bg-white shadow-sm ring-1 ring-black/[0.04]">
                {[
                  ['账户邮箱', email || '未绑定邮箱'],
                  ['资料同步', '当前设备'],
                  ['隐私状态', '仅自己可见'],
                ].map(([label, value], index) => (
                  <div
                    key={label}
                    className={cn(
                      'flex items-center justify-between gap-6 px-4 py-3.5 text-sm',
                      index > 0 && 'border-t border-black/[0.07]',
                    )}
                  >
                    <span className="font-medium text-slate-800">{label}</span>
                    <span className="truncate text-slate-500">{value}</span>
                  </div>
                ))}
              </section>
            </div>
          ) : null}

          {activeSection === 'appearance' ? (
            <ProfileUsageCard className="rounded-[16px] border-0 bg-white shadow-sm ring-1 ring-black/[0.04] backdrop-blur-none" />
          ) : null}

          {activeSection === 'usage' ? (
            <NotificationCenterUsageCard className="rounded-[16px] border-0 bg-white shadow-sm ring-1 ring-black/[0.04] backdrop-blur-none" />
          ) : null}
        </div>
      </main>
    </div>
  );
}
