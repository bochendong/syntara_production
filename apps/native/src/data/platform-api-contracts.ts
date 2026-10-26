import type { PhotoAnswerImage } from './local-problem-grading';
import type { LocalCourseEvent } from '../domain/learning-experiences';
import type {
  LocalAsset,
  LocalMarkdownSection,
  LocalNotebook,
  LocalNotebookAssetLink,
  LocalNotebookPage,
  LocalPageAsset,
  LocalProblem,
  LocalProblemProgress,
  LocalStudyMemory,
} from '../domain/models';

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
  /** 回复强度，平台按网页端同一套档位选模型。 */
  responseStrength?: 'low' | 'medium' | 'high';
}

export interface NativeWeeklyUsage {
  databaseEnabled: boolean;
  period: { start: string; end: string };
  usedUsd: number;
  limitUsd: number | null;
  remainingUsd: number | null;
  requestCount: number;
  requestLimit: number | null;
  remainingRequests: number | null;
  disabled: boolean;
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
    chat?: boolean;
    miniLecture?: boolean;
    grading?: boolean;
    transcription?: boolean;
    syllabus?: boolean;
    notebookGeneration?: boolean;
    [key: string]: boolean | undefined;
  };
  models?: Array<{ id: string; label?: string; recommended?: boolean }>;
  details?: {
    chat?: {
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
  role: 'USER' | 'STUDENT' | 'TEACHER' | 'ADMIN';
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

export interface NativeChatTurnResult {
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

export interface NativeGradeRequest {
  question: string;
  userAnswer: string;
  images?: PhotoAnswerImage[];
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

export interface NativeRealtimeTranscriptionRequest {
  /** ISO-639-1，比如 zh、en；不传就让模型自己判断。 */
  language?: string;
}

export interface NativeRealtimeTranscriptionResponse {
  clientSecret: string;
  expiresAt: number;
  model: string;
  callsUrl: string;
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

/** A course the signed-in account owns, joined or bought on the web platform. */
export interface NativePlatformCourse {
  id: string;
  name: string;
  courseCode: string | null;
  description: string | null;
  language: string;
  avatarUrl: string;
  accessRole: 'owner' | 'enrolled';
  /** 从商城加入的机构课程才有。 */
  organizationName?: string | null;
  /** 机构发布了新版、自己还没打开看过。 */
  hasUpdate?: boolean;
  /** 「+3 题，改了 1 篇笔记」这样的更新摘要；没有更新时为空。 */
  updateSummary?: string | null;
  updatedAt: string;
}

/** 加入的课里一项被自己隐藏的公有内容。 */
export interface NativeHiddenCourseContent {
  targetType: 'notebook' | 'problem';
  targetId: string;
  title: string;
  hiddenAt: number;
}

/** 加入的课的两层信息（/api/native/v1/store?layersOf=）。 */
export interface NativeCourseLayers {
  hidden: NativeHiddenCourseContent[];
  newNotebookIds: string[];
  privateNotebookIds: string[];
  update: { text: string } | null;
}

/** 题目在两层里的位置：公有（发布者的）还是自己的；什么时候发布、什么时候改过。 */
export interface NativeProblemLayerFields {
  layer?: 'public' | 'private';
  releaseAddedIn?: number | null;
  contentUpdatedAt?: number | null;
}

/** 商城里的一门机构课程（/api/native/v1/store）。 */
export interface NativeStoreCourse {
  id: string;
  name: string;
  courseCode: string | null;
  description: string | null;
  avatarUrl: string;
  organization: { id: string; name: string; logoUrl: string | null; verified: boolean } | null;
  notebookCount: number;
  sceneCount: number;
  problemCount: number;
  learnerCount: number;
  averageRating: number;
  reviewCount: number;
  purpose: string;
  university: string | null;
  tags: string[];
  joined: boolean;
  updatedAt: string;
}

/** 商城详情（/api/native/v1/store?courseId=）。 */
export interface NativeStoreCourseDetail extends NativeStoreCourse {
  notebooks: Array<{
    id: string;
    name: string;
    description: string | null;
    sceneCount: number;
    problemCount: number;
  }>;
  reviews: Array<{ id: string; rating: number; comment: string | null; reviewerName: string }>;
}

/** 资料页上传到账号的一份笔记或题目。 */
export interface NativeMaterialUpload {
  courseId: string;
  kind: 'notes' | 'problems';
  clientId: string;
  name: string;
  text: string;
}

export type NativeMaterialUploadResult =
  | { status: 'saved'; kind: 'notes'; notebookId: string }
  | { status: 'saved'; kind: 'problems'; problemId: string };

/** Course chat message as stored by the web platform (`learn_message`). */
export interface NativeSyncedChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt?: number;
  attachments?: Array<{ id?: string; name?: string; mimeType?: string; size?: number }>;
  [key: string]: unknown;
}

export interface NativeSyncedConversationSummary {
  id: string;
  conversationId: string;
  title: string;
  createdAt: number | string;
  updatedAt: number | string;
  currentRevision: number;
  messageCount: number;
}

export interface NativeSyncedConversationList {
  sessions: NativeSyncedConversationSummary[];
  hasMore: boolean;
  nextCursor: string | null;
  totalCount: number;
}

export interface NativeSyncedConversationSnapshot {
  session: NativeSyncedConversationSummary | null;
  messages: NativeSyncedChatMessage[];
  deletedMessageIds: string[];
  /** 更早的消息还有没有；nextCursor 传给 before 取上一页。 */
  messagePage?: { hasMore: boolean; nextCursor: string | null; limit: number };
  currentRevision: number;
}

export interface NativeConversationSyncPayload {
  courseId: string;
  sessionId: string;
  title?: string;
  messages: NativeSyncedChatMessage[];
  deletedMessageIds?: string[];
}

export interface NativeConversationSyncResult {
  accepted: boolean;
  currentRevision: number;
}

/** 网页笔记的列表信息；contentVersion 变了才需要重新下载正文。 */
export type NativeSyncedNotebook = LocalNotebook & { contentVersion: number };

/** 网页上已生成好的课堂，answerMessageId 是挂课堂的那条老师回复。 */
export interface NativeSyncedMiniLecture {
  id: string;
  answerMessageId: string;
  title: string;
  createdAt: number;
}

/** 网页右侧可拖动的学习进度：学到哪一本，或还没开始 / 已学完。 */
export interface NativeLearningProgress {
  kind: 'not_started' | 'notebook' | 'completed_all';
  notebookId: string | null;
  updatedAt: number;
}

/** App 打开课程时从网页拉取的笔记列表、学习记忆、日历、学习进度和课堂清单。 */
export interface NativeCourseData {
  courseId: string;
  notebooks: NativeSyncedNotebook[];
  memories: LocalStudyMemory[];
  events: LocalCourseEvent[];
  miniLectures: NativeSyncedMiniLecture[];
  learningProgress: NativeLearningProgress | null;
}

/** 网页题库：since 之后改过的题、当前全部题目 id，以及这个账号的做题进度（得分率 0–1）。 */
export interface NativeProblemSnapshot {
  courseId: string;
  serverTime: number;
  problemIds: string[];
  /** false 表示题目太多被截断，没出现在 problemIds 里的不一定是网页上删掉的。 */
  complete: boolean;
  /** 题目的 releaseAddedIn 比它大就标「新」；自己建的课为 null。 */
  newSinceVersion?: number | null;
  problems: Array<LocalProblem & NativeProblemLayerFields>;
  progress: Array<Omit<LocalProblemProgress, 'id'>>;
}

/** 一条 App 作答，传到网页题库；id 固定，重复上传只记一次。 */
export interface NativeProblemAttemptUpload {
  event?: 'solution_viewed' | 'answer_reset';
  progressSnapshot?: { status: string; score: number | null; attemptedCount: number } | null;
  id: string;
  problemId: string;
  status: 'pending' | 'passed' | 'failed' | 'partial';
  score: number | null;
  answer: {
    selectedOptionIds?: string[];
    text?: string;
    code?: string;
    images?: PhotoAnswerImage[];
  };
  feedback?: string | null;
  autoGraded?: boolean;
  createdAt: number;
}

/** 一本网页笔记的完整内容，字段与本机迁移包一致。 */
export interface NativeNotebookArchive {
  notebook: NativeSyncedNotebook;
  notebookPages: LocalNotebookPage[];
  markdownSections: LocalMarkdownSection[];
  assets: LocalAsset[];
  pageAssets: LocalPageAsset[];
  notebookAssets: LocalNotebookAssetLink[];
  missingAssetPaths: string[];
}

/** 新手引导的五步，顺序固定：建课 → 资料 → 第一句 → 记住 → 商城。 */
export type NativeOnboardingStep = 'course' | 'store' | 'ask' | 'delete';

/** 账号上的新手引导进度，和 lib/server/onboarding.ts 的 OnboardingState 一致。 */
export interface NativeOnboardingState {
  status: 'active' | 'done' | 'skipped';
  completed: NativeOnboardingStep[];
  next: NativeOnboardingStep | null;
}
