'use client';

import { useCallback, useEffect, useState } from 'react';
import { resolveCourseAvatarDisplayUrl } from '@/lib/constants/course-avatars';
import { backendJson } from '@/lib/utils/backend-api';
import type { StoreCourseAdmission } from '@/lib/utils/database';
import {
  CourseApplicationDialog,
  WEB_COURSE_APPLICATIONS_CHANGED,
} from '@/components/store/course-application-dialog';
import { cn } from '@/lib/utils';

type Application = {
  id: string;
  status: 'pending' | 'rejected';
  answers: Record<string, string>;
  course: {
    id: string;
    name: string;
    courseCode: string | null;
    avatarUrl: string | null;
    admission: StoreCourseAdmission;
    organization: { id: string; name: string } | null;
  };
};

/**
 * 网页课程主页：申请了但还没进的课。待批准的进不去，点开可以改了重发；未通过的可以重新申请。
 * 老师同意后它从这里消失，课程出现在课程列表里（onJoined 让外面重新读课程）。
 */
export function WebPendingApplications({ onJoined }: { onJoined?: () => void }) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [editing, setEditing] = useState<Application | null>(null);
  const load = useCallback(() => {
    void backendJson<{ applications: Application[] }>('/api/courses/store/applications')
      .then((result) =>
        setApplications((previous) => {
          if (previous.some((item) => !result.applications.some((next) => next.id === item.id)))
            onJoined?.();
          return result.applications;
        }),
      )
      .catch(() => {});
  }, [onJoined]);
  useEffect(() => {
    load();
    window.addEventListener(WEB_COURSE_APPLICATIONS_CHANGED, load);
    window.addEventListener('focus', load);
    return () => {
      window.removeEventListener(WEB_COURSE_APPLICATIONS_CHANGED, load);
      window.removeEventListener('focus', load);
    };
  }, [load]);
  if (!applications.length) return null;
  return (
    <>
      <div
        role="group"
        aria-label="申请中的课程"
        className="fixed bottom-6 left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-full border border-white/80 bg-white/70 px-2 py-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.12)] backdrop-blur-xl"
      >
        <span className="px-2 text-xs font-semibold text-slate-500">申请中</span>
        {applications.map((application) => (
          <button
            key={application.id}
            type="button"
            title={
              application.status === 'pending'
                ? `${application.course.name}：等老师同意后才能进入，点一下可以修改申请`
                : `${application.course.name}：申请没有通过，点一下重新申请`
            }
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-900/5"
            onClick={() => setEditing(application)}
          >
            <img
              src={resolveCourseAvatarDisplayUrl(
                application.course.id,
                application.course.avatarUrl,
              )}
              alt=""
              className="size-7 rounded-full object-cover opacity-75 grayscale-[0.4]"
            />
            {application.course.courseCode || application.course.name}
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-bold',
                application.status === 'pending'
                  ? 'bg-amber-400/20 text-amber-800'
                  : 'bg-pink-400/20 text-pink-700',
              )}
            >
              {application.status === 'pending' ? '待批准' : '未通过'}
            </span>
          </button>
        ))}
      </div>
      {editing ? (
        <CourseApplicationDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          course={editing.course}
          status={editing.status}
          initialAnswers={editing.answers}
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
