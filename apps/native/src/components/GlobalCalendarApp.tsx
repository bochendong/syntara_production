import { useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';

import type { LocalCourseEventKind } from '../domain/learning-experiences';
import {
  buildEventsByDay,
  buildLearningCalendarDays,
  formatCalendarMonth,
  LearningCalendarGrid,
  type CalendarScheduleEvent,
} from './LearningCalendarGrid';

export type GlobalCalendarScheduleItem = {
  id: string;
  title: string;
  date: string;
  kind: LocalCourseEventKind;
  kindLabel: string;
  courseId: string;
  courseName: string;
  courseCode: string | null;
};

type GlobalCalendarAppProps = {
  schedules: GlobalCalendarScheduleItem[];
  onBack: () => void;
  onOpenCourse: (courseId: string) => void;
};

function shiftMonth(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function GlobalCalendarApp({ schedules, onBack, onOpenCourse }: GlobalCalendarAppProps) {
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const [dayItems, setDayItems] = useState<GlobalCalendarScheduleItem[]>([]);

  const calendarEvents = useMemo<CalendarScheduleEvent[]>(
    () =>
      schedules.map((item) => {
        const courseLabel = item.courseCode || item.courseName;
        const title = item.title.startsWith(courseLabel)
          ? item.title
          : `${courseLabel} · ${item.title}`;
        return {
          id: `${item.courseId}:${item.id}`,
          title,
          date: item.date,
          kind: item.kind,
        };
      }),
    [schedules],
  );

  const days = useMemo(
    () => buildLearningCalendarDays(referenceDate, calendarEvents),
    [calendarEvents, referenceDate],
  );
  const eventsByDay = useMemo(() => buildEventsByDay(calendarEvents), [calendarEvents]);
  const monthLabel = formatCalendarMonth(referenceDate);

  const kindCounts = useMemo(
    () => ({
      assignment: schedules.filter((item) => item.kind === 'assignment').length,
      exam: schedules.filter((item) => item.kind === 'exam').length,
      progress: schedules.filter((item) => item.kind === 'progress').length,
      tutorial: schedules.filter((item) => item.kind === 'tutorial').length,
    }),
    [schedules],
  );

  const resolveSchedule = (eventId: string) => {
    const [courseId, ...rest] = eventId.split(':');
    const scheduleId = rest.join(':');
    return schedules.find((item) => item.courseId === courseId && item.id === scheduleId) || null;
  };

  return (
    <section className="native-learn-calendar-app" aria-label="日历">
      <div className="native-learn-calendar-shell">
        <aside className="native-learn-calendar-aside">
          <button type="button" className="native-learn-calendar-back" onClick={onBack}>
            <ArrowLeft size={16} />
            返回主屏
          </button>
          <div className="native-learn-calendar-aside-copy">
            <span className="native-learn-calendar-eyebrow">
              <CalendarDays size={14} />
              全局日历
            </span>
            <strong>全部课程安排</strong>
            <small>汇总当前设备上所有课程的本机日程。</small>
          </div>
          <div className="native-learn-calendar-kind-list">
            {[
              { label: '作业', count: kindCounts.assignment, tone: 'assignment' },
              { label: '考试', count: kindCounts.exam, tone: 'exam' },
              { label: '进度', count: kindCounts.progress, tone: 'progress' },
              { label: 'Tutorial', count: kindCounts.tutorial, tone: 'tutorial' },
            ].map((item) => (
              <div key={item.label} className="native-learn-calendar-kind-row">
                <span className={`native-learn-calendar-kind-dot schedule-kind-${item.tone}`} />
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
          <p className="native-learn-calendar-aside-foot">{schedules.length} 项课程安排</p>
        </aside>

        <div className="native-learn-calendar-main">
          <header className="native-learn-calendar-toolbar">
            <h1>{monthLabel}</h1>
            <div className="native-learn-calendar-toolbar-actions">
              <button
                type="button"
                className="native-learn-calendar-today"
                onClick={() => setReferenceDate(new Date())}
              >
                今天
              </button>
              <button
                type="button"
                className="native-learn-calendar-nav"
                onClick={() => setReferenceDate((value) => shiftMonth(value, -1))}
                aria-label="上一个月"
              >
                <ChevronLeft size={16} strokeWidth={2} />
              </button>
              <button
                type="button"
                className="native-learn-calendar-nav"
                onClick={() => setReferenceDate((value) => shiftMonth(value, 1))}
                aria-label="下一个月"
              >
                <ChevronRight size={16} strokeWidth={2} />
              </button>
            </div>
          </header>

          <LearningCalendarGrid
            days={days}
            eventsByDay={eventsByDay}
            isResearchCourse={false}
            onSelectEvent={(event) => {
              const item = resolveSchedule(event.id);
              if (item) onOpenCourse(item.courseId);
            }}
            onSelectDay={(_date, events) => {
              const items = events
                .map((event) => resolveSchedule(event.id))
                .filter((item): item is GlobalCalendarScheduleItem => Boolean(item));
              setDayItems(items);
            }}
          />
        </div>
      </div>

      {dayItems.length > 0 ? (
        <div className="native-dialog-layer native-learn-calendar-day-layer">
          <button
            type="button"
            className="native-dialog-backdrop"
            aria-label="关闭当天安排"
            onClick={() => setDayItems([])}
          />
          <section
            className="native-action-dialog native-calendar-day-dialog-card"
            role="dialog"
            aria-modal="true"
            aria-label={`${dayItems[0]?.date || ''} 的安排`}
          >
            <header>
              <div>
                <span>全局日历</span>
                <h2>{dayItems[0]?.date || '当天安排'}</h2>
              </div>
              <button type="button" className="round-ghost-button" onClick={() => setDayItems([])} aria-label="关闭">
                <X size={17} />
              </button>
            </header>
            <div className="native-calendar-day-list">
              {dayItems.map((item) => (
                <button
                  type="button"
                  className="tool-action-row"
                  key={`${item.courseId}:${item.id}`}
                  onClick={() => {
                    setDayItems([]);
                    onOpenCourse(item.courseId);
                  }}
                >
                  <span className="tool-action-icon">
                    <CalendarDays size={17} />
                  </span>
                  <span>
                    <strong>
                      <span className={`schedule-kind-tag schedule-kind-${item.kind}`}>
                        {item.kindLabel}
                      </span>{' '}
                      {item.title}
                    </strong>
                    <small>{item.courseName}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
