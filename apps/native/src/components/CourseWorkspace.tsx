import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import {
  ArrowLeft,
  BookOpen,
  BookOpenCheck,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Cpu,
  Database,
  Dices,
  FileText,
  Library,
  FileQuestion,
  FolderUp,
  Menu,
  PanelLeft,
  MessageCircle,
  PanelLeftClose,
  Plus,
  Presentation,
  Save,
  Search,
  SendHorizontal,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Target,
  PencilLine,
  Trash2,
  Pin,
  PinOff,
  Ellipsis,
  Store,
  Upload,
  UserRound,
  X,
} from 'lucide-react';

import {
  bundledMarbleAvatar,
  COURSE_AVATAR_PRESETS,
  nativeAccountAvatarUrl,
  pickRandomCourseAvatarId,
  readStoredCourseAvatarId,
  resolveNativeCourseAvatar,
  profileThemeForAvatar,
  writeStoredCourseAvatarId,
} from '../assets';
import { ChatScopePicker } from './ChatScopePicker';
import { useChatWorkspaceShell, usePublishChatSidebar } from './ChatWorkspaceShell';
import { CourseToolsMenu, GlassMenu } from './CourseToolsMenu';
import { CourseMaterialsPage, type CourseMaterialKind } from './CourseMaterialsPage';
import { VoiceInputButton } from './VoiceInputButton';
import { LearningWorkspaceTabs } from './LearningWorkspaceTabs';
import type { CourseLearningPage, CourseOpenTarget } from '../lib/native-launch';
import { useRecentChats } from '../lib/use-recent-chats';
import type { RecentChat } from '../data/recent-chats';
import {
  generalChatClient as defaultGeneralChatClient,
  type GeneralChatClient,
} from '../data/general-chat';
import { browserApp } from '../data/browser-runtime';
import { streamNativeChat, detectChatSurface } from '../ai/chat';
import { buildNativeChatContext } from '../ai/context';
import {
  getAiSettings,
  parseSyllabusDocument,
  supportedAiModels,
  type ParsedSyllabusDocument,
  type ChatResponseStrength,
  type SupportedAiModel,
} from '../data/ai-client';
import {
  MAX_CHAT_IMAGES,
  chatImageThumbnails,
  isChatImageFile,
  prepareChatImage,
  type PendingChatImage,
} from '../data/chat-images';
import {
  CHAT_ATTACH_ACCEPT,
  CHAT_FILE_LABEL,
  MAX_CHAT_FILES,
  chatFileChips,
  formatFileSize,
  prepareChatFile,
  type ChatFileKind,
  type PendingChatFile,
} from '../data/chat-files';
import {
  createNativeMiniLecture,
  getNativePlatformCapabilities,
  getNativeMiniLecture,
  nativeStoreAction,
  uploadNativeMaterial,
  type NativePlatformCapabilities,
} from '../data/platform-api-client';
import {
  miniLectureManifestToPersistence,
  miniLectureManifestToRuntime,
} from '../data/mini-lecture-persistence';
import type { NativeSyncedMiniLecture } from '../data/platform-api-contracts';
import {
  deleteRemoteConversation,
  isPlatformCourse,
  loadOlderConversationMessages,
  pullCourseConversations,
  pullMoreCourseConversations,
  pushConversation,
  refreshConversationMessages,
  searchCourseConversations,
} from '../data/chat-sync';
import {
  deleteConversationMemories,
  loadNotebookForReading,
  pushLearningProgress,
  syncAppMemories,
  syncCourseData,
} from '../data/course-sync';
import { getLocalRepository, type SaveCourseLearningStateInput } from '../data/repository';
import { clearPlatformCourseUpdate, readPlatformCourseMeta } from '../lib/platform-course-meta';
import { usePlatformCourseMeta } from '../lib/use-platform-course-meta';
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
import { marbleImages } from '../lib/learning-action-marbles';
import { LearningToolIcon } from './LearningToolIcon';
import { LearningEmptyState } from './LearningEmptyState';
import { RecallThinking, type ThinkingRecall } from './RecallThinking';
import {
  GlassLoadMore,
  LIST_WINDOW_SIZE,
  useListWindow,
  type LoadMoreState,
  GlassSpinner,
} from './GlassLoadMore';
import { MarbleCatcher, type MarbleCatch } from './MarbleCatcher';
import {
  STALE_FRESHNESS,
  markMemoryReviewed,
  memoryFreshness,
  readReviewedMap,
} from '../lib/memory-freshness';
import { useChatFileDrop } from '../lib/use-chat-file-drop';
import { NativeReviewPlanCard } from './NativeReviewPlanCard';
import { NativeWorkspaceDialog } from './NativeWorkspaceDialog';
import {
  PhoneCalendarPage,
  PhoneClassroomPage,
  PhoneConfirm,
  PhoneMemoryPage,
  PhoneProfilePage,
  PhoneProgressPage,
} from './PhonePages';
import { PhoneNotesPage } from './NotebookShelfPage';
import { notebookAccentFor } from '../lib/notebook-reading';
import { ProblemPracticePage } from './ProblemPracticePage';
import { ProblemBankPage, type ProblemBankLaunch } from './ProblemBankPage';
import { CourseUpdateCard } from './CourseLayerControls';
import { ChatRichText, type ChatRichMemory, type ChatRichSource } from './chat-rich/ChatRichText';
import type {
  LocalConversation,
  LocalCourseLearningState,
  LocalCourseSearchResult,
  LocalCourseSummary,
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
import { writePhoneLastChat } from '../lib/phone-last-chat';
import { readPinnedChatIds, writePinnedChatIds } from '../lib/phone-pinned-chats';
import { useBackDismiss } from '../lib/use-back-dismiss';
import {
  completeOnboardingStep,
  ONBOARDING_PREFILL_EVENT,
  PLATFORM_TUTORIAL_COURSE_ID,
  PLATFORM_TUTORIAL_QUESTION,
} from '../lib/onboarding';
import { usePhoneKeyboardInset } from '../lib/use-phone-keyboard';
import { useCompactLayout, usePhoneLayout } from '../lib/use-phone-layout';
import { useAppNavigation } from './app-navigation-context';

// 我的页收藏架点了别的课的罐子：换课后直接打开那门课的学习记忆。
const OPEN_PHONE_PAGE_KEY = 'syntara.open-phone-page';

function readOpenPhonePage(): 'memory' | 'problems' | null {
  try {
    const page = window.sessionStorage.getItem(OPEN_PHONE_PAGE_KEY);
    return page === 'memory' || page === 'problems' ? page : null;
  } catch {
    return null;
  }
}

type CourseTool = 'overview' | 'library' | 'calendar' | 'settings';
type MobilePanel = 'sessions' | 'tools' | 'progress' | null;
/** 去掉再加回一个 class，让同一个动画可以连续重播。 */
function replayClass(element: HTMLElement | null, className: string) {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

const AI_MODEL_STORAGE_KEY = 'syntara.native.openai.model';
const LEFT_RAIL_STORAGE_KEY = 'syntara.native.chat.left-rail-collapsed';
const COURSE_PROGRESS_STORAGE_PREFIX = 'syntara.native.course-progress.';
const RIGHT_RAIL_STORAGE_KEY = 'syntara.native.chat.right-rail-collapsed';
const RESPONSE_STRENGTH_STORAGE_KEY = 'syntara.phone.response-strength.v1';
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

function ChatMessageContent({
  message,
  onOpenNotebookId,
  onOpenMemoryId,
}: {
  message: LocalMessage;
  onOpenNotebookId?: (notebookId: string) => void;
  onOpenMemoryId?: (memoryId: string) => void;
}) {
  if (message.role === 'user') {
    const images = chatImageThumbnails(message.metadata);
    const files = chatFileChips(message.metadata);
    return (
      <>
        {images.length ? (
          <div className="chat-message-images">
            {images.map((image, index) => (
              <img key={index} src={image.thumbnailDataUrl} alt={image.name} />
            ))}
          </div>
        ) : null}
        {files.length ? (
          <div className="chat-message-files">
            {files.map((file, index) => (
              <ChatFilePill key={index} name={file.name} kind={file.kind} size={file.size} />
            ))}
          </div>
        ) : null}
        <p>{message.text}</p>
      </>
    );
  }

  return (
    <AssistantMessageContent
      message={message}
      onOpenNotebookId={onOpenNotebookId}
      onOpenMemoryId={onOpenMemoryId}
    />
  );
}

/** 文件小药丸：左边一颗按类型上色的玻璃珠写着 PDF / DOC / PPT / TXT。 */
function ChatFilePill({
  name,
  kind,
  size,
  onRemove,
}: {
  name: string;
  kind: ChatFileKind;
  size?: number;
  onRemove?: () => void;
}) {
  return (
    <span className={`chat-file-pill is-${kind}`} title={name}>
      <span className="chat-file-pill-marble" aria-hidden>
        {CHAT_FILE_LABEL[kind]}
      </span>
      <span className="chat-file-pill-text">
        <strong>{name.replace(/\.[^.]+$/, '')}</strong>
        {size ? <small>{formatFileSize(size)}</small> : null}
      </span>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`移除 ${name}`}>
          <X size={12} />
        </button>
      ) : null}
    </span>
  );
}

function AssistantMessageContent({
  message,
  onOpenNotebookId,
  onOpenMemoryId,
}: {
  message: LocalMessage;
  onOpenNotebookId?: (notebookId: string) => void;
  onOpenMemoryId?: (memoryId: string) => void;
}) {
  const evidence = message.metadata?.evidence;
  // [^n] 指向第 n 条课程笔记片段（和发给 AI 的顺序一致）。
  const sources = useMemo<ChatRichSource[]>(
    () =>
      (evidence ?? [])
        .filter((item) => item.sourceType === 'notebook')
        .map((item) => {
          const notebookId = item.metadata?.notebookId;
          return {
            title: item.title ?? '课程笔记',
            notebookId: typeof notebookId === 'string' ? notebookId : undefined,
          };
        }),
    [evidence],
  );
  // [^mn] 指向第 n 颗学习记忆珠子。
  const memories = useMemo<ChatRichMemory[]>(
    () =>
      (evidence ?? [])
        .filter((item) => item.sourceType === 'memory' && item.sourceId)
        .map((item) => {
          const kind = item.metadata?.kind;
          return {
            id: item.sourceId as string,
            title: item.title ?? '学习记忆',
            kind: typeof kind === 'string' ? kind : undefined,
          };
        }),
    [evidence],
  );
  return (
    <ChatRichText
      text={message.text}
      sources={sources}
      memories={memories}
      onOpenMemory={(memory) => onOpenMemoryId?.(memory.id)}
      onOpenSource={(source) => {
        if (source.notebookId) onOpenNotebookId?.(source.notebookId);
      }}
    />
  );
}

function orderCourseNotebooks(notebooks: LocalNotebook[]): LocalNotebook[] {
  return [...notebooks].sort(
    (left, right) =>
      left.name.localeCompare(right.name, 'zh-CN') || left.updatedAt - right.updatedAt,
  );
}

// 「生成课堂讲解」主要听平台 AI 的判断（lectureSuggested）；关键词兜底：
// 学生自己说要课堂、小课、幻灯片、图解时一定给。普通的“讲解一下”不算。
const LECTURE_REQUEST =
  /课堂|小课|微课|讲一节|上一节|做成.{0,6}(课|讲解|幻灯片)|生成.{0,8}讲解|幻灯片|slides?|ppt|图解|配图|画图.{0,4}讲|可视化|动画|视频|lecture|lesson/i;

function isLectureEligibleMessage(message: LocalMessage, askedBy: string): boolean {
  if (message.role !== 'assistant' || message.id.startsWith('stream-')) return false;
  if (message.metadata?.lectureEligibilityReason === 'bundled_reference') return true;
  if (message.metadata?.lectureSuggested === true) return true;
  // 旧版平台把每条课程回答都标成可生成，这里再看一眼学生这一问有没有要课堂。
  if (message.metadata?.lectureEligible === true && LECTURE_REQUEST.test(askedBy)) return true;
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

function readStoredResponseStrength(): ChatResponseStrength {
  try {
    const stored = window.localStorage.getItem(RESPONSE_STRENGTH_STORAGE_KEY);
    return stored === 'low' || stored === 'medium' || stored === 'high' ? stored : 'medium';
  } catch {
    return 'medium';
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

type CourseWorkspaceProps = {
  initialDraft?: string;
  onChangeChatScope?: (courseId: string | null, draft: string) => void;
  homeHref?: string;
  onOpenRecentChat?: (courseId: string | null, conversationId: string) => void;
  generalChatClient?: GeneralChatClient | null;
  workspace: LocalCourseWorkspace;
  initialConversationId?: string | null;
  initialPage?: CourseOpenTarget['page'];
  newEventDate?: string;
  calendarDate?: string;
  /** 当前账户的全部课程，常驻侧栏。 */
  courses: LocalCourseSummary[];
  backendLabel: string;
  onBack: () => void;
  onSwitchCourse: (courseId: string) => void;
  onCreateCourseChat: (courseId: string) => void;
  onOpenCourseTool: (courseId: string, page: CourseLearningPage) => void;
  onCreateCourse?: () => void;
  onNewChat?: () => void;
  onOpenProblemBank: () => void;
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

/** 会话列表的「下一页」：本机的看完了，再向网页要。 */
type ConversationPaging = {
  hasMore: boolean;
  state: LoadMoreState;
  onLoadMore: () => void | Promise<void>;
};

/** 本机只存了一部分会话，搜索时停顿一下再问网页，找到的会话会出现在列表里。 */
function useRemoteConversationSearch(query: string, search?: (query: string) => void) {
  useEffect(() => {
    const keyword = query.normalize('NFKC').trim();
    if (!keyword || !search) return;
    const timer = window.setTimeout(() => search(keyword), 350);
    return () => window.clearTimeout(timer);
  }, [query, search]);
}

/** 列表末尾的弹珠：先多显示本机已有的，看完了再向网页要下一页。 */
function ConversationListEnd({
  listWindow,
  paging,
  length,
}: {
  listWindow: ReturnType<typeof useListWindow>;
  paging?: ConversationPaging;
  length: number;
}) {
  if (listWindow.hasHidden) {
    return <GlassLoadMore onLoadMore={listWindow.showMore} watchKey={listWindow.count} />;
  }
  if (!paging?.hasMore) return null;
  return <GlassLoadMore onLoadMore={paging.onLoadMore} state={paging.state} watchKey={length} />;
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
  paging,
}: {
  conversations: LocalConversation[];
  selectedConversationId: string | null;
  busy: boolean;
  paging?: ConversationPaging;
  onBack: () => void;
  onClose?: () => void;
  onCollapse?: () => void;
  onCreateConversation: () => void;
  onDeleteConversation: (conversation: LocalConversation) => void;
  onShowAllConversations: () => void;
  onSelectConversation: (conversationId: string) => void;
}) {
  const listWindow = useListWindow(conversations.length, conversations[0]?.courseId);
  return (
    <div className="sessions-panel">
      <div className="sessions-back-row">
        <button type="button" onClick={onBack} className="plain-row-button">
          <ArrowLeft size={16} strokeWidth={1.8} />
          <span>聊天</span>
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
            {conversations.slice(0, listWindow.count).map((conversation) => {
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
            <ConversationListEnd
              listWindow={listWindow}
              paging={paging}
              length={conversations.length}
            />
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

type DrawerLearningAction = {
  id: string;
  label: string;
  icon: typeof BookOpen;
  open: () => void;
  count?: number;
};

export function LearningToolsCard({ actions }: { actions: DrawerLearningAction[] }) {
  return (
    <nav className="phone-drawer-nav phone-drawer-learning" aria-label="学习工具">
      <details className="phone-drawer-group" open>
        <summary className="phone-drawer-section-toggle">
          <h3>学习</h3>
          <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
        </summary>
        <div className="phone-drawer-group-items">
          {actions.map(({ id, label, icon: Icon, open, count }) => (
            <button
              type="button"
              key={id}
              className="phone-drawer-tool"
              data-tool={id}
              onClick={open}
              data-marble-target={id === 'memory' ? '2' : undefined}
            >
              <LearningToolIcon tool={id} fallback={Icon} />
              <span>{label}</span>
              {count ? <small>{count}</small> : null}
            </button>
          ))}
        </div>
      </details>
    </nav>
  );
}

/** 学习卡里随上下文出现的一组：没有内容的组不显示。 */
type LearningFloatSection = {
  id: string;
  title: string;
  count?: number;
  rows: {
    id: string;
    tool: string;
    icon: typeof BookOpen;
    label: string;
    hint?: string;
    open: () => void;
  }[];
};

/** 卡片怎么分：聊天相关一张、提醒一张，课程工具固定在最下面一张。 */
const FLOAT_CARD_GROUPS = [
  { id: 'chat', sections: ['outputs', 'sources'] },
  { id: 'reminders', sections: ['upcoming', 'review'] },
];

function LearningFloatSectionView({ section }: { section: LearningFloatSection }) {
  const { id, title, count, rows } = section;
  return (
    <section className="is-context" data-section={id}>
      <div className="learning-float-section">
        <span>{title}</span>
        {count ? <small>{count}</small> : null}
      </div>
      {rows.map(({ id: rowId, tool, icon, label, hint, open }) => (
        <button
          type="button"
          key={rowId}
          className="learning-float-row"
          data-tool={tool}
          onClick={open}
          title={label}
        >
          <LearningToolIcon tool={tool} fallback={icon} />
          <span>{label}</span>
          {hint ? <small>{hint}</small> : null}
        </button>
      ))}
    </section>
  );
}

/**
 * 宽屏聊天页右上角的一叠浮动卡片（像 Codex 的侧卡）。上面的卡片跟着当前聊天和课程出现或消失：
 * 这次聊天的产出和引用一张，接下来的日程和该复习的记忆一张；最下面一张固定是资料和学习工具。
 */
function LearningFloatCard({
  actions,
  sections: contextSections,
}: {
  actions: DrawerLearningAction[];
  sections: LearningFloatSection[];
}) {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const tools = [
    { title: '资料', add: byId.get('materials'), ids: ['notes', 'problems'] },
    { title: '学习', ids: ['progress', 'memory', 'classroom'] },
  ];
  const cards = FLOAT_CARD_GROUPS.map(({ id, sections }) => ({
    id,
    sections: contextSections.filter((section) => sections.includes(section.id)),
  })).filter((card) => card.sections.length);
  return (
    <aside className="learning-float-stack" aria-label="课程学习">
      {cards.map((card) => (
        <div key={card.id} className="learning-float-card is-context" data-card={card.id}>
          {card.sections.map((section) => (
            <LearningFloatSectionView key={section.id} section={section} />
          ))}
        </div>
      ))}
      <div className="learning-float-card" data-card="tools">
        {tools.map(({ title: sectionTitle, add, ids }) => (
          <section key={sectionTitle}>
            <div className="learning-float-section">
              <span>{sectionTitle}</span>
              {add ? (
                <button type="button" onClick={add.open} aria-label="上传资料" title="上传资料">
                  <Plus size={14} strokeWidth={2} />
                </button>
              ) : null}
            </div>
            {ids.map((id) => {
              const action = byId.get(id);
              if (!action) return null;
              const { label, icon: Icon, open, count } = action;
              return (
                <button
                  type="button"
                  key={id}
                  className="learning-float-row"
                  data-tool={id}
                  data-marble-target={id === 'memory' ? '2' : undefined}
                  onClick={open}
                >
                  <LearningToolIcon tool={id} fallback={Icon} />
                  <span>{label}</span>
                  {count ? <small>{count}</small> : null}
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}

/** 日程离今天几天，卡片里只说“今天 / 明天 / N 天后”。 */
function daysUntilLabel(date: string, today: string) {
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  return days <= 0 ? '今天' : days === 1 ? '明天' : `${days} 天后`;
}

const FLOAT_SOURCE_TYPES = new Set([
  'notebook',
  'course_material',
  'source',
  'memory',
  'problem_bank',
]);

/** Shared course navigation and recent conversations. */
const DRAWER_COURSE_PEEK = 5;
const DRAWER_CHAT_PEEK = 5;

export function PhoneChatDrawer<
  T extends Pick<LocalConversation, 'id' | 'title' | 'createdAt' | 'updatedAt'>,
>({
  homeHref = '/',
  onOpenRecentChat,
  generalChatClient = browserApp ? defaultGeneralChatClient : null,
  learningActions,
  courses,
  selectedCourseId,
  selectedCourseAvatarUrl,
  conversations,
  selectedConversationId,
  onCreateCourse,
  onNewChat,
  onDeleteConversation,
  onCreateCourseChat,
  onOpenCourseTool,
  newChatDisabled = false,
  onSelectConversation,
  paging,
  onRemoteSearch,
}: {
  homeHref?: string;
  onOpenRecentChat?: (courseId: string | null, conversationId: string) => void;
  generalChatClient?: GeneralChatClient | null;
  paging?: ConversationPaging;
  onRemoteSearch?: (query: string) => void;
  learningActions: DrawerLearningAction[];
  courses: LocalCourseSummary[];
  selectedCourseId: string;
  selectedCourseAvatarUrl: string;
  conversations: T[];
  selectedConversationId: string | null;
  onCreateCourse?: () => void;
  onNewChat: () => void;
  onDeleteConversation: (conversation: T) => void;
  onCreateCourseChat: (courseId: string) => void;
  onOpenCourseTool: (courseId: string, page: CourseLearningPage) => void;
  newChatDisabled?: boolean;
  onSelectConversation: (conversationId: string) => void;
}) {
  const courseMeta = usePlatformCourseMeta();
  const chatShell = useChatWorkspaceShell();
  // 手机和窄窗口没有左侧细导航栏：商城、日历放在新聊天下面，「我的」放在底部。
  const compact = useCompactLayout();
  const navigation = useAppNavigation();
  const accountAvatar = navigation?.avatarUrl || nativeAccountAvatarUrl(null, null);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [coursesOpen, setCoursesOpen] = useState(true);
  const [chatSelection, setChatSelection] = useState<{
    conversationId: string;
    inCourse: boolean;
  } | null>(() => {
    try {
      const stored: unknown = JSON.parse(
        sessionStorage.getItem('syntara.drawer-chat-selection') ?? 'null',
      );
      if (
        stored &&
        typeof stored === 'object' &&
        'conversationId' in stored &&
        typeof stored.conversationId === 'string' &&
        'inCourse' in stored &&
        typeof stored.inCourse === 'boolean'
      ) {
        return { conversationId: stored.conversationId, inCourse: stored.inCourse };
      }
    } catch {
      // Selection still follows clicks when session storage is unavailable.
    }
    return null;
  });
  const [query, setQuery] = useState('');
  const [courseMenu, setCourseMenu] = useState<{
    course: LocalCourseSummary;
    anchor: HTMLButtonElement;
  } | null>(null);
  const [courseActions, setCourseActions] = useState<{
    course: LocalCourseSummary;
    anchor: HTMLButtonElement;
  } | null>(null);
  // Switching courses remounts the drawer; keep each course's disclosure state in this window.
  const [expandedCourses, setExpandedCourses] = useState<string[]>(() => {
    const initialIds = selectedCourseId ? [selectedCourseId] : courses[0] ? [courses[0].id] : [];
    try {
      const stored: unknown = JSON.parse(
        sessionStorage.getItem('syntara.drawer-expanded-courses') ?? 'null',
      );
      if (Array.isArray(stored) && stored.every((id) => typeof id === 'string')) {
        return selectedCourseId ? [...new Set([...stored, selectedCourseId])] : stored;
      }
    } catch {
      // Navigation still works when session storage is unavailable.
    }
    return initialIds;
  });
  useEffect(() => {
    try {
      sessionStorage.setItem('syntara.drawer-expanded-courses', JSON.stringify(expandedCourses));
    } catch {
      // Disclosure state remains available until this drawer unmounts.
    }
  }, [expandedCourses]);
  // 课程很多时只露出前几门（当前课程总在里面），其余收进「还有 N 门」。
  const [allCoursesShown, setAllCoursesShown] = useState(false);
  // 一门课聊天很多时，展开也只先露出几条，其余点「还有 N 个」再显示。
  const [allChatsCourseIds, setAllChatsCourseIds] = useState<string[]>([]);
  const shownCourses = useMemo(() => {
    if (allCoursesShown || courses.length <= DRAWER_COURSE_PEEK + 1) return courses;
    const head = courses.slice(0, DRAWER_COURSE_PEEK);
    const current = courses.find((course) => course.id === selectedCourseId);
    return current && !head.includes(current)
      ? [current, ...head.slice(0, DRAWER_COURSE_PEEK - 1)]
      : head;
  }, [allCoursesShown, courses, selectedCourseId]);
  const hiddenCourses =
    shownCourses.length < courses.length
      ? courses.filter((course) => !shownCourses.includes(course))
      : [];
  const keyword = query.trim().toLowerCase();
  const history = useRecentChats(
    courses.map((course) => course.id),
    selectedCourseId || null,
    conversations,
    generalChatClient,
    Boolean(onOpenRecentChat),
  );
  const allConversations: RecentChat[] = onOpenRecentChat
    ? history.conversations
    : conversations.map((row) => ({ ...row, courseId: selectedCourseId || null }));
  const visibleConversations = keyword
    ? allConversations.filter((conversation) => conversation.title.toLowerCase().includes(keyword))
    : allConversations;
  // 置顶和删除：长按一条聊天（或点当前聊天右边的 ⋯）弹出菜单。置顶只记在本机。
  const [pinnedIds, setPinnedIds] = useState(readPinnedChatIds);
  // 菜单贴着被长按的那一行弹出（iOS 上下文菜单），而不是从屏幕底部升起。
  const [menu, setMenu] = useState<{
    conversation: RecentChat;
    top: number;
    height: number;
    placeAbove: boolean;
  } | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const openMenuFor = (conversation: RecentChat, row: Element | null) => {
    const drawer = drawerRef.current?.getBoundingClientRect();
    const rect = row?.getBoundingClientRect();
    if (!drawer || !rect) return;
    const top = rect.top - drawer.top;
    const menuHeight = 120;
    setMenu({
      conversation,
      top,
      height: rect.height,
      placeAbove: top + rect.height + menuHeight + 24 > drawer.height,
    });
  };
  const closeMenu = () => setMenu(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const pinnedConversations = pinnedIds
    .map((id) => visibleConversations.find((conversation) => conversation.id === id))
    .filter((conversation): conversation is RecentChat => Boolean(conversation));
  const recentConversations = visibleConversations.filter(
    (conversation) => !pinnedIds.includes(conversation.id),
  );
  const recentWindow = useListWindow(recentConversations.length, keyword);
  useRemoteConversationSearch(query, onOpenRecentChat ? history.search : onRemoteSearch);

  const togglePinned = (conversation: RecentChat) => {
    const next = pinnedIds.includes(conversation.id)
      ? pinnedIds.filter((id) => id !== conversation.id)
      : [conversation.id, ...pinnedIds];
    setPinnedIds(next);
    writePinnedChatIds(next);
    closeMenu();
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const startLongPress = (conversation: RecentChat, row: Element | null) => {
    cancelLongPress();
    longPressFiredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      navigator.vibrate?.(10);
      openMenuFor(conversation, row);
    }, 450);
  };

  const shownChatsForCourse = (courseId: string) => {
    const chats = allConversations.filter((conversation) => conversation.courseId === courseId);
    return allChatsCourseIds.includes(courseId) || chats.length <= DRAWER_CHAT_PEEK + 1
      ? chats
      : chats.slice(0, DRAWER_CHAT_PEEK);
  };

  const activeCourseChatVisible =
    !searching &&
    coursesOpen &&
    expandedCourses.includes(selectedCourseId) &&
    shownCourses.some((course) => course.id === selectedCourseId) &&
    shownChatsForCourse(selectedCourseId).some(
      (conversation) => conversation.id === selectedConversationId,
    );

  const renderRow = (conversation: RecentChat, inCourse: boolean) => {
    const active = conversation.id === selectedConversationId;
    const preferCourse =
      activeCourseChatVisible &&
      (chatSelection?.conversationId !== selectedConversationId || chatSelection.inCourse);
    const primary = active && inCourse === preferCourse;
    return (
      <div
        key={conversation.id}
        className={`phone-drawer-row${primary ? ' phone-drawer-row-active' : active ? ' phone-drawer-row-current' : ''}`}
      >
        <button
          type="button"
          aria-current={primary ? 'page' : undefined}
          onClick={() => {
            if (longPressFiredRef.current) {
              longPressFiredRef.current = false;
              return;
            }
            const nextSelection = { conversationId: conversation.id, inCourse };
            setChatSelection(nextSelection);
            try {
              sessionStorage.setItem(
                'syntara.drawer-chat-selection',
                JSON.stringify(nextSelection),
              );
            } catch {
              // Keep the clicked location selected until the drawer unmounts.
            }
            if (conversation.courseId === (selectedCourseId || null)) {
              chatShell?.onLocalNavigation();
              onSelectConversation(conversation.id);
            } else onOpenRecentChat?.(conversation.courseId, conversation.id);
          }}
          onTouchStart={(event) =>
            startLongPress(conversation, event.currentTarget.closest('.phone-drawer-row'))
          }
          onTouchMove={cancelLongPress}
          onTouchEnd={cancelLongPress}
          onTouchCancel={cancelLongPress}
          onContextMenu={(event) => {
            event.preventDefault();
            cancelLongPress();
            openMenuFor(conversation, event.currentTarget.closest('.phone-drawer-row'));
          }}
        >
          <span className="phone-drawer-row-title">{conversation.title}</span>
        </button>
        <button
          type="button"
          className="phone-drawer-delete"
          onClick={(event) =>
            openMenuFor(conversation, event.currentTarget.closest('.phone-drawer-row'))
          }
          aria-label={`更多操作：${conversation.title}`}
        >
          <Ellipsis size={18} />
        </button>
      </div>
    );
  };

  return (
    <div className="phone-drawer" ref={drawerRef}>
      <div
        className="phone-drawer-top"
        data-tauri-drag-region={
          document.documentElement.classList.contains('platform-macos') ? 'deep' : undefined
        }
      >
        <h2>
          {'__TAURI_INTERNALS__' in window ? (
            'Syntara'
          ) : (
            <a className="phone-drawer-home" href={homeHref} aria-label="Syntara 首页">
              Syntara
            </a>
          )}
        </h2>
        <button
          type="button"
          className="phone-glass-button"
          onClick={() => {
            setSearching((current) => !current);
            setQuery('');
          }}
          aria-label={searching ? '取消搜索' : '搜索聊天'}
        >
          {searching ? <X size={20} strokeWidth={1.8} /> : <Search size={20} strokeWidth={1.8} />}
        </button>
      </div>

      <nav className="phone-drawer-nav phone-drawer-primary" aria-label="聊天">
        <button
          type="button"
          className="phone-drawer-tool"
          onClick={onNewChat}
          disabled={newChatDisabled}
        >
          <SquarePen size={20} strokeWidth={1.8} aria-hidden />
          <span>新聊天</span>
        </button>
        {compact && navigation ? (
          <>
            <button
              type="button"
              className="phone-drawer-tool"
              data-onboarding="store"
              onClick={navigation.onOpenStore}
            >
              <Store size={20} strokeWidth={1.8} aria-hidden />
              <span>商城</span>
            </button>
            <button type="button" className="phone-drawer-tool" onClick={navigation.onOpenCalendar}>
              <CalendarDays size={20} strokeWidth={1.8} aria-hidden />
              <span>日历</span>
            </button>
          </>
        ) : null}
      </nav>
      {searching ? (
        <input
          className="phone-drawer-search"
          type="search"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索聊天"
        />
      ) : null}

      <div className="phone-drawer-scroll">
        {!searching ? (
          <>
            <nav className="phone-drawer-nav phone-drawer-courses" aria-label="全部课程">
              <details
                className="phone-drawer-group"
                open={coursesOpen}
                onToggle={(event) => setCoursesOpen(event.currentTarget.open)}
              >
                <summary className="phone-drawer-section-toggle">
                  <h3>课程</h3>
                  <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
                </summary>
                <div className="phone-drawer-group-items">
                  {!courses.length ? <p className="phone-drawer-empty">还没有课程</p> : null}
                  {shownCourses.map((course) => {
                    const current = course.id === selectedCourseId;
                    const avatarUrl = current
                      ? selectedCourseAvatarUrl
                      : resolveNativeCourseAvatar(course.id, course.courseCode);
                    const avatarTheme = bundledMarbleAvatar(avatarUrl);
                    const hoverStyle = {
                      '--course-hover-art': `url(${JSON.stringify(avatarTheme?.sceneUrl ?? avatarUrl)})`,
                      '--course-hover-tint': `hsl(${avatarTheme?.hue ?? 220} 55% 94%)`,
                    } as CSSProperties;
                    const expanded = expandedCourses.includes(course.id);
                    const chats = allConversations.filter((chat) => chat.courseId === course.id);
                    return (
                      <div className="phone-drawer-course-group" key={course.id}>
                        <div
                          className={`phone-drawer-course-heading${current ? ' is-current' : ''}`}
                          style={hoverStyle}
                        >
                          <button
                            type="button"
                            className="phone-drawer-course"
                            data-onboarding={
                              course.id === PLATFORM_TUTORIAL_COURSE_ID
                                ? 'tutorial-course'
                                : undefined
                            }
                            aria-label={course.courseCode || course.name}
                            aria-expanded={expanded}
                            aria-controls={expanded ? 'course-chats-' + course.id : undefined}
                            title={course.name}
                            onClick={() =>
                              setExpandedCourses((ids) =>
                                expanded
                                  ? ids.filter((id) => id !== course.id)
                                  : [...ids, course.id],
                              )
                            }
                          >
                            <img
                              src={avatarUrl}
                              alt=""
                              aria-hidden
                              data-marble-target={current ? '1' : undefined}
                            />
                            <span>{course.courseCode || course.name}</span>
                            {courseMeta[course.id]?.hasUpdate ? (
                              <img
                                className="phone-drawer-course-update"
                                src={marbleImages.amber}
                                alt="有更新"
                                title={courseMeta[course.id]?.updateSummary || '机构发布了新版'}
                              />
                            ) : null}
                          </button>
                          <div className="phone-drawer-course-actions">
                            <button
                              type="button"
                              aria-label={`${course.courseCode || course.name}学习工具`}
                              title="学习工具"
                              data-onboarding={current ? 'course-tools' : undefined}
                              aria-haspopup="menu"
                              aria-expanded={courseMenu?.course.id === course.id}
                              onClick={(event) =>
                                setCourseMenu(
                                  courseMenu?.course.id === course.id
                                    ? null
                                    : { course, anchor: event.currentTarget },
                                )
                              }
                            >
                              <Ellipsis size={18} strokeWidth={1.7} aria-hidden />
                            </button>
                            <button
                              type="button"
                              aria-label={`${course.courseCode || course.name}：新聊天、编辑、删除`}
                              title="新聊天"
                              data-onboarding={
                                course.id === PLATFORM_TUTORIAL_COURSE_ID
                                  ? 'tutorial-course-menu'
                                  : undefined
                              }
                              aria-haspopup="menu"
                              aria-expanded={courseActions?.course.id === course.id}
                              onClick={(event) =>
                                setCourseActions(
                                  courseActions?.course.id === course.id
                                    ? null
                                    : { course, anchor: event.currentTarget },
                                )
                              }
                            >
                              <SquarePen size={17} strokeWidth={1.7} aria-hidden />
                            </button>
                          </div>
                        </div>
                        {expanded ? (
                          <div
                            className="phone-drawer-course-chats"
                            id={'course-chats-' + course.id}
                            role="group"
                            aria-label={`${course.courseCode || course.name}的聊天`}
                          >
                            {chats.length ? (
                              shownChatsForCourse(course.id).map((conversation) =>
                                renderRow(conversation, true),
                              )
                            ) : (
                              <p className="phone-drawer-course-empty">暂无聊天</p>
                            )}
                            {chats.length > DRAWER_CHAT_PEEK + 1 &&
                            !allChatsCourseIds.includes(course.id) ? (
                              <button
                                type="button"
                                className="phone-drawer-more-chats"
                                onClick={() => setAllChatsCourseIds((ids) => [...ids, course.id])}
                              >
                                还有 {chats.length - DRAWER_CHAT_PEEK} 个
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {hiddenCourses.length || allCoursesShown ? (
                    <button
                      type="button"
                      className="phone-drawer-more-courses"
                      aria-expanded={allCoursesShown}
                      onClick={() => setAllCoursesShown((shown) => !shown)}
                    >
                      <span className="phone-drawer-more-marbles" aria-hidden>
                        {(allCoursesShown ? [] : hiddenCourses.slice(0, 3)).map((course) => (
                          <img
                            key={course.id}
                            src={resolveNativeCourseAvatar(course.id, course.courseCode)}
                            alt=""
                          />
                        ))}
                      </span>
                      <span>{allCoursesShown ? '收起' : `还有 ${hiddenCourses.length} 门`}</span>
                      <ChevronDown size={14} strokeWidth={1.8} aria-hidden />
                    </button>
                  ) : null}
                </div>
              </details>
              {onCreateCourse ? (
                <button
                  type="button"
                  className="phone-drawer-create"
                  aria-label="新课程"
                  data-onboarding="new-course"
                  onClick={onCreateCourse}
                >
                  <Plus size={14} strokeWidth={1.8} aria-hidden />
                  <span>新课程</span>
                </button>
              ) : null}
            </nav>
            {learningActions.length && !compact ? (
              <LearningToolsCard actions={learningActions} />
            ) : null}
          </>
        ) : null}
        {pinnedConversations.length ? (
          <>
            <p className="phone-drawer-section">置顶</p>
            {pinnedConversations.map((conversation) => renderRow(conversation, false))}
          </>
        ) : null}
        <details className="phone-drawer-group phone-drawer-recent" open>
          <summary className="phone-drawer-section-toggle">
            <h3>最近</h3>
            <ChevronDown size={14} strokeWidth={1.8} aria-hidden />
          </summary>
          {recentConversations.length ? (
            <>
              {recentConversations
                .slice(0, recentWindow.count)
                .map((conversation) => renderRow(conversation, false))}
            </>
          ) : (
            <p className="phone-drawer-empty">
              <img src={marbleImages.blue} alt="" aria-hidden />
              {keyword
                ? '没有找到相关聊天'
                : pinnedConversations.length
                  ? '没有其他聊天'
                  : '还没有聊天'}
            </p>
          )}
          <ConversationListEnd
            listWindow={recentWindow}
            paging={keyword ? undefined : onOpenRecentChat ? history.paging : paging}
            length={allConversations.length}
          />
        </details>
      </div>

      {compact && navigation ? (
        <button
          type="button"
          className="phone-drawer-account"
          onClick={navigation.onOpenSettings}
          aria-label="我的"
        >
          <span className="phone-drawer-account-avatar" aria-hidden>
            {accountAvatar && failedAvatar !== accountAvatar ? (
              <img src={accountAvatar} alt="" onError={() => setFailedAvatar(accountAvatar)} />
            ) : (
              <UserRound size={18} strokeWidth={1.7} />
            )}
          </span>
          <span>我的</span>
        </button>
      ) : null}
      {onOpenRecentChat && history.error ? (
        <p className="phone-drawer-empty" role="status">
          {history.error}
        </p>
      ) : null}
      {courseActions ? (
        <GlassMenu
          anchor={courseActions.anchor}
          label={courseActions.course.courseCode || courseActions.course.name}
          onClose={() => setCourseActions(null)}
          items={[
            {
              key: 'chat',
              label: '新聊天',
              icon: <SquarePen size={17} strokeWidth={1.7} aria-hidden />,
              onboarding:
                courseActions.course.id === PLATFORM_TUTORIAL_COURSE_ID
                  ? 'tutorial-chat'
                  : undefined,
              onSelect: () => {
                setCourseActions(null);
                if (!newChatDisabled) onCreateCourseChat(courseActions.course.id);
              },
            },
            ...(courseMeta[courseActions.course.id]?.accessRole === 'enrolled' ||
            !navigation?.onManageCourse
              ? []
              : [
                  {
                    key: 'edit',
                    label: '编辑',
                    icon: <PencilLine size={17} strokeWidth={1.7} aria-hidden />,
                    onSelect: () => {
                      setCourseActions(null);
                      navigation?.onManageCourse?.(courseActions.course, 'edit');
                    },
                  },
                ]),
            ...(navigation?.onManageCourse
              ? [
                  {
                    key: 'delete',
                    label: '删除',
                    icon: <Trash2 size={17} strokeWidth={1.7} aria-hidden />,
                    destructive: true,
                    onboarding:
                      courseActions.course.id === PLATFORM_TUTORIAL_COURSE_ID
                        ? 'course-delete'
                        : undefined,
                    onSelect: () => {
                      setCourseActions(null);
                      navigation?.onManageCourse?.(courseActions.course, 'delete');
                    },
                  },
                ]
              : []),
          ]}
        />
      ) : null}
      {courseMenu ? (
        <CourseToolsMenu
          anchor={courseMenu.anchor}
          courseName={courseMenu.course.courseCode || courseMenu.course.name}
          onClose={() => setCourseMenu(null)}
          onSelect={(page) => {
            setCourseMenu(null);
            onOpenCourseTool(courseMenu.course.id, page);
          }}
        />
      ) : null}
      {menu ? (
        <div className="phone-chat-actions-layer">
          <button
            type="button"
            className="phone-chat-actions-backdrop"
            onClick={closeMenu}
            aria-label="关闭菜单"
          />
          <div
            className="phone-chat-actions-preview"
            style={{ top: menu.top, height: menu.height }}
          >
            {menu.conversation.title}
          </div>
          <div
            className={`phone-chat-actions${menu.placeAbove ? ' is-above' : ''}`}
            role="menu"
            aria-label={menu.conversation.title}
            style={
              menu.placeAbove
                ? { bottom: `calc(100% - ${menu.top - 8}px)` }
                : { top: menu.top + menu.height + 8 }
            }
          >
            <button type="button" role="menuitem" onClick={() => togglePinned(menu.conversation)}>
              {pinnedIds.includes(menu.conversation.id) ? (
                <>
                  <span>取消置顶</span>
                  <PinOff size={18} />
                </>
              ) : (
                <>
                  <span>置顶</span>
                  <Pin size={18} />
                </>
              )}
            </button>
            <button
              type="button"
              role="menuitem"
              className={
                menu.conversation.courseId === (selectedCourseId || null)
                  ? 'phone-chat-actions-danger'
                  : undefined
              }
              onClick={() => {
                const conversation = menu.conversation;
                closeMenu();
                const original =
                  conversation.courseId === (selectedCourseId || null)
                    ? conversations.find((row) => row.id === conversation.id)
                    : undefined;
                if (original) onDeleteConversation(original);
                else onOpenRecentChat?.(conversation.courseId, conversation.id);
              }}
            >
              {menu.conversation.courseId === (selectedCourseId || null) &&
              conversations.some((row) => row.id === menu.conversation.id) ? (
                <>
                  <span>删除</span>
                  <Trash2 size={18} />
                </>
              ) : (
                <>
                  <span>打开聊天</span>
                  <MessageCircle size={18} />
                </>
              )}
            </button>
          </div>
        </div>
      ) : null}
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
        <LearningEmptyState
          title="还没有上传笔记本"
          hint="上传后会出现在这里，方便拖动进度。"
          compact
        />
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
  activeTool: requestedTool,
  progressOnly = false,
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
  /** iPhone 右上角「进度」入口：只显示学习进度，不显示工具分栏。 */
  progressOnly?: boolean;
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
  const activeTool: CourseTool = progressOnly ? 'overview' : requestedTool;

  return (
    <div className="course-tools-panel">
      <header className="course-tools-heading">
        <h2>{progressOnly ? '学习进度' : '课程工具'}</h2>
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

      {progressOnly ? null : (
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
      )}

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
              {librarySearchBusy ? <GlassSpinner size={14} /> : null}
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
                  {syllabusBusy ? <GlassSpinner size={17} /> : <CloudUpload size={17} />}
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
                  {courseSettingsBusy ? <GlassSpinner size={14} /> : <Save size={14} />}
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
  initialDraft = '',
  onChangeChatScope,
  homeHref,
  onOpenRecentChat,
  generalChatClient,
  workspace,
  initialConversationId = null,
  initialPage,
  newEventDate,
  calendarDate,
  backendLabel,
  onBack,
  onOpenProblemBank,
  onOpenPractice,
  onWorkspaceChanged,
  courses,
  onSwitchCourse,
  onCreateCourseChat,
  onOpenCourseTool,
  onCreateCourse,
  onNewChat,
}: CourseWorkspaceProps) {
  const chatShell = useChatWorkspaceShell();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(() =>
    workspace.conversations.some((conversation) => conversation.id === initialConversationId)
      ? initialConversationId
      : null,
  );
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [scopeReady, setScopeReady] = useState(!initialConversationId);
  // 正在回答的那条消息用到的记忆和笔记，思考动画里画成真实颜色的珠子。
  const [thinkingRecall, setThinkingRecall] = useState<
    (ThinkingRecall & { messageId: string }) | null
  >(null);
  const [draft, setDraft] = useState(initialDraft);
  const [pendingImages, setPendingImages] = useState<PendingChatImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingChatFile[]>([]);
  // 手机端做题困难：聊天里不出现练习和复习题单；课堂讲解可以用。
  const phoneLayout = usePhoneLayout();
  const compactLayout = useCompactLayout();
  // 手机和窄窗口：点顶栏中间的课程名弹出学习菜单。
  const [headerMenuAnchor, setHeaderMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const courseMeta = usePlatformCourseMeta();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [activeTool, setActiveTool] = useState<CourseTool>('overview');
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const conversationContentRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pinnedToBottomRef = useRef(true);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  // 从侧边栏进的二级页面，返回时回到打开的侧边栏；从聊天里进的直接回聊天。
  const phonePageFromDrawerRef = useRef(false);
  // iPad 和桌面：侧边栏常驻，可以用聊天页左上角的按钮收起。
  const [localSidebarCollapsed, setLocalSidebarCollapsed] = useState(false);
  const splitSidebarCollapsed = chatShell?.collapsed ?? localSidebarCollapsed;

  // 下次启动时恢复当前课程与聊天。
  useEffect(() => {
    writePhoneLastChat({ courseId: workspace.course.id, conversationId: selectedConversationId });
  }, [selectedConversationId, workspace.course.id]);

  // 新手引导圈住输入框时，先替用户想好第一句；已经在写的不覆盖。
  useEffect(() => {
    const prefill = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text;
      if (!text) return;
      setDraft((current) => (current.trim() ? current : text));
      composerTextareaRef.current?.focus();
    };
    window.addEventListener(ONBOARDING_PREFILL_EVENT, prefill);
    return () => window.removeEventListener(ONBOARDING_PREFILL_EVENT, prefill);
  }, []);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [resource, setResource] = useState<LocalResourceDocument | null>(null);
  const notebookLoadRequestRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [platformAiAccess, setPlatformAiAccess] = useState<PlatformAiAccess>({
    status: 'checking',
    capabilities: null,
    message: '正在检查平台 AI 能力与登录状态…',
  });
  const [aiModel] = useState<SupportedAiModel>(readStoredAiModel);
  // 手机端和网页一样按回复强度（低 / 中 / 高）选模型，记在本机。
  const [phoneResponseStrength, setPhoneResponseStrength] = useState<ChatResponseStrength>(
    readStoredResponseStrength,
  );
  const changePhoneResponseStrength = useCallback((strength: ChatResponseStrength) => {
    setPhoneResponseStrength(strength);
    try {
      window.localStorage.setItem(RESPONSE_STRENGTH_STORAGE_KEY, strength);
    } catch {
      // 存不了就只在这次打开里生效。
    }
  }, []);
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
  // 网页会话分页：第一页随课程一起拉，侧边栏滚到底再拉下一页。
  const [conversationPage, setConversationPage] = useState<{
    nextCursor: string | null;
    totalCount: number;
    state: LoadMoreState;
  }>({ nextCursor: null, totalCount: 0, state: 'idle' });
  // 聊天只渲染最近的一段；往上翻到顶多显示一段，本机的看完了再向网页要更早的。
  const [visibleMessageCount, setVisibleMessageCount] = useState(LIST_WINDOW_SIZE);
  const [olderMessageCursor, setOlderMessageCursor] = useState<string | null>(null);
  const [olderMessagesState, setOlderMessagesState] = useState<LoadMoreState>('idle');
  const prependScrollRef = useRef<{ height: number; top: number } | null>(null);
  const courseIdRef = useRef(workspace.course.id);
  useLayoutEffect(() => {
    courseIdRef.current = workspace.course.id;
  }, [workspace.course.id]);
  const [notice, setNotice] = useState<string | null>(null);
  /** 机构发了新版：打开课程时在输入框上方亮一下更新摘要。 */
  const [updateNote, setUpdateNote] = useState<{ courseId: string; text: string } | null>(null);
  const updateNoteText = updateNote?.courseId === workspace.course.id ? updateNote.text : null;
  const [scheduleItems, setScheduleItems] = useState<LocalCourseEvent[]>([]);
  /** 网页数据同步到本机后加一，触发日历和课堂重新读取。 */
  const [courseDataRevision, setCourseDataRevision] = useState(0);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(Boolean(newEventDate));
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [calendarDialogOpen, setCalendarDialogOpen] = useState(false);
  const [calendarReferenceDate, setCalendarReferenceDate] = useState(() => new Date());
  const [calendarDayItems, setCalendarDayItems] = useState<LocalCourseEvent[]>([]);
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(false);
  const [focusedMemoryId, setFocusedMemoryId] = useState<string | null>(null);
  // 学习页在右侧标签中保持挂载，切换时保留搜索和滚动位置。
  const [phonePage, setPhonePageState] = useState<
    | 'profile'
    | 'materials'
    | 'notes'
    | 'progress'
    | 'memory'
    | 'calendar'
    | 'classroom'
    | 'problems'
    | null
  >(() => initialPage ?? readOpenPhonePage());
  const [learningPages, setLearningPages] = useState<CourseLearningPage[]>(() => {
    const page = initialPage ?? readOpenPhonePage();
    return page && page !== 'calendar' ? [page] : [];
  });
  const setPhonePage = useCallback(
    (page: typeof phonePage) => {
      if (page && page !== 'profile' && page !== 'calendar') {
        // 手机和窄窗口没有标签：一次只开一页，返回就回到聊天。
        setLearningPages((pages) =>
          compactLayout ? [page] : pages.includes(page) ? pages : [...pages, page],
        );
      }
      setPhonePageState(page);
    },
    [compactLayout],
  );
  const activeLearningPage =
    phonePage && phonePage !== 'profile' && phonePage !== 'calendar'
      ? phonePage
      : learningPages.at(-1);
  const closeLearningPage = (page: CourseLearningPage) => {
    const index = learningPages.indexOf(page);
    const remaining = learningPages.filter((item) => item !== page);
    setLearningPages(remaining);
    if (activeLearningPage === page)
      setPhonePageState(remaining[index] ?? remaining[index - 1] ?? null);
  };
  // 笔记 / 题库页的上传键：文件交给资料页，用同一条整理队列。
  const [pendingMaterialUpload, setPendingMaterialUpload] = useState<{
    kind: CourseMaterialKind;
    files: File[];
  } | null>(null);
  const uploadFromPage = (kind: CourseMaterialKind, files: File[]) => {
    setPendingMaterialUpload({ kind, files });
    setPhonePage('materials');
  };
  const [marbleCatch, setMarbleCatch] = useState<MarbleCatch | null>(null);
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
  const [scheduleDate, setScheduleDate] = useState(newEventDate ?? '');
  const [scheduleNote, setScheduleNote] = useState('');
  const [scheduleKind, setScheduleKind] = useState<LocalCourseEventKind>('other');
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const chatDropTargetRef = useRef<HTMLElement>(null);
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
  const chatAvailable = platformReady && platformAiAccess.capabilities?.capabilities.chat === true;
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
    if (!courseDataRevision) setScheduleItems([]);

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
  }, [courseDataRevision, workspace.course.id]);

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
  }, [courseDataRevision, workspace.course.id, workspace.notebooks]);

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
    setVisibleMessageCount(LIST_WINDOW_SIZE);
    setOlderMessageCursor(null);
    setOlderMessagesState('idle');

    if (!selectedConversationId) {
      setScopeReady(true);
      setMessages([]);
      setMiniLectureDecksByMessageId(new Map());
      return;
    }

    if (skipConversationLoadRef.current === selectedConversationId) {
      skipConversationLoadRef.current = null;
      setScopeReady(true);
      setMiniLectureDecksByMessageId(new Map());
      return;
    }

    setScopeReady(false);
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
        setScopeReady(true);
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

    // 网页对话：点开时再下载最近 30 条，之前只预先下载了最近几段。
    const conversationId = selectedConversationId;
    void getLocalRepository()
      .then(async (repository) => {
        const page = await refreshConversationMessages(
          repository,
          courseIdRef.current,
          conversationId,
        );
        if (!page || cancelled || requestId !== conversationLoadRequestRef.current) return;
        setOlderMessageCursor(page.olderCursor);
        if (!page.inserted || busyRef.current) return;
        const [loadedMessages, decks] = await Promise.all([
          repository.listMessages(conversationId),
          repository.listMiniLectureDecks(conversationId),
        ]);
        if (cancelled || requestId !== conversationLoadRequestRef.current || busyRef.current) {
          return;
        }
        setMessages(loadedMessages);
        setMiniLectureDecksByMessageId(
          new Map(
            decks
              .filter((deck) => deck.status === 'ready')
              .map((deck) => [deck.messageId, deck] as const),
          ),
        );
      })
      .catch((cause) => console.warn('[chat-sync] conversation refresh failed', cause));

    return () => {
      cancelled = true;
    };
  }, [selectedConversationId]);

  // 网页上的课程：打开时把网页端的对话拉到本机，两边看到同一份聊天记录。
  const conversationsRef = useRef(workspace.conversations);
  const onWorkspaceChangedRef = useRef(onWorkspaceChanged);
  useEffect(() => {
    conversationsRef.current = workspace.conversations;
    onWorkspaceChangedRef.current = onWorkspaceChanged;
  }, [onWorkspaceChanged, workspace.conversations]);
  // 加入的课里删除、恢复、复制笔记或题目之后：重新同步这门课，本机列表马上跟上。
  const resyncCourseContent = useCallback(async () => {
    const repository = await getLocalRepository();
    await syncCourseData(repository, workspace.course.id).catch((cause) =>
      console.warn('[course-sync] resync failed', cause),
    );
    await onWorkspaceChangedRef.current();
  }, [workspace.course.id]);
  useEffect(() => {
    const courseId = workspace.course.id;
    let cancelled = false;
    setConversationPage({ nextCursor: null, totalCount: 0, state: 'idle' });
    void (async () => {
      const repository = await getLocalRepository();
      const page = await pullCourseConversations(repository, courseId, conversationsRef.current);
      if (cancelled) return;
      const changed = page.changed;
      setConversationPage({
        nextCursor: page.nextCursor,
        totalCount: page.totalCount,
        state: 'idle',
      });
      if (changed) await onWorkspaceChangedRef.current();
      // 笔记、学习记忆、日历、网页上生成的课堂和题库也跟着同步到本机。
      const synced = await syncCourseData(repository, courseId).catch((cause) => {
        console.warn('[course-sync] sync failed', cause);
        return null;
      });
      if (cancelled) return;
      if (synced?.notebooks || synced?.memories || synced?.problems)
        await onWorkspaceChangedRef.current();
      if (synced?.events || synced?.lectures || synced?.progress) {
        setCourseDataRevision((value) => value + 1);
      }
      // 机构发了新版：打开看过就熄灭课程旁的更新弹珠，别的设备下次同步也会熄灭。
      const courseMetaNow = readPlatformCourseMeta()[courseId];
      if (courseMetaNow?.hasUpdate) {
        setUpdateNote({ courseId, text: courseMetaNow.updateSummary || '机构发布了新版' });
        clearPlatformCourseUpdate(courseId);
        void nativeStoreAction(courseId, 'seen').catch((cause) =>
          console.warn('[store] mark seen failed', cause),
        );
      }
      const conversationId = activeConversationIdRef.current;
      if (!(changed || synced?.lectures) || !conversationId || busyRef.current) return;
      const [loadedMessages, decks] = await Promise.all([
        repository.listMessages(conversationId),
        repository.listMiniLectureDecks(conversationId),
      ]);
      if (!cancelled && activeConversationIdRef.current === conversationId && !busyRef.current) {
        setMessages(loadedMessages);
        setMiniLectureDecksByMessageId(
          new Map(
            decks
              .filter((deck) => deck.status === 'ready')
              .map((deck) => [deck.messageId, deck] as const),
          ),
        );
      }
    })().catch((cause) => console.warn('[chat-sync] pull failed', cause));
    return () => {
      cancelled = true;
    };
  }, [workspace.course.id]);

  const loadMoreConversations = useCallback(async () => {
    const cursor = conversationPage.nextCursor;
    if (!cursor || conversationPage.state === 'loading') return;
    const courseId = workspace.course.id;
    setConversationPage((current) => ({ ...current, state: 'loading' }));
    try {
      const repository = await getLocalRepository();
      const page = await pullMoreCourseConversations(
        repository,
        courseId,
        cursor,
        conversationsRef.current,
      );
      if (courseIdRef.current !== courseId) return;
      if (page.changed) await onWorkspaceChangedRef.current();
      setConversationPage({
        nextCursor: page.nextCursor,
        totalCount: page.totalCount,
        state: 'idle',
      });
    } catch (cause) {
      console.warn('[chat-sync] next conversation page failed', cause);
      if (courseIdRef.current === courseId) {
        setConversationPage((current) => ({ ...current, state: 'error' }));
      }
    }
  }, [conversationPage, workspace.course.id]);

  const conversationPaging = useMemo<ConversationPaging>(
    () => ({
      hasMore: Boolean(conversationPage.nextCursor),
      state: conversationPage.state,
      onLoadMore: loadMoreConversations,
    }),
    [conversationPage, loadMoreConversations],
  );

  const searchRemoteConversations = useCallback(
    (query: string) => {
      const courseId = workspace.course.id;
      void getLocalRepository()
        .then((repository) =>
          searchCourseConversations(repository, courseId, query, conversationsRef.current),
        )
        .then((changed) => {
          if (changed && courseIdRef.current === courseId) return onWorkspaceChangedRef.current();
        })
        .catch((cause) => console.warn('[chat-sync] conversation search failed', cause));
    },
    [workspace.course.id],
  );
  useRemoteConversationSearch(
    conversationSearchQuery,
    allConversationsOpen ? searchRemoteConversations : undefined,
  );

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
  const allConversationsWindow = useListWindow(
    filteredConversations.length,
    `${workspace.course.id}:${conversationSearchQuery}`,
  );

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
              const pushed = pending;
              // 网页课程：同时写回账号，网页右侧的学习进度跟着变。
              void pushLearningProgress(
                repository,
                pushed.courseId,
                pushed.completedNotebookCount,
                pushed.currentNotebookId ?? null,
              ).catch((cause) => {
                console.warn('[course-sync] progress push failed', cause);
                if (
                  activeCourseIdRef.current === pushed.courseId &&
                  pushed.requestId === courseProgressSaveRequestRef.current
                ) {
                  setError('学习进度已存在手机上，但同步到账号失败，联网后再拖一次即可。');
                }
              });
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

  const addChatImages = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const courseId = workspace.course.id;
      const room = Math.max(0, MAX_CHAT_IMAGES - pendingImages.length);
      const prepared = await Promise.allSettled(files.slice(0, room).map(prepareChatImage));
      if (activeCourseIdRef.current !== courseId) return;
      const images = prepared.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const failures = prepared.flatMap((result) =>
        result.status === 'rejected' ? [errorMessage(result.reason)] : [],
      );
      if (files.length > room)
        failures.push(`一次最多发送 ${MAX_CHAT_IMAGES} 张图片，多出的已忽略。`);
      setPendingImages((current) => [...current, ...images].slice(0, MAX_CHAT_IMAGES));
      if (failures.length) setError((current) => [current, ...failures].filter(Boolean).join('\n'));
    },
    [pendingImages.length, workspace.course.id],
  );

  const addChatFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const courseId = workspace.course.id;
      const room = Math.max(0, MAX_CHAT_FILES - pendingFiles.length);
      const prepared = await Promise.allSettled(files.slice(0, room).map(prepareChatFile));
      if (activeCourseIdRef.current !== courseId) return;
      const ready = prepared.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const failures = prepared.flatMap((result) =>
        result.status === 'rejected' ? [errorMessage(result.reason)] : [],
      );
      if (files.length > room) failures.push(`一次最多发送 ${MAX_CHAT_FILES} 个文件。`);
      setPendingFiles((current) => [...current, ...ready].slice(0, MAX_CHAT_FILES));
      if (failures.length) setError((current) => [current, ...failures].filter(Boolean).join('\n'));
    },
    [pendingFiles.length, workspace.course.id],
  );

  /** 聊天“+”和拖进聊天的东西：图片走照片，其余当文件发给助教。 */
  const addChatAttachments = useCallback(
    async (files: File[]) => {
      await Promise.all([
        addChatImages(files.filter(isChatImageFile)),
        addChatFiles(files.filter((file) => !isChatImageFile(file))),
      ]);
    },
    [addChatFiles, addChatImages],
  );

  const handleImageSelection = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      setError(null);
      void addChatAttachments(files).catch((cause) => setError(errorMessage(cause)));
    },
    [addChatAttachments],
  );

  const handleChatFileDrop = useCallback(
    (files: File[]) => {
      setError(null);
      setNotice(null);
      void addChatAttachments(files).catch((cause) => setError(errorMessage(cause)));
    },
    [addChatAttachments],
  );

  const chatFileDragging = useChatFileDrop(
    chatDropTargetRef,
    !phoneLayout && !phonePage && !resource && !activeMiniLecture,
    handleChatFileDrop,
  );

  const handleAttachmentSelection = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      setError(null);
      void addChatAttachments(files).catch((cause) => setError(errorMessage(cause)));
    },
    [addChatAttachments],
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

  const createConversation = useCallback(() => {
    if (busyRef.current) return;
    conversationLoadRequestRef.current += 1;
    skipConversationLoadRef.current = null;
    activeConversationIdRef.current = null;
    setSelectedConversationId(null);
    setMessages([]);
    setScopeReady(true);
    setDraft('');
    setPendingImages([]);
    setPendingFiles([]);
    setError(null);
    setMobilePanel(null);
    setPhonePage(null);
  }, [setPhonePage]);

  const selectConversation = useCallback(
    (conversationId: string) => {
      if (conversationId === activeConversationIdRef.current) {
        setMobilePanel(null);
        setPhonePage(null);
        return;
      }
      setScopeReady(false);
      conversationLoadRequestRef.current += 1;
      skipConversationLoadRef.current = null;
      activeConversationIdRef.current = conversationId;
      setSelectedConversationId(conversationId);
      setMobilePanel(null);
      setPhonePage(null);
    },
    [setPhonePage],
  );

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
      // 网页课程的对话先在网页删除，失败就保留本机记录，避免下次同步又出现。
      await deleteRemoteConversation(repository, deleting);
      await repository.deleteConversation(deleting.id);
      // 这条对话里记下的记忆一起删掉（网页同步下来的不动）。
      await deleteConversationMemories(repository, deleting.id);
      if (selectedConversationId === deleting.id) {
        conversationLoadRequestRef.current += 1;
        skipConversationLoadRef.current = null;
        activeConversationIdRef.current = null;
        setSelectedConversationId(null);
        setMessages([]);
      }
      setConversationToDelete(null);
      await onWorkspaceChanged();
      setNotice(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [busy, conversationToDelete, onWorkspaceChanged, selectedConversationId]);

  const openNotebook = useCallback(async (notebook: LocalNotebook) => {
    const requestId = ++notebookLoadRequestRef.current;
    setResourceBusy(true);
    setError(null);
    try {
      const repository = await getLocalRepository();
      const document = await loadNotebookForReading(repository, notebook.id);
      if (!document) throw new Error('本地找不到这个笔记本。');
      if (requestId !== notebookLoadRequestRef.current) return;
      setResource({ kind: 'notebook', document });
      setMobilePanel(null);
    } catch (cause) {
      if (requestId === notebookLoadRequestRef.current) setError(errorMessage(cause));
    } finally {
      if (requestId === notebookLoadRequestRef.current) setResourceBusy(false);
    }
  }, []);

  const openNotebookById = useCallback(
    (notebookId: string) => {
      const notebook = workspace.notebooks.find(({ id }) => id === notebookId);
      if (notebook) void openNotebook(notebook);
    },
    [openNotebook, workspace.notebooks],
  );

  // iPad 和桌面上题库也占满右侧聊天区，侧边栏保留；做题时才进入全屏。
  const openProblemBank = useCallback(() => {
    if (phoneLayout) onOpenProblemBank();
    else setPhonePage('problems');
    setMobilePanel(null);
  }, [onOpenProblemBank, phoneLayout, setPhonePage]);

  const openPracticeFromBank = useCallback(
    (launch: ProblemBankLaunch) => {
      try {
        window.sessionStorage.setItem(OPEN_PHONE_PAGE_KEY, 'problems');
      } catch {
        // 存不了就做完题回到聊天。
      }
      onOpenPractice(launch);
    },
    [onOpenPractice],
  );

  const openNotebookLibrary = useCallback(() => {
    setMobilePanel(null);
    setPhonePage('notes');
  }, [setPhonePage]);

  const openCalendarDialog = useCallback(() => {
    setCalendarDialogOpen(true);
    setCalendarDayItems([]);
    setMobilePanel(null);
  }, []);

  const openMemoryDialog = useCallback(
    (memoryId: string | null = null) => {
      setFocusedMemoryId(memoryId);
      setMobilePanel(null);
      setPhonePage('memory');
    },
    [setPhonePage],
  );

  const openCourseJar = useCallback(
    (courseId: string) => {
      if (courseId === workspace.course.id) {
        setFocusedMemoryId(null);
        setPhonePage('memory');
        return;
      }
      try {
        window.sessionStorage.setItem(OPEN_PHONE_PAGE_KEY, 'memory');
      } catch {
        // 存不了就只换课，不自动打开记忆页。
      }
      onSwitchCourse(courseId);
    },
    [onSwitchCourse, setPhonePage, workspace.course.id],
  );

  useEffect(() => {
    try {
      window.sessionStorage.removeItem(OPEN_PHONE_PAGE_KEY);
    } catch {
      // ignore
    }
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

  const openRemoteMiniLecture = useCallback(async (lecture: NativeSyncedMiniLecture) => {
    const requestId = ++miniLectureLoadRequestRef.current;
    setMiniLectureLoadingDeckId(lecture.id);
    try {
      const manifest = await getNativeMiniLecture(lecture.id);
      const runtimeDeck = miniLectureManifestToRuntime(manifest);
      if (requestId === miniLectureLoadRequestRef.current) setActiveMiniLecture(runtimeDeck);
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
          const kind = payloadText(memoryValue, 'kind') || 'learner_state';
          const notebookId = payloadText(memoryValue, 'notebookId');
          // 星图按这些字符串连线：section:笔记节、concept:概念、problem:题目。
          const references = payloadStringList(memoryValue.sourceReferences);
          // 同一个点已经有珠子了（AI 指明的那颗，或同章节、同种类、共用一个概念的那颗）：合并，不新增。
          const requestedId = payloadText(memoryValue, 'id', 'memoryId');
          const existing =
            workspace.memories.find((item) => item.id === requestedId) ??
            workspace.memories.find(
              (item) =>
                item.status === 'active' &&
                item.kind === kind &&
                (item.notebookId ?? '') === notebookId &&
                item.sourceReferences.some(
                  (ref) =>
                    typeof ref === 'string' &&
                    ref.startsWith('concept:') &&
                    references.includes(ref),
                ),
            );
          const timestamp = Date.now();
          const memory = await repository.upsertStudyMemory({
            id: existing?.id ?? `native-memory-${crypto.randomUUID()}`,
            courseId: workspace.course.id,
            notebookId: notebookId || existing?.notebookId || null,
            targetType: payloadText(memoryValue, 'targetType') || 'course',
            scope: payloadText(memoryValue, 'scope') || 'course',
            kind,
            status: 'active',
            source: 'ai-proposal-confirmed',
            // 合并进旧珠子时，它还算最初记下它的那条对话。
            conversationId: existing ? (existing.conversationId ?? null) : message.conversationId,
            title: payloadText(memoryValue, 'title') || action.label,
            text,
            reason: payloadText(memoryValue, 'reason') || action.summary || null,
            question: payloadText(memoryValue, 'question') || null,
            sourceReferences: [
              ...new Set([
                ...(existing?.sourceReferences ?? []).filter(
                  (ref): ref is string => typeof ref === 'string',
                ),
                ...references,
              ]),
            ],
            confidence: typeof memoryValue.confidence === 'number' ? memoryValue.confidence : null,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
          });
          if (existing) markMemoryReviewed(existing.id, timestamp);
          await onWorkspaceChanged();
          // 推到服务器，iPad / 电脑上也能看到这颗珠子（网页看不到）。
          void syncAppMemories(repository, workspace.course.id).catch((cause) =>
            console.warn('[memory-sync] push failed', cause),
          );
          // 记住了：右下角浮出这门课的小星图，卡片上的珠子飞进去，再蹦到它的章节旁边。
          setMarbleCatch({
            key: `${memory.id}:${Date.now()}`,
            courseId: workspace.course.id,
            courseLabel: workspace.course.courseCode || workspace.course.name,
            notebooks: workspace.notebooks,
            memories: workspace.memories.filter((item) => item.id !== memory.id),
            incoming: memory,
            from: document.querySelector(
              `[data-learning-action-id="${CSS.escape(action.id)}"] .learning-confirmation-mark`,
            ),
          });
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
      workspace.course.courseCode,
      workspace.course.name,
      workspace.memories,
      workspace.notebooks,
      workspace.problems,
    ],
  );

  const sendButtonRef = useRef<HTMLButtonElement | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const [autoSendTick, setAutoSendTick] = useState(0);
  const send = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const images = pendingImages;
      const attachedFiles = pendingFiles;
      const text =
        draft.trim() ||
        (images.length
          ? '请看图片里的题目，帮我讲解。'
          : attachedFiles.length
            ? '帮我看看这个文件。'
            : '');
      if (!text || busy) return;
      if (!chatAvailable) {
        setError(platformAiAccess.message);
        return;
      }
      setBusy(true);
      setError(null);
      setDraft('');
      setPendingImages([]);
      setPendingFiles([]);
      if (workspace.course.id === PLATFORM_TUTORIAL_COURSE_ID) completeOnboardingStep('ask');
      replayClass(sendButtonRef.current, 'is-rolling');
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
          ...(images.length || attachedFiles.length
            ? {
                metadata: {
                  ...(images.length
                    ? {
                        images: images.map(({ name, thumbnailDataUrl }) => ({
                          name,
                          thumbnailDataUrl,
                        })),
                      }
                    : {}),
                  // 原文件不存，只记名字和类型，历史里显示成文件药丸。
                  ...(attachedFiles.length
                    ? {
                        files: attachedFiles.map(({ name, kind, size, mimeType }) => ({
                          name,
                          kind,
                          size,
                          mimeType,
                        })),
                      }
                    : {}),
                },
              }
            : {}),
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
        const surface = detectChatSurface(phoneLayout);
        const context = await buildNativeChatContext({
          repository,
          workspace,
          surface,
          readableNotebooks: orderedProgressNotebooks.slice(0, completedNotebookCount),
          learningState: courseLearningState,
          scheduleItems,
          history,
        });
        setThinkingRecall({
          messageId: optimisticAssistantId,
          memoryKinds: context.memories.map((memory) => memory.kind),
          noteCount: context.notes.length,
        });
        const result = await streamNativeChat(
          {
            requestId: optimisticAssistantId,
            surface,
            course: {
              id: workspace.course.id,
              name: workspace.course.name,
              code: workspace.course.courseCode,
              description: workspace.course.description.slice(0, 4000),
              language: workspace.course.language,
            },
            messages: history.flatMap(({ role, text }) =>
              role === 'user' || role === 'assistant' ? [{ role, text: text.slice(0, 6000) }] : [],
            ),
            images: images.map(({ name, mimeType, dataBase64 }) => ({
              name,
              mimeType,
              dataBase64,
            })),
            files: attachedFiles.map(({ name, mimeType, dataBase64 }) => ({
              name,
              mimeType,
              dataBase64,
            })),
            context,
          },
          { responseStrength: phoneResponseStrength, model: aiModel },
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
        const now = Date.now();
        void pushConversation(repository, {
          id: conversationId,
          courseId: workspace.course.id,
          notebookId: null,
          title:
            workspace.conversations.find((item) => item.id === conversationId)?.title ??
            text.slice(0, 24),
          createdAt: now,
          updatedAt: now,
        }).catch((cause) => console.warn('[chat-sync] push failed', cause));
        await onWorkspaceChanged();
        // 学生明说“记住…”的那条记忆不用再点确认，直接飞进星图。
        for (const action of assistantMessage.metadata?.learningActions ?? []) {
          if (action.kind === 'memory.propose_write' && action.payload?.autoConfirm === true) {
            await executeLearningAction(assistantMessage, action);
          }
        }
      } catch (cause) {
        if (!userMessage) {
          setDraft(draft);
          setPendingImages(images);
          setPendingFiles(attachedFiles);
        }
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
      executeLearningAction,
      messages,
      onWorkspaceChanged,
      phoneLayout,
      phoneResponseStrength,
      platformAiAccess.message,
      selectedConversationId,
      workspace,
      scheduleItems,
      chatAvailable,
      pendingImages,
      pendingFiles,
    ],
  );

  // 点了教程里的默认问题：草稿填好后立刻发出去。
  useEffect(() => {
    if (autoSendTick) composerFormRef.current?.requestSubmit();
  }, [autoSendTick]);

  const sessionPanel = (
    <SessionsPanel
      conversations={workspace.conversations}
      paging={conversationPaging}
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
      <button type="button" onClick={onBack} aria-label="返回 聊天">
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

  const currentConversationTitle =
    workspace.conversations.find((conversation) => conversation.id === selectedConversationId)
      ?.title || '新聊天';
  const courseAvatarUrl = resolveNativeCourseAvatar(
    workspace.course.id,
    workspace.course.courseCode,
    courseAvatarIdDraft,
  );

  const messageWindowStart = Math.max(0, messages.length - visibleMessageCount);
  const rememberScrollBeforePrepend = () => {
    const content = conversationContentRef.current;
    prependScrollRef.current = content
      ? { height: content.scrollHeight, top: content.scrollTop }
      : null;
  };
  const loadOlderMessages = useCallback(async () => {
    if (messageWindowStart > 0) {
      rememberScrollBeforePrepend();
      setVisibleMessageCount((count) => count + LIST_WINDOW_SIZE);
      return;
    }
    const conversationId = activeConversationIdRef.current;
    if (!olderMessageCursor || !conversationId) return;
    setOlderMessagesState('loading');
    try {
      const repository = await getLocalRepository();
      const page = await loadOlderConversationMessages(
        repository,
        courseIdRef.current,
        conversationId,
        olderMessageCursor,
      );
      if (activeConversationIdRef.current !== conversationId) return;
      if (page?.inserted) {
        const loaded = await repository.listMessages(conversationId);
        if (activeConversationIdRef.current !== conversationId) return;
        rememberScrollBeforePrepend();
        // 正在回复时也能翻：只补进本地还没有的更早消息，不动正在生成的那几条。
        setMessages((current) => {
          const known = new Set(current.map((message) => message.id));
          const older = loaded.filter((message) => !known.has(message.id));
          return older.length
            ? [...older, ...current].sort((left, right) => left.createdAt - right.createdAt)
            : current;
        });
        setVisibleMessageCount((count) => count + LIST_WINDOW_SIZE);
      }
      setOlderMessageCursor(page?.olderCursor ?? null);
      setOlderMessagesState('idle');
    } catch (cause) {
      console.warn('[chat-sync] older messages failed', cause);
      if (activeConversationIdRef.current === conversationId) setOlderMessagesState('error');
    }
  }, [messageWindowStart, olderMessageCursor]);

  // 往上加载更早的消息后保持正在看的位置，不跳到顶部。
  useLayoutEffect(() => {
    const anchor = prependScrollRef.current;
    const content = conversationContentRef.current;
    if (!anchor || !content) return;
    prependScrollRef.current = null;
    content.scrollTop = anchor.top + (content.scrollHeight - anchor.height);
  }, [messages, visibleMessageCount]);

  // 手机聊天：停在底部时新消息、图片加载和键盘弹出都跟着滚到底；往上翻过就不打扰。
  const scrollToBottomIfPinned = useCallback(() => {
    const content = conversationContentRef.current;
    if (!content || !pinnedToBottomRef.current) return;
    content.scrollTop = content.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    pinnedToBottomRef.current = true;
  }, [selectedConversationId]);

  useLayoutEffect(() => {
    scrollToBottomIfPinned();
  }, [messages, scrollToBottomIfPinned]);

  const closePhonePage = () => {
    setPhonePage(null);
    // 没有标签时，返回就是离开这一页。
    if (compactLayout) setLearningPages([]);
    if (phonePageFromDrawerRef.current) setMobilePanel('sessions');
    phonePageFromDrawerRef.current = false;
  };
  // 空页面的「去聊天」：直接回到聊天，不再打开抽屉。
  const backToChat = () => {
    phonePageFromDrawerRef.current = false;
    closePhonePage();
  };

  const hasMessages = messages.length > 0;
  useEffect(() => {
    const content = conversationContentRef.current;
    const stream = content?.firstElementChild;
    if (!stream || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(scrollToBottomIfPinned);
    observer.observe(stream);
    return () => observer.disconnect();
  }, [hasMessages, scrollToBottomIfPinned]);

  // 安卓返回键：依次关掉最上层的确认框、阅读器、课堂、二级页面和抽屉。
  useBackDismiss(scheduleDialogOpen, closeScheduleEditor, 20);
  useBackDismiss(Boolean(conversationToDelete), () => setConversationToDelete(null));
  useBackDismiss(Boolean(resource), () => setResource(null));
  useBackDismiss(Boolean(activeMiniLecture), () => setActiveMiniLecture(null));
  useBackDismiss(Boolean(phonePage), closePhonePage);
  useBackDismiss(phoneLayout && mobilePanel !== null, () => setMobilePanel(null));

  // iPad 的软键盘同样会挤占可视区域；桌面上可视区域不变，等于不生效。
  usePhoneKeyboardInset(true, workspaceRef, scrollToBottomIfPinned);

  // 输入框随文字变高，最多五六行。
  useLayoutEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
  }, [draft]);

  const handleConversationScroll = () => {
    const content = conversationContentRef.current;
    if (!content) return;
    pinnedToBottomRef.current =
      content.scrollHeight - content.scrollTop - content.clientHeight < 80;
  };

  // 手指在聊天记录上划动时收起键盘，和 ChatGPT 一样。
  const dismissKeyboardOnDrag = (event: ReactTouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    const touch = event.touches[0];
    if (!phoneLayout || !start || !touch) return;
    if (Math.abs(touch.clientY - start.y) < 12) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.conversation-composer')) active.blur();
  };

  // 从屏幕左边缘往右划打开侧边栏；打开后往左划关上。
  const handleWorkspaceTouchStart = (event: ReactTouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    if (!touch || event.touches.length > 1) {
      swipeStartRef.current = null;
      return;
    }
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleWorkspaceTouchEnd = (event: ReactTouchEvent<HTMLElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    const touch = event.changedTouches[0];
    if (!phoneLayout || !start || !touch || phonePage) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (mobilePanel === 'sessions') {
      if (dx < 0) setMobilePanel(null);
    } else if (!mobilePanel && dx > 0 && start.x <= 28) {
      setMobilePanel('sessions');
    }
  };

  // 手机上侧边栏是抽屉，打开二级页面时先收起、返回时再打开；iPad 和桌面上侧边栏常驻。
  const openFromDrawer = (open: () => void) => {
    if (phoneLayout) {
      phonePageFromDrawerRef.current = true;
      setMobilePanel(null);
    }
    open();
  };
  // 手机没有题库；加入的机构课程里补的笔记和题目只在自己的私有层。
  const materialKinds: CourseMaterialKind[] = phoneLayout ? ['notes'] : ['notes', 'problems'];
  const enrolledCourse = courseMeta[workspace.course.id]?.accessRole === 'enrolled';
  const courseToolActions: DrawerLearningAction[] = [
    { id: 'materials', label: '资料', icon: FolderUp, open: () => setPhonePage('materials') },
    {
      id: 'notes',
      label: '笔记',
      icon: BookOpen,
      open: openNotebookLibrary,
      count: workspace.notebooks.length,
    },
    { id: 'progress', label: '学习进度', icon: Target, open: () => setPhonePage('progress') },
    {
      id: 'memory',
      label: '学习记忆',
      icon: Brain,
      open: () => openMemoryDialog(),
      count: workspace.memories.length,
    },
    { id: 'classroom', label: '课堂', icon: Presentation, open: () => setPhonePage('classroom') },
    ...(!phoneLayout
      ? [
          {
            id: 'problems',
            label: '题库',
            icon: FileQuestion,
            open: openProblemBank,
            count: workspace.problems.length,
          },
        ]
      : []),
  ];

  const floatSections = useMemo<LearningFloatSection[]>(() => {
    if (phoneLayout) return [];
    const sections: LearningFloatSection[] = [];
    const today = new Date().toLocaleDateString('en-CA');
    const horizon = new Date(Date.now() + 14 * 86_400_000).toLocaleDateString('en-CA');
    const upcoming = scheduleItems
      .filter((item) => item.status === 'active' && item.date >= today && item.date <= horizon)
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(0, 2);
    if (upcoming.length) {
      sections.push({
        id: 'upcoming',
        title: '接下来',
        rows: upcoming.map((item) => ({
          id: item.id,
          tool: 'calendar',
          icon: CalendarDays,
          label: item.title,
          hint: daysUntilLabel(item.date, today),
          open: openCalendarDialog,
        })),
      });
    }

    // 这次聊天产出的：推荐的题、复习计划、课堂、记下的记忆，各取最新一份。
    const outputs: LearningFloatSection['rows'] = [];
    const scrollTo = (messageId: string) =>
      document
        .querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const assistantMessages = messages.filter((message) => message.role === 'assistant').reverse();
    const selection = assistantMessages.find(
      (message) => message.metadata?.problemSelection?.problems.length,
    )?.metadata?.problemSelection;
    const selectedIds = (selection?.problems ?? [])
      .map(({ problemId }) => problemId)
      .filter((id) => workspace.problems.some((problem) => problem.id === id));
    if (selectedIds.length) {
      outputs.push({
        id: 'problems',
        tool: 'problems',
        icon: FileQuestion,
        label: selection?.title || '推荐的题',
        hint: `${selectedIds.length} 道`,
        open: () => onOpenPractice({ problemIds: selectedIds, initialProblemId: selectedIds[0] }),
      });
    }
    const planMessage = assistantMessages.find((message) => message.metadata?.reviewPlan);
    const plan = planMessage?.metadata?.reviewPlan;
    if (planMessage && plan) {
      outputs.push({
        id: 'plan',
        tool: 'progress',
        icon: Target,
        label: plan.title || '复习计划',
        hint: plan.tasks.length ? `${plan.tasks.length} 项` : undefined,
        open: () => scrollTo(planMessage.id),
      });
    }
    const lectureDeck = assistantMessages
      .map((message) => miniLectureDecksByMessageId.get(message.id))
      .find(Boolean);
    if (lectureDeck) {
      outputs.push({
        id: 'lecture',
        tool: 'classroom',
        icon: Presentation,
        label: lectureDeck.title || '这次的课堂',
        open: () => void openMiniLecture(lectureDeck),
      });
    }
    const caught = selectedConversationId
      ? workspace.memories.filter((memory) => memory.conversationId === selectedConversationId)
      : [];
    if (caught.length) {
      outputs.push({
        id: 'caught',
        tool: 'memory',
        icon: Brain,
        label: '记下的记忆',
        hint: `${caught.length} 颗`,
        open: () => openMemoryDialog(caught[0].id),
      });
    }
    if (outputs.length) sections.push({ id: 'outputs', title: '这次聊天', rows: outputs });

    // 回答引用到的笔记、资料、记忆和题，能在本机打开的才列出来。
    const sources: LearningFloatSection['rows'] = [];
    const seen = new Set<string>();
    for (const message of assistantMessages) {
      for (const evidence of message.metadata?.evidence ?? []) {
        if (!FLOAT_SOURCE_TYPES.has(evidence.sourceType) || !evidence.sourceId) continue;
        const key = `${evidence.sourceType}:${evidence.sourceId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const sourceId = evidence.sourceId;
        if (evidence.sourceType === 'memory') {
          const memory = workspace.memories.find(({ id }) => id === sourceId);
          if (memory)
            sources.push({
              id: key,
              tool: 'memory',
              icon: Brain,
              label: memory.title,
              open: () => openMemoryDialog(memory.id),
            });
        } else if (evidence.sourceType === 'problem_bank') {
          const problem = workspace.problems.find(({ id }) => id === sourceId);
          if (problem)
            sources.push({
              id: key,
              tool: 'problems',
              icon: FileQuestion,
              label: problem.title,
              open: () => openProblem(problem),
            });
        } else {
          const notebook = workspace.notebooks.find(({ id }) => id === sourceId);
          if (notebook)
            sources.push({
              id: key,
              tool: 'notes',
              icon: BookOpen,
              label: notebook.name,
              open: () => void openNotebook(notebook),
            });
        }
      }
    }
    if (sources.length) {
      sections.push({
        id: 'sources',
        title: '引用',
        count: sources.length > 3 ? sources.length : undefined,
        rows: sources.slice(0, 3),
      });
    }

    // 好几天没复习、已经起雾的记忆。
    const reviewed = readReviewedMap();
    const stale = workspace.memories
      .map((memory) => ({ memory, freshness: memoryFreshness(memory, reviewed) }))
      .filter(({ freshness }) => freshness < STALE_FRESHNESS)
      .sort((left, right) => left.freshness - right.freshness);
    if (stale.length) {
      sections.push({
        id: 'review',
        title: '该复习',
        count: stale.length,
        rows: stale.slice(0, 2).map(({ memory }) => ({
          id: memory.id,
          tool: 'memory',
          icon: Brain,
          label: memory.title,
          open: () => openMemoryDialog(memory.id),
        })),
      });
    }
    return sections;
  }, [
    messages,
    miniLectureDecksByMessageId,
    onOpenPractice,
    openCalendarDialog,
    openMemoryDialog,
    openMiniLecture,
    openNotebook,
    openProblem,
    phoneLayout,
    scheduleItems,
    selectedConversationId,
    workspace.memories,
    workspace.notebooks,
    workspace.problems,
  ]);

  /**
   * 资料页一次导入一个文件，失败时抛出原因，由资料页显示在队列里。
   * 账号课程先写进账号再同步回本机，网页和其他设备都能看到；本机课程只存本机。
   */
  const importMaterialFile = async (kind: CourseMaterialKind, file: File) => {
    if (!isSupportedTextFile(file)) throw new Error('暂不支持这种格式');
    if (file.size > MAX_CHAT_ATTACHMENT_BYTES)
      throw new Error(`超过 ${Math.round(MAX_CHAT_ATTACHMENT_BYTES / 1024)} KB`);
    const repository = await getLocalRepository();
    const input = { courseId: workspace.course.id, name: file.name, text: await file.text() };
    if (await isPlatformCourse(repository, input.courseId)) {
      await uploadNativeMaterial({ ...input, kind, clientId: crypto.randomUUID() });
      await syncCourseData(repository, input.courseId);
      return;
    }
    if (kind === 'notes') await repository.importTextMaterial({ ...input, source: 'notes' });
    else await repository.importTextProblem(input);
  };

  const renderPhoneDrawer = () => (
    <PhoneChatDrawer
      onOpenRecentChat={onOpenRecentChat}
      generalChatClient={generalChatClient}
      homeHref={homeHref}
      learningActions={[]}
      courses={courses}
      onCreateCourse={onCreateCourse}
      onNewChat={onNewChat ?? createConversation}
      selectedCourseId={workspace.course.id}
      selectedCourseAvatarUrl={courseAvatarUrl}
      conversations={workspace.conversations}
      paging={conversationPaging}
      onRemoteSearch={searchRemoteConversations}
      selectedConversationId={selectedConversationId}
      onDeleteConversation={setConversationToDelete}
      onCreateCourseChat={onCreateCourseChat}
      onOpenCourseTool={(id, page) => {
        if (id === workspace.course.id) openFromDrawer(() => setPhonePage(page));
        else onOpenCourseTool(id, page);
      }}
      newChatDisabled={busy}
      onSelectConversation={selectConversation}
    />
  );
  const phoneDrawer = renderPhoneDrawer();
  usePublishChatSidebar(phoneDrawer);

  return (
    <section
      ref={workspaceRef}
      onTouchStart={phoneLayout ? handleWorkspaceTouchStart : undefined}
      onTouchEnd={phoneLayout ? handleWorkspaceTouchEnd : undefined}
      className={`course-workspace${compactLayout ? ' is-compact' : ''}${chatShell ? ' has-persistent-sidebar' : ''}${learningPages.length ? ' has-learning-tabs' : ''}${!phoneLayout && hasMessages ? ' has-learning-rail' : ''}${phonePage && phonePage !== 'profile' && phonePage !== 'calendar' ? ' is-learning-active' : ''}${leftRailCollapsed ? ' workspace-left-collapsed' : ''}${
        rightRailCollapsed ? ' workspace-right-collapsed' : ''
      }${phoneLayout && mobilePanel === 'sessions' ? ' phone-drawer-open' : ''}${
        phoneLayout ? '' : ' is-split'
      }${!phoneLayout && splitSidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}
      aria-label={`${workspace.course.name} 课程工作台`}
    >
      {!chatShell ? (
        <aside
          className="workspace-sidebar workspace-sidebar-left"
          inert={!phoneLayout && splitSidebarCollapsed}
        >
          {phoneLayout ? (leftRailCollapsed ? compactSessionPanel : sessionPanel) : phoneDrawer}
        </aside>
      ) : null}

      <main ref={chatDropTargetRef} className="conversation-workspace">
        {updateNoteText ? (
          <CourseUpdateCard text={updateNoteText} onClose={() => setUpdateNote(null)} />
        ) : null}
        {chatFileDragging ? (
          <div className="chat-file-drop-overlay" role="status">
            <div>
              <CloudUpload size={36} strokeWidth={1.5} />
              <strong>松开以添加文件</strong>
              <span>图片加入聊天，文本资料保存到当前课程</span>
              <small>支持图片、TXT、Markdown、CSV、JSON 和代码文本</small>
            </div>
          </div>
        ) : null}
        {phoneLayout && mobilePanel === 'sessions' ? (
          <button
            type="button"
            className="phone-drawer-dismiss"
            onClick={() => setMobilePanel(null)}
            aria-label="关闭菜单"
          />
        ) : null}
        <header
          className="phone-chat-header"
          data-tauri-drag-region={
            document.documentElement.classList.contains('platform-macos') ? 'deep' : undefined
          }
        >
          {phoneLayout ? (
            <button
              type="button"
              className="phone-glass-button"
              onClick={() => setMobilePanel('sessions')}
              aria-label="打开菜单"
              data-onboarding="drawer"
            >
              <Menu size={20} strokeWidth={1.8} />
            </button>
          ) : (
            <button
              type="button"
              className="phone-glass-button"
              onClick={() =>
                chatShell
                  ? chatShell.toggleSidebar()
                  : setLocalSidebarCollapsed((collapsed) => !collapsed)
              }
              aria-label={splitSidebarCollapsed ? '显示侧边栏' : '隐藏侧边栏'}
              data-onboarding={splitSidebarCollapsed ? 'drawer' : undefined}
            >
              <PanelLeft size={20} strokeWidth={1.8} />
            </button>
          )}
          <div className="phone-chat-title">
            {compactLayout ? (
              <button
                type="button"
                className="phone-chat-title-button"
                aria-haspopup="menu"
                aria-expanded={Boolean(headerMenuAnchor)}
                data-onboarding="course-menu"
                onClick={(event) => {
                  const anchor = event.currentTarget;
                  setHeaderMenuAnchor((current) => (current ? null : anchor));
                }}
              >
                <span>
                  <strong>
                    {workspace.course.courseCode || workspace.course.name}
                    <ChevronDown size={14} strokeWidth={2} aria-hidden />
                  </strong>
                  <small>{currentConversationTitle}</small>
                </span>
              </button>
            ) : (
              <span>
                <strong>{workspace.course.courseCode || workspace.course.name}</strong>
                <small>{currentConversationTitle}</small>
              </span>
            )}
          </div>
          <button
            type="button"
            className="phone-chat-new"
            onClick={() => void createConversation()}
            disabled={busy}
            aria-label="新聊天"
          >
            <SquarePen size={18} strokeWidth={1.8} aria-hidden />
            <span>新聊天</span>
          </button>
        </header>

        <div
          ref={conversationContentRef}
          className="conversation-content"
          onScroll={handleConversationScroll}
          onTouchMove={phoneLayout ? dismissKeyboardOnDrag : undefined}
        >
          {messages.length === 0 ? (
            <div className="conversation-empty-state">
              <h2>今天想从哪里开始？</h2>
              <div className="suggestion-row">
                {(workspace.course.id === PLATFORM_TUTORIAL_COURSE_ID
                  ? [PLATFORM_TUTORIAL_QUESTION, '课程从哪里来？', '怎么删掉一门课？']
                  : [
                      '我现在学到哪里了？',
                      '帮我安排今天复习',
                      phoneLayout ? '拍一道题问 Haru' : '给我开一个小测',
                      '我最近哪里最薄弱？',
                    ]
                ).map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion}
                    data-onboarding={
                      suggestion === PLATFORM_TUTORIAL_QUESTION ? 'tutorial-ask' : undefined
                    }
                    onClick={() => {
                      if (suggestion === '拍一道题问 Haru') {
                        imageInputRef.current?.click();
                        return;
                      }
                      setDraft(suggestion);
                      // 教程里的默认问题点一下就直接问。
                      if (workspace.course.id === PLATFORM_TUTORIAL_COURSE_ID)
                        setAutoSendTick((tick) => tick + 1);
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-stream" aria-label={selectedConversation?.title || '当前会话'}>
              {messageWindowStart > 0 || olderMessageCursor ? (
                <GlassLoadMore
                  placement="start"
                  rootMargin="480px 0px 0px 0px"
                  state={messageWindowStart > 0 ? 'idle' : olderMessagesState}
                  onLoadMore={loadOlderMessages}
                  watchKey={`${messages.length}:${visibleMessageCount}`}
                />
              ) : null}
              {messages.slice(messageWindowStart).map((message, offset) => {
                const index = messageWindowStart + offset;
                const miniLecture =
                  message.role === 'assistant'
                    ? (miniLectureDecksByMessageId.get(message.id) ?? null)
                    : null;
                const miniLectureGeneration = miniLectureGenerationByMessageId.get(message.id) ?? {
                  status: 'idle' as const,
                };
                let askedBy = '';
                for (let back = index - 1; back >= 0 && message.role === 'assistant'; back -= 1) {
                  if (messages[back].role === 'user') {
                    askedBy = messages[back].text;
                    break;
                  }
                }
                // 已经点过生成（进行中或失败）的，卡片留着，好看进度或重试。
                const showLectureCard =
                  miniLectureGeneration.status !== 'idle' ||
                  isLectureEligibleMessage(message, askedBy);
                const nonLectureActions = (message.metadata?.learningActions ?? []).filter(
                  (action) =>
                    action.kind !== 'classroom.propose_temporary_explanation' &&
                    action.kind !== 'image.propose_generation' &&
                    !(phoneLayout && action.kind === 'practice.propose_generation'),
                );
                return (
                  <article
                    className={`chat-message chat-message-${message.role}`}
                    key={message.id}
                    data-message-id={message.id}
                  >
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
                      {message.id.startsWith('stream-') ? (
                        <RecallThinking
                          recall={thinkingRecall?.messageId === message.id ? thinkingRecall : null}
                          done={Boolean(message.text)}
                        />
                      ) : null}
                      {message.id.startsWith('stream-') && !message.text ? null : (
                        <ChatMessageContent
                          message={message}
                          onOpenNotebookId={openNotebookById}
                          onOpenMemoryId={openMemoryDialog}
                        />
                      )}
                      {message.metadata?.reviewPlan && !phoneLayout ? (
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
                          compact
                          onExecute={(action) => void executeLearningAction(message, action)}
                        />
                      ) : null}
                      {miniLecture ? (
                        <MiniLectureInviteCard
                          deck={miniLecture}
                          busy={miniLectureLoadingDeckId === miniLecture.id}
                          compact
                          onOpen={() => void openMiniLecture(miniLecture)}
                        />
                      ) : showLectureCard ? (
                        <MiniLectureGenerateCard
                          state={miniLectureGeneration}
                          disabled={!miniLectureAvailable}
                          unavailableReason={platformAiAccess.message}
                          compact
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
          {pendingImages.length || pendingFiles.length ? (
            <div className="composer-image-strip" aria-label="待发送的附件">
              {pendingImages.map((image) => (
                <span key={image.id} className="composer-image-thumb">
                  <img src={image.thumbnailDataUrl} alt={image.name} />
                  <button
                    type="button"
                    onClick={() =>
                      setPendingImages((current) => current.filter((item) => item.id !== image.id))
                    }
                    aria-label={`移除图片 ${image.name}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              {pendingFiles.map((file) => (
                <ChatFilePill
                  key={file.id}
                  name={file.name}
                  kind={file.kind}
                  size={file.size}
                  onRemove={() =>
                    setPendingFiles((current) => current.filter((item) => item.id !== file.id))
                  }
                />
              ))}
            </div>
          ) : null}
          <form
            className="conversation-composer"
            ref={composerFormRef}
            data-onboarding="composer"
            data-onboarding-course={workspace.course.id}
            data-onboarding-busy={busy ? '' : undefined}
            onSubmit={(event) => void send(event)}
          >
            <button
              type="button"
              className="composer-icon-button"
              onClick={() => attachmentInputRef.current?.click()}
              aria-label="添加照片或文件"
              title="照片、PDF、Word、PPT、文本"
            >
              <Plus size={18} />
            </button>
            <ChatScopePicker
              courses={courses}
              courseId={workspace.course.id}
              courseAvatarUrl={courseAvatarUrl}
              allowGeneralChat={browserApp}
              locked={!scopeReady || busy || messages.length > 0}
              onChange={onChangeChatScope ? (id) => onChangeChatScope(id, draft) : undefined}
            />
            <textarea
              ref={composerTextareaRef}
              rows={1}
              maxLength={4000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                chatAvailable
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
                {chatAvailable
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
            <VoiceInputButton
              disabled={!chatAvailable}
              onText={(text) => {
                setDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
                composerTextareaRef.current?.focus();
              }}
            />
            <button
              ref={sendButtonRef}
              type="submit"
              className="composer-send-button"
              disabled={
                (!draft.trim() && !pendingImages.length && !pendingFiles.length) ||
                busy ||
                !chatAvailable
              }
              aria-label={chatAvailable ? '发送' : platformAiAccess.message}
              title={chatAvailable ? undefined : platformAiAccess.message}
            >
              <SendHorizontal size={17} />
            </button>
          </form>
          {notice ? <p className="composer-notice">{notice}</p> : null}
          {error ? <p className="composer-error">{error}</p> : null}
        </footer>
      </main>

      {!phoneLayout && hasMessages ? (
        <LearningFloatCard actions={courseToolActions} sections={floatSections} />
      ) : null}

      {headerMenuAnchor ? (
        <CourseToolsMenu
          anchor={headerMenuAnchor}
          align="center"
          courseName={workspace.course.courseCode || workspace.course.name}
          onClose={() => setHeaderMenuAnchor(null)}
          onSelect={(page) => {
            setHeaderMenuAnchor(null);
            courseToolActions.find((action) => action.id === page)?.open();
          }}
        />
      ) : null}

      {learningPages.length ? (
        <LearningWorkspaceTabs
          compact={compactLayout}
          onBack={closePhonePage}
          onOpenMenu={setHeaderMenuAnchor}
          pages={learningPages}
          activePage={
            phonePage && phonePage !== 'profile' && phonePage !== 'calendar' ? phonePage : null
          }
          onSelect={setPhonePage}
          onClose={closeLearningPage}
          onChat={() => setPhonePage(null)}
          renderPage={(page) => (
            <>
              {page === 'materials' ? (
                <CourseMaterialsPage
                  notebooks={workspace.notebooks}
                  problems={workspace.problems}
                  onImport={importMaterialFile}
                  onImported={onWorkspaceChanged}
                  onOpenNotes={() => setPhonePage('notes')}
                  onOpenProblems={() => setPhonePage('problems')}
                  kinds={materialKinds}
                  initialUpload={pendingMaterialUpload}
                  onInitialUploadTaken={() => setPendingMaterialUpload(null)}
                />
              ) : null}
              {page === 'notes' ? (
                <PhoneNotesPage
                  workspace={workspace}
                  onBack={() => closeLearningPage(page)}
                  onUpload={() => setPhonePage('materials')}
                  onUploadFiles={(files) => uploadFromPage('notes', files)}
                  layered={enrolledCourse}
                  onContentChanged={resyncCourseContent}
                />
              ) : null}
              {page === 'progress' ? (
                <PhoneProgressPage
                  learningState={courseLearningState}
                  notebooks={workspace.notebooks}
                  onProgressChange={saveCourseProgress}
                  onOpenNotebook={(notebook) => void openNotebook(notebook)}
                  onBack={() => closeLearningPage(page)}
                  onUpload={() => setPhonePage('materials')}
                />
              ) : null}
              {page === 'classroom' ? (
                <PhoneClassroomPage
                  courseId={workspace.course.id}
                  conversations={workspace.conversations}
                  revision={courseDataRevision}
                  loadingDeckId={miniLectureLoadingDeckId}
                  onOpenDeck={(deck) => void openMiniLecture(deck)}
                  onOpenRemoteDeck={openRemoteMiniLecture}
                  onBack={() => closeLearningPage(page)}
                  onChat={backToChat}
                />
              ) : null}
              {page === 'problems' ? (
                <div className="phone-page phone-page-overlay split-problem-bank">
                  <ProblemBankPage
                    workspace={workspace}
                    onBack={() => closeLearningPage(page)}
                    onPractice={openPracticeFromBank}
                    onUpload={
                      materialKinds.includes('problems')
                        ? () => setPhonePage('materials')
                        : undefined
                    }
                    onUploadFiles={
                      materialKinds.includes('problems')
                        ? (files) => uploadFromPage('problems', files)
                        : undefined
                    }
                    canRelease={
                      courseMeta[workspace.course.id]?.accessRole === 'owner' &&
                      Boolean(courseMeta[workspace.course.id]?.organizationName)
                    }
                    layered={enrolledCourse}
                    onContentChanged={resyncCourseContent}
                  />
                </div>
              ) : null}
              {page === 'memory' ? (
                <PhoneMemoryPage
                  courseId={workspace.course.id}
                  courseLabel={workspace.course.courseCode || workspace.course.name}
                  backgroundUrl={profileThemeForAvatar(courseAvatarUrl)?.galaxyUrl}
                  notebooks={workspace.notebooks}
                  memories={workspace.memories}
                  focusedMemoryId={focusedMemoryId}
                  onBack={() => {
                    closeLearningPage(page);
                    setFocusedMemoryId(null);
                  }}
                  onChat={backToChat}
                />
              ) : null}
            </>
          )}
        />
      ) : null}

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
            className={`mobile-slide-panel mobile-slide-panel-${mobilePanel}${
              mobilePanel === 'sessions' && phoneLayout ? ' mobile-slide-panel-drawer' : ''
            }`}
            aria-label={
              mobilePanel === 'sessions'
                ? '会话历史'
                : mobilePanel === 'progress'
                  ? '学习进度'
                  : '课程工具'
            }
          >
            {mobilePanel === 'sessions' && phoneLayout ? (
              renderPhoneDrawer()
            ) : mobilePanel === 'sessions' ? (
              <SessionsPanel
                conversations={workspace.conversations}
                paging={conversationPaging}
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
                progressOnly={mobilePanel === 'progress'}
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
                filteredConversations.slice(0, allConversationsWindow.count).map((conversation) => (
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
                <LearningEmptyState title="没有找到匹配的会话" compact />
              )}
              {filteredConversations.length ? (
                <ConversationListEnd
                  listWindow={allConversationsWindow}
                  paging={conversationSearchQuery.trim() ? undefined : conversationPaging}
                  length={filteredConversations.length}
                />
              ) : null}
            </nav>
            <footer>
              <span>
                共 {Math.max(conversationPage.totalCount, workspace.conversations.length)} 个会话
              </span>
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
                  <LearningEmptyState
                    title="当前课程还没有学习记忆"
                    hint="完成对话、做题或确认学习进度后会逐步积累。"
                    compact
                  />
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
        <PhoneConfirm
          title="删除这个对话？"
          message={`“${conversationToDelete.title}”删除后无法恢复。`}
          confirmLabel="删除"
          destructive
          busy={busy}
          onConfirm={() => void deleteConversation()}
          onCancel={() => setConversationToDelete(null)}
        />
      ) : null}

      {scheduleDialogOpen ? (
        <div
          className={`native-dialog-layer${phonePage === 'calendar' ? ' is-calendar-editor' : ''}`}
        >
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
                {scheduleBusy ? <GlassSpinner size={15} /> : <CalendarDays size={15} />}
                {scheduleBusy ? '正在保存…' : editingScheduleId ? '保存修改' : '保存到本机日历'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      <input
        ref={imageInputRef}
        type="file"
        hidden
        accept="image/*"
        multiple
        onChange={handleImageSelection}
        tabIndex={-1}
      />
      <input
        ref={attachmentInputRef}
        type="file"
        hidden
        accept={CHAT_ATTACH_ACCEPT}
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
          <GlassSpinner size={20} />
          正在从本机打开…
        </div>
      ) : null}
      {phonePage === 'profile' ? (
        <PhoneProfilePage
          courses={courses}
          currentCourseId={workspace.course.id}
          currentCourseAvatarUrl={courseAvatarUrl}
          conversationCount={courses.reduce((sum, course) => sum + course.conversationCount, 0)}
          responseStrength={phoneResponseStrength}
          onResponseStrengthChange={changePhoneResponseStrength}
          onOpenCourseJar={openCourseJar}
          onBack={closePhonePage}
        />
      ) : null}
      {phonePage === 'calendar' ? (
        <PhoneCalendarPage
          initialDate={calendarDate}
          events={scheduleItems}
          isResearchCourse={isResearchCourse}
          onAddEvent={(date) => {
            openNewSchedule();
            setScheduleDate(date);
          }}
          onEditEvent={openScheduleEditor}
          onBack={closePhonePage}
        />
      ) : null}
      {resource ? (
        <LocalResourceViewer
          resource={resource}
          accent={
            resource.kind === 'notebook'
              ? notebookAccentFor(workspace.notebooks, resource.document.notebook.id)
              : undefined
          }
          onClose={() => setResource(null)}
        />
      ) : null}
      {marbleCatch ? (
        <MarbleCatcher
          key={marbleCatch.key}
          request={marbleCatch}
          backgroundUrl={profileThemeForAvatar(courseAvatarUrl)?.galaxyUrl}
          onDone={() => setMarbleCatch(null)}
        />
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
                      dotClassName: 'bg-[var(--marble-blue-mid)]',
                    },
                    {
                      label: isResearchCourse ? '会议' : '考试',
                      count: scheduleItems.filter((item) => item.kind === 'exam').length,
                      dotClassName: 'bg-[var(--marble-pink-mid)]',
                    },
                    {
                      label: isResearchCourse ? '进展' : '进度',
                      count: scheduleItems.filter((item) => item.kind === 'progress').length,
                      dotClassName: 'bg-[var(--marble-amber-mid)]',
                    },
                    {
                      label: isResearchCourse ? '论文阅读' : 'Tutorial',
                      count: scheduleItems.filter((item) => item.kind === 'tutorial').length,
                      dotClassName: 'bg-[var(--marble-purple-mid)]',
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
