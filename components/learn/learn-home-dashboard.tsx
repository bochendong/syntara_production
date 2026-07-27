'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarDays, ChevronRight, Loader2, Plus } from 'lucide-react';
import { resolveCourseAvatarDisplayUrl } from '@/lib/constants/course-avatars';
import { useSettingsStore } from '@/lib/store/settings';
import { LearnBackgroundVisual } from '@/components/learn/learn-background-visual';
import {
  readSyllabusEvents,
  readSyllabusEventsSnapshot,
  subscribeToSyllabusEventChanges,
  type SyllabusCalendarEvent,
  type SyllabusEventKind,
} from '@/features/learn-core/client-calendar-actions';
import { useAuthStore } from '@/lib/store/auth';
import type { CourseRecord } from '@/lib/utils/database';
import { cn } from '@/lib/utils';

const HOME_ICONS_PER_PAGE = 16;
const LEARN_HOME_ICON_ORDER_STORAGE_KEY = 'syntara:learn-home-icon-order:v1';
const LEARN_HOME_ICON_ORDER_EVENT = 'syntara:learn-home-icon-order-change';
const SORTABLE_TRANSITION = {
  duration: 180,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
};
const DROP_ANIMATION = {
  duration: 220,
  easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
};

const HaruLive2D = dynamic(
  () =>
    import('@/components/canvas/talking-avatar-overlay').then(
      (module) => module.TalkingAvatarOverlay,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="relative h-full w-full" aria-hidden="true">
        <Image
          src="/home/syntara-haru-headline-transparent.png"
          alt=""
          width={512}
          height={512}
          sizes="(min-width: 1024px) 400px, 100vw"
          className="h-full w-full object-contain object-bottom opacity-90"
          priority
        />
      </div>
    ),
  },
);

const LEARN_HOME_PREVIEW_PRIMARY_COURSES: CourseRecord[] = [
  ['preview-csc148', 'CSC148', 'CSC148', '算法设计与分析', 'university'],
  ['preview-mat136', 'MAT136', 'MAT136', '线性代数B', 'university'],
  ['preview-mat102', 'MAT102', 'MAT102', '微积分A', 'university'],
  ['preview-proofs', 'GROUP', '群论', '抽象代数', 'university'],
  ['preview-csc108', 'RESEARCH', '研究方法', '学术研究导论', 'research'],
  ['preview-mat137', 'MAT137', 'MAT137', '微积分', 'university'],
  ['preview-csc236', 'CSC236', 'CSC236', '理论基础', 'university'],
  ['preview-mat223', 'MAT223', '线性代数', 'MAT223', 'university'],
  ['preview-sta257', 'STA257', '概率论', 'STA257', 'university'],
  ['preview-research', 'RESEARCH', '研究方法', 'Research', 'research'],
  ['preview-algebra', 'ALGEBRA', '群论', 'Group Theory', 'university'],
  ['preview-csc373', 'CSC373', '算法设计', 'CSC373', 'university'],
  ['preview-sta302', 'STA302', '统计学', 'STA302', 'university'],
  ['preview-calculus', 'CALCULUS', '微积分 II', 'Calculus', 'university'],
].map(
  ([id, courseCode, name, secondary, purpose], index): CourseRecord => ({
    id,
    courseCode,
    name,
    description: name,
    language: 'zh-CN' as const,
    tags: [courseCode, secondary],
    purpose: purpose as CourseRecord['purpose'],
    university: secondary,
    createdAt: index,
    updatedAt: index,
  }),
);

export const LEARN_HOME_PREVIEW_COURSES: CourseRecord[] = [
  ...LEARN_HOME_PREVIEW_PRIMARY_COURSES,
  ...Array.from(
    { length: 15 },
    (_, index): CourseRecord => ({
      id: `preview-extra-${index + 1}`,
      courseCode: `COURSE${index + 1}`,
      name: `拓展课程 ${index + 1}`,
      description: '更多课程',
      language: 'zh-CN' as const,
      tags: ['更多课程'],
      purpose: 'daily' as const,
      createdAt: 100 + index,
      updatedAt: 100 + index,
    }),
  ),
];

type IconComponent = ComponentType<{
  className?: string;
  strokeWidth?: number;
  'aria-hidden'?: boolean;
}>;

type LearnHomeDashboardProps = {
  courses: CourseRecord[];
  activeCourseId: string | null;
  coursesLoading?: boolean;
  courseLoadError?: string | null;
  onCreateCourse: () => void;
  onOpenCalendar: () => void;
  onOpenCourse: (courseId: string) => void;
  onRetryCourseLoad?: () => void;
};

type SystemAppAction = 'calendar' | 'profile' | 'store' | 'settings' | 'create' | 'notifications';

type SystemApp = {
  label: string;
  secondary: string;
  Icon?: IconComponent;
  iconSrc?: string;
  background?: string;
  action: SystemAppAction;
};

type HomeIconItem =
  | { id: string; kind: 'system'; app: SystemApp }
  | { id: string; kind: 'course'; course: CourseRecord };

type HomeGridPosition = {
  column: number;
  row: number;
};

type UpcomingCourseEvent = {
  course: CourseRecord;
  event: SyllabusCalendarEvent;
};

const CALENDAR_EVENT_KIND_META: Record<SyllabusEventKind, { label: string; dotClassName: string }> =
  {
    assignment: { label: '作业', dotClassName: 'bg-[#ff453a]' },
    exam: { label: '考试', dotClassName: 'bg-[#ff9f0a]' },
    progress: { label: '学习计划', dotClassName: 'bg-[#0a84ff]' },
    tutorial: { label: '课程活动', dotClassName: 'bg-[#bf5af2]' },
    holiday: { label: '休息日', dotClassName: 'bg-[#30d158]' },
    other: { label: '其他事项', dotClassName: 'bg-slate-400' },
  };

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

const HOME_ICON_GRID_POSITIONS: HomeGridPosition[] = [
  { column: 3, row: 1 },
  { column: 4, row: 1 },
  { column: 5, row: 1 },
  { column: 6, row: 1 },
  { column: 3, row: 2 },
  { column: 4, row: 2 },
  { column: 5, row: 2 },
  { column: 6, row: 2 },
  { column: 3, row: 3 },
  { column: 4, row: 3 },
  { column: 5, row: 3 },
  { column: 6, row: 3 },
  { column: 3, row: 4 },
  { column: 4, row: 4 },
  { column: 5, row: 4 },
  { column: 6, row: 4 },
];

function homeGridStyle(position?: HomeGridPosition): CSSProperties | undefined {
  if (!position) return undefined;
  return {
    '--learn-home-grid-column': position.column,
    '--learn-home-grid-row': position.row,
  } as CSSProperties;
}

const SYSTEM_APPS: SystemApp[] = [
  {
    label: '日历',
    secondary: 'Calendar',
    iconSrc: '/learn/system-apps/calendar.svg',
    action: 'calendar',
  },
  {
    label: '个人中心',
    secondary: 'Profile',
    iconSrc: '/learn/system-apps/profile.svg',
    action: 'profile',
  },
  {
    label: '课程商城',
    secondary: 'Store',
    iconSrc: '/learn/system-apps/store.svg',
    action: 'store',
  },
  {
    label: '设置',
    secondary: 'Settings',
    iconSrc: '/learn/system-apps/settings.svg',
    action: 'settings',
  },
  {
    label: '通知中心',
    secondary: 'Notifications',
    iconSrc: '/learn/system-apps/notifications.svg',
    action: 'notifications',
  },
  {
    label: '新建课程',
    secondary: 'New course',
    Icon: Plus,
    background: 'linear-gradient(145deg, #a06cf7 0%, #713fe8 100%)',
    action: 'create',
  },
];

const DOCK_SYSTEM_APPS = SYSTEM_APPS.filter((app) => app.action !== 'create').sort(
  (left, right) => {
    const dockOrder: SystemAppAction[] = [
      'calendar',
      'profile',
      'notifications',
      'store',
      'settings',
    ];
    return dockOrder.indexOf(left.action) - dockOrder.indexOf(right.action);
  },
);

const HOME_GRID_SYSTEM_APPS = SYSTEM_APPS.filter((app) => app.action === 'create');

function mergeStoredOrder<T>(items: T[], storedIds: string[], getId: (item: T) => string): T[] {
  const itemById = new Map(items.map((item) => [getId(item), item]));
  const ordered = storedIds.flatMap((id) => {
    const item = itemById.get(id);
    if (!item) return [];
    itemById.delete(id);
    return [item];
  });
  return [...ordered, ...itemById.values()];
}

function subscribeToIconOrder(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === LEARN_HOME_ICON_ORDER_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener('storage', handleStorage);
  window.addEventListener(LEARN_HOME_ICON_ORDER_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(LEARN_HOME_ICON_ORDER_EVENT, onStoreChange);
  };
}

function readIconOrderSnapshot(): string {
  try {
    return localStorage.getItem(LEARN_HOME_ICON_ORDER_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function interleaveIds(first: string[], second: string[]): string[] {
  const merged: string[] = [];
  const length = Math.max(first.length, second.length);
  for (let index = 0; index < length; index += 1) {
    if (first[index]) merged.push(first[index]);
    if (second[index]) merged.push(second[index]);
  }
  return merged;
}

function parseIconOrderSnapshot(snapshot: string): string[] {
  try {
    const stored = JSON.parse(snapshot || '{}') as {
      items?: unknown;
      courses?: unknown;
      systemApps?: unknown;
    };
    if (Array.isArray(stored.items)) {
      return stored.items.filter((id): id is string => typeof id === 'string');
    }

    const legacyCourses = Array.isArray(stored.courses)
      ? stored.courses.filter((id): id is string => typeof id === 'string').map(courseSortableId)
      : [];
    const legacySystemApps = Array.isArray(stored.systemApps)
      ? stored.systemApps
          .filter((id): id is string => typeof id === 'string')
          .map((action) => systemAppSortableId(action as SystemAppAction))
      : [];
    return interleaveIds(legacySystemApps, legacyCourses);
  } catch {
    return [];
  }
}

function safePageCount(length: number): number {
  return Math.max(1, Math.ceil(length / HOME_ICONS_PER_PAGE));
}

function courseSortableId(courseId: string): string {
  return `course:${courseId}`;
}

function systemAppSortableId(action: SystemAppAction): string {
  return `system:${action}`;
}

function buildHomeIconItems(courses: CourseRecord[], systemApps: SystemApp[]): HomeIconItem[] {
  const appItems: HomeIconItem[] = systemApps.map((app) => ({
    id: systemAppSortableId(app.action),
    kind: 'system',
    app,
  }));
  const courseItems: HomeIconItem[] = courses.map((course) => ({
    id: courseSortableId(course.id),
    kind: 'course',
    course,
  }));
  const byId = new Map([...appItems, ...courseItems].map((item) => [item.id, item]));
  return interleaveIds(
    appItems.map((item) => item.id),
    courseItems.map((item) => item.id),
  ).flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

const HOME_ICON_BUTTON_CLASS_NAME =
  'group flex min-w-0 touch-manipulation select-none flex-col items-center rounded-[22px] px-1 pb-2 pt-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-blue-400/45';

function CourseIconContent({
  course,
  active,
}: {
  course: CourseRecord;
  active?: boolean;
}) {
  const avatarUrl = resolveCourseAvatarDisplayUrl(course.id, course.avatarUrl);
  return (
    <>
      <span
        className={cn(
          'relative grid size-[clamp(74px,6.3vw,96px)] shrink-0 place-items-center rounded-[22px] text-white transition-[transform,filter] duration-200 group-hover:-translate-y-0.5 group-hover:brightness-[1.04] group-focus-visible:-translate-y-0.5',
          active && 'ring-2 ring-white ring-offset-2 ring-offset-transparent',
        )}
      >
        <span className="relative size-full overflow-hidden rounded-[22px] shadow-[0_14px_30px_rgba(31,46,108,0.24)]">
          <Image
            src={avatarUrl}
            alt=""
            fill
            sizes="96px"
            className="object-cover"
            loading="eager"
            unoptimized
            aria-hidden
          />
        </span>
      </span>
      <span className="mt-2.5 block max-w-full truncate text-[15px] font-medium leading-5 tracking-[-0.02em] text-white [text-shadow:0_1px_6px_rgba(29,44,104,0.5)]">
        {course.name}
      </span>
    </>
  );
}

function SortableCourseIcon({
  course,
  active,
  gridPosition,
  onOpen,
}: {
  course: CourseRecord;
  active: boolean;
  gridPosition?: HomeGridPosition;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: courseSortableId(course.id),
    transition: SORTABLE_TRANSITION,
  });
  const style: CSSProperties = {
    ...homeGridStyle(gridPosition),
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.16 : 1,
    zIndex: isDragging ? 1 : undefined,
    willChange: 'transform',
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (!isDragging) onOpen();
      }}
      data-home-icon-group="course"
      data-home-icon-id={course.id}
      data-drag-state={isDragging ? 'source' : 'idle'}
      className={cn(
        HOME_ICON_BUTTON_CLASS_NAME,
        'learn-app-home__grid-item',
        isDragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
      aria-label={`打开课程 ${course.name}；可拖动排序`}
    >
      <CourseIconContent course={course} active={active} />
    </button>
  );
}

function SystemAppIconContent({
  app,
  compact = false,
  showLabel = true,
}: {
  app: SystemApp;
  compact?: boolean;
  showLabel?: boolean;
}) {
  const Icon = app.Icon;
  return (
    <>
      <span
        className={cn(
          'relative grid shrink-0 place-items-center overflow-hidden text-white transition-[transform,filter] duration-200 group-hover:-translate-y-0.5 group-hover:brightness-[1.04]',
          compact
            ? 'size-[clamp(56px,5.4vw,74px)] rounded-[20px]'
            : 'size-[clamp(74px,6.3vw,96px)] rounded-[22px]',
        )}
        style={{
          background: app.background,
          boxShadow: app.iconSrc
            ? undefined
            : compact
              ? '0 10px 22px rgba(31, 46, 108, 0.22)'
              : '0 14px 30px rgba(31, 46, 108, 0.24)',
        }}
      >
        {app.iconSrc ? (
          <Image
            src={app.iconSrc}
            width={104}
            height={104}
            alt=""
            className="size-full"
            loading="eager"
            aria-hidden
          />
        ) : Icon ? (
          <Icon className="size-[29%]" strokeWidth={1.75} aria-hidden />
        ) : null}
      </span>
      {showLabel ? (
        <span
          className={cn(
            'block max-w-full truncate font-medium tracking-[-0.02em] text-white [text-shadow:0_1px_6px_rgba(29,44,104,0.5)]',
            compact ? 'mt-1.5 text-[12px] leading-4' : 'mt-2.5 text-[15px] leading-5',
          )}
        >
          {app.label}
        </span>
      ) : null}
    </>
  );
}

function DockSystemAppIcon({
  app,
  onRun,
}: {
  app: SystemApp;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRun}
      title={app.label}
      aria-label={app.label}
      data-dock-system-app={app.action}
      className="group touch-manipulation rounded-[20px] outline-none transition-transform duration-200 hover:-translate-y-1 focus-visible:-translate-y-1 focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:translate-y-0 active:scale-[0.97]"
    >
      <SystemAppIconContent app={app} compact />
    </button>
  );
}

function SortableSystemAppIcon({
  app,
  gridPosition,
  onRun,
}: {
  app: SystemApp;
  gridPosition?: HomeGridPosition;
  onRun: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: systemAppSortableId(app.action),
    transition: SORTABLE_TRANSITION,
  });
  const style: CSSProperties = {
    ...homeGridStyle(gridPosition),
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.16 : 1,
    zIndex: isDragging ? 1 : undefined,
    willChange: 'transform',
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (!isDragging) onRun();
      }}
      data-home-icon-group="system"
      data-home-icon-id={app.action}
      data-drag-state={isDragging ? 'source' : 'idle'}
      className={cn(
        HOME_ICON_BUTTON_CLASS_NAME,
        'learn-app-home__grid-item',
        isDragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
      aria-label={`${app.label}；可拖动排序`}
    >
      <SystemAppIconContent app={app} />
    </button>
  );
}

function LiftedIcon({ children }: { children: ReactNode }) {
  return (
    <div
      aria-hidden
      className={cn(
        HOME_ICON_BUTTON_CLASS_NAME,
        'pointer-events-none cursor-grabbing scale-[1.06] opacity-[0.97] drop-shadow-[0_24px_28px_rgba(26,39,90,0.25)]',
      )}
    >
      {children}
    </div>
  );
}

function LearnHomeLoadingState() {
  return (
    <div
      className="relative z-10 flex h-full min-h-0 items-center justify-center px-5 py-8 sm:px-8 lg:px-10"
      role="status"
      aria-live="polite"
      aria-label="正在加载课程"
    >
      <div className="w-full max-w-[1120px] overflow-hidden rounded-[32px] border border-white/35 bg-slate-950/24 p-5 shadow-[0_28px_90px_rgba(15,23,42,0.24)] backdrop-blur-2xl sm:p-7">
        <div className="flex flex-col items-center text-center">
          <span className="relative grid size-14 place-items-center rounded-[18px] border border-white/35 bg-white/16 shadow-lg">
            <span className="absolute inset-2 animate-ping rounded-[12px] bg-white/12" />
            <Loader2 className="relative size-6 animate-spin text-white" strokeWidth={2} />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-[-0.025em] text-white sm:text-2xl">
            正在载入你的学习空间
          </h1>
          <p className="mt-1.5 text-sm text-white/72">正在连接课程数据库并恢复课程列表…</p>
        </div>

        <div className="mt-7 grid gap-5 lg:grid-cols-[310px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="h-[176px] animate-pulse rounded-[24px] border border-white/24 bg-white/13 p-4">
              <div className="h-5 w-28 rounded-full bg-white/26" />
              <div className="mt-5 space-y-3">
                {[0, 1, 2].map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-3 rounded-[14px] bg-white/12 p-2.5"
                  >
                    <div className="size-9 rounded-[10px] bg-white/24" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-3 w-3/4 rounded-full bg-white/24" />
                      <div className="h-2.5 w-1/2 rounded-full bg-white/14" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="h-[132px] animate-pulse rounded-[24px] border border-white/24 bg-white/13 p-4">
              <div className="h-4 w-24 rounded-full bg-white/24" />
              <div className="mt-5 h-16 rounded-[18px] bg-white/12" />
            </div>
          </div>

          <div className="grid grid-cols-3 content-start gap-x-5 gap-y-7 pt-2 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <div
                key={index}
                className="flex animate-pulse flex-col items-center gap-2.5"
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div className="size-[68px] rounded-[19px] border border-white/25 bg-white/18 shadow-lg sm:size-[76px]" />
                <div className="h-3 w-16 rounded-full bg-white/20 sm:w-20" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LearnHomeDashboard({
  courses,
  activeCourseId,
  coursesLoading,
  courseLoadError,
  onCreateCourse,
  onOpenCalendar,
  onOpenCourse,
  onRetryCourseLoad,
}: LearnHomeDashboardProps) {
  const router = useRouter();
  const userId = useAuthStore((state) => state.userId) || 'anonymous';
  const learnBackgroundId = useSettingsStore((state) => state.learnBackgroundId);
  const [now, setNow] = useState<Date | null>(null);
  const [page, setPage] = useState(1);
  const [draggedHomeIconId, setDraggedHomeIconId] = useState<string | null>(null);
  const dragSensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setNow(new Date()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const iconOrderSnapshot = useSyncExternalStore(
    subscribeToIconOrder,
    readIconOrderSnapshot,
    () => '',
  );
  const homeIconOrder = useMemo(
    () => parseIconOrderSnapshot(iconOrderSnapshot),
    [iconOrderSnapshot],
  );
  const orderedHomeIcons = useMemo(
    () =>
      mergeStoredOrder(
        buildHomeIconItems(courses, HOME_GRID_SYSTEM_APPS),
        homeIconOrder,
        (item) => item.id,
      ),
    [courses, homeIconOrder],
  );
  const courseCalendarIds = useMemo(() => courses.map((course) => course.id), [courses]);
  const syllabusEventsSnapshot = useSyncExternalStore(
    subscribeToSyllabusEventChanges,
    () => readSyllabusEventsSnapshot(userId, courseCalendarIds),
    () => '[]',
  );

  const pageCount = safePageCount(orderedHomeIcons.length);
  const currentPage = Math.min(page, pageCount);
  const visibleHomeIcons = orderedHomeIcons.slice(
    (currentPage - 1) * HOME_ICONS_PER_PAGE,
    currentPage * HOME_ICONS_PER_PAGE,
  );
  const visiblePages = Array.from({ length: Math.min(3, pageCount) }, (_, index) => {
    if (pageCount <= 3) return index + 1;
    const start = Math.min(Math.max(currentPage - 1, 1), pageCount - 2);
    return start + index;
  });
  const referenceDate = now ?? new Date(2026, 6, 21, 9, 41);
  const todayDateKey = localDateKey(referenceDate);
  const upcomingCourseEvents = useMemo<UpcomingCourseEvent[]>(() => {
    // The snapshot invalidates this aggregation when any course calendar changes.
    void syllabusEventsSnapshot;
    return courses
      .flatMap((course) =>
        readSyllabusEvents(userId, course.id).map((event) => ({ course, event })),
      )
      .filter(
        ({ event }) =>
          event.date >= todayDateKey && event.status !== 'done' && event.status !== 'skipped',
      )
      .sort(
        (left, right) =>
          left.event.date.localeCompare(right.event.date) ||
          left.event.title.localeCompare(right.event.title, 'zh-CN') ||
          left.course.name.localeCompare(right.course.name, 'zh-CN'),
      )
      .slice(0, 3);
  }, [courses, syllabusEventsSnapshot, todayDateKey, userId]);
  const draggedHomeIcon = draggedHomeIconId
    ? orderedHomeIcons.find((item) => item.id === draggedHomeIconId) || null
    : null;
  const persistIconOrder = (nextOrder: string[]) => {
    try {
      localStorage.setItem(LEARN_HOME_ICON_ORDER_STORAGE_KEY, JSON.stringify({ items: nextOrder }));
      window.dispatchEvent(new Event(LEARN_HOME_ICON_ORDER_EVENT));
    } catch {
      // Dragging should continue to work even when localStorage is unavailable.
    }
  };

  const startHomeIconDrag = ({ active }: DragStartEvent) => {
    setDraggedHomeIconId(String(active.id));
  };

  const finishHomeIconDrag = ({ active, over }: DragEndEvent) => {
    setDraggedHomeIconId(null);
    if (!over || active.id === over.id) return;
    const sourceId = String(active.id);
    const targetId = String(over.id);
    const orderedIds = orderedHomeIcons.map((item) => item.id);
    const sourceIndex = orderedIds.indexOf(sourceId);
    const targetIndex = orderedIds.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    persistIconOrder(arrayMove(orderedIds, sourceIndex, targetIndex));
  };

  const runSystemAction = (action: SystemAppAction) => {
    if (action === 'calendar') {
      router.push('/calendar');
      return;
    }
    if (action === 'profile') {
      router.push('/profile');
      return;
    }
    if (action === 'store') {
      router.push('/store/courses');
      return;
    }
    if (action === 'settings') {
      router.push('/settings');
      return;
    }
    if (action === 'create') {
      onCreateCourse();
      return;
    }
    if (action === 'notifications') {
      router.push('/notifications');
    }
  };

  return (
    <section
      data-learn-home-dashboard
      className="learn-app-home relative isolate h-full min-h-0 overflow-hidden text-white"
      aria-label="学习应用主页"
    >
      <LearnBackgroundVisual backgroundId={learnBackgroundId} className="absolute inset-0" />
      <div className="learn-app-home__wash absolute inset-0" aria-hidden="true" />
      <div className="learn-app-home__bloom learn-app-home__bloom--a" aria-hidden="true" />
      <div className="learn-app-home__bloom learn-app-home__bloom--b" aria-hidden="true" />
      <div className="learn-app-home__bloom learn-app-home__bloom--c" aria-hidden="true" />

      {coursesLoading && courses.length === 0 ? <LearnHomeLoadingState /> : null}

      {coursesLoading && courses.length === 0 ? null : (
        <div className="relative z-10 mx-auto flex h-full w-full max-w-[1320px] flex-col px-5 pb-4 pt-4 sm:px-8 lg:px-10">
          {courseLoadError ? (
            <div
              className="mb-2 flex shrink-0 items-center justify-between gap-3 rounded-[16px] border border-white/40 bg-slate-950/58 px-4 py-2.5 text-sm text-white shadow-lg backdrop-blur-xl"
              role="alert"
            >
              <span className="min-w-0 truncate">
                课程列表加载失败，数据仍然安全保存在数据库中。
              </span>
              {onRetryCourseLoad ? (
                <button
                  type="button"
                  onClick={onRetryCourseLoad}
                  className="shrink-0 rounded-full bg-white/18 px-3 py-1 text-xs font-semibold transition hover:bg-white/28 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  重试
                </button>
              ) : null}
            </div>
          ) : coursesLoading ? (
            <div
              className="mb-2 flex shrink-0 items-center gap-2 rounded-[16px] border border-white/30 bg-slate-950/38 px-4 py-2.5 text-sm text-white shadow-lg backdrop-blur-xl"
              role="status"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden />
              正在连接课程数据库并恢复课程列表…
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="learn-app-home__grid grid grid-cols-3 gap-x-5 gap-y-5 sm:grid-cols-6 sm:gap-x-6">
              <article className="learn-app-home__widget learn-app-home__widget--schedule col-span-3 min-h-[228px] rounded-[26px] border border-white/28 p-4 shadow-[0_20px_52px_rgba(28,43,114,0.14)] backdrop-blur-2xl sm:col-span-3 lg:col-span-2">
                <button
                  type="button"
                  onClick={onOpenCalendar}
                  className="flex w-full items-center justify-between rounded-xl px-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                >
                  <span className="flex items-center gap-2 text-[17px] font-medium">
                    <CalendarDays className="size-[19px]" strokeWidth={2} aria-hidden />
                    本周课程
                  </span>
                  <ChevronRight className="size-5 text-white/80" strokeWidth={2.1} aria-hidden />
                </button>
                <div className="mt-3 space-y-2">
                  {upcomingCourseEvents.map(({ course, event }) => {
                    const eventDate = new Date(`${event.date}T12:00:00`);
                    const kindMeta = CALENDAR_EVENT_KIND_META[event.kind];
                    return (
                      <button
                        key={`${course.id}:${event.id}`}
                        type="button"
                        onClick={() => onOpenCourse(course.id)}
                        aria-label={`${course.name}：${event.title}，${event.date}`}
                        className="flex w-full items-center gap-3 rounded-[16px] border border-white/18 bg-white/27 px-3 py-2 text-left outline-none transition hover:bg-white/35 focus-visible:ring-2 focus-visible:ring-white/85"
                      >
                        <span className="grid w-10 shrink-0 place-items-center rounded-[11px] bg-white/75 py-1 text-center shadow-sm">
                          <span className="text-[10px] font-semibold leading-3 text-[#ff3b30]">
                            {eventDate.getMonth() + 1}月
                          </span>
                          <span className="text-[20px] font-semibold leading-5 text-slate-900">
                            {eventDate.getDate()}
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium text-slate-900/82">
                            {course.name}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-slate-700/58">
                            {kindMeta.label} · {event.title}
                          </span>
                        </span>
                        <span
                          className={cn('size-2 rounded-full', kindMeta.dotClassName)}
                          aria-hidden
                        />
                      </button>
                    );
                  })}
                  {upcomingCourseEvents.length === 0 ? (
                    <button
                      type="button"
                      onClick={onOpenCalendar}
                      className="flex min-h-[150px] w-full flex-col items-center justify-center rounded-[16px] border border-dashed border-white/28 bg-white/16 px-4 text-center outline-none transition hover:bg-white/24 focus-visible:ring-2 focus-visible:ring-white/85"
                    >
                      <CalendarDays
                        className="size-7 text-white/72"
                        strokeWidth={1.7}
                        aria-hidden
                      />
                      <span className="mt-2 text-sm font-medium text-white/90">
                        暂无近期课程日程
                      </span>
                      <span className="mt-1 text-xs text-white/65">打开日历添加学习安排</span>
                    </button>
                  ) : null}
                </div>
              </article>

              <article
                className="learn-app-home__widget learn-app-home__widget--haru relative col-span-3 min-h-[260px] overflow-hidden rounded-[26px] border border-white/28 shadow-[0_20px_52px_rgba(28,43,114,0.14)] backdrop-blur-2xl sm:col-span-3 lg:col-span-2"
                aria-label="Haru Live2D 动态展示"
              >
                <div className="absolute inset-x-0 -bottom-20 top-9 -translate-y-7">
                  <HaruLive2D
                    layout="card"
                    cardFraming="half"
                    speaking={false}
                    cadence="idle"
                    modelIdOverride="haru"
                    showBadge={false}
                    showStatusDot={false}
                    className="h-full min-h-0 w-full"
                  />
                </div>
                <div className="relative z-10 flex items-center justify-end px-4 pt-4 [text-shadow:0_1px_6px_rgba(20,42,105,0.45)]">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/72">
                    Live2D
                  </span>
                </div>
              </article>
              <DndContext
                id="learn-home-icons-dnd"
                sensors={dragSensors}
                collisionDetection={closestCenter}
                onDragStart={startHomeIconDrag}
                onDragCancel={() => setDraggedHomeIconId(null)}
                onDragEnd={finishHomeIconDrag}
              >
                <SortableContext
                  items={visibleHomeIcons.map((item) => item.id)}
                  strategy={rectSortingStrategy}
                >
                  {visibleHomeIcons.map((item, index) => {
                    const gridPosition = HOME_ICON_GRID_POSITIONS[index];
                    if (item.kind === 'system') {
                      return (
                        <SortableSystemAppIcon
                          key={item.id}
                          app={item.app}
                          gridPosition={gridPosition}
                          onRun={() => runSystemAction(item.app.action)}
                        />
                      );
                    }

                    return (
                      <SortableCourseIcon
                        key={item.id}
                        course={item.course}
                        gridPosition={gridPosition}
                        active={item.course.id === activeCourseId}
                        onOpen={() => onOpenCourse(item.course.id)}
                      />
                    );
                  })}
                </SortableContext>
                <DragOverlay adjustScale={false} dropAnimation={DROP_ANIMATION} zIndex={60}>
                  {draggedHomeIcon ? (
                    <LiftedIcon>
                      {draggedHomeIcon.kind === 'system' ? (
                        <SystemAppIconContent
                          app={draggedHomeIcon.app}
                        />
                      ) : (
                        <CourseIconContent
                          course={draggedHomeIcon.course}
                          active={draggedHomeIcon.course.id === activeCourseId}
                        />
                      )}
                    </LiftedIcon>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>
          </div>

          <nav
            className="mb-[108px] flex h-7 shrink-0 items-center justify-center gap-2"
            aria-label="主屏分页"
          >
            {visiblePages.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => setPage(pageNumber)}
                className={cn(
                  'size-2.5 rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
                  currentPage === pageNumber
                    ? 'scale-110 bg-white shadow-[0_1px_8px_rgba(255,255,255,0.5)]'
                    : 'bg-white/38 hover:bg-white/65',
                )}
                aria-label={`第 ${pageNumber} 页`}
                aria-current={currentPage === pageNumber ? 'page' : undefined}
              />
            ))}
          </nav>

          <nav
            className="learn-app-home__dock fixed bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-start gap-2 rounded-[30px] border border-white/30 bg-white/24 px-3 py-2 shadow-[0_18px_46px_rgba(25,35,94,0.28)] backdrop-blur-2xl max-sm:left-[calc(50%+8px)] lg:absolute"
            aria-label="系统应用 Dock"
          >
            {DOCK_SYSTEM_APPS.map((app) => (
              <DockSystemAppIcon
                key={app.action}
                app={app}
                onRun={() => runSystemAction(app.action)}
              />
            ))}
          </nav>
        </div>
      )}
    </section>
  );
}
