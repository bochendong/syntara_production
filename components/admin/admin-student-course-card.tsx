'use client';

import { useEffect, useState } from 'react';
import { Activity, BookOpen, MessageSquare, Loader2 } from 'lucide-react';
import { PracticeProblemPopup } from '@/components/problem-bank/practice-problem-popup';
import { AdminConversationDialog } from '@/components/admin/admin-conversation-dialog';
import { backendJson } from '@/lib/utils/backend-api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Insights = {
  usage: { credits: number; tokens: number; requests: number };
  activities: Array<{
    id: string;
    actionType: string;
    label: string | null;
    createdAt: string;
    problemId: string | null;
  }>;
  conversations: Array<{
    id: string;
    title: string | null;
    updatedAt: string;
    messageCount: number;
  }>;
  chapters: Array<{ id: string; name: string; total: number; attempted: number; passed: number }>;
};
type Course = {
  id: string;
  name: string;
  courseCode: string | null;
  academicYear: number | null;
  academicTerm: string | null;
};
const activityLabels: Record<string, string> = {
  DAILY_SIGN_IN: '每日签到',
  LESSON_MILESTONE_COMPLETED: '完成课程学习',
  QUIZ_COMPLETED: '完成练习',
  QUIZ_ACCURACY_BONUS: '练习正确率奖励',
  REVIEW_COMPLETED: '完成复习',
  DAILY_TASK_REWARD: '完成每日任务',
  STREAK_BONUS: '连续学习奖励',
  CHARACTER_UNLOCK: '解锁角色',
  AVATAR_UNLOCK: '解锁头像',
  CHARACTER_EQUIP: '更换角色',
  GACHA_DRAW: '角色抽取',
};
function date(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function term(course: Course) {
  return [
    course.academicYear,
    { summer: '夏季', fall: '秋季', winter: '冬季' }[course.academicTerm || ''],
  ]
    .filter(Boolean)
    .join(' · ');
}

export function CourseDetail({
  studentId,
  course,
  data,
  error,
  onRetry,
  showCoursePreview = true,
  problemAccess = 'admin',
  conversationUrl,
}: {
  studentId: string;
  course: Course;
  data: Insights | undefined;
  error: string | undefined;
  onRetry: () => void;
  showCoursePreview?: boolean;
  problemAccess?: 'admin' | 'course';
  conversationUrl?: (conversationId: string) => string;
}) {
  const [problemId, setProblemId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  if (error)
    return (
      <div role="alert" className="rounded-lg border p-5">
        <p className="text-sm text-destructive">{error}</p>
        <Button className="mt-3" variant="outline" size="sm" onClick={onRetry}>
          重新加载
        </Button>
      </div>
    );
  if (!data)
    return (
      <div
        role="status"
        className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" />
        正在读取课程学习情况…
      </div>
    );
  const totals = data.chapters.reduce(
    (sum, row) => ({
      total: sum.total + row.total,
      attempted: sum.attempted + row.attempted,
      passed: sum.passed + row.passed,
    }),
    { total: 0, attempted: 0, passed: 0 },
  );
  return (
    <div className="space-y-4">
      <section aria-label="课程学习概览" className="rounded-xl border p-4">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">
              {course.courseCode || course.name}
              <span className="ml-2 text-xs font-normal text-muted-foreground">{term(course)}</span>
            </h3>
            {course.courseCode && course.name !== course.courseCode ? (
              <p className="mt-1 text-sm text-muted-foreground">{course.name}</p>
            ) : null}
          </div>
          {showCoursePreview ? (
            <Button variant="outline" size="sm" asChild>
              <a
                href={`/api/admin/courses/${encodeURIComponent(course.id)}/preview?studentId=${encodeURIComponent(studentId)}`}
              >
                进入学生课程
              </a>
            </Button>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-4 rounded-lg bg-muted/35 px-4 py-4 sm:grid-cols-3 sm:divide-x">
          <div>
            <p className="text-xs text-muted-foreground">课程用量</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {data.usage.credits.toLocaleString()}
              <span className="ml-1 text-xs font-normal text-muted-foreground">积分</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.usage.tokens.toLocaleString()} tokens · {data.usage.requests} 次扣费
            </p>
          </div>
          <div className="sm:pl-4">
            <p className="text-xs text-muted-foreground">已做题目</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {totals.attempted}
              <span className="ml-1 text-base font-normal text-muted-foreground">
                / {totals.total}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">按题目去重统计</p>
          </div>
          <div className="sm:pl-4">
            <p className="text-xs text-muted-foreground">通过题目</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{totals.passed}</p>
            <p className="mt-1 text-xs text-muted-foreground">至少通过一次</p>
          </div>
        </div>
        <h4 className="mb-3 mt-4 text-sm font-semibold">章节学习进度</h4>
        {data.chapters.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[380px] text-left text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-3">章节</th>
                  <th className="px-3 py-3 text-right">已做 / 总题数</th>
                  <th className="px-3 py-3 text-right">通过</th>
                  <th className="px-3 py-3">完成进度</th>
                </tr>
              </thead>
              <tbody>
                {data.chapters.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-3 py-3 font-medium">{row.name}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {row.attempted} / {row.total}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.passed}</td>
                    <td className="min-w-28 px-3 py-3">
                      <div
                        role="progressbar"
                        aria-label={row.name}
                        aria-valuenow={row.attempted}
                        aria-valuemin={0}
                        aria-valuemax={row.total || 1}
                        className="h-1.5 rounded-full bg-primary/10"
                      >
                        <div
                          className="h-full rounded-full bg-primary/60"
                          style={{ width: `${row.total ? (row.attempted / row.total) * 100 : 0}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg bg-muted/20 py-7 text-center text-sm text-muted-foreground">
            该课程暂无题库题目
          </p>
        )}
        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
          用量统计关联此课程的扣费记录。没有章节归属的题目显示在「未分章」中。
        </p>
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="min-w-0 rounded-xl border p-4">
          <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <Activity className="size-4 text-primary" />
            最近活动
          </h4>
          {data.activities.length ? (
            <ul className="divide-y">
              {data.activities.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm leading-6">
                      {row.label || activityLabels[row.actionType] || row.actionType}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{date(row.createdAt)}</p>
                  </div>
                  {row.problemId ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setProblemId(row.problemId)}
                    >
                      查看题目
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-5 text-sm text-muted-foreground">暂无已记录活动</p>
          )}
        </section>
        <section className="min-w-0 rounded-xl border p-4">
          <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="size-4 text-primary" />
            最近对话
          </h4>
          {data.conversations.length ? (
            <ul className="divide-y">
              {data.conversations.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={row.title || '新对话'}>
                      {row.title || '新对话'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {date(row.updatedAt)} · {row.messageCount} 条消息
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setConversationId(row.id)}
                  >
                    查看对话
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-5 text-sm text-muted-foreground">暂无对话</p>
          )}
        </section>
      </div>
      <PracticeProblemPopup
        open={Boolean(problemId)}
        onOpenChange={(open) => {
          if (!open) setProblemId(null);
        }}
        courseId={course.id}
        problemId={problemId}
        access={problemAccess}
      />
      <AdminConversationDialog
        open={Boolean(conversationId)}
        onOpenChange={(open) => {
          if (!open) setConversationId(null);
        }}
        studentId={studentId}
        courseId={course.id}
        conversationId={conversationId}
        messagesUrl={conversationId ? conversationUrl?.(conversationId) : undefined}
        title={data.conversations.find((row) => row.id === conversationId)?.title || undefined}
      />
    </div>
  );
}

export function AdminStudentCourseWorkspace({
  studentId,
  courses,
  refreshKey,
}: {
  studentId: string;
  courses: Course[];
  refreshKey: number;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Insights>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [retry, setRetry] = useState(0);
  const courseIds = courses.map((course) => course.id).join(',');
  useEffect(() => {
    let active = true;
    for (const id of courseIds.split(',').filter(Boolean)) {
      void backendJson<Insights>(
        `/api/admin/students/${encodeURIComponent(studentId)}/courses/${encodeURIComponent(id)}/insights`,
      )
        .then((value) => {
          if (active) {
            setResults((current) => ({ ...current, [id]: value }));
            setErrors((current) => ({ ...current, [id]: '' }));
          }
        })
        .catch((reason) => {
          if (active)
            setErrors((current) => ({
              ...current,
              [id]: reason instanceof Error ? reason.message : '学习数据加载失败',
            }));
        });
    }
    return () => {
      active = false;
    };
  }, [studentId, courseIds, refreshKey, retry]);

  const selected = courses.find((course) => course.id === selectedId) || courses[0];
  if (!selected)
    return (
      <div className="mt-6 rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">
        该学生尚未分配课程。点击姓名旁的「添加课程」开始分配。
      </div>
    );
  return (
    <div>
      <div
        role="tablist"
        aria-label="学生课程"
        className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4"
      >
        {courses.map((course) => (
          <button
            key={course.id}
            type="button"
            role="tab"
            id={`course-tab-${course.id}`}
            aria-controls={`course-panel-${course.id}`}
            aria-selected={selected.id === course.id}
            tabIndex={selected.id === course.id ? 0 : -1}
            onKeyDown={(event) => {
              const index = courses.findIndex((row) => row.id === course.id);
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % courses.length
                  : event.key === 'ArrowLeft'
                    ? (index - 1 + courses.length) % courses.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? courses.length - 1
                        : -1;
              if (next >= 0) {
                event.preventDefault();
                setSelectedId(courses[next].id);
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                  [next]?.focus();
              }
            }}
            onClick={() => setSelectedId(course.id)}
            className={cn(
              'flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-primary',
              selected.id === course.id
                ? 'border-primary bg-primary/5'
                : 'border-border bg-muted/15 hover:bg-muted/40',
            )}
          >
            <BookOpen className="size-4 shrink-0 text-primary" />
            <span className="min-w-0">
              <span
                className="block truncate text-sm font-semibold"
                title={course.courseCode || course.name}
              >
                {course.courseCode || course.name}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {results[course.id]
                  ? '已做 ' +
                    results[course.id].chapters.reduce((sum, row) => sum + row.attempted, 0) +
                    ' 题'
                  : term(course)}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`course-panel-${selected.id}`}
        aria-labelledby={`course-tab-${selected.id}`}
      >
        <CourseDetail
          studentId={studentId}
          course={selected}
          data={results[selected.id]}
          error={errors[selected.id]}
          onRetry={() => setRetry((value) => value + 1)}
        />
      </div>
    </div>
  );
}
