/**
 * Shared Type Definitions for Multi-Agent Orchestration
 *
 * Defines the session-based multi-agent conversation system with
 * support for QA, Discussion, and Lecture session types.
 */

import type { UIMessage } from 'ai';
import type { ChatResponseStrength } from '@/lib/ai/chat-response-strength';

// Session Types
export type SessionType = 'qa' | 'discussion' | 'lecture';
export type SessionStatus = 'idle' | 'active' | 'interrupted' | 'completed';

export type PublicReplyProgressStepStatus = 'complete' | 'active' | 'pending';

export interface PublicReplyProgressStep {
  id: string;
  label: string;
  description?: string;
  /** Concrete, user-safe facts observed while completing this step. */
  evidence?: string[];
  status: PublicReplyProgressStepStatus;
}

export type ChatContextCompressionTrigger = 'token_budget' | 'message_count';

export type CourseChatTeachingMode = 'reply' | 'guided';

export interface CourseChatContextUsage {
  /** Effective rolling conversation history sent into the course assistant. */
  usedTokens: number;
  /** Product-level conversation-history budget before rolling compression. */
  limitTokens: number;
  estimated: true;
}

/**
 * A user-visible rolling summary of older chat turns.
 *
 * The full transcript remains in conversation storage. This object only
 * describes the smaller context sent to the model on later turns.
 */
export interface ChatContextCompression {
  version: 1;
  mode: 'student' | 'teacher';
  trigger: ChatContextCompressionTrigger;
  summary: string;
  /** Total number of older messages represented by this rolling summary. */
  compressedMessageCount: number;
  /** Number of newest messages that continued to be sent verbatim. */
  retainedMessageCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  throughMessageId: string;
  createdAt: number;
}

/**
 * Metadata attached to chat messages
 */
export interface ChatMessageMetadata {
  senderName?: string;
  senderAvatar?: string;
  originalRole?: 'teacher' | 'agent' | 'user';
  senderKind?: 'orchestrator' | 'notebook' | 'agent' | 'system';
  groupEvent?: 'created' | 'members_added' | 'handoff' | 'summary';
  groupEventSummary?: string;
  groupEventDetail?: string;
  mentionedParticipantIds?: string[];
  mentionedParticipantDetails?: Array<{
    id: string;
    kind?: 'orchestrator' | 'notebook' | 'agent';
    name: string;
    avatarUrl?: string | null;
  }>;
  dispatchVerb?: string;
  dispatchNote?: string;
  dispatchPrompt?: string;
  sourceReferences?: Array<{
    notebookId?: string;
    notebookName?: string;
    order: number;
    title: string;
    why?: string;
  }>;
  actions?: MessageAction[];
  learningActions?: LearningAction[];
  artifacts?: LearnArtifact[];
  /** 用户消息附带的文件（仅展示，不参与模型协议字段） */
  attachments?: Array<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    /** 本会话内用于打开预览；持久化前应剥离 */
    objectUrl?: string;
  }>;
  agentId?: string;
  agentColor?: string;
  createdAt?: number;
  /** true while the assistant response is still receiving stream deltas */
  streaming?: boolean;
  /** Runtime-only placeholder while a reply is preparing; not a real answer. */
  progressOnly?: boolean;
  /** Public, user-safe waiting progress. This must never expose hidden model reasoning. */
  publicProgressSteps?: PublicReplyProgressStep[];
  statusText?: string;
  interrupted?: boolean;
  /** Rolling conversation summary used for subsequent model context. */
  contextCompression?: ChatContextCompression;
}

export interface CourseChatParticipant {
  id: string;
  kind: 'orchestrator' | 'notebook' | 'agent';
  name: string;
  avatarUrl?: string | null;
  joinedAt: number;
}

export interface CourseChatGroupMeta {
  version: 1;
  groupId: string;
  name: string;
  participants: CourseChatParticipant[];
  createdReason?: string;
  workingMemory?: CourseChatWorkingMemory;
  lastRoutingReason?: string;
  memberSummary?: string;
  lastMessagePreview?: string;
  lastActiveAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface CourseChatWorkingMemory {
  lastUserQuestion?: string;
  dispatchSummary?: string;
  recentSources?: Array<{
    notebookId?: string;
    notebookName?: string;
    order: number;
    title: string;
  }>;
  updatedAt: number;
}

/**
 * Action buttons that can be attached to messages
 */
export interface MessageAction {
  id: string;
  label: string;
  icon?: string;
  variant?: 'spotlight' | 'highlight' | 'reset' | 'insert' | 'draw';
}

export type LearningActionKind =
  | 'calendar.propose_add'
  | 'calendar.propose_update'
  | 'calendar.propose_delete'
  | 'calendar.search'
  | 'calendar.start_recent'
  | 'memory.search'
  | 'web.search'
  | 'review_mode.request_choice'
  | 'learner_progress.request_confirmation'
  | 'practice.propose_generation'
  | 'classroom.propose_temporary_explanation'
  | 'image.propose_generation'
  | 'memory.propose_write';

export type LearningActionStatus = 'proposed' | 'confirmed' | 'cancelled' | 'completed' | 'failed';

export type LearningActionConfirmation = 'none' | 'optional' | 'required';

export interface LearningActionExecutionResult {
  status: LearningActionStatus;
  executor: 'learn-client' | 'server' | 'simulator';
  executedAt: number;
  summary: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  trace?: {
    actionId: string;
    actionKind: LearningActionKind;
    courseId?: string;
    conversationId?: string;
  };
}

export interface LearningActionEvidence {
  sourceType:
    | 'notebook'
    | 'memory'
    | 'problem_bank'
    | 'calendar'
    | 'source'
    | 'web'
    | 'user'
    | 'system';
  sourceId?: string;
  title?: string;
  reason?: string;
}

export interface LearningAction {
  id: string;
  kind: LearningActionKind;
  label: string;
  summary?: string;
  status?: LearningActionStatus;
  confirmation?: LearningActionConfirmation;
  payload?: Record<string, unknown>;
  result?: LearningActionExecutionResult;
  evidence?: LearningActionEvidence[];
}

export type LearnCalendarDraftItem = {
  id?: string;
  eventId?: string;
  title: string;
  date?: string;
  start?: string;
  durationMinutes?: number;
  courseId?: string;
  reason?: string;
};

export type LearnActivityPlanTask = {
  title: string;
  kind?: 'review' | 'preview' | 'practice' | 'reading' | 'reflection' | 'catch_up' | 'other';
  concepts?: string[];
  minutes?: number;
  reason?: string;
};

export type LearnReviewFocusPoint = {
  title: string;
  explanation?: string;
  checkQuestion?: string;
};

export type LearnReviewSelfCheck = {
  question: string;
  expectedAnswer?: string;
  concept?: string;
  difficulty?: 'warmup' | 'core' | 'stretch';
};

export type LearnReviewPracticeBridge = {
  title: string;
  summary?: string;
  problemIds?: string[];
  generatedPrompts?: string[];
};

export type LearnAnswerEvidenceSource = {
  sourceType:
    | 'source'
    | 'notebook'
    | 'memory'
    | 'problem_bank'
    | 'calendar'
    | 'web'
    | 'user'
    | 'system';
  id?: string;
  sourceId?: string;
  notebookId?: string | null;
  title: string;
  previewText?: string;
  score?: number;
  metadata?: Record<string, unknown>;
};

export type LearnArtifact =
  | {
      kind: 'activity_plan';
      id: string;
      title: string;
      planType?: 'review' | 'preview' | 'study' | 'catch_up';
      tasks: LearnActivityPlanTask[];
      calendarDraftItems?: LearnCalendarDraftItem[];
      evidence?: LearnAnswerEvidenceSource[];
      scope?: {
        label?: string;
        startDate?: string;
        endDate?: string;
        eventIds?: string[];
        rationale?: string;
      };
    }
  | {
      kind: 'review_plan';
      id: string;
      title: string;
      learningGoal?: string;
      tasks: Array<{
        title: string;
        concepts?: string[];
        minutes?: number;
        reason?: string;
      }>;
      calendarDraftItems?: LearnCalendarDraftItem[];
      focusPoints?: LearnReviewFocusPoint[];
      selfChecks?: LearnReviewSelfCheck[];
      practiceBridge?: LearnReviewPracticeBridge;
      nextSteps?: string[];
    }
  | {
      kind: 'calendar_draft';
      id: string;
      title?: string;
      items: LearnCalendarDraftItem[];
      sourceArtifactId?: string;
    }
  | {
      kind: 'active_activity';
      id: string;
      activityId: string;
      title: string;
      date: string;
      source: 'calendar' | 'plan' | 'manual';
      sourceId?: string;
      courseId?: string;
      courseCode?: string;
      courseName?: string;
      eventKind?: 'assignment' | 'exam' | 'progress' | 'tutorial' | 'holiday' | 'other';
      durationMinutes?: number;
      origin?: 'syllabus' | 'ai_plan' | 'manual' | 'practice' | 'exam_prep';
      rawText?: string;
      startedAt?: number;
    }
  | {
      kind: 'web_search_result';
      id: string;
      query: string;
      sources: Array<{
        title: string;
        url: string;
        content?: string;
        score?: number;
      }>;
      answer?: string;
      usedFor?: string;
    }
  | {
      kind: 'image_prompt_draft';
      id: string;
      prompt: string;
      aspectRatio?: '16:9' | '4:3' | '1:1' | '9:16';
      sourceQuestion?: string;
      imageUrl?: string;
      width?: number;
      height?: number;
    }
  | {
      kind: 'memory_candidate';
      id: string;
      memoryType: 'weakness' | 'mastery' | 'progress' | 'preference' | 'correction' | 'next_step';
      summary: string;
      evidence?: string[];
    }
  | {
      kind: 'answer_evidence';
      id: string;
      title?: string;
      usedFor?: string;
      sources: LearnAnswerEvidenceSource[];
    };

/**
 * Chat session representing a conversation with one or more agents
 */
export interface ChatSession {
  id: string;
  type: SessionType;
  title: string;
  status: SessionStatus;
  messages: UIMessage<ChatMessageMetadata>[];
  config: SessionConfig;
  toolCalls: ToolCallRecord[];
  pendingToolCalls: ToolCallRequest[];
  createdAt: number;
  updatedAt: number;
  sceneId?: string;
  lastActionIndex?: number;
}

/**
 * Session configuration
 */
export interface SessionConfig {
  agentIds: string[];
  maxTurns: number;
  currentTurn: number;
  triggerAgentId?: string; // For discussion: first agent to speak
  defaultAgentId?: string; // For QA: the responding agent
}

/**
 * Pending tool call request sent to client for execution
 */
export interface ToolCallRequest {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  agentId: string;
  status: 'pending' | 'executing';
  requestedAt: number;
}

/**
 * Completed tool call record with result
 */
export interface ToolCallRecord {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  agentId: string;
  result?: unknown;
  error?: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  requestedAt: number;
  completedAt?: number;
}

/**
 * Server-Sent Event types for streaming session updates
 */
export type SessionEvent =
  | { type: 'message'; data: UIMessage<ChatMessageMetadata> }
  | {
      type: 'tool_request';
      data: { sessionId: string; toolCalls: ToolCallRequest[] };
    }
  | { type: 'tool_complete'; data: ToolCallRecord }
  | {
      type: 'agent_switch';
      data: { fromAgentId: string | null; toAgentId: string };
    }
  | { type: 'session_status'; data: { status: SessionStatus; reason?: string } }
  | { type: 'error'; data: { message: string } }
  | { type: 'done'; data: SessionSummary }
  | {
      type: 'text_start';
      data: { messageId: string; agentId: string; agentName: string };
    }
  | { type: 'text_delta'; data: { messageId: string; delta: string } }
  | { type: 'text_end'; data: { messageId: string; content: string } };

/**
 * Summary data sent when session completes
 */
export interface SessionSummary {
  sessionId: string;
  totalTurns: number;
  totalMessages: number;
  totalToolCalls: number;
  endReason: string;
}

/**
 * Request body for creating a new session
 */
export interface CreateSessionRequest {
  type: SessionType;
  title?: string;
  trigger: {
    message?: string;
    agentIds: string[];
    triggerAgentId?: string;
    maxTurns?: number;
  };
}

/**
 * Request body for sending a message to a session
 */
export interface SendMessageRequest {
  content: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  storeState: {
    stage: unknown;
    scenes: unknown[];
    currentSceneId: string | null;
    mode: 'autonomous' | 'playback';
    whiteboardOpen: boolean;
  };
}

/**
 * Request body for submitting tool results
 */
export interface ToolResultsRequest {
  results: ToolCallRecord[];
}

/**
 * Session list item (without full messages for efficiency)
 */
export interface SessionListItem {
  id: string;
  type: SessionType;
  title: string;
  status: SessionStatus;
  messageCount: number;
  toolCallCount: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Convert a full ChatSession to a list item (without messages)
 */
export function toSessionListItem(session: ChatSession): SessionListItem {
  return {
    id: session.id,
    type: session.type,
    title: session.title,
    status: session.status,
    messageCount: session.messages.length,
    toolCallCount: session.toolCalls.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/**
 * A single item in a lecture note — either speech text or an action badge.
 * Ordered to match the original action sequence in the scene.
 */
export type LectureNoteVisualCue =
  | {
      type: 'spotlight' | 'laser';
      actionId: string;
      elementId: string;
    }
  | {
      type: 'semantic_step';
      actionId: string;
      blockId: string;
      stepIndex: number;
    };

export type LectureNoteItem =
  | {
      kind: 'speech';
      id: string;
      actionIndex: number;
      speechIndex: number;
      text: string;
      visualCues: LectureNoteVisualCue[];
    }
  | {
      kind: 'action';
      id: string;
      actionIndex: number;
      type: string;
      label?: string;
      visualCue?: LectureNoteVisualCue;
    };

/**
 * A completed lecture note entry for one scene.
 * Built from Scene.actions, displayed in the Notes tab.
 */
export interface LectureNoteEntry {
  sceneId: string;
  sceneTitle: string;
  sceneOrder: number;
  items: LectureNoteItem[];
  completedAt: number;
}

// ==================== Stateless Multi-Agent API Types ====================

import type { Stage, Scene, StageMode } from '@/lib/types/stage';
import type { AgentTurnSummary, WhiteboardActionRecord } from '@/lib/orchestration/director-prompt';

/**
 * Accumulated director state passed between per-agent requests.
 * Client-maintained — backend is stateless.
 */
export interface DirectorState {
  turnCount: number;
  agentResponses: AgentTurnSummary[];
  whiteboardLedger: WhiteboardActionRecord[];
}

export interface CourseChatContextPage {
  id: string;
  order: number;
  title: string;
  digest: string;
  sourceScore: number;
}

export type CourseChatResourceLoadStatus = 'loading' | 'ready' | 'empty' | 'error' | 'unknown';

export interface CourseChatResourceLoadState {
  status: CourseChatResourceLoadStatus;
  itemCount?: number;
  error?: string;
}

export interface CourseChatContextNotebook {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  updatedAt?: number;
  pages: CourseChatContextPage[];
  pagesState?: CourseChatResourceLoadState;
  privateMemories?: Array<{
    id: string;
    title: string;
    text: string;
    reason?: string;
    question?: string;
    sourceScore: number;
    sourceReferences?: Array<{
      order: number;
      title: string;
      why?: string;
    }>;
  }>;
  sourceScore: number;
}

/**
 * Compact, browser-safe evidence selected by the authenticated course-answer
 * context loader. This is intentionally smaller than CourseChatContext: the
 * browser needs citations for the answer UI, not the full model prompt.
 */
export interface CourseChatEvidenceSummary {
  id: string;
  origin: 'course_source' | 'layered_memory' | 'problem_bank';
  sourceType: string;
  sourceId: string;
  title: string;
  excerpt: string;
  score: number;
  courseId: string;
  notebookId?: string;
  sourceHash?: string;
}

export interface CourseChatLayeredMemoryContext {
  storage?: 'database' | 'unavailable' | string;
  prompt?: string;
  vectorUsed?: boolean;
  counts?: {
    direct?: number;
    semantic?: number;
    knowledgeCache?: number;
    knowledge?: number;
    sourceEvidence?: number;
    learnerAnalytics?: number;
  };
  scope?: {
    effectiveMode?: string;
    expanded?: boolean;
    reason?: string;
  };
  searchIntent?: {
    kind?: string;
    rewrittenQuery?: string;
    progressFilter?: string | null;
    knowledgeTypes?: string[];
    sourceGrounding?: {
      required?: boolean;
      reason?: string;
      signals?: string[];
    };
  };
  knowledgeMatches?: Array<{
    id: string;
    title: string;
    text?: string;
    metadata?: {
      notebookName?: string | null;
      tags?: string[];
      attemptStatus?: string | null;
    };
  }>;
  sourceEvidence?: Array<{
    id: string;
    sourceType?: string;
    title: string;
    originalText?: string;
    renderedText?: string;
    score?: number;
    courseId?: string | null;
    notebookId?: string | null;
    sourceId?: string;
    metadata?: Record<string, unknown>;
  }>;
  semanticMatches?: Array<{
    id: string;
    title?: string;
    text?: string;
    summary?: string;
    source?: string;
  }>;
  knowledgeCache?: Array<{
    id: string;
    sourceType?: string;
    sourceId?: string;
    courseId?: string | null;
    notebookId?: string | null;
    title: string;
    previewText?: string;
    hitCount?: number;
    lastAccessedAt?: string;
    metadata?: unknown;
  }>;
}

export interface CourseChatAnswererHandoffEvidence {
  sourceType: string;
  sourceId?: string;
  title?: string;
  quoteOrSummary: string;
  supports: string;
  confidence?: number;
}

export interface CourseChatAnswererHandoff {
  runId: string;
  intent: string;
  reasonSummary: string;
  evidence: CourseChatAnswererHandoffEvidence[];
  requiredBehavior: string[];
  forbiddenBehavior: string[];
  missingEvidence: string[];
  resourceStates?: {
    notebooks: CourseChatResourceLoadStatus;
    problems: CourseChatResourceLoadStatus;
    sources: CourseChatResourceLoadStatus;
  };
  /** Opaque server-signed transport value; never render it into model prompts. */
  trustedToken?: string;
}

export interface CourseChatServerCoursePackContext {
  /**
   * Server-resolved course pack. API handlers must overwrite this field from
   * the authenticated course row; callers must never be treated as authoritative.
   */
  prompt: string;
  metadata: {
    matched: boolean;
    packId?: string;
    courseCode?: string;
    capabilityLevel?: string;
    currentUnitOrder?: number;
    priorUnitOrders?: number[];
    learnedToolCount?: number;
    futureToolCount?: number;
    answerContractId?: string;
    answerContractVersion?: number;
    answerContractCheckIds?: string[];
  };
  repair?: {
    attempt: number;
    validationFailures: string[];
  };
}

export interface CourseChatHardRule {
  id: string;
  content: string;
}

export interface CourseChatContext {
  course: {
    id: string;
    name: string;
    description?: string;
    language?: 'zh-CN' | 'en-US';
    purpose?: 'research' | 'university' | 'daily';
    tags?: string[];
    university?: string;
    courseCode?: string;
  };
  learner?: {
    progressKnown?: boolean;
    progressLabel?: string;
    progressPercent: number;
    currentNotebookId?: string;
    currentNotebookName?: string;
    /** Full instructor-defined notebook sequence for curriculum-aware planning. */
    courseNotebookIds?: string[];
    courseNotebookNames?: string[];
    completedNotebookIds?: string[];
    futureNotebookIds?: string[];
    futureNotebookNames?: string[];
    attemptedProblemCount: number;
    totalProblemCount: number;
    dueReviewCount: number;
    weakConcepts: string[];
    nextConcepts: string[];
    recentQuestions: string[];
    recentAttempts: Array<{
      title: string;
      status: 'passed' | 'partial' | 'failed';
      concepts: string[];
    }>;
    activePlans: Array<{
      title: string;
      mode: 'practice' | 'quiz';
      status: 'draft' | 'active' | 'completed';
      targetConcepts: string[];
    }>;
    syllabus?: {
      importedCount: number;
      upcoming: Array<{
        title: string;
        kind: 'assignment' | 'exam' | 'progress' | 'tutorial' | 'holiday' | 'other';
        date: string;
        sourceName?: string;
      }>;
      nextAssignment?: {
        title: string;
        date: string;
      };
      nextExam?: {
        title: string;
        date: string;
      };
      nextSchoolProgress?: {
        title: string;
        date: string;
      };
    };
  };
  target: {
    kind: 'orchestrator' | 'agent';
    id: string;
    name: string;
    role?: string;
  };
  notebooks: CourseChatContextNotebook[];
  /** Teacher-authored, server-resolved instructions that the course agent must follow. */
  hardRules?: CourseChatHardRule[];
  resourceStates?: {
    notebooks: CourseChatResourceLoadState;
    problems: CourseChatResourceLoadState;
    sources: CourseChatResourceLoadState;
  };
  layeredMemory?: CourseChatLayeredMemoryContext;
  answererHandoff?: CourseChatAnswererHandoff;
  /** Authenticated server-only course pack and answer-contract context. */
  serverCoursePack?: CourseChatServerCoursePackContext;
}

/**
 * Request body for the stateless chat API
 * All state is sent from the client on each request
 */
export interface StatelessChatRequest {
  /** Conversation history (client-maintained) */
  messages: UIMessage<ChatMessageMetadata>[];
  /** Current application state */
  storeState: {
    stage: Stage | null;
    scenes: Scene[];
    currentSceneId: string | null;
    mode: StageMode;
    whiteboardOpen: boolean;
  };
  /** Agent configuration */
  config: {
    agentIds: string[];
    sessionType?: 'qa' | 'discussion';
    surface?: 'classroom' | 'course-chat' | 'teacher-course-chat' | 'student-course-chat';
    /** User-selected response style for the current course chat turn. */
    teachingMode?: CourseChatTeachingMode;
    /** Server-approved model tier; callers cannot provide an arbitrary model ID. */
    responseStrength?: ChatResponseStrength;
    /** Discussion topic (for agent-initiated discussions) */
    discussionTopic?: string;
    /** Discussion prompt (for agent-initiated discussions) */
    discussionPrompt?: string;
    /** Which agent should speak first in a discussion */
    triggerAgentId?: string;
    /** Full agent configs for generated (non-default) agents that aren't in the server-side registry */
    agentConfigs?: Array<{
      id: string;
      name: string;
      role: string;
      persona: string;
      avatar: string;
      color: string;
      allowedActions: string[];
      priority: number;
      isGenerated?: boolean;
      boundStageId?: string;
    }>;
  };
  /** Accumulated director state from previous per-agent requests */
  directorState?: DirectorState;
  /** Course-level context for the standalone /chat learning surface. */
  courseContext?: CourseChatContext;
  contextSelection?: import('@/features/chat/domain/context-selection').ChatContextSelection;
  /** Temporary page conversations never create cross-conversation memory. */
  memoryMode?: 'normal' | 'temporary';
  /**
   * Opaque learn-core handoff signed by /api/learn/turn. The chat server must
   * verify it against the authenticated user, course, question, and expiry.
   */
  trustedLearnAnswererHandoffToken?: string;
  /** User profile for personalization */
  userProfile?: {
    nickname?: string;
    bio?: string;
  };
  /** OpenAI-compatible API credentials */
  apiKey: string;
  baseUrl?: string;
  model?: string;
  providerType?: string;
  requiresApiKey?: boolean;
}

/**
 * Parsed action from structured output
 */
export interface ParsedAction {
  actionId: string;
  actionName: string;
  params: Record<string, unknown>;
}

/** @deprecated Use ParsedAction instead */
export type ParsedToolCall = ParsedAction;

/**
 * Server-Sent Events for stateless chat API
 */
export type StatelessEvent =
  | {
      type: 'agent_start';
      data: {
        messageId: string;
        agentId: string;
        agentName: string;
        agentAvatar?: string;
        agentColor?: string;
      };
    }
  | { type: 'agent_end'; data: { messageId: string; agentId: string } }
  | { type: 'text_delta'; data: { content: string; messageId?: string } }
  | {
      type: 'action';
      data: {
        actionId: string;
        actionName: string;
        params: Record<string, unknown>;
        agentId: string;
        messageId?: string;
      };
    }
  | {
      type: 'thinking';
      data: { stage: 'director' | 'agent_loading'; agentId?: string };
    }
  | {
      type: 'course_evidence';
      data: {
        courseId: string;
        items: CourseChatEvidenceSummary[];
      };
    }
  | {
      /**
       * User-safe progress produced from real server work. This is operational
       * telemetry only and must never contain hidden model reasoning.
       */
      type: 'public_progress';
      data: {
        line: string;
        steps: PublicReplyProgressStep[];
        agentName?: string;
      };
    }
  | {
      /** The server replaced older model context with a user-visible rolling summary. */
      type: 'context_compression';
      data: ChatContextCompression & { messageId: string };
    }
  | {
      /** User-visible effective conversation-window usage for this turn. */
      type: 'context_usage';
      data: CourseChatContextUsage;
    }
  | { type: 'cue_user'; data: { fromAgentId?: string; prompt?: string } }
  | {
      type: 'done';
      data: {
        totalActions: number;
        totalAgents: number;
        agentHadContent?: boolean;
        directorState?: DirectorState;
      };
    }
  | { type: 'error'; data: { message: string } };
