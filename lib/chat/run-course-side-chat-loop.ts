/**
 * 侧栏课程聊天：无 StreamBuffer，直接消费 /api/chat 的 SSE 并更新消息列表。
 * 行为与 use-chat-sessions 中的 agent loop 对齐（含 director 多轮）。
 */

import type { UIMessage } from 'ai';
import {
  buildCourseReplyProgress,
  dispatchCourseReplyProgress,
  type CourseReplyProgressPhase,
} from '@/lib/chat/course-reply-progress';
import type {
  ChatMessageMetadata,
  CourseChatContextUsage,
  CourseChatContext,
  CourseChatEvidenceSummary,
  CourseChatTeachingMode,
  DirectorState,
  LearningAction,
  LearningActionKind,
  StatelessChatRequest,
  StatelessEvent,
} from '@/lib/types/chat';
import { useSettingsStore } from '@/lib/store/settings';
import { createLogger } from '@/lib/logger';
import { runQueuedAiTask, updateQueuedAiTask } from '@/lib/store/ai-task-queue';
import { backendFetch } from '@/lib/utils/backend-api';

const log = createLogger('CourseSideChat');

export interface RunCourseSideChatParams {
  initialMessages: UIMessage<ChatMessageMetadata>[];
  agentIds: string[];
  /** 非默认 Agent（如课程生成角色）需传完整配置 */
  agentConfigs?: StatelessChatRequest['config']['agentConfigs'];
  getStoreState: () => StatelessChatRequest['storeState'];
  userProfile?: { nickname?: string; bio?: string };
  surface?: StatelessChatRequest['config']['surface'];
  teachingMode?: CourseChatTeachingMode;
  courseContext?: CourseChatContext;
  trustedLearnAnswererHandoffToken?: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
  signal: AbortSignal;
  onMessages: (messages: UIMessage<ChatMessageMetadata>[]) => void;
  onContextUsage?: (usage: CourseChatContextUsage) => void;
}

export interface RunCourseSideChatResult {
  courseEvidence: CourseChatEvidenceSummary[];
  contextUsage: CourseChatContextUsage | null;
}

function cloneMessages(m: UIMessage<ChatMessageMetadata>[]) {
  return m.map((msg) => ({
    ...msg,
    parts: msg.parts.map((p) => ({ ...p })),
    metadata: msg.metadata
      ? {
          ...msg.metadata,
          learningActions: msg.metadata.learningActions?.map((action) => ({
            ...action,
            payload: action.payload ? { ...action.payload } : undefined,
            evidence: action.evidence?.map((item) => ({ ...item })),
          })),
          publicProgressSteps: msg.metadata.publicProgressSteps?.map((step) => ({
            ...step,
            evidence: step.evidence ? [...step.evidence] : undefined,
          })),
          contextCompression: msg.metadata.contextCompression
            ? { ...msg.metadata.contextCompression }
            : undefined,
        }
      : undefined,
  })) as UIMessage<ChatMessageMetadata>[];
}

const LEARNING_ACTION_KINDS = new Set<LearningActionKind>([
  'calendar.propose_add',
  'calendar.propose_update',
  'calendar.propose_delete',
  'calendar.search',
  'calendar.start_recent',
  'memory.search',
  'web.search',
  'learner_progress.request_confirmation',
  'practice.propose_generation',
  'classroom.propose_temporary_explanation',
  'image.propose_generation',
  'memory.propose_write',
]);

function toLearningActionKind(actionName: string): LearningActionKind | null {
  return LEARNING_ACTION_KINDS.has(actionName as LearningActionKind)
    ? (actionName as LearningActionKind)
    : null;
}

function makeLearningAction(
  event: Extract<StatelessEvent, { type: 'action' }>,
): LearningAction | null {
  const kind = toLearningActionKind(event.data.actionName);
  if (!kind) return null;
  const params = event.data.params || {};
  const rawLabel = params.label || params.title || params.topic || event.data.actionName;
  const label = typeof rawLabel === 'string' ? rawLabel : event.data.actionName;
  const rawSummary = params.summary || params.reason;
  const summary = typeof rawSummary === 'string' ? rawSummary : undefined;
  const requiresConfirmation =
    params.requiresConfirmation === true ||
    (kind !== 'calendar.search' && params.requiresConfirmation !== false);
  return {
    id: event.data.actionId,
    kind,
    label,
    summary,
    status: 'proposed',
    confirmation: requiresConfirmation ? 'required' : 'none',
    payload: params,
  };
}

async function consumeOneResponse(
  response: Response,
  signal: AbortSignal,
  working: UIMessage<ChatMessageMetadata>[],
  onMessages: (m: UIMessage<ChatMessageMetadata>[]) => void,
  taskId?: string,
  initialProgressMessageId?: string | null,
  onContextUsage?: (usage: CourseChatContextUsage) => void,
): Promise<{
  cueUserReceived: boolean;
  courseEvidence: CourseChatEvidenceSummary[];
  contextUsage: CourseChatContextUsage | null;
  doneData: {
    totalAgents: number;
    agentHadContent?: boolean;
    directorState?: DirectorState;
  } | null;
}> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');
  const cancelReader = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  if (signal.aborted) {
    cancelReader();
  } else {
    signal.addEventListener('abort', cancelReader, { once: true });
  }

  const decoder = new TextDecoder();
  let sseBuffer = '';
  let currentMessageId: string | null = null;
  let currentAgentName: string | null = null;
  let pendingProgressMessageId: string | null = initialProgressMessageId ?? null;
  let cueUserReceived = false;
  let courseEvidence: CourseChatEvidenceSummary[] = [];
  let contextUsage: CourseChatContextUsage | null = null;
  const streamingStartedMessageIds = new Set<string>();
  let pendingTextPublishTimer: ReturnType<typeof setTimeout> | null = null;
  let doneData: {
    totalAgents: number;
    agentHadContent?: boolean;
    directorState?: DirectorState;
  } | null = null;

  const findTextPartIndex = (msg: UIMessage<ChatMessageMetadata>) =>
    msg.parts.findIndex((p) => p.type === 'text');

  const messageText = (msg: UIMessage<ChatMessageMetadata>) =>
    msg.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('');

  // Model providers can emit several tiny deltas in the same frame. Publishing
  // every one of them forces the page to rebuild the full Markdown tree and can
  // also wake persistence effects hundreds of times per answer. Keep the text
  // genuinely streaming, but cap React updates to roughly one per frame.
  const publishTextUpdate = () => {
    if (pendingTextPublishTimer !== null) return;
    pendingTextPublishTimer = setTimeout(() => {
      pendingTextPublishTimer = null;
      onMessages(cloneMessages(working));
    }, 32);
  };

  const flushTextUpdate = () => {
    if (pendingTextPublishTimer !== null) {
      clearTimeout(pendingTextPublishTimer);
      pendingTextPublishTimer = null;
    }
    onMessages(cloneMessages(working));
  };

  const applyProgress = (
    phase: CourseReplyProgressPhase,
    targetId?: string | null,
    agentName?: string | null,
    options: { ensureMessage?: boolean } = {},
  ) => {
    const progress = buildCourseReplyProgress({ phase, messageId: targetId, agentName });
    const ensureMessage = options.ensureMessage ?? true;
    let resolvedTargetId = targetId || currentMessageId || pendingProgressMessageId;
    let changedMessage = false;

    if (!resolvedTargetId && ensureMessage) {
      resolvedTargetId = `assistant-progress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      pendingProgressMessageId = resolvedTargetId;
      working.push({
        id: resolvedTargetId,
        role: 'assistant',
        parts: [{ type: 'text', text: '' }],
        metadata: {
          senderName: agentName?.trim() || '课程老师',
          originalRole: 'agent',
          createdAt: Date.now(),
          streaming: true,
          progressOnly: true,
          statusText: progress.line,
          publicProgressSteps: progress.steps,
        },
      });
      changedMessage = true;
    } else if (resolvedTargetId) {
      const msg = working.find((m) => m.id === resolvedTargetId);
      if (msg) {
        msg.metadata = {
          ...msg.metadata,
          senderName: msg.metadata?.senderName || agentName?.trim() || '课程老师',
          originalRole: msg.metadata?.originalRole || 'agent',
          createdAt: msg.metadata?.createdAt || Date.now(),
          streaming: true,
          progressOnly: msg.metadata?.progressOnly,
          statusText: progress.line,
          publicProgressSteps: progress.steps,
        };
        changedMessage = true;
      }
    }

    const detail = {
      ...progress,
      messageId: resolvedTargetId || progress.messageId,
    };
    if (taskId) {
      updateQueuedAiTask(taskId, { description: detail.line });
    }
    dispatchCourseReplyProgress(detail);
    if (changedMessage) flushTextUpdate();
    return resolvedTargetId;
  };

  const applyPublicProgress = (data: {
    line: string;
    steps: NonNullable<ChatMessageMetadata['publicProgressSteps']>;
    agentName?: string;
  }) => {
    let resolvedTargetId = currentMessageId || pendingProgressMessageId;
    let changedMessage = false;
    if (!resolvedTargetId) {
      resolvedTargetId = `assistant-progress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      pendingProgressMessageId = resolvedTargetId;
      working.push({
        id: resolvedTargetId,
        role: 'assistant',
        parts: [{ type: 'text', text: '' }],
        metadata: {
          senderName: data.agentName?.trim() || '课程助理',
          originalRole: 'agent',
          createdAt: Date.now(),
          streaming: true,
          progressOnly: true,
          statusText: data.line,
          publicProgressSteps: data.steps,
        },
      });
      changedMessage = true;
    } else {
      const message = working.find((item) => item.id === resolvedTargetId);
      if (message) {
        message.metadata = {
          ...message.metadata,
          senderName: message.metadata?.senderName || data.agentName?.trim() || '课程助理',
          originalRole: message.metadata?.originalRole || 'agent',
          createdAt: message.metadata?.createdAt || Date.now(),
          streaming: true,
          statusText: data.line,
          publicProgressSteps: data.steps,
        };
        changedMessage = true;
      }
    }
    const detail = {
      messageId: resolvedTargetId || undefined,
      phase: 'agent_loading' as const,
      agentName: data.agentName,
      line: data.line,
      steps: data.steps,
      updatedAt: Date.now(),
    };
    if (taskId) updateQueuedAiTask(taskId, { description: data.line });
    dispatchCourseReplyProgress(detail);
    if (changedMessage) flushTextUpdate();
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const events = sseBuffer.split('\n\n');
      sseBuffer = events.pop() || '';

      for (const eventStr of events) {
        const line = eventStr.trim();
        if (!line.startsWith('data: ')) continue;

        let event: StatelessEvent;
        try {
          event = JSON.parse(line.slice(6)) as StatelessEvent;
        } catch {
          continue;
        }

        switch (event.type) {
          case 'course_evidence': {
            courseEvidence = event.data.items;
            break;
          }
          case 'thinking': {
            applyProgress(
              event.data.stage === 'director' ? 'director' : 'agent_loading',
              currentMessageId ?? pendingProgressMessageId,
              currentAgentName,
            );
            break;
          }
          case 'public_progress': {
            applyPublicProgress(event.data);
            break;
          }
          case 'context_compression': {
            const message = working.find((item) => item.id === event.data.messageId);
            if (!message) break;
            const { messageId: _messageId, ...contextCompression } = event.data;
            message.metadata = {
              ...message.metadata,
              contextCompression,
            };
            flushTextUpdate();
            break;
          }
          case 'context_usage': {
            contextUsage = event.data;
            onContextUsage?.(event.data);
            break;
          }
          case 'agent_start': {
            const { messageId, agentId, agentName, agentAvatar, agentColor } = event.data;
            currentMessageId = messageId;
            currentAgentName = agentName;
            const progress = buildCourseReplyProgress({
              phase: 'agent_started',
              messageId,
              agentName,
            });
            const pendingMessage = pendingProgressMessageId
              ? working.find((m) => m.id === pendingProgressMessageId)
              : null;
            const pendingText = pendingMessage ? messageText(pendingMessage).trim() : '';
            const nextMetadata: ChatMessageMetadata = {
              senderName: agentName,
              senderAvatar: agentAvatar,
              agentId,
              agentColor,
              originalRole: 'agent',
              createdAt: pendingMessage?.metadata?.createdAt || Date.now(),
              streaming: true,
              statusText: progress.line,
              publicProgressSteps: progress.steps,
            };
            if (pendingMessage && !pendingText) {
              pendingMessage.id = messageId;
              pendingMessage.metadata = nextMetadata;
              pendingProgressMessageId = null;
            } else {
              working.push({
                id: messageId,
                role: 'assistant',
                parts: [{ type: 'text', text: '' }],
                metadata: nextMetadata,
              });
            }
            if (taskId) updateQueuedAiTask(taskId, { description: progress.line });
            dispatchCourseReplyProgress(progress);
            flushTextUpdate();
            break;
          }
          case 'text_delta': {
            const targetId = event.data.messageId ?? currentMessageId;
            if (!targetId) break;
            const msg = working.find((m) => m.id === targetId);
            if (!msg) break;
            if (!streamingStartedMessageIds.has(targetId)) {
              streamingStartedMessageIds.add(targetId);
              const existingSteps = msg.metadata?.publicProgressSteps;
              const teacherSteps = existingSteps?.some((step) => step.id.startsWith('teacher-'))
                ? existingSteps.map((step) => ({
                    ...step,
                    status:
                      step.id === 'teacher-answer'
                        ? ('active' as const)
                        : step.status === 'pending' || step.status === 'active'
                          ? ('complete' as const)
                          : step.status,
                  }))
                : null;
              const progress = teacherSteps
                ? {
                    messageId: targetId,
                    phase: 'streaming' as const,
                    agentName: msg.metadata?.senderName || currentAgentName || undefined,
                    line: '已经核对课程依据，正在输出回复。',
                    steps: teacherSteps,
                    updatedAt: Date.now(),
                  }
                : buildCourseReplyProgress({
                    phase: 'streaming',
                    messageId: targetId,
                    agentName: msg.metadata?.senderName || currentAgentName,
                  });
              msg.metadata = {
                ...msg.metadata,
                streaming: true,
                statusText: progress.line,
                publicProgressSteps: progress.steps,
              };
              if (taskId) updateQueuedAiTask(taskId, { description: progress.line });
              dispatchCourseReplyProgress(progress);
            }
            const ti = findTextPartIndex(msg);
            if (ti < 0) {
              msg.parts.push({ type: 'text', text: event.data.content });
            } else {
              const part = msg.parts[ti];
              if (part.type === 'text') {
                part.text = (part.text || '') + event.data.content;
              }
            }
            publishTextUpdate();
            break;
          }
          case 'action': {
            const learningAction = makeLearningAction(event);
            if (!learningAction) break;
            const targetId = event.data.messageId ?? currentMessageId;
            if (!targetId) break;
            const msg = working.find((m) => m.id === targetId);
            if (!msg) break;
            msg.metadata = {
              ...msg.metadata,
              learningActions: [...(msg.metadata?.learningActions || []), learningAction],
            };
            flushTextUpdate();
            break;
          }
          case 'agent_end': {
            const msg = working.find((m) => m.id === event.data.messageId);
            if (msg?.metadata) {
              msg.metadata = {
                ...msg.metadata,
                streaming: false,
                statusText: undefined,
                publicProgressSteps: undefined,
              };
              flushTextUpdate();
            }
            currentMessageId = null;
            currentAgentName = null;
            break;
          }
          case 'cue_user': {
            cueUserReceived = true;
            break;
          }
          case 'done': {
            doneData = {
              totalAgents: event.data.totalAgents,
              agentHadContent: event.data.agentHadContent,
              directorState: event.data.directorState,
            };
            if (!currentMessageId && pendingProgressMessageId) {
              const pendingIndex = working.findIndex((m) => m.id === pendingProgressMessageId);
              if (pendingIndex >= 0 && !messageText(working[pendingIndex]).trim()) {
                working.splice(pendingIndex, 1);
                pendingProgressMessageId = null;
                flushTextUpdate();
              }
            }
            applyProgress('completed', currentMessageId, currentAgentName, {
              ensureMessage: false,
            });
            break;
          }
          case 'error': {
            applyProgress('failed', currentMessageId, currentAgentName, { ensureMessage: false });
            throw new Error(event.data.message);
          }
          default:
            break;
        }
      }
    }
  } finally {
    if (pendingTextPublishTimer !== null) {
      clearTimeout(pendingTextPublishTimer);
      pendingTextPublishTimer = null;
      onMessages(cloneMessages(working));
    }
    signal.removeEventListener('abort', cancelReader);
    reader.releaseLock();
  }

  return { cueUserReceived, courseEvidence, contextUsage, doneData };
}

function summarizeChatPrompt(messages: UIMessage<ChatMessageMetadata>[]) {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const text = lastUser?.parts
    ?.map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || '正在生成聊天回复';
}

export async function runCourseSideChatLoop(
  params: RunCourseSideChatParams,
): Promise<RunCourseSideChatResult> {
  return runQueuedAiTask(
    {
      kind: 'chat-reply',
      title: '聊天回复',
      description: summarizeChatPrompt(params.initialMessages),
      signal: params.signal,
    },
    ({ taskId }) => runCourseSideChatLoopUnqueued(params, taskId),
  );
}

async function runCourseSideChatLoopUnqueued(
  params: RunCourseSideChatParams,
  taskId?: string,
): Promise<RunCourseSideChatResult> {
  const {
    initialMessages,
    agentIds,
    agentConfigs,
    getStoreState,
    userProfile,
    surface,
    teachingMode,
    courseContext,
    trustedLearnAnswererHandoffToken,
    apiKey,
    baseUrl,
    model,
    signal,
    onMessages,
    onContextUsage,
  } = params;

  const settingsState = useSettingsStore.getState();
  const notebookAgentSingleTurn =
    surface === 'teacher-course-chat' || surface === 'student-course-chat';
  const defaultMaxTurns = notebookAgentSingleTurn || agentIds.length <= 1 ? 1 : 10;
  // The course notebook server already runs its tools inside one
  // ToolLoopAgent request. Re-entering the outer director loop repeats the
  // same user question and can create up to ten near-duplicate replies.
  const maxTurns = notebookAgentSingleTurn
    ? 1
    : settingsState.maxTurns
      ? parseInt(settingsState.maxTurns, 10) || defaultMaxTurns
      : defaultMaxTurns;

  let directorState: DirectorState | undefined;
  let turnCount = 0;
  const working = cloneMessages(initialMessages);
  let consecutiveEmptyTurns = 0;
  let courseEvidence: CourseChatEvidenceSummary[] = [];
  let contextUsage: CourseChatContextUsage | null = null;

  const addQueuedProgressMessage = () => {
    const progress = buildCourseReplyProgress({ phase: 'queued' });
    const messageId = `assistant-progress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    working.push({
      id: messageId,
      role: 'assistant',
      parts: [{ type: 'text', text: '' }],
      metadata: {
        senderName: '课程老师',
        originalRole: 'agent',
        createdAt: Date.now(),
        streaming: true,
        progressOnly: true,
        statusText: progress.line,
        publicProgressSteps: progress.steps,
      },
    });
    if (taskId) updateQueuedAiTask(taskId, { description: progress.line });
    dispatchCourseReplyProgress({ ...progress, messageId });
    onMessages(cloneMessages(working));
    return messageId;
  };

  const removeQueuedProgressMessage = (messageId: string | null) => {
    if (!messageId) return;
    const index = working.findIndex((message) => message.id === messageId);
    if (index < 0 || !working[index].metadata?.progressOnly) return;
    working.splice(index, 1);
    onMessages(cloneMessages(working));
  };

  while (turnCount < maxTurns && !signal.aborted) {
    const queuedProgressMessageId = addQueuedProgressMessage();
    const storeState = getStoreState();

    const config: StatelessChatRequest['config'] = {
      agentIds,
      sessionType: 'qa',
      surface,
      teachingMode: teachingMode === 'guided' ? 'guided' : 'reply',
    };
    if (agentConfigs && agentConfigs.length > 0) {
      config.agentConfigs = agentConfigs;
    }

    let cueUserReceived = false;
    let doneData: {
      totalAgents: number;
      agentHadContent?: boolean;
      directorState?: DirectorState;
    } | null = null;

    try {
      const response = await backendFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: working.filter((message) => !message.metadata?.progressOnly),
          storeState,
          config,
          courseContext,
          trustedLearnAnswererHandoffToken,
          userProfile,
          directorState,
          apiKey,
          baseUrl: baseUrl || undefined,
          model,
        }),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let publicMessage = errorText.trim();
        try {
          const payload = JSON.parse(errorText) as { error?: unknown; message?: unknown };
          const candidate =
            typeof payload.error === 'string'
              ? payload.error
              : typeof payload.message === 'string'
                ? payload.message
                : '';
          if (candidate.trim()) publicMessage = candidate.trim();
        } catch {
          /* Preserve plain-text upstream errors. */
        }
        throw new Error(publicMessage || `课程聊天请求失败（HTTP ${response.status}）`);
      }

      const consumed = await consumeOneResponse(
        response,
        signal,
        working,
        onMessages,
        taskId,
        queuedProgressMessageId,
        onContextUsage,
      );
      cueUserReceived = consumed.cueUserReceived;
      if (consumed.courseEvidence.length > 0) {
        courseEvidence = consumed.courseEvidence;
      }
      doneData = consumed.doneData;
      if (consumed.contextUsage) contextUsage = consumed.contextUsage;
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        removeQueuedProgressMessage(queuedProgressMessageId);
      } else {
        const progress = buildCourseReplyProgress({
          phase: 'failed',
          messageId: queuedProgressMessageId,
        });
        if (taskId) updateQueuedAiTask(taskId, { description: progress.line });
        dispatchCourseReplyProgress(progress);
        removeQueuedProgressMessage(queuedProgressMessageId);
      }
      throw error;
    }

    if (signal.aborted) {
      removeQueuedProgressMessage(queuedProgressMessageId);
      break;
    }

    if (doneData?.directorState) {
      directorState = doneData.directorState;
    }
    turnCount = directorState?.turnCount ?? turnCount + 1;

    if (cueUserReceived) break;
    if (doneData && doneData.totalAgents === 0) break;

    if (doneData?.agentHadContent === false) {
      consecutiveEmptyTurns++;
      if (consecutiveEmptyTurns >= 2) {
        log.warn('[CourseSideChat] consecutive empty turns, stopping');
        break;
      }
    } else {
      consecutiveEmptyTurns = 0;
    }
  }

  return { courseEvidence, contextUsage };
}
