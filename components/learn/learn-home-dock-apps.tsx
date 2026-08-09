'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  Check,
  Database,
  GraduationCap,
  Library,
  Save,
  Settings2,
  UserRound,
} from 'lucide-react';
import { USER_AVATAR_PRESET_URLS } from '@/lib/constants/user-avatars';
import { useAuthStore } from '@/lib/store/auth';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { listRemoteLearnSessionsPage } from '@/features/learn-conversations/client/remote-conversation-api';
import type { CourseRecord } from '@/lib/utils/database';

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
  const authName = useAuthStore((state) => state.name);
  const email = useAuthStore((state) => state.email);
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
  const [avatar, setSelectedAvatar] = useState(profileAvatar);
  const [avatarPage, setAvatarPage] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);
  const avatarPageSize = 21;
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
    avatar !== profileAvatar;

  const saveProfile = () => {
    setNickname(displayName);
    setBio(signature.trim());
    setAvatar(avatar);
    try {
      localStorage.setItem('syntara:learner-school', school.trim());
    } catch {
      // Profile still saves through the persistent store when localStorage is restricted.
    }
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1600);
  };

  return (
    <section className="learn-dock-profile-app" aria-label="个人中心">
      <div className="learn-dock-profile-shell">
        <aside className="learn-dock-profile-aside">
          <button type="button" className="learn-dock-back-button" onClick={onBack}>
            <ArrowLeft size={16} />
            返回主屏
          </button>

          <div className="learn-dock-profile-hero">
            {avatar ? (
              <img src={avatar} alt="" className="learn-dock-profile-avatar" />
            ) : (
              <span className="learn-dock-profile-avatar is-empty">
                <UserRound size={36} />
              </span>
            )}
            <strong>{displayName}</strong>
            <small>{signature.trim() || email || '还没有个性签名'}</small>
            {school.trim() ? (
              <span className="learn-dock-profile-school">
                <GraduationCap size={14} />
                {school.trim()}
              </span>
            ) : null}
          </div>

          <div className="learn-dock-profile-stats" aria-label="学习用量统计">
            {[
              ['课程', totals.courses],
              ['笔记本', totals.notebooks],
              ['题目', totals.problems],
              ['会话', totals.conversations],
            ].map(([label, value]) => (
              <span key={label}>
                <strong>{Number(value).toLocaleString('zh-CN')}</strong>
                <small>{label}</small>
              </span>
            ))}
          </div>
        </aside>

        <div className="learn-dock-profile-main">
          <header className="learn-dock-profile-toolbar">
            <div>
              <span>个人中心</span>
              <h1>编辑资料</h1>
            </div>
            <button
              type="button"
              className="learn-dock-profile-save"
              onClick={saveProfile}
              disabled={!dirty && !savedFlash}
            >
              {savedFlash ? <Check size={15} /> : <Save size={15} />}
              {savedFlash ? '已保存' : '保存'}
            </button>
          </header>

          <div className="learn-dock-profile-form">
            <label className="learn-dock-profile-field">
              <span>名字</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="你的显示名称"
                maxLength={40}
              />
            </label>

            <label className="learn-dock-profile-field">
              <span>签名</span>
              <textarea
                rows={3}
                value={signature}
                onChange={(event) => setSignature(event.target.value)}
                placeholder="一句话介绍自己"
                maxLength={160}
              />
            </label>

            <label className="learn-dock-profile-field">
              <span>学校</span>
              <input
                value={school}
                onChange={(event) => setSchool(event.target.value)}
                placeholder="例如：University of Toronto"
                maxLength={80}
              />
            </label>

            <div className="learn-dock-profile-avatar-block">
              <div className="learn-dock-profile-avatar-heading">
                <span>个人头像</span>
                <small>
                  {avatarPage + 1} / {avatarPageCount}
                </small>
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
                    </button>
                  );
                })}
              </div>
              <div className="learn-dock-profile-avatar-pager">
                <button
                  type="button"
                  disabled={avatarPage <= 0}
                  onClick={() => setAvatarPage((value) => Math.max(0, value - 1))}
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={avatarPage >= avatarPageCount - 1}
                  onClick={() => setAvatarPage((value) => Math.min(avatarPageCount - 1, value + 1))}
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const APP_LABELS: Record<Exclude<LearnDockApp, 'profile'>, string> = {
  notifications: '通知中心',
  settings: '设置',
};

function LearnHomeSystemApp({
  app,
  courses,
  onClose,
}: {
  app: Exclude<LearnDockApp, 'profile'>;
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

            {app === 'settings' ? (
              <div className="learn-dock-system-content">
                <div className="learn-dock-system-summary">
                  <Settings2 size={20} />
                  <div>
                    <strong>本地优先</strong>
                    <small>课程、题库、笔记本和会话优先从当前设备读取。</small>
                  </div>
                </div>
                <div className="learn-dock-system-settings">
                  <span>
                    <Library size={16} />
                    <small>数据源</small>
                    <strong>网页与本机同步</strong>
                  </span>
                  <span>
                    <Database size={16} />
                    <small>课程内容</small>
                    <strong>{totals.problems} 道题</strong>
                  </span>
                </div>
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
  if (app) {
    return <LearnHomeSystemApp app={app} courses={courses} onClose={onClose} />;
  }
  return null;
}
