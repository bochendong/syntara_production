'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from '@/lib/notifications/client-toast';
import type { NotebookProblemImportDraft } from '@/lib/problem-bank';
import type {
  CourseProblemChapter,
  NotebookProblemClientRecord,
} from '@/lib/utils/notebook-problem-api';
import { problemDraftToPatch, problemRecordToDraft } from '@/lib/problem-bank/editor';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  FormulaReferencePanel,
  ProblemDraftPreviewPanel,
} from '@/components/problem-bank/course-problem-bank-helpers';
import { ProblemDraftForm } from '@/components/problem-bank/problem-draft-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  SYNTARA_WORKSPACE_DIALOG_CONTENT_CLASS,
  SYNTARA_DIALOG_HEADER_CLASS,
} from '@/components/ui/syntara-dialog-style';

type Locale = 'zh-CN' | 'en-US';

export function ProblemEditDialog({
  open,
  onOpenChange,
  locale,
  problem,
  onSave,
  chapters = [],
}: {
  chapters?: CourseProblemChapter[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
  problem: NotebookProblemClientRecord | null;
  onSave: (
    patch: ReturnType<typeof problemDraftToPatch> & { chapterId?: string | null },
  ) => Promise<void>;
}) {
  const formId = useId();
  const draft = useMemo(() => (problem ? problemRecordToDraft(problem) : null), [problem]);
  const [previewDraft, setPreviewDraft] = useState<NotebookProblemImportDraft | null>(null);
  const [chapterOverride, setChapterOverride] = useState<string | null>(null);
  const chapterId = chapterOverride ?? problem?.chapterId ?? '';
  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      setChapterOverride(null);
      setPreviewDraft(null);
    }
    onOpenChange(nextOpen);
  };
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const activeFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const insertFormula = (latex: string) => {
    const activeField = activeFieldRef.current;
    const field =
      activeField &&
      activeField.getClientRects().length > 0 &&
      editorRef.current?.contains(activeField)
        ? activeField
        : (Array.from(
            editorRef.current?.querySelectorAll(
              'textarea, input[type="text"], input:not([type])',
            ) ?? [],
          ).find((element) => element.getClientRects().length > 0) as
            | HTMLInputElement
            | HTMLTextAreaElement
            | undefined);
    if (!field || field.disabled || field.readOnly) return;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const nextValue = field.value.slice(0, start) + latex + field.value.slice(end);
    // Use the native setter so React receives an input event for its controlled field.
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, nextValue);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus();
    field.setSelectionRange(start + latex.length, start + latex.length);
    activeFieldRef.current = field;
  };

  const handleSave = async (nextDraft: NotebookProblemImportDraft) => {
    setSaving(true);
    try {
      await onSave({ ...problemDraftToPatch(nextDraft), chapterId: chapterId || null });
      toast.success(locale === 'zh-CN' ? '题目已更新' : 'Problem updated');
      changeOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className={SYNTARA_WORKSPACE_DIALOG_CONTENT_CLASS}>
        <DialogHeader
          className={`${SYNTARA_DIALOG_HEADER_CLASS} flex-row items-center justify-between gap-4`}
        >
          <div className="min-w-0 space-y-2">
            <DialogTitle>{locale === 'zh-CN' ? '编辑题目' : 'Edit problem'}</DialogTitle>
            <DialogDescription>
              {locale === 'zh-CN'
                ? '修改题面、答案和难度，保存后更新到题库。'
                : 'Update the statement, answers, and difficulty, then save the changes.'}
            </DialogDescription>
          </div>
          <Button type="submit" form={formId} disabled={saving || !draft} className="shrink-0">
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {saving
              ? locale === 'zh-CN'
                ? '保存中…'
                : 'Saving...'
              : locale === 'zh-CN'
                ? '保存修改'
                : 'Save changes'}
          </Button>
        </DialogHeader>

        {draft ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden">
            <div
              ref={editorRef}
              aria-label={locale === 'zh-CN' ? '题目编辑区' : 'Problem editor'}
              className="min-w-0 space-y-4 p-5 lg:min-h-0 lg:overflow-y-auto"
              onFocusCapture={(event) => {
                const target = event.target;
                if (
                  target instanceof HTMLTextAreaElement ||
                  (target instanceof HTMLInputElement &&
                    ['text', 'search', 'url'].includes(target.type))
                ) {
                  activeFieldRef.current = target;
                }
              }}
            >
              <ProblemDraftForm
                key={draft.draftId}
                formId={formId}
                draft={draft}
                locale={locale}
                basicInfoSlot={
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor={`${draft.draftId}-chapter`}>
                      {locale === 'zh-CN' ? '所属章节' : 'Chapter'}
                    </label>
                    <select
                      id={`${draft.draftId}-chapter`}
                      value={chapterId}
                      onChange={(event) => setChapterOverride(event.target.value)}
                      className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                    >
                      <option value="">{locale === 'zh-CN' ? '未归档' : 'Unfiled'}</option>
                      {chapters.map((chapter) => (
                        <option key={chapter.id} value={chapter.id}>
                          {chapter.name}
                        </option>
                      ))}
                    </select>
                  </div>
                }
                onDraftChange={setPreviewDraft}
                onSave={handleSave}
                saveLabel={locale === 'zh-CN' ? '保存修改' : 'Save changes'}
              />
            </div>
            <aside
              aria-label={locale === 'zh-CN' ? '公式与预览' : 'Formulas and preview'}
              className="min-w-0 overflow-x-auto border-t border-slate-200 bg-slate-50/50 p-5 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l dark:border-slate-800 dark:bg-slate-900/30"
            >
              <Tabs defaultValue="formulas" className="min-w-0">
                <TabsList className="w-full">
                  <TabsTrigger value="formulas">
                    {locale === 'zh-CN' ? '公式表' : 'Formulas'}
                  </TabsTrigger>
                  <TabsTrigger value="preview">
                    {locale === 'zh-CN' ? '预览题目' : 'Problem preview'}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="formulas" forceMount className="data-[state=inactive]:hidden">
                  <p className="mb-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {locale === 'zh-CN'
                      ? '点击左侧输入框定位光标，再点击公式的「插入」。'
                      : 'Place the cursor in an editor field, then click Insert beside a formula.'}
                  </p>
                  <FormulaReferencePanel locale={locale} onInsert={insertFormula} />
                </TabsContent>
                <TabsContent value="preview">
                  <ProblemDraftPreviewPanel draft={previewDraft ?? draft} locale={locale} />
                </TabsContent>
              </Tabs>
            </aside>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
