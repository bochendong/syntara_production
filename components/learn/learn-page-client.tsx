'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type SetStateAction,
} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  BookOpen,
  BookOpenCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CheckCircle2,
  Copy,
  Cpu,
  Eraser,
  FileText,
  LibraryBig,
  Loader2,
  Maximize2,
  MessageCircle,
  MessageSquarePlus,
  Minimize2,
  MoreHorizontal,
  Pause,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  SendHorizontal,
  ShoppingBag,
  Sparkles,
  Square,
  Target,
  Trash2,
  UploadCloud,
  Volume2,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { UIMessage } from 'ai';
import { MessageResponse } from '@/components/ai-elements/message';
import {
  LEARN_HOME_PREVIEW_COURSES,
  LearnHomeDashboard,
} from '@/components/learn/learn-home-dashboard';
import { LearnCourseSidebar } from '@/components/learn/learn-course-sidebar';
import { ChatContextCompressionNotice } from '@/components/learn/chat-context-compression-notice';
import { LearnPageShellSkeleton } from '@/components/learn/learn-page-shell-skeleton';
import {
  readLearnCourseListCache,
  removeLearnCourseFromListCache,
  upsertLearnCourseListCache,
  writeLearnCourseListCache,
} from '@/components/learn/learn-course-list-cache';
import {
  buildLearningCalendarDays,
  buildSyllabusEventsByDay,
  LearningCalendarGrid,
} from '@/components/learn/learning-calendar-grid';
import { LearnWorkspaceDialog } from '@/components/learn/learn-workspace-dialog';
import type { CourseProblemPracticeHeaderState } from '@/components/problem-bank/course-problem-bank-view';
import type { CourseProblemPracticeAttemptResolvedEvent } from '@/components/problem-bank/use-course-problem-bank-controller';
import { Button } from '@/components/ui/button';
import { composerInputShellClassName } from '@/components/ui/composer-input-shell';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  SYNTARA_ACTION_DIALOG_CONTENT_CLASS,
  SYNTARA_DIALOG_HEADER_CLASS,
  SYNTARA_WORKSPACE_DIALOG_CONTENT_CLASS,
  SYNTARA_WORKSPACE_DIALOG_OVERLAY_CLASS,
} from '@/components/ui/syntara-dialog-style';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePersistHydrated } from '@/lib/hooks/use-persist-hydrated';
import { normalizeLooseMathDelimiters } from '@/lib/math-engine';
import { useAuthStore } from '@/lib/store/auth';
import { useCurrentCourseStore } from '@/lib/store/current-course';
import { useSettingsStore } from '@/lib/store/settings';
import {
  addMemoryActivity,
  dismissMemoryActivity,
  isActiveMemoryActivityStatus,
  updateMemoryActivity,
  useMemoryActivityStore,
  type MemoryActivityRecord,
} from '@/lib/store/memory-activity';
import { useTaskHistoryStore, type TaskHistoryRecord } from '@/lib/store/task-history';
import {
  askCourseOrchestrator,
  type CourseChatImageAttachment,
} from '@/lib/chat/ask-course-orchestrator';
import {
  cleanupCourseChatAttachments,
  prepareCourseChatAttachmentsForModel,
} from '@/lib/chat/ephemeral-course-chat-attachments';
import { buildProblemExplainPrompt } from '@/lib/chat/problem-explain-prompt';
import {
  answererHandoffFromLearnTurn,
  planningDecisionFromLearnTurn,
  type LearnTurnClientResponse,
} from '@/features/learn-core/client-adapters';
import { explicitPracticeTarget } from '@/features/learn-core/domain/practice-target';
import {
  createLearnActionExecutionResult,
  filterLearningActionsForQuestion,
  latestLearningActionsForTurn,
  learnActionRequiresConfirmation,
  learnActionToClientAction,
  neutralizeUnconfirmedMemoryWriteClaim,
} from '@/features/learn-core/client-actions';
import {
  applyLearningCalendarDelete,
  applyLearningCalendarUpdate,
  learningActionCalendarEvents,
  type SyllabusCalendarEvent,
  type SyllabusEventKind,
} from '@/features/learn-core/client-calendar-actions';
import {
  makeLearningCalendarIdempotencyKey,
  searchLearningCalendarEvents,
  type LearningCalendarEventPatch,
  type RemoteLearningCalendarEvent,
} from '@/features/learning-calendar/client/calendar-api';
import { useLearningCalendarRange } from '@/features/learning-calendar/client/use-learning-calendar-range';
import {
  buildMiniLecturePrompt,
  generatedManifestToMiniLectureDeck,
  MINI_LECTURE_CANVAS_HEIGHT,
  MINI_LECTURE_CANVAS_WIDTH,
  type GeneratedMiniLectureManifest,
  type MiniLectureDeck,
  type MiniLecturePrompt,
  type MiniLectureRegion,
} from '@/features/learn-core/client-mini-lecture';
import {
  compactMiniLectureDeckForPersistence,
  readMiniLectureDeckLocally,
  saveMiniLectureDeckLocally,
} from '@/lib/utils/mini-lecture-storage';
import {
  createCalendarAddActionFromArtifacts,
  latestLearnArtifactsForTurn,
  matchingCalendarAddActionForArtifact,
  visibleLearningActionsForArtifacts,
} from '@/features/learn-core/client-artifacts';
import {
  createLearnProgressRequest,
  type LearnPendingCourseAction as PendingCourseAction,
  type LearnProgressProposal as ProgressProposal,
} from '@/features/learn-core/client-progress';
import type {
  LearnProblemBankMatch,
  LearnProblemBankSearchResult,
  LearnTurnMessage,
} from '@/features/learn-core/domain/types';
import {
  buildCourseReplyProgress,
  dispatchCourseReplyProgress,
} from '@/lib/chat/course-reply-progress';
import type {
  ChatContextCompression,
  ChatMessageMetadata,
  CourseChatContext,
  CourseChatEvidenceSummary,
  LearnActivityPlanTask,
  LearnAnswerEvidenceSource,
  LearnArtifact,
  LearnCalendarDraftItem,
  LearningAction,
} from '@/lib/types/chat';
import type { ParsedPdfContent } from '@/lib/types/pdf';
import {
  deletePracticePlan,
  listPracticePlans,
  loadLearnerCourseState,
  loadPracticePlan,
  previewLearnerProgressCheckpoint,
  recordPracticeAttemptResult,
  recordLearnerQuestion,
  saveLearnerCourseState,
  savePracticePlan,
  seedLearnerCourseStateFromCourse,
  setLearnerPlanningScope,
  setLearnerProgressCheckpoint,
  summarizeLearnerCourseState,
  type LearnerCourseSnapshot,
  type LearnerCourseState,
  type LearnerProgressCheckpointKind,
  type PracticeAttemptStatus,
  type PracticePlan,
  type PracticePlanMode,
} from '@/lib/learning/course-learner-state';
import { orderCourseNotebooks } from '@/lib/learning/course-notebook-order';
import {
  applyConfirmedMemoryToLearnerCourseState,
  type ConfirmedLearnerMemoryType,
  type LearnerMemoryCorrectionMode,
} from '@/lib/learning/confirmed-memory-shadow-state';
import {
  normalizePracticeSelectionText,
  practicePlanTopicFocusLine,
  practiceProblemMatchScore,
  practiceProblemReason,
  practiceSelectionTerms,
  selectedProblemPracticeRationale,
} from '@/lib/learning/practice-problem-selection';
import {
  deletePracticeSession,
  ensurePracticeSession,
  listPracticeSessions,
  loadPracticeSession,
  pausePracticeSession,
  practiceSessionAnswers,
  practiceSessionSummary,
  recordPracticeSessionProblemAiHelp,
  recordPracticeSessionAttempt,
  updatePracticeSessionAnswerDraft,
  updatePracticeSessionCurrentProblem,
  type PracticeSession,
  type PracticeSessionSummary,
} from '@/lib/learning/practice-session';
import type { NotebookProblemAttemptAnswer } from '@/lib/problem-bank';
import type { ProviderId } from '@/lib/ai/providers';
import { resolveCourseAvatarDisplayUrl } from '@/lib/constants/course-avatars';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/notifications/client-toast';
import type { CourseRecord } from '@/lib/utils/database';
import { BackendApiError, backendJson } from '@/lib/utils/backend-api';
import { getCourseOrThrow, listCoursesOrThrow, updateCourse } from '@/lib/utils/course-storage';
import { getCoursePublishBlockReason } from '@/lib/utils/course-publish';
import { clearCourseWorkspaceCache } from '@/lib/utils/course-workspace-cache';
import {
  listCourseProblemSummaries,
  type CourseProblemClientSummary,
} from '@/lib/utils/notebook-problem-api';
import {
  deleteCourseSourceUpload,
  getCourseSourceUploadText,
  listCourseSourceUploads,
  retryCourseSourceIndex,
  type CourseSourceUploadRecord,
} from '@/lib/utils/course-source-upload-api';
import {
  loadCourseContentState,
  type CourseContentState,
  type CourseContentSourceState,
} from '@/lib/utils/course-content-state-api';
import { listStudyMemoryRecords } from '@/lib/utils/study-memory-api';
import {
  listRemotePracticePlans,
  loadRemoteLearnerCourseState,
  saveRemoteLearnerCourseState,
  saveRemotePracticePlan,
} from '@/lib/utils/learner-course-api';
import {
  deleteRemoteLearnConversation,
  getRemoteLearnConversationBaseSnapshot,
  getRemoteLearnConversationSyncError,
  LEARN_CONVERSATION_CHANGED_STORAGE_KEY,
  LEARN_CONVERSATION_RECONCILED_EVENT,
  listRemoteLearnSessionsPage,
  loadRemoteLearnConversationOrThrow,
  mergeRemoteLearnConversationMessages,
  syncRemoteLearnConversation,
  type RemoteLearnConversationSummary,
  type RemoteLearnChatSession,
  type RemoteLearnMessage,
  type RemoteLearnMessagePage,
  type RemoteLearnMessagePayload,
} from '@/features/learn-conversations/client/remote-conversation-api';
import {
  deleteLearnSessionMessageStorage,
  deleteLearnSessionRemoteBase,
  deletedLearnMessageIdsKey,
  learnSessionIndexKey,
  makeLearnSessionId,
  mergeLearnSessions,
  readDeletedLearnMessageIds,
  readDeletedLearnSessionIds,
  readLearnSessionComposerDraft,
  readLearnSessionDirtyMessages,
  readLearnSessionMessagesJson,
  readLearnSessionRemoteBase,
  readLearnSessions,
  rememberDeletedLearnMessageId,
  rememberDeletedLearnSessionId,
  sortLearnSessionsForList,
  writeDeletedLearnMessageIds,
  writeLearnSessionComposerDraft,
  writeLearnSessionDirtyMessages,
  writeLearnSessionMessagesJson,
  writeLearnSessionRemoteBase,
  writeLearnSessions,
  type LearnChatSession,
} from '@/features/learn-conversations/client/local-session-cache';
import {
  clearLearnChatMessageAttachments,
  clearLearnChatSessionAttachments,
  learnChatAttachmentBlobToDataUrl,
  readLearnChatAttachment,
  revokeLearnChatAttachmentUrls,
  saveLearnChatAttachmentDataUrl,
} from '@/lib/utils/learn-chat-attachment-storage';
import {
  writeMemoryWithActivity,
  type MemoryWriteCandidate,
  type MemoryWriteContentType,
} from '@/lib/utils/memory-write-api';
import {
  getFirstSlideByStages,
  listStagesByCourseOrThrow,
  type StageListItem,
} from '@/lib/utils/stage-storage';

function LearnDeferredPanelLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid h-full min-h-40 place-items-center text-sm text-muted-foreground"
    >
      <span className="inline-flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}

function LearnDeferredDialogLoading({ label }: { label: string }) {
  return (
    <Dialog open>
      <DialogContent
        className={cn(SYNTARA_ACTION_DIALOG_CONTENT_CLASS, 'max-w-sm gap-0 p-0')}
        showCloseButton={false}
      >
        <LearnDeferredPanelLoading label={label} />
      </DialogContent>
    </Dialog>
  );
}

const CourseProblemBankView = dynamic(
  () =>
    import('@/components/problem-bank/course-problem-bank-view').then(
      (module) => module.CourseProblemBankView,
    ),
  {
    loading: () => <LearnDeferredPanelLoading label="正在打开题库…" />,
  },
);

const CourseMaterialsPanel = dynamic(
  () =>
    import('@/components/courses/course-materials-panel').then(
      (module) => module.CourseMaterialsPanel,
    ),
  {
    loading: () => <LearnDeferredPanelLoading label="正在打开课程文件…" />,
  },
);

const CourseLearningProgressPanel = dynamic(
  () =>
    import('@/components/learn/course-learning-progress-panel').then(
      (module) => module.CourseLearningProgressPanel,
    ),
  {
    loading: () => <LearnDeferredPanelLoading label="正在加载学习进度…" />,
  },
);

const DeferredCreateCourseDialog = dynamic(
  () =>
    import('@/components/courses/create-course-dialog').then((module) => module.CreateCourseDialog),
  {
    loading: () => <LearnDeferredDialogLoading label="正在打开新建课程…" />,
  },
);

function CreateCourseDialog(props: ComponentProps<typeof DeferredCreateCourseDialog>) {
  if (!props.open) return null;
  return <DeferredCreateCourseDialog {...props} />;
}

const DeferredCourseSettingsDialog = dynamic(
  () =>
    import('@/components/courses/course-settings-dialog').then(
      (module) => module.CourseSettingsDialog,
    ),
  {
    loading: () => <LearnDeferredDialogLoading label="正在打开课程设置…" />,
  },
);

function CourseSettingsDialog(props: ComponentProps<typeof DeferredCourseSettingsDialog>) {
  if (!props.open) return null;
  return <DeferredCourseSettingsDialog {...props} />;
}

const DeferredLearnAllSessionsDialog = dynamic(
  () =>
    import('@/components/learn/learn-all-sessions-dialog').then(
      (module) => module.LearnAllSessionsDialog,
    ),
  {
    loading: () => <LearnDeferredDialogLoading label="正在打开全部对话…" />,
  },
);

function LearnAllSessionsDialog(props: ComponentProps<typeof DeferredLearnAllSessionsDialog>) {
  if (!props.open) return null;
  return <DeferredLearnAllSessionsDialog {...props} />;
}

type LearnMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  attachments?: LearnImageAttachment[];
  plan?: PracticePlan;
  progressProposal?: ProgressProposal;
  pendingAction?: PendingCourseAction;
  lecturePrompt?: MiniLecturePrompt;
  lectureDeck?: MiniLectureDeck;
  learningActions?: LearningAction[];
  artifacts?: LearnArtifact[];
  publicTrace?: LearnPublicTraceStep[];
  contextCompression?: ChatContextCompression;
  transient?: boolean;
};

type LearnPublicTraceStep = {
  id: string;
  title: string;
  detail: string;
  status: 'done' | 'waiting' | 'blocked';
  evidence?: string[];
};

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

type ResourceLoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

type ResourceLoadState = {
  courseId: string | null;
  status: ResourceLoadStatus;
  error: string | null;
  usingCachedData: boolean;
};

type CourseResourceKind = 'notebooks' | 'problems' | 'sources';

type LearnSurfaceStatus = 'deferred' | 'loading' | 'ready' | 'empty' | 'local' | 'error';

type LearnSurfaceStatusItem = {
  key: 'course' | 'conversation' | 'teacher-agent' | 'student-agent' | CourseResourceKind;
  label: string;
  status: LearnSurfaceStatus;
  statusLabel: string;
  detail?: string | null;
};

type CourseAssetCacheEntry = {
  notebooks?: StageListItem[];
  problems?: CourseProblemClientSummary[];
  sourceUploads?: CourseSourceUploadRecord[];
};

type CourseContentRepairRetry = {
  signature: string;
  failures: number;
  timerId: number | null;
};

const COURSE_RESOURCE_TIMEOUT_MS = 35_000;
const COURSE_SOURCE_TIMEOUT_MS = 35_000;
const COURSE_RESOURCE_QUEUE_ABORT_COOLDOWN_MS = 12_000;
const COURSE_SOURCE_PROCESSING_SLOW_MS = 3 * 60_000;
const COURSE_SOURCE_PROCESSING_HARD_TIMEOUT_MS = 15 * 60_000;
const COURSE_SOURCE_STATUS_POLL_MS = 3_000;
const COURSE_SOURCE_STALLED_POLL_MS = 15_000;
const COURSE_SOURCE_UPLOAD_TIMEOUT_MS = 12 * 60_000;
const COURSE_CONTENT_STATE_INITIAL_DELAY_MS = 250;
const COURSE_CONTENT_STATE_POLL_MS = 30_000;
const COURSE_CONTENT_STATE_HOT_POLL_MS = 5_000;
const COURSE_CONTENT_STATE_HOT_WINDOW_MS = 60_000;
const COURSE_CONTENT_STATE_TIMEOUT_MS = 20_000;
const COURSE_CONTENT_STATE_FAILURE_BACKOFF_MS = 60_000;
const COURSE_CONTENT_STATE_MAX_BACKOFF_MS = 5 * 60_000;
const COURSE_CONTENT_STATE_LOCK_PREFIX = 'syntara:learn:course-content-state:';
const COURSE_CONTENT_STATE_CHANNEL_PREFIX = 'syntara:learn:course-content-state-events:';
const COURSE_CONTENT_STATE_STORAGE_PREFIX = 'syntara:learn:course-content-state-snapshot:';
const COURSE_CONTENT_REPAIR_RETRY_BASE_MS = 2_000;
const COURSE_CONTENT_REPAIR_RETRY_MAX_MS = 30_000;
const COURSE_CONTENT_REPAIR_RETRY_MAX_FAILURES = 5;
const LEARN_TURN_TIMEOUT_MS = 90_000;

function isUsefulCourseShellName(value: string | null | undefined): value is string {
  const name = value?.trim() || '';
  return Boolean(name && name !== '正在打开课程…' && name !== '课程学习空间');
}

function courseShellFromUrl(
  courseId: string,
  hint?: {
    id: string | null;
    name: string | null | undefined;
    avatarUrl: string | null | undefined;
  },
): CourseRecord {
  const matchingName =
    hint?.id === courseId && isUsefulCourseShellName(hint.name) ? hint.name.trim() : null;
  return {
    id: courseId,
    name: matchingName || '课程学习空间',
    language: 'zh-CN',
    tags: [],
    purpose: 'university',
    accessRole: 'enrolled',
    avatarUrl: matchingName ? hint?.avatarUrl?.trim() || undefined : undefined,
    createdAt: 0,
    updatedAt: 0,
  };
}

function isProvisionalCourseShell(course: CourseRecord | null | undefined): boolean {
  return Boolean(course && Number(course.createdAt) === 0 && Number(course.updatedAt) === 0);
}

function emptyResourceLoadState(): ResourceLoadState {
  return {
    courseId: null,
    status: 'idle',
    error: null,
    usingCachedData: false,
  };
}

function loadingResourceLoadState(args: {
  courseId: string;
  usingCachedData: boolean;
}): ResourceLoadState {
  return {
    courseId: args.courseId,
    status: 'loading',
    error: null,
    usingCachedData: args.usingCachedData,
  };
}

function settledResourceLoadState(args: {
  courseId: string;
  itemCount: number;
}): ResourceLoadState {
  return {
    courseId: args.courseId,
    status: args.itemCount > 0 ? 'ready' : 'empty',
    error: null,
    usingCachedData: false,
  };
}

function failedResourceLoadState(args: {
  courseId: string;
  error: unknown;
  usingCachedData: boolean;
}): ResourceLoadState {
  return {
    courseId: args.courseId,
    status: 'error',
    error: args.error instanceof Error ? args.error.message : String(args.error || '加载失败'),
    usingCachedData: args.usingCachedData,
  };
}

function resourceSurfaceStatus(
  state: ResourceLoadState,
  activeCourseId: string | null,
): Pick<LearnSurfaceStatusItem, 'status' | 'statusLabel' | 'detail'> {
  if (!activeCourseId || state.courseId !== activeCourseId) {
    return { status: 'loading', statusLabel: '等待中' };
  }
  if (state.status === 'ready') return { status: 'ready', statusLabel: '已就绪' };
  if (state.status === 'empty') return { status: 'empty', statusLabel: '暂无' };
  if (state.status === 'error') {
    return {
      status: state.usingCachedData ? 'local' : 'error',
      statusLabel: state.usingCachedData ? '缓存可用' : '加载失败',
      detail: state.error,
    };
  }
  return {
    status: 'loading',
    statusLabel: state.usingCachedData ? '刷新中' : '加载中',
  };
}

function resourceSurfaceStatusFromContentOrList(args: {
  activeCourseId: string | null;
  listState: ResourceLoadState;
  content: { count: number } | null | undefined;
  contentReady: boolean;
  listHydrationWanted: boolean;
  deferredWhenListIdle?: boolean;
}): Pick<LearnSurfaceStatusItem, 'status' | 'statusLabel' | 'detail'> {
  const listMatchesCourse =
    Boolean(args.activeCourseId) && args.listState.courseId === args.activeCourseId;
  if (args.listHydrationWanted && listMatchesCourse && args.listState.status !== 'idle') {
    return resourceSurfaceStatus(args.listState, args.activeCourseId);
  }
  if (
    listMatchesCourse &&
    (args.listState.status === 'ready' || args.listState.status === 'empty')
  ) {
    return resourceSurfaceStatus(args.listState, args.activeCourseId);
  }
  if (listMatchesCourse && args.listState.status === 'error' && args.listState.usingCachedData) {
    return resourceSurfaceStatus(args.listState, args.activeCourseId);
  }
  if (!args.contentReady || !args.content) {
    if (args.deferredWhenListIdle) {
      return { status: 'deferred', statusLabel: '按需加载' };
    }
    return { status: 'loading', statusLabel: '加载中' };
  }
  if (args.content.count > 0) return { status: 'ready', statusLabel: '已就绪' };
  return { status: 'empty', statusLabel: '暂无' };
}

/** Prefer full-list status once hydrated; otherwise derive ready/empty from content-state. */
function planningResourceStatusFromContentOrList(args: {
  listState: ResourceLoadState;
  contentCount: number | null;
}): ResourceLoadStatus {
  if (args.listState.status !== 'idle') return args.listState.status;
  if (args.contentCount === null) return 'idle';
  return args.contentCount > 0 ? 'ready' : 'empty';
}

function courseResourceQueueErrorNeedsCooldown(error: unknown): boolean {
  if (error instanceof BackendApiError) {
    if (error.kind === 'aborted') return false;
    if (error.kind === 'timeout') return true;
  }
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error || '');
  return /timeout|timed out|connection pool/i.test(`${name} ${message}`);
}

type CourseContentStatePollResult = {
  source: 'network' | 'shared';
  value: CourseContentState;
};

async function runCourseContentStatePollWithLock(args: {
  courseId: string;
  ownerScope: string;
  signal: AbortSignal;
  request: () => Promise<CourseContentState>;
}): Promise<CourseContentStatePollResult> {
  if (args.signal.aborted) {
    throw args.signal.reason instanceof Error
      ? args.signal.reason
      : new DOMException('课程同步检查已取消', 'AbortError');
  }

  const readFreshSharedState = () => {
    const shared = readSharedCourseContentState(args.ownerScope, args.courseId);
    return shared && Date.now() - shared.storedAt < COURSE_CONTENT_STATE_POLL_MS
      ? shared.state
      : null;
  };
  const requestAndShare = async (): Promise<CourseContentStatePollResult> => {
    const value = await args.request();
    writeSharedCourseContentState(args.ownerScope, value);
    return { source: 'network', value };
  };

  if (typeof navigator === 'undefined' || !navigator.locks) {
    const shared = readFreshSharedState();
    return shared ? { source: 'shared', value: shared } : requestAndShare();
  }

  let requestStarted = false;
  try {
    const result = await navigator.locks.request(
      `${COURSE_CONTENT_STATE_LOCK_PREFIX}${encodeURIComponent(args.ownerScope)}:${args.courseId}`,
      {
        mode: 'exclusive',
        signal: args.signal,
      },
      async (lock) => {
        if (!lock) return null;
        const shared = readFreshSharedState();
        if (shared)
          return { source: 'shared', value: shared } satisfies CourseContentStatePollResult;
        requestStarted = true;
        return requestAndShare();
      },
    );
    if (result) return result;
  } catch (error) {
    if (requestStarted || args.signal.aborted) throw error;
    // Web Locks can be unavailable in a restricted browser context. A shared
    // snapshot still suppresses sequential duplicates, and server single-flight
    // protects the simultaneous first-read fallback.
  }
  const shared = readFreshSharedState();
  return shared ? { source: 'shared', value: shared } : requestAndShare();
}

function courseContentStateFromBroadcast(
  value: unknown,
  courseId: string,
): CourseContentState | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as { type?: unknown; state?: unknown };
  if (
    message.type !== 'course-content-state' ||
    !message.state ||
    typeof message.state !== 'object'
  ) {
    return null;
  }
  const state = message.state as Partial<CourseContentState>;
  if (
    state.storage !== 'database' ||
    state.courseId !== courseId ||
    typeof state.revision !== 'string' ||
    typeof state.checkedAt !== 'string' ||
    !state.notebooks ||
    !state.problems ||
    !state.sources
  ) {
    return null;
  }
  const resources = [state.notebooks, state.problems, state.sources];
  if (
    resources.some(
      (resource) =>
        typeof resource.count !== 'number' ||
        typeof resource.revision !== 'string' ||
        (resource.updatedAt !== null && typeof resource.updatedAt !== 'string'),
    )
  ) {
    return null;
  }
  const sourceHealthCounts = [
    state.sources.processingCount,
    state.sources.ingestErrorCount,
    state.sources.indexPendingCount,
    state.sources.indexErrorCount,
  ];
  if (
    sourceHealthCounts.some(
      (count) => typeof count !== 'number' || !Number.isInteger(count) || count < 0,
    ) ||
    (state.sources.oldestProcessingAt !== null &&
      typeof state.sources.oldestProcessingAt !== 'string')
  ) {
    return null;
  }
  return state as CourseContentState;
}

type CourseSourceHealthNotice = {
  tone: 'pending' | 'error';
  label: string;
  detail: string;
};

function courseSourceHealthNotice(
  source: CourseContentSourceState | null | undefined,
): CourseSourceHealthNotice | null {
  if (!source) return null;
  const failureCount = source.ingestErrorCount + source.indexErrorCount;
  const incompleteCount = source.processingCount + source.indexPendingCount;
  if (failureCount === 0 && incompleteCount === 0) return null;

  const details: string[] = [];
  if (source.processingCount > 0) {
    details.push(`${source.processingCount} 份正在入库`);
  }
  if (source.indexPendingCount > 0) {
    details.push(`${source.indexPendingCount} 份等待索引`);
  }
  if (source.ingestErrorCount > 0) {
    details.push(`${source.ingestErrorCount} 份入库失败`);
  }
  if (source.indexErrorCount > 0) {
    details.push(`${source.indexErrorCount} 份索引失败`);
  }
  if (source.oldestProcessingAt) {
    details.push(`最早处理任务：${source.oldestProcessingAt}`);
  }

  return {
    tone: failureCount > 0 ? 'error' : 'pending',
    label: failureCount > 0 ? '资料同步异常' : '资料同步未完成',
    detail: `${details.join('；')}。点击查看原始讲义库。`,
  };
}

type SharedCourseContentState = {
  storedAt: number;
  state: CourseContentState;
};

function courseContentStateStorageKey(ownerScope: string, courseId: string) {
  return `${COURSE_CONTENT_STATE_STORAGE_PREFIX}${encodeURIComponent(ownerScope)}:${courseId}`;
}

function readSharedCourseContentState(
  ownerScope: string,
  courseId: string,
): SharedCourseContentState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(courseContentStateStorageKey(ownerScope, courseId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SharedCourseContentState>;
    const state = courseContentStateFromBroadcast(
      { type: 'course-content-state', state: parsed.state },
      courseId,
    );
    if (!state || typeof parsed.storedAt !== 'number' || !Number.isFinite(parsed.storedAt)) {
      return null;
    }
    return { storedAt: parsed.storedAt, state };
  } catch {
    return null;
  }
}

function writeSharedCourseContentState(ownerScope: string, state: CourseContentState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      courseContentStateStorageKey(ownerScope, state.courseId),
      JSON.stringify({ storedAt: Date.now(), state } satisfies SharedCourseContentState),
    );
  } catch {
    // The successful state remains available in this tab even if storage is unavailable.
  }
}

function latestFiniteTimestamp(values: number[]): number {
  return values.reduce(
    (latest, value) => (Number.isFinite(value) ? Math.max(latest, value) : latest),
    0,
  );
}

function cachedCourseResourceRevision(
  kind: CourseResourceKind,
  assets: CourseAssetCacheEntry | undefined,
): string | null {
  if (kind === 'notebooks') {
    const notebooks = assets?.notebooks;
    if (!notebooks || notebooks.some((notebook) => !Number.isFinite(notebook.contentVersion))) {
      return null;
    }
    const updatedAt = latestFiniteTimestamp(notebooks.map((notebook) => notebook.updatedAt));
    const contentVersion = notebooks.reduce(
      (total, notebook) => total + (notebook.contentVersion ?? 0),
      0,
    );
    return `${notebooks.length}:${updatedAt}:${contentVersion}`;
  }
  if (kind === 'problems') {
    const problems = assets?.problems;
    if (!problems) return null;
    const updatedAt = latestFiniteTimestamp(problems.map((problem) => problem.updatedAt));
    return `${problems.length}:${updatedAt}:0`;
  }
  const sources = assets?.sourceUploads;
  if (!sources) return null;
  const updatedAt = latestFiniteTimestamp(sources.map((source) => Date.parse(source.updatedAt)));
  return `${sources.length}:${updatedAt}:0`;
}

type CourseRailTool = {
  label: string;
  description: string;
  Icon: LucideIcon;
  onSelect: () => void;
};

function resourceCountText(state: ResourceLoadState, count: number): number | string {
  return state.status === 'ready' || state.status === 'empty' ? count : '—';
}

type LearnImageAttachment = Omit<
  CourseChatImageAttachment,
  'dataUrl' | 'modelUrl' | 'textContent'
> & {
  dataUrl?: string;
  objectUrl?: string;
  width?: number;
  height?: number;
};

type LearnRetryTurn = {
  text: string;
  attachments: LearnImageAttachment[];
};

type PracticeProblemHelpState = {
  problemId: string;
  sessionId: string;
  title: string;
  answer: string;
  status: 'loading' | 'ready' | 'error';
  error?: string;
};

type LearnModelOption = {
  value: string;
  providerId: ProviderId;
  modelId: string;
  providerName: string;
  modelName: string;
  vision: boolean | null;
};

type CourseSourceUploadKind =
  | 'pdf'
  | 'markdown'
  | 'plain_text'
  | 'pptx'
  | 'docx'
  | 'problem_bank'
  | 'other';

type CourseSourceIngestResponse = {
  ingest: {
    source: {
      title: string;
      kind: CourseSourceUploadKind;
      hash: string;
      rawFileHash: string | null;
      openaiFileId: string | null;
      parser: string;
      textChars: number;
      processedChars: number;
      truncated: boolean;
      courseCode: string | null;
    };
    classification: {
      documentType: string;
      allQuestionUpload: boolean;
      topic: string;
      problemSignalCount: number;
      templateSignalCount: number;
      confidence: number;
      reasons: string[];
    };
    knowledgeGraph: {
      factId: string | null;
      nodeCount: number;
      edgeCount: number;
    };
    problems: {
      extractedCount: number;
      insertedCount: number;
      duplicateCount: number;
      importBatchId: string | null;
      usage: {
        inputTokens: number;
        outputTokens: number;
        cachedInputTokens: number;
        estimatedCostCredits: number | null;
      } | null;
    };
    memory: {
      writtenCount: number;
      templateCount: number;
      publicPlatformMemoryCount?: number;
      publicCourseMemoryCount?: number;
      publicNotebookMemoryCount: number;
      privateMemoryCount: number;
      skippedPublicNotebookMemory: boolean;
      layers?: Array<{
        layer: string;
        status: 'written' | 'skipped' | 'available';
        summary: string;
      }>;
    };
    notebook: {
      id: string;
      name: string;
      created: boolean;
      sectionId: string | null;
      sectionTitle: string | null;
      sections?: Array<{ id: string; title: string; summary: string | null }>;
    } | null;
  };
};

type LearnSourceUploadStatus =
  | 'ingesting'
  | 'ingesting_slow'
  | 'stored'
  | 'failed'
  | 'indexing'
  | 'indexing_slow'
  | 'index_failed';

type LearnSourceUploadItem = {
  id: string;
  courseId: string;
  fileName: string;
  sourceKind: CourseSourceUploadKind;
  status: LearnSourceUploadStatus;
  createdAt: number;
  updatedAt: number;
  activityId?: string;
  sourceHash?: string;
  summary?: string;
  error?: string;
};

export type SourceLibraryTile = {
  id: string;
  courseId: string;
  tileKind: 'source' | 'notebook' | 'transient';
  title: string;
  subtitle: string;
  dateLabel: string;
  coverImagePath: string | null;
  placeholderLabel: string;
  typeLabel: string;
  updatedAt: number;
  isProblemBank: boolean;
  status: LearnSourceUploadStatus | null;
  error: string | null;
  sourceHash: string | null;
  textNotebookIds: string[];
  textSectionIds: string[];
  textBlocks: Array<{
    id: string;
    title: string;
    markdown: string;
  }>;
};

function sourceLibraryCoverTone(seed: string) {
  const tones = [
    {
      shell:
        'bg-[radial-gradient(circle_at_78%_12%,rgba(125,211,252,0.72),transparent_34%),radial-gradient(circle_at_16%_76%,rgba(167,139,250,0.42),transparent_32%),linear-gradient(150deg,#f8fbff,#dff4ff_48%,#b9e3f8)] text-slate-800',
      accent: 'bg-sky-500',
      soft: 'bg-white/42',
    },
    {
      shell:
        'bg-[radial-gradient(circle_at_22%_18%,rgba(252,165,165,0.62),transparent_32%),radial-gradient(circle_at_80%_72%,rgba(134,239,172,0.48),transparent_34%),linear-gradient(150deg,#fffaf4,#fde7da_45%,#c6f6d5)] text-slate-800',
      accent: 'bg-emerald-500',
      soft: 'bg-white/46',
    },
    {
      shell:
        'bg-[radial-gradient(circle_at_82%_18%,rgba(253,224,71,0.62),transparent_32%),radial-gradient(circle_at_18%_72%,rgba(147,197,253,0.58),transparent_36%),linear-gradient(150deg,#fffdf7,#eef6ff_45%,#dbeafe)] text-slate-800',
      accent: 'bg-amber-500',
      soft: 'bg-white/48',
    },
  ];
  const hash = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return tones[hash % tones.length];
}

function SourceLibraryGeneratedCover({
  tile,
  size = 'grid',
}: {
  tile: SourceLibraryTile;
  size?: 'grid' | 'detail';
}) {
  const tone = sourceLibraryCoverTone(tile.sourceHash || tile.title);
  const isDetail = size === 'detail';
  return (
    <div
      className={cn(
        'relative flex size-full flex-col overflow-hidden text-left',
        tone.shell,
        isDetail ? 'p-8' : 'p-3',
      )}
    >
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.24)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.22)_1px,transparent_1px)] bg-[size:36px_36px]" />
      <div className="absolute -left-10 top-10 size-32 rounded-full bg-white/30 blur-2xl" />
      <div className="absolute -right-12 bottom-8 size-40 rounded-full bg-sky-200/34 blur-2xl" />
      <div
        className={cn(
          'absolute rounded-full shadow-[0_0_0_10px_rgba(255,255,255,0.22)]',
          tone.accent,
          isDetail ? 'right-14 top-20 size-5' : 'right-5 top-12 size-2.5',
        )}
      />
      <div
        className={cn(
          'absolute rotate-[-26deg] rounded-full bg-white/58',
          isDetail ? 'left-16 top-36 h-2 w-44' : 'left-7 top-16 h-1 w-20',
        )}
      />
      <div
        className={cn(
          'absolute rotate-[33deg] rounded-full bg-white/46',
          isDetail ? 'right-20 top-44 h-2 w-36' : 'right-6 top-20 h-1 w-16',
        )}
      />

      <div className="relative z-10 flex items-start justify-between gap-3">
        <span
          className={cn(
            'rounded-full bg-white/72 font-bold uppercase tracking-normal text-slate-600 shadow-sm',
            isDetail ? 'px-3 py-1.5 text-xs' : 'px-2 py-0.5 text-[10px]',
          )}
        >
          {tile.placeholderLabel}
        </span>
        <FileText
          className={cn('text-white/86 drop-shadow-sm', isDetail ? 'size-6' : 'size-4')}
          strokeWidth={1.8}
        />
      </div>

      <div className={cn('relative z-10 mt-auto', isDetail ? 'space-y-5' : 'space-y-2')}>
        <div
          className={cn(
            'w-fit rounded-full font-semibold text-slate-700 shadow-sm',
            tone.soft,
            isDetail ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-[10px]',
          )}
        >
          {tile.typeLabel}
        </div>
        <h3
          className={cn(
            'font-semibold leading-tight tracking-normal text-slate-900',
            isDetail ? 'max-w-[520px] text-5xl' : 'line-clamp-3 text-[17px]',
          )}
        >
          {tile.title}
        </h3>
        <div
          className={cn(
            'border-t border-slate-900/10 pt-2 font-medium text-slate-700/82',
            isDetail ? 'flex items-center justify-between gap-3 text-sm' : 'space-y-0.5 text-[9px]',
          )}
        >
          <span className={cn(!isDetail && 'block truncate')}>{tile.subtitle}</span>
          <span className={cn(!isDetail && 'block truncate')}>{tile.dateLabel}</span>
        </div>
      </div>
    </div>
  );
}

/** Lightweight grid face: no cover image fetch; real cover loads only in detail view. */
export function SourceLibraryListCardFace({ tile }: { tile: SourceLibraryTile }) {
  if (tile.tileKind === 'notebook') {
    return (
      <div className="relative size-full text-left">
        <span className="absolute inset-y-1 left-0 z-[3] flex w-[18px] flex-col items-center justify-evenly rounded-l-[10px] bg-[linear-gradient(90deg,#1e3a5f_0%,#2b4d78_55%,#243f63_100%)] shadow-[inset_-1px_0_0_rgba(255,255,255,0.18),inset_1px_0_0_rgba(0,0,0,0.18)]">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="size-2 rounded-full bg-[radial-gradient(circle_at_35%_30%,#f8fafc_0%,#94a3b8_45%,#475569_100%)] shadow-[0_0_0_1px_rgba(15,23,42,0.25),inset_0_1px_1px_rgba(255,255,255,0.55)]"
            />
          ))}
        </span>
        <span className="absolute bottom-2 right-0 top-2 z-[1] w-2.5 rounded-r-lg bg-[repeating-linear-gradient(180deg,#fff_0_2px,#e2e8f0_2px_3px)] shadow-[2px_0_0_#f1f5f9,4px_0_0_#e2e8f0,6px_0_8px_rgba(15,23,42,0.08)]" />
        <span
          className="absolute bottom-0 left-3.5 right-1.5 top-0 z-[2] grid grid-rows-[auto_1fr_auto_auto] gap-2.5 overflow-hidden rounded-r-[14px] border border-l-0 border-slate-400/35 px-3.5 pb-3.5 pl-4 pt-4 shadow-[0_12px_28px_rgba(15,23,42,0.12),inset_0_2px_0_rgba(255,255,255,0.70),-2px_0_6px_rgba(15,23,42,0.08)] transition group-hover:shadow-[0_18px_34px_rgba(15,23,42,0.16),inset_0_2px_0_rgba(255,255,255,0.70),-2px_0_6px_rgba(15,23,42,0.10)]"
          style={{
            background:
              'linear-gradient(90deg,rgba(15,23,42,.06) 0 1px,transparent 1px 100%),linear-gradient(180deg,transparent 0,transparent 28px,rgba(148,163,184,.22) 28px,rgba(148,163,184,.22) 29px),repeating-linear-gradient(180deg,transparent 0 27px,rgba(148,163,184,.18) 27px 28px),linear-gradient(145deg,#f7fafc 0%,#eef4f8 48%,#e8eef4 100%)',
          }}
        >
          <span className="w-fit rounded border border-blue-600/20 bg-white/70 px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.06em] text-slate-700">
            {tile.typeLabel}
          </span>
          <strong className="line-clamp-4 text-sm font-bold leading-[1.4] tracking-[0.01em] text-slate-900">
            {tile.title}
          </strong>
          <span className="grid gap-0.5 text-[11px] leading-[1.35] text-slate-500">
            <span className="truncate">{tile.subtitle}</span>
            <span className="truncate">{tile.dateLabel}</span>
          </span>
          <span className="inline-flex w-fit min-w-[4.25rem] items-center justify-center rounded-lg bg-blue-700 px-[11px] py-1.5 text-xs font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]">
            打开
          </span>
        </span>
      </div>
    );
  }

  const Icon = tile.isProblemBank ? BookOpenCheck : FileText;
  return (
    <div className="relative flex size-full flex-col overflow-hidden bg-gradient-to-b from-slate-50 via-white to-sky-50/80 p-3 text-left dark:from-slate-900 dark:via-slate-950 dark:to-slate-900">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-400/80 via-sky-300/50 to-transparent" />
      <div className="relative z-10 flex items-start justify-between gap-2">
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 shadow-sm ring-1 ring-slate-200/80 dark:bg-white/10 dark:text-slate-200 dark:ring-white/10">
          {tile.placeholderLabel}
        </span>
        <span className="grid size-7 place-items-center rounded-full bg-sky-50 text-sky-600 ring-1 ring-sky-100 dark:bg-sky-400/10 dark:text-sky-200 dark:ring-sky-300/20">
          <Icon className="size-3.5" strokeWidth={1.85} />
        </span>
      </div>
      <div className="relative z-10 mt-auto space-y-2">
        <div className="mx-auto grid size-12 place-items-center rounded-[14px] bg-white text-slate-500 shadow-sm ring-1 ring-slate-200/80 dark:bg-white/10 dark:text-slate-200 dark:ring-white/10">
          <Icon className="size-5" strokeWidth={1.75} />
        </div>
        <p className="text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          {tile.typeLabel}
        </p>
      </div>
    </div>
  );
}

type SourceLibraryTextState = {
  status: 'loading' | 'ready' | 'empty' | 'failed';
  text: string;
  error?: string;
};

type NotebookMarkdownPageState = {
  status: 'loading' | 'ready' | 'failed';
  sections: NotebookMarkdownSectionListItem[];
  hasMore: boolean;
  nextCursor: string | null;
  loadingMore?: boolean;
  error?: string;
};

type NotebookImagePreviewState = {
  status: 'loading' | 'ready' | 'empty' | 'failed';
  imagePath: string | null;
  error?: string;
};

type SourceLibraryDetailView = 'image' | 'text';

const studentCourseQuickPrompts = [
  '当前向我开放了几本笔记本？',
  '总结一下已开放笔记本的重点',
  '根据课程笔记解释一个核心概念',
  '查看我这周的学习日历',
];
const teacherQuickPrompts = [
  '这门课现在有几个笔记本？',
  '总结一下 Python 基础讲义的章节',
  '当前课程有哪些 Hard Rule？',
  '根据课程笔记解释条件控制',
];
const calendarWeekdays = ['日', '一', '二', '三', '四', '五', '六'];

const PROGRESS_SELECTION_NOT_STARTED = '__not_started__';
const PROGRESS_SELECTION_COMPLETED_ALL = '__completed_all__';
const MODEL_VALUE_SEPARATOR = '\u001e';
const MAX_LEARN_CHAT_ATTACHMENTS = 6;
const MAX_LEARN_CHAT_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_LEARN_CHAT_PDF_BYTES = 4 * 1024 * 1024;
const MAX_LEARN_CHAT_TEXT_BYTES = 1024 * 1024;
const LEARN_CHAT_IMAGE_MAX_DIMENSION = 1280;
const MAX_LEARN_SOURCE_TEXT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_LEARN_SOURCE_DOCUMENT_BYTES = 18 * 1024 * 1024;
const MAX_SYLLABUS_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SYLLABUS_DOCUMENT_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SYLLABUS_IMAGE_FILE_BYTES = 12 * 1024 * 1024;
const LEARN_LEFT_RAIL_COLLAPSED_STORAGE_KEY = 'syntara-learn-left-rail-collapsed';
const LEARN_RIGHT_RAIL_COLLAPSED_STORAGE_KEY = 'syntara-learn-right-rail-collapsed';
const LEARN_DELETED_PRACTICE_PLAN_IDS_PREFIX = 'syntara-learn-deleted-practice-plan-ids:v1';

type LearnSessionListState = {
  courseId: string | null;
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
};

type LearnConversationMessagePageState = RemoteLearnMessagePage & {
  key: string;
  loading: boolean;
  error: string | null;
};

type LearnRightRailView = 'overview' | 'calendar';

type TeachingReviewPlanEvidenceItem = {
  id: string;
  sourceType: string;
  sourceId?: string;
  title: string;
  excerpt?: string;
  reason: string;
  target?: { type: string; id: string };
  conceptTags?: string[];
};

type TeachingReviewQuestionCandidate = {
  problemId: string;
  title: string;
  href: string;
  type: string;
  difficulty: string;
  tags: string[];
  latestAttempt?: { status?: string } | null;
  reason: string;
  evidenceIds: string[];
};

type TeachingReviewPlanTask = {
  id: string;
  title: string;
  concepts: string[];
  minutes: number;
  reason: string;
  evidenceIds: string[];
  problemIds: string[];
};

type TeachingReviewPlanOutput = {
  summary: string;
  scheduleSummary: string | null;
  estimatedMinutes: number;
  tasks: TeachingReviewPlanTask[];
  questionCandidates: TeachingReviewQuestionCandidate[];
  rationale: string[];
  evidenceGaps: string[];
};

type TeachingReviewPlanResponse = {
  decision: {
    id: string;
    targetConcepts: string[];
    output: TeachingReviewPlanOutput;
    evidence: {
      items: TeachingReviewPlanEvidenceItem[];
      gaps: Array<{ reason: string; fallback: string }>;
    };
    userFacingRationale: string[];
  };
};

type SyllabusImportMode = 'file' | 'plan';
type SyllabusCommitMode = 'merge' | 'replace';
const SYLLABUS_EVENT_KIND_OPTIONS: Array<{ value: SyllabusEventKind; label: string }> = [
  { value: 'assignment', label: '作业' },
  { value: 'exam', label: '考试' },
  { value: 'progress', label: '进度' },
  { value: 'tutorial', label: 'Tutorial' },
  { value: 'holiday', label: '假期' },
  { value: 'other', label: '事项' },
];
const RESEARCH_EVENT_KIND_OPTIONS: Array<{ value: SyllabusEventKind; label: string }> = [
  { value: 'assignment', label: 'DDL' },
  { value: 'exam', label: '会议' },
  { value: 'progress', label: '进展' },
  { value: 'tutorial', label: '论文阅读' },
  { value: 'holiday', label: '暂停' },
  { value: 'other', label: '事项' },
];
type StatusCalendarActivity = {
  id: string;
  source: 'plan' | 'practice_session' | 'syllabus';
  sourceId: string;
  title: string;
  date: string;
  meta: string;
  dotClassName: string;
  actionLabel?: string;
  session?: PracticeSession;
  event?: SyllabusCalendarEvent;
};

type ParsedSyllabusFileEvent = {
  title: string;
  kind: SyllabusEventKind;
  date: string;
  week?: string | null;
  sourceColumn?: string | null;
  rawText?: string | null;
  confidence?: number | null;
};

function getInitialLearnRailCollapsed(storageKey: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(storageKey) === '1';
  } catch {
    return false;
  }
}

function pruneDuplicateBlankLearnSessions(
  userId: string,
  courseId: string,
  sessions: LearnChatSession[],
  preferredSessionId: string,
  hasComposerAttachments?: (sessionId: string) => boolean,
): LearnChatSession[] {
  const blankSessionIds = new Set(
    sessions
      .filter((session) =>
        Boolean(
          (session.messageCount === 0 ||
            (session.messageCount === undefined && session.title === '新对话')) &&
          learnSessionIsBlank(readLearnSessionMessages(userId, courseId, session.id)) &&
          !readLearnSessionComposerDraft(userId, courseId, session.id).trim() &&
          !hasComposerAttachments?.(session.id),
        ),
      )
      .map((session) => session.id),
  );
  if (blankSessionIds.size <= 1) return sessions;

  const preferredBlankId = blankSessionIds.has(preferredSessionId)
    ? preferredSessionId
    : sessions.find((session) => blankSessionIds.has(session.id))?.id;
  return sessions.filter(
    (session) => !blankSessionIds.has(session.id) || session.id === preferredBlankId,
  );
}

function parseStoredLearnMessages(raw: string | null): LearnMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LearnMessage[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((message): message is LearnMessage =>
        Boolean(
          message &&
          typeof message.id === 'string' &&
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.text === 'string' &&
          typeof message.createdAt === 'number',
        ),
      )
      .filter((message) => !message.transient)
      .map((message) =>
        finalizeLearnMessagePublicTrace({
          ...message,
          attachments: Array.isArray(message.attachments)
            ? message.attachments
                .map(normalizeLearnAttachmentReference)
                .filter((attachment): attachment is LearnImageAttachment => Boolean(attachment))
            : undefined,
        }),
      );
  } catch {
    return [];
  }
}

function readLearnSessionMessages(
  userId: string,
  courseId: string,
  sessionId: string,
): LearnMessage[] {
  return parseStoredLearnMessages(
    readLearnSessionMessagesJson(userId, courseId, sessionId, 'local'),
  );
}

function readLearnSessionTabMessages(
  userId: string,
  courseId: string,
  sessionId: string,
): LearnMessage[] | null {
  const raw = readLearnSessionMessagesJson(userId, courseId, sessionId, 'tab');
  return raw === null ? null : parseStoredLearnMessages(raw);
}

function learnAttachmentReference(
  attachment: LearnImageAttachment,
): Omit<LearnImageAttachment, 'dataUrl' | 'objectUrl'> {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    width: attachment.width,
    height: attachment.height,
  };
}

function normalizeLearnAttachmentReference(
  attachment: NonNullable<RemoteLearnMessage['attachments']>[number],
): LearnImageAttachment | null {
  const id = attachment.id?.trim();
  const mimeType = attachment.mimeType?.trim();
  if (!id || !mimeType || !isSupportedLearnChatAttachmentMime(mimeType)) return null;
  return {
    id,
    name: attachment.name?.trim() || '附件',
    mimeType,
    size:
      typeof attachment.size === 'number' && Number.isFinite(attachment.size)
        ? Math.max(0, attachment.size)
        : 0,
    width:
      typeof attachment.width === 'number' && Number.isFinite(attachment.width)
        ? attachment.width
        : undefined,
    height:
      typeof attachment.height === 'number' && Number.isFinite(attachment.height)
        ? attachment.height
        : undefined,
  };
}

function serializableLearnMessages(messages: LearnMessage[]) {
  return messages
    .filter((message) => !message.transient)
    .map(finalizeLearnMessagePublicTrace)
    .map((message) => ({
      ...message,
      lectureDeck: compactMiniLectureDeckForPersistence(message.lectureDeck),
      attachments: message.attachments?.map(learnAttachmentReference),
    }))
    .slice(-120);
}

function writeLearnSessionMessages(
  userId: string,
  courseId: string,
  sessionId: string,
  messages: LearnMessage[],
) {
  writeLearnSessionMessagesJson(
    userId,
    courseId,
    sessionId,
    'local',
    JSON.stringify(serializableLearnMessages(messages)),
  );
}

function writeLearnSessionTabMessages(
  userId: string,
  courseId: string,
  sessionId: string,
  messages: LearnMessage[],
) {
  writeLearnSessionMessagesJson(
    userId,
    courseId,
    sessionId,
    'tab',
    JSON.stringify(serializableLearnMessages(messages)),
  );
}

function deleteLearnSessionMessages(userId: string, courseId: string, sessionId: string) {
  deleteLearnSessionMessageStorage(userId, courseId, sessionId);
}

function remoteMessageToLearnMessage(message: RemoteLearnMessage): LearnMessage {
  return finalizeLearnMessagePublicTrace({
    id: message.id,
    role: message.role,
    text: message.text || '',
    createdAt: message.createdAt || Date.now(),
    plan: message.plan == null ? undefined : (message.plan as PracticePlan),
    progressProposal:
      message.progressProposal == null ? undefined : (message.progressProposal as ProgressProposal),
    pendingAction:
      message.pendingAction == null ? undefined : (message.pendingAction as PendingCourseAction),
    lecturePrompt:
      message.lecturePrompt == null ? undefined : (message.lecturePrompt as MiniLecturePrompt),
    lectureDeck: message.lectureDeck == null ? undefined : (message.lectureDeck as MiniLectureDeck),
    learningActions:
      message.learningActions == null ? undefined : (message.learningActions as LearningAction[]),
    artifacts: message.artifacts == null ? undefined : (message.artifacts as LearnArtifact[]),
    publicTrace:
      message.publicTrace == null ? undefined : (message.publicTrace as LearnPublicTraceStep[]),
    contextCompression: message.contextCompression,
    attachments: message.attachments
      ?.map(normalizeLearnAttachmentReference)
      .filter((attachment): attachment is LearnImageAttachment => Boolean(attachment)),
  });
}

function remoteLearnSessionToLocal(session: RemoteLearnChatSession): LearnChatSession {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    currentRevision: session.currentRevision,
    remoteState: 'remote',
  };
}

function learnMessageToRemotePayload(message: LearnMessage): RemoteLearnMessagePayload {
  const settledMessage = finalizeLearnMessagePublicTrace(message);
  return {
    id: settledMessage.id,
    role: settledMessage.role,
    text: settledMessage.text,
    createdAt: settledMessage.createdAt,
    plan: settledMessage.plan,
    progressProposal: settledMessage.progressProposal,
    pendingAction: settledMessage.pendingAction,
    lecturePrompt: settledMessage.lecturePrompt,
    lectureDeck: compactMiniLectureDeckForPersistence(settledMessage.lectureDeck),
    learningActions: settledMessage.learningActions,
    artifacts: settledMessage.artifacts,
    publicTrace: settledMessage.publicTrace,
    contextCompression: settledMessage.contextCompression,
    attachments: settledMessage.attachments?.map(learnAttachmentReference),
  };
}

async function hydrateLearnMessageAttachments(args: {
  messages: LearnMessage[];
  ownerId: string;
  courseId: string;
  sessionId: string;
}): Promise<{ messages: LearnMessage[]; objectUrls: string[] }> {
  const objectUrls: string[] = [];
  const messages = await Promise.all(
    args.messages.map(async (message) => {
      let changed = false;
      const attachments = message.attachments?.length
        ? await Promise.all(
            message.attachments.map(async (attachment) => {
              if (attachment.dataUrl && attachment.objectUrl) return attachment;
              try {
                const loaded = await readLearnChatAttachment({
                  id: attachment.id,
                  context: {
                    ownerId: args.ownerId,
                    courseId: args.courseId,
                    sessionId: args.sessionId,
                    messageId: message.id,
                  },
                });
                if (!loaded) return attachment;
                const dataUrl = await learnChatAttachmentBlobToDataUrl(loaded.blob);
                changed = true;
                objectUrls.push(loaded.objectUrl);
                return {
                  ...attachment,
                  ...loaded.attachment,
                  dataUrl,
                  objectUrl: loaded.objectUrl,
                };
              } catch {
                return attachment;
              }
            }),
          )
        : message.attachments;
      let lectureDeck = message.lectureDeck;
      if (lectureDeck?.localAssetId) {
        try {
          const hydratedDeck = await readMiniLectureDeckLocally({
            context: {
              ownerId: args.ownerId,
              courseId: args.courseId,
              sessionId: args.sessionId,
              messageId: message.id,
            },
            deck: lectureDeck,
          });
          if (hydratedDeck && hydratedDeck !== lectureDeck) {
            lectureDeck = hydratedDeck;
            changed = true;
          } else if (!hydratedDeck) {
            lectureDeck = undefined;
            changed = true;
          }
        } catch {
          // The generated lecture can be regenerated if its local asset was evicted.
        }
      }
      return changed ? { ...message, attachments, lectureDeck } : message;
    }),
  );
  return { messages, objectUrls };
}

function mergeRemoteAndLocalLearnMessages(
  baseMessages: RemoteLearnMessagePayload[],
  remoteMessages: LearnMessage[],
  localMessages: LearnMessage[],
): LearnMessage[] {
  return mergeRemoteLearnConversationMessages(
    baseMessages,
    remoteMessages.map(learnMessageToRemotePayload),
    localMessages.map(learnMessageToRemotePayload),
    { inferLocalDeletions: false },
  ).map(remoteMessageToLearnMessage);
}

function mergeRemoteAuthoritativeLearnMessages(
  remoteMessages: LearnMessage[],
  localMessages: LearnMessage[],
): LearnMessage[] {
  const byId = new Map(localMessages.map((message) => [message.id, message]));
  for (const message of remoteMessages) byId.set(message.id, message);
  return Array.from(byId.values())
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .slice(-120);
}

function mergeOlderRemoteLearnMessages(
  olderMessages: LearnMessage[],
  currentMessages: LearnMessage[],
): LearnMessage[] {
  const byId = new Map(olderMessages.map((message) => [message.id, message]));
  // Current messages may contain unsynced local edits, so they win over a
  // read-only historical page when ids overlap.
  for (const message of currentMessages) byId.set(message.id, message);
  return Array.from(byId.values()).sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}

function copyableLearnMessageText(message: LearnMessage): string {
  const parts = [
    message.text.trim(),
    message.plan?.title ? `计划：${message.plan.title}` : '',
    message.progressProposal?.label ? `学习范围：${message.progressProposal.label}` : '',
    message.lectureDeck?.title ? `课堂讲解：${message.lectureDeck.title}` : '',
    message.learningActions?.length
      ? `学习操作：${message.learningActions.map((a) => a.label).join(' / ')}`
      : '',
    message.artifacts?.length ? `学习素材：${message.artifacts.length} 个` : '',
    message.attachments?.length ? `[附件 ${message.attachments.length} 个]` : '',
  ].filter(Boolean);
  return parts.join('\n').trim();
}

function deletedPracticePlanIdsKey(userId: string, courseId: string) {
  return [
    LEARN_DELETED_PRACTICE_PLAN_IDS_PREFIX,
    encodeURIComponent(userId),
    encodeURIComponent(courseId),
  ].join(':');
}

function readDeletedPracticePlanIds(userId: string, courseId: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(deletedPracticePlanIdsKey(userId, courseId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

function writeDeletedPracticePlanIds(userId: string, courseId: string, ids: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      deletedPracticePlanIdsKey(userId, courseId),
      JSON.stringify(Array.from(ids).slice(-120)),
    );
  } catch {
    /* localStorage may be unavailable */
  }
}

function rememberDeletedPracticePlanId(userId: string, courseId: string, planId: string) {
  const next = readDeletedPracticePlanIds(userId, courseId);
  next.add(planId);
  writeDeletedPracticePlanIds(userId, courseId, next);
}

function visiblePracticePlans(plans: PracticePlan[], deletedIds: Set<string>): PracticePlan[] {
  if (deletedIds.size === 0) return plans;
  return plans.filter((plan) => !deletedIds.has(plan.id));
}

function isSyllabusPdfFile(file: File) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function isSyllabusImageFile(file: File) {
  return (
    ['image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(
      (file.type || '').toLowerCase(),
    ) || /\.(gif|jpe?g|png|webp)$/i.test(file.name)
  );
}

function isPptxSourceFile(file: File) {
  const mime = (file.type || '').toLowerCase();
  return (
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    /\.pptx$/i.test(file.name)
  );
}

function isDocxSourceFile(file: File) {
  const mime = (file.type || '').toLowerCase();
  return (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    /\.docx$/i.test(file.name)
  );
}

function learnSourceKindForFile(file: File): CourseSourceUploadKind {
  const lowerName = file.name.toLowerCase();
  const mime = (file.type || '').toLowerCase();
  if (isSyllabusPdfFile(file)) return 'pdf';
  if (isPptxSourceFile(file)) return 'pptx';
  if (isDocxSourceFile(file)) return 'docx';
  if (mime.includes('markdown') || lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) {
    return 'markdown';
  }
  if (lowerName.includes('problem') || lowerName.includes('question') || lowerName.includes('题')) {
    return 'problem_bank';
  }
  if (mime.startsWith('text/') || /\.(txt|csv|json)$/i.test(file.name)) return 'plain_text';
  return 'other';
}

function isLearnSourceDocumentFile(file: File) {
  if (file.type.startsWith('image/')) return false;
  return (
    isSyllabusPdfFile(file) ||
    isPptxSourceFile(file) ||
    isDocxSourceFile(file) ||
    /\.(txt|md|markdown|csv|json)$/i.test(file.name) ||
    (file.type || '').startsWith('text/')
  );
}

function pdfParseApiError(data: unknown, fallback: string) {
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    return data.error;
  }
  return fallback;
}

async function parseSyllabusFileWithOpenAI(
  file: File,
  options: {
    courseName?: string;
    courseDescription?: string;
  },
): Promise<{
  events: ParsedSyllabusFileEvent[];
  warnings: string[];
}> {
  const formData = new FormData();
  formData.append('file', file);
  if (options.courseName) formData.append('courseName', options.courseName);
  if (options.courseDescription) formData.append('courseDescription', options.courseDescription);

  const response = await fetch('/api/syllabus/parse', {
    method: 'POST',
    body: formData,
  });
  const data = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    events?: ParsedSyllabusFileEvent[];
    warnings?: string[];
    error?: string;
  };
  if (!response.ok || data.success === false || !Array.isArray(data.events)) {
    throw new Error(pdfParseApiError(data, `AI 读取 syllabus 失败：HTTP ${response.status}`));
  }
  return {
    events: data.events,
    warnings: Array.isArray(data.warnings) ? data.warnings.filter(Boolean) : [],
  };
}

async function readSyllabusFileText(
  file: File,
  options: {
    pdfProviderId: string;
    pdfProviderConfig?: { apiKey?: string; baseUrl?: string };
  },
) {
  if (!isSyllabusPdfFile(file)) {
    return file.text();
  }

  const formData = new FormData();
  formData.append('providerId', options.pdfProviderId || 'unpdf');
  if (options.pdfProviderConfig?.apiKey)
    formData.append('apiKey', options.pdfProviderConfig.apiKey);
  if (options.pdfProviderConfig?.baseUrl) {
    formData.append('baseUrl', options.pdfProviderConfig.baseUrl);
  }
  formData.append('pdf', file);

  const response = await fetch('/api/parse-pdf', {
    method: 'POST',
    body: formData,
  });
  const data = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    data?: ParsedPdfContent;
    error?: string;
  };
  if (!response.ok || data.success === false || !data.data) {
    throw new Error(pdfParseApiError(data, `PDF 读取失败：HTTP ${response.status}`));
  }
  const text = (data.data.text || '').trim();
  if (!text) throw new Error('PDF 读取完成，但没有提取到可用文字。');
  return text;
}

function sourceUploadKindLabel(kind: string): string {
  switch (kind) {
    case 'pdf':
      return 'PDF';
    case 'markdown':
      return 'Markdown';
    case 'plain_text':
      return '文本';
    case 'pptx':
      return 'PPTX';
    case 'problem_bank':
      return '题库';
    default:
      return '原始讲义';
  }
}

function formatLibraryItemDate(value: string | number | null | undefined): string {
  const timestamp = typeof value === 'number' ? value : value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMemoryActivityTime(value: number) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function memoryActivityStatusLabel(
  status: MemoryActivityRecord['status'] | TaskHistoryRecord['status'],
) {
  if (
    status === 'detecting' ||
    status === 'writing_fact' ||
    status === 'writing_study_memory' ||
    status === 'indexing_source' ||
    status === 'needs_confirmation' ||
    status === 'running' ||
    status === 'queued' ||
    status === 'needs_attention'
  ) {
    return '理解中';
  }
  if (status === 'completed') return '已记住';
  if (status === 'failed') return '没记成';
  return '已跳过';
}

const INTERNAL_MEMORY_PROCESS_PATTERN =
  /用户先看到|后台|处理判断|写入和索引|独立任务|独立判断|正在覆盖当前任务|当前任务、卡点|教学动作|currentTask|stuckPoint|nextTeachingMove/i;

function memoryActivityStudentTitle(title: string, description: string) {
  const raw = [title, description].join(' ').trim();
  if (INTERNAL_MEMORY_PROCESS_PATTERN.test(raw)) {
    return '我记录了这次互动里有用的学习线索';
  }
  if (
    /(考试|测验|quiz|test|midterm|final|ddl|deadline|due|作业|assignment|日程|calendar|syllabus|上课|office hour)/i.test(
      raw,
    )
  ) {
    return '课程安排已更新';
  }
  if (/(课程要求|笔记本要求|要求|格式|模板|rubric|marking|评分|规则|contract)/i.test(raw)) {
    return '课程要求已更新';
  }
  if (/(个人背景|背景|目标|专业|年级|学校|profile)/i.test(raw)) {
    return '个人背景已更新';
  }
  if (/(重要信息|事实|current fact|fact|记住.*信息)/i.test(raw)) {
    return '重要信息已更新';
  }
  if (/(对话摘要|conversation summary|摘要|总结)/i.test(raw)) {
    return '对话摘要已更新';
  }
  if (/进度|范围|checkpoint|学到的位置/i.test(raw)) return '学习进度已更新';
  if (/薄弱|不稳|不会|卡点|weak|错|mistake|stuck/i.test(raw)) return '薄弱点已更新';
  if (/掌握|会了|已通过|mastered|passed/i.test(raw)) return '掌握情况已更新';
  if (/下一步|怎么帮|教学动作|next/i.test(raw)) return '下一步学习建议已更新';
  if (/资料|索引|入库|source/i.test(raw)) return '资料理解已更新';
  if (/偏好|preference|喜欢|希望|习惯/i.test(raw)) return '学习偏好已更新';
  return title || '我更新了一条学习记忆';
}

function memoryActivityStudentDescription(record: {
  title: string;
  description: string;
  status: MemoryActivityRecord['status'] | TaskHistoryRecord['status'];
  error?: string;
}) {
  if (record.status === 'failed') {
    return record.error || record.description || '这次没有写入成功，我会保留当前对话继续帮你。';
  }
  if (INTERNAL_MEMORY_PROCESS_PATTERN.test(record.description)) {
    return '我会把这次对话里有用的学习状态整理出来，之后回答时更接得上你的进度和卡点。';
  }
  if (record.description) return record.description;
  if (record.status === 'completed')
    return '这条记忆已经更新。之后我会用它判断你的进度、薄弱点和下一步学习安排。';
  return '平台正在判断这条信息会不会帮助之后的学习。';
}

function platformMemoryChipLabel(chip: string) {
  if (chip === 'conversation') return '对话';
  if (chip === 'course') return '课程';
  if (chip === 'notebook') return '笔记本';
  if (chip === 'private') return '私有';
  if (chip === 'public') return '共享';
  if (chip === 'study_memory') return '学习记忆';
  if (chip === 'knowledge_index') return '资料理解';
  if (chip === 'structured_fact') return '事实';
  return chip;
}

type PlatformMemoryVisualTone =
  | 'schedule'
  | 'preference'
  | 'progress'
  | 'weakness'
  | 'mastery'
  | 'source'
  | 'next'
  | 'writing';

const PLATFORM_MEMORY_SPHERES: Array<{
  tone: PlatformMemoryVisualTone;
  label: string;
  className: string;
}> = [
  { tone: 'progress', label: '进度', className: 'learn-memory-sphere-xl sphere-progress' },
  { tone: 'weakness', label: '薄弱点', className: 'learn-memory-sphere-md sphere-weakness' },
  { tone: 'mastery', label: '掌握', className: 'learn-memory-sphere-lg sphere-mastery' },
  { tone: 'schedule', label: '安排', className: 'learn-memory-sphere-sm sphere-schedule' },
  { tone: 'preference', label: '偏好', className: 'learn-memory-sphere-sm sphere-preference' },
  { tone: 'next', label: '下一步', className: 'learn-memory-sphere-lg sphere-next' },
  { tone: 'writing', label: '写入中', className: 'learn-memory-sphere-xs sphere-writing' },
  { tone: 'mastery', label: '稳定', className: 'learn-memory-sphere-sm sphere-mastery-alt' },
];

function platformMemoryVisualTone(record: { title: string; description: string; chips: string[] }) {
  const raw = [record.title, record.description, ...record.chips].join(' ');
  if (
    /(考试|测验|quiz|test|midterm|final|ddl|deadline|due|作业|assignment|日程|calendar|syllabus|上课|office hour|课程安排)/i.test(
      raw,
    )
  ) {
    return 'schedule';
  }
  if (/偏好|preference|喜欢|希望|习惯|学习偏好/i.test(raw)) return 'preference';
  if (/进度|范围|checkpoint|学到的位置|学习进度/i.test(raw)) return 'progress';
  if (/薄弱|不稳|不会|卡点|weak|错|mistake|stuck|薄弱点/i.test(raw)) {
    return 'weakness';
  }
  if (/掌握|会了|已通过|mastered|passed|掌握情况/i.test(raw)) return 'mastery';
  if (/下一步|怎么帮|教学动作|next|学习建议/i.test(raw)) return 'next';
  if (/资料|索引|入库|source|题目|讲义|资料理解/i.test(raw)) return 'source';
  return 'writing';
}

function shouldShowPlatformMemoryRecord(record: TaskHistoryRecord) {
  if (record.source !== 'memory_activity') return false;
  if (record.kind !== 'study_memory' && record.kind !== 'structured_fact') return false;
  if (INTERNAL_MEMORY_PROCESS_PATTERN.test([record.title, record.description].join(' '))) {
    return false;
  }
  return true;
}

function taskHistoryBelongsToCourse(record: TaskHistoryRecord, courseId: string | null) {
  if (record.courseId) return record.courseId === courseId;
  if (!record.contextPath) return true;
  try {
    const contextCourseId = new URL(record.contextPath, 'https://openmaic.local').searchParams.get(
      'courseId',
    );
    return !contextCourseId || contextCourseId === courseId;
  } catch {
    return true;
  }
}

function isPlatformMemoryStatusMockRecord(record: TaskHistoryRecord) {
  return (
    record.sourceId.startsWith('platform-memory-status-mock-') ||
    record.sourceId.startsWith('live2d-memory-status-mock-')
  );
}

function shouldCountPlatformMemoryActivity(activity: MemoryActivityRecord) {
  if (activity.layer !== 'study_memory' && activity.layer !== 'structured_fact') return false;
  if (INTERNAL_MEMORY_PROCESS_PATTERN.test([activity.title, activity.description].join(' '))) {
    return false;
  }
  return true;
}

type PlatformMemoryStatusMockMode = 'off' | 'running' | 'flow';

const PLATFORM_MEMORY_STATUS_MOCK_QUERY_PARAM = 'memoryStatusMock';
const PLATFORM_MEMORY_STATUS_MOCK_ACTIVITY_IDS = [
  'platform-memory-status-mock-schedule',
  'platform-memory-status-mock-preference',
  'platform-memory-status-mock-progress',
  'platform-memory-status-mock-weakness',
  'platform-memory-status-mock-mastery',
  'platform-memory-status-mock-source',
  'platform-memory-status-mock-next-step',
] as const;

function platformMemoryStatusMockModeFromValue(
  value: string | null | undefined,
): PlatformMemoryStatusMockMode {
  if (value === 'running' || value === 'flow') return value;
  return 'off';
}

function dismissPlatformMemoryStatusMockActivities() {
  for (const id of PLATFORM_MEMORY_STATUS_MOCK_ACTIVITY_IDS) {
    dismissMemoryActivity(id);
  }
}

function showRunningPlatformMemoryStatusMock() {
  dismissPlatformMemoryStatusMockActivities();

  addMemoryActivity({
    id: 'platform-memory-status-mock-schedule',
    title: '课程安排已更新',
    description:
      '课程安排：你说 CSC108 下周五有 midterm。之后安排复习、小测和提醒时，我会围绕这个时间倒排。',
    status: 'completed',
    layer: 'study_memory',
    chips: ['课程安排', '考试'],
  });
  addMemoryActivity({
    id: 'platform-memory-status-mock-preference',
    title: '学习偏好已更新',
    description:
      '学习偏好：你更希望先看一个具体例子，再回到定义和规则。之后讲新概念时我会按这个顺序来。',
    status: 'completed',
    layer: 'structured_fact',
    chips: ['学习偏好'],
  });
  addMemoryActivity({
    id: 'platform-memory-status-mock-progress',
    title: '学习进度写入中',
    description: '学习进度：正在学习 03 循环，重点是 range、for、while 和嵌套循环。',
    status: 'writing_study_memory',
    layer: 'study_memory',
    chips: ['学习进度', 'CSC108'],
  });
  addMemoryActivity({
    id: 'platform-memory-status-mock-weakness',
    title: '薄弱点写入中',
    description:
      '薄弱点：循环边界和 range 的停止位置还不稳，尤其容易把最后一次循环是否执行判断错。',
    status: 'writing_study_memory',
    layer: 'study_memory',
    chips: ['薄弱点', '循环'],
  });
}

function replayPlatformMemoryStatusMock() {
  dismissPlatformMemoryStatusMockActivities();

  addMemoryActivity({
    id: 'platform-memory-status-mock-schedule',
    title: '课程安排写入中',
    description: '课程安排：你说 CSC108 下周五有 midterm，我正在把它放进之后的复习规划里。',
    status: 'writing_study_memory',
    layer: 'study_memory',
    chips: ['课程安排', '考试'],
  });
  addMemoryActivity({
    id: 'platform-memory-status-mock-preference',
    title: '学习偏好写入中',
    description: '学习偏好：你更喜欢先看例子，再看定义。之后我会按这个顺序组织讲解。',
    status: 'writing_fact',
    layer: 'structured_fact',
    chips: ['学习偏好'],
  });
  addMemoryActivity({
    id: 'platform-memory-status-mock-progress',
    title: '学习进度写入中',
    description: '学习进度：正在学习 03 循环，范围包括 range、for、while 和嵌套循环。',
    status: 'writing_study_memory',
    layer: 'study_memory',
    chips: ['学习进度', 'CSC108'],
  });
  addMemoryActivity({
    id: 'platform-memory-status-mock-weakness',
    title: '薄弱点写入中',
    description: '薄弱点：循环边界和 range 的停止位置还不稳，需要用小题继续确认。',
    status: 'writing_study_memory',
    layer: 'study_memory',
    chips: ['薄弱点', '循环'],
  });
  addMemoryActivity({
    id: 'platform-memory-status-mock-source',
    title: '资料理解写入中',
    description: '资料理解：我正在把循环讲义和刚才的小测题整理成之后可以检索的课程依据。',
    status: 'indexing_source',
    layer: 'knowledge_index',
    chips: ['资料理解', '题目'],
  });

  return [
    window.setTimeout(() => {
      updateMemoryActivity('platform-memory-status-mock-schedule', {
        title: '课程安排已更新',
        status: 'completed',
        description:
          '课程安排：CSC108 下周五有 midterm。之后安排复习、小测和提醒时，我会围绕这个时间倒排。',
      });
    }, 700),
    window.setTimeout(() => {
      updateMemoryActivity('platform-memory-status-mock-preference', {
        title: '学习偏好已更新',
        status: 'completed',
        description:
          '学习偏好：你更喜欢先看例子，再看定义。之后讲新概念时我会先给一个可运行的小例子。',
      });
    }, 1200),
    window.setTimeout(() => {
      updateMemoryActivity('platform-memory-status-mock-progress', {
        title: '学习进度已更新',
        status: 'completed',
        description:
          '学习进度：你现在定位在 03 循环。下一轮复习会从 range、for、while 和嵌套循环接上。',
      });
    }, 1700),
    window.setTimeout(() => {
      addMemoryActivity({
        id: 'platform-memory-status-mock-mastery',
        title: '掌握情况已更新',
        description: '掌握情况：你已经能读懂简单 for 循环，并能说出循环变量每轮怎样变化。',
        status: 'completed',
        layer: 'study_memory',
        chips: ['掌握情况', '循环'],
      });
    }, 2300),
    window.setTimeout(() => {
      updateMemoryActivity('platform-memory-status-mock-weakness', {
        title: '薄弱点已更新',
        status: 'completed',
        description:
          '薄弱点：range 的停止位置和 while 的终止条件还不稳。下一步要用 2-3 道边界小题来补。',
      });
    }, 2800),
    window.setTimeout(() => {
      addMemoryActivity({
        id: 'platform-memory-status-mock-next-step',
        title: '下一步学习建议已更新',
        description:
          '下一步：先做一组循环边界判断题，再让你自己写一个带 accumulator 的 while 循环。',
        status: 'completed',
        layer: 'study_memory',
        chips: ['下一步', '练习'],
      });
    }, 3400),
    window.setTimeout(() => {
      updateMemoryActivity('platform-memory-status-mock-source', {
        title: '资料理解已更新',
        status: 'completed',
        description:
          '资料理解：循环讲义和小测题已经整理好。之后问到 range/for/while，我可以回到这些材料里找依据。',
      });
    }, 4100),
  ];
}

function formatSourceUploadStatusSummary(result: CourseSourceIngestResponse['ingest']) {
  const sectionCount = result.notebook?.sections?.length ?? (result.notebook?.sectionId ? 1 : 0);
  const sourceTextLine = result.classification.allQuestionUpload
    ? '我识别出这是一份题目文件，已经把能练习的题目整理出来'
    : result.notebook
      ? `我${result.notebook.created ? '新建' : '更新'}了讲义整理正文「${result.notebook.name}」${sectionCount ? `，整理出 ${sectionCount} 个段落` : ''}`
      : '我已经把原始讲义放进可检索的课程理解里';
  return [
    `我读懂了这份关于「${result.classification.topic}」的原始讲义`,
    result.problems.insertedCount
      ? `还整理出 ${result.problems.insertedCount} 道可以之后练习的题`
      : '',
    sourceTextLine,
  ]
    .filter(Boolean)
    .join('。');
}

function sourceUploadLive2DLine(fileName: string, result: CourseSourceIngestResponse['ingest']) {
  if (result.classification.allQuestionUpload) {
    return `《${fileName}》题目入库完成：新增 ${result.problems.insertedCount} 题，跳过 ${result.problems.duplicateCount} 个重复。`;
  }
  const sourceText = result.notebook
    ? `${result.notebook.created ? '新建' : '更新'}了讲义整理正文「${result.notebook.name}」${result.notebook.sections?.length ? `，写入 ${result.notebook.sections.length} 个段落` : ''}`
    : '已更新可检索讲义';
  return `《${fileName}》已入库，${sourceText}，并同步了题库和知识图谱。`;
}

function notifySourceUploadLive2D(fileName: string, result: CourseSourceIngestResponse['ingest']) {
  const progress = buildCourseReplyProgress({
    phase: 'completed',
    agentName: '原始讲义入库',
  });
  dispatchCourseReplyProgress({
    ...progress,
    title: '原始讲义入库',
    line: sourceUploadLive2DLine(fileName, result),
  });
}

function notifySourceUploadFailureLive2D(fileName: string, message: string) {
  const progress = buildCourseReplyProgress({
    phase: 'failed',
    agentName: '原始讲义入库',
  });
  dispatchCourseReplyProgress({
    ...progress,
    title: '原始讲义入库',
    line: `《${fileName}》入库失败：${message}`,
  });
}

function sourceLibraryTextFromBlocks(
  blocks: Array<{
    title: string;
    markdown: string;
  }>,
) {
  return blocks
    .map((block, index) => {
      const markdown = block.markdown.trim();
      if (!markdown) return '';
      const title = block.title || `文本 ${index + 1}`;
      return [`## ${title}`, markdown].join('\n\n');
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

type NotebookMarkdownSectionListItem = {
  id: string;
  title: string;
  order: number;
  summary: string | null;
};

type NotebookMarkdownSectionPage = {
  sections: NotebookMarkdownSectionListItem[];
  page: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
};

type NotebookMarkdownSectionDetail = NotebookMarkdownSectionListItem & {
  notebookId: string;
  courseId: string | null;
  markdown: string;
};

type NotebookWithMarkdownSections = {
  id: string;
  markdownSections: NotebookMarkdownSectionDetail[];
};

const NOTEBOOK_MARKDOWN_REQUEST_TIMEOUT_MS = 30_000;

async function loadNotebookMarkdownSectionPage(notebookId: string, cursor?: string | null) {
  const params = new URLSearchParams({ limit: '20' });
  if (cursor) params.set('cursor', cursor);
  return backendJson<NotebookMarkdownSectionPage>(
    `/api/notebooks/${encodeURIComponent(notebookId)}/markdown-sections?${params.toString()}`,
    { timeoutMs: NOTEBOOK_MARKDOWN_REQUEST_TIMEOUT_MS },
  );
}

async function loadNotebookMarkdownSectionDetail(notebookId: string, sectionId: string) {
  return backendJson<{ section: NotebookMarkdownSectionDetail }>(
    `/api/notebooks/${encodeURIComponent(notebookId)}/markdown-sections/${encodeURIComponent(
      sectionId,
    )}`,
    { timeoutMs: NOTEBOOK_MARKDOWN_REQUEST_TIMEOUT_MS },
  );
}

async function loadNotebookWithMarkdownSections(notebookId: string) {
  return backendJson<{ notebook: NotebookWithMarkdownSections }>(
    `/api/notebooks/${encodeURIComponent(notebookId)}?includeScenes=0&includeMarkdown=1`,
    { timeoutMs: NOTEBOOK_MARKDOWN_REQUEST_TIMEOUT_MS },
  );
}

async function loadBoundedNotebookMarkdownText(notebookIds: string[], textSectionIds: string[]) {
  const boundedNotebookIds = Array.from(new Set(notebookIds)).slice(0, 4);
  const wantedSectionIds = new Set(textSectionIds);
  const notebooks = await Promise.all(
    boundedNotebookIds.map(async (notebookId) => ({
      notebookId,
      result: await loadNotebookWithMarkdownSections(notebookId),
    })),
  );
  const candidates = notebooks.flatMap(({ result }) =>
    result.notebook.markdownSections.map((section) => ({ section })),
  );
  const selectedCandidates = (
    wantedSectionIds.size > 0
      ? candidates.filter(({ section }) => wantedSectionIds.has(section.id))
      : candidates
  ).slice(0, 6);
  return selectedCandidates
    .map(({ section }, index) => {
      const title = section.title || `文本 ${index + 1}`;
      return [`## ${title}`, section.markdown.trim()].filter(Boolean).join('\n\n');
    })
    .join('\n\n')
    .trim();
}

function firstSlidePreviewImage(slide: unknown): string | null {
  if (!slide || typeof slide !== 'object' || Array.isArray(slide)) return null;
  const elements = (slide as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return null;
  for (const element of elements) {
    if (!element || typeof element !== 'object' || Array.isArray(element)) continue;
    const record = element as { type?: unknown; src?: unknown };
    const src = typeof record.src === 'string' ? record.src.trim() : '';
    if (
      record.type === 'image' &&
      (src.startsWith('/') || src.startsWith('http://') || src.startsWith('https://'))
    ) {
      return src;
    }
  }
  return null;
}

function sourceUploadStatusLabel(status: LearnSourceUploadStatus) {
  if (status === 'ingesting') return '入库中';
  if (status === 'ingesting_slow') return '入库较慢，仍在处理';
  if (status === 'stored') return '已入库';
  if (status === 'indexing') return 'AI 索引中';
  if (status === 'indexing_slow') return '索引较慢，仍在处理';
  if (status === 'index_failed') return 'AI 索引失败';
  return '入库失败';
}

function sourceUploadStatusIsProcessing(status: LearnSourceUploadStatus | null | undefined) {
  return (
    status === 'ingesting' ||
    status === 'ingesting_slow' ||
    status === 'indexing' ||
    status === 'indexing_slow'
  );
}

function persistedSourceUploadTileState(upload: CourseSourceUploadRecord): {
  status: LearnSourceUploadStatus | null;
  error: string | null;
} {
  const updatedAt = Date.parse(upload.updatedAt);
  const ageMs = Number.isFinite(updatedAt) ? Date.now() - updatedAt : 0;

  if (upload.ingestStatus === 'error') {
    return {
      status: 'failed',
      error: upload.errorReason || '原始讲义入库失败，服务端没有返回更多原因。',
    };
  }
  if (upload.ingestStatus === 'processing') {
    if (ageMs >= COURSE_SOURCE_PROCESSING_HARD_TIMEOUT_MS) {
      return {
        status: 'failed',
        error: '原始讲义入库超过 15 分钟仍未完成，可以重试上传或查看服务端日志。',
      };
    }
    return {
      status: ageMs >= COURSE_SOURCE_PROCESSING_SLOW_MS ? 'ingesting_slow' : 'ingesting',
      error: null,
    };
  }
  if (upload.indexStatus === 'error') {
    return {
      status: 'index_failed',
      error: upload.errorReason || 'AI 索引失败，服务端没有返回更多原因。',
    };
  }
  if (upload.indexStatus === 'pending' || upload.indexStatus === 'indexing') {
    if (ageMs >= COURSE_SOURCE_PROCESSING_HARD_TIMEOUT_MS) {
      return {
        status: 'index_failed',
        error: 'AI 索引超过 15 分钟仍未完成，可以点击重试索引。',
      };
    }
    return {
      status: ageMs >= COURSE_SOURCE_PROCESSING_SLOW_MS ? 'indexing_slow' : 'indexing',
      error: null,
    };
  }
  return { status: null, error: null };
}

function SourceUploadBadge({
  uploading,
  completedCount,
  compact = false,
}: {
  uploading: boolean;
  completedCount: number;
  compact?: boolean;
}) {
  if (!uploading && completedCount <= 0) return null;
  const label = uploading
    ? compact
      ? '中'
      : '入库中'
    : completedCount > 9
      ? '9+'
      : String(completedCount);
  const srLabel = uploading ? '原始讲义正在入库' : `有 ${completedCount} 个新文件已入库`;

  return (
    <span
      className={cn(
        'absolute z-10 grid place-items-center rounded-full border border-white px-1 text-[10px] font-bold leading-4 text-white shadow-sm dark:border-slate-950',
        compact ? '-right-0.5 -top-0.5 min-w-4' : '-right-1.5 -top-1.5 min-w-4',
        uploading ? 'bg-sky-500' : 'bg-emerald-500',
        !compact && uploading ? 'min-w-[2.5rem] px-1.5' : null,
      )}
      aria-label={srLabel}
    >
      {label}
    </span>
  );
}

function modelOptionValue(providerId: ProviderId, modelId: string): string {
  return `${providerId}${MODEL_VALUE_SEPARATOR}${modelId}`;
}

function parseModelOptionValue(value: string): { providerId: ProviderId; modelId: string } | null {
  const separatorIndex = value.indexOf(MODEL_VALUE_SEPARATOR);
  if (separatorIndex < 0) return null;
  return {
    providerId: value.slice(0, separatorIndex) as ProviderId,
    modelId: value.slice(separatorIndex + 1),
  };
}

function compactBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('附件读取失败'));
    reader.onerror = () => reject(reader.error ?? new Error('附件读取失败'));
    reader.readAsDataURL(file);
  });
}

function normalizedLearnChatAttachmentMime(file: Pick<File, 'name' | 'type'>): string {
  const declared = file.type.trim().toLowerCase();
  if (declared) return declared;
  const extension = file.name.split('.').pop()?.trim().toLowerCase();
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'json') return 'application/json';
  if (extension === 'xml') return 'application/xml';
  if (extension === 'md' || extension === 'markdown') return 'text/markdown';
  if (extension === 'csv') return 'text/csv';
  if (extension === 'txt') return 'text/plain';
  return 'application/octet-stream';
}

function isSupportedLearnChatAttachmentMime(mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase();
  return (
    normalized.startsWith('image/') ||
    normalized.startsWith('text/') ||
    normalized === 'application/pdf' ||
    normalized === 'application/json' ||
    normalized === 'application/xml'
  );
}

function learnChatAttachmentTypeLabel(attachment: Pick<LearnImageAttachment, 'mimeType'>): string {
  const mimeType = attachment.mimeType.toLowerCase();
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.startsWith('image/')) return '图片';
  if (mimeType === 'application/json') return 'JSON';
  if (mimeType === 'application/xml') return 'XML';
  if (mimeType === 'text/markdown') return 'Markdown';
  if (mimeType === 'text/csv') return 'CSV';
  return '文本';
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片解析失败'));
    image.src = src;
  });
}

async function prepareLearnImageAttachment(file: File): Promise<LearnImageAttachment> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件。');
  }
  if (file.size > MAX_LEARN_CHAT_IMAGE_BYTES) {
    throw new Error(`图片不能超过 ${compactBytes(MAX_LEARN_CHAT_IMAGE_BYTES)}。`);
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  let dataUrl = rawDataUrl;
  let mimeType = file.type || 'image/png';
  let width: number | undefined;
  let height: number | undefined;

  if (!/image\/(?:gif|svg\+xml)/.test(mimeType)) {
    const image = await loadImageElement(rawDataUrl);
    width = image.naturalWidth;
    height = image.naturalHeight;
    const longestEdge = Math.max(width, height);
    if (longestEdge > LEARN_CHAT_IMAGE_MAX_DIMENSION) {
      const scale = LEARN_CHAT_IMAGE_MAX_DIMENSION / longestEdge;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('图片压缩失败');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      mimeType = 'image/jpeg';
      dataUrl = canvas.toDataURL(mimeType, 0.86);
      width = canvas.width;
      height = canvas.height;
    }
  }

  const id = makeClientId('learn-image');
  return {
    id,
    name: file.name.trim() || '图片',
    mimeType,
    size: file.size,
    dataUrl,
    objectUrl: dataUrl,
    width,
    height,
  };
}

async function prepareLearnChatAttachment(file: File): Promise<LearnImageAttachment> {
  const mimeType = normalizedLearnChatAttachmentMime(file);
  if (mimeType.startsWith('image/')) {
    return prepareLearnImageAttachment(
      file.type === mimeType ? file : new File([file], file.name, { type: mimeType }),
    );
  }
  if (!isSupportedLearnChatAttachmentMime(mimeType)) {
    throw new Error(`${file.name} 暂不支持。聊天附件支持图片、PDF、Markdown 和文本文件。`);
  }
  const maxBytes =
    mimeType === 'application/pdf' ? MAX_LEARN_CHAT_PDF_BYTES : MAX_LEARN_CHAT_TEXT_BYTES;
  if (file.size > maxBytes) {
    throw new Error(`${file.name} 不能超过 ${compactBytes(maxBytes)}。`);
  }
  const dataUrl = await readFileAsDataUrl(file);
  return {
    id: makeClientId('learn-file'),
    name: file.name.trim() || '附件',
    mimeType,
    size: file.size,
    dataUrl,
    objectUrl: dataUrl,
  };
}

function buildLearnModelOptions(
  providersConfig: ReturnType<typeof useSettingsStore.getState>['providersConfig'],
): LearnModelOption[] {
  const options: LearnModelOption[] = [];
  for (const [rawProviderId, config] of Object.entries(providersConfig)) {
    const providerId = rawProviderId as ProviderId;
    if (
      !config ||
      (config.requiresApiKey && !config.apiKey && !config.isServerConfigured) ||
      !(config.baseUrl || config.defaultBaseUrl || config.serverBaseUrl)
    ) {
      continue;
    }

    let models = config.models || [];
    if (config.isServerConfigured && !config.apiKey && config.serverModels?.length) {
      const allowed = new Set(config.serverModels);
      models = models.filter((model) => allowed.has(model.id));
    }

    for (const model of models) {
      options.push({
        value: modelOptionValue(providerId, model.id),
        providerId,
        modelId: model.id,
        providerName: config.name || providerId,
        modelName: model.name || model.id,
        vision: model.capabilities?.vision ?? null,
      });
    }
  }
  return options;
}

const courseMarkdownClassName = cn(
  'w-full max-w-none select-text break-words text-[12px] leading-[1.7] text-[#28251f] dark:text-slate-100',
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  '[&_p]:mb-2.5 [&_p]:mt-0',
  '[&_strong]:font-semibold [&_strong]:text-foreground',
  '[&_h1]:mb-[7px] [&_h1]:mt-[18px] [&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:leading-[1.35]',
  '[&_h2]:mb-[7px] [&_h2]:mt-[18px] [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:leading-[1.35]',
  '[&_h3]:mb-[7px] [&_h3]:mt-[18px] [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:leading-[1.35]',
  '[&_ul]:mb-[11px] [&_ul]:mt-0 [&_ol]:mb-[11px] [&_ol]:mt-0 [&_ul]:pl-5 [&_ol]:pl-5',
  '[&_li]:mb-1',
  '[&_blockquote]:my-[11px] [&_blockquote]:rounded-r-[7px] [&_blockquote]:border-l-[3px] [&_blockquote]:border-[#c7a678] [&_blockquote]:bg-[#faf7f1] [&_blockquote]:px-2.5 [&_blockquote]:py-[7px] dark:[&_blockquote]:border-slate-600 dark:[&_blockquote]:bg-white/5',
  '[&_blockquote]:text-foreground [&_blockquote_p]:my-0',
  '[&_hr]:my-3.5 [&_hr]:border-border',
  '[&_code]:rounded-[4px] [&_code]:bg-[#f7f1e9] [&_code]:px-[0.32em] [&_code]:py-[0.1em] [&_code]:font-mono [&_code]:text-[0.9em] dark:[&_code]:bg-white/10',
  '[&_[data-streamdown=code-block]]:my-5 [&_[data-streamdown=code-block]]:max-w-full [&_[data-streamdown=code-block]]:overflow-hidden [&_[data-streamdown=code-block]]:rounded-lg [&_[data-streamdown=code-block]]:border [&_[data-streamdown=code-block]]:border-border [&_[data-streamdown=code-block]]:bg-muted/60',
  '[&_[data-streamdown=code-block-body]]:text-sm [&_[data-streamdown=code-block-body]]:leading-6',
  '[&_table]:my-5 [&_table]:block [&_table]:w-full [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:rounded-lg [&_table]:border [&_table]:border-border [&_table]:border-separate [&_table]:border-spacing-0',
  '[&_thead]:bg-muted/80',
  '[&_th]:border-b [&_th]:border-r [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold [&_th:last-child]:border-r-0',
  '[&_td]:border-b [&_td]:border-r [&_td]:border-border/70 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td]:text-sm [&_td:last-child]:border-r-0',
  '[&_tbody_tr:last-child_td]:border-b-0',
);

const PRACTICE_PROBLEM_SELECTION_DECISION_ID = 'learn-practice-problem-selection';
const PRACTICE_PROBLEM_HELP_TIMEOUT_MS = 60_000;

function makeClientId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function miniLecturePromptForMessage(args: {
  messages: LearnMessage[];
  messageIndex: number;
  course: { name: string } | null;
}): MiniLecturePrompt | undefined {
  const message = args.messages[args.messageIndex];
  if (!message || message.role !== 'assistant' || message.transient || message.lectureDeck) {
    return message?.lecturePrompt;
  }
  if (message.lecturePrompt) return message.lecturePrompt;
  if (!args.course || !message.text.trim()) return undefined;

  const question = args.messages
    .slice(0, args.messageIndex)
    .reverse()
    .find((candidate) => candidate.role === 'user' && candidate.text.trim());
  if (!question) return undefined;

  const inferred = buildMiniLecturePrompt({
    question: question.text,
    answer: message.text,
    course: args.course,
  });
  return inferred
    ? {
        ...inferred,
        id: `mini-lecture-prompt-${message.id}`,
        createdAt: message.createdAt,
      }
    : undefined;
}

function learnMessageHasContent(message: LearnMessage): boolean {
  return Boolean(
    message.text.trim() ||
    message.attachments?.length ||
    message.plan ||
    message.progressProposal ||
    message.pendingAction ||
    message.lecturePrompt ||
    message.lectureDeck ||
    message.learningActions?.length ||
    message.artifacts?.length,
  );
}

function learnSessionIsBlank(messages: LearnMessage[]): boolean {
  return !messages.some(learnMessageHasContent);
}

function shouldDisplayPublicTrace(message: LearnMessage): boolean {
  if (!message.publicTrace?.length) return false;
  if (message.transient) return true;
  return message.publicTrace.some((step) => step.status === 'blocked');
}

function learnSessionUpdatedAtFromMessages(messages: LearnMessage[]): number | null {
  const messageTimes = messages
    .filter(learnMessageHasContent)
    .map((message) => message.createdAt)
    .filter((createdAt) => Number.isFinite(createdAt));
  if (!messageTimes.length) return null;
  return Math.max(...messageTimes);
}

function learnConversationSyncSignature(args: {
  key: string;
  title: string;
  messages: RemoteLearnMessagePayload[];
  deletedMessageIds: string[];
}) {
  return JSON.stringify({
    ...args,
    deletedMessageIds: [...args.deletedMessageIds].sort(),
  });
}

function remoteLearnMessagePayloadEqual(
  left: RemoteLearnMessagePayload | undefined,
  right: RemoteLearnMessagePayload,
): boolean {
  return Boolean(left) && JSON.stringify(left) === JSON.stringify(right);
}

function learnSessionScopedKey(userId: string, courseId: string, sessionId: string): string {
  return [userId, courseId, sessionId].map(encodeURIComponent).join(':');
}

function excludePendingDeletedLearnSessions(
  userId: string,
  courseId: string,
  sessions: LearnChatSession[],
  pendingDeletedSessionKeys: ReadonlySet<string>,
): LearnChatSession[] {
  return sessions.filter(
    (session) =>
      !pendingDeletedSessionKeys.has(learnSessionScopedKey(userId, courseId, session.id)),
  );
}

function normalizeLearnSessionTitle(text: string): string {
  const compact = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#*_`>\[\]()]/g, ' ')
    .replace(/[\/／]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const firstSentence = compact.split(/[。！？!?]/).find((part) => part.trim()) || compact;
  let title = firstSentence.trim();
  for (let index = 0; index < 4; index += 1) {
    const next = title
      .replace(/^(老师|ai|AI)[，,：:\s]*/i, '')
      .replace(/^(请帮我|可以帮我|麻烦你|帮我|帮忙|我想要|我想|请问|问一下)[，,：:\s]*/i, '')
      .trim();
    if (next === title) break;
    title = next;
  }
  if (!title) return '';
  return title.length > 24 ? `${title.slice(0, 24)}...` : title;
}

function learnSessionTitleFromMessages(messages: LearnMessage[], fallback: string): string {
  const userMessage = messages.find(
    (message) => message.role === 'user' && (message.text.trim() || message.attachments?.length),
  );
  if (userMessage?.text.trim()) {
    return normalizeLearnSessionTitle(userMessage.text) || fallback;
  }
  if (userMessage?.attachments?.length) return '图片问题';

  const actionMessage = messages.find((message) => message.plan || message.progressProposal);
  if (actionMessage?.plan?.title) {
    return normalizeLearnSessionTitle(actionMessage.plan.title) || fallback;
  }
  if (actionMessage?.progressProposal?.title) return actionMessage.progressProposal.title;

  const assistantMessage = messages.find(
    (message) => message.role === 'assistant' && message.text.trim(),
  );
  if (assistantMessage) {
    return normalizeLearnSessionTitle(assistantMessage.text) || fallback;
  }
  return fallback;
}

function isSyllabusDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function syllabusPlanningEvents(events: SyllabusCalendarEvent[]): SyllabusCalendarEvent[] {
  return events
    .filter((event) => event.title.trim() && isSyllabusDate(event.date) && event.kind !== 'holiday')
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

function progressSelectionFromSnapshot(snapshot: LearnerCourseSnapshot | null): string {
  if (!snapshot?.progressKnown) return '';
  if (snapshot.progressCheckpointKind === 'not_started') return PROGRESS_SELECTION_NOT_STARTED;
  if (snapshot.progressCheckpointKind === 'completed_all') return PROGRESS_SELECTION_COMPLETED_ALL;
  return snapshot.progressNotebookId || snapshot.currentNotebook?.id || '';
}

function orderedCourseNotebooks<
  T extends Pick<StageListItem, 'id' | 'name' | 'createdAt' | 'learningOrder'>,
>(notebooks: T[]): T[] {
  return orderCourseNotebooks(notebooks);
}

function progressLabelForSelection(selection: string, notebooks: StageListItem[]): string {
  if (selection === PROGRESS_SELECTION_NOT_STARTED) return '还没开始';
  if (selection === PROGRESS_SELECTION_COMPLETED_ALL) return '已学完整门课';
  const notebook = notebooks.find((item) => item.id === selection);
  return notebook ? `正在学习《${notebook.name}》` : '选择学习进度';
}

function progressCheckpointForSelection(
  selection: string,
): { kind: LearnerProgressCheckpointKind; notebookId?: string } | null {
  if (!selection) return null;
  if (selection === PROGRESS_SELECTION_NOT_STARTED) return { kind: 'not_started' };
  if (selection === PROGRESS_SELECTION_COMPLETED_ALL) return { kind: 'completed_all' };
  return { kind: 'notebook', notebookId: selection };
}

function messageText(message: UIMessage<ChatMessageMetadata>): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function latestAssistantText(messages: UIMessage<ChatMessageMetadata>[]): string {
  const assistant = messages
    .slice()
    .reverse()
    .find((message) => message.role === 'assistant' && !message.metadata?.progressOnly);
  return assistant ? messageText(assistant) : '';
}

function learnMessagesForCourseAnswerer(
  messages: LearnMessage[],
): UIMessage<ChatMessageMetadata>[] {
  const eligibleMessages = messages.filter(
    (message) =>
      !message.transient && (Boolean(message.text.trim()) || Boolean(message.attachments?.length)),
  );
  const latestCompressionIndex = eligibleMessages.findLastIndex((message) =>
    Boolean(message.contextCompression?.summary.trim()),
  );
  // Once a rolling summary exists, send its carrier plus only the verbatim
  // tail. Before the first compression, allow enough history to reach the
  // server-side budget trigger without growing request bodies indefinitely.
  const contextualMessages =
    latestCompressionIndex >= 0
      ? eligibleMessages.slice(latestCompressionIndex)
      : eligibleMessages.slice(-48);
  const latestAttachmentMessageIndex = contextualMessages.findLastIndex(
    (message) => message.role === 'user' && Boolean(message.attachments?.length),
  );

  return contextualMessages.map((message, index) => {
    const includeAttachmentContent = index === latestAttachmentMessageIndex;
    const attachmentParts =
      includeAttachmentContent && message.role === 'user'
        ? (message.attachments || [])
            .filter(
              (
                attachment,
              ): attachment is LearnImageAttachment & {
                dataUrl: string;
              } => attachment.mimeType.startsWith('image/') && Boolean(attachment.dataUrl),
            )
            .slice(0, 4)
            .map((attachment) => ({
              type: 'file' as const,
              url: attachment.dataUrl,
              mediaType: attachment.mimeType,
              filename: attachment.name,
            }))
        : [];
    const parts = [
      ...(message.text.trim()
        ? [
            {
              type: 'text' as const,
              text:
                message.text.length <= 12_000
                  ? message.text
                  : `${message.text.slice(0, 6_000)}\n\n…（单条历史消息中间部分已省略）…\n\n${message.text.slice(-6_000)}`,
            },
          ]
        : []),
      ...attachmentParts,
    ] as UIMessage<ChatMessageMetadata>['parts'];

    return {
      id: message.id,
      role: message.role,
      parts,
      metadata: {
        senderName: message.role === 'user' ? '你' : '课程老师',
        originalRole: message.role === 'user' ? 'user' : 'agent',
        createdAt: message.createdAt,
        attachments: message.attachments?.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
        })),
        contextCompression: message.contextCompression,
      },
    };
  });
}

function publicTraceFromCourseAnswererMessages(
  messages: UIMessage<ChatMessageMetadata>[],
  historicalMessageIds: Set<string>,
): LearnPublicTraceStep[] | undefined {
  const progressMessage = messages
    .slice()
    .reverse()
    .find(
      (message) =>
        message.role === 'assistant' &&
        !historicalMessageIds.has(message.id) &&
        Boolean(message.metadata?.publicProgressSteps?.length),
    );
  const steps = progressMessage?.metadata?.publicProgressSteps;
  if (!steps?.length) return undefined;
  return steps
    .filter((step) => step.status !== 'pending')
    .map((step) => ({
      id: `course-reply-${step.id}`,
      title: step.label,
      detail:
        step.description ||
        (step.status === 'active'
          ? progressMessage?.metadata?.statusText || '正在处理这一步。'
          : '这一步已完成。'),
      status: step.status === 'complete' ? 'done' : 'waiting',
      evidence: step.evidence,
    }));
}

function streamedCourseAnswerFromMessages(
  messages: UIMessage<ChatMessageMetadata>[],
  historicalMessageIds: Set<string>,
): {
  text: string;
  learningActions?: LearningAction[];
  publicTrace?: LearnPublicTraceStep[];
  contextCompression?: ChatContextCompression;
} | null {
  const assistantMessage = messages
    .slice()
    .reverse()
    .find(
      (message) =>
        message.role === 'assistant' &&
        !historicalMessageIds.has(message.id) &&
        !message.metadata?.progressOnly,
    );
  const publicTrace = publicTraceFromCourseAnswererMessages(messages, historicalMessageIds);
  if (!assistantMessage && !publicTrace?.length) return null;
  return {
    text: assistantMessage ? messageText(assistantMessage) : '',
    learningActions: assistantMessage?.metadata?.learningActions?.map((action) => ({
      ...action,
    })),
    publicTrace,
    contextCompression: assistantMessage?.metadata?.contextCompression,
  };
}

function normalizeRepeatedWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function collapseDuplicatedAssistantText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 320) return trimmed;

  const paragraphs = trimmed.split(/\n{2,}/).map((paragraph) => paragraph.trim());
  if (paragraphs.length >= 4 && paragraphs.length % 2 === 0) {
    const midpoint = paragraphs.length / 2;
    const firstHalf = normalizeRepeatedWhitespace(paragraphs.slice(0, midpoint).join('\n\n'));
    const secondHalf = normalizeRepeatedWhitespace(paragraphs.slice(midpoint).join('\n\n'));
    if (firstHalf && firstHalf === secondHalf) {
      return paragraphs.slice(0, midpoint).join('\n\n');
    }
  }

  const probe = normalizeRepeatedWhitespace(trimmed.slice(0, 260));
  if (probe.length >= 180) {
    const normalized = normalizeRepeatedWhitespace(trimmed);
    const repeatedAt = normalized.indexOf(probe, probe.length + 40);
    if (repeatedAt > 0) {
      return normalized.slice(0, repeatedAt).trim();
    }
  }

  return trimmed;
}

function normalizeLearnChatMarkdownSegment(text: string): string {
  return protectLearnChatAsciiDiagrams(text)
    .split(/(`[^`\n]*`)/g)
    .map((part) => {
      if (part.startsWith('`')) return part.replace(/\[blocked\]/gi, '');
      return normalizeLooseMathDelimiters(sanitizeLearnChatMarkdownText(part));
    })
    .join('');
}

function sanitizeLearnChatMarkdownText(text: string): string {
  return text
    .replace(/\[blocked\]/gi, '')
    .replace(/<(?=\/?[A-Za-z][A-Za-z0-9-]*(?:\s|>|\/>))/g, '&lt;')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function isLikelyLearnChatAsciiDiagramLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 180) return false;
  const backtickCount = trimmed.match(/`/g)?.length || 0;
  if (backtickCount > 0 && backtickCount % 2 === 0) return false;
  const candidate = trimmed.replace(/`/g, '');
  if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(candidate)) return false;
  if (candidate.startsWith('|') && candidate.endsWith('|')) return false;

  const hasPointerWord = /\b(?:head|tail|next|prev|node|nodes|null|none)\b/i.test(candidate);
  const hasStructureMark = /(?:\||->|<-|=>|<->|-->|—>|→|←|↔|⇒|⟶|⟵)/.test(candidate);
  const looksLikeDiagramText = /^[A-Za-z0-9_$.[\]{}()'"|:;,\s<>=+\-→←↔—–_]+$/.test(candidate);
  return hasPointerWord && hasStructureMark && looksLikeDiagramText;
}

function protectLearnChatAsciiDiagrams(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (!isLikelyLearnChatAsciiDiagramLine(line)) return line;
      const leading = line.match(/^\s*/)?.[0] || '';
      const trailing = line.match(/\s*$/)?.[0] || '';
      const diagram = repairLearnChatAsciiDiagramLine(line);
      if (!diagram) return line;
      const fence = diagram.includes('`') ? '``' : '`';
      const paddedDiagram = fence === '``' ? ` ${diagram} ` : diagram;
      return `${leading}${fence}${paddedDiagram}${fence}${trailing}`;
    })
    .join('\n');
}

function repairLearnChatAsciiDiagramLine(line: string): string {
  const diagram = line
    .trim()
    .replace(/\[blocked\]/gi, '')
    .replace(/`/g, '')
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .trim();
  const brokenNodeDiagram = diagram.match(/^(head\s*->\s*)?\[?([A-Za-z0-9_$]+)\s*\|\s*next$/i);
  if (brokenNodeDiagram) {
    const head = brokenNodeDiagram[2] || 'A';
    const prefix = brokenNodeDiagram[1] ? 'head -> ' : '';
    return `${prefix}[${head} | next -> B] -> [B | next -> C] -> [C | next -> None]`;
  }
  if (/^[A-Za-z0-9_$]+\s*\|\s*next$/i.test(diagram)) {
    const head = diagram.match(/^[A-Za-z0-9_$]+/)?.[0] || 'A';
    return `${head} | next -> B | next -> C | None`;
  }
  return diagram;
}

function normalizeCourseAssistantAnswer(text: string): string {
  const collapsed = collapseDuplicatedAssistantText(text);
  return collapsed
    .split(/(```[\s\S]*?```)/g)
    .map((part) => (part.startsWith('```') ? part : normalizeLearnChatMarkdownSegment(part)))
    .join('')
    .trim();
}

function normalizeAssistantMarkdown(text: string): string {
  return collapseDuplicatedAssistantText(text)
    .split(/(```[\s\S]*?```)/g)
    .map((part) => (part.startsWith('```') ? part : normalizeLearnChatMarkdownSegment(part)))
    .join('')
    .trim();
}

function buildNoCourseProblemBankAnswer(args: {
  course: CourseRecord;
  questionText: string;
  notebooks: StageListItem[];
  notebooksLoadState: ResourceLoadState;
}): string {
  const courseLabel = args.course.courseCode || args.course.name;
  const topic =
    args.questionText
      .replace(/给我|帮我|请|从题库|题库|选|挑|抽|找|道|题|。|，|,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40) || '这个主题';
  return [
    `${courseLabel} 这门课当前没有可用的课程题库，所以我不能假装“从题库里选 3 道”。`,
    '',
    args.notebooksLoadState.status === 'ready' || args.notebooksLoadState.status === 'empty'
      ? args.notebooks.length
        ? `课程资料库里有 ${args.notebooks.length} 份正文材料，但学习计划不会用资料临时补造「${topic}」题。`
        : `课程资料库也已确认为空，暂时没有可用于定位「${topic}」的材料。`
      : args.notebooks.length
        ? `当前已显示 ${args.notebooks.length} 份缓存资料，但资料库尚未完成核对；我不会据此判断全部课程材料。`
        : `课程资料状态尚未确认${args.notebooksLoadState.error ? `：${args.notebooksLoadState.error}` : ''}，因此这里不对资料库是否为空下结论。`,
    '',
    '请先导入或发布这门课的题库；题库可用后，我会逐题给出可点击的作答链接。',
  ].join('\n');
}

function buildProblemBankSelectionFailedAnswer(args: {
  course: CourseRecord;
  questionText: string;
  activeProblemCount: number;
}): string {
  const courseLabel = args.course.courseCode || args.course.name;
  const topic =
    args.questionText
      .replace(/我想|我要|我需要|帮我|请|练题目?|做题|刷题|练习|复习|题库|题目|：|:|。|，|,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || '这个主题';
  return [
    `${courseLabel} 当前有 ${args.activeProblemCount} 道可用题库题，但我没有选出严格适合「${topic}」的题。`,
    '我没有把这次请求降级成自生成练习，也没有为了凑数量混入相邻专题。',
    '如果你想放宽范围，可以直接说“范围放宽一点”；否则请先向题库补充并发布对应专题的题目。',
  ].join('\n\n');
}

function learnMessagesForPlanningIntent(messages: LearnMessage[]): LearnTurnMessage[] {
  return messages
    .slice(-8)
    .map((message) => ({
      role: message.role,
      text: message.text.trim().slice(0, 2200),
    }))
    .filter((message) => message.text.length > 0);
}

function classifyLearnTurnPlannerError(error: unknown): {
  message: string;
  blockedTitle: string;
  blockedDetail: string;
} {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '学习路由失败';
  if (
    /Cannot connect to API|Connect Timeout|timeout|ETIMEDOUT|ECONN|ENOTFOUND|fetch failed|network|rate limit|API key|Unauthorized|401|403|429|AI 路由模型连接超时|AI 路由模型不可用/i.test(
      rawMessage,
    )
  ) {
    return {
      message: 'AI 路由模型连接超时或不可用，暂时没有得到结构化学习决定',
      blockedTitle: 'AI 路由模型不可用',
      blockedDetail:
        '模型/API 调用没有成功完成；为了避免硬编码兜底误导，这次没有继续生成回复、计划或题目。',
    };
  }
  if (/review_plan must include|复习计划结构不完整|复习结构不完整/i.test(rawMessage)) {
    return {
      message: 'AI 返回的复习计划结构不完整',
      blockedTitle: '复习计划结构不合格',
      blockedDetail: '路由返回了复习计划意图，但缺少必要的学习目标、重点或自测结构，所以停止展示。',
    };
  }
  if (
    /AI semantic router failed to produce a valid decision|AI semantic router/i.test(rawMessage)
  ) {
    return {
      message: 'AI 路由没有返回合法的结构化学习决定',
      blockedTitle: '路由没有返回可执行结构',
      blockedDetail: '没有拿到合法的结构化学习决定，所以停止生成回复、计划或题目。',
    };
  }
  return {
    message: rawMessage,
    blockedTitle: '学习路由没有完成',
    blockedDetail: '这次学习路由没有成功完成，所以没有继续生成回复、计划或题目。',
  };
}

async function planLearnTurn(args: {
  question: string;
  messages: LearnMessage[];
  attachments?: LearnImageAttachment[];
  course: CourseRecord;
  snapshot: LearnerCourseSnapshot | null;
  calendarEvents: SyllabusCalendarEvent[];
  recentActivities?: StatusCalendarActivity[];
  recentPlans: PracticePlan[];
  problems: CourseProblemClientSummary[];
  /** When full problem list is deferred, content-state count keeps availability truthful. */
  problemBankActiveCountHint?: number;
  sourceUploads: CourseSourceUploadRecord[];
  resourceStates?: {
    notebooks: ResourceLoadStatus;
    problems: ResourceLoadStatus;
    sources: ResourceLoadStatus;
  };
  providerId: ProviderId;
  modelId: string;
  signal?: AbortSignal;
}): Promise<LearnTurnClientResponse | null> {
  const activeProblems = args.problems.filter((problem) => problem.status !== 'archived');
  const problemBankActiveCount = Math.max(
    activeProblems.length,
    Math.max(0, args.problemBankActiveCountHint ?? 0),
  );
  try {
    return await backendJson<LearnTurnClientResponse>('/api/learn/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(args.providerId === 'openai' && args.modelId
          ? { 'x-model': `openai:${args.modelId}` }
          : {}),
      },
      body: JSON.stringify({
        question: args.question,
        recentMessages: learnMessagesForPlanningIntent(args.messages),
        attachments: (args.attachments || []).map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
        })),
        courseId: args.course.id,
        courseName: args.course.name,
        courseCode: args.course.courseCode || undefined,
        hasSyllabus: syllabusPlanningEvents(args.calendarEvents).length > 0,
        progressKnown: Boolean(args.snapshot?.progressKnown),
        learnerSnapshot: args.snapshot,
        calendarEvents: args.calendarEvents.slice(0, 160).map((event) => ({
          id: event.id,
          title: event.title,
          rawText: event.rawText,
          kind: event.kind,
          date: event.date,
          sourceName: event.sourceName,
          origin: event.origin || 'syllabus',
          status: event.status,
          durationMinutes: event.durationMinutes,
        })),
        recentPlans: args.recentPlans.slice(0, 4).map((plan) => ({
          id: plan.id,
          title: plan.title,
          mode: plan.mode,
          targetConcepts: plan.targetConcepts,
          estimatedMinutes: plan.estimatedMinutes,
          status: plan.status,
        })),
        recentArtifacts: latestLearnArtifactsForTurn(args.messages, 12),
        recentActions: latestLearningActionsForTurn(args.messages, 10),
        recentActivities: (args.recentActivities || []).slice(0, 6).map((activity) => ({
          id: activity.id,
          source: activity.source,
          sourceId: activity.sourceId,
          title: activity.title,
          date: activity.date,
          meta: activity.meta,
          eventKind: activity.event?.kind,
          durationMinutes: activity.event?.durationMinutes,
          origin: activity.event?.origin,
          rawText: activity.event?.rawText,
        })),
        problemBank: {
          available: problemBankActiveCount > 0,
          activeCount: problemBankActiveCount,
          samples: activeProblems.slice(0, 8).map((problem) => ({
            id: problem.id,
            title: problem.title,
            notebookName: problem.notebookName,
            tags: problem.tags,
          })),
        },
        resourceStates: args.resourceStates ?? {
          notebooks: args.snapshot ? 'ready' : 'loading',
          problems: problemBankActiveCount > 0 ? 'ready' : 'empty',
          sources: args.sourceUploads.length > 0 ? 'ready' : 'empty',
        },
        sourceUploads: args.sourceUploads.slice(0, 12).map((source) => ({
          id: source.sourceHash,
          sourceHash: source.sourceHash,
          title: source.title,
          kind: source.kind,
          topic: source.topic,
          usageProfile: source.usageProfile,
          createdAt: source.createdAt,
          notebookIds: source.notebookIds,
          problemIds: source.problemIds,
          memoryIds: source.memoryIds,
          ragEntryIds: source.ragEntryIds,
          stats: source.stats,
        })),
      }),
      signal: args.signal,
    });
  } catch (error) {
    console.warn(
      '[learn] AI learn turn planner unavailable:',
      error instanceof Error ? error.message : error,
    );
    throw new Error(classifyLearnTurnPlannerError(error).message);
  }
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function learnAnswerModeLabel(mode?: LearnTurnClientResponse['answerMode']) {
  if (mode === 'client_activity_plan') return '学习活动计划';
  if (mode === 'client_practice_plan') return '题库练习';
  if (mode === 'action_only') return '工具操作';
  if (mode === 'course_answer') return '课程讲解';
  return '学习回应';
}

function publicTraceToolIds(response: LearnTurnClientResponse | null): string[] {
  const ids: string[] = [];
  const trace = response?.trace;
  const steps = Array.isArray(trace?.steps) ? trace.steps : [];
  const toolCalls = Array.isArray(trace?.toolCalls) ? trace.toolCalls : [];
  for (const step of steps) {
    const selectedToolIds = payloadRecord(step.metadata).selectedToolIds;
    if (Array.isArray(selectedToolIds)) ids.push(...selectedToolIds.map(String));
  }
  for (const call of toolCalls) {
    if (call.toolId) ids.push(call.toolId);
    const selectedToolIds = payloadRecord(call.metadata).selectedToolIds;
    if (Array.isArray(selectedToolIds)) ids.push(...selectedToolIds.map(String));
  }
  return Array.from(new Set(ids.filter(Boolean)));
}

function makePublicTraceStep(
  id: string,
  title: string,
  detail: string,
  evidence?: string[],
  status: LearnPublicTraceStep['status'] = 'done',
): LearnPublicTraceStep {
  return {
    id,
    title,
    detail,
    status,
    evidence: evidence?.filter(Boolean).slice(0, 3),
  };
}

function pendingPublicTraceForQuestion(question: string): LearnPublicTraceStep[] {
  return [
    makePublicTraceStep(
      'classify',
      '识别学习意图',
      `判断这次是知识点复习、刷题、课程讲解、考试准备、预习还是进度确认：${question.slice(0, 80)}`,
      undefined,
      'waiting',
    ),
    makePublicTraceStep(
      'context',
      '读取学习上下文',
      '查看学习记忆、课程进度、近期活动、课程日程和题库可用性。',
      undefined,
      'waiting',
    ),
    makePublicTraceStep(
      'route',
      '选择下一步动作',
      '按上下文决定生成知识点复习、题库练习、课程讲解交接或进度确认。',
      undefined,
      'waiting',
    ),
  ];
}

function pendingTeacherPublicTrace(): LearnPublicTraceStep[] {
  return [
    makePublicTraceStep(
      'teacher-access',
      '确认教师权限',
      '由服务端确认当前账号是这门课的 owner。',
      undefined,
      'waiting',
    ),
    makePublicTraceStep(
      'teacher-inventory',
      '读取课程资料',
      '等待服务端返回真实的笔记本、学生和 Hard Rule 数量。',
      undefined,
      'waiting',
    ),
    makePublicTraceStep(
      'teacher-evidence',
      '查阅笔记本依据',
      '智能体会根据问题选择目录、检索或具体笔记本正文。',
      undefined,
      'waiting',
    ),
  ];
}

function finalizePublicTraceSteps(
  steps?: LearnPublicTraceStep[],
): LearnPublicTraceStep[] | undefined {
  if (!steps?.length) return steps;
  let changed = false;
  const settled = steps.map((step) => {
    if (step.status !== 'waiting') return step;
    changed = true;
    return { ...step, status: 'done' as const };
  });
  return changed ? settled : steps;
}

function finalizeLearnMessagePublicTrace(message: LearnMessage): LearnMessage {
  if (message.transient) return message;
  const publicTrace = finalizePublicTraceSteps(message.publicTrace);
  if (publicTrace === message.publicTrace) return message;
  return { ...message, publicTrace };
}

function publicTraceForBlockedQuestion(
  question: string,
  blockedStep: LearnPublicTraceStep,
): LearnPublicTraceStep[] {
  return [
    ...(finalizePublicTraceSteps(pendingPublicTraceForQuestion(question).slice(0, 2)) || []),
    blockedStep,
  ];
}

function replaceLearnMessage(
  messages: LearnMessage[],
  messageId: string,
  replacement: LearnMessage,
): LearnMessage[] {
  const index = messages.findIndex((message) => message.id === messageId);
  // A missing placeholder means the request no longer belongs to the visible
  // conversation (for example, the learner switched sessions mid-request).
  // Appending here would leak the old answer into the newly active session.
  if (index < 0) return messages;
  return messages.map((message) => (message.id === messageId ? replacement : message));
}

function removeLearnMessage(messages: LearnMessage[], messageId: string): LearnMessage[] {
  return messages.filter((message) => message.id !== messageId);
}

function publicTraceFromLearnTurn(
  response: LearnTurnClientResponse | null,
  args: {
    question: string;
    progressKnown?: boolean;
    calendarCount?: number;
    problemCount?: number;
  },
): LearnPublicTraceStep[] {
  if (!response) return [];
  const steps: LearnPublicTraceStep[] = [];
  const toolIds = publicTraceToolIds(response);
  const focusTopics = (response.planningDecision?.focusTopics || [])
    .map((topic) => topic.trim())
    .filter(Boolean);
  const answerMode = response.answerMode || 'course_answer';
  const addStep = (step: LearnPublicTraceStep) => {
    if (!steps.some((item) => item.id === step.id)) steps.push(step);
  };

  addStep(
    makePublicTraceStep(
      'classify',
      '识别学习请求',
      focusTopics.length
        ? `识别为${learnAnswerModeLabel(answerMode)}，范围聚焦：${focusTopics.join('、')}。`
        : `识别为${learnAnswerModeLabel(answerMode)}：${args.question.slice(0, 80)}`,
    ),
  );

  if (toolIds.includes('search_memory')) {
    addStep(
      makePublicTraceStep(
        'memory',
        '查看学习记忆',
        args.progressKnown
          ? '读取当前进度、薄弱点、近期错题和下一步概念。'
          : '检查是否已有进度、薄弱点和做题记录；当前没有把未知进度当作阻塞。',
      ),
    );
  }
  if (toolIds.includes('search_schedule')) {
    addStep(
      makePublicTraceStep(
        'schedule',
        '检查课程日程',
        typeof args.calendarCount === 'number' && args.calendarCount > 0
          ? `查看 ${args.calendarCount} 个 syllabus/日历事项，寻找考试、作业和复习窗口。`
          : '检查 syllabus、考试、作业和近期活动；没有可用日程时不编造 deadline。',
      ),
    );
  }
  if (toolIds.includes('search_problem_bank')) {
    addStep(
      makePublicTraceStep(
        'problem-bank',
        '查看题库',
        typeof args.problemCount === 'number' && args.problemCount > 0
          ? `读取 ${args.problemCount} 道可用题，判断是否需要进入刷题/诊断。`
          : '检查是否有可用题库；没有题库时不会假装抽题。',
      ),
    );
  }
  if (toolIds.includes('resolve_fixed_review_workflow')) {
    addStep(
      makePublicTraceStep(
        'review-workflow',
        '确认复习方式',
        '识别到明确复习目标，但还需要先选择讲解、练题，还是两者都要。',
      ),
    );
  }
  if (toolIds.includes('search_course_materials')) {
    addStep(
      makePublicTraceStep(
        'materials',
        '查看课程资料',
        '检查资料库正文和上传来源，决定是否需要基于原文讲解。',
      ),
    );
  }
  if (toolIds.includes('plan_review')) {
    addStep(
      makePublicTraceStep(
        'plan-review',
        '生成复习路线',
        '把复习分成知识点梳理、自检和需要时的题库练习。',
      ),
    );
  }
  if (toolIds.includes('propose_practice_generation')) {
    addStep(
      makePublicTraceStep(
        'practice',
        '准备刷题方案',
        '根据题库可用性准备练习/小测 proposal，执行前需要学生确认。',
      ),
    );
  }
  if (toolIds.includes('answer_course_question')) {
    addStep(
      makePublicTraceStep('answerer', '交给课程讲解', '把证据、缺口和回答要求交给课程答疑 agent。'),
    );
  }

  const handoffs = Array.isArray(response.trace?.handoffs) ? response.trace?.handoffs : [];
  for (const handoff of handoffs.slice(0, 2)) {
    addStep(
      makePublicTraceStep(
        `handoff-${handoff.id || handoff.to || steps.length}`,
        '交接给下一个 agent',
        handoff.reasonSummary || '已把上下文、证据和行为要求交给下一个 agent。',
        handoff.missingEvidence?.length
          ? [`缺少证据：${handoff.missingEvidence.slice(0, 3).join('、')}`]
          : undefined,
      ),
    );
  }

  const artifacts = response.artifacts || [];
  const reviewPlan = artifacts.find((artifact) => artifact.kind === 'review_plan');
  if (reviewPlan) {
    const record = payloadRecord(reviewPlan);
    const tasks = Array.isArray(record.tasks) ? record.tasks : [];
    const focusPoints = Array.isArray(record.focusPoints) ? record.focusPoints : [];
    const selfChecks = Array.isArray(record.selfChecks) ? record.selfChecks : [];
    addStep(
      makePublicTraceStep(
        'review-artifact',
        '产出知识点复习',
        `${payloadString(record.title, '复习计划')}：${tasks.length || 1} 个任务，${focusPoints.length} 个重点，${selfChecks.length} 个自测。`,
      ),
    );
  }
  const calendarDraft = artifacts.find((artifact) => artifact.kind === 'calendar_draft');
  if (calendarDraft) {
    const items = payloadRecord(calendarDraft).items;
    addStep(
      makePublicTraceStep(
        'calendar-artifact',
        '产生日程草稿',
        `生成 ${Array.isArray(items) ? items.length : 0} 个可加入日历的活动。`,
      ),
    );
  }

  return steps.slice(0, 8);
}

function announceLearningMemoryUpdated(
  courseId: string,
  label: string,
  descriptionPrefix = '记忆已更新',
) {
  addMemoryActivity({
    courseId,
    title: '学习进度已更新',
    description: `学习进度：${label}。${descriptionPrefix}，之后我会按这个位置安排复习、预习和练习。`,
    status: 'completed',
    layer: 'study_memory',
    chips: ['课程', '进度'],
  });
}

function announceSyllabusScheduleUpdated(courseId: string, label: string) {
  const activityId = addMemoryActivity({
    courseId,
    title: '我正在整理课程安排',
    description: `我会记住「${label}」，之后提醒复习和规划任务时会参考它。`,
    status: 'writing_study_memory',
    layer: 'study_memory',
    chips: ['课程', '日程'],
  });
  window.setTimeout(() => {
    updateMemoryActivity(activityId, {
      title: '我已经记住这门课的安排',
      description: `「${label}」已经放进学习日历，之后计划会避开临近任务和考试。`,
      status: 'completed',
      layer: 'study_memory',
      chips: ['课程', '日程'],
    });
  }, 520);
}

function planIntro(plan: PracticePlan): string {
  if (isProblemSelectionPlan(plan)) return selectedPracticeIntro(plan);
  const noun = plan.mode === 'quiz' ? '测验' : '刷题计划';
  const concepts = plan.targetConcepts.slice(0, 3).join('、') || '当前课程重点';
  const count =
    plan.problemIds.length > 0
      ? `已从题库选择 ${plan.problemIds.length} 题`
      : '题库暂无可用题，本次不安排做题';
  const base = `我根据你当前的学习状态开了一个${noun}：聚焦 ${concepts}，预计 ${plan.estimatedMinutes} 分钟，${count}。`;
  const rationale = plan.evidence?.rationale?.slice(0, 2) || [];
  if (!rationale.length) return base;
  return `${base}\n\n为什么这样排：\n${rationale.map((line, index) => `${index + 1}. ${line}`).join('\n')}`;
}

function practiceStatusFromAttempt(status: unknown): PracticeAttemptStatus {
  if (status === 'passed' || status === 'partial' || status === 'failed') return status;
  if (status === 'error') return 'failed';
  return 'partial';
}

function defaultScoreFromPracticeStatus(status: PracticeAttemptStatus): number {
  if (status === 'passed') return 1;
  if (status === 'partial') return 0.5;
  return 0;
}

function normalizedPracticeAttemptScore(
  score: number | null | undefined,
  status: PracticeAttemptStatus,
): number {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    return defaultScoreFromPracticeStatus(status);
  }
  return Math.max(0, Math.min(1, score));
}

function practiceSessionPlanMeta(plan: PracticePlan, summary?: PracticeSessionSummary | null) {
  if (!summary || summary.attempted === 0) {
    return `${plan.estimatedMinutes} 分钟 · ${plan.problemIds.length || 0} 题`;
  }
  return summary.meta;
}

function buildLearnerChatContext(args: {
  snapshot: LearnerCourseSnapshot;
  state: LearnerCourseState;
  notebooks: StageListItem[];
  plans: PracticePlan[];
  syllabusEvents?: SyllabusCalendarEvent[];
}): NonNullable<CourseChatContext['learner']> {
  const orderedNotebooks = orderCourseNotebooks(args.notebooks);
  const today = localDayKey(new Date());
  const sortedSyllabusEvents = (args.syllabusEvents || [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const upcomingSyllabusEvents = sortedSyllabusEvents.filter((event) => event.date >= today);
  const learnerSyllabus =
    sortedSyllabusEvents.length > 0
      ? {
          importedCount: sortedSyllabusEvents.length,
          upcoming: upcomingSyllabusEvents.slice(0, 12).map((event) => ({
            title: event.title,
            kind: event.kind,
            date: event.date,
            sourceName: event.sourceName,
          })),
          nextAssignment: upcomingSyllabusEvents.find((event) => event.kind === 'assignment'),
          nextExam: upcomingSyllabusEvents.find((event) => event.kind === 'exam'),
          nextSchoolProgress: upcomingSyllabusEvents.find((event) => event.kind === 'progress'),
        }
      : undefined;

  return {
    progressKnown: args.snapshot.progressKnown,
    progressLabel: args.snapshot.progressLabel,
    progressPercent: args.snapshot.progressPercent,
    currentNotebookId: args.snapshot.currentNotebook?.id,
    currentNotebookName: args.snapshot.currentNotebook?.name,
    courseNotebookIds: orderedNotebooks.map((notebook) => notebook.id),
    courseNotebookNames: orderedNotebooks.map((notebook) => notebook.name),
    completedNotebookIds: args.state.completedNotebookIds,
    attemptedProblemCount: args.snapshot.attemptedProblemCount,
    totalProblemCount: args.snapshot.totalProblemCount,
    dueReviewCount: args.snapshot.dueReviewCount,
    weakConcepts: args.snapshot.weakConcepts,
    nextConcepts: args.snapshot.nextConcepts,
    recentQuestions: args.state.recentQuestions.slice(0, 5).map((question) => question.text),
    recentAttempts: args.state.recentProblemAttempts.slice(0, 8).map((attempt) => ({
      title: attempt.problemTitle,
      status: attempt.status,
      concepts: attempt.concepts,
    })),
    activePlans: args.plans.slice(0, 4).map((plan) => ({
      title: plan.title,
      mode: plan.mode,
      status: plan.status,
      targetConcepts: plan.targetConcepts,
    })),
    syllabus: learnerSyllabus
      ? {
          ...learnerSyllabus,
          nextAssignment: learnerSyllabus.nextAssignment
            ? {
                title: learnerSyllabus.nextAssignment.title,
                date: learnerSyllabus.nextAssignment.date,
              }
            : undefined,
          nextExam: learnerSyllabus.nextExam
            ? {
                title: learnerSyllabus.nextExam.title,
                date: learnerSyllabus.nextExam.date,
              }
            : undefined,
          nextSchoolProgress: learnerSyllabus.nextSchoolProgress
            ? {
                title: learnerSyllabus.nextSchoolProgress.title,
                date: learnerSyllabus.nextSchoolProgress.date,
              }
            : undefined,
        }
      : undefined,
  };
}

function mergePlans(local: PracticePlan[], remote: PracticePlan[]): PracticePlan[] {
  const byId = new Map<string, PracticePlan>();
  for (const plan of [...local, ...remote]) {
    const current = byId.get(plan.id);
    if (!current || plan.updatedAt > current.updatedAt) byId.set(plan.id, plan);
  }
  return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

function courseCodeMarkers(value: string): Set<string> {
  const markers = new Set<string>();
  const normalized = value.normalize('NFKC').toLowerCase();
  for (const match of normalized.matchAll(
    /(?:^|[^a-z0-9])([a-z]{2,8})[\s_-]*(\d{3}[a-z]?)(?=$|[^a-z0-9])/g,
  )) {
    markers.add(`${match[1]}${match[2]}`);
  }
  return markers;
}

function courseIdentityMarkers(course: CourseRecord): Set<string> {
  return courseCodeMarkers(
    [course.courseCode, course.name, ...course.tags].filter(Boolean).join(' '),
  );
}

function syllabusEventBelongsToCourse(
  event: SyllabusCalendarEvent,
  activeCourse: CourseRecord,
): boolean {
  if (event.courseId) return event.courseId === activeCourse.id;

  const activeMarkers = courseIdentityMarkers(activeCourse);
  if (activeMarkers.size === 0) return true;

  const eventMarkers = courseCodeMarkers(
    [event.title, event.sourceName, event.rawText, event.sourceColumn].filter(Boolean).join(' '),
  );
  if (eventMarkers.size === 0) return true;
  return Array.from(eventMarkers).some((marker) => activeMarkers.has(marker));
}

function localDayKey(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function calendarEventPatch(
  before: SyllabusCalendarEvent,
  after: SyllabusCalendarEvent,
): LearningCalendarEventPatch {
  const patch: LearningCalendarEventPatch = {};
  if (before.title !== after.title) patch.title = after.title;
  if (before.kind !== after.kind) patch.kind = after.kind;
  if (before.date !== after.date) patch.date = after.date;
  if (before.durationMinutes !== after.durationMinutes) {
    patch.durationMinutes = after.durationMinutes ?? null;
  }
  if (before.status !== after.status) patch.status = after.status ?? null;
  if (before.rawText !== after.rawText) patch.rawText = after.rawText ?? null;
  return patch;
}

function uniquePlanStrings(values: Array<string | undefined | null>, limit = 12): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = (value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized.slice(0, 80));
    if (output.length >= limit) break;
  }
  return output;
}

function practicePlanDisplayRationale(plan: PracticePlan): string[] {
  const raw = plan.evidence?.rationale || [];
  const topicText = normalizePracticeSelectionText(
    [
      ...plan.targetConcepts,
      ...(plan.evidence?.items || []).flatMap((item) => [
        item.title || '',
        item.reason || '',
        item.excerpt || '',
      ]),
    ].join(' '),
  );
  const isLinkedListPlan = /链表|linked\s*list|linkedlist/.test(topicText);
  const staleLinkedListLine =
    /traversal\/current pointer|insertion\/deletion|head\/next|linked\s*list|链表/i;
  const primaryConcept = plan.targetConcepts[0] || '当前复习点';
  const repaired = raw.map((line) =>
    !isLinkedListPlan && staleLinkedListLine.test(line)
      ? practicePlanTopicFocusLine(topicText, primaryConcept)
      : line,
  );
  return uniquePlanStrings(
    repaired.length
      ? repaired
      : [
          `优先选择题库里命中「${primaryConcept}」及相关标签/标题的题。`,
          practicePlanTopicFocusLine(topicText, primaryConcept),
        ],
    4,
  );
}

function repairStalePracticeSelectionMessageText(text: string): string {
  if (!text) return text;
  const staleLine = '先覆盖 traversal/current pointer，再覆盖 insertion/deletion 这类引用变更题。';
  if (!text.includes(staleLine)) return text;
  const normalized = normalizePracticeSelectionText(text);
  if (/链表|linked\s*list|linkedlist/.test(normalized)) return text;
  const replacement = practicePlanTopicFocusLine(normalized, '当前复习点');
  return text.replace(staleLine, replacement);
}

function problemBankSearchNoMatchText(search: LearnProblemBankSearchResult): string {
  const target = search.query || '这个主题';
  const excludedLine = search.excluded.length
    ? `我还排除了 ${search.excluded.length} 个相邻但不合适的候选，例如：${search.excluded
        .slice(0, 2)
        .map((item) => `「${item.title}」(${item.reason})`)
        .join('；')}。`
    : '';
  const gaps = search.gaps.length
    ? search.gaps.join('\n')
    : `题库里没有严格命中「${target}」的题。`;
  return [
    `我查了题库全文，但没有找到严格适合「${target}」的练习题。`,
    gaps,
    excludedLine,
    '我没有为了凑数量混入相邻专题。你可以放宽检索范围，或先向课程题库补充并发布对应题目。',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function selectedPracticeDifficultyMix(count: number): PracticePlan['difficultyMix'] {
  if (count <= 0) return { easy: 0, medium: 0, hard: 0 };
  if (count === 1) return { easy: 1, medium: 0, hard: 0 };
  if (count === 2) return { easy: 1, medium: 1, hard: 0 };
  const easy = 1;
  const hard = count >= 5 ? 1 : 0;
  return { easy, medium: Math.max(0, count - easy - hard), hard };
}

function isProblemSelectionPlan(plan: PracticePlan): boolean {
  return plan.evidence?.decisionId === PRACTICE_PROBLEM_SELECTION_DECISION_ID;
}

function selectedPracticeIntro(plan: PracticePlan): string {
  const concepts = plan.targetConcepts.slice(0, 3).join('、') || '当前复习点';
  const count = plan.problemIds.length;
  const rationale = practicePlanDisplayRationale(plan).slice(0, 3);
  if (count === 0) {
    return [
      `我检查了题库，但暂时没有找到适合「${concepts}」且可直接打开的题目。`,
      '这次不会临时编题；你可以放宽主题范围，或者先补充题库。',
    ].join('\n\n');
  }
  return [
    `我从题库里为你选好了 ${count} 道 ${concepts} 练习。`,
    rationale.length
      ? `\n为什么这么选：\n${rationale.map((line, index) => `${index + 1}. ${line}`).join('\n')}`
      : '',
    '\n可以直接点击每道题，或点「开始做题」按顺序练习。',
  ]
    .filter(Boolean)
    .join('\n');
}

function reviewPlanScheduleEvents(syllabusEvents: SyllabusCalendarEvent[]): Array<{
  id: string;
  title: string;
  date: string;
  kind: SyllabusEventKind;
  sourceName: string;
  notes?: string;
}> {
  return syllabusEvents.map((event) => {
    const notes = [event.week, event.sourceColumn, event.rawText]
      .filter((item): item is string => Boolean(item?.trim()))
      .join('\n');
    return {
      id: event.id,
      title: event.title,
      date: event.date,
      kind: event.kind,
      sourceName: event.sourceName,
      notes: notes || undefined,
    };
  });
}

function reviewQuestionDifficultyBucket(difficulty: string): keyof PracticePlan['difficultyMix'] {
  const normalized = difficulty.toLowerCase();
  if (/hard|advanced|challenge|difficult|困难|挑战|高/.test(normalized)) return 'hard';
  if (/easy|beginner|basic|基础|简单|入门|低/.test(normalized)) return 'easy';
  return 'medium';
}

function difficultyMixFromReviewQuestions(
  questions: TeachingReviewQuestionCandidate[],
  fallbackCount: number,
): PracticePlan['difficultyMix'] {
  const mix = { easy: 0, medium: 0, hard: 0 };
  for (const question of questions) {
    mix[reviewQuestionDifficultyBucket(question.difficulty)] += 1;
  }
  const selectedCount = mix.easy + mix.medium + mix.hard;
  if (selectedCount > 0) return mix;
  const count = Math.max(1, fallbackCount);
  const easy = Math.max(1, Math.round(count * 0.35));
  const hard = count >= 4 ? Math.max(1, Math.round(count * 0.15)) : 0;
  return { easy, medium: Math.max(0, count - easy - hard), hard };
}

async function requestTeachingReviewPlan(args: {
  courseId: string;
  prompt: string;
  conversationId: string;
  syllabusEvents: SyllabusCalendarEvent[];
  mode: PracticePlanMode;
  questionCount?: number;
}): Promise<TeachingReviewPlanResponse> {
  const questionCount = Math.max(
    1,
    Math.min(args.questionCount ?? (args.mode === 'quiz' ? 10 : 8), 20),
  );
  return backendJson<TeachingReviewPlanResponse>('/api/teaching/review-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetType: 'course',
      targetId: args.courseId,
      query: args.prompt,
      conversationId: args.conversationId,
      scheduleEvents: reviewPlanScheduleEvents(args.syllabusEvents),
      constraints: {
        today: localDayKey(new Date()),
        questionCount,
        totalMinutes: args.mode === 'quiz' ? Math.max(25, questionCount * 3) : 45,
        maxTasks: 4,
      },
    }),
  });
}

function practicePlanFromTeachingReviewDecision(args: {
  response: TeachingReviewPlanResponse;
  userId: string;
  course: CourseRecord;
  mode: PracticePlanMode;
  prompt: string;
  state: LearnerCourseState;
  snapshot: LearnerCourseSnapshot;
  targetCount?: number;
}): PracticePlan {
  const { decision } = args.response;
  const output = decision.output;
  const problemIds = uniquePlanStrings(
    [
      ...output.questionCandidates.map((question) => question.problemId),
      ...output.tasks.flatMap((task) => task.problemIds),
    ],
    args.targetCount ?? (args.mode === 'quiz' ? 10 : 8),
  );
  const targetConcepts = uniquePlanStrings(
    [
      ...decision.targetConcepts,
      ...output.tasks.flatMap((task) => task.concepts),
      ...output.questionCandidates.flatMap((question) => question.tags),
      ...args.snapshot.weakConcepts,
      ...args.snapshot.nextConcepts,
    ],
    6,
  );
  const evidenceIdSet = new Set(
    [
      ...output.tasks.flatMap((task) => task.evidenceIds),
      ...output.questionCandidates.flatMap((question) => question.evidenceIds),
    ].filter(Boolean),
  );
  const evidenceItems = decision.evidence.items
    .filter((item) => evidenceIdSet.size === 0 || evidenceIdSet.has(item.id))
    .slice(0, 14)
    .map((item) => ({
      id: item.id,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      title: item.title,
      reason: item.reason,
      excerpt: item.excerpt,
    }));
  const now = Date.now();
  const concepts = targetConcepts.length ? targetConcepts : ['课程综合复习'];
  const title =
    args.mode === 'quiz'
      ? `${args.course.courseCode || args.course.name} 证据化小测`
      : `${concepts.slice(0, 2).join(' + ')} 复习计划`;

  return savePracticePlan({
    version: 1,
    id: makeClientId(args.mode === 'quiz' ? 'quiz' : 'practice'),
    userId: args.userId || 'anonymous',
    courseId: args.course.id,
    courseName: args.course.name,
    mode: args.mode,
    title,
    targetConcepts: concepts,
    problemIds,
    questions: output.questionCandidates
      .filter((question) => problemIds.includes(question.problemId))
      .map((question) => ({
        problemId: question.problemId,
        title: question.title,
        href:
          question.href ||
          `/course/${encodeURIComponent(args.course.id)}/problem-bank/${encodeURIComponent(question.problemId)}`,
        reason: question.reason,
        difficulty: question.difficulty,
        tags: question.tags,
      })),
    estimatedMinutes:
      output.estimatedMinutes || (args.mode === 'quiz' ? Math.max(15, problemIds.length * 3) : 45),
    difficultyMix: difficultyMixFromReviewQuestions(output.questionCandidates, problemIds.length),
    createdFrom: {
      currentNotebookId: args.snapshot.currentNotebook?.id || args.state.currentNotebookId,
      currentNotebookName: args.snapshot.currentNotebook?.name || args.state.currentSectionLabel,
      weakPoints: args.snapshot.weakConcepts,
      recentAttemptProblemIds: uniquePlanStrings(
        args.state.recentProblemAttempts.map((attempt) => attempt.problemId),
        8,
      ),
      prompt: args.prompt.trim().slice(0, 600),
    },
    status: 'active',
    createdAt: now,
    updatedAt: now,
    evidence: {
      decisionId: decision.id,
      rationale: uniquePlanStrings(
        [...decision.userFacingRationale, ...output.rationale, output.summary],
        8,
      ),
      gaps: uniquePlanStrings(
        [
          ...output.evidenceGaps,
          ...decision.evidence.gaps.map((gap) => `${gap.reason} ${gap.fallback}`),
        ],
        4,
      ),
      items: evidenceItems,
    },
  });
}

function syllabusEventTone(kind: SyllabusEventKind): string {
  if (kind === 'assignment') return 'bg-sky-500';
  if (kind === 'exam') return 'bg-rose-500';
  if (kind === 'progress') return 'bg-amber-500';
  if (kind === 'tutorial') return 'bg-violet-500';
  if (kind === 'holiday') return 'bg-emerald-500';
  return 'bg-slate-400';
}

function syllabusEventLabel(kind: SyllabusEventKind): string {
  if (kind === 'assignment') return '作业';
  if (kind === 'exam') return '考试';
  if (kind === 'progress') return '进度';
  if (kind === 'tutorial') return 'Tutorial';
  if (kind === 'holiday') return '假期';
  return '事项';
}

function scheduleEventLabel(kind: SyllabusEventKind, isResearchCourse: boolean): string {
  const options = isResearchCourse ? RESEARCH_EVENT_KIND_OPTIONS : SYLLABUS_EVENT_KIND_OPTIONS;
  return options.find((option) => option.value === kind)?.label || syllabusEventLabel(kind);
}

function buildCalendarActivityStartText(args: {
  event: SyllabusCalendarEvent;
  course: CourseRecord | null;
  isResearchCourse: boolean;
}): string {
  const eventLabel = scheduleEventLabel(args.event.kind, args.isResearchCourse);
  const duration = args.event.durationMinutes ? ` · ${args.event.durationMinutes} 分钟` : '';
  const source = args.event.rawText ? `\n依据：${args.event.rawText}` : '';
  const courseLabel = args.course?.courseCode || args.course?.name || '这门课';
  if (args.isResearchCourse) {
    return `开始最近活动：${args.event.title}\n\n${args.event.date} · ${eventLabel}${duration}${source}\n\n建议这次先这样推进：\n1. 用 5 分钟明确这次要产出的东西。\n2. 用主要时间完成活动本身，不重新规划。\n3. 结束时记录一个结果或阻塞点，方便下次接着推进。`;
  }
  return `开始最近活动：${args.event.title}\n\n${args.event.date} · ${eventLabel}${duration} · ${courseLabel}${source}\n\n建议这次先这样学：\n1. 用 5 分钟回看相关定义或例题。\n2. 用主要时间完成这项活动本身，不重新生成计划。\n3. 最后记录一个错因、一个还不稳的点，之后我可以据此更新薄弱点。`;
}

function activeActivityArtifactFromEvent(args: {
  event: SyllabusCalendarEvent;
  course: CourseRecord | null;
}): Extract<LearnArtifact, { kind: 'active_activity' }> {
  return {
    kind: 'active_activity',
    id: makeClientId('active-activity'),
    activityId: args.event.id,
    title: args.event.title,
    date: args.event.date,
    source: 'calendar',
    sourceId: args.event.id,
    courseId: args.course?.id,
    courseCode: args.course?.courseCode,
    courseName: args.course?.name,
    eventKind: args.event.kind,
    durationMinutes: args.event.durationMinutes,
    origin: args.event.origin || 'syllabus',
    rawText: args.event.rawText || undefined,
    startedAt: Date.now(),
  };
}

function inferSyllabusEventKind(line: string): SyllabusEventKind {
  if (/midterm|final|exam|test|quiz|考试|期中|期末|测验/i.test(line)) return 'exam';
  if (/tutorial|two-stage|workshop|activity|discussion|辅导|习题课/i.test(line)) return 'tutorial';
  if (/holiday|break|closed|no class|no lecture|假期|放假|停课/i.test(line)) return 'holiday';
  if (
    /assignment|homework|project|paper|essay|report|lab|problem set|pset|due|deadline|作业|项目|论文|报告|截止/i.test(
      line,
    )
  ) {
    return 'assignment';
  }
  if (
    /week|lecture|reading|chapter|module|unit|topic|第.+周|周进度|进度|阅读|章节|单元|主题/i.test(
      line,
    )
  ) {
    return 'progress';
  }
  return 'other';
}

function parseSyllabusDate(
  line: string,
  fallbackYear: number,
): { key: string; raw: string } | null {
  const iso = line.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
  if (iso) {
    return {
      key: localDayKey(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))),
      raw: iso[0],
    };
  }

  const numeric = line.match(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])(?:\/(20\d{2}))?\b/);
  if (numeric) {
    return {
      key: localDayKey(
        new Date(Number(numeric[3] || fallbackYear), Number(numeric[1]) - 1, Number(numeric[2])),
      ),
      raw: numeric[0],
    };
  }

  const monthNames =
    'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
  const named = line.match(
    new RegExp(`\\b(${monthNames})\\.?\\s+(0?[1-9]|[12]\\d|3[01])(?:,?\\s*(20\\d{2}))?\\b`, 'i'),
  );
  if (named) {
    const monthIndex = [
      'jan',
      'feb',
      'mar',
      'apr',
      'may',
      'jun',
      'jul',
      'aug',
      'sep',
      'oct',
      'nov',
      'dec',
    ].findIndex((prefix) => named[1].toLowerCase().startsWith(prefix));
    return {
      key: localDayKey(new Date(Number(named[3] || fallbackYear), monthIndex, Number(named[2]))),
      raw: named[0],
    };
  }

  const chinese = line.match(/\b(20\d{2})?年?\s*(0?[1-9]|1[0-2])月\s*(0?[1-9]|[12]\d|3[01])日?\b/);
  if (chinese) {
    return {
      key: localDayKey(
        new Date(Number(chinese[1] || fallbackYear), Number(chinese[2]) - 1, Number(chinese[3])),
      ),
      raw: chinese[0],
    };
  }

  return null;
}

function parseSyllabusEventsFromText(
  text: string,
  sourceName: string,
  fallbackYear = new Date().getFullYear(),
): SyllabusCalendarEvent[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 6)
    .slice(0, 500);
  const seen = new Set<string>();
  const events: SyllabusCalendarEvent[] = [];
  for (const line of lines) {
    const parsedDate = parseSyllabusDate(line, fallbackYear);
    if (!parsedDate) continue;
    const title =
      line
        .replace(parsedDate.raw, ' ')
        .replace(/^[-*•\d.)\s]+/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'Syllabus 事项';
    const kind = inferSyllabusEventKind(line);
    const dedupeKey = `${parsedDate.key}:${kind}:${title.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    events.push({
      id: makeClientId('syllabus-event'),
      title,
      kind,
      date: parsedDate.key,
      sourceName,
      createdAt: Date.now(),
    });
  }
  return events.slice(0, 80);
}

function addCalendarDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function validDraftDate(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? value.trim()
    : undefined;
}

function learnCalendarDraftItemFromRecord(
  raw: Record<string, unknown>,
  fallbackIndex = 0,
): LearnCalendarDraftItem | null {
  const title =
    payloadString(raw.title) ||
    payloadString(raw.label) ||
    payloadString(raw.summary) ||
    `学习安排 ${fallbackIndex + 1}`;
  if (!title.trim()) return null;
  const duration =
    typeof raw.durationMinutes === 'number' && Number.isFinite(raw.durationMinutes)
      ? Math.max(5, Math.round(raw.durationMinutes))
      : undefined;
  return {
    id: payloadString(raw.id) || undefined,
    eventId: payloadString(raw.eventId) || undefined,
    title: title.slice(0, 120),
    date: validDraftDate(raw.date) || validDraftDate(raw.day),
    start: payloadString(raw.start) || undefined,
    durationMinutes: duration,
    courseId: payloadString(raw.courseId) || undefined,
    reason: payloadString(raw.reason) || payloadString(raw.summary) || undefined,
  };
}

function normalizeAnswerEvidenceSource(raw: unknown): LearnAnswerEvidenceSource | null {
  const record = payloadRecord(raw);
  const title = payloadString(record.title) || payloadString(record.sourceId) || '证据来源';
  if (!title.trim()) return null;
  const sourceType = payloadString(record.sourceType);
  return {
    sourceType:
      sourceType === 'notebook' ||
      sourceType === 'memory' ||
      sourceType === 'problem_bank' ||
      sourceType === 'calendar' ||
      sourceType === 'web' ||
      sourceType === 'user' ||
      sourceType === 'system'
        ? sourceType
        : 'source',
    id: payloadString(record.id) || undefined,
    sourceId: payloadString(record.sourceId) || undefined,
    notebookId: payloadString(record.notebookId) || null,
    title: title.slice(0, 160),
    previewText:
      payloadString(record.previewText) ||
      payloadString(record.renderedText).slice(0, 900) ||
      payloadString(record.originalText).slice(0, 900) ||
      undefined,
    score: typeof record.score === 'number' ? record.score : undefined,
    metadata: payloadRecord(record.metadata),
  };
}

function normalizeLearnArtifact(raw: unknown): LearnArtifact | null {
  const record = payloadRecord(raw);
  const kind = payloadString(record.kind);
  const id = payloadString(record.id) || makeClientId('artifact');

  if (kind === 'activity_plan') {
    const title = payloadString(record.title) || '学习活动计划';
    const planType = payloadString(record.planType);
    const tasks = Array.isArray(record.tasks)
      ? record.tasks
          .map((task) => payloadRecord(task))
          .map((task, index) => {
            const taskKind = payloadString(task.kind);
            const normalizedKind: LearnActivityPlanTask['kind'] =
              taskKind === 'review' ||
              taskKind === 'preview' ||
              taskKind === 'practice' ||
              taskKind === 'reading' ||
              taskKind === 'reflection' ||
              taskKind === 'catch_up' ||
              taskKind === 'other'
                ? taskKind
                : undefined;
            return {
              title: payloadString(task.title) || `活动 ${index + 1}`,
              kind: normalizedKind,
              concepts: Array.isArray(task.concepts)
                ? task.concepts
                    .map((item) => String(item))
                    .filter(Boolean)
                    .slice(0, 8)
                : undefined,
              minutes: typeof task.minutes === 'number' ? task.minutes : undefined,
              reason: payloadString(task.reason) || undefined,
            };
          })
          .filter((task) => task.title)
          .slice(0, 16)
      : [];
    const calendarDraftItems = Array.isArray(record.calendarDraftItems)
      ? record.calendarDraftItems
          .map((item, index) => learnCalendarDraftItemFromRecord(payloadRecord(item), index))
          .filter((item): item is LearnCalendarDraftItem => Boolean(item))
      : undefined;
    const evidence = Array.isArray(record.evidence)
      ? record.evidence
          .map((source) => normalizeAnswerEvidenceSource(source))
          .filter(
            (source): source is NonNullable<ReturnType<typeof normalizeAnswerEvidenceSource>> =>
              Boolean(source),
          )
          .slice(0, 12)
      : undefined;
    const rawScope = payloadRecord(record.scope);
    const scope = rawScope
      ? {
          label: payloadString(rawScope.label) || undefined,
          startDate: payloadString(rawScope.startDate) || undefined,
          endDate: payloadString(rawScope.endDate) || undefined,
          eventIds: Array.isArray(rawScope.eventIds)
            ? rawScope.eventIds
                .map((item) => String(item))
                .filter(Boolean)
                .slice(0, 80)
            : undefined,
          rationale: payloadString(rawScope.rationale) || undefined,
        }
      : undefined;
    if (!tasks.length && !calendarDraftItems?.length) return null;
    return {
      kind,
      id,
      title,
      planType:
        planType === 'preview' || planType === 'study' || planType === 'catch_up'
          ? planType
          : 'review',
      tasks,
      calendarDraftItems,
      evidence,
      scope,
    };
  }

  if (kind === 'calendar_draft') {
    const items = Array.isArray(record.items)
      ? record.items
          .map((item, index) => learnCalendarDraftItemFromRecord(payloadRecord(item), index))
          .filter((item): item is LearnCalendarDraftItem => Boolean(item))
      : [];
    if (!items.length) return null;
    return {
      kind,
      id,
      title: payloadString(record.title) || '日历草稿',
      items,
      sourceArtifactId: payloadString(record.sourceArtifactId) || undefined,
    };
  }

  if (kind === 'active_activity') {
    const title = payloadString(record.title);
    const date = payloadString(record.date);
    if (!title || !date) return null;
    const source = payloadString(record.source);
    const eventKind = payloadString(record.eventKind);
    const origin = payloadString(record.origin);
    return {
      kind,
      id,
      activityId: payloadString(record.activityId) || payloadString(record.sourceId) || id,
      title,
      date,
      source: source === 'plan' || source === 'manual' ? source : 'calendar',
      sourceId: payloadString(record.sourceId) || undefined,
      courseId: payloadString(record.courseId) || undefined,
      courseCode: payloadString(record.courseCode) || undefined,
      courseName: payloadString(record.courseName) || undefined,
      eventKind:
        eventKind === 'assignment' ||
        eventKind === 'exam' ||
        eventKind === 'progress' ||
        eventKind === 'tutorial' ||
        eventKind === 'holiday' ||
        eventKind === 'other'
          ? eventKind
          : undefined,
      durationMinutes:
        typeof record.durationMinutes === 'number' ? record.durationMinutes : undefined,
      origin:
        origin === 'syllabus' ||
        origin === 'ai_plan' ||
        origin === 'manual' ||
        origin === 'practice' ||
        origin === 'exam_prep'
          ? origin
          : undefined,
      rawText: payloadString(record.rawText) || undefined,
      startedAt: typeof record.startedAt === 'number' ? record.startedAt : undefined,
    };
  }

  if (kind === 'image_prompt_draft') {
    const prompt = payloadString(record.prompt);
    if (!prompt) return null;
    const aspectRatio = payloadString(record.aspectRatio);
    return {
      kind,
      id,
      prompt,
      aspectRatio:
        aspectRatio === '16:9' ||
        aspectRatio === '4:3' ||
        aspectRatio === '1:1' ||
        aspectRatio === '9:16'
          ? aspectRatio
          : undefined,
      sourceQuestion: payloadString(record.sourceQuestion) || undefined,
      imageUrl: payloadString(record.imageUrl) || undefined,
      width: typeof record.width === 'number' ? record.width : undefined,
      height: typeof record.height === 'number' ? record.height : undefined,
    };
  }

  if (kind === 'web_search_result') {
    const query = payloadString(record.query);
    if (!query) return null;
    const sources = Array.isArray(record.sources)
      ? record.sources
          .map((source) => payloadRecord(source))
          .map((source) => ({
            title: payloadString(source.title) || payloadString(source.url) || '网页来源',
            url: payloadString(source.url),
            content: payloadString(source.content) || undefined,
            score: typeof source.score === 'number' ? source.score : undefined,
          }))
          .filter((source) => source.url)
          .slice(0, 8)
      : [];
    return {
      kind,
      id,
      query,
      sources,
      answer: payloadString(record.answer) || undefined,
      usedFor: payloadString(record.usedFor) || undefined,
    };
  }

  if (kind === 'memory_candidate') {
    const summary = payloadString(record.summary);
    const memoryType = payloadString(record.memoryType);
    if (!summary) return null;
    return {
      kind,
      id,
      memoryType:
        memoryType === 'mastery' ||
        memoryType === 'progress' ||
        memoryType === 'preference' ||
        memoryType === 'correction' ||
        memoryType === 'next_step'
          ? memoryType
          : 'weakness',
      summary,
      evidence: Array.isArray(record.evidence)
        ? record.evidence
            .map((item) => String(item))
            .filter(Boolean)
            .slice(0, 8)
        : undefined,
    };
  }

  if (kind === 'answer_evidence') {
    const sources = Array.isArray(record.sources)
      ? record.sources
          .map((source) => normalizeAnswerEvidenceSource(source))
          .filter((source): source is LearnAnswerEvidenceSource => Boolean(source))
          .slice(0, 16)
      : [];
    if (!sources.length) return null;
    return {
      kind,
      id,
      title: payloadString(record.title) || undefined,
      usedFor: payloadString(record.usedFor) || undefined,
      sources,
    };
  }

  if (kind === 'review_plan') {
    const title = payloadString(record.title) || '复习计划';
    const learningGoal = payloadString(record.learningGoal);
    const tasks = Array.isArray(record.tasks)
      ? record.tasks
          .map((task) => payloadRecord(task))
          .map((task, index) => ({
            title: payloadString(task.title) || `任务 ${index + 1}`,
            concepts: Array.isArray(task.concepts)
              ? task.concepts
                  .map((item) => String(item))
                  .filter(Boolean)
                  .slice(0, 8)
              : undefined,
            minutes: typeof task.minutes === 'number' ? task.minutes : undefined,
            reason: payloadString(task.reason) || undefined,
          }))
          .filter((task) => task.title)
          .slice(0, 12)
      : [];
    const calendarDraftItems = Array.isArray(record.calendarDraftItems)
      ? record.calendarDraftItems
          .map((item, index) => learnCalendarDraftItemFromRecord(payloadRecord(item), index))
          .filter((item): item is LearnCalendarDraftItem => Boolean(item))
      : undefined;
    const focusPoints = Array.isArray(record.focusPoints)
      ? record.focusPoints
          .map((item) => payloadRecord(item))
          .map((item) => ({
            title: payloadString(item.title),
            explanation: payloadString(item.explanation),
            checkQuestion: payloadString(item.checkQuestion),
          }))
          .filter((item) => item.title || item.explanation || item.checkQuestion)
          .slice(0, 8)
      : undefined;
    const selfChecks = Array.isArray(record.selfChecks)
      ? record.selfChecks
          .map((item) => payloadRecord(item))
          .map((item) => {
            const difficulty = payloadString(item.difficulty);
            const normalizedDifficulty: 'warmup' | 'core' | 'stretch' | undefined =
              difficulty === 'warmup' || difficulty === 'core' || difficulty === 'stretch'
                ? difficulty
                : undefined;
            return {
              question: payloadString(item.question),
              expectedAnswer: payloadString(item.expectedAnswer),
              concept: payloadString(item.concept),
              difficulty: normalizedDifficulty,
            };
          })
          .filter((item) => item.question || item.expectedAnswer)
          .slice(0, 8)
      : undefined;
    const rawPracticeBridge = payloadRecord(record.practiceBridge);
    const practiceProblemIds = Array.isArray(rawPracticeBridge.problemIds)
      ? rawPracticeBridge.problemIds
          .map((item) => String(item))
          .filter(Boolean)
          .slice(0, 12)
      : [];
    // Parse the legacy field through the artifact schema, but never surface it as executable
    // practice. Current review plans may only bridge to real problem-bank IDs.
    const practiceGeneratedPrompts: string[] = [];
    const practiceBridge =
      payloadString(rawPracticeBridge.title) ||
      payloadString(rawPracticeBridge.summary) ||
      practiceProblemIds.length ||
      practiceGeneratedPrompts.length
        ? {
            title: payloadString(rawPracticeBridge.title) || '练习衔接',
            summary: payloadString(rawPracticeBridge.summary),
            problemIds: practiceProblemIds,
            generatedPrompts: practiceGeneratedPrompts,
          }
        : undefined;
    const nextSteps = Array.isArray(record.nextSteps)
      ? record.nextSteps
          .map((item) => String(item))
          .filter(Boolean)
          .slice(0, 6)
      : undefined;
    if (!tasks.length && !calendarDraftItems?.length) return null;
    return {
      kind,
      id,
      title,
      learningGoal: learningGoal || undefined,
      tasks,
      calendarDraftItems,
      focusPoints,
      selfChecks,
      practiceBridge,
      nextSteps,
    };
  }

  return null;
}

function answerEvidenceArtifactFromCourseContext(args: {
  courseContext?: CourseChatContext;
  question: string;
}): Extract<LearnArtifact, { kind: 'answer_evidence' }> | null {
  const memory = args.courseContext?.layeredMemory;
  if (!memory) return null;
  const sources: LearnAnswerEvidenceSource[] = [];

  for (const source of memory.sourceEvidence || []) {
    const sourcePreview = (source.renderedText || source.originalText || '').trim();
    if (
      /学生消息|student message/i.test(source.title || '') ||
      /助手回复|assistant reply/i.test(source.title || '') ||
      /^学生消息[:：]/.test(sourcePreview) ||
      /^助手回复[:：]/.test(sourcePreview)
    ) {
      continue;
    }
    sources.push({
      sourceType: source.sourceType === 'problem' ? 'problem_bank' : 'source',
      id: source.id,
      sourceId: source.sourceId,
      notebookId: source.notebookId ?? null,
      title: source.title || '原文证据',
      previewText: sourcePreview.slice(0, 900),
      score: typeof source.score === 'number' ? source.score : undefined,
      metadata: {
        ...(source.metadata || {}),
        evidenceType: source.sourceType,
      },
    });
  }

  for (const match of memory.knowledgeMatches || []) {
    sources.push({
      sourceType: 'problem_bank',
      id: match.id,
      title: match.title || '题库匹配',
      previewText: (match.text || '').trim().slice(0, 700),
      metadata: match.metadata || {},
    });
  }

  for (const match of memory.semanticMatches || []) {
    sources.push({
      sourceType: 'memory',
      id: match.id,
      title: match.title || '语义记忆',
      previewText: (match.summary || match.text || '').trim().slice(0, 700),
      metadata: match.source ? { source: match.source } : undefined,
    });
  }

  for (const cache of memory.knowledgeCache || []) {
    sources.push({
      sourceType:
        cache.sourceType === 'problem' || cache.sourceType === 'problem_bank'
          ? 'problem_bank'
          : 'source',
      id: cache.id,
      sourceId: cache.sourceId,
      notebookId: cache.notebookId ?? null,
      title: cache.title || '知识缓存',
      previewText: (cache.previewText || '').trim().slice(0, 700),
      metadata: {
        ...payloadRecord(cache.metadata),
        sourceType: cache.sourceType,
        courseId: cache.courseId,
        hitCount: cache.hitCount,
        lastAccessedAt: cache.lastAccessedAt,
      },
    });
  }

  const deduped = sources.filter(
    (source, index, all) =>
      all.findIndex(
        (item) =>
          item.sourceType === source.sourceType &&
          (item.id || item.sourceId || item.title) ===
            (source.id || source.sourceId || source.title),
      ) === index,
  );
  if (!deduped.length) return null;
  return {
    kind: 'answer_evidence',
    id: makeClientId('answer-evidence'),
    title: '本次回答证据',
    usedFor: args.question.slice(0, 160),
    sources: deduped.slice(0, 16),
  };
}

function answerEvidenceArtifactFromServerSummaries(args: {
  evidence: CourseChatEvidenceSummary[];
  question: string;
}): Extract<LearnArtifact, { kind: 'answer_evidence' }> | null {
  if (!args.evidence.length) return null;
  const sources: LearnAnswerEvidenceSource[] = args.evidence.map((item) => {
    const sourceType: LearnAnswerEvidenceSource['sourceType'] =
      item.origin === 'problem_bank' || item.sourceType === 'problem'
        ? 'problem_bank'
        : item.origin === 'course_source' ||
            /(?:source|document|markdown|upload)/i.test(item.sourceType)
          ? 'source'
          : 'memory';
    return {
      sourceType,
      id: item.id,
      sourceId: item.sourceId,
      notebookId: item.notebookId ?? null,
      title: item.title,
      previewText: item.excerpt,
      score: item.score,
      metadata: {
        origin: item.origin,
        sourceType: item.sourceType,
        courseId: item.courseId,
        ...(item.sourceHash ? { sourceHash: item.sourceHash } : {}),
      },
    };
  });
  return {
    kind: 'answer_evidence',
    id: makeClientId('answer-evidence'),
    title: '本次回答证据',
    usedFor: args.question.slice(0, 160),
    sources: sources.slice(0, 16),
  };
}

function practicePlanCalendarDraftItems(plan: PracticePlan): LearnCalendarDraftItem[] {
  if (isProblemSelectionPlan(plan)) return [];
  const concepts = plan.targetConcepts.length ? plan.targetConcepts : [plan.title];
  const count = Math.min(7, Math.max(1, concepts.length));
  const minutes = Math.max(20, Math.ceil(plan.estimatedMinutes / count));
  return concepts.slice(0, count).map((concept, index) => ({
    id: makeClientId('calendar-draft-item'),
    title: `${plan.mode === 'quiz' ? '小测' : '练习'}：${concept}`,
    date: localDayKey(addCalendarDays(new Date(), index)),
    durationMinutes: minutes,
    courseId: plan.courseId,
    reason: `来自计划「${plan.title}」`,
  }));
}

function nextStudyWeekStart(referenceDate = new Date()): Date {
  const next = new Date(referenceDate);
  next.setHours(12, 0, 0, 0);
  const daysUntilMonday = (8 - next.getDay()) % 7;
  next.setDate(next.getDate() + (daysUntilMonday || 1));
  return next;
}

function inferSyllabusWeekCount(planText: string, notebookCount: number): number {
  const weekMatch = planText.match(/(\d{1,2})\s*(周|星期|week|weeks)/i);
  if (weekMatch) return Math.min(16, Math.max(2, Number(weekMatch[1])));
  const monthMatch = planText.match(/(\d{1,2})\s*(个月|month|months)/i);
  if (monthMatch) return Math.min(16, Math.max(4, Number(monthMatch[1]) * 4));
  const dayMatch = planText.match(/(\d{1,3})\s*(天|day|days)/i);
  if (dayMatch) return Math.min(16, Math.max(2, Math.ceil(Number(dayMatch[1]) / 7)));
  return Math.min(12, Math.max(6, notebookCount || 0));
}

function courseSyllabusTopics(course: CourseRecord, notebooks: StageListItem[], count: number) {
  const descriptionTopics = (course.description || '')
    .split(/[。！？.!?\n;；]/)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => item.length >= 6)
    .map((item) => item.slice(0, 42));
  const notebookTopics = notebooks
    .map((notebook) => notebook.name?.trim())
    .filter((name): name is string => Boolean(name));
  const tagTopics = (course.tags || []).map((tag) => tag.trim()).filter(Boolean);
  const pool = [...descriptionTopics, ...notebookTopics, ...tagTopics, course.name].filter(Boolean);
  return Array.from(
    { length: count },
    (_, index) => pool[index % pool.length] || `第 ${index + 1} 周主题`,
  );
}

function simulateSyllabusEventsFromPlan({
  course,
  notebooks,
  planText,
}: {
  course: CourseRecord;
  notebooks: StageListItem[];
  planText: string;
}): SyllabusCalendarEvent[] {
  const weekCount = inferSyllabusWeekCount(planText, notebooks.length);
  const topics = courseSyllabusTopics(course, notebooks, weekCount);
  const startDate = nextStudyWeekStart();
  const sourceName = '模拟 syllabus';
  const courseLabel = course.courseCode || course.name;
  const events: SyllabusCalendarEvent[] = [];

  for (let index = 0; index < weekCount; index += 1) {
    const weekStart = addCalendarDays(startDate, index * 7);
    const topic = topics[index];
    events.push({
      id: makeClientId('syllabus-event'),
      title: `第 ${index + 1} 周：${topic}`,
      kind: 'progress',
      date: localDayKey(weekStart),
      sourceName,
      createdAt: Date.now(),
    });
    if ((index + 1) % 2 === 0 || index === weekCount - 1) {
      events.push({
        id: makeClientId('syllabus-event'),
        title: `作业 ${Math.ceil((index + 1) / 2)}：${topic} 练习`,
        kind: 'assignment',
        date: localDayKey(addCalendarDays(weekStart, 4)),
        sourceName,
        createdAt: Date.now(),
      });
    }
  }

  if (weekCount >= 5) {
    events.push({
      id: makeClientId('syllabus-event'),
      title: `${courseLabel} 期中检查`,
      kind: 'exam',
      date: localDayKey(addCalendarDays(startDate, Math.floor(weekCount / 2) * 7 - 1)),
      sourceName,
      createdAt: Date.now(),
    });
  }
  events.push({
    id: makeClientId('syllabus-event'),
    title: `${courseLabel} 期末复盘`,
    kind: 'exam',
    date: localDayKey(addCalendarDays(startDate, weekCount * 7 - 2)),
    sourceName,
    createdAt: Date.now(),
  });

  return events.slice(0, 80);
}

function formatCalendarMonth(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    year: 'numeric',
  }).format(value);
}

function formatShortCalendarDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map((part) => Number(part));
  if (!year || !month || !day) return dateKey;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(year, month - 1, day));
}

const learnSessionTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const learnSessionWeekdayFormatter = new Intl.DateTimeFormat('zh-CN', {
  weekday: 'short',
});
const learnSessionDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
});

function formatLearnSessionMeta(updatedAt: number): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return '';
  const updated = new Date(updatedAt);
  if (Number.isNaN(updated.getTime())) return '';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const updatedDay = new Date(updated);
  updatedDay.setHours(0, 0, 0, 0);
  const dayDifference = Math.round((today.getTime() - updatedDay.getTime()) / 86_400_000);

  if (dayDifference === 0) return learnSessionTimeFormatter.format(updated);
  if (dayDifference === 1) return '昨天';
  if (dayDifference > 1 && dayDifference < 7) {
    return learnSessionWeekdayFormatter.format(updated);
  }
  return learnSessionDateFormatter.format(updated);
}

function planCalendarTimestamp(plan: PracticePlan): number {
  return plan.status === 'completed' && plan.completedAt ? plan.completedAt : plan.createdAt;
}

function CourseAvatar({ course, className }: { course: CourseRecord; className?: string }) {
  const avatar = resolveCourseAvatarDisplayUrl(course.id, course.avatarUrl);
  return (
    <img
      src={avatar}
      alt=""
      className={cn(
        'size-10 shrink-0 rounded-[14px] object-cover ring-1 ring-black/5 dark:ring-white/10',
        className,
      )}
    />
  );
}

const learnAssistantActionCardWidthClassName = 'w-full max-w-none';
const learnHomeGlowCardBaseClassName =
  'relative overflow-hidden border border-[#A9E7FF]/45 bg-[#f7fbfd]/90 shadow-[0_22px_64px_rgba(47,143,201,0.14),0_2px_14px_rgba(16,56,50,0.06)] ring-1 ring-white/55 dark:border-white/10 dark:bg-slate-950 dark:ring-white/5';
const learnHomeGlowSheenClassName =
  'absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.42),rgba(255,255,255,0.2)_54%,rgba(255,255,255,0.04))] dark:bg-[linear-gradient(115deg,rgba(2,6,23,0.42),rgba(15,23,42,0.34)_54%,rgba(15,23,42,0.18))]';
const learnHomeGlowSurfaceClassNames = {
  lecture:
    'bg-[radial-gradient(circle_at_18%_18%,rgba(169,231,255,0.58),transparent_34%),radial-gradient(circle_at_86%_22%,rgba(169,240,220,0.5),transparent_32%),radial-gradient(circle_at_76%_82%,rgba(206,198,255,0.3),transparent_36%),#f7fbfd] dark:bg-[radial-gradient(circle_at_18%_18%,rgba(169,231,255,0.18),transparent_36%),radial-gradient(circle_at_86%_22%,rgba(169,240,220,0.16),transparent_34%),radial-gradient(circle_at_76%_82%,rgba(206,198,255,0.14),transparent_36%),#020617]',
  quiz: 'bg-[radial-gradient(circle_at_18%_18%,rgba(169,231,255,0.66),transparent_34%),radial-gradient(circle_at_84%_18%,rgba(206,198,255,0.52),transparent_32%),radial-gradient(circle_at_76%_84%,rgba(169,240,220,0.28),transparent_35%),#f7fbfd] dark:bg-[radial-gradient(circle_at_18%_18%,rgba(169,231,255,0.2),transparent_36%),radial-gradient(circle_at_84%_18%,rgba(206,198,255,0.19),transparent_34%),radial-gradient(circle_at_76%_84%,rgba(169,240,220,0.12),transparent_36%),#020617]',
  practice:
    'bg-[radial-gradient(circle_at_22%_20%,rgba(169,240,220,0.62),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(169,231,255,0.48),transparent_32%),radial-gradient(circle_at_72%_82%,rgba(206,198,255,0.26),transparent_36%),#f7fbfd] dark:bg-[radial-gradient(circle_at_22%_20%,rgba(169,240,220,0.19),transparent_36%),radial-gradient(circle_at_82%_18%,rgba(169,231,255,0.16),transparent_34%),radial-gradient(circle_at_72%_82%,rgba(206,198,255,0.12),transparent_36%),#020617]',
  progress:
    'bg-[radial-gradient(circle_at_18%_24%,rgba(255,154,154,0.34),transparent_34%),radial-gradient(circle_at_84%_18%,rgba(206,198,255,0.5),transparent_32%),radial-gradient(circle_at_72%_78%,rgba(169,231,255,0.34),transparent_36%),#f7fbfd] dark:bg-[radial-gradient(circle_at_18%_24%,rgba(255,154,154,0.16),transparent_36%),radial-gradient(circle_at_84%_18%,rgba(206,198,255,0.18),transparent_34%),radial-gradient(circle_at_72%_78%,rgba(169,231,255,0.14),transparent_36%),#020617]',
} as const;
const learnHomeGlowBloomClassNames = {
  lecture:
    'bg-[radial-gradient(circle_at_16%_8%,rgba(169,231,255,0.94),transparent_34%),radial-gradient(circle_at_88%_10%,rgba(169,240,220,0.78),transparent_32%),radial-gradient(circle_at_78%_88%,rgba(206,198,255,0.5),transparent_38%)] dark:bg-[radial-gradient(circle_at_16%_8%,rgba(169,231,255,0.34),transparent_36%),radial-gradient(circle_at_88%_10%,rgba(169,240,220,0.26),transparent_34%),radial-gradient(circle_at_78%_88%,rgba(206,198,255,0.2),transparent_40%)]',
  quiz: 'bg-[radial-gradient(circle_at_14%_6%,rgba(169,231,255,0.98),transparent_34%),radial-gradient(circle_at_88%_8%,rgba(206,198,255,0.84),transparent_34%),radial-gradient(circle_at_78%_88%,rgba(169,240,220,0.42),transparent_40%)] dark:bg-[radial-gradient(circle_at_14%_6%,rgba(169,231,255,0.36),transparent_36%),radial-gradient(circle_at_88%_8%,rgba(206,198,255,0.3),transparent_36%),radial-gradient(circle_at_78%_88%,rgba(169,240,220,0.16),transparent_42%)]',
  practice:
    'bg-[radial-gradient(circle_at_16%_8%,rgba(169,240,220,0.98),transparent_34%),radial-gradient(circle_at_86%_10%,rgba(169,231,255,0.78),transparent_34%),radial-gradient(circle_at_76%_88%,rgba(206,198,255,0.42),transparent_40%)] dark:bg-[radial-gradient(circle_at_16%_8%,rgba(169,240,220,0.34),transparent_36%),radial-gradient(circle_at_86%_10%,rgba(169,231,255,0.26),transparent_36%),radial-gradient(circle_at_76%_88%,rgba(206,198,255,0.16),transparent_42%)]',
  progress:
    'bg-[radial-gradient(circle_at_14%_12%,rgba(255,154,154,0.82),transparent_34%),radial-gradient(circle_at_88%_8%,rgba(206,198,255,0.9),transparent_34%),radial-gradient(circle_at_74%_86%,rgba(169,231,255,0.52),transparent_40%)] dark:bg-[radial-gradient(circle_at_14%_12%,rgba(255,154,154,0.28),transparent_36%),radial-gradient(circle_at_88%_8%,rgba(206,198,255,0.32),transparent_36%),radial-gradient(circle_at_74%_86%,rgba(169,231,255,0.2),transparent_42%)]',
} as const;

function LearnHomeGlowLayers({
  variant,
}: {
  variant: keyof typeof learnHomeGlowSurfaceClassNames;
}) {
  return (
    <>
      <div
        className={cn('absolute inset-0', learnHomeGlowSurfaceClassNames[variant])}
        aria-hidden
      />
      <div
        className={cn(
          'absolute -inset-12 opacity-90 blur-2xl saturate-150',
          learnHomeGlowBloomClassNames[variant],
        )}
        aria-hidden
      />
      <div className={learnHomeGlowSheenClassName} aria-hidden />
      <div className="absolute inset-x-0 top-0 h-px bg-white/80 dark:bg-white/15" aria-hidden />
    </>
  );
}

function miniLectureRegionStyle(region: MiniLectureRegion) {
  const [x0, y0, x1, y1] = region.bbox;
  return {
    left: `${(x0 / MINI_LECTURE_CANVAS_WIDTH) * 100}%`,
    top: `${(y0 / MINI_LECTURE_CANVAS_HEIGHT) * 100}%`,
    width: `${((x1 - x0) / MINI_LECTURE_CANVAS_WIDTH) * 100}%`,
    height: `${((y1 - y0) / MINI_LECTURE_CANVAS_HEIGHT) * 100}%`,
  };
}

export function MiniLectureInviteCard({
  prompt,
  deck,
  generating,
  disabled = false,
  onGenerate,
  onOpen,
}: {
  prompt?: MiniLecturePrompt;
  deck?: MiniLectureDeck;
  generating: boolean;
  disabled?: boolean;
  onGenerate: () => void;
  onOpen: (deck: MiniLectureDeck) => void;
}) {
  if (!prompt && !deck) return null;
  return (
    <div className={cn(learnAssistantActionCardWidthClassName, 'mt-3.5')}>
      <div
        className={cn(
          'relative grid grid-cols-[38px_minmax(130px,1fr)_auto] items-center gap-2.5 overflow-hidden rounded-[17px] border p-3 shadow-[0_14px_34px_rgba(14,116,144,0.10)]',
          deck
            ? 'border-sky-400/25 bg-[radial-gradient(circle_at_12%_0%,rgba(125,211,252,0.24),transparent_38%),linear-gradient(135deg,#fbfdff_0%,#effaff_54%,#effcf9_100%)]'
            : 'border-dashed border-violet-600/25 bg-[radial-gradient(circle_at_9%_16%,rgba(167,139,250,0.16),transparent_32%),linear-gradient(135deg,#faf5ff_0%,#fff_56%,#f0f9ff_100%)]',
        )}
      >
        <span
          className="z-[1] grid size-[38px] place-items-center rounded-xl bg-[#172033] text-white shadow-[0_8px_20px_rgba(15,23,42,0.20)]"
          aria-hidden
        >
          {generating ? (
            <Loader2 className="size-[18px] animate-spin" />
          ) : (
            <BookOpenCheck className="size-[18px]" strokeWidth={1.8} />
          )}
        </span>
        <span className="z-[1] flex min-w-0 flex-col gap-[3px]">
          <strong className="truncate text-xs font-bold tracking-[-0.01em] text-[#172033]">
            {generating
              ? '正在生成课堂讲解'
              : deck
                ? deck.title || '课堂讲解已生成'
                : '把这段回答变成课堂讲解'}
          </strong>
          <small className="truncate text-[9px] text-[#607086]">
            {deck ? '图片、语音与动态聚焦均已准备好' : '生成图片式课件，恢复遮罩区域并配课堂语音'}
          </small>
        </span>
        <span className="z-[1] self-start rounded-full border border-sky-400/20 bg-white/75 px-[7px] py-[3px] text-[8px] font-bold text-[#0878a4]">
          {generating ? '处理中' : deck ? '已就绪' : '1–2 页'}
        </span>
        <Button
          type="button"
          size="sm"
          className="z-[1] col-[2/4] h-[30px] w-max gap-1.5 rounded-full bg-[#172033] px-3 text-[10px] font-semibold text-white shadow-[0_7px_16px_rgba(15,23,42,0.14)] hover:bg-[#273750]"
          onClick={deck ? () => onOpen(deck) : onGenerate}
          disabled={disabled || generating}
        >
          {generating ? (
            <Loader2 className="size-[13px] animate-spin" />
          ) : (
            <Play className="size-[13px]" fill="currentColor" />
          )}
          {generating ? '生成中…' : deck ? '查看讲解' : '生成课堂讲解'}
        </Button>
        <span
          className="pointer-events-none absolute -right-[30px] -top-11 size-[84px] rotate-[20deg] rounded-3xl border border-white/70"
          aria-hidden
        />
      </div>
    </div>
  );
}

export function MiniLectureClassroomDialog({
  deck,
  open,
  onOpenChange,
}: {
  deck: MiniLectureDeck | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [speechText, setSpeechText] = useState('');
  const timeoutRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackRef = useRef(0);

  const page = deck?.pages[Math.max(0, Math.min(pageIndex, (deck?.pages.length || 1) - 1))] || null;
  const activeRegion = page?.regions.find((region) => region.id === activeRegionId) || null;
  const canPrev = pageIndex > 0;
  const canNext = Boolean(deck && pageIndex < deck.pages.length - 1);

  const stopPlayback = useCallback(() => {
    playbackRef.current += 1;
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setPlaying(false);
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (!open) {
        stopPlayback();
        return;
      }
      setPageIndex(0);
      setActionIndex(0);
      setActiveRegionId(null);
      setSpeechText('');
    }, 0);
    return () => window.clearTimeout(handle);
  }, [deck?.id, open, stopPlayback]);

  useEffect(() => {
    if (!playing || !page || !deck) return;
    const action = page.actions[actionIndex];
    const requestId = playbackRef.current;
    if (!action) {
      timeoutRef.current = window.setTimeout(() => {
        if (playbackRef.current !== requestId) return;
        if (pageIndex < deck.pages.length - 1) {
          setPageIndex((current) => current + 1);
          setActionIndex(0);
          setActiveRegionId(null);
          return;
        }
        setPlaying(false);
      }, 0);
      return;
    }

    if (action.type === 'spotlight') {
      timeoutRef.current = window.setTimeout(() => {
        if (playbackRef.current !== requestId) return;
        setActiveRegionId(action.elementId);
        timeoutRef.current = window.setTimeout(() => {
          if (playbackRef.current !== requestId) return;
          setActionIndex((current) => current + 1);
        }, 520);
      }, 0);
      return () => {
        if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      };
    }

    timeoutRef.current = window.setTimeout(() => {
      if (playbackRef.current !== requestId) return;
      if (action.elementId) setActiveRegionId(action.elementId);
      setSpeechText(action.text);
      if (!action.audioDataUrl) {
        timeoutRef.current = window.setTimeout(
          () => setActionIndex((current) => current + 1),
          Math.max(1400, Math.min(5200, action.text.length * 90)),
        );
        return;
      }
      const audio = new Audio(action.audioDataUrl);
      audio.playbackRate = playbackRate;
      audioRef.current = audio;
      audio.onended = () => {
        if (playbackRef.current !== requestId) return;
        audioRef.current = null;
        setActionIndex((current) => current + 1);
      };
      audio.onerror = () => {
        if (playbackRef.current !== requestId) return;
        audioRef.current = null;
        setActionIndex((current) => current + 1);
      };
      void audio.play().catch(() => {
        if (playbackRef.current !== requestId) return;
        audioRef.current = null;
        setActionIndex((current) => current + 1);
      });
    }, 0);
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [actionIndex, deck, page, pageIndex, playbackRate, playing]);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  const jumpToPage = useCallback(
    (nextIndex: number) => {
      stopPlayback();
      setPageIndex(nextIndex);
      setActionIndex(0);
      setActiveRegionId(null);
      setSpeechText('');
    },
    [stopPlayback],
  );

  if (!deck || !page) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) stopPlayback();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        showCloseButton={false}
        overlayClassName={SYNTARA_WORKSPACE_DIALOG_OVERLAY_CLASS}
        className={cn(
          SYNTARA_WORKSPACE_DIALOG_CONTENT_CLASS,
          'h-[min(820px,94dvh)] max-w-[1080px] border-slate-200 text-slate-900 min-[781px]:h-[min(720px,88dvh)]',
        )}
      >
        <DialogHeader className="flex min-h-[70px] shrink-0 flex-row items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-3 text-left min-[781px]:min-h-[78px] min-[781px]:gap-[18px] min-[781px]:px-[18px] min-[781px]:py-[15px]">
          <div className="min-w-0">
            <DialogTitle className="max-w-[56vw] truncate text-sm font-semibold text-slate-900 min-[781px]:max-w-none min-[781px]:text-base">
              {deck.title}
            </DialogTitle>
            <p className="mt-1 text-[9px] text-slate-500">
              第 {pageIndex + 1}/{deck.pages.length} 页 · {page.regions.length} 个讲解片段
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="inline-flex h-8 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0 pl-[5px] pr-[5px] text-[9px] font-semibold text-slate-500 min-[521px]:pl-2.5">
              <span className="hidden min-[521px]:inline">倍速</span>
              <select
                aria-label="讲解播放速度"
                value={playbackRate}
                onChange={(event) => {
                  const nextRate = Number(event.target.value);
                  setPlaybackRate(nextRate);
                  if (audioRef.current) audioRef.current.playbackRate = nextRate;
                }}
                className="h-6 rounded-full border-0 bg-white py-0 pl-[7px] pr-5 text-[9px] font-semibold text-slate-900 outline-none"
              >
                {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}×
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              size="sm"
              className="size-8 gap-[7px] rounded-full border border-slate-900 bg-slate-900 p-0 font-semibold text-white hover:bg-slate-700 min-[521px]:w-auto min-[521px]:px-[13px]"
              onClick={() => {
                if (playing) {
                  stopPlayback();
                  return;
                }
                playbackRef.current += 1;
                setActionIndex(0);
                setPlaying(true);
              }}
            >
              {playing ? (
                <Pause className="size-3.5" fill="currentColor" />
              ) : (
                <Play className="size-3.5" fill="currentColor" />
              )}
              <span className="hidden text-[10px] min-[521px]:inline">
                {playing ? '暂停讲解' : '播放讲解'}
              </span>
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-8 rounded-full border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100"
              aria-label="关闭课堂讲解"
              onClick={() => {
                stopPlayback();
                onOpenChange(false);
              }}
            >
              <X className="size-[17px]" />
            </Button>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(240px,1fr)_minmax(160px,36%)] min-[521px]:grid-rows-[minmax(280px,1fr)_minmax(180px,34%)] min-[781px]:grid-cols-[minmax(0,1fr)_250px] min-[781px]:grid-rows-none">
          <div className="flex min-h-0 min-w-0 flex-col justify-center bg-slate-50 p-3 min-[781px]:p-5">
            <div className="relative mx-auto aspect-video w-full max-h-[calc(88dvh-170px)] overflow-hidden rounded-[19px] border border-slate-200 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.10)]">
              <img
                src={page.imageDataUrl}
                alt={page.title}
                className="absolute inset-0 size-full object-contain"
              />
              {activeRegion ? (
                <div
                  className="pointer-events-none absolute rounded-[17px] border-2 transition-all duration-700 ease-out"
                  style={{
                    ...miniLectureRegionStyle(activeRegion),
                    borderColor: activeRegion.markerColorHex,
                    boxShadow: `0 0 0 9999px rgba(15,23,42,0.68), 0 0 24px ${activeRegion.markerColorHex}`,
                  }}
                />
              ) : null}
            </div>
            <div className="mt-3.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-auto w-max gap-1 rounded-full border-slate-200 bg-white px-[9px] py-[5px] text-[9px] text-slate-700 disabled:opacity-35"
                onClick={() => jumpToPage(pageIndex - 1)}
                disabled={!canPrev}
              >
                <ChevronLeft className="size-[15px]" />
                上一页
              </Button>
              <span className="flex gap-[5px]">
                {deck.pages.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      'h-1 w-[18px] rounded-full bg-slate-300',
                      index === pageIndex && 'bg-slate-900',
                    )}
                    aria-label={`第 ${index + 1} 页`}
                    onClick={() => jumpToPage(index)}
                  />
                ))}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-auto w-max justify-self-end gap-1 rounded-full border-slate-200 bg-white px-[9px] py-[5px] text-[9px] text-slate-700 disabled:opacity-35"
                onClick={() => jumpToPage(pageIndex + 1)}
                disabled={!canNext}
              >
                下一页
                <ChevronRight className="size-[15px]" />
              </Button>
            </div>
            <p className="mt-[9px] text-center text-[8px] leading-[1.4] text-slate-400">
              语音由 OpenAI 人工智能生成，不是真人录音。
            </p>
          </div>

          <aside className="flex min-h-0 flex-col border-t border-slate-200 bg-white min-[781px]:border-l min-[781px]:border-t-0">
            <div className="flex items-center justify-between gap-2.5 border-b border-slate-200 px-3 py-2.5 text-[10px] font-semibold text-slate-900 min-[781px]:p-4">
              <span className="inline-flex items-center gap-[7px]">
                <Volume2 className="size-[15px]" />
                讲解节奏
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-[5px] text-[8px] text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                onClick={() => {
                  stopPlayback();
                  setActiveRegionId(null);
                  setSpeechText('');
                }}
              >
                <Eraser className="size-[13px]" />
                清除聚焦
              </button>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto p-3 min-[781px]:flex min-[781px]:flex-col">
              {page.regions.map((region) => (
                <button
                  key={region.id}
                  type="button"
                  className={cn(
                    'relative grid grid-cols-[5px_minmax(0,1fr)] gap-x-[9px] gap-y-[5px] rounded-[13px] border border-slate-200 bg-slate-50 p-2.5 text-left text-slate-900',
                    activeRegionId === region.id
                      ? 'border-slate-400 bg-blue-50'
                      : 'hover:bg-slate-100',
                  )}
                  onClick={() => {
                    stopPlayback();
                    setActiveRegionId(region.id);
                    setSpeechText(region.script);
                  }}
                >
                  <span
                    className="row-span-2 h-full w-[5px] rounded-full"
                    style={{ background: region.markerColorHex || '#94a3b8' }}
                  />
                  <strong className="text-[10px]">{region.label}</strong>
                  <small className="line-clamp-2 text-[9px] leading-[1.55] text-slate-500">
                    {region.script}
                  </small>
                </button>
              ))}
            </div>

            <div className="hidden border-t border-slate-200 bg-slate-50 px-[15px] pb-4 pt-[13px] min-[781px]:block">
              <span className="text-[8px] font-bold tracking-[0.1em] text-blue-600">
                {playing ? '正在播放 OpenAI 语音' : speechText ? '当前讲解' : '准备就绪'}
              </span>
              <p className="mt-1.5 text-[9px] leading-[1.6] text-slate-700">
                {speechText || '点击“播放讲解”，遮罩会跟随讲解内容移动。'}
              </p>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PlanActionCard({
  plan,
  sessionSummary,
  problemsState,
  disabled = false,
  onStart,
}: {
  plan: PracticePlan;
  sessionSummary?: PracticeSessionSummary | null;
  problemsState: ResourceLoadState;
  disabled?: boolean;
  onStart: (plan: PracticePlan) => void;
}) {
  const isQuizPlan = plan.mode === 'quiz';
  const planIconClassName = isQuizPlan
    ? 'bg-sky-50 text-sky-700'
    : 'bg-emerald-50 text-emerald-700';
  const planChipClassName = isQuizPlan
    ? 'border-sky-100 bg-sky-50 text-sky-700'
    : 'border-emerald-100 bg-emerald-50 text-emerald-700';
  const planMetricPillClassName =
    'inline-flex items-center justify-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[8px] font-semibold text-slate-500';
  const isSelectionPlan = isProblemSelectionPlan(plan);
  const rationale = practicePlanDisplayRationale(plan).slice(0, 4);
  const gaps = plan.evidence?.gaps?.slice(0, 2) || [];
  const evidenceItems = plan.evidence?.items?.slice(0, 4) || [];
  const questionLinks = plan.problemIds.map((problemId, index) => {
    const question = plan.questions?.find((item) => item.problemId === problemId);
    const evidence = plan.evidence?.items.find(
      (item) => item.sourceId === problemId || item.id === `problem:${problemId}`,
    );
    return {
      problemId,
      title: question?.title || evidence?.title || `题目 ${index + 1}`,
      reason: question?.reason || evidence?.reason,
      href:
        question?.href ||
        `/course/${encodeURIComponent(plan.courseId)}/problem-bank/${encodeURIComponent(problemId)}`,
    };
  });
  const hasQuestions = questionLinks.length > 0;
  const missingQuestionsLabel =
    problemsState.status === 'loading' || problemsState.status === 'idle'
      ? '题库仍在加载'
      : problemsState.status === 'error'
        ? '题库状态不可用'
        : problemsState.status === 'empty'
          ? '题库已确认暂无可用题'
          : '这份计划未保存题目';
  const actionLabel = hasQuestions
    ? sessionSummary?.actionLabel || '开始做题'
    : missingQuestionsLabel;
  const planMeta = practiceSessionPlanMeta(plan, sessionSummary);

  return (
    <div
      className={cn(
        learnAssistantActionCardWidthClassName,
        'mt-3 overflow-hidden rounded-[18px] border border-slate-400/20 bg-white shadow-[0_16px_36px_rgba(15,23,42,0.07)]',
      )}
    >
      <div className="px-3.5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-[9px]',
                planIconClassName,
              )}
            >
              <BookOpenCheck className="size-[15px]" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-slate-900">{plan.title}</p>
              <p className="mt-[3px] text-[9px] text-slate-500">
                {isSelectionPlan ? '题库选题' : plan.mode === 'quiz' ? '课程测验' : '刷题计划'} ·{' '}
                {planMeta}
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => onStart(plan)}
            disabled={disabled || !hasQuestions}
            className="h-[30px] shrink-0 gap-1.5 rounded-full bg-slate-900 px-3 text-[9px] font-bold text-white shadow-sm hover:bg-slate-700"
          >
            <Play className="size-3" />
            {actionLabel}
          </Button>
        </div>

        <div className="mt-2.5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="flex min-w-0 flex-wrap gap-1">
            {plan.targetConcepts.slice(0, 5).map((concept) => (
              <span
                key={concept}
                className={cn(
                  'rounded-full border px-2 py-1 text-[8px] font-semibold',
                  planChipClassName,
                )}
              >
                {concept}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1 text-center sm:justify-end">
            <span className={planMetricPillClassName}>
              <strong className="text-foreground">{plan.difficultyMix.easy}</strong>
              <span className="text-muted-foreground">基础</span>
            </span>
            <span className={planMetricPillClassName}>
              <strong className="text-foreground">{plan.difficultyMix.medium}</strong>
              <span className="text-muted-foreground">中等</span>
            </span>
            <span className={planMetricPillClassName}>
              <strong className="text-foreground">{plan.difficultyMix.hard}</strong>
              <span className="text-muted-foreground">挑战</span>
            </span>
          </div>
        </div>

        {questionLinks.length ? (
          <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
            <p className="text-[9px] font-bold text-slate-900">题库选题 · 点击题目直接作答</p>
            {questionLinks.map((question, index) => (
              <Link
                key={question.problemId}
                href={question.href}
                aria-disabled={disabled}
                tabIndex={disabled ? -1 : undefined}
                onClick={disabled ? (event) => event.preventDefault() : undefined}
                className={cn(
                  'group flex items-center gap-2 rounded-[12px] border border-slate-100 bg-slate-50/80 px-2.5 py-2 text-[9px] transition-colors hover:border-emerald-200 hover:bg-emerald-50/50',
                  disabled && 'pointer-events-none opacity-60',
                )}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-900 text-[9px] font-bold text-white">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-slate-800">{question.title}</span>
                  {question.reason ? (
                    <span className="mt-0.5 block truncate text-[8px] text-slate-500">
                      {question.reason}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[8px] font-bold text-emerald-700">做这道题</span>
                <ChevronRight className="size-3 shrink-0 text-emerald-700 transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-3 border-t border-white/70 pt-3 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
            {problemsState.status === 'loading' || problemsState.status === 'idle'
              ? '题库仍在加载，完成前不会判断当前课程没有可用题。'
              : problemsState.status === 'error'
                ? `题库状态暂不可确认：${problemsState.error || '加载失败'}。本计划不会显示未经确认的题目入口。`
                : problemsState.status === 'empty'
                  ? '当前题库已完成加载，确认暂无可打开的题目。'
                  : '这份历史计划没有保存可打开的题目；这不代表当前课程题库为空。'}
          </p>
        )}
        {rationale.length ? (
          <div className="mt-3 border-t border-white/70 pt-3 text-xs leading-5 text-slate-600 dark:border-white/10 dark:text-slate-300">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {isSelectionPlan ? '为什么这么选' : '计划依据'}
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              {rationale.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {isSelectionPlan && evidenceItems.length ? (
              <div className="mt-2 space-y-1.5">
                {evidenceItems.map((item, index) => (
                  <div
                    key={item.id || `${item.title}-${index}`}
                    className="rounded-[12px] border border-white/70 bg-white/56 px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]"
                  >
                    <p className="font-medium text-slate-800 dark:text-slate-100">
                      {index + 1}. {item.title || '题库题目'}
                    </p>
                    {item.reason ? (
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {item.reason}
                      </p>
                    ) : null}
                    {item.excerpt ? (
                      <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                        {item.excerpt}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : evidenceItems.length ? (
              <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                参考来源：
                {evidenceItems
                  .map((item) => item.title)
                  .filter(Boolean)
                  .join('、')}
              </p>
            ) : null}
            {gaps.length ? (
              <p className="mt-2 text-[11px] text-[#DB544E] dark:text-[#FF9A9A]">
                证据缺口：{gaps.join('；')}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProgressConfirmationCard({
  proposal,
  notebooks,
  disabled = false,
  onSelectionChange,
  onConfirm,
  onDismiss,
}: {
  proposal: ProgressProposal;
  notebooks: StageListItem[];
  disabled?: boolean;
  onSelectionChange: (selection: string) => void;
  onConfirm: () => void;
  onDismiss?: () => void;
}) {
  const orderedNotebooks = orderedCourseNotebooks(notebooks);
  return (
    <div
      className={cn(
        learnAssistantActionCardWidthClassName,
        learnHomeGlowCardBaseClassName,
        'mt-3 rounded-[16px] px-3.5 py-3 text-sm text-slate-800 dark:text-slate-50',
      )}
    >
      <LearnHomeGlowLayers variant="progress" />
      <div className="relative">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-[#FF9A9A]/45 bg-white/72 text-[#DB544E] shadow-sm dark:border-[#FF9A9A]/22 dark:bg-white/8 dark:text-[#FF9A9A]">
            <Target className="size-3.5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">
              {proposal.confirmed
                ? proposal.writeMode === 'planning_scope'
                  ? '计划范围已确认'
                  : '学习进度已更新'
                : (proposal.title ?? '确认学习进度')}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
              {proposal.reason}
            </p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <select
            value={proposal.selection}
            onChange={(event) => onSelectionChange(event.target.value)}
            disabled={disabled || proposal.confirmed}
            className="h-9 min-w-0 rounded-[10px] border border-[#CEC6FF]/55 bg-white/72 px-3 text-sm text-foreground shadow-sm outline-none transition focus:border-[#A9E7FF] focus:ring-2 focus:ring-[#A9E7FF]/30 disabled:cursor-not-allowed disabled:opacity-70 dark:border-[#CEC6FF]/22 dark:bg-slate-950/70"
            aria-label="确认学习进度"
          >
            <option value="">选择学习进度</option>
            <option value={PROGRESS_SELECTION_NOT_STARTED}>还没开始</option>
            {orderedNotebooks.map((notebook) => (
              <option key={notebook.id} value={notebook.id}>
                正在学习：{notebook.name}
              </option>
            ))}
            {notebooks.length > 0 ? (
              <option value={PROGRESS_SELECTION_COMPLETED_ALL}>已经学完整门课</option>
            ) : null}
          </select>
          <Button
            onClick={onConfirm}
            disabled={disabled || !proposal.selection || proposal.confirmed}
            className="h-9 rounded-[10px] bg-[#103832] px-4 text-sm text-white shadow-sm hover:bg-[#15574d] disabled:bg-slate-300 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          >
            {proposal.confirmed ? '已确认' : (proposal.confirmLabel ?? '确认更新')}
          </Button>
          {onDismiss && !proposal.confirmed ? (
            <Button
              variant="ghost"
              onClick={onDismiss}
              disabled={disabled}
              className="h-9 rounded-[10px] px-3 text-sm"
            >
              稍后再说
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function learnActionTitle(action: LearningAction): string {
  switch (action.kind) {
    case 'calendar.propose_add':
      return '添加到学习日历';
    case 'calendar.propose_update':
      return '修改学习日历';
    case 'calendar.propose_delete':
      return '删除日历事项';
    case 'calendar.search':
      return '查看学习日程';
    case 'calendar.start_recent':
      return '开始最近活动';
    case 'memory.search':
      return '查看学习记忆';
    case 'web.search':
      return '联网搜索';
    case 'review_mode.request_choice':
      return '选择复习方式';
    case 'learner_progress.request_confirmation':
      return '确认学习进度';
    case 'practice.propose_generation':
      return '从题库选题';
    case 'classroom.propose_temporary_explanation':
      return '生成临时课堂';
    case 'image.propose_generation':
      return '生成学习图片';
    case 'memory.propose_write':
      return '写入学习记忆';
    default:
      return action.label;
  }
}

function learnActionButtonLabel(action: LearningAction): string {
  if (action.status === 'completed') return '已完成';
  if (action.status === 'confirmed') return '已确认';
  if (action.status === 'cancelled') return '已取消';
  if (action.status === 'failed') return '重试';
  switch (action.kind) {
    case 'calendar.search':
    case 'calendar.start_recent':
    case 'memory.search':
    case 'web.search':
      return '查看';
    case 'calendar.propose_add':
      return '确认添加';
    case 'calendar.propose_update':
      return '确认修改';
    case 'calendar.propose_delete':
      return '确认删除';
    case 'review_mode.request_choice':
      return '选择';
    case 'learner_progress.request_confirmation':
      return '确认进度';
    case 'practice.propose_generation':
      return '确认选题';
    case 'classroom.propose_temporary_explanation':
      return '生成课堂';
    case 'image.propose_generation':
      return '确认生成';
    case 'memory.propose_write':
      return '确认写入';
    default:
      return '确认';
  }
}

function reviewModeChoiceOptions(action: LearningAction) {
  const rawOptions = Array.isArray(action.payload?.options) ? action.payload.options : [];
  const options = rawOptions
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const value = payloadString(record.value);
      const label = payloadString(record.label);
      const followupText = payloadString(record.followupText);
      if (!value || !label || !followupText) return null;
      return { value, label, followupText };
    })
    .filter((item): item is { value: string; label: string; followupText: string } =>
      Boolean(item),
    );
  if (options.length) return options;
  const targetText = payloadString(action.payload?.targetText) || action.summary || action.label;
  return [
    { value: 'explain', label: '听讲解', followupText: `我想听讲解：${targetText}` },
    { value: 'practice', label: '练题目', followupText: `我想练题目：${targetText}` },
    { value: 'both', label: '讲解 + 练题', followupText: `我想讲解和练题都有：${targetText}` },
  ];
}

function memoryActionDetailRows(action: LearningAction): Array<{ label: string; value: string }> {
  if (action.kind !== 'memory.propose_write') return [];
  const payload = actionPayload(action);
  const evidenceValues = [
    ...(action.evidence || []).map((item) => item.reason || item.title || ''),
    ...(Array.isArray(payload.evidence) ? payload.evidence : []),
  ]
    .map((value) => payloadString(value))
    .filter(Boolean)
    .slice(0, 2);
  return [
    {
      label: '知识点',
      value: payloadString(payload.knowledgePoint) || payloadString(payload.concept),
    },
    {
      label: '已掌握',
      value: payloadString(payload.masteredSignal),
    },
    { label: '证据', value: [...new Set(evidenceValues)].join('；') },
    {
      label: '薄弱点',
      value: payloadString(payload.stuckPoint) || payloadString(payload.weakness),
    },
    {
      label: '原因',
      value: payloadString(payload.cause) || payloadString(payload.probableCause),
    },
    {
      label: '下一步',
      value: payloadString(payload.nextTeachingMove) || payloadString(payload.nextStep),
    },
    {
      label: '补充',
      value: action.summary || '',
    },
  ].filter((row) => row.value);
}

export function LearnLearningActionCards({
  actions,
  disabled = false,
  onConfirm,
  onCancel,
  onReviewModeChoice,
}: {
  actions?: LearningAction[];
  disabled?: boolean;
  onConfirm: (action: LearningAction) => void;
  onCancel: (action: LearningAction) => void;
  onReviewModeChoice?: (
    action: LearningAction,
    choice: { value: string; label: string; followupText: string },
  ) => void;
}) {
  if (!actions?.length) return null;
  return (
    <section
      className="mt-2.5 overflow-hidden rounded-[14px] border border-slate-400/20 bg-white/90"
      aria-label="助教建议的下一步"
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-2.5 py-2">
        <span className="inline-flex items-center gap-1.5 text-[9px] font-bold text-violet-700">
          <Sparkles className="size-3" />
          建议的下一步
        </span>
        <small className="text-[8px] text-slate-400">执行前会明确确认</small>
      </header>
      <div className="divide-y divide-slate-100">
        {actions.map((action) => {
          const completed =
            action.status === 'completed' ||
            action.status === 'confirmed' ||
            action.status === 'cancelled';
          const requiresConfirmation = action.confirmation === 'required';
          const memoryDetails = memoryActionDetailRows(action);
          if (action.kind === 'review_mode.request_choice') {
            const options = reviewModeChoiceOptions(action);
            return (
              <article
                key={action.id}
                className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-2 px-2.5 py-[9px] sm:grid-cols-[28px_minmax(0,1fr)_auto]"
              >
                <span className="grid size-7 place-items-center rounded-[9px] bg-violet-50 text-violet-700">
                  <Sparkles className="size-[15px]" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <strong className="truncate text-[9px] text-slate-700">
                    {learnActionTitle(action)}
                  </strong>
                  <small className="truncate text-[8px] leading-[1.45] text-slate-500">
                    {action.summary || action.label}
                  </small>
                </span>
                <div className="col-[2/3] flex flex-wrap gap-1.5 sm:col-auto">
                  {options.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      size="sm"
                      disabled={disabled || completed}
                      className={cn(
                        'h-7 rounded-full px-2.5 text-[8px] font-bold',
                        option.value === 'both'
                          ? 'bg-violet-600 text-white hover:bg-violet-700'
                          : 'border border-violet-200 bg-white text-violet-700 hover:bg-violet-50',
                      )}
                      onClick={() => onReviewModeChoice?.(action, option)}
                    >
                      {option.label}
                    </Button>
                  ))}
                  {requiresConfirmation && !completed ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-full px-2 text-[8px] text-slate-400"
                      disabled={disabled}
                      onClick={() => onCancel(action)}
                    >
                      取消
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          }
          return (
            <article
              key={action.id}
              className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-2 px-2.5 py-[9px]"
            >
              <span className="grid size-7 place-items-center rounded-[9px] bg-violet-50 text-violet-700">
                <Sparkles className="size-[15px]" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[9px] font-bold text-slate-700">
                  {learnActionTitle(action)}
                </p>
                {memoryDetails.length ? (
                  <dl className="mt-1.5 space-y-1 text-[8px] leading-[1.45] text-slate-600">
                    {memoryDetails.map((row) => (
                      <div key={row.label} className="grid grid-cols-[2.5rem_1fr] gap-1.5">
                        <dt className="font-medium text-slate-400">{row.label}</dt>
                        <dd className="min-w-0 whitespace-pre-wrap break-words">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-0.5 truncate text-[8px] leading-[1.45] text-slate-500">
                    {action.summary || action.label}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled || completed}
                  className={cn(
                    'h-7 shrink-0 rounded-full px-2 text-[8px] text-slate-400',
                    requiresConfirmation ? '' : 'hidden',
                  )}
                  onClick={() => onCancel(action)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={disabled || completed}
                  className={cn(
                    'h-7 shrink-0 rounded-full px-2.5 text-[8px] font-bold',
                    completed
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-violet-600 text-white hover:bg-violet-700',
                  )}
                  onClick={() => onConfirm(action)}
                >
                  {learnActionButtonLabel(action)}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function calendarDraftEvents(
  draft: Extract<LearnArtifact, { kind: 'calendar_draft' }>,
): SyllabusCalendarEvent[] {
  return draft.items.map((item, index) => ({
    id: item.id || `${draft.id}-item-${index}`,
    title: item.title,
    kind: 'progress',
    date: item.date || localDayKey(addCalendarDays(new Date(), index)),
    sourceName: draft.title || '日程规划草稿',
    createdAt: Date.now(),
    origin: 'ai_plan',
    sourceRef: { type: 'plan', id: draft.sourceArtifactId || draft.id },
    durationMinutes: item.durationMinutes,
    status: 'planned',
    rawText: item.reason || null,
  }));
}

function calendarDraftInitialDate(draft: Extract<LearnArtifact, { kind: 'calendar_draft' }>) {
  const firstDate = draft.items.map((item) => item.date).find(Boolean);
  return new Date(`${firstDate || localDayKey(new Date())}T12:00:00`);
}

function CalendarDraftPreview({
  draft,
  addAction,
  completed,
  disabled = false,
  isResearchCourse,
  onAddToCalendar,
  onClose,
}: {
  draft: Extract<LearnArtifact, { kind: 'calendar_draft' }>;
  addAction: LearningAction | null;
  completed: boolean;
  disabled?: boolean;
  isResearchCourse: boolean;
  onAddToCalendar?: (action: LearningAction) => void;
  onClose: () => void;
}) {
  const [referenceDate, setReferenceDate] = useState(() => calendarDraftInitialDate(draft));
  useEffect(() => {
    setReferenceDate(calendarDraftInitialDate(draft));
  }, [draft]);
  const draftEvents = useMemo(() => calendarDraftEvents(draft), [draft]);
  const calendarDays = useMemo(
    () => buildLearningCalendarDays(referenceDate, [], draftEvents),
    [draftEvents, referenceDate],
  );
  const eventsByDay = useMemo(() => buildSyllabusEventsByDay(draftEvents), [draftEvents]);
  const firstDate = draftEvents[0]?.date;
  const monthLabel = useMemo(() => formatCalendarMonth(referenceDate), [referenceDate]);

  const showPreviousMonth = useCallback(() => {
    setReferenceDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1));
  }, []);
  const showNextMonth = useCallback(() => {
    setReferenceDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1));
  }, []);
  const showDraftStart = useCallback(() => {
    setReferenceDate(calendarDraftInitialDate(draft));
  }, [draft]);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-2xl font-semibold text-foreground">{monthLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {draft.items.length} 个活动{firstDate ? ` · 从 ${firstDate} 开始` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={showDraftStart}
              className="rounded-full bg-muted px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              首日
            </button>
            <button
              type="button"
              onClick={showPreviousMonth}
              className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground transition hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="上一个月"
              title="上一个月"
            >
              <ChevronLeft className="size-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={showNextMonth}
              className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground transition hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="下一个月"
              title="下一个月"
            >
              <ChevronRight className="size-4" strokeWidth={2} />
            </button>
          </div>
        </div>
        <LearningCalendarGrid
          days={calendarDays}
          syllabusEventsByCalendarDay={eventsByDay}
          isResearchCourse={isResearchCourse}
          maxVisibleItems={4}
          className="h-[min(430px,52dvh)] rounded-[18px] border border-border/70"
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border/70 px-5 py-4">
        <Button type="button" variant="ghost" className="rounded-[10px]" onClick={onClose}>
          关闭
        </Button>
        <Button
          type="button"
          disabled={disabled || !addAction || completed}
          className="rounded-[10px] bg-[#103832] text-white hover:bg-[#15574d] dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          onClick={() => {
            if (!addAction || !onAddToCalendar) return;
            onAddToCalendar(addAction);
            onClose();
          }}
        >
          {completed ? '已添加到日历' : '添加到日历'}
        </Button>
      </div>
    </>
  );
}

function answerEvidenceSourceLink(
  source: LearnAnswerEvidenceSource,
  courseId?: string,
): { href: string; external: boolean; label: string } | null {
  const metadata = source.metadata || {};
  const explicitHref =
    payloadString(metadata.href) ||
    payloadString(metadata.url) ||
    payloadString(metadata.sourceUrl) ||
    payloadString(metadata.source_url);
  if (/^https?:\/\//i.test(explicitHref)) {
    return { href: explicitHref, external: true, label: '打开网页来源' };
  }
  if (!courseId) return null;

  const encodedCourseId = encodeURIComponent(courseId);
  const notebookId =
    source.notebookId ||
    payloadString(metadata.notebookId) ||
    payloadString(metadata.notebook_id) ||
    null;
  if (source.sourceType === 'notebook' && notebookId) {
    return {
      href: `/classroom/${encodeURIComponent(notebookId)}`,
      external: false,
      label: '打开课程笔记',
    };
  }
  if (source.sourceType === 'problem_bank') {
    const problemId =
      source.sourceId ||
      payloadString(metadata.problemId) ||
      payloadString(metadata.problem_id) ||
      source.id;
    if (problemId) {
      return {
        href: `/course/${encodedCourseId}/problem-bank/${encodeURIComponent(problemId)}`,
        external: false,
        label: '打开题目',
      };
    }
    return {
      href: `/course/${encodedCourseId}/problem-bank`,
      external: false,
      label: '打开课程题库',
    };
  }
  if (source.sourceType === 'memory') {
    return {
      href: notebookId
        ? `/classroom/${encodeURIComponent(notebookId)}/memory`
        : `/course/${encodedCourseId}/resources?tab=memory`,
      external: false,
      label: '打开记忆来源',
    };
  }
  if (source.sourceType === 'calendar') {
    return { href: '/calendar', external: false, label: '打开学习日历' };
  }
  if (source.sourceType === 'source') {
    return {
      href: notebookId
        ? `/classroom/${encodeURIComponent(notebookId)}`
        : `/course/${encodedCourseId}/resources?tab=sources`,
      external: false,
      label: notebookId ? '打开来源笔记' : '打开课程资料',
    };
  }
  return null;
}

function AnswerEvidenceSourceCard({
  artifactId,
  source,
  courseId,
  disabled = false,
}: {
  artifactId: string;
  source: LearnAnswerEvidenceSource;
  courseId?: string;
  disabled?: boolean;
}) {
  const link = answerEvidenceSourceLink(source, courseId);
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-indigo-700 dark:bg-indigo-300/15 dark:text-indigo-100">
          {source.sourceType}
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold">{source.title}</span>
        {link ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-100">
            {link.label}
            <ChevronRight className="size-3" />
          </span>
        ) : null}
      </div>
      {source.previewText ? (
        <p className="mt-1 line-clamp-2 text-indigo-800/65 dark:text-indigo-100/60">
          {source.previewText}
        </p>
      ) : null}
    </>
  );
  const className =
    'block rounded-md bg-white/70 px-2 py-1.5 text-indigo-900/80 shadow-sm transition dark:bg-white/10 dark:text-indigo-100/80';
  const linkedClassName = disabled
    ? `${className} cursor-not-allowed opacity-60`
    : `${className} hover:bg-white hover:ring-1 hover:ring-indigo-200 dark:hover:bg-white/15 dark:hover:ring-indigo-300/25`;
  const key = `${artifactId}-${source.sourceType}-${source.id || source.sourceId || source.title}`;

  if (!link) {
    return (
      <div key={key} className={className}>
        {content}
      </div>
    );
  }
  if (link.external) {
    return (
      <a
        key={key}
        href={link.href}
        target="_blank"
        rel="noreferrer"
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : undefined}
        onClick={disabled ? (event) => event.preventDefault() : undefined}
        className={linkedClassName}
      >
        {content}
      </a>
    );
  }
  return (
    <Link
      key={key}
      href={link.href}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : undefined}
      onClick={disabled ? (event) => event.preventDefault() : undefined}
      className={linkedClassName}
    >
      {content}
    </Link>
  );
}

function LearnArtifactCards({
  artifacts,
  actions,
  courseId,
  disabled = false,
  isResearchCourse,
  onConfirmCalendarAction,
}: {
  artifacts?: LearnArtifact[];
  actions?: LearningAction[];
  courseId?: string;
  disabled?: boolean;
  isResearchCourse?: boolean;
  onConfirmCalendarAction?: (action: LearningAction) => void;
}) {
  const [openCalendarDraftId, setOpenCalendarDraftId] = useState<string | null>(null);
  if (!artifacts?.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {artifacts.map((artifact) => {
        if (artifact.kind === 'web_search_result') {
          return (
            <div
              key={artifact.id}
              className="rounded-lg border border-sky-100 bg-sky-50/70 px-3 py-2.5 text-xs dark:border-sky-300/15 dark:bg-sky-400/10"
            >
              <p className="font-semibold text-sky-950 dark:text-sky-100">
                网页搜索：{artifact.query}
              </p>
              {artifact.answer ? (
                <p className="mt-1 line-clamp-3 text-sky-800/80 dark:text-sky-100/75">
                  {artifact.answer}
                </p>
              ) : null}
              {artifact.sources.length ? (
                <div className="mt-2 space-y-1">
                  {artifact.sources.slice(0, 3).map((source) => (
                    <a
                      key={`${artifact.id}-${source.url}`}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-200"
                    >
                      {source.title}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }

        if (artifact.kind === 'calendar_draft') {
          const matchingAction = matchingCalendarAddActionForArtifact(artifact, actions);
          const addAction =
            matchingAction ||
            createCalendarAddActionFromArtifacts({
              artifacts: [artifact],
              id: makeClientId('calendar-add-action'),
            });
          const completed =
            matchingAction?.status === 'completed' || matchingAction?.status === 'confirmed';
          return (
            <div key={artifact.id}>
              <button
                type="button"
                onClick={() => setOpenCalendarDraftId(artifact.id)}
                className="flex w-full items-center gap-3 rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2.5 text-left text-xs shadow-sm transition hover:border-amber-200 hover:bg-amber-50 dark:border-amber-300/15 dark:bg-amber-400/10 dark:hover:bg-amber-400/15"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-[12px] border border-amber-200 bg-white text-amber-700 shadow-sm dark:border-amber-300/20 dark:bg-white/10 dark:text-amber-100">
                  <CalendarDays className="size-4" strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-amber-950 dark:text-amber-100">
                    {artifact.title || '日程规划'}
                  </span>
                  <span className="mt-0.5 block text-amber-800/75 dark:text-amber-100/70">
                    {artifact.items.length} 个活动 · 点击查看这次规划
                  </span>
                </span>
                {completed ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-400/10 dark:text-emerald-100">
                    <CheckCircle2 className="size-3.5" />
                    已添加
                  </span>
                ) : null}
              </button>

              <Dialog
                open={openCalendarDraftId === artifact.id}
                onOpenChange={(open) => setOpenCalendarDraftId(open ? artifact.id : null)}
              >
                <DialogContent
                  overlayClassName={SYNTARA_WORKSPACE_DIALOG_OVERLAY_CLASS}
                  className={cn(
                    SYNTARA_WORKSPACE_DIALOG_CONTENT_CLASS,
                    'h-auto max-h-[min(720px,86dvh)] max-w-2xl',
                  )}
                >
                  <DialogHeader className={SYNTARA_DIALOG_HEADER_CLASS}>
                    <DialogTitle className="flex items-center gap-2 text-base">
                      <span className="grid size-8 place-items-center rounded-[10px] bg-amber-50 text-amber-700 ring-1 ring-amber-100 dark:bg-amber-400/10 dark:text-amber-100 dark:ring-amber-300/15">
                        <CalendarDays className="size-4" />
                      </span>
                      {artifact.title || '日程规划'}
                    </DialogTitle>
                    <DialogDescription>
                      只显示这一次生成的活动安排。添加后会进入当前课程的学习日历。
                    </DialogDescription>
                  </DialogHeader>
                  <CalendarDraftPreview
                    draft={artifact}
                    addAction={addAction}
                    completed={completed}
                    disabled={disabled}
                    isResearchCourse={Boolean(isResearchCourse)}
                    onAddToCalendar={onConfirmCalendarAction}
                    onClose={() => setOpenCalendarDraftId(null)}
                  />
                </DialogContent>
              </Dialog>
            </div>
          );
        }

        if (artifact.kind === 'image_prompt_draft') {
          return (
            <div
              key={artifact.id}
              className="rounded-lg border border-violet-100 bg-violet-50/70 px-3 py-2.5 text-xs dark:border-violet-300/15 dark:bg-violet-400/10"
            >
              <p className="font-semibold text-violet-950 dark:text-violet-100">图片草稿</p>
              <p className="mt-1 line-clamp-3 text-violet-800/80 dark:text-violet-100/75">
                {artifact.prompt}
              </p>
              {artifact.imageUrl ? (
                <img
                  src={artifact.imageUrl}
                  alt="生成的学习图片"
                  className="mt-2 max-h-72 rounded-lg border border-white/70 object-contain shadow-sm dark:border-white/10"
                />
              ) : null}
            </div>
          );
        }

        if (artifact.kind === 'activity_plan') {
          return (
            <div
              key={artifact.id}
              className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-2.5 text-xs dark:border-emerald-300/15 dark:bg-emerald-400/10"
            >
              <p className="font-semibold text-emerald-950 dark:text-emerald-100">
                {artifact.title}
              </p>
              <div className="mt-2 space-y-1">
                {artifact.tasks.slice(0, 4).map((task, index) => (
                  <p key={`${artifact.id}-${index}`} className="text-emerald-800/85">
                    {task.title}
                    {task.minutes ? ` · ${task.minutes} 分钟` : ''}
                  </p>
                ))}
              </div>
            </div>
          );
        }

        if (artifact.kind === 'answer_evidence') {
          return (
            <details
              key={artifact.id}
              className="group rounded-lg border border-indigo-100 bg-indigo-50/45 px-3 py-2 text-xs dark:border-indigo-300/15 dark:bg-indigo-400/10"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-indigo-900 dark:text-indigo-100">
                <span className="min-w-0 truncate font-medium">
                  {artifact.title || '本次回答证据'} · {artifact.sources.length} 个来源
                </span>
                <span className="shrink-0 text-[11px] text-indigo-700/70 group-open:hidden dark:text-indigo-100/60">
                  展开
                </span>
                <span className="hidden shrink-0 text-[11px] text-indigo-700/70 group-open:inline dark:text-indigo-100/60">
                  收起
                </span>
              </summary>
              {artifact.usedFor ? (
                <p className="mt-2 line-clamp-2 text-indigo-800/70 dark:text-indigo-100/65">
                  {artifact.usedFor}
                </p>
              ) : null}
              <div className="mt-2 space-y-1.5">
                {artifact.sources.slice(0, 4).map((source) => (
                  <AnswerEvidenceSourceCard
                    key={`${artifact.id}-${source.sourceType}-${source.id || source.sourceId || source.title}`}
                    artifactId={artifact.id}
                    source={source}
                    courseId={courseId}
                    disabled={disabled}
                  />
                ))}
              </div>
            </details>
          );
        }

        if (artifact.kind === 'review_plan') {
          const learningGoal = payloadString(artifact.learningGoal);
          const focusPoints = Array.isArray(artifact.focusPoints)
            ? artifact.focusPoints.map((item) => payloadRecord(item)).slice(0, 3)
            : [];
          const selfChecks = Array.isArray(artifact.selfChecks)
            ? artifact.selfChecks.map((item) => payloadRecord(item)).slice(0, 3)
            : [];
          const practiceBridge = payloadRecord(artifact.practiceBridge);
          const practiceProblemIds = Array.isArray(practiceBridge.problemIds)
            ? practiceBridge.problemIds.map((item) => String(item)).filter(Boolean)
            : [];
          const nextSteps = Array.isArray(artifact.nextSteps)
            ? artifact.nextSteps
                .map((item) => String(item))
                .filter(Boolean)
                .slice(0, 3)
            : [];
          return (
            <div
              key={artifact.id}
              className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-3 text-xs dark:border-emerald-300/15 dark:bg-emerald-400/10"
            >
              <p className="font-semibold text-emerald-950 dark:text-emerald-100">
                {artifact.title}
              </p>
              {learningGoal ? (
                <p className="mt-1.5 text-emerald-900/75 dark:text-emerald-100/75">
                  {learningGoal}
                </p>
              ) : null}
              <div className="mt-2 space-y-1">
                {artifact.tasks.slice(0, 4).map((task, index) => (
                  <p key={`${artifact.id}-${index}`} className="text-emerald-800/85">
                    {task.title}
                    {task.minutes ? ` · ${task.minutes} 分钟` : ''}
                  </p>
                ))}
              </div>
              {focusPoints.length ? (
                <div className="mt-3 border-t border-emerald-200/70 pt-2 dark:border-emerald-200/10">
                  <p className="font-semibold text-emerald-950 dark:text-emerald-100">
                    先过这几个点
                  </p>
                  <div className="mt-1.5 space-y-2">
                    {focusPoints.map((point, index) => (
                      <div key={`${artifact.id}-focus-${index}`}>
                        <p className="font-medium text-emerald-900 dark:text-emerald-100">
                          {payloadString(point.title) || `重点 ${index + 1}`}
                        </p>
                        {payloadString(point.explanation) ? (
                          <p className="mt-0.5 text-emerald-800/75 dark:text-emerald-100/65">
                            {payloadString(point.explanation)}
                          </p>
                        ) : null}
                        {payloadString(point.checkQuestion) ? (
                          <p className="mt-0.5 text-emerald-900/80 dark:text-emerald-100/75">
                            问自己：{payloadString(point.checkQuestion)}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {selfChecks.length ? (
                <div className="mt-3 border-t border-emerald-200/70 pt-2 dark:border-emerald-200/10">
                  <p className="font-semibold text-emerald-950 dark:text-emerald-100">小自测</p>
                  <div className="mt-1.5 space-y-2">
                    {selfChecks.map((check, index) => (
                      <div key={`${artifact.id}-check-${index}`}>
                        <p className="text-emerald-900 dark:text-emerald-100">
                          {index + 1}. {payloadString(check.question)}
                        </p>
                        {payloadString(check.expectedAnswer) ? (
                          <p className="mt-0.5 text-emerald-800/70 dark:text-emerald-100/60">
                            要点：{payloadString(check.expectedAnswer)}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {payloadString(practiceBridge.summary) || practiceProblemIds.length ? (
                <div className="mt-3 border-t border-emerald-200/70 pt-2 dark:border-emerald-200/10">
                  <p className="font-semibold text-emerald-950 dark:text-emerald-100">
                    {payloadString(practiceBridge.title) || '练习衔接'}
                  </p>
                  {payloadString(practiceBridge.summary) ? (
                    <p className="mt-0.5 text-emerald-800/75 dark:text-emerald-100/65">
                      {payloadString(practiceBridge.summary)}
                    </p>
                  ) : null}
                  {practiceProblemIds.length ? (
                    <p className="mt-0.5 text-emerald-800/75 dark:text-emerald-100/65">
                      题库可用：{practiceProblemIds.slice(0, 4).join('、')}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {nextSteps.length ? (
                <p className="mt-2 border-t border-emerald-200/70 pt-2 text-emerald-900/75 dark:border-emerald-200/10 dark:text-emerald-100/70">
                  下一步：{nextSteps.join('；')}
                </p>
              ) : null}
            </div>
          );
        }

        if (artifact.kind === 'memory_candidate') {
          return (
            <div
              key={artifact.id}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs dark:border-white/10 dark:bg-white/[0.04]"
            >
              <p className="font-semibold text-slate-900 dark:text-slate-100">记忆候选</p>
              <p className="mt-1 line-clamp-3 text-slate-500 dark:text-slate-400">
                {artifact.summary}
              </p>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

function LearnPublicTraceCard({
  steps,
  transient,
}: {
  steps?: LearnPublicTraceStep[];
  transient?: boolean;
}) {
  const displaySteps = transient ? steps : finalizePublicTraceSteps(steps);
  if (!displaySteps?.length) return null;
  const blockedStep = displaySteps.find((step) => step.status === 'blocked');
  const activeStep =
    blockedStep ||
    displaySteps.find((step) => step.status === 'waiting') ||
    displaySteps[displaySteps.length - 1];
  const completedCount = displaySteps.filter((step) => step.status === 'done').length;
  return (
    <div
      className={cn(
        'mb-2 flex items-start gap-2 rounded-[10px] border px-2.5 py-2 text-xs',
        blockedStep
          ? 'border-amber-200 bg-amber-50/70 dark:border-amber-300/15 dark:bg-amber-400/[0.07]'
          : 'border-sky-100 bg-sky-50/55 dark:border-sky-300/10 dark:bg-sky-400/[0.05]',
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full',
          blockedStep
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-400/10 dark:text-amber-100'
            : 'bg-white text-sky-700 shadow-sm ring-1 ring-sky-100 dark:bg-white/10 dark:text-sky-100 dark:ring-sky-300/10',
        )}
      >
        {blockedStep ? (
          <AlertTriangle className="size-3" strokeWidth={1.9} />
        ) : (
          <Loader2 className="size-3 animate-spin motion-reduce:animate-none" strokeWidth={1.9} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold text-slate-900 dark:text-slate-100">
            {activeStep.title}
          </p>
          {!blockedStep && completedCount > 0 ? (
            <span className="shrink-0 text-[10px] text-emerald-700 dark:text-emerald-200">
              {completedCount} 项已完成
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 line-clamp-2 leading-4 text-slate-600 dark:text-slate-300">
          {activeStep.detail}
        </p>
        {activeStep.evidence?.length ? (
          <p className="mt-1 truncate text-[10px] text-slate-500 dark:text-slate-400">
            {activeStep.evidence.slice(0, 3).join(' · ')}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function actionPayload(action: LearningAction): Record<string, unknown> {
  return action.payload && typeof action.payload === 'object' ? action.payload : {};
}

function payloadString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function actionSummary(action: LearningAction): string {
  const payload = actionPayload(action);
  return (
    payloadString(payload.summary) ||
    payloadString(payload.reason) ||
    action.summary ||
    action.label ||
    learnActionTitle(action)
  ).slice(0, 500);
}

function latestUserLearnMessageText(messages: LearnMessage[]): string {
  return (
    messages
      .slice()
      .reverse()
      .find((message) => message.role === 'user')
      ?.text.trim()
      .slice(0, 1000) || ''
  );
}

function memoryActionType(action: LearningAction): ConfirmedLearnerMemoryType {
  const value = payloadString(action.payload?.memoryType).toLowerCase();
  if (
    value === 'weakness' ||
    value === 'mastery' ||
    value === 'progress' ||
    value === 'preference' ||
    value === 'correction' ||
    value === 'next_step'
  ) {
    return value;
  }
  return 'other';
}

function memoryActionConcept(action: LearningAction, summary: string): string {
  const payload = actionPayload(action);
  const concepts = Array.isArray(payload.concepts)
    ? payload.concepts.map((value) => payloadString(value)).filter(Boolean)
    : [];
  return (
    payloadString(payload.knowledgePoint) ||
    payloadString(payload.concept) ||
    concepts[0] ||
    payloadString(payload.title) ||
    summary.slice(0, 64)
  );
}

function memoryActionStructuredText(action: LearningAction, summary: string): string {
  const payload = actionPayload(action);
  const lines = [
    payloadString(payload.knowledgePoint) || payloadString(payload.concept)
      ? `知识点：${payloadString(payload.knowledgePoint) || payloadString(payload.concept)}`
      : '',
    payloadString(payload.masteredSignal) ? `掌握：${payloadString(payload.masteredSignal)}` : '',
    payloadString(payload.stuckPoint) || payloadString(payload.weakness)
      ? `薄弱：${payloadString(payload.stuckPoint) || payloadString(payload.weakness)}`
      : '',
    payloadString(payload.cause) || payloadString(payload.probableCause)
      ? `原因：${payloadString(payload.cause) || payloadString(payload.probableCause)}`
      : '',
    payloadString(payload.nextTeachingMove) || payloadString(payload.nextStep)
      ? `下一步：${payloadString(payload.nextTeachingMove) || payloadString(payload.nextStep)}`
      : '',
  ].filter(Boolean);
  const normalizedSummary = summary.trim();
  if (normalizedSummary && lines.length && !lines.join('\n').includes(normalizedSummary)) {
    lines.push(`补充：${normalizedSummary}`);
  }
  return lines.length ? lines.join('\n') : normalizedSummary;
}

function memoryCorrectionMode(
  action: LearningAction,
  summary: string,
): LearnerMemoryCorrectionMode {
  const payload = actionPayload(action);
  const explicit = [
    payloadString(payload.correctedMemoryType),
    payloadString(payload.correctedState),
    payloadString(payload.correctionType),
    payloadString(payload.status),
  ]
    .join(' ')
    .toLowerCase();
  const evidence = `${explicit}\n${summary}`;
  if (
    /(?:不是|并非|并不是|不代表).{0,12}(?:不会|不懂|不熟|不掌握)|(?:我|学生).{0,12}(?:会|懂|掌握).{0,24}(?:只是|但|不过)/i.test(
      evidence,
    )
  ) {
    return 'mastery';
  }
  if (
    /(?:not[_\s-]?mastered|not[_\s-]?understood|weakness|weak|不会|不懂|不熟|不掌握|没有掌握|薄弱|仍然?错|还是错)/i.test(
      evidence,
    )
  ) {
    return 'weakness';
  }
  if (
    /(?:mastery|mastered|understood|stable|掌握|会了|已经会|已经懂|不是.{0,8}(?:不会|不懂)|只(?:是|不过).{0,20}(?:粗心|忘记|不稳定))/i.test(
      evidence,
    )
  ) {
    return 'mastery';
  }
  return 'resolve';
}

function memoryActionContentType(memoryType: string): MemoryWriteContentType {
  if (memoryType === 'weakness' || memoryType === 'correction') return 'weakness';
  return 'learning_pattern';
}

function memoryActionStudyKind(memoryType: string): string {
  if (memoryType === 'weakness' || memoryType === 'correction') return 'knowledge_gap';
  if (memoryType === 'preference') return 'preference';
  if (memoryType === 'mastery') return 'mastery';
  if (memoryType === 'progress') return 'progress';
  if (memoryType === 'next_step') return 'next_teaching_move';
  return 'reflection';
}

function memoryActionTitle(action: LearningAction): string {
  const payload = actionPayload(action);
  return (
    payloadString(payload.title) ||
    payloadString(payload.label) ||
    action.label ||
    'AI 确认的学习记忆'
  ).slice(0, 120);
}

function stableLearningActionCandidateId(actionId: string): string {
  let hash = BigInt('0xcbf29ce484222325');
  const prime = BigInt('0x100000001b3');
  for (let index = 0; index < actionId.length; index += 1) {
    hash ^= BigInt(actionId.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return `learn-action:${hash.toString(16).padStart(16, '0')}`;
}

function memoryWriteCandidateFromLearningAction(args: {
  action: LearningAction;
  courseId: string;
  conversationId: string;
  summary: string;
}): MemoryWriteCandidate {
  const memoryType = memoryActionType(args.action);
  const title = memoryActionTitle(args.action);
  const reason =
    payloadString(args.action.payload?.reason) ||
    payloadString(args.action.payload?.cause) ||
    payloadString(args.action.payload?.probableCause) ||
    '学生在课程聊天里确认了这条学习记忆，后续讲解、复习和练习选择应参考它。';
  return {
    id: stableLearningActionCandidateId(args.action.id),
    trigger: memoryType === 'correction' ? 'fact_correction' : 'explicit_user',
    contentType: memoryActionContentType(memoryType),
    targetType: 'course',
    targetId: args.courseId,
    conversationId: args.conversationId,
    privacy: 'private',
    title,
    text: args.summary,
    source: 'learn.learning_action',
    sourceRef: {
      actionId: args.action.id,
      actionKind: args.action.kind,
      memoryType,
      evidence: args.action.evidence || args.action.payload?.evidence || null,
      knowledgePoint: args.action.payload?.knowledgePoint || args.action.payload?.concept || null,
      masteredSignal: args.action.payload?.masteredSignal || null,
      stuckPoint: args.action.payload?.stuckPoint || args.action.payload?.weakness || null,
      cause: args.action.payload?.cause || args.action.payload?.probableCause || null,
      nextTeachingMove:
        args.action.payload?.nextTeachingMove || args.action.payload?.nextStep || null,
    },
    studyMemory: {
      targetType: 'course',
      targetId: args.courseId,
      scope: 'private',
      kind: memoryActionStudyKind(memoryType),
      title,
      text: args.summary,
      reason,
      sourceReferences: [
        {
          order: 1,
          title: `课程对话中的已确认记忆操作 ${args.action.id}`,
          why: reason,
          source: 'learn.learning_action',
          actionId: args.action.id,
          conversationId: args.conversationId,
          memoryType,
          evidence: args.action.evidence || args.action.payload?.evidence || null,
          knowledgePoint:
            args.action.payload?.knowledgePoint || args.action.payload?.concept || null,
          masteredSignal: args.action.payload?.masteredSignal || null,
          stuckPoint: args.action.payload?.stuckPoint || args.action.payload?.weakness || null,
          cause: args.action.payload?.cause || args.action.payload?.probableCause || null,
          nextTeachingMove:
            args.action.payload?.nextTeachingMove || args.action.payload?.nextStep || null,
        },
      ],
    },
  };
}

function learningActionPreferredConcepts(action: LearningAction): string[] {
  const payload = actionPayload(action);
  const concepts = Array.isArray(payload.concepts) ? payload.concepts : [];
  return concepts
    .map((item) => payloadString(item))
    .filter(Boolean)
    .slice(0, 8);
}

export function LearnPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSessionId = searchParams.get('session')?.trim() || '';
  const urlCourseId = searchParams.get('courseId')?.trim() || '';
  const debugNoCourses = searchParams.get('debugNoCourses') === '1';
  const previewLearnHome =
    process.env.NODE_ENV !== 'production' && searchParams.get('previewLearnHome') === '1';
  const platformMemoryStatusMockMode = platformMemoryStatusMockModeFromValue(
    searchParams.get(PLATFORM_MEMORY_STATUS_MOCK_QUERY_PARAM),
  );
  const imageInputRef = useRef<HTMLInputElement>(null);
  const sourceDocumentInputRef = useRef<HTMLInputElement>(null);
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null);
  const conversationScrollContainerRef = useRef<HTMLDivElement>(null);
  const conversationShouldStickToBottomRef = useRef(true);
  const syllabusInputRef = useRef<HTMLInputElement>(null);
  const sourceUploadPanelOpenRef = useRef(false);
  const platformMemoryStatusMockTimersRef = useRef<number[]>([]);
  const appliedPlatformMemoryStatusMockModeRef = useRef<PlatformMemoryStatusMockMode>('off');
  const lastSyncedConversationRef = useRef('');
  const lastPersistedMessagesRef = useRef<{
    key: string;
    messages: LearnMessage[];
  }>({ key: '', messages: [] });
  const activeMessageStoreKeyRef = useRef('');
  const activeMessagesRef = useRef<{ key: string; messages: LearnMessage[] } | null>(null);
  const dirtyConversationMessagesRef = useRef(
    new Map<string, Map<string, RemoteLearnMessagePayload>>(),
  );
  const pendingDeletedSessionKeysRef = useRef(new Set<string>());
  const learnSessionsRef = useRef<LearnChatSession[]>([]);
  const composerSessionKeyRef = useRef<{
    key: string;
    userId: string;
    courseId: string;
    sessionId: string;
  } | null>(null);
  const composerDraftRef = useRef('');
  const composerAttachmentsRef = useRef<LearnImageAttachment[]>([]);
  const composerAttachmentsBySessionRef = useRef(new Map<string, LearnImageAttachment[]>());
  const hydratedAttachmentUrlsRef = useRef(new Set<string>());
  const learningActionExecutionIdsRef = useRef(new Set<string>());
  const problemsLoadStateRef = useRef<ResourceLoadState>(emptyResourceLoadState());
  const notebooksLoadStateRef = useRef<ResourceLoadState>(emptyResourceLoadState());
  const problemsHydrationWantedRef = useRef(false);
  const notebooksHydrationWantedRef = useRef(false);
  const sendRequestRef = useRef<{
    key: string;
    controller: AbortController;
    timeoutId: number;
    stoppedByUser: boolean;
  } | null>(null);
  const problemLoadPromiseRef = useRef<{
    courseId: string;
    promise: Promise<CourseProblemClientSummary[]>;
  } | null>(null);
  const notebookLoadPromiseRef = useRef<{
    courseId: string;
    promise: Promise<StageListItem[]>;
  } | null>(null);
  const problemHydrationAbortRef = useRef<AbortController | null>(null);
  const notebookHydrationAbortRef = useRef<AbortController | null>(null);
  // A connection-limited deployment cannot safely absorb one independent
  // queue per surface. Every database-backed course read shares this tail, so
  // the initial metadata, resource hydration, and deferred reconciliation
  // phases never occupy more than one server connection from this tab.
  const learnDatabaseQueueTailRef = useRef<Promise<void>>(Promise.resolve());
  const progressSavePromiseRef = useRef<{
    courseId: string;
    promise: Promise<boolean>;
  } | null>(null);
  const courseAssetCacheRef = useRef(new Map<string, CourseAssetCacheEntry>());
  const courseContentStateRef = useRef(new Map<string, CourseContentState>());
  const courseContentRepairRef = useRef(new Map<string, string>());
  const courseContentRepairRetryRef = useRef(new Map<string, CourseContentRepairRetry>());
  const courseContentMutationHotUntilRef = useRef(new Map<string, number>());
  const activeCourseIdRef = useRef<string | null>(null);
  const activeCourseBootKeyRef = useRef('');
  const learnSessionListCourseIdRef = useRef<string | null>(null);
  const authHydrated = usePersistHydrated(useAuthStore);
  const courseHydrated = usePersistHydrated(useCurrentCourseStore);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const userId = useAuthStore((state) => state.userId);
  const userName = useAuthStore((state) => state.name);
  const portalRole = useAuthStore((state) => state.role);
  const storedCourseId = useCurrentCourseStore((state) => state.id);
  const storedCourseName = useCurrentCourseStore((state) => state.name);
  const storedCourseAvatarUrl = useCurrentCourseStore((state) => state.avatarUrl);
  const setCurrentCourse = useCurrentCourseStore((state) => state.setCurrentCourse);
  const clearCurrentCourse = useCurrentCourseStore((state) => state.clearCurrentCourse);

  const providerId = useSettingsStore((state) => state.providerId);
  const modelId = useSettingsStore((state) => state.modelId);
  const providersConfig = useSettingsStore((state) => state.providersConfig);
  const pdfProviderId = useSettingsStore((state) => state.pdfProviderId);
  const pdfProvidersConfig = useSettingsStore((state) => state.pdfProvidersConfig);
  const webSearchProviderId = useSettingsStore((state) => state.webSearchProviderId);
  const webSearchProvidersConfig = useSettingsStore((state) => state.webSearchProvidersConfig);
  const imageGenerationEnabled = useSettingsStore((state) => state.imageGenerationEnabled);
  const imageProviderId = useSettingsStore((state) => state.imageProviderId);
  const imageModelId = useSettingsStore((state) => state.imageModelId);
  const imageProvidersConfig = useSettingsStore((state) => state.imageProvidersConfig);
  const setModel = useSettingsStore((state) => state.setModel);
  const fetchServerProviders = useSettingsStore((state) => state.fetchServerProviders);
  const memoryActivities = useMemoryActivityStore((state) => state.activities);
  const memoryHistoryRecords = useTaskHistoryStore((state) => state.records);

  const [courses, setCourses] = useState<CourseRecord[]>(() =>
    urlCourseId
      ? [
          courseShellFromUrl(urlCourseId, {
            id: storedCourseId,
            name: storedCourseName,
            avatarUrl: storedCourseAvatarUrl,
          }),
        ]
      : [],
  );
  const [coursesLoadState, setCoursesLoadState] = useState<LoadState>(() =>
    urlCourseId ? 'ready' : 'idle',
  );
  const [courseLoadError, setCourseLoadError] = useState<string | null>(null);
  const [courseLoadAttempt, setCourseLoadAttempt] = useState(0);
  const [activeCourseId, setActiveCourseId] = useState<string | null>(() => urlCourseId || null);
  const [notebooks, setNotebooks] = useState<StageListItem[]>([]);
  const [problems, setProblems] = useState<CourseProblemClientSummary[]>([]);
  const [notebooksLoadState, setNotebooksLoadState] =
    useState<ResourceLoadState>(emptyResourceLoadState);
  const [problemsLoadState, setProblemsLoadState] =
    useState<ResourceLoadState>(emptyResourceLoadState);
  const [problemsHydrationWanted, setProblemsHydrationWanted] = useState(false);
  const [notebooksHydrationWanted, setNotebooksHydrationWanted] = useState(false);
  const [sourcesLoadState, setSourcesLoadState] =
    useState<ResourceLoadState>(emptyResourceLoadState);
  const [resourceLoadAttempts, setResourceLoadAttempts] = useState<
    Record<CourseResourceKind, number>
  >({ notebooks: 0, problems: 0, sources: 0 });
  const [snapshot, setSnapshot] = useState<LearnerCourseSnapshot | null>(null);
  const [progressSelection, setProgressSelection] = useState('');
  const [recentPlanCandidates, setRecentPlans] = useState<PracticePlan[]>([]);
  const [practiceSessionCandidates, setPracticeSessions] = useState<PracticeSession[]>([]);
  const [practicePopupSessionId, setPracticePopupSessionId] = useState<string | null>(null);
  const [practiceHeaderState, setPracticeHeaderState] =
    useState<CourseProblemPracticeHeaderState | null>(null);
  const [practiceProblemHelp, setPracticeProblemHelp] = useState<PracticeProblemHelpState | null>(
    null,
  );
  const [practiceProblemHelpTabProblemId, setPracticeProblemHelpTabProblemId] = useState<
    string | null
  >(null);
  const [practiceProblemHelpTabActive, setPracticeProblemHelpTabActive] = useState(false);
  const [syllabusImportMessage, setSyllabusImportMessage] = useState<string | null>(null);
  const [syllabusDialogOpen, setSyllabusDialogOpen] = useState(false);
  const [courseFilesDialogOpen, setCourseFilesDialogOpen] = useState(false);
  const [createCourseOpen, setCreateCourseOpen] = useState(false);
  const [courseSettingsOpen, setCourseSettingsOpen] = useState(false);
  const [courseSettingsTab, setCourseSettingsTab] = useState<'general' | 'danger'>('general');
  const [syllabusImportMode, setSyllabusImportMode] = useState<SyllabusImportMode>('file');
  const [syllabusCommitMode, setSyllabusCommitMode] = useState<SyllabusCommitMode>('merge');
  const [syllabusImportLoading, setSyllabusImportLoading] = useState(false);
  const [syllabusDraftEvents, setSyllabusDraftEvents] = useState<SyllabusCalendarEvent[]>([]);
  const [syllabusDraftSourceName, setSyllabusDraftSourceName] = useState('');
  const [syllabusPlanDraft, setSyllabusPlanDraft] = useState('');
  const [manualScheduleDialogOpen, setManualScheduleDialogOpen] = useState(false);
  const [manualScheduleTitle, setManualScheduleTitle] = useState('');
  const [manualScheduleDate, setManualScheduleDate] = useState(() => localDayKey(new Date()));
  const [manualScheduleKind, setManualScheduleKind] = useState<SyllabusEventKind>('assignment');
  const [manualScheduleError, setManualScheduleError] = useState<string | null>(null);
  const [keyedMessagesState, setKeyedMessagesState] = useState<{
    key: string;
    messages: LearnMessage[];
  }>({ key: '', messages: [] });
  const messageStoreKey = keyedMessagesState.key;
  const messages = keyedMessagesState.messages;
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<LearnImageAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [retryTurn, setRetryTurn] = useState<LearnRetryTurn | null>(null);
  const [sourceUploadingCourseId, setSourceUploadingCourseId] = useState<string | null>(null);
  const [sourceUploadPanelOpen, setSourceUploadPanelOpen] = useState(false);
  const [notebookLibraryPanelOpen, setNotebookLibraryPanelOpen] = useState(false);
  const [notebookLibraryQuery, setNotebookLibraryQuery] = useState('');
  const [selectedNotebookLibraryTileId, setSelectedNotebookLibraryTileId] = useState<string | null>(
    null,
  );
  const [sourceUploadItems, setSourceUploadItems] = useState<LearnSourceUploadItem[]>([]);
  const [selectedSourceLibraryTileId, setSelectedSourceLibraryTileId] = useState<string | null>(
    null,
  );
  const [sourceLibraryDetailView, setSourceLibraryDetailView] =
    useState<SourceLibraryDetailView>('image');
  const [sourceLibraryImageExpanded, setSourceLibraryImageExpanded] = useState(false);
  const [deletingSourceHashes, setDeletingSourceHashes] = useState<string[]>([]);
  const [reindexingSourceHashes, setReindexingSourceHashes] = useState<string[]>([]);
  const [sourceLibraryTextCache, setSourceLibraryTextCache] = useState<
    Record<string, SourceLibraryTextState>
  >({});
  const [notebookMarkdownPageCache, setNotebookMarkdownPageCache] = useState<
    Record<string, NotebookMarkdownPageState>
  >({});
  const [notebookMarkdownSectionCache, setNotebookMarkdownSectionCache] = useState<
    Record<string, SourceLibraryTextState>
  >({});
  const [selectedNotebookSectionIds, setSelectedNotebookSectionIds] = useState<
    Record<string, string>
  >({});
  const [notebookImagePreviewCache, setNotebookImagePreviewCache] = useState<
    Record<string, NotebookImagePreviewState>
  >({});
  const [courseSourceUploads, setCourseSourceUploads] = useState<CourseSourceUploadRecord[]>([]);
  const [completedSourceUploadBadge, setCompletedSourceUploadBadge] = useState<{
    courseId: string | null;
    count: number;
  }>({ courseId: null, count: 0 });
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishingCourse, setPublishingCourse] = useState(false);
  const [publishableMemoryCount, setPublishableMemoryCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [learnSessions, setLearnSessions] = useState<LearnChatSession[]>([]);
  learnSessionsRef.current = learnSessions;
  const [learnSessionListState, setLearnSessionListState] = useState<LearnSessionListState>({
    courseId: null,
    totalCount: 0,
    hasMore: false,
    nextCursor: null,
    loading: false,
    loadingMore: false,
    error: null,
  });
  const [allSessionsDialogOpen, setAllSessionsDialogOpen] = useState(false);
  const [deletingLearnSessionIds, setDeletingLearnSessionIds] = useState<string[]>([]);
  const [pendingDeleteLearnSession, setPendingDeleteLearnSession] =
    useState<LearnChatSession | null>(null);
  const [localConversationReadyKey, setLocalConversationReadyKey] = useState('');
  const [remoteConversationReadyKey, setRemoteConversationReadyKey] = useState('');
  const [remoteConversationSummaryState, setRemoteConversationSummaryState] = useState<{
    key: string;
    summary: RemoteLearnConversationSummary;
  } | null>(null);
  const [remoteConversationMessagePageState, setRemoteConversationMessagePageState] =
    useState<LearnConversationMessagePageState | null>(null);
  const [remoteConversationLoadError, setRemoteConversationLoadError] = useState<string | null>(
    null,
  );
  const [remoteConversationLoadAttempt, setRemoteConversationLoadAttempt] = useState(0);
  const [remoteConversationSyncAttempt, setRemoteConversationSyncAttempt] = useState(0);
  const [remoteConversationSyncError, setRemoteConversationSyncError] = useState<string | null>(
    null,
  );
  const [learnSessionListRefreshAttempt, setLearnSessionListRefreshAttempt] = useState(0);
  const [initialBootSettledKey, setInitialBootSettledKey] = useState('');
  const [courseContentWatchError, setCourseContentWatchError] = useState<{
    courseId: string;
    message: string;
  } | null>(null);
  const [courseContentWatchAttempt, setCourseContentWatchAttempt] = useState(0);
  const [courseContentStateRevision, setCourseContentStateRevision] = useState('');
  activeCourseIdRef.current = activeCourseId;
  learnSessionListCourseIdRef.current = learnSessionListState.courseId;

  const retryCourseResource = useCallback((kind: CourseResourceKind) => {
    if (kind === 'problems') setProblemsHydrationWanted(true);
    if (kind === 'notebooks') setNotebooksHydrationWanted(true);
    setResourceLoadAttempts((current) => ({
      ...current,
      [kind]: current[kind] + 1,
    }));
  }, []);

  const enqueueInitialLearnBootRequest = useCallback(
    async <T,>(args: { key: string; request: () => Promise<T> }): Promise<T> => {
      const previous = learnDatabaseQueueTailRef.current.catch(() => undefined);
      let releaseQueue: () => void = () => undefined;
      const currentGate = new Promise<void>((resolve) => {
        releaseQueue = resolve;
      });
      learnDatabaseQueueTailRef.current = previous.then(() => currentGate);

      await previous;
      if (activeCourseBootKeyRef.current !== args.key) {
        releaseQueue();
        throw new DOMException('学习会话已切换', 'AbortError');
      }

      try {
        return await args.request();
      } catch (requestError) {
        if (courseResourceQueueErrorNeedsCooldown(requestError)) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, COURSE_RESOURCE_QUEUE_ABORT_COOLDOWN_MS);
          });
        }
        throw requestError;
      } finally {
        releaseQueue();
      }
    },
    [],
  );

  const enqueueCourseResourceRequest = useCallback(
    async <T,>(args: {
      courseId: string;
      kind: CourseResourceKind;
      signal: AbortSignal;
      request: () => Promise<T>;
    }): Promise<T> => {
      const previous = learnDatabaseQueueTailRef.current.catch(() => undefined);
      let releaseQueue: () => void = () => undefined;
      const currentGate = new Promise<void>((resolve) => {
        releaseQueue = resolve;
      });
      learnDatabaseQueueTailRef.current = previous.then(() => currentGate);

      await previous;
      if (args.signal.aborted || activeCourseIdRef.current !== args.courseId) {
        releaseQueue();
        throw args.signal.reason instanceof Error
          ? args.signal.reason
          : new DOMException(`${args.kind} 加载已取消`, 'AbortError');
      }

      let releaseDeferred = false;
      try {
        return await args.request();
      } catch (requestError) {
        if (courseResourceQueueErrorNeedsCooldown(requestError)) {
          releaseDeferred = true;
          window.setTimeout(releaseQueue, COURSE_RESOURCE_QUEUE_ABORT_COOLDOWN_MS);
        }
        throw requestError;
      } finally {
        if (!releaseDeferred) releaseQueue();
      }
    },
    [],
  );

  const enqueueDeferredLearnDataRequest = useCallback(
    async <T,>(args: { courseId: string; request: () => Promise<T> }): Promise<T> => {
      const previous = learnDatabaseQueueTailRef.current.catch(() => undefined);
      let releaseQueue: () => void = () => undefined;
      const currentGate = new Promise<void>((resolve) => {
        releaseQueue = resolve;
      });
      learnDatabaseQueueTailRef.current = previous.then(() => currentGate);

      await previous;
      if (activeCourseIdRef.current !== args.courseId) {
        releaseQueue();
        throw new DOMException('课程已切换', 'AbortError');
      }

      let releaseDeferred = false;
      try {
        return await args.request();
      } catch (requestError) {
        if (courseResourceQueueErrorNeedsCooldown(requestError)) {
          releaseDeferred = true;
          window.setTimeout(releaseQueue, COURSE_RESOURCE_QUEUE_ABORT_COOLDOWN_MS);
        }
        throw requestError;
      } finally {
        if (!releaseDeferred) releaseQueue();
      }
    },
    [],
  );

  const clearCourseContentRepairRetry = useCallback(
    (courseId: string, kind: CourseResourceKind) => {
      const repairKey = `${courseId}:${kind}`;
      const pendingRetry = courseContentRepairRetryRef.current.get(repairKey);
      if (pendingRetry?.timerId != null) window.clearTimeout(pendingRetry.timerId);
      courseContentRepairRetryRef.current.delete(repairKey);
      courseContentRepairRef.current.delete(repairKey);
    },
    [],
  );

  const scheduleCourseContentRepairRetry = useCallback(
    (courseId: string, kind: CourseResourceKind) => {
      const expectedState = courseContentStateRef.current.get(courseId);
      if (!expectedState) return;
      const repairKey = `${courseId}:${kind}`;
      const actualRevision = cachedCourseResourceRevision(
        kind,
        courseAssetCacheRef.current.get(courseId),
      );
      const signature = `${expectedState[kind].revision}|${actualRevision ?? 'missing'}`;
      const previousRetry = courseContentRepairRetryRef.current.get(repairKey);
      if (previousRetry?.signature === signature && previousRetry.timerId !== null) return;

      courseContentRepairRef.current.delete(repairKey);
      const failures = previousRetry?.signature === signature ? previousRetry.failures + 1 : 1;
      if (failures > COURSE_CONTENT_REPAIR_RETRY_MAX_FAILURES) return;
      const delayMs = Math.min(
        COURSE_CONTENT_REPAIR_RETRY_MAX_MS,
        COURSE_CONTENT_REPAIR_RETRY_BASE_MS * 2 ** (failures - 1),
      );
      const timerId = window.setTimeout(() => {
        const currentRetry = courseContentRepairRetryRef.current.get(repairKey);
        if (!currentRetry || currentRetry.signature !== signature) return;
        courseContentRepairRetryRef.current.set(repairKey, {
          ...currentRetry,
          timerId: null,
        });
        if (activeCourseIdRef.current !== courseId) return;
        setResourceLoadAttempts((current) => ({
          ...current,
          [kind]: current[kind] + 1,
        }));
      }, delayMs);
      courseContentRepairRetryRef.current.set(repairKey, {
        signature,
        failures,
        timerId,
      });
    },
    [],
  );

  const markCourseContentMutation = useCallback((courseId: string) => {
    courseContentMutationHotUntilRef.current.set(
      courseId,
      Date.now() + COURSE_CONTENT_STATE_HOT_WINDOW_MS,
    );
    if (activeCourseIdRef.current === courseId) {
      setCourseContentWatchAttempt((current) => current + 1);
    }
  }, []);

  const replaceMessagesFromRead = useCallback(
    (key: string, action: SetStateAction<LearnMessage[]>) => {
      if (activeMessageStoreKeyRef.current !== key) return;
      const current =
        activeMessagesRef.current?.key === key ? activeMessagesRef.current.messages : [];
      const next =
        typeof action === 'function'
          ? (action as (messages: LearnMessage[]) => LearnMessage[])(current)
          : action;
      activeMessagesRef.current = { key, messages: next };
      setKeyedMessagesState({ key, messages: next });
    },
    [],
  );
  const setMessages = useCallback((action: SetStateAction<LearnMessage[]>) => {
    const key = activeMessageStoreKeyRef.current;
    const current =
      activeMessagesRef.current?.key === key ? activeMessagesRef.current.messages : [];
    const next =
      typeof action === 'function'
        ? (action as (messages: LearnMessage[]) => LearnMessage[])(current)
        : action;
    if (key) {
      const currentById = new Map(current.map((message) => [message.id, message]));
      const dirtyById =
        dirtyConversationMessagesRef.current.get(key) ??
        new Map<string, RemoteLearnMessagePayload>();
      for (const message of next) {
        if (message.transient) continue;
        const payload = learnMessageToRemotePayload(message);
        const previous = currentById.get(message.id);
        if (
          !previous ||
          previous.transient ||
          !remoteLearnMessagePayloadEqual(learnMessageToRemotePayload(previous), payload)
        ) {
          dirtyById.set(message.id, payload);
        }
      }
      if (dirtyById.size > 0) dirtyConversationMessagesRef.current.set(key, dirtyById);
    }
    activeMessagesRef.current = { key, messages: next };
    setKeyedMessagesState({ key, messages: next });
  }, []);
  const clearMessagesFromRead = useCallback(() => {
    activeMessagesRef.current = null;
    setKeyedMessagesState({ key: '', messages: [] });
  }, []);
  const [leftRailCollapsed, setLeftRailCollapsed] = useState(() =>
    getInitialLearnRailCollapsed(LEARN_LEFT_RAIL_COLLAPSED_STORAGE_KEY),
  );
  const [rightRailCollapsed, setRightRailCollapsed] = useState(() =>
    getInitialLearnRailCollapsed(LEARN_RIGHT_RAIL_COLLAPSED_STORAGE_KEY),
  );
  const [rightRailView, setRightRailView] = useState<LearnRightRailView>('overview');
  const [calendarDialogOpen, setCalendarDialogOpen] = useState(false);
  const [memoryActivityDialogOpen, setMemoryActivityDialogOpen] = useState(false);
  const [calendarReferenceDate, setCalendarReferenceDate] = useState(() => new Date());
  const [miniLectureOpen, setMiniLectureOpen] = useState(false);
  const [activeMiniLectureDeck, setActiveMiniLectureDeck] = useState<MiniLectureDeck | null>(null);
  const [generatingMiniLectureMessageId, setGeneratingMiniLectureMessageId] = useState<
    string | null
  >(null);

  const hydrated = authHydrated && courseHydrated;
  const localUserId = userId || 'anonymous';
  const canManageCourseContent = portalRole === 'TEACHER' || portalRole === 'ADMIN';
  const teacherChatMode = searchParams.get('from') === 'teacher';
  const studentPreviewMode = searchParams.get('asStudent') === '1';
  const isTeacherCourseChat = !studentPreviewMode && (canManageCourseContent || teacherChatMode);
  const isStudentCourseChat = !isTeacherCourseChat;
  // 学生在课程聊天内继续使用课程工具侧栏；教师聊天保持精简的双栏布局。
  const showRightRail = isStudentCourseChat;
  const draftSessionId = useMemo(
    () => makeLearnSessionId(`${localUserId}:${urlCourseId}`),
    [localUserId, urlCourseId],
  );
  const activeSessionId = urlSessionId || draftSessionId;
  const showLearnHomeDashboard = !urlCourseId && !urlSessionId && !debugNoCourses;
  const activeMessageStoreKey =
    activeCourseId && activeCourseId === urlCourseId
      ? `${localUserId}:${activeCourseId}:${activeSessionId}`
      : '';
  const visibleMessages = useMemo(
    () => (messageStoreKey === activeMessageStoreKey && activeMessageStoreKey ? messages : []),
    [activeMessageStoreKey, messageStoreKey, messages],
  );
  const handleConversationScroll = useCallback(() => {
    const container = conversationScrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    conversationShouldStickToBottomRef.current = distanceFromBottom < 120;
  }, []);
  useEffect(() => {
    const container = conversationScrollContainerRef.current;
    if (!container || !conversationShouldStickToBottomRef.current) return;
    const frameId = window.requestAnimationFrame(() => {
      const current = conversationScrollContainerRef.current;
      if (!current || !conversationShouldStickToBottomRef.current) return;
      current.scrollTop = current.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [sending, visibleMessages]);
  const railLearnSessions = useMemo(() => {
    const recent = learnSessions.slice(0, 5);
    if (!activeSessionId || recent.some((session) => session.id === activeSessionId)) return recent;
    const activeSession = learnSessions.find((session) => session.id === activeSessionId);
    return activeSession ? [...recent.slice(0, 4), activeSession] : recent;
  }, [activeSessionId, learnSessions]);
  const remoteConversationSummary =
    remoteConversationSummaryState?.key === activeMessageStoreKey
      ? remoteConversationSummaryState.summary
      : null;
  const remoteConversationMessagePage =
    remoteConversationMessagePageState?.key === activeMessageStoreKey
      ? remoteConversationMessagePageState
      : null;
  const activeCourseBootKey = activeCourseId ? `${localUserId}:${activeCourseId}` : '';
  activeCourseBootKeyRef.current = activeCourseBootKey;
  const conversationInteractive =
    Boolean(activeMessageStoreKey) && localConversationReadyKey === activeMessageStoreKey;
  const initialBootSettled = Boolean(
    activeCourseBootKey && initialBootSettledKey === activeCourseBootKey,
  );
  const conversationFallbackActive =
    conversationInteractive && Boolean(remoteConversationLoadError || remoteConversationSyncError);
  const sourceUploading = sourceUploadingCourseId === activeCourseId;
  const activeSourceUploadItems = useMemo(
    () => sourceUploadItems.filter((item) => item.courseId === activeCourseId),
    [activeCourseId, sourceUploadItems],
  );
  const activeCourseSourceUploads = useMemo(
    () => courseSourceUploads.filter((upload) => upload.courseId === activeCourseId),
    [activeCourseId, courseSourceUploads],
  );
  const completedSourceUploadBadgeCount =
    completedSourceUploadBadge.courseId === activeCourseId ? completedSourceUploadBadge.count : 0;

  const updateComposerDraft = useCallback(
    (value: string) => {
      setDraft(value);
      composerDraftRef.current = value;
      if (activeCourseId) {
        writeLearnSessionComposerDraft(localUserId, activeCourseId, activeSessionId, value);
      }
    },
    [activeCourseId, activeSessionId, localUserId],
  );

  const updateComposerAttachments = useCallback(
    (
      action:
        | LearnImageAttachment[]
        | ((current: LearnImageAttachment[]) => LearnImageAttachment[]),
    ) => {
      setAttachments((current) => {
        const next = typeof action === 'function' ? action(current) : action;
        composerAttachmentsRef.current = next;
        if (activeMessageStoreKey) {
          composerAttachmentsBySessionRef.current.set(activeMessageStoreKey, next);
        }
        return next;
      });
    },
    [activeMessageStoreKey],
  );

  useEffect(() => {
    const previous = composerSessionKeyRef.current;
    if (previous?.key === activeMessageStoreKey) return;

    if (previous) {
      writeLearnSessionComposerDraft(
        previous.userId,
        previous.courseId,
        previous.sessionId,
        composerDraftRef.current,
      );
      composerAttachmentsBySessionRef.current.set(previous.key, composerAttachmentsRef.current);
    }

    if (!activeCourseId || !activeMessageStoreKey) {
      composerSessionKeyRef.current = null;
      composerDraftRef.current = '';
      composerAttachmentsRef.current = [];
      setDraft('');
      setAttachments([]);
      return;
    }

    const nextDraft = readLearnSessionComposerDraft(localUserId, activeCourseId, activeSessionId);
    const nextAttachments =
      composerAttachmentsBySessionRef.current.get(activeMessageStoreKey) ?? [];
    composerSessionKeyRef.current = {
      key: activeMessageStoreKey,
      userId: localUserId,
      courseId: activeCourseId,
      sessionId: activeSessionId,
    };
    composerDraftRef.current = nextDraft;
    composerAttachmentsRef.current = nextAttachments;
    setDraft(nextDraft);
    setAttachments(nextAttachments);
  }, [activeCourseId, activeMessageStoreKey, activeSessionId, localUserId]);

  useEffect(() => {
    activeMessageStoreKeyRef.current = activeMessageStoreKey;
    const request = sendRequestRef.current;
    if (request && request.key !== activeMessageStoreKey) {
      window.clearTimeout(request.timeoutId);
      request.controller.abort(new DOMException('学习会话已切换', 'AbortError'));
      sendRequestRef.current = null;
      setSending(false);
    }
    return () => {
      if (activeMessageStoreKeyRef.current === activeMessageStoreKey) {
        activeMessageStoreKeyRef.current = '';
      }
      const activeRequest = sendRequestRef.current;
      if (activeRequest?.key === activeMessageStoreKey) {
        window.clearTimeout(activeRequest.timeoutId);
        activeRequest.controller.abort(new DOMException('学习会话已切换', 'AbortError'));
        sendRequestRef.current = null;
      }
    };
  }, [activeMessageStoreKey]);

  useEffect(
    () => () => {
      revokeLearnChatAttachmentUrls(
        Array.from(hydratedAttachmentUrlsRef.current, (objectUrl) => ({ objectUrl })),
      );
      hydratedAttachmentUrlsRef.current.clear();
    },
    [activeMessageStoreKey],
  );

  useEffect(() => {
    if (!activeCourseId) return;
    const refreshMatchingConversation = (detail: unknown) => {
      if (!detail || typeof detail !== 'object') return;
      const change = detail as {
        courseId?: unknown;
        sessionId?: unknown;
        ownerScope?: unknown;
        deletedMessageIds?: unknown;
      };
      if (change.ownerScope !== undefined && change.ownerScope !== localUserId) return;
      if (change.courseId !== activeCourseId) return;
      setLearnSessionListRefreshAttempt((current) => current + 1);
      if (change.sessionId !== activeSessionId) return;
      if (sendRequestRef.current?.key === activeMessageStoreKeyRef.current) return;
      if (Array.isArray(change.deletedMessageIds)) {
        const serverDeletedIds = new Set(change.deletedMessageIds.map(String).filter(Boolean));
        if (serverDeletedIds.size > 0) {
          setMessages((current) => current.filter((message) => !serverDeletedIds.has(message.id)));
        }
      }
      lastSyncedConversationRef.current = '';
      setRemoteConversationReadyKey('');
      setRemoteConversationLoadAttempt((current) => current + 1);
    };
    const handleReconciled = (event: Event) => {
      refreshMatchingConversation((event as CustomEvent<unknown>).detail);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === learnSessionIndexKey(localUserId, activeCourseId)) {
        const nextSessions = excludePendingDeletedLearnSessions(
          localUserId,
          activeCourseId,
          readLearnSessions(localUserId, activeCourseId),
          pendingDeletedSessionKeysRef.current,
        );
        setLearnSessions(nextSessions);
        setLearnSessionListState((current) =>
          current.courseId === activeCourseId
            ? { ...current, totalCount: Math.max(current.totalCount, nextSessions.length) }
            : current,
        );
        return;
      }
      if (event.key === deletedLearnMessageIdsKey(localUserId, activeCourseId, activeSessionId)) {
        const deletedIds = readDeletedLearnMessageIds(localUserId, activeCourseId, activeSessionId);
        if (deletedIds.size > 0) {
          setMessages((current) => current.filter((message) => !deletedIds.has(message.id)));
        }
        return;
      }
      if (event.key !== LEARN_CONVERSATION_CHANGED_STORAGE_KEY || !event.newValue) return;
      try {
        refreshMatchingConversation(JSON.parse(event.newValue));
      } catch {
        /* Ignore malformed change notifications from older clients. */
      }
    };
    window.addEventListener(LEARN_CONVERSATION_RECONCILED_EVENT, handleReconciled);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(LEARN_CONVERSATION_RECONCILED_EVENT, handleReconciled);
      window.removeEventListener('storage', handleStorage);
    };
  }, [activeCourseId, activeSessionId, localUserId, setMessages]);

  useEffect(() => {
    problemsLoadStateRef.current = problemsLoadState;
  }, [problemsLoadState]);
  useEffect(() => {
    notebooksLoadStateRef.current = notebooksLoadState;
  }, [notebooksLoadState]);
  useEffect(() => {
    problemsHydrationWantedRef.current = problemsHydrationWanted;
  }, [problemsHydrationWanted]);
  useEffect(() => {
    notebooksHydrationWantedRef.current = notebooksHydrationWanted;
  }, [notebooksHydrationWanted]);

  useEffect(() => {
    if (
      !courseHydrated ||
      !urlCourseId ||
      storedCourseId !== urlCourseId ||
      !isUsefulCourseShellName(storedCourseName)
    ) {
      return;
    }
    setCourses((current) =>
      current.map((course) =>
        course.id === urlCourseId && isProvisionalCourseShell(course)
          ? {
              ...course,
              name: storedCourseName.trim(),
              avatarUrl: storedCourseAvatarUrl?.trim() || course.avatarUrl,
            }
          : course,
      ),
    );
  }, [courseHydrated, storedCourseAvatarUrl, storedCourseId, storedCourseName, urlCourseId]);

  const activeCourse = useMemo(
    () => courses.find((course) => course.id === activeCourseId) || null,
    [activeCourseId, courses],
  );
  const activeCourseCanLoadResources = Boolean(
    activeCourse &&
    initialBootSettled &&
    (!isProvisionalCourseShell(activeCourse) ||
      isUsefulCourseShellName(activeCourse.name) ||
      courseLoadError),
  );
  const firstResourceRoundReady = Boolean(
    activeCourse && courseContentStateRevision.startsWith(`${activeCourse.id}:`),
  );
  const calendarDemanded =
    rightRailView === 'calendar' ||
    calendarDialogOpen ||
    syllabusDialogOpen ||
    manualScheduleDialogOpen;
  const {
    events: remoteSyllabusEvents,
    loading: calendarLoading,
    mutating: calendarMutating,
    error: calendarLoadError,
    truncated: calendarEventsTruncated,
    reload: reloadCalendarEvents,
    createEvents: createCalendarEvents,
    updateEvent: updateCalendarEvent,
    deleteEvent: deleteCalendarEvent,
    mergeLoadedEvents: mergeLoadedCalendarEvents,
  } = useLearningCalendarRange({
    referenceDate: calendarReferenceDate,
    courseId: activeCourseId || undefined,
    rangeMode: 'compact',
    enabled: Boolean(activeCourseId && calendarDemanded),
  });

  const recentPlans = useMemo(
    () => recentPlanCandidates.filter((plan) => plan.courseId === activeCourseId),
    [activeCourseId, recentPlanCandidates],
  );
  const practiceSessions = useMemo(
    () => practiceSessionCandidates.filter((session) => session.courseId === activeCourseId),
    [activeCourseId, practiceSessionCandidates],
  );
  const syllabusEvents = useMemo(
    () =>
      activeCourse
        ? remoteSyllabusEvents.filter((event) => syllabusEventBelongsToCourse(event, activeCourse))
        : [],
    [activeCourse, remoteSyllabusEvents],
  );
  const hasActiveCourse = Boolean(activeCourse);
  const activeLearnSessionListState =
    learnSessionListState.courseId === activeCourseId
      ? learnSessionListState
      : {
          courseId: activeCourseId,
          totalCount: learnSessions.length,
          hasMore: false,
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error: null,
        };
  const activeCourseIsOwner = canManageCourseContent && activeCourse?.accessRole !== 'enrolled';
  const isResearchCourse = activeCourse?.purpose === 'research';
  const coursePublishBlockReason = activeCourse
    ? getCoursePublishBlockReason(activeCourse, notebooks)
    : null;
  const publishableProblemCount = useMemo(
    () => problems.filter((problem) => problem.status === 'published').length,
    [problems],
  );
  const refreshPracticeSessions = useCallback(() => {
    if (!activeCourseId) {
      setPracticeSessions([]);
      return;
    }
    setPracticeSessions(listPracticeSessions(localUserId, activeCourseId));
  }, [activeCourseId, localUserId]);
  const syncPracticeSessionState = useCallback(
    (session: PracticeSession | null | undefined) => {
      if (!session || (activeCourseId && session.courseId !== activeCourseId)) return;
      setPracticeSessions((current) => {
        const next = [
          session,
          ...current.filter((item) => item.id !== session.id && item.courseId === session.courseId),
        ].sort((a, b) => b.updatedAt - a.updatedAt);
        return next;
      });
    },
    [activeCourseId],
  );

  useEffect(() => {
    refreshPracticeSessions();
  }, [refreshPracticeSessions]);
  const activeQuickPrompts = isTeacherCourseChat ? teacherQuickPrompts : studentCourseQuickPrompts;
  const manualScheduleKindOptions = isResearchCourse
    ? RESEARCH_EVENT_KIND_OPTIONS
    : SYLLABUS_EVENT_KIND_OPTIONS;
  const modelOptions = useMemo(() => buildLearnModelOptions(providersConfig), [providersConfig]);
  const selectedModelValue = modelOptionValue(providerId, modelId);
  const selectedModel = useMemo(
    () =>
      modelOptions.find((option) => option.value === selectedModelValue) || {
        value: selectedModelValue,
        providerId,
        modelId,
        providerName: providerId,
        modelName: modelId || '未选择模型',
        vision: null,
      },
    [modelId, modelOptions, providerId, selectedModelValue],
  );
  const visibleModelOptions = useMemo(
    () =>
      modelOptions.some((option) => option.value === selectedModelValue)
        ? modelOptions
        : [selectedModel, ...modelOptions],
    [modelOptions, selectedModel, selectedModelValue],
  );
  const selectedKnownNoVision = selectedModel.vision === false;
  const pdfProviderConfig = pdfProvidersConfig[pdfProviderId];

  const setSourceUploadDialogOpen = useCallback(
    (open: boolean) => {
      sourceUploadPanelOpenRef.current = open;
      setSourceUploadPanelOpen(open);
      if (open) {
        setCompletedSourceUploadBadge((current) =>
          current.courseId === activeCourseId ? { ...current, count: 0 } : current,
        );
      } else {
        setSelectedSourceLibraryTileId(null);
        setSourceLibraryDetailView('image');
        setSourceLibraryImageExpanded(false);
      }
    },
    [activeCourseId],
  );

  const openSourceUploadPanel = useCallback(() => {
    setSourceUploadDialogOpen(true);
  }, [setSourceUploadDialogOpen]);

  const openNotebookLibraryPanel = useCallback(() => {
    if (!activeCourse) return;
    setSelectedNotebookLibraryTileId(null);
    setNotebookLibraryQuery('');
    setNotebookLibraryPanelOpen(true);
  }, [activeCourse]);

  const openNotebookFromProgress = useCallback(
    (notebook: StageListItem) => {
      if (!activeCourse) return;
      setNotebookLibraryQuery('');
      setNotebookLibraryPanelOpen(true);
      setSelectedNotebookLibraryTileId(`notebook-library-${notebook.id}`);
    },
    [activeCourse],
  );

  const openMiniLectureDeck = useCallback((deck: MiniLectureDeck) => {
    setActiveMiniLectureDeck(deck);
    setMiniLectureOpen(true);
  }, []);

  const generateMiniLectureForMessage = useCallback(
    async (messageId: string) => {
      const messageStoreKey = activeMessageStoreKeyRef.current;
      if (!messageStoreKey || localConversationReadyKey !== messageStoreKey) {
        toast.info('会话仍在本地恢复，请稍后再操作。');
        return;
      }
      const message = messages.find((item) => item.id === messageId);
      if (!message) return;
      if (message.lectureDeck) {
        openMiniLectureDeck(message.lectureDeck);
        return;
      }
      const messageIndex = messages.findIndex((item) => item.id === messageId);
      const prompt = miniLecturePromptForMessage({
        messages,
        messageIndex,
        course: activeCourse,
      });
      if (!prompt) return;
      setGeneratingMiniLectureMessageId(messageId);
      try {
        const response = await backendJson<{
          ok: true;
          data: GeneratedMiniLectureManifest;
        }>('/api/learn/mini-lectures', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(providerId === 'openai' && modelId ? { 'x-model': `openai:${modelId}` } : {}),
          },
          body: JSON.stringify({
            course: activeCourse
              ? {
                  id: activeCourse.id,
                  name: activeCourse.name,
                  courseCode: activeCourse.courseCode || undefined,
                  purpose: activeCourse.purpose,
                }
              : prompt.courseName,
            message: {
              id: messageId,
              text: prompt.question,
            },
            answer: {
              id: messageId,
              title: prompt.title,
              text: prompt.answer,
            },
            pageCount: prompt.answer.length > 520 ? 2 : 1,
            language: activeCourse?.language === 'en-US' ? 'en-US' : 'zh-CN',
            ttsVoice: 'marin',
            idempotencyKey: `learn-${messageId}`,
          }),
          timeoutMs: 300_000,
        });
        const deck = generatedManifestToMiniLectureDeck(response.data, prompt);
        await saveMiniLectureDeckLocally({
          context: {
            ownerId: localUserId,
            courseId: activeCourse?.id || 'unknown-course',
            sessionId: activeSessionId,
            messageId,
          },
          deck,
        });
        setMessages((current) =>
          current.map((item) =>
            item.id === messageId
              ? {
                  ...item,
                  lectureDeck: deck,
                }
              : item,
          ),
        );
        setActiveMiniLectureDeck(deck);
        setMiniLectureOpen(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '图片课堂讲解生成失败，请重试。');
      } finally {
        setGeneratingMiniLectureMessageId((current) => (current === messageId ? null : current));
      }
    },
    [
      activeCourse,
      activeSessionId,
      localConversationReadyKey,
      localUserId,
      messages,
      modelId,
      openMiniLectureDeck,
      providerId,
      setMessages,
    ],
  );

  const updateSourceUploadItem = useCallback(
    (itemId: string, patch: Partial<Omit<LearnSourceUploadItem, 'id' | 'createdAt'>>) => {
      setSourceUploadItems((current) =>
        current.map((item) =>
          item.id === itemId
            ? {
                ...item,
                ...patch,
                updatedAt: Date.now(),
              }
            : item,
        ),
      );
    },
    [],
  );

  const handleUploadButtonClick = useCallback(() => {
    if (!canManageCourseContent) return;
    if (!activeCourse) {
      setError('先添加或选择一门课程，再上传原始讲义。');
      return;
    }
    if (sourceUploadingCourseId && sourceUploadingCourseId !== activeCourse.id) {
      setError('另一门课程的原始讲义仍在入库，请等待完成后再上传。');
      return;
    }
    if (
      sourceUploading ||
      activeSourceUploadItems.length > 0 ||
      completedSourceUploadBadgeCount > 0
    ) {
      openSourceUploadPanel();
      return;
    }
    sourceDocumentInputRef.current?.click();
  }, [
    canManageCourseContent,
    completedSourceUploadBadgeCount,
    activeCourse,
    activeSourceUploadItems.length,
    openSourceUploadPanel,
    sourceUploading,
    sourceUploadingCourseId,
  ]);

  useEffect(() => {
    const textarea = draftTextareaRef.current;
    if (!textarea) return;

    textarea.style.height = '24px';
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 24), 128)}px`;
  }, [draft]);

  useEffect(() => {
    const clearPlatformMemoryStatusMockTimers = () => {
      for (const timerId of platformMemoryStatusMockTimersRef.current) {
        window.clearTimeout(timerId);
      }
      platformMemoryStatusMockTimersRef.current = [];
    };

    clearPlatformMemoryStatusMockTimers();

    if (platformMemoryStatusMockMode === 'off') {
      if (appliedPlatformMemoryStatusMockModeRef.current !== 'off') {
        dismissPlatformMemoryStatusMockActivities();
      }
      appliedPlatformMemoryStatusMockModeRef.current = 'off';
      return undefined;
    }

    dismissPlatformMemoryStatusMockActivities();
    appliedPlatformMemoryStatusMockModeRef.current = platformMemoryStatusMockMode;
    if (platformMemoryStatusMockMode === 'flow') {
      platformMemoryStatusMockTimersRef.current = replayPlatformMemoryStatusMock();
    } else {
      showRunningPlatformMemoryStatusMock();
    }

    return () => {
      clearPlatformMemoryStatusMockTimers();
      dismissPlatformMemoryStatusMockActivities();
      appliedPlatformMemoryStatusMockModeRef.current = 'off';
    };
  }, [platformMemoryStatusMockMode]);

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
  const showCurrentCalendarMonth = useCallback(() => {
    setCalendarReferenceDate(new Date());
  }, []);
  const calendarDays = useMemo(
    () => buildLearningCalendarDays(calendarReferenceDate, recentPlans, syllabusEvents),
    [calendarReferenceDate, recentPlans, syllabusEvents],
  );
  const calendarMonthLabel = useMemo(
    () => formatCalendarMonth(calendarReferenceDate),
    [calendarReferenceDate],
  );
  const practiceSessionByPlanId = useMemo(() => {
    const next = new Map<string, PracticeSession>();
    for (const session of practiceSessions) {
      const current = next.get(session.planId);
      if (!current || session.updatedAt > current.updatedAt) next.set(session.planId, session);
    }
    return next;
  }, [practiceSessions]);
  const practiceSessionSummaryByPlanId = useMemo(() => {
    const next = new Map<string, PracticeSessionSummary>();
    for (const [planId, session] of practiceSessionByPlanId.entries()) {
      next.set(planId, practiceSessionSummary(session));
    }
    return next;
  }, [practiceSessionByPlanId]);
  const activePracticeSession = useMemo(() => {
    if (!practicePopupSessionId) return null;
    return (
      practiceSessions.find((session) => session.id === practicePopupSessionId) ??
      loadPracticeSession(practicePopupSessionId)
    );
  }, [practicePopupSessionId, practiceSessions]);
  const activePracticePlan = useMemo(() => {
    if (!activePracticeSession) return null;
    return (
      recentPlans.find((plan) => plan.id === activePracticeSession.planId) ??
      loadPracticePlan(activePracticeSession.planId)
    );
  }, [activePracticeSession, recentPlans]);
  const activePracticeProblemIds = useMemo(
    () => Array.from(new Set(activePracticePlan?.problemIds.filter(Boolean) ?? [])),
    [activePracticePlan],
  );
  const activePracticeSummary = useMemo(
    () => (activePracticeSession ? practiceSessionSummary(activePracticeSession) : null),
    [activePracticeSession],
  );
  const activePracticeAnswers = useMemo(
    () => practiceSessionAnswers(activePracticeSession),
    [activePracticeSession],
  );
  const practicePopupCompletedCount = activePracticeSummary?.completed ?? 0;
  const practicePopupTotalCount = activePracticeSummary?.total ?? activePracticeProblemIds.length;
  const practicePopupProgressPercent = practicePopupTotalCount
    ? Math.min(
        100,
        Math.max(0, Math.round((practicePopupCompletedCount / practicePopupTotalCount) * 100)),
      )
    : 0;
  const practicePopupCurrentQuestionLabel = practiceHeaderState
    ? practiceHeaderState.progressCurrent > 0
      ? `第 ${practiceHeaderState.progressCurrent} 题`
      : practiceHeaderState.progressLabel
    : null;
  const practicePopupStatusParts: Array<{ label: string; className: string }> = [];
  if (activePracticeSummary?.correct) {
    practicePopupStatusParts.push({
      label: `正确 ${activePracticeSummary.correct}`,
      className:
        'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-300/20',
    });
  }
  if (activePracticeSummary?.partial) {
    practicePopupStatusParts.push({
      label: `半会 ${activePracticeSummary.partial}`,
      className:
        'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-400/10 dark:text-sky-200 dark:ring-sky-300/20',
    });
  }
  if (activePracticeSummary?.failed) {
    practicePopupStatusParts.push({
      label: `错题 ${activePracticeSummary.failed}`,
      className:
        'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-400/10 dark:text-rose-200 dark:ring-rose-300/20',
    });
  }
  if (activePracticeSummary?.stuck) {
    practicePopupStatusParts.push({
      label: `不会 ${activePracticeSummary.stuck}`,
      className:
        'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-100 dark:ring-amber-300/20',
    });
  }
  if (activePracticeSummary?.draft) {
    practicePopupStatusParts.push({
      label: `草稿 ${activePracticeSummary.draft}`,
      className:
        'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-white/10',
    });
  }
  const activePracticeProblemState =
    activePracticeSession && practiceHeaderState?.problemId
      ? (activePracticeSession.problemStates[practiceHeaderState.problemId] ?? null)
      : null;
  const currentPracticeProblemHelpSessionId =
    typeof activePracticeProblemState?.aiHelpSessionId === 'string' &&
    activePracticeProblemState.aiHelpSessionId.trim()
      ? activePracticeProblemState.aiHelpSessionId.trim()
      : null;
  const currentPracticeProblemHelp =
    practiceProblemHelp &&
    (!practiceHeaderState?.problemId ||
      practiceProblemHelp.problemId === practiceHeaderState.problemId)
      ? practiceProblemHelp
      : null;
  const currentPracticeProblemHasAiHelp = Boolean(
    currentPracticeProblemHelp ||
    currentPracticeProblemHelpSessionId ||
    activePracticeProblemState?.stuck,
  );
  const currentPracticeProblemHelpTabVisible = Boolean(
    practiceHeaderState?.problemId &&
    practiceProblemHelpTabProblemId === practiceHeaderState.problemId,
  );
  const currentPracticeProblemHelpTabActive =
    currentPracticeProblemHelpTabVisible && practiceProblemHelpTabActive;
  const currentPracticeProblemHelpLoading = currentPracticeProblemHelp?.status === 'loading';
  const practiceAiHelpHeaderLabel = currentPracticeProblemHelpLoading
    ? '生成中'
    : currentPracticeProblemHelpTabVisible
      ? '重新生成解答'
      : 'AI 解答';
  const statusCalendarActivities = useMemo<StatusCalendarActivity[]>(() => {
    const todayKey = localDayKey(new Date());
    const sessionPlanIds = new Set(practiceSessions.map((session) => session.planId));
    const practiceSessionActivities = practiceSessions.slice(0, 8).map((session) => {
      const summary = practiceSessionSummary(session);
      return {
        id: `practice-session-${session.id}`,
        source: 'practice_session' as const,
        sourceId: session.id,
        title: session.planTitle,
        date: localDayKey(session.updatedAt),
        meta: summary.meta,
        dotClassName:
          summary.failed > 0 || summary.stuck > 0
            ? 'bg-amber-500'
            : summary.completed >= summary.total && summary.total > 0
              ? 'bg-sky-500'
              : 'bg-emerald-500',
        actionLabel: summary.actionLabel,
        session,
      };
    });
    const planActivities = recentPlans
      .filter((plan) => !sessionPlanIds.has(plan.id))
      .map((plan) => {
        const date = localDayKey(planCalendarTimestamp(plan));
        return {
          id: `plan-${plan.id}`,
          source: 'plan' as const,
          sourceId: plan.id,
          title: plan.title,
          date,
          meta: `${plan.mode === 'quiz' ? '小测' : '刷题'} · ${plan.estimatedMinutes} 分钟`,
          dotClassName: plan.mode === 'quiz' ? 'bg-violet-500' : 'bg-emerald-500',
          actionLabel: plan.mode === 'quiz' ? '开始小测' : '开始刷题',
        };
      });
    const syllabusActivities = syllabusEvents.map((event) => ({
      id: `syllabus-${event.id}`,
      source: 'syllabus' as const,
      sourceId: event.id,
      title: event.title,
      date: event.date,
      meta: `${scheduleEventLabel(event.kind, isResearchCourse)}${event.sourceName ? ` · ${event.sourceName}` : ''}`,
      dotClassName: syllabusEventTone(event.kind),
      actionLabel:
        event.origin === 'ai_plan' || event.kind === 'progress' ? '开始活动' : '查看日程',
      event,
    }));
    const allActivities = [...practiceSessionActivities, ...planActivities, ...syllabusActivities];
    const upcoming = allActivities
      .filter((activity) => activity.date >= todayKey)
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.title.localeCompare(b.title, 'zh-CN') ||
          a.id.localeCompare(b.id),
      );
    return upcoming.slice(0, 4);
  }, [isResearchCourse, practiceSessions, recentPlans, syllabusEvents]);
  const plansByCalendarDay = useMemo(() => {
    const next = new Map<string, PracticePlan[]>();
    for (const plan of recentPlans) {
      const key = localDayKey(planCalendarTimestamp(plan));
      const items = next.get(key) || [];
      items.push(plan);
      next.set(key, items);
    }
    return next;
  }, [recentPlans]);
  const syllabusEventsByCalendarDay = useMemo(() => {
    return buildSyllabusEventsByDay(syllabusEvents);
  }, [syllabusEvents]);
  const missingLearningSetup =
    Boolean(activeCourse) &&
    !isResearchCourse &&
    !snapshot?.progressKnown &&
    syllabusEvents.length === 0;
  const activeMemoryActivities = useMemo(
    () =>
      memoryActivities.filter(
        (activity) =>
          (!activity.courseId || activity.courseId === activeCourseId) &&
          shouldCountPlatformMemoryActivity(activity) &&
          isActiveMemoryActivityStatus(activity.status),
      ),
    [activeCourseId, memoryActivities],
  );
  const completedMemoryActivities = useMemo(
    () =>
      memoryActivities.filter(
        (activity) =>
          (!activity.courseId || activity.courseId === activeCourseId) &&
          shouldCountPlatformMemoryActivity(activity) &&
          activity.status === 'completed',
      ),
    [activeCourseId, memoryActivities],
  );
  const platformMemoryState = activeMemoryActivities.length
    ? 'writing'
    : completedMemoryActivities.length
      ? 'completed'
      : 'idle';
  const platformMemoryBadgeCount =
    activeMemoryActivities.length || completedMemoryActivities.length;
  const platformMemoryHistory = useMemo(
    () =>
      memoryHistoryRecords
        .filter(
          (record) =>
            taskHistoryBelongsToCourse(record, activeCourseId) &&
            shouldShowPlatformMemoryRecord(record) &&
            (platformMemoryStatusMockMode !== 'off' || !isPlatformMemoryStatusMockRecord(record)),
        )
        .slice(0, 15),
    [activeCourseId, memoryHistoryRecords, platformMemoryStatusMockMode],
  );
  const platformMemoryButtonLabel =
    platformMemoryState === 'writing'
      ? `平台记忆正在更新，${platformMemoryBadgeCount} 条`
      : platformMemoryState === 'completed'
        ? `平台记忆刚更新了 ${platformMemoryBadgeCount} 条`
        : '平台记忆动态';
  const platformMemoryTooltip =
    platformMemoryState === 'writing'
      ? '平台正在理解新的学习信息'
      : platformMemoryState === 'completed'
        ? '平台记忆刚刚有更新'
        : '查看平台记忆写入历史';
  const validSyllabusDraftEvents = useMemo(
    () =>
      syllabusDraftEvents
        .map((event) => ({
          ...event,
          title: event.title.trim(),
          sourceName: event.sourceName.trim() || syllabusDraftSourceName || 'syllabus',
        }))
        .filter((event) => event.title && /^\d{4}-\d{2}-\d{2}$/.test(event.date)),
    [syllabusDraftEvents, syllabusDraftSourceName],
  );

  useEffect(() => {
    setCourseSettingsOpen(false);
    if (!activeCourseId) {
      return;
    }
    setError(null);
    setProgressSelection('');
    setSyllabusImportMessage(null);
    setSyllabusDialogOpen(false);
    setSyllabusPlanDraft('');
    setSyllabusImportMode('file');
    setSyllabusCommitMode('merge');
    setSyllabusImportLoading(false);
    setSyllabusDraftEvents([]);
    setSyllabusDraftSourceName('');
    setManualScheduleDialogOpen(false);
    setManualScheduleTitle('');
    setManualScheduleDate(localDayKey(new Date()));
    setManualScheduleKind('assignment');
    setManualScheduleError(null);
  }, [activeCourseId]);

  const learnSessionHref = useCallback(
    (sessionId: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (activeCourseId) next.set('courseId', activeCourseId);
      next.set('session', sessionId);
      const query = next.toString();
      return query ? `/learn?${query}` : '/learn';
    },
    [activeCourseId, searchParams],
  );

  const registerLocalOnlyLearnSession = useCallback(
    (args: {
      courseId: string;
      sessionId: string;
      title?: string;
      messageCount?: number;
      resetMessages?: boolean;
    }): LearnChatSession => {
      const now = Date.now();
      const existingSessions = readLearnSessions(localUserId, args.courseId);
      const existing = existingSessions.find((session) => session.id === args.sessionId);
      if (args.resetMessages) {
        deleteLearnSessionMessages(localUserId, args.courseId, args.sessionId);
        writeLearnSessionComposerDraft(localUserId, args.courseId, args.sessionId, '');
        composerAttachmentsBySessionRef.current.delete(
          `${localUserId}:${args.courseId}:${args.sessionId}`,
        );
      }
      const session: LearnChatSession = {
        id: args.sessionId,
        title: args.title ?? existing?.title ?? '新对话',
        createdAt: existing?.createdAt ?? now,
        updatedAt: existing?.updatedAt ?? now,
        messageCount: args.messageCount ?? (args.resetMessages ? 0 : (existing?.messageCount ?? 0)),
        currentRevision: 0,
        remoteState: 'local-only',
      };
      const nextSessions = sortLearnSessionsForList(localUserId, args.courseId, [
        session,
        ...existingSessions.filter((item) => item.id !== args.sessionId),
      ]);
      writeLearnSessions(localUserId, args.courseId, nextSessions);
      writeLearnSessionRemoteBase(localUserId, args.courseId, args.sessionId, {
        revision: 0,
        title: session.title,
        messages: [],
        messageWindow: { hasMore: false, isComplete: true },
      });
      if (activeCourseIdRef.current === args.courseId) {
        learnSessionsRef.current = nextSessions;
        setLearnSessions(nextSessions);
      }
      return session;
    },
    [localUserId],
  );

  const switchCourse = useCallback(
    (courseId: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set('courseId', courseId);
      next.delete('session');
      setSourceUploadDialogOpen(false);
      router.replace(`/learn?${next.toString()}`, { scroll: false });
    },
    [router, searchParams, setSourceUploadDialogOpen],
  );

  useEffect(() => {
    if (
      !activeCourseId ||
      activeCourseId !== urlCourseId ||
      urlSessionId ||
      showLearnHomeDashboard
    ) {
      return;
    }
    registerLocalOnlyLearnSession({
      courseId: activeCourseId,
      sessionId: draftSessionId,
      resetMessages: true,
    });
    clearMessagesFromRead();
    router.replace(learnSessionHref(draftSessionId), { scroll: false });
  }, [
    activeCourseId,
    clearMessagesFromRead,
    draftSessionId,
    learnSessionHref,
    registerLocalOnlyLearnSession,
    router,
    showLearnHomeDashboard,
    urlCourseId,
    urlSessionId,
  ]);

  const replaceDeletedSessionWithFallback = useCallback(
    (args: {
      courseId: string;
      deletedSessionId: string;
      carriedMessages?: LearnMessage[];
      recoveredSessionId?: string;
    }) => {
      const carriedMessages = args.carriedMessages ?? [];
      const availableSessions = readLearnSessions(localUserId, args.courseId).filter(
        (session) => session.id !== args.deletedSessionId,
      );
      const now = Date.now();
      const fallbackSession =
        carriedMessages.length > 0
          ? ({
              id: args.recoveredSessionId ?? makeLearnSessionId(),
              title: learnSessionTitleFromMessages(carriedMessages, '已恢复的本地对话'),
              createdAt: now,
              updatedAt: learnSessionUpdatedAtFromMessages(carriedMessages) ?? now,
              messageCount: carriedMessages.filter(learnMessageHasContent).length,
              currentRevision: 0,
              remoteState: 'local-only',
            } satisfies LearnChatSession)
          : (availableSessions[0] ??
            ({
              id: makeLearnSessionId(),
              title: '新对话',
              createdAt: now,
              updatedAt: now,
              messageCount: 0,
              currentRevision: 0,
              remoteState: 'local-only',
            } satisfies LearnChatSession));
      const nextSessions = sortLearnSessionsForList(localUserId, args.courseId, [
        fallbackSession,
        ...availableSessions.filter((session) => session.id !== fallbackSession.id),
      ]);
      if (carriedMessages.length > 0) {
        writeLearnSessionMessages(localUserId, args.courseId, fallbackSession.id, carriedMessages);
        writeLearnSessionTabMessages(
          localUserId,
          args.courseId,
          fallbackSession.id,
          carriedMessages,
        );
      } else if (fallbackSession.remoteState === 'local-only') {
        deleteLearnSessionMessages(localUserId, args.courseId, fallbackSession.id);
        writeLearnSessionComposerDraft(localUserId, args.courseId, fallbackSession.id, '');
      }
      if (fallbackSession.remoteState === 'local-only') {
        writeLearnSessionRemoteBase(localUserId, args.courseId, fallbackSession.id, {
          revision: 0,
          title: fallbackSession.title,
          messages: [],
          messageWindow: { hasMore: false, isComplete: true },
        });
      }
      writeLearnSessions(localUserId, args.courseId, nextSessions);
      setLearnSessions(nextSessions);
      clearMessagesFromRead();
      setLocalConversationReadyKey('');
      setRemoteConversationReadyKey('');
      router.replace(learnSessionHref(fallbackSession.id), { scroll: false });
      return fallbackSession;
    },
    [clearMessagesFromRead, learnSessionHref, localUserId, router],
  );

  const handleCourseCreated = useCallback(async (courseId: string) => {
    setCoursesLoadState('loading');
    const items = await listCoursesOrThrow();
    setCourses(items);
    setCoursesLoadState('ready');
    setActiveCourseId((current) => {
      if (current && items.some((course) => course.id === current)) return current;
      if (items.some((course) => course.id === courseId)) return courseId;
      return items[0]?.id || null;
    });
  }, []);

  const handleCourseSettingsUpdated = useCallback(
    (updatedCourse: CourseRecord) => {
      setCourses((current) =>
        current.map((course) => (course.id === updatedCourse.id ? updatedCourse : course)),
      );
      upsertLearnCourseListCache(localUserId, updatedCourse);
      setCurrentCourse({
        id: updatedCourse.id,
        name: updatedCourse.name,
        avatarUrl: updatedCourse.avatarUrl,
      });
    },
    [localUserId, setCurrentCourse],
  );

  const handleCourseSettingsDeleted = useCallback(
    (courseId: string) => {
      courseAssetCacheRef.current.delete(courseId);
      clearCourseWorkspaceCache(courseId);
      removeLearnCourseFromListCache(localUserId, courseId);
      setSourceUploadItems((current) => current.filter((item) => item.courseId !== courseId));
      setCourses((current) => current.filter((course) => course.id !== courseId));
      setCourseSettingsOpen(false);
      setActiveCourseId(null);
      setCourseLoadError(null);
      clearCurrentCourse();
      router.replace('/learn', { scroll: false });
    },
    [clearCurrentCourse, localUserId, router],
  );

  const handlePublishActiveCourse = useCallback(async () => {
    if (!activeCourse || publishingCourse) return;
    if (!activeCourseIsOwner) {
      toast.error('已加入的课程由创建者维护，不能发布到商城');
      return;
    }
    if (coursePublishBlockReason) {
      toast.error(coursePublishBlockReason);
      return;
    }

    setPublishingCourse(true);
    try {
      const updatedCourse = await updateCourse(activeCourse.id, {
        name: activeCourse.name,
        description: activeCourse.description ?? '',
        language: activeCourse.language,
        tags: activeCourse.tags,
        purpose: activeCourse.purpose,
        university: activeCourse.university,
        courseCode: activeCourse.courseCode,
        avatarUrl: activeCourse.avatarUrl,
        listedInCourseStore: true,
        coursePriceCents: activeCourse.coursePriceCents ?? 0,
      });
      setCourses((current) =>
        current.map((course) => (course.id === updatedCourse.id ? updatedCourse : course)),
      );
      setPublishDialogOpen(false);
      toast.success('已发布到课程商城：题库和公开课程记忆已同步，源文件和私人内容不会发布。');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '课程发布失败');
    } finally {
      setPublishingCourse(false);
    }
  }, [activeCourse, activeCourseIsOwner, coursePublishBlockReason, publishingCourse]);

  const persistLeftRailCollapsed = useCallback((collapsed: boolean) => {
    setLeftRailCollapsed(collapsed);
    try {
      localStorage.setItem(LEARN_LEFT_RAIL_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* localStorage may be unavailable */
    }
  }, []);

  const persistRightRailCollapsed = useCallback((collapsed: boolean) => {
    setRightRailCollapsed(collapsed);
    try {
      localStorage.setItem(LEARN_RIGHT_RAIL_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* localStorage may be unavailable */
    }
  }, []);

  useEffect(() => {
    if (activeCourseId && activeCourseId !== urlCourseId) return;
    if (!activeCourseId) {
      setLearnSessions([]);
      clearMessagesFromRead();
      setLocalConversationReadyKey('');
      setRemoteConversationReadyKey('');
      setInitialBootSettledKey('');
      setRemoteConversationLoadError(null);
      setRemoteConversationSyncError(null);
      return;
    }
    const locallyDeletedSessionIds = readDeletedLearnSessionIds(localUserId, activeCourseId);
    if (locallyDeletedSessionIds.has(activeSessionId)) {
      replaceDeletedSessionWithFallback({
        courseId: activeCourseId,
        deletedSessionId: activeSessionId,
      });
      return;
    }
    let alive = true;
    const hydrationRequestKeys = new Set<string>();
    const now = Date.now();
    const nextStoreKey = `${localUserId}:${activeCourseId}:${activeSessionId}`;
    const persistedDirtyMessages = readLearnSessionDirtyMessages(
      localUserId,
      activeCourseId,
      activeSessionId,
    );
    if (persistedDirtyMessages.length > 0) {
      const dirtyById =
        dirtyConversationMessagesRef.current.get(nextStoreKey) ??
        new Map<string, RemoteLearnMessagePayload>();
      for (const message of persistedDirtyMessages) {
        if (!dirtyById.has(message.id)) dirtyById.set(message.id, message);
      }
      dirtyConversationMessagesRef.current.set(nextStoreKey, dirtyById);
    }
    const hydrateRestoredAttachments = (candidateMessages: LearnMessage[]) => {
      const pendingMessages = candidateMessages.filter((message) => {
        const hasUnhydratedAttachment = message.attachments?.some(
          (attachment) => !attachment.dataUrl || !attachment.objectUrl,
        );
        if (!hasUnhydratedAttachment) return false;
        const requestKey = `${message.id}:${message.attachments
          ?.map((attachment) => attachment.id)
          .join(',')}`;
        if (hydrationRequestKeys.has(requestKey)) return false;
        hydrationRequestKeys.add(requestKey);
        return true;
      });
      if (!pendingMessages.length) return;
      void hydrateLearnMessageAttachments({
        messages: pendingMessages,
        ownerId: localUserId,
        courseId: activeCourseId,
        sessionId: activeSessionId,
      }).then((hydrated) => {
        if (!alive || activeMessageStoreKeyRef.current !== nextStoreKey) {
          revokeLearnChatAttachmentUrls(hydrated.objectUrls.map((objectUrl) => ({ objectUrl })));
          return;
        }
        for (const objectUrl of hydrated.objectUrls) {
          hydratedAttachmentUrlsRef.current.add(objectUrl);
        }
        const hydratedById = new Map(
          hydrated.messages.map((message) => [message.id, message.attachments]),
        );
        replaceMessagesFromRead(nextStoreKey, (current) =>
          current.map((message) => {
            const hydratedAttachments = hydratedById.get(message.id);
            return hydratedAttachments ? { ...message, attachments: hydratedAttachments } : message;
          }),
        );
      });
    };
    setLocalConversationReadyKey('');
    setRemoteConversationReadyKey('');
    setRemoteConversationLoadError(null);
    setRemoteConversationSyncError(null);
    let existing = readLearnSessions(localUserId, activeCourseId);
    const canonicalDraftSession = existing.find((session) => session.id === activeSessionId);
    if (
      activeSessionId === draftSessionId &&
      canonicalDraftSession?.remoteState !== 'local-only' &&
      canonicalDraftSession?.remoteState !== 'remote'
    ) {
      // Older builds could pair this component-generated canonical key with
      // the previous conversation body. Its identity is known locally, so
      // repair that one key without guessing from title or message count.
      registerLocalOnlyLearnSession({
        courseId: activeCourseId,
        sessionId: activeSessionId,
        resetMessages: true,
      });
      clearMessagesFromRead();
      existing = readLearnSessions(localUserId, activeCourseId);
    }
    const byId = new Map<string, LearnChatSession>();
    for (const session of existing) byId.set(session.id, session);
    if (urlSessionId) {
      const currentSession = byId.get(activeSessionId);
      byId.set(activeSessionId, {
        id: activeSessionId,
        title:
          currentSession?.title && currentSession.title !== '默认学习会话'
            ? currentSession.title
            : '新对话',
        createdAt: currentSession?.createdAt ?? now,
        updatedAt: currentSession?.updatedAt ?? now,
        messageCount: currentSession?.messageCount ?? 0,
        currentRevision:
          currentSession?.currentRevision ?? (activeSessionId === draftSessionId ? 0 : undefined),
        remoteState: currentSession?.remoteState,
      });
    }
    const nextSessions = pruneDuplicateBlankLearnSessions(
      localUserId,
      activeCourseId,
      sortLearnSessionsForList(localUserId, activeCourseId, Array.from(byId.values())),
      activeSessionId,
      (sessionId) =>
        Boolean(
          composerAttachmentsBySessionRef.current.get(
            `${localUserId}:${activeCourseId}:${sessionId}`,
          )?.length,
        ),
    ).slice(0, 5);
    if (learnSessionListCourseIdRef.current !== activeCourseId) {
      setLearnSessions(nextSessions);
      setLearnSessionListState({
        courseId: activeCourseId,
        totalCount: nextSessions.length,
        hasMore: false,
        nextCursor: null,
        loading: true,
        loadingMore: false,
        error: null,
      });
    }
    const readCurrentTabMessages = () => {
      const inMemory = activeMessagesRef.current;
      if (inMemory?.key === nextStoreKey) return inMemory.messages;
      return (
        readLearnSessionTabMessages(localUserId, activeCourseId, activeSessionId) ??
        readLearnSessionMessages(localUserId, activeCourseId, activeSessionId)
      );
    };
    const localMessages = readCurrentTabMessages();
    replaceMessagesFromRead(nextStoreKey, localMessages);
    setLocalConversationReadyKey(nextStoreKey);
    hydrateRestoredAttachments(localMessages);

    if (!urlSessionId) {
      lastSyncedConversationRef.current = learnConversationSyncSignature({
        key: nextStoreKey,
        title: '新对话',
        messages: [],
        deletedMessageIds: [],
      });
      setRemoteConversationReadyKey(nextStoreKey);
    }

    return () => {
      alive = false;
    };
  }, [
    activeCourseId,
    activeSessionId,
    clearMessagesFromRead,
    draftSessionId,
    localUserId,
    registerLocalOnlyLearnSession,
    replaceDeletedSessionWithFallback,
    replaceMessagesFromRead,
    setMessages,
    urlCourseId,
    urlSessionId,
  ]);

  useEffect(() => {
    if (activeCourseId && activeCourseId !== urlCourseId) return;
    if (!activeCourseId || !activeCourseBootKey) {
      setInitialBootSettledKey('');
      return;
    }
    if (!hydrated || !isLoggedIn) return;
    let alive = true;
    const courseId = activeCourseId;
    const controller = new AbortController();
    const cachedSessions = excludePendingDeletedLearnSessions(
      localUserId,
      courseId,
      sortLearnSessionsForList(localUserId, courseId, readLearnSessions(localUserId, courseId)),
      pendingDeletedSessionKeysRef.current,
    );
    setLearnSessions(cachedSessions);
    setLearnSessionListState({
      courseId,
      totalCount: cachedSessions.length,
      hasMore: false,
      nextCursor: null,
      loading: true,
      loadingMore: false,
      error: null,
    });

    // Conversation names are the only remote history needed for the first
    // screen. Enqueue this metadata-only read as soon as auth and the route
    // course id are known, while sharing the same max-one database lane as
    // course detail and resources. It never fetches a message body.
    void enqueueInitialLearnBootRequest({
      key: activeCourseBootKey,
      request: async () => {
        const response = await listRemoteLearnSessionsPage(courseId, {
          limit: 5,
          ownerScope: localUserId,
          signal: controller.signal,
        });
        if (!response) {
          throw new DOMException(
            '最近会话同步失败，当前显示本地记录。',
            'LearnDatabaseTimeoutError',
          );
        }
        return response;
      },
    })
      .then((remoteSessions) => {
        if (!alive || activeCourseIdRef.current !== courseId) return;
        if (remoteSessions.storage !== 'database') {
          throw new Error('云端会话列表暂时不可用，当前显示本机记录。');
        }
        const latestCachedSessions = readLearnSessions(localUserId, courseId);
        const mergedSessions = excludePendingDeletedLearnSessions(
          localUserId,
          courseId,
          mergeLearnSessions(
            localUserId,
            courseId,
            mergeLearnSessions(
              localUserId,
              courseId,
              latestCachedSessions,
              learnSessionsRef.current,
            ),
            remoteSessions.sessions.map(remoteLearnSessionToLocal),
          ),
          pendingDeletedSessionKeysRef.current,
        );
        writeLearnSessions(localUserId, courseId, mergedSessions);
        setLearnSessions(mergedSessions);
        setLearnSessionListState({
          courseId,
          totalCount: Math.max(remoteSessions.totalCount, mergedSessions.length),
          hasMore: remoteSessions.hasMore,
          nextCursor: remoteSessions.nextCursor,
          loading: false,
          loadingMore: false,
          error: null,
        });
      })
      .catch((sessionListError) => {
        if (!alive || activeCourseIdRef.current !== courseId) return;
        setLearnSessionListState((current) =>
          current.courseId === courseId
            ? {
                ...current,
                loading: false,
                error:
                  sessionListError instanceof Error
                    ? sessionListError.message
                    : '最近会话同步失败，当前显示本地记录。',
              }
            : current,
        );
      })
      .finally(() => {
        if (!alive || activeCourseIdRef.current !== courseId) return;
        setLearnSessionListState((current) =>
          current.courseId === courseId ? { ...current, loading: false } : current,
        );
      });

    return () => {
      alive = false;
      controller.abort(new DOMException('课程已切换', 'AbortError'));
    };
  }, [
    activeCourseBootKey,
    activeCourseId,
    enqueueInitialLearnBootRequest,
    hydrated,
    isLoggedIn,
    learnSessionListRefreshAttempt,
    localUserId,
    urlCourseId,
  ]);

  useEffect(() => {
    if (!activeCourseId) {
      void fetchServerProviders();
      return;
    }
    if (!firstResourceRoundReady) return;
    void enqueueDeferredLearnDataRequest({
      courseId: activeCourseId,
      request: fetchServerProviders,
    }).catch(() => undefined);
  }, [
    activeCourseId,
    enqueueDeferredLearnDataRequest,
    fetchServerProviders,
    firstResourceRoundReady,
  ]);

  useEffect(() => {
    if (!activeCourseId || activeCourseId !== urlCourseId || !urlSessionId) return;
    let alive = true;
    const courseId = activeCourseId;
    const sessionId = urlSessionId;
    const detailKey = activeMessageStoreKey;
    setRemoteConversationReadyKey('');
    setRemoteConversationSummaryState(null);
    setRemoteConversationMessagePageState(null);
    setRemoteConversationLoadError(null);

    const selectedLocalSession = readLearnSessions(localUserId, courseId).find(
      (session) => session.id === sessionId,
    );
    // Only an explicit marker written before client-side navigation can bypass
    // detail. An arbitrary/copied URL has no marker and must still verify the
    // server even when its title or cached message count looks blank.
    if (
      selectedLocalSession?.remoteState === 'local-only' &&
      selectedLocalSession.currentRevision === 0
    ) {
      writeLearnSessionRemoteBase(localUserId, courseId, sessionId, {
        revision: 0,
        title: selectedLocalSession.title,
        messages: [],
        messageWindow: { hasMore: false, isComplete: true },
      });
      setRemoteConversationMessagePageState({
        key: detailKey,
        hasMore: false,
        nextCursor: null,
        limit: 30,
        loading: false,
        error: null,
      });
      setRemoteConversationReadyKey(detailKey);
      return;
    }

    const controller = new AbortController();
    void loadRemoteLearnConversationOrThrow(courseId, sessionId, localUserId, {
      signal: controller.signal,
    })
      .then(async (remoteConversation) => {
        if (!alive || activeMessageStoreKeyRef.current !== detailKey) return;
        const remoteRevision =
          remoteConversation.currentRevision ?? remoteConversation.session?.currentRevision ?? 0;
        if (
          remoteConversation.storage === 'database' &&
          remoteConversation.session === null &&
          remoteRevision > 0
        ) {
          rememberDeletedLearnSessionId(localUserId, courseId, sessionId);
          deleteLearnSessionMessages(localUserId, courseId, sessionId);
          deleteLearnSessionRemoteBase(localUserId, courseId, sessionId);
          setLearnSessions((current) => current.filter((session) => session.id !== sessionId));
          replaceDeletedSessionWithFallback({
            courseId,
            deletedSessionId: sessionId,
          });
          toast.info('这条会话已在其他位置删除，已为你打开下一条会话。');
          return;
        }
        if (
          remoteConversation.storage === 'database' &&
          remoteConversation.session === null &&
          remoteRevision === 0
        ) {
          const dirtyById =
            dirtyConversationMessagesRef.current.get(detailKey) ??
            new Map(
              readLearnSessionDirtyMessages(localUserId, courseId, sessionId).map((message) => [
                message.id,
                message,
              ]),
            );
          if (dirtyById.size > 0) {
            dirtyConversationMessagesRef.current.set(detailKey, dirtyById);
          }
          const currentMessages =
            activeMessagesRef.current?.key === detailKey ? activeMessagesRef.current.messages : [];
          const currentById = new Map(currentMessages.map((message) => [message.id, message]));
          const retainedDirtyMessages = Array.from(dirtyById.values())
            .map((payload) => {
              const currentMessage = currentById.get(payload.id);
              return currentMessage &&
                remoteLearnMessagePayloadEqual(learnMessageToRemotePayload(currentMessage), payload)
                ? currentMessage
                : remoteMessageToLearnMessage(payload);
            })
            .sort(
              (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
            );
          if (retainedDirtyMessages.length === 0) {
            // A revision-zero miss proves the server has no body. Clean cached
            // messages under this key came from an old key-pairing bug and must
            // not be promoted into writes.
            deleteLearnSessionMessages(localUserId, courseId, sessionId);
            dirtyConversationMessagesRef.current.delete(detailKey);
          } else {
            writeLearnSessionMessages(localUserId, courseId, sessionId, retainedDirtyMessages);
            writeLearnSessionTabMessages(localUserId, courseId, sessionId, retainedDirtyMessages);
          }
          replaceMessagesFromRead(detailKey, retainedDirtyMessages);
          writeLearnSessionRemoteBase(localUserId, courseId, sessionId, {
            revision: 0,
            title: learnSessionTitleFromMessages(retainedDirtyMessages, '新对话'),
            messages: [],
            messageWindow: { hasMore: false, isComplete: true },
          });
          setRemoteConversationMessagePageState({
            key: detailKey,
            hasMore: false,
            nextCursor: null,
            limit: 30,
            loading: false,
            error: null,
          });
          setLearnSessions((current) => {
            const currentSession = current.find((session) => session.id === sessionId);
            const now = Date.now();
            const verifiedLocalSession: LearnChatSession = {
              id: sessionId,
              title: learnSessionTitleFromMessages(
                retainedDirtyMessages,
                currentSession?.title ?? '新对话',
              ),
              createdAt: currentSession?.createdAt ?? now,
              updatedAt: currentSession?.updatedAt ?? now,
              messageCount: retainedDirtyMessages.filter(learnMessageHasContent).length,
              currentRevision: 0,
              remoteState: 'local-only',
            };
            const nextSessions = sortLearnSessionsForList(localUserId, courseId, [
              verifiedLocalSession,
              ...current.filter((session) => session.id !== sessionId),
            ]);
            writeLearnSessions(localUserId, courseId, nextSessions);
            return nextSessions;
          });
          setRemoteConversationReadyKey(detailKey);
          setRemoteConversationLoadError(null);
          return;
        }
        if (remoteConversation.storage !== 'database' || !remoteConversation.session) {
          setRemoteConversationLoadError('远端会话暂时不可用，当前保留本地内容。');
          return;
        }
        setRemoteConversationSummaryState(
          remoteConversation.summary
            ? {
                key: detailKey,
                summary: remoteConversation.summary,
              }
            : null,
        );
        setRemoteConversationMessagePageState({
          key: detailKey,
          hasMore:
            remoteConversation.messagePage?.hasMore ??
            remoteConversation.messageWindow?.hasMore ??
            false,
          nextCursor: remoteConversation.messagePage?.nextCursor ?? null,
          limit: remoteConversation.messagePage?.limit ?? 30,
          loading: false,
          error: null,
        });

        const localMessages =
          readLearnSessionTabMessages(localUserId, courseId, sessionId) ??
          readLearnSessionMessages(localUserId, courseId, sessionId);
        const latestLocalMessages = localMessages.filter((message) => !message.transient);
        const remoteMessages = remoteConversation.messages.map(remoteMessageToLearnMessage);
        const remotePayloads = remoteMessages.map(learnMessageToRemotePayload);
        const dirtyById = dirtyConversationMessagesRef.current.get(detailKey);
        if (dirtyById) {
          const remoteById = new Map(remotePayloads.map((message) => [message.id, message]));
          for (const messageId of dirtyById.keys()) {
            // Message ids are immutable turn identities. Once an id exists in
            // the database, the server copy is authoritative during hydration.
            // This lets stale tabs converge instead of endlessly overwriting
            // different cached metadata for the same visible message.
            if (remoteById.has(messageId)) dirtyById.delete(messageId);
          }
          if (dirtyById.size === 0) dirtyConversationMessagesRef.current.delete(detailKey);
          writeLearnSessionDirtyMessages(
            localUserId,
            courseId,
            sessionId,
            Array.from(dirtyById.values()),
          );
        }
        const persistedRemoteBase = readLearnSessionRemoteBase(localUserId, courseId, sessionId);
        const validRemoteBase =
          persistedRemoteBase && persistedRemoteBase.revision <= remoteRevision
            ? persistedRemoteBase
            : null;
        const canInferRemoteDeletions =
          validRemoteBase?.messageWindow?.isComplete === true &&
          remoteConversation.messageWindow?.isComplete === true;
        let mergedMessages =
          canInferRemoteDeletions && validRemoteBase
            ? mergeRemoteAndLocalLearnMessages(
                validRemoteBase.messages,
                remoteMessages,
                latestLocalMessages,
              )
            : mergeRemoteAuthoritativeLearnMessages(remoteMessages, latestLocalMessages);
        const pendingDirtyMessages = Array.from(dirtyById?.values() ?? []).map(
          remoteMessageToLearnMessage,
        );
        if (pendingDirtyMessages.length > 0) {
          // The server owns every clean overlapping id, while an explicit
          // local dirty operation must remain visible until that exact payload
          // is acknowledged.
          mergedMessages = mergeOlderRemoteLearnMessages(mergedMessages, pendingDirtyMessages);
        }
        const deletedMessageIds = readDeletedLearnMessageIds(localUserId, courseId, sessionId);
        const serverDeletedMessageIds = new Set(remoteConversation.deletedMessageIds ?? []);
        mergedMessages = mergedMessages.filter(
          (message) =>
            !deletedMessageIds.has(message.id) && !serverDeletedMessageIds.has(message.id),
        );
        writeLearnSessionRemoteBase(localUserId, courseId, sessionId, {
          revision: remoteRevision,
          title: remoteConversation.session.title,
          messages: remotePayloads,
          messageWindow: remoteConversation.messageWindow,
        });
        writeLearnSessionMessages(localUserId, courseId, sessionId, mergedMessages);
        writeLearnSessionTabMessages(localUserId, courseId, sessionId, mergedMessages);
        const acceptedRemoteSnapshot =
          JSON.stringify(mergedMessages.map(learnMessageToRemotePayload)) ===
          JSON.stringify(remotePayloads);
        lastSyncedConversationRef.current =
          acceptedRemoteSnapshot && deletedMessageIds.size === 0
            ? learnConversationSyncSignature({
                key: detailKey,
                title: remoteConversation.session.title,
                messages: remotePayloads,
                deletedMessageIds: [],
              })
            : '';
        replaceMessagesFromRead(detailKey, mergedMessages);
        const hydratedMessages = await hydrateLearnMessageAttachments({
          messages: mergedMessages,
          ownerId: localUserId,
          courseId,
          sessionId,
        });
        if (!alive || activeMessageStoreKeyRef.current !== detailKey) {
          revokeLearnChatAttachmentUrls(
            hydratedMessages.objectUrls.map((objectUrl) => ({ objectUrl })),
          );
          return;
        }
        for (const objectUrl of hydratedMessages.objectUrls) {
          hydratedAttachmentUrlsRef.current.add(objectUrl);
        }
        replaceMessagesFromRead(detailKey, hydratedMessages.messages);
        setLearnSessions((current) => {
          const nextSessions = mergeLearnSessions(localUserId, courseId, current, [
            remoteLearnSessionToLocal(remoteConversation.session!),
          ]);
          writeLearnSessions(localUserId, courseId, nextSessions);
          return nextSessions;
        });
        setRemoteConversationLoadError(null);
        setRemoteConversationReadyKey(detailKey);
      })
      .catch((detailError) => {
        if (!alive || activeMessageStoreKeyRef.current !== detailKey) return;
        setRemoteConversationMessagePageState(null);
        setRemoteConversationLoadError(
          detailError instanceof Error ? detailError.message : '远端会话加载失败',
        );
      });

    return () => {
      alive = false;
      controller.abort(new DOMException('会话已切换', 'AbortError'));
    };
  }, [
    activeCourseId,
    activeMessageStoreKey,
    localUserId,
    remoteConversationLoadAttempt,
    replaceDeletedSessionWithFallback,
    replaceMessagesFromRead,
    urlCourseId,
    urlSessionId,
  ]);

  useEffect(() => {
    if (!activeCourseId) return;
    if (messageStoreKey !== activeMessageStoreKey) return;
    const persistentMessages = messages.filter((message) => !message.transient);
    const persistedMarker = lastPersistedMessagesRef.current;
    const persistentStateChanged =
      persistedMarker.key !== activeMessageStoreKey ||
      persistedMarker.messages.length !== persistentMessages.length ||
      !persistedMarker.messages.every((message, index) => message === persistentMessages[index]);
    if (!urlSessionId && persistentMessages.length === 0) return;
    const cachedCurrentSession = readLearnSessions(localUserId, activeCourseId).find(
      (session) => session.id === activeSessionId,
    );
    const cachedTitle = cachedCurrentSession?.title?.trim() || '';
    const syncTitle =
      cachedTitle &&
      cachedTitle !== '新对话' &&
      cachedTitle !== '默认学习会话' &&
      !/^新会话\s+\d+$/.test(cachedTitle)
        ? cachedTitle
        : learnSessionTitleFromMessages(persistentMessages, '新对话');
    if (persistentStateChanged) {
      lastPersistedMessagesRef.current = {
        key: activeMessageStoreKey,
        messages: persistentMessages,
      };
      writeLearnSessionMessages(localUserId, activeCourseId, activeSessionId, persistentMessages);
      writeLearnSessionTabMessages(
        localUserId,
        activeCourseId,
        activeSessionId,
        persistentMessages,
      );
      setLearnSessions((current) => {
        const now = Date.now();
        const latestMessageUpdatedAt = learnSessionUpdatedAtFromMessages(persistentMessages);
        const byId = new Map<string, LearnChatSession>();
        for (const session of current) byId.set(session.id, session);
        const currentSession = byId.get(activeSessionId);
        const fallbackTitle =
          currentSession?.title &&
          currentSession.title !== '默认学习会话' &&
          !/^新会话\s+\d+$/.test(currentSession.title)
            ? currentSession.title
            : '新对话';
        byId.set(activeSessionId, {
          id: activeSessionId,
          title: learnSessionTitleFromMessages(persistentMessages, fallbackTitle),
          createdAt: currentSession?.createdAt ?? now,
          updatedAt: latestMessageUpdatedAt ?? currentSession?.updatedAt ?? now,
          messageCount: Math.max(
            currentSession?.messageCount ?? 0,
            persistentMessages.filter(learnMessageHasContent).length,
          ),
          currentRevision: currentSession?.currentRevision,
          remoteState: currentSession?.remoteState,
        });
        const nextSessions = pruneDuplicateBlankLearnSessions(
          localUserId,
          activeCourseId,
          sortLearnSessionsForList(localUserId, activeCourseId, Array.from(byId.values())),
          activeSessionId,
          (sessionId) =>
            Boolean(
              composerAttachmentsBySessionRef.current.get(
                `${localUserId}:${activeCourseId}:${sessionId}`,
              )?.length,
            ),
        );
        writeLearnSessions(localUserId, activeCourseId, nextSessions);
        return nextSessions;
      });
    }
    const dirtyById = dirtyConversationMessagesRef.current.get(activeMessageStoreKey);
    const dirtyMessages = dirtyById ? Array.from(dirtyById.values()) : [];
    writeLearnSessionDirtyMessages(localUserId, activeCourseId, activeSessionId, dirtyMessages);
    if (remoteConversationReadyKey !== activeMessageStoreKey) return;
    if (!initialBootSettled) return;
    // A streaming turn may update the assistant message dozens of times per
    // second. Persist the completed turn once instead of competing with the SSE
    // reader and repeatedly reconciling the same conversation revision.
    if (sending) return;

    const deletedMessageIds = Array.from(
      readDeletedLearnMessageIds(localUserId, activeCourseId, activeSessionId),
    ).sort();
    if (dirtyMessages.length === 0 && deletedMessageIds.length === 0) return;
    const syncSignature = learnConversationSyncSignature({
      key: activeMessageStoreKey,
      title: syncTitle,
      messages: dirtyMessages,
      deletedMessageIds,
    });
    if (lastSyncedConversationRef.current === syncSignature) return;
    lastSyncedConversationRef.current = syncSignature;
    setRemoteConversationSummaryState((current) =>
      current?.key === activeMessageStoreKey ? null : current,
    );
    setRemoteConversationSyncError(null);
    void syncRemoteLearnConversation({
      courseId: activeCourseId,
      sessionId: activeSessionId,
      title: syncTitle,
      messages: dirtyMessages,
      dirtyMessages,
      deletedMessageIds,
      ownerScope: localUserId,
    }).then((ok) => {
      if (ok) {
        const submittedDeletedMessageIdSet = new Set(deletedMessageIds);
        const currentDirtyById = dirtyConversationMessagesRef.current.get(activeMessageStoreKey);
        if (currentDirtyById) {
          for (const submittedMessage of dirtyMessages) {
            if (
              remoteLearnMessagePayloadEqual(
                currentDirtyById.get(submittedMessage.id),
                submittedMessage,
              )
            ) {
              currentDirtyById.delete(submittedMessage.id);
            }
          }
          if (currentDirtyById.size === 0) {
            dirtyConversationMessagesRef.current.delete(activeMessageStoreKey);
          }
          writeLearnSessionDirtyMessages(
            localUserId,
            activeCourseId,
            activeSessionId,
            Array.from(currentDirtyById.values()),
          );
        }
        const acceptedBase = getRemoteLearnConversationBaseSnapshot(
          activeCourseId,
          activeSessionId,
          localUserId,
        );
        if (acceptedBase) {
          writeLearnSessionRemoteBase(localUserId, activeCourseId, activeSessionId, acceptedBase);
          setLearnSessions((current) => {
            const nextSessions = current.map((session) =>
              session.id === activeSessionId
                ? {
                    ...session,
                    currentRevision: acceptedBase.revision,
                    remoteState: 'remote' as const,
                  }
                : session,
            );
            writeLearnSessions(localUserId, activeCourseId, nextSessions);
            return nextSessions;
          });
          const pendingDeletedMessageIds = readDeletedLearnMessageIds(
            localUserId,
            activeCourseId,
            activeSessionId,
          );
          const remainingDeletedMessageIds = new Set(
            Array.from(pendingDeletedMessageIds).filter(
              (id) => !submittedDeletedMessageIdSet.has(id),
            ),
          );
          writeDeletedLearnMessageIds(
            localUserId,
            activeCourseId,
            activeSessionId,
            remainingDeletedMessageIds,
          );
        }
        if (activeMessageStoreKeyRef.current === activeMessageStoreKey) {
          setRemoteConversationSyncError(null);
        }
      } else if (
        activeMessageStoreKeyRef.current === activeMessageStoreKey &&
        lastSyncedConversationRef.current === syncSignature
      ) {
        lastSyncedConversationRef.current = '';
        setRemoteConversationSyncError(
          getRemoteLearnConversationSyncError(activeCourseId, activeSessionId, localUserId) ||
            '远端会话没有接受本次同步，本地消息仍保留。',
        );
      }
    });
  }, [
    activeCourseId,
    activeMessageStoreKey,
    activeSessionId,
    initialBootSettled,
    localUserId,
    messageStoreKey,
    messages,
    remoteConversationReadyKey,
    remoteConversationSyncAttempt,
    sending,
    urlSessionId,
  ]);

  useEffect(() => {
    if (previewLearnHome) {
      setCourses([]);
      setCoursesLoadState('ready');
      setActiveCourseId(null);
      return;
    }
    if (!hydrated) return;
    if (!isLoggedIn) {
      router.replace('/login');
      return;
    }
    let alive = true;
    setCourseLoadError(null);
    const cachedCourses = readLearnCourseListCache(localUserId, { allowStale: true });
    const cachedCourseList = urlCourseId
      ? cachedCourses?.filter((course) => course.id === urlCourseId)
      : cachedCourses;
    if (urlCourseId) {
      const storedCourseHint = useCurrentCourseStore.getState();
      setCourses(
        cachedCourseList?.length
          ? cachedCourseList
          : [
              courseShellFromUrl(urlCourseId, {
                id: storedCourseHint.id,
                name: storedCourseHint.name,
                avatarUrl: storedCourseHint.avatarUrl,
              }),
            ],
      );
      setActiveCourseId(urlCourseId);
      setCoursesLoadState('ready');
    } else {
      setCoursesLoadState('loading');
      if (cachedCourseList?.length) {
        setCourses(cachedCourseList);
        setCoursesLoadState('ready');
      }
    }
    if (debugNoCourses) {
      setCourses([]);
      setCoursesLoadState('ready');
      return () => {
        alive = false;
      };
    }
    // `switchCourse` updates the optimistic active shell before the router
    // commits its query string. Never pair that new boot key with the previous
    // URL course's request; the next render starts the correctly matched read.
    if (urlCourseId && activeCourseId !== urlCourseId) {
      return () => {
        alive = false;
      };
    }
    const bootKey = activeCourseBootKey;
    if (urlCourseId && !bootKey) {
      return () => {
        alive = false;
      };
    }
    if (urlCourseId) setInitialBootSettledKey('');
    const controller = new AbortController();
    const courseRequest = urlCourseId
      ? enqueueInitialLearnBootRequest({
          key: bootKey,
          request: () =>
            getCourseOrThrow(urlCourseId, { signal: controller.signal }).then((course) => [course]),
        })
      : listCoursesOrThrow({ signal: controller.signal });
    courseRequest
      .then((items) => {
        if (!alive) return;
        if (items.length === 0 && cachedCourseList?.length) {
          setCoursesLoadState('ready');
          return;
        }
        if (urlCourseId && items[0]) {
          const nextCachedCourses = [
            items[0],
            ...(cachedCourses || []).filter((course) => course.id !== items[0].id),
          ];
          writeLearnCourseListCache(localUserId, nextCachedCourses);
        } else if (!urlCourseId) {
          writeLearnCourseListCache(localUserId, items);
        }
        setCourses(items);
        setCoursesLoadState('ready');
      })
      .catch((err) => {
        if (
          !alive ||
          controller.signal.aborted ||
          (urlCourseId && activeCourseBootKeyRef.current !== bootKey)
        ) {
          return;
        }
        const reason = err instanceof Error ? err.message : '课程加载失败';
        const accessUnavailable =
          err instanceof BackendApiError && (err.status === 403 || err.status === 404);
        if (accessUnavailable) {
          setCourses((current) => current.filter((course) => course.id !== urlCourseId));
          setCourseLoadError(reason);
          setCoursesLoadState('ready');
          return;
        }
        if (urlCourseId) {
          setCoursesLoadState('ready');
          setCourseLoadError(
            cachedCourseList?.length
              ? `课程刷新失败，当前显示缓存数据：${reason}`
              : `课程详情暂时不可用，学习空间已先打开：${reason}`,
          );
          return;
        }
        if (cachedCourseList?.length) {
          setCoursesLoadState('ready');
          setCourseLoadError(`课程刷新失败，当前显示缓存数据：${reason}`);
          return;
        }
        setCoursesLoadState('error');
        setCourseLoadError(reason);
      })
      .finally(() => {
        if (alive && urlCourseId && bootKey && activeCourseBootKeyRef.current === bootKey) {
          setInitialBootSettledKey(bootKey);
        }
      });
    return () => {
      alive = false;
      controller.abort(new DOMException('课程已切换', 'AbortError'));
    };
  }, [
    activeCourseId,
    activeCourseBootKey,
    courseLoadAttempt,
    debugNoCourses,
    enqueueInitialLearnBootRequest,
    hydrated,
    isLoggedIn,
    localUserId,
    previewLearnHome,
    router,
    setCurrentCourse,
    urlCourseId,
  ]);

  useEffect(() => {
    if (previewLearnHome) {
      setActiveCourseId(null);
      return;
    }
    if (coursesLoadState !== 'ready') return;
    if (showLearnHomeDashboard) {
      setActiveCourseId((current) => (current === null ? current : null));
      return;
    }
    if (debugNoCourses) {
      setActiveCourseId((current) => (current === null ? current : null));
      return;
    }
    const nextCourseId =
      urlCourseId && courses.some((course) => course.id === urlCourseId) ? urlCourseId : null;
    setActiveCourseId((current) => (current === nextCourseId ? current : nextCourseId));
  }, [
    courses,
    coursesLoadState,
    debugNoCourses,
    previewLearnHome,
    showLearnHomeDashboard,
    urlCourseId,
  ]);

  useEffect(() => {
    if (!activeCourse) {
      clearCurrentCourse();
      setCourseSourceUploads([]);
      setPublishableMemoryCount(null);
      setPracticeSessions([]);
      setPracticePopupSessionId(null);
      setNotebooks([]);
      setProblems([]);
      setSnapshot(null);
      setProblemsHydrationWanted(false);
      setNotebooksHydrationWanted(false);
      setNotebooksLoadState(emptyResourceLoadState());
      setProblemsLoadState(emptyResourceLoadState());
      setSourcesLoadState(emptyResourceLoadState());
      problemHydrationAbortRef.current?.abort();
      notebookHydrationAbortRef.current?.abort();
      problemHydrationAbortRef.current = null;
      notebookHydrationAbortRef.current = null;
      problemLoadPromiseRef.current = null;
      notebookLoadPromiseRef.current = null;
      return;
    }
    if (!isProvisionalCourseShell(activeCourse) || isUsefulCourseShellName(activeCourse.name)) {
      setCurrentCourse({
        id: activeCourse.id,
        name: activeCourse.name,
        avatarUrl: activeCourse.avatarUrl,
      });
    }
    const courseId = activeCourse.id;
    const localCourseUserId = userId || 'anonymous';
    const cachedAssets = courseAssetCacheRef.current.get(courseId);
    const cachedSources = cachedAssets?.sourceUploads ?? [];
    const cachedNotebooks = cachedAssets?.notebooks ?? [];
    const cachedProblems = cachedAssets?.problems ?? [];

    setError(null);
    setSourceLibraryTextCache({});
    setCourseSourceUploads(cachedSources);
    setNotebooks(cachedNotebooks);
    setProblems(cachedProblems);
    setProblemsHydrationWanted(false);
    setNotebooksHydrationWanted(false);
    // Chat page only needs lightweight content-state for status. Full lists stay
    // deferred until practice / publish / explicit hydration asks for them.
    setNotebooksLoadState(
      cachedAssets?.notebooks
        ? settledResourceLoadState({ courseId, itemCount: cachedNotebooks.length })
        : emptyResourceLoadState(),
    );
    setProblemsLoadState(
      cachedAssets?.problems
        ? settledResourceLoadState({ courseId, itemCount: cachedProblems.length })
        : emptyResourceLoadState(),
    );
    setSourcesLoadState(
      cachedAssets?.sourceUploads
        ? settledResourceLoadState({ courseId, itemCount: cachedSources.length })
        : emptyResourceLoadState(),
    );
    const localState = loadLearnerCourseState({ userId: localCourseUserId, courseId });
    const initialSnapshot = summarizeLearnerCourseState({
      state: localState,
      notebooks: cachedNotebooks,
      problems: cachedProblems,
    });
    setSnapshot(initialSnapshot);
    setProgressSelection(progressSelectionFromSnapshot(initialSnapshot));

    const deletedPlanIds = readDeletedPracticePlanIds(localCourseUserId, courseId);
    const localPlans = visiblePracticePlans(
      listPracticePlans(localCourseUserId, courseId),
      deletedPlanIds,
    );
    setRecentPlans(localPlans.slice(0, 4));
    setPracticeSessions(listPracticeSessions(localCourseUserId, courseId));
  }, [activeCourse, clearCurrentCourse, setCurrentCourse, userId]);

  useEffect(() => {
    if (!activeCourse || !firstResourceRoundReady) return;
    let alive = true;
    const courseId = activeCourse.id;
    const localCourseUserId = userId || 'anonymous';
    const deletedPlanIds = readDeletedPracticePlanIds(localCourseUserId, courseId);
    const localPlans = visiblePracticePlans(
      listPracticePlans(localCourseUserId, courseId),
      deletedPlanIds,
    );
    void enqueueDeferredLearnDataRequest({
      courseId,
      request: () => listRemotePracticePlans(courseId),
    })
      .then((remotePlans) => {
        if (!alive) return;
        const nextDeletedPlanIds = readDeletedPracticePlanIds(localCourseUserId, courseId);
        const visibleRemotePlans = visiblePracticePlans(remotePlans, nextDeletedPlanIds);
        visibleRemotePlans.forEach(savePracticePlan);
        setRecentPlans(
          mergePlans(
            visiblePracticePlans(localPlans, nextDeletedPlanIds),
            visibleRemotePlans,
          ).slice(0, 4),
        );
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [activeCourse, enqueueDeferredLearnDataRequest, firstResourceRoundReady, userId]);

  const hydrateCourseProblems = useCallback(
    async (courseId: string): Promise<CourseProblemClientSummary[]> => {
      if (problemLoadPromiseRef.current?.courseId === courseId) {
        return problemLoadPromiseRef.current.promise;
      }
      const cachedProblems = courseAssetCacheRef.current.get(courseId)?.problems;
      const controller = new AbortController();
      problemHydrationAbortRef.current?.abort();
      problemHydrationAbortRef.current = controller;
      setProblems(cachedProblems ?? []);
      setProblemsLoadState(
        loadingResourceLoadState({ courseId, usingCachedData: Boolean(cachedProblems) }),
      );

      const loadPromise = enqueueCourseResourceRequest({
        courseId,
        kind: 'problems',
        signal: controller.signal,
        request: () =>
          listCourseProblemSummaries(courseId, {
            lean: true,
            signal: controller.signal,
            timeoutMs: COURSE_RESOURCE_TIMEOUT_MS,
          }),
      })
        .then((nextProblems) => {
          if (controller.signal.aborted || activeCourseIdRef.current !== courseId) {
            return nextProblems;
          }
          courseAssetCacheRef.current.set(courseId, {
            ...(courseAssetCacheRef.current.get(courseId) ?? {}),
            problems: nextProblems,
          });
          clearCourseContentRepairRetry(courseId, 'problems');
          setProblems(nextProblems);
          setProblemsLoadState(
            settledResourceLoadState({ courseId, itemCount: nextProblems.length }),
          );
          const currentNotebooks = courseAssetCacheRef.current.get(courseId)?.notebooks ?? [];
          const currentState = loadLearnerCourseState({
            userId: userId || 'anonymous',
            courseId,
          });
          const nextSnapshot = summarizeLearnerCourseState({
            state: currentState,
            notebooks: currentNotebooks,
            problems: nextProblems,
          });
          setSnapshot(nextSnapshot);
          setProgressSelection(progressSelectionFromSnapshot(nextSnapshot));
          return nextProblems;
        })
        .catch((err) => {
          if (controller.signal.aborted || activeCourseIdRef.current !== courseId) {
            throw err;
          }
          setProblemsLoadState(
            failedResourceLoadState({
              courseId,
              error: err,
              usingCachedData: Boolean(cachedProblems),
            }),
          );
          scheduleCourseContentRepairRetry(courseId, 'problems');
          throw err;
        })
        .finally(() => {
          if (problemLoadPromiseRef.current?.promise === loadPromise) {
            problemLoadPromiseRef.current = null;
          }
        });

      problemLoadPromiseRef.current = { courseId, promise: loadPromise };
      return loadPromise;
    },
    [
      clearCourseContentRepairRetry,
      enqueueCourseResourceRequest,
      scheduleCourseContentRepairRetry,
      userId,
    ],
  );

  const hydrateCourseNotebooks = useCallback(
    async (courseId: string): Promise<StageListItem[]> => {
      if (notebookLoadPromiseRef.current?.courseId === courseId) {
        return notebookLoadPromiseRef.current.promise;
      }
      const cachedNotebooks = courseAssetCacheRef.current.get(courseId)?.notebooks;
      const controller = new AbortController();
      notebookHydrationAbortRef.current?.abort();
      notebookHydrationAbortRef.current = controller;
      setNotebooks(cachedNotebooks ?? []);
      setNotebooksLoadState(
        loadingResourceLoadState({ courseId, usingCachedData: Boolean(cachedNotebooks) }),
      );

      const loadPromise = enqueueCourseResourceRequest({
        courseId,
        kind: 'notebooks',
        signal: controller.signal,
        request: () =>
          listStagesByCourseOrThrow(courseId, {
            signal: controller.signal,
            timeoutMs: COURSE_RESOURCE_TIMEOUT_MS,
          }),
      })
        .then((nextNotebooks) => {
          if (controller.signal.aborted || activeCourseIdRef.current !== courseId) {
            return nextNotebooks;
          }
          courseAssetCacheRef.current.set(courseId, {
            ...(courseAssetCacheRef.current.get(courseId) ?? {}),
            notebooks: nextNotebooks,
          });
          clearCourseContentRepairRetry(courseId, 'notebooks');
          setNotebooks(nextNotebooks);
          setNotebooksLoadState(
            settledResourceLoadState({ courseId, itemCount: nextNotebooks.length }),
          );

          const currentProblems = courseAssetCacheRef.current.get(courseId)?.problems ?? [];
          const course = courses.find((item) => item.id === courseId) ?? activeCourse;
          if (course) {
            const seeded = seedLearnerCourseStateFromCourse({
              userId: userId || 'anonymous',
              course,
              notebooks: nextNotebooks,
              problems: currentProblems,
            });
            const nextSnapshot = summarizeLearnerCourseState({
              state: seeded,
              notebooks: nextNotebooks,
              problems: currentProblems,
            });
            setSnapshot(nextSnapshot);
            setProgressSelection(progressSelectionFromSnapshot(nextSnapshot));
          }
          return nextNotebooks;
        })
        .catch((err) => {
          if (controller.signal.aborted || activeCourseIdRef.current !== courseId) {
            throw err;
          }
          setNotebooksLoadState(
            failedResourceLoadState({
              courseId,
              error: err,
              usingCachedData: Boolean(cachedNotebooks),
            }),
          );
          scheduleCourseContentRepairRetry(courseId, 'notebooks');
          throw err;
        })
        .finally(() => {
          if (notebookLoadPromiseRef.current?.promise === loadPromise) {
            notebookLoadPromiseRef.current = null;
          }
        });

      notebookLoadPromiseRef.current = { courseId, promise: loadPromise };
      return loadPromise;
    },
    [
      activeCourse,
      clearCourseContentRepairRetry,
      courses,
      enqueueCourseResourceRequest,
      scheduleCourseContentRepairRetry,
      userId,
    ],
  );

  const ensureProblemsLoaded = useCallback(async (): Promise<CourseProblemClientSummary[]> => {
    if (!activeCourse || !activeCourseCanLoadResources) return problems;
    const courseId = activeCourse.id;
    setProblemsHydrationWanted(true);
    const state = problemsLoadStateRef.current;
    if (
      state.courseId === courseId &&
      (state.status === 'ready' || state.status === 'empty') &&
      !problemLoadPromiseRef.current
    ) {
      return courseAssetCacheRef.current.get(courseId)?.problems ?? problems;
    }
    try {
      return await hydrateCourseProblems(courseId);
    } catch {
      return courseAssetCacheRef.current.get(courseId)?.problems ?? problems;
    }
  }, [activeCourse, activeCourseCanLoadResources, hydrateCourseProblems, problems]);

  const ensureNotebooksLoaded = useCallback(async (): Promise<StageListItem[]> => {
    if (!activeCourse || !activeCourseCanLoadResources) return notebooks;
    const courseId = activeCourse.id;
    setNotebooksHydrationWanted(true);
    const state = notebooksLoadStateRef.current;
    if (
      state.courseId === courseId &&
      (state.status === 'ready' || state.status === 'empty') &&
      !notebookLoadPromiseRef.current
    ) {
      return courseAssetCacheRef.current.get(courseId)?.notebooks ?? notebooks;
    }
    try {
      return await hydrateCourseNotebooks(courseId);
    } catch {
      return courseAssetCacheRef.current.get(courseId)?.notebooks ?? notebooks;
    }
  }, [activeCourse, activeCourseCanLoadResources, hydrateCourseNotebooks, notebooks]);

  useEffect(() => {
    if (!activeCourse || !activeCourseCanLoadResources || !problemsHydrationWanted) return;
    if (resourceLoadAttempts.problems === 0) return;
    void hydrateCourseProblems(activeCourse.id).catch(() => undefined);
  }, [
    activeCourse,
    activeCourseCanLoadResources,
    hydrateCourseProblems,
    problemsHydrationWanted,
    resourceLoadAttempts.problems,
  ]);

  useEffect(() => {
    if (!activeCourse || !activeCourseCanLoadResources || !notebooksHydrationWanted) return;
    if (resourceLoadAttempts.notebooks === 0) return;
    void hydrateCourseNotebooks(activeCourse.id).catch(() => undefined);
  }, [
    activeCourse,
    activeCourseCanLoadResources,
    hydrateCourseNotebooks,
    notebooksHydrationWanted,
    resourceLoadAttempts.notebooks,
  ]);

  useEffect(() => {
    if (!activeCourse || !firstResourceRoundReady) return;
    let alive = true;
    const courseId = activeCourse.id;
    void enqueueDeferredLearnDataRequest({
      courseId,
      request: () => loadRemoteLearnerCourseState(courseId),
    })
      .then((remoteState) => {
        if (!alive || activeCourseIdRef.current !== courseId) return;
        const localState = loadLearnerCourseState({
          userId: userId || 'anonymous',
          courseId,
        });
        if (
          remoteState &&
          (localState.progressCheckpoint?.source !== 'student' ||
            remoteState.updatedAt >= localState.updatedAt)
        ) {
          saveLearnerCourseState(remoteState);
        } else if (localState.progressCheckpoint?.source === 'student') {
          progressSavePromiseRef.current = {
            courseId,
            promise: saveRemoteLearnerCourseState(localState),
          };
        }
        const mergedState = seedLearnerCourseStateFromCourse({
          userId: userId || 'anonymous',
          course: activeCourse,
          notebooks,
          problems,
        });
        const mergedSnapshot = summarizeLearnerCourseState({
          state: mergedState,
          notebooks,
          problems,
        });
        setSnapshot(mergedSnapshot);
        setProgressSelection(progressSelectionFromSnapshot(mergedSnapshot));
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [
    activeCourse,
    enqueueDeferredLearnDataRequest,
    firstResourceRoundReady,
    notebooks,
    problems,
    userId,
  ]);

  useEffect(() => {
    if (!publishDialogOpen || !activeCourse || !activeCourseCanLoadResources) return;
    void ensureNotebooksLoaded();
    void ensureProblemsLoaded();
  }, [
    activeCourse,
    activeCourseCanLoadResources,
    ensureNotebooksLoaded,
    ensureProblemsLoaded,
    publishDialogOpen,
  ]);

  useEffect(() => {
    if (!sourceUploadPanelOpen || !activeCourse || !activeCourseCanLoadResources) return;
    // Source library also lists notebooks not backed by an upload.
    void ensureNotebooksLoaded();
  }, [activeCourse, activeCourseCanLoadResources, ensureNotebooksLoaded, sourceUploadPanelOpen]);

  useEffect(() => {
    if (!notebookLibraryPanelOpen || !activeCourse || !activeCourseCanLoadResources) return;
    void ensureNotebooksLoaded();
  }, [activeCourse, activeCourseCanLoadResources, ensureNotebooksLoaded, notebookLibraryPanelOpen]);

  useEffect(() => {
    if (rightRailView !== 'overview' || !activeCourse || !activeCourseCanLoadResources) return;
    void ensureNotebooksLoaded();
  }, [activeCourse, activeCourseCanLoadResources, ensureNotebooksLoaded, rightRailView]);

  useEffect(() => {
    if (!activeCourse || !activeCourseCanLoadResources || !sourceUploadPanelOpen) return;
    const courseId = activeCourse.id;
    const cachedSources = courseAssetCacheRef.current
      .get(courseId)
      ?.sourceUploads?.filter((upload) => upload.courseId === courseId);
    const controller = new AbortController();
    let alive = true;
    setCourseSourceUploads(cachedSources ?? []);
    setSourcesLoadState(
      loadingResourceLoadState({ courseId, usingCachedData: Boolean(cachedSources) }),
    );

    void enqueueCourseResourceRequest({
      courseId,
      kind: 'sources',
      signal: controller.signal,
      request: () =>
        listCourseSourceUploads(courseId, {
          // The popup grid only needs catalog metadata. Notebook/source text is
          // fetched by the selected-tile effect after the user opens one item.
          includeText: false,
          includeArtifacts: false,
          signal: controller.signal,
          timeoutMs: COURSE_SOURCE_TIMEOUT_MS,
        }),
    })
      .then((loadedSources) => {
        if (!alive) return;
        const nextSources = loadedSources.filter((upload) => upload.courseId === courseId);
        courseAssetCacheRef.current.set(courseId, {
          ...(courseAssetCacheRef.current.get(courseId) ?? {}),
          sourceUploads: nextSources,
        });
        clearCourseContentRepairRetry(courseId, 'sources');
        setCourseSourceUploads(nextSources);
        setSourcesLoadState(settledResourceLoadState({ courseId, itemCount: nextSources.length }));
      })
      .catch((err) => {
        if (!alive || controller.signal.aborted) return;
        setSourcesLoadState(
          failedResourceLoadState({
            courseId,
            error: err,
            usingCachedData: Boolean(cachedSources),
          }),
        );
        scheduleCourseContentRepairRetry(courseId, 'sources');
      });

    return () => {
      alive = false;
      controller.abort(new DOMException('课程已切换', 'AbortError'));
    };
  }, [
    activeCourse,
    activeCourseCanLoadResources,
    clearCourseContentRepairRetry,
    enqueueCourseResourceRequest,
    resourceLoadAttempts.sources,
    scheduleCourseContentRepairRetry,
    sourceUploadPanelOpen,
    userId,
  ]);

  useEffect(() => {
    if (!activeCourse?.id || !activeCourseCanLoadResources) {
      setCourseContentWatchError(null);
      setCourseContentStateRevision('');
      return;
    }

    const courseId = activeCourse.id;
    const sharedStateStorageKey = courseContentStateStorageKey(localUserId, courseId);
    const controller = new AbortController();
    let alive = true;
    let requestInFlight = false;
    let consecutiveFailures = 0;
    let timerId: number | null = null;
    let contentStateChannel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        contentStateChannel = new BroadcastChannel(
          `${COURSE_CONTENT_STATE_CHANNEL_PREFIX}${encodeURIComponent(localUserId)}:${courseId}`,
        );
      }
    } catch {
      contentStateChannel = null;
    }
    let nextAllowedPollAt = Date.now() + COURSE_CONTENT_STATE_INITIAL_DELAY_MS;
    const nextSuccessPollDelay = () =>
      Date.now() < (courseContentMutationHotUntilRef.current.get(courseId) ?? 0)
        ? COURSE_CONTENT_STATE_HOT_POLL_MS
        : COURSE_CONTENT_STATE_POLL_MS;

    const clearScheduledPoll = () => {
      if (timerId === null) return;
      window.clearTimeout(timerId);
      timerId = null;
    };
    const schedulePoll = (delayMs: number) => {
      if (!alive || document.visibilityState === 'hidden') return;
      clearScheduledPoll();
      timerId = window.setTimeout(() => void requestCourseContentPoll(), Math.max(0, delayMs));
    };

    const applyCourseContentState = (nextState: CourseContentState) => {
      if (!alive || nextState.courseId !== courseId) return;
      const previousState = courseContentStateRef.current.get(courseId);
      courseContentStateRef.current.set(courseId, nextState);
      setCourseContentStateRevision(`${courseId}:${nextState.revision}`);
      setCourseContentWatchError((current) => (current?.courseId === courseId ? null : current));
      consecutiveFailures = 0;
      nextAllowedPollAt = Date.now() + nextSuccessPollDelay();

      if (!previousState || previousState.revision === nextState.revision) return;
      courseContentMutationHotUntilRef.current.set(
        courseId,
        Date.now() + COURSE_CONTENT_STATE_HOT_WINDOW_MS,
      );
      nextAllowedPollAt = Date.now() + COURSE_CONTENT_STATE_HOT_POLL_MS;
      const changedKinds: CourseResourceKind[] = [];
      if (
        notebooksHydrationWantedRef.current &&
        previousState.notebooks.revision !== nextState.notebooks.revision
      ) {
        changedKinds.push('notebooks');
      }
      if (
        problemsHydrationWantedRef.current &&
        previousState.problems.revision !== nextState.problems.revision
      ) {
        changedKinds.push('problems');
      }
      if (
        sourceUploadPanelOpenRef.current &&
        previousState.sources.revision !== nextState.sources.revision
      ) {
        changedKinds.push('sources');
      }
      if (changedKinds.length === 0) return;

      const nextCachedAssets = {
        ...(courseAssetCacheRef.current.get(courseId) ?? {}),
      };
      for (const kind of changedKinds) {
        if (kind === 'notebooks') delete nextCachedAssets.notebooks;
        if (kind === 'problems') delete nextCachedAssets.problems;
        if (kind === 'sources') delete nextCachedAssets.sourceUploads;
      }
      courseAssetCacheRef.current.set(courseId, nextCachedAssets);
      setResourceLoadAttempts((current) => {
        const nextAttempts = { ...current };
        for (const kind of changedKinds) nextAttempts[kind] += 1;
        return nextAttempts;
      });

      const changedLabels = changedKinds.map((kind) =>
        kind === 'notebooks' ? '笔记本' : kind === 'problems' ? '题库' : '原始讲义',
      );
      toast.info(`已发现服务端内容更新，正在刷新${changedLabels.join('、')}。`);
    };

    const requestCourseContentPoll = async () => {
      if (!alive || document.visibilityState === 'hidden') return;
      const remainingBackoffMs = nextAllowedPollAt - Date.now();
      if (remainingBackoffMs > 0) {
        schedulePoll(remainingBackoffMs);
        return;
      }
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const pollResult = await enqueueDeferredLearnDataRequest({
          courseId,
          request: () =>
            runCourseContentStatePollWithLock({
              courseId,
              ownerScope: localUserId,
              signal: controller.signal,
              request: () =>
                loadCourseContentState(courseId, {
                  signal: controller.signal,
                  timeoutMs: COURSE_CONTENT_STATE_TIMEOUT_MS,
                }),
            }),
        });
        if (!alive) return;

        applyCourseContentState(pollResult.value);
        if (pollResult.source === 'network') {
          try {
            contentStateChannel?.postMessage({
              type: 'course-content-state',
              state: pollResult.value,
            });
          } catch {
            // The local tab already applied and persisted the state.
          }
        }
      } catch (watchError) {
        if (!alive || controller.signal.aborted) return;
        consecutiveFailures += 1;
        const backoffMs = Math.min(
          COURSE_CONTENT_STATE_MAX_BACKOFF_MS,
          COURSE_CONTENT_STATE_FAILURE_BACKOFF_MS * 2 ** Math.min(consecutiveFailures - 1, 3),
        );
        // Browser aborts do not cancel an already-running Prisma query. Waiting
        // at least one pool-timeout window prevents the watcher from stacking
        // abandoned server requests and starving the visible resource loads.
        nextAllowedPollAt = Date.now() + backoffMs;
        setCourseContentWatchError({
          courseId,
          message: watchError instanceof Error ? watchError.message : '无法检查课程内容是否已同步',
        });
      } finally {
        requestInFlight = false;
        if (alive && document.visibilityState === 'visible') {
          schedulePoll(nextAllowedPollAt - Date.now());
        }
      }
    };

    const pollWhenDue = () => {
      clearScheduledPoll();
      void requestCourseContentPoll();
    };
    const forcePoll = () => {
      nextAllowedPollAt = 0;
      clearScheduledPoll();
      void requestCourseContentPoll();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearScheduledPoll();
        return;
      }
      pollWhenDue();
    };
    const applyExternalContentState = (nextState: CourseContentState | null) => {
      if (!nextState) return;
      applyCourseContentState(nextState);
      if (!requestInFlight) {
        clearScheduledPoll();
        schedulePoll(nextAllowedPollAt - Date.now());
      }
    };
    const handleContentStateBroadcast = (event: MessageEvent<unknown>) => {
      applyExternalContentState(courseContentStateFromBroadcast(event.data, courseId));
    };
    const handleContentStateStorage = (event: StorageEvent) => {
      if (event.key !== sharedStateStorageKey || !event.newValue) return;
      applyExternalContentState(readSharedCourseContentState(localUserId, courseId)?.state ?? null);
    };
    contentStateChannel?.addEventListener('message', handleContentStateBroadcast);
    schedulePoll(COURSE_CONTENT_STATE_INITIAL_DELAY_MS);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('storage', handleContentStateStorage);
    window.addEventListener('focus', pollWhenDue);
    window.addEventListener('online', forcePoll);
    return () => {
      alive = false;
      controller.abort(new DOMException('课程已切换', 'AbortError'));
      clearScheduledPoll();
      contentStateChannel?.removeEventListener('message', handleContentStateBroadcast);
      contentStateChannel?.close();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('storage', handleContentStateStorage);
      window.removeEventListener('focus', pollWhenDue);
      window.removeEventListener('online', forcePoll);
    };
  }, [
    activeCourse?.id,
    activeCourseCanLoadResources,
    courseContentWatchAttempt,
    enqueueDeferredLearnDataRequest,
    localUserId,
  ]);

  useEffect(() => {
    const courseId = activeCourse?.id;
    if (!courseId || !courseContentStateRevision.startsWith(`${courseId}:`)) return;
    const expectedState = courseContentStateRef.current.get(courseId);
    if (!expectedState) return;

    const loadStates: Record<CourseResourceKind, ResourceLoadState> = {
      notebooks: notebooksLoadState,
      problems: problemsLoadState,
      sources: sourcesLoadState,
    };
    const cachedAssets = courseAssetCacheRef.current.get(courseId);
    const staleKinds: CourseResourceKind[] = [];

    for (const kind of ['notebooks', 'problems', 'sources'] as const) {
      if (kind === 'sources' && !sourceUploadPanelOpen) continue;
      const loadState = loadStates[kind];
      if (loadState.courseId !== courseId) continue;
      if (loadState.status === 'error') {
        scheduleCourseContentRepairRetry(courseId, kind);
        continue;
      }
      if (loadState.status !== 'ready' && loadState.status !== 'empty') continue;
      const actualRevision = cachedCourseResourceRevision(kind, cachedAssets);
      if (actualRevision === null) continue;
      const expectedRevision = expectedState[kind].revision;
      const repairKey = `${courseId}:${kind}`;
      if (actualRevision === expectedRevision) {
        clearCourseContentRepairRetry(courseId, kind);
        continue;
      }
      const mismatchSignature = `${expectedRevision}|${actualRevision}`;
      const pendingRetry = courseContentRepairRetryRef.current.get(repairKey);
      if (
        pendingRetry?.signature === mismatchSignature &&
        (pendingRetry.timerId !== null ||
          pendingRetry.failures >= COURSE_CONTENT_REPAIR_RETRY_MAX_FAILURES)
      ) {
        continue;
      }
      if (courseContentRepairRef.current.get(repairKey) === mismatchSignature) continue;
      courseContentRepairRef.current.set(repairKey, mismatchSignature);
      staleKinds.push(kind);
    }

    if (staleKinds.length === 0) return;
    const nextCachedAssets = { ...(cachedAssets ?? {}) };
    for (const kind of staleKinds) {
      if (kind === 'notebooks') delete nextCachedAssets.notebooks;
      if (kind === 'problems') delete nextCachedAssets.problems;
      if (kind === 'sources') delete nextCachedAssets.sourceUploads;
    }
    courseAssetCacheRef.current.set(courseId, nextCachedAssets);
    setResourceLoadAttempts((current) => {
      const nextAttempts = { ...current };
      for (const kind of staleKinds) nextAttempts[kind] += 1;
      return nextAttempts;
    });
  }, [
    activeCourse?.id,
    clearCourseContentRepairRetry,
    courseContentStateRevision,
    notebooksLoadState,
    problemsLoadState,
    scheduleCourseContentRepairRetry,
    sourceUploadPanelOpen,
    sourcesLoadState,
  ]);

  useEffect(() => {
    if (!activeCourse?.id || activeSourceUploadItems.length === 0) return;
    const matches = activeSourceUploadItems.flatMap((item) => {
      const upload = activeCourseSourceUploads.find((candidate) => {
        if (item.sourceHash) return candidate.sourceHash === item.sourceHash;
        if (candidate.title.trim() !== item.fileName.trim()) return false;
        const updatedAt = Date.parse(candidate.updatedAt);
        return Number.isFinite(updatedAt) && updatedAt >= item.createdAt - 60_000;
      });
      if (!upload) return [];
      const summary =
        upload.ingestStatus === 'processing'
          ? '服务端已接收文件，仍在处理；后续状态以原始讲义卡片为准。'
          : upload.ingestStatus === 'error'
            ? upload.errorReason || '服务端确认原始讲义入库失败。'
            : '服务端已确认原始讲义入库。';
      if (
        item.status === 'stored' &&
        item.sourceHash === upload.sourceHash &&
        item.summary === summary
      ) {
        return [];
      }
      return [{ item, upload, summary }];
    });
    if (matches.length === 0) return;

    const byItemId = new Map(matches.map((match) => [match.item.id, match] as const));
    setSourceUploadItems((current) =>
      current.map((item) => {
        const match = byItemId.get(item.id);
        if (!match) return item;
        return {
          ...item,
          status: 'stored',
          sourceHash: match.upload.sourceHash,
          summary: match.summary,
          error: undefined,
          updatedAt: Date.now(),
        };
      }),
    );
    if (matches.some(({ upload }) => upload.ingestStatus === 'ready')) {
      setResourceLoadAttempts((current) => ({
        notebooks: current.notebooks + 1,
        problems: current.problems + 1,
        sources: current.sources + 1,
      }));
      markCourseContentMutation(activeCourse.id);
    }
    for (const { item, upload, summary } of matches) {
      if (!item.activityId || upload.ingestStatus === 'processing') continue;
      updateMemoryActivity(item.activityId, {
        title: upload.ingestStatus === 'ready' ? '原始讲义已入库' : '原始讲义入库失败',
        description: summary,
        status: upload.ingestStatus === 'ready' ? 'completed' : 'failed',
        layer: 'knowledge_index',
        error: upload.ingestStatus === 'error' ? summary : undefined,
      });
    }
  }, [
    activeCourse?.id,
    activeCourseSourceUploads,
    activeSourceUploadItems,
    markCourseContentMutation,
  ]);

  useEffect(() => {
    if (!activeCourse?.id) return;
    const now = Date.now();
    const slowItemIds = new Set(
      activeSourceUploadItems
        .filter(
          (item) =>
            item.status === 'ingesting' && now - item.createdAt >= COURSE_SOURCE_PROCESSING_SLOW_MS,
        )
        .map((item) => item.id),
    );
    const timedOutItems = activeSourceUploadItems.filter(
      (item) =>
        (item.status === 'ingesting' || item.status === 'ingesting_slow') &&
        now - item.createdAt >= COURSE_SOURCE_PROCESSING_HARD_TIMEOUT_MS,
    );
    if (slowItemIds.size > 0 || timedOutItems.length > 0) {
      const timedOutIds = new Set(timedOutItems.map((item) => item.id));
      setSourceUploadItems((current) =>
        current.map((item) => {
          if (timedOutIds.has(item.id)) {
            return {
              ...item,
              status: 'failed',
              error: '原始讲义上传超过 15 分钟仍未得到服务端确认，可以重试上传。',
              updatedAt: now,
            };
          }
          if (slowItemIds.has(item.id)) {
            return {
              ...item,
              status: 'ingesting_slow',
              summary: '上传耗时较长，仍在服务端处理中，请勿重复提交。',
              updatedAt: now,
            };
          }
          return item;
        }),
      );
      for (const item of timedOutItems) {
        if (!item.activityId) continue;
        updateMemoryActivity(item.activityId, {
          title: '原始讲义入库超时',
          description: item.fileName,
          status: 'failed',
          layer: 'knowledge_index',
          error: '原始讲义上传超过 15 分钟仍未得到服务端确认。',
        });
      }
    }

    const hasFreshPendingSourceWork =
      activeSourceUploadItems.some(
        (item) =>
          sourceUploadStatusIsProcessing(item.status) &&
          now - item.createdAt < COURSE_SOURCE_PROCESSING_HARD_TIMEOUT_MS,
      ) ||
      activeCourseSourceUploads.some((upload) => {
        if (upload.courseId !== activeCourse.id) return false;
        return sourceUploadStatusIsProcessing(persistedSourceUploadTileState(upload).status);
      });
    const hasServerPendingSourceWork = activeCourseSourceUploads.some(
      (upload) =>
        upload.courseId === activeCourse.id &&
        (upload.ingestStatus === 'processing' ||
          upload.indexStatus === 'pending' ||
          upload.indexStatus === 'indexing'),
    );
    if (!hasFreshPendingSourceWork && !hasServerPendingSourceWork) return;

    const timer = window.setTimeout(
      () => {
        retryCourseResource('sources');
      },
      hasFreshPendingSourceWork ? COURSE_SOURCE_STATUS_POLL_MS : COURSE_SOURCE_STALLED_POLL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [activeCourse?.id, activeCourseSourceUploads, activeSourceUploadItems, retryCourseResource]);

  useEffect(() => {
    if (
      !activeCourse ||
      !activeCourseIsOwner ||
      !firstResourceRoundReady ||
      (!publishDialogOpen && !memoryActivityDialogOpen)
    ) {
      setPublishableMemoryCount(null);
      return;
    }
    let alive = true;
    void enqueueDeferredLearnDataRequest({
      courseId: activeCourse.id,
      request: () => listStudyMemoryRecords({ targetType: 'course', targetId: activeCourse.id }),
    })
      .catch(() => [])
      .then((courseMemories) => {
        if (!alive) return;
        setPublishableMemoryCount(
          courseMemories.filter((memory) => memory.scope === 'public' && memory.status === 'active')
            .length,
        );
      });
    return () => {
      alive = false;
    };
  }, [
    activeCourse,
    activeCourseIsOwner,
    enqueueDeferredLearnDataRequest,
    firstResourceRoundReady,
    memoryActivityDialogOpen,
    publishDialogOpen,
  ]);

  const refreshLearnerSnapshot = useCallback(() => {
    if (!activeCourse) return;
    const localUserId = userId || 'anonymous';
    const nextState = loadLearnerCourseState({
      userId: localUserId,
      courseId: activeCourse.id,
    });
    const nextSnapshot = summarizeLearnerCourseState({ state: nextState, notebooks, problems });
    setSnapshot(nextSnapshot);
    setProgressSelection(progressSelectionFromSnapshot(nextSnapshot));
    void saveRemoteLearnerCourseState(nextState);
    const deletedPlanIds = readDeletedPracticePlanIds(localUserId, activeCourse.id);
    const localPlans = visiblePracticePlans(
      listPracticePlans(localUserId, activeCourse.id),
      deletedPlanIds,
    );
    setRecentPlans(localPlans.slice(0, 4));
    setPracticeSessions(listPracticeSessions(localUserId, activeCourse.id));
    void listRemotePracticePlans(activeCourse.id).then((remotePlans) => {
      const nextDeletedPlanIds = readDeletedPracticePlanIds(localUserId, activeCourse.id);
      const visibleRemotePlans = visiblePracticePlans(remotePlans, nextDeletedPlanIds);
      visibleRemotePlans.forEach(savePracticePlan);
      setRecentPlans(
        mergePlans(visiblePracticePlans(localPlans, nextDeletedPlanIds), visibleRemotePlans).slice(
          0,
          4,
        ),
      );
    });
  }, [activeCourse, notebooks, problems, userId]);

  const updateLearningPosition = useCallback(
    (selection: string) => {
      if (!activeCourse || !selection) return null;
      const localUserId = userId || 'anonymous';
      const checkpoint = progressCheckpointForSelection(selection);
      if (!checkpoint) return null;
      const nextState = setLearnerProgressCheckpoint({
        userId: localUserId,
        courseId: activeCourse.id,
        notebooks,
        kind: checkpoint.kind,
        notebookId: checkpoint.notebookId,
      });
      const nextSnapshot = summarizeLearnerCourseState({ state: nextState, notebooks, problems });
      const label = progressLabelForSelection(selection, notebooks);
      setSnapshot(nextSnapshot);
      setProgressSelection(progressSelectionFromSnapshot(nextSnapshot));
      const savePromise = saveRemoteLearnerCourseState(nextState);
      progressSavePromiseRef.current = { courseId: activeCourse.id, promise: savePromise };
      void savePromise.then((saved) => {
        if (saved) {
          announceLearningMemoryUpdated(activeCourse.id, label);
        } else if (activeCourseIdRef.current === activeCourse.id) {
          setError('学习进度已保存在当前浏览器，但同步到账号失败；发送问题前请重试。');
        }
      });
      return { state: nextState, snapshot: nextSnapshot, label };
    },
    [activeCourse, notebooks, problems, userId],
  );

  const confirmPlanningScope = useCallback(
    (selection: string, action: PendingCourseAction | undefined) => {
      if (!activeCourse || !selection || !action) return null;
      const checkpoint = progressCheckpointForSelection(selection);
      if (!checkpoint) return null;
      const localUserId = userId || 'anonymous';
      const seededState = seedLearnerCourseStateFromCourse({
        userId: localUserId,
        course: activeCourse,
        notebooks,
        problems,
      });
      const savedState = setLearnerPlanningScope({
        userId: localUserId,
        courseId: activeCourse.id,
        notebooks,
        kind: checkpoint.kind,
        notebookId: checkpoint.notebookId,
        purpose: action.kind,
        prompt: action.prompt,
      });
      const scopedState = previewLearnerProgressCheckpoint({
        state: savedState,
        notebooks,
        kind: checkpoint.kind,
        notebookId: checkpoint.notebookId,
      });
      const nextSnapshot = summarizeLearnerCourseState({
        state: seededState,
        notebooks,
        problems,
      });
      const scopedSnapshot = summarizeLearnerCourseState({
        state: scopedState,
        notebooks,
        problems,
      });
      const label = progressLabelForSelection(selection, notebooks);
      setSnapshot(nextSnapshot);
      setProgressSelection(progressSelectionFromSnapshot(nextSnapshot));
      void saveRemoteLearnerCourseState(savedState).then((saved) => {
        if (saved) {
          announceLearningMemoryUpdated(activeCourse.id, label, '计划范围已记录');
        } else if (activeCourseIdRef.current === activeCourse.id) {
          setError('计划范围已保存在当前浏览器，但同步到账号失败；请重试。');
        }
      });
      return { state: scopedState, snapshot: scopedSnapshot, label };
    },
    [activeCourse, notebooks, problems, userId],
  );

  const updateMessageProgressProposal = useCallback(
    (messageId: string, selection: string) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId && message.progressProposal
            ? {
                ...message,
                progressProposal: {
                  ...message.progressProposal,
                  selection,
                  label: progressLabelForSelection(selection, notebooks),
                },
              }
            : message,
        ),
      );
    },
    [notebooks, setMessages],
  );

  const dismissMessageProgressProposal = useCallback(
    (messageId: string) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId && message.progressProposal
            ? {
                ...message,
                text: '好的，我先不更新学习进度。你也可以随时点“更新学习进度”手动调整。',
                progressProposal: undefined,
                pendingAction: undefined,
              }
            : message,
        ),
      );
    },
    [setMessages],
  );

  const deleteLearnMessage = useCallback(
    (messageId: string) => {
      if (activeCourseId) {
        rememberDeletedLearnMessageId(localUserId, activeCourseId, activeSessionId, messageId);
        void clearLearnChatMessageAttachments({
          ownerId: localUserId,
          courseId: activeCourseId,
          sessionId: activeSessionId,
          messageId,
        }).catch(() => undefined);
      }
      setMessages((current) => current.filter((message) => message.id !== messageId));
    },
    [activeCourseId, activeSessionId, localUserId, setMessages],
  );

  const copyLearnMessage = useCallback(async (message: LearnMessage) => {
    const text = copyableLearnMessageText(message);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard can be unavailable in some browser permission states.
    }
  }, []);

  const handleModelChange = useCallback(
    (value: string) => {
      const parsed = parseModelOptionValue(value);
      if (!parsed) return;
      setModel(parsed.providerId, parsed.modelId);
    },
    [setModel],
  );

  const handleChatAttachmentFiles = useCallback(
    async (fileList: FileList | File[] | null) => {
      const files = Array.from(fileList || []);
      if (!files.length) return;
      const remainingSlots = Math.max(0, MAX_LEARN_CHAT_ATTACHMENTS - attachments.length);
      if (remainingSlots <= 0) {
        setError(`一次最多添加 ${MAX_LEARN_CHAT_ATTACHMENTS} 个聊天附件。`);
        return;
      }
      const prepared: LearnImageAttachment[] = [];
      let firstError: string | null = null;
      for (const file of files.slice(0, remainingSlots)) {
        try {
          prepared.push(await prepareLearnChatAttachment(file));
        } catch (error) {
          firstError ||= error instanceof Error ? error.message : `${file.name} 添加失败`;
        }
      }
      if (prepared.length) {
        updateComposerAttachments((current) =>
          [...current, ...prepared].slice(0, MAX_LEARN_CHAT_ATTACHMENTS),
        );
      }
      if (!firstError && files.length > remainingSlots) {
        firstError = `一次最多添加 ${MAX_LEARN_CHAT_ATTACHMENTS} 个聊天附件，已保留前 ${remainingSlots} 个。`;
      }
      setError(firstError);
    },
    [attachments.length, updateComposerAttachments],
  );

  const handleLearnUploadFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!canManageCourseContent) return;
      const files = Array.from(fileList || []);
      if (!files.length) return;

      const sourceFiles = files.filter(isLearnSourceDocumentFile);
      const unsupportedFiles = files.filter((file) => !isLearnSourceDocumentFile(file));

      if (unsupportedFiles.length) {
        setError(
          `暂不支持 ${unsupportedFiles[0].name}，课程资料支持 PDF、PPTX、DOCX、Markdown 或文本文件。`,
        );
      }
      if (!sourceFiles.length) return;
      if (!activeCourse) {
        setError('请先选择课程，再上传原始讲义。');
        return;
      }
      const uploadStoreKey = activeMessageStoreKeyRef.current;
      if (sourceUploadingCourseId) {
        if (sourceUploadingCourseId === activeCourse.id) openSourceUploadPanel();
        else setError('另一门课程的原始讲义仍在入库，请等待完成后再上传。');
        return;
      }
      const courseHasUnconfirmedUpload =
        activeSourceUploadItems.some((item) => sourceUploadStatusIsProcessing(item.status)) ||
        activeCourseSourceUploads.some((upload) => {
          const status = persistedSourceUploadTileState(upload).status;
          return status === 'ingesting' || status === 'ingesting_slow';
        });
      if (courseHasUnconfirmedUpload) {
        openSourceUploadPanel();
        setError('这门课仍有原始讲义在服务端处理中，请等待状态确认后再上传，避免重复任务。');
        return;
      }

      const queuedSourceFiles = sourceFiles.slice(0, 3);
      if (sourceFiles.length > queuedSourceFiles.length) {
        setError('一次最多入库 3 个原始讲义文件，已处理前 3 个。');
      }

      openSourceUploadPanel();
      const uploadCourseId = activeCourse.id;
      setSourceUploadingCourseId(uploadCourseId);
      if (sourceFiles.length <= queuedSourceFiles.length) setError(null);
      let didIngestAnyFile = false;
      try {
        for (const file of queuedSourceFiles) {
          const sourceKind = learnSourceKindForFile(file);
          const itemId = makeClientId('source-upload');
          const now = Date.now();
          setSourceUploadItems((current) => [
            {
              id: itemId,
              courseId: uploadCourseId,
              fileName: file.name,
              sourceKind,
              status: 'ingesting',
              createdAt: now,
              updatedAt: now,
            },
            ...current,
          ]);
          const activityId = addMemoryActivity({
            courseId: uploadCourseId,
            title: '原始讲义入库中',
            description: `正在入库：${file.name}`,
            status: 'indexing_source',
            layer: 'knowledge_index',
            chips: [activeCourse.courseCode || '课程', '原始讲义'],
          });
          updateSourceUploadItem(itemId, { activityId });

          const maxSize =
            sourceKind === 'plain_text' ||
            sourceKind === 'markdown' ||
            sourceKind === 'problem_bank'
              ? MAX_LEARN_SOURCE_TEXT_FILE_BYTES
              : MAX_LEARN_SOURCE_DOCUMENT_BYTES;

          try {
            if (file.size > maxSize) {
              throw new Error(
                `${file.name} 太大，请上传 ${compactBytes(maxSize)} 以内的原始讲义。`,
              );
            }

            const formData = new FormData();
            formData.append('file', file);
            formData.append('sourceTitle', file.name);
            formData.append('sourceKind', sourceKind);
            formData.append('language', activeCourse.language === 'en-US' ? 'en-US' : 'zh-CN');
            formData.append('pdfProviderId', pdfProviderId);
            if (pdfProviderConfig?.apiKey) formData.append('pdfApiKey', pdfProviderConfig.apiKey);
            if (pdfProviderConfig?.baseUrl) {
              formData.append('pdfBaseUrl', pdfProviderConfig.baseUrl);
            }
            const response = await backendJson<CourseSourceIngestResponse>(
              `/api/courses/${encodeURIComponent(activeCourse.id)}/source-ingest`,
              {
                method: 'POST',
                headers: {
                  ...(providerId === 'openai' && modelId ? { 'x-model': `openai:${modelId}` } : {}),
                },
                body: formData,
                timeoutMs: COURSE_SOURCE_UPLOAD_TIMEOUT_MS,
              },
            );
            const summary = formatSourceUploadStatusSummary(response.ingest);
            updateSourceUploadItem(itemId, {
              status: 'stored',
              summary,
              error: undefined,
            });
            updateMemoryActivity(activityId, {
              title: '原始讲义已入库',
              description: summary,
              status: 'completed',
              layer: 'knowledge_index',
              chips: [activeCourse.courseCode || '课程', '原始讲义'],
            });
            notifySourceUploadLive2D(file.name, response.ingest);
            if (!sourceUploadPanelOpenRef.current) {
              setCompletedSourceUploadBadge((current) => ({
                courseId: uploadCourseId,
                count: current.courseId === uploadCourseId ? Math.min(99, current.count + 1) : 1,
              }));
            }
            didIngestAnyFile = true;
          } catch (err) {
            const message = err instanceof Error ? err.message : '原始讲义上传失败';
            if (err instanceof BackendApiError && err.kind === 'timeout') {
              updateSourceUploadItem(itemId, {
                status: 'ingesting_slow',
                summary: '上传响应较慢，服务端可能仍在处理；正在继续查询真实状态。',
                error: undefined,
              });
              updateMemoryActivity(activityId, {
                title: '原始讲义仍在处理中',
                description: `${file.name} 的上传请求已等待 12 分钟，正在继续查询服务端状态。`,
                status: 'indexing_source',
                layer: 'knowledge_index',
                chips: [activeCourse.courseCode || '课程', '原始讲义'],
              });
              setResourceLoadAttempts((current) => ({
                notebooks: current.notebooks + 1,
                problems: current.problems + 1,
                sources: current.sources + 1,
              }));
              markCourseContentMutation(uploadCourseId);
              toast.info('上传响应较慢，已继续查询服务端状态；请勿重复上传。');
              break;
            }
            updateSourceUploadItem(itemId, {
              status: 'failed',
              error: message,
            });
            updateMemoryActivity(activityId, {
              title: '原始讲义入库失败',
              description: file.name,
              status: 'failed',
              layer: 'knowledge_index',
              chips: [activeCourse.courseCode || '课程', '原始讲义'],
              error: message,
            });
            notifySourceUploadFailureLive2D(file.name, message);
            setError(message);
            if (uploadStoreKey && activeMessageStoreKeyRef.current === uploadStoreKey) {
              setMessages((current) => [
                ...current,
                {
                  id: makeClientId('assistant-source-upload-error'),
                  role: 'assistant',
                  text: `${message}。`,
                  createdAt: Date.now(),
                },
              ]);
            }
          }
        }

        if (didIngestAnyFile && activeMessageStoreKeyRef.current === uploadStoreKey) {
          setResourceLoadAttempts((current) => ({
            notebooks: current.notebooks + 1,
            problems: current.problems + 1,
            sources: current.sources + 1,
          }));
          markCourseContentMutation(uploadCourseId);
        }
      } finally {
        setSourceUploadingCourseId((current) => (current === uploadCourseId ? null : current));
      }
    },
    [
      activeCourse,
      activeCourseSourceUploads,
      activeSourceUploadItems,
      canManageCourseContent,
      markCourseContentMutation,
      modelId,
      openSourceUploadPanel,
      pdfProviderConfig,
      pdfProviderId,
      providerId,
      setMessages,
      sourceUploadingCourseId,
      updateSourceUploadItem,
    ],
  );

  const commitSyllabusEvents = useCallback(
    async (
      incomingEvents: SyllabusCalendarEvent[],
      message: string,
      activityLabel: string,
      mode: SyllabusCommitMode,
    ) => {
      if (!activeCourseId || !incomingEvents.length) return;
      setSyllabusImportLoading(true);
      setSyllabusImportMessage(null);
      try {
        let currentEvents = syllabusEvents;
        if (mode === 'replace') {
          currentEvents = await reloadCalendarEvents();
          for (const event of currentEvents) {
            await deleteCalendarEvent(event, {
              idempotencyKey: makeLearningCalendarIdempotencyKey(
                'course-calendar-replace-delete',
                `${activeCourseId}-${event.id}-${event.version}`,
              ),
            });
          }
        }

        const existingKeys = new Set(
          currentEvents.map(
            (event) =>
              `${event.date}:${event.kind}:${event.title.trim().toLocaleLowerCase('zh-CN')}`,
          ),
        );
        const eventsToCreate = incomingEvents
          .filter(
            (event) =>
              mode === 'replace' ||
              !existingKeys.has(
                `${event.date}:${event.kind}:${event.title.trim().toLocaleLowerCase('zh-CN')}`,
              ),
          )
          .map((event) => ({
            ...event,
            courseId: activeCourseId,
            origin: event.origin || ('syllabus' as const),
            sourceRef:
              event.sourceRef ||
              ({
                type: 'syllabus' as const,
                id: event.sourceName || 'course-syllabus',
              } satisfies NonNullable<SyllabusCalendarEvent['sourceRef']>),
          }));
        if (eventsToCreate.length) {
          await createCalendarEvents(eventsToCreate, {
            idempotencyKey: makeLearningCalendarIdempotencyKey(
              'course-calendar-syllabus',
              `${activeCourseId}-${eventsToCreate.map((event) => event.id).join('-')}`,
            ),
          });
        }

        setSyllabusImportMessage(
          eventsToCreate.length ? message : '这些事项已经存在于课程日历中，没有重复写入。',
        );
        setSyllabusDialogOpen(false);
        setSyllabusDraftEvents([]);
        setSyllabusDraftSourceName('');
        setRightRailView('calendar');

        const today = localDayKey(new Date());
        const focusEvent =
          incomingEvents
            .slice()
            .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
            .find((event) => event.date >= today) || incomingEvents[0];
        setCalendarReferenceDate(new Date(`${focusEvent.date}T12:00:00`));
        announceSyllabusScheduleUpdated(activeCourseId, activityLabel);
      } catch (commitError) {
        setSyllabusImportMessage(
          commitError instanceof Error
            ? `课程日历保存失败：${commitError.message}`
            : '课程日历保存失败，请稍后重试。',
        );
        void reloadCalendarEvents().catch(() => undefined);
      } finally {
        setSyllabusImportLoading(false);
      }
    },
    [
      activeCourseId,
      createCalendarEvents,
      deleteCalendarEvent,
      reloadCalendarEvents,
      syllabusEvents,
    ],
  );

  const openManualScheduleDialog = useCallback(() => {
    setManualScheduleTitle('');
    setManualScheduleDate(localDayKey(new Date()));
    setManualScheduleKind('assignment');
    setManualScheduleError(null);
    setManualScheduleDialogOpen(true);
  }, []);

  const clearLearningCalendar = useCallback(async () => {
    if (!activeCourseId) return;
    if (!syllabusEvents.length) {
      toast.success('日历里暂时没有可清空的日程。');
      return;
    }
    const confirmed = window.confirm(
      `确定清空当前课程日历中的 ${syllabusEvents.length} 项日程吗？此操作无法撤销。`,
    );
    if (!confirmed) return;
    setSyllabusImportMessage('正在清空课程日历…');
    try {
      for (const event of syllabusEvents) {
        await deleteCalendarEvent(event, {
          idempotencyKey: makeLearningCalendarIdempotencyKey(
            'course-calendar-clear',
            `${activeCourseId}-${event.id}-${event.version}`,
          ),
        });
      }
      setSyllabusImportMessage('已清空当前加载范围内的课程日历。');
      toast.success('已清空课程日历');
    } catch (clearError) {
      setSyllabusImportMessage(
        clearError instanceof Error
          ? `日历仅完成了部分清理：${clearError.message}`
          : '清空日历失败，请重试。',
      );
      void reloadCalendarEvents().catch(() => undefined);
      toast.error('清空日历没有完整完成，请重试。');
    }
  }, [activeCourseId, deleteCalendarEvent, reloadCalendarEvents, syllabusEvents]);

  const openSyllabusUploadDialog = useCallback(() => {
    if (!canManageCourseContent) return;
    setSyllabusImportMode('file');
    setSyllabusImportMessage(null);
    setSyllabusDialogOpen(true);
  }, [canManageCourseContent]);

  const confirmManualScheduleEvent = useCallback(async () => {
    if (!activeCourseId) return;
    const title = manualScheduleTitle.trim();
    if (!title) {
      setManualScheduleError('请填写日程标题。');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(manualScheduleDate)) {
      setManualScheduleError('请选择有效日期。');
      return;
    }

    const event: SyllabusCalendarEvent = {
      id: makeClientId('syllabus-event'),
      courseId: activeCourseId,
      title,
      kind: manualScheduleKind,
      date: manualScheduleDate,
      sourceName: '手动添加',
      origin: 'manual',
      sourceRef: { type: 'manual', id: activeCourseId },
      status: 'planned',
      createdAt: Date.now(),
    };
    setManualScheduleError(null);
    try {
      await createCalendarEvents([event], {
        idempotencyKey: makeLearningCalendarIdempotencyKey(
          'course-calendar-manual',
          `${activeCourseId}-${event.id}`,
        ),
      });
      setSyllabusImportMessage(`已添加日程「${title}」。`);
      setCalendarReferenceDate(new Date(`${manualScheduleDate}T12:00:00`));
      setRightRailView('calendar');
      setManualScheduleDialogOpen(false);
      setManualScheduleTitle('');
      setManualScheduleDate(localDayKey(new Date()));
      setManualScheduleKind('assignment');
      setManualScheduleError(null);
      announceSyllabusScheduleUpdated(activeCourseId, `${title}，${manualScheduleDate}`);
    } catch (createError) {
      setManualScheduleError(
        createError instanceof Error ? createError.message : '日程保存失败，请稍后重试。',
      );
    }
  }, [
    activeCourseId,
    createCalendarEvents,
    manualScheduleDate,
    manualScheduleKind,
    manualScheduleTitle,
  ]);

  const openPracticePlan = useCallback(
    (plan: PracticePlan) => {
      if (plan.problemIds.length === 0) {
        toast.error('这组练习还没有题目。');
        return;
      }
      const session = ensurePracticeSession({ plan, userId: localUserId });
      syncPracticeSessionState(session);
      // Use the dedicated practice page (full problem solver), not the learn sidebar popup.
      router.push(`/practice/${encodeURIComponent(plan.id)}`);
    },
    [localUserId, router, syncPracticeSessionState],
  );

  const openPracticeSession = useCallback(
    (sessionId: string) => {
      const session = loadPracticeSession(sessionId);
      if (!session) {
        toast.error('没有找到这组练习进度。');
        refreshPracticeSessions();
        return;
      }
      syncPracticeSessionState(session);
      router.push(`/practice/${encodeURIComponent(session.planId)}`);
    },
    [refreshPracticeSessions, router, syncPracticeSessionState],
  );

  const handlePracticePopupOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      if (practicePopupSessionId) {
        syncPracticeSessionState(pausePracticeSession(practicePopupSessionId));
      }
      setPracticeHeaderState(null);
      setPracticeProblemHelp(null);
      setPracticeProblemHelpTabProblemId(null);
      setPracticeProblemHelpTabActive(false);
      setPracticePopupSessionId(null);
      refreshPracticeSessions();
    },
    [practicePopupSessionId, refreshPracticeSessions, syncPracticeSessionState],
  );

  const handlePracticeHeaderStateChange = useCallback(
    (state: CourseProblemPracticeHeaderState | null) => {
      setPracticeHeaderState(state);
    },
    [],
  );

  const handlePracticeProblemChange = useCallback(
    (problemId: string) => {
      if (!practicePopupSessionId) return;
      setPracticeProblemHelpTabProblemId(null);
      setPracticeProblemHelpTabActive(false);
      syncPracticeSessionState(
        updatePracticeSessionCurrentProblem(practicePopupSessionId, problemId),
      );
    },
    [practicePopupSessionId, syncPracticeSessionState],
  );

  const handlePracticeAnswerDraftChange = useCallback(
    (problemId: string, answer: NotebookProblemAttemptAnswer | null) => {
      if (!practicePopupSessionId) return;
      syncPracticeSessionState(
        updatePracticeSessionAnswerDraft(practicePopupSessionId, problemId, answer),
      );
    },
    [practicePopupSessionId, syncPracticeSessionState],
  );

  const handlePracticeProblemHelpRequest = useCallback(
    async (options?: { forceRegenerate?: boolean }) => {
      if (!activeCourse || !activePracticeSession?.id || !practiceHeaderState) return;
      const forceRegenerate = options?.forceRegenerate ?? false;
      const problemTitle =
        practiceHeaderState.problemTitle || practiceHeaderState.problem.title || '这道题';
      const userText = `我不会这道题，请讲解：${problemTitle}`;
      const existingHelp =
        practiceProblemHelp?.problemId === practiceHeaderState.problemId
          ? practiceProblemHelp
          : null;
      if (existingHelp?.status === 'loading') {
        return;
      }
      if (!forceRegenerate && existingHelp?.status === 'ready') {
        return;
      }
      if (!forceRegenerate && existingHelp?.status === 'error') {
        return;
      }

      const restoreSavedHelp = (sessionId: string): PracticeProblemHelpState | null => {
        const trimmedSessionId = sessionId.trim();
        if (!trimmedSessionId) return null;
        const savedMessages = readLearnSessionMessages(
          localUserId,
          activeCourse.id,
          trimmedSessionId,
        );
        const assistantText =
          savedMessages
            .slice()
            .reverse()
            .find(
              (message) =>
                message.role === 'assistant' &&
                message.text.trim() &&
                message.text.trim() !== '正在生成这道题的讲解…',
            )
            ?.text.trim() || '';
        if (!assistantText) return null;
        const isError =
          assistantText.includes('题解生成超时') ||
          assistantText.includes('题解生成失败') ||
          assistantText.includes('请稍后重试或换一个模型');
        return {
          problemId: practiceHeaderState.problemId,
          sessionId: trimmedSessionId,
          title: problemTitle,
          answer: assistantText,
          status: isError ? 'error' : 'ready',
          error: isError ? assistantText : undefined,
        };
      };

      const persistedHelpSessionId =
        activePracticeSession.problemStates[
          practiceHeaderState.problemId
        ]?.aiHelpSessionId?.trim() || '';
      const savedHelp = forceRegenerate
        ? null
        : (persistedHelpSessionId ? restoreSavedHelp(persistedHelpSessionId) : null) ||
          learnSessions.reduce<PracticeProblemHelpState | null>((match, session) => {
            if (match) return match;
            const savedMessages = readLearnSessionMessages(
              localUserId,
              activeCourse.id,
              session.id,
            );
            const hasMatchingQuestion = savedMessages.some(
              (message) => message.role === 'user' && message.text.trim() === userText,
            );
            return hasMatchingQuestion ? restoreSavedHelp(session.id) : null;
          }, null);
      if (savedHelp) {
        setPracticeProblemHelp(savedHelp);
        setLeftRailCollapsed(false);
        if (!persistedHelpSessionId) {
          syncPracticeSessionState(
            recordPracticeSessionProblemAiHelp({
              sessionId: activePracticeSession.id,
              problemId: practiceHeaderState.problemId,
              helpSessionId: savedHelp.sessionId,
              timestamp: Date.now(),
            }),
          );
        }
        return;
      }

      if (!practiceHeaderState.problemContent) {
        toast.error('题目内容还没加载完成，请稍后再试。');
        return;
      }

      const now = Date.now();
      const helpSessionId = makeLearnSessionId();
      const helpTitle = `题解：${problemTitle}`.slice(0, 48);
      const userMessage: LearnMessage = {
        id: makeClientId('user-problem-help'),
        role: 'user',
        text: userText,
        createdAt: now,
      };
      const loadingMessage: LearnMessage = {
        id: makeClientId('assistant-problem-help-loading'),
        role: 'assistant',
        text: '正在生成这道题的讲解…',
        createdAt: now + 1,
      };
      const initialMessages = [userMessage, loadingMessage];
      const nextSession: LearnChatSession = {
        id: helpSessionId,
        title: helpTitle,
        createdAt: now,
        updatedAt: now,
        messageCount: initialMessages.filter(learnMessageHasContent).length,
        currentRevision: 0,
      };

      writeLearnSessionMessages(localUserId, activeCourse.id, helpSessionId, initialMessages);
      writeLearnSessionTabMessages(localUserId, activeCourse.id, helpSessionId, initialMessages);
      setLearnSessions((current) => {
        const next = sortLearnSessionsForList(localUserId, activeCourse.id, [
          nextSession,
          ...current,
        ]);
        writeLearnSessions(localUserId, activeCourse.id, next);
        return next;
      });
      setLeftRailCollapsed(false);
      setPracticeProblemHelp({
        problemId: practiceHeaderState.problemId,
        sessionId: helpSessionId,
        title: problemTitle,
        answer: '',
        status: 'loading',
      });

      syncPracticeSessionState(
        recordPracticeSessionProblemAiHelp({
          sessionId: activePracticeSession.id,
          problemId: practiceHeaderState.problemId,
          helpSessionId,
          timestamp: now,
        }),
      );

      const questionState = recordLearnerQuestion({
        userId: userId || 'anonymous',
        courseId: activeCourse.id,
        text: userText,
      });
      const questionSnapshot = summarizeLearnerCourseState({
        state: questionState,
        notebooks,
        problems,
      });
      setSnapshot(questionSnapshot);
      setProgressSelection(progressSelectionFromSnapshot(questionSnapshot));
      void saveRemoteLearnerCourseState(questionState);

      const controller = new AbortController();
      const timeoutId = window.setTimeout(
        () => controller.abort(),
        PRACTICE_PROBLEM_HELP_TIMEOUT_MS,
      );
      try {
        const prompt = [
          buildProblemExplainPrompt({
            problem: practiceHeaderState.problem,
            problemTitle,
            problemContent: practiceHeaderState.problemContent,
            notebookName:
              practiceHeaderState.notebookLabel ||
              practiceHeaderState.problem.notebookName ||
              activeCourse.name,
            currentAnswer: practiceHeaderState.currentAnswer,
            latestAttempt: practiceHeaderState.latestAttempt,
          }),
          '',
          '课程级补充要求：这次回答会展示在做题弹窗里。请直接给题解，不要生成练习计划或跳转建议；最后给一个很短的“我接下来该怎么做”。',
        ].join('\n');
        const result = await askCourseOrchestrator({
          courseId: activeCourse.id,
          courseName: activeCourse.name,
          question: prompt,
          orchestratorAvatarUrl: activeCourse.avatarUrl,
          signal: controller.signal,
          learnerContext: buildLearnerChatContext({
            snapshot: questionSnapshot,
            state: questionState,
            notebooks,
            plans: recentPlans,
            syllabusEvents,
          }),
          userProfile: { nickname: userName },
        });
        const answer = normalizeCourseAssistantAnswer(
          latestAssistantText(result.messages) ||
            result.answer ||
            '这道题暂时没有生成讲解，请稍后再试。',
        );
        const lecturePrompt = buildMiniLecturePrompt({
          question: userText,
          answer,
          course: activeCourse,
        });
        const finalMessages: LearnMessage[] = [
          userMessage,
          {
            id: makeClientId('assistant-problem-help'),
            role: 'assistant',
            text: answer,
            createdAt: Date.now(),
            lecturePrompt,
          },
        ];
        writeLearnSessionMessages(localUserId, activeCourse.id, helpSessionId, finalMessages);
        writeLearnSessionTabMessages(localUserId, activeCourse.id, helpSessionId, finalMessages);
        setPracticeProblemHelp((current) =>
          current?.sessionId === helpSessionId
            ? { ...current, answer, status: 'ready', error: undefined }
            : current,
        );
        const updatedSession: LearnChatSession = {
          ...nextSession,
          title: learnSessionTitleFromMessages(finalMessages, helpTitle),
          updatedAt: Date.now(),
        };
        setLearnSessions((current) => {
          const next = sortLearnSessionsForList(localUserId, activeCourse.id, [
            updatedSession,
            ...current.filter((session) => session.id !== helpSessionId),
          ]);
          writeLearnSessions(localUserId, activeCourse.id, next);
          return next;
        });
        void syncRemoteLearnConversation({
          courseId: activeCourse.id,
          sessionId: helpSessionId,
          title: updatedSession.title,
          messages: finalMessages.map(learnMessageToRemotePayload),
          ownerScope: localUserId,
        });
        refreshLearnerSnapshot();
      } catch (error) {
        const message = controller.signal.aborted
          ? '题解生成超时'
          : error instanceof Error
            ? error.message
            : '题解生成失败';
        const errorText = `${message}。请稍后重试或换一个模型。`;
        const finalMessages: LearnMessage[] = [
          userMessage,
          {
            id: makeClientId('assistant-problem-help-error'),
            role: 'assistant',
            text: errorText,
            createdAt: Date.now(),
          },
        ];
        writeLearnSessionMessages(localUserId, activeCourse.id, helpSessionId, finalMessages);
        writeLearnSessionTabMessages(localUserId, activeCourse.id, helpSessionId, finalMessages);
        setPracticeProblemHelp((current) =>
          current?.sessionId === helpSessionId
            ? { ...current, answer: errorText, status: 'error', error: message }
            : current,
        );
        void syncRemoteLearnConversation({
          courseId: activeCourse.id,
          sessionId: helpSessionId,
          title: helpTitle,
          messages: finalMessages.map(learnMessageToRemotePayload),
          ownerScope: localUserId,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
    },
    [
      activeCourse,
      activePracticeSession,
      learnSessions,
      localUserId,
      notebooks,
      practiceHeaderState,
      practiceProblemHelp,
      problems,
      recentPlans,
      refreshLearnerSnapshot,
      syncPracticeSessionState,
      syllabusEvents,
      userId,
      userName,
    ],
  );

  const handlePracticeAiHelpHeaderClick = useCallback(() => {
    if (!practiceHeaderState?.problemId) return;
    setPracticeProblemHelpTabProblemId(practiceHeaderState.problemId);
    setPracticeProblemHelpTabActive(true);
    void handlePracticeProblemHelpRequest({
      forceRegenerate: currentPracticeProblemHelpTabVisible && !currentPracticeProblemHelpLoading,
    });
  }, [
    currentPracticeProblemHelpLoading,
    currentPracticeProblemHelpTabVisible,
    handlePracticeProblemHelpRequest,
    practiceHeaderState?.problemId,
  ]);

  const handlePracticeAttemptResolved = useCallback(
    (event: CourseProblemPracticeAttemptResolvedEvent) => {
      if (!activePracticeSession) return;
      const status = practiceStatusFromAttempt(event.status);
      const title = event.problemTitle || event.problemId;
      const concepts = event.concepts.length > 0 ? event.concepts : [title];
      syncPracticeSessionState(
        recordPracticeSessionAttempt({
          sessionId: activePracticeSession.id,
          problemId: event.problemId,
          status: event.status,
          score: event.score,
          feedback: event.feedback,
        }),
      );
      const nextState = recordPracticeAttemptResult({
        userId: localUserId,
        courseId: activePracticeSession.courseId,
        result: {
          problemId: event.problemId,
          problemTitle: title,
          concepts,
          status,
          score: normalizedPracticeAttemptScore(event.score, status),
        },
      });
      void saveRemoteLearnerCourseState(nextState);
      refreshLearnerSnapshot();
    },
    [activePracticeSession, localUserId, refreshLearnerSnapshot, syncPracticeSessionState],
  );

  const removeStatusCalendarActivity = useCallback(
    async (activity: StatusCalendarActivity) => {
      if (!activeCourseId) return;

      if (activity.source === 'plan') {
        rememberDeletedPracticePlanId(localUserId, activeCourseId, activity.sourceId);
        deletePracticePlan(activity.sourceId, localUserId);
        setRecentPlans((current) => current.filter((plan) => plan.id !== activity.sourceId));
        return;
      }

      if (activity.source === 'practice_session') {
        const session = activity.session ?? loadPracticeSession(activity.sourceId);
        deletePracticeSession(activity.sourceId, localUserId);
        if (session?.planId) {
          rememberDeletedPracticePlanId(localUserId, activeCourseId, session.planId);
          deletePracticePlan(session.planId, localUserId);
          setRecentPlans((current) => current.filter((plan) => plan.id !== session.planId));
        }
        setPracticeSessions((current) =>
          current.filter((sessionItem) => sessionItem.id !== activity.sourceId),
        );
        if (practicePopupSessionId === activity.sourceId) setPracticePopupSessionId(null);
        return;
      }

      const event = syllabusEvents.find((candidate) => candidate.id === activity.sourceId);
      if (!event) return;
      try {
        await deleteCalendarEvent(event, {
          idempotencyKey: makeLearningCalendarIdempotencyKey(
            'course-calendar-activity-delete',
            `${activeCourseId}-${event.id}-${event.version}`,
          ),
        });
        if (syllabusDraftEvents.some((candidate) => candidate.id === activity.sourceId)) {
          setSyllabusDraftEvents((current) =>
            current.filter((candidate) => candidate.id !== activity.sourceId),
          );
        }
      } catch (deleteError) {
        toast.error(
          deleteError instanceof Error ? deleteError.message : '日历活动删除失败，请稍后重试。',
        );
      }
    },
    [
      activeCourseId,
      deleteCalendarEvent,
      localUserId,
      practicePopupSessionId,
      syllabusDraftEvents,
      syllabusEvents,
    ],
  );

  const startStatusCalendarActivity = useCallback(
    async (activity: StatusCalendarActivity) => {
      if (sending) return;
      const activityStoreKey = activeMessageStoreKeyRef.current;
      if (!activityStoreKey) return;
      if (activity.source === 'plan') {
        const plan = recentPlans.find((item) => item.id === activity.sourceId);
        if (plan) {
          openPracticePlan(plan);
        } else {
          toast.error('没有找到这组练习计划。');
        }
        return;
      }
      if (activity.source === 'practice_session') {
        openPracticeSession(activity.sourceId);
        return;
      }

      const event = syllabusEvents.find((item) => item.id === activity.sourceId);
      if (!event) {
        toast.error('没有找到这个日历活动。');
        return;
      }

      setRightRailCollapsed(false);
      setRightRailView('calendar');
      setCalendarReferenceDate(new Date(`${event.date}T12:00:00`));
      const activeArtifact = activeActivityArtifactFromEvent({
        event,
        course: activeCourse,
      });
      const messageId = makeClientId('assistant-calendar-activity-start');
      if (!activeCourse) {
        setMessages((current) => [
          ...current,
          {
            id: messageId,
            role: 'assistant',
            text: buildCalendarActivityStartText({
              event,
              course: activeCourse,
              isResearchCourse,
            }),
            createdAt: Date.now(),
            artifacts: [activeArtifact],
          },
        ]);
        return;
      }

      setSending(true);
      try {
        const currentState = loadLearnerCourseState({
          userId: localUserId,
          courseId: activeCourse.id,
        });
        const currentSnapshot = summarizeLearnerCourseState({
          state: currentState,
          notebooks,
          problems,
        });
        const activityQuestion = [
          `开始日历活动：${event.title}`,
          `日期：${event.date}`,
          `类型：${scheduleEventLabel(event.kind, isResearchCourse)}`,
          event.durationMinutes ? `预计时长：${event.durationMinutes} 分钟` : '',
          event.rawText ? `来源内容：${event.rawText}` : '',
          '请直接带我执行这个活动；如果需要题库、日历或记忆操作，请返回结构化 action/artifact。',
        ]
          .filter(Boolean)
          .join('\n');
        const activityContentState = courseContentStateRef.current.get(activeCourse.id);
        const learnTurn = await planLearnTurn({
          question: activityQuestion,
          messages,
          course: activeCourse,
          snapshot: currentSnapshot,
          calendarEvents: syllabusEvents,
          recentActivities: statusCalendarActivities,
          recentPlans,
          problems,
          problemBankActiveCountHint:
            problemsLoadState.status === 'idle' ? activityContentState?.problems.count : undefined,
          sourceUploads: activeCourseSourceUploads,
          resourceStates: {
            notebooks: planningResourceStatusFromContentOrList({
              listState: notebooksLoadState,
              contentCount: activityContentState ? activityContentState.notebooks.count : null,
            }),
            problems: planningResourceStatusFromContentOrList({
              listState: problemsLoadState,
              contentCount: activityContentState ? activityContentState.problems.count : null,
            }),
            sources: sourcesLoadState.status,
          },
          providerId,
          modelId,
        });
        if (activeMessageStoreKeyRef.current !== activityStoreKey) return;
        const artifacts = [
          activeArtifact,
          ...(learnTurn?.artifacts || [])
            .map(normalizeLearnArtifact)
            .filter((artifact): artifact is LearnArtifact => Boolean(artifact)),
        ];
        const learningActions = [
          ...(learnTurn?.proposals || []),
          ...(learnTurn?.directCalls || []),
        ].map((learnAction) =>
          learnActionToClientAction({
            action: learnAction,
            id: makeClientId('learn-action'),
            defaultConfirmation: learnActionRequiresConfirmation(learnAction.kind)
              ? 'required'
              : 'none',
          }),
        );
        const text = learnTurn?.replyText?.trim() || '';
        if (!text && artifacts.length <= 1 && !learningActions.length) {
          throw new Error('AI 没有返回可展示的活动执行内容。');
        }
        setMessages((current) => [
          ...current,
          {
            id: messageId,
            role: 'assistant',
            text,
            createdAt: Date.now(),
            learningActions: learningActions.length ? learningActions : undefined,
            artifacts,
            publicTrace: publicTraceFromLearnTurn(learnTurn, {
              question: activityQuestion,
              progressKnown: currentSnapshot.progressKnown,
              calendarCount: syllabusEvents.length,
              problemCount: problems.length,
            }),
          },
        ]);
        refreshLearnerSnapshot();
      } catch (error) {
        if (activeMessageStoreKeyRef.current !== activityStoreKey) return;
        const message = error instanceof Error ? error.message : '活动执行失败';
        setMessages((current) => [
          ...current,
          {
            id: messageId,
            role: 'assistant',
            text: `${message}。我没有使用本地活动兜底，请稍后重试或换一个模型。`,
            createdAt: Date.now(),
            artifacts: [activeArtifact],
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [
      activeCourse,
      activeCourseSourceUploads,
      isResearchCourse,
      localUserId,
      messages,
      modelId,
      notebooks,
      notebooksLoadState,
      openPracticePlan,
      openPracticeSession,
      problems,
      problemsLoadState,
      providerId,
      recentPlans,
      refreshLearnerSnapshot,
      setMessages,
      sending,
      statusCalendarActivities,
      sourcesLoadState.status,
      syllabusEvents,
    ],
  );

  const handleSyllabusFile = useCallback(
    async (fileList: FileList | null) => {
      if (!canManageCourseContent) return;
      if (!activeCourseId) return;
      const file = fileList?.[0];
      if (!file) return;
      const isPdfFile = isSyllabusPdfFile(file);
      const isImageFile = isSyllabusImageFile(file);
      const isAiFile = isPdfFile || isImageFile;
      const maxSize = isPdfFile
        ? MAX_SYLLABUS_DOCUMENT_FILE_BYTES
        : isImageFile
          ? MAX_SYLLABUS_IMAGE_FILE_BYTES
          : MAX_SYLLABUS_TEXT_FILE_BYTES;
      if (file.size > maxSize) {
        setSyllabusDraftEvents([]);
        setSyllabusImportMessage(
          isPdfFile
            ? 'PDF 文件太大，请上传 20MB 以内的 syllabus。'
            : isImageFile
              ? '图片文件太大，请上传 12MB 以内的 syllabus 图片。'
              : 'Syllabus 文件太大，请先导出为较短的文本或 Markdown。',
        );
        return;
      }
      try {
        setSyllabusImportLoading(true);
        setSyllabusDraftEvents([]);
        setSyllabusDraftSourceName(file.name);
        setSyllabusImportMessage(
          isAiFile ? `正在用 AI 读取 syllabus ${isPdfFile ? 'PDF' : '图片'}...` : null,
        );
        let parsedEvents: SyllabusCalendarEvent[];
        let parseWarnings: string[] = [];
        if (isAiFile) {
          try {
            const parsed = await parseSyllabusFileWithOpenAI(file, {
              courseName: activeCourse?.name,
              courseDescription: activeCourse?.description,
            });
            parseWarnings = parsed.warnings;
            parsedEvents = parsed.events.map((event) => ({
              id: makeClientId('syllabus-event'),
              title: event.title,
              kind: event.kind,
              date: event.date,
              sourceName: file.name,
              createdAt: Date.now(),
              week: event.week,
              sourceColumn: event.sourceColumn,
              rawText: event.rawText,
              confidence: event.confidence,
            }));
          } catch (error) {
            const message = error instanceof Error ? error.message : '未知错误';
            throw new Error(`AI 读取 syllabus ${isPdfFile ? 'PDF' : '图片'}失败：${message}`);
          }
        } else {
          const text = await readSyllabusFileText(file, {
            pdfProviderId,
            pdfProviderConfig,
          });
          parsedEvents = parseSyllabusEventsFromText(text, file.name);
        }
        if (!parsedEvents.length) {
          setSyllabusImportMessage('没有识别到带日期的作业、考试或课程进度。');
          return;
        }
        const warningText = parseWarnings.length ? ` ${parseWarnings[0]}` : '';
        setSyllabusDraftEvents(parsedEvents);
        setSyllabusImportMessage(
          `识别出 ${parsedEvents.length} 个 syllabus 事项。请检查后确认添加。${warningText}`,
        );
      } catch (err) {
        setSyllabusDraftEvents([]);
        setSyllabusImportMessage(err instanceof Error ? err.message : 'Syllabus 导入失败');
      } finally {
        setSyllabusImportLoading(false);
      }
    },
    [
      activeCourse?.description,
      activeCourse?.name,
      activeCourseId,
      canManageCourseContent,
      pdfProviderConfig,
      pdfProviderId,
    ],
  );

  const handleSimulateSyllabus = useCallback(() => {
    if (!activeCourse || !activeCourseId) return;
    const generatedEvents = simulateSyllabusEventsFromPlan({
      course: activeCourse,
      notebooks,
      planText: syllabusPlanDraft,
    });
    setSyllabusDraftSourceName('模拟 syllabus');
    setSyllabusDraftEvents(generatedEvents);
    setSyllabusImportMessage(`已生成 ${generatedEvents.length} 个模拟事项。请检查后确认添加。`);
  }, [activeCourse, activeCourseId, notebooks, syllabusPlanDraft]);

  const updateSyllabusDraftEvent = useCallback(
    (eventId: string, patch: Partial<SyllabusCalendarEvent>) => {
      setSyllabusDraftEvents((current) =>
        current.map((event) => (event.id === eventId ? { ...event, ...patch } : event)),
      );
    },
    [],
  );

  const removeSyllabusDraftEvent = useCallback((eventId: string) => {
    setSyllabusDraftEvents((current) => current.filter((event) => event.id !== eventId));
  }, []);

  const addSyllabusDraftEvent = useCallback(() => {
    setSyllabusDraftEvents((current) => [
      ...current,
      {
        id: makeClientId('syllabus-draft'),
        title: '',
        kind: 'other',
        date: localDayKey(new Date()),
        sourceName: syllabusDraftSourceName || '手动添加',
        createdAt: Date.now(),
      },
    ]);
  }, [syllabusDraftSourceName]);

  const confirmSyllabusDraftEvents = useCallback(async () => {
    if (!validSyllabusDraftEvents.length) {
      setSyllabusImportMessage('请至少保留一个标题和日期都有效的事项。');
      return;
    }
    const sourceLabel = syllabusDraftSourceName || 'syllabus';
    const modeLabel = syllabusCommitMode === 'replace' ? '已更新' : '已添加';
    await commitSyllabusEvents(
      validSyllabusDraftEvents.map((event) => ({
        ...event,
        sourceName: event.sourceName || sourceLabel,
        createdAt: event.createdAt || Date.now(),
      })),
      `${modeLabel} ${validSyllabusDraftEvents.length} 个 syllabus 事项。`,
      `${sourceLabel}，${validSyllabusDraftEvents.length} 个事项`,
      syllabusCommitMode,
    );
    setSyllabusPlanDraft('');
  }, [commitSyllabusEvents, syllabusCommitMode, syllabusDraftSourceName, validSyllabusDraftEvents]);

  const removeAttachment = useCallback(
    (id: string) => {
      updateComposerAttachments((current) => current.filter((attachment) => attachment.id !== id));
    },
    [updateComposerAttachments],
  );

  const selectLearnSession = useCallback(
    (sessionId: string) => {
      if (!activeCourseId || sending) return;
      if (sessionId === activeSessionId) return;
      router.push(learnSessionHref(sessionId));
    },
    [activeCourseId, activeSessionId, learnSessionHref, router, sending],
  );

  const createNewLearnSession = useCallback(() => {
    if (!activeCourseId) return;
    if (learnSessionIsBlank(visibleMessages) && !draft.trim() && attachments.length === 0) return;
    const nextSessionId = makeLearnSessionId();
    registerLocalOnlyLearnSession({
      courseId: activeCourseId,
      sessionId: nextSessionId,
      resetMessages: true,
    });
    clearMessagesFromRead();
    const next = new URLSearchParams(searchParams.toString());
    next.set('courseId', activeCourseId);
    next.set('session', nextSessionId);
    router.push(`/learn?${next.toString()}`);
  }, [
    activeCourseId,
    attachments.length,
    clearMessagesFromRead,
    draft,
    registerLocalOnlyLearnSession,
    router,
    searchParams,
    visibleMessages,
  ]);

  const deleteLearnSession = useCallback(
    async (session: LearnChatSession) => {
      if (!activeCourseId) return;
      const deleteCourseId = activeCourseId;
      const deleteWasActiveSession = session.id === activeSessionId;
      const sessionMessages = deleteWasActiveSession
        ? visibleMessages
        : readLearnSessionMessages(localUserId, deleteCourseId, session.id);
      if (learnSessions.length <= 1 && learnSessionIsBlank(sessionMessages)) return;
      const localOnlyDraft = session.remoteState === 'local-only' && session.currentRevision === 0;

      const previousSessions = readLearnSessions(localUserId, deleteCourseId);
      const optimisticRemaining = previousSessions.filter((item) => item.id !== session.id);
      const pendingDeleteKey = learnSessionScopedKey(localUserId, deleteCourseId, session.id);
      pendingDeletedSessionKeysRef.current.add(pendingDeleteKey);
      writeLearnSessions(localUserId, deleteCourseId, optimisticRemaining);
      setDeletingLearnSessionIds((current) =>
        current.includes(session.id) ? current : [...current, session.id],
      );
      setPendingDeleteLearnSession(null);
      setLearnSessions((current) => current.filter((item) => item.id !== session.id));
      setLearnSessionListState((current) =>
        current.courseId === deleteCourseId
          ? {
              ...current,
              totalCount: localOnlyDraft
                ? Math.max(
                    optimisticRemaining.length,
                    current.totalCount > previousSessions.length
                      ? current.totalCount
                      : current.totalCount - 1,
                  )
                : Math.max(0, current.totalCount - 1),
            }
          : current,
      );
      if (deleteWasActiveSession) {
        replaceDeletedSessionWithFallback({
          courseId: deleteCourseId,
          deletedSessionId: session.id,
        });
      }

      try {
        if (!localOnlyDraft) {
          const remoteDeleted = await deleteRemoteLearnConversation(
            deleteCourseId,
            session.id,
            localUserId,
          );
          if (!remoteDeleted) {
            const restoredSessions = mergeLearnSessions(
              localUserId,
              deleteCourseId,
              readLearnSessions(localUserId, deleteCourseId),
              previousSessions,
            );
            writeLearnSessions(localUserId, deleteCourseId, restoredSessions);
            if (activeCourseIdRef.current === deleteCourseId) {
              setLearnSessions(restoredSessions);
              setLearnSessionListState((current) =>
                current.courseId === deleteCourseId
                  ? {
                      ...current,
                      totalCount: Math.max(current.totalCount + 1, restoredSessions.length),
                    }
                  : current,
              );
            }
            toast.error('远端会话没有删除成功，列表已经恢复。请重试。');
            return;
          }
        }

        rememberDeletedLearnSessionId(localUserId, deleteCourseId, session.id);
        dirtyConversationMessagesRef.current.delete(
          `${localUserId}:${deleteCourseId}:${session.id}`,
        );
        deleteLearnSessionMessages(localUserId, deleteCourseId, session.id);
        writeLearnSessionComposerDraft(localUserId, deleteCourseId, session.id, '');
        composerAttachmentsBySessionRef.current.delete(
          `${localUserId}:${deleteCourseId}:${session.id}`,
        );
        void clearLearnChatSessionAttachments({
          ownerId: localUserId,
          courseId: deleteCourseId,
          sessionId: session.id,
        }).catch(() => undefined);
        deleteLearnSessionRemoteBase(localUserId, deleteCourseId, session.id);
        toast.success(localOnlyDraft ? '本地草稿已删除。' : '会话已删除。');
      } catch (deleteError) {
        console.error('[learn] failed to delete session', deleteError);
        const restoredSessions = mergeLearnSessions(
          localUserId,
          deleteCourseId,
          readLearnSessions(localUserId, deleteCourseId),
          previousSessions,
        );
        writeLearnSessions(localUserId, deleteCourseId, restoredSessions);
        if (activeCourseIdRef.current === deleteCourseId) {
          setLearnSessions(restoredSessions);
          setLearnSessionListState((current) =>
            current.courseId === deleteCourseId
              ? {
                  ...current,
                  totalCount: Math.max(current.totalCount + 1, restoredSessions.length),
                }
              : current,
          );
        }
        toast.error('删除会话失败，列表已经恢复。请稍后再试。');
      } finally {
        pendingDeletedSessionKeysRef.current.delete(pendingDeleteKey);
        setDeletingLearnSessionIds((current) => current.filter((id) => id !== session.id));
      }
    },
    [
      activeCourseId,
      activeSessionId,
      learnSessions,
      localUserId,
      replaceDeletedSessionWithFallback,
      visibleMessages,
    ],
  );

  const loadMoreLearnSessions = useCallback(async () => {
    if (!activeCourseId) return;
    const requestCourseId = activeCourseId;
    if (learnSessionListState.courseId !== requestCourseId) return;
    if (learnSessionListState.loadingMore) return;
    if (learnSessionListState.error && !learnSessionListState.hasMore) {
      setLearnSessionListRefreshAttempt((current) => current + 1);
      return;
    }
    if (!learnSessionListState.hasMore) return;
    const cursor = learnSessionListState.nextCursor;
    if (!cursor) {
      setLearnSessionListState((current) =>
        current.courseId === requestCourseId ? { ...current, hasMore: false } : current,
      );
      return;
    }

    setLearnSessionListState((current) =>
      current.courseId === requestCourseId
        ? { ...current, loadingMore: true, error: null }
        : current,
    );
    const page = await listRemoteLearnSessionsPage(requestCourseId, {
      cursor,
      limit: 5,
      ownerScope: localUserId,
    });
    if (
      activeCourseIdRef.current !== requestCourseId ||
      learnSessionListCourseIdRef.current !== requestCourseId
    ) {
      return;
    }
    if (!page || page.storage !== 'database') {
      setLearnSessionListState((current) =>
        current.courseId === requestCourseId
          ? {
              ...current,
              loadingMore: false,
              error: '更多会话暂时加载失败，请重试。',
            }
          : current,
      );
      return;
    }

    const mergedSessions = excludePendingDeletedLearnSessions(
      localUserId,
      requestCourseId,
      mergeLearnSessions(
        localUserId,
        requestCourseId,
        learnSessionsRef.current,
        page.sessions.map(remoteLearnSessionToLocal),
      ),
      pendingDeletedSessionKeysRef.current,
    );
    writeLearnSessions(localUserId, requestCourseId, mergedSessions);
    learnSessionsRef.current = mergedSessions;
    setLearnSessions(mergedSessions);
    setLearnSessionListState((current) =>
      current.courseId === requestCourseId
        ? {
            ...current,
            // totalCount is exact server metadata; merged length also covers
            // unsynced local drafts without inflating overlap between pages.
            totalCount: Math.max(page.totalCount, mergedSessions.length),
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            loadingMore: false,
            error: null,
          }
        : current,
    );
  }, [activeCourseId, learnSessionListState, localUserId]);

  const loadOlderLearnMessages = useCallback(async () => {
    if (!activeCourseId || activeCourseId !== urlCourseId || !urlSessionId) return;
    const detailKey = activeMessageStoreKey;
    const pageState = remoteConversationMessagePage;
    if (!detailKey || !pageState || pageState.loading || !pageState.hasMore) return;
    const cursor = pageState.nextCursor;
    if (!cursor) {
      setRemoteConversationMessagePageState((current) =>
        current?.key === detailKey
          ? { ...current, error: '更早消息的游标不可用，请重新打开这条会话。' }
          : current,
      );
      return;
    }

    setRemoteConversationMessagePageState((current) =>
      current?.key === detailKey ? { ...current, loading: true, error: null } : current,
    );
    try {
      const remoteConversation = await loadRemoteLearnConversationOrThrow(
        activeCourseId,
        urlSessionId,
        localUserId,
        {
          before: cursor,
          messageLimit: pageState.limit,
          preserveLocalBaseline: true,
        },
      );
      if (activeMessageStoreKeyRef.current !== detailKey) return;
      if (remoteConversation.storage !== 'database' || !remoteConversation.session) {
        throw new Error('更早消息暂时不可用，请稍后重试。');
      }

      const deletedMessageIds = readDeletedLearnMessageIds(
        localUserId,
        activeCourseId,
        urlSessionId,
      );
      const serverDeletedMessageIds = new Set(remoteConversation.deletedMessageIds ?? []);
      const olderMessages = remoteConversation.messages
        .map(remoteMessageToLearnMessage)
        .filter(
          (message) =>
            !deletedMessageIds.has(message.id) && !serverDeletedMessageIds.has(message.id),
        );
      const scrollContainer = conversationScrollContainerRef.current;
      const previousScrollHeight = scrollContainer?.scrollHeight ?? 0;
      replaceMessagesFromRead(detailKey, (current) =>
        mergeOlderRemoteLearnMessages(olderMessages, current),
      );
      window.requestAnimationFrame(() => {
        const currentScrollContainer = conversationScrollContainerRef.current;
        if (
          !scrollContainer ||
          currentScrollContainer !== scrollContainer ||
          activeMessageStoreKeyRef.current !== detailKey
        ) {
          return;
        }
        currentScrollContainer.scrollTop +=
          currentScrollContainer.scrollHeight - previousScrollHeight;
      });

      if (remoteConversation.summary) {
        setRemoteConversationSummaryState({
          key: detailKey,
          summary: remoteConversation.summary,
        });
      }
      setRemoteConversationMessagePageState({
        key: detailKey,
        hasMore:
          remoteConversation.messagePage?.hasMore ??
          remoteConversation.messageWindow?.hasMore ??
          false,
        nextCursor: remoteConversation.messagePage?.nextCursor ?? null,
        limit: remoteConversation.messagePage?.limit ?? pageState.limit,
        loading: false,
        error: null,
      });
      const remoteBase = getRemoteLearnConversationBaseSnapshot(
        activeCourseId,
        urlSessionId,
        localUserId,
      );
      if (remoteBase) {
        writeLearnSessionRemoteBase(localUserId, activeCourseId, urlSessionId, remoteBase);
      }
      setLearnSessions((current) => {
        const nextSessions = mergeLearnSessions(localUserId, activeCourseId, current, [
          remoteLearnSessionToLocal(remoteConversation.session!),
        ]);
        writeLearnSessions(localUserId, activeCourseId, nextSessions);
        return nextSessions;
      });

      if (olderMessages.length > 0) {
        void hydrateLearnMessageAttachments({
          messages: olderMessages,
          ownerId: localUserId,
          courseId: activeCourseId,
          sessionId: urlSessionId,
        }).then((hydrated) => {
          if (activeMessageStoreKeyRef.current !== detailKey) {
            revokeLearnChatAttachmentUrls(hydrated.objectUrls.map((objectUrl) => ({ objectUrl })));
            return;
          }
          for (const objectUrl of hydrated.objectUrls) {
            hydratedAttachmentUrlsRef.current.add(objectUrl);
          }
          const hydratedById = new Map(hydrated.messages.map((message) => [message.id, message]));
          replaceMessagesFromRead(detailKey, (current) =>
            current.map((message) => hydratedById.get(message.id) ?? message),
          );
        });
      }
    } catch (loadError) {
      if (activeMessageStoreKeyRef.current !== detailKey) return;
      setRemoteConversationMessagePageState((current) =>
        current?.key === detailKey
          ? {
              ...current,
              loading: false,
              error:
                loadError instanceof Error ? loadError.message : '更早消息暂时不可用，请稍后重试。',
            }
          : current,
      );
    }
  }, [
    activeCourseId,
    activeMessageStoreKey,
    localUserId,
    remoteConversationMessagePage,
    replaceMessagesFromRead,
    urlCourseId,
    urlSessionId,
  ]);

  const addAssistantPlan = useCallback(
    (plan: PracticePlan, textOverride?: string, extraArtifacts: LearnArtifact[] = []) => {
      const savedPlan = savePracticePlan(plan);
      const calendarDraftItems = practicePlanCalendarDraftItems(savedPlan);
      const artifacts: LearnArtifact[] = [
        ...(calendarDraftItems.length
          ? [
              {
                kind: 'calendar_draft' as const,
                id: makeClientId('calendar-draft'),
                title: `${savedPlan.title} 日历草稿`,
                items: calendarDraftItems,
                sourceArtifactId: savedPlan.id,
              },
            ]
          : []),
        ...extraArtifacts,
      ];
      void saveRemotePracticePlan(savedPlan);
      setRecentPlans((current) => mergePlans([savedPlan], current).slice(0, 4));
      setMessages((current) => [
        ...current,
        {
          id: makeClientId('assistant-plan'),
          role: 'assistant',
          text: textOverride || planIntro(savedPlan),
          createdAt: Date.now(),
          plan: savedPlan,
          artifacts,
        },
      ]);
      refreshLearnerSnapshot();
    },
    [refreshLearnerSnapshot, setMessages],
  );

  const buildSelectedProblemPracticePlan = useCallback(
    (args: {
      mode: PracticePlanMode;
      prompt?: string;
      targetCount?: number;
      preferredConcepts?: string[];
      preferredProblemIds?: string[];
      stateOverride?: LearnerCourseState;
      problemBankSearch?: LearnProblemBankSearchResult | null;
      problemsOverride?: CourseProblemClientSummary[];
    }): PracticePlan | null => {
      if (!activeCourse) return null;
      const availableProblems = args.problemsOverride || problems;
      const activeProblems = availableProblems.filter((problem) => problem.status !== 'archived');
      if (!activeProblems.length) return null;
      const terms = practiceSelectionTerms({
        prompt: args.prompt,
        preferredConcepts: args.preferredConcepts,
        course: activeCourse,
      });
      const targetCount = Math.max(1, Math.min(args.targetCount ?? 5, 8));
      const activeProblemById = new Map(activeProblems.map((problem) => [problem.id, problem]));
      const preferredProblemIds = new Set(args.preferredProblemIds || []);
      const selected: Array<{
        problem: CourseProblemClientSummary;
        score: number;
        searchMatch?: LearnProblemBankMatch;
      }> = args.problemBankSearch
        ? args.problemBankSearch.matches
            .map((match) => {
              const problem = activeProblemById.get(match.problemId);
              return problem ? { problem, score: match.score, searchMatch: match } : null;
            })
            .filter(
              (
                item,
              ): item is {
                problem: CourseProblemClientSummary;
                score: number;
                searchMatch: LearnProblemBankMatch;
              } => Boolean(item),
            )
            .slice(0, targetCount)
        : (() => {
            const ranked = activeProblems
              .map((problem) => ({
                problem,
                score:
                  (preferredProblemIds.has(problem.id) ? 100 : 0) +
                  practiceProblemMatchScore(problem, terms),
              }))
              .sort((a, b) => b.score - a.score || a.problem.title.localeCompare(b.problem.title));
            return ranked.some((item) => item.score > 0) && terms.length
              ? ranked.filter((item) => item.score > 0).slice(0, targetCount)
              : ranked.slice(0, targetCount);
          })();
      if (!selected.length) return null;

      const planState =
        args.stateOverride ||
        seedLearnerCourseStateFromCourse({
          userId: userId || 'anonymous',
          course: activeCourse,
          notebooks,
          problems: availableProblems,
        });
      const recentProblemIds = new Set(
        planState.recentProblemAttempts.slice(0, 20).map((item) => item.problemId),
      );
      const selectedProblems = selected.map((item) => item.problem);
      const targetConcepts = uniquePlanStrings(
        [
          ...(args.preferredConcepts || []),
          args.problemBankSearch?.query,
          ...terms.filter((term) => !/^(node|nodes|next|head|_first|_node)$/i.test(term)),
          ...selectedProblems.flatMap((problem) => problem.tags),
          activeCourse.courseCode,
        ],
        6,
      );
      const primaryConcept =
        targetConcepts.find((concept) => /linked\s*list|linkedlist/i.test(concept)) ||
        targetConcepts[0] ||
        '题库练习';
      const rationale = selectedProblemPracticeRationale({
        primaryConcept,
        selectedProblems,
        terms,
      });
      const searchRationale = args.problemBankSearch
        ? uniquePlanStrings(
            [
              ...args.problemBankSearch.rationale,
              ...args.problemBankSearch.gaps,
              args.problemBankSearch.excluded.length
                ? `已排除 ${args.problemBankSearch.excluded.length} 个相邻但不符合本轮目标的候选。`
                : '',
            ],
            4,
          )
        : rationale;
      const now = Date.now();
      return {
        version: 1,
        id: makeClientId(args.mode === 'quiz' ? 'quiz-selection' : 'practice-selection'),
        userId: userId || 'anonymous',
        courseId: activeCourse.id,
        courseName: activeCourse.name,
        mode: args.mode,
        title: `已选好 ${selectedProblems.length} 道 ${primaryConcept} 练习`,
        targetConcepts: targetConcepts.length ? targetConcepts : [primaryConcept],
        problemIds: selectedProblems.map((problem) => problem.id),
        questions: selected.map(({ problem, searchMatch }) => ({
          problemId: problem.id,
          title: problem.title,
          href: `/course/${encodeURIComponent(activeCourse.id)}/problem-bank/${encodeURIComponent(problem.id)}`,
          reason: searchMatch?.reason || practiceProblemReason(problem, terms),
          difficulty: problem.difficulty,
          tags: problem.tags,
        })),
        estimatedMinutes:
          args.mode === 'quiz'
            ? Math.max(12, selectedProblems.length * 3)
            : Math.max(10, selectedProblems.length * 2),
        difficultyMix: selectedPracticeDifficultyMix(selectedProblems.length),
        createdFrom: {
          currentNotebookId: undefined,
          currentNotebookName: undefined,
          weakPoints: [],
          recentAttemptProblemIds: Array.from(recentProblemIds).slice(0, 8),
          prompt: args.prompt?.trim().slice(0, 600),
        },
        status: 'active',
        createdAt: now,
        updatedAt: now,
        evidence: {
          decisionId: PRACTICE_PROBLEM_SELECTION_DECISION_ID,
          rationale: searchRationale,
          gaps: args.problemBankSearch?.gaps || [],
          items: selected.slice(0, 6).map(({ problem, searchMatch }) => ({
            id: `problem-${problem.id}`,
            sourceType: 'problem_bank',
            sourceId: problem.id,
            title: problem.title,
            reason: searchMatch?.reason || practiceProblemReason(problem, terms),
            excerpt:
              searchMatch?.excerpt ||
              [
                problem.notebookName ? `来源：${problem.notebookName}` : '',
                problem.tags.length ? `标签：${problem.tags.slice(0, 5).join('、')}` : '',
              ]
                .filter(Boolean)
                .join('；'),
          })),
        },
      };
    },
    [activeCourse, notebooks, problems, userId],
  );

  const actionResult = useCallback(
    (
      action: LearningAction,
      args: Omit<
        Parameters<typeof createLearnActionExecutionResult>[1],
        'courseId' | 'conversationId'
      >,
    ) =>
      createLearnActionExecutionResult(action, {
        ...args,
        courseId: activeCourseId || undefined,
        conversationId: activeSessionId,
      }),
    [activeCourseId, activeSessionId],
  );

  const markLearningActionStatus = useCallback(
    (
      actionId: string,
      status: NonNullable<LearningAction['status']>,
      result?: NonNullable<LearningAction['result']>,
    ) => {
      setMessages((current) =>
        current.map((message) =>
          message.learningActions?.some((action) => action.id === actionId)
            ? {
                ...message,
                learningActions: message.learningActions.map((action) =>
                  action.id === actionId
                    ? {
                        ...action,
                        status,
                        result:
                          result ||
                          (status === 'completed' || status === 'failed' || status === 'cancelled'
                            ? actionResult(action, {
                                status,
                                input: {
                                  payload: action.payload || {},
                                },
                              })
                            : action.result),
                      }
                    : action,
                ),
              }
            : message,
        ),
      );
    },
    [actionResult, setMessages],
  );

  const handleLearningActionConfirm = useCallback(
    async (action: LearningAction) => {
      const actionStoreKey = activeMessageStoreKeyRef.current;
      if (!actionStoreKey) return;
      if (localConversationReadyKey !== actionStoreKey) {
        toast.info('会话仍在本地恢复，请稍后再执行学习操作。');
        return;
      }
      const actionStillBelongsToVisibleSession = () =>
        activeMessageStoreKeyRef.current === actionStoreKey;
      if (!activeCourseId || !activeCourse) {
        markLearningActionStatus(action.id, 'failed');
        toast.error('当前没有可写入的课程。');
        return;
      }
      const executionKey = `${actionStoreKey}:${action.id}`;
      if (learningActionExecutionIdsRef.current.has(executionKey)) {
        toast.info('这个学习操作正在执行。');
        return;
      }
      learningActionExecutionIdsRef.current.add(executionKey);
      markLearningActionStatus(action.id, 'confirmed');

      try {
        if (action.kind === 'calendar.search') {
          const query = payloadString(action.payload?.query) || actionSummary(action);
          const searchResult = await searchLearningCalendarEvents({
            courseId: activeCourseId,
            query,
            referenceDate: calendarReferenceDate,
          });
          if (!actionStillBelongsToVisibleSession()) return;
          mergeLoadedCalendarEvents(searchResult.events);
          setRightRailCollapsed(false);
          setRightRailView('calendar');
          setCalendarDialogOpen(true);
          if (searchResult.events[0]) {
            setCalendarReferenceDate(new Date(`${searchResult.events[0].date}T12:00:00`));
          }
          setSyllabusImportMessage(
            searchResult.events.length
              ? `日历查询「${query}」命中 ${searchResult.events.length} 项。`
              : `日历查询「${query}」没有命中事项。`,
          );
          markLearningActionStatus(
            action.id,
            'completed',
            actionResult(action, {
              status: 'completed',
              summary: `已查询远端学习日历，命中 ${searchResult.events.length} 项。`,
              input: { query },
              output: {
                openedView: 'calendar',
                matchedCount: searchResult.events.length,
                scannedCount: searchResult.scannedCount,
                eventIds: searchResult.events.map((event) => event.id),
                truncated: searchResult.truncated,
              },
            }),
          );
          return;
        }

        if (action.kind === 'calendar.start_recent') {
          const payload = actionPayload(action);
          const activityId = payloadString(payload.activityId);
          const activity =
            statusCalendarActivities.find(
              (item) => item.id === activityId || item.sourceId === activityId,
            ) || statusCalendarActivities[0];
          if (!activity) {
            setMessages((current) => [
              ...current,
              {
                id: makeClientId('assistant-calendar-no-activity'),
                role: 'assistant',
                text: '现在没有可开始的课程日历活动。你可以先生成一个活动计划，或手动添加今天的学习安排。',
                createdAt: Date.now(),
              },
            ]);
            markLearningActionStatus(
              action.id,
              'failed',
              actionResult(action, {
                status: 'failed',
                summary: '没有可开始的课程日历活动。',
                input: { payload: action.payload || {} },
                error: 'No recent calendar activity was available.',
              }),
            );
            return;
          }
          await startStatusCalendarActivity(activity);
          if (!actionStillBelongsToVisibleSession()) return;
          markLearningActionStatus(
            action.id,
            'completed',
            actionResult(action, {
              status: 'completed',
              summary: `已开始学习活动：${activity.title}`,
              input: { payload: action.payload || {} },
              output: {
                activityId: activity.id,
                sourceId: activity.sourceId,
                title: activity.title,
              },
            }),
          );
          return;
        }

        if (action.kind === 'memory.search') {
          const query = payloadString(action.payload?.query) || actionSummary(action);
          const data = await backendJson<{
            answer?: string;
            counts?: Record<string, number>;
          }>('/api/memory/search', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(providerId === 'openai' && modelId ? { 'x-model': `openai:${modelId}` } : {}),
            },
            body: JSON.stringify({
              targetType: 'course',
              targetId: activeCourseId,
              query,
              conversationId: activeSessionId,
            }),
          });
          if (!actionStillBelongsToVisibleSession()) return;
          setMessages((current) => [
            ...current,
            {
              id: makeClientId('assistant-memory-search'),
              role: 'assistant',
              text:
                data.answer ||
                `我查了这门课的学习记忆，但没有找到足够明确的记录来回答「${query}」。`,
              createdAt: Date.now(),
            },
          ]);
          markLearningActionStatus(
            action.id,
            'completed',
            actionResult(action, {
              status: 'completed',
              summary: `已查询学习记忆：${query}`,
              input: { query },
              output: { counts: data.counts || {}, hasAnswer: Boolean(data.answer) },
            }),
          );
          return;
        }

        if (action.kind === 'web.search') {
          const query = payloadString(action.payload?.query) || actionSummary(action);
          const webConfig = webSearchProvidersConfig[webSearchProviderId];
          const data = await backendJson<{
            answer?: string;
            sources?: Array<{ title: string; url: string; content?: string; score?: number }>;
            query?: string;
            skipped?: boolean;
            reason?: string;
          }>('/api/web-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              apiKey: webConfig?.apiKey || undefined,
              usageContext: {
                courseId: activeCourseId || undefined,
                courseName: activeCourse.name,
                operationCode: 'learn_web_search',
                chargeReason: '学习页联网搜索',
                serviceLabel: 'Tavily Web Search',
              },
            }),
          });
          if (!actionStillBelongsToVisibleSession()) return;
          if (data.skipped) {
            setMessages((current) => [
              ...current,
              {
                id: makeClientId('assistant-web-search-skipped'),
                role: 'assistant',
                text: '当前没有配置可用的网页搜索 API key，所以这次没有联网搜索。',
                createdAt: Date.now(),
              },
            ]);
            markLearningActionStatus(
              action.id,
              'failed',
              actionResult(action, {
                status: 'failed',
                summary: '网页搜索未执行：没有可用 API key。',
                input: { query },
                error: data.reason || 'Web search provider was not configured.',
              }),
            );
            return;
          }
          const artifact: LearnArtifact = {
            kind: 'web_search_result',
            id: makeClientId('web-search-artifact'),
            query: data.query || query,
            answer: data.answer || undefined,
            usedFor: payloadString(action.payload?.usedFor) || undefined,
            sources: (data.sources || []).slice(0, 8),
          };
          const sourceLines = artifact.sources
            .slice(0, 4)
            .map((source, index) => `${index + 1}. [${source.title}](${source.url})`)
            .join('\n');
          setMessages((current) => [
            ...current,
            {
              id: makeClientId('assistant-web-search'),
              role: 'assistant',
              text: [
                data.answer || `我查到了和「${query}」相关的网页来源。`,
                sourceLines ? `\n来源：\n${sourceLines}` : '',
              ]
                .filter(Boolean)
                .join('\n'),
              createdAt: Date.now(),
              artifacts: [artifact],
            },
          ]);
          markLearningActionStatus(
            action.id,
            'completed',
            actionResult(action, {
              status: 'completed',
              summary: `已完成网页搜索：${query}`,
              input: { query },
              output: {
                sourceCount: artifact.sources.length,
                artifactId: artifact.id,
              },
            }),
          );
          return;
        }

        if (action.kind === 'calendar.propose_add') {
          const events = learningActionCalendarEvents(action).map((event, index) => {
            const clientEventId = `learning-action-${action.id}-${index}`.slice(0, 200);
            return {
              ...event,
              id: clientEventId,
              clientEventId,
              courseId: activeCourseId,
            };
          });
          const createdEvents = await createCalendarEvents(events, {
            idempotencyKey: makeLearningCalendarIdempotencyKey(
              'ai-calendar-add',
              `${activeCourseId}-${action.id}`,
            ),
          });
          if (!actionStillBelongsToVisibleSession()) return;
          setSyllabusImportMessage(`已同步 ${createdEvents.length} 个 AI 学习日程。`);
          setRightRailCollapsed(false);
          setRightRailView('calendar');
          setCalendarReferenceDate(new Date(`${createdEvents[0].date}T12:00:00`));
          announceSyllabusScheduleUpdated(activeCourseId, createdEvents[0].title);
          markLearningActionStatus(
            action.id,
            'completed',
            actionResult(action, {
              status: 'completed',
              summary: `已加入 ${createdEvents.length} 个学习日历事项。`,
              input: { payload: action.payload || {} },
              output: {
                eventIds: createdEvents.map((event) => event.id),
                eventCount: createdEvents.length,
              },
            }),
          );
          toast.success('已加入学习日历。');
          return;
        }

        if (action.kind === 'calendar.propose_update') {
          const currentEvents = await reloadCalendarEvents();
          if (!actionStillBelongsToVisibleSession()) return;
          const updateResult = applyLearningCalendarUpdate({ events: currentEvents, action });
          if (!updateResult) {
            setRightRailCollapsed(false);
            setRightRailView('calendar');
            setCalendarDialogOpen(true);
            markLearningActionStatus(
              action.id,
              'failed',
              actionResult(action, {
                status: 'failed',
                summary: '日历修改没有命中唯一事项。',
                input: { payload: action.payload || {} },
                error: 'Calendar update target was ambiguous.',
              }),
            );
            toast.error('这个日历修改没有命中唯一事项，请在日历里选择后再改。');
            return;
          }
          const currentById = new Map(currentEvents.map((event) => [event.id, event]));
          const changedEvents = updateResult.events
            .map((event) => {
              const previous = currentById.get(event.id);
              if (!previous) return null;
              const patch = calendarEventPatch(previous, event);
              return Object.keys(patch).length ? { previous, patch } : null;
            })
            .filter(
              (
                item,
              ): item is {
                previous: RemoteLearningCalendarEvent;
                patch: LearningCalendarEventPatch;
              } => Boolean(item),
            );
          if (!changedEvents.length) {
            throw new Error('日历事项已经是目标状态，没有可提交的远端修改。');
          }
          const updatedEvents: RemoteLearningCalendarEvent[] = [];
          for (const item of changedEvents) {
            updatedEvents.push(
              await updateCalendarEvent(item.previous, item.patch, {
                idempotencyKey: makeLearningCalendarIdempotencyKey(
                  'ai-calendar-update',
                  `${activeCourseId}-${action.id}-${item.previous.id}-${item.previous.version}`,
                ),
              }),
            );
          }
          if (!actionStillBelongsToVisibleSession()) return;
          const focusEvent =
            updatedEvents.find((event) => event.id === updateResult.updated.id) || updatedEvents[0];
          setSyllabusImportMessage('AI 建议的日历调整已同步，请在学习日历中检查。');
          setRightRailCollapsed(false);
          setRightRailView('calendar');
          setCalendarReferenceDate(new Date(`${focusEvent.date}T12:00:00`));
          announceSyllabusScheduleUpdated(activeCourseId, focusEvent.title);
          markLearningActionStatus(
            action.id,
            'completed',
            actionResult(action, {
              status: 'completed',
              summary: `已调整 ${updatedEvents.length} 个日历事项。`,
              input: { payload: action.payload || {} },
              output: {
                eventId: focusEvent.id,
                eventIds: updatedEvents.map((event) => event.id),
                title: focusEvent.title,
                date: focusEvent.date,
              },
            }),
          );
          toast.success('日历调整已记录。');
          return;
        }

        if (action.kind === 'calendar.propose_delete') {
          const currentEvents = await reloadCalendarEvents();
          if (!actionStillBelongsToVisibleSession()) return;
          const deleteResult = applyLearningCalendarDelete({ events: currentEvents, action });
          if (!deleteResult) {
            setRightRailCollapsed(false);
            setRightRailView('calendar');
            setCalendarDialogOpen(true);
            markLearningActionStatus(
              action.id,
              'failed',
              actionResult(action, {
                status: 'failed',
                summary: '日历删除没有命中唯一事项。',
                input: { payload: action.payload || {} },
                error: 'Calendar delete target was ambiguous.',
              }),
            );
            toast.error('这个删除操作没有命中唯一事项，请在日历里手动确认。');
            return;
          }
          for (const event of deleteResult.deletedEvents) {
            const remoteEvent = currentEvents.find((candidate) => candidate.id === event.id);
            if (!remoteEvent) throw new Error(`找不到待删除的远端日历事项：${event.id}`);
            await deleteCalendarEvent(remoteEvent, {
              idempotencyKey: makeLearningCalendarIdempotencyKey(
                'ai-calendar-delete',
                `${activeCourseId}-${action.id}-${remoteEvent.id}-${remoteEvent.version}`,
              ),
            });
          }
          if (!actionStillBelongsToVisibleSession()) return;
          setRightRailCollapsed(false);
          setRightRailView('calendar');
          const deletedCount = deleteResult.deletedEvents.length;
          markLearningActionStatus(
            action.id,
            'completed',
            actionResult(action, {
              status: 'completed',
              summary: `已删除 ${deletedCount} 个日历事项。`,
              input: { payload: action.payload || {} },
              output: {
                eventId: deleteResult.deleted.id,
                eventIds: deleteResult.deletedEvents.map((event) => event.id),
              },
            }),
          );
          toast.success(`已删除 ${deletedCount} 个日历事项。`);
          return;
        }

        if (action.kind === 'learner_progress.request_confirmation') {
          setMessages((current) => [
            ...current,
            {
              id: makeClientId('assistant-progress-action'),
              role: 'assistant',
              text: '先确认一下学习进度；确认后我会按这个位置继续安排计划和复习。',
              createdAt: Date.now(),
              progressProposal: {
                selection: '',
                label: action.label || '确认学习进度',
                title: '确认学习进度',
                reason: actionSummary(action),
                confirmLabel: '确认进度',
                writeMode: 'progress',
              },
            },
          ]);
          setRightRailCollapsed(false);
          setRightRailView('overview');
          markLearningActionStatus(
            action.id,
            'completed',
            actionResult(action, {
              status: 'completed',
              summary: '已打开学习进度确认卡。',
              input: { payload: action.payload || {} },
              output: { pendingAction: 'progress_confirmation' },
            }),
          );
          return;
        }

        if (action.kind === 'practice.propose_generation') {
          let selectionProblems = problems;
          let selectionProblemsState = problemsLoadState;
          try {
            selectionProblems = await ensureProblemsLoaded();
            selectionProblemsState = settledResourceLoadState({
              courseId: activeCourse.id,
              itemCount: selectionProblems.length,
            });
          } catch (resourceError) {
            selectionProblemsState = failedResourceLoadState({
              courseId: activeCourse.id,
              error: resourceError,
              usingCachedData: selectionProblems.length > 0,
            });
          }
          const activeProblemCount = selectionProblems.filter(
            (problem) => problem.status !== 'archived',
          ).length;
          const actionPayloadData = actionPayload(action);
          const summaryText = actionSummary(action);
          // Historical actions may still request generated/self-generated sources.
          // Their execution contract is now selection-only: never create replacement questions.
          if (
            selectionProblemsState.status === 'idle' ||
            selectionProblemsState.status === 'loading' ||
            (selectionProblemsState.status === 'error' && activeProblemCount === 0)
          ) {
            const reason = selectionProblemsState.error || '题库仍在加载';
            setMessages((current) => [
              ...current,
              {
                id: makeClientId('assistant-problem-resource-unresolved'),
                role: 'assistant',
                text: `暂时无法执行题库选题：${reason}。资源状态明确前，我不会把它当成“无题库”。请重试题库加载。`,
                createdAt: Date.now(),
              },
            ]);
            markLearningActionStatus(
              action.id,
              'failed',
              actionResult(action, {
                status: 'failed',
                summary: '题库状态尚未确认，未执行选题。',
                input: { payload: action.payload || {} },
                error: reason,
              }),
            );
            return;
          }
          if (!activeProblemCount) {
            setMessages((current) => [
              ...current,
              {
                id: makeClientId('assistant-no-course-bank-confirm'),
                role: 'assistant',
                text: buildNoCourseProblemBankAnswer({
                  course: activeCourse,
                  questionText: summaryText,
                  notebooks,
                  notebooksLoadState,
                }),
                createdAt: Date.now(),
              },
            ]);
            markLearningActionStatus(
              action.id,
              'completed',
              actionResult(action, {
                status: 'completed',
                summary: '没有可用题库，已改为说明缺失而不是生成题库题。',
                input: { payload: action.payload || {} },
                output: { generatedPlan: false, missingEvidence: ['problem_bank'] },
              }),
            );
            return;
          }
          if (activeProblemCount > 0) {
            const currentState = loadLearnerCourseState({
              userId: localUserId,
              courseId: activeCourseId,
            });
            const selectedPlan = buildSelectedProblemPracticePlan({
              mode: 'practice',
              prompt: summaryText,
              targetCount:
                typeof actionPayloadData.count === 'number' ? actionPayloadData.count : undefined,
              preferredConcepts: learningActionPreferredConcepts(action),
              stateOverride: currentState,
              problemsOverride: selectionProblems,
            });
            if (selectedPlan) {
              addAssistantPlan(selectedPlan);
              markLearningActionStatus(
                action.id,
                'completed',
                actionResult(action, {
                  status: 'completed',
                  summary: `已从题库选择 ${selectedPlan.problemIds.length} 道练习题。`,
                  input: { payload: action.payload || {} },
                  output: {
                    generatedPlan: true,
                    source: 'problem_bank',
                    planId: selectedPlan.id,
                    selectedProblemIds: selectedPlan.problemIds,
                  },
                }),
              );
              return;
            }
            setMessages((current) => [
              ...current,
              {
                id: makeClientId('assistant-practice-bank-no-match'),
                role: 'assistant',
                text: buildProblemBankSelectionFailedAnswer({
                  course: activeCourse,
                  questionText: summaryText,
                  activeProblemCount,
                }),
                createdAt: Date.now(),
              },
            ]);
            markLearningActionStatus(
              action.id,
              'completed',
              actionResult(action, {
                status: 'completed',
                summary: '题库没有严格命中，未降级为自生成练习。',
                input: { payload: action.payload || {} },
                output: {
                  generatedPlan: false,
                  source: 'problem_bank',
                  missingEvidence: ['strict_problem_bank_match'],
                },
              }),
            );
            return;
          }
        }

        if (action.kind === 'classroom.propose_temporary_explanation') {
          const topic = payloadString(action.payload?.topic) || action.label || '临时课堂讲解';
          const answer = actionSummary(action);
          const lecturePrompt = buildMiniLecturePrompt({
            question: topic,
            answer,
            course: activeCourse,
          });
          setMessages((current) => [
            ...current,
            {
              id: makeClientId('assistant-lecture-action'),
              role: 'assistant',
              text: lecturePrompt ? '已准备好临时课堂讲解。' : answer,
              createdAt: Date.now(),
              lecturePrompt,
            },
          ]);
          markLearningActionStatus(
            action.id,
            'completed',
            actionResult(action, {
              status: 'completed',
              summary: lecturePrompt ? `已准备临时课堂讲解：${topic}` : '已返回临时讲解文本。',
              input: { payload: action.payload || {} },
              output: { hasLecturePrompt: Boolean(lecturePrompt), topic },
            }),
          );
          return;
        }

        if (action.kind === 'image.propose_generation') {
          if (!imageGenerationEnabled) {
            markLearningActionStatus(
              action.id,
              'failed',
              actionResult(action, {
                status: 'failed',
                summary: '图片生成未执行：功能未开启。',
                input: { payload: action.payload || {} },
                error: 'Image generation is disabled.',
              }),
            );
            toast.error('图片生成功能还没有开启，请先到设置里启用图片生成。');
            return;
          }
          const prompt = payloadString(action.payload?.prompt) || actionSummary(action);
          if (!prompt) {
            markLearningActionStatus(
              action.id,
              'failed',
              actionResult(action, {
                status: 'failed',
                summary: '图片生成未执行：缺少 prompt。',
                input: { payload: action.payload || {} },
                error: 'Missing image prompt.',
              }),
            );
            toast.error('这个图片生成操作缺少 prompt。');
            return;
          }
          const aspectRatio = payloadString(action.payload?.aspectRatio) || '16:9';
          const imageConfig = imageProvidersConfig[imageProviderId];
          const data = await backendJson<{
            result?: {
              url?: string;
              base64?: string;
              width?: number;
              height?: number;
            };
          }>('/api/generate/image', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-image-provider': imageProviderId,
              'x-image-model': imageModelId,
              'x-api-key': imageConfig?.apiKey || '',
              'x-base-url': imageConfig?.baseUrl || '',
            },
            body: JSON.stringify({
              prompt,
              aspectRatio:
                aspectRatio === '4:3' ||
                aspectRatio === '1:1' ||
                aspectRatio === '9:16' ||
                aspectRatio === '16:9'
                  ? aspectRatio
                  : '16:9',
              notebookContext: {
                courseId: activeCourseId || undefined,
                courseName: activeCourse.name,
              },
            }),
          });
          if (!actionStillBelongsToVisibleSession()) return;
          const imageUrl = data.result?.url || data.result?.base64 || '';
          if (!imageUrl) throw new Error('图片生成完成，但响应里没有可展示图片。');
          const artifact: LearnArtifact = {
            kind: 'image_prompt_draft',
            id: makeClientId('image-artifact'),
            prompt,
            aspectRatio:
              aspectRatio === '4:3' ||
              aspectRatio === '1:1' ||
              aspectRatio === '9:16' ||
              aspectRatio === '16:9'
                ? aspectRatio
                : '16:9',
            sourceQuestion: latestUserLearnMessageText(messages),
            imageUrl,
            width: data.result?.width,
            height: data.result?.height,
          };
          setMessages((current) => [
            ...current,
            {
              id: makeClientId('assistant-image-result'),
              role: 'assistant',
              text: '图片已生成。',
              createdAt: Date.now(),
              artifacts: [artifact],
            },
          ]);
          markLearningActionStatus(
            action.id,
            'completed',
            actionResult(action, {
              status: 'completed',
              summary: '图片已生成。',
              input: { prompt, aspectRatio },
              output: {
                artifactId: artifact.id,
                hasImageUrl: Boolean(imageUrl),
                width: artifact.width,
                height: artifact.height,
              },
            }),
          );
          toast.success('图片已生成。');
          return;
        }

        if (action.kind === 'memory.propose_write') {
          const summary = actionSummary(action);
          const structuredMemoryText = memoryActionStructuredText(action, summary);
          const timestamp = Date.now();
          const memoryType = memoryActionType(action);
          const currentState = loadLearnerCourseState({
            userId: localUserId,
            courseId: activeCourseId,
          });
          const concept = memoryActionConcept(action, summary);
          const shadowUpdate = applyConfirmedMemoryToLearnerCourseState({
            state: currentState,
            memoryType,
            concept,
            title: memoryActionTitle(action),
            evidence: structuredMemoryText,
            timestamp,
            makeId: makeClientId,
            correctionMode:
              memoryType === 'correction' ? memoryCorrectionMode(action, summary) : undefined,
          });

          let durableMemoryId: string | undefined;
          try {
            const writeResponse = await writeMemoryWithActivity({
              candidate: memoryWriteCandidateFromLearningAction({
                action,
                courseId: activeCourseId,
                conversationId: activeSessionId,
                summary: structuredMemoryText,
              }),
            });
            const writeResult = writeResponse.results[0];
            if (
              !writeResult?.executed ||
              writeResult.action !== 'write_study_memory' ||
              !writeResult.memory?.id
            ) {
              throw new Error(
                writeResult?.error || writeResult?.reason || '长期记忆没有完成写入。',
              );
            }
            durableMemoryId = writeResult.memory.id;
          } catch (error) {
            if (!actionStillBelongsToVisibleSession()) return;
            const errorMessage = error instanceof Error ? error.message : '未知错误';
            markLearningActionStatus(
              action.id,
              'failed',
              actionResult(action, {
                status: 'failed',
                summary: `长期学习记忆未写入：${concept}`,
                input: { payload: action.payload || {} },
                output: {
                  concept,
                  memoryType,
                  shadowStateUpdated: false,
                  durableMemorySynced: false,
                },
                error: errorMessage,
              }),
            );
            toast.error(`长期学习记忆未写入：${errorMessage}`);
            return;
          }
          if (!actionStillBelongsToVisibleSession()) return;

          const nextState = shadowUpdate.changed
            ? saveLearnerCourseState(shadowUpdate.state)
            : shadowUpdate.state;
          if (shadowUpdate.changed) {
            setSnapshot(
              summarizeLearnerCourseState({
                state: nextState,
                notebooks,
                problems,
              }),
            );
          }
          const shadowStateNeedsSync = shadowUpdate.change !== 'none';
          const completionResult = (remoteShadowStateSynced: boolean | 'pending') =>
            actionResult(action, {
              status: 'completed',
              summary: `已更新学习记忆：${concept}`,
              input: { payload: action.payload || {} },
              output: {
                concept,
                memoryType,
                shadowChange: shadowUpdate.change,
                shadowStateUpdated: shadowUpdate.changed,
                remoteShadowStateSynced,
                durableMemorySynced: true,
                durableMemoryId,
                weakPointId: shadowUpdate.weakPointId,
                conceptMastery: shadowUpdate.conceptMastery,
              },
            });

          // The canonical StudyMemory write is the success boundary. The
          // learner-state fact is a derived shadow projection and must not keep
          // the confirmation action spinning or turn a successful memory write
          // into a false failure.
          const shadowSyncPromise = shadowStateNeedsSync
            ? saveRemoteLearnerCourseState(nextState)
            : Promise.resolve(true);
          markLearningActionStatus(
            action.id,
            'completed',
            completionResult(shadowStateNeedsSync ? 'pending' : true),
          );
          toast.success('已更新学习记忆。');

          if (shadowStateNeedsSync) {
            void shadowSyncPromise.then((remoteShadowStateSynced) => {
              if (!actionStillBelongsToVisibleSession()) return;
              markLearningActionStatus(
                action.id,
                'completed',
                completionResult(remoteShadowStateSynced),
              );
              if (!remoteShadowStateSynced) {
                toast.warning('长期记忆已保存；学习状态镜像暂未同步，不影响本次记忆。');
              }
            });
          }
          return;
        }
      } catch (error) {
        if (!actionStillBelongsToVisibleSession()) return;
        markLearningActionStatus(
          action.id,
          'failed',
          actionResult(action, {
            status: 'failed',
            summary: '学习动作执行失败。',
            input: { payload: action.payload || {} },
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        toast.error(error instanceof Error ? error.message : '学习动作执行失败。');
      } finally {
        learningActionExecutionIdsRef.current.delete(executionKey);
      }
    },
    [
      activeCourse,
      activeCourseId,
      activeSessionId,
      actionResult,
      addAssistantPlan,
      buildSelectedProblemPracticePlan,
      calendarReferenceDate,
      createCalendarEvents,
      deleteCalendarEvent,
      ensureProblemsLoaded,
      imageGenerationEnabled,
      imageModelId,
      imageProviderId,
      imageProvidersConfig,
      localUserId,
      markLearningActionStatus,
      mergeLoadedCalendarEvents,
      messages,
      setMessages,
      modelId,
      notebooks,
      notebooksLoadState,
      problems,
      problemsLoadState,
      providerId,
      reloadCalendarEvents,
      localConversationReadyKey,
      startStatusCalendarActivity,
      statusCalendarActivities,
      updateCalendarEvent,
      webSearchProviderId,
      webSearchProvidersConfig,
    ],
  );

  const handleLearningActionCancel = useCallback(
    (action: LearningAction) => {
      if (!action?.id) return;
      const actionStoreKey = activeMessageStoreKeyRef.current;
      if (!actionStoreKey || localConversationReadyKey !== actionStoreKey) {
        toast.info('会话仍在本地恢复，请稍后再操作。');
        return;
      }
      markLearningActionStatus(action.id, 'cancelled');
      toast.info('已取消这个学习操作。');
    },
    [localConversationReadyKey, markLearningActionStatus],
  );

  useEffect(() => {
    const handleLearningActionEvent = (event: Event) => {
      const action = (event as CustomEvent<LearningAction>).detail;
      if (!action?.id || !action.kind) return;
      handleLearningActionConfirm(action);
    };
    const handleLearningActionCancelEvent = (event: Event) => {
      const action = (event as CustomEvent<LearningAction>).detail;
      if (!action?.id || !action.kind) return;
      handleLearningActionCancel(action);
    };
    window.addEventListener('syntara:learning-action-confirm', handleLearningActionEvent);
    window.addEventListener('syntara:learning-action-cancel', handleLearningActionCancelEvent);
    return () => {
      window.removeEventListener('syntara:learning-action-confirm', handleLearningActionEvent);
      window.removeEventListener('syntara:learning-action-cancel', handleLearningActionCancelEvent);
    };
  }, [handleLearningActionCancel, handleLearningActionConfirm]);

  const buildEvidenceBasedPlan = useCallback(
    async (args: {
      mode: PracticePlanMode;
      prompt: string;
      targetCount?: number;
      stateOverride?: LearnerCourseState;
      snapshotOverride?: LearnerCourseSnapshot;
      allowUnconfirmedSchedule?: boolean;
    }) => {
      if (!activeCourse) return null;
      const localUserId = userId || 'anonymous';
      const planState =
        args.stateOverride ||
        seedLearnerCourseStateFromCourse({
          userId: localUserId,
          course: activeCourse,
          notebooks,
          problems,
        });
      const planSnapshot =
        args.snapshotOverride ||
        summarizeLearnerCourseState({
          state: planState,
          notebooks,
          problems,
        });
      if (
        !planSnapshot.progressKnown &&
        !(args.allowUnconfirmedSchedule && syllabusPlanningEvents(syllabusEvents).length > 0)
      ) {
        return null;
      }

      try {
        const response = await requestTeachingReviewPlan({
          courseId: activeCourse.id,
          prompt: args.prompt,
          conversationId: activeSessionId,
          syllabusEvents,
          mode: args.mode,
          questionCount: args.targetCount,
        });
        return practicePlanFromTeachingReviewDecision({
          response,
          userId: localUserId,
          course: activeCourse,
          mode: args.mode,
          prompt: args.prompt,
          state: planState,
          snapshot: planSnapshot,
          targetCount: args.targetCount,
        });
      } catch (error) {
        console.warn(
          '[learn] evidence-based review plan unavailable:',
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    },
    [activeCourse, activeSessionId, notebooks, problems, syllabusEvents, userId],
  );

  const continuePendingAction = useCallback(
    async (
      action: PendingCourseAction | undefined,
      nextState: LearnerCourseState,
      nextSnapshot: LearnerCourseSnapshot,
    ) => {
      if (!action || !activeCourse) return;
      const pendingStoreKey = activeMessageStoreKeyRef.current;
      if (!pendingStoreKey) return;
      setSending(true);
      if (action.kind === 'practice_plan') {
        let pendingProblems = problems;
        let pendingProblemsState = problemsLoadState;
        try {
          pendingProblems = await ensureProblemsLoaded();
          pendingProblemsState = settledResourceLoadState({
            courseId: activeCourse.id,
            itemCount: pendingProblems.length,
          });
        } catch (resourceError) {
          pendingProblemsState = failedResourceLoadState({
            courseId: activeCourse.id,
            error: resourceError,
            usingCachedData: pendingProblems.length > 0,
          });
        }
        if (
          pendingProblemsState.status === 'idle' ||
          pendingProblemsState.status === 'loading' ||
          (pendingProblemsState.status === 'error' && pendingProblems.length === 0)
        ) {
          setMessages((current) => [
            ...current,
            {
              id: makeClientId('assistant-problem-resource-unresolved'),
              role: 'assistant',
              text: `题库状态尚未确认${pendingProblemsState.error ? `：${pendingProblemsState.error}` : ''}。资源加载完成前，我不会生成“无题库”结论。请先重试题库加载。`,
              createdAt: Date.now(),
            },
          ]);
          setSending(false);
          return;
        }
        try {
          const evidencePlan = await buildEvidenceBasedPlan({
            mode: action.mode,
            prompt: action.prompt,
            stateOverride: nextState,
            snapshotOverride: nextSnapshot,
          });
          if (activeMessageStoreKeyRef.current !== pendingStoreKey) return;
          if (evidencePlan) {
            addAssistantPlan(evidencePlan);
            return;
          }
          setMessages((current) => [
            ...current,
            {
              id: makeClientId('assistant-plan-empty'),
              role: 'assistant',
              text: '进度已经更新，但 AI 没有返回可用的练习计划。我没有使用本地计划兜底，请重试一次或换一个模型。',
              createdAt: Date.now(),
            },
          ]);
        } finally {
          setSending(false);
        }
        return;
      }

      const messagePrefix =
        action.kind === 'preview_plan' ? 'assistant-preview-plan' : 'assistant-review-plan';

      try {
        const pendingContentState = courseContentStateRef.current.get(activeCourse.id);
        const learnTurn = await planLearnTurn({
          question: action.prompt,
          messages,
          course: activeCourse,
          snapshot: nextSnapshot,
          calendarEvents: syllabusEvents,
          recentActivities: statusCalendarActivities,
          recentPlans,
          problems,
          problemBankActiveCountHint:
            problemsLoadState.status === 'idle' ? pendingContentState?.problems.count : undefined,
          sourceUploads: activeCourseSourceUploads,
          resourceStates: {
            notebooks: planningResourceStatusFromContentOrList({
              listState: notebooksLoadState,
              contentCount: pendingContentState ? pendingContentState.notebooks.count : null,
            }),
            problems: planningResourceStatusFromContentOrList({
              listState: problemsLoadState,
              contentCount: pendingContentState ? pendingContentState.problems.count : null,
            }),
            sources: sourcesLoadState.status,
          },
          providerId,
          modelId,
        });
        if (activeMessageStoreKeyRef.current !== pendingStoreKey) return;
        const artifacts = (learnTurn?.artifacts || [])
          .map(normalizeLearnArtifact)
          .filter((artifact): artifact is LearnArtifact => Boolean(artifact));
        const learningActions = [
          ...(learnTurn?.proposals || []),
          ...(learnTurn?.directCalls || []),
        ].map((learnAction) =>
          learnActionToClientAction({
            action: learnAction,
            id: makeClientId('learn-action'),
            defaultConfirmation: learnActionRequiresConfirmation(learnAction.kind)
              ? 'required'
              : 'none',
          }),
        );
        const text = learnTurn?.replyText?.trim() || '';
        if (!text && !artifacts.length && !learningActions.length) {
          throw new Error('AI 没有返回可展示的计划草稿。');
        }
        setMessages((current) => [
          ...current,
          {
            id: makeClientId(messagePrefix),
            role: 'assistant',
            text,
            createdAt: Date.now(),
            artifacts: artifacts.length ? artifacts : undefined,
            learningActions: learningActions.length ? learningActions : undefined,
            publicTrace: publicTraceFromLearnTurn(learnTurn, {
              question: action.prompt,
              progressKnown: nextSnapshot.progressKnown,
              calendarCount: syllabusEvents.length,
              problemCount: problems.length,
            }),
          },
        ]);
        refreshLearnerSnapshot();
      } catch (error) {
        if (activeMessageStoreKeyRef.current !== pendingStoreKey) return;
        const plannerError = classifyLearnTurnPlannerError(error);
        setMessages((current) => [
          ...current,
          {
            id: makeClientId('assistant-learn-router-error'),
            role: 'assistant',
            text: `${plannerError.message}。我没有使用本地兜底计划，请稍后重试或换一个模型。`,
            createdAt: Date.now(),
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [
      activeCourse,
      addAssistantPlan,
      buildEvidenceBasedPlan,
      activeCourseSourceUploads,
      ensureProblemsLoaded,
      messages,
      modelId,
      notebooksLoadState,
      problems,
      problemsLoadState,
      providerId,
      recentPlans,
      refreshLearnerSnapshot,
      setMessages,
      statusCalendarActivities,
      sourcesLoadState.status,
      syllabusEvents,
    ],
  );

  const confirmMessageProgressProposal = useCallback(
    (messageId: string, selection: string) => {
      const proposalStoreKey = activeMessageStoreKeyRef.current;
      if (!proposalStoreKey || localConversationReadyKey !== proposalStoreKey) {
        toast.info('会话仍在本地恢复，请稍后再确认进度。');
        return;
      }
      if (!selection) return;
      const message = messages.find((item) => item.id === messageId);
      const writeMode = message?.progressProposal?.writeMode ?? 'progress';
      const result =
        writeMode === 'planning_scope'
          ? confirmPlanningScope(selection, message?.pendingAction)
          : updateLearningPosition(selection);
      if (!result) return;
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId && message.progressProposal
            ? {
                ...message,
                text:
                  writeMode === 'planning_scope'
                    ? `已确认本次范围：${result.label}。`
                    : `已更新学习进度：${result.label}。`,
                progressProposal: {
                  ...message.progressProposal,
                  selection,
                  label: result.label,
                  confirmed: true,
                },
                pendingAction: undefined,
              }
            : message,
        ),
      );
      void continuePendingAction(message?.pendingAction, result.state, result.snapshot);
    },
    [
      confirmPlanningScope,
      continuePendingAction,
      messages,
      localConversationReadyKey,
      setMessages,
      updateLearningPosition,
    ],
  );

  const addProgressRequestMessage = useCallback(
    (args: { snapshot: LearnerCourseSnapshot | null }) => {
      const progressKnown = Boolean(args.snapshot?.progressKnown);
      const selection = progressSelectionFromSnapshot(args.snapshot);
      const progressRequest = createLearnProgressRequest({
        progressKnown,
        snapshotSelection: selection,
        selectionLabel: progressLabelForSelection(selection, notebooks),
      });
      const messageId = makeClientId('assistant-progress-proposal');
      setMessages((current) => [
        ...current,
        {
          id: messageId,
          role: 'assistant',
          text: progressRequest.text,
          createdAt: Date.now(),
          progressProposal: progressRequest.proposal,
          pendingAction: progressRequest.pendingAction,
        },
      ]);
    },
    [notebooks, setMessages],
  );

  const startPlan = useCallback(
    (plan: PracticePlan) => {
      const planStoreKey = activeMessageStoreKeyRef.current;
      if (!planStoreKey || localConversationReadyKey !== planStoreKey) {
        toast.info('会话仍在本地恢复，请稍后再开始练习。');
        return;
      }
      openPracticePlan(plan);
    },
    [localConversationReadyKey, openPracticePlan],
  );

  const stopSending = useCallback(() => {
    const request = sendRequestRef.current;
    if (!request) return;
    request.stoppedByUser = true;
    request.controller.abort(new DOMException('用户停止生成', 'AbortError'));
  }, []);

  const sendMessage = useCallback(
    async (textOverride?: string, attachmentOverride?: LearnImageAttachment[]) => {
      const text = (textOverride ?? draft).trim();
      const outgoingAttachments = attachmentOverride ?? attachments;
      const hasAttachments = outgoingAttachments.length > 0;
      const hasImageAttachments = outgoingAttachments.some((attachment) =>
        attachment.mimeType.startsWith('image/'),
      );
      if (
        (!text && !hasAttachments) ||
        !activeCourse ||
        sending ||
        sendRequestRef.current ||
        sourceUploading
      ) {
        return;
      }
      const turnStoreKey = activeMessageStoreKey;
      if (
        !turnStoreKey ||
        messageStoreKey !== turnStoreKey ||
        localConversationReadyKey !== turnStoreKey
      ) {
        setError('会话仍在本地恢复，请稍后再发送。');
        return;
      }
      if (hasImageAttachments && selectedKnownNoVision) {
        setError('当前模型不支持图片，请先切换到带视觉能力的模型。');
        return;
      }
      const outgoingAttachmentPayloads = outgoingAttachments.flatMap((attachment) =>
        attachment.dataUrl
          ? [
              {
                id: attachment.id,
                name: attachment.name,
                mimeType: attachment.mimeType,
                size: attachment.size,
                dataUrl: attachment.dataUrl,
              },
            ]
          : [],
      );
      if (outgoingAttachmentPayloads.length !== outgoingAttachments.length) {
        setError('有附件内容尚未从当前浏览器恢复，请重新选择附件后再发送。');
        return;
      }
      const questionText = text || '请阅读我上传的附件，结合课程内容帮我分析。';
      const turnCourseId = activeCourse.id;
      const controller = new AbortController();
      let didTimeout = false;
      const turnRequest = {
        key: turnStoreKey,
        controller,
        timeoutId: 0,
        stoppedByUser: false,
      };
      turnRequest.timeoutId = window.setTimeout(() => {
        didTimeout = true;
        controller.abort(new DOMException('学习回复超时', 'TimeoutError'));
      }, LEARN_TURN_TIMEOUT_MS);
      sendRequestRef.current = turnRequest;
      const canCommitTurn = () =>
        sendRequestRef.current === turnRequest && activeMessageStoreKeyRef.current === turnStoreKey;
      const finishTurn = () => {
        window.clearTimeout(turnRequest.timeoutId);
        if (sendRequestRef.current === turnRequest) sendRequestRef.current = null;
        if (activeMessageStoreKeyRef.current === turnStoreKey) setSending(false);
      };
      const pendingWorkflowMessageId = makeClientId('assistant-workflow');
      const pendingWorkflowMessage: LearnMessage | null = pendingWorkflowMessageId
        ? {
            id: pendingWorkflowMessageId,
            role: 'assistant',
            text: '',
            createdAt: Date.now(),
            publicTrace: isTeacherCourseChat
              ? pendingTeacherPublicTrace()
              : pendingPublicTraceForQuestion(questionText),
            transient: true,
          }
        : null;
      const userMessage: LearnMessage = {
        id: makeClientId('user'),
        role: 'user',
        text: questionText,
        attachments: outgoingAttachments,
        createdAt: Date.now(),
      };
      updateComposerDraft('');
      updateComposerAttachments([]);
      setError(null);
      setRetryTurn(null);
      setSending(true);
      setMessages((current) => {
        const nextMessages: LearnMessage[] = [...current, userMessage];
        if (pendingWorkflowMessage) nextMessages.push(pendingWorkflowMessage);
        return nextMessages;
      });
      if (outgoingAttachments.length > 0) {
        const attachmentSaveResults = await Promise.allSettled(
          outgoingAttachments.map((attachment) =>
            saveLearnChatAttachmentDataUrl({
              context: {
                ownerId: localUserId,
                courseId: activeCourse.id,
                sessionId: activeSessionId,
                messageId: userMessage.id,
              },
              attachment: learnAttachmentReference(attachment),
              dataUrl: attachment.dataUrl as string,
            }),
          ),
        );
        if (!canCommitTurn()) return;
        const attachmentSaveFailures = attachmentSaveResults.filter(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        if (attachmentSaveFailures.length) {
          console.warn(
            '[learn] failed to persist chat attachments:',
            attachmentSaveFailures.map((result) =>
              result.reason instanceof Error ? result.reason.message : String(result.reason),
            ),
          );
          setError('附件可用于当前回答，但浏览器未能保存副本；刷新后可能需要重新上传。');
        }
      }

      if (isTeacherCourseChat || isStudentCourseChat) {
        const answererConversation = learnMessagesForCourseAnswerer(messages);
        const historicalAnswererMessageIds = new Set(
          answererConversation.map((message) => message.id),
        );
        let latestTeacherPublicTrace: LearnPublicTraceStep[] | undefined;
        let ephemeralCleanupTokens: string[] = [];
        try {
          const preparedAttachments = await prepareCourseChatAttachmentsForModel(
            outgoingAttachmentPayloads,
            { signal: controller.signal },
          );
          ephemeralCleanupTokens = preparedAttachments.cleanupTokens;
          const result = await askCourseOrchestrator({
            courseId: activeCourse.id,
            courseName: activeCourse.name,
            question: questionText,
            conversation: answererConversation,
            attachments: preparedAttachments.attachments,
            orchestratorAvatarUrl: activeCourse.avatarUrl,
            userProfile: { nickname: userName },
            surface: isTeacherCourseChat ? 'teacher-course-chat' : 'student-course-chat',
            signal: controller.signal,
            onMessages: (nextMessages) => {
              if (!canCommitTurn()) return;
              const streamedAnswer = streamedCourseAnswerFromMessages(
                nextMessages,
                historicalAnswererMessageIds,
              );
              if (!streamedAnswer) return;
              if (streamedAnswer.publicTrace?.length) {
                latestTeacherPublicTrace = streamedAnswer.publicTrace;
              }
              setMessages((current) => {
                const existing = current.find((message) => message.id === pendingWorkflowMessageId);
                if (!existing) return current;
                return replaceLearnMessage(current, pendingWorkflowMessageId, {
                  id: pendingWorkflowMessageId,
                  role: 'assistant',
                  text: streamedAnswer.text || existing.text,
                  createdAt: existing.createdAt,
                  publicTrace:
                    streamedAnswer.publicTrace || latestTeacherPublicTrace || existing.publicTrace,
                  contextCompression:
                    streamedAnswer.contextCompression || existing.contextCompression,
                  transient: true,
                });
              });
            },
          });
          if (!canCommitTurn()) return;
          if (controller.signal.aborted) {
            throw controller.signal.reason instanceof Error
              ? controller.signal.reason
              : new DOMException('教师课程回复已中止', 'AbortError');
          }
          const currentTurnAnswer = streamedCourseAnswerFromMessages(
            result.messages,
            historicalAnswererMessageIds,
          );
          if (!currentTurnAnswer?.text.trim()) {
            throw new Error('教师课程助理没有返回新的内容');
          }
          const answerMessage: LearnMessage = {
            id: pendingWorkflowMessageId,
            role: 'assistant',
            text: normalizeCourseAssistantAnswer(currentTurnAnswer.text),
            createdAt: Date.now(),
            publicTrace: finalizePublicTraceSteps(
              currentTurnAnswer.publicTrace || latestTeacherPublicTrace,
            ),
            contextCompression: currentTurnAnswer.contextCompression,
          };
          setMessages((current) =>
            replaceLearnMessage(current, pendingWorkflowMessageId, answerMessage),
          );
          setRetryTurn(null);
        } catch (error) {
          if (!canCommitTurn()) return;
          const stoppedByUser = turnRequest.stoppedByUser;
          const errorText = error instanceof Error ? error.message : '教师课程回复失败';
          const databaseUnavailable =
            /课程数据库暂时不可用|数据库连接暂时繁忙|无法可靠读取已持久化的课程资料/.test(
              errorText,
            );
          const partialAnswer =
            activeMessagesRef.current?.key === turnStoreKey
              ? activeMessagesRef.current.messages
                  .find((message) => message.id === pendingWorkflowMessageId)
                  ?.text.trim() || ''
              : '';
          const interruptionNotice = stoppedByUser
            ? '已停止继续生成。上方是停止前已经收到的内容。'
            : didTimeout
              ? `回复在 ${Math.round(LEARN_TURN_TIMEOUT_MS / 1000)} 秒内没有完成。上方是超时前已经收到的内容，可点击重新发送继续。`
              : databaseUnavailable
                ? '课程数据库暂时不可用，本次回复没有完成，请稍后重试。'
                : `${errorText}。请稍后重试或换一个模型。`;
          const errorMessage: LearnMessage = {
            id: pendingWorkflowMessageId,
            role: 'assistant',
            text: partialAnswer
              ? `${partialAnswer}\n\n> ${interruptionNotice}`
              : interruptionNotice,
            createdAt: Date.now(),
            publicTrace: publicTraceForBlockedQuestion(
              questionText,
              makePublicTraceStep(
                'teacher-answer-blocked',
                stoppedByUser ? '已由你停止' : '教师课程回复没有完成',
                stoppedByUser
                  ? '回答流已取消，已经传输的内容会保留在当前对话中。'
                  : databaseUnavailable
                    ? '课程资料库当前不可连接。本次没有读取旧缓存或生成未经课程资料核对的回答。'
                    : didTimeout
                      ? '回答超时中断，已经传输的内容会保留在当前对话中。'
                      : '课程权限、资料工具或模型回复链路未能成功完成。',
                undefined,
                'blocked',
              ),
            ),
          };
          setRetryTurn({ text: questionText, attachments: outgoingAttachments });
          setMessages((current) =>
            replaceLearnMessage(current, pendingWorkflowMessageId, errorMessage),
          );
        } finally {
          await cleanupCourseChatAttachments(ephemeralCleanupTokens);
          finishTurn();
        }
        return;
      }

      let turnProblems = problems;
      let turnNotebooks = notebooks;
      let turnProblemsState = problemsLoadState;
      const turnContentState = courseContentStateRef.current.get(turnCourseId);
      if ((turnContentState?.notebooks.count || 0) > 0) {
        turnNotebooks = await ensureNotebooksLoaded();
        if (!canCommitTurn()) return;
        if (turnNotebooks.length === 0) {
          setError('课程笔记本目录尚未加载完成，已停止本次回答，避免 AI 丢失学习范围。请重试。');
          finishTurn();
          return;
        }
      }
      const progressSave = progressSavePromiseRef.current;
      const progressSaved =
        !progressSave || progressSave.courseId !== turnCourseId ? true : await progressSave.promise;
      if (!canCommitTurn()) return;
      if (!progressSaved) {
        setError('学习进度尚未同步到账号，已停止本次回答，避免 AI 使用旧进度。请重试。');
        finishTurn();
        return;
      }
      if (explicitPracticeTarget(questionText)) {
        try {
          turnProblems = await ensureProblemsLoaded();
          turnProblemsState = settledResourceLoadState({
            courseId: turnCourseId,
            itemCount: turnProblems.length,
          });
        } catch (resourceError) {
          if (!canCommitTurn()) return;
          turnProblemsState = failedResourceLoadState({
            courseId: turnCourseId,
            error: resourceError,
            usingCachedData: turnProblems.length > 0,
          });
        }
        if (!canCommitTurn()) return;
        const problemTruthUnavailable =
          turnProblemsState.status === 'idle' ||
          turnProblemsState.status === 'loading' ||
          (turnProblemsState.status === 'error' && turnProblems.length === 0);
        if (problemTruthUnavailable) {
          const reason = turnProblemsState.error || '题库资源尚未加载完成';
          const resourceMessage: LearnMessage = {
            id: makeClientId('assistant-problem-resource-error'),
            role: 'assistant',
            text: `我暂时不能判断这门课有没有可用题库：${reason}。请先重试题库加载；资源状态明确前，我不会把它当成“无题库”。`,
            createdAt: Date.now(),
            publicTrace: publicTraceForBlockedQuestion(
              questionText,
              makePublicTraceStep(
                'problem-bank-resource-unresolved',
                '题库状态尚未确认',
                reason,
                undefined,
                'blocked',
              ),
            ),
          };
          setMessages((current) =>
            pendingWorkflowMessageId
              ? replaceLearnMessage(current, pendingWorkflowMessageId, resourceMessage)
              : [...current, resourceMessage],
          );
          finishTurn();
          return;
        }
      } else if (turnContentState) {
        // Non-practice turns only need lightweight availability from content-state.
        turnProblemsState = settledResourceLoadState({
          courseId: turnCourseId,
          itemCount: turnContentState.problems.count,
        });
      }

      const questionState = recordLearnerQuestion({
        userId: userId || 'anonymous',
        courseId: activeCourse.id,
        text: hasAttachments
          ? `${questionText}\n[学生上传了 ${outgoingAttachments.length} 个临时附件]`
          : questionText,
      });
      const questionSnapshot = summarizeLearnerCourseState({
        state: questionState,
        notebooks: turnNotebooks,
        problems: turnProblems,
      });
      setSnapshot(questionSnapshot);
      setProgressSelection(progressSelectionFromSnapshot(questionSnapshot));
      void saveRemoteLearnerCourseState(questionState);

      let learnTurn: LearnTurnClientResponse | null = null;
      try {
        const listProblemsSettled =
          problemsLoadStateRef.current.status === 'ready' ||
          problemsLoadStateRef.current.status === 'empty';
        learnTurn = await planLearnTurn({
          question: questionText,
          messages: [...messages, userMessage],
          attachments: outgoingAttachments,
          course: activeCourse,
          snapshot: questionSnapshot,
          calendarEvents: syllabusEvents,
          recentActivities: statusCalendarActivities,
          recentPlans,
          problems: turnProblems,
          problemBankActiveCountHint:
            turnProblems.some((problem) => problem.status !== 'archived') || listProblemsSettled
              ? undefined
              : turnContentState?.problems.count,
          sourceUploads: activeCourseSourceUploads,
          resourceStates: {
            notebooks: planningResourceStatusFromContentOrList({
              listState: notebooksLoadState,
              contentCount: turnContentState ? turnContentState.notebooks.count : null,
            }),
            problems: turnProblemsState.status,
            sources: sourcesLoadState.status,
          },
          providerId,
          modelId,
          signal: controller.signal,
        });
      } catch (error) {
        if (!canCommitTurn()) return;
        const plannerError = classifyLearnTurnPlannerError(error);
        const stoppedByUser = turnRequest.stoppedByUser;
        const errorMessage: LearnMessage = {
          id: makeClientId('assistant-learn-router-error'),
          role: 'assistant',
          text: stoppedByUser
            ? '已停止生成。你可以原样重新发送上一条消息。'
            : didTimeout
              ? `学习路由在 ${Math.round(LEARN_TURN_TIMEOUT_MS / 1000)} 秒内没有完成，已停止本次请求。你可以直接重试。`
              : `${plannerError.message}。我没有使用本地兜底计划，请稍后重试或换一个模型。`,
          createdAt: Date.now(),
          publicTrace: publicTraceForBlockedQuestion(
            questionText,
            makePublicTraceStep(
              'router-blocked',
              stoppedByUser ? '已由你停止' : plannerError.blockedTitle,
              stoppedByUser ? '本次学习路由和后续回答均已取消。' : plannerError.blockedDetail,
              undefined,
              'blocked',
            ),
          ),
        };
        setRetryTurn({ text: questionText, attachments: outgoingAttachments });
        setMessages((current) =>
          replaceLearnMessage(current, pendingWorkflowMessageId, errorMessage),
        );
        finishTurn();
        return;
      }
      if (!canCommitTurn()) return;
      const learnTurnAnswerMode = learnTurn?.answerMode || 'course_answer';
      const shouldContinueToCourseAnswer = learnTurnAnswerMode === 'course_answer';
      const actionPlanArtifacts = (learnTurn?.artifacts || [])
        .map(normalizeLearnArtifact)
        .filter((artifact): artifact is LearnArtifact => Boolean(artifact));
      const learnTurnPlanningDecision = planningDecisionFromLearnTurn(learnTurn, questionText);
      const completedProblemSearch =
        learnTurnPlanningDecision?.problemBankSearch?.source === 'problem_bank_full_text';
      if (learnTurnPlanningDecision?.intent.kind === 'practice_plan' && !completedProblemSearch) {
        let latestProblemState = problemsLoadStateRef.current;
        if (
          latestProblemState.status === 'idle' ||
          latestProblemState.status === 'loading' ||
          latestProblemState.status === 'error'
        ) {
          try {
            turnProblems = await ensureProblemsLoaded();
            if (!canCommitTurn()) return;
            latestProblemState = settledResourceLoadState({
              courseId: turnCourseId,
              itemCount: turnProblems.length,
            });
            turnProblemsState = latestProblemState;
          } catch (resourceError) {
            if (!canCommitTurn()) return;
            latestProblemState = failedResourceLoadState({
              courseId: turnCourseId,
              error: resourceError,
              usingCachedData: turnProblems.length > 0,
            });
            turnProblemsState = latestProblemState;
          }
        }
        if (
          latestProblemState.status === 'idle' ||
          latestProblemState.status === 'loading' ||
          (latestProblemState.status === 'error' && turnProblems.length === 0)
        ) {
          const reason = latestProblemState.error || '题库仍在加载';
          const resourceMessage: LearnMessage = {
            id: makeClientId('assistant-problem-resource-unresolved'),
            role: 'assistant',
            text: `这次请求需要核对题库，但题库状态还没有完成：${reason}。我已停止生成“无题库”或“没有匹配题”的结论，请重试题库加载后再试。`,
            createdAt: Date.now(),
            publicTrace: publicTraceForBlockedQuestion(
              questionText,
              makePublicTraceStep(
                'problem-bank-resource-unresolved',
                '题库状态尚未确认',
                reason,
                undefined,
                'blocked',
              ),
            ),
          };
          setMessages((current) =>
            pendingWorkflowMessageId
              ? replaceLearnMessage(current, pendingWorkflowMessageId, resourceMessage)
              : [...current, resourceMessage],
          );
          finishTurn();
          return;
        }
      }
      const answererHandoff = answererHandoffFromLearnTurn(learnTurn);
      const proposalActions = filterLearningActionsForQuestion(
        (learnTurn?.proposals || []).map((action) =>
          learnActionToClientAction({
            action,
            id: makeClientId('learn-action'),
            defaultConfirmation: learnActionRequiresConfirmation(action.kind) ? 'required' : 'none',
          }),
        ),
        questionText,
      );
      const directActions = (learnTurn?.directCalls || []).map((action) =>
        learnActionToClientAction({
          action,
          id: makeClientId('learn-action'),
          defaultConfirmation: 'none',
        }),
      );
      const deferredAnswerActions = shouldContinueToCourseAnswer
        ? proposalActions.filter(
            (action) =>
              action.kind === 'memory.propose_write' ||
              action.kind === 'classroom.propose_temporary_explanation',
          )
        : [];
      const blockingProposalActions = shouldContinueToCourseAnswer
        ? proposalActions.filter(
            (action) =>
              action.kind !== 'memory.propose_write' &&
              action.kind !== 'classroom.propose_temporary_explanation',
          )
        : proposalActions;
      const deferredAnswerArtifacts = shouldContinueToCourseAnswer ? actionPlanArtifacts : [];
      const visibleActionPlanArtifacts = shouldContinueToCourseAnswer ? [] : actionPlanArtifacts;
      const visibleBlockingProposalActions = blockingProposalActions;
      const visibleDirectActions = directActions;
      const visibleArtifacts = visibleActionPlanArtifacts;
      const actionPlanText =
        shouldContinueToCourseAnswer &&
        !visibleBlockingProposalActions.length &&
        !visibleArtifacts.length
          ? ''
          : learnTurn?.replyText?.trim() || '';
      if (actionPlanText || visibleBlockingProposalActions.length || visibleArtifacts.length) {
        const actionPlanMessage: LearnMessage = {
          id: shouldContinueToCourseAnswer
            ? pendingWorkflowMessageId
            : makeClientId('assistant-action-plan'),
          role: 'assistant',
          text: actionPlanText,
          createdAt: Date.now(),
          learningActions: visibleBlockingProposalActions.length
            ? visibleBlockingProposalActions
            : undefined,
          artifacts: visibleArtifacts.length ? visibleArtifacts : undefined,
          publicTrace: publicTraceFromLearnTurn(learnTurn, {
            question: questionText,
            progressKnown: questionSnapshot.progressKnown,
            calendarCount: syllabusEvents.length,
            problemCount: turnProblems.length,
          }),
        };
        setMessages((current) =>
          pendingWorkflowMessageId
            ? replaceLearnMessage(current, pendingWorkflowMessageId, actionPlanMessage)
            : [...current, actionPlanMessage],
        );
      }
      if (visibleDirectActions.length) {
        for (const action of visibleDirectActions) {
          if (!canCommitTurn()) return;
          await handleLearningActionConfirm(action);
        }
        if (!canCommitTurn()) return;
        if (!actionPlanText && !visibleBlockingProposalActions.length && !visibleArtifacts.length) {
          const actionOnlyMessage: LearnMessage = {
            id: makeClientId('assistant-action-plan'),
            role: 'assistant',
            text: '已完成这次结构化学习操作。',
            createdAt: Date.now(),
            publicTrace: publicTraceFromLearnTurn(learnTurn, {
              question: questionText,
              progressKnown: questionSnapshot.progressKnown,
              calendarCount: syllabusEvents.length,
              problemCount: turnProblems.length,
            }),
          };
          setMessages((current) =>
            pendingWorkflowMessageId
              ? replaceLearnMessage(current, pendingWorkflowMessageId, actionOnlyMessage)
              : [...current, actionOnlyMessage],
          );
        }
      }
      const emptyTerminalRoute =
        (learnTurnAnswerMode === 'action_only' || learnTurnAnswerMode === 'none') &&
        !actionPlanText &&
        !visibleBlockingProposalActions.length &&
        !visibleArtifacts.length &&
        !visibleDirectActions.length;
      if (emptyTerminalRoute) {
        const emptyRouteMessage: LearnMessage = {
          id: pendingWorkflowMessageId,
          role: 'assistant',
          text: '这次学习路由没有返回可展示的回答或操作。你可以原样重试，或把问题补充得更具体一些。',
          createdAt: Date.now(),
          publicTrace: publicTraceForBlockedQuestion(
            questionText,
            makePublicTraceStep(
              'empty-route-blocked',
              '学习路由没有产生结果',
              '路由结束了本次处理，但没有返回回答、工具操作或可展示卡片，因此没有静默吞掉这条消息。',
              undefined,
              'blocked',
            ),
          ),
        };
        setRetryTurn({ text: questionText, attachments: outgoingAttachments });
        setMessages((current) =>
          replaceLearnMessage(current, pendingWorkflowMessageId, emptyRouteMessage),
        );
        finishTurn();
        return;
      }
      if (
        visibleDirectActions.length ||
        visibleBlockingProposalActions.length ||
        visibleArtifacts.length ||
        learnTurnAnswerMode === 'action_only' ||
        learnTurnAnswerMode === 'none'
      ) {
        finishTurn();
        return;
      }

      const planningDecision = learnTurnPlanningDecision;

      const planningIntent = planningDecision?.intent ?? null;
      const planningPrompt = planningDecision?.resolvedPrompt || questionText;

      if (planningIntent && planningDecision) {
        if (planningIntent.kind === 'practice_plan') {
          const selectedPlan = buildSelectedProblemPracticePlan({
            mode: planningIntent.mode,
            prompt: planningPrompt,
            preferredConcepts: planningDecision.focusTopics,
            stateOverride: questionState,
            problemBankSearch: planningDecision.problemBankSearch,
            problemsOverride: turnProblems,
          });
          if (selectedPlan) {
            if (pendingWorkflowMessageId) {
              setMessages((current) => removeLearnMessage(current, pendingWorkflowMessageId));
            }
            addAssistantPlan(selectedPlan);
            finishTurn();
            return;
          }
          if (planningDecision.problemBankSearch) {
            const noMatchMessage: LearnMessage = {
              id: makeClientId('assistant-practice-no-bank-match'),
              role: 'assistant',
              text: problemBankSearchNoMatchText(planningDecision.problemBankSearch),
              createdAt: Date.now(),
              publicTrace: publicTraceFromLearnTurn(learnTurn, {
                question: questionText,
                progressKnown: questionSnapshot.progressKnown,
                calendarCount: syllabusEvents.length,
                problemCount: turnProblems.length,
              }),
            };
            setMessages((current) =>
              pendingWorkflowMessageId
                ? replaceLearnMessage(current, pendingWorkflowMessageId, noMatchMessage)
                : [...current, noMatchMessage],
            );
            finishTurn();
            return;
          }
          const activeProblemCount = turnProblems.filter(
            (problem) => problem.status !== 'archived',
          ).length;
          const noSearchMessage: LearnMessage = {
            id: makeClientId('assistant-practice-bank-unresolved'),
            role: 'assistant',
            text: activeProblemCount
              ? [
                  `我识别到这是题库练习请求，但这次没有拿到可审计的题库检索结果。`,
                  '我没有用普通计划卡替代真实题目，也没有生成题目补位。',
                  '请重试一次，或先放宽题库检索范围。',
                ].join('\n\n')
              : buildNoCourseProblemBankAnswer({
                  course: activeCourse,
                  questionText: planningPrompt,
                  notebooks: turnNotebooks,
                  notebooksLoadState,
                }),
            createdAt: Date.now(),
            publicTrace: publicTraceForBlockedQuestion(
              questionText,
              makePublicTraceStep(
                'problem-bank-search-missing',
                '题库检索结果缺失',
                '已经识别为题库练习请求，但 planning decision 没有提供 problemBankSearch，因此停止且不生成题目。',
                undefined,
                'blocked',
              ),
            ),
          };
          setMessages((current) =>
            pendingWorkflowMessageId
              ? replaceLearnMessage(current, pendingWorkflowMessageId, noSearchMessage)
              : [...current, noSearchMessage],
          );
          finishTurn();
          return;
        }

        const missingArtifactMessage: LearnMessage = {
          id: makeClientId('assistant-ai-plan-missing-artifact'),
          role: 'assistant',
          text: 'AI 已识别这是学习计划请求，但没有返回可展示的计划草稿。我没有使用本地计划兜底，请重试一次或换一个模型。',
          createdAt: Date.now(),
          publicTrace: publicTraceForBlockedQuestion(
            questionText,
            makePublicTraceStep(
              'artifact-blocked',
              '计划草稿不可展示',
              '路由给出了计划意图，但没有返回合格的 plan artifact。',
              undefined,
              'blocked',
            ),
          ),
        };
        setMessages((current) =>
          pendingWorkflowMessageId
            ? replaceLearnMessage(current, pendingWorkflowMessageId, missingArtifactMessage)
            : [...current, missingArtifactMessage],
        );
        finishTurn();
        return;
      }

      const answererConversation = learnMessagesForCourseAnswerer(messages);
      const historicalAnswererMessageIds = new Set(
        answererConversation.map((message) => message.id),
      );
      const plannerPublicTrace = publicTraceFromLearnTurn(learnTurn, {
        question: questionText,
        progressKnown: questionSnapshot.progressKnown,
        calendarCount: syllabusEvents.length,
        problemCount: turnProblems.length,
      });
      let latestAnswererPublicTrace: LearnPublicTraceStep[] | undefined;
      let ephemeralCleanupTokens: string[] = [];

      try {
        const preparedAttachments = await prepareCourseChatAttachmentsForModel(
          outgoingAttachmentPayloads,
          { signal: controller.signal },
        );
        ephemeralCleanupTokens = preparedAttachments.cleanupTokens;
        const result = await askCourseOrchestrator({
          courseId: activeCourse.id,
          courseName: activeCourse.name,
          question: questionText,
          conversation: answererConversation,
          attachments: preparedAttachments.attachments,
          orchestratorAvatarUrl: activeCourse.avatarUrl,
          answererHandoff,
          learnerContext: buildLearnerChatContext({
            snapshot: questionSnapshot,
            state: questionState,
            notebooks,
            plans: recentPlans,
            syllabusEvents,
          }),
          userProfile: { nickname: userName },
          signal: controller.signal,
          onMessages: (nextMessages) => {
            if (!canCommitTurn()) return;
            const streamedAnswer = streamedCourseAnswerFromMessages(
              nextMessages,
              historicalAnswererMessageIds,
            );
            if (!streamedAnswer) return;
            if (streamedAnswer.publicTrace?.length) {
              latestAnswererPublicTrace = streamedAnswer.publicTrace;
            }
            setMessages((current) => {
              const existing = current.find((message) => message.id === pendingWorkflowMessageId);
              if (!existing) return current;
              const publicTrace = [
                ...plannerPublicTrace.slice(0, 3),
                ...(streamedAnswer.publicTrace ||
                  latestAnswererPublicTrace ||
                  existing.publicTrace ||
                  []),
              ].slice(0, 8);
              return replaceLearnMessage(current, pendingWorkflowMessageId, {
                id: pendingWorkflowMessageId,
                role: 'assistant',
                text: streamedAnswer.text || existing.text,
                createdAt: existing.createdAt,
                publicTrace: publicTrace.length ? publicTrace : undefined,
                contextCompression:
                  streamedAnswer.contextCompression || existing.contextCompression,
                transient: true,
              });
            });
          },
        });
        if (!canCommitTurn()) return;
        if (controller.signal.aborted) {
          throw controller.signal.reason instanceof Error
            ? controller.signal.reason
            : new DOMException('课程回答已中止', 'AbortError');
        }
        const currentTurnAnswer = streamedCourseAnswerFromMessages(
          result.messages,
          historicalAnswererMessageIds,
        );
        if (!currentTurnAnswer?.text.trim()) {
          throw new Error('课程回答没有返回新的内容');
        }
        const rawAnswer = normalizeCourseAssistantAnswer(currentTurnAnswer.text);
        const learningActions = filterLearningActionsForQuestion(
          [...(currentTurnAnswer.learningActions || []), ...deferredAnswerActions],
          questionText,
        );
        const answer = neutralizeUnconfirmedMemoryWriteClaim(rawAnswer, learningActions);
        const lecturePrompt = buildMiniLecturePrompt({
          question: questionText,
          answer,
          course: activeCourse,
        });
        const evidenceArtifact =
          answerEvidenceArtifactFromServerSummaries({
            evidence: result.courseEvidence,
            question: questionText,
          }) ||
          answerEvidenceArtifactFromCourseContext({
            courseContext: result.courseContext,
            question: questionText,
          });
        const artifacts = [
          ...(evidenceArtifact ? [evidenceArtifact] : []),
          ...deferredAnswerArtifacts,
        ];
        const answerMessage: LearnMessage = {
          id: pendingWorkflowMessageId,
          role: 'assistant',
          text: answer,
          createdAt: Date.now(),
          lecturePrompt,
          learningActions: learningActions.length ? learningActions : undefined,
          artifacts: artifacts.length ? artifacts : undefined,
          publicTrace: finalizePublicTraceSteps(
            [
              ...plannerPublicTrace.slice(0, 3),
              ...(currentTurnAnswer.publicTrace || latestAnswererPublicTrace || []),
            ].slice(0, 8),
          ),
          contextCompression: currentTurnAnswer.contextCompression,
        };
        setMessages((current) =>
          replaceLearnMessage(current, pendingWorkflowMessageId, answerMessage),
        );
        setRetryTurn(null);
        refreshLearnerSnapshot();
      } catch (err) {
        if (!canCommitTurn()) return;
        const message = err instanceof Error ? err.message : '课程回复失败';
        const stoppedByUser = turnRequest.stoppedByUser;
        const errorMessage: LearnMessage = {
          id: pendingWorkflowMessageId,
          role: 'assistant',
          text: stoppedByUser
            ? '已停止生成。你可以原样重新发送上一条消息。'
            : didTimeout
              ? `课程回复在 ${Math.round(LEARN_TURN_TIMEOUT_MS / 1000)} 秒内没有完成，已停止本次请求。你可以直接重试。`
              : `${message}。我没有生成本地兜底回答，请稍后重试或换一个模型。`,
          createdAt: Date.now(),
          publicTrace: publicTraceForBlockedQuestion(
            questionText,
            makePublicTraceStep(
              'answer-blocked',
              stoppedByUser ? '已由你停止' : '课程讲解没有完成',
              stoppedByUser
                ? '回答流已取消，未完成的内容不会当作正式回答保存。'
                : '已经进入课程讲解路径，但回答生成没有成功完成。',
              undefined,
              'blocked',
            ),
          ),
        };
        setRetryTurn({ text: questionText, attachments: outgoingAttachments });
        setMessages((current) =>
          replaceLearnMessage(current, pendingWorkflowMessageId, errorMessage),
        );
      } finally {
        await cleanupCourseChatAttachments(ephemeralCleanupTokens);
        finishTurn();
      }
    },
    [
      activeCourse,
      activeMessageStoreKey,
      activeSessionId,
      addAssistantPlan,
      attachments,
      buildSelectedProblemPracticePlan,
      activeCourseSourceUploads,
      draft,
      handleLearningActionConfirm,
      ensureProblemsLoaded,
      isTeacherCourseChat,
      isStudentCourseChat,
      ensureNotebooksLoaded,
      localUserId,
      messages,
      messageStoreKey,
      modelId,
      notebooks,
      notebooksLoadState,
      problems,
      problemsLoadState,
      providerId,
      setMessages,
      refreshLearnerSnapshot,
      statusCalendarActivities,
      recentPlans,
      localConversationReadyKey,
      selectedKnownNoVision,
      sending,
      sourceUploading,
      sourcesLoadState.status,
      syllabusEvents,
      updateComposerAttachments,
      updateComposerDraft,
      userId,
      userName,
    ],
  );

  const sourceBackedNotebookIds = useMemo(() => {
    const ids = new Set<string>();
    for (const upload of activeCourseSourceUploads) {
      for (const notebookId of upload.notebookIds) ids.add(notebookId);
    }
    return ids;
  }, [activeCourseSourceUploads]);

  const sourceLibraryTiles = useMemo<SourceLibraryTile[]>(() => {
    const uploadTiles = activeCourseSourceUploads.map((upload) => {
      const isProblemBank = upload.allQuestionUpload === true || upload.kind === 'problem_bank';
      const sectionCount = upload.stats.sectionCount || upload.sectionIds.length;
      const problemCount = upload.stats.problemCount || upload.problemIds.length;
      const updatedLabel = formatLibraryItemDate(upload.updatedAt);
      const persistedState = persistedSourceUploadTileState(upload);
      return {
        id: `source-${upload.courseId}-${upload.sourceHash}`,
        courseId: upload.courseId,
        tileKind: 'source' as const,
        title: upload.topic || upload.title,
        subtitle: isProblemBank
          ? problemCount > 0
            ? `${problemCount} 道题`
            : '题库文件'
          : sectionCount > 0
            ? `${sectionCount} 段文本`
            : sourceUploadKindLabel(upload.kind),
        dateLabel: updatedLabel,
        coverImagePath: isProblemBank ? null : upload.coverImagePath,
        placeholderLabel: isProblemBank ? '题库' : '原始讲义',
        typeLabel: isProblemBank ? '题库' : sourceUploadKindLabel(upload.kind),
        updatedAt: Date.parse(upload.updatedAt) || 0,
        isProblemBank,
        status: persistedState.status,
        error: persistedState.error,
        sourceHash: upload.sourceHash,
        textNotebookIds: upload.notebookIds,
        textSectionIds: upload.sectionIds,
        textBlocks: (upload.textSections || []).map((section) => ({
          id: section.id,
          title: section.title,
          markdown: section.markdown,
        })),
      };
    });

    const notebookTiles = notebooks
      .filter((notebook) => !sourceBackedNotebookIds.has(notebook.id))
      .map((notebook) => ({
        id: `notebook-${notebook.id}`,
        courseId: notebook.courseId || activeCourseId || '',
        tileKind: 'notebook' as const,
        title: notebook.name,
        subtitle:
          notebook.notebookKind === 'markdown'
            ? `${notebook.sectionCount || 0} 段文本`
            : `${notebook.sceneCount || 0} 页`,
        dateLabel: formatLibraryItemDate(notebook.updatedAt),
        coverImagePath: notebook.coverImagePath || null,
        placeholderLabel: notebook.notebookKind === 'markdown' ? '资料' : '图片笔记',
        typeLabel: notebook.notebookKind === 'markdown' ? '笔记本' : '图片笔记本',
        updatedAt: notebook.updatedAt || 0,
        isProblemBank: false,
        status: null,
        error: null,
        sourceHash: null,
        textNotebookIds: notebook.notebookKind === 'markdown' ? [notebook.id] : [],
        textSectionIds: [],
        textBlocks: [],
      }));

    return [...uploadTiles, ...notebookTiles].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [activeCourseId, activeCourseSourceUploads, notebooks, sourceBackedNotebookIds]);

  const transientSourceUploadTiles = useMemo<SourceLibraryTile[]>(
    () =>
      activeSourceUploadItems
        .filter((item) => item.status !== 'stored')
        .map((item) => ({
          id: `transient-${item.courseId}-${item.id}`,
          courseId: item.courseId,
          tileKind: 'transient' as const,
          title: item.fileName,
          subtitle:
            item.status === 'ingesting'
              ? '入库中'
              : item.status === 'ingesting_slow'
                ? '较慢，但仍在处理'
                : '入库失败',
          dateLabel: formatLibraryItemDate(item.updatedAt),
          coverImagePath: null,
          placeholderLabel: item.sourceKind === 'problem_bank' ? '题库' : '原始讲义',
          typeLabel: sourceUploadKindLabel(item.sourceKind),
          updatedAt: item.updatedAt,
          isProblemBank: item.sourceKind === 'problem_bank',
          status: item.status,
          error: item.error ?? null,
          sourceHash: null,
          textNotebookIds: [],
          textSectionIds: [],
          textBlocks: [],
        })),
    [activeSourceUploadItems],
  );

  const allSourceLibraryTiles = useMemo(
    () =>
      [...transientSourceUploadTiles, ...sourceLibraryTiles].filter(
        (tile) => tile.courseId === activeCourseId,
      ),
    [activeCourseId, sourceLibraryTiles, transientSourceUploadTiles],
  );

  const notebookLibraryTiles = useMemo<SourceLibraryTile[]>(() => {
    return notebooks
      .filter((notebook) => (notebook.courseId || activeCourseId) === activeCourseId)
      .map((notebook) => {
        const isMarkdown = (notebook.notebookKind ?? 'image') === 'markdown';
        const sectionCount = notebook.sectionCount || 0;
        return {
          id: `notebook-library-${notebook.id}`,
          courseId: notebook.courseId || activeCourseId || '',
          tileKind: 'notebook' as const,
          title: notebook.name,
          subtitle: `${sectionCount} 章节`,
          dateLabel: formatLibraryItemDate(notebook.updatedAt),
          coverImagePath: notebook.coverImagePath || null,
          placeholderLabel: 'NOTEBOOK',
          typeLabel: isMarkdown ? 'Markdown' : '讲义',
          updatedAt: notebook.updatedAt || 0,
          isProblemBank: false,
          status: null,
          error: null,
          sourceHash: null,
          textNotebookIds: isMarkdown ? [notebook.id] : [],
          textSectionIds: [],
          textBlocks: [],
        };
      })
      .sort(
        (left, right) =>
          right.updatedAt - left.updatedAt || left.title.localeCompare(right.title, 'zh-CN'),
      );
  }, [activeCourseId, notebooks]);

  const filteredNotebookLibraryTiles = useMemo(() => {
    const query = notebookLibraryQuery.trim().toLowerCase();
    if (!query) return notebookLibraryTiles;
    const terms = query.split(/\s+/).filter(Boolean);
    return notebookLibraryTiles.filter((tile) => {
      const haystack = [tile.title, tile.typeLabel, tile.subtitle].join('\n').toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [notebookLibraryQuery, notebookLibraryTiles]);

  const selectedNotebookLibraryTile = useMemo(
    () => notebookLibraryTiles.find((tile) => tile.id === selectedNotebookLibraryTileId) ?? null,
    [notebookLibraryTiles, selectedNotebookLibraryTileId],
  );
  const selectedNotebookLibraryId = selectedNotebookLibraryTile?.id.startsWith('notebook-library-')
    ? selectedNotebookLibraryTile.id.slice('notebook-library-'.length)
    : null;
  const selectedNotebookLibraryIsMarkdown = selectedNotebookLibraryTile?.typeLabel === 'Markdown';
  const selectedNotebookMarkdownPageState = selectedNotebookLibraryId
    ? notebookMarkdownPageCache[selectedNotebookLibraryId]
    : undefined;
  const selectedNotebookSectionId = selectedNotebookLibraryId
    ? selectedNotebookSectionIds[selectedNotebookLibraryId] ||
      selectedNotebookMarkdownPageState?.sections[0]?.id ||
      null
    : null;
  const selectedNotebookLibraryTextState =
    selectedNotebookLibraryId && selectedNotebookSectionId
      ? notebookMarkdownSectionCache[`${selectedNotebookLibraryId}:${selectedNotebookSectionId}`]
      : undefined;
  const selectedNotebookLibraryText = selectedNotebookLibraryTextState?.text.trim() || '';
  const selectedNotebookLibraryHasText = selectedNotebookLibraryText.length > 0;
  const selectedNotebookLibraryTextLoading =
    selectedNotebookLibraryTextState?.status === 'loading' ||
    (Boolean(selectedNotebookLibraryTile && selectedNotebookLibraryIsMarkdown) &&
      (selectedNotebookMarkdownPageState?.status === 'loading' ||
        !selectedNotebookMarkdownPageState ||
        (Boolean(selectedNotebookSectionId) && !selectedNotebookLibraryTextState)));
  const selectedNotebookImagePreviewState = selectedNotebookLibraryId
    ? notebookImagePreviewCache[selectedNotebookLibraryId]
    : undefined;
  const selectedNotebookImagePath =
    selectedNotebookLibraryTile?.coverImagePath ||
    selectedNotebookImagePreviewState?.imagePath ||
    null;
  const sourceLibraryResourceEntries: Array<{
    kind: CourseResourceKind;
    label: string;
    state: ResourceLoadState;
  }> = [
    { kind: 'sources', label: '原始讲义', state: sourcesLoadState },
    ...(notebooksHydrationWanted ||
    notebooksLoadState.status === 'loading' ||
    notebooksLoadState.status === 'ready' ||
    notebooksLoadState.status === 'empty' ||
    notebooksLoadState.status === 'error'
      ? [{ kind: 'notebooks' as const, label: '笔记本', state: notebooksLoadState }]
      : []),
  ];
  const sourceLibraryPendingEntries = sourceLibraryResourceEntries.filter(
    ({ state }) => state.status === 'idle' || state.status === 'loading',
  );
  const sourceLibraryFailedEntries = sourceLibraryResourceEntries.filter(
    ({ state }) => state.status === 'error',
  );
  const sourceLibraryStatusText = (() => {
    const parts: string[] = [];
    if (allSourceLibraryTiles.length > 0) {
      parts.push(
        sourceLibraryPendingEntries.length > 0 || sourceLibraryFailedEntries.length > 0
          ? `已显示 ${allSourceLibraryTiles.length} 个项目`
          : `${allSourceLibraryTiles.length} 个项目`,
      );
    }
    if (sourceLibraryPendingEntries.length > 0) {
      parts.push(`${sourceLibraryPendingEntries.map(({ label }) => label).join('、')}加载中`);
    }
    if (sourceLibraryFailedEntries.length > 0) {
      parts.push(`${sourceLibraryFailedEntries.map(({ label }) => label).join('、')}加载失败`);
    }
    return parts.length > 0 ? parts.join(' · ') : '0 个项目';
  })();

  const selectedSourceLibraryTile = useMemo(
    () => allSourceLibraryTiles.find((tile) => tile.id === selectedSourceLibraryTileId) ?? null,
    [allSourceLibraryTiles, selectedSourceLibraryTileId],
  );
  const selectedSourceLibraryTextState = selectedSourceLibraryTile
    ? sourceLibraryTextCache[selectedSourceLibraryTile.id]
    : undefined;

  const loadSourceLibraryTileText = useCallback((tile: SourceLibraryTile) => {
    const canLoadSourceText = Boolean(tile.tileKind === 'source' && tile.sourceHash);
    const canLoadNotebookText = tile.textNotebookIds.length > 0;
    if (!canLoadSourceText && !canLoadNotebookText) {
      setSourceLibraryTextCache((current) => ({
        ...current,
        [tile.id]: { status: 'empty', text: '' },
      }));
      return;
    }
    setSourceLibraryTextCache((current) => ({
      ...current,
      [tile.id]: { status: 'loading', text: '' },
    }));
    const textRequest =
      canLoadSourceText && tile.sourceHash
        ? getCourseSourceUploadText({
            courseId: tile.courseId,
            sourceHash: tile.sourceHash,
          }).then((source) => sourceLibraryTextFromBlocks(source.textSections))
        : loadBoundedNotebookMarkdownText(tile.textNotebookIds, tile.textSectionIds);

    void textRequest
      .then((text) => {
        setSourceLibraryTextCache((current) => ({
          ...current,
          [tile.id]: {
            status: text ? 'ready' : 'empty',
            text,
          },
        }));
      })
      .catch((error) => {
        setSourceLibraryTextCache((current) => ({
          ...current,
          [tile.id]: {
            status: 'failed',
            text: '',
            error: error instanceof Error ? error.message : '文本读取失败',
          },
        }));
      });
  }, []);

  const loadNotebookMarkdownPageForPopup = useCallback(
    async (notebookId: string, loadMore = false, force = false) => {
      const current = notebookMarkdownPageCache[notebookId];
      if (
        (!loadMore &&
          (current?.status === 'ready' ||
            current?.status === 'loading' ||
            (!force && current?.status === 'failed'))) ||
        (loadMore && (!current?.hasMore || !current.nextCursor || current.loadingMore))
      ) {
        return;
      }
      setNotebookMarkdownPageCache((cache) => ({
        ...cache,
        [notebookId]: loadMore
          ? { ...current, status: current?.status || 'loading', loadingMore: true }
          : {
              status: 'loading',
              sections: current?.sections || [],
              hasMore: current?.hasMore || false,
              nextCursor: current?.nextCursor || null,
            },
      }));
      try {
        const result = await loadNotebookMarkdownSectionPage(
          notebookId,
          loadMore ? current?.nextCursor : null,
        );
        const sections = loadMore
          ? Array.from(
              new Map(
                [...(current?.sections || []), ...result.sections].map((section) => [
                  section.id,
                  section,
                ]),
              ).values(),
            )
          : result.sections;
        setNotebookMarkdownPageCache((cache) => ({
          ...cache,
          [notebookId]: {
            status: 'ready',
            sections,
            hasMore: result.page.hasMore,
            nextCursor: result.page.nextCursor,
          },
        }));
        if (sections[0]) {
          setSelectedNotebookSectionIds((selected) =>
            selected[notebookId] ? selected : { ...selected, [notebookId]: sections[0].id },
          );
        }
      } catch (error) {
        setNotebookMarkdownPageCache((cache) => ({
          ...cache,
          [notebookId]: {
            status: 'failed',
            sections: current?.sections || [],
            hasMore: current?.hasMore || false,
            nextCursor: current?.nextCursor || null,
            error: error instanceof Error ? error.message : '章节列表读取失败',
          },
        }));
      }
    },
    [notebookMarkdownPageCache],
  );

  const loadNotebookMarkdownSectionForPopup = useCallback(
    async (notebookId: string, sectionId: string, force = false) => {
      const cacheKey = `${notebookId}:${sectionId}`;
      const current = notebookMarkdownSectionCache[cacheKey];
      if (
        current?.status === 'ready' ||
        current?.status === 'loading' ||
        (!force && current?.status === 'failed')
      ) {
        return;
      }
      setNotebookMarkdownSectionCache((cache) => ({
        ...cache,
        [cacheKey]: { status: 'loading', text: '' },
      }));
      try {
        const result = await loadNotebookMarkdownSectionDetail(notebookId, sectionId);
        const text = result.section.markdown.trim();
        setNotebookMarkdownSectionCache((cache) => ({
          ...cache,
          [cacheKey]: { status: text ? 'ready' : 'empty', text },
        }));
      } catch (error) {
        setNotebookMarkdownSectionCache((cache) => ({
          ...cache,
          [cacheKey]: {
            status: 'failed',
            text: '',
            error: error instanceof Error ? error.message : '章节正文读取失败',
          },
        }));
      }
    },
    [notebookMarkdownSectionCache],
  );

  const loadNotebookImagePreviewForPopup = useCallback(
    async (notebookId: string, coverImagePath: string | null) => {
      const current = notebookImagePreviewCache[notebookId];
      if (
        current?.status === 'ready' ||
        current?.status === 'loading' ||
        current?.status === 'failed'
      ) {
        return;
      }
      if (coverImagePath) {
        setNotebookImagePreviewCache((cache) => ({
          ...cache,
          [notebookId]: { status: 'ready', imagePath: coverImagePath },
        }));
        return;
      }
      setNotebookImagePreviewCache((cache) => ({
        ...cache,
        [notebookId]: { status: 'loading', imagePath: null },
      }));
      try {
        const slides = await getFirstSlideByStages([notebookId]);
        const imagePath = firstSlidePreviewImage(slides[notebookId]);
        setNotebookImagePreviewCache((cache) => ({
          ...cache,
          [notebookId]: {
            status: imagePath ? 'ready' : 'empty',
            imagePath,
          },
        }));
      } catch (error) {
        setNotebookImagePreviewCache((cache) => ({
          ...cache,
          [notebookId]: {
            status: 'failed',
            imagePath: null,
            error: error instanceof Error ? error.message : '封面预览读取失败',
          },
        }));
      }
    },
    [notebookImagePreviewCache],
  );

  useEffect(() => {
    if (!notebookLibraryPanelOpen || !selectedNotebookLibraryTile || !selectedNotebookLibraryId) {
      return;
    }
    if (selectedNotebookLibraryIsMarkdown) {
      void loadNotebookMarkdownPageForPopup(selectedNotebookLibraryId);
      return;
    }
    void loadNotebookImagePreviewForPopup(
      selectedNotebookLibraryId,
      selectedNotebookLibraryTile.coverImagePath,
    );
  }, [
    loadNotebookImagePreviewForPopup,
    loadNotebookMarkdownPageForPopup,
    notebookLibraryPanelOpen,
    selectedNotebookLibraryId,
    selectedNotebookLibraryIsMarkdown,
    selectedNotebookLibraryTile,
  ]);

  useEffect(() => {
    if (
      !notebookLibraryPanelOpen ||
      !selectedNotebookLibraryIsMarkdown ||
      !selectedNotebookLibraryId ||
      !selectedNotebookSectionId
    ) {
      return;
    }
    void loadNotebookMarkdownSectionForPopup(selectedNotebookLibraryId, selectedNotebookSectionId);
  }, [
    loadNotebookMarkdownSectionForPopup,
    notebookLibraryPanelOpen,
    selectedNotebookLibraryId,
    selectedNotebookLibraryIsMarkdown,
    selectedNotebookSectionId,
  ]);

  useEffect(() => {
    if (
      !selectedSourceLibraryTileId?.startsWith('notebook-') ||
      selectedSourceLibraryTile ||
      sourcesLoadState.status === 'idle' ||
      sourcesLoadState.status === 'loading'
    ) {
      return;
    }
    const notebookId = selectedSourceLibraryTileId.slice('notebook-'.length);
    const replacement = allSourceLibraryTiles.find(
      (tile) => tile.tileKind === 'source' && tile.textNotebookIds.includes(notebookId),
    );
    if (!replacement) return;
    setSelectedSourceLibraryTileId(replacement.id);
    const preloadedText = sourceLibraryTextFromBlocks(replacement.textBlocks);
    if (preloadedText) {
      setSourceLibraryTextCache((current) => ({
        ...current,
        [replacement.id]: { status: 'ready', text: preloadedText },
      }));
    } else {
      loadSourceLibraryTileText(replacement);
    }
  }, [
    allSourceLibraryTiles,
    loadSourceLibraryTileText,
    selectedSourceLibraryTile,
    selectedSourceLibraryTileId,
    sourcesLoadState.status,
  ]);

  const selectedSourceLibraryHasImage = Boolean(selectedSourceLibraryTile?.coverImagePath);
  const selectedSourceLibraryPreloadedText = selectedSourceLibraryTile
    ? sourceLibraryTextFromBlocks(selectedSourceLibraryTile.textBlocks)
    : '';
  const selectedSourceLibraryText =
    selectedSourceLibraryPreloadedText.trim() || selectedSourceLibraryTextState?.text.trim() || '';
  const selectedSourceLibraryHasText =
    Boolean(selectedSourceLibraryPreloadedText.trim()) ||
    (selectedSourceLibraryTextState?.status === 'ready' && selectedSourceLibraryText.length > 0);
  const selectedSourceLibraryTextResolved =
    selectedSourceLibraryTextState?.status === 'empty' ||
    selectedSourceLibraryTextState?.status === 'failed';
  const selectedSourceLibraryTextLoading =
    selectedSourceLibraryTextState?.status === 'loading' ||
    (Boolean(
      selectedSourceLibraryTile?.sourceHash || selectedSourceLibraryTile?.textNotebookIds.length,
    ) &&
      !selectedSourceLibraryTile?.textBlocks.length &&
      !selectedSourceLibraryTextState);
  const showSourceLibraryViewSwitch = selectedSourceLibraryHasImage && selectedSourceLibraryHasText;
  const effectiveSourceLibraryDetailView: SourceLibraryDetailView = showSourceLibraryViewSwitch
    ? sourceLibraryDetailView
    : selectedSourceLibraryHasText ||
        selectedSourceLibraryTextResolved ||
        selectedSourceLibraryTextLoading ||
        !selectedSourceLibraryHasImage
      ? 'text'
      : 'image';

  const handleDeleteSourceLibraryTile = useCallback(
    async (tile: SourceLibraryTile) => {
      if (
        !activeCourse?.id ||
        !activeCourseIsOwner ||
        tile.courseId !== activeCourse.id ||
        !tile.sourceHash
      )
        return;
      const sourceHash = tile.sourceHash;
      if (deletingSourceHashes.includes(sourceHash)) return;
      const confirmed = window.confirm(
        `确定删除“${tile.title}”吗？\n\n这会删除这份原始讲义生成的正文、笔记本、专属记忆和索引记录；课程题库会完整保留。`,
      );
      if (!confirmed) return;

      setDeletingSourceHashes((current) =>
        current.includes(sourceHash) ? current : [...current, sourceHash],
      );
      try {
        await deleteCourseSourceUpload({
          courseId: activeCourse.id,
          sourceHash,
        });
        setCourseSourceUploads((current) =>
          current.filter(
            (upload) => upload.courseId !== activeCourse.id || upload.sourceHash !== sourceHash,
          ),
        );
        setSourceLibraryTextCache((current) => {
          const next = { ...current };
          delete next[tile.id];
          return next;
        });
        if (selectedSourceLibraryTileId === tile.id) {
          setSelectedSourceLibraryTileId(null);
          setSourceLibraryDetailView('image');
          setSourceLibraryImageExpanded(false);
        }
        const cachedAssets = courseAssetCacheRef.current.get(activeCourse.id) ?? {};
        courseAssetCacheRef.current.set(activeCourse.id, {
          ...cachedAssets,
          sourceUploads: (cachedAssets.sourceUploads ?? activeCourseSourceUploads).filter(
            (upload) => upload.sourceHash !== sourceHash,
          ),
        });
        setResourceLoadAttempts((current) => ({
          notebooks: current.notebooks + 1,
          problems: current.problems + 1,
          sources: current.sources + 1,
        }));
        markCourseContentMutation(activeCourse.id);
        toast.success('已删除原始讲义及相关记录');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '删除原始讲义失败');
      } finally {
        setDeletingSourceHashes((current) => current.filter((hash) => hash !== sourceHash));
      }
    },
    [
      activeCourse?.id,
      activeCourseIsOwner,
      activeCourseSourceUploads,
      deletingSourceHashes,
      markCourseContentMutation,
      selectedSourceLibraryTileId,
    ],
  );

  const handleRetrySourceIndex = useCallback(
    async (tile: SourceLibraryTile) => {
      if (
        !activeCourse?.id ||
        !activeCourseIsOwner ||
        tile.courseId !== activeCourse.id ||
        !tile.sourceHash
      )
        return;
      const sourceHash = tile.sourceHash;
      if (reindexingSourceHashes.includes(sourceHash)) return;

      setReindexingSourceHashes((current) =>
        current.includes(sourceHash) ? current : [...current, sourceHash],
      );
      try {
        await retryCourseSourceIndex({
          courseId: activeCourse.id,
          sourceHash,
        });
        const updatedAt = new Date().toISOString();
        setCourseSourceUploads((current) =>
          current.map((upload) =>
            upload.courseId === activeCourse.id && upload.sourceHash === sourceHash
              ? { ...upload, indexStatus: 'indexing', errorReason: null, updatedAt }
              : upload,
          ),
        );
        const cachedAssets = courseAssetCacheRef.current.get(activeCourse.id);
        if (cachedAssets?.sourceUploads) {
          courseAssetCacheRef.current.set(activeCourse.id, {
            ...cachedAssets,
            sourceUploads: cachedAssets.sourceUploads.map((upload) =>
              upload.sourceHash === sourceHash
                ? { ...upload, indexStatus: 'indexing', errorReason: null, updatedAt }
                : upload,
            ),
          });
        }
        retryCourseResource('sources');
        markCourseContentMutation(activeCourse.id);
        toast.success('已重新提交 AI 索引');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '重新索引失败');
      } finally {
        setReindexingSourceHashes((current) => current.filter((hash) => hash !== sourceHash));
      }
    },
    [
      activeCourse?.id,
      activeCourseIsOwner,
      markCourseContentMutation,
      reindexingSourceHashes,
      retryCourseResource,
    ],
  );

  const requestedCourseExists = Boolean(
    urlCourseId && courses.some((course) => course.id === urlCourseId),
  );
  const resolvingActiveCourse =
    coursesLoadState === 'ready' && requestedCourseExists && !activeCourse;
  const requestedCourseUnavailable =
    coursesLoadState === 'ready' && Boolean(urlCourseId) && !requestedCourseExists;
  const remoteConversationError = remoteConversationLoadError || remoteConversationSyncError;
  const courseSurfaceStatus: LearnSurfaceStatusItem = courseLoadError
    ? {
        key: 'course',
        label: '课程',
        status: activeCourse && isUsefulCourseShellName(activeCourse.name) ? 'local' : 'error',
        statusLabel:
          activeCourse && isUsefulCourseShellName(activeCourse.name) ? '缓存可用' : '加载失败',
        detail: courseLoadError,
      }
    : isProvisionalCourseShell(activeCourse)
      ? {
          key: 'course',
          label: '课程',
          status: 'loading',
          statusLabel: '信息同步中',
        }
      : {
          key: 'course',
          label: '课程',
          status: 'ready',
          statusLabel: '已就绪',
        };
  const conversationSurfaceStatus: LearnSurfaceStatusItem = !conversationInteractive
    ? {
        key: 'conversation',
        label: '对话',
        status: 'loading',
        statusLabel: '会话加载中',
      }
    : remoteConversationError
      ? {
          key: 'conversation',
          label: '对话',
          status: 'error',
          statusLabel: '同步异常',
          detail: remoteConversationError,
        }
      : remoteConversationReadyKey === activeMessageStoreKey
        ? {
            key: 'conversation',
            label: '对话',
            status: 'ready',
            statusLabel: '已同步',
          }
        : {
            key: 'conversation',
            label: '对话',
            status: 'loading',
            statusLabel: '云同步中',
          };
  const activeCourseContentState =
    activeCourse?.id && courseContentStateRevision.startsWith(`${activeCourse.id}:`)
      ? courseContentStateRef.current.get(activeCourse.id)
      : null;
  const contentStateReady = Boolean(activeCourseContentState);
  const notebookSurfaceStatus: LearnSurfaceStatusItem = {
    key: 'notebooks',
    label: '笔记本',
    ...resourceSurfaceStatusFromContentOrList({
      activeCourseId,
      listState: notebooksLoadState,
      content: activeCourseContentState?.notebooks,
      contentReady: contentStateReady,
      listHydrationWanted: notebooksHydrationWanted,
      deferredWhenListIdle: true,
    }),
  };
  const learnSurfaceStatusItems: LearnSurfaceStatusItem[] = [
    courseSurfaceStatus,
    conversationSurfaceStatus,
    notebookSurfaceStatus,
    isTeacherCourseChat
      ? {
          key: 'teacher-agent',
          label: '智能体',
          status: 'ready',
          statusLabel: '教师只读模式',
          detail: '只读取笔记本和 Hard Rule，不读取题库，也不写入学生学习状态。',
        }
      : {
          key: 'student-agent',
          label: '智能体',
          status: 'ready',
          statusLabel: '课程助理已就绪',
          detail: '只读取当前进度开放的笔记本和 Hard Rule；日历变更必须经你确认。',
        },
  ];
  // Students consume the teacher-published notebook projection and cannot read
  // or repair the teacher's private source catalog. Keep source-ingest/index
  // health actionable by showing it only in the teacher course-chat surface.
  const activeCourseSourceHealthNotice = isTeacherCourseChat
    ? courseSourceHealthNotice(activeCourseContentState?.sources)
    : null;
  const activeCourseContentWatchError =
    courseContentWatchError && courseContentWatchError.courseId === activeCourse?.id
      ? courseContentWatchError.message
      : null;
  const resourceErrorItems = [{ label: '笔记本', state: notebooksLoadState }].filter(
    (item): item is { label: string; state: ResourceLoadState & { error: string } } =>
      item.state.status === 'error' && Boolean(item.state.error),
  );
  const hasCourseSyncError = Boolean(
    activeCourse &&
    (courseLoadError ||
      remoteConversationError ||
      activeCourseContentWatchError ||
      resourceErrorItems.length > 0),
  );
  const courseSyncUsesLocalFallback = Boolean(
    activeCourse &&
    conversationFallbackActive &&
    !courseLoadError &&
    !activeCourseContentWatchError &&
    resourceErrorItems.length === 0,
  );
  const courseSyncErrorTitle = [
    courseLoadError,
    remoteConversationError,
    activeCourseContentWatchError ? `课程内容监听：${activeCourseContentWatchError}` : null,
    ...resourceErrorItems.map((item) => `${item.label}：${item.state.error}`),
  ]
    .filter(Boolean)
    .join('\n');
  const retryFailedCourseContent = () => {
    if (courseLoadError) setCourseLoadAttempt((current) => current + 1);
    if (remoteConversationLoadError) {
      setRemoteConversationLoadAttempt((current) => current + 1);
    } else if (remoteConversationSyncError) {
      setRemoteConversationSyncAttempt((current) => current + 1);
    }
    if (notebooksLoadState.status === 'error') retryCourseResource('notebooks');
    if (activeCourseContentWatchError) {
      setCourseContentWatchAttempt((current) => current + 1);
    }
  };

  if (
    !showLearnHomeDashboard &&
    (!hydrated ||
      coursesLoadState === 'idle' ||
      coursesLoadState === 'loading' ||
      resolvingActiveCourse)
  ) {
    return <LearnPageShellSkeleton loadingLabel="正在加载当前课程与会话…" />;
  }

  if (!showLearnHomeDashboard && coursesLoadState === 'error') {
    return (
      <LearnPageShellSkeleton
        error={courseLoadError || '课程加载失败，服务端没有返回可用的错误原因。'}
        onRetry={() => setCourseLoadAttempt((current) => current + 1)}
      />
    );
  }

  if (requestedCourseUnavailable) {
    return (
      <div className="grid h-full min-h-[70dvh] place-items-center bg-slate-50 px-6 text-center dark:bg-slate-950">
        <div className="max-w-sm">
          <BookOpenCheck className="mx-auto size-8 text-slate-400" strokeWidth={1.6} />
          <h1 className="mt-4 text-lg font-semibold text-slate-950 dark:text-slate-50">
            无法打开这门课程
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            {courseLoadError ||
              '这门课程不存在，或当前账号没有访问权限。学习空间不会改为展示其他课程。'}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-5 rounded-full px-5"
            onClick={() => setCourseLoadAttempt((current) => current + 1)}
          >
            <RefreshCw className="size-4" />
            重试
          </Button>
          <Button asChild className="mt-5 rounded-full px-5">
            <Link href="/learn">返回课程首页</Link>
          </Button>
        </div>
      </div>
    );
  }

  const rightRailCardClassName =
    'rounded-[13px] border border-slate-200/80 bg-white/[0.94] shadow-[0_5px_16px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-slate-950/[0.88]';
  const rightRailRowClassName =
    'rounded-[10px] border border-slate-200/70 bg-white px-3 py-2 dark:border-white/[0.08] dark:bg-white/5';
  const rightRailSectionTitleClassName =
    'text-[13px] font-semibold leading-5 text-slate-700 dark:text-slate-200';
  const rightRailSectionIconClassName = 'size-3.5 text-slate-400 dark:text-slate-500';
  const rightRailIconButtonClassName =
    'grid size-8 shrink-0 place-items-center rounded-full bg-white/75 text-slate-500 shadow-sm ring-1 ring-slate-200/80 transition hover:bg-white hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-100 dark:bg-white/5 dark:text-slate-400 dark:ring-white/10 dark:hover:bg-white/10 dark:hover:text-slate-100 dark:focus-visible:ring-sky-300/20';

  const learningCalendarPanel = (
    <section className={cn(rightRailCardClassName, 'w-full p-3')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-muted-foreground" strokeWidth={1.8} />
            <p className="text-sm font-semibold text-foreground">
              {isResearchCourse ? '研究日历' : '学习日历'}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{calendarMonthLabel}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 rounded-full border-border bg-background px-3 text-xs shadow-sm"
          onClick={openManualScheduleDialog}
        >
          <Plus className="size-3.5" strokeWidth={1.9} />
          添加日程
        </Button>
      </div>

      {calendarLoading && !syllabusEvents.length ? (
        <p className="mt-3 flex items-center gap-2 rounded-[12px] bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700 dark:bg-sky-400/10 dark:text-sky-100">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          正在加载课程日历…
        </p>
      ) : null}
      {calendarLoadError ? (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-[12px] bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-400/10 dark:text-rose-100">
          <span className="min-w-0 truncate">{calendarLoadError}</span>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 font-semibold"
            onClick={() => void reloadCalendarEvents().catch(() => undefined)}
          >
            <RefreshCw className="size-3" aria-hidden="true" />
            重试
          </button>
        </div>
      ) : null}
      {calendarEventsTruncated ? (
        <p className="mt-3 rounded-[12px] bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-400/10 dark:text-amber-100">
          当前窗口事项超过 120 项，建议缩小查询范围。
        </p>
      ) : null}

      <button
        type="button"
        className="mt-3 block w-full rounded-[16px] border border-slate-200/80 bg-white p-3 text-left shadow-sm transition hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={() => setCalendarDialogOpen(true)}
        aria-label="打开大日历"
        title="打开大日历"
      >
        <div className="grid grid-cols-7 gap-1 text-center">
          {calendarWeekdays.map((day) => (
            <span
              key={day}
              className="mb-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500"
            >
              {day}
            </span>
          ))}
          {calendarDays.map((day) => (
            <div
              key={day.key}
              className={cn(
                'relative grid aspect-square place-items-center rounded-full text-[11px] font-semibold',
                day.inMonth ? 'text-slate-700' : 'text-slate-300',
                day.isToday ? 'bg-[#ff3b30] text-white' : null,
                (day.planCount || day.syllabusCount) && !day.isToday
                  ? 'ring-1 ring-slate-200'
                  : null,
              )}
              title={[
                day.planCount ? `${day.planCount} 个学习计划` : '',
                day.syllabusCount
                  ? `${day.syllabusCount} 个${isResearchCourse ? '研究日程' : 'syllabus 事项'}`
                  : '',
              ]
                .filter(Boolean)
                .join('，')}
            >
              {day.day}
              {day.planCount || day.syllabusCount ? (
                <span className="absolute bottom-0.5 flex items-center gap-0.5">
                  {day.planCount ? (
                    <span
                      className={cn(
                        'size-1 rounded-full',
                        day.isToday ? 'bg-white' : 'bg-emerald-500',
                      )}
                    />
                  ) : null}
                  {day.syllabusCount ? (
                    <span
                      className={cn('size-1 rounded-full', day.isToday ? 'bg-white' : 'bg-sky-500')}
                    />
                  ) : null}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </button>
    </section>
  );

  const practicePopupDialog = (
    <Dialog
      open={Boolean(activePracticeSession && activePracticePlan)}
      onOpenChange={handlePracticePopupOpenChange}
    >
      <DialogContent
        showCloseButton={false}
        overlayClassName={SYNTARA_WORKSPACE_DIALOG_OVERLAY_CLASS}
        className={cn(
          SYNTARA_WORKSPACE_DIALOG_CONTENT_CLASS,
          'h-[min(860px,92dvh)] max-w-[1320px] bg-[#f5f5f5] dark:bg-slate-950',
        )}
      >
        <DialogHeader className="relative shrink-0 border-b border-border/80 bg-background/95 px-4 py-3 text-left backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="关闭"
              aria-label="关闭做题弹窗"
              className="h-9 w-9 shrink-0 rounded-full border border-slate-200 bg-white p-0 text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
              onClick={() => handlePracticePopupOpenChange(false)}
            >
              <X className="size-3.5" />
              <span className="sr-only">关闭</span>
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <DialogTitle className="min-w-0 truncate text-[15px] font-semibold leading-5">
                {activePracticePlan?.title ?? '题库练习'}
              </DialogTitle>
              {practicePopupCurrentQuestionLabel ? (
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  {practicePopupCurrentQuestionLabel}
                </span>
              ) : null}
              <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">
                已完成 {practicePopupCompletedCount}/{practicePopupTotalCount || 0}
              </span>
              {practicePopupStatusParts.length > 0 ? (
                <span className="hidden shrink-0 items-center gap-1 md:inline-flex">
                  {practicePopupStatusParts.map((item) => (
                    <span
                      key={item.label}
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[11px] font-medium ring-1',
                        item.className,
                      )}
                    >
                      {item.label}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
                  还没提交答案
                </span>
              )}
              <DialogDescription className="sr-only">
                已完成 {practicePopupCompletedCount}/{practicePopupTotalCount || 0}
              </DialogDescription>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePracticeAiHelpHeaderClick}
                disabled={
                  !activePracticeSummary?.currentProblemId ||
                  currentPracticeProblemHelpLoading ||
                  !practiceHeaderState ||
                  (!practiceHeaderState.problemContent && !currentPracticeProblemHelpSessionId)
                }
                className={cn(
                  'h-8 gap-1.5 rounded-full px-3 text-xs font-semibold',
                  currentPracticeProblemHelpTabVisible
                    ? 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-300/25 dark:bg-sky-300/10 dark:text-sky-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10',
                )}
              >
                {currentPracticeProblemHelpLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Brain className="size-3.5" />
                )}
                {practiceAiHelpHeaderLabel}
              </Button>
              <div className="flex items-center gap-1 rounded-full border border-border bg-background p-1 shadow-sm">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 rounded-full px-2.5 text-xs"
                  disabled={!practiceHeaderState || practiceHeaderState.previousDisabled}
                  title={practiceHeaderState?.previousTitle ?? '没有上一题'}
                  onClick={() => practiceHeaderState?.onPrevious?.()}
                >
                  <ChevronLeft className="size-3.5" />
                  {practiceHeaderState?.previousLabel ?? '上一题'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 rounded-full px-2.5 text-xs"
                  disabled={!practiceHeaderState || practiceHeaderState.nextDisabled}
                  title={practiceHeaderState?.nextTitle ?? '没有下一题'}
                  onClick={() => practiceHeaderState?.onNext?.()}
                >
                  {practiceHeaderState?.nextLabel ?? '下一题'}
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-[width] duration-300"
              style={{ width: `${practicePopupProgressPercent}%` }}
            />
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          {activePracticeSession && activePracticePlan ? (
            <CourseProblemBankView
              key={activePracticeSession.id}
              courseId={activePracticeSession.courseId}
              initialProblemId={
                activePracticeSession.currentProblemId || activePracticeProblemIds[0]
              }
              mode="practice"
              practiceBackLabel="关闭"
              practiceHeaderPlacement="external"
              practiceProblemIds={activePracticeProblemIds}
              initialPracticeAnswers={activePracticeAnswers}
              onPracticeBack={() => handlePracticePopupOpenChange(false)}
              onPracticeHeaderStateChange={handlePracticeHeaderStateChange}
              onPracticeProblemChange={handlePracticeProblemChange}
              onPracticeAnswerDraftChange={handlePracticeAnswerDraftChange}
              onPracticeAttemptResolved={handlePracticeAttemptResolved}
              practiceAiHelp={
                currentPracticeProblemHelpTabVisible
                  ? {
                      state: currentPracticeProblemHelp,
                      hasHelp: currentPracticeProblemHasAiHelp,
                      active: currentPracticeProblemHelpTabActive,
                      onActiveChange: setPracticeProblemHelpTabActive,
                    }
                  : undefined
              }
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );

  const syllabusImportDialog = canManageCourseContent ? (
    <LearnWorkspaceDialog
      open={syllabusDialogOpen}
      onOpenChange={setSyllabusDialogOpen}
      title="添加课程日程"
      description="先读取 syllabus，再检查、修改或移除事项；确认后才会写入日历。"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-border px-5 py-4 text-left">
          <h2 className="text-base font-semibold text-foreground">添加课程日程</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            先读取 syllabus，再检查、修改或移除事项；确认后才会写入日历。
          </p>
        </div>
        <input
          ref={syllabusInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.json,application/pdf,image/png,image/jpeg,image/webp,image/gif,text/*"
          className="hidden"
          onChange={(event) => {
            void handleSyllabusFile(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[360px_1fr]">
          <aside className="min-h-0 border-b border-border/70 bg-muted/25 p-4 lg:border-b-0 lg:border-r">
            <div className="grid grid-cols-2 rounded-full bg-muted p-1 text-sm font-medium">
              {[
                { value: 'file' as const, label: '上传文件' },
                { value: 'plan' as const, label: '描述计划' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setSyllabusImportMode(item.value)}
                  className={cn(
                    'h-9 rounded-full transition',
                    syllabusImportMode === item.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {syllabusImportMessage ? (
              <p
                className={cn(
                  rightRailRowClassName,
                  'mt-4 text-xs leading-5 text-muted-foreground',
                )}
              >
                {syllabusImportMessage}
              </p>
            ) : null}

            {syllabusImportMode === 'file' ? (
              <section className="mt-4 rounded-[18px] border border-border/70 bg-background p-4">
                <div className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
                  {syllabusImportLoading ? (
                    <Loader2 className="size-5 animate-spin" strokeWidth={1.8} />
                  ) : (
                    <FileText className="size-5" strokeWidth={1.8} />
                  )}
                </div>
                <p className="mt-3 text-sm font-semibold text-foreground">
                  {syllabusImportLoading ? '正在读取 syllabus' : '上传 syllabus 文件'}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  支持 syllabus 图片、扫描件、PDF 与文本；AI 识别后会先显示可编辑预览。
                </p>
                <Button
                  type="button"
                  className="mt-4 h-9 rounded-full px-4 text-sm"
                  onClick={() => syllabusInputRef.current?.click()}
                  disabled={syllabusImportLoading}
                >
                  {syllabusImportLoading ? '读取中...' : '选择文件'}
                </Button>
              </section>
            ) : (
              <section className="mt-4 rounded-[18px] border border-border/70 bg-background p-4">
                <div className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
                  <CalendarDays className="size-5" strokeWidth={1.8} />
                </div>
                <p className="mt-3 text-sm font-semibold text-foreground">描述你的学习计划</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  没有 syllabus 文件时，可以先描述节奏，我会生成可确认的模拟日程。
                </p>
                <Textarea
                  value={syllabusPlanDraft}
                  onChange={(event) => setSyllabusPlanDraft(event.target.value)}
                  placeholder="例如：我想 8 周学完，每周学习 3 次，有一次期中和一次期末。"
                  className="mt-4 min-h-32 resize-none rounded-[16px] border-border bg-muted/30 text-sm shadow-none focus-visible:ring-1"
                />
                <Button
                  type="button"
                  className="mt-4 h-9 rounded-full px-4 text-sm"
                  onClick={handleSimulateSyllabus}
                  disabled={!activeCourse}
                >
                  生成预览
                </Button>
              </section>
            )}

            <div
              className={cn(rightRailRowClassName, 'mt-4 text-xs leading-5 text-muted-foreground')}
            >
              {syllabusCommitMode === 'replace'
                ? '确认后会替换当前已保存的 syllabus 日程。'
                : '确认后会和当前已保存的 syllabus 日程合并。'}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col bg-background">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">确认添加</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {syllabusDraftEvents.length
                    ? `${syllabusDraftEvents.length} 个待确认事项`
                    : '上传或生成后，这里会显示可编辑的日程预览'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 rounded-full px-3 text-xs"
                onClick={addSyllabusDraftEvent}
                disabled={syllabusImportLoading}
              >
                添加事项
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {syllabusImportLoading ? (
                <div className="grid h-full place-items-center rounded-[22px] border border-dashed border-border bg-muted/20 text-center">
                  <div>
                    <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
                    <p className="mt-3 text-sm font-medium text-foreground">正在读取文件</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      读取完成后会显示可编辑的 syllabus 事项。
                    </p>
                  </div>
                </div>
              ) : syllabusDraftEvents.length ? (
                <div className="space-y-3">
                  {syllabusDraftEvents.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-[18px] border border-border/70 bg-background p-3 shadow-sm"
                    >
                      <div className="grid gap-2 lg:grid-cols-[140px_130px_1fr_32px]">
                        <input
                          type="date"
                          value={event.date}
                          onChange={(changeEvent) =>
                            updateSyllabusDraftEvent(event.id, {
                              date: changeEvent.currentTarget.value,
                            })
                          }
                          className="h-9 rounded-full border border-border bg-muted/30 px-3 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                        />
                        <select
                          value={event.kind}
                          onChange={(changeEvent) =>
                            updateSyllabusDraftEvent(event.id, {
                              kind: changeEvent.currentTarget.value as SyllabusEventKind,
                            })
                          }
                          className="h-9 rounded-full border border-border bg-muted/30 px-3 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                        >
                          {manualScheduleKindOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <input
                          value={event.title}
                          onChange={(changeEvent) =>
                            updateSyllabusDraftEvent(event.id, {
                              title: changeEvent.currentTarget.value,
                            })
                          }
                          placeholder="事项标题"
                          className="h-9 min-w-0 rounded-full border border-border bg-muted/30 px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-9 rounded-full text-muted-foreground hover:text-destructive"
                          onClick={() => removeSyllabusDraftEvent(event.id)}
                          aria-label="移除事项"
                          title="移除事项"
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                        {event.week ? (
                          <span className="rounded-full bg-muted px-2 py-0.5">{event.week}</span>
                        ) : null}
                        {event.sourceColumn ? (
                          <span className="rounded-full bg-muted px-2 py-0.5">
                            {event.sourceColumn}
                          </span>
                        ) : null}
                        {event.confidence != null ? (
                          <span className="rounded-full bg-muted px-2 py-0.5">
                            置信度 {Math.round(event.confidence * 100)}%
                          </span>
                        ) : null}
                        {event.rawText ? (
                          <span className="min-w-0 truncate rounded-full bg-muted px-2 py-0.5">
                            {event.rawText}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid h-full place-items-center rounded-[22px] border border-dashed border-border bg-muted/20 text-center">
                  <div>
                    <UploadCloud className="mx-auto size-7 text-muted-foreground" />
                    <p className="mt-3 text-sm font-medium text-foreground">还没有待确认的事项</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      选择 syllabus 文件，或描述学习计划生成预览。
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/70 px-5 py-4">
              <p className="min-w-0 text-xs text-muted-foreground">
                {validSyllabusDraftEvents.length
                  ? `${validSyllabusDraftEvents.length} 个有效事项会被写入日历`
                  : '确认前请至少保留一个有效事项'}
              </p>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-full px-4 text-sm"
                  onClick={() => setSyllabusDialogOpen(false)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  className="h-9 rounded-full px-4 text-sm"
                  onClick={() => void confirmSyllabusDraftEvents()}
                  disabled={
                    syllabusImportLoading || calendarMutating || !validSyllabusDraftEvents.length
                  }
                >
                  {syllabusImportLoading || calendarMutating
                    ? '同步中…'
                    : syllabusCommitMode === 'replace'
                      ? '确认保存'
                      : '确认添加'}
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </LearnWorkspaceDialog>
  ) : null;

  const manualScheduleDialog = (
    <Dialog
      open={manualScheduleDialogOpen}
      onOpenChange={(open) => {
        if (calendarMutating) return;
        setManualScheduleDialogOpen(open);
        if (!open) setManualScheduleError(null);
      }}
    >
      <DialogContent className={cn(SYNTARA_ACTION_DIALOG_CONTENT_CLASS, 'max-w-[480px] p-0')}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void confirmManualScheduleEvent();
          }}
        >
          <DialogHeader className={SYNTARA_DIALOG_HEADER_CLASS}>
            <DialogTitle className="text-base">添加日程</DialogTitle>
            <DialogDescription className="text-xs leading-5 text-muted-foreground">
              {isResearchCourse
                ? '手动补充一条会议、DDL、实验节点或研究提醒。'
                : '手动补充一条作业、考试、课程进度或提醒。'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-5 py-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">标题</span>
              <input
                value={manualScheduleTitle}
                onChange={(event) => {
                  setManualScheduleTitle(event.currentTarget.value);
                  setManualScheduleError(null);
                }}
                placeholder={isResearchCourse ? '例如：完成消融实验' : '例如：Assignment 2 截止'}
                className="h-10 w-full rounded-[14px] border border-border bg-muted/30 px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/20"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground">日期</span>
                <input
                  type="date"
                  value={manualScheduleDate}
                  onChange={(event) => {
                    setManualScheduleDate(event.currentTarget.value);
                    setManualScheduleError(null);
                  }}
                  className="h-10 w-full rounded-[14px] border border-border bg-muted/30 px-3 text-sm text-foreground outline-none transition focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/20"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground">类型</span>
                <select
                  value={manualScheduleKind}
                  onChange={(event) =>
                    setManualScheduleKind(event.currentTarget.value as SyllabusEventKind)
                  }
                  className="h-10 w-full rounded-[14px] border border-border bg-muted/30 px-3 text-sm text-foreground outline-none transition focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/20"
                >
                  {manualScheduleKindOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {manualScheduleError ? (
              <p className="rounded-[14px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700 dark:border-rose-300/20 dark:bg-rose-400/10 dark:text-rose-100">
                {manualScheduleError}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-full px-4 text-sm"
              onClick={() => setManualScheduleDialogOpen(false)}
              disabled={calendarMutating}
            >
              取消
            </Button>
            <Button
              type="submit"
              className="h-9 rounded-full px-4 text-sm"
              disabled={calendarMutating}
            >
              {calendarMutating ? '同步中…' : '添加'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );

  const courseFilesDialog = canManageCourseContent ? (
    <Dialog open={courseFilesDialogOpen} onOpenChange={setCourseFilesDialogOpen}>
      <DialogContent
        overlayClassName={SYNTARA_WORKSPACE_DIALOG_OVERLAY_CLASS}
        className={cn(
          SYNTARA_WORKSPACE_DIALOG_CONTENT_CLASS,
          'h-auto max-h-[min(760px,86dvh)] max-w-3xl overflow-y-auto',
        )}
      >
        <DialogHeader className={SYNTARA_DIALOG_HEADER_CLASS}>
          <DialogTitle className="text-base">上传文件</DialogTitle>
          <p className="text-xs leading-5 text-muted-foreground">管理这门课里你上传过的文件。</p>
        </DialogHeader>
        <div className="p-4 sm:p-5">
          {activeCourse ? (
            <CourseMaterialsPanel courseId={activeCourse.id} className="shadow-none" />
          ) : (
            <p className="rounded-[18px] border border-dashed border-border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
              先添加或选择课程，再管理课程文件。
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  ) : null;

  const sourceUploadStatusDialog = (
    <LearnWorkspaceDialog
      open={sourceUploadPanelOpen}
      onOpenChange={setSourceUploadDialogOpen}
      title="原始讲义库"
      description={
        canManageCourseContent
          ? '浏览课程文件和整理好的正文；第一个位置用于上传新的课程文件。'
          : '浏览老师提供的课程文件和整理好的正文。'
      }
      showCloseButton={!selectedSourceLibraryTile}
    >
      <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-slate-950">
        {selectedSourceLibraryTile ? (
          <div className="shrink-0 border-b border-slate-200/70 bg-gradient-to-b from-slate-50 to-white px-5 py-4 dark:border-white/10 dark:from-slate-900 dark:to-slate-950 sm:px-6">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedSourceLibraryTileId(null);
                  setSourceLibraryDetailView('image');
                  setSourceLibraryImageExpanded(false);
                }}
                className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:text-white"
                aria-label="返回原始讲义库"
              >
                <ChevronLeft className="size-4" strokeWidth={1.9} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                  <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-700 dark:bg-sky-400/15 dark:text-sky-100">
                    {selectedSourceLibraryTile.typeLabel}
                  </span>
                  {selectedSourceLibraryTile.dateLabel ? (
                    <span className="text-slate-400 dark:text-slate-500">
                      {selectedSourceLibraryTile.dateLabel}
                    </span>
                  ) : null}
                  {selectedSourceLibraryTile.status ? (
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-1',
                        sourceUploadStatusIsProcessing(selectedSourceLibraryTile.status)
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-100'
                          : 'bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-100',
                      )}
                    >
                      {sourceUploadStatusLabel(selectedSourceLibraryTile.status)}
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-2 truncate text-lg font-semibold tracking-tight text-slate-950 dark:text-white">
                  {selectedSourceLibraryTile.title}
                </h2>
                <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                  {selectedSourceLibraryTile.subtitle}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {showSourceLibraryViewSwitch ? (
                  <div className="hidden items-center rounded-xl bg-slate-100 p-1 text-xs font-semibold text-slate-500 dark:bg-white/10 dark:text-slate-300 sm:inline-flex">
                    {(['text', 'image'] as const).map((view) => (
                      <button
                        key={view}
                        type="button"
                        onClick={() => {
                          setSourceLibraryDetailView(view);
                          if (view === 'text') setSourceLibraryImageExpanded(false);
                        }}
                        className={cn(
                          'rounded-lg px-3 py-1.5 transition',
                          effectiveSourceLibraryDetailView === view
                            ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white'
                            : 'hover:text-slate-900 dark:hover:text-white',
                        )}
                      >
                        {view === 'text' ? '文本' : '图片'}
                      </button>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSourceUploadDialogOpen(false)}
                  className="inline-flex size-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label="关闭原始讲义库"
                >
                  <X className="size-4" strokeWidth={1.9} />
                </button>
                {selectedSourceLibraryTile.sourceHash && activeCourseIsOwner ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleDeleteSourceLibraryTile(selectedSourceLibraryTile)}
                    disabled={deletingSourceHashes.includes(selectedSourceLibraryTile.sourceHash)}
                    className="h-9 rounded-full border-rose-200 bg-white px-3 text-xs font-semibold text-rose-600 shadow-sm hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-300/20 dark:bg-white/5 dark:text-rose-200 dark:hover:bg-rose-400/10"
                  >
                    {deletingSourceHashes.includes(selectedSourceLibraryTile.sourceHash) ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" strokeWidth={1.8} />
                    ) : (
                      <Trash2 className="mr-1.5 size-3.5" strokeWidth={1.8} />
                    )}
                    删除原始讲义
                  </Button>
                ) : null}
              </div>
            </div>
            {showSourceLibraryViewSwitch ? (
              <div className="mt-4 inline-flex items-center rounded-xl bg-slate-100 p-1 text-xs font-semibold text-slate-500 dark:bg-white/10 dark:text-slate-300 sm:hidden">
                {(['text', 'image'] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    onClick={() => {
                      setSourceLibraryDetailView(view);
                      if (view === 'text') setSourceLibraryImageExpanded(false);
                    }}
                    className={cn(
                      'rounded-lg px-4 py-1.5 transition',
                      effectiveSourceLibraryDetailView === view
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white'
                        : 'hover:text-slate-900 dark:hover:text-white',
                    )}
                  >
                    {view === 'text' ? '文本' : '图片'}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/70 px-6 py-4 dark:border-white/10">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-slate-950 dark:text-white">
                原始讲义库
              </h2>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{sourceLibraryStatusText}</span>
                {sourceUploading ? (
                  <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-100">
                    <Loader2 className="size-3 animate-spin" />
                    入库中
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex min-w-0 shrink-0 justify-end">
              {activeSourceUploadItems.some(
                (item) => !sourceUploadStatusIsProcessing(item.status),
              ) ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full px-3 text-xs"
                  onClick={() =>
                    setSourceUploadItems((items) =>
                      items.filter(
                        (item) =>
                          item.courseId !== activeCourseId ||
                          sourceUploadStatusIsProcessing(item.status),
                      ),
                    )
                  }
                >
                  清空完成项
                </Button>
              ) : null}
            </div>
          </div>
        )}

        {selectedSourceLibraryTile ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-6">
            <div className="flex justify-center">
              {effectiveSourceLibraryDetailView === 'text' ? (
                <div className="w-full max-w-[760px] px-6 py-6">
                  {selectedSourceLibraryHasText ? (
                    <MessageResponse className="text-[15px] leading-8 text-slate-800 dark:text-slate-100 [&_a]:text-blue-600 [&_a]:underline-offset-4 hover:[&_a]:underline dark:[&_a]:text-blue-300">
                      {selectedSourceLibraryText}
                    </MessageResponse>
                  ) : (
                    <div className="grid min-h-64 place-items-center text-center text-sm text-slate-500 dark:text-slate-400">
                      <div className="max-w-sm">
                        <FileText className="mx-auto size-7 text-slate-300" strokeWidth={1.7} />
                        <p className="mt-3 font-medium text-slate-700 dark:text-slate-200">
                          {selectedSourceLibraryTextLoading
                            ? '正在读取文本'
                            : selectedSourceLibraryTextState?.status === 'failed'
                              ? '文本读取失败'
                              : '没有可预览的文本'}
                        </p>
                        <p className="mt-1 text-xs leading-5">
                          {selectedSourceLibraryTextLoading
                            ? '正在加载这本笔记的正文内容。'
                            : selectedSourceLibraryTextState?.error ||
                              '这份原始讲义暂时没有整理出的正文文本。'}
                        </p>
                        {selectedSourceLibraryTextState?.status === 'failed' ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-4 h-8 rounded-full px-3 text-xs"
                            onClick={() => loadSourceLibraryTileText(selectedSourceLibraryTile)}
                          >
                            <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
                            重试读取
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              ) : selectedSourceLibraryTile.coverImagePath ? (
                <div
                  className="relative w-full transition-[max-width] duration-200 ease-out"
                  style={{ maxWidth: sourceLibraryImageExpanded ? 1080 : 760 }}
                >
                  <img
                    src={selectedSourceLibraryTile.coverImagePath}
                    alt=""
                    className="w-full rounded-[18px] border border-slate-200 bg-white shadow-[0_20px_48px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-slate-900"
                    loading="lazy"
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setSourceLibraryImageExpanded((expanded) => !expanded)}
                        className="absolute right-3 top-3 inline-flex size-9 items-center justify-center rounded-full border border-white/80 bg-white/85 text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.18)] backdrop-blur transition hover:bg-white hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 dark:border-white/15 dark:bg-slate-950/78 dark:text-slate-100 dark:hover:bg-slate-900"
                        aria-label={sourceLibraryImageExpanded ? '缩小图片' : '放大图片'}
                      >
                        {sourceLibraryImageExpanded ? (
                          <Minimize2 className="size-4" strokeWidth={1.9} />
                        ) : (
                          <Maximize2 className="size-4" strokeWidth={1.9} />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="font-medium">
                      {sourceLibraryImageExpanded ? '缩小图片' : '放大图片'}
                    </TooltipContent>
                  </Tooltip>
                </div>
              ) : (
                <div className="aspect-[0.707] w-full max-w-[760px] overflow-hidden rounded-[18px] border border-slate-200 shadow-[0_20px_48px_rgba(15,23,42,0.16)] dark:border-white/10">
                  <SourceLibraryGeneratedCover tile={selectedSourceLibraryTile} size="detail" />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-7">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] content-start gap-x-10 gap-y-11">
              {sourceLibraryPendingEntries.length > 0 || sourceLibraryFailedEntries.length > 0 ? (
                <div
                  role={sourceLibraryFailedEntries.length > 0 ? 'alert' : 'status'}
                  aria-live="polite"
                  className={cn(
                    'col-span-full rounded-2xl border px-4 py-3 text-left text-xs leading-5',
                    sourceLibraryFailedEntries.length > 0
                      ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-300/20 dark:bg-rose-400/10 dark:text-rose-100'
                      : 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-300/20 dark:bg-sky-400/10 dark:text-sky-100',
                  )}
                >
                  {sourceLibraryPendingEntries.length > 0 ? (
                    <p className="inline-flex items-center gap-2 font-medium">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      正在加载
                      {sourceLibraryPendingEntries.map(({ label }) => label).join('、')}
                      ；完成前不会把原始讲义库判定为空。
                    </p>
                  ) : null}
                  {sourceLibraryFailedEntries.map(({ kind, label, state }) => (
                    <div
                      key={kind}
                      className="mt-1 flex flex-wrap items-start justify-between gap-2 first:mt-0"
                    >
                      <p className="min-w-0 flex-1">
                        <span className="font-semibold">{label}加载失败：</span>
                        {state.error || '服务端没有返回错误原因'}
                        {state.usingCachedData ? '（当前保留缓存内容）' : ''}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-full border-current/30 bg-transparent px-2.5 text-[11px] hover:bg-white/60 dark:hover:bg-white/10"
                        onClick={() => retryCourseResource(kind)}
                      >
                        <RefreshCw className="mr-1 size-3" aria-hidden="true" />
                        重试
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
              {activeCourseIsOwner ? (
                <div className="min-w-0 text-center">
                  <button
                    type="button"
                    disabled={sourceUploading}
                    onClick={() => sourceDocumentInputRef.current?.click()}
                    className="group mx-auto flex aspect-[0.707] w-full max-w-[142px] items-center justify-center rounded-[16px] border-2 border-dashed border-sky-300 bg-white text-sky-600 transition hover:border-sky-400 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-300/40 dark:bg-white/[0.03] dark:text-sky-200 dark:hover:bg-sky-400/10"
                    aria-label="上传文件"
                  >
                    {sourceUploading ? (
                      <Loader2 className="size-7 animate-spin" strokeWidth={1.8} />
                    ) : (
                      <Plus className="size-8 transition group-hover:scale-110" strokeWidth={1.8} />
                    )}
                  </button>
                  <p className="mt-3 truncate text-sm font-semibold text-sky-600 dark:text-sky-200">
                    上传文件
                  </p>
                </div>
              ) : null}

              {allSourceLibraryTiles.map((tile) => {
                const status = tile.status;
                const deletingSource = tile.sourceHash
                  ? deletingSourceHashes.includes(tile.sourceHash)
                  : false;
                const reindexingSource = tile.sourceHash
                  ? reindexingSourceHashes.includes(tile.sourceHash)
                  : false;
                const openTile = () => {
                  const preloadedText = sourceLibraryTextFromBlocks(tile.textBlocks);
                  if (preloadedText) {
                    setSourceLibraryTextCache((current) => ({
                      ...current,
                      [tile.id]: { status: 'ready', text: preloadedText },
                    }));
                  } else {
                    loadSourceLibraryTileText(tile);
                  }
                  setSourceLibraryDetailView(
                    preloadedText || !tile.coverImagePath ? 'text' : 'image',
                  );
                  setSourceLibraryImageExpanded(false);
                  setSelectedSourceLibraryTileId(tile.id);
                };
                return (
                  <div key={tile.id} className="min-w-0 text-center">
                    <div
                      className={cn(
                        'relative mx-auto w-full',
                        tile.tileKind === 'notebook' ? 'max-w-[210px]' : 'max-w-[142px]',
                      )}
                    >
                      <button
                        type="button"
                        aria-label={`查看 ${tile.title}`}
                        onClick={openTile}
                        disabled={deletingSource}
                        className={cn(
                          'group block w-full focus-visible:outline-none disabled:cursor-wait disabled:opacity-55',
                          tile.tileKind === 'notebook' &&
                            'transition duration-150 hover:-translate-y-1 hover:-rotate-[0.6deg]',
                        )}
                      >
                        <span
                          className={cn(
                            'relative block w-full transition group-focus-visible:ring-2 group-focus-visible:ring-sky-300',
                            tile.tileKind === 'notebook'
                              ? 'aspect-[3/4] min-h-[220px]'
                              : 'aspect-[0.707] overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.12)] group-hover:-translate-y-0.5 group-hover:shadow-[0_16px_30px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-slate-900',
                          )}
                        >
                          <SourceLibraryListCardFace tile={tile} />
                          {status ? (
                            <span
                              className={cn(
                                'absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold shadow-sm backdrop-blur',
                                sourceUploadStatusIsProcessing(status)
                                  ? 'bg-sky-100/90 text-sky-700 dark:bg-sky-400/20 dark:text-sky-100'
                                  : 'bg-rose-100/90 text-rose-700 dark:bg-rose-400/20 dark:text-rose-100',
                              )}
                            >
                              {sourceUploadStatusLabel(status)}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </div>
                    {tile.tileKind !== 'notebook' ? (
                      <button
                        type="button"
                        onClick={openTile}
                        disabled={deletingSource}
                        className="mt-3 block w-full min-w-0 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-wait disabled:opacity-55"
                      >
                        <span className="block line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-5 text-sky-600 dark:text-sky-200">
                          {tile.title}
                        </span>
                        <span className="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400">
                          {tile.dateLabel || tile.typeLabel}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-slate-400 dark:text-slate-500">
                          {tile.subtitle}
                        </span>
                      </button>
                    ) : null}
                    {tile.error ? (
                      <span
                        className="mt-1 block line-clamp-2 text-[11px] leading-4 text-rose-600 dark:text-rose-300"
                        title={tile.error}
                      >
                        {tile.error}
                      </span>
                    ) : null}
                    {status === 'index_failed' && tile.sourceHash && activeCourseIsOwner ? (
                      <button
                        type="button"
                        onClick={() => void handleRetrySourceIndex(tile)}
                        disabled={reindexingSource || deletingSource}
                        className="mt-1.5 inline-flex h-7 items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 disabled:cursor-wait disabled:opacity-60 dark:border-sky-300/20 dark:bg-sky-400/10 dark:text-sky-100"
                      >
                        {reindexingSource ? <Loader2 className="size-3 animate-spin" /> : null}
                        重试索引
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </LearnWorkspaceDialog>
  );

  const notebookLibraryDialog = (
    <LearnWorkspaceDialog
      open={notebookLibraryPanelOpen}
      onOpenChange={(open) => {
        setNotebookLibraryPanelOpen(open);
        if (!open) {
          setSelectedNotebookLibraryTileId(null);
          setNotebookLibraryQuery('');
        }
      }}
      title="笔记本库"
      description="在课程内按需浏览课程笔记本。"
      showCloseButton={!selectedNotebookLibraryTile}
    >
      <div className="flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
        <header className="shrink-0 border-b border-slate-200/80 bg-white px-5 py-4 dark:border-white/10 dark:bg-slate-950 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (selectedNotebookLibraryTile) {
                  setSelectedNotebookLibraryTileId(null);
                  return;
                }
                setNotebookLibraryPanelOpen(false);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
            >
              <ArrowLeft className="size-3.5" strokeWidth={1.9} />
              {selectedNotebookLibraryTile ? '返回列表' : '返回课程'}
            </button>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
              {activeCourse?.courseCode || activeCourse?.name || '课程'}
            </span>
            {!selectedNotebookLibraryTile ? (
              <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50 px-3 text-slate-400 focus-within:border-sky-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-sky-100 dark:border-white/10 dark:bg-white/5 dark:focus-within:ring-sky-300/20">
                <BookOpen className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                <input
                  type="search"
                  value={notebookLibraryQuery}
                  onChange={(event) => setNotebookLibraryQuery(event.target.value)}
                  placeholder="搜索笔记本名称"
                  className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-slate-400"
                  autoComplete="off"
                />
              </label>
            ) : null}
            <span className="ml-auto text-xs font-semibold tabular-nums text-slate-500">
              {selectedNotebookLibraryTile
                ? selectedNotebookLibraryTile.typeLabel
                : `${filteredNotebookLibraryTiles.length}/${notebookLibraryTiles.length}`}
            </span>
            {!selectedNotebookLibraryTile ? (
              <button
                type="button"
                onClick={() => setNotebookLibraryPanelOpen(false)}
                className="inline-flex size-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 dark:hover:bg-white/10 dark:hover:text-white"
                aria-label="关闭笔记本库"
              >
                <X className="size-4" strokeWidth={1.9} />
              </button>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
              <BookOpen className="size-3.5" strokeWidth={1.8} />
              笔记本库 · {notebookLibraryTiles.length} 本
            </span>
            <span>
              {selectedNotebookLibraryTile
                ? selectedNotebookLibraryTile.title
                : '点开后在本机阅读器中查看'}
            </span>
          </div>
        </header>

        {selectedNotebookLibraryTile ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto w-full max-w-[1040px]">
              <div className="mb-5 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-700 dark:bg-sky-400/15 dark:text-sky-100">
                  {selectedNotebookLibraryTile.typeLabel}
                </span>
                {selectedNotebookLibraryTile.dateLabel ? (
                  <span className="text-slate-400">{selectedNotebookLibraryTile.dateLabel}</span>
                ) : null}
                <span className="text-slate-400">{selectedNotebookLibraryTile.subtitle}</span>
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-white">
                {selectedNotebookLibraryTile.title}
              </h2>
              {selectedNotebookLibraryIsMarkdown ? (
                <div className="mt-6 grid min-h-[420px] overflow-hidden rounded-[18px] border border-slate-200/80 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-slate-900 md:grid-cols-[240px_minmax(0,1fr)]">
                  <aside className="border-b border-slate-200/80 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03] md:border-b-0 md:border-r">
                    <p className="px-2 py-1 text-[11px] font-semibold text-slate-500">章节</p>
                    <div className="mt-1 space-y-1">
                      {(selectedNotebookMarkdownPageState?.sections || []).map((section) => (
                        <button
                          key={section.id}
                          type="button"
                          onClick={() => {
                            if (!selectedNotebookLibraryId) return;
                            setSelectedNotebookSectionIds((selected) => ({
                              ...selected,
                              [selectedNotebookLibraryId]: section.id,
                            }));
                          }}
                          className={cn(
                            'w-full rounded-[10px] px-3 py-2 text-left transition',
                            selectedNotebookSectionId === section.id
                              ? 'bg-white text-sky-700 shadow-sm ring-1 ring-slate-200/80 dark:bg-white/10 dark:text-sky-100 dark:ring-white/10'
                              : 'text-slate-600 hover:bg-white/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white',
                          )}
                        >
                          <span className="block truncate text-xs font-semibold">
                            {section.title}
                          </span>
                          {section.summary ? (
                            <span className="mt-1 block line-clamp-2 text-[10px] leading-4 text-slate-400">
                              {section.summary}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                    {selectedNotebookMarkdownPageState?.status === 'loading' ? (
                      <div className="flex items-center gap-2 px-3 py-4 text-xs text-slate-500">
                        <Loader2 className="size-3.5 animate-spin" />
                        加载章节…
                      </div>
                    ) : null}
                    {selectedNotebookMarkdownPageState?.status === 'failed' ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 h-8 w-full rounded-full px-3 text-xs"
                        onClick={() => {
                          if (selectedNotebookLibraryId) {
                            void loadNotebookMarkdownPageForPopup(
                              selectedNotebookLibraryId,
                              false,
                              true,
                            );
                          }
                        }}
                      >
                        <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
                        重试章节列表
                      </Button>
                    ) : null}
                    {selectedNotebookMarkdownPageState?.hasMore ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={selectedNotebookMarkdownPageState.loadingMore}
                        className="mt-3 h-8 w-full rounded-full px-3 text-xs"
                        onClick={() => {
                          if (selectedNotebookLibraryId) {
                            void loadNotebookMarkdownPageForPopup(selectedNotebookLibraryId, true);
                          }
                        }}
                      >
                        {selectedNotebookMarkdownPageState.loadingMore ? (
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        ) : null}
                        加载更多章节
                      </Button>
                    ) : null}
                  </aside>
                  <article className="min-w-0 px-6 py-6">
                    {selectedNotebookLibraryHasText ? (
                      <MessageResponse className="text-[15px] leading-8 text-slate-800 dark:text-slate-100 [&_a]:text-blue-600 [&_a]:underline-offset-4 hover:[&_a]:underline dark:[&_a]:text-blue-300">
                        {selectedNotebookLibraryText}
                      </MessageResponse>
                    ) : (
                      <div className="grid min-h-72 place-items-center text-center text-sm text-slate-500">
                        <div className="max-w-sm">
                          {selectedNotebookLibraryTextLoading ? (
                            <Loader2 className="mx-auto size-6 animate-spin text-sky-500" />
                          ) : (
                            <FileText className="mx-auto size-7 text-slate-300" strokeWidth={1.7} />
                          )}
                          <p className="mt-3 font-medium text-slate-700 dark:text-slate-200">
                            {selectedNotebookLibraryTextLoading
                              ? '正在加载本节正文…'
                              : selectedNotebookLibraryTextState?.status === 'failed'
                                ? '章节打开失败'
                                : selectedNotebookMarkdownPageState?.sections.length
                                  ? '本节暂时没有正文'
                                  : '这本笔记本还没有章节'}
                          </p>
                          <p className="mt-1 text-xs leading-5">
                            {selectedNotebookLibraryTextState?.error ||
                              selectedNotebookMarkdownPageState?.error ||
                              '选择左侧章节后，正文才会按需加载。'}
                          </p>
                          {selectedNotebookLibraryTextState?.status === 'failed' &&
                          selectedNotebookLibraryId &&
                          selectedNotebookSectionId ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-4 h-8 rounded-full px-3 text-xs"
                              onClick={() =>
                                void loadNotebookMarkdownSectionForPopup(
                                  selectedNotebookLibraryId,
                                  selectedNotebookSectionId,
                                  true,
                                )
                              }
                            >
                              <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
                              重试本节
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </article>
                </div>
              ) : (
                <div className="mt-6 rounded-[18px] border border-slate-200/80 bg-white px-6 py-6 shadow-[0_12px_28px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-slate-900">
                  <div className="mx-auto max-w-[760px]">
                    <div className="grid min-h-72 place-items-center overflow-hidden rounded-[16px] bg-slate-100 dark:bg-slate-950">
                      {selectedNotebookImagePath ? (
                        <img
                          src={selectedNotebookImagePath}
                          alt={`${selectedNotebookLibraryTile.title} 预览`}
                          className="max-h-[520px] w-full object-contain"
                          loading="lazy"
                        />
                      ) : selectedNotebookImagePreviewState?.status === 'loading' ? (
                        <div className="text-center text-sm text-slate-500">
                          <Loader2 className="mx-auto size-6 animate-spin text-sky-500" />
                          <p className="mt-3">正在加载首张预览…</p>
                        </div>
                      ) : (
                        <div className="max-w-sm text-center text-sm text-slate-500">
                          <BookOpen className="mx-auto size-8 text-slate-300" strokeWidth={1.7} />
                          <p className="mt-3 font-medium text-slate-700 dark:text-slate-200">
                            这本讲义可以在阅读器中打开
                          </p>
                          <p className="mt-1 text-xs leading-5">
                            {selectedNotebookImagePreviewState?.error ||
                              '当前没有可用封面，进入阅读器后可查看完整讲义。'}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="mt-5 flex justify-end">
                      <Button
                        type="button"
                        className="h-9 rounded-full bg-sky-600 px-4 text-xs text-white hover:bg-sky-700"
                        onClick={() => {
                          if (!selectedNotebookLibraryId) return;
                          setNotebookLibraryPanelOpen(false);
                          router.push(
                            `/classroom/${encodeURIComponent(selectedNotebookLibraryId)}`,
                          );
                        }}
                      >
                        <BookOpen className="mr-1.5 size-3.5" aria-hidden="true" />
                        进入阅读器
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-10">
            {notebooksLoadState.status === 'loading' && notebookLibraryTiles.length === 0 ? (
              <div className="grid min-h-64 place-items-center text-sm text-slate-500">
                <div className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  正在加载笔记本库…
                </div>
              </div>
            ) : filteredNotebookLibraryTiles.length === 0 ? (
              <div className="grid min-h-64 place-items-center text-center text-sm text-slate-500">
                <div className="max-w-sm">
                  <CheckCircle2 className="mx-auto size-7 text-slate-300" strokeWidth={1.7} />
                  <p className="mt-3 font-semibold text-slate-700 dark:text-slate-200">
                    {notebookLibraryTiles.length ? '没有匹配的笔记本' : '还没有本地笔记本'}
                  </p>
                  <p className="mt-1 text-xs leading-5">
                    {notebookLibraryTiles.length
                      ? '换个关键词再试。'
                      : '导入课程资料后，这里会出现笔记本。'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] content-start gap-x-10 gap-y-11">
                {filteredNotebookLibraryTiles.map((tile) => (
                  <button
                    key={tile.id}
                    type="button"
                    aria-label={`打开 ${tile.title}`}
                    onClick={() => {
                      setSelectedNotebookLibraryTileId(tile.id);
                    }}
                    className="group relative mx-auto block aspect-[3/4] min-h-[220px] w-full max-w-[210px] text-left transition duration-150 hover:-translate-y-1 hover:-rotate-[0.6deg] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                  >
                    <SourceLibraryListCardFace tile={tile} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </LearnWorkspaceDialog>
  );

  const recentActivityPanel = (
    <section className="min-h-0">
      <div className="flex items-center gap-2 px-1">
        <CalendarDays className={rightRailSectionIconClassName} strokeWidth={1.8} />
        <p className={rightRailSectionTitleClassName}>最近活动</p>
      </div>
      <div className="mt-2 space-y-1.5">
        {statusCalendarActivities.length ? (
          statusCalendarActivities.map((activity) => (
            <div key={activity.id} className={cn(rightRailRowClassName, 'text-[12px] leading-4')}>
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void startStatusCalendarActivity(activity);
                  }}
                  className="-m-1 min-w-0 flex-1 rounded-[12px] p-1 text-left transition hover:bg-slate-50/80 focus-visible:bg-slate-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-100 dark:hover:bg-white/5 dark:focus-visible:bg-white/5 dark:focus-visible:ring-sky-300/20"
                  aria-label={`${activity.actionLabel ?? '打开'}：${activity.title}`}
                  title={activity.actionLabel ?? '打开'}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn('size-1.5 shrink-0 rounded-full', activity.dotClassName)} />
                    <span className="min-w-0 flex-1 truncate font-semibold text-slate-800 dark:text-slate-100">
                      {activity.title}
                    </span>
                    <span className="shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {formatShortCalendarDate(activity.date)}
                    </span>
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-sky-50 text-sky-700 ring-1 ring-sky-100 dark:bg-sky-400/10 dark:text-sky-100 dark:ring-sky-300/15">
                      <Play className="size-3.5" fill="currentColor" strokeWidth={1.8} />
                    </span>
                  </span>
                  <span className="mt-1 block truncate pl-3.5 text-[11px] font-medium leading-4 text-slate-500 dark:text-slate-400">
                    {activity.meta}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void removeStatusCalendarActivity(activity)}
                  disabled={calendarMutating}
                  className="grid size-6 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:bg-rose-50 focus-visible:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-100 dark:hover:bg-rose-400/10 dark:hover:text-rose-200 dark:focus-visible:bg-rose-400/10 dark:focus-visible:text-rose-200 dark:focus-visible:ring-rose-300/20"
                  aria-label={`删除日历活动：${activity.title}`}
                  title="删除"
                >
                  <Trash2 className="size-3.5" strokeWidth={1.8} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className={cn(rightRailRowClassName, 'text-[12px] leading-4 text-muted-foreground')}>
            暂无未来活动。
          </p>
        )}
      </div>
    </section>
  );

  const platformMemoryDialog = (
    <LearnWorkspaceDialog
      open={memoryActivityDialogOpen}
      onOpenChange={setMemoryActivityDialogOpen}
      title="平台记忆动态"
      description="查看平台最近怎样更新对你的学习状态的理解。"
      contentClassName="learn-memory-dialog-shell border-0 bg-transparent shadow-none"
    >
      <div className="learn-memory-dialog-surface flex h-full min-h-0">
        <aside className="learn-memory-sidebar hidden w-[282px] shrink-0 px-6 py-6 lg:flex lg:flex-col">
          <p className="text-xs font-semibold tracking-normal text-slate-500">平台记忆</p>
          <h2 className="mt-3 text-[32px] font-semibold leading-10 tracking-normal text-slate-950">
            记忆动态
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            这里只显示与你本人相关的进度、偏好、掌握情况和薄弱点，不显示课程资料同步。
          </p>
          <div className="mt-6 grid gap-2 text-sm">
            <div className="learn-memory-metric-row" data-tone="writing">
              <span className="font-semibold">写入中</span>
              <span className="tabular-nums">{activeMemoryActivities.length}</span>
            </div>
            <div className="learn-memory-metric-row" data-tone="completed">
              <span className="font-semibold">刚完成</span>
              <span className="tabular-nums">{completedMemoryActivities.length}</span>
            </div>
          </div>

          <div className="learn-memory-sphere-stage mt-auto" aria-hidden="true">
            <div className="learn-memory-sphere-glow" />
            {PLATFORM_MEMORY_SPHERES.map((sphere) => (
              <span
                key={`${sphere.tone}-${sphere.className}`}
                className={cn('learn-memory-glass-sphere', sphere.className)}
                data-tone={sphere.tone}
              />
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="learn-memory-dialog-header flex shrink-0 items-start justify-between gap-4 px-7 py-6">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-500 lg:hidden">平台记忆</p>
              <h2 className="truncate text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">
                最近写入
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                只有与你本人相关的记忆写入后，平台才会在这里通知你。
              </p>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7 pt-5">
            {platformMemoryHistory.length ? (
              <div className="learn-memory-list-surface">
                {platformMemoryHistory.map((record) => {
                  const statusLabel = memoryActivityStatusLabel(record.status);
                  const isRunning =
                    record.status === 'running' ||
                    record.status === 'queued' ||
                    record.status === 'needs_attention';
                  const isCompleted = record.status === 'completed';
                  const tone = platformMemoryVisualTone(record);
                  return (
                    <div
                      key={record.id}
                      className="learn-memory-history-row grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
                    >
                      <div className="grid min-w-0 grid-cols-[22px_minmax(0,1fr)] gap-3">
                        <span
                          className="learn-memory-glass-bead mt-1"
                          data-tone={tone}
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold',
                                isRunning
                                  ? 'bg-amber-100/75 text-amber-800 ring-1 ring-amber-200/70'
                                  : isCompleted
                                    ? 'bg-sky-100/75 text-sky-800 ring-1 ring-sky-200/70'
                                    : 'bg-slate-100/80 text-slate-600 ring-1 ring-slate-200/70',
                              )}
                            >
                              {statusLabel}
                            </span>
                            {record.chips.slice(0, 3).map((chip) => (
                              <span
                                key={`${record.id}-${chip}`}
                                className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200/70"
                              >
                                {platformMemoryChipLabel(chip)}
                              </span>
                            ))}
                          </div>
                          <p className="mt-2 text-sm font-semibold leading-5 text-slate-950">
                            {memoryActivityStudentTitle(record.title, record.description)}
                          </p>
                          <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500">
                            {memoryActivityStudentDescription(record)}
                          </p>
                        </div>
                      </div>
                      <time className="text-xs font-medium tabular-nums text-slate-400 sm:pt-1">
                        {formatMemoryActivityTime(record.updatedAt)}
                      </time>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="learn-memory-empty-state grid h-full min-h-72 place-items-center text-center">
                <div className="max-w-sm px-6">
                  <div className="learn-memory-empty-orbs mx-auto" aria-hidden="true">
                    <span data-tone="progress" />
                    <span data-tone="mastery" />
                    <span data-tone="weakness" />
                  </div>
                  <p className="mt-4 text-sm font-semibold text-slate-950">还没有记忆动态</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    当你确认学习进度，或平台写入你的偏好、掌握情况和薄弱点后，会在这里告诉你。
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </LearnWorkspaceDialog>
  );

  const largeCalendarDialog = (
    <LearnWorkspaceDialog
      open={calendarDialogOpen}
      onOpenChange={setCalendarDialogOpen}
      title="学习日历"
      description="查看复习计划、作业、考试和周进度。"
    >
      <div className="flex h-full min-h-0 bg-background">
        <aside className="hidden w-[230px] shrink-0 border-r border-border/70 bg-muted/30 px-4 py-5 lg:flex lg:flex-col">
          <div className="space-y-5">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">学习日历</p>
              <div className="mt-3 space-y-2.5 text-sm">
                {[
                  {
                    label: '复习计划',
                    count: recentPlans.length,
                    dotClassName: 'bg-emerald-500',
                  },
                  {
                    label: '作业',
                    count: syllabusEvents.filter((event) => event.kind === 'assignment').length,
                    dotClassName: 'bg-sky-500',
                  },
                  {
                    label: '考试',
                    count: syllabusEvents.filter((event) => event.kind === 'exam').length,
                    dotClassName: 'bg-rose-500',
                  },
                  {
                    label: '周进度',
                    count: syllabusEvents.filter((event) => event.kind === 'progress').length,
                    dotClassName: 'bg-amber-500',
                  },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          'grid size-4 shrink-0 place-items-center rounded-[5px]',
                          item.dotClassName,
                        )}
                      >
                        <span className="size-1.5 rounded-full bg-white" />
                      </span>
                      <span className="min-w-0 truncate font-medium text-foreground">
                        {item.label}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-4 px-5 pb-4 pt-5 sm:px-6">
            <h2 className="truncate text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
              {calendarMonthLabel}
            </h2>
            <div className="flex shrink-0 items-center gap-3 pr-8">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={showCurrentCalendarMonth}
                  className="rounded-full bg-muted px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  今天
                </button>
                <button
                  type="button"
                  onClick={showPreviousCalendarMonth}
                  className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground transition hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label="上一个月"
                  title="上一个月"
                >
                  <ChevronLeft className="size-4" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={showNextCalendarMonth}
                  className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground transition hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label="下一个月"
                  title="下一个月"
                >
                  <ChevronRight className="size-4" strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>

          {calendarLoading ? (
            <p className="mx-5 mb-3 flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700 sm:mx-6 dark:bg-sky-400/10 dark:text-sky-100">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              正在同步课程日历…
            </p>
          ) : null}
          {calendarLoadError ? (
            <div className="mx-5 mb-3 flex items-center justify-between gap-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 sm:mx-6 dark:bg-rose-400/10 dark:text-rose-100">
              <span className="min-w-0 truncate">{calendarLoadError}</span>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 font-semibold"
                onClick={() => void reloadCalendarEvents().catch(() => undefined)}
              >
                <RefreshCw className="size-3" aria-hidden="true" />
                重试
              </button>
            </div>
          ) : null}

          <LearningCalendarGrid
            days={calendarDays}
            plansByCalendarDay={plansByCalendarDay}
            syllabusEventsByCalendarDay={syllabusEventsByCalendarDay}
            isResearchCourse={isResearchCourse}
          />
        </div>
      </div>
    </LearnWorkspaceDialog>
  );

  const coursePublishDialog = (
    <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
      <DialogContent className={cn(SYNTARA_ACTION_DIALOG_CONTENT_CLASS, 'max-w-[520px] gap-0 p-0')}>
        <DialogHeader className={SYNTARA_DIALOG_HEADER_CLASS}>
          <DialogTitle className="text-base">
            {activeCourse?.listedInCourseStore ? '更新课程发布' : '发布到课程商城'}
          </DialogTitle>
          <DialogDescription className="leading-5">
            共享你的课程，让其他同学加入学习；有人加入付费课程时，你可以获得额度。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-3 gap-2">
            <div className={cn(rightRailRowClassName, 'text-center')}>
              <p className="text-lg font-semibold text-foreground">
                {resourceCountText(sourcesLoadState, activeCourseSourceUploads.length)}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">原始讲义</p>
            </div>
            <div className={cn(rightRailRowClassName, 'text-center')}>
              <p className="text-lg font-semibold text-foreground">
                {resourceCountText(problemsLoadState, publishableProblemCount)}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">已发布题目</p>
            </div>
            <div className={cn(rightRailRowClassName, 'text-center')}>
              <p className="text-lg font-semibold text-foreground">
                {publishableMemoryCount ?? '—'}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">公开记忆</p>
            </div>
          </div>

          <div className="space-y-2">
            {[
              '不会发布你的私人学习状态、私人记忆或聊天记录。',
              '不会上传 PDF、图片等源文件；源文件只留在你的原始讲义库里。',
              '会同步课程信息、原始讲义的整理文本、已发布题库，以及课程回复题目需要用到的公开记忆。',
            ].map((item) => (
              <div key={item} className="flex gap-2 text-sm leading-5 text-slate-600">
                <CheckCircle2
                  className="mt-0.5 size-4 shrink-0 text-emerald-600"
                  strokeWidth={1.9}
                />
                <span>{item}</span>
              </div>
            ))}
          </div>

          {coursePublishBlockReason ? (
            <div className="rounded-[16px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100">
              {coursePublishBlockReason}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/70 px-5 py-4">
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-full px-4 text-sm"
            onClick={() => setPublishDialogOpen(false)}
            disabled={publishingCourse}
          >
            取消
          </Button>
          <Button
            type="button"
            className="h-9 rounded-full px-4 text-sm"
            onClick={() => void handlePublishActiveCourse()}
            disabled={publishingCourse || Boolean(coursePublishBlockReason)}
          >
            {publishingCourse ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
            ) : (
              <ShoppingBag className="size-4" strokeWidth={1.8} />
            )}
            {activeCourse?.listedInCourseStore ? '更新发布' : '确认发布'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  const courseRailTools: CourseRailTool[] = activeCourse
    ? [
        {
          label: '资料库',
          description: '课程笔记本与学习资料',
          Icon: LibraryBig,
          onSelect: openNotebookLibraryPanel,
        },
        {
          label: isResearchCourse ? '研究日历' : '学习日历',
          description: '计划与截止日期',
          Icon: CalendarDays,
          onSelect: () => setCalendarDialogOpen(true),
        },
      ]
    : [];

  const legacySessionsPanel = (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col bg-slate-50/80 transition-[padding] duration-300 dark:bg-slate-950/40',
        leftRailCollapsed ? 'items-center px-1 py-3' : 'px-4 py-5',
      )}
    >
      {leftRailCollapsed ? (
        <>
          <Link
            href="/learn"
            onClick={(event) => {
              if (sending) event.preventDefault();
            }}
            aria-disabled={sending}
            className="mb-3 flex size-9 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm ring-1 ring-border/70 transition hover:text-foreground"
            aria-label="返回所有课程"
            title="所有课程"
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} />
          </Link>
          <button
            type="button"
            onClick={() => persistLeftRailCollapsed(false)}
            className="mb-3 flex size-9 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm ring-1 ring-border/70 transition hover:text-foreground"
            aria-label="展开会话历史"
            title="展开会话历史"
          >
            <ChevronRight className="size-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={hasActiveCourse ? createNewLearnSession : () => router.push('/learn')}
            disabled={sending}
            className={rightRailIconButtonClassName}
            aria-label="添加新会话"
            title="添加新会话"
          >
            <MessageSquarePlus className="size-4" strokeWidth={1.8} />
          </button>
        </>
      ) : (
        <>
          <Link
            href="/learn"
            onClick={(event) => {
              if (sending) event.preventDefault();
            }}
            aria-disabled={sending}
            className="mb-4 inline-flex h-9 w-fit items-center gap-2 rounded-[9px] bg-transparent px-2 text-xs font-medium text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/8 dark:hover:text-white"
          >
            <ArrowLeft className="size-3.5" strokeWidth={1.8} />
            所有课程
          </Link>

          {activeCourse ? (
            <section className="mb-5 rounded-[18px] border border-slate-200/80 bg-white/65 p-2 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
              <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
                <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">
                  课程导航
                </p>
                <span className="max-w-[104px] truncate text-[10px] font-medium text-slate-400">
                  {activeCourse.courseCode || '当前课程'}
                </span>
              </div>
              <nav className="space-y-1" aria-label="课程导航">
                {courseRailTools.slice(0, 2).map((tool) => {
                  const Icon = tool.Icon;
                  return (
                    <button
                      key={tool.label}
                      type="button"
                      onClick={tool.onSelect}
                      className="group flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-[13px] px-2.5 text-left text-slate-700 transition hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 dark:text-slate-200 dark:hover:bg-white/8 dark:focus-visible:ring-sky-300/20"
                      aria-label={tool.label}
                      title={tool.label}
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-white text-slate-500 shadow-sm ring-1 ring-slate-200/70 transition group-hover:text-sky-700 dark:bg-white/8 dark:text-slate-300 dark:ring-white/10 dark:group-hover:text-sky-200">
                        <Icon className="size-4" strokeWidth={1.8} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold">{tool.label}</span>
                        <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-400">
                          {tool.description}
                        </span>
                      </span>
                      <ChevronRight className="size-3.5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
                    </button>
                  );
                })}
                {courseRailTools.length > 2 ? (
                  <div className="grid grid-cols-2 gap-1 pt-1">
                    {courseRailTools.slice(2).map((tool) => {
                      const Icon = tool.Icon;
                      return (
                        <button
                          key={tool.label}
                          type="button"
                          onClick={tool.onSelect}
                          className="flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-[11px] px-2 text-[10px] font-semibold text-slate-500 transition hover:bg-white hover:text-slate-800 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 dark:text-slate-400 dark:hover:bg-white/8 dark:hover:text-slate-100"
                          title={tool.description}
                        >
                          <Icon className="size-3.5 shrink-0" strokeWidth={1.8} />
                          <span className="truncate">{tool.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </nav>
              {!missingLearningSetup && !snapshot?.progressKnown ? (
                <button
                  type="button"
                  onClick={() => addProgressRequestMessage({ snapshot })}
                  className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-[11px] border border-sky-100 bg-sky-50/80 px-2 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 dark:border-sky-300/15 dark:bg-sky-400/10 dark:text-sky-200 dark:focus-visible:ring-sky-300/20"
                >
                  <Target className="size-3.5" strokeWidth={1.8} />
                  {isResearchCourse ? '更新研究进度' : '更新学习进度'}
                </button>
              ) : null}
            </section>
          ) : null}

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <MessageSquarePlus className={rightRailSectionIconClassName} strokeWidth={1.8} />
                <p className="text-[19px] font-semibold leading-none text-slate-950 dark:text-slate-50">
                  会话历史
                </p>
              </div>
              <p className="mt-1.5 truncate text-xs text-slate-500">
                {activeCourse?.courseCode || activeCourse?.name || '当前课程'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => persistLeftRailCollapsed(true)}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm ring-1 ring-border/70 transition hover:text-foreground"
              aria-label="收起会话历史"
              title="收起会话历史"
            >
              <ChevronLeft className="size-4" strokeWidth={1.75} />
            </button>
          </div>

          <Button
            type="button"
            onClick={hasActiveCourse ? createNewLearnSession : () => router.push('/learn')}
            disabled={sending}
            className="mt-4 h-[38px] w-full justify-center rounded-[11px] border border-slate-900 bg-slate-950 px-3 text-xs font-semibold text-white shadow-[0_7px_18px_rgba(15,23,42,0.14)] hover:bg-slate-800 dark:border-white dark:bg-white dark:text-slate-950"
          >
            <MessageSquarePlus className="size-3.5" strokeWidth={1.8} />
            新对话
          </Button>

          <nav
            className="mt-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-6"
            aria-label="当前课程会话历史"
          >
            {!hasActiveCourse ? (
              <div className={cn(rightRailRowClassName, 'text-xs leading-5 text-muted-foreground')}>
                请返回课程首页选择一门课程；进入后这里只显示当前课程的会话。
              </div>
            ) : null}
            {hasActiveCourse
              ? railLearnSessions.map((session) => {
                  const active = session.id === activeSessionId;
                  const deleting = deletingLearnSessionIds.includes(session.id);
                  const onlyBlankSession =
                    learnSessions.length <= 1 && active && learnSessionIsBlank(visibleMessages);
                  const deleteDisabled = deleting || onlyBlankSession || sending;
                  return (
                    <div
                      key={session.id}
                      className={cn(
                        'group flex min-h-10 min-w-0 items-center gap-1 rounded-[10px] border pr-1 text-[12px] font-medium leading-4 tracking-normal text-slate-600 transition hover:border-slate-200 hover:bg-white/80 dark:text-slate-100 dark:hover:bg-white/5',
                        active
                          ? 'border-slate-200/80 bg-white shadow-[0_4px_14px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/5'
                          : 'border-transparent bg-transparent',
                      )}
                    >
                      <Link
                        href={learnSessionHref(session.id)}
                        onClick={(event) => {
                          event.preventDefault();
                          selectLearnSession(session.id);
                        }}
                        aria-disabled={sending}
                        aria-current={active ? 'page' : undefined}
                        className="flex min-h-10 min-w-0 flex-1 items-center px-3 py-2"
                      >
                        <span className="min-w-0 flex-1 truncate">{session.title}</span>
                      </Link>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setPendingDeleteLearnSession(session);
                        }}
                        disabled={deleteDisabled}
                        className={cn(
                          'grid size-8 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:pointer-events-none disabled:opacity-60 dark:text-slate-500 dark:hover:bg-rose-500/10 dark:hover:text-rose-300',
                          active ? 'opacity-100' : 'opacity-70 group-hover:opacity-100',
                          onlyBlankSession && 'opacity-35',
                        )}
                        aria-label={
                          onlyBlankSession ? '空白新对话无需删除' : `删除会话：${session.title}`
                        }
                        title={onlyBlankSession ? '空白新对话无需删除' : '删除会话'}
                      >
                        {deleting ? (
                          <Loader2 className="size-3.5 animate-spin" strokeWidth={1.9} />
                        ) : (
                          <Trash2 className="size-3.5" strokeWidth={1.9} />
                        )}
                      </button>
                    </div>
                  );
                })
              : null}
          </nav>
          <div className="my-3 h-px shrink-0 bg-slate-200/80 dark:bg-white/10" />
          <div className="max-h-[45%] min-h-[180px] shrink-0 overflow-y-auto pb-6">
            {recentActivityPanel}
          </div>
        </>
      )}
    </div>
  );

  const sessionsPanel =
    !leftRailCollapsed && activeCourse ? (
      <LearnCourseSidebar
        course={{
          name: activeCourse.name,
          code: activeCourse.courseCode,
        }}
        sessions={learnSessions.map((session) => ({
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
          meta: formatLearnSessionMeta(session.updatedAt),
          deleting: deletingLearnSessionIds.includes(session.id),
          deleteDisabled:
            sending ||
            (learnSessions.length <= 1 &&
              session.id === activeSessionId &&
              learnSessionIsBlank(messages)),
        }))}
        activeSessionId={activeSessionId}
        totalCount={activeLearnSessionListState.totalCount}
        loading={activeLearnSessionListState.loading && learnSessions.length === 0}
        hasMore={activeLearnSessionListState.hasMore}
        error={activeLearnSessionListState.error}
        interactionDisabled={sending}
        onShowAllCourses={() => router.push('/learn')}
        onCreateSession={createNewLearnSession}
        onSelectSession={(session) => selectLearnSession(session.id)}
        onDeleteSession={(session) => {
          const target = learnSessions.find((item) => item.id === session.id);
          if (target) setPendingDeleteLearnSession(target);
        }}
        onShowAllSessions={() => setAllSessionsDialogOpen(true)}
        onRetry={() => setLearnSessionListRefreshAttempt((current) => current + 1)}
        onCollapse={() => persistLeftRailCollapsed(true)}
      />
    ) : (
      legacySessionsPanel
    );

  const courseToolButtons = [
    {
      key: 'overview',
      label: '概览',
      Icon: Target,
      active: rightRailView === 'overview',
      onSelect: () => {
        setRightRailView('overview');
        persistRightRailCollapsed(false);
      },
    },
    {
      key: 'calendar',
      label: '日历',
      Icon: CalendarDays,
      active: rightRailView === 'calendar',
      onSelect: () => {
        setRightRailView('calendar');
        persistRightRailCollapsed(false);
      },
    },
  ] as const;

  const compactCourseToolsPanel = (
    <div className="flex min-h-0 flex-1 flex-col items-center bg-slate-50/80 px-1 py-3 dark:bg-slate-950/40">
      <span
        className="mb-3 grid size-9 place-items-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200/80 dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/10"
        title="课程工具"
        aria-hidden="true"
      >
        <Target className="size-4" strokeWidth={1.75} />
      </span>
      <nav
        className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto"
        aria-label="课程工具"
      >
        {courseToolButtons.map(({ key, label, Icon, active, onSelect }) => (
          <button
            key={key}
            type="button"
            onClick={onSelect}
            className={cn(
              'flex size-10 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm ring-1 ring-border/70 transition hover:text-foreground',
              active
                ? 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-400/10 dark:text-sky-200 dark:ring-sky-300/20'
                : null,
            )}
            aria-label={label}
            title={label}
          >
            <Icon className="size-[18px]" strokeWidth={1.75} />
          </button>
        ))}
      </nav>
    </div>
  );

  const courseContextPanel = (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col bg-slate-50/80 transition-[padding] duration-300 dark:bg-slate-950/40',
        rightRailCollapsed ? 'items-center px-1 py-3' : 'px-4 py-5',
      )}
    >
      {rightRailCollapsed ? (
        <>
          <button
            type="button"
            onClick={() => persistRightRailCollapsed(false)}
            className="mb-3 flex size-9 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm ring-1 ring-border/70 transition hover:text-foreground"
            aria-label="展开右侧栏"
            title="展开右侧栏"
          >
            <ChevronLeft className="size-4" strokeWidth={1.75} />
          </button>
          <nav
            className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto"
            aria-label="课程工具"
          >
            {courseToolButtons.map(({ key, label, Icon, active, onSelect }) => (
              <button
                key={key}
                type="button"
                onClick={onSelect}
                className={cn(
                  'flex size-10 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm ring-1 ring-border/70 transition hover:text-foreground',
                  active
                    ? 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-400/10 dark:text-sky-200 dark:ring-sky-300/20'
                    : null,
                )}
                aria-label={label}
                title={label}
              >
                <Icon className="size-[18px]" strokeWidth={1.75} />
              </button>
            ))}
          </nav>
        </>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold tracking-[-0.01em] text-slate-950 dark:text-white">
                课程工具
              </p>
            </div>
            <button
              type="button"
              onClick={() => persistRightRailCollapsed(true)}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm ring-1 ring-border/70 transition hover:text-foreground"
              aria-label="收起右侧栏"
              title="收起右侧栏"
            >
              <ChevronRight className="size-4" strokeWidth={1.75} />
            </button>
          </div>

          <nav
            className="mt-4 grid grid-cols-2 gap-[3px] rounded-[10px] bg-slate-100/80 p-[3px] dark:bg-white/5"
            aria-label="课程工具"
          >
            {courseToolButtons.map(({ key, label, Icon, active, onSelect }) => (
              <button
                key={key}
                type="button"
                onClick={onSelect}
                className={cn(
                  'flex min-w-0 flex-col items-center gap-[3px] rounded-[8px] px-1 py-[7px] text-[11px] font-medium text-slate-500 transition hover:bg-white/70 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-white',
                  active &&
                    'bg-white text-slate-950 shadow-[0_3px_10px_rgba(72,61,47,0.08)] dark:bg-slate-950 dark:text-slate-50',
                )}
                aria-pressed={active}
              >
                <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </nav>

          {rightRailView === 'calendar' ? (
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-6">
              {learningCalendarPanel}

              <section className={cn(rightRailCardClassName, 'mt-3 p-3')}>
                <div className="flex items-center gap-2">
                  <CalendarDays className="size-4 text-muted-foreground" strokeWidth={1.8} />
                  <p className="text-sm font-semibold text-foreground">日历操作</p>
                </div>
                <div className="mt-3 space-y-2">
                  <button
                    type="button"
                    onClick={() => void clearLearningCalendar()}
                    disabled={calendarMutating}
                    className={cn(
                      rightRailRowClassName,
                      'flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-100 dark:hover:border-white/15 dark:hover:bg-white/10 dark:focus-visible:ring-sky-300/20',
                    )}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-white text-slate-600 shadow-sm ring-1 ring-slate-200/80 dark:bg-white/10 dark:text-slate-200 dark:ring-white/10">
                      <Trash2 className="size-4" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-foreground">清空日历</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        移除当前课程的全部日程
                      </span>
                    </span>
                    <ChevronRight
                      className="size-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={1.8}
                    />
                  </button>

                  {canManageCourseContent ? (
                    <button
                      type="button"
                      onClick={openSyllabusUploadDialog}
                      className={cn(
                        rightRailRowClassName,
                        'flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-100 dark:hover:border-white/15 dark:hover:bg-white/10 dark:focus-visible:ring-sky-300/20',
                      )}
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-white text-slate-600 shadow-sm ring-1 ring-slate-200/80 dark:bg-white/10 dark:text-slate-200 dark:ring-white/10">
                        <UploadCloud className="size-4" strokeWidth={1.8} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-foreground">
                          {syllabusEvents.length > 0 ? '重新上传 syllabus' : '上传 syllabus'}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {syllabusEvents.length > 0
                            ? '从 syllabus 重新导入课程日程'
                            : '从 syllabus 导入课程日程'}
                        </span>
                      </span>
                      <ChevronRight
                        className="size-3.5 shrink-0 text-muted-foreground"
                        strokeWidth={1.8}
                      />
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={openManualScheduleDialog}
                    className={cn(
                      rightRailRowClassName,
                      'flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-100 dark:hover:border-white/15 dark:hover:bg-white/10 dark:focus-visible:ring-sky-300/20',
                    )}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-white text-slate-600 shadow-sm ring-1 ring-slate-200/80 dark:bg-white/10 dark:text-slate-200 dark:ring-white/10">
                      <Plus className="size-4" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-foreground">添加活动</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        手动添加一项学习日程
                      </span>
                    </span>
                    <ChevronRight
                      className="size-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={1.8}
                    />
                  </button>
                </div>
              </section>
            </div>
          ) : null}

          {rightRailView === 'overview' ? (
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-6">
              <section className={cn(rightRailCardClassName, 'p-3')}>
                <CourseLearningProgressPanel
                  notebooks={notebooks}
                  loading={
                    notebooks.length === 0 &&
                    notebooksLoadState.status !== 'empty' &&
                    (notebooksLoadState.status === 'loading' ||
                      (activeCourseContentState?.notebooks.count || 0) > 0)
                  }
                  selection={
                    progressSelection ||
                    progressSelectionFromSnapshot(snapshot) ||
                    PROGRESS_SELECTION_NOT_STARTED
                  }
                  notStartedToken={PROGRESS_SELECTION_NOT_STARTED}
                  completedAllToken={PROGRESS_SELECTION_COMPLETED_ALL}
                  onProgressChange={(selection) => {
                    updateLearningPosition(selection);
                  }}
                  onOpenNotebook={openNotebookFromProgress}
                />
              </section>

              <section className={cn(rightRailCardClassName, 'mt-3 p-3')}>
                <div className="flex items-center gap-2">
                  <LibraryBig className="size-4 text-muted-foreground" strokeWidth={1.8} />
                  <p className="text-sm font-semibold text-foreground">资料库</p>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  查看这门课已经开放的笔记本与学习资料。
                </p>
                <button
                  type="button"
                  onClick={openNotebookLibraryPanel}
                  className={cn(
                    rightRailRowClassName,
                    'mt-3 flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-100 dark:hover:border-white/15 dark:hover:bg-white/10 dark:focus-visible:ring-sky-300/20',
                  )}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-white text-slate-600 shadow-sm ring-1 ring-slate-200/80 dark:bg-white/10 dark:text-slate-200 dark:ring-white/10">
                    <BookOpen className="size-4" strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-foreground">打开资料库</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {resourceCountText(notebooksLoadState, notebooks.length)} 本课程笔记
                    </span>
                  </span>
                  <ChevronRight
                    className="size-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.8}
                  />
                </button>
              </section>

              {activeCourse && canManageCourseContent ? (
                <section className={cn(rightRailCardClassName, 'mt-3 p-3')}>
                  <div className="flex items-center gap-2">
                    <UploadCloud className="size-4 text-muted-foreground" strokeWidth={1.8} />
                    <p className="text-sm font-semibold text-foreground">
                      {syllabusEvents.length ? '重新上传时间表' : '上传时间表'}
                    </p>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    导入课程大纲后，日历会自动带上考试、作业等安排。
                  </p>
                  <button
                    type="button"
                    onClick={openSyllabusUploadDialog}
                    className={cn(
                      rightRailRowClassName,
                      'mt-3 flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-100 dark:hover:border-white/15 dark:hover:bg-white/10 dark:focus-visible:ring-sky-300/20',
                    )}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-white text-slate-600 shadow-sm ring-1 ring-slate-200/80 dark:bg-white/10 dark:text-slate-200 dark:ring-white/10">
                      <FileText className="size-4" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-foreground">
                        {syllabusEvents.length ? '重新上传时间表' : '点击上传'}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        图片 / PDF / 文本均可
                      </span>
                    </span>
                    <ChevronRight
                      className="size-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={1.8}
                    />
                  </button>
                </section>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  if (showLearnHomeDashboard) {
    return (
      <>
        <LearnHomeDashboard
          courses={previewLearnHome ? LEARN_HOME_PREVIEW_COURSES : courses}
          activeCourseId={activeCourseId}
          onCreateCourse={() => setCreateCourseOpen(true)}
          onOpenCalendar={() => setCalendarDialogOpen(true)}
          onOpenUsage={() => router.push('/student/usage')}
          onOpenCourse={switchCourse}
        />
        <CreateCourseDialog
          open={createCourseOpen}
          onOpenChange={setCreateCourseOpen}
          onSuccess={handleCourseCreated}
        />
        {largeCalendarDialog}
      </>
    );
  }

  return (
    <>
      <div
        className={cn(
          'learn-course-shell grid h-full min-h-0 overflow-hidden bg-slate-50 text-foreground transition-[grid-template-columns] duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] dark:bg-slate-950',
          // Fixed left/center/right proportions at every viewport size (lg+).
          // Teachers don't use the student course-tools right rail.
          showRightRail &&
            !leftRailCollapsed &&
            !rightRailCollapsed &&
            'lg:grid-cols-[18%_minmax(0,1fr)_22%]',
          showRightRail &&
            leftRailCollapsed &&
            !rightRailCollapsed &&
            'lg:grid-cols-[4.5rem_minmax(0,1fr)_22%]',
          showRightRail &&
            !leftRailCollapsed &&
            rightRailCollapsed &&
            'lg:grid-cols-[18%_minmax(0,1fr)_4.5rem]',
          showRightRail &&
            leftRailCollapsed &&
            rightRailCollapsed &&
            'lg:grid-cols-[4.5rem_minmax(0,1fr)_4.5rem]',
          !showRightRail && !leftRailCollapsed && 'lg:grid-cols-[18%_minmax(0,1fr)]',
          !showRightRail && leftRailCollapsed && 'lg:grid-cols-[4.5rem_minmax(0,1fr)]',
        )}
      >
        <aside className="hidden min-h-0 flex-col overflow-hidden border-r border-slate-200/80 bg-slate-50 lg:flex dark:border-white/10 dark:bg-slate-950">
          {sessionsPanel}
        </aside>

        <main className="flex min-h-[70dvh] flex-col overflow-hidden bg-white lg:min-h-0 dark:bg-slate-950">
          <header className="shrink-0 border-b border-slate-200/80 bg-white/95 px-6 py-3 dark:border-white/10 dark:bg-slate-950/95">
            <div className="flex w-full items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {activeCourse ? (
                  <CourseAvatar course={activeCourse} className="size-10 rounded-[12px]" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <h1 className="min-w-0 truncate text-sm font-semibold leading-5 text-slate-950 dark:text-slate-50">
                        {activeCourse?.name || '学习聊天'}
                      </h1>
                      <p className="shrink-0 truncate text-[11px] font-medium leading-4 text-slate-400">
                        {activeCourse?.courseCode ||
                          (activeCourse ? '当前课程上下文' : '等待添加课程上下文')}
                      </p>
                      {hasCourseSyncError ? (
                        <button
                          type="button"
                          onClick={retryFailedCourseContent}
                          className={cn(
                            'inline-flex h-6 min-w-0 items-center gap-1.5 rounded-[8px] border px-2 text-left text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2',
                            courseSyncUsesLocalFallback
                              ? 'border-amber-200/80 bg-amber-50/80 text-amber-800 hover:bg-amber-100 focus-visible:ring-amber-300 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100 dark:hover:bg-amber-400/15'
                              : 'border-rose-200/80 bg-rose-50/80 text-rose-700 hover:bg-rose-100 focus-visible:ring-rose-300 dark:border-rose-300/20 dark:bg-rose-400/10 dark:text-rose-100 dark:hover:bg-rose-400/15',
                          )}
                          title={courseSyncErrorTitle}
                        >
                          <RefreshCw className="size-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">
                            {courseSyncUsesLocalFallback
                              ? '对话同步异常，点击重试'
                              : '部分内容同步失败，点击重试'}
                          </span>
                        </button>
                      ) : null}
                      {activeCourseSourceHealthNotice ? (
                        <button
                          type="button"
                          onClick={openSourceUploadPanel}
                          className={cn(
                            'inline-flex h-6 min-w-0 items-center gap-1.5 rounded-[8px] border px-2 text-left text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2',
                            activeCourseSourceHealthNotice.tone === 'error'
                              ? 'border-rose-200/80 bg-rose-50/80 text-rose-700 hover:bg-rose-100 focus-visible:ring-rose-300 dark:border-rose-300/20 dark:bg-rose-400/10 dark:text-rose-100 dark:hover:bg-rose-400/15'
                              : 'border-amber-200/80 bg-amber-50/80 text-amber-800 hover:bg-amber-100 focus-visible:ring-amber-300 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100 dark:hover:bg-amber-400/15',
                          )}
                          title={activeCourseSourceHealthNotice.detail}
                          aria-label={`${activeCourseSourceHealthNotice.label}，打开原始讲义库`}
                          data-testid="learn-source-health-warning"
                        >
                          {activeCourseSourceHealthNotice.tone === 'error' ? (
                            <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
                          ) : (
                            <Loader2
                              className="size-3 shrink-0 animate-spin motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                          )}
                          <span className="truncate">{activeCourseSourceHealthNotice.label}</span>
                        </button>
                      ) : null}
                    </div>
                    {activeCourse ? (
                      <div
                        className="mt-1 flex min-w-0 flex-wrap items-center gap-1"
                        role="status"
                        aria-live="polite"
                        aria-label={learnSurfaceStatusItems
                          .map((item) => `${item.label}${item.statusLabel}`)
                          .join('，')}
                        data-testid="learn-surface-status"
                      >
                        {learnSurfaceStatusItems.map((item) => (
                          <span
                            key={item.key}
                            className={cn(
                              'inline-flex h-5 min-w-0 items-center gap-1 rounded-full border px-1.5 text-[9px] font-semibold leading-none',
                              item.status === 'loading' &&
                                'border-slate-200/80 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-300',
                              item.status === 'deferred' &&
                                'border-slate-200/80 bg-white text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-300',
                              item.status === 'ready' &&
                                'border-emerald-200/80 bg-emerald-50/80 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-400/10 dark:text-emerald-100',
                              item.status === 'empty' &&
                                'border-slate-200/80 bg-white text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-300',
                              item.status === 'local' &&
                                'border-amber-200/80 bg-amber-50/80 text-amber-700 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100',
                              item.status === 'error' &&
                                'border-rose-200/80 bg-rose-50/80 text-rose-700 dark:border-rose-300/20 dark:bg-rose-400/10 dark:text-rose-100',
                            )}
                            title={
                              item.detail
                                ? `${item.label}：${item.statusLabel}\n${item.detail}`
                                : `${item.label}：${item.statusLabel}`
                            }
                          >
                            {item.status === 'loading' ? (
                              <Loader2
                                className="size-2.5 shrink-0 animate-spin motion-reduce:animate-none"
                                aria-hidden="true"
                              />
                            ) : item.status === 'deferred' ? (
                              <BookOpen
                                className="size-2.5 shrink-0"
                                strokeWidth={1.8}
                                aria-hidden="true"
                              />
                            ) : item.status === 'error' || item.status === 'local' ? (
                              <AlertTriangle className="size-2.5 shrink-0" aria-hidden="true" />
                            ) : (
                              <CheckCircle2 className="size-2.5 shrink-0" aria-hidden="true" />
                            )}
                            <span className="truncate">{item.label}</span>
                            <span className="truncate opacity-75">{item.statusLabel}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {activeCourse ? (
                  <>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="size-9 rounded-[11px] border-slate-200 bg-white shadow-sm lg:hidden dark:border-white/10 dark:bg-white/5"
                          aria-label="打开课程导航"
                        >
                          <MoreHorizontal className="size-4" strokeWidth={1.9} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        sideOffset={8}
                        className="w-60 rounded-[14px] p-1.5"
                      >
                        <DropdownMenuLabel>课程导航</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => router.push('/learn')}>
                          <ArrowLeft className="size-4" strokeWidth={1.8} />
                          所有课程
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={sending}
                          onSelect={hasActiveCourse ? createNewLearnSession : undefined}
                        >
                          <MessageSquarePlus className="size-4" strokeWidth={1.8} />
                          新对话
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setAllSessionsDialogOpen(true)}>
                          <MessageCircle className="size-4" strokeWidth={1.8} />
                          会话历史
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {courseRailTools.map((tool) => {
                          const Icon = tool.Icon;
                          return (
                            <DropdownMenuItem key={tool.label} onSelect={tool.onSelect}>
                              <Icon className="size-4" strokeWidth={1.8} />
                              {tool.label}
                              <DropdownMenuShortcut className="max-w-28 truncate tracking-normal">
                                {tool.description}
                              </DropdownMenuShortcut>
                            </DropdownMenuItem>
                          );
                        })}
                        {!missingLearningSetup && !snapshot?.progressKnown ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => addProgressRequestMessage({ snapshot })}
                            >
                              <Target className="size-4" strokeWidth={1.8} />
                              {isResearchCourse ? '更新研究进度' : '更新学习进度'}
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>

                    {!isTeacherCourseChat ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={() => setMemoryActivityDialogOpen(true)}
                            className="learn-memory-orb-button size-9 rounded-full border-transparent p-0 text-white shadow-sm hover:text-white focus-visible:ring-sky-200"
                            data-memory-state={platformMemoryState}
                            aria-label={platformMemoryButtonLabel}
                          >
                            <span className="learn-memory-orb-core" aria-hidden="true">
                              <span className="learn-memory-orb-ribbon learn-memory-orb-ribbon-a" />
                              <span className="learn-memory-orb-ribbon learn-memory-orb-ribbon-b" />
                              <span className="learn-memory-orb-ribbon learn-memory-orb-ribbon-c" />
                              <span className="learn-memory-orb-star" />
                            </span>
                            {platformMemoryBadgeCount > 0 ? (
                              <span
                                className={cn(
                                  'absolute -right-1.5 -top-1.5 z-20 grid min-w-5 place-items-center rounded-full border border-white px-1 text-[10px] font-bold leading-5 shadow-sm dark:border-slate-950',
                                  platformMemoryState === 'writing'
                                    ? 'bg-amber-400 text-amber-950'
                                    : 'bg-sky-500 text-white',
                                )}
                                aria-hidden="true"
                              >
                                {platformMemoryBadgeCount > 9 ? '9+' : platformMemoryBadgeCount}
                              </span>
                            ) : null}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="end" className="font-medium">
                          {platformMemoryTooltip}
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          </header>

          <div
            ref={conversationScrollContainerRef}
            onScroll={handleConversationScroll}
            className="min-h-0 flex-1 overflow-y-auto bg-white px-6 py-5 dark:bg-slate-950"
          >
            <div className="flex min-h-full w-full flex-col gap-4">
              {remoteConversationMessagePage?.hasMore || remoteConversationMessagePage?.error ? (
                <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadOlderLearnMessages()}
                    disabled={remoteConversationMessagePage.loading}
                    className="h-8 rounded-full px-3 text-xs"
                  >
                    {remoteConversationMessagePage.loading ? (
                      <Loader2
                        className="size-3.5 animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronUp className="size-3.5" aria-hidden="true" />
                    )}
                    {remoteConversationMessagePage.loading
                      ? '正在加载更早消息…'
                      : remoteConversationMessagePage.error
                        ? '重试加载更早消息'
                        : '加载更早消息'}
                  </Button>
                  {remoteConversationMessagePage.error ? (
                    <p
                      className="text-center text-[11px] text-amber-700 dark:text-amber-200"
                      role="status"
                    >
                      {remoteConversationMessagePage.error}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {remoteConversationSummary?.text.trim() ? (
                <section
                  className="mx-auto w-full max-w-3xl rounded-[12px] border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-xs leading-5 text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300"
                  aria-label="较早对话摘要"
                >
                  <p className="font-semibold text-slate-800 dark:text-slate-100">较早对话摘要</p>
                  <p className="mt-1 whitespace-pre-wrap">{remoteConversationSummary.text}</p>
                </section>
              ) : null}
              {visibleMessages.length === 0 && !sending ? (
                <div className="learn-empty-ambient relative isolate flex min-h-[420px] flex-1 items-center justify-center overflow-hidden">
                  <span className="learn-empty-spotlight learn-empty-spotlight-main" aria-hidden />
                  <span
                    className="learn-empty-spotlight learn-empty-spotlight-accent"
                    aria-hidden
                  />
                  <div
                    className="learn-empty-center relative z-10 flex max-w-2xl flex-col items-center gap-4 px-3 text-center"
                    style={{
                      background: 'transparent',
                      borderColor: 'transparent',
                      boxShadow: 'none',
                      backdropFilter: 'none',
                    }}
                  >
                    <div className="learn-empty-avatar relative">
                      {activeCourse ? (
                        <CourseAvatar course={activeCourse} className="size-14 rounded-[18px]" />
                      ) : (
                        <div className="grid size-14 place-items-center rounded-[18px] bg-sky-50 text-sky-700 ring-1 ring-sky-100 dark:bg-sky-400/10 dark:text-sky-100 dark:ring-sky-300/15">
                          <MessageSquarePlus className="size-6" strokeWidth={1.8} />
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                        {activeCourse?.courseCode ||
                          (activeCourse
                            ? isTeacherCourseChat
                              ? 'Teacher assistant'
                              : 'Student assistant'
                            : 'General chat')}
                      </p>
                      <p className="mt-1 text-lg font-semibold tracking-normal text-slate-950 dark:text-slate-50">
                        {!activeCourse
                          ? '添加课程后开始聊天'
                          : isTeacherCourseChat
                            ? '想核对哪份课程资料？'
                            : '想查哪一本课程笔记？'}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        {!activeCourse
                          ? '添加课程后，我会把聊天、复习、题库和记忆都绑定到对应课程。'
                          : isTeacherCourseChat
                            ? '回答前会先核对笔记本正文与 Hard Rule，不读取题库，也不会改写学生学习状态。'
                            : '回答前会核对已开放的笔记本与 Hard Rule；不加载题库，也不记录薄弱点。日历变更会先请你确认。'}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2" aria-label="快捷入口">
                      {(activeCourse ? activeQuickPrompts : ['添加一门课程', '去课程商城']).map(
                        (prompt) => (
                          <Button
                            key={prompt}
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (prompt === '添加一门课程') {
                                setCreateCourseOpen(true);
                                return;
                              }
                              if (prompt === '去课程商城') {
                                router.push('/store/courses');
                                return;
                              }
                              updateComposerDraft(prompt);
                              window.requestAnimationFrame(() => draftTextareaRef.current?.focus());
                            }}
                            className="h-8 rounded-full border-slate-200/80 bg-white/76 px-3 text-xs shadow-sm backdrop-blur-sm hover:bg-white dark:border-white/10 dark:bg-white/8 dark:hover:bg-white/12"
                          >
                            {prompt}
                          </Button>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
              {visibleMessages.map((message, messageIndex) => {
                const displayText =
                  message.role === 'assistant' &&
                  message.plan &&
                  isProblemSelectionPlan(message.plan)
                    ? selectedPracticeIntro(message.plan)
                    : repairStalePracticeSelectionMessageText(message.text);
                const miniLecturePrompt = miniLecturePromptForMessage({
                  messages: visibleMessages,
                  messageIndex,
                  course: activeCourse,
                });

                return (
                  <ContextMenu key={message.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        className={cn(
                          message.role === 'user'
                            ? 'ml-auto max-w-[82%] rounded-[15px_6px_15px_15px] bg-[#4d4a43] px-3 py-2.5 text-[12px] leading-[1.65] text-[#f8f5ee] shadow-[0_7px_20px_rgba(70,61,48,0.05)] dark:bg-slate-100 dark:text-slate-950'
                            : 'mr-auto flex max-w-[82%] items-start gap-[9px]',
                        )}
                      >
                        {message.role === 'user' ? (
                          <>
                            {message.attachments?.length ? (
                              <div className="mb-2 grid max-w-full grid-cols-2 gap-2">
                                {message.attachments.map((attachment) =>
                                  attachment.mimeType.startsWith('image/') &&
                                  attachment.objectUrl ? (
                                    <img
                                      key={attachment.id}
                                      src={attachment.objectUrl}
                                      alt={attachment.name}
                                      className="max-h-40 w-full rounded-lg border border-white/15 object-cover"
                                    />
                                  ) : attachment.objectUrl ? (
                                    <div
                                      key={attachment.id}
                                      className="flex min-h-16 min-w-0 items-center gap-2.5 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5"
                                    >
                                      <span
                                        className={cn(
                                          'grid size-9 shrink-0 place-items-center rounded-lg bg-white/10',
                                          attachment.mimeType === 'application/pdf'
                                            ? 'text-rose-300'
                                            : 'text-white/70',
                                        )}
                                      >
                                        <FileText className="size-5" />
                                      </span>
                                      <span className="min-w-0 text-left">
                                        <span className="block truncate text-xs font-medium text-white">
                                          {attachment.name}
                                        </span>
                                        <span className="mt-0.5 block text-[10px] text-white/55">
                                          {learnChatAttachmentTypeLabel(attachment)} · 仅当前设备
                                        </span>
                                      </span>
                                    </div>
                                  ) : (
                                    <div
                                      key={attachment.id}
                                      className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-lg border border-white/15 bg-white/10 px-3 text-center text-xs text-white/75"
                                      title="附件原件只保存在上传设备；当前浏览器未找到本地副本。"
                                    >
                                      <FileText className="size-5" />
                                      <span className="max-w-full truncate">{attachment.name}</span>
                                      <span className="text-[10px] text-white/55">
                                        当前设备未找到附件
                                      </span>
                                    </div>
                                  ),
                                )}
                              </div>
                            ) : null}
                            <p className="select-text whitespace-pre-wrap">{message.text}</p>
                          </>
                        ) : (
                          <>
                            {activeCourse ? (
                              <CourseAvatar
                                course={activeCourse}
                                className="size-7 rounded-[9px]"
                              />
                            ) : (
                              <div className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-sky-50 text-sky-700 ring-1 ring-sky-100 dark:bg-sky-400/10 dark:text-sky-100 dark:ring-sky-300/15">
                                <MessageSquarePlus className="size-4" strokeWidth={1.8} />
                              </div>
                            )}
                            <div className="min-w-0 flex-1 select-text rounded-[6px_15px_15px] border border-[#4d473e]/[0.08] bg-white px-3 py-2.5 shadow-[0_7px_20px_rgba(70,61,48,0.05)] dark:border-white/10 dark:bg-white/5">
                              {message.contextCompression ? (
                                <ChatContextCompressionNotice
                                  compression={message.contextCompression}
                                />
                              ) : null}
                              {shouldDisplayPublicTrace(message) ? (
                                <LearnPublicTraceCard
                                  steps={message.publicTrace}
                                  transient={message.transient}
                                />
                              ) : null}
                              {displayText ? (
                                <MessageResponse
                                  className={courseMarkdownClassName}
                                  mode={message.transient ? 'streaming' : 'static'}
                                >
                                  {normalizeAssistantMarkdown(displayText)}
                                </MessageResponse>
                              ) : null}
                              {message.plan ? (
                                <PlanActionCard
                                  plan={message.plan}
                                  problemsState={problemsLoadState}
                                  disabled={!conversationInteractive}
                                  sessionSummary={practiceSessionSummaryByPlanId.get(
                                    message.plan.id,
                                  )}
                                  onStart={startPlan}
                                />
                              ) : null}
                              {message.artifacts?.length ? (
                                <LearnArtifactCards
                                  artifacts={message.artifacts}
                                  actions={message.learningActions}
                                  courseId={activeCourse?.id}
                                  disabled={!conversationInteractive}
                                  isResearchCourse={isResearchCourse}
                                  onConfirmCalendarAction={handleLearningActionConfirm}
                                />
                              ) : null}
                              {message.progressProposal ? (
                                <ProgressConfirmationCard
                                  proposal={message.progressProposal}
                                  notebooks={notebooks}
                                  disabled={!conversationInteractive}
                                  onSelectionChange={(selection) =>
                                    updateMessageProgressProposal(message.id, selection)
                                  }
                                  onConfirm={() =>
                                    confirmMessageProgressProposal(
                                      message.id,
                                      message.progressProposal?.selection || '',
                                    )
                                  }
                                  onDismiss={() => dismissMessageProgressProposal(message.id)}
                                />
                              ) : null}
                              {miniLecturePrompt || message.lectureDeck ? (
                                <MiniLectureInviteCard
                                  prompt={miniLecturePrompt}
                                  deck={message.lectureDeck}
                                  generating={generatingMiniLectureMessageId === message.id}
                                  disabled={!conversationInteractive}
                                  onGenerate={() => generateMiniLectureForMessage(message.id)}
                                  onOpen={openMiniLectureDeck}
                                />
                              ) : null}
                              {message.learningActions?.length ? (
                                <LearnLearningActionCards
                                  actions={visibleLearningActionsForArtifacts(
                                    message.learningActions,
                                    message.artifacts,
                                  )}
                                  disabled={!conversationInteractive}
                                  onConfirm={handleLearningActionConfirm}
                                  onCancel={handleLearningActionCancel}
                                  onReviewModeChoice={(action, choice) => {
                                    if (!conversationInteractive) return;
                                    markLearningActionStatus(
                                      action.id,
                                      'completed',
                                      actionResult(action, {
                                        status: 'completed',
                                        summary: `已选择复习方式：${choice.label}`,
                                        input: { payload: action.payload || {}, choice },
                                        output: { followupText: choice.followupText },
                                      }),
                                    );
                                    void sendMessage(choice.followupText);
                                  }}
                                />
                              ) : null}
                            </div>
                          </>
                        )}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-40">
                      <ContextMenuItem onSelect={() => void copyLearnMessage(message)}>
                        <Copy className="size-4" />
                        复制消息
                      </ContextMenuItem>
                      <ContextMenuItem
                        variant="destructive"
                        onSelect={() => deleteLearnMessage(message.id)}
                      >
                        <Trash2 className="size-4" />
                        删除消息
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
              {sending &&
              !messages.some((message) => message.transient && message.publicTrace?.length) ? (
                <div className="mr-auto flex items-center gap-2 rounded-full bg-slate-50 px-3 py-2 text-sm text-slate-500 ring-1 ring-slate-200 dark:bg-white/5 dark:ring-white/10">
                  <Loader2 className="size-4 animate-spin" />
                  课程正在整理回答…
                </div>
              ) : null}
              {sourceUploading ? (
                <div className="mr-auto flex items-center gap-2 rounded-full bg-sky-50 px-3 py-2 text-sm text-sky-700 ring-1 ring-sky-100 dark:bg-sky-400/10 dark:text-sky-100 dark:ring-sky-300/15">
                  <Loader2 className="size-4 animate-spin" />
                  正在摄取原始讲义…
                </div>
              ) : null}
            </div>
          </div>

          <footer className="shrink-0 border-t border-slate-100 bg-gradient-to-t from-white via-white to-white/85 px-6 pb-4 pt-3 dark:border-white/5 dark:from-slate-950 dark:via-slate-950 dark:to-slate-950/85">
            <div className="w-full">
              <div
                className={cn(
                  composerInputShellClassName,
                  'rounded-[24px] border-slate-200/90 bg-white/95 px-2.5 py-2 shadow-[0_12px_36px_rgba(15,23,42,0.08)] focus-within:border-slate-300 focus-within:shadow-[0_16px_44px_rgba(15,23,42,0.12)] dark:border-white/12 dark:bg-slate-900/95',
                )}
              >
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*,.pdf,.txt,.md,.markdown,.csv,.json,.xml,application/pdf,application/json,application/xml,text/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void handleChatAttachmentFiles(event.currentTarget.files);
                    event.currentTarget.value = '';
                  }}
                />
                {canManageCourseContent ? (
                  <input
                    ref={sourceDocumentInputRef}
                    type="file"
                    accept=".pdf,.pptx,.docx,.txt,.md,.markdown,.csv,.json,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      void handleLearnUploadFiles(event.currentTarget.files);
                      event.currentTarget.value = '';
                    }}
                  />
                ) : null}
                {attachments.length > 0 ? (
                  <div className="mb-2 flex gap-2 overflow-x-auto px-1 pb-2">
                    {attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="group relative flex h-[74px] min-w-[240px] basis-[calc(50%-0.25rem)] items-center gap-3 rounded-[18px] border border-slate-200 bg-white px-3.5 pr-10 shadow-[0_3px_12px_rgba(15,23,42,0.035)] dark:border-white/10 dark:bg-white/5"
                      >
                        {attachment.mimeType.startsWith('image/') && attachment.objectUrl ? (
                          <img
                            src={attachment.objectUrl}
                            alt={attachment.name}
                            className="size-11 shrink-0 rounded-[10px] border border-slate-200 object-cover dark:border-white/10"
                          />
                        ) : (
                          <span
                            className={cn(
                              'grid size-11 shrink-0 place-items-center rounded-[11px] bg-slate-50 dark:bg-white/5',
                              attachment.mimeType === 'application/pdf'
                                ? 'text-rose-500'
                                : 'text-slate-500 dark:text-slate-300',
                            )}
                          >
                            <FileText className="size-6" strokeWidth={1.8} />
                          </span>
                        )}
                        <span className="min-w-0 text-left">
                          <span className="block truncate text-sm font-semibold text-slate-950 dark:text-white">
                            {attachment.name}
                          </span>
                          <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                            {learnChatAttachmentTypeLabel(attachment)} · 仅本次聊天
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => removeAttachment(attachment.id)}
                          className="absolute right-2 top-2 grid size-6 place-items-center rounded-full text-slate-400 opacity-80 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white"
                          title="移除附件"
                          aria-label={`移除附件 ${attachment.name}`}
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex min-h-10 items-center gap-2">
                  {canManageCourseContent ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={!conversationInteractive}
                          title="添加内容"
                          aria-label="添加内容"
                          className="relative size-9 shrink-0 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-white/10 dark:hover:text-white"
                        >
                          {sourceUploading ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Plus className="size-4" />
                          )}
                          <SourceUploadBadge
                            uploading={sourceUploading}
                            completedCount={completedSourceUploadBadgeCount}
                            compact
                          />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-56">
                        <DropdownMenuItem onSelect={() => imageInputRef.current?.click()}>
                          <Paperclip className="size-4" />
                          添加到本次聊天
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={handleUploadButtonClick}>
                          <UploadCloud className="size-4" />
                          {sourceUploading ||
                          activeSourceUploadItems.length > 0 ||
                          completedSourceUploadBadgeCount > 0
                            ? '查看课程资料入库状态'
                            : '上传为课程资料'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={!conversationInteractive}
                      title="添加聊天附件"
                      aria-label="添加聊天附件"
                      className="relative size-9 shrink-0 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-white/10 dark:hover:text-white"
                    >
                      <Plus className="size-4" />
                    </Button>
                  )}
                  <Textarea
                    ref={draftTextareaRef}
                    rows={1}
                    value={draft}
                    onChange={(event) => updateComposerDraft(event.target.value)}
                    disabled={!conversationInteractive}
                    placeholder={
                      conversationFallbackActive
                        ? '云端同步暂时异常，恢复后会自动同步…'
                        : !conversationInteractive
                          ? '正在加载课程会话…'
                          : activeCourse
                            ? isTeacherCourseChat
                              ? `询问 ${activeCourse.courseCode || activeCourse.name} 的课程资料`
                              : `问 ${activeCourse.courseCode || activeCourse.name} 一个问题`
                            : '添加课程后开始提问'
                    }
                    className="max-h-32 min-h-9 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0 py-1.5 text-sm leading-6 shadow-none [field-sizing:fixed] focus-visible:ring-0"
                  />
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Select value={selectedModelValue} onValueChange={handleModelChange}>
                      <SelectTrigger
                        size="sm"
                        className="h-8 w-10 rounded-full border-slate-200 bg-transparent px-0 text-[11px] shadow-none sm:w-[148px] sm:px-2 dark:border-white/10"
                        aria-label="选择聊天模型"
                      >
                        <Cpu className="size-3.5 text-muted-foreground" />
                        <span className="hidden min-w-0 truncate sm:block">
                          {selectedModel.providerName} · {selectedModel.modelName}
                        </span>
                      </SelectTrigger>
                      <SelectContent align="end" className="max-h-72 w-[300px]">
                        <SelectGroup>
                          {visibleModelOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.providerName} · {option.modelName}
                              {option.vision === false ? ' · 无视觉' : ''}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="icon"
                      onClick={sending ? stopSending : () => void sendMessage()}
                      disabled={
                        sending
                          ? false
                          : (!draft.trim() && attachments.length === 0) ||
                            !activeCourse ||
                            !conversationInteractive ||
                            sourceUploading ||
                            (attachments.some((attachment) =>
                              attachment.mimeType.startsWith('image/'),
                            ) &&
                              selectedKnownNoVision)
                      }
                      className={cn(
                        'size-9 rounded-full text-white shadow-[0_10px_22px_rgba(15,23,42,0.18)] disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-white/10 dark:disabled:text-white/35',
                        sending
                          ? 'bg-rose-600 hover:bg-rose-500 dark:bg-rose-500 dark:text-white dark:hover:bg-rose-400'
                          : 'bg-slate-950 hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200',
                      )}
                      aria-label={sending ? '停止生成' : '发送'}
                      title={sending ? '停止生成' : '发送'}
                    >
                      {sending ? (
                        <Square className="size-3.5 fill-current" />
                      ) : (
                        <SendHorizontal className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
                {conversationFallbackActive ? (
                  <p
                    role="status"
                    aria-live="polite"
                    className="mt-2 px-1 text-[11px] leading-5 text-amber-700 dark:text-amber-200"
                  >
                    云端会话同步暂时异常；系统会自动重试，也可以点击页头立即重试。
                  </p>
                ) : null}
                {attachments.some((attachment) => attachment.mimeType.startsWith('image/')) &&
                selectedKnownNoVision ? (
                  <p className="mt-2 px-1 text-xs text-destructive">当前模型不支持图片</p>
                ) : null}
              </div>
              {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
              {retryTurn && !sending ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void sendMessage(retryTurn.text, retryTurn.attachments)}
                  className="mt-1.5 h-8 gap-1.5 rounded-full px-3 text-xs text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"
                >
                  <RefreshCw className="size-3.5" />
                  重新发送上一条
                </Button>
              ) : null}
            </div>
          </footer>
        </main>

        {showRightRail ? (
          <aside className="hidden min-h-0 flex-col overflow-hidden border-l border-border/70 bg-background lg:flex">
            <div className="flex min-h-0 flex-1 xl:hidden">{compactCourseToolsPanel}</div>
            <div className="hidden min-h-0 flex-1 xl:flex">{courseContextPanel}</div>
          </aside>
        ) : null}
      </div>
      <CreateCourseDialog
        open={createCourseOpen}
        onOpenChange={setCreateCourseOpen}
        onSuccess={handleCourseCreated}
      />
      <Dialog
        open={Boolean(pendingDeleteLearnSession)}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteLearnSession(null);
        }}
      >
        <DialogContent
          className={cn(SYNTARA_ACTION_DIALOG_CONTENT_CLASS, 'max-w-[430px] gap-0 p-0')}
        >
          <DialogHeader className={SYNTARA_DIALOG_HEADER_CLASS}>
            <DialogTitle className="text-base">删除这条会话？</DialogTitle>
            <DialogDescription className="leading-5">
              “{pendingDeleteLearnSession?.title || '这条会话'}
              ”会从本机移除；已经同步到云端的内容也会一并删除。此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2 border-t border-border/70 px-5 py-4">
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-[12px] px-4 text-xs"
              onClick={() => setPendingDeleteLearnSession(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-9 rounded-[12px] px-4 text-xs"
              onClick={() => {
                const target = pendingDeleteLearnSession;
                if (target) void deleteLearnSession(target);
              }}
            >
              <Trash2 className="size-3.5" strokeWidth={1.9} />
              删除会话
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <CourseSettingsDialog
        course={activeCourseIsOwner ? activeCourse : null}
        open={courseSettingsOpen}
        onOpenChange={(open) => {
          setCourseSettingsOpen(open);
          if (!open) setCourseSettingsTab('general');
        }}
        initialTab={courseSettingsTab}
        onCourseUpdated={handleCourseSettingsUpdated}
        onCourseDeleted={handleCourseSettingsDeleted}
      />
      <LearnAllSessionsDialog
        sessions={learnSessions.map((session) => ({
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
          deleting: deletingLearnSessionIds.includes(session.id),
          deleteDisabled:
            sending ||
            (learnSessions.length <= 1 &&
              session.id === activeSessionId &&
              learnSessionIsBlank(messages)),
        }))}
        open={allSessionsDialogOpen}
        onOpenChange={setAllSessionsDialogOpen}
        activeSessionId={activeSessionId}
        totalCount={activeLearnSessionListState.totalCount}
        loading={activeLearnSessionListState.loading}
        loadingMore={activeLearnSessionListState.loadingMore}
        hasMore={activeLearnSessionListState.hasMore}
        error={activeLearnSessionListState.error}
        onSelect={(session) => {
          setAllSessionsDialogOpen(false);
          selectLearnSession(session.id);
        }}
        onDelete={(session) => {
          const target = learnSessions.find((item) => item.id === session.id);
          if (target) setPendingDeleteLearnSession(target);
        }}
        onLoadMore={loadMoreLearnSessions}
      />
      <MiniLectureClassroomDialog
        deck={activeMiniLectureDeck}
        open={miniLectureOpen}
        onOpenChange={setMiniLectureOpen}
      />
      {practicePopupDialog}
      {syllabusImportDialog}
      {manualScheduleDialog}
      {sourceUploadStatusDialog}
      {notebookLibraryDialog}
      {courseFilesDialog}
      {platformMemoryDialog}
      {largeCalendarDialog}
      {coursePublishDialog}
    </>
  );
}
