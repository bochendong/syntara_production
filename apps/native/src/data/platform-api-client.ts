import type {
  NativeGradeRequest,
  NativeGradeResponse,
  NativeDeviceAuthorization,
  NativeDevicePollResult,
  NativeDeviceTokenPair,
  NativeDeviceUser,
  NativeMiniLectureManifest,
  NativeMiniLectureRequest,
  NativePlatformCapabilities,
  NativePlatformStreamEvent,
  NativeReviewPlanRequest,
  NativeReviewPlanResponse,
  NativeSyllabusRequest,
  NativeSyllabusResponse,
  NativeTeachingTurnPayload,
  NativeTeachingTurnResult,
  NativeTranscriptionRequest,
  NativeTranscriptionResponse,
  PlatformApiEnvelope,
  PlatformCommandOptions,
  PlatformJsonCommandRequest,
} from './platform-api-contracts';
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
  assertTauriRuntime();
  const { invoke } = await import('@tauri-apps/api/core');
  const syntaraToken =
    options.syntaraToken === undefined ? await resolveNativePlatformToken() : options.syntaraToken;
  const response = await invoke<
    PlatformApiEnvelope<NativePlatformCapabilities> | NativePlatformCapabilities
  >('native_get_capabilities', { request: { ...options, syntaraToken } });
  return unwrapPlatformEnvelope(response);
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

export async function runNativeTeachingTurn(
  request: PlatformJsonCommandRequest<NativeTeachingTurnPayload>,
  onEvent?: (event: NativePlatformStreamEvent) => void,
): Promise<NativeTeachingTurnResult> {
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
    return await invoke<NativeTeachingTurnResult>('native_teaching_turn', {
      request: authenticatedRequest,
    });
  } finally {
    unlisten();
  }
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

export function createNativeReviewPlan(
  payload: NativeReviewPlanRequest,
  options: PlatformCommandOptions = {},
): Promise<NativeReviewPlanResponse> {
  return invokeJson<NativeReviewPlanRequest, NativeReviewPlanResponse>(
    'native_create_review_plan',
    {
      requestId: crypto.randomUUID(),
      payload,
      ...options,
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

export type {
  NativeGradeRequest,
  NativeGradeResponse,
  NativeDeviceAuthorization,
  NativeDevicePollResult,
  NativeDeviceTokenPair,
  NativeDeviceUser,
  NativeMiniLectureManifest,
  NativeMiniLectureRequest,
  NativePlatformCapabilities,
  NativePlatformStreamEvent,
  NativeReviewPlanRequest,
  NativeReviewPlanResponse,
  NativeSyllabusRequest,
  NativeSyllabusResponse,
  NativeTeachingTurnPayload,
  NativeTeachingTurnResult,
  NativeTranscriptionRequest,
  NativeTranscriptionResponse,
  PlatformApiEnvelope,
  PlatformCommandOptions,
  PlatformJsonCommandRequest,
} from './platform-api-contracts';
