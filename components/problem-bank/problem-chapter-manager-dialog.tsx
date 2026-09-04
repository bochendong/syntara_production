'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/notifications/client-toast';
import {
  createCourseProblemChapter,
  deleteCourseProblemChapter,
  updateCourseProblemChapter,
  type CourseProblemChapter,
} from '@/lib/utils/notebook-problem-api';

type ChapterDraft = { name: string; description: string };

export function ProblemChapterManagerDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  chapters: CourseProblemChapter[];
  locale: 'zh-CN' | 'en-US';
  onChanged: () => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, ChapterDraft>>({});
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        props.chapters.map((chapter) => [
          chapter.id,
          { name: chapter.name, description: chapter.description },
        ]),
      ),
    );
  }, [props.chapters]);

  const createChapter = async () => {
    const name = newName.trim();
    if (!name || busyId) return;
    setBusyId('__new__');
    try {
      await createCourseProblemChapter({
        courseId: props.courseId,
        name,
        description: newDescription.trim(),
      });
      setNewName('');
      setNewDescription('');
      await props.onChanged();
      toast.success(props.locale === 'zh-CN' ? '章节已添加' : 'Chapter added');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Create failed');
    } finally {
      setBusyId(null);
    }
  };

  const saveChapter = async (chapter: CourseProblemChapter) => {
    const draft = drafts[chapter.id];
    if (!draft?.name.trim() || busyId) return;
    setBusyId(chapter.id);
    try {
      await updateCourseProblemChapter({
        courseId: props.courseId,
        chapterId: chapter.id,
        name: draft.name.trim(),
        description: draft.description.trim(),
      });
      await props.onChanged();
      toast.success(props.locale === 'zh-CN' ? '章节已更新' : 'Chapter updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  const removeChapter = async (chapter: CourseProblemChapter) => {
    if (busyId) return;
    const confirmed = window.confirm(
      props.locale === 'zh-CN'
        ? `删除“${chapter.name}”后，其中 ${chapter.problemCount} 道题会回到未归档。确认删除吗？`
        : `Delete “${chapter.name}”? Its ${chapter.problemCount} problems will become unfiled.`,
    );
    if (!confirmed) return;
    setBusyId(chapter.id);
    try {
      await deleteCourseProblemChapter({ courseId: props.courseId, chapterId: chapter.id });
      await props.onChanged();
      toast.success(props.locale === 'zh-CN' ? '章节已删除' : 'Chapter deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{props.locale === 'zh-CN' ? '管理章节' : 'Manage chapters'}</DialogTitle>
          <DialogDescription>
            {props.locale === 'zh-CN'
              ? '章节由老师手动建立。AI 归档只会把未归档题目放入已有章节。'
              : 'Teachers define chapters. AI filing only places unfiled problems into them.'}
          </DialogDescription>
        </DialogHeader>

        <section className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-500/25 dark:bg-sky-500/10">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            {props.locale === 'zh-CN'
              ? `添加第 ${props.chapters.length + 1} 章`
              : `Add chapter ${props.chapters.length + 1}`}
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_auto]">
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={props.locale === 'zh-CN' ? '章节名字' : 'Chapter name'}
              maxLength={160}
            />
            <Input
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              placeholder={props.locale === 'zh-CN' ? '章节描述' : 'Chapter description'}
              maxLength={2000}
            />
            <Button
              onClick={() => void createChapter()}
              disabled={!newName.trim() || Boolean(busyId)}
            >
              {busyId === '__new__' ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Plus className="mr-1.5 size-4" />
              )}
              {props.locale === 'zh-CN' ? '添加' : 'Add'}
            </Button>
          </div>
        </section>

        <div className="space-y-3">
          {props.chapters.map((chapter, index) => {
            const draft = drafts[chapter.id] ?? {
              name: chapter.name,
              description: chapter.description,
            };
            return (
              <section
                key={chapter.id}
                className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {props.locale === 'zh-CN' ? `第 ${index + 1} 章` : `Chapter ${index + 1}`}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {chapter.problemCount} {props.locale === 'zh-CN' ? '道题' : 'problems'}
                    </span>
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!draft.name.trim() || Boolean(busyId)}
                      onClick={() => void saveChapter(chapter)}
                    >
                      {busyId === chapter.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Save className="size-4" />
                      )}
                      <span className="ml-1.5">{props.locale === 'zh-CN' ? '保存' : 'Save'}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={Boolean(busyId)}
                      onClick={() => void removeChapter(chapter)}
                      aria-label={props.locale === 'zh-CN' ? '删除章节' : 'Delete chapter'}
                      className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-500/10"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)]">
                  <Input
                    value={draft.name}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [chapter.id]: { ...draft, name: event.target.value },
                      }))
                    }
                    aria-label={props.locale === 'zh-CN' ? '章节名字' : 'Chapter name'}
                    maxLength={160}
                  />
                  <Input
                    value={draft.description}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [chapter.id]: { ...draft, description: event.target.value },
                      }))
                    }
                    aria-label={props.locale === 'zh-CN' ? '章节描述' : 'Chapter description'}
                    placeholder={props.locale === 'zh-CN' ? '章节描述' : 'Chapter description'}
                    maxLength={2000}
                  />
                </div>
                <p className="mt-2 truncate text-xs text-slate-400">
                  {props.locale === 'zh-CN'
                    ? `第 ${index + 1} 章：${draft.name || '未命名'}｜${draft.description || '暂无描述'}`
                    : `Chapter ${index + 1}: ${draft.name || 'Untitled'} | ${draft.description || 'No description'}`}
                </p>
              </section>
            );
          })}

          {props.chapters.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500 dark:border-slate-800">
              {props.locale === 'zh-CN'
                ? '还没有章节。请先在上方添加第一章：名字｜章节描述。'
                : 'No chapters yet. Add chapter 1 with a name and description first.'}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
