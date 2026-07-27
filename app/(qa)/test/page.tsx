import Link from 'next/link';
import {
  ArrowRight,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  GitBranch,
  Lightbulb,
  ListChecks,
  MessageSquareText,
  Network,
  NotebookText,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CORE_PLATFORM_TEST_SCENARIOS,
  MEMORY_SYSTEM_TEST_SCENARIOS,
  PLATFORM_TEST_CATEGORY_LABELS,
  PLATFORM_TEST_STAGES,
  RECOMMENDED_PLATFORM_TEST_SCENARIOS,
  THIRD_PHASE_AGENT_TEST_SCENARIOS,
  type PlatformTestCategory,
  type PlatformTestScenario,
  type PlatformTestStageId,
} from '@/features/qa/test-center/registry';
import { MEMORY_TEST_RESULT_COMPATIBILITY_NOTE } from '@/features/qa/test-center/memory/result-storage-contract';

const CATEGORY_ICONS: Record<PlatformTestCategory, typeof NotebookText> = {
  notebook: NotebookText,
  calendar: CalendarDays,
  practice: ListChecks,
  teaching: MessageSquareText,
  memory: BrainCircuit,
  journey: Network,
};

const CATEGORY_STYLES: Record<PlatformTestCategory, string> = {
  notebook: 'bg-sky-50 text-sky-700 ring-sky-200',
  calendar: 'bg-amber-50 text-amber-700 ring-amber-200',
  practice: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  teaching: 'bg-violet-50 text-violet-700 ring-violet-200',
  memory: 'bg-violet-50 text-violet-700 ring-violet-200',
  journey: 'bg-amber-50 text-amber-700 ring-amber-200',
};

const PHASE_STYLES = {
  first: {
    card: 'hover:border-sky-300',
    order: 'bg-sky-600',
    category: 'bg-sky-50 text-sky-700 ring-sky-200',
    step: 'bg-sky-50 text-sky-700',
  },
  second: {
    card: 'hover:border-violet-300',
    order: 'bg-violet-600',
    category: 'bg-violet-50 text-violet-700 ring-violet-200',
    step: 'bg-violet-50 text-violet-700',
  },
  third: {
    card: 'hover:border-teal-300',
    order: 'bg-teal-600',
    category: 'bg-teal-50 text-teal-700 ring-teal-200',
    step: 'bg-teal-50 text-teal-700',
  },
  release: {
    card: 'hover:border-amber-300',
    order: 'bg-amber-600',
    category: 'bg-amber-50 text-amber-700 ring-amber-200',
    step: 'bg-amber-50 text-amber-700',
  },
} as const;

const STAGE_CARD_STYLES: Record<PlatformTestStageId, string> = {
  capability: 'border-sky-200 bg-sky-50 text-sky-950',
  'memory-system': 'border-violet-200 bg-violet-50 text-violet-950',
  'agent-integration': 'border-teal-200 bg-teal-50 text-teal-950',
  'release-regression': 'border-amber-200 bg-amber-50 text-amber-950',
};

function ScenarioCard({
  scenario,
  phase,
}: {
  scenario: PlatformTestScenario;
  phase?: keyof typeof PHASE_STYLES;
}) {
  const CategoryIcon = CATEGORY_ICONS[scenario.category];
  const phaseStyle = phase ? PHASE_STYLES[phase] : null;
  const isPlanned = scenario.executionStatus === 'planned';

  return (
    <Card
      className={`gap-0 overflow-hidden rounded-2xl border-slate-200 py-0 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${phaseStyle?.card ?? 'hover:border-slate-300'}`}
    >
      <CardHeader className="border-b border-slate-100 px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-4">
            <div
              className={`flex size-11 shrink-0 items-center justify-center rounded-xl font-mono text-sm font-semibold text-white ${phaseStyle?.order ?? 'bg-slate-950'}`}
            >
              {scenario.recommended ? '回归' : String(scenario.order).padStart(2, '0')}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={`rounded-md border-0 ring-1 ${phaseStyle?.category ?? CATEGORY_STYLES[scenario.category]}`}
                >
                  <CategoryIcon className="size-3.5" />
                  {PLATFORM_TEST_CATEGORY_LABELS[scenario.category]}
                </Badge>
                {isPlanned ? (
                  <Badge variant="outline" className="rounded-md border-dashed text-teal-700">
                    测试合同待接线
                  </Badge>
                ) : scenario.recommended ? (
                  <Badge variant="outline" className="rounded-md border-dashed text-slate-500">
                    发布前回归
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="rounded-md">
                    核心流程
                  </Badge>
                )}
              </div>
              <CardTitle className="mt-3 text-lg leading-7 tracking-normal text-slate-950">
                {scenario.title}
              </CardTitle>
              <CardDescription className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-600">
                {scenario.summary}
              </CardDescription>
            </div>
          </div>

          <Button asChild variant="outline" className="shrink-0 rounded-lg">
            <Link href={`/test/${scenario.id}`}>
              {isPlanned ? '查看测试合同' : '查看流程'}
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-5 py-4 sm:px-6">
        <ol className="grid gap-2 lg:grid-cols-4" aria-label={`${scenario.title}测试步骤`}>
          {scenario.steps.map((step, index) => (
            <li key={step.title} className="flex min-w-0 items-center gap-2 text-sm text-slate-600">
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold ${phaseStyle?.step ?? 'bg-slate-100 text-slate-600'}`}
              >
                {index + 1}
              </span>
              <span className="truncate font-medium">{step.title}</span>
              {index < scenario.steps.length - 1 ? (
                <ArrowRight className="ml-auto hidden size-3.5 shrink-0 text-slate-300 lg:block" />
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function StageMap() {
  return (
    <section aria-labelledby="stage-map-title">
      <div className="mb-4">
        <div className="text-sm font-semibold text-slate-500">阶段职责</div>
        <h2 id="stage-map-title" className="mt-1 text-2xl font-semibold tracking-tight">
          每个阶段只回答一个验收问题
        </h2>
      </div>
      <div className="grid gap-3 lg:grid-cols-4">
        {PLATFORM_TEST_STAGES.map((stage) => (
          <a
            key={stage.id}
            href={`#${stage.anchorId}`}
            className={`rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm ${STAGE_CARD_STYLES[stage.id]}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs font-semibold">0{stage.number}</span>
              <Badge variant="outline" className="border-current/20 bg-white/50">
                {stage.state === 'ready'
                  ? '已有测试'
                  : stage.state === 'next'
                    ? '下一阶段'
                    : '发布门槛'}
              </Badge>
            </div>
            <h3 className="mt-3 font-semibold">{stage.title}</h3>
            <p className="mt-2 text-sm leading-6 opacity-80">{stage.acceptanceQuestion}</p>
            <div className="mt-3 border-t border-current/10 pt-3 text-xs leading-5 opacity-70">
              负责：{stage.responsibility}
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

export default function PlatformTestsPage() {
  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-950">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-8 sm:px-6 lg:py-10">
        <header className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-8 px-6 py-8 lg:grid-cols-[1fr_320px] lg:px-9 lg:py-10">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
                <span className="flex size-7 items-center justify-center rounded-lg bg-slate-950 text-white">
                  <ShieldCheck className="size-4" />
                </span>
                Syntara 平台流程 QA
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
                先验能力，再验记忆，再验 Agent 编排
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
                阶段不再按功能名称混排。每一阶段有独立责任、完成门槛和交接产物；只有通过第三阶段的能力，才进入总
                Agent 与发布回归。
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Badge variant="secondary" className="rounded-md px-2.5 py-1">
                  <Wrench className="size-3.5" />
                  能力可独立调用
                </Badge>
                <Badge variant="secondary" className="rounded-md px-2.5 py-1">
                  <BrainCircuit className="size-3.5" />
                  记忆可解释
                </Badge>
                <Badge variant="secondary" className="rounded-md px-2.5 py-1">
                  <Network className="size-3.5" />
                  编排可追踪
                </Badge>
                <Badge variant="secondary" className="rounded-md px-2.5 py-1">
                  <CheckCircle2 className="size-3.5" />
                  发布有门槛
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 self-start">
              <div className="rounded-2xl bg-sky-600 p-5 text-white">
                <div className="font-mono text-3xl font-semibold">
                  {CORE_PLATFORM_TEST_SCENARIOS.length}
                </div>
                <div className="mt-1 text-sm text-sky-100">原子能力</div>
              </div>
              <div className="rounded-2xl bg-violet-600 p-5 text-white">
                <div className="font-mono text-3xl font-semibold">
                  {MEMORY_SYSTEM_TEST_SCENARIOS.length}
                </div>
                <div className="mt-1 text-sm text-violet-100">记忆系统</div>
              </div>
              <div className="rounded-2xl bg-teal-600 p-5 text-white">
                <div className="font-mono text-3xl font-semibold">
                  {THIRD_PHASE_AGENT_TEST_SCENARIOS.length}
                </div>
                <div className="mt-1 text-sm text-teal-100">Agent 工作包</div>
              </div>
              <div className="rounded-2xl bg-slate-950 p-5 text-white">
                <div className="flex items-center gap-2 font-semibold">
                  <Sparkles className="size-4 text-amber-300" />
                  清晰交接
                </div>
                <p className="mt-2 text-sm leading-5 text-slate-300">通过 gate 才进入下一阶段</p>
              </div>
            </div>
          </div>
        </header>

        <StageMap />

        <section aria-labelledby="phase-one-capability-title">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-sky-700">
                <ListChecks className="size-4" />
                第一阶段 · 原子业务能力
              </div>
              <h2
                id="phase-one-capability-title"
                className="mt-1 text-2xl font-semibold tracking-tight"
              >
                单个模块能否离开总 Agent 独立工作？
              </h2>
            </div>
            <p className="max-w-xl text-sm text-slate-500">
              负责 service、REST API、输入输出和产物正确性；不在这里判断 Agent 路由。
            </p>
          </div>
          <div className="grid gap-4">
            {CORE_PLATFORM_TEST_SCENARIOS.map((scenario) => (
              <ScenarioCard key={scenario.id} scenario={scenario} phase="first" />
            ))}
          </div>
        </section>

        <section aria-labelledby="phase-two-memory-title">
          <div className="mb-4 rounded-2xl border border-violet-200 bg-violet-50 px-5 py-4 sm:px-6">
            <div className="flex gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                <BrainCircuit className="size-4" />
              </span>
              <div>
                <div className="text-sm font-semibold text-violet-700">第二阶段测试范围</div>
                <h2
                  id="phase-two-memory-title"
                  className="mt-1 text-lg font-semibold text-violet-950"
                >
                  用户状态如何提取、写入、更新、查询和隔离？
                </h2>
                <p className="mt-1 text-sm leading-6 text-violet-800">
                  {MEMORY_SYSTEM_TEST_SCENARIOS.length}
                  条现有测试继续原地运行。四个人物基线保持只读；每条测试只修改一次性本地副本。
                </p>
                <p className="mt-2 text-xs leading-5 text-violet-700">
                  兼容保证：{MEMORY_TEST_RESULT_COMPATIBILITY_NOTE}
                </p>
              </div>
            </div>
          </div>
          <div className="grid gap-4">
            {MEMORY_SYSTEM_TEST_SCENARIOS.map((scenario) => (
              <ScenarioCard key={scenario.id} scenario={scenario} phase="second" />
            ))}
          </div>
        </section>

        <section aria-labelledby="phase-three-agent-title">
          <div className="mb-4 rounded-2xl border border-teal-200 bg-teal-50 px-5 py-4 sm:px-6">
            <div className="flex gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-teal-700">
                <GitBranch className="size-4" />
              </span>
              <div>
                <div className="text-sm font-semibold text-teal-700">第三阶段 · 下一阶段</div>
                <h2
                  id="phase-three-agent-title"
                  className="mt-1 text-lg font-semibold text-teal-950"
                >
                  Agent 如何安全调用第二阶段记忆？
                </h2>
                <p className="mt-1 text-sm leading-6 text-teal-800">
                  按依赖顺序拆成四个工作包：先 typed function tool，再 REST/MCP 同源，然后
                  agent-as-tool/handoff/tracing，最后做沙盒与课程隔离回归。
                </p>
                <p className="mt-2 text-xs leading-5 text-teal-700">
                  第三阶段只读取第二阶段最新结果作为 fixture；第三阶段结果使用新的 stable
                  key，互不覆盖。
                </p>
              </div>
            </div>
          </div>
          <div className="grid gap-4">
            {THIRD_PHASE_AGENT_TEST_SCENARIOS.map((scenario) => (
              <ScenarioCard key={scenario.id} scenario={scenario} phase="third" />
            ))}
          </div>
        </section>

        <section aria-labelledby="release-regression-title" className="pb-6">
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 sm:px-6">
            <div className="flex gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <Lightbulb className="size-4" />
              </span>
              <div>
                <div className="text-sm font-semibold text-amber-700">第四阶段 · 发布门槛</div>
                <h2
                  id="release-regression-title"
                  className="mt-1 text-lg font-semibold text-amber-950"
                >
                  新用户旅程、总 Agent 与真实学习闭环
                </h2>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  只有前三阶段通过的能力才进入这里；先验证零状态新用户能否走完全平台，再用真实
                  CSC148 用户任务验证总 Agent、跨模块交接、失败恢复和发布 trace。
                </p>
              </div>
            </div>
          </div>
          <div className="grid gap-4">
            {RECOMMENDED_PLATFORM_TEST_SCENARIOS.map((scenario) => (
              <ScenarioCard key={scenario.id} scenario={scenario} phase="release" />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
