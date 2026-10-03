'use client';

import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { CourseProblemBankView } from '@/components/problem-bank/course-problem-bank-view';
import type { AdminCourseProblemBankSnapshot } from '@/components/problem-bank/use-course-problem-bank-controller';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  SYNTARA_WORKSPACE_DIALOG_CONTENT_CLASS,
  SYNTARA_WORKSPACE_DIALOG_OVERLAY_CLASS,
} from '@/components/ui/syntara-dialog-style';
import { backendJson } from '@/lib/utils/backend-api';
import { cn } from '@/lib/utils';

export function PracticeProblemPopup({
  open,
  onOpenChange,
  courseId,
  problemId,
  title,
  access = 'admin',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  problemId: string | null;
  title?: string;
  access?: 'admin' | 'course';
}) {
  const [snapshot, setSnapshot] = useState<AdminCourseProblemBankSnapshot | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (access !== 'admin' || !open || !problemId) return;
    let active = true;
    setSnapshot(null);
    setError('');
    void backendJson<{ snapshot: AdminCourseProblemBankSnapshot }>(
      `/api/admin/courses/${encodeURIComponent(courseId)}/problems/${encodeURIComponent(problemId)}`,
    )
      .then((response) => {
        if (active) setSnapshot(response.snapshot);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '题目加载失败');
      });
    return () => {
      active = false;
    };
  }, [access, courseId, open, problemId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName={SYNTARA_WORKSPACE_DIALOG_OVERLAY_CLASS}
        className={cn(
          SYNTARA_WORKSPACE_DIALOG_CONTENT_CLASS,
          'h-[min(860px,92dvh)] max-w-[1320px] bg-[#f5f5f5] dark:bg-slate-950',
        )}
      >
        <DialogHeader className="relative shrink-0 border-b border-border/80 bg-background/95 px-4 py-3 text-left backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="关闭"
              aria-label="关闭题目"
              className="h-9 w-9 shrink-0 rounded-full border border-slate-200 bg-white p-0 text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-3.5" />
            </Button>
            <DialogTitle className="min-w-0 truncate text-[15px] font-semibold leading-5">
              {snapshot?.problems[0]?.title || title || '查看题目'}
            </DialogTitle>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          {error ? (
            <p role="alert" className="px-6 py-8 text-sm text-destructive">
              {error}
            </p>
          ) : access === 'course' && problemId ? (
            <CourseProblemBankView
              key={problemId}
              courseId={courseId}
              mode="practice"
              initialProblemId={problemId}
              practiceProblemIds={[problemId]}
              practiceHeaderPlacement="external"
              showCourseTitle={false}
              showCourseNavigation={false}
              showChromeBackground={false}
            />
          ) : snapshot && problemId ? (
            <CourseProblemBankView
              key={problemId}
              courseId={courseId}
              mode="practice"
              initialProblemId={problemId}
              practiceProblemIds={[problemId]}
              practiceHeaderPlacement="external"
              adminSnapshot={snapshot}
              showCourseTitle={false}
              showCourseNavigation={false}
              showChromeBackground={false}
            />
          ) : (
            <div
              role="status"
              className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 className="size-4 animate-spin" />
              正在加载题目…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
