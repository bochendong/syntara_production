import { Suspense } from 'react';
import { LearningCalendarPage } from '@/components/learn/learning-calendar-page';

export default function CalendarPage() {
  return (
    <Suspense
      fallback={
        <div className="grid h-full min-h-[680px] place-items-center rounded-[22px] bg-[#f2f2f7] text-sm text-slate-500">
          加载学习日历…
        </div>
      }
    >
      <LearningCalendarPage />
    </Suspense>
  );
}
