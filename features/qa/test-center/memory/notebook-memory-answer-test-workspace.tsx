'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock3,
  FileWarning,
  Library,
  Loader2,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  CSC148_NOTEBOOK_MEMORY_ANSWER_CASES,
  type NotebookMemoryAnswerCase,
  type NotebookMemoryAnswerResponse,
  type NotebookMemoryCandidate,
} from '@/features/qa/test-center/memory/csc148-notebook-memory-answer-cases';
import { CSC148_SOURCE_UPLOAD_CASES } from '@/features/qa/test-center/memory/csc148-source-upload-cases';
import {
  loadLocalNotebookAnswerLatestResults,
  saveLocalNotebookAnswerLatestResult,
  type LocalNotebookAnswerLatestResult,
} from '@/features/qa/test-center/memory/local-memory-notebook-answer-result-store';
import {
  loadLocalSourceUploadLatestResults,
  type LocalSourceUploadLatestResult,
} from '@/features/qa/test-center/memory/local-memory-source-test-result-store';
import { MEMORY_SYSTEM_TEST_SCENARIOS } from '@/features/qa/test-center/registry';
import { useSettingsStore } from '@/lib/store/settings';
import { backendJson } from '@/lib/utils/backend-api';

const ANSWER_API = '/api/platform-tests/memory-local-notebook-answer';
const MANUAL_CHECKS_KEY = 'syntara-memory-notebook-answer-manual-checks';
const MAX_NOTEBOOK_CHARACTERS = 60_000;
const MAX_TOTAL_CHARACTERS = 180_000;

type LoadedNotebook = NotebookMemoryCandidate & {
  originalCharacters: number;
  truncated: boolean;
};

type UiCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

const SOURCE_CASE_BY_ID = new Map(CSC148_SOURCE_UPLOAD_CASES.map((item) => [item.id, item]));

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp);
}

function notebookResultShape(result: LocalSourceUploadLatestResult) {
  const mutationResult = result.notebookMutation?.result;
  if (!mutationResult || typeof mutationResult !== 'object') return null;
  const notebook = (mutationResult as { notebook?: unknown }).notebook;
  if (!notebook || typeof notebook !== 'object') return null;
  const candidate = notebook as {
    filename?: unknown;
    content?: unknown;
    output?: { title?: unknown };
  };
  if (typeof candidate.content !== 'string' || !candidate.content.trim()) return null;
  return {
    filename:
      typeof candidate.filename === 'string'
        ? candidate.filename
        : `${result.testCaseId}-generated-notebook.md`,
    content: candidate.content.trim(),
    title:
      typeof candidate.output?.title === 'string' && candidate.output.title.trim()
        ? candidate.output.title.trim()
        : SOURCE_CASE_BY_ID.get(result.testCaseId)?.title || result.testCaseId,
  };
}

function buildLoadedNotebooks(results: LocalSourceUploadLatestResult[]): LoadedNotebook[] {
  const resultByCaseId = new Map(results.map((result) => [result.testCaseId, result]));
  let remainingCharacters = MAX_TOTAL_CHARACTERS;
  const notebooks: LoadedNotebook[] = [];

  for (const sourceCase of CSC148_SOURCE_UPLOAD_CASES) {
    const result = resultByCaseId.get(sourceCase.id);
    if (!result || remainingCharacters <= 0) continue;
    const notebook = notebookResultShape(result);
    if (!notebook) continue;
    const allowedCharacters = Math.min(MAX_NOTEBOOK_CHARACTERS, remainingCharacters);
    const content = notebook.content.slice(0, allowedCharacters);
    if (!content.trim()) continue;
    notebooks.push({
      id: `notebook:${sourceCase.id}`,
      sourceCaseId: sourceCase.id,
      title: notebook.title,
      filename: notebook.filename,
      content,
      generatedAt: result.updatedAt,
      originalCharacters: notebook.content.length,
      truncated: content.length < notebook.content.length,
    });
    remainingCharacters -= content.length;
  }

  return notebooks;
}

function sourceFingerprint(notebooks: LoadedNotebook[]) {
  return notebooks
    .map(
      (notebook) => `${notebook.sourceCaseId}:${notebook.generatedAt}:${notebook.content.length}`,
    )
    .join('|');
}

function requiredNotebookTitles(testCase: NotebookMemoryAnswerCase) {
  return testCase.requiredNotebookGroups.map((group) =>
    group.map((caseId) => SOURCE_CASE_BY_ID.get(caseId)?.title || caseId).join(' 或 '),
  );
}

function evaluateResponse(
  testCase: NotebookMemoryAnswerCase,
  response: NotebookMemoryAnswerResponse,
  notebooks: LoadedNotebook[],
) {
  const availableSourceIds = new Set(notebooks.map((notebook) => notebook.sourceCaseId));
  const sourceIdByNotebookId = new Map(
    notebooks.map((notebook) => [notebook.id, notebook.sourceCaseId]),
  );
  const selectedSourceIds = new Set(
    response.retrieval.validSelectedNotebookIds
      .map((notebookId) => sourceIdByNotebookId.get(notebookId))
      .filter((value): value is string => Boolean(value)),
  );
  const missingNotebookGroups = testCase.requiredNotebookGroups.filter(
    (group) => !group.some((sourceId) => availableSourceIds.has(sourceId)),
  );
  const checks: UiCheck[] = response.machineChecks.map((check) => ({ ...check }));

  if (testCase.kind === 'outside_scope') {
    checks.push(
      {
        id: 'expected_scope',
        label: '没有把无关 CSC148 笔记本硬套到问题上',
        passed:
          response.retrieval.memoryScope === 'outside_notebooks' &&
          response.retrieval.validSelectedNotebookIds.length === 0,
        detail: `${response.retrieval.memoryScope} · 选择 ${response.retrieval.validSelectedNotebookIds.length} 份`,
      },
      {
        id: 'honest_boundary',
        label: '回答明确声明了笔记本记忆边界',
        passed:
          response.answer.boundaryStatement.trim().length >= 12 &&
          response.answer.appliedNotebookIds.length === 0,
        detail: response.answer.boundaryStatement,
      },
    );
  } else {
    testCase.requiredNotebookGroups.forEach((group, index) => {
      checks.push({
        id: `required_retrieval_${index}`,
        label: `检索到必需课程记忆：${requiredNotebookTitles(testCase)[index]}`,
        passed: group.some((sourceId) => selectedSourceIds.has(sourceId)),
        detail: group.some((sourceId) => availableSourceIds.has(sourceId))
          ? `实际选择：${Array.from(selectedSourceIds).join('、') || '无'}`
          : '当前浏览器尚未生成这份必需笔记本，不能完成本项验收。',
      });
    });

    const answerText =
      `${response.answer.answerMarkdown}\n${response.answer.courseRulesApplied.join(
        '\n',
      )}`.toLowerCase();
    testCase.answerSignalGroups.forEach((signals, index) => {
      const matched = signals.find((signal) => answerText.includes(signal.toLowerCase()));
      checks.push({
        id: `answer_signal_${index}`,
        label: `回答包含可观察课程信号：${signals.join(' / ')}`,
        passed: Boolean(matched),
        detail: matched ? `命中：${matched}` : '未在实际回答中找到任一信号。',
      });
    });
  }

  return {
    ready: missingNotebookGroups.length === 0,
    missingNotebookGroups,
    checks,
    passed: missingNotebookGroups.length === 0 && checks.every((check) => check.passed),
  };
}

function scopeLabel(scope: NotebookMemoryAnswerResponse['retrieval']['memoryScope']) {
  if (scope === 'supported') return '笔记本可完整支持';
  if (scope === 'partially_supported') return '笔记本仅部分支持';
  return '超出笔记本范围';
}

export function NotebookMemoryAnswerTestWorkspace() {
  const scenario = MEMORY_SYSTEM_TEST_SCENARIOS.find(
    (item) => item.id === 'memory-ai-explanation',
  )!;
  const scenarioIndex = MEMORY_SYSTEM_TEST_SCENARIOS.findIndex((item) => item.id === scenario.id);
  const previousScenario = MEMORY_SYSTEM_TEST_SCENARIOS[scenarioIndex - 1] || null;
  const nextScenario = MEMORY_SYSTEM_TEST_SCENARIOS[scenarioIndex + 1] || null;
  const providerId = useSettingsStore((state) => state.providerId);
  const modelId = useSettingsStore((state) => state.modelId);
  const [selectedCaseId, setSelectedCaseId] = useState(CSC148_NOTEBOOK_MEMORY_ANSWER_CASES[0].id);
  const [notebooks, setNotebooks] = useState<LoadedNotebook[]>([]);
  const [latestResults, setLatestResults] = useState<
    Record<string, LocalNotebookAnswerLatestResult>
  >({});
  const [manualChecks, setManualChecks] = useState<Record<string, boolean>>({});
  const [loadingLocal, setLoadingLocal] = useState(true);
  const [runningCaseId, setRunningCaseId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const selectedCase =
    CSC148_NOTEBOOK_MEMORY_ANSWER_CASES.find((item) => item.id === selectedCaseId) ||
    CSC148_NOTEBOOK_MEMORY_ANSWER_CASES[0];
  const latestResult = latestResults[selectedCase.id] || null;
  const fingerprint = sourceFingerprint(notebooks);
  const staleResult = Boolean(latestResult && latestResult.sourceFingerprint !== fingerprint);
  const evaluation = latestResult
    ? evaluateResponse(selectedCase, latestResult.response, notebooks)
    : null;

  const availableSourceIds = useMemo(
    () => new Set(notebooks.map((notebook) => notebook.sourceCaseId)),
    [notebooks],
  );
  const missingRequiredTitles = requiredNotebookTitles(selectedCase).filter((_, index) =>
    selectedCase.requiredNotebookGroups[index].every(
      (sourceId) => !availableSourceIds.has(sourceId),
    ),
  );

  async function refreshLocalState() {
    setLoadingLocal(true);
    setError('');
    try {
      const [sourceResults, answerResults] = await Promise.all([
        loadLocalSourceUploadLatestResults(),
        loadLocalNotebookAnswerLatestResults(),
      ]);
      setNotebooks(buildLoadedNotebooks(sourceResults));
      setLatestResults(Object.fromEntries(answerResults.map((result) => [result.caseId, result])));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingLocal(false);
    }
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MANUAL_CHECKS_KEY);
      if (saved) setManualChecks(JSON.parse(saved) as Record<string, boolean>);
    } catch {
      // A malformed manual-check snapshot should not block the test page.
    }
    void refreshLocalState();
  }, []);

  async function runSelectedCase() {
    setRunningCaseId(selectedCase.id);
    setError('');
    try {
      const freshSourceResults = await loadLocalSourceUploadLatestResults();
      const freshNotebooks = buildLoadedNotebooks(freshSourceResults);
      setNotebooks(freshNotebooks);
      if (!freshNotebooks.length) {
        throw new Error('当前浏览器还没有第二阶段 02 生成成功的学习笔记本。');
      }
      const response = await backendJson<NotebookMemoryAnswerResponse>(ANSWER_API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-generation-test-no-charge': 'true',
          ...(providerId === 'openai' && modelId ? { 'x-model': `openai:${modelId}` } : {}),
        },
        body: JSON.stringify({
          action: 'answer_from_notebook_memory',
          caseId: selectedCase.id,
          question: selectedCase.question,
          notebooks: freshNotebooks.map(
            ({ originalCharacters: _originalCharacters, truncated: _truncated, ...notebook }) =>
              notebook,
          ),
        }),
      });
      const saved = await saveLocalNotebookAnswerLatestResult({
        caseId: selectedCase.id,
        sourceFingerprint: sourceFingerprint(freshNotebooks),
        response,
      });
      setLatestResults((current) => ({ ...current, [selectedCase.id]: saved }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunningCaseId(null);
    }
  }

  function toggleManualCheck(criterionIndex: number, checked: boolean) {
    const key = `${selectedCase.id}:${criterionIndex}`;
    const next = { ...manualChecks, [key]: checked };
    setManualChecks(next);
    localStorage.setItem(MANUAL_CHECKS_KEY, JSON.stringify(next));
  }

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
                <Badge variant="outline">AI 使用记忆</Badge>
                <Badge variant="outline">浏览器本地 · 不读写数据库</Badge>
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
                  <Badge className="bg-slate-950 hover:bg-slate-950">7 条独立测试</Badge>
                  <span className="text-xs text-slate-400">每条只保留最新结果</span>
                </div>
                <CardTitle className="mt-2 text-lg">选择一个用户问题</CardTitle>
                <p className="text-xs leading-5 text-slate-500">
                  切换问题不会改变笔记本记忆，也不会影响其他测试结果。
                </p>
              </CardHeader>
              <CardContent className="space-y-2 bg-slate-50/70 p-3">
                {CSC148_NOTEBOOK_MEMORY_ANSWER_CASES.map((testCase, index) => {
                  const result = latestResults[testCase.id];
                  const isSelected = testCase.id === selectedCase.id;
                  const caseEvaluation = result
                    ? evaluateResponse(testCase, result.response, notebooks)
                    : null;
                  const isStale = Boolean(
                    result && result.sourceFingerprint !== sourceFingerprint(notebooks),
                  );
                  return (
                    <button
                      type="button"
                      key={testCase.id}
                      onClick={() => {
                        setSelectedCaseId(testCase.id);
                        setError('');
                      }}
                      disabled={runningCaseId !== null}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                        isSelected
                          ? 'border-slate-950 bg-slate-950 text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-900 hover:border-slate-400'
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
                            isSelected ? 'bg-white text-slate-950' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold leading-5">
                            {testCase.title}
                          </span>
                          <span
                            className={`mt-1 block text-xs leading-4 ${
                              isSelected ? 'text-slate-300' : 'text-slate-500'
                            }`}
                          >
                            {testCase.shortTitle}
                          </span>
                          <span className="mt-2 flex items-center gap-1 text-[11px]">
                            {!result ? (
                              <>
                                <CircleDashed className="size-3" /> 未运行
                              </>
                            ) : isStale ? (
                              <>
                                <RefreshCw className="size-3" /> 笔记本已变化
                              </>
                            ) : caseEvaluation?.passed ? (
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
                      </div>
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          </aside>

          <div className="min-w-0 space-y-5">
            <Card className="rounded-2xl border-sky-200 bg-sky-50/50 shadow-sm">
              <CardContent className="p-5 sm:p-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Library className="size-5 text-sky-700" />
                      <h2 className="font-semibold">本次用户实际拥有的笔记本记忆</h2>
                      <Badge variant="secondary">{notebooks.length} 份已生成笔记本</Badge>
                    </div>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                      直接读取“第二阶段 02”在当前浏览器保存的最新 Markdown
                      笔记本。这里只显示生成结果，不展示 queue 原文，也不会写入数据库。
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="shrink-0 rounded-xl bg-white"
                    onClick={() => void refreshLocalState()}
                    disabled={loadingLocal || runningCaseId !== null}
                  >
                    {loadingLocal ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    重新读取本地结果
                  </Button>
                </div>
                {notebooks.length ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {notebooks.map((notebook) => (
                      <article
                        key={notebook.id}
                        className="rounded-xl border border-sky-200 bg-white p-3"
                      >
                        <div className="flex items-start gap-3">
                          <div className="rounded-lg bg-sky-100 p-2 text-sky-700">
                            <BookOpen className="size-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="line-clamp-2 text-sm font-semibold">
                              {notebook.title}
                            </div>
                            <div className="mt-1 truncate font-mono text-[11px] text-slate-400">
                              {notebook.filename}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                              <span>{notebook.originalCharacters.toLocaleString()} 字符</span>
                              <span>生成于 {formatTime(notebook.generatedAt)}</span>
                              {notebook.truncated ? (
                                <span className="text-amber-700">送入模型时已截断</span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : loadingLocal ? (
                  <div className="mt-4 flex items-center gap-2 rounded-xl border border-sky-200 bg-white px-4 py-5 text-sm text-slate-500">
                    <Loader2 className="size-4 animate-spin" /> 正在读取当前浏览器的生成结果…
                  </div>
                ) : (
                  <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                    <span>当前浏览器还没有可用的生成笔记本，请先完成第二阶段 02。</span>
                    <Button asChild variant="outline" className="shrink-0 bg-white">
                      <Link href="/test/memory-source-upload-writeback">前往生成笔记本</Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
                {error}
              </div>
            ) : null}

            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="max-w-4xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-slate-950 hover:bg-slate-950">
                        测试 {CSC148_NOTEBOOK_MEMORY_ANSWER_CASES.indexOf(selectedCase) + 1}
                      </Badge>
                      <Badge variant="outline">{selectedCase.kind}</Badge>
                    </div>
                    <CardTitle className="mt-3 text-xl">{selectedCase.title}</CardTitle>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{selectedCase.purpose}</p>
                  </div>
                  <Button
                    className="shrink-0 rounded-xl bg-violet-600 hover:bg-violet-700"
                    onClick={() => void runSelectedCase()}
                    disabled={runningCaseId !== null || loadingLocal || notebooks.length === 0}
                  >
                    {runningCaseId === selectedCase.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    {latestResult ? '重新运行并替换最新结果' : '运行本条测试'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-5 sm:p-6">
                <div className="rounded-2xl bg-slate-950 p-5 text-white">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    模拟用户实际提问
                  </div>
                  <MessageResponse className="text-sm leading-7 text-slate-100">
                    {selectedCase.question}
                  </MessageResponse>
                </div>
                {missingRequiredTitles.length ? (
                  <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                    <FileWarning className="mt-1 size-4 shrink-0" />
                    <div>
                      <div className="font-semibold">当前缺少完成本条测试所需的笔记本</div>
                      <div className="mt-1">{missingRequiredTitles.join('；')}</div>
                      <div className="mt-1 text-xs text-amber-700">
                        仍可观察 AI 的缺口处理，但不会把缺失内容硬编码进上下文，也不会判为通过。
                      </div>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {latestResult ? (
              <>
                {staleResult ? (
                  <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
                    <RefreshCw className="size-4" />
                    这条结果使用的是上一版笔记本记忆；重新运行后会替换为当前最新版。
                  </div>
                ) : null}

                <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
                  <Card className="rounded-2xl border-blue-200 bg-blue-50/40 shadow-sm">
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <SearchCheck className="size-4 text-blue-700" /> 第一步：实际记忆检索
                        </CardTitle>
                        <Badge
                          variant={
                            latestResult.response.retrieval.memoryScope === 'outside_notebooks'
                              ? 'outline'
                              : 'secondary'
                          }
                        >
                          {scopeLabel(latestResult.response.retrieval.memoryScope)}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm leading-6 text-slate-700">
                        {latestResult.response.retrieval.selectionReason}
                      </p>
                      {latestResult.response.retrieval.matches.length ? (
                        <div className="space-y-3">
                          {latestResult.response.retrieval.matches.map((match) => {
                            const notebook = notebooks.find((item) => item.id === match.notebookId);
                            return (
                              <article
                                key={`${match.notebookId}-${match.reason}`}
                                className="rounded-xl border border-blue-200 bg-white p-4"
                              >
                                <div className="break-words font-mono text-[11px] text-blue-700">
                                  {match.notebookId}
                                </div>
                                <div className="mt-1 text-sm font-semibold">
                                  {notebook?.title || match.notebookId}
                                </div>
                                <p className="mt-2 text-xs leading-5 text-slate-600">
                                  {match.reason}
                                </p>
                                {match.rememberedRules.length ? (
                                  <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
                                    {match.rememberedRules.map((rule) => (
                                      <li key={rule}>· {rule}</li>
                                    ))}
                                  </ul>
                                ) : null}
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-blue-200 bg-white p-4 text-sm text-slate-500">
                          检索器没有选择任何课程笔记本。
                        </div>
                      )}
                      {latestResult.response.retrieval.missingKnowledge.length ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                          <div className="font-semibold">检索识别出的知识缺口</div>
                          {latestResult.response.retrieval.missingKnowledge.map((item) => (
                            <div key={item} className="mt-1">
                              · {item}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>

                  <Card className="rounded-2xl border-violet-200 shadow-sm">
                    <CardHeader className="border-b border-violet-100 bg-violet-50/50">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <BrainCircuit className="size-4 text-violet-700" />
                          第二步：只基于已检索记忆回答
                        </CardTitle>
                        <Badge variant="outline">{latestResult.response.model}</Badge>
                      </div>
                      <p className="text-xs leading-5 text-slate-500">
                        {latestResult.response.answer.boundaryStatement}
                      </p>
                    </CardHeader>
                    <CardContent className="p-5 sm:p-6">
                      <MessageResponse className="text-sm leading-7 text-slate-700">
                        {latestResult.response.answer.answerMarkdown}
                      </MessageResponse>
                      {latestResult.response.answer.courseRulesApplied.length ? (
                        <details className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                            查看模型声明的课程规则与自检
                          </summary>
                          <div className="mt-3 space-y-3 text-xs leading-5 text-slate-600">
                            <div>
                              {latestResult.response.answer.courseRulesApplied.map((item) => (
                                <div key={item}>· {item}</div>
                              ))}
                            </div>
                            <div>
                              {latestResult.response.answer.selfChecks.map((item) => (
                                <div key={item}>✓ {item}</div>
                              ))}
                            </div>
                          </div>
                        </details>
                      ) : null}
                    </CardContent>
                  </Card>
                </div>

                <Card className="rounded-2xl border-slate-200 shadow-sm">
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ShieldCheck className="size-4 text-emerald-700" /> 验收结果
                      </CardTitle>
                      <Badge
                        variant={evaluation?.passed ? 'secondary' : 'destructive'}
                        className={evaluation?.passed ? 'bg-emerald-100 text-emerald-800' : ''}
                      >
                        {evaluation?.passed ? '结构化检查通过' : '存在未通过项'}
                      </Badge>
                    </div>
                    <p className="text-xs leading-5 text-slate-500">
                      机器只检查检索
                      ID、范围一致性和可观察格式信号；语义质量保留给下面的人工验收，不用预设答案冒充判断。
                    </p>
                  </CardHeader>
                  <CardContent className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                    <div className="space-y-2">
                      {evaluation?.checks.map((check) => (
                        <div
                          key={check.id}
                          className={`rounded-xl border p-3 ${
                            check.passed
                              ? 'border-emerald-200 bg-emerald-50'
                              : 'border-red-200 bg-red-50'
                          }`}
                        >
                          <div className="flex items-start gap-2 text-sm font-medium">
                            {check.passed ? (
                              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" />
                            ) : (
                              <XCircle className="mt-0.5 size-4 shrink-0 text-red-700" />
                            )}
                            <span>{check.label}</span>
                          </div>
                          <div className="mt-1 pl-6 text-xs leading-5 text-slate-600">
                            {check.detail}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-2 font-semibold">
                        <Clock3 className="size-4 text-slate-600" /> 人工语义验收
                      </div>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        请直接阅读上方实际回答后勾选；这里不会 hardcode 语义结论。
                      </p>
                      <div className="mt-4 space-y-4">
                        {selectedCase.manualCriteria.map((criterion, index) => {
                          const key = `${selectedCase.id}:${index}`;
                          return (
                            <label
                              key={criterion}
                              className="flex cursor-pointer items-start gap-3"
                            >
                              <Checkbox
                                className="mt-0.5"
                                checked={Boolean(manualChecks[key])}
                                onCheckedChange={(checked) =>
                                  toggleManualCheck(index, checked === true)
                                }
                              />
                              <span className="text-sm leading-6 text-slate-700">{criterion}</span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-400">
                        最新运行：{formatTime(latestResult.updatedAt)} · 本地仅保留本条最新结果
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card className="rounded-2xl border-dashed border-slate-300 bg-white shadow-none">
                <CardContent className="flex min-h-52 flex-col items-center justify-center p-8 text-center">
                  <BrainCircuit className="size-8 text-slate-300" />
                  <div className="mt-4 font-semibold">尚未运行这条问题测试</div>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                    运行后先显示 AI 从哪些已生成笔记本提取了什么，再显示只使用这些记忆生成的回答。
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
