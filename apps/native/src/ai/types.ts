/** 和服务端 features/native-ai/server/schema.ts 的请求同形。 */

export type NativeChatSurface = 'phone' | 'tablet' | 'desktop';

export interface NativeChatContext {
  today?: string;
  progress?: {
    completedNotebooks: number;
    totalNotebooks: number;
    currentNotebook?: string | null;
  };
  notes: Array<{
    id: string;
    notebookId?: string;
    notebook: string;
    title: string;
    content: string;
  }>;
  memories: Array<{ id: string; kind: string; title: string; text: string; concepts: string[] }>;
  calendar: Array<{ id: string; title: string; date: string; kind: string; status?: string }>;
  attempts: Array<{
    problemId: string;
    title: string;
    status: string;
    answer?: string;
    feedback?: string;
  }>;
  problems: Array<{
    id: string;
    title: string;
    type?: string;
    difficulty?: string;
    tags: string[];
    excerpt?: string;
    status?: string | null;
  }>;
}

export interface NativeChatPayload {
  requestId: string;
  surface: NativeChatSurface;
  course: {
    id?: string;
    name: string;
    code?: string | null;
    description?: string;
    language: 'zh-CN' | 'en-US';
  };
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
  images?: Array<{
    name: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    dataBase64: string;
  }>;
  /** PDF / Word / PPT / 纯文本，服务端抽字。 */
  files?: Array<{ name: string; mimeType: string; dataBase64: string }>;
  context: NativeChatContext;
}
