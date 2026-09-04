'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Bot, Clock3, Eye, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { backendJson } from '@/lib/utils/backend-api';
import { listLocalDemoProblemBank } from '@/lib/teacher/local-demo-problem-bank';
import { findLocalDemoStudent } from '@/lib/teacher/local-demo-student-roster';
import {
  ProblemAttemptReviewDialog,
  type TeacherStudentAttemptDetail,
} from '@/components/problem-bank/problem-attempt-review-dialog';

type StudentDetail = {
  range: string;
  from: string | null;
  to: string;
  student: {
    userId: string;
    name: string;
    phoneLast4: string | null;
    attemptedProblemCount: number;
    passRate: number | null;
    averageActiveDurationMs: number | null;
    timingSampleCount: number;
  };
  problems: Array<{
    problemId: string;
    title: string;
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
    };
    chapterName: string | null;
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
  const student = findLocalDemoStudent(studentId);
  const codeProblem = problems.find((problem) => problem.type === 'code');
  const attemptedProblems = [
    ...problems.slice(0, 3),
    ...(codeProblem && !problems.slice(0, 3).some((problem) => problem.id === codeProblem.id)
      ? [codeProblem]
      : []),
  ];
  return {
    range: '7d',
    from: new Date(DEMO_NOW - 7 * 86_400_000).toISOString(),
    to: new Date(DEMO_NOW).toISOString(),
    student: {
      userId: studentId,
      name: student?.name || '未命名学生',
      phoneLast4: student?.phoneLast4 || null,
      attemptedProblemCount: Math.min(4, problems.length),
      passRate: 0.67,
      averageActiveDurationMs: 390_000,
      timingSampleCount: Math.min(4, problems.length),
    },
    problems: attemptedProblems.map((problem, index) => ({
      problemId: problem.id,
      title: problem.title,
      difficulty: problem.difficulty,
      status: index % 3 === 0 ? 'failed' : 'passed',
      attemptCount: index + 1,
      averageActiveDurationMs: 260_000 + index * 70_000,
      timingSampleCount: 1,
      latestAttempt: {
        id: `mock-attempt-${index}`,
        status: index % 3 === 0 ? 'failed' : 'passed',
        score: index % 3 === 0 ? 0 : 1,
        activeDurationMs: 260_000 + index * 70_000,
        createdAt: DEMO_NOW - index * 3_600_000,
      },
      chapterName: problem.chapterName ?? null,
    })),
  };
}

function localAttemptDetail(
  courseId: string,
  problemId: string,
  latestAttempt: StudentDetail['problems'][number]['latestAttempt'],
): TeacherStudentAttemptDetail | null {
  const problem = (listLocalDemoProblemBank(courseId) || []).find((item) => item.id === problemId);
  if (!problem) return null;
  const content = problem.publicContent;
  const answer =
    content.type === 'choice'
      ? { selectedOptionIds: content.options.slice(0, 1).map((option) => option.id) }
      : content.type === 'fill_blank'
        ? { blanks: Object.fromEntries(content.blanks.map((blank) => [blank.id, '示例作答'])) }
        : content.type === 'code'
          ? {
              code:
                content.starterCode?.replace(
                  /pass\s*$/m,
                  'return sum_link(node.rest) + node.first',
                ) || 'def solution():\n    return None',
            }
          : { text: '这是学生最近一次提交的示例答案。' };
  return {
    ...latestAttempt,
    kind: 'submit',
    answer,
    result: {
      correct: latestAttempt.status === 'passed',
      feedback:
        latestAttempt.status === 'passed'
          ? '回答正确，核心思路完整。'
          : '本次提交未通过，请检查关键条件和推导过程。',
    },
    timingSource: 'client_active',
    problem: {
      id: problem.id,
      title: problem.title,
      type: problem.type,
      difficulty: problem.difficulty,
      points: problem.points,
      publicContent: problem.publicContent,
      chapterName: problem.chapterName ?? null,
    },
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
  const [attempt, setAttempt] = useState<TeacherStudentAttemptDetail | null>(null);
  const [loadingAttemptId, setLoadingAttemptId] = useState<string | null>(null);
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
              {detail.student.phoneLast4
                ? `手机号尾号 ${detail.student.phoneLast4}`
                : '手机号未填写'}
              {' · '}统计范围{' '}
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
          <div className="grid grid-cols-[150px_1fr_100px_80px_120px_40px] gap-3 border-b bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900">
            <span>最近提交</span>
            <span>题目 / 知识点</span>
            <span>结果</span>
            <span>提交次数</span>
            <span>平均用时</span>
            <span className="sr-only">操作</span>
          </div>
          {detail.problems.map((problem) => (
            <button
              key={problem.problemId}
              type="button"
              disabled={loadingAttemptId === problem.latestAttempt.id}
              onClick={async () => {
                if (props.mockMode) {
                  setAttempt(
                    localAttemptDetail(props.courseId, problem.problemId, problem.latestAttempt),
                  );
                  return;
                }
                setLoadingAttemptId(problem.latestAttempt.id);
                try {
                  const value = await backendJson<{ attempt: TeacherStudentAttemptDetail }>(
                    `/api/teacher/courses/${encodeURIComponent(props.courseId)}/students/${encodeURIComponent(props.studentId)}/attempts/${encodeURIComponent(problem.latestAttempt.id)}`,
                  );
                  setAttempt(value.attempt);
                } finally {
                  setLoadingAttemptId(null);
                }
              }}
              className="grid w-full grid-cols-[150px_1fr_100px_80px_120px_40px] items-center gap-3 border-b px-4 py-3 text-left text-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70 dark:border-slate-800 dark:hover:bg-slate-800/50"
            >
              <span className="tabular-nums text-slate-600 dark:text-slate-300">
                {new Date(problem.latestAttempt.createdAt).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{problem.title}</span>
                <span className="block truncate text-xs text-slate-500">
                  {problem.chapterName || '未归档'}
                </span>
              </span>
              <span>
                {problem.status === 'passed'
                  ? '通过'
                  : problem.status === 'partial'
                    ? '部分正确'
                    : problem.status === 'failed'
                      ? '未通过'
                      : '判题异常'}
              </span>
              <span>{problem.attemptCount}</span>
              <span>
                {duration(problem.averageActiveDurationMs)}{' '}
                <small className="text-slate-400">({problem.timingSampleCount})</small>
              </span>
              <span className="grid size-8 place-items-center justify-self-end rounded-lg text-slate-400">
                {loadingAttemptId === problem.latestAttempt.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Eye className="size-4" />
                )}
              </span>
            </button>
          ))}
          {!detail.problems.length ? (
            <div className="grid min-h-56 place-items-center px-6 text-center">
              <div>
                <Clock3 className="mx-auto size-8 text-slate-300" />
                <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                  这个时间范围内还没有做题记录
                </p>
                <p className="mt-1 text-xs text-slate-400">切换统计范围可以查看更早的提交。</p>
              </div>
            </div>
          ) : null}
        </section>
      </div>
      <ProblemAttemptReviewDialog
        open={Boolean(attempt)}
        onOpenChange={(open) => !open && setAttempt(null)}
        attempt={attempt}
      />
    </main>
  );
}
