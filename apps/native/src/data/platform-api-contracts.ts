import type { NativeMessageMetadata } from '../domain/teaching';

export interface PlatformApiError {
  code?: string;
  message: string;
  retryable?: boolean;
  stage?: string;
  details?: unknown;
}

export type PlatformApiEnvelope<T> =
  | { ok: true; data: T }
  | { success: true; data?: T; [key: string]: unknown }
  | { ok: false; error: PlatformApiError }
  | { success: false; error: PlatformApiError | string };

export interface PlatformCommandOptions {
  syntaraToken?: string;
  idempotencyKey?: string;
  /** Safe model preference; provider credentials remain server-only. */
  model?: string;
}

export interface PlatformJsonCommandRequest<TPayload> extends PlatformCommandOptions {
  requestId: string;
  payload: TPayload;
}

export interface NativePlatformCapabilities {
  service?: string;
  schemaVersion?: number;
  version?: string;
  available: boolean;
  access?: {
    mode: 'authenticated' | 'shared-test' | 'bearer' | string;
    bearerRequired: boolean;
    providerCredentials: 'server-only' | string;
  };
  capabilities: {
    teachingTurn?: boolean;
    miniLecture?: boolean;
    reviewPlan?: boolean;
    grading?: boolean;
    transcription?: boolean;
    syllabus?: boolean;
    notebookGeneration?: boolean;
    [key: string]: boolean | undefined;
  };
  models?: Array<{ id: string; label?: string; recommended?: boolean }>;
  details?: {
    teachingTurn?: {
      path: string;
      transport: Array<'json' | 'sse' | string>;
    };
    miniLecture?: {
      path: string;
      imageProvider: string;
      imageModel: string;
      ttsProvider: string;
      ttsModel: string;
      browserSpeechSynthesis: boolean;
    };
  };
  dataBoundary?: {
    providerKeys: 'server-only' | string;
    localContext: 'request-scoped' | string;
    generatedAssets: 'download-to-app-data' | string;
    generatedMetadata: 'sqlite' | string;
  };
}

export interface NativeDeviceUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: 'USER' | 'ADMIN';
}

export interface NativeDeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

export interface NativeDeviceTokenPair {
  status: 'authorized';
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
  user: NativeDeviceUser;
}

export type NativeDevicePollResult =
  | NativeDeviceTokenPair
  | { status: 'pending'; intervalSeconds: number };

export interface NativeTeachingTurnMessage {
  id?: string;
  role: 'user' | 'assistant';
  text: string;
}

export interface NativeTeachingTurnPayload {
  requestId: string;
  clientTurnId?: string;
  question: string;
  course: {
    id?: string;
    name: string;
    code?: string;
    description?: string;
    language?: 'zh-CN' | 'en-US';
  };
  conversation: {
    id?: string;
    recentMessages: NativeTeachingTurnMessage[];
  };
  localContext?: {
    calendarEvents?: unknown[];
    memories?: unknown[];
    attempts?: unknown[];
    problemCandidates?: unknown[];
    notebookExcerpts?: unknown[];
    sourceExcerpts?: unknown[];
    recentPlans?: unknown[];
    [key: string]: unknown;
  };
  preferences?: {
    language?: 'zh-CN' | 'en-US';
    allowWebSearch?: boolean;
  };
}

export interface NativePlatformStreamEvent {
  requestId: string;
  sequence: number;
  eventId?: string | null;
  event:
    | 'status'
    | 'planning'
    | 'agent_start'
    | 'agent_end'
    | 'text_delta'
    | 'action'
    | 'artifact'
    | 'usage'
    | 'done'
    | 'error'
    | string;
  data: unknown;
}

export interface NativeTeachingTurnResult {
  requestId: string;
  text: string;
  model: string | null;
  responseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  finalEvent: unknown;
}

export interface NativeMiniLectureRequest {
  course?:
    | string
    | {
        id?: string;
        name: string;
        subject?: string;
        description?: string;
        courseCode?: string;
        purpose?: 'research' | 'university' | 'daily';
      };
  message: string | { id?: string; text: string };
  answer: string | { id?: string; title?: string; text: string };
  source?:
    | string
    | {
        id?: string;
        title?: string;
        text?: string;
        references?: Array<{
          id?: string;
          title?: string;
          excerpt?: string;
          url?: string;
        }>;
      };
  pageCount?: 1 | 2;
  language?: 'zh-CN' | 'en-US';
  ttsVoice?: string;
  idempotencyKey?: string;
}

export interface NativeMiniLectureProviderMeta {
  provider: string;
  model: string;
}

export interface NativeMiniLectureImageAsset extends NativeMiniLectureProviderMeta {
  delivery: 'inline-base64';
  mimeType: 'image/png';
  base64: string;
  sha256: string;
  bytes: number;
  pixelWidth: number;
  pixelHeight: number;
  promptHash?: string;
}

export interface NativeMiniLectureAudioAsset extends NativeMiniLectureProviderMeta {
  delivery: 'inline-base64';
  mimeType: 'audio/mpeg';
  format: 'mp3';
  base64: string;
  sha256: string;
  bytes: number;
  voice: string;
  speed: number;
}

export interface NativeMiniLectureRegion {
  id: string;
  semanticId: string;
  label: string;
  order: number;
  role: string;
  color: string;
  /** Classroom canvas coordinates: [left, top, width, height]. */
  bbox: [number, number, number, number];
}

export interface NativeMiniLectureSpotlightAction {
  id: string;
  type: 'spotlight';
  regionId: string;
  title: string;
  dimOpacity: number;
}

export interface NativeMiniLectureSpeechAction {
  id: string;
  type: 'speech';
  regionId: string;
  title: string;
  text: string;
  audio: NativeMiniLectureAudioAsset;
}

export type NativeMiniLectureAction =
  | NativeMiniLectureSpotlightAction
  | NativeMiniLectureSpeechAction;

export interface NativeMiniLecturePage {
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
}

export interface NativeMiniLectureManifest {
  schemaVersion: 1;
  kind: 'syntara.native.mini-lecture';
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
}

export interface NativeReviewPlanRequest {
  course: { id: string; name?: string; code?: string };
  query: string;
  today?: string;
  scheduleEvents?: unknown[];
  attempts?: unknown[];
  memories?: unknown[];
  problemCandidates?: unknown[];
  constraints?: {
    totalMinutes?: number;
    questionCount?: number;
    maxTasks?: number;
  };
}

export interface NativeReviewPlanResponse {
  decision: unknown;
  messageMetadata?: Pick<
    NativeMessageMetadata,
    'reviewPlan' | 'problemSelection' | 'evidence' | 'teachingRunId'
  >;
}

export interface NativeGradeRequest {
  question: string;
  userAnswer: string;
  points: number;
  language?: string;
  questionType?: 'short_answer' | 'proof' | 'code_tracing';
  referenceAnswer?: string;
  proof?: string;
  analysis?: string;
  commentPrompt?: string;
}

export interface NativeGradeResponse {
  score: number;
  comment: string;
  diagnosis?: {
    knowledgePoint?: string;
    stuckPoint?: string;
    cause?: string;
    nextTeachingMove?: string;
  };
}

export interface NativeTranscriptionRequest {
  fileName: string;
  mimeType: string;
  dataBase64: string;
  language?: string;
}

export interface NativeTranscriptionResponse {
  text: string;
  language?: string;
  durationSeconds?: number;
}

export interface NativeSyllabusRequest {
  course: {
    id?: string;
    name: string;
    description?: string;
  };
  file: {
    name: string;
    mimeType: string;
    dataBase64: string;
  };
  preferences?: {
    model?: string;
  };
}

export interface NativeSyllabusEvent {
  id?: string;
  title: string;
  kind: 'assignment' | 'exam' | 'progress' | 'tutorial' | 'holiday' | 'other';
  date: string;
  week?: string | null;
  sourceColumn?: string | null;
  rawText?: string | null;
  confidence?: number | null;
}

export interface NativeSyllabusResponse {
  courseTitle?: string | null;
  sourceMarkdown?: string;
  events: NativeSyllabusEvent[];
  warnings: string[];
  model?: string;
  modelId?: string;
}
