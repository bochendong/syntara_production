import { useState } from 'react';
import './global-calendar.css';
import { PhoneCalendarPage } from './PhonePages';
import { useBackDismiss } from '../lib/use-back-dismiss';
import type { LocalCourseSummary } from '../domain/models';
import type { LocalCourseEvent } from '../domain/learning-experiences';

export function GlobalCalendarApp({
  courses,
  events,
  onOpenCourse,
  onBack,
}: {
  courses: LocalCourseSummary[];
  events: LocalCourseEvent[];
  onOpenCourse: (courseId: string, date?: string, createEvent?: boolean) => void;
  onBack: () => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  useBackDismiss(adding !== null, () => setAdding(null), 20);
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const visibleEvents = events
    .filter((event) => event.status === 'active' && courseById.has(event.courseId))
    .map((event) => {
      const course = courseById.get(event.courseId)!;
      return {
        ...event,
        id: JSON.stringify([event.courseId, event.id]),
        title: `${course.courseCode || course.name} · ${event.title}`,
      };
    });

  return (
    <>
      <PhoneCalendarPage
        title="总日历"
        events={visibleEvents}
        isResearchCourse={false}
        onAddEvent={setAdding}
        onEditEvent={(event) => onOpenCourse(event.courseId, event.date)}
        onBack={onBack}
      />
      {adding ? (
        <div className="global-calendar-dialog-backdrop">
          <section
            className="global-calendar-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-course-title"
          >
            <h2 id="calendar-course-title">选择课程添加安排</h2>
            <p>在课程日历中添加或编辑，安排会汇总到这里。</p>
            <div className="global-calendar-dialog-courses">
              {courses.map((course) => (
                <button
                  type="button"
                  key={course.id}
                  onClick={() => onOpenCourse(course.id, adding, true)}
                >
                  {course.courseCode} {course.name}
                </button>
              ))}
            </div>
            {!courses.length ? <p>还没有课程，请先在网页上创建或加入课程。</p> : null}
            <button
              type="button"
              className="global-calendar-action"
              autoFocus
              onClick={() => setAdding(null)}
            >
              取消
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
