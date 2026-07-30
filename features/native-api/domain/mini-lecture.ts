import { z } from 'zod';

export const NATIVE_MINI_LECTURE_SCHEMA_VERSION = 1 as const;
export const NATIVE_MINI_LECTURE_MANIFEST_KIND = 'syntara.native.mini-lecture' as const;

const identifierSchema = z.string().trim().min(1).max(200);
const compactTextSchema = z.string().trim().min(1).max(2_000);
const answerTextSchema = z.string().trim().min(1).max(24_000);
const sourceTextSchema = z.string().trim().min(1).max(16_000);

const messageSchema = z.union([
  compactTextSchema,
  z
    .object({
      id: identifierSchema.optional(),
      text: compactTextSchema,
    })
    .strict(),
]);

const answerSchema = z.union([
  answerTextSchema,
  z
    .object({
      id: identifierSchema.optional(),
      title: z.string().trim().min(1).max(180).optional(),
      text: answerTextSchema,
    })
    .strict(),
]);

const courseSchema = z.union([
  z.string().trim().min(1).max(200),
  z
    .object({
      id: identifierSchema.optional(),
      name: z.string().trim().min(1).max(200),
      subject: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().min(1).max(2_000).optional(),
      courseCode: z.string().trim().min(1).max(80).optional(),
      purpose: z.enum(['research', 'university', 'daily']).optional(),
    })
    .strict(),
]);

const sourceReferenceSchema = z
  .object({
    id: identifierSchema.optional(),
    title: z.string().trim().min(1).max(240).optional(),
    excerpt: z.string().trim().min(1).max(2_000).optional(),
    url: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

const sourceSchema = z.union([
  sourceTextSchema,
  z
    .object({
      id: identifierSchema.optional(),
      title: z.string().trim().min(1).max(240).optional(),
      text: sourceTextSchema.optional(),
      references: z.array(sourceReferenceSchema).max(12).optional(),
    })
    .strict()
    .refine((value) => Boolean(value.text || value.references?.length), {
      message: 'source must include text or references',
    }),
]);

export const nativeMiniLectureRequestSchema = z
  .object({
    course: courseSchema.optional(),
    message: messageSchema,
    answer: answerSchema,
    source: sourceSchema.optional(),
    pageCount: z.union([z.literal(1), z.literal(2)]).default(1),
    language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
    ttsVoice: z.string().trim().min(1).max(64).default('marin'),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type NativeMiniLectureRequest = z.infer<typeof nativeMiniLectureRequestSchema>;

export type NativeMiniLectureProviderMeta = {
  provider: string;
  model: string;
};

export type NativeMiniLectureRegion = {
  id: string;
  semanticId: string;
  label: string;
  order: number;
  role: string;
  color: string;
  /** Classroom canvas coordinates: [left, top, width, height]. */
  bbox: [number, number, number, number];
};

export type NativeMiniLectureImageAsset = NativeMiniLectureProviderMeta & {
  delivery: 'inline-base64';
  mimeType: 'image/png';
  base64: string;
  sha256: string;
  bytes: number;
  pixelWidth: number;
  pixelHeight: number;
  promptHash?: string;
};

export type NativeMiniLectureAudioAsset = NativeMiniLectureProviderMeta & {
  delivery: 'inline-base64';
  mimeType: 'audio/mpeg';
  format: 'mp3';
  base64: string;
  sha256: string;
  bytes: number;
  voice: string;
  speed: number;
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
  audio: NativeMiniLectureAudioAsset;
};

export type NativeMiniLectureAction =
  | NativeMiniLectureSpotlightAction
  | NativeMiniLectureSpeechAction;

export type NativeMiniLecturePage = {
  id: string;
  order: number;
  title: string;
  /** Coordinate space used by every region bbox. */
  width: 1000;
  height: 562.5;
  image: NativeMiniLectureImageAsset;
  recovery: {
    status: 'passed';
    recoveredAt?: number;
    findings: string[];
    expectedRegionCount: number;
    recoveredRegionCount: number;
  };
  regions: NativeMiniLectureRegion[];
  actions: NativeMiniLectureAction[];
};

export type NativeMiniLectureManifest = {
  schemaVersion: typeof NATIVE_MINI_LECTURE_SCHEMA_VERSION;
  kind: typeof NATIVE_MINI_LECTURE_MANIFEST_KIND;
  lectureId: string;
  idempotencyKey: string;
  requestHash: string;
  contentHash: string;
  contentVersion: string;
  status: 'ready';
  title: string;
  language: 'zh-CN' | 'en-US';
  source: {
    courseId?: string;
    messageId?: string;
    answerId?: string;
    sourceId?: string;
  };
  generator: {
    image: NativeMiniLectureProviderMeta;
    actions: NativeMiniLectureProviderMeta;
    tts: NativeMiniLectureProviderMeta & {
      voice: string;
    };
  };
  pages: NativeMiniLecturePage[];
  createdAt: string;
};

export type NativeMiniLectureErrorCode =
  | 'INVALID_REQUEST'
  | 'IDEMPOTENCY_CONFLICT'
  | 'IMAGE_GENERATION_FAILED'
  | 'MARKER_RECOVERY_FAILED'
  | 'ACTION_GENERATION_FAILED'
  | 'TTS_GENERATION_FAILED'
  | 'MISSING_PROVIDER_CONFIGURATION'
  | 'INTERNAL_ERROR';

export type NativeMiniLectureErrorStage =
  | 'validation'
  | 'idempotency'
  | 'image'
  | 'marker-recovery'
  | 'actions'
  | 'tts'
  | 'internal';

export type NativeMiniLectureErrorBody = {
  ok: false;
  error: {
    code: NativeMiniLectureErrorCode;
    message: string;
    retryable: boolean;
    stage: NativeMiniLectureErrorStage;
    details?: Record<string, unknown>;
  };
};

export type NativeMiniLectureSuccessBody = {
  ok: true;
  data: NativeMiniLectureManifest;
  meta: {
    idempotency: {
      key: string;
      replayed: boolean;
      scope: 'server-process';
    };
  };
};
