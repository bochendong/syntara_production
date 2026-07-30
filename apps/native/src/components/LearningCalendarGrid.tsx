import { cn } from '../lib/cn';

export type LocalScheduleKind =
  | 'assignment'
  | 'exam'
  | 'progress'
  | 'tutorial'
  | 'holiday'
  | 'other';

export type CalendarScheduleEvent = {
  id: string;
  title: string;
  date: string;
  kind: LocalScheduleKind;
};

export type LearningCalendarDay = {
  key: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  eventCount: number;
};

const CALENDAR_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function localDayKey(value: number | Date | string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatCalendarMonth(value: Date): string {
  return `${value.getFullYear()}年${value.getMonth() + 1}月`;
}

export function buildLearningCalendarDays(
  referenceDate: Date,
  events: CalendarScheduleEvent[],
): LearningCalendarDay[] {
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());
  const todayKey = localDayKey(new Date());
  const countByDay = new Map<string, number>();
  for (const event of events) {
    const key = localDayKey(event.date);
    countByDay.set(key, (countByDay.get(key) || 0) + 1);
  }

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const key = localDayKey(date);
    return {
      key,
      day: date.getDate(),
      inMonth: date.getMonth() === referenceDate.getMonth(),
      isToday: key === todayKey,
      eventCount: countByDay.get(key) || 0,
    };
  });
}

export function buildEventsByDay(
  events: CalendarScheduleEvent[],
): Map<string, CalendarScheduleEvent[]> {
  const next = new Map<string, CalendarScheduleEvent[]>();
  for (const event of events) {
    const key = localDayKey(event.date);
    const items = next.get(key) || [];
    items.push(event);
    next.set(key, items);
  }
  return next;
}

function eventTone(kind: LocalScheduleKind): string {
  if (kind === 'assignment') return 'bg-sky-500';
  if (kind === 'exam') return 'bg-rose-500';
  if (kind === 'progress') return 'bg-amber-500';
  if (kind === 'tutorial') return 'bg-violet-500';
  if (kind === 'holiday') return 'bg-emerald-500';
  return 'bg-slate-400';
}

function eventPillTone(kind: LocalScheduleKind): string {
  if (kind === 'assignment') return 'bg-sky-100 text-sky-800';
  if (kind === 'exam') return 'bg-rose-100 text-rose-800';
  if (kind === 'progress') return 'bg-amber-100 text-amber-800';
  if (kind === 'tutorial') return 'bg-violet-100 text-violet-800';
  if (kind === 'holiday') return 'bg-emerald-100 text-emerald-800';
  return 'bg-slate-100 text-slate-700';
}

function eventLabel(kind: LocalScheduleKind, isResearchCourse: boolean): string {
  const learningLabels: Record<LocalScheduleKind, string> = {
    assignment: '作业',
    exam: '考试',
    progress: '进度',
    tutorial: 'Tutorial',
    holiday: '假期',
    other: '事项',
  };
  const researchLabels: Record<LocalScheduleKind, string> = {
    assignment: 'DDL',
    exam: '会议',
    progress: '进展',
    tutorial: '论文阅读',
    holiday: '暂停',
    other: '事项',
  };
  return (isResearchCourse ? researchLabels : learningLabels)[kind];
}

export function LearningCalendarGrid({
  days,
  eventsByDay,
  isResearchCourse,
  maxVisibleItems = 3,
  className,
  onSelectEvent,
  onSelectDay,
}: {
  days: LearningCalendarDay[];
  eventsByDay?: Map<string, CalendarScheduleEvent[]>;
  isResearchCourse: boolean;
  maxVisibleItems?: number;
  className?: string;
  onSelectEvent?: (event: CalendarScheduleEvent) => void;
  onSelectDay?: (date: string, events: CalendarScheduleEvent[]) => void;
}) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}>
      <div className="grid shrink-0 grid-cols-7 border-y border-black/[0.08] bg-white/70 text-right">
        {CALENDAR_WEEKDAYS.map((day) => (
          <div
            key={day}
            className="border-r border-black/[0.07] px-3 py-2 text-xs font-semibold text-slate-500 last:border-r-0"
          >
            周{day}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 overflow-hidden bg-white">
        {days.map((day) => {
          const dayEvents = eventsByDay?.get(day.key) || [];
          const items = dayEvents.map((event) => ({
            id: event.id,
            title: event.title,
            event,
            dotClassName: eventTone(event.kind),
            pillClassName: eventPillTone(event.kind),
          }));
          const visibleItems = items.slice(0, maxVisibleItems);
          const hiddenItemCount = items.length - visibleItems.length;

          return (
            <div
              key={day.key}
              className={cn(
                'min-h-0 border-b border-r border-black/[0.07] px-2 py-2 last:border-r-0',
                !day.inMonth ? 'bg-[#f7f7fa]' : 'bg-white',
              )}
            >
              <div className="flex justify-end">
                <span
                  className={cn(
                    'grid size-7 place-items-center rounded-full text-sm font-semibold leading-none',
                    day.inMonth ? 'text-slate-800' : 'text-slate-300',
                    day.isToday ? 'bg-[#ff3b30] text-white' : null,
                  )}
                >
                  {day.day}
                </span>
              </div>

              <div className="mt-1 space-y-0.5 overflow-hidden">
                {visibleItems.map((item) => {
                  const itemClassName = cn(
                    'flex h-4 w-full min-w-0 items-center gap-1 rounded-[4px] px-1 text-left text-[8px] font-medium leading-none outline-none',
                    item.pillClassName,
                    onSelectEvent ? 'cursor-pointer hover:brightness-[0.97]' : 'cursor-default',
                  );
                  const content = (
                    <>
                      <span className={cn('size-1 shrink-0 rounded-full', item.dotClassName)} />
                      <span className="min-w-0 truncate">{item.title}</span>
                    </>
                  );
                  return onSelectEvent ? (
                    <button
                      key={item.id}
                      type="button"
                      className={itemClassName}
                      title={`${item.title} · ${eventLabel(item.event.kind, isResearchCourse)}`}
                      onClick={() => onSelectEvent(item.event)}
                    >
                      {content}
                    </button>
                  ) : (
                    <div key={item.id} className={itemClassName} title={item.title}>
                      {content}
                    </div>
                  );
                })}
                {hiddenItemCount > 0 ? (
                  onSelectDay ? (
                    <button
                      type="button"
                      className="w-full truncate rounded px-1 py-0.5 text-left text-[8px] font-medium text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                      onClick={() => onSelectDay(day.key, dayEvents)}
                      aria-label={`查看 ${day.key} 的全部 ${dayEvents.length} 项安排`}
                    >
                      还有 {hiddenItemCount} 项
                    </button>
                  ) : (
                    <p className="truncate px-1 text-[8px] font-medium text-slate-400">
                      还有 {hiddenItemCount} 项
                    </p>
                  )
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LearningCalendarMini({
  days,
  className,
  onOpen,
}: {
  days: LearningCalendarDay[];
  className?: string;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'w-full rounded-[16px] border border-slate-200/80 bg-white p-3 text-left shadow-sm transition hover:border-slate-300',
        className,
      )}
      onClick={onOpen}
      aria-label="打开大日历"
    >
      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-slate-400">
        {CALENDAR_WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => (
          <span
            key={day.key}
            className={cn(
              'relative grid aspect-square place-items-center rounded-full text-[11px] font-semibold',
              day.inMonth ? 'text-slate-700' : 'text-slate-300',
              day.isToday ? 'bg-[#ff3b30] text-white' : null,
              !day.isToday && day.eventCount > 0 ? 'ring-1 ring-slate-200' : null,
            )}
          >
            {day.day}
            {day.eventCount > 0 && !day.isToday ? (
              <span className="absolute bottom-0.5 size-1 rounded-full bg-sky-500" />
            ) : null}
          </span>
        ))}
      </div>
    </button>
  );
}
