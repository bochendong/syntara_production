'use client';

import { BookOpen } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

interface PurchaseConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemTypeLabel: '课程' | '笔记本';
  itemName: string;
  countSummary?: string;
  note?: string;
  busy?: boolean;
  confirmLabel?: string;
  onConfirm: () => Promise<boolean | void> | boolean | void;
}

/** Confirmation for adding a shared course or copying a notebook without credits. */
export function PurchaseConfirmDialog({
  open,
  onOpenChange,
  itemTypeLabel,
  itemName,
  countSummary,
  note,
  busy = false,
  confirmLabel,
  onConfirm,
}: PurchaseConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[32rem] overflow-y-auto rounded-[24px]">
        <AlertDialogHeader>
          <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700">
            <BookOpen className="size-5" />
          </div>
          <AlertDialogTitle>确认加入{itemTypeLabel}</AlertDialogTitle>
          <AlertDialogDescription>
            你将把「{itemName}」
            {itemTypeLabel === '笔记本' ? '复制到自己的资料库' : '加入自己的课程列表'}。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {countSummary ? <p className="text-sm text-muted-foreground">{countSummary}</p> : null}
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel type="button">取消</AlertDialogCancel>
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              const result = await onConfirm();
              if (result !== false) onOpenChange(false);
            }}
          >
            {busy ? '处理中…' : confirmLabel || `确认加入${itemTypeLabel}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
