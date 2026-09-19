'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { backendJson } from '@/lib/utils/backend-api';

type Detail = { id: string; requestContent: string | null; responseContent: string | null };

export function UsageContentDialog({ id, model }: { id: string; model: string }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void backendJson<{ row: Detail }>(`/api/admin/llm-usage/${encodeURIComponent(id)}`)
      .then(({ row }) => {
        if (active) setDetail(row);
      })
      .catch(() => {
        if (active) setError('加载失败，请重试');
      });
    return () => {
      active = false;
    };
  }, [open, id, attempt]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setDetail(null);
        setError('');
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          查看内容
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>用量内容</DialogTitle>
          <DialogDescription>
            {model} · 记录 {id}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-5 overflow-y-auto">
          {error ? (
            <div role="alert">
              {error}
              <Button
                variant="outline"
                onClick={() => {
                  setError('');
                  setDetail(null);
                  setAttempt((v) => v + 1);
                }}
              >
                重试
              </Button>
            </div>
          ) : !detail ? (
            <p role="status">正在加载内容…</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                展示本次调用保存的输入和输出。敏感字段和二进制媒体不保存；超长内容会标注截断。
              </p>
              {(['requestContent', 'responseContent'] as const).map((key) => (
                <section key={key}>
                  <h3 className="mb-2 font-medium">
                    {key === 'requestContent' ? '输入内容' : '输出内容'}
                  </h3>
                  <pre className="whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-4 font-mono text-xs">
                    {detail[key] ?? '当时未记录此内容，无法追溯。'}
                  </pre>
                </section>
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
