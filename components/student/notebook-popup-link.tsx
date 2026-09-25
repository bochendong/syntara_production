'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const StudentNotebookDialog = dynamic(
  () => import('./student-notebook-dialog').then((module) => module.StudentNotebookDialog),
  { ssr: false },
);

export function NotebookPopupLink({
  notebookId,
  title,
  kind,
  className,
  children,
  onOpen,
}: {
  notebookId: string;
  title?: string;
  kind?: 'image' | 'markdown';
  className?: string;
  children: ReactNode;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Link
        href={`/classroom/${encodeURIComponent(notebookId)}`}
        className={cn(
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        onClick={(event) => {
          if (
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            event.button !== 0
          )
            return;
          event.preventDefault();
          onOpen?.();
          setOpen(true);
        }}
      >
        {children}
      </Link>
      {open ? (
        <StudentNotebookDialog
          notebook={{ id: notebookId, title, kind }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
