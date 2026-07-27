'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock3,
  Database,
  FileSearch,
  Loader2,
  MessageCircle,
  Route,
  Search,
  Sparkles,
  Target,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  CSC148_MEMORY_REVIEW_PLAN_CASES,
  type Csc148MemoryReviewPlanCase,
} from '@/features/qa/test-center/memory/csc148-memory-review-plan-cases';
import {
  loadLocalMemoryReviewPlanLatestResults,
  saveLocalMemoryReviewPlanLatestResult,
  isLocalMemoryReviewPlanLatestResult,
  type LocalMemoryReviewPlanLatestResult,
} from '@/features/qa/test-center/memory/local-memory-review-plan-result-store';
import { loadPhaseTwoRunsFromLocalFiles } from '@/features/qa/test-center/memory/local-memory-run-file-sync';
import {
  disposeLocalMemoryTestScenarioRun,
  ensureLocalMemoryTestUserCohort,
  LOCAL_MEMORY_TEST_USER_FIXTURES,
  prepareLocalMemoryTestScenarioRun,
  runLocalMemoryTestAction,
  type LocalMemoryTestSnapshot,
} from '@/features/qa/test-center/memory/local-memory-test-store';
import type {
  MemoryReviewPlanRequest,
  MemoryReviewPlanResponse,
  MemoryReviewPlanToolId,
} from '@/features/qa/test-center/memory/memory-review-plan-types';
import { courseProblemHref } from '@/features/qa/test-center/memory/problem-bank-link';
import { MEMORY_SYSTEM_TEST_SCENARIOS } from '@/features/qa/test-center/registry';
import { useSettingsStore } from '@/lib/store/settings';
import { backendJson } from '@/lib/utils/backend-api';
import { getCourseMaterialBlob } from '@/lib/utils/course-material-storage';

const SCENARIO_ID = 'memory-ai-review-plan';
const TOOL_LABELS: Record<MemoryReviewPlanToolId, string> = {
  read_user_profile: '读取全局用户资料',
  read_calendar: '读取日历',
  search_learning_memory: '检索学习记忆',
  search_problem_attempts: '检索做题记录',
  search_problem_bank: 'RAG 检索 CSC148 题库',
  search_notebooks: 'RAG 检索课程笔记',
};

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

function studentScheduleLabel(session: MemoryReviewPlanResponse['plan']['sessions'][number]) {
  const offset = session.startTime.match(/^开始后\s*(\d+)\s*分钟$/);
  if (offset) {
    const minutes = Number(offset[1]);
    return minutes === 0 ? '现在开始' : `${minutes} 分钟后`;
  }
  return `${session.dayLabel} ${session.startTime}`;
}

function toDayKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function stableFingerprint(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function resolveSessionQuestions(
  response: MemoryReviewPlanResponse,
  session: MemoryReviewPlanResponse['plan']['sessions'][number],
) {
  if (session.questions?.length === session.problemIds.length) return session.questions;
  const selectedById = new Map(
    response.problemBank.selected.map((problem) => [problem.id, problem] as const),
  );
  const courseId = response.problemBank.courseId;
  return session.problemIds.flatMap((problemId) => {
    const problem = selectedById.get(problemId);
    if (!problem) return [];
    return [
      {
        problemId,
        title: problem.title,
        href: problem.href || (courseId ? courseProblemHref(courseId, problemId) : ''),
        type: problem.type,
        difficulty: problem.difficulty,
        tags: problem.tags,
        reason: session.reason,
        evidenceIds: session.evidenceIds,
      },
    ];
  });
}

function calendarSource(
  snapshot: LocalMemoryTestSnapshot,
): MemoryReviewPlanRequest['sources']['calendar'] {
  return snapshot.facts
    .filter((fact) => fact.namespace === 'calendar')
    .map((fact) => {
      const value =
        fact.valueJson && typeof fact.valueJson === 'object'
          ? (fact.valueJson as Record<string, unknown>)
          : {};
      const startsAt = String(value.startsAt || value.startAt || '');
      if (!startsAt) return null;
      const durationMinutes =
        typeof value.durationMinutes === 'number' ? value.durationMinutes : null;
      return {
        id: String(value.id || fact.id),
        title: String(value.title || fact.key),
        startsAt,
        endsAt:
          typeof value.endsAt === 'string'
            ? value.endsAt
            : typeof value.endAt === 'string'
              ? value.endAt
              : durationMinutes
                ? new Date(Date.parse(startsAt) + durationMinutes * 60_000).toISOString()
                : null,
        timezone: String(
          value.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        ),
        status: String(value.status || 'planned'),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

async function notebookSource(
  snapshot: LocalMemoryTestSnapshot,
): Promise<MemoryReviewPlanRequest['sources']['notebooks']> {
  const documents = await Promise.all(
    snapshot.sources.materials.map(async (material) => {
      const blob = await getCourseMaterialBlob(material.id);
      if (!blob) return null;
      const content = await blob.text();
      if (!content.trim()) return null;
      return {
        id: material.id,
        title: material.name,
        content,
        updatedAt: material.updatedAt,
      };
    }),
  );
  return documents.filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function requestFromSnapshot(args: {
  snapshot: LocalMemoryTestSnapshot;
  testCase: Csc148MemoryReviewPlanCase;
  query: string;
  notebooks: MemoryReviewPlanRequest['sources']['notebooks'];
}): MemoryReviewPlanRequest {
  const fixture = LOCAL_MEMORY_TEST_USER_FIXTURES.find(
    (item) => item.userId === args.testCase.fixtureUserId,
  );
  if (!fixture) throw new Error('找不到这条测试对应的模拟用户。');
  const conceptByProblemId = new Map(
    args.snapshot.sources.problems.map((problem) => [problem.id, problem.concept] as const),
  );
  return {
    action: 'generate_review_plan',
    user: {
      id: args.snapshot.user.id,
      name: args.snapshot.user.name,
      courseCode: 'CSC148',
      learnerProfile: fixture.learnerProfile,
      studyHabit: fixture.studyHabit,
    },
    query: args.query.trim(),
    today: toDayKey(new Date()),
    constraints: {
      totalMinutes: args.testCase.totalMinutes,
      maxSessions: args.testCase.expectedMinSessions === 1 ? 3 : 5,
      maxQuestionsPerSession: 5,
    },
    sources: {
      calendar: calendarSource(args.snapshot),
      memories: args.snapshot.studyMemories.map((memory) => ({
        id: memory.id,
        title: memory.title,
        text: memory.text,
        kind: memory.kind,
        scope: memory.scope,
        status: memory.status,
        updatedAt: memory.updatedAt,
      })),
      attempts: args.snapshot.sources.attempts.map((attempt) => ({
        id: attempt.id,
        problemId: attempt.problemId,
        problemTitle: attempt.problemTitle,
        concept: conceptByProblemId.get(attempt.problemId) || '未标注知识点',
        status: attempt.status,
        score: attempt.score,
        maxScore: attempt.maxScore,
        feedback: attempt.feedback,
        createdAt: attempt.createdAt,
      })),
      notebooks: args.notebooks,
    },
  };
}

function evaluateCase(testCase: Csc148MemoryReviewPlanCase, response: MemoryReviewPlanResponse) {
  const called = new Set(response.readPlan.calls.map((call) => call.toolId));
  const expectedToolsPassed = testCase.expectedTools.every((toolId) => called.has(toolId));
  const forbiddenToolsPassed = testCase.forbiddenTools.every((toolId) => !called.has(toolId));
  const sessionCountPassed = response.plan.sessions.length >= testCase.expectedMinSessions;
  const questionCount = response.plan.sessions.reduce(
    (sum, session) => sum + session.questionCount,
    0,
  );
  const questionCountPassed = questionCount >= testCase.expectedQuestionCount;
  const checks = [
    ...response.machineChecks,
    {
      id: 'case-required-tools',
      label: '调用了本用例要求的证据工具',
      passed: expectedToolsPassed,
      detail: testCase.expectedTools.map((toolId) => TOOL_LABELS[toolId]).join('、'),
    },
    {
      id: 'case-forbidden-tools',
      label: '没有读取用户明确排除的来源',
      passed: forbiddenToolsPassed,
      detail: testCase.forbiddenTools.length
        ? testCase.forbiddenTools.map((toolId) => TOOL_LABELS[toolId]).join('、')
        : '本用例没有禁止来源',
    },
    {
      id: 'case-session-count',
      label: '计划覆盖所需复习次数',
      passed: sessionCountPassed,
      detail: `${response.plan.sessions.length} 次，要求至少 ${testCase.expectedMinSessions} 次`,
    },
    {
      id: 'case-question-count',
      label: '计划安排了足够的真实题库题目',
      passed: questionCountPassed,
      detail: `${questionCount} 题，要求至少 ${testCase.expectedQuestionCount} 题`,
    },
  ];
  return { checks, passed: checks.every((check) => check.passed) };
}

export function MemoryReviewPlanTestWorkspace() {
  const scenario = MEMORY_SYSTEM_TEST_SCENARIOS.find((item) => item.id === SCENARIO_ID);
  const scenarioIndex = MEMORY_SYSTEM_TEST_SCENARIOS.findIndex((item) => item.id === SCENARIO_ID);
  const previousScenario = MEMORY_SYSTEM_TEST_SCENARIOS[scenarioIndex - 1] || null;
  const nextScenario = MEMORY_SYSTEM_TEST_SCENARIOS[scenarioIndex + 1] || null;
  const providerId = useSettingsStore((state) => state.providerId);
  const modelId = useSettingsStore((state) => state.modelId);
  const [selectedCaseId, setSelectedCaseId] = useState(CSC148_MEMORY_REVIEW_PLAN_CASES[0].id);
  const [query, setQuery] = useState(CSC148_MEMORY_REVIEW_PLAN_CASES[0].query);
  const [cohort, setCohort] = useState<LocalMemoryTestSnapshot[]>([]);
  const [latestResults, setLatestResults] = useState<
    Record<string, LocalMemoryReviewPlanLatestResult>
  >({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const selectedCase =
    CSC148_MEMORY_REVIEW_PLAN_CASES.find((item) => item.id === selectedCaseId) ||
    CSC148_MEMORY_REVIEW_PLAN_CASES[0];
  const baseline = cohort.find((item) => item.user.id === selectedCase.fixtureUserId) || null;
  const latestResult = latestResults[selectedCase.id] || null;
  const userMessage = latestResult?.response.plan.userMessage?.trim() || null;
  const userFacingQuestionSessions = latestResult
    ? latestResult.response.plan.sessions
        .map((session) => ({
          session,
          questions: resolveSessionQuestions(latestResult.response, session),
        }))
        .filter(({ questions }) => questions.length > 0)
    : [];
  const evaluation = latestResult ? evaluateCase(selectedCase, latestResult.response) : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [snapshots, saved, fileRecords] = await Promise.all([
          ensureLocalMemoryTestUserCohort(),
          loadLocalMemoryReviewPlanLatestResults(),
          loadPhaseTwoRunsFromLocalFiles<LocalMemoryReviewPlanLatestResult>(SCENARIO_ID).catch(
            () => [],
          ),
        ]);
        if (cancelled) return;
        setCohort(snapshots);
        const merged = Object.fromEntries(saved.map((item) => [item.caseId, item]));
        for (const record of fileRecords) {
          const candidate = record.result;
          if (!isLocalMemoryReviewPlanLatestResult(candidate)) continue;
          const current = merged[record.caseId];
          if (candidate?.updatedAt && (!current || candidate.updatedAt > current.updatedAt)) {
            merged[record.caseId] = candidate;
          }
        }
        setLatestResults(merged);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function selectCase(testCase: Csc148MemoryReviewPlanCase) {
    setSelectedCaseId(testCase.id);
    setQuery(testCase.query);
    setError('');
  }

  async function runSelectedCase() {
    setRunning(true);
    setError('');
    let disposableUserId = '';
    try {
      let snapshot = await prepareLocalMemoryTestScenarioRun({
        scenarioId: SCENARIO_ID,
        fixtureUserId: selectedCase.fixtureUserId,
      });
      disposableUserId = snapshot.user.id;
      if (selectedCase.calendarEvent) {
        const startsAt = new Date();
        startsAt.setDate(startsAt.getDate() + selectedCase.calendarEvent.daysFromNow);
        startsAt.setHours(9, 0, 0, 0);
        const mutation = await runLocalMemoryTestAction({
          action: 'upsert_calendar',
          userId: snapshot.user.id,
          eventId: `review-plan-${selectedCase.id}`,
          title: selectedCase.calendarEvent.title,
          startsAt: startsAt.toISOString(),
          durationMinutes: selectedCase.calendarEvent.durationMinutes,
        });
        snapshot = mutation.snapshot;
      }
      const notebooks = await notebookSource(snapshot);
      const request = requestFromSnapshot({ snapshot, testCase: selectedCase, query, notebooks });
      const sourceFingerprint = stableFingerprint({
        user: selectedCase.fixtureUserId,
        calendar: request.sources.calendar,
        memories: request.sources.memories.map((item) => [item.id, item.updatedAt]),
        attempts: request.sources.attempts.map((item) => [item.id, item.createdAt]),
        notebooks: request.sources.notebooks.map((item) => [item.id, item.updatedAt]),
      });
      const modelHeaders: Record<string, string> =
        providerId === 'openai' && modelId ? { 'x-model': `openai:${modelId}` } : {};
      const response = await backendJson<MemoryReviewPlanResponse>(
        '/api/platform-tests/memory-local-review-plan',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-generation-test-no-charge': 'true',
            ...modelHeaders,
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(360_000),
        },
      );
      const saved = await saveLocalMemoryReviewPlanLatestResult({
        caseId: selectedCase.id,
        fixtureUserId: selectedCase.fixtureUserId,
        query: request.query,
        sourceFingerprint,
        response,
      });
      setLatestResults((current) => ({ ...current, [selectedCase.id]: saved }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (disposableUserId) await disposeLocalMemoryTestScenarioRun(disposableUserId);
      setRunning(false);
    }
  }

  if (!scenario) return null;

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-950">
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        <header className="mb-5 rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm sm:px-7">
          <Button asChild variant="ghost" className="-ml-3 rounded-lg text-slate-600">
            <Link href="/test#phase-two-memory-title">
              <ArrowLeft className="size-4" /> 返回第二阶段测试列表
            </Link>
          </Button>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-4xl">
              <div className="flex flex-wrap gap-2">
                <Badge className="rounded-md bg-violet-600 hover:bg-violet-600">第二阶段</Badge>
                <Badge variant="outline" className="font-mono">
                  测试 {String(scenarioIndex + 1).padStart(2, '0')} /{' '}
                  {MEMORY_SYSTEM_TEST_SCENARIOS.length}
                </Badge>
                <Badge variant="outline">Agent 式读取计划</Badge>
                <Badge variant="outline">每条只保留最新结果</Badge>
                <Badge variant="outline">浏览器 + 本地文件记录</Badge>
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                {scenario.title}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{scenario.summary}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              {previousScenario ? (
                <Button asChild variant="outline" className="rounded-xl">
                  <Link href={`/test/${previousScenario.id}`}>
                    <ChevronLeft className="size-4" /> 上一条
                  </Link>
                </Button>
              ) : null}
              {nextScenario ? (
                <Button asChild className="rounded-xl bg-slate-950 hover:bg-slate-800">
                  <Link href={`/test/${nextScenario.id}`}>
                    下一条 <ChevronRight className="size-4" />
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </header>

        <div className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-5">
            <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100 bg-white pb-4">
                <div className="flex items-center justify-between gap-3">
                  <Badge className="bg-slate-950 hover:bg-slate-950">
                    {CSC148_MEMORY_REVIEW_PLAN_CASES.length} 条独立测试
                  </Badge>
                  <span className="text-xs text-slate-400">latest-by-case</span>
                </div>
                <CardTitle className="mt-2 text-lg">选择自然语言任务</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 bg-slate-50/70 p-3">
                {CSC148_MEMORY_REVIEW_PLAN_CASES.map((testCase, index) => {
                  const result = latestResults[testCase.id];
                  const resultEvaluation = result ? evaluateCase(testCase, result.response) : null;
                  const selected = testCase.id === selectedCase.id;
                  return (
                    <button
                      type="button"
                      key={testCase.id}
                      onClick={() => selectCase(testCase)}
                      disabled={running}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                        selected
                          ? 'border-slate-950 bg-slate-950 text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-900 hover:border-slate-400'
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <span className="flex items-start gap-3">
                        <span
                          className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
                            selected ? 'bg-white text-slate-950' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold leading-5">
                            {testCase.title}
                          </span>
                          <span
                            className={`mt-1 block text-xs leading-4 ${selected ? 'text-slate-300' : 'text-slate-500'}`}
                          >
                            {testCase.shortTitle}
                          </span>
                          <span className="mt-2 flex items-center gap-1 text-[11px]">
                            {!result ? (
                              <>
                                <CircleDashed className="size-3" /> 未运行
                              </>
                            ) : resultEvaluation?.passed ? (
                              <>
                                <CheckCircle2 className="size-3" /> 最新结果通过
                              </>
                            ) : (
                              <>
                                <XCircle className="size-3" /> 最新结果待检查
                              </>
                            )}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          </aside>

          <div className="min-w-0 space-y-5">
            {error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
                {error}
              </div>
            ) : null}

            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-slate-950 hover:bg-slate-950">自然语言输入</Badge>
                      <Badge variant="outline">{selectedCase.shortTitle}</Badge>
                    </div>
                    <CardTitle className="mt-3 text-xl">{selectedCase.title}</CardTitle>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{selectedCase.purpose}</p>
                  </div>
                  <Button
                    onClick={() => void runSelectedCase()}
                    disabled={running || loading || !query.trim()}
                    className="shrink-0 rounded-xl bg-violet-600 hover:bg-violet-700"
                  >
                    {running ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    {running ? '正在规划、检索并生成…' : '运行最新一次测试'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-5">
                <Textarea
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="min-h-32 bg-white leading-6"
                  aria-label="复习计划自然语言请求"
                />
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-xs font-semibold text-slate-500">模拟用户基线</div>
                    <div className="mt-2 text-sm font-semibold">
                      {baseline?.user.name || '读取中…'}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {baseline
                        ? `${baseline.counts.attempts} 次作答 · ${baseline.counts.studyMemories} 条记忆 · ${baseline.counts.calendarEvents} 个日历事项`
                        : '正在准备四档只读用户。'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-4">
                    <div className="text-xs font-semibold text-emerald-700">预期读取</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selectedCase.expectedTools.map((toolId) => (
                        <Badge key={toolId} variant="secondary">
                          {TOOL_LABELS[toolId]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl bg-amber-50 p-4">
                    <div className="text-xs font-semibold text-amber-700">禁止或不需要读取</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selectedCase.forbiddenTools.length ? (
                        selectedCase.forbiddenTools.map((toolId) => (
                          <Badge key={toolId} variant="outline">
                            {TOOL_LABELS[toolId]}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-amber-800">无；本条需要完整证据链</span>
                      )}
                    </div>
                  </div>
                </div>
                <p className="text-xs leading-5 text-slate-500">
                  运行时创建一次性用户副本；模型先只看到数据数量和工具说明，决定读取范围后才执行工具。副本结束即销毁，结果按
                  case 覆盖保存。
                </p>
              </CardContent>
            </Card>

            {latestResult ? (
              <>
                <Card className="overflow-hidden rounded-2xl border-violet-200 bg-white shadow-sm">
                  <CardHeader className="border-b border-violet-100 bg-violet-50/70">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <MessageCircle className="size-4 text-violet-600" /> 给用户的最终回复
                      </CardTitle>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">学生可执行版</Badge>
                        <Badge variant="outline">{formatTime(latestResult.updatedAt)}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="py-6">
                    {userMessage ? (
                      <div className="flex items-start gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white">
                          <MessageCircle className="size-4" />
                        </div>
                        <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800">
                          {userMessage}
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                        这条本地结果生成于“用户友好回复”上线之前。重新运行本用例后，这里会显示一条不含内部
                        ID、文件名和工具参数的完整学习建议。
                      </div>
                    )}
                    {userFacingQuestionSessions.length ? (
                      <section
                        aria-label="计划题目快捷入口"
                        className="mt-6 border-t border-violet-100 pt-5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-semibold text-violet-950">
                              计划题目快捷入口
                            </h3>
                            <p className="mt-1 text-xs leading-5 text-slate-500">
                              按复习段分组；点击题目即可进入现有题库作答。
                            </p>
                          </div>
                          <Badge variant="outline">
                            {userFacingQuestionSessions.reduce(
                              (total, { questions }) => total + questions.length,
                              0,
                            )}{' '}
                            道题
                          </Badge>
                        </div>
                        <div className="mt-4 space-y-3">
                          {userFacingQuestionSessions.map(({ session, questions }) => (
                            <div
                              key={session.id}
                              className="rounded-xl border border-violet-100 bg-violet-50/40 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-violet-800">
                                <CalendarDays className="size-3.5" />
                                <span>{studentScheduleLabel(session)}</span>
                                <span className="text-violet-300">·</span>
                                <span>{session.focus}</span>
                              </div>
                              <div className="mt-2 grid gap-2">
                                {questions.map((question) =>
                                  question.href ? (
                                    <Link
                                      key={question.problemId}
                                      href={question.href}
                                      className="group flex items-center justify-between gap-3 rounded-lg border border-sky-200 bg-white px-3 py-2.5 transition hover:border-sky-400 hover:bg-sky-50"
                                    >
                                      <span>
                                        <span className="block text-sm font-semibold leading-5 text-sky-950">
                                          {question.title}
                                        </span>
                                        <span className="mt-1 block text-xs leading-5 text-slate-600">
                                          {question.reason}
                                        </span>
                                      </span>
                                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-sky-700">
                                        做这道题 <ArrowUpRight className="size-3.5" />
                                      </span>
                                    </Link>
                                  ) : (
                                    <div
                                      key={question.problemId}
                                      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
                                    >
                                      {question.title}：旧记录尚未包含作答链接，请重跑本用例。
                                    </div>
                                  ),
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : null}
                  </CardContent>
                </Card>

                <details className="rounded-2xl border border-slate-200 bg-slate-100/70 px-4 py-4 shadow-sm sm:px-5">
                  <summary className="flex cursor-pointer items-center gap-2 font-semibold text-slate-700">
                    <Route className="size-4" /> 查看 QA 技术追踪与结构化执行结果
                  </summary>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    以下内容用于验证工具选择、证据引用和题库来源，不属于给学生的最终回复。
                  </p>
                  <div className="mt-4 space-y-5">
                    <Card className="rounded-2xl border-teal-200 bg-teal-50/40 shadow-sm">
                      <CardHeader>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <Route className="size-4 text-teal-700" /> Agent 读取计划与安全 Trace
                          </CardTitle>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">{latestResult.response.model}</Badge>
                            <Badge variant="outline">{formatTime(latestResult.updatedAt)}</Badge>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="rounded-xl border border-teal-200 bg-white p-4">
                          <div className="text-sm font-semibold">为什么选择这些工具</div>
                          <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-600">
                            {latestResult.response.readPlan.reasoning.map((reason) => (
                              <li key={reason}>• {reason}</li>
                            ))}
                          </ul>
                        </div>
                        <ol className="grid gap-3 xl:grid-cols-2">
                          {latestResult.response.trace.map((traceItem, index) => (
                            <li
                              key={traceItem.toolId}
                              className="rounded-xl border border-teal-200 bg-white p-4"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <span className="flex size-6 items-center justify-center rounded-full bg-teal-700 font-mono text-[11px] text-white">
                                    {index + 1}
                                  </span>
                                  <span className="font-semibold">
                                    {TOOL_LABELS[traceItem.toolId]}
                                  </span>
                                </div>
                                <Badge
                                  variant={
                                    traceItem.status === 'completed' ? 'secondary' : 'destructive'
                                  }
                                >
                                  {traceItem.status === 'completed'
                                    ? `${traceItem.durationMs} ms`
                                    : '失败'}
                                </Badge>
                              </div>
                              <p className="mt-3 text-sm leading-6 text-slate-600">
                                {traceItem.reason}
                              </p>
                              <div className="mt-2 font-mono text-[11px] text-slate-400">
                                query={traceItem.query || 'null'} · limit={traceItem.limit} ·
                                evidence=
                                {traceItem.outputEvidenceIds.length}
                              </div>
                              {traceItem.error ? (
                                <p
                                  className={`mt-2 text-xs ${
                                    traceItem.status === 'failed'
                                      ? 'text-red-700'
                                      : 'text-amber-700'
                                  }`}
                                >
                                  {traceItem.status === 'failed' ? '失败原因' : '降级说明'}：
                                  {traceItem.error}
                                </p>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      </CardContent>
                    </Card>

                    <Card className="rounded-2xl border-slate-200 shadow-sm">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Target className="size-4 text-violet-600" />{' '}
                          {latestResult.response.plan.title}
                        </CardTitle>
                        <p className="text-sm leading-6 text-slate-600">
                          {latestResult.response.plan.summary}
                        </p>
                        <p className="text-sm font-medium text-amber-800">
                          {latestResult.response.plan.deadlineSummary}
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        <div className="grid gap-3 lg:grid-cols-2">
                          {latestResult.response.plan.priorities.map((priority) => (
                            <article key={priority.concept} className="rounded-xl bg-violet-50 p-4">
                              <div className="font-semibold text-violet-950">
                                {priority.concept}
                              </div>
                              <p className="mt-2 text-sm leading-6 text-violet-900">
                                {priority.reason}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {priority.evidenceIds.map((id) => (
                                  <Badge
                                    key={id}
                                    variant="outline"
                                    className="font-mono text-[10px]"
                                  >
                                    {id}
                                  </Badge>
                                ))}
                              </div>
                            </article>
                          ))}
                        </div>

                        <div className="space-y-3">
                          {latestResult.response.plan.sessions.map((session) => {
                            const questions = resolveSessionQuestions(
                              latestResult.response,
                              session,
                            );
                            return (
                              <article
                                key={session.id}
                                className="rounded-2xl border border-slate-200 bg-white p-5"
                              >
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-violet-700">
                                      <CalendarDays className="size-3.5" /> {session.dayLabel} ·{' '}
                                      {session.date} {session.startTime}
                                    </div>
                                    <h3 className="mt-2 text-lg font-semibold">{session.focus}</h3>
                                  </div>
                                  <div className="flex gap-2">
                                    <Badge variant="outline">
                                      <Clock3 className="size-3.5" /> {session.minutes} 分钟
                                    </Badge>
                                    <Badge variant="outline">{session.questionCount} 题</Badge>
                                  </div>
                                </div>
                                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                                  <div className="rounded-xl bg-slate-50 p-4">
                                    <div className="text-xs font-semibold text-slate-500">
                                      怎么复习
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-slate-700">
                                      {session.method}
                                    </p>
                                  </div>
                                  <div className="rounded-xl bg-amber-50 p-4">
                                    <div className="text-xs font-semibold text-amber-700">
                                      为什么这样安排
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-amber-900">
                                      {session.reason}
                                    </p>
                                  </div>
                                </div>
                                <div className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                                  完成信号：{session.completionSignal}
                                </div>
                                {questions.length ? (
                                  <div className="mt-3 grid gap-2">
                                    {questions.map((question) => (
                                      <div key={question.problemId}>
                                        {question.href ? (
                                          <Link
                                            href={question.href}
                                            className="group flex items-start justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 transition hover:border-sky-400 hover:bg-sky-100"
                                          >
                                            <span>
                                              <span className="block text-sm font-semibold leading-5 text-sky-950">
                                                {question.title}
                                              </span>
                                              <span className="mt-1 block font-mono text-[10px] text-sky-700">
                                                {question.problemId}
                                              </span>
                                            </span>
                                            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-sky-700">
                                              做这道题 <ArrowUpRight className="size-3.5" />
                                            </span>
                                          </Link>
                                        ) : (
                                          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                                            <div className="text-sm font-semibold text-amber-950">
                                              {question.title}
                                            </div>
                                            <div className="mt-1 text-xs text-amber-700">
                                              这是旧测试记录，重跑后才会补齐真实作答链接。
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                  {session.evidenceIds.map((id) => (
                                    <Badge
                                      key={id}
                                      variant="outline"
                                      className="font-mono text-[10px]"
                                    >
                                      {id}
                                    </Badge>
                                  ))}
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>

                    <div className="grid gap-5 xl:grid-cols-2">
                      <Card className="rounded-2xl border-slate-200 shadow-sm">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-base">
                            <Database className="size-4 text-sky-600" /> 真实 CSC148 题库候选
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-xs leading-5 text-slate-500">
                            题库共 {latestResult.response.problemBank.totalCount} 题，本轮 RAG 返回{' '}
                            {latestResult.response.problemBank.selected.length} 题。
                          </p>
                          {latestResult.response.problemBank.selected.map((problem) => (
                            <article key={problem.id} className="rounded-xl border p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-mono text-[11px] text-sky-700">
                                    {problem.id}
                                  </div>
                                  {problem.href || latestResult.response.problemBank.courseId ? (
                                    <Link
                                      href={
                                        problem.href ||
                                        courseProblemHref(
                                          latestResult.response.problemBank.courseId as string,
                                          problem.id,
                                        )
                                      }
                                      className="mt-1 inline-flex items-start gap-1 text-sm font-semibold text-slate-950 hover:text-sky-700"
                                    >
                                      {problem.title}{' '}
                                      <ArrowUpRight className="mt-0.5 size-3.5 shrink-0" />
                                    </Link>
                                  ) : (
                                    <div className="mt-1 text-sm font-semibold">
                                      {problem.title}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="mt-2 text-xs text-slate-500">
                                {problem.type} · {problem.difficulty} · RAG{' '}
                                {problem.hybridScore.toFixed(3)}
                              </div>
                            </article>
                          ))}
                        </CardContent>
                      </Card>

                      <Card className="rounded-2xl border-slate-200 shadow-sm">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-base">
                            <CheckCircle2 className="size-4 text-emerald-600" /> 机器验收
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {evaluation?.checks.map((check) => (
                            <div
                              key={check.id}
                              className={`rounded-xl border px-3 py-3 text-sm ${
                                check.passed
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                                  : 'border-red-200 bg-red-50 text-red-900'
                              }`}
                            >
                              <div className="flex items-center gap-2 font-semibold">
                                {check.passed ? (
                                  <CheckCircle2 className="size-4" />
                                ) : (
                                  <XCircle className="size-4" />
                                )}
                                {check.label}
                              </div>
                              <p className="mt-1 text-xs leading-5 opacity-80">{check.detail}</p>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    </div>

                    <details className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                      <summary className="flex cursor-pointer items-center gap-2 font-semibold">
                        <FileSearch className="size-4" /> 查看实际提取的全部证据（
                        {latestResult.response.evidence.length} 条）
                      </summary>
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        {latestResult.response.evidence.map((item) => (
                          <article key={item.id} className="rounded-xl bg-slate-50 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="break-all font-mono text-[10px] text-slate-500">
                                {item.id}
                              </span>
                              <Badge variant="outline">{item.sourceType}</Badge>
                            </div>
                            <div className="mt-2 text-sm font-semibold">{item.title}</div>
                            <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">
                              {item.excerpt}
                            </p>
                          </article>
                        ))}
                      </div>
                    </details>
                  </div>
                </details>
              </>
            ) : loading ? (
              <Card className="rounded-2xl border-slate-200 shadow-sm">
                <CardContent className="flex items-center gap-2 py-8 text-sm text-slate-500">
                  <Loader2 className="size-4 animate-spin" /> 正在恢复四档用户与最新测试结果…
                </CardContent>
              </Card>
            ) : (
              <Card className="rounded-2xl border-slate-200 shadow-sm">
                <CardContent className="flex items-center gap-3 py-8 text-sm text-slate-500">
                  <Search className="size-4" /> 运行后会显示读取计划、工具 trace、真实题库 RAG
                  候选、证据化学习计划和机器验收。
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
