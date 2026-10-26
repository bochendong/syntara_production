'use client';

import { useCallback, useEffect, useState } from 'react';
import { Layers, Loader2, Scissors, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/lib/notifications/client-toast';
import { cn } from '@/lib/utils';
import { formatPartLabel } from '@/lib/problem-bank';
import {
  applyCourseMultipartCheckup,
  scanCourseMultipartCheckup,
  type MultipartCheckupSuggestion,
} from '@/lib/utils/notebook-problem-api';
import { ProblemRichText } from './problem-rich-text';

type Locale = 'zh-CN' | 'en-US';

/** 小问体检：列出被拆开 / 挤在一起的旧题，老师勾选后才修复。 */
export function MultipartCheckupDialog(props: {
  courseId: string;
  locale: Locale;
  disabled?: boolean;
  onApplied: () => void | Promise<void>;
}) {
  const zh = props.locale === 'zh-CN';
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<MultipartCheckupSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setLoading(true);
    try {
      const data = await scanCourseMultipartCheckup(props.courseId);
      setSuggestions(data.suggestions);
      setSelected(new Set(data.suggestions.map((item) => item.id)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : zh ? '体检失败' : 'Check failed');
    } finally {
      setLoading(false);
    }
  }, [props.courseId, zh]);

  useEffect(() => {
    if (open) void scan();
  }, [open, scan]);

  const run = async (action: 'apply' | 'dismiss') => {
    const ids = suggestions.filter((item) => selected.has(item.id)).map((item) => item.id);
    if (!ids.length || busy) return;
    setBusy(true);
    try {
      const result = await applyCourseMultipartCheckup({
        courseId: props.courseId,
        action,
        suggestionIds: ids,
        language: props.locale,
      });
      if (action === 'apply') {
        const ok = result.applied?.length ?? 0;
        const failed = result.failed ?? [];
        if (ok) toast.success(zh ? `修好了 ${ok} 道` : `Fixed ${ok}`);
        if (failed.length) toast.error(failed[0].error);
        await props.onApplied();
      }
      await scan();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : zh ? '修复失败' : 'Fix failed');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={props.disabled}
        onClick={() => setOpen(true)}
        title={zh ? '找出被拆开或挤在一起的小问' : 'Find split or crammed sub-parts'}
      >
        <Layers className="mr-1.5 size-3.5" />
        {zh ? '小问体检' : 'Sub-part check'}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>{zh ? '小问体检' : 'Sub-part check'}</DialogTitle>
            <DialogDescription>
              {zh
                ? '合并：几道题合成一道大题，旧题归档，作答记录留在旧题上。切开：原题升级成大题，进度保留，每问答案由 AI 补。'
                : 'Merge combines problems into one and archives the old ones. Split upgrades a problem in place; AI fills each part’s answer.'}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[58vh] space-y-2 overflow-y-auto px-5 py-3">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {zh ? '正在检查…' : 'Checking…'}
              </div>
            ) : suggestions.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {zh ? '没发现问题 ✨' : 'All good ✨'}
              </div>
            ) : (
              suggestions.map((item) => {
                const isOpen = expanded === item.id;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'rounded-xl border bg-card/70 p-3 transition',
                      selected.has(item.id) ? 'border-primary/50' : 'opacity-70',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-primary"
                        checked={selected.has(item.id)}
                        onChange={() => toggle(item.id)}
                        aria-label={item.title}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                              item.kind === 'merge'
                                ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
                                : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                            )}
                          >
                            {item.kind === 'merge' ? (
                              <Wand2 className="size-3" />
                            ) : (
                              <Scissors className="size-3" />
                            )}
                            {item.kind === 'merge'
                              ? zh
                                ? `合并 ${item.problems.length} 道`
                                : `Merge ${item.problems.length}`
                              : zh
                                ? `切成 ${item.preview.parts.length} 问`
                                : `Split into ${item.preview.parts.length}`}
                          </span>
                          <span className="truncate">{item.title}</span>
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {item.problems.map((problem) => problem.title).join(' · ')}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.preview.parts.map((part) => (
                            <span
                              key={part.label}
                              className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                            >
                              {formatPartLabel(part.label)}
                            </span>
                          ))}
                          <button
                            type="button"
                            className="ml-auto text-xs text-primary hover:underline"
                            onClick={() => setExpanded(isOpen ? null : item.id)}
                          >
                            {isOpen ? (zh ? '收起' : 'Hide') : zh ? '看看修复后' : 'Preview'}
                          </button>
                        </div>
                        {isOpen ? (
                          <div className="mt-3 space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
                            <ProblemRichText content={item.preview.stem} />
                            {item.preview.parts.map((part) => (
                              <div key={part.label} className="border-l-2 pl-3">
                                <span className="mr-1 font-semibold">
                                  {formatPartLabel(part.label)}
                                </span>
                                <ProblemRichText
                                  content={
                                    part.content.type === 'fill_blank'
                                      ? part.content.stemTemplate
                                      : part.content.stem
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || !selected.size}
              onClick={() => void run('dismiss')}
            >
              {zh ? '忽略所选' : 'Ignore selected'}
            </Button>
            <Button size="sm" disabled={busy || !selected.size} onClick={() => void run('apply')}>
              {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
              {zh ? `修复所选（${selected.size}）` : `Fix selected (${selected.size})`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
