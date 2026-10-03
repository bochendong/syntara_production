import type { PublicReplyProgressStep } from '@/lib/types/chat';

/**
 * User-visible "thinking chain" for the course agent.
 *
 * Every step is derived from real server work: the course inventory that was
 * loaded, each tool call with its real input and output, and (when the
 * provider exposes one) the model's own reasoning SUMMARY. Nothing here
 * invents reasoning or claims verification that did not happen.
 */

export type CourseTurnTraceMode = 'teacher' | 'student';

export type CourseTurnTraceEvent = {
  line: string;
  steps: PublicReplyProgressStep[];
  agentName?: string;
};

export type CourseTurnTraceOptions = {
  mode: CourseTurnTraceMode;
  agentName: string;
  emit: (event: CourseTurnTraceEvent) => Promise<void>;
  /** Resolve a notebook id to its display name (used for search scope labels). */
  resolveNotebookName?: (notebookId: string) => string | undefined;
  /** Minimum gap between non-structural emissions (reasoning deltas). Default 250ms. */
  throttleMs?: number;
  now?: () => number;
};

export type CourseTurnPreparedInfo = {
  notebookCount: number;
  totalNotebookCount?: number;
  studentCount?: number;
  hardRuleCount: number;
  problemCount?: number;
  /** Up to 3 names are shown as evidence chips. */
  notebookNames?: string[];
};

export type CourseTurnToolResult = {
  success: boolean;
  output?: unknown;
  error?: unknown;
  /** Needed only when toolStarted was never called (e.g. provider-executed web_search). */
  toolName?: string;
  input?: unknown;
};

export type CourseTurnTrace = {
  /** Optional: show an active "reading course" step before the inventory loads. */
  preparing(): Promise<void>;
  prepared(info: CourseTurnPreparedInfo): Promise<void>;
  contextCompacting(description: string): Promise<void>;
  contextCompacted(description: string, evidence?: string[]): Promise<void>;
  toolStarted(toolCallId: string, toolName: string, input: unknown): Promise<void>;
  toolFinished(toolCallId: string, result: CourseTurnToolResult): Promise<void>;
  /** Append reasoning-summary text (deltas or whole parts). Pass partId to separate parts. */
  reasoning(summaryText: string, partId?: string): Promise<void>;
  composing(): Promise<void>;
  answering(): Promise<void>;
  finished(args: { answered: boolean; deliverable?: string }): Promise<void>;
  failed(message: string): Promise<void>;
  /** Force out any throttled emission. */
  flush(): Promise<void>;
  /** Current steps (copy). */
  snapshot(): PublicReplyProgressStep[];
  /** One-line summary, e.g. "查了题库和 2 本笔记本 · 用时 6s". */
  summaryLine(): string;
};

const REASONING_MAX_CHARS = 400;
const EVIDENCE_MAX = 3;

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {};
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clip(text: string, max: number): string {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length <= max ? value : `${value.slice(0, Math.max(1, max - 1)).trim()}…`;
}

function quote(text: string, max = 40): string {
  return `“${clip(text, max)}”`;
}

/** Mask a person name: keep the first character only ("张三丰" -> "张**"). */
export function maskPersonName(name: string): string {
  const value = name.trim();
  if (!value) return '';
  const chars = Array.from(value);
  if (chars.length === 1) return value;
  return `${chars[0]}${'*'.repeat(Math.min(chars.length - 1, 2))}`;
}

function maskQuery(query: string): string {
  const value = query.trim();
  if (!value) return '';
  if (/^\d{4}$/.test(value)) return `尾号 ${value}`;
  if (value.includes('@')) return `${value.slice(0, 1)}***@${value.split('@')[1] || ''}`;
  if (/^[a-z0-9_-]{16,}$/i.test(value)) return '指定学生';
  return maskPersonName(value);
}

function errorReason(error: unknown): string {
  if (error instanceof Error && error.message) return clip(error.message, 80);
  if (typeof error === 'string' && error.trim()) return clip(error, 80);
  const message = str(rec(error).message);
  return message ? clip(message, 80) : '工具返回错误';
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${seconds % 60 ? `${seconds % 60}s` : ''}`;
}

const TIME_SCOPE_LABEL: Record<string, string> = {
  week: '近一周',
  month: '近一个月',
  term: '本学期',
  all: '全部时间',
};

const FOCUS_LABEL: Record<string, string> = {
  questions: '提问',
  status: '学习状态',
  weakness: '薄弱点',
  all: '提问与作答',
};

/** Short noun used in the one-line summary ("查了题库和 2 本笔记本"). */
type SourceKind =
  | 'notebook'
  | 'problem_bank'
  | 'calendar'
  | 'learning'
  | 'history'
  | 'context'
  | 'web'
  | 'file'
  | 'other';

type ToolDescriptor = {
  label: string;
  description?: string;
  evidence?: string[];
  source: SourceKind;
};

type ToolOutcome = {
  description?: string;
  evidence?: string[];
  /** Short line for the header while this is the latest activity. */
  line: string;
  /** Whether the tool returned usable data (drives honest compose wording). */
  hasData: boolean;
  /** Notebook names touched, for the summary ("2 本笔记本"). */
  notebooks?: string[];
};

function describeToolStart(
  toolName: string,
  input: unknown,
  resolveNotebookName?: (id: string) => string | undefined,
): ToolDescriptor {
  const values = rec(input);
  switch (toolName) {
    case 'list_course_notebooks':
      return { label: '查看笔记本目录', description: '列出本课程的全部笔记本', source: 'notebook' };
    case 'search_course_notebooks': {
      const query = str(values.query);
      const full = values.detail === 'full';
      const notebookId = str(values.notebookId);
      const notebookName = notebookId ? resolveNotebookName?.(notebookId) : undefined;
      const sectionCount = arr(values.sectionIds).length;
      const scope = notebookName
        ? `《${clip(notebookName, 24)}》`
        : notebookId
          ? '指定笔记本'
          : '全部笔记本';
      const parts = [
        query ? quote(query) : '',
        sectionCount ? `${scope} · ${sectionCount} 个章节` : scope,
      ].filter(Boolean);
      return {
        label: full ? '阅读笔记本正文' : '检索笔记本',
        description: parts.join(' · '),
        source: 'notebook',
      };
    }
    case 'search_course_problem_bank': {
      const query = str(values.query);
      const count = num(values.requestedCount) ?? 5;
      return {
        label: '检索题库',
        description: [query ? quote(query) : '', `需要 ${count} 道`].filter(Boolean).join(' · '),
        source: 'problem_bank',
      };
    }
    case 'list_problem_chapters':
      return { label: '查看题库章节', description: '列出题库的章节目录', source: 'problem_bank' };
    case 'list_calendar_events': {
      const start = str(values.start);
      const end = str(values.end);
      return {
        label: '读取学习日历',
        description: start && end ? `${start} 至 ${end}` : start || end || undefined,
        source: 'calendar',
      };
    }
    case 'propose_calendar_change': {
      const operation = str(values.operation);
      const op = operation === 'create' ? '新增' : operation === 'update' ? '修改' : '删除';
      const summary = str(values.summary) || str(values.title) || str(rec(values.event).title);
      return {
        label: `准备日历${op}草案`,
        description: summary ? clip(summary, 60) : undefined,
        source: 'calendar',
      };
    }
    case 'get_my_learning_context': {
      const focus = FOCUS_LABEL[str(values.focus) || 'all'] || '学习记录';
      const time = TIME_SCOPE_LABEL[str(values.timeScope) || 'week'] || '';
      return {
        label: '读取我的学习记录',
        description: [time, focus].filter(Boolean).join(' · '),
        source: 'learning',
      };
    }
    case 'get_course_learning_insight': {
      const scope = str(values.scope) || 'class';
      const time = TIME_SCOPE_LABEL[str(values.timeScope) || 'week'] || '';
      if (scope === 'student') {
        const who = maskQuery(str(values.studentQuery));
        return {
          label: '查看学生学习情况',
          description: [who ? `学生：${who}` : '', time].filter(Boolean).join(' · '),
          source: 'learning',
        };
      }
      if (scope === 'problem') {
        const problem = str(values.problemQuery);
        return {
          label: '分析题目作答情况',
          description: [problem ? quote(problem) : '', time].filter(Boolean).join(' · '),
          source: 'learning',
        };
      }
      return {
        label: '汇总班级学习动态',
        description: [time, '匿名汇总'].filter(Boolean).join(' · '),
        source: 'learning',
      };
    }
    case 'recall_conversation': {
      const query = str(values.query);
      return {
        label: '回看历史对话',
        description: query ? quote(query) : values.conversationId ? '读取指定对话' : '最近的对话',
        source: 'history',
      };
    }
    case 'read_selected_context':
      return { label: '读取选中内容', description: '按选中的编号读取课程数据', source: 'context' };
    case 'web_search': {
      const query = str(rec(values.action).query) || str(values.query);
      return { label: '联网搜索', description: query ? quote(query) : undefined, source: 'web' };
    }
    case 'create_document':
    case 'write_long_document': {
      const title = str(values.title) || str(values.fileName) || str(values.name);
      return {
        label: toolName === 'write_long_document' ? '撰写长文档' : '生成文档',
        description: title ? `《${clip(title, 40)}》` : undefined,
        source: 'file',
      };
    }
    case 'generate_image': {
      const prompt = str(values.prompt) || str(values.description);
      return {
        label: '生成图片',
        description: prompt ? clip(prompt, 60) : undefined,
        source: 'file',
      };
    }
    default:
      return { label: '调用工具', description: toolName, source: 'other' };
  }
}

function fileNamesFrom(output: Rec): string[] {
  const names: string[] = [];
  const push = (value: unknown) => {
    const item = rec(value);
    const name =
      str(item.fileName) || str(item.filename) || str(item.name) || str(item.title) || str(value);
    if (name && !names.includes(name)) names.push(clip(name, 40));
  };
  for (const key of ['files', 'documents', 'images', 'assets', 'attachments']) {
    for (const item of arr(output[key])) push(item);
  }
  for (const key of ['file', 'document', 'image', 'asset']) {
    if (output[key]) push(output[key]);
  }
  if (!names.length) {
    const own =
      str(output.fileName) || str(output.filename) || str(output.title) || str(output.name);
    if (own) names.push(clip(own, 40));
  }
  return names;
}

function describeToolOutcome(
  toolName: string,
  input: unknown,
  rawOutput: unknown,
  label: string,
): ToolOutcome {
  const output = rec(rawOutput);
  const values = rec(input);
  switch (toolName) {
    case 'list_course_notebooks': {
      const notebooks = arr(output.notebooks)
        .map((item) => str(rec(item).name))
        .filter(Boolean);
      const count = num(output.notebookCount) ?? notebooks.length;
      return {
        description: `共 ${count} 本笔记本`,
        evidence: notebooks.slice(0, EVIDENCE_MAX).map((name) => clip(name, 30)),
        line: `笔记本目录：${count} 本`,
        hasData: count > 0,
      };
    }
    case 'search_course_notebooks': {
      const matches = arr(output.matches).map(rec);
      const count = num(output.matchCount) ?? matches.length;
      const notebooks = Array.from(
        new Set(matches.map((match) => str(match.notebookName)).filter(Boolean)),
      );
      const evidence = matches
        .map((match) => {
          const notebook = str(match.notebookName);
          const section = str(match.sectionTitle);
          return notebook && section
            ? `${clip(notebook, 18)} · ${clip(section, 24)}`
            : clip(section || notebook, 40);
        })
        .filter(Boolean)
        .slice(0, EVIDENCE_MAX);
      return {
        description: count
          ? `找到 ${count} 个相关章节${notebooks.length > 1 ? `，来自 ${notebooks.length} 本笔记本` : ''}`
          : '没有找到相关章节',
        evidence,
        line: count ? `笔记本中找到 ${count} 个相关章节` : '笔记本中没有找到相关章节',
        hasData: count > 0,
        notebooks,
      };
    }
    case 'search_course_problem_bank': {
      const matches = arr(output.matches).map(rec);
      const excluded = arr(output.excluded).length;
      const gaps = arr(output.gaps).map(str).filter(Boolean);
      const evidence = matches
        .map((match) => {
          const meta = rec(match.metadata);
          const title = clip(str(match.title), 28);
          const chapter =
            str(meta.chapterTitle) ||
            str(meta.chapter) ||
            str(meta.chapterName) ||
            str(match.notebookName);
          return title ? (chapter ? `${title}（${clip(chapter, 16)}）` : title) : '';
        })
        .filter(Boolean)
        .slice(0, EVIDENCE_MAX);
      const description = matches.length
        ? `找到 ${matches.length} 道匹配题${excluded ? `，排除 ${excluded} 道不相符` : ''}`
        : gaps[0]
          ? `没有严格匹配的题目：${clip(gaps[0], 60)}`
          : '没有严格匹配的题目';
      return {
        description,
        evidence,
        line: matches.length ? `题库找到 ${matches.length} 道题` : '题库没有严格匹配的题目',
        hasData: matches.length > 0,
      };
    }
    case 'list_problem_chapters': {
      const list = arr(output.chapters).length
        ? arr(output.chapters)
        : arr(output.items).length
          ? arr(output.items)
          : arr(rawOutput);
      const names = list
        .map((item) => str(rec(item).title) || str(rec(item).name) || str(item))
        .filter(Boolean);
      const total = num(output.problemCount) ?? num(output.totalProblemCount);
      return {
        description: `${list.length} 个章节${total != null ? ` · 共 ${total} 道题` : ''}`,
        evidence: names.slice(0, EVIDENCE_MAX).map((name) => clip(name, 24)),
        line: `题库共 ${list.length} 个章节`,
        hasData: list.length > 0,
      };
    }
    case 'list_calendar_events': {
      const events = arr(output.events).map(rec);
      const start = str(values.start);
      const end = str(values.end);
      const range = start && end ? `${start} 至 ${end}` : '';
      return {
        description: [
          range,
          events.length
            ? `${events.length} 个日程${output.truncated ? '（仅列出部分）' : ''}`
            : '没有日程',
        ]
          .filter(Boolean)
          .join(' · '),
        evidence: events
          .map((event) =>
            [str(event.date).slice(5), clip(str(event.title), 20)].filter(Boolean).join(' '),
          )
          .filter(Boolean)
          .slice(0, EVIDENCE_MAX),
        line: events.length ? `日历中有 ${events.length} 个日程` : '这段时间没有日程',
        hasData: true,
      };
    }
    case 'propose_calendar_change':
      return {
        description: '草案已生成，等待确认，尚未写入日历',
        line: '日历草案已生成，等待确认',
        hasData: true,
      };
    case 'get_my_learning_context': {
      const summary = rec(output.summary);
      const questions = num(summary.questionCount);
      const attempts = num(summary.attemptCount);
      if (!rawOutput || (questions == null && attempts == null)) {
        return { description: '暂无学习记录', line: '暂无学习记录', hasData: false };
      }
      const weak = arr(output.weakTags)
        .map((tag) => str(rec(tag).tag))
        .filter(Boolean)
        .slice(0, 2)
        .map((tag) => `薄弱：${clip(tag, 16)}`);
      return {
        description: `${questions ?? 0} 次提问 · ${attempts ?? 0} 次作答`,
        evidence: [
          ...(num(summary.passedCount) != null ? [`通过 ${summary.passedCount} 次`] : []),
          ...weak,
        ].slice(0, EVIDENCE_MAX),
        line: `读到 ${questions ?? 0} 次提问、${attempts ?? 0} 次作答`,
        hasData: (questions ?? 0) + (attempts ?? 0) > 0,
      };
    }
    case 'get_course_learning_insight': {
      if (output.found === false) {
        const candidates = arr(output.candidates).length;
        const reason = str(output.reason);
        return {
          description: clip(reason || '没有找到匹配对象', 80),
          evidence: candidates ? [`${candidates} 个候选`] : undefined,
          line: candidates > 1 ? '匹配到多个对象，需要进一步确认' : '没有找到匹配对象',
          hasData: false,
        };
      }
      const scope = str(values.scope) || 'class';
      if (scope === 'student' || output.student) {
        const student = rec(output.student);
        const stats = rec(output.statistics);
        const analytics = rec(rec(output.analytics).summary);
        const name = maskPersonName(str(student.name)) || '该学生';
        const submissions = num(stats.submissionCount) ?? num(analytics.attemptCount);
        const passRate = num(stats.passRate);
        return {
          description: [
            `已定位 ${name}`,
            submissions != null ? `${submissions} 次提交` : '',
            passRate != null
              ? `通过率 ${Math.round(passRate <= 1 ? passRate * 100 : passRate)}%`
              : '',
          ]
            .filter(Boolean)
            .join(' · '),
          evidence: [
            name,
            ...(num(analytics.questionCount) != null ? [`${analytics.questionCount} 次提问`] : []),
            ...(num(stats.timingSampleCount) != null
              ? [`${stats.timingSampleCount} 个计时样本`]
              : []),
          ].slice(0, EVIDENCE_MAX),
          line: `已读取 ${name} 的学习记录`,
          hasData: true,
        };
      }
      if (scope === 'problem' || output.problem) {
        const problem = rec(output.problem);
        const title = str(problem.title) || str(problem.problemTitle) || '这道题';
        const attempts = num(rec(output.sample).attemptCount) ?? num(problem.attemptCount);
        const affected = arr(output.affectedStudents).length;
        return {
          description: [
            clip(title, 30),
            attempts != null ? `${attempts} 次作答` : '',
            affected ? `${affected} 位学生未通过` : '',
          ]
            .filter(Boolean)
            .join(' · '),
          evidence: [clip(title, 30)],
          line: `已分析 ${clip(title, 20)} 的作答情况`,
          hasData: true,
        };
      }
      const enrolled = num(output.enrolledStudentCount);
      const active = num(output.activeStudentCount);
      const questions = num(output.questionCount) ?? 0;
      const attempts = num(output.attemptCount) ?? 0;
      return {
        description: [
          enrolled != null ? `${active ?? 0}/${enrolled} 位学生活跃` : '',
          `${questions} 次提问`,
          `${attempts} 次作答`,
        ]
          .filter(Boolean)
          .join(' · '),
        line: `班级近期 ${questions} 次提问、${attempts} 次作答`,
        hasData: questions + attempts > 0,
      };
    }
    case 'recall_conversation': {
      if (Array.isArray(rawOutput)) {
        const titles = rawOutput.map((row) => str(rec(row).title)).filter(Boolean);
        return {
          description: rawOutput.length
            ? `找到 ${rawOutput.length} 段相关对话`
            : '没有找到相关对话',
          evidence: titles.slice(0, EVIDENCE_MAX).map((title) => clip(title, 24)),
          line: rawOutput.length ? `找到 ${rawOutput.length} 段历史对话` : '没有找到相关历史对话',
          hasData: rawOutput.length > 0,
        };
      }
      if (output.found === false) {
        return { description: '没有找到这段对话', line: '没有找到这段对话', hasData: false };
      }
      const title = str(rec(output.conversation).title) || '历史对话';
      const messages = arr(output.messages).length;
      return {
        description: `《${clip(title, 30)}》 · ${messages} 条消息`,
        evidence: [clip(title, 24)],
        line: `已回看《${clip(title, 20)}》`,
        hasData: messages > 0,
      };
    }
    case 'read_selected_context': {
      const evidenceItems = arr(output.evidence).map(rec);
      const gaps = arr(output.gaps).map(str).filter(Boolean);
      if (!rawOutput || !evidenceItems.length) {
        return {
          description: gaps[0] ? clip(gaps[0], 60) : '没有可读取的内容',
          line: '选中内容没有可读取的数据',
          hasData: false,
        };
      }
      return {
        description: `读取 ${evidenceItems.length} 项${gaps.length ? ` · ${gaps.length} 项缺失` : ''}`,
        evidence: evidenceItems
          .map((item) => clip(str(item.title), 24))
          .filter(Boolean)
          .slice(0, EVIDENCE_MAX),
        line: `已读取 ${evidenceItems.length} 项选中内容`,
        hasData: true,
      };
    }
    case 'web_search': {
      const action = rec(output.action);
      const query = str(action.query);
      const sources = arr(output.sources).map(rec);
      const hosts = Array.from(
        new Set(
          sources
            .map((source) => (str(source.url) ? hostOf(str(source.url)) : str(source.name)))
            .filter(Boolean),
        ),
      );
      const what =
        str(action.type) === 'openPage'
          ? `打开 ${hostOf(str(action.url)) || '网页'}`
          : query
            ? quote(query)
            : '';
      return {
        description:
          [what, sources.length ? `${sources.length} 个来源` : ''].filter(Boolean).join(' · ') ||
          undefined,
        evidence: hosts.slice(0, EVIDENCE_MAX),
        line: sources.length ? `联网搜索返回 ${sources.length} 个来源` : '联网搜索完成',
        hasData: true,
      };
    }
    case 'create_document':
    case 'write_long_document':
    case 'generate_image': {
      const names = fileNamesFrom(output);
      const noun = toolName === 'generate_image' ? '图片' : '文档';
      return {
        description: names.length ? `已生成 ${names.length} 个${noun}` : `${noun}已生成`,
        evidence: names.slice(0, EVIDENCE_MAX),
        line: names.length ? `已生成${noun}：${names[0]}` : `${noun}已生成`,
        hasData: true,
      };
    }
    default:
      return { description: '工具已返回结果', line: `${label}完成`, hasData: rawOutput != null };
  }
}

const SOURCE_NOUN: Record<SourceKind, string> = {
  notebook: '笔记本',
  problem_bank: '题库',
  calendar: '日历',
  learning: '学习记录',
  history: '历史对话',
  context: '选中内容',
  web: '网络来源',
  file: '生成文件',
  other: '其他工具',
};

type ToolRecord = {
  stepId: string;
  toolName: string;
  input: unknown;
  source: SourceKind;
  label: string;
  finished: boolean;
  success: boolean;
  hasData: boolean;
  notebooks: string[];
};

export function createCourseTurnTrace(options: CourseTurnTraceOptions): CourseTurnTrace {
  const now = options.now ?? Date.now;
  const throttleMs = options.throttleMs ?? 250;
  const startedAt = now();
  const isStudent = options.mode === 'student';
  const steps: PublicReplyProgressStep[] = [];
  const tools = new Map<string, ToolRecord>();
  const toolOrder: ToolRecord[] = [];
  let line = '';
  let reasoningText = '';
  let reasoningPartId: string | undefined;
  let lastEmitAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let closed = false;
  let toolSeq = 0;

  const find = (id: string) => steps.find((step) => step.id === id);

  const upsert = (step: PublicReplyProgressStep, position?: 'beforeTail') => {
    const index = steps.findIndex((item) => item.id === step.id);
    if (index >= 0) {
      steps[index] = { ...steps[index], ...step };
      return steps[index];
    }
    if (position === 'beforeTail') {
      // Keep compose/answer steps last so new tool/reasoning steps appear before them.
      const tailIndex = steps.findIndex(
        (item) => item.kind === 'compose' || item.kind === 'answer',
      );
      if (tailIndex >= 0) {
        steps.splice(tailIndex, 0, step);
        return step;
      }
    }
    steps.push(step);
    return step;
  };

  const complete = (step: PublicReplyProgressStep | undefined, at = now()) => {
    if (!step || step.status !== 'active') return;
    step.status = 'complete';
    step.endedAt ??= at;
  };

  const settleReasoning = () => complete(find('reasoning'));

  const doEmit = () => {
    lastEmitAt = now();
    const event: CourseTurnTraceEvent = {
      line,
      steps: steps.map((step) => ({
        ...step,
        evidence: step.evidence ? [...step.evidence] : undefined,
      })),
      agentName: options.agentName,
    };
    chain = chain
      .then(() => options.emit(event))
      .catch(() => {
        /* progress emission must never break the turn */
      });
    return chain;
  };

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    return doEmit();
  };

  /** Structural changes go out immediately; incremental text is throttled. */
  const schedule = (structural: boolean): Promise<void> => {
    if (structural) return flush();
    if (timer) return chain;
    const wait = throttleMs - (now() - lastEmitAt);
    if (wait <= 0) return flush();
    timer = setTimeout(() => {
      timer = null;
      void doEmit();
    }, wait);
    return chain;
  };

  const sourcesSummary = () => {
    const finished = toolOrder.filter((tool) => tool.finished && tool.success);
    const notebookNames = new Set(finished.flatMap((tool) => tool.notebooks));
    const nouns: string[] = [];
    const seen = new Set<SourceKind>();
    for (const tool of finished) {
      if (seen.has(tool.source)) continue;
      seen.add(tool.source);
      nouns.push(
        tool.source === 'notebook' && notebookNames.size > 0
          ? `${notebookNames.size} 本笔记本`
          : SOURCE_NOUN[tool.source],
      );
    }
    return nouns;
  };

  const joinNouns = (nouns: string[]) =>
    nouns.length <= 1
      ? nouns.join('')
      : `${nouns.slice(0, -1).join('、')}和${nouns[nouns.length - 1]}`;

  const summaryLine = () => {
    const nouns = sourcesSummary();
    const failedCount = toolOrder.filter((tool) => tool.finished && !tool.success).length;
    return [
      nouns.length ? `查了${joinNouns(nouns.slice(0, 3))}` : toolOrder.length ? '' : '未调用工具',
      failedCount ? `${failedCount} 个工具失败` : '',
      `用时 ${formatDuration(now() - startedAt)}`,
    ]
      .filter(Boolean)
      .join(' · ');
  };

  const toolStarted = async (toolCallId: string, toolName: string, input: unknown) => {
    if (closed || tools.has(toolCallId)) return;
    const at = now();
    settleReasoning();
    // The model went back to tools: a compose step shown earlier was premature.
    const composeIndex = steps.findIndex(
      (step) => step.kind === 'compose' && step.status === 'active',
    );
    if (composeIndex >= 0) steps.splice(composeIndex, 1);
    const descriptor = describeToolStart(toolName, input, options.resolveNotebookName);
    const stepId = `tool-${++toolSeq}`;
    const record: ToolRecord = {
      stepId,
      toolName,
      input,
      source: descriptor.source,
      label: descriptor.label,
      finished: false,
      success: false,
      hasData: false,
      notebooks: [],
    };
    tools.set(toolCallId, record);
    toolOrder.push(record);
    upsert(
      {
        id: stepId,
        kind: 'tool',
        label: descriptor.label,
        description: descriptor.description,
        evidence: descriptor.evidence,
        status: 'active',
        startedAt: at,
      },
      'beforeTail',
    );
    line = `正在${descriptor.label}${descriptor.description ? `：${descriptor.description}` : ''}`;
    await schedule(true);
  };

  const toolFinished = async (toolCallId: string, result: CourseTurnToolResult) => {
    if (closed) return;
    if (!tools.has(toolCallId)) {
      await toolStarted(toolCallId, result.toolName || 'unknown', result.input);
    }
    const record = tools.get(toolCallId);
    if (!record || record.finished) return;
    const step = find(record.stepId);
    const at = now();
    record.finished = true;
    record.success = result.success;
    if (!step) return;
    step.status = 'complete';
    step.endedAt = at;
    if (!result.success) {
      const reason = errorReason(result.error);
      step.failed = true;
      step.description = [step.description, `失败：${reason}`].filter(Boolean).join(' · ');
      line = `${record.label}失败：${reason}`;
      await schedule(true);
      return;
    }
    const outcome = describeToolOutcome(record.toolName, record.input, result.output, record.label);
    record.hasData = outcome.hasData;
    record.notebooks = outcome.notebooks ?? [];
    if (outcome.description) {
      step.description =
        step.description && record.toolName !== 'web_search'
          ? `${step.description} → ${outcome.description}`
          : outcome.description;
    }
    if (outcome.evidence?.length) step.evidence = outcome.evidence.slice(0, EVIDENCE_MAX);
    line = outcome.line;
    await schedule(true);
  };

  return {
    async preparing() {
      upsert({
        id: 'prepare',
        kind: 'prepare',
        label: '读取课程资料',
        description: isStudent ? '按学习进度读取已开放的笔记本' : '读取笔记本、学生与课程规则',
        status: 'active',
        startedAt: now(),
      });
      line = '正在读取课程资料';
      await schedule(true);
    },

    async prepared(info) {
      const at = now();
      const notebooks =
        isStudent &&
        info.totalNotebookCount != null &&
        info.totalNotebookCount !== info.notebookCount
          ? `已开放 ${info.notebookCount}/${info.totalNotebookCount} 本笔记本`
          : `${info.notebookCount} 本笔记本`;
      const parts = [
        notebooks,
        info.hardRuleCount ? `${info.hardRuleCount} 条课程规则` : '',
        !isStudent && info.studentCount != null ? `${info.studentCount} 位学生` : '',
        info.problemCount != null ? `${info.problemCount} 道题` : '',
      ].filter(Boolean);
      upsert({
        id: 'prepare',
        kind: 'prepare',
        label: `读取课程：${parts.join(' · ')}`,
        description: isStudent ? '已确认选课权限，只读取当前进度开放的内容' : '已确认教师权限',
        evidence: info.notebookNames
          ?.filter(Boolean)
          .slice(0, EVIDENCE_MAX)
          .map((name) => clip(name, 24)),
        status: 'complete',
        startedAt: find('prepare')?.startedAt ?? startedAt,
        endedAt: at,
      });
      line = `已读取课程：${parts.join('、')}`;
      await schedule(true);
    },

    async contextCompacting(description) {
      upsert(
        {
          id: 'context',
          kind: 'prepare',
          label: '整理较早对话',
          description: clip(description, 120),
          status: 'active',
          startedAt: now(),
        },
        'beforeTail',
      );
      line = '对话较长，正在整理较早内容';
      await schedule(true);
    },

    async contextCompacted(description, evidence) {
      upsert(
        {
          id: 'context',
          kind: 'prepare',
          label: '整理较早对话',
          description: clip(description, 120),
          evidence: evidence?.slice(0, EVIDENCE_MAX),
          status: 'complete',
          startedAt: find('context')?.startedAt ?? now(),
          endedAt: now(),
        },
        'beforeTail',
      );
      line = '较早对话已整理';
      await schedule(true);
    },

    toolStarted,
    toolFinished,

    async reasoning(summaryText, partId) {
      if (closed || !summaryText) return;
      const existing = find('reasoning');
      const separator =
        reasoningText && partId !== undefined && partId !== reasoningPartId ? '\n' : '';
      reasoningPartId = partId ?? reasoningPartId;
      reasoningText += separator + summaryText;
      const cleaned = reasoningText
        .replace(/\*\*/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .trim();
      if (!cleaned) return;
      const display =
        cleaned.length > REASONING_MAX_CHARS
          ? `…${cleaned.slice(cleaned.length - REASONING_MAX_CHARS + 1)}`
          : cleaned;
      const latestLine = cleaned.split('\n').pop() || cleaned;
      const structural = !existing || existing.status !== 'active';
      upsert(
        {
          id: 'reasoning',
          kind: 'reasoning',
          label: '思路',
          description: display,
          status: 'active',
          startedAt: existing?.startedAt ?? now(),
          endedAt: undefined,
        },
        'beforeTail',
      );
      line = `思考中：${clip(latestLine, 48)}`;
      await schedule(structural);
    },

    async composing() {
      if (closed) return;
      settleReasoning();
      const nouns = sourcesSummary();
      const anyData = toolOrder.some((tool) => tool.success && tool.hasData);
      const description = anyData
        ? `依据${joinNouns(nouns.slice(0, 3))}的结果组织回答`
        : toolOrder.length
          ? '工具没有返回可用资料，按课程规则说明情况'
          : '依据对话与课程规则组织回答';
      upsert({
        id: 'compose',
        kind: 'compose',
        label: '组织回复',
        description,
        status: 'active',
        startedAt: find('compose')?.startedAt ?? now(),
      });
      line = '正在组织回复';
      await schedule(true);
    },

    async answering() {
      if (closed || find('answer')?.status === 'active') return;
      const at = now();
      settleReasoning();
      complete(find('compose'), at);
      for (const step of steps) if (step.kind === 'tool') complete(step, at);
      upsert({
        id: 'answer',
        kind: 'answer',
        label: '输出回复',
        status: 'active',
        startedAt: find('answer')?.startedAt ?? at,
      });
      line = '正在输出回复';
      await schedule(true);
    },

    async finished({ answered, deliverable }) {
      if (closed) return;
      const at = now();
      for (const step of steps) complete(step, at);
      if (answered) {
        upsert({
          id: 'answer',
          kind: 'answer',
          label: '输出回复',
          status: 'complete',
          startedAt: find('answer')?.startedAt ?? at,
          endedAt: at,
        });
      } else if (deliverable) {
        upsert({
          id: 'answer',
          kind: 'answer',
          label: deliverable,
          status: 'complete',
          startedAt: at,
          endedAt: at,
        });
      } else {
        upsert({
          id: 'answer',
          kind: 'answer',
          label: '没有生成文字回复',
          description: '模型结束时没有输出文字，可以换个说法重试',
          status: 'complete',
          failed: true,
          startedAt: at,
          endedAt: at,
        });
      }
      line = summaryLine();
      closed = true;
      await flush();
    },

    async failed(message) {
      if (closed) return;
      const at = now();
      const reason = clip(message || '未知错误', 100);
      for (const step of steps) {
        if (step.status !== 'active') continue;
        step.status = 'complete';
        step.failed = true;
        step.endedAt = at;
      }
      upsert({
        id: 'answer',
        kind: 'answer',
        label: '回复中断',
        description: reason,
        status: 'complete',
        failed: true,
        startedAt: find('answer')?.startedAt ?? at,
        endedAt: at,
      });
      line = `回复失败：${reason}`;
      closed = true;
      await flush();
    },

    flush: () => flush(),

    snapshot: () => steps.map((step) => ({ ...step })),

    summaryLine,
  };
}

/**
 * Provider options that ask OpenAI reasoning models for a user-safe reasoning
 * SUMMARY. Only the Responses API streams summaries; on Chat Completions the
 * key is ignored (stripped by the provider's options schema).
 *
 * `@ai-sdk/openai@3` only treats o1/o3/o4-mini/gpt-5* (not gpt-5-chat) as
 * reasoning models; gpt-6* needs `forceReasoning: true`, otherwise the summary
 * option is dropped with an "unsupported" warning.
 */
export function reasoningProviderOptions(
  modelId: string | undefined,
  extra?: { reasoningEffort?: string; providerId?: string },
): { openai: Record<string, string | boolean> } | undefined {
  if (extra?.providerId && extra.providerId !== 'openai') return undefined;
  const raw = (modelId || '').trim();
  const id = (raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw).toLowerCase();
  if (!id) return undefined;
  const isGpt6 = id.startsWith('gpt-6');
  const isReasoning =
    isGpt6 || (id.startsWith('gpt-5') && !id.startsWith('gpt-5-chat')) || /^o\d/.test(id);
  if (!isReasoning) return undefined;
  return {
    openai: {
      reasoningSummary: 'auto',
      ...(isGpt6 ? { forceReasoning: true } : {}),
      ...(extra?.reasoningEffort ? { reasoningEffort: extra.reasoningEffort } : {}),
    },
  };
}
