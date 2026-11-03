'use client';

import { useEffect, useState } from 'react';
import { UserCheck } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { backendJson } from '@/lib/utils/backend-api';
import type { StoreCourseAdmission } from '@/lib/utils/database';

/** 申请提交或改了重发后，网页上的「待批准」列表重新读。 */
export const WEB_COURSE_APPLICATIONS_CHANGED = 'syntara:web-course-applications-changed';

/** 机构课程的老师能看到学生在这门课的做题和提问，加入时说一句。 */
export function CoursePrivacyNote({ className }: { className?: string }) {
  return (
    <p className={className ?? 'flex items-center gap-1.5 text-xs text-muted-foreground'}>
      <span className="size-1.5 rounded-full bg-sky-500" aria-hidden />
      老师可以看到你在这门课的做题和提问
    </p>
  );
}

/**
 * 网页商城：加入需要老师同意的课。填写课程要求的信息后提交，等老师同意；
 * 待批准时可以改了重发，未通过可以重新申请（同一条申请，不会重复）。
 */
export function CourseApplicationDialog({
  open,
  onOpenChange,
  course,
  status,
  initialAnswers,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: {
    id: string;
    name: string;
    admission: StoreCourseAdmission;
    organization?: { name: string } | null;
  };
  /** 上次申请的状态：pending 是改了重发，rejected 是重新申请。 */
  status?: string | null;
  initialAnswers?: Record<string, string>;
  onSubmitted: (status: 'joined' | 'pending') => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setAnswers(initialAnswers ?? {});
      setError('');
    }
  }, [open, initialAnswers]);
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await backendJson<{ status: 'joined' | 'pending' }>(
        `/api/courses/store/${encodeURIComponent(course.id)}/apply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers }),
        },
      );
      window.dispatchEvent(new Event(WEB_COURSE_APPLICATIONS_CHANGED));
      onOpenChange(false);
      onSubmitted(result.status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[32rem] overflow-y-auto rounded-[24px]">
        <AlertDialogHeader>
          <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-700">
            <UserCheck className="size-5" />
          </div>
          <AlertDialogTitle>
            {status === 'pending' ? '修改申请' : status === 'rejected' ? '重新申请' : '申请加入'}「
            {course.name}」
          </AlertDialogTitle>
          <AlertDialogDescription>
            {status === 'pending'
              ? '申请还在等老师同意。改好后重新发送，会替换上次填的内容。'
              : status === 'rejected'
                ? '上次申请没有通过，可以改好后重新发送。'
                : '这门课加入需要老师同意。提交后等老师同意，就能进入课程。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {course.organization ? <CoursePrivacyNote /> : null}
        <form
          id="course-application-form"
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {course.admission.fields.map((field, index) => (
            <label key={field.id} className="grid gap-1.5 text-sm font-medium">
              {field.label}
              <Input
                autoFocus={index === 0}
                required
                inputMode={field.kind === 'phone_last4' ? 'numeric' : 'text'}
                pattern={field.kind === 'phone_last4' ? '[0-9]{4}' : undefined}
                maxLength={field.kind === 'phone_last4' ? 4 : 500}
                placeholder={field.kind === 'phone_last4' ? '4 位数字' : '请输入'}
                value={answers[field.id] ?? ''}
                disabled={busy}
                onChange={(event) => setAnswers({ ...answers, [field.id]: event.target.value })}
              />
            </label>
          ))}
        </form>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel type="button" disabled={busy}>
            取消
          </AlertDialogCancel>
          <Button type="submit" form="course-application-form" disabled={busy}>
            {busy ? '正在提交…' : status ? '重新发送' : '提交申请'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
