import type {
  PersistedMiniLectureAction,
  PersistedMiniLectureDeck,
  PersistedMiniLectureDocument,
  PersistedMiniLecturePage,
} from '../domain/learning-experiences';
import type { LocalAsset } from '../domain/models';
import {
  bundledMiniLectureVersion,
  bundledMockMiniLectures,
  type NativeMiniLectureSpeechAction,
} from './mock-mini-lectures';

const BUNDLED_LECTURE_PACKAGE_NAME = 'mat136-image2-openai-tts';
const BUNDLED_LECTURE_PACKAGE_VERSION = 1;
const BUNDLED_LECTURE_TIMESTAMP = Date.UTC(2026, 6, 28, 0, 0, 0);

type BundledAssetDescriptor = {
  id: string;
  path: string;
  url: string;
  mimeType: string;
  expectedSha256?: string;
  expectedBytes?: number;
};

export type BundledMiniLectureSeed = {
  version: string;
  documents: PersistedMiniLectureDocument[];
  assets: BundledAssetDescriptor[];
};

function imageAssetId(pageId: string): string {
  return `bundled-lecture-image:${pageId}`;
}

function audioAssetId(actionId: string): string {
  return `bundled-lecture-audio:${actionId}`;
}

function assetPath(url: string): string {
  return `bundled-mini-lectures/${bundledMiniLectureVersion}/${url
    .split('/')
    .filter(Boolean)
    .slice(-3)
    .join('/')}`;
}

function persistedAction(
  action: ReturnType<typeof bundledMockMiniLectures>[number]['pages'][number]['actions'][number],
): PersistedMiniLectureAction {
  if (action.type === 'spotlight') return action;
  return {
    id: action.id,
    type: action.type,
    regionId: action.regionId,
    title: action.title,
    text: action.text,
    audioAssetId: audioAssetId(action.id),
    audioProvider: action.audioProvider,
    audioModel: action.audioModel,
    audioVoice: action.audioVoice,
    audioSha256: action.audioSha256,
    audioBytes: action.audioBytes,
  };
}

export function bundledMiniLectureSeed(): BundledMiniLectureSeed {
  const assets: BundledAssetDescriptor[] = [];
  const documents = bundledMockMiniLectures().map((sourceDeck) => {
    const deck: PersistedMiniLectureDeck = {
      id: sourceDeck.id,
      messageId: sourceDeck.sourceMessageId,
      title: sourceDeck.title,
      origin: 'bundled',
      packageName: BUNDLED_LECTURE_PACKAGE_NAME,
      packageVersion: BUNDLED_LECTURE_PACKAGE_VERSION,
      status: sourceDeck.status,
      generatorMeta: {
        ...sourceDeck.generatedBy,
        bundledVersion: bundledMiniLectureVersion,
      },
      createdAt: BUNDLED_LECTURE_TIMESTAMP,
      updatedAt: BUNDLED_LECTURE_TIMESTAMP,
    };
    const pages: PersistedMiniLecturePage[] = sourceDeck.pages.map((sourcePage, order) => {
      const pageImageAssetId = imageAssetId(sourcePage.id);
      assets.push({
        id: pageImageAssetId,
        path: assetPath(sourcePage.imageUrl),
        url: sourcePage.imageUrl,
        mimeType: 'image/png',
        expectedSha256: sourcePage.imageSha256,
        expectedBytes: sourcePage.imageBytes,
      });
      for (const action of sourcePage.actions) {
        if (action.type !== 'speech') continue;
        const speech = action as NativeMiniLectureSpeechAction;
        assets.push({
          id: audioAssetId(speech.id),
          path: assetPath(speech.audioUrl),
          url: speech.audioUrl,
          mimeType: 'audio/mpeg',
          expectedSha256: speech.audioSha256,
          expectedBytes: speech.audioBytes,
        });
      }
      return {
        id: sourcePage.id,
        deckId: sourceDeck.id,
        order,
        title: sourcePage.title,
        imageAssetId: pageImageAssetId,
        width: sourcePage.width,
        height: sourcePage.height,
        recoveryStatus: sourcePage.recoveryStatus,
        regions: sourcePage.regions,
        actions: sourcePage.actions.map(persistedAction),
        createdAt: BUNDLED_LECTURE_TIMESTAMP,
        updatedAt: BUNDLED_LECTURE_TIMESTAMP,
      };
    });
    return { deck, pages };
  });
  return { version: bundledMiniLectureVersion, documents, assets };
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 32_768;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', digestInput.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function materializeBundledMiniLectureAssets(
  descriptors: BundledAssetDescriptor[],
): Promise<LocalAsset[]> {
  return Promise.all(
    descriptors.map(async (descriptor) => {
      const response = await fetch(descriptor.url);
      if (!response.ok) {
        throw new Error(`无法读取内置课堂资源：${descriptor.url} (${response.status})`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const sha256 = await sha256Hex(bytes);
      if (descriptor.expectedSha256 && descriptor.expectedSha256 !== sha256) {
        throw new Error(`内置课堂资源校验失败：${descriptor.url}`);
      }
      if (descriptor.expectedBytes && descriptor.expectedBytes !== bytes.byteLength) {
        throw new Error(`内置课堂资源大小不匹配：${descriptor.url}`);
      }
      return {
        id: descriptor.id,
        path: descriptor.path,
        mimeType: descriptor.mimeType,
        sizeBytes: bytes.byteLength,
        sha256,
        source: `bundled:${bundledMiniLectureVersion}`,
        dataBase64: bytesToBase64(bytes),
        storagePath: null,
        createdAt: BUNDLED_LECTURE_TIMESTAMP,
        updatedAt: BUNDLED_LECTURE_TIMESTAMP,
      };
    }),
  );
}
