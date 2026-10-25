'use client';

import { useRef, useState, type DragEvent } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { LANDING_MARBLE_ART } from '@/components/home/landing/marble-art';
import { cn } from '@/lib/utils';

const ACCEPT = '.txt,.md,.markdown,.csv,.json,.ts,.tsx,.js,.jsx,.py,.html,.css,text/*';

type DropState = 'idle' | 'busy' | 'done' | 'failed';

async function uploadNote(courseId: string, file: File) {
  const text = await file.text();
  if (!text.trim()) throw new Error(`${file.name} 是空的`);
  const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/materials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'notes', clientId: crypto.randomUUID(), name: file.name, text }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || '没能整理');
  }
}

/** 资料库顶上的投放台：把文本笔记拖进来（或点一下选），整理成这门课的笔记本。 */
export function CourseNotesDrop({
  courseId,
  onUploaded,
}: {
  courseId: string;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<DropState>('idle');
  const [message, setMessage] = useState('');

  const accept = async (files: File[]) => {
    if (!files.length || state === 'busy') return;
    setState('busy');
    setMessage('');
    let imported = 0;
    let failure = '';
    for (const file of files) {
      try {
        await uploadNote(courseId, file);
        imported += 1;
      } catch (cause) {
        failure = cause instanceof Error ? cause.message : String(cause);
      }
    }
    if (imported) onUploaded();
    setState(failure ? 'failed' : 'done');
    setMessage(failure);
    window.setTimeout(() => setState((current) => (current === 'done' ? 'idle' : current)), 1600);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    void accept(Array.from(event.dataTransfer.files));
  };

  return (
    <button
      type="button"
      data-onboarding="materials-drop"
      aria-label="上传笔记"
      onClick={() => inputRef.current?.click()}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className={cn(
        'group flex w-full items-center gap-3 rounded-[20px] border border-dashed px-4 py-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-violet-400/50',
        dragging
          ? 'border-violet-400 bg-violet-50/80 dark:bg-violet-400/10'
          : 'border-slate-300/80 bg-slate-50/70 hover:border-violet-300 hover:bg-violet-50/50 dark:border-white/15 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]',
      )}
    >
      <img
        src={LANDING_MARBLE_ART.purple.src}
        alt=""
        aria-hidden
        className={cn(
          'size-9 shrink-0 transition-transform duration-300',
          dragging ? 'scale-110' : 'group-hover:-translate-y-0.5',
          state === 'busy' && 'animate-pulse',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
          {state === 'busy'
            ? '整理中'
            : state === 'done'
              ? '整理好了'
              : dragging
                ? '放开'
                : '把笔记拖进来'}
        </span>
        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
          {state === 'failed' && message ? message : 'TXT · Markdown · CSV · 代码'}
        </span>
      </span>
      {state === 'busy' ? <Loader2 className="size-4 animate-spin text-violet-500" /> : null}
      {state === 'done' ? <Check className="size-4 text-emerald-500" /> : null}
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple
        accept={ACCEPT}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = '';
          void accept(files);
        }}
      />
    </button>
  );
}
