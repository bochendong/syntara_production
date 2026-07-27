'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  Database,
  History,
  MessageSquareQuote,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  loadPhaseTwoRunsFromLocalFiles,
  syncPhaseTwoRunToLocalFile,
} from '@/features/qa/test-center/memory/local-memory-run-file-sync';
import { cn } from '@/lib/utils';
import {
  STRUCTURED_MEMORY_FACT_CASES,
  buildStructuredMemoryCasePrompt,
  getExpectedStructuredMemoryState,
  type StructuredMemoryCaseResponse,
  type StructuredMemoryFactCase,
  type StructuredMemoryState,
} from './structured-memory-fact-cases';

const RESULT_STORAGE_KEY = 'syntara:qa:structured-memory-natural-language-runs:v1';
const EXTRACTION_API = '/api/platform-tests/memory-structured-facts';

type StoredRun = {
  response: StructuredMemoryCaseResponse;
  userMessage: string;
  updatedAt: number;
};

const OPERATION_STYLES: Record<
  StructuredMemoryFactCase['operation'],
  { badge: string; icon: typeof CalendarDays }
> = {
  write_calendar: { badge: 'bg-amber-50 text-amber-800 ring-amber-200', icon: CalendarDays },
  write_learning_memory: {
    badge: 'bg-violet-50 text-violet-800 ring-violet-200',
    icon: BrainCircuit,
  },
  write_preference: {
    badge: 'bg-sky-50 text-sky-800 ring-sky-200',
    icon: SlidersHorizontal,
  },
  update_calendar: { badge: 'bg-orange-50 text-orange-800 ring-orange-200', icon: History },
};

function formatDateTime(value: string, timezone: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(timestamp);
  } catch {
    return value;
  }
}

function operationLabel(operation: StructuredMemoryFactCase['operation']) {
  if (operation === 'write_calendar') return '日历 · 新建';
  if (operation === 'update_calendar') return '日历 · 覆盖';
  if (operation === 'write_learning_memory') return '学习记忆 · 新建';
  return '偏好 · 新建';
}

function StateSection({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof CalendarDays;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <Icon className="size-4 text-slate-500" />
          {title}
        </h3>
        <Badge variant="outline" className="bg-white font-mono text-[10px]">
          {count}
        </Badge>
      </div>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-3 text-xs leading-5 text-slate-500">
      {children}
    </div>
  );
}

function MemoryStatePanel({
  label,
  state,
  targetKey,
  expected,
}: {
  label: string;
  state: StructuredMemoryState;
  targetKey: string;
  expected?: boolean;
}) {
  return (
    <Card
      className={cn(
        'rounded-2xl border shadow-sm',
        expected ? 'border-emerald-200 bg-emerald-50/20' : 'border-slate-200 bg-white',
      )}
    >
      <CardHeader className="border-b border-slate-100 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {expected ? (
              <ArrowRight className="size-4 text-emerald-600" />
            ) : (
              <Clock3 className="size-4 text-slate-500" />
            )}
            {label}
          </CardTitle>
          <Badge variant="outline" className="bg-white">
            {state.user.timezone}
          </Badge>
        </div>
        <div className="mt-2 rounded-xl bg-slate-950 px-3.5 py-3 text-white">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <UserRound className="size-4" /> {state.user.displayName}
            </span>
            <span className="font-mono text-[10px] text-slate-300">{state.user.courseCode}</span>
          </div>
          <p className="mt-1.5 text-xs leading-5 text-slate-300">{state.user.profileSummary}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <StateSection icon={CalendarDays} title="日历" count={state.calendarEvents.length}>
          {state.calendarEvents.length ? (
            state.calendarEvents.map((event) => (
              <article
                key={event.id}
                className={cn(
                  'rounded-lg border bg-white px-3 py-2.5',
                  event.id === targetKey
                    ? 'border-amber-300 ring-2 ring-amber-100'
                    : 'border-slate-200',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDateTime(event.startsAt, event.timezone)} ·{' '}
                      {event.durationMinutes === 1 ? '截止' : `${event.durationMinutes} 分钟`}
                    </p>
                  </div>
                  {event.id === targetKey ? (
                    <Badge className="bg-amber-500 text-[10px] hover:bg-amber-500">目标</Badge>
                  ) : null}
                </div>
                <p className="mt-2 break-all font-mono text-[10px] text-slate-400">{event.id}</p>
              </article>
            ))
          ) : (
            <EmptyState>当前没有日历事项。</EmptyState>
          )}
        </StateSection>

        <StateSection
          icon={BrainCircuit}
          title="课程学习记忆"
          count={state.learningMemories.length}
        >
          {state.learningMemories.length ? (
            state.learningMemories.map((memory) => (
              <article
                key={memory.key}
                className={cn(
                  'rounded-lg border bg-white px-3 py-2.5',
                  memory.key === targetKey
                    ? 'border-violet-300 ring-2 ring-violet-100'
                    : 'border-slate-200',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{memory.title}</p>
                  {memory.key === targetKey ? (
                    <Badge className="bg-violet-600 text-[10px] hover:bg-violet-600">目标</Badge>
                  ) : null}
                </div>
                <div className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
                  {memory.mastery ? <p>掌握：{memory.mastery}</p> : null}
                  {memory.weakness ? <p>薄弱：{memory.weakness}</p> : null}
                  {memory.cause ? <p>原因：{memory.cause}</p> : null}
                  {memory.nextTeachingMove ? <p>下一步：{memory.nextTeachingMove}</p> : null}
                </div>
                <p className="mt-2 break-all font-mono text-[10px] text-slate-400">{memory.key}</p>
              </article>
            ))
          ) : (
            <EmptyState>当前没有课程学习记忆。</EmptyState>
          )}
        </StateSection>

        <StateSection icon={SlidersHorizontal} title="用户偏好" count={state.preferences.length}>
          {state.preferences.length ? (
            state.preferences.map((preference) => (
              <article
                key={preference.key}
                className={cn(
                  'rounded-lg border bg-white px-3 py-2.5',
                  preference.key === targetKey
                    ? 'border-sky-300 ring-2 ring-sky-100'
                    : 'border-slate-200',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{preference.label}</p>
                  {preference.key === targetKey ? (
                    <Badge className="bg-sky-600 text-[10px] hover:bg-sky-600">目标</Badge>
                  ) : null}
                </div>
                <p className="mt-1.5 text-xs leading-5 text-slate-700">{preference.value}</p>
                <p className="mt-1 text-[11px] leading-4 text-slate-400">{preference.reason}</p>
                <p className="mt-2 break-all font-mono text-[10px] text-slate-400">
                  {preference.key}
                </p>
              </article>
            ))
          ) : (
            <EmptyState>当前没有用户偏好。</EmptyState>
          )}
        </StateSection>
      </CardContent>
    </Card>
  );
}

function TestSidebar({
  selectedCaseId,
  runs,
  onSelect,
}: {
  selectedCaseId: string;
  runs: Record<string, StoredRun>;
  onSelect: (caseId: string) => void;
}) {
  return (
    <aside className="space-y-4 lg:sticky lg:top-5 lg:self-start">
      <Card className="rounded-2xl border-slate-200 bg-slate-950 text-white shadow-sm">
        <CardHeader className="border-b border-white/10 pb-4">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base text-white">8 个自然语言测试</CardTitle>
            <Badge className="bg-white/10 text-white hover:bg-white/10">2 位用户</Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-300">
            每条用例都有独立的日历、学习记忆和偏好基线。
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {[1, 2].map((userNumber) => {
            const cases = STRUCTURED_MEMORY_FACT_CASES.filter(
              (testCase) => testCase.userNumber === userNumber,
            );
            const user = cases[0]?.before.user;
            if (!user) return null;
            return (
              <section key={userNumber}>
                <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
                  <div>
                    <div className="text-xs font-semibold text-white">
                      用户 {userNumber} · {user.displayName}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400">{user.timezone}</div>
                  </div>
                  <Badge className="bg-white/10 font-mono text-[10px] text-slate-200 hover:bg-white/10">
                    4 tests
                  </Badge>
                </div>
                <div className="space-y-1.5">
                  {cases.map((testCase) => {
                    const active = testCase.id === selectedCaseId;
                    const run = runs[testCase.id];
                    const style = OPERATION_STYLES[testCase.operation];
                    const Icon = style.icon;
                    return (
                      <button
                        key={testCase.id}
                        type="button"
                        data-testid={`structured-memory-case-${testCase.id}`}
                        aria-pressed={active}
                        onClick={() => onSelect(testCase.id)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                          active
                            ? 'border-white bg-white text-slate-950 shadow-sm'
                            : 'border-transparent text-slate-300 hover:border-white/10 hover:bg-white/5 hover:text-white',
                        )}
                      >
                        <span
                          className={cn(
                            'flex size-7 shrink-0 items-center justify-center rounded-lg',
                            active ? 'bg-slate-950 text-white' : 'bg-white/10 text-slate-300',
                          )}
                        >
                          <Icon className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold leading-5">
                            {testCase.order}. {testCase.operationLabel}
                          </span>
                          <span
                            className={cn(
                              'block truncate text-[10px]',
                              active ? 'text-slate-500' : 'text-slate-500',
                            )}
                          >
                            {testCase.title}
                          </span>
                        </span>
                        {run ? (
                          run.response.passed ? (
                            <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                          ) : (
                            <XCircle className="size-4 shrink-0 text-rose-500" />
                          )
                        ) : (
                          <ChevronRight className="size-4 shrink-0 opacity-40" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </CardContent>
      </Card>
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-500 shadow-sm">
        模型只生成提案，不写真实用户数据。每条最新结果同时保存在浏览器与本机测试记录，刷新后仍可对照。
      </div>
    </aside>
  );
}

function ExtractionResult({ run }: { run: StoredRun }) {
  const { response } = run;
  const extraction = response.extraction;
  return (
    <Card
      className={cn(
        'rounded-2xl shadow-sm',
        response.passed ? 'border-emerald-200' : 'border-rose-200',
      )}
    >
      <CardHeader className="border-b border-slate-100 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              {response.passed ? (
                <CheckCircle2 className="size-5 text-emerald-600" />
              ) : (
                <XCircle className="size-5 text-rose-600" />
              )}
              <CardTitle className="text-base">
                {response.passed ? '本条自然语言提取通过' : '本条需要人工复核'}
              </CardTitle>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {response.model} · {new Date(run.updatedAt).toLocaleString('zh-CN')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{extraction.decision}</Badge>
            <Badge variant="outline">置信度 {extraction.confidence}</Badge>
            <Badge variant="outline">{response.change.mode}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl bg-violet-50 p-4">
            <div className="text-xs font-semibold text-violet-700">为什么模型认为要存</div>
            <p className="mt-2 text-sm leading-6 text-violet-950">{extraction.reasonToStore}</p>
          </div>
          <div className="rounded-xl bg-sky-50 p-4">
            <div className="text-xs font-semibold text-sky-700">用户原话证据</div>
            <p className="mt-2 text-sm leading-6 text-sky-950">“{extraction.evidenceQuote}”</p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
          <span className="font-semibold text-slate-950">规范化说明：</span>
          {extraction.normalizationNote}
        </div>
        {response.change.warning ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {response.change.warning}
          </div>
        ) : null}
        <div className="grid gap-2 md:grid-cols-5">
          {response.checks.map((check) => (
            <div
              key={check.id}
              title={check.detail}
              className={cn(
                'rounded-xl border px-3 py-3',
                check.passed
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-rose-200 bg-rose-50 text-rose-900',
              )}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                {check.passed ? (
                  <CheckCircle2 className="size-3.5" />
                ) : (
                  <XCircle className="size-3.5" />
                )}
                {check.label}
              </div>
              <p className="mt-1.5 line-clamp-3 text-[10px] leading-4 opacity-80">{check.detail}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function StructuredMemoryFactsTestWorkspace() {
  const [selectedCaseId, setSelectedCaseId] = useState(STRUCTURED_MEMORY_FACT_CASES[0].id);
  const [messages, setMessages] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      STRUCTURED_MEMORY_FACT_CASES.map((testCase) => [testCase.id, testCase.userMessage]),
    ),
  );
  const [runs, setRuns] = useState<Record<string, StoredRun>>({});
  const [storageReady, setStorageReady] = useState(false);
  const [busyCaseId, setBusyCaseId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let browserRuns: Record<string, StoredRun> = {};
      try {
        const raw = window.localStorage.getItem(RESULT_STORAGE_KEY);
        if (raw) browserRuns = JSON.parse(raw) as Record<string, StoredRun>;
      } catch {
        window.localStorage.removeItem(RESULT_STORAGE_KEY);
      }
      try {
        const fileRecords = await loadPhaseTwoRunsFromLocalFiles<StoredRun>(
          'memory-structured-facts-calendar',
        );
        for (const record of fileRecords) {
          const candidate = record.result;
          const current = browserRuns[record.caseId];
          if (candidate?.updatedAt && (!current || candidate.updatedAt > current.updatedAt)) {
            browserRuns[record.caseId] = candidate;
          }
        }
      } catch {
        // Browser-local history remains usable when the optional filesystem mirror is unavailable.
      }
      if (!cancelled) {
        setRuns(browserRuns);
        setStorageReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(runs));
  }, [runs, storageReady]);

  const activeCase = useMemo(
    () =>
      STRUCTURED_MEMORY_FACT_CASES.find((testCase) => testCase.id === selectedCaseId) ||
      STRUCTURED_MEMORY_FACT_CASES[0],
    [selectedCaseId],
  );
  const currentMessage = messages[activeCase.id] || activeCase.userMessage;
  const activeRun = runs[activeCase.id] || null;
  const runIsStale = activeRun ? activeRun.userMessage !== currentMessage : false;
  const afterState = activeRun?.response.after || getExpectedStructuredMemoryState(activeCase);
  const targetKey = activeRun?.response.change.targetKey || activeCase.expected.targetKey;
  const OperationIcon = OPERATION_STYLES[activeCase.operation].icon;

  async function runExtraction() {
    setBusyCaseId(activeCase.id);
    setError('');
    try {
      const response = await fetch(EXTRACTION_API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-generation-test-no-charge': 'true',
          'x-model': 'openai:gpt-4o-mini',
        },
        signal: AbortSignal.timeout(55_000),
        body: JSON.stringify({
          action: 'extract_structured_memory',
          caseId: activeCase.id,
          userMessage: currentMessage,
        }),
      });
      const payload = (await response.json()) as StructuredMemoryCaseResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || `测试请求失败（HTTP ${response.status}）`);
      const storedRun: StoredRun = {
        response: payload,
        userMessage: currentMessage,
        updatedAt: Date.now(),
      };
      await syncPhaseTwoRunToLocalFile({
        scenarioId: 'memory-structured-facts-calendar',
        caseId: activeCase.id,
        result: storedRun,
      });
      setRuns((current) => ({
        ...current,
        [activeCase.id]: storedRun,
      }));
    } catch (caught) {
      setError(
        caught instanceof DOMException && caught.name === 'TimeoutError'
          ? '模型在 55 秒内没有返回，已结束本次测试；可以稍后重跑，不会留下半写入状态。'
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
    } finally {
      setBusyCaseId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f6fa] text-slate-950">
      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm sm:px-7">
          <Button asChild variant="ghost" className="-ml-2 text-slate-600">
            <Link href="/test#memory-system-title">
              <ArrowLeft className="size-4" /> 返回记忆系统测试
            </Link>
          </Button>
          <div className="mt-4 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-4xl">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-violet-600 hover:bg-violet-600">第二阶段 04</Badge>
                <Badge variant="outline">2 位用户</Badge>
                <Badge variant="outline">8 个自然语言用例</Badge>
                <Badge variant="outline">before / after</Badge>
                <Badge variant="outline">浏览器 + 本地文件记录</Badge>
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
                用户记忆、偏好与日历的自然语言写入测试
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">
                用户不会替系统说“请写入某个
                namespace”。测试要验证模型能结合当前用户状态，从自然表达里判断为什么值得存、应该存哪一层，以及是在新建还是覆盖已有日历。
              </p>
            </div>
            <div className="grid shrink-0 grid-cols-4 gap-2 rounded-2xl bg-slate-950 p-3 text-center text-white">
              {['写日历', '写记忆', '写偏好', '改日历'].map((item) => (
                <div key={item} className="rounded-xl bg-white/10 px-3 py-2">
                  <div className="font-mono text-lg font-semibold">2</div>
                  <div className="mt-0.5 text-[10px] text-slate-300">{item}</div>
                </div>
              ))}
            </div>
          </div>
        </header>

        <div className="mt-5 grid gap-5 lg:grid-cols-[310px_minmax(0,1fr)]">
          <TestSidebar selectedCaseId={activeCase.id} runs={runs} onSelect={setSelectedCaseId} />

          <div className="min-w-0 space-y-5">
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100 pb-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-slate-950 font-mono hover:bg-slate-950">
                        TEST {String(activeCase.order).padStart(2, '0')}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          'border-0 ring-1',
                          OPERATION_STYLES[activeCase.operation].badge,
                        )}
                      >
                        <OperationIcon className="size-3.5" />{' '}
                        {operationLabel(activeCase.operation)}
                      </Badge>
                      <Badge variant="outline">用户 {activeCase.userNumber}</Badge>
                    </div>
                    <CardTitle className="mt-3 text-xl tracking-normal sm:text-2xl">
                      {activeCase.title}
                    </CardTitle>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{activeCase.scenario}</p>
                  </div>
                  <div className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                      <UserRound className="size-4" /> {activeCase.before.user.displayName}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-slate-500">
                      {activeCase.before.user.timezone}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-violet-700">
                    <Database className="size-4" /> 为什么这段话值得存
                  </div>
                  <p className="mt-2 text-sm leading-6 text-violet-950">{activeCase.whyStore}</p>
                </div>
                <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-sky-700">
                    <Sparkles className="size-4" /> 本轮希望模型理解什么
                  </div>
                  <p className="mt-2 text-sm leading-6 text-sky-950">{activeCase.extractionGoal}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100 pb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <MessageSquareQuote className="size-4 text-slate-500" /> 用户自然原话
                    </CardTitle>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      可以改写，但不要加入“写入记忆”“修改日历”这类产品内部指令。
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setMessages((current) => ({
                        ...current,
                        [activeCase.id]: activeCase.userMessage,
                      }))
                    }
                  >
                    <RefreshCw className="size-3.5" /> 恢复用例原话
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  aria-label="用户自然语言输入"
                  value={currentMessage}
                  onChange={(event) =>
                    setMessages((current) => ({
                      ...current,
                      [activeCase.id]: event.target.value,
                    }))
                  }
                  className="min-h-28 resize-y rounded-xl border-slate-200 bg-slate-50 px-4 py-3 text-base leading-7"
                />
                {runIsStale ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
                    当前输入已不同于上次运行；下面仍保留上次 before /
                    after，重新运行后会覆盖本用例的最新结果。
                  </div>
                ) : null}
                <details className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                    查看真正发送给提取模型的测试 prompt
                  </summary>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    prompt
                    明确说明产品为什么要存、各层职责和当前用户状态；它不会要求用户自己声明姓名或使用内部术语。
                  </p>
                  <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-4 font-mono text-[11px] leading-5 text-slate-200">
                    {buildStructuredMemoryCasePrompt(activeCase, currentMessage)}
                  </pre>
                </details>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs leading-5 text-slate-500">
                    模型生成写入提案 → 测试器应用到一次性状态副本 → 自动核对 5 项证据
                  </div>
                  <Button
                    size="lg"
                    data-testid="run-structured-memory-case"
                    className="rounded-xl bg-slate-950 px-5 hover:bg-slate-800"
                    disabled={busyCaseId !== null || !currentMessage.trim()}
                    onClick={() => void runExtraction()}
                  >
                    {busyCaseId === activeCase.id ? (
                      <CircleDashed className="size-4 animate-spin" />
                    ) : (
                      <Play className="size-4" />
                    )}
                    {busyCaseId === activeCase.id ? '正在提取…' : '运行自然语言提取'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm leading-6 text-rose-900">
                {error}
              </div>
            ) : null}

            {activeRun ? (
              <ExtractionResult run={activeRun} />
            ) : (
              <div className="flex items-start gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-4 text-sm leading-6 text-slate-600">
                <CircleDashed className="mt-1 size-4 shrink-0" />
                尚未运行这条用例。下方右侧先显示预期的“之后”，运行后会替换成模型真正提取并应用的结果。
              </div>
            )}

            <section aria-label="记忆状态前后对照" className="grid gap-5 xl:grid-cols-2">
              <MemoryStatePanel
                label="之前 · 当前用户状态"
                state={activeRun?.response.before || activeCase.before}
                targetKey={targetKey}
              />
              <MemoryStatePanel
                label={activeRun ? '之后 · 模型运行结果' : '预期之后 · 尚未运行'}
                state={afterState}
                targetKey={targetKey}
                expected
              />
            </section>

            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100 pb-4">
                <CardTitle className="text-base">本用例人工验收重点</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-3">
                {activeCase.manualCriteria.map((criterion) => (
                  <div
                    key={criterion}
                    className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm leading-5 text-slate-700"
                  >
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    {criterion}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
