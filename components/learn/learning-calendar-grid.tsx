'use client';

import type { PracticePlan } from '@/lib/learning/course-learner-state';
import type {
  SyllabusCalendarEvent,
  SyllabusEventKind,
} from '@/features/learn-core/client-calendar-actions';
import { cn } from '@/lib/utils';

const CALENDAR_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export type LearningCalendarDay = {
  key: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  planCount: number;
  syllabusCount: number;
};

function localDayKey(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function planTimestamp(plan: PracticePlan): number {
  return plan.status === 'completed' && plan.completedAt ? plan.completedAt : plan.createdAt;
}

export function buildLearningCalendarDays(
  referenceDate: Date,
  plans: PracticePlan[],
  syllabusEvents: SyllabusCalendarEvent[],
): LearningCalendarDay[] {
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());
  const todayKey = localDayKey(new Date());
  const planCountByDay = new Map<string, number>();
  for (const plan of plans) {
    const key = localDayKey(planTimestamp(plan));
    planCountByDay.set(key, (planCountByDay.get(key) || 0) + 1);
  }
  const syllabusCountByDay = new Map<string, number>();
  for (const event of syllabusEvents) {
    syllabusCountByDay.set(event.date, (syllabusCountByDay.get(event.date) || 0) + 1);
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
      planCount: planCountByDay.get(key) || 0,
      syllabusCount: syllabusCountByDay.get(key) || 0,
    };
  });
}

export function buildSyllabusEventsByDay(
  events: SyllabusCalendarEvent[],
): Map<string, SyllabusCalendarEvent[]> {
  const next = new Map<string, SyllabusCalendarEvent[]>();
  for (const event of events) {
    const items = next.get(event.date) || [];
    items.push(event);
    next.set(event.date, items);
  }
  return next;
}

function eventTone(kind: SyllabusEventKind): string {
  if (kind === 'assignment') return 'bg-sky-500';
  if (kind === 'exam') return 'bg-rose-500';
  if (kind === 'progress') return 'bg-amber-500';
  if (kind === 'tutorial') return 'bg-violet-500';
  if (kind === 'holiday') return 'bg-emerald-500';
  return 'bg-slate-400';
}

function eventPillTone(kind: SyllabusEventKind): string {
  if (kind === 'assignment') return 'bg-sky-100 text-sky-800';
  if (kind === 'exam') return 'bg-rose-100 text-rose-800';
  if (kind === 'progress') return 'bg-amber-100 text-amber-800';
  if (kind === 'tutorial') return 'bg-violet-100 text-violet-800';
  if (kind === 'holiday') return 'bg-emerald-100 text-emerald-800';
  return 'bg-slate-100 text-slate-700';
}

function eventLabel(kind: SyllabusEventKind, isResearchCourse: boolean): string {
  const learningLabels: Record<SyllabusEventKind, string> = {
    assignment: '作业',
    exam: '考试',
    progress: '进度',
    tutorial: 'Tutorial',
    holiday: '假期',
    other: '事项',
  };
  const researchLabels: Record<SyllabusEventKind, string> = {
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
  plansByCalendarDay,
  syllabusEventsByCalendarDay,
  isResearchCourse,
  maxVisibleItems = 3,
  className,
  onSelectEvent,
}: {
  days: LearningCalendarDay[];
  plansByCalendarDay?: Map<string, PracticePlan[]>;
  syllabusEventsByCalendarDay?: Map<string, SyllabusCalendarEvent[]>;
  isResearchCourse: boolean;
  maxVisibleItems?: number;
  className?: string;
  onSelectEvent?: (event: SyllabusCalendarEvent) => void;
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
          const dayPlans = plansByCalendarDay?.get(day.key) || [];
          const dayEvents = syllabusEventsByCalendarDay?.get(day.key) || [];
          const items = [
            ...dayPlans.map((plan) => ({
              id: `plan-${plan.id}`,
              title: plan.title,
              event: null,
              dotClassName: 'bg-emerald-500',
              pillClassName: 'bg-emerald-100 text-emerald-800',
            })),
            ...dayEvents.map((event) => ({
              id: `syllabus-${event.id}`,
              title: event.title,
              event,
              dotClassName: eventTone(event.kind),
              pillClassName: eventPillTone(event.kind),
            })),
          ];
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

              <div className="mt-1.5 space-y-1 overflow-hidden">
                {visibleItems.map((item) => {
                  const itemClassName = cn(
                    'flex h-5 w-full min-w-0 items-center gap-1.5 rounded-[5px] px-1.5 text-left text-[10px] font-semibold leading-none outline-none',
                    item.pillClassName,
                    item.event && onSelectEvent
                      ? 'cursor-pointer hover:brightness-[0.97] focus-visible:ring-2 focus-visible:ring-blue-500'
                      : 'cursor-default',
                  );
                  const content = (
                    <>
                      <span className={cn('size-1.5 shrink-0 rounded-full', item.dotClassName)} />
                      <span className="min-w-0 truncate">{item.title}</span>
                    </>
                  );
                  return item.event && onSelectEvent ? (
                    <button
                      key={item.id}
                      type="button"
                      className={itemClassName}
                      title={`${item.title} · ${eventLabel(item.event.kind, isResearchCourse)}`}
                      onClick={() => onSelectEvent(item.event!)}
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
                  <p className="truncate px-1.5 text-[10px] font-medium text-slate-400">
                    还有 {hiddenItemCount} 项
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
