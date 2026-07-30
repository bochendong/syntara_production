'use client';

import { CreateCourseForm } from '@/components/courses/create-course-form';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  SYNTARA_ACTION_DIALOG_CONTENT_CLASS,
  SYNTARA_DIALOG_HEADER_CLASS,
} from '@/components/ui/syntara-dialog-style';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/notifications/client-toast';

type CreateCourseDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (courseId: string) => void | Promise<void>;
};

export function CreateCourseDialog({ open, onOpenChange, onSuccess }: CreateCourseDialogProps) {
  const handleSuccess = async (courseId: string) => {
    onOpenChange(false);
    toast.success('已创建课程');
    await onSuccess?.(courseId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          SYNTARA_ACTION_DIALOG_CONTENT_CLASS,
          'max-h-[min(720px,calc(100dvh-1rem))] max-w-[520px] gap-0 p-0',
        )}
        showCloseButton
      >
        <DialogHeader className={SYNTARA_DIALOG_HEADER_CLASS}>
          <DialogTitle className="text-lg font-semibold">新建课程</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto p-5">
          <CreateCourseForm
            key={open ? 'create-course-open' : 'create-course-closed'}
            onSuccess={handleSuccess}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
