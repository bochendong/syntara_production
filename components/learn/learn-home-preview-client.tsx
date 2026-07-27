'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import {
  LEARN_HOME_PREVIEW_COURSES,
  LearnHomeDashboard,
} from '@/components/learn/learn-home-dashboard';

type PreviewDialog = 'calendar' | 'create' | null;

export function LearnHomePreviewClient() {
  const [dialog, setDialog] = useState<PreviewDialog>(null);

  return (
    <>
      <LearnHomeDashboard
        courses={LEARN_HOME_PREVIEW_COURSES}
        activeCourseId={null}
        onCreateCourse={() => setDialog('create')}
        onOpenCalendar={() => setDialog('calendar')}
        onOpenCourse={() => undefined}
      />
      {dialog ? (
        <div
          className="fixed inset-0 z-[1600] grid place-items-center bg-slate-950/25 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={dialog === 'calendar' ? '学习日历预览' : '新建课程预览'}
        >
          <div className="w-full max-w-sm rounded-[28px] border border-white/55 bg-white/88 p-6 text-slate-900 shadow-2xl backdrop-blur-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold">
                  {dialog === 'calendar' ? '学习日历' : '新建课程'}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {dialog === 'calendar'
                    ? '日历入口已连接到现有课程日程。'
                    : '新建课程入口已连接到现有创建流程。'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 outline-none hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="关闭预览"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
