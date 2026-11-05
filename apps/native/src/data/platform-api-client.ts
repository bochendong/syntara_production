import { browserApp, previewChat } from './browser-runtime';
import {
  browserChat,
  browserGrade,
  browserCommand,
  browserCommandHeaders,
  browserFetch,
  browserRequest,
} from './browser-platform';
import type {
  NativeConversationSyncPayload,
  NativeCourseLayers,
  NativeRealtimeTranscriptionRequest,
  NativeRealtimeTranscriptionResponse,
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
  NativeOnboardingState,
  NativeOnboardingStep,
  NativeStoreCourse,
  NativeStoreCourseDetail,
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
import type { LocalProblem, LocalStudyMemory } from '../domain/models';
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
  if (previewChat) {
    const capabilities = await browserRequest<NativePlatformCapabilities>(
      '/api/native/v1/capabilities',
    );
    return { ...capabilities, capabilities: { chat: capabilities.capabilities.chat } };
  }
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
  signal?: AbortSignal,
): Promise<NativeChatTurnResult> {
  if (browserApp || previewChat) return browserChat(request, onEvent, signal);
  signal?.throwIfAborted();
  assertTauriRuntime();
  const [{ invoke }, { listen }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ]);
  const unlisten = onEvent
    ? await listen<NativePlatformStreamEvent>('syntara://platform-ai-stream', ({ payload }) => {
        if (payload.requestId === request.requestId && !signal?.aborted) onEvent(payload);
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
  signal?: AbortSignal,
): Promise<NativeChatTurnResult> {
  return runStreamingTurn('native_chat', request, onEvent, signal);
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
  const request = {
    requestId: crypto.randomUUID(),
    payload,
    ...options,
  };
  const result =
    !browserApp && !isTauriRuntime()
      ? browserGrade<NativeGradeResponse>(payload, browserCommandHeaders(request))
      : invokeJson<NativeGradeRequest, NativeGradeResponse>('native_grade_answer', request);
  return result.then((result) => {
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
export function getNativeNotebook(
  notebookId: string,
  managedCourseId?: string,
): Promise<NativeNotebookArchive> {
  return invokeQuery('native_get_notebook', { id: notebookId, managedCourseId });
}

/** 把手机上的学习进度写回账号，网页右侧的学习进度会跟着变。 */
export async function saveNativeLearningProgress(payload: {
  courseId: string;
  kind: NativeLearningProgress['kind'];
  notebookId: string | null;
  updatedAt?: number;
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

export function gradeNativeCode(input: {
  courseId: string;
  problemId: string;
  attemptId: string;
  code: string;
  language: 'zh-CN' | 'en-US';
  /** 大题里的代码小问 label；mode=run 只跑公开测试 */
  part?: string;
  mode?: 'submit' | 'run';
  /** mode=run：public 跑公开测试，code 直接运行整段代码 */
  target?: 'public' | 'code';
  /** 从课堂入口提交：这节课的 id */
  classSessionId?: string;
}): Promise<{
  saved: boolean;
  preview?: boolean;
  replayed?: boolean;
  status: 'passed' | 'partial' | 'failed' | 'pending' | 'error';
  score: number | null;
  result: { feedback?: string; [key: string]: unknown };
}> {
  return invokeJson('native_grade_code', { requestId: crypto.randomUUID(), payload: input });
}

/** Only explicit test expressions and expected values are returned. */
export type RevealedHiddenTests = {
  cases: Array<{ expression: string; expected: string }>;
  hasScript: boolean;
};

export function getNativeHiddenTests(input: {
  courseId: string;
  problemId: string;
  part?: string;
}): Promise<RevealedHiddenTests> {
  return invokeJson('native_get_hidden_tests', { requestId: crypto.randomUUID(), payload: input });
}

export function runNativeHiddenTests(input: {
  courseId: string;
  problemId: string;
  part?: string;
  code: string;
  language: 'zh-CN' | 'en-US';
  indices?: number[];
}): Promise<{ cases: Array<{ id: string; passed: boolean }>; feedback?: string }> {
  return invokeJson('native_get_hidden_tests', {
    requestId: crypto.randomUUID(),
    payload: { ...input, mode: 'run' },
  });
}

/** 网页题库里 since 之后改过的题和做题进度；since 省略时取整门课。 */
export function getNativeProblems(
  courseId: string,
  since?: number | null,
  managed = false,
): Promise<NativeProblemSnapshot> {
  return invokeQuery('native_get_problems', {
    courseId,
    since: since ?? undefined,
    managed: managed ? 1 : undefined,
  });
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

/** 商城详情页：章节和评价。 */
export async function getNativeStoreCourse(courseId: string): Promise<NativeStoreCourseDetail> {
  const result = await invokeQuery<{ course: NativeStoreCourseDetail }>('native_get_store', {
    courseId,
  });
  return result.course;
}

export type NativeClassroomItem = {
  id: string;
  problemId: string;
  title: string;
  type: string;
  number: number | null;
  addedAt: number;
  myStatus: 'pending' | 'passed' | 'failed' | 'partial' | 'error' | null;
  myAttempts: number;
};

export type NativeClassroomSession = {
  id: string;
  number: number;
  name?: string | null;
  status: string;
  joined: boolean;
  startedAt: number;
  endedAt: number | null;
  className: string;
  courseId: string;
  courseName: string;
  teacherName: string;
  items: NativeClassroomItem[];
};

export type NativeClassroomState = {
  /** 正在上的课（自己进了的，或者本班正在上的）。 */
  sessions: NativeClassroomSession[];
  /** 自己进过、已经下课的课；从这里回去提交还算那节课。 */
  past: NativeClassroomSession[];
};

/** 手机端不调用。 */
export async function getNativeClassroom(): Promise<NativeClassroomState> {
  const result = await invokeQuery<NativeClassroomState>('native_get_classroom', {});
  return { sessions: result.sessions ?? [], past: result.past ?? [] };
}

/** join-code：输 6 位课堂码或班级码；join-session：本班的人点「进入课堂」。 */
export function nativeClassroomAction(
  payload: { action: 'join-code'; code: string } | { action: 'join-session'; sessionId: string },
): Promise<
  NativeClassroomState & {
    joined: { kind: 'session' | 'class'; courseId: string; sessionId?: string; classId?: string };
  }
> {
  return invokeJson('native_classroom_action', { requestId: crypto.randomUUID(), payload });
}

export type TeachAttemptStatus = 'pending' | 'passed' | 'failed' | 'partial' | 'error';

export type TeachHome = {
  currentPeriod: { label: string };
  courses: Array<{
    id: string;
    name: string;
    courseCode: string | null;
    avatarUrl: string | null;
    problemCount: number;
    notebookCount: number;
    learnerCount: number;
    listed: boolean;
    canPublish: boolean;
    pendingApplications: number;
    /** 这门课是我认领的（一门课只能有一位老师认领）。 */
    claimedByMe: boolean;
    currentClass: {
      id: string;
      name: string;
      mine: boolean;
      memberCount: number;
      liveSessionId: string | null;
    } | null;
    pastClasses: Array<{ id: string; name: string; label: string; memberCount: number }>;
  }>;
};

type TeachPerson = { userId: string; name: string; email: string | null; avatarUrl: string | null };

export type TeachClass = {
  class: {
    id: string;
    name: string;
    joinCode: string;
    label: string;
    course: { id: string; name: string; courseCode: string | null };
  };
  roster: Array<TeachPerson & { joinedAt: number; source: string }>;
  visitors: TeachPerson[];
  sessions: Array<{
    id: string;
    number: number;
    name?: string | null;
    /** draft 备课 | live 上课中 | ended 已下课 */
    status: string;
    code: string | null;
    startedAt: number | null;
    endedAt: number | null;
    participantCount: number;
    itemCount: number;
  }>;
  problems: Array<{
    id: string;
    title: string;
    type: string;
    number: number | null;
    chapter: { id: string; name: string } | null;
  }>;
  progress: Array<{
    userId: string;
    problemId: string;
    status: TeachAttemptStatus;
    score: number | null;
    attemptedCount: number;
  }>;
};

export type TeachSession = {
  session: {
    id: string;
    number: number;
    name?: string | null;
    /** draft 备课 | live 上课中 | ended 已下课 */
    status: string;
    code: string | null;
    locked: boolean;
    startedAt: number | null;
    endedAt: number | null;
    presentCount: number;
    class: { id: string; name: string; rosterCount: number };
    course: { id: string; name: string; courseCode: string | null };
  };
  /** 表格的行：在场的人在前，没进来的名单学生在后。 */
  students: Array<{
    userId: string;
    name: string;
    avatarUrl: string | null;
    present: boolean;
    via: string;
    joinedAt: number | null;
  }>;
  /** 表格的列：这节课的题，按顺序。 */
  items: TeachSessionItem[];
};

export type TeachSessionItem = {
  id: string;
  problemId: string;
  position: number;
  title: string;
  type: string;
  number: number | null;
  addedAt: number;
  submittedCount: number;
  passedCount: number;
  /** 部分对 + 待批改 */
  partialCount: number;
  failedCount: number;
  /** 选择题的选项分布；别的题是 null。 */
  options: Array<{ id: string; label: string; count: number; correct: boolean }> | null;
  results: Array<{
    userId: string;
    status: TeachAttemptStatus;
    score: number | null;
    submittedAt: number;
    attempts: number;
  }>;
};

export type TeachStudentAnswers = {
  language: string | null;
  attempts: Array<{
    id: string;
    kind: string;
    status: TeachAttemptStatus;
    /** 0~1 */
    score: number | null;
    answer: Record<string, unknown>;
    result: Record<string, unknown>;
    createdAt: number;
  }>;
};

export type TeachImportClass = {
  classId: string;
  label: string;
  sessions: Array<{
    id: string;
    number: number;
    name?: string | null;
    itemCount: number;
    titles: string[];
  }>;
};

export type TeachLiveCourse = {
  sessionId: string;
  number: number;
  name?: string | null;
  presentCount: number;
  problemIds: string[];
};

export type TeachProblemChoice = {
  id: string;
  title: string;
  type: string;
  number: number | null;
  chapter: { id: string; name: string } | null;
};

/** 教学页：能开班的课程。 */
export function getTeachHome(): Promise<TeachHome> {
  return invokeQuery('native_get_teach', {});
}

export function getTeachClass(classId: string): Promise<TeachClass> {
  return invokeQuery('native_get_teach', { classId });
}

export function getTeachSession(sessionId: string): Promise<TeachSession> {
  return invokeQuery('native_get_teach', { sessionId });
}

export async function getTeachProblemChoices(sessionId: string): Promise<TeachProblemChoice[]> {
  const result = await invokeQuery<{ problems: TeachProblemChoice[] }>('native_get_teach', {
    choices: sessionId,
  });
  return result.problems ?? [];
}

export async function getTeachProblemPreview(sessionId: string, problemId: string) {
  const result = await invokeQuery<{ problem: LocalProblem }>('native_get_teach', {
    preview: sessionId,
    problemId,
  });
  return result.problem;
}

/** 点弹珠：这个学生这道题在这节课里提交过的全部答案，最新的在前。 */
export function getTeachStudentAnswers(
  sessionId: string,
  problemId: string,
  userId: string,
): Promise<TeachStudentAnswers> {
  return invokeQuery('native_get_teach', { answers: sessionId, problemId, userId });
}

/** 同一门课往届可以导入的课。 */
export async function getTeachImportSources(classId: string): Promise<TeachImportClass[]> {
  const result = await invokeQuery<{ classes: TeachImportClass[] }>('native_get_teach', {
    importFor: classId,
  });
  return result.classes ?? [];
}

/** 题库页：这门课我正在上的那节。 */
export async function getTeachLiveCourse(courseId: string): Promise<TeachLiveCourse | null> {
  const result = await invokeQuery<{ live: TeachLiveCourse | null }>('native_get_teach', {
    liveCourse: courseId,
  });
  return result.live ?? null;
}

type TeachClassAction =
  | { action: 'add-member'; classId: string; email: string }
  | { action: 'remove-member'; classId: string; userId: string }
  | { action: 'reset-code'; classId: string }
  | { action: 'import-sessions'; classId: string; sessionIds: string[] };

type TeachSessionAction =
  | { action: 'rename'; sessionId: string; name: string }
  | { action: 'add'; sessionId: string; problemIds: string[] }
  | { action: 'remove'; sessionId: string; problemId: string }
  | { action: 'reorder'; sessionId: string; problemIds: string[] }
  | { action: 'lock'; sessionId: string; locked: boolean }
  | { action: 'end'; sessionId: string };

function teachAction<T>(payload: unknown): Promise<T> {
  return invokeJson('native_teach_action', { requestId: crypto.randomUUID(), payload });
}

export type TeachClaimableCourse = {
  id: string;
  name: string;
  courseCode: string | null;
  avatarUrl: string | null;
  organizationName: string | null;
  problemCount: number;
  claim: 'mine' | 'free' | 'taken';
};

/** 尚未被认领、也没有负责老师的机构课。 */
export async function getTeachClaimableCourses(query = ''): Promise<TeachClaimableCourse[]> {
  const result = await invokeQuery<{ courses: TeachClaimableCourse[] }>('native_get_teach', {
    claim: '1',
    ...(query.trim() ? { q: query.trim() } : {}),
  });
  return result.courses;
}

export function claimTeachCourse(courseId: string): Promise<TeachHome> {
  return teachAction({ action: 'claim', courseId });
}

export function releaseTeachCourse(courseId: string): Promise<TeachHome> {
  return teachAction({ action: 'release-claim', courseId });
}

export function openTeachClass(courseId: string): Promise<{ classId: string }> {
  return teachAction({ action: 'open-class', courseId });
}

/** 开始上课：不用先选题。传 sessionId 让那节备好的课开始。 */
export function startTeachSession(
  classId: string,
  sessionId?: string,
): Promise<{ sessionId: string }> {
  return teachAction({ action: 'start-session', classId, ...(sessionId ? { sessionId } : {}) });
}

export function createTeachDraft(classId: string): Promise<{ sessionId: string }> {
  return teachAction({ action: 'create-draft', classId });
}

export function deleteTeachDraft(sessionId: string): Promise<{ classId: string }> {
  return teachAction({ action: 'delete-draft', sessionId });
}

export function teachClassAction(payload: TeachClassAction): Promise<TeachClass> {
  return teachAction(payload);
}

export function teachSessionAction(payload: TeachSessionAction): Promise<TeachSession> {
  return teachAction(payload);
}

export type AdminRole = 'USER' | 'STUDENT' | 'TEACHER' | 'ADMIN';

export type AdminUsage = { estimatedCostUsd: number; requestCount: number };

export type AdminLlmConfig = {
  modelId: string;
  tierModels: { low: string; medium: string; high: string };
  baseUrl: string;
  hasApiKey: boolean;
  maskedApiKey: string;
  source: 'database' | 'environment';
  updatedAt: string | null;
};

export type AdminGlobalUsage = {
  limit: {
    enabled: boolean;
    weeklyCostLimitUsd: number | null;
    weeklyRequestLimit: number | null;
    updatedBy: string | null;
    updatedAt: string | null;
  };
  usage: AdminUsage;
};

export type AdminOverview = {
  me: { userId: string; email: string | null };
  llm: AdminLlmConfig;
  modelOptions: Array<{ id: string; label: string; description: string }>;
  providers: Array<{
    kind: 'image' | 'tts' | 'webSearch';
    id: string;
    name: string;
    configured: boolean;
    keyLast4: string | null;
    envName: string | null;
  }>;
  usage: AdminGlobalUsage;
  roleCounts: Record<AdminRole, number>;
};

export type AdminUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: AdminRole;
  isActive: boolean;
  createdAt: number;
  limit: {
    weeklyCostLimitUsd: number | null;
    weeklyRequestLimit: number | null;
    disabled: boolean;
  } | null;
  usage: AdminUsage;
};

/** 只有管理员能拿到 true；其他账号接口返回 403，这里当成 false。 */
export async function isAdminAccount(): Promise<boolean> {
  try {
    const result = await invokeQuery<{ admin?: boolean }>('native_get_admin', { check: 1 });
    return result.admin === true;
  } catch {
    return false;
  }
}

/** 管理页总览。不是管理员会报 403。 */
export function getAdminOverview(): Promise<AdminOverview> {
  return invokeQuery('native_get_admin', {});
}

export type AdminUsersPage = {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminUserCourse = {
  id: string;
  name: string;
  courseCode: string | null;
  university: string | null;
  avatarUrl: string;
  accessRole: 'owner' | 'enrolled';
};

export type AdminCoursePerson = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: AdminRole;
  isActive: boolean;
};

export type AdminManagedCourse = {
  id: string;
  name: string;
  courseCode: string | null;
  avatarUrl: string;
  organizationName: string | null;
  owner: AdminCoursePerson;
  managers: AdminCoursePerson[];
  claimedTeacher?: AdminCoursePerson | null;
  responsiblePeople: AdminCoursePerson[];
};

export type AdminCoursePage = {
  courses: AdminManagedCourse[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminCourseStudentPage = {
  students: AdminCoursePerson[];
  total: number;
  page: number;
  pageSize: number;
};

export function listAdminCourseStudents(
  courseId: string,
  query: string,
  page: number,
): Promise<AdminCourseStudentPage> {
  return invokeQuery('native_get_admin', { students: 1, courseId, query: query.trim(), page });
}

export function removeAdminCourseStudent(
  courseId: string,
  userId: string,
): Promise<{ removed: boolean }> {
  return adminAction({ action: 'remove-course-student', courseId, userId });
}

export async function downloadAdminCourseMaterials(courseId: string): Promise<{ path?: string }> {
  if (!browserApp) {
    assertTauriRuntime();
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('native_download_admin_course', {
      request: { syntaraToken: await resolveNativePlatformToken(), query: { courseId } },
    });
  }
  const response = await browserFetch(
    `/api/native/v1/admin?${new URLSearchParams({ export: '1', courseId })}`,
  );
  const blob = await response.blob();
  if (!blob.size || !response.headers.get('Content-Type')?.includes('application/zip')) {
    throw new Error('课程资料打包失败，请重试。');
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `course-${courseId.replace(/[^A-Za-z0-9_-]/g, '_')}-materials.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return {};
}

export function listAdminCourses(query: string, page: number): Promise<AdminCoursePage> {
  return invokeQuery('native_get_admin', { catalog: 1, query: query.trim(), page });
}

export async function searchAdminAssignees(query: string): Promise<AdminCoursePerson[]> {
  return (
    await invokeQuery<{ users: AdminCoursePerson[] }>('native_get_admin', {
      assignees: 1,
      query: query.trim(),
    })
  ).users;
}

export async function setAdminCourseAssignment(
  courseId: string,
  userId: string,
  assigned: boolean,
): Promise<AdminManagedCourse> {
  return (
    await adminAction<{ course: AdminManagedCourse }>({
      action: 'set-course-manager',
      courseId,
      userId,
      assigned,
    })
  ).course;
}

export async function getAdminUserCourses(userId: string): Promise<AdminUserCourse[]> {
  const result = await invokeQuery<{ courses: AdminUserCourse[] }>('native_get_admin', {
    courses: 1,
    userId,
  });
  return result.courses;
}

export function searchAdminUsers(
  query: string,
  role: AdminRole | null,
  page = 1,
): Promise<AdminUsersPage> {
  return invokeQuery('native_get_admin', {
    users: 1,
    query: query.trim() || undefined,
    role: role ?? undefined,
    page,
  });
}

function adminAction<T>(payload: unknown): Promise<T> {
  return invokeJson('native_admin_action', { requestId: crypto.randomUUID(), payload });
}

export async function saveAdminLlm(input: {
  modelId?: string;
  tierModels?: AdminLlmConfig['tierModels'];
  apiKey?: string;
  baseUrl?: string;
}): Promise<AdminLlmConfig> {
  return (await adminAction<{ llm: AdminLlmConfig }>({ action: 'save-llm', ...input })).llm;
}

export async function setAdminUserRole(userId: string, role: AdminRole): Promise<AdminUser> {
  return (await adminAction<{ user: AdminUser }>({ action: 'set-role', userId, role })).user;
}

export async function setAdminUserLimit(input: {
  userId: string;
  weeklyCostLimitUsd: number | null;
  weeklyRequestLimit: number | null;
  disabled: boolean;
}): Promise<AdminUser> {
  return (await adminAction<{ user: AdminUser }>({ action: 'set-user-limit', ...input })).user;
}

export async function setAdminGlobalLimit(input: {
  enabled: boolean;
  weeklyCostLimitUsd: number | null;
  weeklyRequestLimit: number | null;
}): Promise<AdminGlobalUsage> {
  return (await adminAction<{ usage: AdminGlobalUsage }>({ action: 'set-global-limit', ...input }))
    .usage;
}

/** 从商城加入课程。 */
export function nativeStoreAction(
  courseId: string,
  action: 'join',
  answers?: Record<string, string>,
): Promise<{ courseId: string; created?: boolean; status?: 'joined' | 'pending' }> {
  return invokeJson('native_store_action', {
    requestId: crypto.randomUUID(),
    payload: { courseId, action, answers },
  });
}

export function markNativeCourseUpdateSeen(
  courseId: string,
  contentVersion?: number,
): Promise<{ courseId: string; seen: boolean }> {
  return invokeJson('native_store_action', {
    requestId: crypto.randomUUID(),
    payload: { courseId, action: 'seen', contentVersion },
  });
}

export type CourseAdmissionField = { id: string; label: string; kind: 'text' | 'phone_last4' };
export type CourseAdmissionConfig = { mode: 'open' | 'approval'; fields: CourseAdmissionField[] };
export type CoursePublicationInput = {
  name: string;
  campus: string;
  organization: 'none' | 'speedup';
  admission: CourseAdmissionConfig;
};
export type CoursePublication = CoursePublicationInput & {
  courseId: string;
  avatarUrl: string | null;
  canEditProfile: boolean;
  listed: boolean;
  canPublish: boolean;
  speedupAvailable: boolean;
  organizationName: string | null;
  currentClass: { id: string; mine: boolean; name: string } | null;
};
export async function updateManagedCourseProfile(
  courseId: string,
  profile: { name: string; avatarId: string | null },
): Promise<CoursePublication> {
  return (
    await invokeJson<unknown, { publication: CoursePublication }>('native_store_action', {
      requestId: crypto.randomUUID(),
      payload: { action: 'update-course-profile', courseId, profile },
    })
  ).publication;
}
export type CourseApplication = {
  id: string;
  createdAt: string;
  applicant: { id: string; name: string | null; email: string | null; image: string | null };
  answersJson: Array<CourseAdmissionField & { value: string }>;
};
export type CourseApplicationPage = {
  applications: CourseApplication[];
  total: number;
  page: number;
  pageSize: number;
};
export async function getCoursePublication(courseId: string): Promise<CoursePublication> {
  return (
    await invokeQuery<{ publication: CoursePublication }>('native_get_store', {
      publicationOf: courseId,
    })
  ).publication;
}
export async function publishCourseToStore(
  courseId: string,
  publication: CoursePublicationInput,
): Promise<CoursePublication> {
  return (
    await invokeJson<unknown, { publication: CoursePublication }>('native_store_action', {
      requestId: crypto.randomUUID(),
      payload: { action: 'publish', courseId, publication },
    })
  ).publication;
}
export function getCourseApplications(
  courseId: string,
  page = 1,
  query = '',
): Promise<CourseApplicationPage> {
  return invokeQuery('native_get_store', { applicationsOf: courseId, page, query });
}
export function reviewCourseApplication(
  courseId: string,
  applicationId: string,
  decision: 'approved' | 'rejected',
): Promise<{ status: string }> {
  return invokeJson('native_store_action', {
    requestId: crypto.randomUUID(),
    payload: { action: 'review-application', courseId, applicationId, decision },
  });
}

export function releaseNativeCourseVersion(
  courseId: string,
): Promise<{ version: number; text: string }> {
  return invokeJson('native_store_action', {
    requestId: crypto.randomUUID(),
    payload: { courseId, action: 'release' },
  });
}

/** 加入的课：自己隐藏的内容、「新」笔记、自己加的笔记、还没看过的更新。 */
export function getNativeCourseLayers(courseId: string): Promise<NativeCourseLayers> {
  return invokeQuery<NativeCourseLayers>('native_get_store', { layersOf: courseId });
}

/**
 * 加入的课里的一项笔记或题目：
 * remove 删除（公有的只对自己隐藏，自己的真删）、restore 恢复隐藏、copy 复制到我的。
 */
export function nativeCourseContentAction(
  courseId: string,
  action: 'remove' | 'restore' | 'copy',
  target: { targetType: 'notebook' | 'problem'; targetId: string },
): Promise<{ result?: 'hidden' | 'deleted'; restored?: boolean; id?: string }> {
  return invokeJson('native_store_action', {
    requestId: crypto.randomUUID(),
    payload: { courseId, action, ...target },
  });
}

/** 删课：自己建的课连笔记和聊天一起删；从商城加入的只从列表里移走。 */
export function deleteNativeCourse(
  courseId: string,
): Promise<{ ok: true; action: 'deleted' | 'removed' }> {
  return invokeQuery('native_delete_course', { courseId });
}

/** 改自己建的课的名字和简介。 */
export function editNativeCourse(payload: {
  courseId: string;
  name: string;
  description?: string;
}): Promise<unknown> {
  return invokeJson('native_edit_course', { requestId: crypto.randomUUID(), payload });
}

/** 新手引导进度存在账号上，换设备也接着上一步。 */
export async function getNativeOnboarding(): Promise<NativeOnboardingState> {
  const result = await invokeQuery<{ onboarding: NativeOnboardingState }>(
    'native_get_onboarding',
    {},
  );
  return result.onboarding;
}

export async function nativeOnboardingAction(
  payload:
    | { action: 'complete'; step: NativeOnboardingStep }
    | { action: 'skip' }
    | { action: 'finish' }
    | { action: 'restart' },
): Promise<NativeOnboardingState> {
  const result = await invokeJson<typeof payload, { onboarding: NativeOnboardingState }>(
    'native_onboarding_action',
    { requestId: crypto.randomUUID(), payload },
  );
  return result.onboarding;
}

export type SpeedupPhoneState = { needed: boolean; courses: string[] };

/** 学生加入了 Speedup 的课、还没留手机尾号时 needed = true（几门课也只问一次）。 */
export async function getSpeedupPhoneState(): Promise<SpeedupPhoneState> {
  const result = await invokeQuery<{ speedupPhone: SpeedupPhoneState }>('native_get_onboarding', {
    part: 'speedup-phone',
  });
  return result.speedupPhone;
}

export async function saveSpeedupPhoneLast4(last4: string): Promise<SpeedupPhoneState> {
  const result = await invokeJson<
    { action: 'speedup-phone'; last4: string },
    { speedupPhone: SpeedupPhoneState }
  >('native_onboarding_action', {
    requestId: crypto.randomUUID(),
    payload: { action: 'speedup-phone', last4 },
  });
  return result.speedupPhone;
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

export function startNativeRealtimeTranscription(
  payload: NativeRealtimeTranscriptionRequest,
  options: PlatformCommandOptions = {},
): Promise<NativeRealtimeTranscriptionResponse> {
  return invokeJson<NativeRealtimeTranscriptionRequest, NativeRealtimeTranscriptionResponse>(
    'native_start_realtime_transcription',
    {
      requestId: crypto.randomUUID(),
      payload,
      ...options,
    },
  );
}

export function syncNativeCalendar(payload: {
  courseId: string;
  cursor?: string;
  changes: Array<{
    id: string;
    deleted?: boolean;
    updatedAt: number;
    event?: import('../domain/learning-experiences').LocalCourseEvent;
  }>;
}): Promise<{
  events: import('../domain/learning-experiences').LocalCourseEvent[];
  deletedIds: string[];
  nextCursor: string | null;
}> {
  return invokeJson('native_sync_calendar', { requestId: crypto.randomUUID(), payload });
}

export function getGeneralConversations<T>(query: Record<string, string>): Promise<T> {
  return invokeQuery('native_get_general_conversations', query);
}
export function saveGeneralConversation<T>(payload: unknown): Promise<T> {
  return invokeJson('native_save_general_conversation', {
    requestId: crypto.randomUUID(),
    payload,
  });
}
export function removeGeneralConversation(id: string): Promise<void> {
  return invokeQuery('native_delete_general_conversation', { id });
}

export function syncNativePreferences(payload: {
  profile?: import('./learner-profile').LearnerProfile;
  memoryTourSeen?: boolean;
  progressTourSeen?: boolean;
}): Promise<{
  profile?: import('./learner-profile').LearnerProfile;
  memoryTourSeen?: boolean;
  progressTourSeen?: boolean;
}> {
  return invokeJson('native_sync_preferences', { requestId: crypto.randomUUID(), payload });
}

export type ManagedContentKind = 'notes' | 'problems';
export type ManagedContentPage = {
  total: number;
  page: number;
  pageSize: number;
  items: Array<{
    id: string;
    title: string;
    updatedAt: string;
    status: string | null;
    chapterId?: string | null;
    notebookId?: string | null;
    pending?: 'add' | 'update' | 'delete';
  }>;
};
/** group：题库按分组取（c:章节 id / n:笔记 id / none），分组里按题号排。 */
export function getManagedCourseContent(
  courseId: string,
  kind: ManagedContentKind,
  page: number,
  query: string,
  group?: string,
): Promise<ManagedContentPage> {
  return invokeQuery('native_get_store', { managementOf: courseId, kind, page, query, group });
}
export type ManagedProblemGroup = { key: string; id: string; name: string; count: number };
export type ManagedProblemGroups = {
  chapters: ManagedProblemGroup[];
  notebooks: ManagedProblemGroup[];
  ungrouped: number;
};
/** 题库的章节（含空章节）、按笔记的分组和每组题数。 */
export function getManagedProblemGroups(courseId: string): Promise<ManagedProblemGroups> {
  return invokeQuery('native_get_store', { problemGroupsOf: courseId });
}
export type ManagedCourseStudents = {
  total: number;
  /** 机构课程才有学情（最近活跃、做题、提问）；私有课程为 false。 */
  insights: boolean;
  terms: Array<{
    key: string;
    label: string;
    students: Array<{
      userId: string;
      name: string | null;
      email: string | null;
      image: string | null;
      joinedAt: string;
      method: 'open' | 'approval';
      lastActiveAt: string | null;
    }>;
  }>;
};
/** 从商城加入这门课的学生，按加入的学期分组。 */
export function getManagedCourseStudents(courseId: string): Promise<ManagedCourseStudents> {
  return invokeQuery('native_get_store', { studentsOf: courseId });
}
export type ManagedCourseStudent = {
  student: {
    userId: string;
    name: string | null;
    email: string | null;
    image: string | null;
    joinedAt: string;
    method: 'open' | 'approval';
    answers: Array<{ id: string; label: string; value: string }>;
  };
  /** 私有课程为 null：老师看不到学生的做题和提问。 */
  insights: {
    attempted: number;
    passed: number;
    accuracy: number | null;
    attemptCount: number;
    lastActiveAt: string | null;
    problems: Array<{
      id: string;
      title: string;
      chapterName: string | null;
      status: 'pending' | 'passed' | 'failed' | 'partial' | 'error';
      attemptCount: number;
      lastAttemptAt: string;
    }>;
    attempts: Array<{
      id: string;
      problemId: string;
      title: string;
      chapterName: string | null;
      status: 'pending' | 'passed' | 'failed' | 'partial' | 'error';
      score: number | null;
      answerPreview: string;
      createdAt: string;
    }>;
    questions: Array<{ id: string; text: string; createdAt: string; conversationTitle: string }>;
  } | null;
};
/** 一个学生在这门课的情况（只给课程主人）。 */
export function getManagedCourseStudent(
  courseId: string,
  userId: string,
): Promise<ManagedCourseStudent> {
  return invokeQuery('native_get_store', { studentOf: courseId, userId });
}
export type ManagedStudentAttempt = {
  id: string;
  status: 'pending' | 'passed' | 'failed' | 'partial' | 'error';
  score: number | null;
  createdAt: string;
};
export type ManagedStudentAttemptPage = {
  attempts: ManagedStudentAttempt[];
  total: number;
  page: number;
  pageSize: number;
};
export type ManagedStudentAttemptDetail = ManagedStudentAttempt & {
  title: string;
  language?: string;
  answer: Record<string, unknown>;
  result: Record<string, unknown> | null;
  activeDurationMs: number | null;
};
export function getManagedStudentAttempts(
  courseId: string,
  userId: string,
  problemId: string,
  page = 1,
): Promise<ManagedStudentAttemptPage> {
  return invokeQuery('native_get_store', { studentOf: courseId, userId, problemId, page });
}
export function getManagedStudentAttempt(
  courseId: string,
  userId: string,
  problemId: string,
  attemptId: string,
): Promise<{ attempt: ManagedStudentAttemptDetail }> {
  return invokeQuery('native_get_store', { studentOf: courseId, userId, problemId, attemptId });
}
export type MyCourseApplication = {
  id: string;
  status: 'pending' | 'rejected';
  updatedAt: string;
  answers: Record<string, string>;
  course: {
    id: string;
    name: string;
    courseCode: string | null;
    avatarUrl: string | null;
    admission: CourseAdmissionConfig;
    organization: { id: string; name: string } | null;
  };
};
/** 自己待批准、未通过的加入申请（侧边栏显示，可以改了重发）。 */
export async function getMyCourseApplications(): Promise<MyCourseApplication[]> {
  return (
    await invokeQuery<{ applications: MyCourseApplication[] }>('native_get_store', {
      myApplications: 1,
    })
  ).applications;
}
export type ManagedReleaseStatus = {
  deletions?: number;
  draftCount?: number;
  changes?: Array<{ id: string; title: string; kind: string; operation: string; draft: boolean }>;
  addedProblems: number;
  updatedProblems: number;
  addedNotebooks: number;
  updatedNotebooks: number;
  total: number;
  canRelease: boolean;
  lastReleasedAt: string | null;
  version: number;
};
/** 上次「发布新版」以来有多少新增 / 改过的内容，以及自己能不能发布。 */
export function getManagedReleaseStatus(courseId: string): Promise<ManagedReleaseStatus> {
  return invokeQuery('native_get_store', { releaseOf: courseId });
}
export function addManagedCourseContent(
  courseId: string,
  kind: ManagedContentKind,
  title: string,
  text: string,
): Promise<unknown> {
  return invokeJson('native_store_action', {
    requestId: crypto.randomUUID(),
    payload: { action: 'add-managed-content', courseId, kind, title, text },
  });
}
/** 课程管理里改一本笔记：名称和各小节的 Markdown。 */
export function updateManagedCourseNote(
  courseId: string,
  id: string,
  patch: { title?: string; sections?: Array<{ id: string; markdown: string }> },
): Promise<unknown> {
  return invokeJson('native_store_action', {
    requestId: crypto.randomUUID(),
    payload: { action: 'update-managed-note', courseId, id, ...patch },
  });
}
/** 课程管理里改一道公有题；publicContent / grading 和网页题库的结构一致。 */
export function updateManagedCourseProblem(
  courseId: string,
  id: string,
  patch: {
    title?: string;
    status?: 'draft' | 'published';
    difficulty?: 'easy' | 'medium' | 'hard';
    chapterId?: string | null;
    notebookId?: string | null;
    publicContent?: Record<string, unknown>;
    grading?: Record<string, unknown>;
  },
): Promise<unknown> {
  return invokeJson('native_store_action', {
    requestId: crypto.randomUUID(),
    payload: { action: 'update-managed-problem', courseId, id, ...patch },
  });
}
export type CourseAiRule = { id: string; content: string; updatedAt: string };
export type CourseAiRulePack = { rules: CourseAiRule[]; limit: number; maxChars: number };
/** 课程管理「AI 规则」：老师给这门课助教定的作答规则（课程主人和管理员可见）。 */
export function getCourseAiRules(courseId: string): Promise<CourseAiRulePack> {
  return invokeQuery('native_get_store', { aiRulesOf: courseId });
}
/** 整包保存，顺序就是 AI 读规则的顺序；没传的旧规则会删除。 */
export function saveCourseAiRules(
  courseId: string,
  rules: Array<{ id?: string; content: string }>,
): Promise<CourseAiRulePack> {
  return invokeJson('native_store_action', {
    requestId: crypto.randomUUID(),
    payload: { action: 'save-ai-rules', courseId, rules },
  });
}
export function deleteManagedCourseContent(
  courseId: string,
  kind: ManagedContentKind,
  id: string,
): Promise<unknown> {
  return invokeJson('native_store_action', {
    requestId: crypto.randomUUID(),
    payload: { action: 'delete-managed-content', courseId, kind, id },
  });
}

export function undoManagedCourseContent(
  courseId: string,
  kind: ManagedContentKind,
  id: string,
): Promise<unknown> {
  return invokeJson('native_store_action', {
    requestId: crypto.randomUUID(),
    payload: { action: 'undo-managed-content', courseId, kind, id },
  });
}
