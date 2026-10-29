import { getLocalRepository } from './repository';
import { queueSync, syncPrefix } from './sync-outbox';
import {
  getGeneralConversations,
  saveGeneralConversation,
  removeGeneralConversation,
  runNativeChatTurn,
} from './platform-api-client';
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
const post = <T>(payload: unknown) => saveGeneralConversation<T>(payload);
async function listRemoteGeneralConversations(): Promise<GeneralConversation[]> {
  const rows = new Map<string, GeneralConversation>();
  let cursor: string | null = null;
  const visited = new Set<string>();
  do {
    const page: { conversations: GeneralConversation[]; nextCursor?: string | null } =
      await getGeneralConversations(cursor ? { cursor } : {});
    for (const chat of page.conversations) rows.set(chat.id, chat);
    cursor = page.nextCursor ?? null;
    if (cursor && visited.has(cursor)) throw new Error('聊天记录分页异常，请重试');
    if (cursor) visited.add(cursor);
  } while (cursor);
  return [...rows.values()];
}
let flushing: Promise<void> | undefined;
export async function flushGeneralOutbox() {
  if (flushing) return flushing;
  flushing = (async () => {
    const repository = await getLocalRepository();
    const deletes = await repository.listSyncEntries(syncPrefix('general-delete', 'account'));
    const removed = new Set(deletes.map((entry) => JSON.parse(entry.value) as string));
    for (const entry of deletes) {
      await removeGeneralConversation(JSON.parse(entry.value));
      await repository.removeSyncEntry(entry.key, entry.value);
    }
    const messages = await repository.listSyncEntries(syncPrefix('general-message', 'account'));
    // General conversations are created on the server before any messages are
    // queued. Absence from the complete list is therefore an authoritative delete.
    const available = new Set(
      messages.length ? (await listRemoteGeneralConversations()).map((row) => row.id) : [],
    );
    for (const entry of messages) {
      const pending = JSON.parse(entry.value) as {
        conversationId: string;
        message: GeneralMessage;
      };
      if (!removed.has(pending.conversationId) && available.has(pending.conversationId))
        await post(pending);
      await repository.removeSyncEntry(entry.key, entry.value);
    }
  })().finally(() => {
    flushing = undefined;
  });
  return flushing;
}
export const generalChatClient: GeneralChatClient = {
  async list() {
    await flushGeneralOutbox();
    return listRemoteGeneralConversations();
  },
  async load(id) {
    await flushGeneralOutbox();
    return (await getGeneralConversations<{ messages: GeneralMessage[] }>({ id })).messages;
  },
  async create(title) {
    return (await post<{ conversation: GeneralConversation }>({ title })).conversation;
  },
  async append(conversationId, message) {
    const repository = await getLocalRepository();
    const entry = await queueSync(repository, 'general-message', 'account', message.id, {
      conversationId,
      message,
    });
    const result = (
      await post<{ conversation: GeneralConversation }>({
        conversationId,
        message: { id: message.id, role: message.role, text: message.text },
      })
    ).conversation;
    await repository.removeSyncEntry(entry.key, entry.value);
    return result;
  },
  async remove(id) {
    await queueSync(await getLocalRepository(), 'general-delete', 'account', id, id);
    void flushGeneralOutbox().catch((cause) =>
      console.warn('[general-chat] deletion queued', cause),
    );
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
    const result = await runNativeChatTurn(
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
