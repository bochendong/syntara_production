'use client';

import type { UIMessage } from 'ai';
import { COURSE_ORCHESTRATOR_ID, COURSE_ORCHESTRATOR_NAME } from '@/lib/constants/course-chat';
import { runCourseSideChatLoop } from '@/lib/chat/run-course-side-chat-loop';
import type {
  ChatMessageMetadata,
  CourseChatContext,
  CourseChatEvidenceSummary,
  StatelessChatRequest,
} from '@/lib/types/chat';
import type { Scene } from '@/lib/types/stage';
import { getCurrentModelConfig } from '@/lib/utils/model-config';

export type AskCourseOrchestratorOptions = {
  courseId: string;
  question: string;
  attachments?: CourseChatImageAttachment[];
  courseName?: string;
  orchestratorAvatarUrl?: string | null;
  conversation?: UIMessage<ChatMessageMetadata>[];
  courseContext?: CourseChatContext;
  learnerContext?: CourseChatContext['learner'];
  answererHandoff?: CourseChatContext['answererHandoff'];
  userProfile?: { nickname?: string; bio?: string };
  signal?: AbortSignal;
  onMessages?: (messages: UIMessage<ChatMessageMetadata>[]) => void;
};

export type CourseChatImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
};

export type AskCourseOrchestratorResult = {
  answer: string;
  messages: UIMessage<ChatMessageMetadata>[];
  courseContext: CourseChatContext;
  courseEvidence: CourseChatEvidenceSummary[];
};

function messageText(message: UIMessage<ChatMessageMetadata>): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function latestAssistantAnswer(messages: UIMessage<ChatMessageMetadata>[]): string {
  const latestAssistant = messages
    .slice()
    .reverse()
    .find((message) => message.role === 'assistant' && !message.metadata?.progressOnly);
  return latestAssistant ? messageText(latestAssistant) : '';
}

function buildUserMessage(
  question: string,
  attachments: CourseChatImageAttachment[] = [],
): UIMessage<ChatMessageMetadata> {
  const now = Date.now();
  const parts = [
    { type: 'text' as const, text: question },
    ...attachments.map((attachment) => ({
      type: 'file' as const,
      url: attachment.dataUrl,
      mediaType: attachment.mimeType,
      filename: attachment.name,
    })),
  ] as UIMessage<ChatMessageMetadata>['parts'];
  return {
    id: `course-question-${now}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    parts,
    metadata: {
      senderName: '你',
      originalRole: 'user',
      createdAt: now,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })),
    },
  };
}

function buildOrchestratorAgentConfig(
  avatarUrl?: string | null,
): NonNullable<StatelessChatRequest['config']['agentConfigs']>[number] {
  return {
    id: COURSE_ORCHESTRATOR_ID,
    name: COURSE_ORCHESTRATOR_NAME,
    avatar: avatarUrl || '',
    role: 'teacher',
    persona:
      '你是课程总控老师。先判断用户的问题应该依据现有资料库正文回答、补充资料，还是综合多份课程来源完成；在直接回答时，要像耐心的课程导师一样讲清概念、步骤、例子和易错点。',
    color: '#7c3aed',
    allowedActions: [],
    priority: 100,
    isGenerated: false,
  };
}

export async function askCourseOrchestrator(
  options: AskCourseOrchestratorOptions,
): Promise<AskCourseOrchestratorResult> {
  const modelConfig = getCurrentModelConfig();
  if (!modelConfig.isServerConfigured) {
    throw new Error('系统模型尚未配置，请联系管理员。');
  }

  // /api/chat rebuilds all prompt-bearing course state from the authenticated
  // database. Sending sources, learner memory, and problem context from the
  // browser only duplicates reads and is discarded by the trust boundary.
  const courseContext: CourseChatContext = options.courseContext ?? {
    course: {
      id: options.courseId,
      name: options.courseName?.trim() || '当前课程',
    },
    target: {
      kind: 'orchestrator',
      id: COURSE_ORCHESTRATOR_ID,
      name: COURSE_ORCHESTRATOR_NAME,
      role: 'teacher',
    },
    notebooks: [],
  };

  let messages = [
    ...(options.conversation || []),
    buildUserMessage(options.question, options.attachments),
  ];
  const controller = options.signal ? null : new AbortController();

  const runResult = await runCourseSideChatLoop({
    initialMessages: messages,
    agentIds: [COURSE_ORCHESTRATOR_ID],
    agentConfigs: [buildOrchestratorAgentConfig(options.orchestratorAvatarUrl)],
    getStoreState: () => ({
      stage: null,
      scenes: [] as Scene[],
      currentSceneId: null,
      mode: 'playback' as const,
      whiteboardOpen: false,
    }),
    userProfile: options.userProfile,
    surface: 'course-chat',
    courseContext,
    trustedLearnAnswererHandoffToken: options.answererHandoff?.trustedToken,
    apiKey: modelConfig.apiKey,
    baseUrl: modelConfig.baseUrl || undefined,
    model: modelConfig.modelString,
    signal: options.signal ?? controller!.signal,
    onMessages: (nextMessages) => {
      messages = nextMessages;
      options.onMessages?.(nextMessages);
    },
  });

  return {
    answer: latestAssistantAnswer(messages),
    messages,
    courseContext,
    courseEvidence: runResult.courseEvidence,
  };
}
