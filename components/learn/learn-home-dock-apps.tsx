'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  Database,
  LogOut,
  MoreHorizontal,
  Pencil,
  Save,
  Settings2,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { USER_AVATAR_PRESET_URLS } from '@/lib/constants/user-avatars';
import { useAuthStore } from '@/lib/store/auth';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { listRemoteLearnSessionsPage } from '@/features/learn-conversations/client/remote-conversation-api';
import type { CourseRecord } from '@/lib/utils/database';

const EmbeddedSettingsDialog = dynamic(
  () => import('@/components/settings').then((module) => module.SettingsDialog),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full w-full place-items-center bg-[#f7f9fd] text-sm text-slate-500">
        正在加载设置…
      </div>
    ),
  },
);

export type LearnDockApp = 'profile' | 'notifications' | 'settings';

type LearningTotals = {
  courses: number;
  notebooks: number;
  problems: number;
  conversations: number;
};

function baseTotals(courses: CourseRecord[]): LearningTotals {
  return {
    courses: courses.length,
    notebooks: courses.reduce((total, course) => total + (course.notebookCount ?? 0), 0),
    problems: courses.reduce((total, course) => total + (course.problemCount ?? 0), 0),
    conversations: 0,
  };
}

function useLearningTotals(courses: CourseRecord[]) {
  const [totals, setTotals] = useState<LearningTotals>(() => baseTotals(courses));

  useEffect(() => {
    let cancelled = false;
    const nextBase = baseTotals(courses);

    void Promise.allSettled(
      courses.map((course) => listRemoteLearnSessionsPage(course.id, { limit: 100 })),
    ).then((results) => {
      if (cancelled) return;
      setTotals({
        ...nextBase,
        conversations: results.reduce(
          (total, result) =>
            result.status === 'fulfilled' && result.value
              ? total + result.value.sessions.length
              : total,
          0,
        ),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [courses]);

  return totals;
}

function LearnHomeProfileApp({ courses, onBack }: { courses: CourseRecord[]; onBack: () => void }) {
  const router = useRouter();
  const authName = useAuthStore((state) => state.name);
  const email = useAuthStore((state) => state.email);
  const role = useAuthStore((state) => state.role);
  const logout = useAuthStore((state) => state.logout);
  const profileAvatar = useUserProfileStore((state) => state.avatar);
  const profileNickname = useUserProfileStore((state) => state.nickname);
  const profileBio = useUserProfileStore((state) => state.bio);
  const setAvatar = useUserProfileStore((state) => state.setAvatar);
  const setNickname = useUserProfileStore((state) => state.setNickname);
  const setBio = useUserProfileStore((state) => state.setBio);
  const totals = useLearningTotals(courses);
  const [name, setName] = useState(profileNickname || authName || '学习者');
  const [signature, setSignature] = useState(profileBio);
  const [school, setSchool] = useState(() => {
    try {
      return localStorage.getItem('syntara:learner-school') || '';
    } catch {
      return '';
    }
  });
  const [savedSchool, setSavedSchool] = useState(school);
  const [avatar, setSelectedAvatar] = useState(profileAvatar);
  const [avatarPage, setAvatarPage] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);
  const avatarPageSize = 10;
  const avatarPageCount = Math.max(1, Math.ceil(USER_AVATAR_PRESET_URLS.length / avatarPageSize));
  const avatarsOnPage = useMemo(
    () =>
      USER_AVATAR_PRESET_URLS.slice(
        avatarPage * avatarPageSize,
        avatarPage * avatarPageSize + avatarPageSize,
      ),
    [avatarPage],
  );

  const displayName = name.trim() || authName || '学习者';
  const dirty =
    displayName !== (profileNickname || authName || '学习者') ||
    signature.trim() !== profileBio ||
    avatar !== profileAvatar ||
    school.trim() !== savedSchool;

  const roleLabel = role === 'TEACHER' ? '教师账户' : role === 'ADMIN' ? '管理员账户' : '学生账户';

  const saveProfile = () => {
    setNickname(displayName);
    setBio(signature.trim());
    setAvatar(avatar);
    try {
      localStorage.setItem('syntara:learner-school', school.trim());
    } catch {
      // Profile still saves through the persistent store when localStorage is restricted.
    }
    setSavedSchool(school.trim());
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1600);
  };

  return (
    <section className="learn-dock-profile-app" aria-label="个人中心">
      <div className="learn-dock-profile-shell">
        <aside className="learn-dock-profile-navigation">
          <div className="learn-dock-profile-brand">
            <span>
              <Sparkles size={19} strokeWidth={2.2} />
            </span>
            <strong>Syntara</strong>
          </div>
          <nav aria-label="个人中心导航">
            <button type="button" data-active="true" aria-current="page">
              <span>
                <UserRound size={17} strokeWidth={1.9} />
              </span>
              个人资料
            </button>
          </nav>
          <p className="learn-dock-profile-navigation-note">
            个人中心只管理头像、昵称、简介和学校；模型与界面偏好统一放在设置中。
          </p>
          <div className="learn-dock-profile-navigation-footer">
            <button type="button" onClick={() => router.push('/settings')}>
              <Settings2 size={17} strokeWidth={1.9} />
              打开设置
            </button>
            <button type="button" onClick={onBack}>
              <ArrowLeft size={17} strokeWidth={1.9} />
              返回主屏
            </button>
            <button
              type="button"
              onClick={() => {
                logout();
                router.push('/login');
              }}
            >
              <LogOut size={17} strokeWidth={1.9} />
              退出登录
            </button>
          </div>
        </aside>

        <div className="learn-dock-profile-main">
          <header className="learn-dock-profile-toolbar">
            <div>
              <h1>个人资料</h1>
              <p>管理您的个人信息与资料</p>
            </div>
            <span className="learn-dock-profile-role">{roleLabel}</span>
          </header>

          <div className="learn-dock-profile-content">
            <div className="learn-dock-profile-card">
              <aside className="learn-dock-profile-summary">
                <div className="learn-dock-profile-portrait-wrap">
                  {avatar ? (
                    <img
                      src={avatar}
                      alt={`${displayName}的头像`}
                      className="learn-dock-profile-avatar"
                    />
                  ) : (
                    <span className="learn-dock-profile-avatar is-empty">
                      <UserRound size={42} />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById('profile-avatar-picker')
                        ?.scrollIntoView({ behavior: 'smooth' })
                    }
                    aria-label="选择头像"
                  >
                    <Pencil size={15} strokeWidth={2} />
                  </button>
                </div>
                <label className="learn-dock-profile-name">
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="你的显示名称"
                    maxLength={40}
                    aria-label="显示名称"
                  />
                  <Pencil size={14} strokeWidth={2} />
                </label>
                <p className="learn-dock-profile-email">{email || '本地学习账户'}</p>
                <div className="learn-dock-profile-stats" aria-label="学习用量统计">
                  {[
                    ['课程', totals.courses],
                    ['笔记本', totals.notebooks],
                    ['会话', totals.conversations],
                  ].map(([label, value]) => (
                    <span key={label}>
                      <strong>{Number(value).toLocaleString('zh-CN')}</strong>
                      <small>{label}</small>
                    </span>
                  ))}
                </div>
                <div className="learn-dock-profile-account-card">
                  <CalendarDays size={18} strokeWidth={1.9} />
                  <span>
                    <small>账户身份</small>
                    <strong>{roleLabel}</strong>
                  </span>
                </div>
              </aside>

              <div className="learn-dock-profile-form">
                <label className="learn-dock-profile-field">
                  <span>
                    <strong>个人简介</strong>
                    <small>{signature.length} / 160</small>
                  </span>
                  <span className="learn-dock-profile-input-wrap is-textarea">
                    <textarea
                      rows={3}
                      value={signature}
                      onChange={(event) => setSignature(event.target.value)}
                      placeholder="一句话介绍自己…"
                      maxLength={160}
                    />
                    <Pencil size={15} strokeWidth={1.9} />
                  </span>
                </label>

                <label className="learn-dock-profile-field">
                  <span>
                    <strong>学校</strong>
                  </span>
                  <span className="learn-dock-profile-input-wrap">
                    <input
                      value={school}
                      onChange={(event) => setSchool(event.target.value)}
                      placeholder="例如：University of Toronto"
                      maxLength={80}
                    />
                    <Pencil size={15} strokeWidth={1.9} />
                  </span>
                </label>

                <div className="learn-dock-profile-avatar-block" id="profile-avatar-picker">
                  <div className="learn-dock-profile-avatar-heading">
                    <span>头像选择</span>
                    <small>点击头像进行选择</small>
                  </div>
                  <div className="learn-dock-profile-avatar-grid">
                    {avatarsOnPage.map((url) => {
                      const selected = avatar === url;
                      return (
                        <button
                          type="button"
                          key={url}
                          className={`learn-dock-profile-avatar-option${selected ? ' is-selected' : ''}`}
                          onClick={() => setSelectedAvatar(url)}
                          aria-label="选择头像"
                          aria-pressed={selected}
                        >
                          <img src={url} alt="" draggable={false} />
                          {selected ? <Check size={15} strokeWidth={2.2} /> : null}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="learn-dock-profile-avatar-more"
                      onClick={() => setAvatarPage((value) => (value + 1) % avatarPageCount)}
                    >
                      <MoreHorizontal size={21} strokeWidth={1.8} />
                      <span>更多</span>
                    </button>
                  </div>
                </div>

                <div className="learn-dock-profile-actions">
                  <button
                    type="button"
                    className="learn-dock-profile-save"
                    onClick={saveProfile}
                    disabled={!dirty && !savedFlash}
                  >
                    {savedFlash ? <Check size={15} /> : <Save size={15} />}
                    {savedFlash ? '已保存' : '保存修改'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const APP_LABELS: Record<'notifications', string> = {
  notifications: '通知中心',
};

function LearnHomeSystemApp({
  app,
  courses,
  onClose,
}: {
  app: 'notifications';
  courses: CourseRecord[];
  onClose: () => void;
}) {
  const totals = baseTotals(courses);

  return (
    <section className="learn-dock-profile-app" aria-label={APP_LABELS[app]}>
      <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 dark:border-white/10 dark:bg-slate-950 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" className="learn-dock-back-button" onClick={onClose}>
              <ArrowLeft size={16} />
              返回主屏
            </button>
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                SYSTEM APP
              </span>
              <h1 className="truncate text-xl font-semibold text-slate-950 dark:text-white sm:text-2xl">
                {APP_LABELS[app]}
              </h1>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
          <div className="mx-auto w-full max-w-5xl rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5 sm:p-7">
            {app === 'notifications' ? (
              <div className="learn-dock-system-content">
                <div className="learn-dock-system-summary">
                  <Bell size={20} />
                  <div>
                    <strong>本机通知中心</strong>
                    <small>资料导入、课程更新和课程日程会在这里汇总。</small>
                  </div>
                </div>
                <article className="learn-dock-system-note">
                  <Database size={16} />
                  <div>
                    <strong>学习资料已就绪</strong>
                    <small>
                      当前可读取 {totals.courses} 门课程、{totals.problems} 道题和{' '}
                      {totals.notebooks} 个笔记本。
                    </small>
                  </div>
                </article>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </section>
  );
}

export function LearnHomeDockAppLayer({
  app,
  courses,
  onClose,
}: {
  app: LearnDockApp | null;
  courses: CourseRecord[];
  onClose: () => void;
}) {
  if (app === 'profile') {
    return <LearnHomeProfileApp courses={courses} onBack={onClose} />;
  }
  if (app === 'settings') {
    return (
      <section className="learn-dock-profile-app" aria-label="设置">
        <EmbeddedSettingsDialog embedded open onOpenChange={(open) => !open && onClose()} />
      </section>
    );
  }
  if (app) {
    return <LearnHomeSystemApp app={app} courses={courses} onClose={onClose} />;
  }
  return null;
}
