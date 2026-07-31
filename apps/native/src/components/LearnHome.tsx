import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Database,
  FileUp,
  Library,
  Plus,
  Settings2,
  ShoppingBag,
  X,
} from 'lucide-react';

import cloudKingdomBackgroundUrl from '../../../../public/background/cloud-kingdom.webp?url';
import haruImageUrl from '../../../../public/home/syntara-haru-headline-transparent.png?url';
import calendarIconUrl from '../../../../public/learn/system-apps/calendar.svg?url';
import notificationsIconUrl from '../../../../public/learn/system-apps/notifications.svg?url';
import profileIconUrl from '../../../../public/learn/system-apps/profile.svg?url';
import settingsIconUrl from '../../../../public/learn/system-apps/settings.svg?url';
import storeIconUrl from '../../../../public/learn/system-apps/store.svg?url';
import { resolveNativeCourseAvatar } from '../assets';
import { getLocalRepository } from '../data/repository';
import type { LocalCourseEvent, LocalCourseEventKind } from '../domain/learning-experiences';
import type { LocalCourseSummary } from '../domain/models';
import { HaruLive2D } from './HaruLive2D';
import { GlobalCalendarApp } from './GlobalCalendarApp';
import { ProfileCenterApp } from './ProfileCenterApp';

const UPCOMING_SCHEDULE_LIMIT = 5;
const HOME_GRID_ROWS = 4;

function resolveHomeAppColumns(width: number): number {
  if (width >= 1_080) return 4;
  if (width >= 820) return 3;
  return 2;
}

function homeIconGridStyle(index: number, appColumns: number): CSSProperties {
  return {
    gridColumn: 3 + (index % appColumns),
    gridRow: Math.floor(index / appColumns) + 1,
  };
}

type LearnHomeProps = {
  courses: LocalCourseSummary[];
  activeCourseId: string | null;
  backendLabel: string;
  loadDuration: number | null;
  migrationBusy: boolean;
  onCreateCourse: () => void;
  onImportArchive: () => void;
  onOpenCourse: (courseId: string) => void;
};

type DockAppId = 'calendar' | 'profile' | 'notifications' | 'store' | 'settings';

type DockApp = {
  id: DockAppId;
  label: string;
  iconUrl: string;
};

type HomeScheduleItem = {
  id: string;
  title: string;
  date: string;
  kind: LocalCourseEventKind;
  kindLabel: string;
  course: LocalCourseSummary;
};

const dockApps: DockApp[] = [
  { id: 'calendar', label: '日历', iconUrl: calendarIconUrl },
  { id: 'profile', label: '个人中心', iconUrl: profileIconUrl },
  { id: 'notifications', label: '通知中心', iconUrl: notificationsIconUrl },
  { id: 'store', label: '课程商城', iconUrl: storeIconUrl },
  { id: 'settings', label: '设置', iconUrl: settingsIconUrl },
];

const KIND_LABELS: Record<LocalCourseEventKind, string> = {
  assignment: '作业',
  exam: '考试',
  progress: '进度',
  tutorial: 'Tutorial',
  holiday: '假期',
  other: '事项',
};

const RESEARCH_KIND_LABELS: Record<LocalCourseEventKind, string> = {
  assignment: 'DDL',
  exam: '会议',
  progress: '进展',
  tutorial: '论文阅读',
  holiday: '暂停',
  other: '事项',
};

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function scheduleKindLabel(kind: LocalCourseEventKind, isResearchCourse: boolean): string {
  return (isResearchCourse ? RESEARCH_KIND_LABELS : KIND_LABELS)[kind];
}

function toHomeScheduleItem(event: LocalCourseEvent, course: LocalCourseSummary): HomeScheduleItem {
  return {
    id: event.id,
    title: event.title,
    date: event.date,
    kind: event.kind,
    kindLabel: scheduleKindLabel(event.kind, course.purpose === 'research'),
    course,
  };
}

export function LearnHome({
  courses,
  activeCourseId,
  backendLabel,
  loadDuration,
  migrationBusy,
  onCreateCourse,
  onImportArchive,
  onOpenCourse,
}: LearnHomeProps) {
  const [page, setPage] = useState(0);
  const [activeDockApp, setActiveDockApp] = useState<DockAppId | null>(null);
  const [allSchedules, setAllSchedules] = useState<HomeScheduleItem[]>([]);
  const [avatarRevision, setAvatarRevision] = useState(0);
  const [appColumns, setAppColumns] = useState(4);
  const stageRef = useRef<HTMLDivElement>(null);
  const homeItems = useMemo(
    () => [
      { id: 'new-course', kind: 'create' as const },
      ...courses.map((course) => ({ id: course.id, kind: 'course' as const, course })),
    ],
    [courses],
  );
  const iconsPerPage = appColumns * HOME_GRID_ROWS;
  const pageCount = Math.max(1, Math.ceil(homeItems.length / iconsPerPage));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleItems = homeItems.slice(
    currentPage * iconsPerPage,
    (currentPage + 1) * iconsPerPage,
  );
  const totals = useMemo(
    () =>
      courses.reduce(
        (summary, course) => ({
          problems: summary.problems + course.problemCount,
          notebooks: summary.notebooks + course.notebookCount,
          conversations: summary.conversations + course.conversationCount,
        }),
        { problems: 0, notebooks: 0, conversations: 0 },
      ),
    [courses],
  );
  const todayDateKey = localDateKey(new Date());
  const upcomingSchedules = useMemo(
    () =>
      allSchedules.filter((item) => item.date >= todayDateKey).slice(0, UPCOMING_SCHEDULE_LIMIT),
    [allSchedules, todayDateKey],
  );

  useEffect(() => {
    let cancelled = false;

    void getLocalRepository()
      .then(async (repository) => {
        const nested = await Promise.all(
          courses.map(async (course) => {
            const events = await repository.listCourseEvents(course.id);
            return events.map((event) => toHomeScheduleItem(event, course));
          }),
        );
        return nested.flat();
      })
      .then((items) => {
        if (cancelled) return;
        const sorted = items.sort(
          (left, right) =>
            left.date.localeCompare(right.date) ||
            left.title.localeCompare(right.title, 'zh-CN') ||
            left.course.name.localeCompare(right.course.name, 'zh-CN'),
        );
        setAllSchedules(sorted);
      })
      .catch(() => {
        if (!cancelled) setAllSchedules([]);
      });

    return () => {
      cancelled = true;
    };
  }, [courses]);

  useEffect(() => {
    const refreshAvatars = () => setAvatarRevision((value) => value + 1);
    window.addEventListener('syntara-native-course-avatar-changed', refreshAvatars);
    return () => window.removeEventListener('syntara-native-course-avatar-changed', refreshAvatars);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const updateColumns = (width: number) => {
      setAppColumns((current) => {
        const next = resolveHomeAppColumns(width);
        return current === next ? current : next;
      });
    };
    updateColumns(stage.getBoundingClientRect().width);

    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateColumns(entry.contentRect.width);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="native-learn-home" aria-label="学习应用主页">
      {activeDockApp === 'calendar' ? (
        <GlobalCalendarApp
          schedules={allSchedules.map((item) => ({
            id: item.id,
            title: item.title,
            date: item.date,
            kind: item.kind,
            kindLabel: item.kindLabel,
            courseId: item.course.id,
            courseName: item.course.name,
            courseCode: item.course.courseCode,
          }))}
          onBack={() => setActiveDockApp(null)}
          onOpenCourse={(courseId) => {
            setActiveDockApp(null);
            onOpenCourse(courseId);
          }}
        />
      ) : null}

      {activeDockApp === 'profile' ? (
        <ProfileCenterApp
          courseCount={courses.length}
          notebookCount={totals.notebooks}
          problemCount={totals.problems}
          conversationCount={totals.conversations}
          onBack={() => setActiveDockApp(null)}
        />
      ) : null}

      <img
        className="native-learn-background-fill"
        src={cloudKingdomBackgroundUrl}
        alt=""
        aria-hidden
      />
      <img className="native-learn-background" src={cloudKingdomBackgroundUrl} alt="" aria-hidden />
      <span className="native-learn-wash" aria-hidden />
      <span className="native-learn-bloom native-learn-bloom-a" aria-hidden />
      <span className="native-learn-bloom native-learn-bloom-b" aria-hidden />
      <span className="native-learn-bloom native-learn-bloom-c" aria-hidden />

      <div className="native-learn-shell">
        <div
          ref={stageRef}
          className="native-learn-stage"
          style={{ '--home-app-columns': appColumns } as CSSProperties}
        >
          <article className="native-learn-widget native-learn-schedule">
            <button
              type="button"
              className="native-learn-schedule-header"
              onClick={() => setActiveDockApp('calendar')}
            >
              <span>
                <CalendarDays size={19} strokeWidth={2} />
                本周课程
              </span>
              <ChevronRight size={20} strokeWidth={2.1} />
            </button>
            {upcomingSchedules.length ? (
              <div className="native-learn-schedule-list">
                {upcomingSchedules.map((item) => {
                  const eventDate = new Date(`${item.date}T12:00:00`);
                  return (
                    <button
                      type="button"
                      key={`${item.course.id}:${item.id}`}
                      className="native-learn-schedule-row"
                      onClick={() => onOpenCourse(item.course.id)}
                      aria-label={`${item.course.name}：${item.title}，${item.date}`}
                    >
                      <span className="native-learn-schedule-date">
                        <small>{eventDate.getMonth() + 1}月</small>
                        <strong>{eventDate.getDate()}</strong>
                      </span>
                      <span className="native-learn-schedule-copy">
                        <strong>{item.course.name}</strong>
                        <small>
                          {item.kindLabel} · {item.title}
                        </small>
                      </span>
                      <span
                        className={`native-learn-schedule-dot schedule-kind-${item.kind}`}
                        aria-hidden
                      />
                    </button>
                  );
                })}
              </div>
            ) : (
              <button
                type="button"
                className="native-learn-schedule-empty"
                onClick={() => setActiveDockApp('calendar')}
              >
                <CalendarDays size={28} strokeWidth={1.7} />
                <strong>暂无近期课程日程</strong>
                <span>打开日历添加学习安排</span>
              </button>
            )}
            <footer>
              <span>
                <Database size={12} />
                {backendLabel}
              </span>
              {loadDuration !== null ? <span>{loadDuration.toFixed(1)} ms</span> : null}
            </footer>
          </article>

          <article className="native-learn-widget native-learn-haru" aria-label="Haru 学习伙伴">
            <HaruLive2D fallbackSrc={haruImageUrl} />
            <div className="native-learn-haru-copy">
              <span>SYNTARA</span>
              <strong>Haru</strong>
              <small>你的本地学习伙伴</small>
            </div>
          </article>

          <div className="native-learn-icons" aria-label="课程与学习应用">
            {visibleItems.map((item, index) => {
              const gridStyle = homeIconGridStyle(index, appColumns);
              if (item.kind === 'create') {
                return (
                  <button
                    type="button"
                    className="native-learn-app-icon"
                    key={item.id}
                    style={gridStyle}
                    onClick={onCreateCourse}
                  >
                    <span className="native-learn-app-art native-learn-create-art">
                      <Plus size={31} strokeWidth={1.8} />
                    </span>
                    <strong>新建课程</strong>
                  </button>
                );
              }
              const active = item.course.id === activeCourseId;
              return (
                <button
                  type="button"
                  className={`native-learn-app-icon${active ? ' native-learn-app-icon-active' : ''}`}
                  key={item.id}
                  style={gridStyle}
                  onClick={() => onOpenCourse(item.course.id)}
                  aria-label={`打开课程 ${item.course.name}`}
                >
                  <span className="native-learn-app-art native-learn-course-art">
                    <img
                      key={`${item.course.id}:${avatarRevision}`}
                      src={resolveNativeCourseAvatar(item.course.id, item.course.courseCode)}
                      alt=""
                      aria-hidden
                      draggable={false}
                    />
                  </span>
                  <strong>{item.course.name}</strong>
                  <small className="native-learn-course-meta">
                    {item.course.notebookCount} 笔记 · {item.course.conversationCount} 对话
                  </small>
                </button>
              );
            })}
          </div>
        </div>

        <nav className="native-learn-pagination" aria-label="主屏分页">
          {pageCount > 1 ? (
            <button
              type="button"
              className="native-learn-page-arrow"
              onClick={() => setPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              aria-label="上一页"
            >
              <ChevronLeft size={16} />
            </button>
          ) : null}
          {Array.from({ length: pageCount }, (_, index) => (
            <button
              type="button"
              key={index}
              className={
                index === currentPage
                  ? 'native-learn-page-dot native-learn-page-active'
                  : 'native-learn-page-dot'
              }
              onClick={() => setPage(index)}
              aria-label={`第 ${index + 1} 页`}
              aria-current={index === currentPage ? 'page' : undefined}
            />
          ))}
          {pageCount > 1 ? (
            <button
              type="button"
              className="native-learn-page-arrow"
              onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
              disabled={currentPage === pageCount - 1}
              aria-label="下一页"
            >
              <ChevronRight size={16} />
            </button>
          ) : null}
        </nav>

        <nav className="native-learn-dock" aria-label="系统应用 Dock">
          {dockApps.map((app) => (
            <button
              type="button"
              key={app.id}
              onClick={() => setActiveDockApp(app.id)}
              aria-label={app.label}
              title={app.label}
            >
              <img src={app.iconUrl} alt="" aria-hidden draggable={false} />
              <span>{app.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {activeDockApp && activeDockApp !== 'calendar' && activeDockApp !== 'profile' ? (
        <div className="native-dialog-layer">
          <button
            type="button"
            className="native-dialog-backdrop"
            onClick={() => setActiveDockApp(null)}
            aria-label={`关闭${dockApps.find((app) => app.id === activeDockApp)?.label || '系统应用'}`}
          />
          <section
            className="native-action-dialog native-learn-system-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="native-learn-system-title"
          >
            <header>
              <div>
                <span>本机系统应用</span>
                <h2 id="native-learn-system-title">
                  {dockApps.find((app) => app.id === activeDockApp)?.label}
                </h2>
              </div>
              <button
                type="button"
                className="round-ghost-button"
                onClick={() => setActiveDockApp(null)}
                aria-label="关闭"
              >
                <X size={17} />
              </button>
            </header>

            {activeDockApp === 'notifications' ? (
              <div className="native-system-app-content">
                <div className="native-system-summary">
                  <Bell size={20} />
                  <div>
                    <strong>本机通知中心</strong>
                    <small>迁移、资料导入和课程日程会在这里汇总。</small>
                  </div>
                </div>
                <article className="native-system-note">
                  <Database size={16} />
                  <div>
                    <strong>本地资料已就绪</strong>
                    <small>
                      当前可离线读取 {courses.length} 门课程、{totals.problems} 道题和{' '}
                      {totals.notebooks} 个笔记本。
                    </small>
                  </div>
                </article>
              </div>
            ) : null}

            {activeDockApp === 'store' ? (
              <div className="native-system-app-content">
                <div className="native-system-summary">
                  <ShoppingBag size={20} />
                  <div>
                    <strong>本地课程包</strong>
                    <small>从 Syntara 迁移包安装课程，不需要连接线上数据库。</small>
                  </div>
                </div>
                <button
                  type="button"
                  className="native-system-primary-action"
                  onClick={() => {
                    setActiveDockApp(null);
                    onImportArchive();
                  }}
                  disabled={migrationBusy}
                >
                  <FileUp size={17} />
                  {migrationBusy ? '正在迁移' : '选择课程迁移包'}
                </button>
              </div>
            ) : null}

            {activeDockApp === 'settings' ? (
              <div className="native-system-app-content">
                <div className="native-system-summary">
                  <Settings2 size={20} />
                  <div>
                    <strong>本地优先</strong>
                    <small>课程、题库、笔记本和会话默认从当前设备读取。</small>
                  </div>
                </div>
                <div className="native-system-settings-list">
                  <span>
                    <Library size={16} />
                    <small>数据源</small>
                    <strong>{backendLabel}</strong>
                  </span>
                  <span>
                    <Database size={16} />
                    <small>课程内容</small>
                    <strong>{totals.problems} 道题</strong>
                  </span>
                </div>
              </div>
            ) : null}

            <footer>
              <span>不依赖线上数据库</span>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setActiveDockApp(null)}
              >
                完成
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
