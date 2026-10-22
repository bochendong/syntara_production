import { accountStorageKey } from '../data/browser-runtime';
const PHONE_LAST_CHAT_KEY = 'syntara.phone.last-chat.v1';

export type PhoneLastChat = {
  courseId: string;
  conversationId: string | null;
};

/** iPhone 上最近使用的课程和聊天，只存在本机。 */
export function readPhoneLastChat(): PhoneLastChat | null {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(accountStorageKey(PHONE_LAST_CHAT_KEY)) ?? 'null',
    );
    if (!stored || typeof stored !== 'object') return null;
    const { courseId, conversationId } = stored as Record<string, unknown>;
    if (typeof courseId !== 'string' || !courseId) return null;
    return {
      courseId,
      conversationId: typeof conversationId === 'string' && conversationId ? conversationId : null,
    };
  } catch {
    return null;
  }
}

export function writePhoneLastChat(lastChat: PhoneLastChat) {
  try {
    localStorage.setItem(accountStorageKey(PHONE_LAST_CHAT_KEY), JSON.stringify(lastChat));
  } catch {
    /* 没有存储也能用，只是下次从第一门课开始。 */
  }
}
