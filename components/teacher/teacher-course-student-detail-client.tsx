'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Bot, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { backendJson } from '@/lib/utils/backend-api';
import { listLocalDemoProblemBank } from '@/lib/teacher/local-demo-problem-bank';

type StudentDetail = {
  range: string;
  from: string | null;
  to: string;
  student: {
    userId: string;
    name: string;
    email: string;
    attemptedProblemCount: number;
    passRate: number | null;
    averageActiveDurationMs: number | null;
    timingSampleCount: number;
  };
  problems: Array<{
    problemId: string;
    title: string;
    problemNumber: number | null;
    difficulty: string;
    status: string;
    attemptCount: number;
    averageActiveDurationMs: number | null;
    timingSampleCount: number;
    latestAttempt: {
      id: string;
      status: string;
      score: number | null;
      activeDurationMs: number | null;
      createdAt: number;
    } | null;
    tagPaths: Array<{ area: string; concept: string }>;
  }>;
};

const DEMO_NOW = Date.UTC(2026, 8, 3, 9, 0, 0);

function duration(value: number | null) {
  if (value == null) return '暂无数据';
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return minutes ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}

function localDetail(courseId: string, studentId: string): StudentDetail {
  const problems = listLocalDemoProblemBank(courseId) || [];
  return {
    range: '7d',
    from: new Date(DEMO_NOW - 7 * 86_400_000).toISOString(),
    to: new Date(DEMO_NOW).toISOString(),
    student: {
      userId: studentId,
      name: studentId.replace(/^stu-/, ''),
      email: `${studentId}@demo.local`,
      attemptedProblemCount: Math.min(4, problems.length),
      passRate: 0.67,
      averageActiveDurationMs: 390_000,
      timingSampleCount: Math.min(4, problems.length),
    },
    problems: problems.map((problem, index) => ({
      problemId: problem.id,
      title: problem.title,
      problemNumber: problem.problemNumber ?? index + 1,
      difficulty: problem.difficulty,
      status: index < 4 ? (index % 3 === 0 ? 'failed' : 'passed') : 'unattempted',
      attemptCount: index < 4 ? 1 : 0,
      averageActiveDurationMs: index < 4 ? 260_000 + index * 70_000 : null,
      timingSampleCount: index < 4 ? 1 : 0,
      latestAttempt:
        index < 4
          ? {
              id: `mock-attempt-${index}`,
              status: index % 3 === 0 ? 'failed' : 'passed',
              score: index % 3 === 0 ? 0 : 1,
              activeDurationMs: 260_000 + index * 70_000,
              createdAt: DEMO_NOW - index * 3_600_000,
            }
          : null,
      tagPaths: (problem.tagAssignments || []).map((item) => ({
        area: item.area,
        concept: item.concept,
      })),
    })),
  };
}

export function TeacherCourseStudentDetailClient(props: {
  courseId: string;
  studentId: string;
  mockMode?: boolean;
}) {
  const router = useRouter();
  const [range, setRange] = useState('7d');
  const [detail, setDetail] = useState<StudentDetail | null>(() =>
    props.mockMode ? localDetail(props.courseId, props.studentId) : null,
  );
  const [loading, setLoading] = useState(!props.mockMode);
  const [attempt, setAttempt] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (props.mockMode) return;
    void backendJson<StudentDetail>(
      `/api/teacher/courses/${encodeURIComponent(props.courseId)}/students/${encodeURIComponent(props.studentId)}/learning?range=${range}`,
    )
      .then(setDetail)
      .finally(() => setLoading(false));
  }, [props.courseId, props.mockMode, props.studentId, range]);
  if (loading && !detail)
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  if (!detail) return <div className="p-8">学生数据不存在。</div>;
  return (
    <main className="min-h-screen bg-slate-50 p-4 dark:bg-slate-950 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() =>
              router.push(
                `/teacher/courses/${encodeURIComponent(props.courseId)}/students${props.mockMode ? '?mock=1' : ''}`,
              )
            }
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            返回班级
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">{detail.student.name}</h1>
            <p className="text-sm text-slate-500">
              {detail.student.email} · 统计范围{' '}
              {detail.from ? new Date(detail.from).toLocaleDateString('zh-CN') : '全部'} 至今
            </p>
          </div>
          <select
            value={range}
            onChange={(event) => {
              setLoading(true);
              setRange(event.target.value);
            }}
            className="h-9 rounded-lg border bg-white px-3 text-sm dark:bg-slate-900"
          >
            <option value="7d">最近 7 天</option>
            <option value="30d">最近 30 天</option>
            <option value="term">本学期</option>
            <option value="all">全部</option>
          </select>
          <Button
            onClick={() =>
              router.push(
                `/learn?courseId=${encodeURIComponent(props.courseId)}&from=teacher&studentId=${encodeURIComponent(props.studentId)}&range=${range}`,
              )
            }
          >
            <Bot className="mr-1.5 h-4 w-4" />问 AI
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ['已做题', `${detail.student.attemptedProblemCount}`],
            [
              '通过率',
              detail.student.passRate == null
                ? '暂无数据'
                : `${Math.round(detail.student.passRate * 100)}%`,
            ],
            ['平均有效时长', duration(detail.student.averageActiveDurationMs)],
            ['计时样本', `${detail.student.timingSampleCount}`],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-2xl border bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-lg font-semibold">{value}</p>
            </div>
          ))}
        </div>
        <section className="overflow-hidden rounded-2xl border bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="grid grid-cols-[70px_1fr_110px_90px_140px] gap-3 border-b bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900">
            <span>题号</span>
            <span>题目 / 知识点</span>
            <span>最近状态</span>
            <span>尝试</span>
            <span>平均有效时长</span>
          </div>
          {detail.problems.map((problem) => (
            <button
              key={problem.problemId}
              type="button"
              disabled={!problem.latestAttempt}
              onClick={async () => {
                if (!problem.latestAttempt) return;
                if (props.mockMode) {
                  setAttempt(problem.latestAttempt as unknown as Record<string, unknown>);
                  return;
                }
                const value = await backendJson<{ attempt: Record<string, unknown> }>(
                  `/api/teacher/courses/${encodeURIComponent(props.courseId)}/students/${encodeURIComponent(props.studentId)}/attempts/${encodeURIComponent(problem.latestAttempt.id)}`,
                );
                setAttempt(value.attempt);
              }}
              className="grid w-full grid-cols-[70px_1fr_110px_90px_140px] gap-3 border-b px-4 py-3 text-left text-sm hover:bg-slate-50 disabled:cursor-default disabled:opacity-70 dark:border-slate-800 dark:hover:bg-slate-800/50"
            >
              <span>#{problem.problemNumber ?? '—'}</span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{problem.title}</span>
                <span className="block truncate text-xs text-slate-500">
                  {problem.tagPaths.map((tag) => `${tag.area} / ${tag.concept}`).join(' · ') ||
                    '未标注'}
                </span>
              </span>
              <span>{problem.status === 'unattempted' ? '暂无提交' : problem.status}</span>
              <span>{problem.attemptCount}</span>
              <span>
                {duration(problem.averageActiveDurationMs)}{' '}
                <small className="text-slate-400">({problem.timingSampleCount})</small>
              </span>
            </button>
          ))}
        </section>
      </div>
      <Dialog open={Boolean(attempt)} onOpenChange={(open) => !open && setAttempt(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>最近提交详情</DialogTitle>
            <DialogDescription>答案、判题反馈、分数、有效用时和时间戳</DialogDescription>
          </DialogHeader>
          <pre className="whitespace-pre-wrap rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
            {JSON.stringify(attempt, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </main>
  );
}
