'use client';

import { useState } from 'react';
import { Loader2, MessageCircleQuestion } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/notifications/client-toast';
import { backendFetch } from '@/lib/utils/backend-api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function ProblemForumPublishDialog(props: {
  courseId: string;
  problemId: string;
  problemTitle: string;
  locale: 'zh-CN' | 'en-US';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [saving, setSaving] = useState(false);

  const publish = async () => {
    if (!question.trim() || saving) return;
    setSaving(true);
    try {
      const form = new FormData();
      form.set(
        'title',
        props.locale === 'zh-CN'
          ? `题目求助：${props.problemTitle}`
          : `Question: ${props.problemTitle}`,
      );
      form.set('bodyMarkdown', question.trim());
      form.set('problemId', props.problemId);
      const response = await backendFetch(
        `/api/course-forum/${encodeURIComponent(props.courseId)}`,
        {
          method: 'POST',
          body: form,
          timeoutMs: 30_000,
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          payload?.error || (props.locale === 'zh-CN' ? '发布失败' : 'Publish failed'),
        );
      }
      const payload = (await response.json()) as { postId: string };
      setOpen(false);
      setQuestion('');
      router.push(
        `/course/${encodeURIComponent(props.courseId)}/forum?postId=${encodeURIComponent(payload.postId)}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Publish failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        className="h-8 shrink-0 rounded-md px-3 text-xs"
        onClick={() => setOpen(true)}
      >
        <MessageCircleQuestion className="mr-1.5 h-3.5 w-3.5" />
        {props.locale === 'zh-CN' ? '发布到论坛' : 'Ask in forum'}
      </Button>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {props.locale === 'zh-CN' ? '向课程论坛提问' : 'Ask the course forum'}
          </DialogTitle>
          <DialogDescription>{props.problemTitle}</DialogDescription>
        </DialogHeader>
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={30_000}
          rows={8}
          autoFocus
          placeholder={
            props.locale === 'zh-CN'
              ? '具体说说你卡在哪里。帖子会自动附上公开题面，不会公开你的答案或判题结果。'
              : 'Describe where you are stuck. The public problem statement will be attached; your answer and grading result stay private.'
          }
          className="w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-sky-400 dark:border-slate-700 dark:bg-slate-950"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            {props.locale === 'zh-CN' ? '取消' : 'Cancel'}
          </Button>
          <Button onClick={() => void publish()} disabled={!question.trim() || saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {props.locale === 'zh-CN' ? '发布问题' : 'Publish question'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
