import { browserApp } from './browser-runtime';
import {
  browserChat,
  browserCommand,
  browserCommandHeaders,
  browserRequest,
} from './browser-platform';
import type {
  NativeConversationSyncPayload,
  NativeConversationSyncResult,
  NativeCourseData,
  NativeNotebookArchive,
  NativePlatformCourse,
  NativeProblemAttemptUpload,
  NativeProblemSnapshot,
  NativeSyncedConversationList,
  NativeSyncedConversationSnapshot,
  NativeGradeRequest,
  NativeGradeResponse,
  NativeLearningProgress,
  NativeMaterialUpload,
  NativeMaterialUploadResult,
  NativeStoreCourse,
  NativeDeviceAuthorization,
  NativeDevicePollResult,
  NativeDeviceTokenPair,
  NativeDeviceUser,
  NativeMiniLectureManifest,
  NativeSyncedMiniLecture,
  NativeMiniLectureRequest,
  NativePlatformCapabilities,
  NativePlatformStreamEvent,
  NativeSyllabusRequest,
  NativeSyllabusResponse,
  NativeChatTurnResult,
  NativeTranscriptionRequest,
  NativeTranscriptionResponse,
  NativeWeeklyUsage,
  PlatformApiEnvelope,
  PlatformCommandOptions,
  PlatformJsonCommandRequest,
} from './platform-api-contracts';
import type { LocalStudyMemory } from '../domain/models';
import { resolveNativePlatformToken } from './platform-auth-token';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function assertTauriRuntime() {
  if (!isTauriRuntime()) {
    throw new Error('平台 AI 服务只在 macOS / iPadOS 原生 App 中启用。');
  }
}

function platformErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return '平台 AI 服务返回未知错误。';
}

export function unwrapPlatformEnvelope<T>(response: PlatformApiEnvelope<T> | T): T {
  if (!response || typeof response !== 'object') return response as T;
  if ('ok' in response && response.ok === false) {
    throw new Error(platformErrorMessage(response.error));
  }
  if ('success' in response && response.success === false) {
    throw new Error(platformErrorMessage(response.error));
  }
  if ('data' in response && response.data !== undefined) {
    return response.data as T;
  }
  return response as T;
}

async function invokeJson<TPayload, TResult>(
  command: string,
  request: PlatformJsonCommandRequest<TPayload>,
): Promise<TResult> {
  if (browserApp)
    return browserCommand(command, request.payload, undefined, browserCommandHeaders(request));
  assertTauriRuntime();
  const { invoke } = await import('@tauri-apps/api/core');
  const authenticatedRequest = {
    ...request,
    syntaraToken:
      request.syntaraToken === undefined
        ? await resolveNativePlatformToken()
        : request.syntaraToken,
  };
  const response = await invoke<PlatformApiEnvelope<TResult> | TResult>(command, {
    request: authenticatedRequest,
  });
  return unwrapPlatformEnvelope(response);
}

export async function getNativePlatformCapabilities(
  options: Pick<PlatformCommandOptions, 'syntaraToken'> = {},
): Promise<NativePlatformCapabilities> {
  if (browserApp) return browserRequest('/api/native/v1/capabilities');
  assertTauriRuntime();
  const { invoke } = await import('@tauri-apps/api/core');
  const syntaraToken =
    options.syntaraToken === undefined ? await resolveNativePlatformToken() : options.syntaraToken;
  const response = await invoke<
    PlatformApiEnvelope<NativePlatformCapabilities> | NativePlatformCapabilities
  >('native_get_capabilities', { request: { ...options, syntaraToken } });
  return unwrapPlatformEnvelope(response);
}

export async function getTesterLoginConfig(): Promise<{ enabled: boolean; email: string }> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('native_tester_login_config');
}

export function loginNativeTester(input: {
  email: string;
  password: string;
  deviceId: string;
  deviceName: string;
}): Promise<NativeDeviceTokenPair> {
  return invokeJson<typeof input, NativeDeviceTokenPair>('native_tester_login', {
    requestId: crypto.randomUUID(),
    payload: input,
    syntaraToken: '',
  });
}

export function startNativeDeviceAuth(input: {
  deviceId: string;
  deviceName: string;
}): Promise<NativeDeviceAuthorization> {
  return invokeJson<typeof input, NativeDeviceAuthorization>('native_start_device_auth', {
    requestId: crypto.randomUUID(),
    payload: input,
    syntaraToken: '',
  });
}

export function pollNativeDeviceAuth(deviceCode: string): Promise<NativeDevicePollResult> {
  return invokeJson<{ deviceCode: string }, NativeDevicePollResult>('native_poll_device_auth', {
    requestId: crypto.randomUUID(),
    payload: { deviceCode },
    syntaraToken: '',
  });
}

export function refreshNativeDeviceAuth(refreshToken: string): Promise<NativeDeviceTokenPair> {
  return invokeJson<{ refreshToken: string }, NativeDeviceTokenPair>('native_refresh_device_auth', {
    requestId: crypto.randomUUID(),
    payload: { refreshToken },
    syntaraToken: '',
  });
}

export async function getNativeCurrentUser(
  syntaraToken: string,
): Promise<{ sessionId: string; user: NativeDeviceUser }> {
  assertTauriRuntime();
  const { invoke } = await import('@tauri-apps/api/core');
  const response = await invoke<
    | PlatformApiEnvelope<{ sessionId: string; user: NativeDeviceUser }>
    | {
        sessionId: string;
        user: NativeDeviceUser;
      }
  >('native_get_current_user', { request: { syntaraToken } });
  return unwrapPlatformEnvelope(response);
}

export function logoutNativeDevice(syntaraToken: string): Promise<{ revoked: boolean }> {
  return invokeJson<Record<string, never>, { revoked: boolean }>('native_logout_device', {
    requestId: crypto.randomUUID(),
    payload: {},
    syntaraToken,
  });
}

async function runStreamingTurn<TPayload>(
  command: 'native_chat',
  request: PlatformJsonCommandRequest<TPayload>,
  onEvent?: (event: NativePlatformStreamEvent) => void,
): Promise<NativeChatTurnResult> {
  if (browserApp) return browserChat(request, onEvent);
  assertTauriRuntime();
  const [{ invoke }, { listen }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ]);
  const unlisten = onEvent
    ? await listen<NativePlatformStreamEvent>('syntara://platform-ai-stream', ({ payload }) => {
        if (payload.requestId === request.requestId) onEvent(payload);
      })
    : () => {};
  try {
    const authenticatedRequest = {
      ...request,
      syntaraToken:
        request.syntaraToken === undefined
          ? await resolveNativePlatformToken()
          : request.syntaraToken,
    };
    return await invoke<NativeChatTurnResult>(command, {
      request: authenticatedRequest,
    });
  } finally {
    unlisten();
  }
}

/** 手机 / 桌面端独立的助教聊天（/api/native/v2/chat，SSE 流式）。 */
export function runNativeChatTurn<TPayload>(
  request: PlatformJsonCommandRequest<TPayload>,
  onEvent?: (event: NativePlatformStreamEvent) => void,
): Promise<NativeChatTurnResult> {
  return runStreamingTurn('native_chat', request, onEvent);
}

export function createNativeMiniLecture(
  payload: NativeMiniLectureRequest,
  options: PlatformCommandOptions = {},
): Promise<NativeMiniLectureManifest> {
  const idempotencyKey = options.idempotencyKey || payload.idempotencyKey || crypto.randomUUID();
  return invokeJson<NativeMiniLectureRequest, NativeMiniLectureManifest>(
    'native_create_mini_lecture',
    {
      requestId: crypto.randomUUID(),
      payload: {
        ...payload,
        idempotencyKey,
      },
      syntaraToken: options.syntaraToken,
      idempotencyKey,
      model: options.model,
    },
  );
}

export function gradeNativeAnswer(
  payload: NativeGradeRequest,
  options: PlatformCommandOptions = {},
): Promise<NativeGradeResponse> {
  return invokeJson<NativeGradeRequest, NativeGradeResponse>('native_grade_answer', {
    requestId: crypto.randomUUID(),
    payload,
    ...options,
  }).then((result) => {
    if (
      !result ||
      typeof result !== 'object' ||
      typeof result.score !== 'number' ||
      !Number.isFinite(result.score) ||
      !Number.isInteger(result.score) ||
      result.score < 0 ||
      result.score > payload.points
    ) {
      throw new Error(`平台 AI 批改返回了无效分数（应为 0–${payload.points} 的整数）。`);
    }
    if (typeof result.comment !== 'string' || !result.comment.trim()) {
      throw new Error('平台 AI 批改没有返回有效评语。');
    }
    if (result.comment.trim().length > 2_000) {
      throw new Error('平台 AI 批改返回的评语过长。');
    }
    return {
      ...result,
      comment: result.comment.trim(),
    };
  });
}

export function transcribeNativeAudio(
  payload: NativeTranscriptionRequest,
  options: PlatformCommandOptions = {},
): Promise<NativeTranscriptionResponse> {
  return invokeJson<NativeTranscriptionRequest, NativeTranscriptionResponse>(
    'native_transcribe_audio',
    {
      requestId: crypto.randomUUID(),
      payload,
      ...options,
    },
  );
}

export function parseNativeSyllabus(
  payload: NativeSyllabusRequest,
  options: PlatformCommandOptions = {},
): Promise<NativeSyllabusResponse> {
  return invokeJson<NativeSyllabusRequest, NativeSyllabusResponse>('native_parse_syllabus', {
    requestId: crypto.randomUUID(),
    payload,
    ...options,
  });
}

async function invokeQuery<TResult>(
  command: string,
  query: Record<string, string | number | undefined>,
): Promise<TResult> {
  if (browserApp)
    return browserCommand(
      command,
      undefined,
      Object.fromEntries(
        Object.entries(query)
          .filter((entry) => entry[1] !== undefined)
          .map(([key, value]) => [key, String(value)]),
      ),
    );
  assertTauriRuntime();
  const { invoke } = await import('@tauri-apps/api/core');
  const syntaraToken = await resolveNativePlatformToken();
  const cleanQuery = Object.fromEntries(
    Object.entries(query)
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  const response = await invoke<PlatformApiEnvelope<TResult> | TResult>(command, {
    request: { syntaraToken, query: cleanQuery },
  });
  return unwrapPlatformEnvelope(response);
}

export async function listNativePlatformCourses(): Promise<NativePlatformCourse[]> {
  if (browserApp)
    return (await browserRequest<{ courses: NativePlatformCourse[] }>('/api/native/v1/courses'))
      .courses;
  assertTauriRuntime();
  const { invoke } = await import('@tauri-apps/api/core');
  const syntaraToken = await resolveNativePlatformToken();
  const response = await invoke<
    PlatformApiEnvelope<{ courses: NativePlatformCourse[] }> | { courses: NativePlatformCourse[] }
  >('native_list_platform_courses', { request: { syntaraToken } });
  return unwrapPlatformEnvelope(response).courses ?? [];
}

/** 本周 AI 用量，和网页侧边栏的「本周剩余用量」同一份数据。 */
export async function getNativeWeeklyUsage(): Promise<NativeWeeklyUsage> {
  if (browserApp) return browserRequest('/api/native/v1/usage');
  assertTauriRuntime();
  const { invoke } = await import('@tauri-apps/api/core');
  const syntaraToken = await resolveNativePlatformToken();
  const response = await invoke<PlatformApiEnvelope<NativeWeeklyUsage> | NativeWeeklyUsage>(
    'native_get_weekly_usage',
    { request: { syntaraToken } },
  );
  return unwrapPlatformEnvelope(response);
}

/** 一页会话（按最近更新排序）；cursor 取下一页，q 按标题搜索。 */
export function listSyncedConversations(
  courseId: string,
  options: { limit?: number; cursor?: string | null; q?: string } = {},
): Promise<NativeSyncedConversationList> {
  return invokeQuery('native_get_conversations', {
    courseId,
    limit: options.limit ?? 30,
    cursor: options.cursor ?? undefined,
    q: options.q || undefined,
  });
}

/** 一段对话最近的消息；before 取更早的一页。 */
export function loadSyncedConversation(
  courseId: string,
  sessionId: string,
  options: { messageLimit?: number; before?: string | null } = {},
): Promise<NativeSyncedConversationSnapshot> {
  return invokeQuery('native_get_conversations', {
    courseId,
    sessionId,
    messageLimit: options.messageLimit ?? 30,
    before: options.before ?? undefined,
  });
}

export function pushSyncedConversation(
  payload: NativeConversationSyncPayload,
): Promise<NativeConversationSyncResult> {
  return invokeJson<NativeConversationSyncPayload, NativeConversationSyncResult>(
    'native_sync_conversation',
    { requestId: crypto.randomUUID(), payload },
  );
}

export function deleteSyncedConversation(
  courseId: string,
  sessionId: string,
  baseRevision: number,
): Promise<NativeConversationSyncResult> {
  return invokeQuery('native_delete_conversation', { courseId, sessionId, baseRevision });
}

/** 网页上这门课的笔记列表、学习记忆、日历和课堂清单。 */
export function getNativeCourseData(courseId: string): Promise<NativeCourseData> {
  return invokeQuery('native_get_course_data', { courseId });
}

/** 网页课堂清单的一页（最新的在前），cursor 取下一页。 */
export function getNativeMiniLecturePage(
  courseId: string,
  cursor?: string | null,
): Promise<{ miniLectures: NativeSyncedMiniLecture[]; nextCursor: string | null }> {
  return invokeQuery('native_get_course_data', {
    courseId,
    section: 'mini-lectures',
    limit: 20,
    cursor: cursor ?? undefined,
  });
}

/** 一本网页笔记的完整内容（含图片）。 */
export function getNativeNotebook(notebookId: string): Promise<NativeNotebookArchive> {
  return invokeQuery('native_get_notebook', { id: notebookId });
}

/** 把手机上的学习进度写回账号，网页右侧的学习进度会跟着变。 */
export async function saveNativeLearningProgress(payload: {
  courseId: string;
  kind: NativeLearningProgress['kind'];
  notebookId: string | null;
}): Promise<NativeLearningProgress> {
  const result = await invokeJson<typeof payload, { learningProgress: NativeLearningProgress }>(
    'native_save_learning_progress',
    { requestId: crypto.randomUUID(), payload },
  );
  return result.learningProgress;
}

/** App 自己写的学习记忆（网页看不到），三端通过服务器互通。 */
export interface NativeMemorySnapshot {
  courseId: string;
  memories: LocalStudyMemory[];
  reviews: Record<string, number>;
}

export function getNativeMemories(courseId: string): Promise<NativeMemorySnapshot> {
  return invokeQuery('native_get_memories', { courseId });
}

/** 推上本机记忆和复习时间，返回服务器合并后的完整版本。 */
export function syncNativeMemories(payload: NativeMemorySnapshot): Promise<NativeMemorySnapshot> {
  return invokeJson<NativeMemorySnapshot, NativeMemorySnapshot>('native_sync_memories', {
    requestId: crypto.randomUUID(),
    payload,
  });
}

/** 网页题库里 since 之后改过的题和做题进度；since 省略时取整门课。 */
export function getNativeProblems(
  courseId: string,
  since?: number | null,
): Promise<NativeProblemSnapshot> {
  return invokeQuery('native_get_problems', { courseId, since: since ?? undefined });
}

/** 把 App 上的作答传到网页题库，返回已记下和不用再传的作答 id。 */
export function uploadNativeProblemAttempts(payload: {
  courseId: string;
  attempts: NativeProblemAttemptUpload[];
}): Promise<{ saved: string[]; skipped: string[] }> {
  return invokeJson<typeof payload, { saved: string[]; skipped: string[] }>(
    'native_upload_problem_attempts',
    { requestId: crypto.randomUUID(), payload },
  );
}

/** 商城里的机构课程，和网页 /store/courses 同一份。 */
export async function listNativeStoreCourses(): Promise<NativeStoreCourse[]> {
  const result = await invokeQuery<{ courses: NativeStoreCourse[] }>('native_get_store', {});
  return result.courses ?? [];
}

/** join：从商城加入课程；seen：打开过加入的课程，熄灭「有更新」。 */
export function nativeStoreAction(
  courseId: string,
  action: 'join' | 'seen',
): Promise<{ courseId: string; created?: boolean; seen?: boolean }> {
  return invokeJson('native_store_action', {
    requestId: crypto.randomUUID(),
    payload: { courseId, action },
  });
}

/** 资料页的笔记 / 题目写进账号，网页和其他设备都能同步到。 */
export function uploadNativeMaterial(
  payload: NativeMaterialUpload,
): Promise<NativeMaterialUploadResult> {
  return invokeJson<NativeMaterialUpload, NativeMaterialUploadResult>('native_upload_material', {
    requestId: crypto.randomUUID(),
    payload,
  });
}

/** 网页上已生成好的课堂清单。 */
export function getNativeMiniLecture(lectureId: string): Promise<NativeMiniLectureManifest> {
  return invokeQuery('native_get_mini_lecture', { id: lectureId });
}

export type {
  NativeCourseData,
  NativeGradeRequest,
  NativeGradeResponse,
  NativeLearningProgress,
  NativeNotebookArchive,
  NativeDeviceAuthorization,
  NativeDevicePollResult,
  NativeDeviceTokenPair,
  NativeDeviceUser,
  NativeMiniLectureManifest,
  NativeMiniLectureRequest,
  NativePlatformCapabilities,
  NativePlatformStreamEvent,
  NativeSyllabusRequest,
  NativeSyllabusResponse,
  NativeChatTurnResult,
  NativeTranscriptionRequest,
  NativeTranscriptionResponse,
  NativeWeeklyUsage,
  PlatformApiEnvelope,
  PlatformCommandOptions,
  PlatformJsonCommandRequest,
} from './platform-api-contracts';

export async function createBrowserCourse(
  name: string,
  description: string,
): Promise<NativePlatformCourse> {
  const result = await browserRequest<{ course: NativePlatformCourse }>('/api/native/v1/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  return result.course;
}
