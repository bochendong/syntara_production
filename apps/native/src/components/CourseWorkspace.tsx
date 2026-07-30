import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowLeft,
  BookOpen,
  BookOpenCheck,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleGauge,
  CloudUpload,
  Cpu,
  Database,
  Dices,
  FileText,
  Library,
  Loader2,
  Menu,
  MessageCircle,
  PanelLeftClose,
  Paperclip,
  Plus,
  Save,
  Search,
  SendHorizontal,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import {
  COURSE_AVATAR_PRESETS,
  pickRandomCourseAvatarId,
  readStoredCourseAvatarId,
  resolveNativeCourseAvatar,
  writeStoredCourseAvatarId,
} from '../assets';
import {
  getAiSettings,
  parseSyllabusDocument,
  streamAssistantReply,
  supportedAiModels,
  type AiSettings,
  type ParsedSyllabusDocument,
  type SupportedAiModel,
} from '../data/ai-client';
import {
  createNativeMiniLecture,
  getNativePlatformCapabilities,
  type NativePlatformCapabilities,
} from '../data/platform-api-client';
import { miniLectureManifestToPersistence } from '../data/mini-lecture-persistence';
import {
  getLocalRepository,
  type SaveCourseLearningStateInput,
} from '../data/repository';
import {
  courseScopedEventId,
  reviewPlanEventId,
  type LocalCourseEvent,
  type LocalCourseEventKind,
  type PersistedMiniLectureDeck,
  type RuntimeMiniLectureDeck,
} from '../domain/learning-experiences';
import { LocalResourceViewer, type LocalResourceDocument } from './LocalResourceViewer';
import {
  buildEventsByDay,
  buildLearningCalendarDays,
  formatCalendarMonth,
  LearningCalendarGrid,
  LearningCalendarMini,
} from './LearningCalendarGrid';
import {
  MiniLectureClassroom,
  MiniLectureGenerateCard,
  MiniLectureInviteCard,
  type MiniLectureGenerationState,
} from './MiniLectureClassroom';
import { NativeLearningActions } from './NativeLearningActions';
import { NativeReviewPlanCard } from './NativeReviewPlanCard';
import { NativeWorkspaceDialog } from './NativeWorkspaceDialog';
import { ProblemPracticePage } from './ProblemPracticePage';
import type { ProblemBankLaunch } from './ProblemBankPage';
import { ProblemRichText } from './problem-bank/problem-rich-text';
import type {
  LocalConversation,
  LocalCourseLearningState,
  LocalCourseSearchResult,
  LocalCourseWorkspace,
  LocalMessage,
  LocalNotebook,
  LocalProblem,
} from '../domain/models';
import type {
  NativeLearningAction,
  NativeReviewPlan,
  NativeReviewPlanCalendarItem,
  NativeReviewPlanTask,
} from '../domain/teaching';

type CourseTool = 'overview' | 'library' | 'calendar' | 'settings';
type MobilePanel = 'sessions' | 'tools' | null;
const AI_MODEL_STORAGE_KEY = 'syntara.native.openai.model';
const LEFT_RAIL_STORAGE_KEY = 'syntara.native.chat.left-rail-collapsed';
const COURSE_PROGRESS_STORAGE_PREFIX = 'syntara.native.course-progress.';
const RIGHT_RAIL_STORAGE_KEY = 'syntara.native.chat.right-rail-collapsed';
const MAX_CHAT_ATTACHMENT_BYTES = 512 * 1024;
const MAX_CHAT_ATTACHMENTS = 4;
const MAX_SYLLABUS_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_SYLLABUS_IMAGE_BYTES = 12 * 1024 * 1024;

type PlatformAiAccessStatus =
  | 'checking'
  | 'ready'
  | 'unauthorized'
  | 'unconfigured'
  | 'unavailable';

type PlatformAiAccess = {
  status: PlatformAiAccessStatus;
  capabilities: NativePlatformCapabilities | null;
  message: string;
};

function ChatMessageContent({ message }: { message: LocalMessage }) {
  if (message.role === 'user') return <p>{message.text}</p>;

  return <ProblemRichText className="chat-message-markdown" content={message.text} />;
}

function boundedJson(value: unknown, maxLength = 3600): string {
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch {
    return '';
  }
}

function orderCourseNotebooks(notebooks: LocalNotebook[]): LocalNotebook[] {
  return [...notebooks].sort(
    (left, right) =>
      left.name.localeCompare(right.name, 'zh-CN') || left.updatedAt - right.updatedAt,
  );
}

function isLectureEligibleMessage(message: LocalMessage): boolean {
  if (message.role !== 'assistant' || message.id.startsWith('stream-')) return false;
  if (message.metadata?.lectureEligible === true) return true;
  if (
    message.metadata?.learningActions?.some(
      (action) => action.kind === 'classroom.propose_temporary_explanation',
    )
  ) {
    return true;
  }
  return false;
}

async function miniLectureIdempotencyKey(message: LocalMessage, question: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${message.id}\n${question}\n${message.text}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `native-mini-lecture-${hash}`;
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function payloadText(value: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

function payloadStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
}

const SCHEDULE_KIND_OPTIONS: Array<{ value: LocalCourseEventKind; label: string }> = [
  { value: 'assignment', label: '作业' },
  { value: 'exam', label: '考试' },
  { value: 'progress', label: '进度' },
  { value: 'tutorial', label: 'Tutorial' },
  { value: 'holiday', label: '假期' },
  { value: 'other', label: '事项' },
];

const RESEARCH_SCHEDULE_KIND_OPTIONS: Array<{ value: LocalCourseEventKind; label: string }> = [
  { value: 'assignment', label: 'DDL' },
  { value: 'exam', label: '会议' },
  { value: 'progress', label: '进展' },
  { value: 'tutorial', label: '论文阅读' },
  { value: 'holiday', label: '暂停' },
  { value: 'other', label: '事项' },
];

function isLocalCourseEventKind(value: unknown): value is LocalCourseEventKind {
  return (
    value === 'assignment' ||
    value === 'exam' ||
    value === 'progress' ||
    value === 'tutorial' ||
    value === 'holiday' ||
    value === 'other'
  );
}

function inferScheduleKind(text: string): LocalCourseEventKind {
  if (/midterm|final|exam|test|quiz|考试|期中|期末|测验/i.test(text)) return 'exam';
  if (/tutorial|two-stage|workshop|activity|discussion|辅导|习题课/i.test(text)) return 'tutorial';
  if (/holiday|break|closed|no class|no lecture|假期|放假|停课/i.test(text)) return 'holiday';
  if (
    /assignment|homework|project|paper|essay|report|lab|problem set|pset|due|deadline|作业|项目|论文|报告|截止/i.test(
      text,
    )
  ) {
    return 'assignment';
  }
  if (
    /week|lecture|reading|chapter|module|unit|topic|第.+周|周进度|进度|阅读|章节|单元|主题/i.test(
      text,
    )
  ) {
    return 'progress';
  }
  return 'other';
}

function normalizeStoredScheduleItem(
  item: Record<string, unknown>,
  courseId: string,
): LocalCourseEvent | null {
  if (
    typeof item.id !== 'string' ||
    typeof item.title !== 'string' ||
    typeof item.date !== 'string'
  ) {
    return null;
  }
  const note = typeof item.note === 'string' ? item.note : '';
  const kind = isLocalCourseEventKind(item.kind)
    ? item.kind
    : inferScheduleKind(`${item.title}\n${note}`);
  const createdAt = typeof item.createdAt === 'number' ? item.createdAt : Date.now();
  return {
    id: item.id,
    courseId,
    title: item.title,
    date: item.date,
    note,
    kind,
    source: item.source === 'syllabus' ? 'syllabus' : 'manual',
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  };
}

function scheduleStorageKey(courseId: string): string {
  return `syntara.native.course.${courseId}.schedule`;
}

function readStoredBoolean(key: string): boolean {
  return window.localStorage.getItem(key) === 'true';
}

function readStoredCourseProgress(courseId: string): number {
  try {
    const raw = window.localStorage.getItem(`${COURSE_PROGRESS_STORAGE_PREFIX}${courseId}`);
    if (!raw) return 0;
    const value = Number(raw);
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, Math.round(value)));
  } catch {
    return 0;
  }
}

function readStoredCourseProgressIndex(courseId: string, notebookCount: number): number {
  if (notebookCount <= 0) return 0;
  const raw = readStoredCourseProgress(courseId);
  if (raw > notebookCount - 1) {
    return Math.min(notebookCount - 1, Math.max(0, Math.round((raw / 100) * (notebookCount - 1))));
  }
  return Math.min(notebookCount - 1, Math.max(0, Math.round(raw)));
}

function readStoredSchedule(courseId: string): LocalCourseEvent[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(scheduleStorageKey(courseId)) || '[]');
    if (!Array.isArray(value)) return [];
    return value
      .flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const normalized = normalizeStoredScheduleItem(item as Record<string, unknown>, courseId);
        return normalized ? [normalized] : [];
      })
      .sort((left, right) => left.date.localeCompare(right.date));
  } catch {
    return [];
  }
}

function mergeCourseEvents(
  current: LocalCourseEvent[],
  incoming: LocalCourseEvent[],
): LocalCourseEvent[] {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) {
    if (event.status === 'active') byId.set(event.id, event);
    else byId.delete(event.id);
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.createdAt - right.createdAt ||
      left.id.localeCompare(right.id),
  );
}

function normalizeScheduleDate(year: number, month: number, day: number): string | null {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function scheduleTitleFromLine(line: string, matchedDate: string): string {
  const title = line
    .replace(matchedDate, ' ')
    .replace(/^[\s:：,，;；\-–—|]+|[\s:：,，;；\-–—|]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return title.slice(0, 80) || 'Syllabus 安排';
}

function extractSyllabusSchedule(text: string, courseId: string): LocalCourseEvent[] {
  const currentYear = new Date().getFullYear();
  const items: LocalCourseEvent[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/).slice(0, 2500)) {
    const line = rawLine.trim();
    if (!line) continue;
    const fullDate = line.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    const shortDate = fullDate ? null : line.match(/\b(\d{1,2})[-/.](\d{1,2})\b/);
    const matchedDate = fullDate?.[0] || shortDate?.[0];
    if (!matchedDate) continue;
    const date = fullDate
      ? normalizeScheduleDate(Number(fullDate[1]), Number(fullDate[2]), Number(fullDate[3]))
      : normalizeScheduleDate(currentYear, Number(shortDate![1]), Number(shortDate![2]));
    if (!date) continue;
    const title = scheduleTitleFromLine(line, matchedDate);
    const dedupeKey = `${date}:${title.toLocaleLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const createdAt = Date.now();
    items.push({
      id: crypto.randomUUID(),
      courseId,
      title,
      date,
      note: `从 syllabus 中识别：${line.slice(0, 180)}`,
      kind: inferScheduleKind(`${title}\n${line}`),
      source: 'syllabus',
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    });
  }
  return items.slice(0, 80);
}

function isSupportedTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  return /\.(md|markdown|csv|json|txt|ts|tsx|js|jsx|py|html|css)$/i.test(file.name);
}

function isSupportedSyllabusImage(file: File): boolean {
  return (
    ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) ||
    /\.(png|jpe?g|webp|gif)$/i.test(file.name)
  );
}

function isSupportedSyllabusDocument(file: File): boolean {
  if (isSupportedTextFile(file)) return true;
  if (isSupportedSyllabusImage(file)) return true;
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('无法读取上传文件。'));
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      const separator = value.indexOf(',');
      if (separator < 0) {
        reject(new Error('上传文件没有生成有效的 Base64 数据。'));
        return;
      }
      resolve(value.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

function parsedSyllabusSchedule(
  parsed: ParsedSyllabusDocument,
  courseId: string,
): LocalCourseEvent[] {
  const createdAt = Date.now();
  return parsed.events.map((event) => ({
    id: crypto.randomUUID(),
    courseId,
    title: event.title,
    date: event.date,
    note: [
      event.rawText ? `原文：${event.rawText}` : '',
      event.sourceColumn ? `来源：${event.sourceColumn}` : '',
      typeof event.confidence === 'number'
        ? `识别置信度：${Math.round(event.confidence * 100)}%`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    kind: event.kind,
    source: 'syllabus',
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  }));
}

function parsedSyllabusMarkdown(fileName: string, parsed: ParsedSyllabusDocument): string {
  if (parsed.sourceMarkdown.trim()) return parsed.sourceMarkdown.trim();
  const rows = parsed.events
    .map((event) => `| ${event.date} | ${event.kind} | ${event.title.replaceAll('|', '\\|')} |`)
    .join('\n');
  return [
    `# ${parsed.courseTitle || fileName}`,
    '',
    '## 日历事项',
    '',
    '| 日期 | 类型 | 安排 |',
    '| --- | --- | --- |',
    rows || '| — | — | 未识别到明确日期 |',
  ].join('\n');
}

function readStoredAiModel(): SupportedAiModel {
  const stored = window.localStorage.getItem(AI_MODEL_STORAGE_KEY);
  return supportedAiModels.some(({ id }) => id === stored)
    ? (stored as SupportedAiModel)
    : 'gpt-5.6-sol';
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

type CourseWorkspaceProps = {
  workspace: LocalCourseWorkspace;
  backendLabel: string;
  onBack: () => void;
  onOpenProblemBank: () => void;
  onOpenNotebookLibrary: () => void;
  onOpenPractice: (launch: ProblemBankLaunch) => void;
  onWorkspaceChanged: () => Promise<void>;
};

const courseTools = [
  { id: 'overview', label: '概览', Icon: Target },
  { id: 'library', label: '资料库', Icon: Library },
  { id: 'calendar', label: '日历', Icon: CalendarDays },
  { id: 'settings', label: '设置', Icon: SlidersHorizontal },
] as const;

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function SessionsPanel({
  conversations,
  selectedConversationId,
  busy,
  onBack,
  onClose,
  onCollapse,
  onCreateConversation,
  onDeleteConversation,
  onShowAllConversations,
  onSelectConversation,
}: {
  conversations: LocalConversation[];
  selectedConversationId: string | null;
  busy: boolean;
  onBack: () => void;
  onClose?: () => void;
  onCollapse?: () => void;
  onCreateConversation: () => void;
  onDeleteConversation: (conversation: LocalConversation) => void;
  onShowAllConversations: () => void;
  onSelectConversation: (conversationId: string) => void;
}) {
  return (
    <div className="sessions-panel">
      <div className="sessions-back-row">
        <button type="button" onClick={onBack} className="plain-row-button">
          <ArrowLeft size={16} strokeWidth={1.8} />
          <span>Learn 首页</span>
        </button>
        {onClose ? (
          <button type="button" className="round-ghost-button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        ) : null}
      </div>

      <section className="sessions-heading">
        <div>
          <h2>会话历史</h2>
        </div>
        <div className="sessions-heading-actions">
          <button
            type="button"
            className="round-ghost-button"
            onClick={onShowAllConversations}
            aria-label="搜索全部会话"
          >
            <Search size={16} strokeWidth={1.8} />
          </button>
          {onCollapse ? (
            <button
              type="button"
              className="round-ghost-button desktop-collapse"
              onClick={onCollapse}
              aria-label="收起会话历史"
            >
              <PanelLeftClose size={16} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
      </section>

      <button
        type="button"
        className="new-conversation-button"
        onClick={onCreateConversation}
        disabled={busy}
      >
        <Plus size={16} strokeWidth={1.8} />
        新对话
      </button>

      <nav className="session-list" aria-label="当前课程会话历史">
        {conversations.length ? (
          <>
            <p className="session-group-title">最近</p>
            {conversations.map((conversation) => {
              const active = conversation.id === selectedConversationId;
              return (
                <div
                  className={
                    active ? 'session-row-shell session-row-shell-active' : 'session-row-shell'
                  }
                  key={conversation.id}
                >
                  <button
                    type="button"
                    className="session-row"
                    onClick={() => onSelectConversation(conversation.id)}
                  >
                    <MessageCircle size={14} strokeWidth={1.7} />
                    <span>{conversation.title}</span>
                    <time>{formatRelativeTime(conversation.updatedAt)}</time>
                  </button>
                  <button
                    type="button"
                    className="session-delete-button"
                    onClick={() => onDeleteConversation(conversation)}
                    aria-label={`删除会话：${conversation.title}`}
                    title="删除会话"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </>
        ) : (
          <p className="sessions-empty-copy">还没有会话，先开始一次新的学习对话。</p>
        )}
      </nav>

      <div className="sessions-footer">
        <button type="button" className="plain-row-button" onClick={onShowAllConversations}>
          <Menu size={15} />
          <span>全部会话</span>
        </button>
        <span>{conversations.length}</span>
      </div>
    </div>
  );
}

function LibrarySearchRow({
  result,
  onOpen,
}: {
  result: LocalCourseSearchResult;
  onOpen: () => void;
}) {
  const label =
    result.type === 'notebook' ? '笔记本' : result.type === 'problem' ? '题目' : '学习记忆';
  const content = (
    <>
      <span className="tool-row-icon">
        {result.type === 'notebook' ? (
          <BookOpen size={16} strokeWidth={1.8} />
        ) : result.type === 'problem' ? (
          <CheckCircle2 size={16} strokeWidth={1.8} />
        ) : (
          <Sparkles size={16} strokeWidth={1.8} />
        )}
      </span>
      <span>
        <strong>{result.title}</strong>
        <small>{result.excerpt}</small>
      </span>
      <span className="tool-row-badge">{label}</span>
    </>
  );
  return (
    <button type="button" className="tool-list-row local-search-result" onClick={onOpen}>
      {content}
    </button>
  );
}

function CourseLearningProgressPanel({
  learningState,
  notebooks,
  onProgressChange,
  onOpenNotebook,
}: {
  learningState: LocalCourseLearningState | null;
  notebooks: LocalNotebook[];
  onProgressChange: (completedNotebookCount: number, currentNotebookId: string | null) => void;
  onOpenNotebook: (notebook: LocalNotebook) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [completedNotebookCount, setCompletedNotebookCount] = useState(() =>
    Math.min(notebooks.length, Math.max(0, learningState?.completedNotebookCount ?? 0)),
  );
  const [anchorPercents, setAnchorPercents] = useState<number[]>([]);
  const [dragging, setDragging] = useState(false);

  const orderedNotebooks = useMemo(() => orderCourseNotebooks(notebooks), [notebooks]);

  const notebookCount = orderedNotebooks.length;

  const commitCount = useCallback(
    (count: number) => {
      const next = Math.min(notebookCount, Math.max(0, Math.round(count)));
      if (next === completedNotebookCount) return;
      setCompletedNotebookCount(next);
      onProgressChange(next, next > 0 ? (orderedNotebooks[next - 1]?.id ?? null) : null);
    },
    [completedNotebookCount, notebookCount, onProgressChange, orderedNotebooks],
  );

  const measureAnchors = useCallback(() => {
    const track = trackRef.current;
    if (!track || notebookCount <= 0) {
      setAnchorPercents([]);
      return;
    }
    const trackRect = track.getBoundingClientRect();
    if (trackRect.height <= 0) return;
    const next = orderedNotebooks.map((_, index) => {
      const item = itemRefs.current[index];
      if (!item) return ((index + 0.5) / notebookCount) * 100;
      const itemRect = item.getBoundingClientRect();
      const centerY = itemRect.top + itemRect.height / 2;
      return ((centerY - trackRect.top) / trackRect.height) * 100;
    });
    setAnchorPercents(next);
  }, [notebookCount, orderedNotebooks]);

  useLayoutEffect(() => {
    let frameId = window.requestAnimationFrame(measureAnchors);
    const scheduleMeasurement = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(measureAnchors);
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasurement);
    if (observer) {
      if (trackRef.current) observer.observe(trackRef.current);
      if (listRef.current) observer.observe(listRef.current);
    }
    window.addEventListener('resize', scheduleMeasurement);
    return () => {
      window.cancelAnimationFrame(frameId);
      observer?.disconnect();
      window.removeEventListener('resize', scheduleMeasurement);
    };
  }, [measureAnchors]);

  const snapCountFromClientY = useCallback(
    (clientY: number) => {
      const track = trackRef.current;
      if (!track || notebookCount <= 0) return 0;
      const trackRect = track.getBoundingClientRect();
      if (trackRect.height <= 0) return 0;
      const ratio = Math.min(1, Math.max(0, (clientY - trackRect.top) / trackRect.height));
      return Math.round(ratio * notebookCount);
    },
    [notebookCount],
  );

  const updateProgressFromClientY = useCallback(
    (clientY: number) => {
      commitCount(snapCountFromClientY(clientY));
    },
    [commitCount, snapCountFromClientY],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateProgressFromClientY(event.clientY);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging && !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateProgressFromClientY(event.clientY);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  const progressPercent =
    notebookCount <= 0 ? 0 : Math.round((completedNotebookCount / notebookCount) * 100);
  const thumbTop =
    completedNotebookCount <= 0
      ? 0
      : (anchorPercents[completedNotebookCount - 1] ??
        (completedNotebookCount / notebookCount) * 100);

  return (
    <section className="tool-card">
      <h3>
        <BookOpen size={16} strokeWidth={1.7} />
        学习进度
        <small>{progressPercent}%</small>
      </h3>
      {notebookCount === 0 ? (
        <p className="course-progress-empty">
          还没有上传笔记本。上传后会出现在这里，方便拖动进度。
        </p>
      ) : (
        <>
          <p className="course-progress-scope">AI 只读取蓝色进度点之前的笔记本内容与对应记忆。</p>
          <div className="course-progress-panel">
            <div
              ref={trackRef}
              className={`course-progress-track${dragging ? ' is-dragging' : ''}`}
              role="slider"
              aria-label="课程学习进度"
              aria-valuemin={0}
              aria-valuemax={notebookCount}
              aria-valuenow={completedNotebookCount}
              aria-valuetext={`已完成 ${completedNotebookCount} / ${notebookCount} 本 · ${progressPercent}%`}
              tabIndex={0}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                  event.preventDefault();
                  commitCount(completedNotebookCount - 1);
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  commitCount(completedNotebookCount + 1);
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  commitCount(0);
                } else if (event.key === 'End') {
                  event.preventDefault();
                  commitCount(notebookCount);
                }
              }}
            >
              <span className="course-progress-fill" style={{ height: `${thumbTop}%` }} />
              {orderedNotebooks.map((notebook, index) => (
                <span
                  key={`anchor-${notebook.id}`}
                  className={`course-progress-anchor${index < completedNotebookCount ? ' is-reached' : ''}${index === completedNotebookCount - 1 ? ' is-current' : ''}`}
                  style={{
                    top: `${anchorPercents[index] ?? ((index + 0.5) / notebookCount) * 100}%`,
                  }}
                />
              ))}
              <span className="course-progress-thumb" style={{ top: `${thumbTop}%` }} />
            </div>
            <ul className="course-progress-notebooks" ref={listRef}>
              {orderedNotebooks.map((notebook, index) => {
                const reached = index < completedNotebookCount;
                const current = index === completedNotebookCount - 1;
                return (
                  <li
                    key={notebook.id}
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                  >
                    <button
                      type="button"
                      className={`course-progress-notebook${reached ? ' is-reached' : ''}${current ? ' is-current' : ''}`}
                      onClick={() => onOpenNotebook(notebook)}
                    >
                      <span className="course-progress-notebook-index">{index + 1}</span>
                      <span className="course-progress-notebook-copy">
                        <strong>{notebook.name}</strong>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

function CourseToolsPanel({
  workspace,
  activeTool,
  backendLabel,
  courseLearningState,
  platformAiAccess,
  librarySearchBusy,
  librarySearchQuery,
  librarySearchResults,
  scheduleItems,
  syllabusBusy,
  hasSyllabusUploaded,
  onAddSchedule,
  onClearCalendar,
  onClose,
  onCollapse,
  onDeleteSchedule,
  onEditSchedule,
  onOpenCalendar,
  onOpenNotebook,
  onOpenNotebookLibrary,
  onOpenProblemBank,
  onOpenSearchResult,
  onSearchQueryChange,
  onSaveCourseSettings,
  onCourseProgressChange,
  onToolChange,
  onUploadNotes,
  onUploadProblems,
  onUploadSyllabus,
  courseNameDraft,
  courseCodeDraft,
  courseDescriptionDraft,
  courseAvatarIdDraft,
  onCourseNameDraftChange,
  onCourseCodeDraftChange,
  onCourseDescriptionDraftChange,
  onOpenAvatarPicker,
  courseSettingsBusy,
}: {
  workspace: LocalCourseWorkspace;
  activeTool: CourseTool;
  backendLabel: string;
  courseLearningState: LocalCourseLearningState | null;
  platformAiAccess: PlatformAiAccess;
  librarySearchBusy: boolean;
  librarySearchQuery: string;
  librarySearchResults: LocalCourseSearchResult[];
  scheduleItems: LocalCourseEvent[];
  syllabusBusy: boolean;
  hasSyllabusUploaded: boolean;
  onAddSchedule: () => void;
  onClearCalendar: () => void;
  onClose?: () => void;
  onCollapse?: () => void;
  onDeleteSchedule: (itemId: string) => void;
  onEditSchedule: (item: LocalCourseEvent) => void;
  onOpenCalendar: () => void;
  onOpenNotebook: (notebook: LocalNotebook) => void;
  onOpenNotebookLibrary: () => void;
  onOpenProblemBank: () => void;
  onOpenSearchResult: (result: LocalCourseSearchResult) => void;
  onSearchQueryChange: (query: string) => void;
  onSaveCourseSettings: () => void;
  onCourseProgressChange: (
    completedNotebookCount: number,
    currentNotebookId: string | null,
  ) => void;
  onToolChange: (tool: CourseTool) => void;
  onUploadNotes: () => void;
  onUploadProblems: () => void;
  onUploadSyllabus: () => void;
  courseNameDraft: string;
  courseCodeDraft: string;
  courseDescriptionDraft: string;
  courseAvatarIdDraft: string | null;
  onCourseNameDraftChange: (value: string) => void;
  onCourseCodeDraftChange: (value: string) => void;
  onCourseDescriptionDraftChange: (value: string) => void;
  onOpenAvatarPicker: () => void;
  courseSettingsBusy: boolean;
}) {
  const publishedProblemCount = workspace.problems.filter(
    (problem) => problem.status === 'published',
  ).length;
  const platformReady =
    platformAiAccess.status === 'ready' && platformAiAccess.capabilities?.available === true;
  const syllabusAvailable =
    platformReady && platformAiAccess.capabilities?.capabilities.syllabus === true;
  const syllabusActionLabel = hasSyllabusUploaded ? '重新上传时间表' : '上传时间表';
  const syllabusActionHint = syllabusAvailable
    ? 'TXT / Markdown / PDF / 图片'
    : 'TXT / Markdown；PDF 与图片需平台 AI';
  const upcomingScheduleItems = [...scheduleItems]
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.updatedAt - right.updatedAt ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 6);

  return (
    <div className="course-tools-panel">
      <header className="course-tools-heading">
        <h2>课程工具</h2>
        {onClose ? (
          <button type="button" className="round-ghost-button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        ) : onCollapse ? (
          <button
            type="button"
            className="round-ghost-button"
            onClick={onCollapse}
            aria-label="收起课程工具"
          >
            <ChevronRight size={17} />
          </button>
        ) : null}
      </header>

      <nav className="course-tool-tabs" aria-label="课程工具">
        {courseTools.map(({ id, label, Icon }) => (
          <button
            type="button"
            key={id}
            className={
              activeTool === id ? 'course-tool-tab course-tool-tab-active' : 'course-tool-tab'
            }
            onClick={() => onToolChange(id)}
          >
            <Icon size={15} strokeWidth={1.75} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="course-tools-scroll">
        {activeTool === 'overview' ? (
          <>
            <CourseLearningProgressPanel
              key={`${workspace.course.id}:${courseLearningState?.updatedAt ?? 'loading'}:${workspace.notebooks.length}`}
              learningState={courseLearningState}
              notebooks={workspace.notebooks}
              onProgressChange={onCourseProgressChange}
              onOpenNotebook={onOpenNotebook}
            />

            <section className="tool-card">
              <h3>
                <CloudUpload size={16} strokeWidth={1.7} />
                {syllabusActionLabel}
              </h3>
              <p>导入课程大纲后，日历会自动带上考试、作业等安排。</p>
              <button
                type="button"
                className="tool-action-row tool-action-row-dark tool-action-row-center"
                onClick={onUploadSyllabus}
                disabled={syllabusBusy}
                title={syllabusBusy ? '正在解析…' : '点击上传'}
              >
                {syllabusBusy ? '正在解析…' : '点击上传'}
              </button>
            </section>
          </>
        ) : null}

        {activeTool === 'library' ? (
          <>
            <label className="local-library-search">
              <Search size={15} strokeWidth={1.8} />
              <input
                type="search"
                value={librarySearchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                placeholder="搜索本机笔记本、题目和学习记忆"
                autoComplete="off"
              />
              {librarySearchBusy ? <Loader2 size={14} className="spin-icon" /> : null}
            </label>
            {librarySearchQuery.trim() ? (
              <section className="tool-card tool-card-list local-search-results">
                <h3>
                  <Search size={16} strokeWidth={1.7} />
                  本机搜索
                  <small>{librarySearchBusy ? '检索中' : librarySearchResults.length}</small>
                </h3>
                {!librarySearchBusy && librarySearchResults.length === 0 ? (
                  <p>当前课程没有匹配的本地资料。</p>
                ) : null}
                {librarySearchResults.map((result) => (
                  <LibrarySearchRow
                    key={`${result.type}:${result.id}`}
                    result={result}
                    onOpen={() => onOpenSearchResult(result)}
                  />
                ))}
              </section>
            ) : (
              <>
                <section className="tool-card">
                  <h3>
                    <Library size={16} strokeWidth={1.7} />
                    资料库
                  </h3>
                  <p>打开题库或笔记本库；内容在独立页面中查看。</p>
                  <button type="button" className="tool-action-row" onClick={onOpenProblemBank}>
                    <span className="tool-action-icon">
                      <BookOpenCheck size={17} />
                    </span>
                    <span>
                      <strong>打开题库</strong>
                      <small>
                        独立题库页 · {workspace.problems.length} 题
                        {publishedProblemCount ? ` · ${publishedProblemCount} 已发布` : ''}
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                  <button type="button" className="tool-action-row" onClick={onOpenNotebookLibrary}>
                    <span className="tool-action-icon">
                      <BookOpen size={17} />
                    </span>
                    <span>
                      <strong>打开笔记本库</strong>
                      <small>独立笔记本页 · {workspace.notebooks.length} 本</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                </section>
                <section className="tool-card">
                  <h3>
                    <Upload size={16} strokeWidth={1.7} />
                    上传资料
                  </h3>
                  <p>导入文本资料到本机题库或笔记本库。</p>
                  <button type="button" className="tool-action-row" onClick={onUploadProblems}>
                    <span className="tool-action-icon">
                      <Upload size={17} />
                    </span>
                    <span>
                      <strong>上传题目</strong>
                      <small>TXT / Markdown · 导入为本机简答题</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                  <button type="button" className="tool-action-row" onClick={onUploadNotes}>
                    <span className="tool-action-icon">
                      <FileText size={17} />
                    </span>
                    <span>
                      <strong>上传笔记</strong>
                      <small>TXT / Markdown · 导入为本机笔记本</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                </section>
              </>
            )}
          </>
        ) : null}

        {activeTool === 'calendar' ? (
          <section className="tool-card">
            <h3>
              <CalendarDays size={16} strokeWidth={1.7} />
              学习日历
              <span className="tool-card-heading-actions">
                <button type="button" className="tool-card-heading-action" onClick={onAddSchedule}>
                  <Plus size={14} strokeWidth={2} />
                  添加安排
                </button>
              </span>
            </h3>
            <LearningCalendarMini
              days={buildLearningCalendarDays(new Date(), scheduleItems)}
              onOpen={onOpenCalendar}
            />
            {upcomingScheduleItems.length ? (
              <div className="course-calendar-agenda" aria-label="近期课程安排">
                {upcomingScheduleItems.map((item) => (
                  <div className="course-calendar-agenda-row" key={item.id}>
                    <button
                      type="button"
                      className="course-calendar-agenda-open"
                      onClick={() => onEditSchedule(item)}
                      title={`查看或编辑：${item.title}`}
                    >
                      <time>{item.date.slice(5).replace('-', '/')}</time>
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {(workspace.course.purpose === 'research'
                            ? RESEARCH_SCHEDULE_KIND_OPTIONS
                            : SCHEDULE_KIND_OPTIONS
                          ).find((option) => option.value === item.kind)?.label || '事项'}
                        </small>
                      </span>
                      <ChevronRight size={14} />
                    </button>
                    <button
                      type="button"
                      className="course-calendar-agenda-delete"
                      onClick={() => onDeleteSchedule(item.id)}
                      aria-label={`删除日程：${item.title}`}
                      title="删除日程"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="calendar-tool-actions">
              <button
                type="button"
                className="tool-action-row"
                onClick={onUploadSyllabus}
                disabled={syllabusBusy}
              >
                <span className="tool-action-icon">
                  {syllabusBusy ? (
                    <Loader2 size={17} className="spin-icon" />
                  ) : (
                    <CloudUpload size={17} />
                  )}
                </span>
                <span>
                  <strong>{syllabusBusy ? '正在解析 syllabus…' : syllabusActionLabel}</strong>
                  <small>{syllabusActionHint}</small>
                </span>
                <ChevronRight size={16} />
              </button>
              <button
                type="button"
                className="tool-action-row"
                onClick={onClearCalendar}
                disabled={!scheduleItems.length}
              >
                <span className="tool-action-icon">
                  <Trash2 size={17} />
                </span>
                <span>
                  <strong>清空日历</strong>
                  <small>
                    {scheduleItems.length
                      ? `删除当前 ${scheduleItems.length} 项日程`
                      : '当前没有可清空的日程'}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
              <button type="button" className="tool-action-row" onClick={onAddSchedule}>
                <span className="tool-action-icon">
                  <Plus size={17} />
                </span>
                <span>
                  <strong>添加日程</strong>
                  <small>手动添加考试、作业或学习安排</small>
                </span>
                <ChevronRight size={16} />
              </button>
            </div>
          </section>
        ) : null}

        {activeTool === 'settings' ? (
          <>
            <section className="tool-card">
              <h3>
                <Settings2 size={16} strokeWidth={1.7} />
                课程设置
              </h3>
              <p>直接修改后点击保存，只更新当前设备上的课程信息。</p>
              <div className="course-inline-settings">
                <button
                  type="button"
                  className="tool-action-row course-avatar-picker-row"
                  onClick={onOpenAvatarPicker}
                  disabled={courseSettingsBusy}
                >
                  <img
                    src={resolveNativeCourseAvatar(
                      workspace.course.id,
                      courseCodeDraft || workspace.course.courseCode,
                      courseAvatarIdDraft,
                    )}
                    alt=""
                    className="course-settings-avatar"
                    aria-hidden
                  />
                  <span>
                    <strong>更换头像</strong>
                    <small>在弹窗中选择课程头像</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
                <label className="native-settings-field">
                  <span>课程名称</span>
                  <input
                    value={courseNameDraft}
                    onChange={(event) => onCourseNameDraftChange(event.target.value)}
                    placeholder="课程名称"
                    maxLength={80}
                    disabled={courseSettingsBusy}
                  />
                </label>
                <label className="native-settings-field">
                  <span>课程代码</span>
                  <input
                    value={courseCodeDraft}
                    onChange={(event) => onCourseCodeDraftChange(event.target.value)}
                    placeholder="例如：MAT136"
                    maxLength={32}
                    disabled={courseSettingsBusy}
                  />
                </label>
                <label className="native-settings-field">
                  <span>课程说明</span>
                  <textarea
                    rows={3}
                    value={courseDescriptionDraft}
                    onChange={(event) => onCourseDescriptionDraftChange(event.target.value)}
                    placeholder="这门课程的学习目标与范围"
                    maxLength={500}
                    disabled={courseSettingsBusy}
                  />
                </label>
                <button
                  type="button"
                  className="secondary-button course-inline-settings-save"
                  onClick={onSaveCourseSettings}
                  disabled={!courseNameDraft.trim() || courseSettingsBusy}
                >
                  {courseSettingsBusy ? (
                    <Loader2 size={14} className="spin-icon" />
                  ) : (
                    <Save size={14} />
                  )}
                  {courseSettingsBusy ? '保存中…' : '保存'}
                </button>
              </div>
            </section>
            <section className="tool-card">
              <h3>
                <Database size={16} strokeWidth={1.7} />
                本地资料
              </h3>
              <div className="settings-fact">
                <span>数据源</span>
                <strong>{backendLabel}</strong>
              </div>
              <div className="settings-fact">
                <span>笔记本</span>
                <strong>{workspace.notebooks.length}</strong>
              </div>
              <div className="settings-fact">
                <span>题目</span>
                <strong>{workspace.problems.length}</strong>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function CourseWorkspace({
  workspace,
  backendLabel,
  onBack,
  onOpenProblemBank,
  onOpenNotebookLibrary,
  onOpenPractice,
  onWorkspaceChanged,
}: CourseWorkspaceProps) {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [activeTool, setActiveTool] = useState<CourseTool>('overview');
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [busy, setBusy] = useState(false);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [resource, setResource] = useState<LocalResourceDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings>({
    configured: false,
    credentialSource: null,
    defaultModel: 'gpt-5.6-sol',
  });
  const [platformAiAccess, setPlatformAiAccess] = useState<PlatformAiAccess>({
    status: 'checking',
    capabilities: null,
    message: '正在检查平台 AI 能力与登录状态…',
  });
  const [aiModel, setAiModel] = useState<SupportedAiModel>(readStoredAiModel);
  const [librarySearchQuery, setLibrarySearchQuery] = useState('');
  const [librarySearchResults, setLibrarySearchResults] = useState<LocalCourseSearchResult[]>([]);
  const [librarySearchBusy, setLibrarySearchBusy] = useState(false);
  const [syllabusBusy, setSyllabusBusy] = useState(false);
  const [leftRailCollapsed, setLeftRailCollapsed] = useState(() =>
    readStoredBoolean(LEFT_RAIL_STORAGE_KEY),
  );
  const [rightRailCollapsed, setRightRailCollapsed] = useState(() =>
    readStoredBoolean(RIGHT_RAIL_STORAGE_KEY),
  );
  const [allConversationsOpen, setAllConversationsOpen] = useState(false);
  const [conversationSearchQuery, setConversationSearchQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [scheduleItems, setScheduleItems] = useState<LocalCourseEvent[]>([]);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [calendarDialogOpen, setCalendarDialogOpen] = useState(false);
  const [calendarReferenceDate, setCalendarReferenceDate] = useState(() => new Date());
  const [calendarDayItems, setCalendarDayItems] = useState<LocalCourseEvent[]>([]);
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(false);
  const [focusedMemoryId, setFocusedMemoryId] = useState<string | null>(null);
  const [courseLearningState, setCourseLearningState] = useState<LocalCourseLearningState | null>(
    null,
  );
  const [miniLectureDecksByMessageId, setMiniLectureDecksByMessageId] = useState<
    Map<string, PersistedMiniLectureDeck>
  >(() => new Map());
  const [miniLectureLoadingDeckId, setMiniLectureLoadingDeckId] = useState<string | null>(null);
  const [activeMiniLecture, setActiveMiniLecture] = useState<RuntimeMiniLectureDeck | null>(null);
  const [miniLectureGenerationByMessageId, setMiniLectureGenerationByMessageId] = useState<
    Map<string, MiniLectureGenerationState>
  >(() => new Map());
  const [reviewPracticeLaunch, setReviewPracticeLaunch] = useState<ProblemBankLaunch | null>(null);
  const [reviewPlanStatusRevision, setReviewPlanStatusRevision] = useState(0);
  const [busyLearningActionId, setBusyLearningActionId] = useState<string | null>(null);
  const [conversationToDelete, setConversationToDelete] = useState<LocalConversation | null>(null);
  const [courseNameDraft, setCourseNameDraft] = useState(workspace.course.name);
  const [courseCodeDraft, setCourseCodeDraft] = useState(workspace.course.courseCode || '');
  const [courseDescriptionDraft, setCourseDescriptionDraft] = useState(
    workspace.course.description,
  );
  const [courseAvatarIdDraft, setCourseAvatarIdDraft] = useState<string | null>(() =>
    readStoredCourseAvatarId(workspace.course.id),
  );
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
  const [avatarPickerId, setAvatarPickerId] = useState<string | null>(() =>
    readStoredCourseAvatarId(workspace.course.id),
  );
  const [avatarPickerPage, setAvatarPickerPage] = useState(0);
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleNote, setScheduleNote] = useState('');
  const [scheduleKind, setScheduleKind] = useState<LocalCourseEventKind>('other');
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const problemUploadInputRef = useRef<HTMLInputElement>(null);
  const noteUploadInputRef = useRef<HTMLInputElement>(null);
  const syllabusInputRef = useRef<HTMLInputElement>(null);
  const focusedMemoryRef = useRef<HTMLElement | null>(null);
  const conversationLoadRequestRef = useRef(0);
  const platformAccessRequestRef = useRef(0);
  const skipConversationLoadRef = useRef<string | null>(null);
  const miniLectureLoadRequestRef = useRef(0);
  const courseProgressSaveRequestRef = useRef(0);
  const courseProgressSaveRunningRef = useRef(false);
  const pendingCourseProgressSaveRef = useRef<
    | (SaveCourseLearningStateInput & {
        requestId: number;
        notebookCount: number;
      })
    | null
  >(null);
  const courseEventMutationIdsRef = useRef(new Set<string>());
  const activeCourseIdRef = useRef(workspace.course.id);
  const activeConversationIdRef = useRef(selectedConversationId);
  activeCourseIdRef.current = workspace.course.id;
  activeConversationIdRef.current = selectedConversationId;
  const platformReady =
    platformAiAccess.status === 'ready' && platformAiAccess.capabilities?.available === true;
  const teachingTurnAvailable =
    platformReady && platformAiAccess.capabilities?.capabilities.teachingTurn === true;
  const miniLectureAvailable =
    platformReady && platformAiAccess.capabilities?.capabilities.miniLecture === true;
  const syllabusAvailable =
    platformReady && platformAiAccess.capabilities?.capabilities.syllabus === true;

  useEffect(() => {
    if (activeTool !== 'settings') return;
    setCourseNameDraft(workspace.course.name);
    setCourseCodeDraft(workspace.course.courseCode || '');
    setCourseDescriptionDraft(workspace.course.description);
    setCourseAvatarIdDraft(readStoredCourseAvatarId(workspace.course.id));
  }, [
    activeTool,
    workspace.course.courseCode,
    workspace.course.description,
    workspace.course.id,
    workspace.course.name,
  ]);

  const avatarPageSize = 21;
  const avatarPageCount = Math.max(1, Math.ceil(COURSE_AVATAR_PRESETS.length / avatarPageSize));
  const avatarPresetsOnPage = useMemo(() => {
    const start = avatarPickerPage * avatarPageSize;
    return COURSE_AVATAR_PRESETS.slice(start, start + avatarPageSize);
  }, [avatarPickerPage]);

  const openAvatarPicker = useCallback(() => {
    setAvatarPickerId(courseAvatarIdDraft || readStoredCourseAvatarId(workspace.course.id));
    setAvatarPickerPage(0);
    setAvatarDialogOpen(true);
  }, [courseAvatarIdDraft, workspace.course.id]);

  const confirmAvatarPicker = useCallback(() => {
    setCourseAvatarIdDraft(avatarPickerId);
    setAvatarDialogOpen(false);
  }, [avatarPickerId]);

  useEffect(() => {
    let cancelled = false;
    const courseId = workspace.course.id;
    setScheduleItems([]);

    void getLocalRepository()
      .then(async (repository) => {
        const storedEvents = await repository.listCourseEvents(courseId);
        const legacyStorageKey = scheduleStorageKey(courseId);
        const hasLegacySchedule = window.localStorage.getItem(legacyStorageKey) !== null;
        if (hasLegacySchedule) {
          const storedIds = new Set(storedEvents.map((event) => event.id));
          const legacyEvents = readStoredSchedule(courseId).filter(
            (event) => !storedIds.has(event.id),
          );
          if (legacyEvents.length) {
            await repository.upsertCourseEvents(legacyEvents);
          }
          window.localStorage.removeItem(legacyStorageKey);
          if (legacyEvents.length) return repository.listCourseEvents(courseId);
        }
        return storedEvents;
      })
      .then((events) => {
        if (!cancelled) {
          setScheduleItems(events.filter((event) => event.status === 'active'));
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [workspace.course.id]);

  useEffect(() => {
    let cancelled = false;
    const courseId = workspace.course.id;
    const notebookCount = workspace.notebooks.length;
    const legacyStorageKey = `${COURSE_PROGRESS_STORAGE_PREFIX}${courseId}`;

    void getLocalRepository()
      .then(async (repository) => {
        const stored = await repository.getCourseLearningState(courseId);
        if (stored) return stored;

        const legacyValue = window.localStorage.getItem(legacyStorageKey);
        if (legacyValue === null || notebookCount <= 0) return null;
        const completedNotebookCount = Math.min(
          notebookCount,
          readStoredCourseProgressIndex(courseId, notebookCount) + 1,
        );
        const currentNotebookId =
          [...workspace.notebooks].sort(
            (left, right) =>
              left.name.localeCompare(right.name, 'zh-CN') || left.updatedAt - right.updatedAt,
          )[completedNotebookCount - 1]?.id ?? null;
        const migrated = await repository.saveCourseLearningState({
          courseId,
          completedNotebookCount,
          currentNotebookId,
        });
        window.localStorage.removeItem(legacyStorageKey);
        return migrated;
      })
      .then((state) => {
        if (!cancelled && activeCourseIdRef.current === courseId) {
          setCourseLearningState(state);
        }
      })
      .catch((cause) => {
        if (!cancelled && activeCourseIdRef.current === courseId) {
          setError(errorMessage(cause));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspace.course.id, workspace.notebooks]);

  const refreshPlatformAiAccess = useCallback(() => {
    const requestId = ++platformAccessRequestRef.current;
    setPlatformAiAccess((current) => ({
      status: 'checking',
      capabilities: current.capabilities,
      message: '正在验证登录并连接平台 AI…',
    }));
    void Promise.allSettled([getAiSettings(), getNativePlatformCapabilities()]).then(
      ([settingsResult, capabilitiesResult]) => {
        if (requestId !== platformAccessRequestRef.current) return;
        if (settingsResult.status === 'fulfilled') {
          setAiSettings(settingsResult.value);
        }
        if (
          capabilitiesResult.status === 'fulfilled' &&
          capabilitiesResult.value.available === true
        ) {
          setPlatformAiAccess({
            status: 'ready',
            capabilities: capabilitiesResult.value,
            message: '平台 AI 已连接，调用使用服务端 OpenAI Key。',
          });
          return;
        }

        const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : null;
        const capabilityError =
          capabilitiesResult.status === 'rejected'
            ? errorMessage(capabilitiesResult.reason)
            : '平台没有宣告可用能力。';
        if (!settings?.configured) {
          setPlatformAiAccess({
            status: 'unconfigured',
            capabilities: null,
            message: settings?.error || '当前安装包没有配置平台 API 地址。',
          });
        } else if (/HTTP 401|登录凭据|unauthorized/i.test(capabilityError)) {
          setPlatformAiAccess({
            status: 'unauthorized',
            capabilities: null,
            message: '请先登录 Syntara 账户，再使用平台 AI。',
          });
        } else {
          setPlatformAiAccess({
            status: 'unavailable',
            capabilities: null,
            message: capabilityError,
          });
        }
      },
    );
  }, []);

  useEffect(() => {
    refreshPlatformAiAccess();
    return () => {
      platformAccessRequestRef.current += 1;
    };
  }, [refreshPlatformAiAccess]);

  useEffect(() => {
    if (platformAiAccess.status === 'ready') return;
    const timer = window.setInterval(refreshPlatformAiAccess, 12_000);
    return () => window.clearInterval(timer);
  }, [platformAiAccess.status, refreshPlatformAiAccess]);

  useEffect(() => {
    const refreshAfterLogin = () => refreshPlatformAiAccess();
    window.addEventListener('syntara-native-auth-changed', refreshAfterLogin);
    return () => window.removeEventListener('syntara-native-auth-changed', refreshAfterLogin);
  }, [refreshPlatformAiAccess]);

  useEffect(() => {
    const requestId = ++conversationLoadRequestRef.current;
    let cancelled = false;
    miniLectureLoadRequestRef.current += 1;
    setMiniLectureLoadingDeckId(null);
    setActiveMiniLecture(null);
    setMiniLectureGenerationByMessageId(new Map());

    if (!selectedConversationId) {
      setMessages([]);
      setMiniLectureDecksByMessageId(new Map());
      return;
    }

    if (skipConversationLoadRef.current === selectedConversationId) {
      skipConversationLoadRef.current = null;
      setMiniLectureDecksByMessageId(new Map());
      return;
    }

    setMessages([]);
    setMiniLectureDecksByMessageId(new Map());
    void getLocalRepository()
      .then((repository) =>
        Promise.all([
          repository.listMessages(selectedConversationId),
          repository.listMiniLectureDecks(selectedConversationId),
        ]),
      )
      .then(([loadedMessages, decks]) => {
        if (cancelled || requestId !== conversationLoadRequestRef.current) return;
        setMessages(loadedMessages);
        setMiniLectureDecksByMessageId(
          new Map(
            decks
              .filter((deck) => deck.status === 'ready')
              .map((deck) => [deck.messageId, deck] as const),
          ),
        );
      })
      .catch((cause) => {
        if (!cancelled && requestId === conversationLoadRequestRef.current) {
          setError(errorMessage(cause));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedConversationId]);

  useEffect(() => {
    const query = librarySearchQuery.trim();
    if (!query) {
      setLibrarySearchResults([]);
      setLibrarySearchBusy(false);
      return;
    }
    let cancelled = false;
    setLibrarySearchBusy(true);
    const timer = window.setTimeout(() => {
      void getLocalRepository()
        .then((repository) => repository.searchCourse(workspace.course.id, query))
        .then((results) => {
          if (!cancelled) setLibrarySearchResults(results);
        })
        .catch((cause) => {
          if (!cancelled) setError(errorMessage(cause));
        })
        .finally(() => {
          if (!cancelled) setLibrarySearchBusy(false);
        });
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [librarySearchQuery, workspace.course.id]);

  const selectedConversation = useMemo(
    () =>
      workspace.conversations.find((conversation) => conversation.id === selectedConversationId) ??
      null,
    [selectedConversationId, workspace.conversations],
  );

  const filteredConversations = useMemo(() => {
    const query = conversationSearchQuery.normalize('NFKC').trim().toLocaleLowerCase();
    if (!query) return workspace.conversations;
    return workspace.conversations.filter((conversation) =>
      conversation.title.normalize('NFKC').toLocaleLowerCase().includes(query),
    );
  }, [conversationSearchQuery, workspace.conversations]);

  const collapseLeftRail = useCallback(() => {
    window.localStorage.setItem(LEFT_RAIL_STORAGE_KEY, 'true');
    setLeftRailCollapsed(true);
  }, []);

  const expandLeftRail = useCallback(() => {
    window.localStorage.setItem(LEFT_RAIL_STORAGE_KEY, 'false');
    setLeftRailCollapsed(false);
  }, []);

  const collapseRightRail = useCallback(() => {
    window.localStorage.setItem(RIGHT_RAIL_STORAGE_KEY, 'true');
    setRightRailCollapsed(true);
  }, []);

  const expandRightRail = useCallback(() => {
    window.localStorage.setItem(RIGHT_RAIL_STORAGE_KEY, 'false');
    setRightRailCollapsed(false);
  }, []);

  const openAllConversations = useCallback(() => {
    setConversationSearchQuery('');
    setAllConversationsOpen(true);
    setMobilePanel(null);
  }, []);

  const saveCourseProgress = useCallback(
    (completedNotebookCount: number, currentNotebookId: string | null) => {
      const courseId = workspace.course.id;
      const requestId = ++courseProgressSaveRequestRef.current;
      const optimistic: LocalCourseLearningState = {
        courseId,
        completedNotebookCount,
        currentNotebookId,
        updatedAt: Date.now(),
      };
      setCourseLearningState(optimistic);
      setError(null);
      pendingCourseProgressSaveRef.current = {
        courseId,
        completedNotebookCount,
        currentNotebookId,
        updatedAt: optimistic.updatedAt,
        requestId,
        notebookCount: workspace.notebooks.length,
      };
      if (courseProgressSaveRunningRef.current) return;

      courseProgressSaveRunningRef.current = true;
      void (async () => {
        try {
          const repository = await getLocalRepository();
          let pending = pendingCourseProgressSaveRef.current;
          while (pending) {
            pendingCourseProgressSaveRef.current = null;
            try {
              const saved = await repository.saveCourseLearningState(pending);
              if (
                activeCourseIdRef.current === pending.courseId &&
                pending.requestId === courseProgressSaveRequestRef.current
              ) {
                setCourseLearningState(saved);
                setNotice(
                  pending.completedNotebookCount
                    ? `学习进度已保存：完成 ${pending.completedNotebookCount} / ${pending.notebookCount} 本。`
                    : '学习进度已重置为 0%。',
                );
              }
            } catch (cause) {
              if (
                activeCourseIdRef.current === pending.courseId &&
                pending.requestId === courseProgressSaveRequestRef.current
              ) {
                setError(errorMessage(cause));
                const stored = await repository
                  .getCourseLearningState(pending.courseId)
                  .catch(() => null);
                if (
                  activeCourseIdRef.current === pending.courseId &&
                  pending.requestId === courseProgressSaveRequestRef.current
                ) {
                  setCourseLearningState(stored);
                }
              }
            }
            pending = pendingCourseProgressSaveRef.current;
          }
        } catch (cause) {
          const pending = pendingCourseProgressSaveRef.current;
          pendingCourseProgressSaveRef.current = null;
          if (
            pending &&
            activeCourseIdRef.current === pending.courseId &&
            pending.requestId === courseProgressSaveRequestRef.current
          ) {
            setError(errorMessage(cause));
          }
        } finally {
          courseProgressSaveRunningRef.current = false;
        }
      })();
    },
    [workspace.course.id, workspace.notebooks.length],
  );

  const changeAiModel = useCallback((model: SupportedAiModel) => {
    setAiModel(model);
    window.localStorage.setItem(AI_MODEL_STORAGE_KEY, model);
    const label = supportedAiModels.find((item) => item.id === model)?.label || model;
    setNotice(`后续平台 AI 将使用 ${label}。`);
  }, []);

  const closeScheduleEditor = useCallback(() => {
    setScheduleDialogOpen(false);
    setEditingScheduleId(null);
    setScheduleTitle('');
    setScheduleDate('');
    setScheduleNote('');
    setScheduleKind('other');
  }, []);

  const openNewSchedule = useCallback(() => {
    setEditingScheduleId(null);
    setScheduleTitle('');
    setScheduleDate('');
    setScheduleNote('');
    setScheduleKind('other');
    setCalendarDialogOpen(false);
    setCalendarDayItems([]);
    setScheduleDialogOpen(true);
    setMobilePanel(null);
  }, []);

  const openScheduleEditor = useCallback((item: LocalCourseEvent) => {
    setEditingScheduleId(item.id);
    setScheduleTitle(item.title);
    setScheduleDate(item.date);
    setScheduleNote(item.note);
    setScheduleKind(item.kind);
    setCalendarDialogOpen(false);
    setCalendarDayItems([]);
    setScheduleDialogOpen(true);
    setMobilePanel(null);
  }, []);

  const addSchedule = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const title = scheduleTitle.trim();
      if (!title || !scheduleDate || scheduleBusy) return;
      const note = scheduleNote.trim();
      const courseId = workspace.course.id;
      const timestamp = Date.now();
      const existing = editingScheduleId
        ? (scheduleItems.find((scheduleItem) => scheduleItem.id === editingScheduleId) ?? null)
        : null;
      const item: LocalCourseEvent = {
        id: existing?.id ?? crypto.randomUUID(),
        courseId,
        title,
        date: scheduleDate,
        note,
        kind: scheduleKind === 'other' ? inferScheduleKind(`${title}\n${note}`) : scheduleKind,
        source: existing?.source ?? 'manual',
        status: 'active',
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      setScheduleBusy(true);
      setError(null);
      try {
        const repository = await getLocalRepository();
        await repository.upsertCourseEvents([item]);
        if (activeCourseIdRef.current !== courseId) return;
        setScheduleItems((current) => mergeCourseEvents(current, [item]));
        closeScheduleEditor();
        setActiveTool('calendar');
        setNotice(
          existing ? `已更新日程“${item.title}”。` : `已把“${item.title}”保存到本机课程日历。`,
        );
      } catch (cause) {
        if (activeCourseIdRef.current === courseId) setError(errorMessage(cause));
      } finally {
        if (activeCourseIdRef.current === courseId) setScheduleBusy(false);
      }
    },
    [
      closeScheduleEditor,
      editingScheduleId,
      scheduleBusy,
      scheduleDate,
      scheduleItems,
      scheduleKind,
      scheduleNote,
      scheduleTitle,
      workspace.course.id,
    ],
  );

  const deleteSchedule = useCallback(
    async (itemId: string) => {
      if (courseEventMutationIdsRef.current.has(itemId)) return;
      const item = scheduleItems.find((scheduleItem) => scheduleItem.id === itemId);
      if (!item) return;
      const confirmed = window.confirm(`确定删除日程“${item.title}”？`);
      if (!confirmed) return;
      courseEventMutationIdsRef.current.add(itemId);
      const courseId = workspace.course.id;
      setError(null);
      try {
        const repository = await getLocalRepository();
        await repository.deleteCourseEvent(courseId, itemId);
        if (activeCourseIdRef.current === courseId) {
          setScheduleItems((current) => current.filter((item) => item.id !== itemId));
          if (editingScheduleId === itemId) closeScheduleEditor();
          setNotice(`已删除日程“${item.title}”。`);
        }
      } catch (cause) {
        if (activeCourseIdRef.current === courseId) setError(errorMessage(cause));
      } finally {
        courseEventMutationIdsRef.current.delete(itemId);
      }
    },
    [closeScheduleEditor, editingScheduleId, scheduleItems, workspace.course.id],
  );

  const addFiles = useCallback(
    async (files: File[], source: 'attachment' | 'syllabus') => {
      setError(null);
      setNotice(null);
      const selected = files.slice(0, MAX_CHAT_ATTACHMENTS);
      const extractedScheduleItems: LocalCourseEvent[] = [];
      const parseWarnings: string[] = [];
      let importedCount = 0;
      const courseId = workspace.course.id;
      const repository = await getLocalRepository();
      for (const file of selected) {
        if (source === 'syllabus' && !isSupportedSyllabusDocument(file)) {
          setError(
            `“${file.name}”格式不支持；syllabus 当前支持 TXT、Markdown、CSV、PDF、PNG、JPG、WEBP 和 GIF。`,
          );
          continue;
        }
        if (source === 'attachment' && !isSupportedTextFile(file)) {
          setError(
            `“${file.name}”暂不支持本地读取；当前支持 TXT、Markdown、CSV、JSON 和代码文本。`,
          );
          continue;
        }
        const isText = isSupportedTextFile(file);
        const maxBytes =
          source === 'syllabus' && isSupportedSyllabusImage(file)
            ? MAX_SYLLABUS_IMAGE_BYTES
            : source === 'syllabus'
              ? MAX_SYLLABUS_DOCUMENT_BYTES
              : MAX_CHAT_ATTACHMENT_BYTES;
        if (file.size > maxBytes) {
          setError(
            `“${file.name}”超过 ${Math.round(maxBytes / 1024 / 1024) || 0.5} MB，请压缩或拆分后再添加。`,
          );
          continue;
        }

        let text: string;
        if (source === 'syllabus' && !isText) {
          const parsed = await parseSyllabusDocument({
            courseName: workspace.course.name,
            courseDescription: workspace.course.description,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            dataBase64: await fileToBase64(file),
            model: aiModel,
          });
          text = parsedSyllabusMarkdown(file.name, parsed);
          extractedScheduleItems.push(...parsedSyllabusSchedule(parsed, courseId));
          parseWarnings.push(...parsed.warnings);
        } else {
          text = await file.text();
          if (source === 'syllabus') {
            extractedScheduleItems.push(...extractSyllabusSchedule(text, courseId));
          }
        }
        await repository.importTextMaterial({
          courseId,
          name: file.name,
          text,
          source: source === 'syllabus' ? 'syllabus' : 'chat',
        });
        importedCount += 1;
      }
      if (!importedCount) return;
      if (source === 'syllabus') {
        const storedEvents = await repository.listCourseEvents(courseId);
        const existing = new Set(
          storedEvents.map((item) => `${item.date}:${item.title.toLocaleLowerCase()}`),
        );
        const unique = extractedScheduleItems.filter((item) => {
          const key = `${item.date}:${item.title.toLocaleLowerCase()}`;
          if (existing.has(key)) return false;
          existing.add(key);
          return true;
        });
        if (unique.length) await repository.upsertCourseEvents(unique);
        if (activeCourseIdRef.current === courseId) {
          setScheduleItems((current) => mergeCourseEvents(current, unique));
        }
        if (activeCourseIdRef.current === courseId) {
          setActiveTool('calendar');
          setNotice(
            unique.length
              ? `syllabus 已保存到本机资料库，并识别出 ${unique.length} 项日期。${
                  parseWarnings.length ? ` ${parseWarnings[0]}` : ''
                }`
              : `syllabus 已保存到本机资料库，但没有识别到可确认的日期。${
                  parseWarnings.length ? ` ${parseWarnings[0]}` : ''
                }`,
          );
        }
      } else if (activeCourseIdRef.current === courseId) {
        setActiveTool('library');
        setNotice(`${importedCount} 份资料已保存到当前课程的本机资料库，没有发送给模型。`);
      }
      if (activeCourseIdRef.current === courseId) await onWorkspaceChanged();
    },
    [
      aiModel,
      onWorkspaceChanged,
      workspace.course.description,
      workspace.course.id,
      workspace.course.name,
    ],
  );

  const handleAttachmentSelection = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      void addFiles(files, 'attachment').catch((cause) => setError(errorMessage(cause)));
    },
    [addFiles],
  );

  const handleProblemUploadSelection = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (!files.length) return;
      void (async () => {
        setError(null);
        setNotice(null);
        const selected = files.slice(0, MAX_CHAT_ATTACHMENTS);
        const courseId = workspace.course.id;
        const repository = await getLocalRepository();
        let importedCount = 0;
        for (const file of selected) {
          if (!isSupportedTextFile(file)) {
            setError(
              `“${file.name}”暂不支持；题目上传当前支持 TXT、Markdown、CSV、JSON 和代码文本。`,
            );
            continue;
          }
          if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
            setError(`“${file.name}”超过 ${Math.round(MAX_CHAT_ATTACHMENT_BYTES / 1024)} KB。`);
            continue;
          }
          await repository.importTextProblem({
            courseId,
            name: file.name,
            text: await file.text(),
          });
          importedCount += 1;
        }
        if (!importedCount) return;
        if (activeCourseIdRef.current === courseId) {
          setNotice(`已上传 ${importedCount} 道本机题目，可在题库中查看。`);
          await onWorkspaceChanged();
        }
      })().catch((cause) => setError(errorMessage(cause)));
    },
    [onWorkspaceChanged, workspace.course.id],
  );

  const handleNoteUploadSelection = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (!files.length) return;
      void (async () => {
        setError(null);
        setNotice(null);
        const selected = files.slice(0, MAX_CHAT_ATTACHMENTS);
        const courseId = workspace.course.id;
        const repository = await getLocalRepository();
        let importedCount = 0;
        for (const file of selected) {
          if (!isSupportedTextFile(file)) {
            setError(
              `“${file.name}”暂不支持；笔记上传当前支持 TXT、Markdown、CSV、JSON 和代码文本。`,
            );
            continue;
          }
          if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
            setError(`“${file.name}”超过 ${Math.round(MAX_CHAT_ATTACHMENT_BYTES / 1024)} KB。`);
            continue;
          }
          await repository.importTextMaterial({
            courseId,
            name: file.name,
            text: await file.text(),
            source: 'notes',
          });
          importedCount += 1;
        }
        if (!importedCount) return;
        if (activeCourseIdRef.current === courseId) {
          setNotice(`已上传 ${importedCount} 份本机笔记，可在笔记本库中查看。`);
          await onWorkspaceChanged();
        }
      })().catch((cause) => setError(errorMessage(cause)));
    },
    [onWorkspaceChanged, workspace.course.id],
  );

  const handleSyllabusSelection = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (!files.length || syllabusBusy) return;
      const file = files[0];
      const needsPlatformAi = !isSupportedTextFile(file);
      if (needsPlatformAi && !syllabusAvailable) {
        setError(
          platformAiAccess.message || 'PDF / 图片 syllabus 需要平台 AI；也可改用 TXT 或 Markdown。',
        );
        return;
      }
      setSyllabusBusy(true);
      void addFiles(files.slice(0, 1), 'syllabus')
        .catch((cause) => setError(errorMessage(cause)))
        .finally(() => setSyllabusBusy(false));
    },
    [addFiles, platformAiAccess.message, syllabusAvailable, syllabusBusy],
  );

  const createConversation = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const repository = await getLocalRepository();
      const conversation = await repository.createConversation(workspace.course.id, '新对话');
      await onWorkspaceChanged();
      conversationLoadRequestRef.current += 1;
      skipConversationLoadRef.current = conversation.id;
      activeConversationIdRef.current = conversation.id;
      setSelectedConversationId(conversation.id);
      setMessages([]);
      setMobilePanel(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [onWorkspaceChanged, workspace.course.id]);

  const selectConversation = useCallback((conversationId: string) => {
    conversationLoadRequestRef.current += 1;
    skipConversationLoadRef.current = null;
    activeConversationIdRef.current = conversationId;
    setSelectedConversationId(conversationId);
    setMobilePanel(null);
  }, []);

  const saveCourseSettings = useCallback(async () => {
    if (!courseNameDraft.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const repository = await getLocalRepository();
      await repository.updateCourse({
        id: workspace.course.id,
        name: courseNameDraft,
        description: courseDescriptionDraft,
        courseCode: courseCodeDraft || null,
      });
      writeStoredCourseAvatarId(workspace.course.id, courseAvatarIdDraft);
      await onWorkspaceChanged();
      setNotice('课程信息已更新，并保存在当前设备。');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    courseAvatarIdDraft,
    courseCodeDraft,
    courseDescriptionDraft,
    courseNameDraft,
    onWorkspaceChanged,
    workspace.course.id,
  ]);

  const deleteConversation = useCallback(async () => {
    if (!conversationToDelete || busy) return;
    const deleting = conversationToDelete;
    setBusy(true);
    setError(null);
    try {
      const repository = await getLocalRepository();
      await repository.deleteConversation(deleting.id);
      if (selectedConversationId === deleting.id) {
        conversationLoadRequestRef.current += 1;
        skipConversationLoadRef.current = null;
        activeConversationIdRef.current = null;
        setSelectedConversationId(null);
        setMessages([]);
      }
      setConversationToDelete(null);
      await onWorkspaceChanged();
      setNotice(`已删除会话“${deleting.title}”。`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [busy, conversationToDelete, onWorkspaceChanged, selectedConversationId]);

  const openNotebook = useCallback(async (notebook: LocalNotebook) => {
    setResourceBusy(true);
    setError(null);
    try {
      const repository = await getLocalRepository();
      const document = await repository.loadNotebookDocument(notebook.id);
      if (!document) throw new Error('本地找不到这个笔记本。');
      setResource({ kind: 'notebook', document });
      setMobilePanel(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setResourceBusy(false);
    }
  }, []);

  const openProblemBank = useCallback(() => {
    onOpenProblemBank();
    setMobilePanel(null);
  }, [onOpenProblemBank]);

  const openNotebookLibrary = useCallback(() => {
    onOpenNotebookLibrary();
    setMobilePanel(null);
  }, [onOpenNotebookLibrary]);

  const openCalendarDialog = useCallback(() => {
    setCalendarDialogOpen(true);
    setCalendarDayItems([]);
    setMobilePanel(null);
  }, []);

  const openMemoryDialog = useCallback((memoryId: string | null = null) => {
    setFocusedMemoryId(memoryId);
    setMemoryDialogOpen(true);
    setMobilePanel(null);
  }, []);

  const closeMemoryDialog = useCallback(() => {
    setMemoryDialogOpen(false);
    setFocusedMemoryId(null);
  }, []);

  useEffect(() => {
    if (!memoryDialogOpen || !focusedMemoryId) return;
    const frame = window.requestAnimationFrame(() => {
      focusedMemoryRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      focusedMemoryRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedMemoryId, memoryDialogOpen]);

  const showCurrentCalendarMonth = useCallback(() => {
    setCalendarReferenceDate(new Date());
  }, []);

  const showPreviousCalendarMonth = useCallback(() => {
    setCalendarReferenceDate(
      (current) => new Date(current.getFullYear(), current.getMonth() - 1, 1),
    );
  }, []);

  const showNextCalendarMonth = useCallback(() => {
    setCalendarReferenceDate(
      (current) => new Date(current.getFullYear(), current.getMonth() + 1, 1),
    );
  }, []);

  const calendarMonthLabel = useMemo(
    () => formatCalendarMonth(calendarReferenceDate),
    [calendarReferenceDate],
  );
  const calendarDays = useMemo(
    () => buildLearningCalendarDays(calendarReferenceDate, scheduleItems),
    [calendarReferenceDate, scheduleItems],
  );
  const eventsByCalendarDay = useMemo(() => buildEventsByDay(scheduleItems), [scheduleItems]);
  const scheduleIdSet = useMemo(
    () => new Set(scheduleItems.map((item) => item.id)),
    [scheduleItems],
  );
  const isResearchCourse = workspace.course.purpose === 'research';

  const openProblem = useCallback(
    (problem: LocalProblem) => {
      const published = workspace.problems.filter((item) => item.status === 'published');
      const pool = published.some((item) => item.id === problem.id)
        ? published
        : workspace.problems.filter((item) => item.status !== 'archived');
      const ids = (pool.length ? pool : [problem]).map((item) => item.id);
      onOpenPractice({
        problemIds: ids,
        initialProblemId: problem.id,
      });
      setMobilePanel(null);
    },
    [onOpenPractice, workspace.problems],
  );

  const openReviewPlanProblem = useCallback(
    (problemId: string, plan: NativeReviewPlan) => {
      const requestedIds = [...new Set(plan.tasks.flatMap((task) => task.problemIds ?? []))];
      const availableIds = requestedIds.filter((id) =>
        workspace.problems.some((problem) => problem.id === id),
      );
      if (!availableIds.some((id) => id === problemId)) return;
      setReviewPracticeLaunch({
        problemIds: availableIds,
        initialProblemId: problemId,
      });
    },
    [workspace.problems],
  );

  const closeReviewPlanPractice = useCallback(() => {
    setReviewPracticeLaunch(null);
    setReviewPlanStatusRevision((current) => current + 1);
  }, []);

  const toggleReviewPlanCalendar = useCallback(
    async (
      task: NativeReviewPlanTask,
      calendarItem: NativeReviewPlanCalendarItem | null,
      plan: NativeReviewPlan,
    ) => {
      const courseId = workspace.course.id;
      const eventId = reviewPlanEventId(
        courseId,
        plan.id,
        task.id,
        calendarItem?.eventId ?? calendarItem?.id,
      );
      const date = calendarItem?.date ?? task.date;
      if (!date || courseEventMutationIdsRef.current.has(eventId)) return;
      courseEventMutationIdsRef.current.add(eventId);
      const exists = scheduleItems.some((item) => item.id === eventId);
      const timestamp = Date.now();
      const scheduledReview: LocalCourseEvent = {
        id: eventId,
        courseId,
        title: calendarItem?.title ?? task.title,
        date,
        note: `复习计划：${plan.title}\n${calendarItem?.reason ?? task.reason ?? plan.summary ?? ''}`,
        kind: 'progress',
        source: 'review-plan',
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      setError(null);
      try {
        const repository = await getLocalRepository();
        if (exists) {
          await repository.deleteCourseEvent(courseId, eventId);
        } else {
          await repository.upsertCourseEvents([scheduledReview]);
        }
        if (activeCourseIdRef.current !== courseId) return;
        setScheduleItems((current) =>
          exists
            ? current.filter((item) => item.id !== eventId)
            : mergeCourseEvents(current, [scheduledReview]),
        );
      } catch (cause) {
        if (activeCourseIdRef.current === courseId) setError(errorMessage(cause));
      } finally {
        courseEventMutationIdsRef.current.delete(eventId);
      }
    },
    [scheduleItems, workspace.course.id],
  );

  const openSearchResult = useCallback(
    (result: LocalCourseSearchResult) => {
      if (result.type === 'notebook') {
        const notebook = workspace.notebooks.find(({ id }) => id === result.resourceId);
        if (notebook) void openNotebook(notebook);
        return;
      }
      if (result.type === 'problem') {
        const problem = workspace.problems.find(({ id }) => id === result.resourceId);
        if (problem) openProblem(problem);
        return;
      }
      if (result.type === 'memory') {
        openMemoryDialog(result.id);
      }
    },
    [openMemoryDialog, openNotebook, openProblem, workspace.notebooks, workspace.problems],
  );

  const openSyllabusPicker = useCallback(() => {
    syllabusInputRef.current?.click();
  }, []);

  const clearCalendar = useCallback(async () => {
    if (!scheduleItems.length) return;
    const confirmed = window.confirm(
      `确定清空当前课程的 ${scheduleItems.length} 项日程？此操作不会删除已导入的 syllabus 原文。`,
    );
    if (!confirmed) return;
    const courseId = workspace.course.id;
    const eventIds = scheduleItems.map((item) => item.id);
    setError(null);
    try {
      const repository = await getLocalRepository();
      for (const eventId of eventIds) {
        await repository.deleteCourseEvent(courseId, eventId);
      }
      if (activeCourseIdRef.current === courseId) {
        setScheduleItems([]);
        setNotice(`已清空 ${eventIds.length} 项日历安排。`);
      }
    } catch (cause) {
      if (activeCourseIdRef.current === courseId) setError(errorMessage(cause));
    }
  }, [scheduleItems, workspace.course.id]);

  const hasSyllabusUploaded = useMemo(
    () =>
      workspace.notebooks.some((notebook) => notebook.tags.includes('syllabus')) ||
      scheduleItems.some((item) => item.source === 'syllabus'),
    [scheduleItems, workspace.notebooks],
  );

  const openMiniLecture = useCallback(async (deck: PersistedMiniLectureDeck) => {
    const requestId = ++miniLectureLoadRequestRef.current;
    setMiniLectureLoadingDeckId(deck.id);
    setError(null);
    try {
      const repository = await getLocalRepository();
      const runtimeDeck = await repository.loadMiniLectureDeck(deck.id);
      if (!runtimeDeck) throw new Error('本地找不到这份课堂讲解。');
      if (requestId !== miniLectureLoadRequestRef.current) return;
      setActiveMiniLecture(runtimeDeck);
    } catch (cause) {
      if (requestId === miniLectureLoadRequestRef.current) setError(errorMessage(cause));
    } finally {
      if (requestId === miniLectureLoadRequestRef.current) setMiniLectureLoadingDeckId(null);
    }
  }, []);

  const generateMiniLecture = useCallback(
    async (message: LocalMessage) => {
      if (
        message.role !== 'assistant' ||
        miniLectureGenerationByMessageId.get(message.id)?.status === 'running'
      ) {
        return;
      }
      if (!miniLectureAvailable) {
        setError(platformAiAccess.message);
        return;
      }
      const messageIndex = messages.findIndex((item) => item.id === message.id);
      const question =
        messages
          .slice(0, Math.max(0, messageIndex))
          .reverse()
          .find((item) => item.role === 'user')
          ?.text.trim() || '请讲解这段课程内容。';
      setMiniLectureGenerationByMessageId((current) => {
        const next = new Map(current);
        next.set(message.id, {
          status: 'running',
          step: 'image_generation',
        });
        return next;
      });
      setError(null);

      try {
        const idempotencyKey = await miniLectureIdempotencyKey(message, question);
        const sourceEvidence = (message.metadata?.evidence ?? []).slice(0, 12);
        const manifest = await createNativeMiniLecture(
          {
            idempotencyKey,
            course: {
              id: workspace.course.id,
              name: workspace.course.name,
              description: (workspace.course.description || '本机课程').slice(0, 2000),
              courseCode: workspace.course.courseCode ?? undefined,
              purpose: workspace.course.purpose,
            },
            message: { id: message.id, text: question.slice(0, 2000) },
            answer: {
              id: message.id,
              title: `${workspace.course.courseCode || workspace.course.name} 课堂讲解`,
              text: message.text.slice(0, 24_000),
            },
            source: {
              id: `native-context:${message.id}`,
              title: `${workspace.course.name} 本机学习依据`,
              text:
                workspace.course.description ||
                '依据当前对话回答与本机课程上下文生成，不额外上传整库数据。',
              references: sourceEvidence.map((evidence, index) => ({
                id: evidence.id ?? `${message.id}-evidence-${index + 1}`,
                title: (evidence.title ?? evidence.sourceType).slice(0, 240),
                excerpt: (evidence.excerpt ?? evidence.reason ?? '本机学习证据').slice(0, 2000),
              })),
            },
            pageCount: message.text.length > 2600 ? 2 : 1,
            language: workspace.course.language,
            ttsVoice: 'marin',
          },
          { model: aiModel },
        );
        setMiniLectureGenerationByMessageId((current) => {
          const next = new Map(current);
          next.set(message.id, {
            status: 'running',
            step: 'packaging',
            progress: 92,
          });
          return next;
        });

        const repository = await getLocalRepository();
        const savedDeck = await repository.saveMiniLectureDocument(
          miniLectureManifestToPersistence(manifest, message.id),
        );
        const nextMetadata = {
          ...(message.metadata ?? {}),
          schemaVersion: 1 as const,
          lectureDeckId: savedDeck.id,
        };
        await repository.updateMessageMetadata(message.id, nextMetadata);
        setMessages((current) =>
          current.map((item) =>
            item.id === message.id ? { ...item, metadata: nextMetadata } : item,
          ),
        );
        setMiniLectureDecksByMessageId((current) => {
          const next = new Map(current);
          next.set(message.id, savedDeck);
          return next;
        });
        setMiniLectureGenerationByMessageId((current) => {
          const next = new Map(current);
          next.delete(message.id);
          return next;
        });
        await openMiniLecture(savedDeck);
      } catch (cause) {
        const messageText = errorMessage(cause);
        setMiniLectureGenerationByMessageId((current) => {
          const next = new Map(current);
          next.set(message.id, {
            status: 'failed',
            step: 'image_generation',
            error: messageText,
          });
          return next;
        });
      }
    },
    [
      messages,
      aiModel,
      miniLectureGenerationByMessageId,
      miniLectureAvailable,
      openMiniLecture,
      platformAiAccess.message,
      workspace.course.courseCode,
      workspace.course.description,
      workspace.course.id,
      workspace.course.language,
      workspace.course.name,
      workspace.course.purpose,
    ],
  );

  const executeLearningAction = useCallback(
    async (message: LocalMessage, action: NativeLearningAction) => {
      if (busyLearningActionId) return;
      if (
        action.kind === 'classroom.propose_temporary_explanation' ||
        action.kind === 'image.propose_generation'
      ) {
        await generateMiniLecture(message);
        return;
      }

      setBusyLearningActionId(action.id);
      setError(null);
      const payload = payloadRecord(action.payload);
      const nestedEvent = payloadRecord(payload.event);
      const value = Object.keys(nestedEvent).length ? nestedEvent : payload;
      let summary = '';
      let output: Record<string, unknown> | undefined;
      try {
        const repository = await getLocalRepository();
        if (action.kind === 'calendar.propose_add' || action.kind === 'calendar.propose_update') {
          const date = payloadText(value, 'date', 'eventDate', 'scheduledDate');
          if (!date) throw new Error('这个日历提案缺少日期，不能写入本机日历。');
          const requestedEventId = payloadText(value, 'id', 'eventId');
          const scopedEventId = courseScopedEventId(
            workspace.course.id,
            'ai-proposal',
            requestedEventId || `${message.id}:${action.id}`,
          );
          const existingEvent = scheduleItems.find(
            (item) =>
              item.courseId === workspace.course.id &&
              (item.id === scopedEventId ||
                (action.kind === 'calendar.propose_update' &&
                  requestedEventId &&
                  item.id === requestedEventId)),
          );
          const eventId = existingEvent?.id ?? scopedEventId;
          const timestamp = Date.now();
          const courseEvent: LocalCourseEvent = {
            id: eventId,
            courseId: workspace.course.id,
            title: payloadText(value, 'title', 'label') || action.label,
            date,
            note: payloadText(value, 'note', 'reason', 'summary') || action.summary || '',
            kind: isLocalCourseEventKind(value.kind) ? value.kind : 'other',
            source: 'ai-proposal',
            status: 'active',
            createdAt: existingEvent?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          await repository.upsertCourseEvents([courseEvent]);
          setScheduleItems((current) => mergeCourseEvents(current, [courseEvent]));
          summary = `已写入本机日历：${courseEvent.title}`;
          output = { eventId };
        } else if (action.kind === 'calendar.propose_delete') {
          const requestedEventId = payloadText(value, 'id', 'eventId');
          if (!requestedEventId) throw new Error('这个删除提案缺少明确的日历事项 ID。');
          const scopedEventId = courseScopedEventId(
            workspace.course.id,
            'ai-proposal',
            requestedEventId,
          );
          const event = scheduleItems.find(
            (item) =>
              item.courseId === workspace.course.id &&
              (item.id === requestedEventId || item.id === scopedEventId),
          );
          if (!event) throw new Error('当前课程中找不到这个日历事项，未执行删除。');
          const eventId = event.id;
          await repository.deleteCourseEvent(workspace.course.id, eventId);
          setScheduleItems((current) => current.filter((item) => item.id !== eventId));
          summary = '已从本机日历删除指定事项。';
          output = { eventId };
        } else if (action.kind === 'calendar.search' || action.kind === 'calendar.start_recent') {
          setCalendarDialogOpen(true);
          summary = '已打开本机课程日历。';
        } else if (action.kind === 'memory.search') {
          openMemoryDialog();
          summary = '已打开本机学习记忆。';
        } else if (action.kind === 'memory.propose_write') {
          const candidate = payloadRecord(payload.memory ?? payload.candidate);
          const memoryValue = Object.keys(candidate).length ? candidate : payload;
          const text = payloadText(memoryValue, 'text', 'content', 'summary');
          if (!text) throw new Error('这个记忆提案缺少可写入的学习结论。');
          const timestamp = Date.now();
          const memory = await repository.upsertStudyMemory({
            id:
              payloadText(memoryValue, 'id', 'memoryId') || `native-memory-${crypto.randomUUID()}`,
            courseId: workspace.course.id,
            notebookId: payloadText(memoryValue, 'notebookId') || null,
            targetType: payloadText(memoryValue, 'targetType') || 'course',
            scope: payloadText(memoryValue, 'scope') || 'course',
            kind: payloadText(memoryValue, 'kind') || 'learner_state',
            status: 'active',
            source: 'ai-proposal-confirmed',
            title: payloadText(memoryValue, 'title') || action.label,
            text,
            reason: payloadText(memoryValue, 'reason') || action.summary || null,
            question: payloadText(memoryValue, 'question') || null,
            sourceReferences: Array.isArray(memoryValue.sourceReferences)
              ? memoryValue.sourceReferences
              : (message.metadata?.evidence ?? []),
            confidence: typeof memoryValue.confidence === 'number' ? memoryValue.confidence : null,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          await onWorkspaceChanged();
          summary = `已写入本机学习记忆：${memory.title}`;
          output = { memoryId: memory.id };
        } else if (action.kind === 'practice.propose_generation') {
          const selectedIds = message.metadata?.problemSelection?.problems.map(
            (problem) => problem.problemId,
          );
          const problemIds = [
            ...new Set([...payloadStringList(payload.problemIds), ...(selectedIds ?? [])]),
          ].filter((problemId) => workspace.problems.some((problem) => problem.id === problemId));
          if (!problemIds.length) {
            throw new Error('平台没有返回可绑定到本机题库的真实题号，因此没有临时生成题目。');
          }
          setReviewPracticeLaunch({
            problemIds,
            initialProblemId: problemIds[0],
          });
          summary = `已打开 ${problemIds.length} 道本机题库练习。`;
          output = { problemIds };
        } else if (action.kind === 'review_mode.request_choice') {
          setDraft('我想要讲解后再练题，请按这个方式继续。');
          summary = '已把复习方式带回输入框，仍由你确认发送。';
        } else if (action.kind === 'learner_progress.request_confirmation') {
          setDraft(
            payloadText(payload, 'question', 'prompt') || '请根据我的本机记录确认学习进度。',
          );
          summary = '已把进度确认问题带回输入框。';
        } else if (action.kind === 'web.search') {
          summary = '联网检索必须由平台在教学回合中完成；当前只展示已返回的检索证据。';
          setNotice(summary);
        } else {
          throw new Error('这个教学动作尚没有原生执行器。');
        }

        const nextAction: NativeLearningAction = {
          ...action,
          status: 'completed',
          result: {
            status: 'completed',
            executor: 'native-client',
            executedAt: Date.now(),
            summary,
            input: payload,
            output,
          },
        };
        const nextMetadata = {
          ...(message.metadata ?? {}),
          schemaVersion: 1 as const,
          learningActions: (message.metadata?.learningActions ?? []).map((item) =>
            item.id === action.id ? nextAction : item,
          ),
        };
        await repository.updateMessageMetadata(message.id, nextMetadata);
        setMessages((current) =>
          current.map((item) =>
            item.id === message.id ? { ...item, metadata: nextMetadata } : item,
          ),
        );
        setNotice(summary);
      } catch (cause) {
        const failure = errorMessage(cause);
        const nextMetadata = {
          ...(message.metadata ?? {}),
          schemaVersion: 1 as const,
          learningActions: (message.metadata?.learningActions ?? []).map((item) =>
            item.id === action.id
              ? {
                  ...item,
                  status: 'failed' as const,
                  result: {
                    status: 'failed' as const,
                    executor: 'native-client' as const,
                    executedAt: Date.now(),
                    summary: failure,
                    input: payload,
                    error: failure,
                  },
                }
              : item,
          ),
        };
        const repository = await getLocalRepository();
        await repository.updateMessageMetadata(message.id, nextMetadata).catch(() => undefined);
        setMessages((current) =>
          current.map((item) =>
            item.id === message.id ? { ...item, metadata: nextMetadata } : item,
          ),
        );
        setError(failure);
      } finally {
        setBusyLearningActionId(null);
      }
    },
    [
      busyLearningActionId,
      generateMiniLecture,
      onWorkspaceChanged,
      openMemoryDialog,
      scheduleItems,
      workspace.course.id,
      workspace.problems,
    ],
  );

  const send = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text || busy) return;
      if (!teachingTurnAvailable) {
        setError(platformAiAccess.message);
        return;
      }
      setBusy(true);
      setError(null);
      setDraft('');
      let userMessage: LocalMessage | null = null;
      let optimisticAssistantId: string | null = null;
      try {
        const repository = await getLocalRepository();
        let conversationId = selectedConversationId;
        if (!conversationId) {
          const conversation = await repository.createConversation(
            workspace.course.id,
            text.slice(0, 24),
          );
          conversationId = conversation.id;
          conversationLoadRequestRef.current += 1;
          skipConversationLoadRef.current = conversation.id;
          activeConversationIdRef.current = conversation.id;
          setSelectedConversationId(conversation.id);
        }
        userMessage = await repository.appendMessage({
          conversationId,
          role: 'user',
          text,
        });
        const history = [...messages, userMessage].slice(-12);
        optimisticAssistantId = `stream-${crypto.randomUUID()}`;
        const optimisticAssistant: LocalMessage = {
          id: optimisticAssistantId,
          conversationId,
          role: 'assistant',
          text: '',
          createdAt: Date.now(),
        };
        setMessages((current) => [...current, userMessage!, optimisticAssistant]);
        await onWorkspaceChanged();

        const orderedProgressNotebooks = orderCourseNotebooks(workspace.notebooks);
        const completedNotebookCount = Math.min(
          orderedProgressNotebooks.length,
          Math.max(0, courseLearningState?.completedNotebookCount ?? 0),
        );
        const readableNotebooks = orderedProgressNotebooks.slice(0, completedNotebookCount);
        const readableNotebookIds = new Set(readableNotebooks.map((notebook) => notebook.id));
        const recentReadableNotebooks = readableNotebooks.slice(-8);
        const readableMemories = workspace.memories.filter(
          (memory) => !memory.notebookId || readableNotebookIds.has(memory.notebookId),
        );
        const [problemProgress, notebookDocuments] = await Promise.all([
          repository.listProblemProgress(workspace.course.id),
          Promise.all(
            recentReadableNotebooks.map((notebook) => repository.loadNotebookDocument(notebook.id)),
          ),
        ]);
        const progressByProblemId = new Map(
          problemProgress.map((progress) => [progress.problemId, progress]),
        );
        const recentProblemDocuments = await Promise.all(
          problemProgress
            .filter((progress) => Boolean(progress.latestAttemptId))
            .slice(0, 12)
            .map((progress) => repository.loadProblemDocument(progress.problemId)),
        );
        const recentAttemptContext = recentProblemDocuments
          .flatMap((document) => {
            if (!document) return [];
            const progress = progressByProblemId.get(document.problem.id);
            return document.attempts.slice(0, 2).map((attempt) => {
              const result = attempt.result ?? {};
              return {
                id: attempt.id,
                problemId: document.problem.id,
                problemTitle: document.problem.title.slice(0, 300),
                problemType: document.problem.type,
                status: attempt.status.slice(0, 80),
                score: attempt.score,
                attemptedCount: progress?.attemptedCount,
                passedCount: progress?.passedCount,
                answer: boundedJson(attempt.answer, 2_400),
                feedback: payloadText(result, 'feedback').slice(0, 1_200),
                attemptedAt: new Date(attempt.createdAt).toISOString(),
              };
            });
          })
          .sort((left, right) => right.attemptedAt.localeCompare(left.attemptedAt))
          .slice(0, 16);
        const notebookExcerpts = notebookDocuments.flatMap((document) => {
          if (!document) return [];
          const markdown = document.markdownSections
            .slice(0, 4)
            .map((section) => `## ${section.title}\n${section.markdown}`)
            .join('\n\n')
            .slice(0, 8000);
          const pageSummary = document.pages
            .slice(0, 4)
            .map((page) => `${page.title}\n${boundedJson(page.content)}`)
            .join('\n\n')
            .slice(0, 8000);
          const content = markdown || pageSummary;
          return content
            ? [
                {
                  id: document.notebook.id,
                  title: document.notebook.name,
                  content,
                  sourceRef: `native-notebook:${document.notebook.id}`,
                },
              ]
            : [];
        });
        const result = await streamAssistantReply(
          {
            requestId: optimisticAssistantId,
            courseId: workspace.course.id,
            courseName: workspace.course.name,
            courseCode: workspace.course.courseCode,
            courseDescription: workspace.course.description,
            conversationId,
            messages: history,
            model: aiModel,
            localContext: {
              calendarEvents: scheduleItems.slice(0, 120),
              memories: [
                {
                  id: `course-progress:${workspace.course.id}`,
                  title: '课程学习进度',
                  kind: 'course_progress',
                  text: `已完成 ${courseLearningState?.completedNotebookCount ?? 0} / ${workspace.notebooks.length} 本笔记本（${
                    workspace.notebooks.length
                      ? Math.round(
                          ((courseLearningState?.completedNotebookCount ?? 0) /
                            workspace.notebooks.length) *
                            100,
                        )
                      : 0
                  }%）。`,
                  currentNotebookId: courseLearningState?.currentNotebookId ?? null,
                  readableNotebookIds: readableNotebooks.map((notebook) => notebook.id),
                  scopeRule:
                    'Only use notebook content and notebook-scoped memories at or before the saved learning progress.',
                  updatedAt: courseLearningState?.updatedAt ?? Date.now(),
                },
                ...readableMemories,
              ].slice(0, 40),
              attempts: recentAttemptContext,
              problemCandidates: workspace.problems
                .filter((problem) => problem.status !== 'archived')
                .slice(0, 40)
                .map((problem) => ({
                  id: problem.id,
                  problemId: problem.id,
                  title: problem.title,
                  type: problem.type,
                  difficulty: problem.difficulty,
                  tags: problem.tags,
                  excerpt: boundedJson(problem.publicContent),
                  latestAttemptStatus: progressByProblemId.get(problem.id)?.status ?? null,
                })),
              notebookExcerpts,
              sourceExcerpts: [],
              recentPlans: messages
                .flatMap((message) =>
                  message.metadata?.reviewPlan ? [message.metadata.reviewPlan] : [],
                )
                .slice(-8),
            },
          },
          (delta) =>
            setMessages((current) => {
              if (activeConversationIdRef.current !== conversationId) return current;
              return current.map((message) =>
                message.id === optimisticAssistantId
                  ? { ...message, text: `${message.text}${delta}` }
                  : message,
              );
            }),
        );
        const assistantMessage = await repository.appendMessage({
          conversationId,
          role: 'assistant',
          text: result.text,
          metadata: result.metadata,
        });
        setMessages((current) => {
          if (activeConversationIdRef.current !== conversationId) return current;
          if (!current.some((message) => message.id === optimisticAssistantId)) {
            return [...current, assistantMessage];
          }
          return current.map((message) =>
            message.id === optimisticAssistantId ? assistantMessage : message,
          );
        });
        await onWorkspaceChanged();
      } catch (cause) {
        if (!userMessage) setDraft(text);
        if (optimisticAssistantId) {
          setMessages((current) =>
            current.filter((message) => message.id !== optimisticAssistantId),
          );
        }
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
      }
    },
    [
      aiModel,
      busy,
      courseLearningState,
      draft,
      messages,
      onWorkspaceChanged,
      platformAiAccess.message,
      selectedConversationId,
      workspace.course.description,
      workspace.course.courseCode,
      workspace.course.id,
      workspace.course.name,
      workspace.memories,
      workspace.notebooks,
      workspace.problems,
      scheduleItems,
      teachingTurnAvailable,
    ],
  );

  const sessionPanel = (
    <SessionsPanel
      conversations={workspace.conversations}
      selectedConversationId={selectedConversationId}
      busy={busy}
      onBack={onBack}
      onCollapse={collapseLeftRail}
      onCreateConversation={() => void createConversation()}
      onDeleteConversation={setConversationToDelete}
      onShowAllConversations={openAllConversations}
      onSelectConversation={selectConversation}
    />
  );

  const toolsPanel = (
    <CourseToolsPanel
      workspace={workspace}
      activeTool={activeTool}
      backendLabel={backendLabel}
      courseLearningState={courseLearningState}
      platformAiAccess={platformAiAccess}
      librarySearchBusy={librarySearchBusy}
      librarySearchQuery={librarySearchQuery}
      librarySearchResults={librarySearchResults}
      scheduleItems={scheduleItems}
      syllabusBusy={syllabusBusy}
      hasSyllabusUploaded={hasSyllabusUploaded}
      onAddSchedule={openNewSchedule}
      onClearCalendar={() => void clearCalendar()}
      onCollapse={collapseRightRail}
      onDeleteSchedule={deleteSchedule}
      onEditSchedule={openScheduleEditor}
      onCourseProgressChange={saveCourseProgress}
      onOpenCalendar={openCalendarDialog}
      onOpenNotebook={(notebook) => void openNotebook(notebook)}
      onOpenNotebookLibrary={openNotebookLibrary}
      onOpenProblemBank={openProblemBank}
      onOpenSearchResult={openSearchResult}
      onSearchQueryChange={setLibrarySearchQuery}
      onSaveCourseSettings={() => void saveCourseSettings()}
      onToolChange={setActiveTool}
      onUploadNotes={() => noteUploadInputRef.current?.click()}
      onUploadProblems={() => problemUploadInputRef.current?.click()}
      onUploadSyllabus={openSyllabusPicker}
      courseNameDraft={courseNameDraft}
      courseCodeDraft={courseCodeDraft}
      courseDescriptionDraft={courseDescriptionDraft}
      courseAvatarIdDraft={courseAvatarIdDraft}
      onCourseNameDraftChange={setCourseNameDraft}
      onCourseCodeDraftChange={setCourseCodeDraft}
      onCourseDescriptionDraftChange={setCourseDescriptionDraft}
      onOpenAvatarPicker={openAvatarPicker}
      courseSettingsBusy={busy}
    />
  );

  const compactSessionPanel = (
    <div className="compact-workspace-rail">
      <button type="button" onClick={onBack} aria-label="返回 Learn 首页">
        <ArrowLeft size={17} />
      </button>
      <button type="button" onClick={expandLeftRail} aria-label="展开会话历史">
        <ChevronRight size={17} />
      </button>
      <button
        type="button"
        onClick={() => void createConversation()}
        disabled={busy}
        aria-label="新对话"
      >
        <Plus size={17} />
      </button>
      <button type="button" onClick={openAllConversations} aria-label="搜索全部会话">
        <Search size={17} />
      </button>
    </div>
  );

  const compactToolsPanel = (
    <div className="compact-workspace-rail">
      <button type="button" onClick={expandRightRail} aria-label="展开课程工具">
        <ChevronLeft size={17} />
      </button>
      <nav aria-label="课程工具">
        {courseTools.map(({ id, label, Icon }) => (
          <button
            type="button"
            key={id}
            className={activeTool === id ? 'compact-rail-active' : undefined}
            onClick={() => {
              setActiveTool(id);
              expandRightRail();
            }}
            aria-label={label}
          >
            <Icon size={17} />
          </button>
        ))}
      </nav>
    </div>
  );

  return (
    <section
      className={`course-workspace${leftRailCollapsed ? ' workspace-left-collapsed' : ''}${
        rightRailCollapsed ? ' workspace-right-collapsed' : ''
      }`}
      aria-label={`${workspace.course.name} 课程工作台`}
    >
      <aside className="workspace-sidebar workspace-sidebar-left">
        {leftRailCollapsed ? compactSessionPanel : sessionPanel}
      </aside>

      <main className="conversation-workspace">
        <header className="conversation-header">
          <div className="compact-nav-actions">
            <button
              type="button"
              className="round-outline-button"
              onClick={() => setMobilePanel('sessions')}
              aria-label="打开会话历史"
            >
              <Menu size={17} />
            </button>
          </div>

          <img
            className="conversation-course-avatar"
            src={resolveNativeCourseAvatar(
              workspace.course.id,
              workspace.course.courseCode,
              courseAvatarIdDraft,
            )}
            alt=""
            aria-hidden
          />
          <div className="conversation-course-copy">
            <div className="conversation-course-title">
              <h1>{workspace.course.courseCode || workspace.course.name}</h1>
              <span>当前课程上下文</span>
            </div>
            <div className="course-status-pills" role="status">
              <span>
                <CircleGauge size={10} />
                课程 本机
              </span>
              <span className="status-ready">
                <CheckCircle2 size={10} />
                对话 本机
              </span>
              <button
                type="button"
                className="status-ready"
                onClick={openProblemBank}
                title="打开题库"
              >
                <CheckCircle2 size={10} />
                题库 {workspace.problems.length}
              </button>
              <button type="button" onClick={openNotebookLibrary} title="打开笔记本库">
                <CircleGauge size={10} />
                笔记本 {workspace.notebooks.length}
              </button>
            </div>
          </div>

          <div className="conversation-header-spacer" />
          <button
            type="button"
            className="memory-orb"
            onClick={() => openMemoryDialog()}
            aria-label={`打开学习记忆，共 ${workspace.memories.length} 条`}
            title="学习记忆"
          >
            <span />
            {workspace.memories.length ? <small>{workspace.memories.length}</small> : null}
          </button>
          <button
            type="button"
            className="round-outline-button compact-tools-button"
            onClick={() => setMobilePanel('tools')}
            aria-label="打开课程工具"
          >
            <SlidersHorizontal size={17} />
          </button>
        </header>

        <div className="conversation-content">
          {messages.length === 0 ? (
            <div className="conversation-empty-state">
              <span className="conversation-empty-glow" aria-hidden />
              <img
                src={resolveNativeCourseAvatar(
                  workspace.course.id,
                  workspace.course.courseCode,
                  courseAvatarIdDraft,
                )}
                className="conversation-empty-avatar"
                alt=""
                aria-hidden
              />
              <p className="empty-kicker">LEARNING</p>
              <h2>今天想从哪里开始？</h2>
              <p>补齐 syllabus 和学习进度后，今天的安排会更准。</p>
              <div className="suggestion-row">
                {[
                  '我现在学到哪里了？',
                  '帮我安排今天复习',
                  '给我开一个小测',
                  '我最近哪里最薄弱？',
                ].map((suggestion) => (
                  <button type="button" key={suggestion} onClick={() => setDraft(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-stream" aria-label={selectedConversation?.title || '当前会话'}>
              {messages.map((message) => {
                const miniLecture =
                  message.role === 'assistant'
                    ? (miniLectureDecksByMessageId.get(message.id) ?? null)
                    : null;
                const miniLectureGeneration = miniLectureGenerationByMessageId.get(message.id) ?? {
                  status: 'idle' as const,
                };
                const nonLectureActions = (message.metadata?.learningActions ?? []).filter(
                  (action) =>
                    action.kind !== 'classroom.propose_temporary_explanation' &&
                    action.kind !== 'image.propose_generation',
                );
                return (
                  <article className={`chat-message chat-message-${message.role}`} key={message.id}>
                    {message.role !== 'user' ? (
                      <img
                        src={resolveNativeCourseAvatar(
                          workspace.course.id,
                          workspace.course.courseCode,
                          courseAvatarIdDraft,
                        )}
                        alt=""
                        aria-hidden
                      />
                    ) : null}
                    <div>
                      {message.id.startsWith('stream-') && !message.text ? (
                        <span className="assistant-thinking">
                          <Loader2 size={13} />
                          正在组织回复…
                        </span>
                      ) : (
                        <ChatMessageContent message={message} />
                      )}
                      {message.metadata?.reviewPlan ? (
                        <NativeReviewPlanCard
                          courseId={workspace.course.id}
                          plan={message.metadata.reviewPlan}
                          problems={workspace.problems}
                          addedScheduleIds={scheduleIdSet}
                          statusRevision={reviewPlanStatusRevision}
                          onOpenProblem={openReviewPlanProblem}
                          onToggleCalendar={toggleReviewPlanCalendar}
                        />
                      ) : null}
                      {nonLectureActions.length ? (
                        <NativeLearningActions
                          actions={nonLectureActions}
                          busyActionId={busyLearningActionId}
                          onExecute={(action) => void executeLearningAction(message, action)}
                        />
                      ) : null}
                      {miniLecture ? (
                        <MiniLectureInviteCard
                          deck={miniLecture}
                          busy={miniLectureLoadingDeckId === miniLecture.id}
                          onOpen={() => void openMiniLecture(miniLecture)}
                        />
                      ) : isLectureEligibleMessage(message) ? (
                        <MiniLectureGenerateCard
                          state={miniLectureGeneration}
                          disabled={!miniLectureAvailable}
                          unavailableReason={platformAiAccess.message}
                          onGenerate={() => void generateMiniLecture(message)}
                        />
                      ) : null}
                      <time>{formatRelativeTime(message.createdAt)}</time>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <footer className="conversation-composer-footer">
          <form className="conversation-composer" onSubmit={(event) => void send(event)}>
            <button
              type="button"
              className="composer-icon-button"
              onClick={() => attachmentInputRef.current?.click()}
              aria-label="添加本机资料"
              title="导入到当前课程的本机资料库"
            >
              <Paperclip size={17} />
            </button>
            <textarea
              rows={1}
              maxLength={4000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                teachingTurnAvailable
                  ? `问 ${workspace.course.courseCode || workspace.course.name} 一个问题`
                  : platformAiAccess.message
              }
            />
            <button
              type="button"
              className="model-chip"
              onClick={() => {
                setActiveTool('settings');
                expandRightRail();
                if (window.matchMedia('(max-width: 1120px)').matches) setMobilePanel('tools');
              }}
            >
              <Cpu size={13} />
              <span>
                {teachingTurnAvailable
                  ? `OpenAI · ${aiModel
                      .replace('gpt-5.6-', '')
                      .replace(/^./, (value) => value.toUpperCase())}`
                  : platformAiAccess.status === 'checking'
                    ? '正在检查平台 AI'
                    : platformAiAccess.status === 'unauthorized'
                      ? '平台 AI · 需登录'
                      : '平台 AI · 暂不可用'}
              </span>
              <ChevronRight size={13} />
            </button>
            <button
              type="submit"
              className="composer-send-button"
              disabled={!draft.trim() || busy || !teachingTurnAvailable}
              aria-label={teachingTurnAvailable ? '发送' : platformAiAccess.message}
              title={teachingTurnAvailable ? undefined : platformAiAccess.message}
            >
              <SendHorizontal size={17} />
            </button>
          </form>
          {notice ? <p className="composer-notice">{notice}</p> : null}
          {error ? <p className="composer-error">{error}</p> : null}
        </footer>
      </main>

      <aside className="workspace-sidebar workspace-sidebar-right">
        {rightRailCollapsed ? compactToolsPanel : toolsPanel}
      </aside>

      {mobilePanel ? (
        <div className="mobile-panel-layer">
          <button
            type="button"
            className="mobile-panel-backdrop"
            onClick={() => setMobilePanel(null)}
            aria-label="关闭面板"
          />
          <aside
            className={`mobile-slide-panel mobile-slide-panel-${mobilePanel}`}
            aria-label={mobilePanel === 'sessions' ? '会话历史' : '课程工具'}
          >
            {mobilePanel === 'sessions' ? (
              <SessionsPanel
                conversations={workspace.conversations}
                selectedConversationId={selectedConversationId}
                busy={busy}
                onBack={onBack}
                onClose={() => setMobilePanel(null)}
                onCreateConversation={() => void createConversation()}
                onDeleteConversation={setConversationToDelete}
                onShowAllConversations={openAllConversations}
                onSelectConversation={selectConversation}
              />
            ) : (
              <CourseToolsPanel
                workspace={workspace}
                activeTool={activeTool}
                backendLabel={backendLabel}
                courseLearningState={courseLearningState}
                platformAiAccess={platformAiAccess}
                librarySearchBusy={librarySearchBusy}
                librarySearchQuery={librarySearchQuery}
                librarySearchResults={librarySearchResults}
                scheduleItems={scheduleItems}
                syllabusBusy={syllabusBusy}
                hasSyllabusUploaded={hasSyllabusUploaded}
                onAddSchedule={openNewSchedule}
                onClearCalendar={() => void clearCalendar()}
                onClose={() => setMobilePanel(null)}
                onDeleteSchedule={deleteSchedule}
                onEditSchedule={openScheduleEditor}
                onCourseProgressChange={saveCourseProgress}
                onOpenCalendar={openCalendarDialog}
                onOpenNotebook={(notebook) => void openNotebook(notebook)}
                onOpenNotebookLibrary={openNotebookLibrary}
                onOpenProblemBank={openProblemBank}
                onOpenSearchResult={openSearchResult}
                onSearchQueryChange={setLibrarySearchQuery}
                onSaveCourseSettings={() => void saveCourseSettings()}
                onToolChange={setActiveTool}
                onUploadNotes={() => noteUploadInputRef.current?.click()}
                onUploadProblems={() => problemUploadInputRef.current?.click()}
                onUploadSyllabus={openSyllabusPicker}
                courseNameDraft={courseNameDraft}
                courseCodeDraft={courseCodeDraft}
                courseDescriptionDraft={courseDescriptionDraft}
                courseAvatarIdDraft={courseAvatarIdDraft}
                onCourseNameDraftChange={setCourseNameDraft}
                onCourseCodeDraftChange={setCourseCodeDraft}
                onCourseDescriptionDraftChange={setCourseDescriptionDraft}
                onOpenAvatarPicker={openAvatarPicker}
                courseSettingsBusy={busy}
              />
            )}
          </aside>
        </div>
      ) : null}

      {allConversationsOpen ? (
        <div className="native-dialog-layer">
          <button
            type="button"
            className="native-dialog-backdrop"
            onClick={() => setAllConversationsOpen(false)}
            aria-label="关闭全部会话"
          />
          <section
            className="native-action-dialog native-conversation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="native-all-conversations-title"
          >
            <header>
              <div>
                <span>当前课程</span>
                <h2 id="native-all-conversations-title">全部会话</h2>
              </div>
              <button
                type="button"
                className="round-ghost-button"
                onClick={() => setAllConversationsOpen(false)}
                aria-label="关闭"
              >
                <X size={17} />
              </button>
            </header>
            <label className="native-dialog-search">
              <Search size={16} />
              <input
                type="search"
                value={conversationSearchQuery}
                onChange={(event) => setConversationSearchQuery(event.target.value)}
                placeholder="搜索会话标题"
                autoFocus
              />
            </label>
            <nav className="native-conversation-results" aria-label="全部课程会话">
              {filteredConversations.length ? (
                filteredConversations.map((conversation) => (
                  <button
                    type="button"
                    key={conversation.id}
                    className={
                      conversation.id === selectedConversationId
                        ? 'native-conversation-result native-conversation-result-active'
                        : 'native-conversation-result'
                    }
                    onClick={() => {
                      selectConversation(conversation.id);
                      setAllConversationsOpen(false);
                    }}
                  >
                    <MessageCircle size={15} />
                    <span>
                      <strong>{conversation.title}</strong>
                      <small>{formatRelativeTime(conversation.updatedAt)}</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))
              ) : (
                <p className="native-dialog-empty">没有找到匹配的会话。</p>
              )}
            </nav>
            <footer>
              <span>共 {workspace.conversations.length} 个会话</span>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setAllConversationsOpen(false);
                  void createConversation();
                }}
                disabled={busy}
              >
                <Plus size={15} />
                新对话
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <MiniLectureClassroom
        key={
          activeMiniLecture
            ? `${activeMiniLecture.id}:${activeMiniLecture.updatedAt}`
            : 'closed-mini-lecture'
        }
        deck={activeMiniLecture}
        onClose={() => {
          miniLectureLoadRequestRef.current += 1;
          setMiniLectureLoadingDeckId(null);
          setActiveMiniLecture(null);
        }}
      />
      <NativeWorkspaceDialog
        open={Boolean(reviewPracticeLaunch)}
        onClose={closeReviewPlanPractice}
        title="MAT136 复习题"
        description="在弹窗中完成复习计划选择的本地题目。"
        className="native-review-practice-dialog"
      >
        {reviewPracticeLaunch ? (
          <ProblemPracticePage
            problems={workspace.problems}
            launch={reviewPracticeLaunch}
            onBack={closeReviewPlanPractice}
          />
        ) : null}
      </NativeWorkspaceDialog>

      {memoryDialogOpen ? (
        <NativeWorkspaceDialog
          open={memoryDialogOpen}
          onClose={closeMemoryDialog}
          title="学习记忆"
          description="查看平台对本课程学习状态的理解。"
          labelledBy="native-memory-title"
        >
          <div className="native-workspace-panel">
            <header className="native-workspace-panel-header">
              <div>
                <h2 id="native-memory-title">学习记忆</h2>
                <p>用于记录掌握点、薄弱点和下一步学习动作。</p>
              </div>
              <button
                type="button"
                className="round-ghost-button"
                onClick={closeMemoryDialog}
                aria-label="关闭"
              >
                <X size={17} />
              </button>
            </header>
            <div className="native-workspace-panel-body">
              <div className="native-memory-summary">
                <span>
                  <Brain size={18} />
                </span>
                <div>
                  <strong>{workspace.memories.length} 条本机记忆</strong>
                  <small>仅保存在当前设备。</small>
                </div>
              </div>
              <div className="native-memory-list">
                {workspace.memories.length ? (
                  [...workspace.memories]
                    .sort((left, right) => {
                      if (left.id === focusedMemoryId) return -1;
                      if (right.id === focusedMemoryId) return 1;
                      return right.updatedAt - left.updatedAt;
                    })
                    .map((memory) => (
                      <article
                        key={memory.id}
                        ref={memory.id === focusedMemoryId ? focusedMemoryRef : undefined}
                        className={memory.id === focusedMemoryId ? 'is-focused' : undefined}
                        tabIndex={memory.id === focusedMemoryId ? -1 : undefined}
                      >
                        <header>
                          <span>{memory.kind || memory.targetType || '学习状态'}</span>
                          <time>{formatRelativeTime(memory.updatedAt)}</time>
                        </header>
                        <h3>{memory.title}</h3>
                        <p>{memory.text}</p>
                        {memory.reason ? <small>{memory.reason}</small> : null}
                      </article>
                    ))
                ) : (
                  <p className="native-dialog-empty">
                    当前课程还没有学习记忆。完成对话、做题或确认学习进度后会逐步积累。
                  </p>
                )}
              </div>
            </div>
          </div>
        </NativeWorkspaceDialog>
      ) : null}

      {avatarDialogOpen ? (
        <div className="native-dialog-layer">
          <button
            type="button"
            className="native-dialog-backdrop"
            onClick={() => setAvatarDialogOpen(false)}
            aria-label="关闭头像选择"
          />
          <section
            className="native-action-dialog native-avatar-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="native-avatar-dialog-title"
          >
            <header>
              <div>
                <span>当前课程</span>
                <h2 id="native-avatar-dialog-title">更换课程头像</h2>
              </div>
              <button
                type="button"
                className="round-ghost-button"
                onClick={() => setAvatarDialogOpen(false)}
                aria-label="关闭"
              >
                <X size={17} />
              </button>
            </header>
            <p className="native-avatar-dialog-copy">
              选择一张头像后确认；仍需在侧边栏点击保存才会写入本机。
            </p>
            <div className="native-avatar-preview-row">
              <div className="native-avatar-preview">
                <img
                  src={resolveNativeCourseAvatar(
                    workspace.course.id,
                    courseCodeDraft || workspace.course.courseCode,
                    avatarPickerId,
                  )}
                  alt=""
                  aria-hidden
                />
                <div>
                  <strong>预览</strong>
                  <small>
                    {avatarPickerPage + 1} / {avatarPageCount}
                  </small>
                </div>
              </div>
              <div className="native-avatar-preview-actions">
                <button
                  type="button"
                  className="round-outline-button"
                  onClick={() => setAvatarPickerId(pickRandomCourseAvatarId())}
                  aria-label="随机头像"
                >
                  <Dices size={15} />
                </button>
                <button
                  type="button"
                  className="round-outline-button"
                  disabled={avatarPickerPage <= 0}
                  onClick={() => setAvatarPickerPage((page) => Math.max(0, page - 1))}
                  aria-label="上一页头像"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button"
                  className="round-outline-button"
                  disabled={avatarPickerPage >= avatarPageCount - 1}
                  onClick={() =>
                    setAvatarPickerPage((page) => Math.min(avatarPageCount - 1, page + 1))
                  }
                  aria-label="下一页头像"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
            <div className="native-avatar-grid">
              {avatarPresetsOnPage.map((preset) => {
                const selected = avatarPickerId === preset.id;
                return (
                  <button
                    type="button"
                    key={preset.id}
                    className={
                      selected
                        ? 'native-avatar-option native-avatar-option-active'
                        : 'native-avatar-option'
                    }
                    onClick={() => setAvatarPickerId(preset.id)}
                    aria-label="选择课程头像"
                    aria-pressed={selected}
                  >
                    <img src={preset.url} alt="" aria-hidden />
                  </button>
                );
              })}
            </div>
            <footer>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setAvatarDialogOpen(false)}
              >
                取消
              </button>
              <button type="button" className="primary-dialog-button" onClick={confirmAvatarPicker}>
                确认
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {conversationToDelete ? (
        <div className="native-dialog-layer">
          <button
            type="button"
            className="native-dialog-backdrop"
            onClick={() => setConversationToDelete(null)}
            aria-label="取消删除会话"
          />
          <section
            className="native-action-dialog native-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="native-delete-conversation-title"
          >
            <header>
              <div>
                <span>本机会话</span>
                <h2 id="native-delete-conversation-title">删除这个会话？</h2>
              </div>
              <button
                type="button"
                className="round-ghost-button"
                onClick={() => setConversationToDelete(null)}
                aria-label="关闭"
              >
                <X size={17} />
              </button>
            </header>
            <p className="native-confirm-copy">
              “{conversationToDelete.title}”及其中的本机消息会一并删除，此操作无法撤销。
            </p>
            <footer>
              <button
                type="button"
                className="secondary-button secondary-button-quiet"
                onClick={() => setConversationToDelete(null)}
                disabled={busy}
              >
                取消
              </button>
              <button
                type="button"
                className="native-danger-button"
                onClick={() => void deleteConversation()}
                disabled={busy}
              >
                {busy ? <Loader2 size={15} className="spin-icon" /> : <Trash2 size={15} />}
                删除会话
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {scheduleDialogOpen ? (
        <div className="native-dialog-layer">
          <button
            type="button"
            className="native-dialog-backdrop"
            onClick={closeScheduleEditor}
            aria-label={editingScheduleId ? '关闭编辑安排' : '关闭添加安排'}
          />
          <form
            className="native-action-dialog native-schedule-dialog"
            onSubmit={addSchedule}
            role="dialog"
            aria-modal="true"
            aria-labelledby="native-add-schedule-title"
          >
            <header>
              <div>
                <span>当前课程</span>
                <h2 id="native-add-schedule-title">
                  {editingScheduleId ? '编辑学习安排' : '添加学习安排'}
                </h2>
              </div>
              <button
                type="button"
                className="round-ghost-button"
                onClick={closeScheduleEditor}
                aria-label="关闭"
              >
                <X size={17} />
              </button>
            </header>
            <label className="native-dialog-field">
              <span>名称</span>
              <input
                value={scheduleTitle}
                onChange={(event) => setScheduleTitle(event.target.value)}
                placeholder="例如：完成 Problem Set 2"
                autoFocus
                required
              />
            </label>
            <label className="native-dialog-field">
              <span>日期</span>
              <input
                type="date"
                value={scheduleDate}
                onChange={(event) => setScheduleDate(event.target.value)}
                required
              />
            </label>
            <label className="native-dialog-field">
              <span>类型</span>
              <select
                value={scheduleKind}
                onChange={(event) => setScheduleKind(event.target.value as LocalCourseEventKind)}
              >
                {(workspace.course.purpose === 'research'
                  ? RESEARCH_SCHEDULE_KIND_OPTIONS
                  : SCHEDULE_KIND_OPTIONS
                ).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="native-dialog-field">
              <span>备注</span>
              <textarea
                rows={3}
                value={scheduleNote}
                onChange={(event) => setScheduleNote(event.target.value)}
                placeholder="可选：范围、地点或准备事项"
              />
            </label>
            <footer>
              <div className="native-schedule-dialog-actions">
                {editingScheduleId ? (
                  <button
                    type="button"
                    className="native-danger-button"
                    onClick={() => void deleteSchedule(editingScheduleId)}
                    disabled={scheduleBusy}
                  >
                    <Trash2 size={15} />
                    删除
                  </button>
                ) : null}
                <button
                  type="button"
                  className="secondary-button secondary-button-quiet"
                  onClick={closeScheduleEditor}
                >
                  取消
                </button>
              </div>
              <button
                type="submit"
                className="primary-dialog-button"
                disabled={!scheduleTitle.trim() || !scheduleDate || scheduleBusy}
              >
                {scheduleBusy ? (
                  <Loader2 size={15} className="spin-icon" />
                ) : (
                  <CalendarDays size={15} />
                )}
                {scheduleBusy ? '正在保存…' : editingScheduleId ? '保存修改' : '保存到本机日历'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      <input
        ref={attachmentInputRef}
        type="file"
        hidden
        accept=".txt,.md,.markdown,.csv,.json,.ts,.tsx,.js,.jsx,.py,.html,.css,text/*"
        multiple
        onChange={handleAttachmentSelection}
        tabIndex={-1}
      />
      <input
        ref={problemUploadInputRef}
        type="file"
        hidden
        accept=".txt,.md,.markdown,.csv,.json,.ts,.tsx,.js,.jsx,.py,.html,.css,text/*"
        multiple
        onChange={handleProblemUploadSelection}
        tabIndex={-1}
      />
      <input
        ref={noteUploadInputRef}
        type="file"
        hidden
        accept=".txt,.md,.markdown,.csv,.json,.ts,.tsx,.js,.jsx,.py,.html,.css,text/*"
        multiple
        onChange={handleNoteUploadSelection}
        tabIndex={-1}
      />
      <input
        ref={syllabusInputRef}
        type="file"
        hidden
        accept=".txt,.md,.markdown,.csv,.pdf,.png,.jpg,.jpeg,.webp,.gif,text/*,application/pdf,image/png,image/jpeg,image/webp,image/gif"
        onChange={handleSyllabusSelection}
        tabIndex={-1}
      />

      <span className="workspace-sparkle" aria-hidden>
        <Sparkles size={16} />
      </span>
      {resourceBusy ? (
        <div className="local-resource-loading" role="status">
          <Loader2 size={20} />
          正在从本机打开…
        </div>
      ) : null}
      {resource ? (
        <LocalResourceViewer resource={resource} onClose={() => setResource(null)} />
      ) : null}
      <NativeWorkspaceDialog
        open={calendarDialogOpen}
        onClose={() => setCalendarDialogOpen(false)}
        title="学习日历"
        description="查看复习计划、作业、考试和周进度。"
        labelledBy="native-calendar-title"
      >
        <div className="flex h-full min-h-0 bg-white">
          <aside className="hidden w-[230px] shrink-0 flex-col border-r border-slate-200/70 bg-slate-50/80 px-4 py-5 lg:flex">
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold text-slate-500">学习日历</p>
                <div className="mt-3 space-y-2.5 text-sm">
                  {[
                    {
                      label: isResearchCourse ? 'DDL' : '作业',
                      count: scheduleItems.filter((item) => item.kind === 'assignment').length,
                      dotClassName: 'bg-sky-500',
                    },
                    {
                      label: isResearchCourse ? '会议' : '考试',
                      count: scheduleItems.filter((item) => item.kind === 'exam').length,
                      dotClassName: 'bg-rose-500',
                    },
                    {
                      label: isResearchCourse ? '进展' : '进度',
                      count: scheduleItems.filter((item) => item.kind === 'progress').length,
                      dotClassName: 'bg-amber-500',
                    },
                    {
                      label: isResearchCourse ? '论文阅读' : 'Tutorial',
                      count: scheduleItems.filter((item) => item.kind === 'tutorial').length,
                      dotClassName: 'bg-violet-500',
                    },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={`grid size-4 shrink-0 place-items-center rounded-[5px] ${item.dotClassName}`}
                        >
                          <span className="size-1.5 rounded-full bg-white" />
                        </span>
                        <span className="min-w-0 truncate font-medium text-slate-900">
                          {item.label}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setCalendarDialogOpen(false);
                  openNewSchedule();
                }}
              >
                <Plus size={15} />
                添加安排
              </button>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-4 px-5 pb-4 pt-5 sm:px-6">
              <h2
                id="native-calendar-title"
                className="truncate text-3xl font-semibold tracking-normal text-slate-950 sm:text-4xl"
              >
                {calendarMonthLabel}
              </h2>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={showCurrentCalendarMonth}
                  className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-200"
                >
                  今天
                </button>
                <button
                  type="button"
                  onClick={showPreviousCalendarMonth}
                  className="grid size-9 place-items-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
                  aria-label="上一个月"
                  title="上一个月"
                >
                  <ChevronLeft size={16} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={showNextCalendarMonth}
                  className="grid size-9 place-items-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
                  aria-label="下一个月"
                  title="下一个月"
                >
                  <ChevronRight size={16} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="round-ghost-button ml-1"
                  onClick={() => setCalendarDialogOpen(false)}
                  aria-label="关闭"
                >
                  <X size={17} />
                </button>
              </div>
            </div>

            <LearningCalendarGrid
              days={calendarDays}
              eventsByDay={eventsByCalendarDay}
              isResearchCourse={isResearchCourse}
              onSelectEvent={(event) => {
                const item = scheduleItems.find((scheduleItem) => scheduleItem.id === event.id);
                if (item) openScheduleEditor(item);
              }}
              onSelectDay={(_date, events) => {
                const eventIds = new Set(events.map((event) => event.id));
                setCalendarDayItems(
                  scheduleItems.filter((scheduleItem) => eventIds.has(scheduleItem.id)),
                );
              }}
            />
          </div>
        </div>
      </NativeWorkspaceDialog>
      <NativeWorkspaceDialog
        open={calendarDayItems.length > 0}
        onClose={() => setCalendarDayItems([])}
        title={calendarDayItems[0]?.date ? `${calendarDayItems[0].date} 的安排` : '当天安排'}
        description="选择一项查看详情、编辑日期或删除。"
        className="native-calendar-day-workspace-dialog"
      >
        <div className="native-calendar-day-dialog">
          <header>
            <div>
              <span>学习日历</span>
              <h2>{calendarDayItems[0]?.date || '当天安排'}</h2>
            </div>
            <button
              type="button"
              className="round-ghost-button"
              onClick={() => setCalendarDayItems([])}
              aria-label="关闭"
            >
              <X size={17} />
            </button>
          </header>
          <div className="native-calendar-day-list">
            {calendarDayItems.map((item) => (
              <button
                type="button"
                className="tool-action-row"
                key={item.id}
                onClick={() => openScheduleEditor(item)}
              >
                <span className="tool-action-icon">
                  <CalendarDays size={16} />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.note || '没有备注'}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </div>
      </NativeWorkspaceDialog>
    </section>
  );
}
