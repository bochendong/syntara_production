import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { UIMessage } from 'ai';
import { deleteChatAttachmentBlob } from '@/lib/utils/chat-attachment-blobs';
import type { ChatMessageMetadata } from '@/lib/types/chat';
import type { NotebookChatMessage } from './chat-page-types';

export function useChatMessageActions({
  setAgThread,
  setNbThread,
}: {
  setAgThread: Dispatch<SetStateAction<UIMessage<ChatMessageMetadata>[]>>;
  setNbThread: Dispatch<SetStateAction<NotebookChatMessage[]>>;
}) {
  const copyMessageText = useCallback(async (text: string) => {
    const normalized = text.trim();
    if (!normalized) return;
    try {
      await navigator.clipboard.writeText(normalized);
    } catch {
      // ignore clipboard errors
    }
  }, []);

  const deleteNotebookMessageAt = useCallback(
    (index: number) => {
      setNbThread((prev) => {
        const removed = prev[index];
        if (removed?.role === 'user' && removed.attachments?.length) {
          for (const attachment of removed.attachments) {
            if (attachment.objectUrl) URL.revokeObjectURL(attachment.objectUrl);
            void deleteChatAttachmentBlob(attachment.id);
          }
        }
        return prev.filter((_, i) => i !== index);
      });
    },
    [setNbThread],
  );

  const deleteAgentMessageById = useCallback(
    (messageId: string) => {
      setAgThread((prev) => {
        const removed = prev.find((message) => message.id === messageId);
        if (removed?.metadata?.attachments?.length) {
          for (const attachment of removed.metadata.attachments) {
            if (attachment.objectUrl) URL.revokeObjectURL(attachment.objectUrl);
            void deleteChatAttachmentBlob(attachment.id);
          }
        }
        return prev.filter((message) => message.id !== messageId);
      });
    },
    [setAgThread],
  );

  return {
    copyMessageText,
    deleteAgentMessageById,
    deleteNotebookMessageAt,
  };
}
