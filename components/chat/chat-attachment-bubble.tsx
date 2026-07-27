'use client';

import { File, FileText, ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentKind(mimeType: string, name: string) {
  const m = (mimeType || '').toLowerCase();
  const n = name.toLowerCase();
  if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n)) return 'image' as const;
  if (m === 'application/pdf' || n.endsWith('.pdf')) return 'pdf' as const;
  return 'file' as const;
}

export function ChatAttachmentBubble({
  name,
  size,
  mimeType,
  objectUrl,
  variant = 'onUserBubble',
}: {
  name: string;
  size: number;
  mimeType: string;
  objectUrl?: string;
  variant?: 'onUserBubble' | 'onNeutral';
}) {
  const kind = attachmentKind(mimeType, name);
  const openable = Boolean(objectUrl);

  const iconWrap = cn(
    'flex size-11 shrink-0 items-center justify-center rounded-md',
    kind === 'pdf' && 'bg-[#f5e6e8] text-[#e64340] dark:bg-[#3d2528] dark:text-[#ff6b6b]',
    kind === 'image' && 'bg-[#e8f4fd] text-[#10aeff] dark:bg-[#1a2f3d] dark:text-[#5eb8ff]',
    kind === 'file' && 'bg-[#ededed] text-[#576b95] dark:bg-[#2a2f3a] dark:text-[#8fa3c4]',
  );

  const body = (
    <>
      <div className={iconWrap} aria-hidden>
        {kind === 'pdf' ? (
          <FileText className="size-6" strokeWidth={1.75} />
        ) : kind === 'image' ? (
          <ImageIcon className="size-6" strokeWidth={1.75} />
        ) : (
          <File className="size-6" strokeWidth={1.75} />
        )}
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="line-clamp-2 text-[13px] font-medium leading-snug text-slate-900">{name}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{formatFileSize(size)}</p>
      </div>
    </>
  );

  const shell = cn(
    'flex w-full max-w-[min(100%,280px)] gap-2.5 rounded-[10px] border p-2 pr-2.5 text-left shadow-sm transition-[transform,box-shadow]',
    variant === 'onUserBubble'
      ? 'border-white/30 bg-white text-slate-900 shadow-black/15 dark:border-white/25 dark:bg-[#f8fafc] dark:shadow-black/40'
      : 'border-slate-200/90 bg-white text-slate-900 shadow-slate-900/5 dark:border-slate-600/60 dark:bg-slate-900/50 dark:text-slate-100',
    openable && 'cursor-pointer hover:shadow-md active:scale-[0.99]',
    !openable && 'cursor-default opacity-90',
  );

  if (openable && objectUrl) {
    return (
      <a
        href={objectUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(shell, 'no-underline')}
        title={name}
        aria-label={`打开 ${name}`}
      >
        {body}
      </a>
    );
  }

  return (
    <div
      className={shell}
      role="group"
      title="本地未缓存该文件内容（例如在本功能上线前发送过），请重新上传后发送"
    >
      {body}
    </div>
  );
}
