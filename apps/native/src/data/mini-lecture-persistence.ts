import type {
  NativeMiniLectureManifest,
  NativeMiniLectureSpeechAction,
} from './platform-api-contracts';
import type { SaveMiniLectureInput } from './repository';
import type { LocalAsset } from '../domain/models';
import type {
  PersistedMiniLectureAction,
  PersistedMiniLectureDocument,
} from '../domain/learning-experiences';

function generatedAssetId(kind: 'image' | 'audio', sha256: string) {
  return `generated-mini-lecture:${kind}:${sha256}`;
}

function logicalAssetPath(
  manifest: NativeMiniLectureManifest,
  kind: 'image' | 'audio',
  index: number,
) {
  const extension = kind === 'image' ? 'png' : 'mp3';
  return `generated-mini-lectures/${manifest.contentHash}/${kind}-${String(index + 1).padStart(2, '0')}.${extension}`;
}

function createdTimestamp(manifest: NativeMiniLectureManifest) {
  const parsed = Date.parse(manifest.createdAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function generatedAsset(args: {
  id: string;
  path: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  dataBase64: string;
  source: string;
  timestamp: number;
}): LocalAsset {
  return {
    id: args.id,
    path: args.path,
    mimeType: args.mimeType,
    sizeBytes: args.bytes,
    sha256: args.sha256,
    source: args.source,
    dataBase64: args.dataBase64,
    storagePath: null,
    createdAt: args.timestamp,
    updatedAt: args.timestamp,
  };
}

function persistedSpeechAction(
  action: NativeMiniLectureSpeechAction,
  audioAssetId: string,
): PersistedMiniLectureAction {
  return {
    id: action.id,
    type: 'speech',
    regionId: action.regionId,
    title: action.title,
    text: action.text,
    audioAssetId,
    audioProvider: action.audio.provider,
    audioModel: action.audio.model,
    audioVoice: action.audio.voice,
    audioSha256: action.audio.sha256,
    audioBytes: action.audio.bytes,
  };
}

export function miniLectureManifestToPersistence(
  manifest: NativeMiniLectureManifest,
  messageId: string,
): SaveMiniLectureInput {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== 'syntara.native.mini-lecture' ||
    manifest.status !== 'ready' ||
    !manifest.pages.length
  ) {
    throw new Error('平台返回的课堂讲解尚未就绪。');
  }
  if (
    manifest.generator.image.model !== 'gpt-image-2' ||
    manifest.generator.tts.model !== 'gpt-4o-mini-tts'
  ) {
    throw new Error('课堂讲解没有使用要求的 Image2 与 OpenAI TTS 模型。');
  }

  const timestamp = createdTimestamp(manifest);
  const assetsById = new Map<string, LocalAsset>();
  let audioIndex = 0;
  const pages: PersistedMiniLectureDocument['pages'] = manifest.pages.map((page) => {
    if (
      page.recovery.status !== 'passed' ||
      page.recovery.recoveredRegionCount !== page.recovery.expectedRegionCount
    ) {
      throw new Error(`“${page.title}”没有通过严格标记恢复。`);
    }
    const regionIds = new Set(page.regions.map((region) => region.id));
    const imageAssetId = generatedAssetId('image', page.image.sha256);
    assetsById.set(
      imageAssetId,
      generatedAsset({
        id: imageAssetId,
        path: logicalAssetPath(manifest, 'image', page.order),
        mimeType: page.image.mimeType,
        bytes: page.image.bytes,
        sha256: page.image.sha256,
        dataBase64: page.image.base64,
        source: `generated:${manifest.lectureId}`,
        timestamp,
      }),
    );

    const actions = page.actions.map((action): PersistedMiniLectureAction => {
      if (!regionIds.has(action.regionId)) {
        throw new Error(`课堂动作引用了不存在的讲解区域：${action.regionId}`);
      }
      if (action.type === 'spotlight') return action;
      const audioAssetId = generatedAssetId('audio', action.audio.sha256);
      assetsById.set(
        audioAssetId,
        generatedAsset({
          id: audioAssetId,
          path: logicalAssetPath(manifest, 'audio', audioIndex),
          mimeType: action.audio.mimeType,
          bytes: action.audio.bytes,
          sha256: action.audio.sha256,
          dataBase64: action.audio.base64,
          source: `generated:${manifest.lectureId}`,
          timestamp,
        }),
      );
      audioIndex += 1;
      return persistedSpeechAction(action, audioAssetId);
    });
    if (!actions.some((action) => action.type === 'speech')) {
      throw new Error(`“${page.title}”没有 OpenAI 语音动作。`);
    }
    return {
      id: page.id,
      deckId: manifest.lectureId,
      order: page.order,
      title: page.title,
      imageAssetId,
      width: page.width,
      height: page.height,
      recoveryStatus: 'passed',
      regions: page.regions,
      actions,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });

  const document: PersistedMiniLectureDocument = {
    deck: {
      id: manifest.lectureId,
      messageId,
      title: manifest.title,
      origin: 'generated',
      packageName: manifest.kind,
      packageVersion: manifest.schemaVersion,
      status: 'ready',
      generatorMeta: {
        imageProvider: manifest.generator.image.provider,
        imageModel: manifest.generator.image.model,
        ttsProvider: manifest.generator.tts.provider,
        ttsModel: manifest.generator.tts.model,
        ttsVoice: manifest.generator.tts.voice,
        actionsProvider: manifest.generator.actions.provider,
        actionsModel: manifest.generator.actions.model,
        contentHash: manifest.contentHash,
        contentVersion: manifest.contentVersion,
        markerRecovery: 'passed',
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    pages,
  };
  return { document, assets: [...assetsById.values()] };
}
