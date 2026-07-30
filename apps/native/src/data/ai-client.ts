import type { LocalMessage } from '../domain/models';
import type { NativeMessageMetadata } from '../domain/teaching';
import {
  parseNativeSyllabus,
  runNativeTeachingTurn,
  type NativePlatformStreamEvent,
} from './platform-api-client';

export const supportedAiModels = [
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', detail: '质量优先' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', detail: '速度与成本平衡' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', detail: '低延迟' },
] as const;

export type SupportedAiModel = (typeof supportedAiModels)[number]['id'];

export interface AiSettings {
  configured: boolean;
  credentialSource: 'platform-service' | null;
  defaultModel: SupportedAiModel;
  apiBaseUrl?: string | null;
  error?: string | null;
}

export interface AiChatResult {
  text: string;
  model: string;
  responseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  metadata?: NativeMessageMetadata;
}

export type SyllabusEventKind =
  | 'assignment'
  | 'exam'
  | 'progress'
  | 'tutorial'
  | 'holiday'
  | 'other';

export interface ParsedSyllabusEvent {
  title: string;
  kind: SyllabusEventKind;
  date: string;
  week: string | null;
  sourceColumn: string | null;
  rawText: string | null;
  confidence: number | null;
}

export interface ParsedSyllabusDocument {
  courseTitle: string | null;
  sourceMarkdown: string;
  events: ParsedSyllabusEvent[];
  warnings: string[];
  model: string;
}

export interface StreamAssistantInput {
  requestId: string;
  courseId: string;
  courseName: string;
  courseCode?: string | null;
  courseDescription: string;
  conversationId: string;
  messages: LocalMessage[];
  model: SupportedAiModel;
  localContext?: {
    calendarEvents?: unknown[];
    memories?: unknown[];
    attempts?: unknown[];
    problemCandidates?: unknown[];
    notebookExcerpts?: unknown[];
    sourceExcerpts?: unknown[];
    recentPlans?: unknown[];
  };
}

interface ParseSyllabusInput {
  courseName: string;
  courseDescription: string;
  fileName: string;
  mimeType: string;
  dataBase64: string;
  model: SupportedAiModel;
}

const defaultSettings: AiSettings = {
  configured: false,
  credentialSource: null,
  defaultModel: 'gpt-5.6-sol',
};

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function streamDelta(event: NativePlatformStreamEvent): string | null {
  if (event.event !== 'text_delta' && event.event !== 'delta') return null;
  if (!event.data || typeof event.data !== 'object') return null;
  const payload = event.data as Record<string, unknown>;
  if (typeof payload.delta === 'string') return payload.delta;
  if (typeof payload.content === 'string') return payload.content;
  const data =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : null;
  if (typeof data?.delta === 'string') return data.delta;
  return typeof data?.content === 'string' ? data.content : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function assistantMetadataFromFinalEvent(value: unknown): NativeMessageMetadata | undefined {
  let current = recordValue(value);
  if (!current) return undefined;
  if (recordValue(current.data)) current = recordValue(current.data);
  const assistantMessage = recordValue(current?.assistantMessage);
  const metadata = recordValue(assistantMessage?.metadata);
  return metadata ? (metadata as NativeMessageMetadata) : undefined;
}

export async function getAiSettings(): Promise<AiSettings> {
  if (!isTauriRuntime()) return defaultSettings;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<AiSettings>('get_ai_settings');
}

export async function streamAssistantReply(
  input: StreamAssistantInput,
  onDelta: (delta: string) => void,
): Promise<AiChatResult> {
  if (!isTauriRuntime()) {
    throw new Error('模型回复只在 macOS / iPadOS 原生 App 中启用。');
  }

  const question =
    input.messages
      .slice()
      .reverse()
      .find((message) => message.role === 'user')
      ?.text.trim()
      .slice(0, 4000) || '';
  if (!question) throw new Error('没有可发送的学生问题。');

  const result = await runNativeTeachingTurn(
    {
      requestId: input.requestId,
      idempotencyKey: input.requestId,
      model: input.model,
      payload: {
        requestId: input.requestId,
        clientTurnId: input.requestId,
        question,
        course: {
          id: input.courseId,
          name: input.courseName,
          code: input.courseCode ?? undefined,
          description: input.courseDescription,
          language: 'zh-CN',
        },
        conversation: {
          id: input.conversationId,
          recentMessages: input.messages.flatMap(({ id, role, text }) =>
            role === 'user' || role === 'assistant'
              ? [{ id, role, text: text.slice(0, 4000) }]
              : [],
          ),
        },
        localContext: input.localContext ?? {},
        preferences: {
          language: 'zh-CN',
          allowWebSearch: false,
        },
      },
    },
    (event) => {
      const delta = streamDelta(event);
      if (delta) onDelta(delta);
    },
  );
  return {
    text: result.text,
    model: result.model || input.model,
    responseId: result.responseId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    metadata: assistantMetadataFromFinalEvent(result.finalEvent),
  };
}

export async function parseSyllabusDocument(
  input: ParseSyllabusInput,
): Promise<ParsedSyllabusDocument> {
  if (!isTauriRuntime()) {
    throw new Error('PDF 和图片 syllabus 解析只在 macOS / iPadOS 原生 App 中启用。');
  }
  const result = await parseNativeSyllabus(
    {
      course: {
        name: input.courseName,
        description: input.courseDescription,
      },
      file: {
        name: input.fileName,
        mimeType: input.mimeType,
        dataBase64: input.dataBase64,
      },
      preferences: {
        model: input.model,
      },
    },
    { model: input.model },
  );
  return {
    courseTitle: result.courseTitle ?? null,
    sourceMarkdown: result.sourceMarkdown || '',
    events: result.events.map((event) => ({
      title: event.title,
      kind: event.kind,
      date: event.date,
      week: event.week ?? null,
      sourceColumn: event.sourceColumn ?? null,
      rawText: event.rawText ?? null,
      confidence: event.confidence ?? null,
    })),
    warnings: result.warnings || [],
    model: result.model || result.modelId || input.model,
  };
}

export * from './platform-api-client';
