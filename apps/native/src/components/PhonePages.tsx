import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent,
} from 'react';
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Images,
  LogOut,
  Mail,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  UserRound,
  X,
} from 'lucide-react';

import {
  COURSE_AVATAR_PRESETS,
  nativeAccountAvatarUrl,
  profileThemeForAvatar,
  resolveNativeCourseAvatar,
} from '../assets';
import { getLocalRepository } from '../data/repository';
import { loadNotebookForReading } from '../data/course-sync';
import { loadNativeAuthSession, logoutNativeAuthSession } from '../data/native-auth';
import {
  getNativeMiniLecturePage,
  getNativeWeeklyUsage,
  type NativeDeviceUser,
} from '../data/platform-api-client';
import { isPlatformCourse } from '../data/chat-sync';
import type { ChatResponseStrength } from '../data/ai-client';
import type { NativeSyncedMiniLecture, NativeWeeklyUsage } from '../data/platform-api-contracts';
import {
  DEFAULT_LEARNER_PROFILE,
  readStoredLearnerProfile,
  writeStoredLearnerProfile,
  type LearnerProfile,
} from '../data/learner-profile';
import type {
  LocalCourseEvent,
  LocalCourseEventKind,
  PersistedMiniLectureDeck,
} from '../domain/learning-experiences';
import type {
  LocalConversation,
  LocalCourseLearningState,
  LocalCourseSummary,
  LocalCourseWorkspace,
  LocalNotebook,
  LocalStudyMemory,
} from '../domain/models';
import {
  buildLearningCalendarDays,
  formatCalendarMonth,
  localDayKey,
} from './LearningCalendarGrid';
import { LocalResourceViewer, type LocalResourceDocument } from './LocalResourceViewer';
import { MemoryGalaxyFlat } from './GlassMarbles';
import {
  GlassLoadMore,
  GlassSkeletonRows,
  useListWindow,
  type LoadMoreState,
  GlassSpinner,
} from './GlassLoadMore';
import { ProblemRichText } from './problem-bank/problem-rich-text';
import {
  STALE_FRESHNESS,
  markMemoryReviewed,
  memoryFreshness,
  readReviewedMap,
} from '../lib/memory-freshness';
import { buildMemoryGalaxy, type GalaxyNode, type MemoryGalaxy } from '../lib/memory-galaxy';
import { useBackDismiss } from '../lib/use-back-dismiss';
import { useSidebarBackground } from '../lib/use-sidebar-background';
import {
  MEMORY_MARBLE_LEGEND,
  classroomMarble,
  marbleImages,
  memoryMarble,
  type MarbleColor,
} from '../lib/learning-action-marbles';
import './phone-pages.css';
import './course-pages.css';

const DAY_MS = 24 * 60 * 60 * 1000;

// three.js 比较大，用到 3D 的页面打开时才加载。
const MemoryGalaxy3D = lazy(() => import('./MemoryGalaxy3D'));
const MarbleTube3D = lazy(() => import('./MarbleTube3D'));

/** 立体的记忆星图；设备不支持 3D 时退回平面版。 */
function MemoryGalaxyHero({
  galaxy,
  activeId = null,
  filterIds = null,
  focusId,
  label,
  onNodeTap,
  onBackgroundTap,
}: {
  galaxy: MemoryGalaxy;
  activeId?: string | null;
  filterIds?: Set<string> | null;
  focusId?: string | null;
  label: string;
  onNodeTap?: (node: GalaxyNode) => void;
  onBackgroundTap?: () => void;
}) {
  const [flat, setFlat] = useState(false);
  if (flat) {
    return (
      <MemoryGalaxyFlat
        galaxy={galaxy}
        activeId={activeId}
        filterIds={filterIds}
        label={label}
        onNodeTap={onNodeTap}
      />
    );
  }
  return (
    <Suspense
      fallback={
        <span
          className="memory-galaxy"
          style={
            galaxy.backgroundUrl
              ? { backgroundImage: `url(${JSON.stringify(galaxy.backgroundUrl)})` }
              : undefined
          }
          aria-hidden
        />
      }
    >
      <MemoryGalaxy3D
        galaxy={galaxy}
        activeId={activeId}
        filterIds={filterIds}
        focusId={focusId}
        label={label}
        tilt
        onNodeTap={onNodeTap}
        onBackgroundTap={onBackgroundTap}
        onUnavailable={() => setFlat(true)}
      />
    </Suspense>
  );
}

/** 学习进度里每学完一本就收一颗弹珠，颜色轮流换。 */
const PROGRESS_MARBLE_COLORS: MarbleColor[] = ['blue', 'purple', 'pink', 'green', 'amber'];

function progressMarble(index: number): string {
  return marbleImages[PROGRESS_MARBLE_COLORS[index % PROGRESS_MARBLE_COLORS.length]];
}

function formatAgo(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor((Date.now() - timestamp) / DAY_MS);
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

function sortNotebooks(notebooks: LocalNotebook[]): LocalNotebook[] {
  // 按笔记本编号排列（01 → 11），编号相同时按名称。
  return [...notebooks].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
}

/** iPhone 二级页面：玻璃顶栏 + 返回按钮，内容从顶栏下面滚过去。 */
function PhonePage({
  title,
  subtitle,
  action,
  overlay = false,
  wide = false,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  overlay?: boolean;
  /** 大屏右侧面板放宽（记忆星图要地方）。 */
  wide?: boolean;
  onBack: () => void;
  children: ReactNode;
}) {
  const pageRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; dx: number; horizontal: boolean | null } | null>(
    null,
  );

  // 从左边缘往右拖返回，页面跟着手指走。
  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    dragRef.current =
      overlay && touch && event.touches.length === 1 && touch.clientX <= 28
        ? { x: touch.clientX, y: touch.clientY, dx: 0, horizontal: null }
        : null;
  };

  const handleTouchMove = (event: TouchEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const page = pageRef.current;
    const touch = event.touches[0];
    if (!drag || !page || !touch) return;
    const dx = touch.clientX - drag.x;
    const dy = touch.clientY - drag.y;
    if (drag.horizontal === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      drag.horizontal = dx > 0 && Math.abs(dx) > Math.abs(dy);
      if (!drag.horizontal) {
        dragRef.current = null;
        return;
      }
    }
    drag.dx = Math.max(0, dx);
    page.style.animation = 'none';
    page.style.transition = 'none';
    page.style.transform = `translateX(${drag.dx}px)`;
  };

  const handleTouchEnd = () => {
    const drag = dragRef.current;
    const page = pageRef.current;
    dragRef.current = null;
    if (!drag?.horizontal || !page) return;
    const leave = drag.dx > page.clientWidth * 0.3;
    page.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
    page.style.transform = leave ? 'translateX(100%)' : 'translateX(0)';
    if (leave) window.setTimeout(onBack, 200);
  };

  return (
    <section
      ref={pageRef}
      className={`phone-page${overlay ? ' phone-page-overlay' : ''}${wide ? ' phone-page-wide' : ''}`}
      aria-label={title}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <header className="phone-page-header">
        <button type="button" className="phone-glass-button" onClick={onBack} aria-label="返回">
          <ChevronLeft size={22} />
        </button>
        <div className="phone-page-title">
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </div>
        <div className="phone-page-action">{action}</div>
      </header>
      <div className="phone-page-scroll">{children}</div>
    </section>
  );
}

/** 空状态：一块小玻璃屏幕里一颗弹珠，加一行标题和一行提示（和课堂空状态一样）。 */
function PhoneEmpty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="phone-page-empty">
      <span aria-hidden>
        <img src={marbleImages.blue} alt="" />
      </span>
      <strong>{title}</strong>
      <small>{hint}</small>
    </div>
  );
}

type ProfileSheet = 'avatar' | 'logout' | null;

const ROLE_LABELS: Record<NativeDeviceUser['role'], string> = {
  ADMIN: '管理员',
  STUDENT: '学生',
  TEACHER: '老师',
  USER: '用户',
};

const RESPONSE_STRENGTH_OPTIONS: Array<{
  value: ChatResponseStrength;
  label: string;
  description: string;
}> = [
  { value: 'low', label: '低', description: '适合日常问答，速度更快、用量更省。' },
  { value: 'medium', label: '中', description: '适合需要推理和分步讲解的学习问题。' },
  {
    value: 'high',
    label: '高',
    description: '适合复杂推导、综合分析和高难度问题，用量约是低档的 5 倍。',
  },
];

function PhoneWeeklyUsage() {
  const [usage, setUsage] = useState<NativeWeeklyUsage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getNativeWeeklyUsage()
      .then((next) => {
        if (!cancelled) setUsage(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const load = () => {
    setLoading(true);
    setFailed(false);
    setReloadKey((current) => current + 1);
  };

  if (loading) {
    return (
      <div className="phone-usage">
        <GlassSpinner size={18} />
      </div>
    );
  }
  if (failed || !usage) {
    return (
      <button type="button" className="phone-usage phone-usage-retry" onClick={load}>
        <img src={marbleImages.blue} alt="" aria-hidden />
        用量暂时读不到，点一下重试
      </button>
    );
  }
  if (usage.disabled) {
    return <div className="phone-usage phone-usage-note is-danger">管理员已暂停你的 AI 调用</div>;
  }
  if (!usage.databaseEnabled) {
    return <div className="phone-usage phone-usage-note">当前环境没有开启云端用量统计</div>;
  }

  const hasCostLimit = usage.limitUsd != null;
  const hasRequestLimit = usage.requestLimit != null;
  const resetLabel = new Date(usage.period.end).toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  });
  if (!hasCostLimit && !hasRequestLimit) {
    return (
      <div className="phone-usage">
        <div className="phone-usage-head">
          <strong>${usage.usedUsd.toFixed(2)}</strong>
          <small>本周已用 · 没有设置每周限额</small>
        </div>
        <p className="phone-usage-foot">{resetLabel} 重置</p>
      </div>
    );
  }
  const used = hasCostLimit ? usage.usedUsd : usage.requestCount;
  const limit = (hasCostLimit ? usage.limitUsd : usage.requestLimit) ?? 0;
  const percent = limit <= 0 ? 100 : Math.min(100, (used / limit) * 100);
  const remaining = hasCostLimit
    ? `$${(usage.remainingUsd ?? 0).toFixed(2)}`
    : `${usage.remainingRequests ?? 0} 次`;
  return (
    <div className="phone-usage">
      <div className="phone-usage-head">
        <strong>{remaining}</strong>
        <small>本周剩余</small>
      </div>
      <div className="phone-usage-bar" aria-hidden="true">
        <span
          className={percent >= 100 ? 'is-danger' : percent >= 80 ? 'is-warning' : undefined}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="phone-usage-foot">
        已用 {hasCostLimit ? `$${usage.usedUsd.toFixed(2)}` : usage.requestCount} /{' '}
        {hasCostLimit ? `$${limit.toFixed(2)}` : limit}
        {hasCostLimit && hasRequestLimit
          ? ` · 请求 ${usage.requestCount} / ${usage.requestLimit}`
          : ''}{' '}
        · {resetLabel} 重置
      </p>
    </div>
  );
}

type ShelfGalaxy = {
  id: string;
  galaxy: MemoryGalaxy;
  count: number;
  image: string | null;
};

/** 我的页里的收藏架：每门课一团小小的记忆星图。 */
function GalaxyShelf({
  courses,
  currentCourseId,
  currentCourseAvatarUrl,
  onOpen,
}: {
  courses: LocalCourseSummary[];
  currentCourseId: string;
  currentCourseAvatarUrl: string;
  onOpen: (courseId: string) => void;
}) {
  const [shelf, setShelf] = useState<ShelfGalaxy[]>([]);
  const [avatarRevision, setAvatarRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setAvatarRevision((value) => value + 1);
    window.addEventListener('syntara-native-course-avatar-changed', refresh);
    return () => window.removeEventListener('syntara-native-course-avatar-changed', refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ renderGalaxySnapshot }, repository] = await Promise.all([
        import('../lib/memory-galaxy-3d'),
        getLocalRepository(),
      ]);
      const reviewed = readReviewedMap();
      const done: ShelfGalaxy[] = [];
      for (const course of courses) {
        const workspace = await repository.loadCourseWorkspace(course.id).catch(() => null);
        if (cancelled) return;
        const galaxy = buildMemoryGalaxy(
          {
            courseId: course.id,
            courseLabel: course.courseCode || course.name,
            backgroundUrl: profileThemeForAvatar(
              course.id === currentCourseId
                ? currentCourseAvatarUrl
                : resolveNativeCourseAvatar(course.id, course.courseCode),
            )?.galaxyUrl,
            notebooks: workspace?.notebooks ?? [],
            memories: workspace?.memories ?? [],
          },
          reviewed,
        );
        const image = await renderGalaxySnapshot(galaxy, 240, 240);
        if (cancelled) return;
        done.push({ id: course.id, galaxy, count: workspace?.memories.length ?? 0, image });
        // 一个一个摆上架，不用等所有课都画完。
        setShelf([...done]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courses, currentCourseId, currentCourseAvatarUrl, avatarRevision]);

  return (
    <div className="phone-jar-shelf">
      {courses.map((course) => {
        const item = shelf.find((entry) => entry.id === course.id);
        const name = course.courseCode || course.name;
        const label = `${name} 的记忆星图，${item?.count ?? 0} 颗记忆`;
        return (
          <div
            key={course.id}
            className={`phone-jar-shelf-item${course.id === currentCourseId ? ' is-current' : ''}`}
          >
            {item && !item.image ? (
              <MemoryGalaxyFlat
                size="sm"
                galaxy={item.galaxy}
                label={label}
                onTap={() => onOpen(course.id)}
              />
            ) : (
              <button
                type="button"
                className="phone-jar-shelf-jar"
                onClick={() => onOpen(course.id)}
                aria-label={label}
              >
                {item?.image ? <img src={item.image} alt="" /> : null}
              </button>
            )}
            <strong>{name}</strong>
            <small>{item ? `${item.count} 颗` : '…'}</small>
          </div>
        );
      })}
    </div>
  );
}

export function PhoneProfilePage({
  courses,
  currentCourseId,
  currentCourseAvatarUrl,
  conversationCount,
  responseStrength,
  onResponseStrengthChange,
  onOpenCourseJar,
  onBack,
}: {
  courses: LocalCourseSummary[];
  currentCourseId: string;
  currentCourseAvatarUrl: string;
  conversationCount: number;
  responseStrength: ChatResponseStrength;
  onResponseStrengthChange: (strength: ChatResponseStrength) => void;
  onOpenCourseJar: (courseId: string) => void;
  onBack: () => void;
}) {
  const courseCount = courses.length;
  const [sidebarBackgroundEnabled, setSidebarBackgroundEnabled] = useSidebarBackground();
  const [profile, setProfile] = useState<LearnerProfile>(() => readStoredLearnerProfile());
  const [user, setUser] = useState<NativeDeviceUser | null>(null);
  const [sheet, setSheet] = useState<ProfileSheet>(null);
  // 编辑资料用整页而不是底部面板，键盘弹出来不会挡住输入框。
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftSignature, setDraftSignature] = useState('');
  const [draftSchool, setDraftSchool] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  useBackDismiss(editing, () => setEditing(false), 20);
  useBackDismiss(Boolean(sheet), () => setSheet(null), 30);

  useEffect(() => {
    let cancelled = false;
    void loadNativeAuthSession()
      .then((session) => {
        if (!cancelled) setUser(session?.user ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // 没改过本机资料时，用网页账号的名字和头像。
  const customName = profile.name !== DEFAULT_LEARNER_PROFILE.name ? profile.name.trim() : '';
  const displayName = customName || user?.name || DEFAULT_LEARNER_PROFILE.name;
  const signature =
    profile.signature !== DEFAULT_LEARNER_PROFILE.signature ? profile.signature.trim() : '';
  const avatarUrl = nativeAccountAvatarUrl(profile.avatarId, user?.image);
  const profileBackgroundUrl = profileThemeForAvatar(avatarUrl)?.backgroundUrl;
  const school = profile.school.trim();

  const saveProfile = (patch: Partial<Omit<LearnerProfile, 'updatedAt'>>) => {
    setProfile(
      writeStoredLearnerProfile({
        avatarId: profile.avatarId,
        name: profile.name,
        signature: profile.signature,
        school: profile.school,
        ...patch,
      }),
    );
  };

  const openEdit = () => {
    setDraftName(displayName);
    setDraftSignature(signature);
    setDraftSchool(school);
    setEditing(true);
  };

  const logout = async () => {
    setLoggingOut(true);
    try {
      await logoutNativeAuthSession();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <>
      <PhonePage title="我的" overlay onBack={onBack}>
        <section className={`phone-me-card${profileBackgroundUrl ? ' has-avatar-background' : ''}`}>
          {profileBackgroundUrl ? (
            <img
              key={profileBackgroundUrl}
              className="profile-avatar-backdrop"
              src={profileBackgroundUrl}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
          ) : null}
          <div className="phone-me-head">
            <button
              type="button"
              className="phone-me-avatar"
              onClick={() => setSheet('avatar')}
              aria-label="更换头像"
            >
              {avatarUrl ? <img src={avatarUrl} alt="" /> : <UserRound size={30} />}
              <span className="phone-me-avatar-badge">
                <Pencil size={11} />
              </span>
            </button>
            <div className="phone-me-identity">
              <strong>{displayName}</strong>
              <small>{signature || '写一句话介绍自己'}</small>
            </div>
            <div className="phone-me-actions">
              <button
                type="button"
                className="phone-me-sidebar-toggle"
                role="switch"
                aria-checked={sidebarBackgroundEnabled}
                onClick={() => setSidebarBackgroundEnabled(!sidebarBackgroundEnabled)}
              >
                侧边栏背景
                <span className="phone-me-toggle-track" aria-hidden="true" />
              </button>
              <button type="button" className="phone-me-edit" onClick={openEdit}>
                编辑
              </button>
            </div>
          </div>
          <div className="phone-me-stats">
            <span>
              <strong>{courseCount}</strong>
              <small>课程</small>
            </span>
            <span>
              <strong>{conversationCount}</strong>
              <small>聊天</small>
            </span>
            <span>
              <strong>{user ? ROLE_LABELS[user.role] : '—'}</strong>
              <small>身份</small>
            </span>
          </div>
        </section>

        {courses.length ? (
          <>
            <p className="phone-group-title">我的记忆星图</p>
            <GalaxyShelf
              courses={courses}
              currentCourseId={currentCourseId}
              currentCourseAvatarUrl={currentCourseAvatarUrl}
              onOpen={onOpenCourseJar}
            />
          </>
        ) : null}

        <p className="phone-group-title">本周用量</p>
        <div className="phone-group">
          <PhoneWeeklyUsage />
        </div>

        <p className="phone-group-title">回复强度</p>
        <div className="phone-group phone-strength">
          <div className="phone-segmented" role="radiogroup" aria-label="回复强度">
            {RESPONSE_STRENGTH_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.value}
                role="radio"
                aria-checked={responseStrength === option.value}
                className={responseStrength === option.value ? 'is-active' : undefined}
                onClick={() => onResponseStrengthChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p>
            {RESPONSE_STRENGTH_OPTIONS.find((option) => option.value === responseStrength)
              ?.description ?? ''}
          </p>
        </div>

        <p className="phone-group-title">账号</p>
        <div className="phone-group">
          <div className="phone-row">
            <span className="phone-row-icon phone-row-icon-blue">
              <Mail size={17} />
            </span>
            <span className="phone-row-copy">
              <strong>邮箱</strong>
            </span>
            <span className="phone-row-value">{user?.email || '未绑定'}</span>
          </div>
          <button type="button" className="phone-row phone-row-button" onClick={openEdit}>
            <span className="phone-row-icon phone-row-icon-amber">
              <GraduationCap size={17} />
            </span>
            <span className="phone-row-copy">
              <strong>学校</strong>
            </span>
            <span className="phone-row-value">{school || '未填写'}</span>
            <ChevronRight size={18} className="phone-row-trailing" />
          </button>
        </div>

        <div className="phone-group">
          <button type="button" className="phone-row phone-row-button" onClick={openEdit}>
            <span className="phone-row-icon phone-row-icon-violet">
              <Pencil size={16} />
            </span>
            <span className="phone-row-copy">
              <strong>编辑资料</strong>
            </span>
            <ChevronRight size={18} className="phone-row-trailing" />
          </button>
          <button
            type="button"
            className="phone-row phone-row-button"
            onClick={() => setSheet('avatar')}
          >
            <span className="phone-row-icon phone-row-icon-green">
              <Images size={17} />
            </span>
            <span className="phone-row-copy">
              <strong>更换头像</strong>
            </span>
            <ChevronRight size={18} className="phone-row-trailing" />
          </button>
        </div>

        <div className="phone-group">
          <button
            type="button"
            className="phone-row phone-row-button phone-row-center phone-row-danger"
            onClick={() => setSheet('logout')}
          >
            <LogOut size={17} />
            退出登录
          </button>
        </div>
        <p className="phone-group-footer phone-me-footer">聊天记录会和网页账号同步。</p>

        {sheet === 'avatar' ? (
          <div className="phone-sheet-layer">
            <button
              type="button"
              className="phone-sheet-backdrop"
              onClick={() => setSheet(null)}
              aria-label="关闭"
            />
            {sheet === 'avatar' ? (
              <section className="phone-sheet" aria-label="更换头像">
                <header className="phone-sheet-header">
                  <button type="button" onClick={() => setSheet(null)}>
                    取消
                  </button>
                  <strong>更换头像</strong>
                  <span />
                </header>
                <div className="phone-sheet-avatars">
                  {COURSE_AVATAR_PRESETS.map((preset) => {
                    const selected = avatarUrl === preset.url;
                    return (
                      <button
                        type="button"
                        key={preset.id}
                        className={`phone-avatar-option${selected ? ' is-selected' : ''}`}
                        onClick={() => {
                          saveProfile({ avatarId: preset.id });
                          setSheet(null);
                        }}
                        aria-label={`选择头像 ${preset.id} ${preset.name}`}
                        aria-pressed={selected}
                      >
                        <img src={preset.url} alt="" loading="lazy" draggable={false} />
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
        {sheet === 'logout' ? (
          <PhoneConfirm
            title="退出登录？"
            message="本机的聊天和笔记会保留。"
            confirmLabel="退出"
            destructive
            busy={loggingOut}
            onConfirm={() => void logout()}
            onCancel={() => setSheet(null)}
          />
        ) : null}
      </PhonePage>
      {editing ? (
        <PhonePage
          title="编辑资料"
          overlay
          onBack={() => setEditing(false)}
          action={
            <button
              type="button"
              className="phone-page-text-button"
              onClick={() => {
                saveProfile({
                  name: draftName.trim() || DEFAULT_LEARNER_PROFILE.name,
                  signature: draftSignature.trim(),
                  school: draftSchool.trim(),
                });
                setEditing(false);
              }}
            >
              完成
            </button>
          }
        >
          <div className="phone-group">
            <label className="phone-row phone-field">
              <span>名字</span>
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="你的显示名称"
                maxLength={40}
              />
            </label>
            <label className="phone-row phone-field">
              <span>签名</span>
              <input
                value={draftSignature}
                onChange={(event) => setDraftSignature(event.target.value)}
                placeholder="一句话介绍自己"
                maxLength={160}
              />
            </label>
            <label className="phone-row phone-field">
              <span>学校</span>
              <input
                value={draftSchool}
                onChange={(event) => setDraftSchool(event.target.value)}
                placeholder="例如 University of Toronto"
                maxLength={80}
              />
            </label>
          </div>
        </PhonePage>
      ) : null}
    </>
  );
}

export function PhoneNotesPage({
  workspace,
  onBack,
}: {
  workspace: LocalCourseWorkspace;
  onBack: () => void;
}) {
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resource, setResource] = useState<LocalResourceDocument | null>(null);

  const sortedNotebooks = useMemo(() => sortNotebooks(workspace.notebooks), [workspace.notebooks]);
  // 每本笔记的弹珠颜色跟着它在课程里的顺序走（和学习进度页一样），搜索时不会变色。
  const marbleIndex = useMemo(
    () => new Map(sortedNotebooks.map((notebook, index) => [notebook.id, index])),
    [sortedNotebooks],
  );
  const notebooks = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = sortedNotebooks;
    if (!terms.length) return list;
    return list.filter((notebook) => {
      const haystack = notebook.name.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [query, sortedNotebooks]);
  const listWindow = useListWindow(notebooks.length, `${workspace.course.id}:${query}`, 40);

  const openNotebook = async (notebook: LocalNotebook) => {
    setBusyId(notebook.id);
    setError(null);
    try {
      const repository = await getLocalRepository();
      const document = await loadNotebookForReading(repository, notebook.id);
      if (!document) throw new Error('本地找不到这个笔记本。');
      setResource({ kind: 'notebook', document });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PhonePage
      title="笔记"
      subtitle={workspace.course.courseCode || workspace.course.name}
      overlay
      onBack={onBack}
    >
      <label className="phone-search">
        <Search size={17} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索笔记"
          type="search"
        />
      </label>
      {error ? <p className="phone-page-error">{error}</p> : null}

      {notebooks.length ? (
        <>
          <p className="phone-group-title">{workspace.notebooks.length} 本笔记</p>
          <div className="nb-grid">
            {notebooks.slice(0, listWindow.count).map((notebook, index) => {
              const busy = busyId === notebook.id;
              return (
                <button
                  key={notebook.id}
                  type="button"
                  className={`nb-card${busy ? ' is-opening' : ''}`}
                  style={{ animationDelay: `${Math.min(index % 40, 12) * 28}ms` }}
                  disabled={busyId !== null}
                  onClick={() => void openNotebook(notebook)}
                >
                  <img
                    className="nb-card-marble"
                    src={progressMarble(marbleIndex.get(notebook.id) ?? index)}
                    alt=""
                  />
                  <span className="nb-card-copy">
                    <strong>{notebook.name}</strong>
                    <small>
                      {notebook.sectionCount} 节 · {formatAgo(notebook.updatedAt)}
                    </small>
                  </span>
                  {busy ? (
                    <GlassSpinner size={17} className="nb-card-trailing" />
                  ) : (
                    <ChevronRight size={18} className="nb-card-trailing" />
                  )}
                </button>
              );
            })}
          </div>
          {listWindow.hasHidden ? (
            <GlassLoadMore onLoadMore={listWindow.showMore} watchKey={listWindow.count} />
          ) : null}
        </>
      ) : (
        <PhoneEmpty
          title={workspace.notebooks.length ? '没有匹配的笔记' : '还没有笔记'}
          hint={
            workspace.notebooks.length
              ? '换个关键词再试。'
              : '在网页上传课程资料后，这里会出现笔记。'
          }
        />
      )}

      {resource ? (
        <LocalResourceViewer resource={resource} onClose={() => setResource(null)} />
      ) : null}
    </PhonePage>
  );
}

export function PhoneProgressPage({
  learningState,
  notebooks,
  onProgressChange,
  onOpenNotebook,
  onBack,
}: {
  learningState: LocalCourseLearningState | null;
  notebooks: LocalNotebook[];
  onProgressChange: (completedNotebookCount: number, currentNotebookId: string | null) => void;
  onOpenNotebook: (notebook: LocalNotebook) => void;
  onBack: () => void;
}) {
  const ordered = useMemo(() => sortNotebooks(notebooks), [notebooks]);
  const total = ordered.length;
  const completed = Math.min(total, Math.max(0, learningState?.completedNotebookCount ?? 0));
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const [tubeFlat, setTubeFlat] = useState(false);

  const setCompleted = (count: number) => {
    const next = Math.min(total, Math.max(0, count));
    if (next === completed) return;
    onProgressChange(next, next > 0 ? (ordered[next - 1]?.id ?? null) : null);
  };

  return (
    <PhonePage title="学习进度" overlay onBack={onBack}>
      <div className="phone-group phone-progress-summary">
        <div className="phone-progress-figure">
          <strong>{percent}</strong>
          <span>%</span>
        </div>
        <p>
          已学完 {completed} / {total} 本笔记
        </p>
        {total ? (
          tubeFlat ? (
            <div className="phone-progress-tube" aria-hidden="true">
              {ordered.map((notebook, index) => (
                <span key={notebook.id} className={index < completed ? 'is-filled' : undefined}>
                  {index < completed ? <img src={progressMarble(index)} alt="" /> : null}
                </span>
              ))}
            </div>
          ) : (
            <Suspense fallback={<span className="marble-tube-3d" aria-hidden />}>
              <MarbleTube3D
                completed={completed}
                total={total}
                colors={PROGRESS_MARBLE_COLORS}
                onUnavailable={() => setTubeFlat(true)}
              />
            </Suspense>
          )
        ) : null}
        <small>AI 只会参考你已经学到的笔记和对应的学习记忆。</small>
      </div>

      {total ? (
        <>
          <p className="phone-group-title">点一下标记学到哪一本</p>
          <div className="phone-group">
            {ordered.map((notebook, index) => {
              const reached = index < completed;
              const current = index === completed - 1;
              return (
                <div
                  key={notebook.id}
                  className={`phone-row phone-progress-row${reached ? ' is-reached' : ''}${current ? ' is-current' : ''}`}
                >
                  <button
                    type="button"
                    className="phone-progress-mark"
                    onClick={() => setCompleted(current ? index : index + 1)}
                    aria-pressed={reached}
                  >
                    <span className="phone-progress-dot">
                      {reached ? (
                        <>
                          <img src={progressMarble(index)} alt="" />
                          <Check size={13} strokeWidth={3} />
                        </>
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span className="phone-row-copy">
                      <strong>{notebook.name}</strong>
                      {current ? <small>当前学到这里</small> : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="phone-progress-open"
                    onClick={() => onOpenNotebook(notebook)}
                    aria-label={`打开 ${notebook.name}`}
                  >
                    <BookOpen size={17} />
                  </button>
                </div>
              );
            })}
          </div>
          {completed > 0 ? (
            <div className="phone-group">
              <button
                type="button"
                className="phone-row phone-row-button phone-row-danger"
                onClick={() => setCompleted(0)}
              >
                <RotateCcw size={17} />
                <span className="phone-row-copy">
                  <strong>清空进度</strong>
                </span>
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <PhoneEmpty title="还没有笔记" hint="在网页上传课程资料后，就可以在这里标记学习进度。" />
      )}
    </PhonePage>
  );
}

export function PhoneMemoryPage({
  courseId,
  courseLabel,
  backgroundUrl,
  notebooks,
  memories,
  focusedMemoryId,
  onBack,
}: {
  courseId: string;
  courseLabel: string;
  backgroundUrl?: string;
  notebooks: LocalNotebook[];
  memories: LocalStudyMemory[];
  focusedMemoryId: string | null;
  onBack: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(focusedMemoryId);
  const [filter, setFilter] = useState<MarbleColor | 'stale' | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [reviewed, setReviewed] = useState(() => readReviewedMap());
  // 记忆很多时星图只画最近的 100 颗，其余是星尘；点开一章时这一章的全部画出来。
  const expandNotebookId = chapterId?.startsWith('notebook:') ? chapterId.slice(9) : null;
  const galaxy = useMemo(
    () =>
      buildMemoryGalaxy(
        {
          courseId,
          courseLabel,
          backgroundUrl,
          notebooks,
          memories,
          expandNotebookId,
          keepMemoryIds: [focusedMemoryId],
        },
        reviewed,
      ),
    [
      courseId,
      courseLabel,
      backgroundUrl,
      expandNotebookId,
      focusedMemoryId,
      memories,
      notebooks,
      reviewed,
    ],
  );
  const nodeById = useMemo(() => new Map(galaxy.nodes.map((node) => [node.id, node])), [galaxy]);
  // 星尘没有节点，新鲜度直接按记忆算。
  const freshnessById = useMemo(
    () => new Map(memories.map((memory) => [memory.id, memoryFreshness(memory, reviewed)])),
    [memories, reviewed],
  );
  const freshnessOf = (memoryId: string) => freshnessById.get(memoryId) ?? 1;
  const ordered = useMemo(
    () =>
      [...memories].sort((left, right) => {
        if (left.id === focusedMemoryId) return -1;
        if (right.id === focusedMemoryId) return 1;
        return right.updatedAt - left.updatedAt;
      }),
    [focusedMemoryId, memories],
  );
  const staleCount = memories.filter((memory) => freshnessOf(memory.id) < STALE_FRESHNESS).length;
  const legend = useMemo(
    () =>
      MEMORY_MARBLE_LEGEND.map((entry) => ({
        ...entry,
        count: memories.filter((memory) => memoryMarble(memory.kind).color === entry.color).length,
      })).filter((entry) => entry.count > 0),
    [memories],
  );
  const needle = query.trim().toLowerCase();
  const shown = ordered.filter((memory) => {
    if (chapterId && `notebook:${memory.notebookId}` !== chapterId) return false;
    if (filter === 'stale' && freshnessOf(memory.id) >= STALE_FRESHNESS) return false;
    if (filter && filter !== 'stale' && memoryMarble(memory.kind).color !== filter) return false;
    if (needle && !`${memory.title}\n${memory.text}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  // 筛选或搜索时，星图里只亮这些珠子。
  const filtering = Boolean(filter || needle || chapterId);
  const shownKey = filtering ? shown.map((memory) => memory.id).join('|') : '';
  const filterIds = useMemo(
    () => (filtering ? new Set(shownKey.split('|').filter(Boolean)) : null),
    [filtering, shownKey],
  );
  const chapter = chapterId ? nodeById.get(chapterId) : null;
  const listWindow = useListWindow(
    shown.length,
    `${courseId}:${filter}:${chapterId}:${needle}`,
    50,
  );

  // 点开一条记忆读一遍就算复习过：星图里那颗珠子的雾散开。
  const review = (memoryId: string) => {
    setActiveId(memoryId);
    if (freshnessOf(memoryId) < 0.99) setReviewed(markMemoryReviewed(memoryId));
  };

  const revealMemory = (memoryId: string) => {
    const index = shown.findIndex((memory) => memory.id === memoryId);
    if (index < 0) {
      setFilter(null);
      setChapterId(null);
      setQuery('');
    } else {
      listWindow.reveal(index);
    }
    review(memoryId);
    window.requestAnimationFrame(() =>
      document
        .getElementById(`phone-memory-${memoryId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
    );
  };

  const tapNode = (node: GalaxyNode) => {
    if (node.kind === 'memory') {
      revealMemory(node.id);
      return;
    }
    setActiveId(null);
    if (node.kind === 'core' || node.id === chapterId) {
      // 点课程球（或再点一次同一章）：回到全景。
      setChapterId(null);
      setFocusId(null);
      return;
    }
    setChapterId(node.id);
    setFocusId(node.id);
  };

  const toggleFilter = (next: MarbleColor | 'stale') =>
    setFilter((current) => (current === next ? null : next));

  const hasChapters = galaxy.nodes.some((node) => node.kind === 'chapter');

  return (
    <PhonePage title="学习记忆" overlay wide onBack={onBack}>
      {ordered.length ? (
        <div className="phone-memory-layout">
          <div className="phone-memory-galaxy">
            <div className="phone-memory-legend" role="group" aria-label="按类型筛选">
              {staleCount ? (
                <button
                  type="button"
                  className="is-stale"
                  aria-pressed={filter === 'stale'}
                  onClick={() => toggleFilter('stale')}
                >
                  <span className="phone-memory-stale-dot" aria-hidden />
                  该复习
                  <small>{staleCount}</small>
                </button>
              ) : null}
              {legend.map((entry) => (
                <button
                  type="button"
                  key={entry.color}
                  aria-pressed={filter === entry.color}
                  onClick={() => toggleFilter(entry.color)}
                >
                  <img src={marbleImages[entry.color]} alt="" />
                  {entry.label}
                  <small>{entry.count}</small>
                </button>
              ))}
            </div>
            <div className="phone-memory-visual">
              <MemoryGalaxyHero
                galaxy={galaxy}
                activeId={activeId}
                filterIds={filterIds}
                focusId={focusId}
                label="记忆星图：拖动、双指缩放，点珠子看记忆，点章节飞过去"
                onNodeTap={tapNode}
                onBackgroundTap={() => setActiveId(null)}
              />
              <p className="phone-memory-galaxy-count">
                <strong>{memories.length}</strong>
                <span>颗记忆</span>
              </p>
            </div>
          </div>

          <div className="phone-memory-side">
            <label className="phone-memory-search">
              <Search size={16} aria-hidden />
              <input
                type="search"
                value={query}
                placeholder="搜索记忆"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {chapter ? (
              <button
                type="button"
                className="phone-memory-chapter"
                onClick={() => {
                  setChapterId(null);
                  setFocusId(null);
                }}
              >
                <span
                  className={`phone-memory-chapter-dot is-${chapter.color ?? 'none'}`}
                  aria-hidden
                />
                <strong>{chapter.label}</strong>
                <small>{shown.length}</small>
                <X size={15} aria-hidden />
              </button>
            ) : null}
            <div className="phone-memory-list">
              {shown.slice(0, listWindow.count).map((memory) => {
                const marble = memoryMarble(memory.kind);
                const stale = freshnessOf(memory.id) < STALE_FRESHNESS;
                const open = memory.id === activeId;
                return (
                  <article
                    key={memory.id}
                    id={`phone-memory-${memory.id}`}
                    className={`phone-memory-card${open ? ' is-focused' : ''}${stale ? ' is-stale' : ''}`}
                    onClick={() => review(memory.id)}
                  >
                    <header>
                      <span className={`phone-memory-kind is-${marble.color}`}>
                        <img src={marbleImages[marble.color]} alt="" />
                        {marble.label}
                      </span>
                      <time>{stale ? '该复习了' : formatAgo(memory.updatedAt)}</time>
                    </header>
                    <h3>{memory.title}</h3>
                    <div className="phone-memory-text">
                      <ProblemRichText content={memory.text} />
                    </div>
                    {memory.reason && open ? <small>{memory.reason}</small> : null}
                  </article>
                );
              })}
              {listWindow.hasHidden ? (
                <GlassLoadMore onLoadMore={listWindow.showMore} watchKey={listWindow.count} />
              ) : null}
              {shown.length === 0 ? <p className="phone-memory-none">没有对上的记忆</p> : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="phone-memory-galaxy is-empty">
          <MemoryGalaxyHero galaxy={galaxy} label="还没有记忆的星图" />
          <p className="phone-memory-galaxy-empty">
            {hasChapters ? '还没有记忆珠' : '星图还是空的'}
            <small>聊天里确认“记住”后，会有一颗珠子飞进来。</small>
          </p>
        </div>
      )}
    </PhonePage>
  );
}

const LEARNING_EVENT_LABELS: Record<LocalCourseEventKind, string> = {
  assignment: '作业',
  exam: '考试',
  progress: '进度',
  tutorial: 'Tutorial',
  holiday: '假期',
  other: '事项',
};

const RESEARCH_EVENT_LABELS: Record<LocalCourseEventKind, string> = {
  assignment: 'DDL',
  exam: '会议',
  progress: '进展',
  tutorial: '论文阅读',
  holiday: '暂停',
  other: '事项',
};

const CALENDAR_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function formatDayHeading(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = CALENDAR_WEEKDAYS[date.getDay()];
  return key === localDayKey(new Date())
    ? `今天 · ${month}月${day}日`
    : `${month}月${day}日 周${weekday}`;
}

function calendarCountdown(dateKey: string, todayKey: string): string {
  const utcDay = (key: string) => {
    const [year, month, day] = key.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  const days = Math.round((utcDay(dateKey) - utcDay(todayKey)) / DAY_MS);
  return days === 1 ? '明天' : `${days} 天后`;
}

function PhoneEventRow({
  event,
  label,
  onClick,
}: {
  event: LocalCourseEvent;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="phone-row phone-row-button phone-event-row" onClick={onClick}>
      <span className={`phone-event-dot is-${event.kind}`} aria-hidden="true" />
      <span className="phone-row-copy">
        <strong>{event.title}</strong>
        <small>
          {label}
          {event.note ? ` · ${event.note}` : ''}
        </small>
      </span>
    </button>
  );
}

export function PhoneCalendarPage({
  title = '日历',
  initialDate,
  events,
  isResearchCourse,
  onAddEvent,
  onEditEvent,
  onBack,
}: {
  title?: string;
  initialDate?: string;
  events: LocalCourseEvent[];
  isResearchCourse: boolean;
  onAddEvent: (date: string) => void;
  onEditEvent: (event: LocalCourseEvent) => void;
  onBack: () => void;
}) {
  const [referenceDate, setReferenceDate] = useState(() =>
    initialDate ? new Date(`${initialDate}T12:00:00`) : new Date(),
  );
  const [selectedKey, setSelectedKey] = useState(() => initialDate ?? localDayKey(new Date()));
  const labels = isResearchCourse ? RESEARCH_EVENT_LABELS : LEARNING_EVENT_LABELS;
  const days = useMemo(
    () => buildLearningCalendarDays(referenceDate, events),
    [events, referenceDate],
  );
  const eventsByDay = useMemo(() => {
    const map = new Map<string, LocalCourseEvent[]>();
    for (const event of events) {
      const key = localDayKey(event.date);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [events]);
  const selectedEvents = eventsByDay.get(selectedKey) ?? [];
  const todayKey = localDayKey(new Date());
  const upcoming = useMemo(
    () =>
      events
        .filter(
          (event) => localDayKey(event.date) > todayKey && localDayKey(event.date) !== selectedKey,
        )
        .sort((left, right) => left.date.localeCompare(right.date))
        .slice(0, 6),
    [events, selectedKey, todayKey],
  );

  const shiftMonth = (delta: number) =>
    setReferenceDate((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));

  return (
    <PhonePage title={title} overlay wide onBack={onBack}>
      <div className="phone-calendar-layout">
        <section className="phone-group phone-calendar" aria-label="选择日期">
          <div className="phone-calendar-head">
            <strong>{formatCalendarMonth(referenceDate)}</strong>
            <div>
              <button type="button" onClick={() => shiftMonth(-1)} aria-label="上个月">
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                className="phone-calendar-today"
                onClick={() => {
                  setReferenceDate(new Date());
                  setSelectedKey(todayKey);
                }}
              >
                今天
              </button>
              <button type="button" onClick={() => shiftMonth(1)} aria-label="下个月">
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          <div className="phone-calendar-grid">
            {CALENDAR_WEEKDAYS.map((weekday) => (
              <span key={weekday} className="phone-calendar-weekday">
                {weekday}
              </span>
            ))}
            {days.map((day) => {
              const dayEvents = eventsByDay.get(day.key) ?? [];
              return (
                <button
                  type="button"
                  key={day.key}
                  className={`phone-calendar-day${day.inMonth ? '' : ' is-muted'}${day.isToday ? ' is-today' : ''}${day.key === selectedKey ? ' is-selected' : ''}`}
                  aria-label={`${day.key}${day.eventCount ? `，${day.eventCount} 项安排` : ''}`}
                  aria-pressed={day.key === selectedKey}
                  aria-current={day.isToday ? 'date' : undefined}
                  onClick={() => setSelectedKey(day.key)}
                >
                  <span className="phone-calendar-number">{day.day}</span>
                  {day.eventCount ? <i aria-hidden="true" /> : null}
                  <span className="phone-calendar-day-events" aria-hidden="true">
                    {dayEvents.slice(0, 2).map((event) => (
                      <span
                        key={event.id}
                        className={`phone-calendar-event-chip is-${event.kind}`}
                        title={`${labels[event.kind]} · ${event.title}`}
                      >
                        {event.title}
                      </span>
                    ))}
                    {dayEvents.length > 2 ? (
                      <span
                        className="phone-calendar-more"
                        title={`还有 ${dayEvents.length - 2} 项`}
                      >
                        +{dayEvents.length - 2}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="phone-calendar-agenda" aria-label="日程安排">
          <section
            className="phone-group phone-calendar-selected"
            aria-labelledby="calendar-day-title"
          >
            <header className="phone-calendar-agenda-head" aria-live="polite">
              <div>
                <h2 id="calendar-day-title">{formatDayHeading(selectedKey)}</h2>
                {selectedEvents.length ? <small>{selectedEvents.length} 项安排</small> : null}
              </div>
              <button
                type="button"
                className="phone-calendar-add"
                onClick={() => onAddEvent(selectedKey)}
                aria-label={`为${selectedKey}添加安排`}
                title="添加安排"
              >
                <Plus size={18} />
              </button>
            </header>
            {selectedEvents.length ? (
              selectedEvents.map((event) => (
                <PhoneEventRow
                  key={event.id}
                  event={event}
                  label={labels[event.kind]}
                  onClick={() => onEditEvent(event)}
                />
              ))
            ) : (
              <div className="phone-calendar-empty">
                <img src={marbleImages.blue} alt="" aria-hidden />
                <p>这天没有安排</p>
              </div>
            )}
          </section>

          {upcoming.length ? (
            <section aria-labelledby="calendar-upcoming-title">
              <h3 className="phone-group-title" id="calendar-upcoming-title">
                接下来
              </h3>
              <div className="phone-group">
                {upcoming.map((event) => (
                  <button
                    type="button"
                    key={event.id}
                    className="phone-row phone-row-button phone-event-row"
                    onClick={() => {
                      const key = localDayKey(event.date);
                      const [year, month] = key.split('-').map(Number);
                      setReferenceDate(new Date(year, month - 1, 1));
                      setSelectedKey(key);
                    }}
                  >
                    <span className={`phone-event-dot is-${event.kind}`} aria-hidden="true" />
                    <span className="phone-row-copy">
                      <strong>{event.title}</strong>
                      <small>
                        {labels[event.kind]} · {formatDayHeading(localDayKey(event.date))}
                      </small>
                    </span>
                    <span className="phone-calendar-countdown">
                      {calendarCountdown(localDayKey(event.date), todayKey)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </PhonePage>
  );
}

type ClassroomEntry = {
  id: string;
  title: string;
  updatedAt: number;
  conversationTitle: string;
} & (
  | { deck: PersistedMiniLectureDeck; remote?: never }
  | { deck?: never; remote: NativeSyncedMiniLecture }
);

/** 还没下载到本机的网页课堂（本机已有的那条回复上的课堂不重复显示）。 */
function remoteClassroomEntries(
  lectures: NativeSyncedMiniLecture[],
  localMessageIds: Set<string>,
): ClassroomEntry[] {
  return lectures
    .filter((lecture) => !localMessageIds.has(lecture.answerMessageId))
    .map((lecture) => ({
      id: lecture.id,
      title: lecture.title,
      updatedAt: lecture.createdAt,
      conversationTitle: '课程课堂',
      remote: lecture,
    }));
}

type ClassroomCover = { imageUrl: string; pageCount: number };

/** 课堂列表的封面：读出本机课堂的第一页图和页数，只读前 24 节；网页上还没下载的课堂没有封面。 */
function useClassroomCovers(entries: ClassroomEntry[] | null): Map<string, ClassroomCover> {
  const [covers, setCovers] = useState<Map<string, ClassroomCover>>(() => new Map());
  useEffect(() => {
    if (!entries?.length) return;
    let cancelled = false;
    void (async () => {
      const repository = await getLocalRepository();
      const local = entries.flatMap((entry) => (entry.deck ? [entry.deck] : [])).slice(0, 24);
      for (const deck of local) {
        try {
          const runtime = await repository.loadMiniLectureDeck(deck.id);
          const first = runtime?.pages[0];
          if (cancelled) return;
          if (!runtime || !first) continue;
          setCovers((current) =>
            new Map(current).set(deck.id, {
              imageUrl: first.imageUrl,
              pageCount: runtime.pages.length,
            }),
          );
        } catch {
          // 封面读不出来就只显示标题。
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entries]);
  return covers;
}

export function PhoneClassroomPage({
  courseId,
  conversations,
  revision,
  loadingDeckId,
  onOpenDeck,
  onOpenRemoteDeck,
  onBack,
}: {
  courseId: string;
  conversations: LocalConversation[];
  /** 网页课堂同步到本机后变化，用来重新读取列表。 */
  revision: number;
  loadingDeckId: string | null;
  onOpenDeck: (deck: PersistedMiniLectureDeck) => void;
  onOpenRemoteDeck: (lecture: NativeSyncedMiniLecture) => Promise<void>;
  onBack: () => void;
}) {
  const [entries, setEntries] = useState<ClassroomEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 网页课堂按页取：先 20 节，滚到底再取下一页。
  const [remoteCursor, setRemoteCursor] = useState<string | null>(null);
  const [remoteState, setRemoteState] = useState<LoadMoreState>('idle');
  const [localMessageIds, setLocalMessageIds] = useState<Set<string>>(() => new Set());
  const covers = useClassroomCovers(entries);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const repository = await getLocalRepository();
        const lists = await Promise.all(
          conversations.map(async (conversation) =>
            (await repository.listMiniLectureDecks(conversation.id)).map(
              (deck): ClassroomEntry => ({
                id: deck.id,
                title: deck.title,
                updatedAt: deck.updatedAt,
                deck,
                conversationTitle: conversation.title,
              }),
            ),
          ),
        );
        const local = lists.flat().filter((entry) => entry.deck?.status === 'ready');
        let remote: NativeSyncedMiniLecture[] = [];
        let cursor: string | null = null;
        if (await isPlatformCourse(repository, courseId)) {
          try {
            const page = await getNativeMiniLecturePage(courseId);
            remote = page.miniLectures;
            cursor = page.nextCursor;
          } catch (cause) {
            if (!cancelled)
              setError('课堂同步失败：' + (cause instanceof Error ? cause.message : String(cause)));
          }
        }
        if (cancelled) return;
        const messageIds = new Set(
          local.flatMap((entry) => (entry.deck ? [entry.deck.messageId] : [])),
        );
        setLocalMessageIds(messageIds);
        setRemoteCursor(cursor);
        setRemoteState('idle');
        setEntries(
          [...local, ...remoteClassroomEntries(remote, messageIds)].sort(
            (left, right) => right.updatedAt - left.updatedAt,
          ),
        );
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversations, courseId, revision]);

  const listWindow = useListWindow(entries?.length ?? 0, `${courseId}:${revision}`, 20);
  const loadMoreRemote = async () => {
    if (!remoteCursor) return;
    setRemoteState('loading');
    try {
      const page = await getNativeMiniLecturePage(courseId, remoteCursor);
      setEntries((current) => {
        const known = new Set(current?.map((entry) => entry.id));
        const more = remoteClassroomEntries(page.miniLectures, localMessageIds).filter(
          (entry) => !known.has(entry.id),
        );
        return [...(current ?? []), ...more];
      });
      setRemoteCursor(page.nextCursor);
      listWindow.showMore();
      setRemoteState('idle');
    } catch {
      setRemoteState('error');
    }
  };

  const openEntry = async (entry: ClassroomEntry) => {
    setError(null);
    try {
      if (entry.remote) await onOpenRemoteDeck(entry.remote);
      else onOpenDeck(entry.deck);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <PhonePage
      title="课堂"
      subtitle={entries?.length ? `${entries.length}${remoteCursor ? '+' : ''} 节` : undefined}
      overlay
      onBack={onBack}
    >
      {error ? <p className="phone-page-error">{error}</p> : null}
      {entries === null && !error ? (
        <GlassSkeletonRows rows={5} height={56} />
      ) : entries?.length ? (
        <>
          <div className="cl-grid">
            {entries.slice(0, listWindow.count).map((entry, index) => {
              const cover = covers.get(entry.id);
              const loading = loadingDeckId === entry.id;
              return (
                <button
                  type="button"
                  key={entry.id}
                  className={`cl-card${loading ? ' is-loading' : ''}`}
                  style={{ animationDelay: `${Math.min(index % 20, 12) * 40}ms` }}
                  disabled={loadingDeckId !== null}
                  onClick={() => void openEntry(entry)}
                >
                  <span className="cl-cover">
                    {cover ? <img src={cover.imageUrl} alt="" loading="lazy" /> : null}
                    <span className="cl-play">
                      {loading ? (
                        <GlassSpinner size={20} />
                      ) : (
                        <Play size={20} fill="currentColor" />
                      )}
                    </span>
                    {cover ? <span className="cl-pages">{cover.pageCount} 页</span> : null}
                  </span>
                  <span className="cl-copy">
                    <strong>{entry.title}</strong>
                    <small>
                      {entry.conversationTitle} · {formatAgo(entry.updatedAt)}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
          {listWindow.hasHidden ? (
            <GlassLoadMore onLoadMore={listWindow.showMore} watchKey={listWindow.count} />
          ) : remoteCursor ? (
            <GlassLoadMore
              onLoadMore={loadMoreRemote}
              state={remoteState}
              watchKey={entries.length}
            />
          ) : null}
        </>
      ) : entries && !error ? (
        <div className="cl-empty">
          <span className="cl-empty-screen" aria-hidden>
            <img src={classroomMarble} alt="" />
          </span>
          <strong>还没有课堂</strong>
          <small>在聊天里说「做成课堂讲解」</small>
        </div>
      ) : null}
    </PhonePage>
  );
}

/** iOS 风格的玻璃确认框：一句标题、最多一行说明、两个按钮。 */
export function PhoneConfirm({
  title,
  message,
  confirmLabel,
  cancelLabel = '取消',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="phone-confirm-layer" role="presentation">
      <button
        type="button"
        className="phone-confirm-backdrop"
        aria-label={cancelLabel}
        onClick={onCancel}
      />
      <section className="phone-confirm" role="alertdialog" aria-modal="true" aria-label={title}>
        <strong className="phone-confirm-title">{title}</strong>
        {message ? <p className="phone-confirm-message">{message}</p> : null}
        <div className="phone-confirm-actions">
          <button type="button" className="phone-confirm-button" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`phone-confirm-button is-primary${destructive ? ' is-destructive' : ''}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <GlassSpinner size={16} /> : null}
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
