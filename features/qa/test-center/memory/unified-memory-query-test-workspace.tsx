'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Database,
  Loader2,
  MessageSquareText,
  Route,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';

import { MessageResponse } from '@/components/ai-elements/message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  CSC148_UNIFIED_MEMORY_QUERY_CASES,
  type Csc148UnifiedMemoryQueryCase,
} from '@/features/qa/test-center/memory/csc148-unified-memory-query-cases';
import { CSC148_SOURCE_UPLOAD_CASES } from '@/features/qa/test-center/memory/csc148-source-upload-cases';
import {
  disposeLocalMemoryTestScenarioRun,
  ensureLocalMemoryTestUserCohort,
  prepareLocalMemoryTestScenarioRun,
  runLocalMemoryTestAction,
  type LocalMemoryTestSnapshot,
} from '@/features/qa/test-center/memory/local-memory-test-store';
import {
  loadLocalSourceUploadLatestResults,
  type LocalSourceUploadLatestResult,
} from '@/features/qa/test-center/memory/local-memory-source-test-result-store';
import {
  loadLocalMemoryUnifiedQueryLatestResults,
  saveLocalMemoryUnifiedQueryLatestResult,
  type LocalMemoryUnifiedQueryLatestResult,
} from '@/features/qa/test-center/memory/local-memory-unified-query-result-store';
import { loadPhaseTwoRunsFromLocalFiles } from '@/features/qa/test-center/memory/local-memory-run-file-sync';
import type {
  UnifiedMemoryQueryEvidence,
  UnifiedMemoryQueryRequest,
  UnifiedMemoryQueryResponse,
  UnifiedMemoryQueryToolId,
} from '@/features/qa/test-center/memory/unified-memory-query-types';
import { MEMORY_SYSTEM_TEST_SCENARIOS } from '@/features/qa/test-center/registry';
import { useSettingsStore } from '@/lib/store/settings';
import { backendJson } from '@/lib/utils/backend-api';

const SCENARIO_ID = 'memory-layered-query';
const QUERY_API = '/api/platform-tests/memory-local-unified-query';
const MANUAL_CHECKS_KEY = 'syntara-memory-unified-query-manual-checks';
const MAX_NOTEBOOK_CHARACTERS = 60_000;
const MAX_TOTAL_NOTEBOOK_CHARACTERS = 180_000;

const TOOL_LABELS: Record<UnifiedMemoryQueryToolId, string> = {
  read_user_profile: '稳定个人资料与偏好',
  read_calendar: '精确日程',
  search_working_memory: '当前工作记忆',
  search_learning_memory: '长期学习记忆',
  search_problem_attempts: '近期做题记录',
  search_notebooks: '已生成课程笔记本',
  search_problem_bank: '真实 CSC148 题目',
};

type LoadedNotebook = UnifiedMemoryQueryRequest['sources']['notebooks'][number] & {
  sourceCaseId: string;
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

function notebookResultShape(result: LocalSourceUploadLatestResult) {
  const mutationResult = result.notebookMutation?.result;
  if (!mutationResult || typeof mutationResult !== 'object') return null;
  const notebook = (mutationResult as { notebook?: unknown }).notebook;
  if (!notebook || typeof notebook !== 'object') return null;
  const candidate = notebook as {
    content?: unknown;
    output?: { title?: unknown };
  };
  if (typeof candidate.content !== 'string' || !candidate.content.trim()) return null;
  return {
    content: candidate.content.trim(),
    title:
      typeof candidate.output?.title === 'string' && candidate.output.title.trim()
        ? candidate.output.title.trim()
        : SOURCE_CASE_BY_ID.get(result.testCaseId)?.title || result.testCaseId,
  };
}

function buildLoadedNotebooks(results: LocalSourceUploadLatestResult[]): LoadedNotebook[] {
  const resultByCaseId = new Map(results.map((result) => [result.testCaseId, result]));
  let remainingCharacters = MAX_TOTAL_NOTEBOOK_CHARACTERS;
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
      id: `generated:${sourceCase.id}`,
      sourceCaseId: sourceCase.id,
      title: notebook.title,
      content,
      updatedAt: result.updatedAt,
      originalCharacters: notebook.content.length,
      truncated: content.length < notebook.content.length,
    });
    remainingCharacters -= content.length;
  }
  return notebooks;
}

function requestSourceCounts(request: UnifiedMemoryQueryRequest) {
  const privateLearningMemoryCount = request.sources.memories.filter(
    (memory) => memory.scope === 'private',
  ).length;
  return [
    {
      id: 'profile',
      label: '稳定个人资料',
      count: request.sources.profile.facts.length,
      note: '只能用于背景、偏好和学习习惯，不能证明掌握或薄弱点。',
    },
    {
      id: 'calendar',
      label: '日历事项',
      count: request.sources.calendar.length,
      note: '只支持日程判断。',
    },
    {
      id: 'working-memory',
      label: '当前工作记忆',
      count: request.sources.workingMemory ? 1 : 0,
      note: '当前卡点、掌握信号和下一教学动作。',
    },
    {
      id: 'learning-memory',
      label: '长期学习记忆',
      count: request.sources.memories.length,
      note: `其中 ${privateLearningMemoryCount} 条是个人私有学习记忆；公开课程约束不能证明个人状态。`,
    },
    {
      id: 'attempts',
      label: '近期做题记录',
      count: request.sources.attempts.length,
      note: '可判分的真实作答、得分和反馈。',
    },
    {
      id: 'notebooks',
      label: '生成课程笔记本',
      count: request.sources.notebooks.length,
      note: '课程知识与课程约束，不等于个人学习状态。',
    },
    {
      id: 'problem-bank',
      label: '真实 CSC148 题库',
      count: 298,
      note: '课程题目池，不等于用户做过或暴露过的题目。',
    },
  ];
}

function learningEvidenceCount(request: UnifiedMemoryQueryRequest) {
  return (
    (request.sources.workingMemory ? 1 : 0) +
    request.sources.memories.filter((memory) => memory.scope === 'private').length +
    request.sources.attempts.length
  );
}

function EffectiveInputAudit({
  request,
  testCase,
  exact,
  legacyResult,
}: {
  request: UnifiedMemoryQueryRequest;
  testCase: Csc148UnifiedMemoryQueryCase;
  exact: boolean;
  legacyResult: boolean;
}) {
  const sourceCounts = requestSourceCounts(request);
  const directLearningEvidence = learningEvidenceCount(request);
  const profileFacts = request.sources.profile.facts.map((fact) => ({
    namespace: fact.namespace,
    key: fact.key,
    value: fact.valueJson,
  }));

  return (
    <Card className="rounded-2xl border-sky-200 bg-sky-50/60 shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-sky-700 hover:bg-sky-700">本轮有效输入</Badge>
          <Badge variant="outline">{exact ? '已保存的运行快照' : '运行前预览'}</Badge>
        </div>
        <CardTitle className="mt-2 flex items-center gap-2 text-lg">
          <Database className="size-5 text-sky-700" /> Agent 到底拿到了什么
        </CardTitle>
        <p className="text-sm leading-6 text-slate-600">
          这里展示的是本轮实际可用上下文，不是左侧人物基线总库存。请用它判断回复中的每个具体结论有没有证据。
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {legacyResult ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            当前回复来自旧版结果，旧版没有保存当次完整请求。下面是按当前人物基线重建的预览；请重新运行一次，页面才会显示与回复一一对应的真实输入快照。
          </div>
        ) : null}
        <div
          className={`rounded-xl border px-4 py-3 text-sm leading-6 ${
            directLearningEvidence === 0
              ? 'border-rose-200 bg-rose-50 text-rose-900'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          <div className="font-semibold">
            可用于判断个人掌握或薄弱点的直接学习证据：{directLearningEvidence} 条
          </div>
          <p className="mt-1">
            {directLearningEvidence === 0
              ? '因此，回复如果点名某个知识点最薄弱、比较不同知识点的掌握程度，或声称用户做过某类题，都应判为无证据推断。'
              : '具体学习结论仍需能回到下面的工作记忆、长期学习记忆或真实作答。'}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {sourceCounts.map((source) => (
            <div key={source.id} className="rounded-xl border border-sky-100 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-800">{source.label}</span>
                <Badge variant={source.count ? 'default' : 'outline'}>{source.count}</Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">{source.note}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-sky-100 bg-white p-4">
            <div className="text-sm font-semibold text-slate-900">实际提供的稳定个人资料</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              这些资料可以影响语言、时长和表达方式，但不能被包装成近期学习诊断。
            </p>
            {profileFacts.length ? (
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                {JSON.stringify(profileFacts, null, 2)}
              </pre>
            ) : (
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
                本轮没有提供个人资料。
              </div>
            )}
          </div>

          <div className="rounded-xl border border-sky-100 bg-white p-4">
            <div className="text-sm font-semibold text-slate-900">本条测试的判定合同</div>
            <div className="mt-3 space-y-3 text-sm leading-6">
              <div>
                <span className="font-medium text-slate-700">期望证据状态：</span>
                <span className="text-slate-600">{testCase.expectedEvidenceState || '未限定'}</span>
              </div>
              <div>
                <div className="font-medium text-slate-700">必须读取</div>
                <p className="text-slate-600">
                  {testCase.requiredTools.length
                    ? testCase.requiredTools.map((toolId) => TOOL_LABELS[toolId]).join('、')
                    : '无'}
                </p>
              </div>
              <div>
                <div className="font-medium text-slate-700">禁止读取</div>
                <p className="text-slate-600">
                  {testCase.forbiddenTools.length
                    ? testCase.forbiddenTools.map((toolId) => TOOL_LABELS[toolId]).join('、')
                    : '无'}
                </p>
              </div>
              {testCase.requiredCitedEvidenceSources?.length ? (
                <div>
                  <div className="font-medium text-slate-700">回答必须实际引用</div>
                  <p className="text-slate-600">
                    {testCase.requiredCitedEvidenceSources.join('、')}
                  </p>
                </div>
              ) : null}
              {testCase.requiresRawAttemptDiscovery ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <div className="font-medium text-emerald-900">独立发现约束</div>
                  <p className="text-emerald-800">
                    本轮工作记忆与长期诊断必须为 0；作答只保留原始答案、状态和分数，不提供诊断反馈。
                  </p>
                </div>
              ) : null}
              {testCase.expectedProblemIds?.length ? (
                <div>
                  <div className="font-medium text-slate-700">必须命中的精确题目</div>
                  <p className="font-mono text-xs text-slate-600">
                    {testCase.expectedProblemIds.join('、')}
                  </p>
                </div>
              ) : null}
              {typeof testCase.maxCitedEvidence === 'number' ? (
                <div>
                  <span className="font-medium text-slate-700">最多引用：</span>
                  <span className="text-slate-600">{testCase.maxCitedEvidence} 条证据</span>
                </div>
              ) : null}
              <div>
                <div className="font-medium text-slate-700">人工判断重点</div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-600">
                  {testCase.manualCriteria.map((criterion) => (
                    <li key={criterion}>{criterion}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        <details className="rounded-xl border border-sky-100 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">
            查看本轮完整请求 JSON
          </summary>
          <div className="border-t border-sky-100 p-4">
            <pre className="max-h-[640px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">
              {JSON.stringify(request, null, 2)}
            </pre>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function LearningAnswerEvidenceAudit({
  request,
  response,
}: {
  request: UnifiedMemoryQueryRequest;
  response: UnifiedMemoryQueryResponse;
}) {
  const citedEvidenceIds = new Set(response.answer.citedEvidenceIds);
  const citedEvidence = response.evidence.filter((item) => citedEvidenceIds.has(item.id));
  const directEvidenceCount = learningEvidenceCount(request);

  const evidenceCard = (item: UnifiedMemoryQueryEvidence) => (
    <article key={item.id} className="rounded-lg border border-emerald-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{item.sourceType}</Badge>
        <span className="text-sm font-semibold text-slate-900">{item.title}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{item.excerpt}</p>
    </article>
  );

  return (
    <Card className="rounded-2xl border-emerald-200 bg-emerald-50/50 shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-emerald-700 hover:bg-emerald-700">人工准确性核对</Badge>
          <Badge variant="outline">输入 {directEvidenceCount} 条</Badge>
          <Badge variant="outline">实际引用 {citedEvidence.length} 条</Badge>
        </div>
        <CardTitle className="mt-2 flex items-center gap-2 text-lg">
          <BookOpen className="size-5 text-emerald-700" /> 这段回复到底依据了什么
        </CardTitle>
        <p className="text-sm leading-6 text-slate-600">
          左边是本轮真正交给 agent
          的个人学习证据；右边是回答实际声明使用的证据。请直接把回复中的掌握、薄弱和原因逐条与原文对照。
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-emerald-100 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">本轮全部直接学习输入</div>
          <div className="mt-3 max-h-[620px] space-y-3 overflow-auto pr-1">
            {request.sources.workingMemory ? (
              <article className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">working_memory</Badge>
                  <span className="text-sm font-semibold">当前工作记忆</span>
                </div>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                  {JSON.stringify(request.sources.workingMemory, null, 2)}
                </pre>
              </article>
            ) : null}

            {request.sources.memories.map((memory) => (
              <article key={memory.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">learning_memory</Badge>
                  <span className="text-sm font-semibold">{memory.title}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">
                  {memory.text}
                </p>
                <p className="mt-2 text-[11px] text-slate-400">
                  {memory.kind} · 更新于 {formatTime(memory.updatedAt)}
                </p>
              </article>
            ))}

            {request.sources.attempts.map((attempt) => (
              <article key={attempt.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">attempt</Badge>
                  <span className="text-sm font-semibold">{attempt.problemTitle}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-600">
                  概念：{attempt.concept}；得分：{attempt.score}
                  {attempt.maxScore === null ? '' : ` / ${attempt.maxScore}`}；状态：
                  {attempt.status}
                </p>
                <p className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-xs leading-5 text-slate-700">
                  原始作答：{attempt.answerPreview || '未保存'}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">
                  反馈：{attempt.feedback || '无反馈'}
                </p>
                <p className="mt-2 text-[11px] text-slate-400">
                  作答于 {formatTime(attempt.createdAt)}
                </p>
              </article>
            ))}

            {directEvidenceCount === 0 ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-900">
                本轮没有任何可用于判断个人掌握或薄弱点的直接学习证据。
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-emerald-100 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">回复实际引用的证据</div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            这里只展示 citedEvidenceIds 对应的真实返回项；没有出现在这里的材料，不应被当作回复依据。
          </p>
          <div className="mt-3 max-h-[620px] space-y-3 overflow-auto pr-1">
            {citedEvidence.length ? (
              citedEvidence.map(evidenceCard)
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
                这段回复没有声明任何实际引用证据。若回复仍给出具体学习诊断，应直接判为不可核验。
              </div>
            )}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

function calendarSource(snapshot: LocalMemoryTestSnapshot) {
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
      const endsAt =
        typeof value.endsAt === 'string'
          ? value.endsAt
          : typeof value.endAt === 'string'
            ? value.endAt
            : durationMinutes
              ? new Date(Date.parse(startsAt) + durationMinutes * 60_000).toISOString()
              : null;
      return {
        id: String(value.id || fact.key.replace(/^event:/, '')),
        title: String(value.title || fact.key),
        startsAt,
        endsAt,
        durationMinutes,
        timezone: String(
          value.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        ),
        status: String(value.status || 'planned'),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function calendarSetupSource(testCase: Csc148UnifiedMemoryQueryCase) {
  return testCase.calendarSetup.map((event) => {
    const startsAt = new Date();
    startsAt.setDate(startsAt.getDate() + event.daysFromNow);
    startsAt.setHours(event.hour, event.minute, 0, 0);
    return {
      id: event.id,
      title: event.title,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + event.durationMinutes * 60_000).toISOString(),
      durationMinutes: event.durationMinutes,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      status: 'planned',
    };
  });
}

function requestFromSnapshot(args: {
  snapshot: LocalMemoryTestSnapshot;
  testCase: Csc148UnifiedMemoryQueryCase;
  query: string;
  notebooks: LoadedNotebook[];
}): UnifiedMemoryQueryRequest {
  const conceptByProblemId = new Map(
    args.snapshot.sources.problems.map((problem) => [problem.id, problem.concept] as const),
  );
  const profileFacts = args.snapshot.facts
    .filter(
      (fact) =>
        (fact.namespace === 'profile' && fact.key === 'student_context') ||
        (fact.namespace === 'preference' && fact.key === 'explanation_style') ||
        (fact.namespace === 'habit' && fact.key === 'study_session'),
    )
    .map((fact) => ({
      id: fact.id,
      namespace: fact.namespace,
      key: fact.key,
      valueJson: fact.valueJson,
      updatedAt: fact.updatedAt,
    }));

  const allCalendar = calendarSource(args.snapshot);
  const setupEventIds = new Set(args.testCase.calendarSetup.map((item) => item.id));
  const calendar = args.testCase.calendarSetup.length
    ? allCalendar.filter((item) => setupEventIds.has(item.id))
    : args.testCase.historyMode === 'none'
      ? []
      : allCalendar;
  const durableMemories = args.snapshot.studyMemories
    .filter((memory) => memory.kind !== 'working_state' && memory.scope === 'private')
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const memories = args.testCase.requiresRawAttemptDiscovery
    ? []
    : args.testCase.historyMode === 'none'
      ? []
      : args.testCase.historyMode === 'sparse'
        ? durableMemories.slice(0, 2)
        : durableMemories;
  const attemptsByRecency = [...args.snapshot.sources.attempts].sort(
    (left, right) => right.createdAt - left.createdAt,
  );
  const attempts = args.testCase.requiresRawAttemptDiscovery
    ? attemptsByRecency.filter((attempt) => attempt.answerPreview).slice(0, 2)
    : args.testCase.historyMode === 'none'
      ? []
      : args.testCase.historyMode === 'sparse'
        ? attemptsByRecency.slice(0, 3)
        : args.snapshot.sources.attempts;
  const selectedNotebooks = args.testCase.requiresGeneratedNotebooks ? args.notebooks : [];

  return {
    action: 'run_unified_memory_query',
    caseId: args.testCase.id,
    query: args.query.trim(),
    today: toDayKey(new Date()),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    user: {
      id: args.snapshot.user.id,
      name: args.snapshot.user.name,
      courseCode: 'CSC148',
    },
    sources: {
      profile: { facts: profileFacts },
      calendar,
      workingMemory:
        args.testCase.historyMode === 'none' || args.testCase.requiresRawAttemptDiscovery
          ? null
          : args.snapshot.workingMemory || null,
      memories: memories.map((memory) => ({
        id: memory.id,
        title: memory.title,
        text: memory.text,
        kind: memory.kind,
        scope: memory.scope,
        status: memory.status,
        updatedAt: memory.updatedAt,
      })),
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        problemId: attempt.problemId,
        problemTitle: attempt.problemTitle,
        concept: conceptByProblemId.get(attempt.problemId) || '未标注知识点',
        status: attempt.status,
        score: attempt.score,
        maxScore: attempt.maxScore,
        answerPreview: attempt.answerPreview,
        feedback: args.testCase.requiresRawAttemptDiscovery ? '' : attempt.feedback,
        createdAt: attempt.createdAt,
      })),
      notebooks: selectedNotebooks.map((notebook) => ({
        id: notebook.id,
        title: notebook.title,
        content: notebook.content,
        updatedAt: notebook.updatedAt,
      })),
    },
  };
}

function evaluateResult(
  testCase: Csc148UnifiedMemoryQueryCase,
  result: LocalMemoryUnifiedQueryLatestResult,
  notebooks: LoadedNotebook[],
) {
  const response = result.response;
  const calledTools = new Set(response.agent.calls.map((call) => call.toolId));
  const evidenceById = new Map(response.evidence.map((item) => [item.id, item] as const));
  const citedEvidence = response.answer.citedEvidenceIds.flatMap((id) => {
    const evidence = evidenceById.get(id);
    return evidence ? [evidence] : [];
  });
  const citedSourceTypes = new Set(citedEvidence.map((item) => item.sourceType));
  const checks: UiCheck[] = [
    ...response.machineChecks,
    {
      id: 'expected-intent',
      label: '自然语言意图判断正确',
      passed: testCase.expectedIntents.includes(response.agent.intent),
      detail: `实际：${response.agent.intent}；期望：${testCase.expectedIntents.join(' / ')}`,
    },
    {
      id: 'required-tools',
      label: '调用了当前小测试所需的读取能力',
      passed: testCase.requiredTools.every((toolId) => calledTools.has(toolId)),
      detail: testCase.requiredTools.map((toolId) => TOOL_LABELS[toolId]).join('、'),
    },
    {
      id: 'forbidden-tools',
      label: '没有读取与当前请求无关或明确禁止的来源',
      passed: testCase.forbiddenTools.every((toolId) => !calledTools.has(toolId)),
      detail: testCase.forbiddenTools.length
        ? testCase.forbiddenTools.map((toolId) => TOOL_LABELS[toolId]).join('、')
        : '本条没有禁止来源',
    },
    {
      id: 'notebook-prerequisite',
      label: '需要课程知识时复用了第二阶段 02 的生成笔记本',
      passed: !testCase.requiresGeneratedNotebooks || notebooks.length > 0,
      detail: testCase.requiresGeneratedNotebooks
        ? `已加载 ${notebooks.length} 份生成笔记本`
        : '本条不需要课程笔记本',
    },
    {
      id: 'calendar-result',
      label: '日历写入状态符合测试预期',
      passed:
        !testCase.expectedCalendarAction ||
        (response.answer.calendarAction.status === testCase.expectedCalendarAction &&
          (testCase.expectedCalendarAction !== 'ready' || Boolean(result.calendarMutation))),
      detail: `${response.answer.calendarAction.status} · ${result.calendarMutation ? '已写入一次性副本' : '无写入'}`,
    },
    {
      id: 'calendar-no-unexpected-mutation',
      label: '未要求执行时没有产生日历写入',
      passed: testCase.expectedCalendarAction === 'ready' || result.calendarMutation === null,
      detail:
        testCase.expectedCalendarAction === 'ready'
          ? '本条期望执行唯一日历修改'
          : result.calendarMutation
            ? '检测到不应发生的日历写入'
            : '没有日历写入',
    },
  ];
  if (testCase.requiredCitedEvidenceSources?.length) {
    const missingSourceTypes = testCase.requiredCitedEvidenceSources.filter(
      (sourceType) => !citedSourceTypes.has(sourceType),
    );
    checks.push({
      id: 'required-cited-evidence-sources',
      label: '关键结论实际引用了所需证据类型',
      passed: missingSourceTypes.length === 0,
      detail: missingSourceTypes.length
        ? `缺少：${missingSourceTypes.join('、')}`
        : `已引用：${testCase.requiredCitedEvidenceSources.join('、')}`,
    });
  }
  if (testCase.requiresRawAttemptDiscovery) {
    const rawRequest = result.request;
    const rawAttempts = rawRequest?.sources.attempts || [];
    checks.push(
      {
        id: 'raw-attempt-input-only',
        label: '输入没有预写学习诊断，只包含原始作答',
        passed: Boolean(
          rawRequest &&
          !rawRequest.sources.workingMemory &&
          rawRequest.sources.memories.length === 0 &&
          rawAttempts.length >= 2 &&
          rawAttempts.every((attempt) => attempt.answerPreview && !attempt.feedback),
        ),
        detail: rawRequest
          ? `工作记忆 ${rawRequest.sources.workingMemory ? 1 : 0} 条；长期诊断 ${rawRequest.sources.memories.length} 条；带原始答案的作答 ${rawAttempts.filter((attempt) => attempt.answerPreview).length} 条`
          : '旧结果没有保存完整请求，请重新运行',
      },
      {
        id: 'raw-attempt-derived-diagnosis',
        label: 'Agent 从代码行为中发现了递归参数没有缩小',
        passed:
          /base case/i.test(response.answer.message) &&
          /(原树|同一棵树|没有缩小|未缩小|子树|问题规模)/u.test(response.answer.message),
        detail: '回答需同时识别已有 base case，以及递归调用参数仍未缩小这一行为。',
      },
    );
  }
  if (testCase.expectedProblemIds?.length) {
    const selectedProblemIds = new Set(response.problemBank.selectedProblemIds);
    const missingProblemIds = testCase.expectedProblemIds.filter(
      (problemId) => !selectedProblemIds.has(problemId),
    );
    checks.push({
      id: 'expected-problem-ids',
      label: '命中了题面对应的精确题库记录',
      passed: missingProblemIds.length === 0,
      detail: missingProblemIds.length
        ? `未命中：${missingProblemIds.join('、')}`
        : `已命中：${testCase.expectedProblemIds.join('、')}`,
    });
  }
  if (typeof testCase.maxCitedEvidence === 'number') {
    checks.push({
      id: 'cited-evidence-budget',
      label: '引用证据数量没有演变成全量堆砌',
      passed: response.answer.citedEvidenceIds.length <= testCase.maxCitedEvidence,
      detail: `实际 ${response.answer.citedEvidenceIds.length} 条；上限 ${testCase.maxCitedEvidence} 条`,
    });
  }
  if (testCase.expectedEvidenceState) {
    checks.push({
      id: 'evidence-state',
      label: '证据不足时没有过度推断',
      passed: response.answer.evidenceState === testCase.expectedEvidenceState,
      detail: `实际：${response.answer.evidenceState}；期望：${testCase.expectedEvidenceState}`,
    });
  }
  return { checks, passed: checks.every((check) => check.passed) };
}

function ResultIcon({ passed }: { passed: boolean }) {
  return passed ? (
    <CheckCircle2 className="size-4 text-emerald-600" />
  ) : (
    <XCircle className="size-4 text-rose-600" />
  );
}

export function UnifiedMemoryQueryTestWorkspace() {
  const scenario = MEMORY_SYSTEM_TEST_SCENARIOS.find((item) => item.id === SCENARIO_ID)!;
  const scenarioIndex = MEMORY_SYSTEM_TEST_SCENARIOS.findIndex((item) => item.id === scenario.id);
  const previousScenario = MEMORY_SYSTEM_TEST_SCENARIOS[scenarioIndex - 1] || null;
  const nextScenario = MEMORY_SYSTEM_TEST_SCENARIOS[scenarioIndex + 1] || null;
  const providerId = useSettingsStore((state) => state.providerId);
  const modelId = useSettingsStore((state) => state.modelId);
  const [selectedCaseId, setSelectedCaseId] = useState(CSC148_UNIFIED_MEMORY_QUERY_CASES[0].id);
  const [query, setQuery] = useState(CSC148_UNIFIED_MEMORY_QUERY_CASES[0].query);
  const [cohort, setCohort] = useState<LocalMemoryTestSnapshot[]>([]);
  const [notebooks, setNotebooks] = useState<LoadedNotebook[]>([]);
  const [latestResults, setLatestResults] = useState<
    Record<string, LocalMemoryUnifiedQueryLatestResult>
  >({});
  const [manualChecks, setManualChecks] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const selectedCase =
    CSC148_UNIFIED_MEMORY_QUERY_CASES.find((item) => item.id === selectedCaseId) ||
    CSC148_UNIFIED_MEMORY_QUERY_CASES[0];
  const baseline = cohort.find((item) => item.user.id === selectedCase.fixtureUserId) || null;
  const latestResult = latestResults[selectedCase.id] || null;
  const evaluation = latestResult ? evaluateResult(selectedCase, latestResult, notebooks) : null;
  const notebookFingerprint = useMemo(
    () => notebooks.map((item) => `${item.sourceCaseId}:${item.updatedAt}:${item.content.length}`),
    [notebooks],
  );
  const previewRequest = useMemo(() => {
    if (!baseline) return null;
    const request = requestFromSnapshot({
      snapshot: baseline,
      testCase: selectedCase,
      query,
      notebooks,
    });
    if (selectedCase.calendarSetup.length) {
      request.sources.calendar = calendarSetupSource(selectedCase);
    }
    return request;
  }, [baseline, notebooks, query, selectedCase]);
  const auditedRequest = latestResult?.request || previewRequest;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MANUAL_CHECKS_KEY);
      if (saved) setManualChecks(JSON.parse(saved) as Record<string, boolean>);
    } catch {
      // A malformed optional QA checklist must not block test execution.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [snapshots, sourceResults, queryResults, fileRecords] = await Promise.all([
          ensureLocalMemoryTestUserCohort(),
          loadLocalSourceUploadLatestResults(),
          loadLocalMemoryUnifiedQueryLatestResults(),
          loadPhaseTwoRunsFromLocalFiles<LocalMemoryUnifiedQueryLatestResult>(SCENARIO_ID).catch(
            () => [],
          ),
        ]);
        if (cancelled) return;
        setCohort(snapshots);
        setNotebooks(buildLoadedNotebooks(sourceResults));
        const merged = Object.fromEntries(queryResults.map((item) => [item.caseId, item]));
        for (const record of fileRecords) {
          const candidate = record.result;
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

  function selectCase(testCase: Csc148UnifiedMemoryQueryCase) {
    setSelectedCaseId(testCase.id);
    setQuery(testCase.query);
    setError('');
  }

  function toggleManualCheck(label: string, checked: boolean) {
    const key = `${selectedCase.id}:${label}`;
    const next = { ...manualChecks, [key]: checked };
    setManualChecks(next);
    localStorage.setItem(MANUAL_CHECKS_KEY, JSON.stringify(next));
  }

  async function runSelectedCase() {
    if (selectedCase.requiresGeneratedNotebooks && notebooks.length === 0) {
      setError('这条测试需要先在第二阶段 02 生成至少一份 CSC148 学习笔记本。');
      return;
    }
    setRunning(true);
    setError('');
    let disposableUserId = '';
    try {
      let snapshot = await prepareLocalMemoryTestScenarioRun({
        scenarioId: SCENARIO_ID,
        fixtureUserId: selectedCase.fixtureUserId,
      });
      disposableUserId = snapshot.user.id;

      for (const event of calendarSetupSource(selectedCase)) {
        const mutation = await runLocalMemoryTestAction({
          action: 'upsert_calendar',
          userId: snapshot.user.id,
          eventId: event.id,
          title: event.title,
          startsAt: event.startsAt,
          durationMinutes: event.durationMinutes,
        });
        snapshot = mutation.snapshot;
      }

      const request = requestFromSnapshot({
        snapshot,
        testCase: selectedCase,
        query,
        notebooks,
      });
      const sourceFingerprint = stableFingerprint({
        caseId: selectedCase.id,
        historyMode: selectedCase.historyMode,
        profile: request.sources.profile.facts.map((item) => [item.id, item.updatedAt]),
        calendar: request.sources.calendar,
        workingMemory: request.sources.workingMemory,
        memories: request.sources.memories.map((item) => [item.id, item.updatedAt]),
        attempts: request.sources.attempts.map((item) => [item.id, item.createdAt]),
        notebooks: notebookFingerprint,
      });
      const modelHeaders: Record<string, string> =
        providerId === 'openai' && modelId ? { 'x-model': `openai:${modelId}` } : {};
      const response = await backendJson<UnifiedMemoryQueryResponse>(QUERY_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-generation-test-no-charge': 'true',
          ...modelHeaders,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(240_000),
      });

      let calendarMutation = null;
      const calendarAction = response.answer.calendarAction;
      if (
        calendarAction.status === 'ready' &&
        calendarAction.targetEventId &&
        calendarAction.updatedStartsAt &&
        calendarAction.durationMinutes
      ) {
        calendarMutation = await runLocalMemoryTestAction({
          action: 'upsert_calendar',
          userId: snapshot.user.id,
          eventId: calendarAction.targetEventId,
          title: calendarAction.updatedTitle || undefined,
          startsAt: calendarAction.updatedStartsAt,
          durationMinutes: calendarAction.durationMinutes,
        });
      }

      const saved = await saveLocalMemoryUnifiedQueryLatestResult({
        caseId: selectedCase.id,
        fixtureUserId: selectedCase.fixtureUserId,
        query: request.query,
        request,
        sourceFingerprint,
        response,
        calendarMutation,
      });
      setLatestResults((current) => ({ ...current, [selectedCase.id]: saved }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (disposableUserId) await disposeLocalMemoryTestScenarioRun(disposableUserId);
      setRunning(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-950">
      <div className="mx-auto max-w-[1580px] px-4 py-6 sm:px-6">
        <header className="mb-5 rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm sm:px-7">
          <Button asChild variant="ghost" className="-ml-3 rounded-lg text-slate-600">
            <Link href="/test#phase-two-memory-title">
              <ArrowLeft className="size-4" /> 返回第二阶段测试列表
            </Link>
          </Button>
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-4xl">
              <div className="flex flex-wrap gap-2">
                <Badge className="rounded-md bg-violet-600 hover:bg-violet-600">
                  第二阶段 · 05
                </Badge>
                <Badge variant="outline">统一自然语言 Agent</Badge>
                <Badge variant="outline">一次性本地副本</Badge>
                <Badge variant="outline">latest-only</Badge>
                <Badge variant="outline">浏览器 + 本地文件记录</Badge>
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                {scenario.title}
              </h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
                一个 agent
                从普通说法中判断需要哪些上下文，再综合个人资料、日历、学习状态、已生成笔记本与真实题目回答；学生侧不显示内部路径或隐藏思维过程。
              </p>
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

        <div className="grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-5">
            <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100 bg-slate-950 text-white">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquareText className="size-4" /> 独立小测试
                </CardTitle>
                <p className="text-xs leading-5 text-slate-300">
                  每项单独运行、单独保存最新结果，不是一个流程的步骤。
                </p>
              </CardHeader>
              <CardContent className="space-y-2 p-3">
                {CSC148_UNIFIED_MEMORY_QUERY_CASES.map((testCase, index) => {
                  const selected = selectedCase.id === testCase.id;
                  const saved = latestResults[testCase.id];
                  return (
                    <button
                      key={testCase.id}
                      type="button"
                      disabled={running}
                      onClick={() => selectCase(testCase)}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                        selected
                          ? 'border-slate-950 bg-slate-950 text-white'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-[11px] font-semibold ${
                            selected ? 'bg-white text-slate-950' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{testCase.shortTitle}</span>
                          <span
                            className={`mt-1 block text-[11px] leading-4 ${selected ? 'text-slate-300' : 'text-slate-500'}`}
                          >
                            {testCase.description}
                          </span>
                          <span
                            className={`mt-1 block text-[10px] ${selected ? 'text-slate-400' : saved ? 'text-emerald-600' : 'text-slate-400'}`}
                          >
                            {saved ? `最新结果 ${formatTime(saved.updatedAt)}` : '尚未运行'}
                          </span>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Database className="size-4" /> 本地测试资产
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">人物基线</span>
                  <span className="font-medium">{baseline?.user.name || '加载中'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">长期记忆</span>
                  <span className="font-mono">{baseline?.counts.studyMemories ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">做题记录</span>
                  <span className="font-mono">{baseline?.counts.attempts ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">日历事项</span>
                  <span className="font-mono">{baseline?.counts.calendarEvents ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">第二阶段 02 笔记本</span>
                  <span className="font-mono">{notebooks.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">真实题库</span>
                  <span className="font-mono">298</span>
                </div>
              </CardContent>
            </Card>
          </aside>

          <div className="min-w-0 space-y-5">
            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">
                {error}
              </div>
            ) : null}

            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-slate-950 hover:bg-slate-950">{selectedCase.title}</Badge>
                  <Badge variant="outline">
                    {selectedCase.historyMode === 'none'
                      ? '无学习历史'
                      : selectedCase.historyMode === 'sparse'
                        ? '少量历史'
                        : '完整历史'}
                  </Badge>
                  <Badge variant="outline">
                    {baseline?.user.name || selectedCase.fixtureUserId}
                  </Badge>
                </div>
                <CardTitle className="mt-2 text-xl">自然语言输入</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="min-h-32 resize-y text-sm leading-6"
                />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="max-w-2xl text-xs leading-5 text-slate-500">
                    用户不选择模块；统一 agent
                    只接收自然语言和可用数据数量，自行决定读取范围。日历写入只发生在一次性测试副本。
                  </p>
                  <Button
                    onClick={runSelectedCase}
                    disabled={running || loading || !query.trim()}
                    className="rounded-xl bg-violet-600 hover:bg-violet-700"
                  >
                    {running ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    运行当前小测试
                  </Button>
                </div>
              </CardContent>
            </Card>

            {auditedRequest ? (
              <EffectiveInputAudit
                request={auditedRequest}
                testCase={selectedCase}
                exact={Boolean(latestResult?.request)}
                legacyResult={Boolean(latestResult && !latestResult.request)}
              />
            ) : null}

            {selectedCase.requiresGeneratedNotebooks && notebooks.length === 0 ? (
              <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm">
                <CardContent className="flex items-start gap-3 py-5 text-sm leading-6 text-amber-900">
                  <BookOpen className="mt-1 size-4 shrink-0" />
                  <p>
                    当前浏览器还没有第二阶段 02
                    的生成笔记本结果。先完成任意一份资料生成，再运行本条；这里不会用临时假笔记替代。
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {!latestResult ? (
              <Card className="rounded-2xl border-slate-200 shadow-sm">
                <CardContent className="flex min-h-56 flex-col items-center justify-center py-10 text-center">
                  {loading ? (
                    <Loader2 className="size-6 animate-spin text-violet-600" />
                  ) : (
                    <CircleDashed className="size-7 text-slate-400" />
                  )}
                  <div className="mt-3 font-semibold">尚未运行这条独立测试</div>
                  <p className="mt-1 max-w-lg text-sm leading-6 text-slate-500">
                    运行后会保留用户可见回答、精简调用摘要、实际证据、机器检查和必要的日历前后快照。
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <Card className="rounded-2xl border-violet-200 bg-violet-50 shadow-sm">
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-violet-600 hover:bg-violet-600">用户实际看到</Badge>
                      <Badge variant="outline">{latestResult.response.answer.evidenceState}</Badge>
                      <Badge variant="outline">{latestResult.response.model}</Badge>
                    </div>
                    <CardTitle className="mt-2 flex items-center gap-2 text-lg">
                      <BrainCircuit className="size-5" /> 统一 Agent 回复
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-2xl border border-violet-200 bg-white px-5 py-4 text-sm leading-7 text-slate-800">
                      <MessageResponse>{latestResult.response.answer.message}</MessageResponse>
                    </div>
                  </CardContent>
                </Card>

                {auditedRequest ? (
                  <LearningAnswerEvidenceAudit
                    request={auditedRequest}
                    response={latestResult.response}
                  />
                ) : null}

                {latestResult.response.answer.calendarAction.status !== 'none' ? (
                  <Card className="rounded-2xl border-amber-200 shadow-sm">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <CalendarClock className="size-4 text-amber-600" /> 日历动作验收
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                        {latestResult.response.answer.calendarAction.status === 'ready'
                          ? latestResult.response.answer.calendarAction.confirmationSummary ||
                            '已形成并执行唯一日历修改。'
                          : latestResult.response.answer.calendarAction.clarificationQuestion ||
                            '目标有歧义，本轮没有修改。'}
                      </div>
                      {latestResult.calendarMutation ? (
                        <div className="grid gap-4 xl:grid-cols-2">
                          <div>
                            <div className="mb-2 text-xs font-semibold text-slate-500">修改前</div>
                            <pre className="max-h-64 overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                              {JSON.stringify(
                                latestResult.calendarMutation.before.facts.filter(
                                  (fact) => fact.namespace === 'calendar',
                                ),
                                null,
                                2,
                              )}
                            </pre>
                          </div>
                          <div>
                            <div className="mb-2 text-xs font-semibold text-slate-500">修改后</div>
                            <pre className="max-h-64 overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                              {JSON.stringify(
                                latestResult.calendarMutation.after.facts.filter(
                                  (fact) => fact.namespace === 'calendar',
                                ),
                                null,
                                2,
                              )}
                            </pre>
                          </div>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                ) : null}

                <Card className="rounded-2xl border-slate-200 shadow-sm">
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ShieldCheck className="size-4 text-emerald-600" /> 自动验收
                      </CardTitle>
                      <Badge
                        className={
                          evaluation?.passed
                            ? 'bg-emerald-600 hover:bg-emerald-600'
                            : 'bg-rose-600 hover:bg-rose-600'
                        }
                      >
                        {evaluation?.passed ? '全部通过' : '有检查未通过'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-3 xl:grid-cols-2">
                    {evaluation?.checks.map((check) => (
                      <div
                        key={check.id}
                        className="flex gap-3 rounded-xl border border-slate-200 p-3"
                      >
                        <ResultIcon passed={check.passed} />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">{check.label}</div>
                          <p className="mt-1 break-words text-xs leading-5 text-slate-500">
                            {check.detail}
                          </p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <details className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-semibold">
                    <Route className="size-4 text-slate-500" /> QA 安全调用摘要与证据
                  </summary>
                  <div className="border-t border-slate-100 px-5 py-5">
                    <div className="grid gap-4 xl:grid-cols-2">
                      <Card className="rounded-xl border-slate-200 shadow-none">
                        <CardHeader>
                          <CardTitle className="text-sm">调用摘要（非思维链）</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                          <div>
                            <span className="text-slate-500">意图：</span>
                            {latestResult.response.agent.intent}
                          </div>
                          <p className="leading-6 text-slate-600">
                            {latestResult.response.agent.decisionSummary}
                          </p>
                          {latestResult.response.trace.map((item) => (
                            <div key={item.toolId} className="rounded-lg bg-slate-50 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium">{TOOL_LABELS[item.toolId]}</span>
                                <Badge variant="outline">{item.outputEvidenceIds.length} 条</Badge>
                              </div>
                              <p className="mt-1 text-xs leading-5 text-slate-500">{item.reason}</p>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                      <Card className="rounded-xl border-slate-200 shadow-none">
                        <CardHeader>
                          <CardTitle className="text-sm">实际返回证据</CardTitle>
                        </CardHeader>
                        <CardContent className="max-h-[520px] space-y-3 overflow-auto">
                          {latestResult.response.evidence.map((item) => (
                            <article
                              key={item.id}
                              className="rounded-lg border border-slate-200 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">{item.sourceType}</Badge>
                                <span className="text-sm font-semibold">{item.title}</span>
                              </div>
                              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">
                                {item.excerpt}
                              </p>
                            </article>
                          ))}
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </details>

                <Card className="rounded-2xl border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base">人工语义验收</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {selectedCase.manualCriteria.map((label) => {
                      const key = `${selectedCase.id}:${label}`;
                      return (
                        <label
                          key={label}
                          className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3"
                        >
                          <Checkbox
                            checked={Boolean(manualChecks[key])}
                            onCheckedChange={(checked) =>
                              toggleManualCheck(label, checked === true)
                            }
                          />
                          <span className="text-sm leading-6 text-slate-700">{label}</span>
                        </label>
                      );
                    })}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
