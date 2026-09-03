'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { toast } from '@/lib/notifications/client-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  mergeCourseProblemTags,
  updateCourseProblemTag,
  type CourseProblemTagTreeNode,
} from '@/lib/utils/notebook-problem-api';

export function ProblemTagManagerDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  tree: CourseProblemTagTreeNode[];
  locale: 'zh-CN' | 'en-US';
  onChanged: () => Promise<void>;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const area of props.tree) {
      next[area.id] = area.name;
      for (const concept of area.concepts) next[concept.id] = concept.name;
    }
    setNames(next);
  }, [props.tree]);

  const save = async (
    tagId: string,
    patch: { name?: string; parentId?: string; confirmAssignments?: boolean },
  ) => {
    setBusyId(tagId);
    try {
      await updateCourseProblemTag({ courseId: props.courseId, tagId, ...patch });
      await props.onChanged();
      toast.success(props.locale === 'zh-CN' ? '知识树已更新' : 'Knowledge tree updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  const concepts = props.tree.flatMap((area) =>
    area.concepts.map((concept) => ({ ...concept, areaId: area.id, areaName: area.name })),
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[82vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {props.locale === 'zh-CN' ? '管理课程知识树' : 'Manage knowledge tree'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {props.tree.map((area) => (
            <section
              key={area.id}
              className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"
            >
              <div className="flex items-center gap-2">
                <Input
                  value={names[area.id] ?? area.name}
                  onChange={(event) =>
                    setNames((current) => ({ ...current, [area.id]: event.target.value }))
                  }
                  className="h-9 font-semibold"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === area.id || !(names[area.id] || '').trim()}
                  onClick={() => void save(area.id, { name: names[area.id] })}
                >
                  {busyId === area.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <div className="mt-3 space-y-2">
                {area.concepts.map((concept) => (
                  <div
                    key={concept.id}
                    className="grid gap-2 rounded-lg bg-slate-50 p-2 md:grid-cols-[1fr_150px_180px] dark:bg-slate-900/60"
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        value={names[concept.id] ?? concept.name}
                        onChange={(event) =>
                          setNames((current) => ({ ...current, [concept.id]: event.target.value }))
                        }
                        className="h-8"
                      />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={busyId === concept.id}
                        onClick={() => void save(concept.id, { name: names[concept.id] })}
                      >
                        {busyId === concept.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <select
                      value={area.id}
                      onChange={(event) => void save(concept.id, { parentId: event.target.value })}
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                    >
                      {props.tree.map((targetArea) => (
                        <option key={targetArea.id} value={targetArea.id}>
                          {targetArea.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value=""
                      aria-label={
                        props.locale === 'zh-CN' ? '合并到其他知识点' : 'Merge into another concept'
                      }
                      onChange={async (event) => {
                        const targetId = event.target.value;
                        if (!targetId) return;
                        setBusyId(concept.id);
                        try {
                          await mergeCourseProblemTags({
                            courseId: props.courseId,
                            sourceId: concept.id,
                            targetId,
                          });
                          await props.onChanged();
                          toast.success(
                            props.locale === 'zh-CN' ? '知识点已合并' : 'Concepts merged',
                          );
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : 'Merge failed');
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                    >
                      <option value="">
                        {props.locale === 'zh-CN' ? '合并到…' : 'Merge into…'}
                      </option>
                      {concepts
                        .filter((target) => target.id !== concept.id)
                        .map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.areaName} / {target.name}
                          </option>
                        ))}
                    </select>
                    {concept.status === 'pending' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-fit text-xs text-amber-700"
                        onClick={() => void save(concept.id, { confirmAssignments: true })}
                      >
                        {props.locale === 'zh-CN' ? '确认应用' : 'Apply'}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
          {props.tree.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              {props.locale === 'zh-CN'
                ? '暂无知识树，请先运行 AI 整理标签。'
                : 'No knowledge tree yet. Run AI tag organization first.'}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
