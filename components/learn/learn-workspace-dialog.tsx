'use client';

import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  SYNTARA_WORKSPACE_DIALOG_CONTENT_CLASS,
  SYNTARA_WORKSPACE_DIALOG_OVERLAY_CLASS,
} from '@/components/ui/syntara-dialog-style';

/** Shared shell size for Learn workspace panels (source library, calendar, problem bank, …). */
export const LEARN_WORKSPACE_DIALOG_CONTENT_CLASS = SYNTARA_WORKSPACE_DIALOG_CONTENT_CLASS;

export function LearnWorkspaceDialog({
  open,
  onOpenChange,
  title,
  description,
  showCloseButton = true,
  contentClassName,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  showCloseButton?: boolean;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={showCloseButton}
        overlayClassName={SYNTARA_WORKSPACE_DIALOG_OVERLAY_CLASS}
        className={cn(LEARN_WORKSPACE_DIALOG_CONTENT_CLASS, contentClassName)}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
