'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { backendJson } from '@/lib/utils/backend-api';

type Row = {
  id: string;
  name?: string;
  title?: string;
  description?: string | null;
  notebookKind?: string;
  removedAt?: string | null;
  type?: string;
  status?: string;
  problemNumber?: number | null;
  course: { name: string } | null;
  notebook?: { name: string } | null;
  chapter?: { name: string } | null;
  _count?: { pages: number; scenes: number; markdownSections: number; problems: number };
};
type Resources = {
  courses: { id: string; name: string }[];
  rows: Row[];
  notebookCount: number;
  problemCount: number;
  page: number;
  pages: number;
  total: number;
};
const typeNames: Record<string, string> = {
  proof: '证明题',
  calculation: '计算题',
  code: '编程题',
  coding: '编程题',
  choice: '选择题',
  multiple_choice: '选择题',
  fill_blank: '填空题',
  short_answer: '简答题',
  single_choice: '单选题',
};
const statusNames: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
};

function ResourceList({
  teacherId,
  kind,
  courseId,
  page,
  onPageChange,
  onCourses,
}: {
  teacherId: string;
  kind: string;
  courseId: string;
  page: number;
  onPageChange: (page: number) => void;
  onCourses: (courses: Resources['courses']) => void;
}) {
  const [result, setResult] = useState<Resources | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ kind, courseId, page: String(page) });
    void backendJson<Resources>(
      `/api/admin/teachers/${encodeURIComponent(teacherId)}/resources?${query}`,
    )
      .then((data) => {
        if (active) {
          setResult(data);
          onCourses(data.courses);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [teacherId, kind, courseId, page, retry, onCourses]);
  if (error)
    return (
      <div role="alert">
        资料加载失败。
        <Button
          variant="outline"
          onClick={() => {
            setError(false);
            setRetry((v) => v + 1);
          }}
        >
          重试
        </Button>
      </div>
    );
  if (!result) return <p role="status">正在加载老师资料…</p>;
  return (
    <>
      <p className="text-sm text-muted-foreground">
        当前范围：{result.notebookCount} 个笔记本 · {result.problemCount} 道题目 · 第 {result.page}/
        {result.pages} 页
      </p>
      {result.rows.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          当前范围内暂无{kind === 'notebooks' ? '笔记本' : '题目'}。
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {result.rows.map((row) => (
            <li key={row.id} className="space-y-1 p-4">
              <p className="break-words font-medium">
                {row.problemNumber != null ? `${row.problemNumber}. ` : ''}
                {row.name || row.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {row.course?.name || '未归入课程'}
                {row.chapter ? ` · ${row.chapter.name}` : ''}
                {row.notebook ? ` · 来源：${row.notebook.name}` : ''}
              </p>
              {row._count ? (
                <p className="text-xs text-muted-foreground">
                  {row.notebookKind === 'markdown' ? 'Markdown 笔记本' : '图文笔记本'} ·{' '}
                  {row.notebookKind === 'markdown'
                    ? `${row._count.markdownSections} 节`
                    : `${row._count.pages || row._count.scenes} 页`}{' '}
                  · {row._count.problems} 道题{row.removedAt ? ' · 已移除' : ''}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {typeNames[row.type || ''] || row.type} ·{' '}
                  {statusNames[row.status || ''] || row.status}
                </p>
              )}
              {row.description ? (
                <p className="whitespace-pre-wrap break-words text-sm">{row.description}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={result.page <= 1}
          onClick={() => onPageChange(result.page - 1)}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          disabled={result.page >= result.pages}
          onClick={() => onPageChange(result.page + 1)}
        >
          下一页
        </Button>
      </div>
    </>
  );
}

export function TeacherResourcesDialog({
  teacher,
  onClose,
}: {
  teacher: { id: string; name: string; email: string };
  onClose: () => void;
}) {
  const [kind, setKind] = useState('notebooks');
  const [courseId, setCourseId] = useState('');
  const [page, setPage] = useState(1);
  const [courses, setCourses] = useState<Resources['courses']>([]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{teacher.name || teacher.email} 的教学资料</DialogTitle>
          <DialogDescription>
            查看老师名下的题库与笔记本，包含草稿和已移除笔记本。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={kind === 'notebooks' ? 'default' : 'outline'}
            aria-pressed={kind === 'notebooks'}
            onClick={() => {
              setKind('notebooks');
              setPage(1);
            }}
          >
            笔记本
          </Button>
          <Button
            variant={kind === 'problems' ? 'default' : 'outline'}
            aria-pressed={kind === 'problems'}
            onClick={() => {
              setKind('problems');
              setPage(1);
            }}
          >
            题库
          </Button>
          <select
            aria-label="筛选课程"
            value={courseId}
            onChange={(event) => {
              setCourseId(event.target.value);
              setPage(1);
            }}
            className="min-w-0 max-w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">全部课程</option>
            <option value="unassigned">未归入课程</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </div>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto">
          <ResourceList
            key={`${kind}:${courseId}:${page}`}
            teacherId={teacher.id}
            kind={kind}
            courseId={courseId}
            page={page}
            onPageChange={setPage}
            onCourses={setCourses}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
