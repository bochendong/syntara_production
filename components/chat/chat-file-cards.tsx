'use client';

import { useState } from 'react';
import { Download, ExternalLink, Eye, FileImage, FileText, FileType2 } from 'lucide-react';
import { LEARN_CONFIRMATION_SURFACE_CLASS } from '@/components/learn/learn-confirmation-card';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  SYNTARA_WORKSPACE_DIALOG_CONTENT_CLASS,
  SYNTARA_WORKSPACE_DIALOG_OVERLAY_CLASS,
} from '@/components/ui/syntara-dialog-style';
import type { ChatFileArtifact } from '@/lib/types/chat';
import { cn } from '@/lib/utils';

const CHAT_FILE_KIND_META: Record<
  ChatFileArtifact['fileKind'],
  { label: string; icon: typeof FileText; iconClassName: string }
> = {
  docx: {
    label: 'Word 文档',
    icon: FileText,
    iconClassName:
      'bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-400/10 dark:text-blue-200 dark:ring-blue-300/15',
  },
  pdf: {
    label: 'PDF',
    icon: FileType2,
    iconClassName:
      'bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-400/10 dark:text-rose-200 dark:ring-rose-300/15',
  },
  image: {
    label: '图片',
    icon: FileImage,
    iconClassName:
      'bg-violet-50 text-violet-700 ring-violet-100 dark:bg-violet-400/10 dark:text-violet-200 dark:ring-violet-300/15',
  },
};

const CHAT_FILE_BUTTON_CLASS =
  'inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-sky-200 hover:bg-sky-50 hover:text-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:border-sky-300/25 dark:hover:bg-sky-400/10 dark:hover:text-sky-100';

export function formatChatFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '';
  if (sizeBytes < 1024) return `${Math.round(sizeBytes)} B`;
  if (sizeBytes < 1024 * 1024)
    return `${(sizeBytes / 1024).toFixed(sizeBytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Narrow unknown persisted data back to a chat file artifact. */
export function isChatFileArtifact(value: unknown): value is ChatFileArtifact {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ChatFileArtifact>;
  return (
    candidate.kind === 'chat_file' &&
    typeof candidate.id === 'string' &&
    typeof candidate.url === 'string' &&
    (candidate.fileKind === 'docx' ||
      candidate.fileKind === 'pdf' ||
      candidate.fileKind === 'image')
  );
}

function ChatFileCard({ file }: { file: ChatFileArtifact }) {
  const [imageOpen, setImageOpen] = useState(false);
  const meta = CHAT_FILE_KIND_META[file.fileKind] || CHAT_FILE_KIND_META.docx;
  const Icon = meta.icon;
  const size = formatChatFileSize(file.sizeBytes);
  const previewUrl = file.previewUrl;
  const imagePreviewUrl = file.fileKind === 'image' ? file.previewUrl || file.url : undefined;
  const title = file.title || file.fileName || meta.label;

  return (
    <div className={cn(LEARN_CONFIRMATION_SURFACE_CLASS, 'p-3 text-xs')}>
      <div className="flex items-start gap-3">
        {imagePreviewUrl ? (
          <button
            type="button"
            onClick={() => setImageOpen(true)}
            className="group relative size-14 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-inset ring-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 dark:bg-white/5 dark:ring-white/10"
            aria-label={`查看大图：${title}`}
          >
            <img
              src={imagePreviewUrl}
              alt={title}
              loading="lazy"
              className="size-full object-cover transition-transform group-hover:scale-105"
            />
          </button>
        ) : (
          <span
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-xl ring-1 ring-inset',
              meta.iconClassName,
            )}
          >
            <Icon className="size-4" strokeWidth={1.9} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
            {[meta.label, file.fileName, size].filter(Boolean).join(' · ')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <a
              href={file.url}
              download={file.fileName || undefined}
              className={CHAT_FILE_BUTTON_CLASS}
            >
              <Download className="size-3" />
              下载
            </a>
            {file.fileKind === 'image' && imagePreviewUrl ? (
              <button
                type="button"
                onClick={() => setImageOpen(true)}
                className={CHAT_FILE_BUTTON_CLASS}
              >
                <Eye className="size-3" />
                预览
              </button>
            ) : previewUrl ? (
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className={CHAT_FILE_BUTTON_CLASS}
              >
                <ExternalLink className="size-3" />
                预览
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {imagePreviewUrl ? (
        <Dialog open={imageOpen} onOpenChange={setImageOpen}>
          <DialogContent
            overlayClassName={SYNTARA_WORKSPACE_DIALOG_OVERLAY_CLASS}
            className={cn(SYNTARA_WORKSPACE_DIALOG_CONTENT_CLASS, 'bg-slate-50 dark:bg-slate-950')}
          >
            <div className="shrink-0 border-b border-slate-900/8 px-5 py-4 pr-14 dark:border-white/10">
              <DialogTitle className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {title}
              </DialogTitle>
              <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                {[file.fileName, size].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-4">
              <img
                src={imagePreviewUrl}
                alt={title}
                className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
              />
            </div>
            <div className="flex shrink-0 justify-end border-t border-slate-900/8 px-5 py-3 dark:border-white/10">
              <a
                href={file.url}
                download={file.fileName || undefined}
                className={CHAT_FILE_BUTTON_CLASS}
              >
                <Download className="size-3" />
                下载
              </a>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/** Files the course assistant generated in chat (Word, PDF, image). */
export function ChatFileCards({
  files,
  className,
}: {
  files?: ChatFileArtifact[];
  className?: string;
}) {
  if (!files?.length) return null;
  return (
    <div className={cn('mt-3 grid gap-2 sm:grid-cols-2', className)}>
      {files.map((file) => (
        <ChatFileCard key={file.id} file={file} />
      ))}
    </div>
  );
}
