import { browserApp, platformAvailable } from './browser-runtime';
import { getNativePlatformCapabilities } from './platform-api-client';
import { parseNativeSyllabus } from './platform-api-client';

export const supportedAiModels = [
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', detail: '默认 · 讲义与兜底' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', detail: '低延迟' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', detail: '可选' },
] as const;

export type SupportedAiModel = (typeof supportedAiModels)[number]['id'];

export type ChatResponseStrength = 'low' | 'medium' | 'high';

export interface AiSettings {
  configured: boolean;
  credentialSource: 'platform-service' | null;
  defaultModel: SupportedAiModel;
  apiBaseUrl?: string | null;
  error?: string | null;
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

export async function getAiSettings(): Promise<AiSettings> {
  if (browserApp) {
    const capabilities = await getNativePlatformCapabilities();
    const model = capabilities.models?.find((m) => m.recommended)?.id;
    return {
      configured: capabilities.available,
      credentialSource: 'platform-service',
      defaultModel: supportedAiModels.some((m) => m.id === model)
        ? (model as SupportedAiModel)
        : 'gpt-5.6-luna',
    };
  }
  if (!isTauriRuntime()) return defaultSettings;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<AiSettings>('get_ai_settings');
}

export async function parseSyllabusDocument(
  input: ParseSyllabusInput,
): Promise<ParsedSyllabusDocument> {
  if (!platformAvailable()) {
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
