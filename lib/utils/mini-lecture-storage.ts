import type { MiniLectureDeck } from '@/features/learn-core/client-mini-lecture';
import {
  getChatAttachmentBlobRecord,
  storeChatAttachmentBlob,
} from '@/lib/utils/chat-attachment-blobs';

export type MiniLectureStorageContext = {
  ownerId: string;
  courseId: string;
  sessionId: string;
  messageId: string;
};

function isGeneratedDeck(deck: MiniLectureDeck): boolean {
  return deck.markerProtocol.recoveredFrom === 'openai-image2-marker-recovery';
}

export function compactMiniLectureDeckForPersistence(
  deck: MiniLectureDeck | undefined,
): MiniLectureDeck | undefined {
  if (!deck || !isGeneratedDeck(deck)) return deck;
  const localAssetId = deck.localAssetId || `mini-lecture:${deck.id}`;
  return {
    ...deck,
    localAssetId,
    pages: deck.pages.map((page) => ({
      ...page,
      imageDataUrl: '',
      actions: page.actions.map((action) =>
        action.type === 'speech' ? { ...action, audioDataUrl: undefined } : action,
      ),
    })),
  };
}

export function miniLectureDeckAssetsAreHydrated(deck: MiniLectureDeck | undefined): boolean {
  if (!deck) return false;
  if (!isGeneratedDeck(deck)) return true;
  return deck.pages.every(
    (page) =>
      Boolean(page.imageDataUrl) &&
      page.actions.every((action) => action.type !== 'speech' || Boolean(action.audioDataUrl)),
  );
}

export async function saveMiniLectureDeckLocally(args: {
  context: MiniLectureStorageContext;
  deck: MiniLectureDeck;
}): Promise<void> {
  if (!isGeneratedDeck(args.deck)) return;
  const id = args.deck.localAssetId || `mini-lecture:${args.deck.id}`;
  const blob = new Blob([JSON.stringify({ ...args.deck, localAssetId: id })], {
    type: 'application/vnd.syntara.mini-lecture+json',
  });
  await storeChatAttachmentBlob(id, blob, {
    ...args.context,
    name: `${args.deck.title}.mini-lecture.json`,
    mimeType: blob.type,
    size: blob.size,
  });
}

export async function readMiniLectureDeckLocally(args: {
  context: MiniLectureStorageContext;
  deck: MiniLectureDeck;
}): Promise<MiniLectureDeck | null> {
  if (miniLectureDeckAssetsAreHydrated(args.deck)) return args.deck;
  const id = args.deck.localAssetId?.trim();
  if (!id) return null;
  const record = await getChatAttachmentBlobRecord(id);
  if (
    !record ||
    record.ownerId !== args.context.ownerId ||
    record.courseId !== args.context.courseId
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(await record.blob.text()) as MiniLectureDeck;
    if (parsed.id !== args.deck.id || !Array.isArray(parsed.pages)) return null;
    return parsed;
  } catch {
    return null;
  }
}
