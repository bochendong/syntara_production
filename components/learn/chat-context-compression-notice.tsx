import { ArchiveRestore, ChevronDown } from 'lucide-react';
import type { ChatContextCompression } from '@/lib/types/chat';

function compactTokenCount(value: number): string {
  if (value < 1_000) return `约 ${value}`;
  const rounded = Math.round(value / 100) / 10;
  return `约 ${rounded}k`;
}

export function ChatContextCompressionNotice({
  compression,
}: {
  compression: ChatContextCompression;
}) {
  return (
    <details className="group mb-3 overflow-hidden rounded-xl border border-sky-200/80 bg-sky-50/70 text-left dark:border-sky-300/15 dark:bg-sky-400/[0.07]">
      <summary className="flex cursor-pointer list-none items-start gap-2.5 px-3 py-2.5 marker:hidden">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-white text-sky-700 shadow-sm ring-1 ring-sky-100 dark:bg-white/10 dark:text-sky-200 dark:ring-white/10">
          <ArchiveRestore className="size-3.5" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-sky-950 dark:text-sky-100">
              上下文已自动整理
            </span>
            <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-[9px] font-medium text-sky-700 ring-1 ring-sky-100 dark:bg-white/10 dark:text-sky-200 dark:ring-white/10">
              对话记录未删除
            </span>
          </span>
          <span className="mt-0.5 block text-[11px] leading-5 text-sky-800/75 dark:text-sky-100/65">
            {compression.compressedMessageCount} 条较早消息已合并为摘要，最近{' '}
            {compression.retainedMessageCount} 条继续按原文参与回答
          </span>
        </span>
        <ChevronDown className="mt-1 size-3.5 shrink-0 text-sky-600 transition-transform group-open:rotate-180 dark:text-sky-200/70" />
      </summary>
      <div className="border-t border-sky-200/70 px-3 pb-3 pt-2.5 dark:border-sky-300/10">
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-sky-800/60 dark:text-sky-100/50">
          <span>整理前 {compactTokenCount(compression.estimatedTokensBefore)} tokens</span>
          <span>整理后 {compactTokenCount(compression.estimatedTokensAfter)} tokens</span>
          <span>
            {compression.trigger === 'token_budget' ? '由上下文预算触发' : '由消息数量触发'}
          </span>
        </div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-800/60 dark:text-sky-100/50">
          后续回答使用的较早对话摘要
        </p>
        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white/80 px-3 py-2.5 text-xs leading-5 text-slate-700 ring-1 ring-sky-100 dark:bg-slate-950/35 dark:text-slate-200 dark:ring-white/10">
          {compression.summary}
        </div>
      </div>
    </details>
  );
}
