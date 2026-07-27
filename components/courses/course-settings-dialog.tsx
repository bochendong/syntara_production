'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Settings2, Trash2 } from 'lucide-react';
import { CreateCourseForm } from '@/components/courses/create-course-form';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/lib/notifications/client-toast';
import { deleteCourseAndNotebooks } from '@/lib/utils/course-storage';
import type { CourseRecord } from '@/lib/utils/database';

type CourseSettingsDialogProps = {
  course: CourseRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCourseUpdated: (course: CourseRecord) => void | Promise<void>;
  onCourseDeleted: (courseId: string) => void | Promise<void>;
};

export function CourseSettingsDialog({
  course,
  open,
  onOpenChange,
  onCourseUpdated,
  onCourseDeleted,
}: CourseSettingsDialogProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) return;
    setDeleteDialogOpen(false);
    setDeleteConfirmation('');
  }, [open]);

  if (!course) return null;

  const deleteConfirmed = deleteConfirmation.trim() === course.name.trim();

  const handleDeleteCourse = async () => {
    if (!deleteConfirmed || deleting) return;
    setDeleting(true);
    try {
      await deleteCourseAndNotebooks(course.id);
      toast.success(`已删除课程「${course.name}」`);
      setDeleteDialogOpen(false);
      setDeleteConfirmation('');
      await onCourseDeleted(course.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '课程删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!deleting) onOpenChange(nextOpen);
        }}
      >
        <DialogContent
          className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-2xl border-border/80 bg-background p-0 shadow-2xl sm:max-h-[min(92dvh,820px)] sm:w-full sm:rounded-[24px]"
          showCloseButton
          data-testid="course-settings-dialog"
        >
          <DialogHeader className="shrink-0 border-b border-border/70 px-5 py-4 pr-14 text-left sm:px-6 sm:py-5">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-[14px] bg-slate-100 text-slate-600 dark:bg-white/8 dark:text-slate-200">
                <Settings2 className="size-[18px]" strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <DialogTitle className="truncate text-lg font-semibold">课程设置</DialogTitle>
                <DialogDescription className="mt-1 truncate">
                  {course.courseCode || course.name}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <Tabs
            key={`${course.id}:${open ? 'open' : 'closed'}`}
            defaultValue="general"
            className="min-h-0 flex-1 gap-0"
          >
            <div className="shrink-0 border-b border-border/70 px-5 py-3 sm:px-6">
              <TabsList className="grid w-full grid-cols-2 sm:w-[320px]">
                <TabsTrigger value="general">常规设置</TabsTrigger>
                <TabsTrigger value="danger">危险操作</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="general" className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">
              <CreateCourseForm
                key={`${course.id}:${open ? 'editing' : 'closed'}`}
                editCourse={course}
                onSuccess={async (_courseId, updatedCourse) => {
                  await onCourseUpdated(updatedCourse);
                  onOpenChange(false);
                  toast.success('课程设置已保存');
                }}
              />
            </TabsContent>

            <TabsContent value="danger" className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">
              <section className="rounded-[20px] border border-rose-200 bg-rose-50/70 p-4 dark:border-rose-300/20 dark:bg-rose-400/8 sm:p-5">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[14px] bg-white text-rose-600 shadow-sm ring-1 ring-rose-100 dark:bg-white/8 dark:text-rose-300 dark:ring-rose-300/15">
                    <AlertTriangle className="size-[18px]" strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-rose-950 dark:text-rose-100">
                      永久删除课程
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-rose-800/80 dark:text-rose-100/70">
                      将删除这门课程以及课程内的笔记本和题目，并从课程列表移除。此操作无法撤销。
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  className="mt-5 h-10 rounded-[12px] px-4"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="size-4" strokeWidth={1.9} />
                  删除课程
                </Button>
              </section>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(nextOpen) => {
          if (deleting) return;
          setDeleteDialogOpen(nextOpen);
          if (!nextOpen) setDeleteConfirmation('');
        }}
      >
        <AlertDialogContent className="border-rose-200 sm:max-w-[480px] dark:border-rose-300/20">
          <AlertDialogHeader>
            <AlertDialogTitle>确认永久删除课程？</AlertDialogTitle>
            <AlertDialogDescription className="leading-6">
              请输入课程名称
              <span className="mx-1 font-semibold text-foreground">“{course.name}”</span>
              以确认删除。删除后无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="delete-course-confirmation">课程名称</Label>
            <Input
              id="delete-course-confirmation"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              placeholder={course.name}
              autoComplete="off"
              disabled={deleting}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={deleting}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              disabled={!deleteConfirmed || deleting}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteCourse();
              }}
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={1.9} />
              ) : (
                <Trash2 className="size-4" strokeWidth={1.9} />
              )}
              {deleting ? '删除中…' : '永久删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
