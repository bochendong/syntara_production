'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileUp,
  HardDrive,
  ImageIcon,
  Layers3,
  Loader2,
  MessageSquareText,
  PencilLine,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UserRound,
  UserRoundPlus,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MessageResponse } from '@/components/ai-elements/message';
import {
  buildLocalMemoryEvidence,
  disposeLocalMemoryTestScenarioRun,
  ensureLocalMemoryTestUserCohort,
  LOCAL_PROBLEM_WRITEBACK_CASES,
  LOCAL_MEMORY_TEST_USER_FIXTURES,
  prepareLocalMemoryTestScenarioRun,
  queryLocalMemoryTest,
  runLocalMemoryTestAction,
  type LocalMemoryMutationResponse,
  type LocalMemoryLearnerProfile,
  type LocalProblemWritebackCase,
  type LocalAttemptDiagnosisResponse,
  type LocalMemoryTestSnapshot,
} from '@/features/qa/test-center/memory/local-memory-test-store';
import {
  CSC148_SOURCE_UPLOAD_CASES,
  type Csc148SourceUploadCase,
} from '@/features/qa/test-center/memory/csc148-source-upload-cases';
import {
  CSC148_QUESTION_WRITEBACK_CASES,
  type LocalQuestionDiagnosisResponse,
  type LocalQuestionWritebackCase,
} from '@/features/qa/test-center/memory/csc148-question-writeback-cases';
import {
  loadLocalMemoryActivityLatestResults,
  saveLocalMemoryActivityLatestResult,
  type LocalMemoryActivityLatestResult,
  type LocalMemoryActivityScenarioId,
} from '@/features/qa/test-center/memory/local-memory-activity-result-store';
import {
  createLocalSourceUploadLatestResult,
  loadLocalSourceUploadLatestResults,
  saveLocalSourceUploadLatestResult,
  type LocalSourceTestStage,
  type LocalSourceUploadLatestResult,
} from '@/features/qa/test-center/memory/local-memory-source-test-result-store';
import {
  MEMORY_SYSTEM_TEST_SCENARIOS,
  type MemorySystemGroup,
  type MemorySystemTestScenario,
} from '@/features/qa/test-center/registry';
import { PlatformFlowResultPreview } from '@/features/qa/test-center/workspace/platform-flow-result-preview';
import type {
  NotebookAnswerContract,
  NotebookRouteDecision,
  NotebookStudyGuide,
  PlatformFlowOutput,
} from '@/features/qa/test-center/workspace/types';
import type {
  ImageGenerationCostEstimate,
  ImageGenerationResult,
  StudyCoverOverlaySpec,
} from '@/lib/media/types';
import { useSettingsStore } from '@/lib/store/settings';
import { backendJson } from '@/lib/utils/backend-api';

type Snapshot = LocalMemoryTestSnapshot;
type MutationResponse = LocalMemoryMutationResponse;

type AiTask = 'questions' | 'explanation' | 'review_plan' | 'next_action';
type SourceResultView = LocalSourceTestStage;

const SOURCE_COVER_IMAGE_PROVIDER_ID = 'openai-image' as const;
const SOURCE_COVER_IMAGE_MODEL_ID = 'gpt-image-2';

type QueueSourceResponse = {
  sourceId: string;
  filename: string;
  queuePath: string;
  content: string;
  size: number;
  modifiedAt: number;
};

type SourceMarkdownNotebookResponse = {
  storage: 'none';
  preview: {
    source: {
      title: string;
      hash: string;
      openaiFileId: string | null;
      aiSynthesisInput: 'openai_file_id' | 'extracted_text' | 'not_used';
    };
    classification: {
      documentType: string;
      usageProfile: string;
      topic: string;
      courseCode: string | null;
    };
    title: string;
    routing: NotebookRouteDecision;
    studyGuide: NotebookStudyGuide;
    sections: Array<{ key: string; title: string; summary: string; markdown: string }>;
    answerContract: NotebookAnswerContract | null;
  };
};

type SourceCoverPromptResponse = {
  storage: 'none';
  preview: {
    source: {
      title: string;
      hash: string;
      openaiFileId: string | null;
      aiSynthesisInput: 'openai_file_id' | 'extracted_text' | 'not_used';
    };
    classification: { documentType: string; usageProfile: string; topic: string };
    prompt: string;
    coverSpec: StudyCoverOverlaySpec;
    summary: string;
    sections: Array<{ title: string; summary: string }>;
  };
};

type ImageGenerationResponse = {
  result: ImageGenerationResult;
  costEstimate?: ImageGenerationCostEstimate;
};

type AiResponse = {
  action: 'generate';
  task: AiTask;
  model: string;
  usage: unknown;
  context: {
    instruction: string;
    evidence: Array<{ id: string; layer: string; title: string; content: string }>;
    recall: unknown;
  };
  output: {
    title: string;
    summary: string;
    items: Array<{
      title: string;
      content: string;
      evidenceIds: string[];
      difficulty: string | null;
      minutes: number | null;
    }>;
    adaptations: string[];
    uncertainty: string[];
  };
  evidenceChecks: Array<{
    title: string;
    passed: boolean;
    citedIds: string[];
    unknownIds: string[];
  }>;
  passedMachineCheck: boolean;
};

const AI_API = '/api/platform-tests/memory-local-ai';
const CHECK_STORAGE_KEY = 'syntara-memory-phase2-manual-checks';
const COHORT_SCENARIO_ID = 'memory-simulated-user';
const SOURCE_UPLOAD_SCENARIO_ID = 'memory-source-upload-writeback';

const GROUP_LABELS: Record<MemorySystemGroup, string> = {
  setup: '测试准备',
  write: '记忆写入',
  manage: '查询、修改与删除',
  ai: 'AI 使用记忆',
};

const AI_TASK_BY_SCENARIO: Record<string, AiTask> = {
  'memory-ai-question-generation': 'questions',
  'memory-ai-explanation': 'explanation',
  'memory-ai-review-plan': 'review_plan',
  'memory-ai-next-action': 'next_action',
};

const AI_TASK_LABELS: Record<AiTask, string> = {
  questions: '基于记忆生成三道递进题',
  explanation: '基于记忆进行个性化讲解',
  review_plan: '基于记忆制定三天复习计划',
  next_action: '基于记忆推荐下一学习动作',
};

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function completedSourceStageCount(result: LocalSourceUploadLatestResult) {
  return [result.memoryMutation, result.notebookMutation, result.coverMutation].filter(Boolean)
    .length;
}

function formatLatestResultTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp);
}

function JsonBlock({ value, maxHeight = 'max-h-72' }: { value: unknown; maxHeight?: string }) {
  return (
    <pre
      className={`${maxHeight} overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-200`}
    >
      {pretty(value)}
    </pre>
  );
}

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
      <div className="font-mono text-xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-[11px] leading-4 text-slate-500">{label}</div>
    </div>
  );
}

function SnapshotCounts({ snapshot }: { snapshot: Snapshot }) {
  return (
    <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      <CountCard label="长期/教学记忆" value={snapshot.counts.studyMemories} />
      <CountCard label="当前结构化事实" value={snapshot.counts.activeFacts} />
      <CountCard label="事实变更事件" value={snapshot.counts.factEvents} />
      <CountCard label="本地上传资料" value={snapshot.counts.materials} />
      <CountCard label="测试题目" value={snapshot.counts.problems} />
      <CountCard label="作答记录" value={snapshot.counts.attempts} />
      <CountCard label="测试对话" value={snapshot.counts.conversations} />
      <CountCard label="日历事项" value={snapshot.counts.calendarEvents} />
    </section>
  );
}

function exactFactValue(snapshot: Snapshot, namespace: string, key: string) {
  return snapshot.facts.find((fact) => fact.namespace === namespace && fact.key === key)?.valueJson;
}

function learnerProfileFromSnapshot(snapshot: Snapshot): LocalMemoryLearnerProfile | null {
  const value = exactFactValue(snapshot, 'profile', 'learner_level');
  if (!value || typeof value !== 'object') return null;
  const profile = value as Partial<LocalMemoryLearnerProfile>;
  if (
    typeof profile.levelId !== 'string' ||
    typeof profile.levelLabel !== 'string' ||
    typeof profile.masteryPercent !== 'number' ||
    !Array.isArray(profile.mastered) ||
    !Array.isArray(profile.weaknesses) ||
    typeof profile.nextTeachingMove !== 'string'
  ) {
    return null;
  }
  return profile as LocalMemoryLearnerProfile;
}

type UsageSummary = {
  usageTier: 'new' | 'light' | 'active' | 'heavy';
  usageLabel: string;
  accountAgeDays: number;
  activeDays: number;
  studySessions: number;
  problemCount: number;
  attemptCount: number;
  conversationCount: number;
  materialCount: number;
  calendarEventCount: number;
  reviewCount: number;
  durablePrivateMemoryCount: number;
  messageCount: number;
  passedAttempts: number;
  lastActiveAt: string;
};

function usageSummaryFromSnapshot(snapshot: Snapshot): UsageSummary | null {
  const value = exactFactValue(snapshot, 'usage', 'activity_summary');
  if (!value || typeof value !== 'object') return null;
  const usage = value as Partial<UsageSummary>;
  if (
    typeof usage.usageLabel !== 'string' ||
    typeof usage.accountAgeDays !== 'number' ||
    typeof usage.activeDays !== 'number' ||
    typeof usage.studySessions !== 'number' ||
    typeof usage.messageCount !== 'number' ||
    typeof usage.reviewCount !== 'number'
  ) {
    return null;
  }
  return usage as UsageSummary;
}

function formatLocalDate(value: number | string | undefined) {
  if (value === undefined) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function SourceHistoryPreview({ snapshot }: { snapshot: Snapshot }) {
  const recentProblems = [...snapshot.sources.problems]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 6);
  const recentAttempts = [...snapshot.sources.attempts]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 6);
  const recentConversations = [...snapshot.sources.conversations]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 4);
  const recentMaterials = snapshot.sources.materials.slice(0, 4);
  const calendarFacts = snapshot.facts
    .filter((fact) => fact.namespace === 'calendar')
    .slice(0, 4)
    .map((fact) => ({
      key: fact.key,
      value: fact.valueJson as {
        title?: string;
        startAt?: string;
        status?: string;
      },
    }));

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-950">最近题目与作答</h4>
          <Badge variant="outline">
            {snapshot.counts.problems} 题 · {snapshot.counts.attempts} 次
          </Badge>
        </div>
        <div className="mt-3 space-y-2">
          {recentProblems.map((problem) => (
            <div key={problem.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">{problem.title}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {problem.concept} · {problem.difficulty} · {formatLocalDate(problem.createdAt)}
                  </div>
                </div>
                <Badge
                  variant="secondary"
                  className={
                    problem.latestStatus === 'passed'
                      ? 'bg-emerald-100 text-emerald-800'
                      : problem.latestStatus === 'partial'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-rose-100 text-rose-800'
                  }
                >
                  {problem.attemptCount} 次 · {problem.latestStatus || '无作答'}
                </Badge>
              </div>
            </div>
          ))}
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-500">
            查看最近 6 条逐次作答记录
          </summary>
          <div className="mt-2 space-y-2">
            {recentAttempts.map((attempt) => (
              <div
                key={attempt.id}
                className="rounded-xl bg-white p-3 text-xs leading-5 text-slate-600"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-slate-900">
                    {attempt.problemTitle}
                  </span>
                  <span className="font-mono">
                    {attempt.status} · {attempt.score}/2
                  </span>
                </div>
                <p className="mt-1">{attempt.feedback}</p>
              </div>
            ))}
          </div>
        </details>
      </div>

      <div className="space-y-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-950">聊天记录</h4>
            <Badge variant="outline">{snapshot.counts.conversations} 段</Badge>
          </div>
          <div className="mt-3 space-y-2">
            {recentConversations.length ? (
              recentConversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className="rounded-xl border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-slate-900">{conversation.title}</span>
                    <span className="text-xs text-slate-400">
                      {conversation.messageCount} 条消息
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                    {conversation.lastUserMessage}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">还没有聊天记录。</p>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-950">上传资料</h4>
              <Badge variant="outline">{snapshot.counts.materials} 份</Badge>
            </div>
            <div className="mt-3 space-y-2 text-xs text-slate-600">
              {recentMaterials.length ? (
                recentMaterials.map((material) => (
                  <div key={material.id} className="truncate rounded-lg bg-white px-3 py-2">
                    {material.name}
                  </div>
                ))
              ) : (
                <p>尚未上传资料。</p>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-950">日历记忆</h4>
              <Badge variant="outline">{snapshot.counts.calendarEvents} 项</Badge>
            </div>
            <div className="mt-3 space-y-2 text-xs text-slate-600">
              {calendarFacts.length ? (
                calendarFacts.map((fact) => (
                  <div key={fact.key} className="rounded-lg bg-white px-3 py-2">
                    <div className="font-medium text-slate-900">{fact.value.title || fact.key}</div>
                    <div className="mt-0.5 text-slate-400">
                      {formatLocalDate(fact.value.startAt)} · {fact.value.status || 'planned'}
                    </div>
                  </div>
                ))
              ) : (
                <p>尚未创建日历事项。</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MutationEvidence({ mutation }: { mutation: MutationResponse | null }) {
  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">本次临时运行的 before / after</CardTitle>
      </CardHeader>
      <CardContent>
        {mutation ? (
          <JsonBlock
            value={{
              action: mutation.action,
              delta: mutation.delta,
              result: mutation.result,
              before: mutation.before?.counts,
              after: mutation.after?.counts,
            }}
          />
        ) : (
          <p className="text-sm text-slate-500">
            每次运行都从人物基线创建一次性副本，再读取 before / after / delta；副本随后销毁。
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function CliMemoryRunEvidence({
  latestResult,
}: {
  latestResult: LocalMemoryActivityLatestResult | null;
}) {
  if (!latestResult?.cliRun || latestResult.mutation) return null;
  return (
    <Card className="rounded-2xl border-violet-200 bg-violet-50/40 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">命令行真实模型测试记录</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-6 text-violet-950">
          这条记录由本地 CLI 直接调用模型并执行分层记忆门控后写入，已同步到本页面；它不伪造浏览器
          before / after。需要检查浏览器沙盒写入时，可在本页重新运行同一用例。
        </p>
        <JsonBlock value={latestResult.cliRun} />
      </CardContent>
    </Card>
  );
}

function StudyMemoryList({
  memories,
  onDelete,
}: {
  memories: Snapshot['studyMemories'];
  onDelete?: (memoryId: string) => void;
}) {
  if (!memories.length) {
    return <p className="text-sm text-slate-500">当前没有匹配的 StudyMemory。</p>;
  }

  return (
    <div className="space-y-3">
      {memories.map((memory) => (
        <article key={memory.id} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-slate-950">{memory.title}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                <Badge variant="secondary">{memory.kind}</Badge>
                <Badge variant="outline">{memory.source}</Badge>
                <Badge variant="outline">{memory.scope}</Badge>
              </div>
            </div>
            {onDelete ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label="删除记忆"
                onClick={() => onDelete(memory.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{memory.text}</p>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-500">
              查看 memoryId 与来源引用
            </summary>
            <div className="mt-2">
              <JsonBlock
                value={{ id: memory.id, sourceReferences: memory.sourceReferences }}
                maxHeight="max-h-48"
              />
            </div>
          </details>
        </article>
      ))}
    </div>
  );
}

function TestSteps({
  steps,
}: {
  steps: Array<{ title: string; action: string; evidence: string }>;
}) {
  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">本条包含 {steps.length} 个小测试</CardTitle>
          <Badge variant="outline">逐条人工核对</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-2">
        {steps.map((step, index) => (
          <article
            id={`memory-subtest-${index + 1}`}
            key={step.title}
            className="scroll-mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-slate-950 font-mono text-[11px] font-semibold text-white">
                {index + 1}
              </span>
              <h2 className="font-semibold text-slate-950">{step.title}</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">{step.action}</p>
            <p className="mt-2 text-xs leading-5 text-emerald-700">验收证据：{step.evidence}</p>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}

function CurrentTestSidebar({ scenario }: { scenario: MemorySystemTestScenario }) {
  const testNumber = String(scenario.order - 7).padStart(2, '0');

  return (
    <nav
      aria-label={`${scenario.shortTitle}的小测试`}
      className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
    >
      <div className="border-b border-slate-100 px-2 pb-3 pt-1">
        <div className="flex items-center justify-between gap-2">
          <Badge className="bg-slate-950 font-mono hover:bg-slate-950">测试 {testNumber}</Badge>
          <span className="text-[11px] font-semibold text-slate-400">
            {scenario.steps.length} 条小测试
          </span>
        </div>
        <div className="mt-3 text-sm font-semibold leading-5 text-slate-950">
          {scenario.shortTitle}
        </div>
        <div className="mt-1 text-xs text-slate-500">{GROUP_LABELS[scenario.phaseTwoGroup]}</div>
      </div>

      <ol className="mt-3 space-y-2">
        {scenario.steps.map((step, index) => (
          <li key={step.title}>
            <a
              href={`#memory-subtest-${index + 1}`}
              className="group flex gap-3 rounded-xl border border-transparent px-3 py-3 transition hover:border-slate-200 hover:bg-slate-50"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 font-mono text-xs font-semibold text-slate-600 group-hover:bg-slate-950 group-hover:text-white">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-5 text-slate-800">
                  {step.title}
                </span>
                <span className="mt-1 block text-[11px] leading-4 text-slate-500">
                  {step.action}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ol>

      <Button asChild variant="outline" className="mt-3 w-full justify-between rounded-xl">
        <Link href="/test#phase-two-memory-title">
          查看全部 {MEMORY_SYSTEM_TEST_SCENARIOS.length} 条测试
          <ChevronRight className="size-4" />
        </Link>
      </Button>
    </nav>
  );
}

function ProblemWritebackCaseSidebar({
  selectedCaseId,
  disabled,
  latestResults,
  onSelect,
}: {
  selectedCaseId: string;
  disabled: boolean;
  latestResults: Record<string, LocalMemoryActivityLatestResult>;
  onSelect: (testCase: LocalProblemWritebackCase) => void;
}) {
  return (
    <nav
      className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
      aria-label="做题记忆写回测试"
    >
      <div className="px-2 pb-2 pt-1">
        <div className="flex items-center justify-between gap-2">
          <Badge className="bg-slate-950 hover:bg-slate-950">测试 07</Badge>
          <span className="text-[11px] font-semibold text-slate-400">
            {LOCAL_PROBLEM_WRITEBACK_CASES.length} 个独立测试
          </span>
        </div>
        <div className="mt-3 text-sm font-semibold text-slate-950">选择一个做题场景</div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          每项都从对应人物的只读基线单独开始，互不继承测试结果。
        </p>
      </div>

      <div className="mt-1 max-h-[calc(100vh-300px)] space-y-2 overflow-y-auto pr-1">
        {LOCAL_PROBLEM_WRITEBACK_CASES.map((testCase, index) => {
          const selected = selectedCaseId === testCase.id;
          const latestResult = latestResults[testCase.id];
          return (
            <button
              key={testCase.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(testCase)}
              className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                selected
                  ? 'border-slate-950 bg-slate-950 text-white'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              } disabled:cursor-wait disabled:opacity-60`}
            >
              <span className="flex items-start gap-3">
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-semibold ${
                    selected ? 'bg-white text-slate-950' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-5">{testCase.title}</span>
                  <span
                    className={`mt-1 block text-[11px] leading-4 ${selected ? 'text-slate-300' : 'text-slate-500'}`}
                  >
                    {testCase.relationLabel}
                  </span>
                  <span
                    className={`mt-1 block text-[10px] leading-4 ${selected ? 'text-slate-400' : latestResult ? 'text-emerald-600' : 'text-slate-400'}`}
                  >
                    {latestResult
                      ? `最新结果 ${formatLatestResultTime(latestResult.updatedAt)}`
                      : '未运行'}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <Button asChild variant="outline" className="mt-3 w-full justify-between rounded-xl">
        <Link href="/test#phase-two-memory-title">
          查看全部 {MEMORY_SYSTEM_TEST_SCENARIOS.length} 条测试
          <ChevronRight className="size-4" />
        </Link>
      </Button>
    </nav>
  );
}

function QuestionWritebackCaseSidebar({
  selectedCaseId,
  disabled,
  latestResults,
  onSelect,
}: {
  selectedCaseId: string;
  disabled: boolean;
  latestResults: Record<string, LocalMemoryActivityLatestResult>;
  onSelect: (testCase: LocalQuestionWritebackCase) => void;
}) {
  return (
    <nav
      className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
      aria-label="提问记忆写回测试"
    >
      <div className="px-2 pb-2 pt-1">
        <div className="flex items-center justify-between gap-2">
          <Badge className="bg-slate-950 hover:bg-slate-950">测试 08</Badge>
          <span className="text-[11px] font-semibold text-slate-400">
            {CSC148_QUESTION_WRITEBACK_CASES.length} 个独立测试
          </span>
        </div>
        <div className="mt-3 text-sm font-semibold text-slate-950">选择一条学生提问</div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          覆盖口语短问、题目/代码/traceback 粘贴、上下文不足与课程外问题。
        </p>
      </div>

      <div className="mt-1 max-h-[calc(100vh-300px)] space-y-2 overflow-y-auto pr-1">
        {CSC148_QUESTION_WRITEBACK_CASES.map((testCase, index) => {
          const selected = selectedCaseId === testCase.id;
          const latestResult = latestResults[testCase.id];
          return (
            <button
              key={testCase.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(testCase)}
              className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                selected
                  ? 'border-slate-950 bg-slate-950 text-white'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              } disabled:cursor-wait disabled:opacity-60`}
            >
              <span className="flex items-start gap-3">
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-semibold ${
                    selected ? 'bg-white text-slate-950' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-5">{testCase.title}</span>
                  <span
                    className={`mt-1 block text-[11px] leading-4 ${selected ? 'text-slate-300' : 'text-slate-500'}`}
                  >
                    {testCase.relationLabel}
                  </span>
                  <span
                    className={`mt-1 block text-[10px] leading-4 ${selected ? 'text-slate-400' : latestResult ? 'text-emerald-600' : 'text-slate-400'}`}
                  >
                    {latestResult
                      ? `最新结果 ${formatLatestResultTime(latestResult.updatedAt)}`
                      : '未运行'}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <Button asChild variant="outline" className="mt-3 w-full justify-between rounded-xl">
        <Link href="/test#phase-two-memory-title">
          查看全部 {MEMORY_SYSTEM_TEST_SCENARIOS.length} 条测试
          <ChevronRight className="size-4" />
        </Link>
      </Button>
    </nav>
  );
}

function SourceUploadCaseSidebar({
  selectedCaseId,
  disabled,
  latestResults,
  onSelect,
}: {
  selectedCaseId: string;
  disabled: boolean;
  latestResults: Record<string, LocalSourceUploadLatestResult>;
  onSelect: (testCase: Csc148SourceUploadCase) => void;
}) {
  return (
    <nav
      className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
      aria-label="上传教师笔记本记忆写回测试"
    >
      <div className="px-2 pb-2 pt-1">
        <div className="flex items-center justify-between gap-2">
          <Badge className="bg-slate-950 hover:bg-slate-950">测试 02</Badge>
          <span className="text-[11px] font-semibold text-slate-400">
            {CSC148_SOURCE_UPLOAD_CASES.length} 份 queue 文件
          </span>
        </div>
        <div className="mt-3 text-sm font-semibold text-slate-950">选择一份教师笔记本</div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          每份文件独立测试记忆去重、笔记本生成和封面图生成。
        </p>
      </div>

      <div className="mt-1 max-h-[calc(100vh-300px)] space-y-2 overflow-y-auto pr-1">
        {CSC148_SOURCE_UPLOAD_CASES.map((testCase, index) => {
          const selected = selectedCaseId === testCase.id;
          const latestResult = latestResults[testCase.id];
          const completedCount = latestResult ? completedSourceStageCount(latestResult) : 0;
          return (
            <button
              key={testCase.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(testCase)}
              className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                selected
                  ? 'border-slate-950 bg-slate-950 text-white'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              } disabled:cursor-wait disabled:opacity-60`}
            >
              <span className="flex items-start gap-3">
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-semibold ${
                    selected ? 'bg-white text-slate-950' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-5">{testCase.title}</span>
                  <span
                    className={`mt-1 block truncate font-mono text-[10px] leading-4 ${selected ? 'text-slate-300' : 'text-slate-500'}`}
                  >
                    {testCase.filename}
                  </span>
                  <span
                    className={`mt-1 block text-[11px] leading-4 ${selected ? 'text-slate-300' : 'text-slate-500'}`}
                  >
                    {testCase.baselineHasContract ? '已有相似契约 · 应合并' : '新课程契约 · 应新增'}
                  </span>
                  {latestResult ? (
                    <span
                      className={`mt-1.5 flex items-center gap-1 text-[11px] font-semibold leading-4 ${
                        latestResult.status === 'completed'
                          ? selected
                            ? 'text-emerald-300'
                            : 'text-emerald-700'
                          : selected
                            ? 'text-amber-300'
                            : 'text-amber-700'
                      }`}
                    >
                      {latestResult.status === 'completed' ? (
                        <CheckCircle2 className="size-3.5 shrink-0" />
                      ) : (
                        <RefreshCw className="size-3.5 shrink-0" />
                      )}
                      最新结果 {completedCount}/3 · {formatLatestResultTime(latestResult.updatedAt)}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <Button asChild variant="outline" className="mt-3 w-full justify-between rounded-xl">
        <Link href="/test#phase-two-memory-title">
          查看全部 {MEMORY_SYSTEM_TEST_SCENARIOS.length} 条测试
          <ChevronRight className="size-4" />
        </Link>
      </Button>
    </nav>
  );
}

function changedStudyMemories(mutation: MutationResponse | null) {
  if (!mutation) return [];
  const beforeById = new Map(mutation.before.studyMemories.map((memory) => [memory.id, memory]));
  return mutation.after.studyMemories
    .map((memory) => {
      const before = beforeById.get(memory.id);
      if (!before) return { change: '新增' as const, memory };
      const changed =
        before.title !== memory.title ||
        before.text !== memory.text ||
        before.kind !== memory.kind ||
        before.status !== memory.status ||
        before.updatedAt !== memory.updatedAt ||
        JSON.stringify(before.sourceReferences) !== JSON.stringify(memory.sourceReferences);
      return changed ? { change: '更新' as const, memory } : null;
    })
    .filter(
      (item): item is { change: '新增' | '更新'; memory: Snapshot['studyMemories'][number] } =>
        Boolean(item),
    );
}

function imageResultUrl(result: ImageGenerationResult) {
  if (result.url) return result.url;
  if (!result.base64) return '';
  return result.base64.startsWith('data:')
    ? result.base64
    : `data:image/png;base64,${result.base64}`;
}

export function MemoryLifecycleTestWorkspace({ activeScenarioId }: { activeScenarioId: string }) {
  const activeScenario =
    MEMORY_SYSTEM_TEST_SCENARIOS.find((scenario) => scenario.id === activeScenarioId) ||
    MEMORY_SYSTEM_TEST_SCENARIOS[0];
  const activeScenarioIndex = MEMORY_SYSTEM_TEST_SCENARIOS.findIndex(
    (scenario) => scenario.id === activeScenario.id,
  );
  const previousScenario = MEMORY_SYSTEM_TEST_SCENARIOS[activeScenarioIndex - 1] || null;
  const nextScenario = MEMORY_SYSTEM_TEST_SCENARIOS[activeScenarioIndex + 1] || null;
  const activeTestNumber = String(activeScenarioIndex + 1).padStart(2, '0');
  const activeAiTask = AI_TASK_BY_SCENARIO[activeScenario.id];
  const providerId = useSettingsStore((state) => state.providerId);
  const modelId = useSettingsStore((state) => state.modelId);
  const imageProvidersConfig = useSettingsStore((state) => state.imageProvidersConfig);

  const [personaSelections, setPersonaSelections] = useState<Record<string, string>>({});
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [cohortSnapshots, setCohortSnapshots] = useState<Snapshot[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [lastMutation, setLastMutation] = useState<MutationResponse | null>(null);
  const [query, setQuery] = useState('我目前在递归上掌握了什么、薄弱在哪里，今晚应该复习什么？');
  const [queryResult, setQueryResult] = useState<unknown>(null);
  const [aiRuns, setAiRuns] = useState<AiResponse[]>([]);
  const [factNamespace, setFactNamespace] = useState('preference');
  const [factKey, setFactKey] = useState('language');
  const [factValue, setFactValue] = useState('"zh-CN"');
  const [calendarStartsAt, setCalendarStartsAt] = useState('2026-07-16T20:00');
  const [manualChecks, setManualChecks] = useState<Record<string, boolean>>({});
  const [selectedProblemCaseId, setSelectedProblemCaseId] = useState(
    LOCAL_PROBLEM_WRITEBACK_CASES[0].id,
  );
  const [selectedQuestionCaseId, setSelectedQuestionCaseId] = useState(
    CSC148_QUESTION_WRITEBACK_CASES[0].id,
  );
  const [selectedSourceCaseId, setSelectedSourceCaseId] = useState(
    CSC148_SOURCE_UPLOAD_CASES[0].id,
  );
  const [sourceResultView, setSourceResultView] = useState<SourceResultView>('memory');
  const [sourceRunPhase, setSourceRunPhase] = useState('');
  const [sourceMemoryMutation, setSourceMemoryMutation] = useState<MutationResponse | null>(null);
  const [sourceNotebookMutation, setSourceNotebookMutation] = useState<MutationResponse | null>(
    null,
  );
  const [sourceCoverMutation, setSourceCoverMutation] = useState<MutationResponse | null>(null);
  const [sourceStageErrors, setSourceStageErrors] = useState<
    Partial<Record<SourceResultView, string>>
  >({});
  const [sourceLatestResults, setSourceLatestResults] = useState<
    Record<string, LocalSourceUploadLatestResult>
  >({});
  const [activityLatestResults, setActivityLatestResults] = useState<
    Record<string, LocalMemoryActivityLatestResult>
  >({});
  const selectedProblemCase =
    LOCAL_PROBLEM_WRITEBACK_CASES.find((item) => item.id === selectedProblemCaseId) ||
    LOCAL_PROBLEM_WRITEBACK_CASES[0];
  const selectedSourceCase =
    CSC148_SOURCE_UPLOAD_CASES.find((item) => item.id === selectedSourceCaseId) ||
    CSC148_SOURCE_UPLOAD_CASES[0];
  const selectedQuestionCase =
    CSC148_QUESTION_WRITEBACK_CASES.find((item) => item.id === selectedQuestionCaseId) ||
    CSC148_QUESTION_WRITEBACK_CASES[0];
  const selectedSourceLatestResult = sourceLatestResults[selectedSourceCase.id] || null;
  const selectedFixtureUserId =
    activeScenario.id === 'memory-problem-writeback'
      ? selectedProblemCase.fixtureUserId
      : activeScenario.id === 'memory-source-upload-writeback'
        ? selectedSourceCase.fixtureUserId
        : activeScenario.id === 'memory-question-writeback'
          ? selectedQuestionCase.fixtureUserId
          : personaSelections[activeScenario.id] || LOCAL_MEMORY_TEST_USER_FIXTURES[0].userId;
  const selectedFixture =
    LOCAL_MEMORY_TEST_USER_FIXTURES.find((fixture) => fixture.userId === selectedFixtureUserId) ||
    LOCAL_MEMORY_TEST_USER_FIXTURES[0];

  useEffect(() => {
    try {
      const savedChecks = localStorage.getItem(CHECK_STORAGE_KEY);
      if (savedChecks) setManualChecks(JSON.parse(savedChecks) as Record<string, boolean>);
    } catch {
      // Keep the manual test UI usable when local history is malformed.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBusy('prepare_run');
    setError('');
    setSnapshot(null);
    setLastMutation(null);
    setQueryResult(null);
    setSourceResultView('memory');
    setSourceRunPhase('');
    setSourceMemoryMutation(null);
    setSourceNotebookMutation(null);
    setSourceCoverMutation(null);
    setSourceStageErrors({});
    if (activeAiTask) {
      setAiRuns((current) => current.filter((runItem) => runItem.task !== activeAiTask));
    }
    void (async () => {
      const snapshots = await ensureLocalMemoryTestUserCohort();
      if (cancelled) return;
      setCohortSnapshots(snapshots);
      if (activeScenario.id === COHORT_SCENARIO_ID) {
        const selected =
          snapshots.find((item) => item.user.id === selectedFixtureUserId) || snapshots[0] || null;
        if (selected) setSnapshot(selected);
        return;
      }

      let latestSourceResult: LocalSourceUploadLatestResult | null = null;
      if (activeScenario.id === SOURCE_UPLOAD_SCENARIO_ID) {
        const latestResults = await loadLocalSourceUploadLatestResults();
        if (cancelled) return;
        setSourceLatestResults(
          Object.fromEntries(latestResults.map((result) => [result.testCaseId, result])),
        );
        latestSourceResult =
          latestResults.find((result) => result.testCaseId === selectedSourceCaseId) || null;
      }

      let latestActivityResult: LocalMemoryActivityLatestResult | null = null;
      if (
        activeScenario.id === 'memory-problem-writeback' ||
        activeScenario.id === 'memory-question-writeback'
      ) {
        const latestResults = await loadLocalMemoryActivityLatestResults(
          activeScenario.id as LocalMemoryActivityScenarioId,
        );
        if (cancelled) return;
        setActivityLatestResults(
          Object.fromEntries(latestResults.map((result) => [result.caseId, result])),
        );
        const selectedCaseId =
          activeScenario.id === 'memory-problem-writeback'
            ? selectedProblemCaseId
            : selectedQuestionCaseId;
        latestActivityResult =
          latestResults.find((result) => result.caseId === selectedCaseId) || null;
      }

      const runSnapshot = await prepareLocalMemoryTestScenarioRun({
        scenarioId: activeScenario.id,
        fixtureUserId: selectedFixtureUserId,
      });
      try {
        if (cancelled) return;
        const latestSnapshot =
          latestSourceResult?.coverMutation?.snapshot ||
          latestSourceResult?.notebookMutation?.snapshot ||
          latestSourceResult?.memoryMutation?.snapshot ||
          latestActivityResult?.mutation?.snapshot ||
          runSnapshot;
        setSnapshot(latestSnapshot);
        if (latestActivityResult) setLastMutation(latestActivityResult.mutation);
        if (latestSourceResult) {
          setSourceMemoryMutation(latestSourceResult.memoryMutation);
          setSourceNotebookMutation(latestSourceResult.notebookMutation);
          setSourceCoverMutation(latestSourceResult.coverMutation);
          setSourceStageErrors(latestSourceResult.stageErrors);
          setSourceRunPhase(
            latestSourceResult.status === 'running'
              ? `上次运行未完成；已保留 ${completedSourceStageCount(latestSourceResult)}/3 项。`
              : latestSourceResult.phase,
          );
        }
      } finally {
        await disposeLocalMemoryTestScenarioRun(runSnapshot.user.id);
      }
    })()
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeAiTask,
    activeScenario.id,
    selectedFixtureUserId,
    selectedProblemCaseId,
    selectedQuestionCaseId,
    selectedSourceCaseId,
  ]);

  const latestAi = activeAiTask
    ? aiRuns.find((runItem) => runItem.task === activeAiTask) || null
    : null;
  async function run(label: string, operation: () => Promise<void>) {
    setBusy(label);
    setError('');
    try {
      await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  async function prepareDisposableRun() {
    return prepareLocalMemoryTestScenarioRun({
      scenarioId: activeScenario.id,
      fixtureUserId: selectedFixtureUserId,
    });
  }

  async function mutate(
    action: string,
    extra: Record<string, unknown> | ((prepared: Snapshot) => Record<string, unknown>) = {},
  ) {
    await run(action, async () => {
      const prepared = await prepareDisposableRun();
      try {
        const resolvedExtra = typeof extra === 'function' ? extra(prepared) : extra;
        const response = await runLocalMemoryTestAction({
          action,
          userId: prepared.user.id,
          ...resolvedExtra,
        });
        setSnapshot(response.snapshot);
        setLastMutation(response);
        if (
          activeScenario.id === 'memory-problem-writeback' &&
          action === 'record_problem_attempts'
        ) {
          const saved = await saveLocalMemoryActivityLatestResult({
            scenarioId: 'memory-problem-writeback',
            caseId: selectedProblemCase.id,
            fixtureUserId: selectedProblemCase.fixtureUserId,
            mutation: response,
          });
          setActivityLatestResults((current) => ({
            ...current,
            [saved.caseId]: saved,
          }));
        }
      } finally {
        await disposeLocalMemoryTestScenarioRun(prepared.user.id);
      }
    });
  }

  async function reloadScenario() {
    await run('prepare_run', async () => {
      const snapshots = await ensureLocalMemoryTestUserCohort();
      setCohortSnapshots(snapshots);
      setLastMutation(null);
      setQueryResult(null);
      if (activeScenario.id === COHORT_SCENARIO_ID) {
        const baseline =
          snapshots.find((item) => item.user.id === selectedFixtureUserId) || snapshots[0];
        if (baseline) setSnapshot(baseline);
        return;
      }
      const prepared = await prepareDisposableRun();
      try {
        setSnapshot(prepared);
      } finally {
        await disposeLocalMemoryTestScenarioRun(prepared.user.id);
      }
    });
  }

  async function runQuery() {
    await run('query', async () => {
      const prepared = await prepareDisposableRun();
      try {
        setQueryResult(await queryLocalMemoryTest(prepared.user.id, query));
        setSnapshot(prepared);
      } finally {
        await disposeLocalMemoryTestScenarioRun(prepared.user.id);
      }
    });
  }

  async function generate(task: AiTask) {
    await run(`generate:${task}`, async () => {
      const prepared = await prepareDisposableRun();
      try {
        const localContext = await buildLocalMemoryEvidence(prepared.user.id);
        const response = await backendJson<AiResponse>(AI_API, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-generation-test-no-charge': 'true',
          },
          body: JSON.stringify({
            action: 'generate',
            userId: prepared.user.id,
            task,
            context: {
              instruction: localContext.instruction,
              evidence: localContext.evidence,
            },
          }),
        });
        setAiRuns([response, ...aiRuns].slice(0, 20));
        setSnapshot(localContext.snapshot);
      } finally {
        await disposeLocalMemoryTestScenarioRun(prepared.user.id);
      }
    });
  }

  async function runQuestionWritebackCase() {
    await run('record_question_case', async () => {
      const prepared = await prepareDisposableRun();
      try {
        const baselineProfile = learnerProfileFromSnapshot(prepared);
        const modelHeaders: Record<string, string> =
          providerId === 'openai' && modelId ? { 'x-model': `openai:${modelId}` } : {};
        const diagnosisResponse = await backendJson<LocalQuestionDiagnosisResponse>(
          '/api/platform-tests/memory-local-question-diagnosis',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-generation-test-no-charge': 'true',
              ...modelHeaders,
            },
            body: JSON.stringify({
              action: 'diagnose_question',
              caseId: selectedQuestionCase.id,
              question: selectedQuestionCase.userMessage,
              source: selectedQuestionCase.sourceFilename
                ? {
                    filename: selectedQuestionCase.sourceFilename,
                    title: selectedQuestionCase.sourceTitle,
                  }
                : null,
              baseline: {
                userId: selectedFixture.userId,
                name: selectedFixture.name,
                level: baselineProfile?.levelLabel || selectedFixture.learnerProfile.levelLabel,
                summary: baselineProfile?.summary || selectedFixture.learnerProfile.summary,
                mastered: baselineProfile?.mastered || selectedFixture.learnerProfile.mastered,
                weaknesses:
                  baselineProfile?.weaknesses || selectedFixture.learnerProfile.weaknesses,
              },
            }),
          },
        );
        const response = await runLocalMemoryTestAction({
          action: 'record_question_case',
          userId: prepared.user.id,
          testCaseId: selectedQuestionCase.id,
          diagnosisResponse,
        });
        const saved = await saveLocalMemoryActivityLatestResult({
          scenarioId: 'memory-question-writeback',
          caseId: selectedQuestionCase.id,
          fixtureUserId: selectedQuestionCase.fixtureUserId,
          mutation: response,
        });
        setSnapshot(response.snapshot);
        setLastMutation(response);
        setActivityLatestResults((current) => ({
          ...current,
          [saved.caseId]: saved,
        }));
      } finally {
        await disposeLocalMemoryTestScenarioRun(prepared.user.id);
      }
    });
  }

  function toggleManualCheck(label: string, checked: boolean) {
    const key = `${activeScenario.id}:${label}`;
    const next = { ...manualChecks, [key]: checked };
    setManualChecks(next);
    localStorage.setItem(CHECK_STORAGE_KEY, JSON.stringify(next));
  }

  function toggleCaseManualCheck(caseId: string, label: string, checked: boolean) {
    const key = `${activeScenario.id}:${caseId}:${label}`;
    const next = { ...manualChecks, [key]: checked };
    setManualChecks(next);
    localStorage.setItem(CHECK_STORAGE_KEY, JSON.stringify(next));
  }

  function selectCohortUser(selectedSnapshot: Snapshot) {
    setPersonaSelections((current) => ({
      ...current,
      [activeScenario.id]: selectedSnapshot.user.id,
    }));
    setLastMutation(null);
    setQueryResult(null);
  }

  function selectProblemWritebackCase(testCase: LocalProblemWritebackCase) {
    const latestResult = activityLatestResults[testCase.id] || null;
    setSelectedProblemCaseId(testCase.id);
    setLastMutation(latestResult?.mutation || null);
    if (latestResult?.mutation) setSnapshot(latestResult.mutation.snapshot);
    setQueryResult(null);
    setError('');
  }

  function selectQuestionWritebackCase(testCase: LocalQuestionWritebackCase) {
    const latestResult = activityLatestResults[testCase.id] || null;
    setSelectedQuestionCaseId(testCase.id);
    setLastMutation(latestResult?.mutation || null);
    if (latestResult?.mutation) setSnapshot(latestResult.mutation.snapshot);
    setQueryResult(null);
    setError('');
  }

  function selectSourceUploadCase(testCase: Csc148SourceUploadCase) {
    const latestResult = sourceLatestResults[testCase.id] || null;
    setSelectedSourceCaseId(testCase.id);
    setLastMutation(null);
    setQueryResult(null);
    setSourceResultView('memory');
    setSourceRunPhase(
      latestResult?.status === 'running'
        ? `上次运行未完成；已保留 ${completedSourceStageCount(latestResult)}/3 项。`
        : latestResult?.phase || '',
    );
    setSourceMemoryMutation(latestResult?.memoryMutation || null);
    setSourceNotebookMutation(latestResult?.notebookMutation || null);
    setSourceCoverMutation(latestResult?.coverMutation || null);
    setSourceStageErrors(latestResult?.stageErrors || {});
    const latestSnapshot =
      latestResult?.coverMutation?.snapshot ||
      latestResult?.notebookMutation?.snapshot ||
      latestResult?.memoryMutation?.snapshot;
    if (latestSnapshot) setSnapshot(latestSnapshot);
    setError('');
  }

  async function runSourceUploadCase() {
    await run('record_source_upload_case', async () => {
      const prepared = await prepareDisposableRun();
      const startedAt = Date.now();
      let latestResult = createLocalSourceUploadLatestResult({
        testCaseId: selectedSourceCase.id,
        fixtureUserId: selectedSourceCase.fixtureUserId,
        runId:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${selectedSourceCase.id}-${startedAt}`,
        startedAt,
      });
      const persistLatestResult = async (
        patch: Partial<LocalSourceUploadLatestResult>,
      ): Promise<void> => {
        latestResult = { ...latestResult, ...patch, updatedAt: Date.now() };
        await saveLocalSourceUploadLatestResult(latestResult);
        setSourceLatestResults((current) => ({
          ...current,
          [latestResult.testCaseId]: latestResult,
        }));
      };
      const stageErrors: Partial<Record<SourceResultView, string>> = {};
      try {
        setLastMutation(null);
        setSourceResultView('memory');
        setSourceMemoryMutation(null);
        setSourceNotebookMutation(null);
        setSourceCoverMutation(null);
        setSourceStageErrors({});
        setSourceRunPhase('正在读取本地教师笔记本…');
        await persistLatestResult({ phase: '正在读取本地教师笔记本…' });
        const source = await backendJson<QueueSourceResponse>(
          `/api/platform-tests/memory-local-source?caseId=${encodeURIComponent(selectedSourceCase.id)}`,
          { cache: 'no-store' },
        );
        const sourceFile = new File([source.content], source.filename, { type: 'text/markdown' });
        const sourceFormData = (outputMode: 'notebook_content' | 'cover_prompt') => {
          const formData = new FormData();
          formData.append('file', sourceFile);
          formData.append('sourceTitle', source.filename);
          formData.append('sourceKind', 'markdown');
          formData.append('language', 'zh-CN');
          formData.append('usageProfile', 'university_course');
          formData.append('outputMode', outputMode);
          if (outputMode === 'cover_prompt') {
            formData.append('coverTitle', selectedSourceCase.title);
            formData.append('coverCourseLabel', `CSC148 · ${selectedSourceCase.chapter}`);
            formData.append('coverFocus', selectedSourceCase.topics.join('、'));
          }
          return formData;
        };
        const modelHeaders: Record<string, string> =
          providerId === 'openai' && modelId ? { 'x-model': `openai:${modelId}` } : {};
        const recordStageError = (stage: SourceResultView, caught: unknown) => {
          const message = caught instanceof Error ? caught.message : String(caught);
          stageErrors[stage] = message;
          setSourceStageErrors({ ...stageErrors });
          return message;
        };

        setSourceRunPhase('正在写入或合并课程记忆…');
        try {
          const memoryResponse = await runLocalMemoryTestAction({
            action: 'record_source_upload_memory_case',
            userId: prepared.user.id,
            testCaseId: selectedSourceCase.id,
          });
          setSnapshot(memoryResponse.snapshot);
          setLastMutation(memoryResponse);
          setSourceMemoryMutation(memoryResponse);
          await persistLatestResult({
            memoryMutation: memoryResponse,
            phase: '记忆更新已完成；正在生成学习笔记本…',
          });
        } catch (caught) {
          recordStageError('memory', caught);
          await persistLatestResult({
            stageErrors: { ...stageErrors },
            phase: '记忆更新失败；继续生成学习笔记本…',
          });
        }

        setSourceRunPhase('正在使用第一阶段结构化生成器创建课程学习笔记…');
        try {
          const notebookResponse = await backendJson<SourceMarkdownNotebookResponse>(
            '/api/courses/memory-local-preview/source-ingest',
            {
              method: 'POST',
              headers: modelHeaders,
              body: sourceFormData('notebook_content'),
            },
          );
          const notebookOutput: Extract<PlatformFlowOutput, { kind: 'notebook' }> = {
            kind: 'notebook',
            title: notebookResponse.preview.title || notebookResponse.preview.source.title,
            routing: notebookResponse.preview.routing,
            studyGuide: notebookResponse.preview.studyGuide,
            sections: notebookResponse.preview.sections,
            answerContract: notebookResponse.preview.answerContract,
          };
          const notebookMutation = await runLocalMemoryTestAction({
            action: 'save_source_upload_notebook',
            userId: prepared.user.id,
            testCaseId: selectedSourceCase.id,
            generatedNotebook: notebookOutput,
          });
          setSnapshot(notebookMutation.snapshot);
          setSourceNotebookMutation(notebookMutation);
          await persistLatestResult({
            notebookMutation,
            phase: '学习笔记本已完成；正在生成封面图…',
          });
        } catch (caught) {
          recordStageError('notebook', caught);
          await persistLatestResult({
            stageErrors: { ...stageErrors },
            phase: '学习笔记本生成失败；继续生成封面图…',
          });
        }

        setSourceRunPhase('正在使用第一阶段封面提示生成器分析资料…');
        try {
          const coverPromptResponse = await backendJson<SourceCoverPromptResponse>(
            '/api/courses/memory-local-preview/source-ingest',
            {
              method: 'POST',
              headers: modelHeaders,
              body: sourceFormData('cover_prompt'),
            },
          );
          const coverPreview = coverPromptResponse.preview;
          const imageConfig = imageProvidersConfig[SOURCE_COVER_IMAGE_PROVIDER_ID];
          setSourceRunPhase('正在调用第一阶段正式图片生成链路…');
          const imageResponse = await backendJson<ImageGenerationResponse>('/api/generate/image', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-image-provider': SOURCE_COVER_IMAGE_PROVIDER_ID,
              'x-image-model': SOURCE_COVER_IMAGE_MODEL_ID,
              'x-generation-test-no-charge': 'true',
              ...(imageConfig?.apiKey ? { 'x-api-key': imageConfig.apiKey } : {}),
              ...(imageConfig?.baseUrl ? { 'x-base-url': imageConfig.baseUrl } : {}),
            },
            body: JSON.stringify({
              prompt: coverPreview.prompt,
              negativePrompt:
                '密集文字、可读段落、表格、信息卡片、乱码、伪汉字、无意义文字、无关公式、写实照片、广告海报、黑色背景、logo、水印',
              width: 1024,
              height: 1448,
              style: 'minimal A4 portrait study cover background with generous whitespace',
              quality: 'medium',
              coverOverlay: coverPreview.coverSpec,
            }),
          });
          const imageUrl = imageResultUrl(imageResponse.result);
          if (!imageUrl) throw new Error('图片生成成功，但没有返回可保存的封面图。');
          const coverOutput: Extract<PlatformFlowOutput, { kind: 'image' }> = {
            kind: 'image',
            title: coverPreview.classification.topic || selectedSourceCase.title,
            summary: `${coverPreview.summary} 图片已通过第一阶段正式图片接口生成。`,
            imagePrompt: coverPreview.prompt,
            coverSpec: coverPreview.coverSpec,
            imageUrl,
            width: imageResponse.result.width || 1024,
            height: imageResponse.result.height || 1448,
            sections: coverPreview.sections.map((section) => section.title),
          };
          const coverMutation = await runLocalMemoryTestAction({
            action: 'save_source_upload_cover',
            userId: prepared.user.id,
            testCaseId: selectedSourceCase.id,
            generatedCover: coverOutput,
          });
          setSnapshot(coverMutation.snapshot);
          setSourceCoverMutation(coverMutation);
          await persistLatestResult({
            coverMutation,
            phase: '封面图已完成；正在保存最新测试结果…',
          });
        } catch (caught) {
          recordStageError('cover', caught);
          await persistLatestResult({
            stageErrors: { ...stageErrors },
            phase: '封面图生成失败；正在保存最新测试结果…',
          });
        }

        const completedCount = 3 - Object.keys(stageErrors).length;
        if (Object.keys(stageErrors).length) {
          const failureMessage = Object.entries(stageErrors)
            .map(([stage, message]) => `${stage}: ${message}`)
            .join('；');
          const phase = `${completedCount}/3 项已完成；最新结果与失败项均已保留。`;
          setSourceRunPhase(phase);
          await persistLatestResult({
            status: 'partial',
            phase,
            completedAt: Date.now(),
            runError: failureMessage,
            stageErrors: { ...stageErrors },
          });
          throw new Error(failureMessage);
        }
        const completedPhase = '3/3 项均已完成；这是该测试保留的最新结果。';
        setSourceRunPhase(completedPhase);
        await persistLatestResult({
          status: 'completed',
          phase: completedPhase,
          completedAt: Date.now(),
          runError: null,
          stageErrors: {},
        });
      } catch (caught) {
        if (latestResult.status === 'running') {
          const message = caught instanceof Error ? caught.message : String(caught);
          const phase = `${completedSourceStageCount(latestResult)}/3 项已完成；最新结果已保留。`;
          setSourceRunPhase(phase);
          await persistLatestResult({
            status: 'partial',
            phase,
            completedAt: Date.now(),
            runError: message,
            stageErrors: { ...stageErrors },
          });
        }
        throw caught;
      } finally {
        await disposeLocalMemoryTestScenarioRun(prepared.user.id);
      }
    });
  }

  async function reloadCohort() {
    await reloadScenario();
  }

  function renderCohortSelector() {
    return (
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="px-4 pb-2 pt-4">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">选择测试用户</CardTitle>
            <Badge variant="outline">4 个水平</Badge>
          </div>
          <p className="text-xs leading-5 text-slate-500">
            {activeScenario.id === COHORT_SCENARIO_ID
              ? '选择后只查看该用户的只读基线。'
              : '每次运行都会从所选人物基线创建一次性副本。'}
          </p>
        </CardHeader>
        <CardContent className="space-y-1.5 px-3 pb-3">
          {LOCAL_MEMORY_TEST_USER_FIXTURES.map((fixture) => {
            const userSnapshot = cohortSnapshots.find((item) => item.user.id === fixture.userId);
            const profile = userSnapshot ? learnerProfileFromSnapshot(userSnapshot) : null;
            const usage = userSnapshot ? usageSummaryFromSnapshot(userSnapshot) : null;
            const selected = selectedFixtureUserId === fixture.userId;
            return (
              <label
                key={fixture.userId}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${
                  selected
                    ? 'border-slate-950 bg-slate-950 text-white'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="memory-cohort-user"
                  checked={selected}
                  disabled={!userSnapshot || busy !== null}
                  onChange={() => userSnapshot && selectCohortUser(userSnapshot)}
                  className="mt-0.5 size-4"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{fixture.name}</span>
                    <span
                      className={`font-mono text-xs ${selected ? 'text-slate-300' : 'text-slate-400'}`}
                    >
                      {profile?.masteryPercent ?? '--'}%
                    </span>
                  </span>
                  <span
                    className={`mt-1 block text-xs ${selected ? 'text-slate-300' : 'text-slate-500'}`}
                  >
                    {usage?.usageLabel || fixture.usageProfile.usageLabel} ·{' '}
                    {profile?.levelLabel || fixture.learnerProfile.levelLabel}
                  </span>
                  <span
                    className={`mt-1 block font-mono text-[10px] ${selected ? 'text-slate-400' : 'text-slate-400'}`}
                  >
                    {userSnapshot?.counts.problems ?? fixture.usageProfile.problemCount} 题 /{' '}
                    {userSnapshot?.counts.attempts ?? fixture.usageProfile.attemptCount} 作答 /{' '}
                    {userSnapshot?.counts.conversations ?? fixture.usageProfile.conversationCount}{' '}
                    对话
                  </span>
                </span>
              </label>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full rounded-xl"
            onClick={reloadCohort}
            disabled={busy !== null}
          >
            {busy === 'prepare_run' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {activeScenario.id === COHORT_SCENARIO_ID
              ? '重新读取四个人物基线'
              : '从人物基线重置本测试'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  function renderCohortComparison() {
    const userSnapshot = cohortSnapshots.find((item) => item.user.id === selectedFixtureUserId);
    const profile = userSnapshot ? learnerProfileFromSnapshot(userSnapshot) : null;
    const preference = userSnapshot
      ? exactFactValue(userSnapshot, 'preference', 'explanation_style')
      : null;
    const habit = userSnapshot ? exactFactValue(userSnapshot, 'habit', 'study_session') : null;
    const usage = userSnapshot ? usageSummaryFromSnapshot(userSnapshot) : null;
    const memories = userSnapshot?.studyMemories || [];
    const privateLongTermCount = memories.filter(
      (memory) => memory.scope === 'private' && memory.kind !== 'working_state',
    ).length;
    const publicMemoryCount = memories.filter((memory) => memory.scope === 'public').length;
    const archivedMemoryCount = memories.filter((memory) => memory.status === 'archived').length;
    const recentMemories = [...memories].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
    const accuracy = userSnapshot?.counts.attempts
      ? Math.round(((usage?.passedAttempts || 0) / userSnapshot.counts.attempts) * 100)
      : 0;

    return (
      <section className="space-y-4">
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-slate-950">
              {userSnapshot?.user.name || selectedFixture.name}的只读人物基线
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              第一条测试只负责加载和查看人物，不会改变其他测试选择，也不会修改人物记忆。
            </p>
          </div>
          <Badge variant="outline" className="w-fit">
            {usage?.usageLabel || selectedFixture.usageProfile.usageLabel} ·{' '}
            {profile?.levelLabel || selectedFixture.learnerProfile.levelLabel}
          </Badge>
        </div>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-xl">
                    {userSnapshot?.user.name || selectedFixture.name}
                  </CardTitle>
                  <Badge className="bg-slate-950 hover:bg-slate-950">
                    {profile?.levelLabel || selectedFixture.learnerProfile.levelLabel}
                  </Badge>
                  <Badge variant="outline">
                    {usage?.usageLabel || selectedFixture.usageProfile.usageLabel}
                  </Badge>
                </div>
                <div className="mt-2 font-mono text-[11px] text-slate-400">
                  {selectedFixture.userId}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-3xl font-semibold text-slate-950">
                  {profile?.masteryPercent ?? '--'}%
                </div>
                <div className="text-[10px] text-slate-400">模拟掌握度</div>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500"
                style={{ width: `${profile?.masteryPercent ?? 0}%` }}
              />
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {profile?.summary || '正在读取本地用户信息。'}
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-emerald-50 p-4">
                <div className="text-xs font-semibold text-emerald-700">已掌握</div>
                <ul className="mt-2 space-y-1 text-sm leading-5 text-emerald-950">
                  {(profile?.mastered || []).map((item) => (
                    <li key={item}>· {item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl bg-rose-50 p-4">
                <div className="text-xs font-semibold text-rose-700">当前薄弱点</div>
                <ul className="mt-2 space-y-1 text-sm leading-5 text-rose-950">
                  {(profile?.weaknesses || []).map((item) => (
                    <li key={item}>· {item}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="rounded-xl bg-sky-50 p-4 text-sm leading-6 text-sky-950">
              <span className="font-semibold text-sky-700">下一教学动作：</span>
              {profile?.nextTeachingMove || '等待本地学习状态。'}
            </div>

            <div>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">平台使用历史</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    以下数字来自这个用户实际生成的本地题目、作答、对话、资料和事实记录。
                  </p>
                </div>
                <span className="text-xs text-slate-400">
                  最近活跃 {formatLocalDate(usage?.lastActiveAt)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
                <CountCard label="注册天数" value={usage?.accountAgeDays || 0} />
                <CountCard label="活跃天数" value={usage?.activeDays || 0} />
                <CountCard label="学习会话" value={usage?.studySessions || 0} />
                <CountCard label="题目" value={userSnapshot?.counts.problems || 0} />
                <CountCard label="逐次作答" value={userSnapshot?.counts.attempts || 0} />
                <CountCard label="通过率 %" value={accuracy} />
                <CountCard label="聊天" value={userSnapshot?.counts.conversations || 0} />
                <CountCard label="聊天消息" value={usage?.messageCount || 0} />
                <CountCard label="上传资料" value={userSnapshot?.counts.materials || 0} />
                <CountCard label="日历事项" value={userSnapshot?.counts.calendarEvents || 0} />
                <CountCard label="错题复习" value={usage?.reviewCount || 0} />
                <CountCard label="事实变更" value={userSnapshot?.counts.factEvents || 0} />
              </div>
            </div>

            {userSnapshot ? <SourceHistoryPreview snapshot={userSnapshot} /> : null}

            <div>
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-slate-950">从来源记录提炼出的分层记忆</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  一次作答不会机械生成一条长期记忆；系统保留原始业务记录，再把跨多次证据稳定出现的掌握、薄弱点和教学动作提炼出来。
                </p>
              </div>
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                <CountCard label="当前短期状态" value={userSnapshot?.workingMemory ? 1 : 0} />
                <CountCard label="私有长期记忆" value={privateLongTermCount} />
                <CountCard label="共有课程记忆" value={publicMemoryCount} />
                <CountCard label="精确当前事实" value={userSnapshot?.counts.activeFacts || 0} />
                <CountCard
                  label="原始来源记录"
                  value={
                    (userSnapshot?.counts.problems || 0) +
                    (userSnapshot?.counts.attempts || 0) +
                    (userSnapshot?.counts.conversations || 0) +
                    (userSnapshot?.counts.materials || 0)
                  }
                />
                <CountCard label="已归档记忆" value={archivedMemoryCount} />
              </div>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-slate-700">最近更新的 12 条记忆</h4>
                <span className="text-xs text-slate-400">共 {memories.length} 条</span>
              </div>
              <StudyMemoryList memories={recentMemories} />
              {memories.length > recentMemories.length ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-500">
                    展开全部 {memories.length} 条记忆
                  </summary>
                  <div className="mt-3">
                    <StudyMemoryList
                      memories={[...memories].sort((a, b) => b.updatedAt - a.updatedAt)}
                    />
                  </div>
                </details>
              ) : null}
            </div>
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-slate-500">
                查看全部精确事实、讲解偏好与学习习惯 JSON
              </summary>
              <div className="mt-2">
                <JsonBlock
                  value={{ facts: userSnapshot?.facts || [], preference, habit }}
                  maxHeight="max-h-80"
                />
              </div>
            </details>
          </CardContent>
        </Card>
      </section>
    );
  }

  function renderManualCriteria() {
    return (
      <Card className="rounded-2xl border-emerald-200 bg-emerald-50/40 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">本条测试的人工通过标准</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {activeScenario.passCriteria.map((label) => {
            const key = `${activeScenario.id}:${label}`;
            return (
              <label
                key={label}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm leading-6"
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={Boolean(manualChecks[key])}
                  onChange={(event) => toggleManualCheck(label, event.target.checked)}
                />
                <span>{label}</span>
              </label>
            );
          })}
          <p className="text-xs leading-5 text-emerald-700">
            勾选状态只记录人工验收，不会替代本地存储结果或机器 evidenceId 校验。
          </p>
        </CardContent>
      </Card>
    );
  }

  function renderUserSidebar() {
    const activeProfile = snapshot ? learnerProfileFromSnapshot(snapshot) : null;
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 font-semibold text-slate-950">
          <UserRound className="size-4" /> 本次测试临时用户
        </div>
        {snapshot ? (
          <div className="mt-3 space-y-3">
            <div>
              <div className="text-base font-semibold">{selectedFixture.name}</div>
              <div className="mt-1 break-all font-mono text-[11px] text-slate-500">
                基线：{selectedFixture.userId}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {activeProfile ? (
                  <Badge className="bg-slate-950 text-[10px] hover:bg-slate-950">
                    {activeProfile.levelLabel} · {activeProfile.masteryPercent}%
                  </Badge>
                ) : null}
                <Badge variant="outline" className="text-[10px] text-amber-700">
                  一次性副本 · 不回写基线
                </Badge>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
              <div className="font-mono text-[10px] text-slate-400">
                临时运行：{snapshot.user.id}
              </div>
              <div className="font-semibold text-slate-900">
                {snapshot.course.courseCode} · {snapshot.course.name}
              </div>
              <div className="mt-1">笔记本：{snapshot.notebook.name}</div>
              <div className="mt-1 break-all font-mono text-[10px]">{snapshot.course.id}</div>
              <div className="break-all font-mono text-[10px]">{snapshot.notebook.id}</div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-violet-50 px-2 py-2">
                <div className="font-mono font-semibold text-violet-800">
                  {snapshot.counts.studyMemories}
                </div>
                <div className="text-[10px] text-violet-600">记忆</div>
              </div>
              <div className="rounded-lg bg-sky-50 px-2 py-2">
                <div className="font-mono font-semibold text-sky-800">
                  {snapshot.counts.activeFacts}
                </div>
                <div className="text-[10px] text-sky-600">事实</div>
              </div>
              <div className="rounded-lg bg-emerald-50 px-2 py-2">
                <div className="font-mono font-semibold text-emerald-800">
                  {snapshot.counts.factEvents}
                </div>
                <div className="text-[10px] text-emerald-600">事件</div>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={reloadScenario}
              disabled={busy !== null}
            >
              <RefreshCw className="size-3.5" /> 从人物基线重新开始
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> 正在从人物基线准备临时副本
          </div>
        )}
      </div>
    );
  }

  function renderProblemWritebackTest() {
    const latestResult = activityLatestResults[selectedProblemCase.id] || null;
    const changedMemories = changedStudyMemories(lastMutation);
    const result = lastMutation?.result as
      | {
          testCaseId?: string;
          fixtureUserId?: string;
          reusedProblem?: boolean;
          problem?: {
            id?: string;
            title?: string;
            prompt?: string;
            questionType?: string;
          };
          attempts?: Array<{
            id?: string;
            status?: 'ungraded' | 'failed' | 'partial' | 'passed';
            score?: number;
            maxScore?: number;
            answerPreview?: string;
            selectedOptionIds?: string[];
            submissionContext?: string;
            gradingSource?: 'platform_objective' | 'platform_ai' | 'not_graded';
            gradingReliable?: boolean;
            feedback?: string;
          }>;
          diagnosisResponse?: LocalAttemptDiagnosisResponse;
          workingMemory?: unknown;
          longTermMemory?: { id?: string } | null;
          longTermChange?: 'created' | 'revised' | 'skipped';
          gradingReliable?: boolean;
        }
      | undefined;
    const writeTargetUserId = lastMutation?.after.user.id || snapshot?.user.id || '';
    const ownershipMatches = Boolean(
      lastMutation &&
      result?.fixtureUserId === selectedFixture.userId &&
      lastMutation.before.user.id === writeTargetUserId &&
      lastMutation.after.user.id === writeTargetUserId,
    );
    const expectsNoMemory = selectedProblemCase.writeMode === 'no_memory';
    const resultMemoryFound =
      result?.gradingReliable === false
        ? expectsNoMemory &&
          changedMemories.length === 0 &&
          !result?.workingMemory &&
          !result?.longTermMemory
        : result?.longTermMemory?.id
          ? lastMutation?.after.studyMemories.some(
              (memory) => memory.id === result.longTermMemory?.id,
            )
          : (selectedProblemCase.writeMode === 'working_only' &&
              changedMemories.some(({ memory }) => memory.kind === 'working_state')) ||
            (selectedProblemCase.writeMode === 'no_memory' &&
              changedMemories.length === 0 &&
              !result?.workingMemory &&
              !result?.longTermMemory);
    const expectedLongTermChange = (() => {
      if (result?.gradingReliable === false) {
        return expectsNoMemory && result.longTermChange === 'skipped';
      }
      if (selectedProblemCase.writeMode === 'create_long_term') {
        return result?.longTermChange === 'created';
      }
      if (
        selectedProblemCase.writeMode === 'revise_long_term' ||
        selectedProblemCase.writeMode === 'strengthen_long_term'
      ) {
        return result?.longTermChange === 'revised';
      }
      return result?.longTermChange === 'skipped';
    })();
    const gradingGatePassed = Boolean(
      result &&
      (result.gradingReliable !== false ||
        (changedMemories.length === 0 && !result.workingMemory && !result.longTermMemory)),
    );
    const attemptDiagnosis = result?.diagnosisResponse?.diagnosis;
    const layerRoutingPassed = Boolean(
      attemptDiagnosis &&
      attemptDiagnosis.layerRouting.sourceOfTruth === 'problem_attempt' &&
      attemptDiagnosis.layerRouting.controlFacts === 'read_only' &&
      attemptDiagnosis.layerRouting.knowledgeBase === 'read_only' &&
      attemptDiagnosis.layerRouting.knowledgeCache === 'read_only' &&
      attemptDiagnosis.layerRouting.shortTerm ===
        (attemptDiagnosis.workingMemoryAction === 'update' ? 'overwrite' : 'skip') &&
      attemptDiagnosis.layerRouting.longTerm === attemptDiagnosis.durableMemoryAction,
    );
    const diagnosisEvidencePassed = Boolean(
      attemptDiagnosis &&
      (result?.gradingReliable === false
        ? attemptDiagnosis.workingMemoryAction === 'skip' &&
          attemptDiagnosis.durableMemoryAction === 'skip'
        : attemptDiagnosis.nextTeachingMove &&
          (attemptDiagnosis.masteredSignal || attemptDiagnosis.stuckPoint)),
    );
    const allResultChecksPass =
      ownershipMatches &&
      gradingGatePassed &&
      resultMemoryFound &&
      expectedLongTermChange &&
      layerRoutingPassed &&
      diagnosisEvidencePassed;
    const visibleQuestion = result?.problem?.prompt || selectedProblemCase.questionPrompt;
    const visibleQuestionType = result?.problem?.questionType || selectedProblemCase.questionType;
    const visibleAttempts = result?.attempts?.length
      ? result.attempts.map((attempt, index) => ({
          id: attempt.id,
          status: attempt.status || 'ungraded',
          score: attempt.score,
          maxScore: attempt.maxScore || selectedProblemCase.points,
          answer:
            attempt.answerPreview ||
            (attempt.selectedOptionIds?.length
              ? `选择：${attempt.selectedOptionIds.join('、')}`
              : '[没有提交答案]'),
          selectedOptionIds: attempt.selectedOptionIds || [],
          submissionContext: attempt.submissionContext,
          gradingSource: attempt.gradingSource,
          gradingReliable: attempt.gradingReliable === true,
          feedback: attempt.feedback || '',
          previewIndex: index,
        }))
      : selectedProblemCase.attempts.map((attempt, index) => ({
          id: undefined,
          status: 'ungraded' as const,
          score: undefined,
          maxScore: selectedProblemCase.points,
          answer:
            attempt.answer ||
            (attempt.selectedOptionIds?.length
              ? `选择：${attempt.selectedOptionIds.join('、')}`
              : '[没有提交答案]'),
          selectedOptionIds: attempt.selectedOptionIds || [],
          submissionContext: attempt.submissionContext,
          gradingSource: undefined,
          gradingReliable: false,
          feedback: '运行测试后由平台判题，此处不预设正误或分数。',
          previewIndex: index,
        }));

    return (
      <section className="space-y-5">
        <CliMemoryRunEvidence latestResult={latestResult} />
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-slate-950 hover:bg-slate-950">{selectedFixture.name}</Badge>
                  <Badge variant="outline">{selectedProblemCase.relationLabel}</Badge>
                  <Badge variant="outline">{selectedProblemCase.chapter}</Badge>
                </div>
                <CardTitle className="mt-3 text-xl">{selectedProblemCase.title}</CardTitle>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {selectedProblemCase.description}
                </p>
              </div>
              <Button
                className="shrink-0 bg-slate-950 hover:bg-slate-800"
                onClick={() =>
                  mutate('record_problem_attempts', {
                    testCaseId: selectedProblemCase.id,
                    modelString:
                      providerId === 'openai' && modelId ? `openai:${modelId}` : undefined,
                  })
                }
                disabled={busy !== null}
              >
                {busy === 'record_problem_attempts' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                {busy === 'record_problem_attempts' ? '平台判题中' : '运行这个测试'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 rounded-xl bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-900 sm:flex-row sm:items-center sm:justify-between">
              <span>
                课程资料：{selectedProblemCase.sourceTitle || selectedProblemCase.chapter}
                {selectedProblemCase.sourceFilename
                  ? ` · queue/CSC148/${selectedProblemCase.sourceFilename}`
                  : ''}
              </span>
              <span className="shrink-0 font-medium">
                {latestResult
                  ? `最新保存 ${formatLatestResultTime(latestResult.updatedAt)}`
                  : '未运行'}
              </span>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{visibleQuestionType}</Badge>
                <Badge variant="outline">{selectedProblemCase.difficulty}</Badge>
                <span className="text-xs text-slate-500">{selectedProblemCase.concept}</span>
              </div>
              <div className="mt-3 text-xs font-semibold text-slate-500">用户做的题目</div>
              <div className="mt-1 font-semibold text-slate-950">
                {selectedProblemCase.problemTitle}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {visibleQuestion}
              </p>
              {selectedProblemCase.options?.length ? (
                <div className="mt-3 grid gap-2">
                  {selectedProblemCase.options.map((option) => (
                    <div
                      key={option.id}
                      className="flex gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-5 text-slate-700"
                    >
                      <span className="font-mono font-semibold text-slate-950">{option.id}</span>
                      <span>{option.text}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                满分 {selectedProblemCase.points} 分 · 运行时判题 ·{' '}
                {selectedProblemCase.options?.length ? '平台选项判题' : '平台 AI 评分'}
              </div>
              <details className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                  查看判题参考与评分 rubric（人工验收用）
                </summary>
                <div className="mt-3 space-y-3 text-xs leading-5 text-slate-600">
                  <div>
                    <div className="font-semibold text-slate-900">参考答案</div>
                    <div className="mt-1 whitespace-pre-wrap">
                      {Array.isArray(selectedProblemCase.referenceAnswer)
                        ? selectedProblemCase.referenceAnswer.join('、')
                        : selectedProblemCase.referenceAnswer}
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">评分 rubric</div>
                    <div className="mt-1 whitespace-pre-wrap">{selectedProblemCase.rubric}</div>
                  </div>
                  <div className="rounded-md bg-slate-50 px-3 py-2">
                    这里展示的是平台判题依据，不是预先写入用户提交的正误或分数。
                  </div>
                </div>
              </details>
              {result?.problem?.id ? (
                <div className="mt-2 break-all font-mono text-[10px] text-slate-400">
                  problemId: {result.problem.id}
                </div>
              ) : null}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-500">用户提交的答案</h3>
                <Badge variant="outline">{visibleAttempts.length} 次提交</Badge>
              </div>
              <div className="space-y-3">
                {visibleAttempts.map((attempt, index) => (
                  <article
                    key={attempt.id || `${selectedProblemCase.id}-${attempt.previewIndex}`}
                    className="rounded-xl border border-slate-200 bg-white p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 items-center justify-center rounded-md bg-slate-100 font-mono text-xs font-semibold text-slate-600">
                          {index + 1}
                        </span>
                        <Badge
                          className={
                            attempt.status === 'passed'
                              ? 'bg-emerald-600 hover:bg-emerald-600'
                              : attempt.status === 'partial'
                                ? 'bg-amber-500 hover:bg-amber-500'
                                : attempt.status === 'failed'
                                  ? 'bg-rose-600 hover:bg-rose-600'
                                  : 'bg-slate-500 hover:bg-slate-500'
                          }
                        >
                          {attempt.status === 'ungraded'
                            ? attempt.id
                              ? '未判题'
                              : '待平台判题'
                            : `${attempt.status} · ${attempt.score}/${attempt.maxScore}`}
                        </Badge>
                      </div>
                      {attempt.id ? (
                        <span className="font-mono text-[10px] text-slate-400">
                          attemptId: {attempt.id}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">运行后生成 attemptId</span>
                      )}
                    </div>
                    <div className="mt-3 rounded-lg bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 whitespace-pre-wrap">
                      {attempt.answer}
                    </div>
                    {attempt.selectedOptionIds.length ? (
                      <div className="mt-2 text-xs font-medium text-slate-700">
                        提交选项：{attempt.selectedOptionIds.join('、')}
                      </div>
                    ) : null}
                    {attempt.submissionContext ? (
                      <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                        {attempt.submissionContext}
                      </div>
                    ) : null}
                    <div className="mt-2 text-xs leading-5 text-slate-500">
                      {attempt.gradingSource === 'platform_ai'
                        ? 'AI 评分'
                        : attempt.gradingSource === 'platform_objective'
                          ? '选项判题'
                          : '判题状态'}
                      ：{attempt.feedback}
                    </div>
                    {attempt.id && !attempt.gradingReliable ? (
                      <div className="mt-2 text-xs font-medium text-rose-700">
                        判题结果不可信：只保留 attempt，不允许写入学习记忆。
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-sky-50 p-4">
              <div className="text-xs font-semibold text-sky-700">预期记忆变化</div>
              <p className="mt-2 text-sm leading-6 text-sky-950">
                {selectedProblemCase.expectedMemoryChange}
              </p>
            </div>
          </CardContent>
        </Card>

        {attemptDiagnosis ? (
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">从真实作答证据生成的教学诊断</CardTitle>
                <div className="flex gap-2">
                  <Badge variant="outline">{result?.diagnosisResponse?.model || '未知模型'}</Badge>
                  <Badge variant="outline">置信度 {attemptDiagnosis.confidence}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                {[
                  ['知识点', attemptDiagnosis.knowledgePoint],
                  ['掌握证据', attemptDiagnosis.masteredSignal || '本轮无足够证据'],
                  ['薄弱点', attemptDiagnosis.stuckPoint || '本轮无足够证据'],
                  ['可能原因', attemptDiagnosis.cause || '证据不足，不猜原因'],
                  ['下一教学动作', attemptDiagnosis.nextTeachingMove],
                  ['长期门槛理由', attemptDiagnosis.durableMemoryReason],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-slate-50 p-4">
                    <div className="text-[11px] font-semibold text-slate-500">{label}</div>
                    <div className="mt-2 text-sm leading-6 text-slate-800">{value}</div>
                  </div>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <Badge variant="outline">事实层：Attempt</Badge>
                <Badge variant="outline">短期：{attemptDiagnosis.layerRouting.shortTerm}</Badge>
                <Badge variant="outline">长期：{attemptDiagnosis.layerRouting.longTerm}</Badge>
                <Badge variant="outline">控制事实：只读</Badge>
                <Badge variant="outline">知识库：只读</Badge>
                <Badge variant="outline">缓存：只读</Badge>
              </div>
              {attemptDiagnosis.evidenceFromAttempt.length ? (
                <div className="rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
                  学生证据摘录：{attemptDiagnosis.evidenceFromAttempt.join('；')}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">本次实际新增或更新的记忆</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  这里只比较最新一次运行的 before / after；IndexedDB 同一用例会覆盖旧结果。
                </p>
              </div>
              {lastMutation ? (
                <Badge variant="outline">{changedMemories.length} 条变化</Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {!lastMutation ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                点击“运行这个测试”后，这里只显示真正发生变化的记忆。
              </div>
            ) : changedMemories.length ? (
              <div className="space-y-4">
                {changedMemories.map(({ change, memory }) => (
                  <div key={memory.id}>
                    <div className="mb-2 flex items-center gap-2">
                      <Badge
                        className={
                          change === '新增'
                            ? 'bg-emerald-600 hover:bg-emerald-600'
                            : 'bg-amber-500 hover:bg-amber-500'
                        }
                      >
                        {change}
                      </Badge>
                      <span className="font-mono text-[11px] text-slate-400">{memory.id}</span>
                    </div>
                    <StudyMemoryList memories={[memory]} />
                  </div>
                ))}
              </div>
            ) : expectsNoMemory ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-sm leading-6 text-emerald-900">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="size-4" /> 0 条记忆变化，符合预期
                </div>
                <p className="mt-1">
                  题目和超时 attempt
                  已保留为业务记录，但没有答案内容，系统没有猜测掌握、薄弱点或下一教学动作。
                </p>
              </div>
            ) : result?.gradingReliable === false ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm leading-6 text-amber-950">
                <div className="font-semibold">评分没有返回可信结果，已阻止记忆写入</div>
                <p className="mt-1">
                  attempt 已作为业务记录保留，但本场景预期的学习记忆没有生成；请恢复评分服务后重跑。
                </p>
              </div>
            ) : (
              <div className="rounded-xl bg-rose-50 px-4 py-5 text-sm text-rose-900">
                本次没有产生预期的记忆变化，测试不通过。
              </div>
            )}
          </CardContent>
        </Card>

        {lastMutation ? (
          <Card
            className={`rounded-2xl shadow-sm ${allResultChecksPass ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40'}`}
          >
            <CardHeader>
              <CardTitle className="text-base">写入用户归属确认</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-white p-3">
                  <div className="text-[11px] text-slate-400">模拟人物</div>
                  <div className="mt-1 font-semibold text-slate-950">{selectedFixture.name}</div>
                  <div className="mt-1 break-all font-mono text-[10px] text-slate-500">
                    基线：{selectedFixture.userId}
                  </div>
                </div>
                <div className="rounded-xl bg-white p-3">
                  <div className="text-[11px] text-slate-400">本次实际写入 userId</div>
                  <div className="mt-1 break-all font-mono text-xs text-slate-800">
                    {writeTargetUserId}
                  </div>
                  <Badge variant="outline" className="mt-2 text-[10px] text-amber-700">
                    一次性本地副本
                  </Badge>
                </div>
                <div className="rounded-xl bg-white p-3">
                  <div className="text-[11px] text-slate-400">来源记录</div>
                  <div className="mt-1 text-sm font-medium text-slate-900">
                    {result?.reusedProblem ? '复用已有 problemId' : '创建新 problemId'}
                  </div>
                  <div className="mt-1 break-all font-mono text-[10px] text-slate-500">
                    {result?.problem?.id || '—'} · {result?.attempts?.length || 0} attempts
                  </div>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <div
                  className={`flex items-center gap-2 rounded-xl border bg-white px-3 py-3 text-sm ${ownershipMatches ? 'border-emerald-200 text-emerald-900' : 'border-rose-200 text-rose-900'}`}
                >
                  {ownershipMatches ? (
                    <CheckCircle2 className="size-4 shrink-0" />
                  ) : (
                    <XCircle className="size-4 shrink-0" />
                  )}
                  before / after userId {ownershipMatches ? '一致' : '不一致'}
                </div>
                <div
                  className={`flex items-center gap-2 rounded-xl border bg-white px-3 py-3 text-sm ${gradingGatePassed ? 'border-emerald-200 text-emerald-900' : 'border-rose-200 text-rose-900'}`}
                >
                  {gradingGatePassed ? (
                    <CheckCircle2 className="size-4 shrink-0" />
                  ) : (
                    <XCircle className="size-4 shrink-0" />
                  )}
                  判题安全门：{result?.gradingReliable === false ? '已拦截' : '可信'}
                </div>
                <div
                  className={`flex items-center gap-2 rounded-xl border bg-white px-3 py-3 text-sm ${resultMemoryFound ? 'border-emerald-200 text-emerald-900' : 'border-rose-200 text-rose-900'}`}
                >
                  {resultMemoryFound ? (
                    <CheckCircle2 className="size-4 shrink-0" />
                  ) : (
                    <XCircle className="size-4 shrink-0" />
                  )}
                  记忆结果符合本场景：{resultMemoryFound ? '是' : '否'}
                </div>
                <div
                  className={`flex items-center gap-2 rounded-xl border bg-white px-3 py-3 text-sm ${expectedLongTermChange ? 'border-emerald-200 text-emerald-900' : 'border-rose-200 text-rose-900'}`}
                >
                  {expectedLongTermChange ? (
                    <CheckCircle2 className="size-4 shrink-0" />
                  ) : (
                    <XCircle className="size-4 shrink-0" />
                  )}
                  长期写入策略符合场景：{expectedLongTermChange ? '是' : '否'}
                </div>
                <div
                  className={`flex items-center gap-2 rounded-xl border bg-white px-3 py-3 text-sm ${diagnosisEvidencePassed ? 'border-emerald-200 text-emerald-900' : 'border-rose-200 text-rose-900'}`}
                >
                  {diagnosisEvidencePassed ? (
                    <CheckCircle2 className="size-4 shrink-0" />
                  ) : (
                    <XCircle className="size-4 shrink-0" />
                  )}
                  诊断来自已提交证据：{diagnosisEvidencePassed ? '是' : '否'}
                </div>
                <div
                  className={`flex items-center gap-2 rounded-xl border bg-white px-3 py-3 text-sm ${layerRoutingPassed ? 'border-emerald-200 text-emerald-900' : 'border-rose-200 text-rose-900'}`}
                >
                  {layerRoutingPassed ? (
                    <CheckCircle2 className="size-4 shrink-0" />
                  ) : (
                    <XCircle className="size-4 shrink-0" />
                  )}
                  分层路由不污染 KB/cache：{layerRoutingPassed ? '是' : '否'}
                </div>
              </div>
              <p
                className={`text-xs leading-5 ${allResultChecksPass ? 'text-emerald-800' : 'text-rose-800'}`}
              >
                测试写入发生在该人物的一次性本地副本中；读取 after
                证据后副本立即销毁，人物基线不会被污染。
              </p>
            </CardContent>
          </Card>
        ) : null}
      </section>
    );
  }

  function renderQuestionWritebackTest() {
    const latestResult = activityLatestResults[selectedQuestionCase.id] || null;
    const changedMemories = changedStudyMemories(lastMutation);
    const durableChangedMemories = changedMemories.filter(
      ({ memory }) => memory.kind !== 'working_state',
    );
    const result = lastMutation?.result as
      | {
          testCaseId?: string;
          fixtureUserId?: string;
          conversation?: {
            id?: string;
            messages?: Array<{ id?: string; role?: string; content?: string }>;
          };
          diagnosisResponse?: LocalQuestionDiagnosisResponse;
          workingMemory?: Snapshot['workingMemory'];
          durableMemory?: Snapshot['studyMemories'][number] | null;
          durableMemoryChange?: 'created' | 'revised' | 'skipped';
        }
      | undefined;
    const diagnosis = result?.diagnosisResponse?.diagnosis;
    const workingChanged = Boolean(
      lastMutation &&
      JSON.stringify(lastMutation.before.workingMemory) !==
        JSON.stringify(lastMutation.after.workingMemory),
    );
    const workingMatches =
      selectedQuestionCase.expectedWorkingMemory === 'update'
        ? Boolean(result?.workingMemory && workingChanged)
        : Boolean(lastMutation && !result?.workingMemory && !workingChanged);
    const expectedDurableChange = {
      create: 'created',
      revise: 'revised',
      skip: 'skipped',
    }[selectedQuestionCase.expectedDurableMemory];
    const durableMatches = result?.durableMemoryChange === expectedDurableChange;
    const conversationMatches = Boolean(
      lastMutation &&
      result?.conversation?.id &&
      lastMutation.after.counts.conversations === lastMutation.before.counts.conversations + 1,
    );
    const ownershipMatches = Boolean(
      lastMutation &&
      result?.fixtureUserId === selectedFixture.userId &&
      lastMutation.before.user.id === lastMutation.after.user.id,
    );
    const transcriptWasNotCopied = Boolean(
      lastMutation &&
      (!result?.durableMemory?.text ||
        !result.durableMemory.text.includes(selectedQuestionCase.userMessage.trim())),
    );
    const normalizedQuestion = selectedQuestionCase.userMessage.replace(/\s+/g, ' ').toLowerCase();
    const diagnosisEvidenceGrounded = Boolean(
      diagnosis &&
      diagnosis.evidenceFromMessage.every((excerpt) =>
        normalizedQuestion.includes(excerpt.replace(/\s+/g, ' ').toLowerCase()),
      ) &&
      (!diagnosis.masteredSignal || diagnosis.evidenceFromMessage.length > 0),
    );
    const questionLayerRoutingPassed = Boolean(
      diagnosis &&
      diagnosis.layerRouting.sourceOfTruth === 'conversation_message' &&
      diagnosis.layerRouting.controlFacts === 'read_only' &&
      diagnosis.layerRouting.shortTerm ===
        (diagnosis.workingMemoryAction === 'update' ? 'overwrite' : 'skip') &&
      diagnosis.layerRouting.longTerm === diagnosis.durableMemoryAction &&
      diagnosis.layerRouting.knowledgeBase === 'read_only' &&
      diagnosis.layerRouting.knowledgeCache === 'read_only',
    );
    const machineChecks = [
      { label: '对话与两条 Message 真实写入一次性用户', passed: conversationMatches },
      { label: '记忆只归属于当前 baseline 人物的临时副本', passed: ownershipMatches },
      {
        label: `工作记忆策略：${selectedQuestionCase.expectedWorkingMemory}`,
        passed: workingMatches,
      },
      {
        label: `长期记忆策略：${selectedQuestionCase.expectedDurableMemory}`,
        passed: durableMatches,
      },
      { label: '长期记忆没有直接复制整条用户原话', passed: transcriptWasNotCopied },
      { label: '掌握/薄弱诊断只使用学生消息中的真实片段', passed: diagnosisEvidenceGrounded },
      { label: '题库、课程资料与检索缓存保持只读', passed: questionLayerRoutingPassed },
    ];

    return (
      <section className="space-y-5">
        <CliMemoryRunEvidence latestResult={latestResult} />
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-slate-950 hover:bg-slate-950">{selectedFixture.name}</Badge>
                  <Badge variant="outline">{selectedFixture.learnerProfile.levelLabel}</Badge>
                  <Badge variant="outline">{selectedQuestionCase.relationLabel}</Badge>
                </div>
                <CardTitle className="mt-3 text-xl">{selectedQuestionCase.title}</CardTitle>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {selectedFixture.learnerProfile.summary}
                </p>
              </div>
              <Button
                className="shrink-0 bg-slate-950 hover:bg-slate-800"
                onClick={() => void runQuestionWritebackCase()}
                disabled={busy !== null}
              >
                {busy === 'record_question_case' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <MessageSquareText className="size-4" />
                )}
                {busy === 'record_question_case' ? '正在回答并诊断' : '运行这条提问测试'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs font-semibold text-slate-500">baseline 用户状态</div>
                <div className="mt-2 text-sm leading-6 text-slate-700">
                  <div>已掌握：{selectedFixture.learnerProfile.mastered.join('；')}</div>
                  <div>当前薄弱：{selectedFixture.learnerProfile.weaknesses.join('；')}</div>
                </div>
              </div>
              <div className="rounded-xl bg-sky-50 p-4">
                <div className="text-xs font-semibold text-sky-700">可用课程资料</div>
                <div className="mt-2 text-sm font-medium text-sky-950">
                  {selectedQuestionCase.sourceTitle}
                </div>
                <div className="mt-1 font-mono text-[11px] text-sky-700">
                  {selectedQuestionCase.sourceFilename || '无：测试边界与追问策略'}
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-950 p-4 text-white">
              <div className="text-xs font-semibold text-slate-400">学生实际发送的消息</div>
              <MessageResponse className="mt-3 text-sm leading-7 text-slate-100" mode="static">
                {selectedQuestionCase.userMessage}
              </MessageResponse>
            </div>

            <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-950">
              <div className="font-semibold">这条测试预期什么</div>
              <p className="mt-1">{selectedQuestionCase.expectedReason}</p>
              <p className="mt-2 text-xs text-sky-700">
                模型仍需基于学生原话自行诊断；预期策略只用于测试后比对，不会送入模型。
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>IndexedDB 每条用例只保留最新一次结果。</span>
              <span>
                {latestResult
                  ? `最新保存：${formatLatestResultTime(latestResult.updatedAt)}`
                  : '尚未运行'}
              </span>
            </div>
          </CardContent>
        </Card>

        {!lastMutation ? (
          <Card className="rounded-2xl border-dashed border-slate-300 shadow-sm">
            <CardContent className="py-12 text-center text-sm text-slate-500">
              运行后将在这里显示 AI 实际回答、诊断、记忆变化与写入归属。
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">AI 实际回答</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {result?.diagnosisResponse?.model || '未知模型'}
                    </Badge>
                    <Badge variant="outline">置信度 {diagnosis?.confidence || '—'}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <MessageResponse className="text-sm leading-7 text-slate-700" mode="static">
                  {result?.diagnosisResponse?.assistantReply || '没有收到回答。'}
                </MessageResponse>
                {result?.diagnosisResponse?.source.matchedSections.length ? (
                  <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
                    实际命中资料片段：
                    {result.diagnosisResponse.source.matchedSections.join('、')}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">模型提取的学习诊断</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    ['知识点', diagnosis?.knowledgePoint],
                    ['本轮掌握证据', diagnosis?.masteredSignal || '无足够证据'],
                    ['薄弱点', diagnosis?.stuckPoint || '无足够证据'],
                    ['原因', diagnosis?.cause || '无足够证据'],
                    ['下一教学动作', diagnosis?.nextTeachingMove],
                    ['持久化理由', diagnosis?.durableMemoryReason],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-slate-50 p-4">
                      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
                      <div className="mt-2 text-sm leading-6 text-slate-800">{value || '—'}</div>
                    </div>
                  ))}
                </div>
                {diagnosis ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    <Badge variant="outline">事实层：Conversation/Message</Badge>
                    <Badge variant="outline">短期：{diagnosis.layerRouting.shortTerm}</Badge>
                    <Badge variant="outline">长期：{diagnosis.layerRouting.longTerm}</Badge>
                    <Badge variant="outline">控制事实：只读</Badge>
                    <Badge variant="outline">知识库：只读</Badge>
                    <Badge variant="outline">缓存：只读</Badge>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <div className="grid gap-5 xl:grid-cols-2">
              <Card className="rounded-2xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">本次实际记忆变化</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">工作记忆</span>
                      <Badge variant="outline">{workingChanged ? '已更新' : '未更改'}</Badge>
                    </div>
                    {result?.workingMemory ? (
                      <div className="mt-3 whitespace-pre-wrap text-xs leading-5 text-slate-600">
                        {result.workingMemory.summary}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">长期私有记忆</span>
                      <Badge variant="outline">{result?.durableMemoryChange || 'skipped'}</Badge>
                    </div>
                    {durableChangedMemories.length ? (
                      <div className="mt-3">
                        <StudyMemoryList
                          memories={durableChangedMemories.map((item) => item.memory)}
                        />
                      </div>
                    ) : (
                      <p className="mt-3 text-xs leading-5 text-slate-500">
                        没有新增或修改长期记忆。
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">机器检查</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {machineChecks.map((check) => (
                    <div
                      key={check.label}
                      className={`flex items-start gap-2 rounded-xl border px-3 py-3 text-sm ${
                        check.passed
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                          : 'border-rose-200 bg-rose-50 text-rose-900'
                      }`}
                    >
                      {check.passed ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                      ) : (
                        <XCircle className="mt-0.5 size-4 shrink-0" />
                      )}
                      <span>{check.label}</span>
                    </div>
                  ))}
                  <div className="break-all rounded-xl bg-slate-50 px-3 py-3 font-mono text-[10px] text-slate-500">
                    conversationId: {result?.conversation?.id || '—'}
                    <br />
                    run userId: {lastMutation.after.user.id}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="rounded-2xl border-emerald-200 bg-emerald-50/40 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">本用例人工验收</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {selectedQuestionCase.manualCriteria.map((label) => {
                  const key = `${activeScenario.id}:${selectedQuestionCase.id}:${label}`;
                  return (
                    <label
                      key={label}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm leading-6"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4"
                        checked={Boolean(manualChecks[key])}
                        onChange={(event) =>
                          toggleCaseManualCheck(
                            selectedQuestionCase.id,
                            label,
                            event.target.checked,
                          )
                        }
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </CardContent>
            </Card>
          </>
        )}
      </section>
    );
  }

  function renderSourceUploadTest() {
    const changedMemories = changedStudyMemories(sourceMemoryMutation);
    const result = Object.assign(
      {},
      sourceMemoryMutation?.result as object | undefined,
      sourceNotebookMutation?.result as object | undefined,
      sourceCoverMutation?.result as object | undefined,
    ) as
      | {
          testCaseId?: string;
          fixtureUserId?: string;
          source?: {
            queuePath?: string;
            filename?: string;
            size?: number;
            modifiedAt?: number;
            material?: { id?: string; name?: string; size?: number; mimeType?: string };
          };
          memory?: {
            action?: 'created' | 'merged';
            matchedMemoryId?: string | null;
            item?: { id?: string; title?: string };
            contractKey?: string;
          };
          notebook?: {
            material?: { id?: string; name?: string; size?: number; mimeType?: string };
            filename?: string;
            content?: string;
            output?: Extract<PlatformFlowOutput, { kind: 'notebook' }>;
          };
          cover?: {
            material?: { id?: string; name?: string; size?: number; mimeType?: string };
            filename?: string;
            output?: Extract<PlatformFlowOutput, { kind: 'image' }>;
          };
        }
      | undefined;
    const expectedMemoryAction = selectedSourceCase.baselineHasContract ? 'merged' : 'created';
    const writeTargetUserId = sourceMemoryMutation?.after.user.id || snapshot?.user.id || '';
    const ownershipMatches = Boolean(
      sourceMemoryMutation &&
      result?.fixtureUserId === selectedFixture.userId &&
      sourceMemoryMutation.before.user.id === writeTargetUserId &&
      sourceMemoryMutation.after.user.id === writeTargetUserId,
    );
    const notebookMaterialIds = new Set(
      sourceNotebookMutation?.after.sources.materials.map((item) => item.id) || [],
    );
    const coverMaterialIds = new Set(
      sourceCoverMutation?.after.sources.materials.map((item) => item.id) || [],
    );
    const notebookSaved = Boolean(
      result?.notebook?.material?.id && notebookMaterialIds.has(result.notebook.material.id),
    );
    const coverSaved = Boolean(
      result?.cover?.material?.id && coverMaterialIds.has(result.cover.material.id),
    );
    const memoryActionMatches = result?.memory?.action === expectedMemoryAction;
    const memoryResultExists = Boolean(
      result?.memory?.item?.id &&
      sourceMemoryMutation?.after.studyMemories.some(
        (memory) => memory.id === result.memory?.item?.id,
      ),
    );
    const resultChecks: Record<SourceResultView, boolean> = {
      memory: ownershipMatches && memoryActionMatches && memoryResultExists,
      notebook: notebookSaved && result?.notebook?.output?.kind === 'notebook',
      cover: coverSaved && result?.cover?.output?.kind === 'image',
    };
    const selectedResultAvailable =
      sourceResultView === 'memory'
        ? Boolean(sourceMemoryMutation)
        : sourceResultView === 'notebook'
          ? Boolean(sourceNotebookMutation)
          : Boolean(sourceCoverMutation);
    const selectedStageError =
      sourceStageErrors[sourceResultView] || selectedSourceLatestResult?.runError || undefined;

    return (
      <section className="space-y-5">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-slate-950 hover:bg-slate-950">{selectedFixture.name}</Badge>
                  <Badge variant="outline">{selectedSourceCase.chapter}</Badge>
                  <Badge variant="outline">
                    {selectedSourceCase.baselineHasContract ? '已有相似契约' : '首次出现的契约'}
                  </Badge>
                </div>
                <CardTitle className="mt-3 text-xl">{selectedSourceCase.title}</CardTitle>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {selectedSourceCase.description}
                </p>
              </div>
              <Button
                className="shrink-0 bg-slate-950 hover:bg-slate-800"
                onClick={() => void runSourceUploadCase()}
                disabled={busy !== null}
              >
                {busy === 'record_source_upload_case' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileUp className="size-4" />
                )}
                {busy === 'record_source_upload_case'
                  ? '处理教师笔记本中'
                  : '运行这份文件的三项测试'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600 sm:flex-row sm:items-center sm:justify-between">
              <span>
                一次运行依次完成：记忆写入 → 第一阶段结构化笔记生成 → 第一阶段正式图片生成。
              </span>
              <span className="shrink-0 font-medium text-slate-900">
                {sourceRunPhase || '等待运行'}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">本次上传产生的三个结果</CardTitle>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  使用切换器分别验收记忆更新、结构化学习笔记本和正式生成封面。
                </p>
                {selectedSourceLatestResult ? (
                  <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <HardDrive className="size-3.5" />
                    本地仅保留该用例的最新结果 ·{' '}
                    {formatLatestResultTime(selectedSourceLatestResult.updatedAt)}
                  </div>
                ) : null}
              </div>
              <div
                role="tablist"
                aria-label="资料上传测试结果切换"
                className="grid w-full gap-1 rounded-xl border border-slate-200 bg-white p-1 lg:w-[560px] lg:grid-cols-3"
              >
                {(
                  [
                    { id: 'memory', label: '记忆更新', icon: BrainCircuit },
                    { id: 'notebook', label: '学习笔记本', icon: BookOpen },
                    { id: 'cover', label: '封面图', icon: ImageIcon },
                  ] as const
                ).map((view) => {
                  const Icon = view.icon;
                  const selected = sourceResultView === view.id;
                  return (
                    <button
                      key={view.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setSourceResultView(view.id)}
                      className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                        selected
                          ? 'bg-slate-950 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                      }`}
                    >
                      <Icon className="size-4" />
                      {view.label}
                      {resultChecks[view.id] ? (
                        <CheckCircle2 className="size-3.5 text-emerald-400" />
                      ) : sourceStageErrors[view.id] ? (
                        <XCircle className="size-3.5 text-rose-400" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-5 sm:p-6">
            {!selectedResultAvailable ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-8 text-center">
                {selectedStageError ? (
                  <XCircle className="size-9 text-rose-500" />
                ) : busy === 'record_source_upload_case' ? (
                  <Loader2 className="size-9 animate-spin text-violet-600" />
                ) : sourceResultView === 'memory' ? (
                  <BrainCircuit className="size-9 text-slate-300" />
                ) : sourceResultView === 'notebook' ? (
                  <BookOpen className="size-9 text-slate-300" />
                ) : (
                  <ImageIcon className="size-9 text-slate-300" />
                )}
                <div
                  className={`mt-4 font-semibold ${selectedStageError ? 'text-rose-900' : 'text-slate-900'}`}
                >
                  {selectedStageError
                    ? `${sourceResultView === 'memory' ? '记忆更新' : sourceResultView === 'notebook' ? '学习笔记本' : '封面图'}执行失败`
                    : busy === 'record_source_upload_case'
                      ? sourceRunPhase
                      : '运行后在这里验收结果'}
                </div>
                <p
                  className={`mt-2 max-w-lg text-sm leading-6 ${selectedStageError ? 'text-rose-700' : 'text-slate-500'}`}
                >
                  {selectedStageError || '笔记本和封面会直接复用第一阶段的生成链路与人工验收界面。'}
                </p>
              </div>
            ) : sourceResultView === 'memory' ? (
              <div role="tabpanel" className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-950">
                      本次实际新增或合并的记忆
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      只显示真正发生变化的 StudyMemory，并核对写入用户。
                    </p>
                  </div>
                  <Badge
                    className={
                      result?.memory?.action === 'merged'
                        ? 'bg-amber-500 hover:bg-amber-500'
                        : 'bg-emerald-600 hover:bg-emerald-600'
                    }
                  >
                    {result?.memory?.action === 'merged' ? '合并已有记忆' : '新增记忆'}
                  </Badge>
                </div>

                {changedMemories.length ? (
                  changedMemories.map(({ change, memory }) => (
                    <div key={memory.id}>
                      <div className="mb-2 flex items-center gap-2">
                        <Badge variant="outline">{change}</Badge>
                        <span className="break-all font-mono text-[10px] text-slate-400">
                          {memory.id}
                        </span>
                      </div>
                      <StudyMemoryList memories={[memory]} />
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-900">
                    没有检测到可核验的记忆变化。
                  </div>
                )}

                <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-600">
                    <div className="font-semibold text-slate-900">去重判断</div>
                    <div className="mt-2 font-mono">contractKey: {result?.memory?.contractKey}</div>
                    <div>
                      期望 {expectedMemoryAction} · 实际 {result?.memory?.action}
                    </div>
                  </div>
                  <div className="rounded-xl bg-violet-50 p-4">
                    <div className="text-xs font-semibold text-violet-700">
                      对学生后续体验的优化
                    </div>
                    <p className="mt-2 text-sm leading-6 text-violet-950">
                      {selectedSourceCase.futureTeachingUse}
                    </p>
                  </div>
                </div>

                <details className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-800">
                    查看写入或合并的课程规则
                  </summary>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                    {selectedSourceCase.memoryRules.map((rule) => (
                      <li key={rule} className="flex gap-2">
                        <span className="text-violet-600">•</span>
                        <span>{rule}</span>
                      </li>
                    ))}
                  </ul>
                </details>

                <div className="grid gap-2 sm:grid-cols-3">
                  {[
                    ['写入一次性 userId', ownershipMatches],
                    ['记忆新增/合并策略正确', memoryActionMatches && memoryResultExists],
                    ['人物基线未被污染', Boolean(sourceMemoryMutation)],
                  ].map(([label, passed]) => (
                    <div
                      key={String(label)}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-sm ${
                        passed
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                          : 'border-rose-200 bg-rose-50 text-rose-900'
                      }`}
                    >
                      {passed ? (
                        <CheckCircle2 className="size-4 shrink-0" />
                      ) : (
                        <XCircle className="size-4 shrink-0" />
                      )}
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            ) : sourceResultView === 'notebook' ? (
              <div role="tabpanel" className="space-y-5">
                <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="size-4" />
                    第一阶段结构化笔记生成链路 · 最新测试结果已保存到本地 IndexedDB
                  </span>
                  <span className="break-all font-mono text-[10px] text-emerald-700">
                    {result?.notebook?.filename} · {result?.notebook?.material?.id}
                  </span>
                </div>
                {result?.notebook?.output ? (
                  <PlatformFlowResultPreview output={result.notebook.output} />
                ) : (
                  <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-900">
                    没有收到第一阶段结构化笔记生成结果。
                  </div>
                )}
              </div>
            ) : (
              <div role="tabpanel" className="space-y-5">
                <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="size-4" />
                    第一阶段正式图片生成链路 · 最新测试结果已保存到本地 IndexedDB
                  </span>
                  <span className="break-all font-mono text-[10px] text-emerald-700">
                    {result?.cover?.filename} · {result?.cover?.material?.id}
                  </span>
                </div>
                {result?.cover?.output ? (
                  <PlatformFlowResultPreview output={result.cover.output} />
                ) : (
                  <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-900">
                    没有收到第一阶段正式封面图生成结果。
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    );
  }

  function renderWriteTest() {
    if (activeScenario.id === 'memory-problem-writeback') {
      return renderProblemWritebackTest();
    }
    if (activeScenario.id === 'memory-source-upload-writeback') {
      return renderSourceUploadTest();
    }
    if (activeScenario.id === 'memory-question-writeback') {
      return renderQuestionWritebackTest();
    }
    return null;
  }

  function renderStructuredFacts() {
    if (!snapshot) return null;
    return (
      <div className="space-y-5">
        <section className="grid gap-5 xl:grid-cols-2">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">个人资料、语言、讲解与学习习惯</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-slate-600">
                一次写入姓名、专业、语言、讲解顺序与 35 分钟学习习惯，随后可逐条查看和修改。
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => mutate('seed_preferences')}
                disabled={busy !== null}
              >
                <UserRoundPlus className="size-4" /> 写入模拟用户资料与偏好
              </Button>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="size-4" /> 日历作为特殊记忆
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="calendar-start">复习开始时间</Label>
                <Input
                  id="calendar-start"
                  type="datetime-local"
                  value={calendarStartsAt}
                  onChange={(event) => setCalendarStartsAt(event.target.value)}
                />
              </div>
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  mutate('upsert_calendar_roundtrip', {
                    eventId: 'recursion-review',
                    startsAt: new Date(calendarStartsAt).toISOString(),
                    durationMinutes: 35,
                  })
                }
              >
                <CalendarDays className="size-4" />
                创建并修改同一日历记忆
              </Button>
              <p className="text-xs leading-5 text-slate-500">
                一次临时运行中先创建再修改同一 event key；重跑仍从人物基线开始。
              </p>
            </CardContent>
          </Card>
        </section>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PencilLine className="size-4" /> 单条事实新增或覆盖
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-[180px_220px_1fr_auto] lg:items-end">
            <div className="space-y-2">
              <Label>namespace</Label>
              <Input
                value={factNamespace}
                onChange={(event) => setFactNamespace(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>key</Label>
              <Input value={factKey} onChange={(event) => setFactKey(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>JSON value</Label>
              <Input value={factValue} onChange={(event) => setFactValue(event.target.value)} />
            </div>
            <Button
              disabled={busy !== null}
              onClick={() => {
                try {
                  void mutate('upsert_fact', {
                    namespace: factNamespace,
                    key: factKey,
                    valueJson: JSON.parse(factValue),
                    contentType: factNamespace === 'profile' ? 'profile' : 'preference',
                  });
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : 'JSON 无效');
                }
              }}
            >
              写入 / 覆盖
            </Button>
          </CardContent>
        </Card>

        <section className="grid gap-5 xl:grid-cols-2">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">当前结构化事实</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {snapshot.facts.length ? (
                snapshot.facts.map((fact) => (
                  <article key={fact.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-mono text-sm font-semibold">
                          {fact.namespace}:{fact.key}
                        </div>
                        <div className="mt-1 break-all text-xs text-slate-500">{fact.id}</div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="删除事实"
                        onClick={() =>
                          mutate('delete_memory', (prepared) => ({
                            layer: 'structured_fact',
                            memoryId:
                              prepared.facts.find(
                                (item) =>
                                  item.namespace === fact.namespace && item.key === fact.key,
                              )?.id || '',
                          }))
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    <div className="mt-3">
                      <JsonBlock value={fact.valueJson} maxHeight="max-h-40" />
                    </div>
                  </article>
                ))
              ) : (
                <p className="text-sm text-slate-500">尚无结构化事实。</p>
              )}
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">事实事件账本</CardTitle>
            </CardHeader>
            <CardContent>
              <JsonBlock value={snapshot.factEvents} maxHeight="max-h-[520px]" />
            </CardContent>
          </Card>
        </section>
        <MutationEvidence mutation={lastMutation} />
      </div>
    );
  }

  function renderQueryTest() {
    return (
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers3 className="size-4" /> 分层记忆查询
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} />
            <Button onClick={runQuery} disabled={busy !== null}>
              {busy === 'query' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              运行查询
            </Button>
          </div>
          <p className="text-xs leading-5 text-slate-500">
            每次从当前人物基线准备查询证据；不会读取其他测试的结果，也不会访问服务端向量库或数据库。
          </p>
          {queryResult ? <JsonBlock value={queryResult} maxHeight="max-h-[620px]" /> : null}
        </CardContent>
      </Card>
    );
  }

  function renderDeleteTest() {
    if (!snapshot) return null;
    return (
      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">本次临时副本中的可删除来源</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot.sources.problems.map((source) => (
              <div key={source.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <div className="font-medium">题目 · {source.title}</div>
                <div className="mt-1 break-all text-xs text-slate-500">
                  {source.attemptCount} 次作答 · {source.id}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() =>
                    mutate('delete_source', (prepared) => ({
                      sourceType: 'problem',
                      sourceId:
                        prepared.sources.problems.find((item) => item.title === source.title)?.id ||
                        prepared.sources.problems[0]?.id ||
                        '',
                    }))
                  }
                >
                  <Trash2 className="size-4" /> 删除题目并清理记忆
                </Button>
              </div>
            ))}
            {snapshot.sources.conversations.map((source) => (
              <div key={source.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <div className="font-medium">对话 · {source.title || '无标题'}</div>
                <div className="mt-1 break-all text-xs text-slate-500">
                  {source.messageCount} 条消息 · {source.id}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() =>
                    mutate('delete_source', (prepared) => ({
                      sourceType: 'conversation',
                      sourceId:
                        prepared.sources.conversations.find((item) => item.title === source.title)
                          ?.id ||
                        prepared.sources.conversations[0]?.id ||
                        '',
                    }))
                  }
                >
                  <Trash2 className="size-4" /> 删除聊天并清理记忆
                </Button>
              </div>
            ))}
            {snapshot.sources.materials.map((source) => (
              <div key={source.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <div className="font-medium">资料 · {source.name}</div>
                <div className="mt-1 break-all text-xs text-slate-500">IndexedDB · {source.id}</div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() =>
                    mutate('delete_source', (prepared) => ({
                      sourceType: 'uploaded_material',
                      sourceId:
                        prepared.sources.materials.find((item) => item.name === source.name)?.id ||
                        prepared.sources.materials[0]?.id ||
                        '',
                    }))
                  }
                >
                  <Trash2 className="size-4" /> 删除资料并清理记忆
                </Button>
              </div>
            ))}
            {!snapshot.sources.problems.length &&
            !snapshot.sources.conversations.length &&
            !snapshot.sources.materials.length ? (
              <p className="text-sm leading-6 text-slate-500">
                临时删除测试数据尚未准备好，请点击“从人物基线重置本测试”。
              </p>
            ) : null}
          </CardContent>
        </Card>
        <div className="space-y-5">
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">删除后仍存在的记忆</CardTitle>
            </CardHeader>
            <CardContent>
              <StudyMemoryList
                memories={snapshot.studyMemories}
                onDelete={(memoryId) => {
                  const displayed = snapshot.studyMemories.find((item) => item.id === memoryId);
                  void mutate('delete_memory', (prepared) => ({
                    layer: 'study_memory',
                    memoryId:
                      prepared.studyMemories.find(
                        (item) =>
                          item.title === displayed?.title &&
                          item.kind === displayed?.kind &&
                          item.scope === displayed?.scope,
                      )?.id || '',
                  }));
                }}
              />
            </CardContent>
          </Card>
          <MutationEvidence mutation={lastMutation} />
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
            删除结果只存在于本次页面快照；临时副本已经销毁，不会影响人物基线或其他测试。
          </p>
        </div>
      </div>
    );
  }

  function renderAiTest() {
    if (!activeAiTask) return null;
    return (
      <Card className="rounded-2xl border-violet-200 bg-violet-50/40 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="size-4 text-violet-600" /> {AI_TASK_LABELS[activeAiTask]}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-slate-600">
              模型只接收下方展示的浏览器本地证据；生成接口不读取或写入数据库，只校验返回的
              evidenceId。
            </p>
            <Button onClick={() => generate(activeAiTask)} disabled={busy !== null}>
              {busy === `generate:${activeAiTask}` ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              运行本条 AI 测试
            </Button>
          </div>

          {latestAi ? (
            <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">实际送入模型的证据</h3>
                  <Badge variant={latestAi.passedMachineCheck ? 'secondary' : 'destructive'}>
                    {latestAi.passedMachineCheck ? 'evidenceId 全部有效' : '存在未知 evidenceId'}
                  </Badge>
                </div>
                {latestAi.context.evidence.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-xl border border-violet-200 bg-white p-3 text-sm"
                  >
                    <div className="break-all font-mono text-xs text-violet-700">{item.id}</div>
                    <div className="mt-1 font-semibold">{item.title}</div>
                    <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">
                      {item.content}
                    </p>
                  </article>
                ))}
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-xs font-medium text-violet-700">
                    {latestAi.task} · {latestAi.model}
                  </div>
                  <h3 className="mt-1 text-xl font-semibold">{latestAi.output.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{latestAi.output.summary}</p>
                </div>
                {latestAi.output.items.map((item) => (
                  <article
                    key={`${latestAi.task}-${item.title}`}
                    className="rounded-xl border border-violet-200 bg-white p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold">{item.title}</h4>
                      {item.difficulty ? <Badge variant="outline">{item.difficulty}</Badge> : null}
                      {item.minutes ? <Badge variant="outline">{item.minutes} 分钟</Badge> : null}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {item.content}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {item.evidenceIds.map((id) => (
                        <Badge key={id} variant="secondary" className="font-mono text-[10px]">
                          {id}
                        </Badge>
                      ))}
                    </div>
                  </article>
                ))}
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-slate-600">
                    查看适配说明、缺口与机器校验
                  </summary>
                  <div className="mt-2">
                    <JsonBlock
                      value={{
                        adaptations: latestAi.output.adaptations,
                        uncertainty: latestAi.output.uncertainty,
                        evidenceChecks: latestAi.evidenceChecks,
                        usage: latestAi.usage,
                      }}
                    />
                  </div>
                </details>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              尚未运行本条 AI 测试。本条会自行从人物基线准备所需证据，不依赖其他测试。
            </p>
          )}
        </CardContent>
      </Card>
    );
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
                <Badge className="rounded-md bg-violet-600 hover:bg-violet-600">第二阶段</Badge>
                <Badge variant="outline" className="font-mono">
                  测试 {activeTestNumber} / {MEMORY_SYSTEM_TEST_SCENARIOS.length}
                </Badge>
                <Badge variant="outline">{GROUP_LABELS[activeScenario.phaseTwoGroup]}</Badge>
                <Badge variant="outline">只读人物 · 一次性测试副本</Badge>
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                {activeScenario.title}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                {activeScenario.summary}
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

        <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-5">
            {activeScenario.id === COHORT_SCENARIO_ID ? (
              renderCohortSelector()
            ) : activeScenario.id === 'memory-problem-writeback' ? (
              <ProblemWritebackCaseSidebar
                selectedCaseId={selectedProblemCase.id}
                disabled={busy !== null}
                latestResults={activityLatestResults}
                onSelect={selectProblemWritebackCase}
              />
            ) : activeScenario.id === 'memory-question-writeback' ? (
              <QuestionWritebackCaseSidebar
                selectedCaseId={selectedQuestionCase.id}
                disabled={busy !== null}
                latestResults={activityLatestResults}
                onSelect={selectQuestionWritebackCase}
              />
            ) : activeScenario.id === 'memory-source-upload-writeback' ? (
              <SourceUploadCaseSidebar
                selectedCaseId={selectedSourceCase.id}
                disabled={busy !== null}
                latestResults={sourceLatestResults}
                onSelect={selectSourceUploadCase}
              />
            ) : (
              <>
                <CurrentTestSidebar scenario={activeScenario} />
                {renderCohortSelector()}
                {renderUserSidebar()}
              </>
            )}
          </aside>

          <div className="min-w-0 space-y-5">
            {activeScenario.id !== COHORT_SCENARIO_ID &&
            activeScenario.id !== 'memory-problem-writeback' &&
            activeScenario.id !== 'memory-question-writeback' &&
            activeScenario.id !== 'memory-source-upload-writeback' ? (
              <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm sm:px-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-slate-950 hover:bg-slate-950">测试内容</Badge>
                    <Badge variant="outline">{activeScenario.steps.length} 个小测试</Badge>
                  </div>
                  <span className="text-xs text-slate-400">左侧目录仅属于当前测试</span>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="text-xs font-semibold text-slate-500">测试前置</div>
                    <ul className="mt-2 space-y-1.5 text-sm leading-5 text-slate-700">
                      {activeScenario.setup.map((item) => (
                        <li key={item}>· {item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl bg-sky-50 p-4">
                    <div className="text-xs font-semibold text-sky-700">本条输入</div>
                    <ul className="mt-2 space-y-1.5 text-sm leading-5 text-sky-950">
                      {activeScenario.inputs.map((item) => (
                        <li key={item}>· {item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-4">
                    <div className="text-xs font-semibold text-emerald-700">预期输出</div>
                    <ul className="mt-2 space-y-1.5 text-sm leading-5 text-emerald-950">
                      {activeScenario.outputs.map((item) => (
                        <li key={item}>· {item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>
            ) : null}

            {error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
                {error}
              </div>
            ) : null}

            {activeScenario.id !== COHORT_SCENARIO_ID &&
            activeScenario.id !== 'memory-problem-writeback' &&
            activeScenario.id !== 'memory-question-writeback' &&
            activeScenario.id !== 'memory-source-upload-writeback' ? (
              <TestSteps steps={activeScenario.steps} />
            ) : null}

            {activeScenario.id === COHORT_SCENARIO_ID ? (
              <>
                {renderCohortComparison()}
                {renderManualCriteria()}
              </>
            ) : !snapshot ? (
              <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm">
                <CardContent className="flex items-start gap-3 py-5 text-sm leading-6 text-amber-900">
                  <HardDrive className="mt-1 size-4 shrink-0" />
                  <p>
                    请先在左侧创建或加载本地模拟用户。用户建立后，本条测试的本地操作区和结果证据才会显示。
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {activeScenario.id !== 'memory-problem-writeback' &&
                activeScenario.id !== 'memory-question-writeback' &&
                activeScenario.id !== 'memory-source-upload-writeback' ? (
                  <SnapshotCounts snapshot={snapshot} />
                ) : null}

                {renderWriteTest()}
                {activeScenario.id === 'memory-structured-facts-calendar'
                  ? renderStructuredFacts()
                  : null}
                {activeScenario.id === 'memory-layered-query' ? renderQueryTest() : null}
                {activeScenario.id === 'memory-source-cascade-delete' ? renderDeleteTest() : null}
                {activeScenario.phaseTwoGroup === 'ai' ? renderAiTest() : null}

                {activeScenario.id !== 'memory-problem-writeback' &&
                activeScenario.id !== 'memory-question-writeback' &&
                activeScenario.id !== 'memory-source-upload-writeback'
                  ? renderManualCriteria()
                  : null}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
