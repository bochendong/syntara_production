import { useCallback, useEffect, useState } from 'react';
import { bundledMarbleAvatar, resolveNativeCourseAvatar } from '../assets';
import { getMyCourseApplications, type MyCourseApplication } from '../data/platform-api-client';
import { COURSE_APPLICATIONS_CHANGED, CourseJoinDialog } from './CourseJoinDialog';
import './course-join.css';

// App 收到这个事件会马上重新同步课程列表（平时 60 秒一次）。
const refreshCourses = () =>
  window.dispatchEvent(new Event('syntara-native-learner-profile-changed'));

/**
 * 侧边栏课程列表下面：申请了但还没进的课。待批准的进不去，可以改了重发；未通过的可以重新申请。
 * 老师批准后它就从这里消失，出现在正常的课程列表里。
 */
export function PendingCourseApplications({
  onJoined = refreshCourses,
}: {
  onJoined?: () => void;
}) {
  const [applications, setApplications] = useState<MyCourseApplication[]>([]);
  const [editing, setEditing] = useState<MyCourseApplication | null>(null);
  const load = useCallback(() => {
    void getMyCourseApplications()
      .then((next) => {
        setApplications((previous) => {
          // 之前在等、现在不在了：多半是批准了，让外面刷新课程列表。
          if (previous.some((item) => !next.some((entry) => entry.id === item.id))) onJoined?.();
          return next;
        });
      })
      .catch(() => {});
  }, [onJoined]);
  useEffect(() => {
    load();
    window.addEventListener(COURSE_APPLICATIONS_CHANGED, load);
    window.addEventListener('focus', load);
    return () => {
      window.removeEventListener(COURSE_APPLICATIONS_CHANGED, load);
      window.removeEventListener('focus', load);
    };
  }, [load]);
  if (!applications.length) return null;
  return (
    <>
      <div className="pca" role="group" aria-label="申请中的课程">
        {applications.map((application) => {
          const avatar =
            bundledMarbleAvatar(application.course.avatarUrl)?.url ||
            resolveNativeCourseAvatar(application.course.id, application.course.courseCode);
          const label = application.course.courseCode || application.course.name;
          return (
            <button
              key={application.id}
              type="button"
              className={`pca-row is-${application.status}`}
              title={
                application.status === 'pending'
                  ? `${application.course.name}：等老师批准后才能进入，点一下可以修改申请`
                  : `${application.course.name}：申请没有通过，点一下重新申请`
              }
              onClick={() => setEditing(application)}
            >
              <img src={avatar} alt="" aria-hidden />
              <span className="pca-label">{label}</span>
              <span className="pca-chip">
                {application.status === 'pending' ? '待批准' : '未通过'}
              </span>
            </button>
          );
        })}
      </div>
      {editing ? (
        <CourseJoinDialog
          course={editing.course}
          initialAnswers={editing.answers}
          resend={editing.status}
          onClose={() => setEditing(null)}
          onSubmitted={(status) => {
            setEditing(null);
            if (status === 'joined') onJoined?.();
            load();
          }}
        />
      ) : null}
    </>
  );
}
