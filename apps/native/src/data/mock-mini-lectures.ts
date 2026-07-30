import generatedManifest from './generated-mat136-mini-lectures.json';

export type NativeMiniLectureRegion = {
  id: string;
  semanticId: string;
  label: string;
  order: number;
  role: string;
  color: string;
  /** OpenMAIC classroom canvas coordinates: [left, top, width, height]. */
  bbox: [number, number, number, number];
};

export type NativeMiniLectureSpotlightAction = {
  id: string;
  type: 'spotlight';
  regionId: string;
  title: string;
  dimOpacity: number;
};

export type NativeMiniLectureSpeechAction = {
  id: string;
  type: 'speech';
  regionId: string;
  title: string;
  text: string;
  audioUrl: string;
  audioProvider: 'openai-tts';
  audioModel: 'gpt-4o-mini-tts';
  audioVoice: string;
  audioSha256: string;
  audioBytes: number;
};

export type NativeMiniLectureAction =
  | NativeMiniLectureSpotlightAction
  | NativeMiniLectureSpeechAction;

export type NativeMiniLecturePage = {
  id: string;
  title: string;
  imageUrl: string;
  imageSha256: string;
  imageBytes: number;
  width: number;
  height: number;
  recoveryStatus: 'passed';
  regions: NativeMiniLectureRegion[];
  actions: NativeMiniLectureAction[];
};

export type NativeMiniLectureDeck = {
  id: string;
  sourceMessageId: string;
  title: string;
  status: 'ready';
  generatedBy: {
    imageProvider: 'openai-image';
    imageModel: 'gpt-image-2';
    ttsProvider: 'openai-tts';
    ttsModel: 'gpt-4o-mini-tts';
    ttsVoice: string;
  };
  pages: NativeMiniLecturePage[];
};

type GeneratedMiniLectureManifest = {
  schemaVersion: 1;
  contentVersion: string;
  decks: Record<string, NativeMiniLectureDeck>;
};

const manifest = generatedManifest as unknown as GeneratedMiniLectureManifest;

export const NATIVE_MINI_LECTURE_WIDTH = 1000;
export const NATIVE_MINI_LECTURE_HEIGHT = 562.5;
export const bundledMiniLectureVersion = manifest.contentVersion;

export function bundledMockMiniLectures(): NativeMiniLectureDeck[] {
  return Object.values(manifest.decks).filter((deck) => deck.status === 'ready');
}

export function bundledMockMiniLecture(messageId: string): NativeMiniLectureDeck | null {
  const deck = manifest.decks[messageId];
  if (!deck || deck.status !== 'ready') return null;
  return deck;
}
