'use client';

import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  SYNTARA_WORKSPACE_DIALOG_CONTENT_CLASS,
  SYNTARA_WORKSPACE_DIALOG_OVERLAY_CLASS,
} from '@/components/ui/syntara-dialog-style';
import { backendJson } from '@/lib/utils/backend-api';
import { cn } from '@/lib/utils';

type ConversationMessage = {
  id: string;
  role: string | null;
  plainText: string | null;
  content: unknown;
  createdAt: string;
};

type ConversationResponse = {
  conversation: { title: string; messageCount: number };
  messages: ConversationMessage[];
  messagesTruncated: boolean;
};

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromUnknown).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.content === 'string') return record.content;
  if (record.parts) return textFromUnknown(record.parts);
  if (record.content) return textFromUnknown(record.content);
  return '';
}

function messageText(message: ConversationMessage) {
  return message.plainText?.trim() || textFromUnknown(message.content).trim();
}

function roleLabel(role: string | null) {
  if (role === 'user') return '学生';
  if (role === 'assistant') return '课程助理';
  if (role === 'system') return '系统';
  return role || '消息';
}

export function AdminConversationDialog({
  open,
  onOpenChange,
  studentId,
  courseId,
  conversationId,
  messagesUrl,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  courseId: string;
  conversationId: string | null;
  messagesUrl?: string;
  title?: string;
}) {
  const [data, setData] = useState<ConversationResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !conversationId) return;
    let active = true;
    setData(null);
    setError('');
    const path =
      messagesUrl ||
      `/api/admin/users/${encodeURIComponent(studentId)}/courses/${encodeURIComponent(courseId)}/conversations/${encodeURIComponent(conversationId)}?messageLimit=1000`;
    void backendJson<ConversationResponse>(path)
      .then((response) => {
        if (active) setData(response);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '对话加载失败');
      });
    return () => {
      active = false;
    };
  }, [conversationId, courseId, messagesUrl, open, studentId]);

  const messages = (data?.messages ?? []).filter((message) => messageText(message));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName={SYNTARA_WORKSPACE_DIALOG_OVERLAY_CLASS}
        className={cn(SYNTARA_WORKSPACE_DIALOG_CONTENT_CLASS, 'h-[min(860px,92dvh)] max-w-[920px]')}
      >
        <DialogHeader className="relative shrink-0 border-b border-border/80 bg-background/95 px-4 py-3 text-left backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="关闭"
              aria-label="关闭对话"
              className="h-9 w-9 shrink-0 rounded-full border border-slate-200 bg-white p-0 text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-3.5" />
            </Button>
            <div className="min-w-0">
              <DialogTitle className="truncate text-[15px] font-semibold leading-5">
                {data?.conversation.title || title || '查看对话'}
              </DialogTitle>
              {data ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {messages.length} 条消息
                  {data.messagesTruncated ? '，更早的消息未全部载入' : ''}
                </p>
              ) : null}
            </div>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : !data ? (
            <div
              role="status"
              className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 className="size-4 animate-spin" />
              正在读取完整对话…
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">这条对话没有可显示的消息。</p>
          ) : (
            <ol className="space-y-4">
              {messages.map((message) => {
                const fromStudent = message.role === 'user';
                return (
                  <li
                    key={message.id}
                    className={cn('flex', fromStudent ? 'justify-end' : 'justify-start')}
                  >
                    <article
                      className={cn(
                        'max-w-[85%] rounded-2xl px-4 py-3 text-sm',
                        fromStudent
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                          : 'bg-muted/70',
                      )}
                    >
                      <p
                        className={cn(
                          'mb-1.5 text-[11px] font-medium',
                          fromStudent ? 'text-white/70 dark:text-slate-500' : 'text-muted-foreground',
                        )}
                      >
                        {roleLabel(message.role)}
                      </p>
                      {fromStudent ? (
                        <p className="whitespace-pre-wrap leading-6">{messageText(message)}</p>
                      ) : (
                        <MessageResponse className="text-sm leading-6">
                          {messageText(message)}
                        </MessageResponse>
                      )}
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
