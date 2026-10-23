import { browserChat, browserRequest } from './browser-platform';
import type { NativeChatPayload, NativeChatSurface } from '../ai/types';
import type { ChatResponseStrength } from './ai-client';

export interface GeneralConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}
export interface GeneralMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
}
export interface GeneralChatClient {
  list(): Promise<GeneralConversation[]>;
  load(id: string): Promise<GeneralMessage[]>;
  create(title: string): Promise<GeneralConversation>;
  append(id: string, message: GeneralMessage): Promise<GeneralConversation>;
  remove(id: string): Promise<void>;
  reply(
    messages: GeneralMessage[],
    surface: NativeChatSurface,
    strength: ChatResponseStrength,
    onDelta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string>;
}
const endpoint = '/api/native/v2/general-conversations';
const post = <T>(payload: unknown) =>
  browserRequest<T>(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
export const generalChatClient: GeneralChatClient = {
  async list() {
    return (await browserRequest<{ conversations: GeneralConversation[] }>(endpoint)).conversations;
  },
  async load(id) {
    return (
      await browserRequest<{ messages: GeneralMessage[] }>(
        `${endpoint}?id=${encodeURIComponent(id)}`,
      )
    ).messages;
  },
  async create(title) {
    return (await post<{ conversation: GeneralConversation }>({ title })).conversation;
  },
  async append(conversationId, message) {
    return (
      await post<{ conversation: GeneralConversation }>({
        conversationId,
        message: { id: message.id, role: message.role, text: message.text },
      })
    ).conversation;
  },
  async remove(id) {
    await browserRequest(`${endpoint}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async reply(messages, surface, strength, onDelta, signal) {
    const requestId = crypto.randomUUID();
    const payload: NativeChatPayload = {
      requestId,
      surface,
      scope: 'general',
      course: { name: '普通聊天', language: 'zh-CN' },
      messages: messages.slice(-16).map(({ role, text }) => ({ role, text: text.slice(0, 6000) })),
      context: { notes: [], memories: [], calendar: [], attempts: [], problems: [] },
    };
    const result = await browserChat(
      { requestId, responseStrength: strength, payload },
      (event) => {
        if (
          event.event === 'text_delta' &&
          typeof (event.data as { delta?: unknown })?.delta === 'string'
        )
          onDelta((event.data as { delta: string }).delta);
      },
      signal,
    );
    return result.text;
  },
};
