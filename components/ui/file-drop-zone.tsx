'use client';

import { useId, type ReactNode } from 'react';
import { FileText, Upload, X } from 'lucide-react';
import { useFileDrop } from '@/lib/hooks/use-file-drop';
import { cn } from '@/lib/utils';

/**
 * Dashed highlight shown over a drop target while files are dragged over it.
 * The parent must be `relative`.
 */
export function FileDropOverlay({
  active,
  label = '松开即可上传',
  className,
}: {
  active: boolean;
  label?: ReactNode;
  className?: string;
}) {
  if (!active) return null;
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-sky-400/80 bg-sky-50/85 text-sky-900 backdrop-blur-[1px] dark:bg-slate-950/80 dark:text-sky-100',
        className,
      )}
    >
      <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/80 bg-white/90 px-4 py-2 text-sm font-medium shadow-sm dark:border-sky-400/30 dark:bg-slate-900/90">
        <Upload className="size-4" />
        {label}
      </div>
    </div>
  );
}

/**
 * Click-or-drop file picker box. Replaces a bare `<input type="file">` and
 * shows the chosen file names, since a dropped file can't be written back
 * into a native input.
 */
export function FileDropZone({
  files,
  onFiles,
  onClear,
  accept,
  multiple = false,
  disabled,
  title = '点击选择文件，或拖拽到这里',
  hint,
  ariaLabel,
  onRejected,
  className,
}: {
  files: File[];
  onFiles: (files: File[]) => void;
  onClear?: () => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  title?: ReactNode;
  hint?: ReactNode;
  ariaLabel?: string;
  onRejected?: (files: File[]) => void;
  className?: string;
}) {
  const inputId = useId();
  const { isDragging, dropZoneProps } = useFileDrop({
    onFiles,
    disabled,
    accept,
    multiple,
    onRejected,
  });

  return (
    <div className={cn('space-y-2', className)}>
      <label
        htmlFor={inputId}
        {...dropZoneProps}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-5 text-center transition-colors',
          disabled
            ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60 dark:border-white/10 dark:bg-white/[0.03]'
            : isDragging
              ? 'border-sky-400 bg-sky-50 ring-4 ring-sky-400/15 dark:border-sky-400/70 dark:bg-sky-400/10'
              : 'border-slate-300 bg-white/70 hover:border-sky-300 hover:bg-sky-50/60 dark:border-white/15 dark:bg-white/[0.03] dark:hover:border-sky-400/40 dark:hover:bg-sky-400/5',
        )}
      >
        <input
          id={inputId}
          aria-label={ariaLabel}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          className="sr-only"
          onChange={(event) => {
            const picked = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            if (picked.length > 0) onFiles(multiple ? picked : picked.slice(0, 1));
          }}
        />
        <Upload className="size-5 text-sky-600 dark:text-sky-300" />
        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {isDragging ? '松开即可上传' : title}
        </span>
        {hint ? <span className="text-xs text-slate-500 dark:text-slate-400">{hint}</span> : null}
      </label>
      {files.length > 0 ? (
        <ul className="space-y-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}:${file.size}:${index}`}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-white/10 dark:bg-white/5"
            >
              <FileText className="size-4 shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-100">
                {file.name}
              </span>
              {onClear && !disabled ? (
                <button
                  type="button"
                  onClick={onClear}
                  className="grid size-6 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label={`移除 ${file.name}`}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
