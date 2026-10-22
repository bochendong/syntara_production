const PHONE_PINNED_CHATS_KEY = 'syntara.phone.pinned-chats.v1';

/** iPhone 侧边栏里置顶的聊天 id，只存在本机。 */
export function readPinnedChatIds(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PHONE_PINNED_CHATS_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function writePinnedChatIds(ids: string[]) {
  try {
    localStorage.setItem(PHONE_PINNED_CHATS_KEY, JSON.stringify(ids));
  } catch {
    /* 没有存储时置顶只在这次打开里有效。 */
  }
}
