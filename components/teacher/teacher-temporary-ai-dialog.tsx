'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { UIMessage } from 'ai';
import { Bot, Loader2, Send, Sparkles } from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { askCourseOrchestrator } from '@/lib/chat/ask-course-orchestrator';
import type { ChatMessageMetadata } from '@/lib/types/chat';
import { cn } from '@/lib/utils';

type TemporaryMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

const QUICK_QUESTIONS = [
  '哪些学生最近需要我重点关注？',
  '总结班级最近一周的薄弱知识点',
  '根据最近提交，建议我下一节课先讲什么？',
];

export function TeacherTemporaryAiDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  courseName?: string;
  title?: string;
  introTitle?: string;
  introDescription?: string;
  contextPrompt?: string;
  quickQuestions?: string[];
}) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<TemporaryMessage[]>([]);
  const [conversation, setConversation] = useState<UIMessage<ChatMessageMetadata>[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const hasConversation = messages.length > 0;
  const title =
    props.title?.trim() ||
    (props.courseName?.trim() ? `${props.courseName} · 临时提问` : '课程临时提问');
  const quickQuestions = props.quickQuestions?.length ? props.quickQuestions : QUICK_QUESTIONS;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, submitting]);

  function resetConversation() {
    abortRef.current?.abort();
    abortRef.current = null;
    setQuestion('');
    setMessages([]);
    setConversation([]);
    setSubmitting(false);
    setError('');
  }

  function handleOpenChange(open: boolean) {
    if (!open) resetConversation();
    props.onOpenChange(open);
  }

  async function submitQuestion(event?: FormEvent) {
    event?.preventDefault();
    const nextQuestion = question.trim();
    if (!nextQuestion || submitting) return;

    const userMessage: TemporaryMessage = {
      id: `temporary-user-${Date.now()}`,
      role: 'user',
      text: nextQuestion,
    };
    setMessages((current) => [...current, userMessage]);
    setQuestion('');
    setError('');
    setSubmitting(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await askCourseOrchestrator({
        courseId: props.courseId,
        courseName: props.courseName,
        question: props.contextPrompt
          ? `${props.contextPrompt.trim()}\n\n老师的临时问题：${nextQuestion}`
          : nextQuestion,
        conversation,
        surface: 'teacher-course-chat',
        signal: controller.signal,
      });
      setConversation(result.messages);
      setMessages((current) => [
        ...current,
        {
          id: `temporary-assistant-${Date.now()}`,
          role: 'assistant',
          text: result.answer.trim() || '这次没有生成有效回答，请换一种问法再试一次。',
        },
      ]);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : '临时提问失败，请稍后重试。');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[min(760px,88dvh)] max-w-[min(760px,calc(100vw-1.5rem))] flex-col gap-0 overflow-hidden rounded-3xl p-0">
        <DialogHeader className="border-b border-slate-200 bg-white px-5 py-4 pr-14 dark:border-white/10 dark:bg-slate-950">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-700 ring-1 ring-violet-100 dark:bg-violet-400/10 dark:text-violet-200 dark:ring-violet-400/20">
              <Bot className="size-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-semibold text-slate-950 dark:text-white">
                {title}
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                本次对话只在这个窗口中保留，关闭后会清空。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/80 px-4 py-5 dark:bg-slate-950/80 sm:px-6">
          {!hasConversation ? (
            <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center">
              <span className="grid size-14 place-items-center rounded-[20px] bg-white text-violet-600 shadow-[0_14px_38px_rgba(124,58,237,0.12)] ring-1 ring-violet-100 dark:bg-white/[0.04] dark:text-violet-200 dark:ring-violet-400/20">
                <Sparkles className="size-6" />
              </span>
              <h3 className="mt-5 text-base font-semibold text-slate-950 dark:text-white">
                {props.introTitle || '想先了解班级的哪件事？'}
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
                {props.introDescription || 'AI 会结合这门课的学生学习信号、题库与近期作答来回答。'}
              </p>
              <div className="mt-5 flex max-w-lg flex-wrap justify-center gap-2">
                {quickQuestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setQuestion(item)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-violet-400/30 dark:hover:bg-violet-400/10 dark:hover:text-violet-200"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto space-y-5">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6',
                      message.role === 'user'
                        ? 'rounded-br-md bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                        : 'rounded-bl-md border border-slate-200 bg-white text-slate-800 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100',
                    )}
                  >
                    {message.role === 'assistant' ? (
                      <MessageResponse className="[&_p]:my-2 first:[&_p]:mt-0 last:[&_p]:mb-0">
                        {message.text}
                      </MessageResponse>
                    ) : (
                      <p className="whitespace-pre-wrap">{message.text}</p>
                    )}
                  </div>
                </div>
              ))}
              {submitting ? (
                <div className="flex justify-start" role="status" aria-live="polite">
                  <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
                    <Loader2 className="size-4 animate-spin text-violet-500" />
                    正在分析课程与近期学习信号…
                  </div>
                </div>
              ) : null}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <form
          onSubmit={(event) => void submitQuestion(event)}
          className="border-t border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950"
        >
          {error ? (
            <p className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-400/10 dark:text-rose-200">
              {error}
            </p>
          ) : null}
          <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-2 transition focus-within:border-violet-300 focus-within:ring-2 focus-within:ring-violet-500/10 dark:border-white/10 dark:bg-white/[0.04] dark:focus-within:border-violet-400/40">
            <Textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submitQuestion();
                }
              }}
              disabled={submitting}
              rows={2}
              placeholder="临时问问这门课的学生情况…"
              className="max-h-32 min-h-12 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
            />
            <Button
              type="submit"
              size="icon"
              disabled={submitting || !question.trim()}
              className="size-10 shrink-0 rounded-xl bg-violet-600 text-white hover:bg-violet-700"
              aria-label="发送临时提问"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </div>
          <p className="mt-2 px-1 text-[11px] text-slate-400">Enter 发送，Shift + Enter 换行</p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
