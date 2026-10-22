import type { ChatResponseStrength } from '../data/ai-client';
import { runNativeChatTurn, type NativePlatformStreamEvent } from '../data/platform-api-client';
import type { NativeMessageMetadata } from '../domain/teaching';
import type { NativeChatPayload, NativeChatSurface } from './types';

export interface NativeChatResult {
  text: string;
  model: string | null;
  metadata?: NativeMessageMetadata;
}

/** 手机竖屏 = phone；iPad（含 iPadOS 伪装成 Mac 的 UA）= tablet；其余 = desktop。 */
export function detectChatSurface(phoneLayout: boolean): NativeChatSurface {
  if (phoneLayout) return 'phone';
  if (typeof navigator === 'undefined') return 'desktop';
  const ipad =
    /iPad/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return ipad || /Android/.test(navigator.userAgent) ? 'tablet' : 'desktop';
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function deltaOf(event: NativePlatformStreamEvent): string | null {
  if (event.event !== 'text_delta') return null;
  const delta = record(event.data)?.delta;
  return typeof delta === 'string' ? delta : null;
}

function metadataOf(finalEvent: unknown): NativeMessageMetadata | undefined {
  let current = record(finalEvent);
  if (record(current?.data)) current = record(current?.data);
  const metadata = record(record(current?.assistantMessage)?.metadata);
  return metadata ? (metadata as NativeMessageMetadata) : undefined;
}

/** 手机 / 桌面端助教：流式拿回答，结束时拿到卡片（记忆、日历、课堂、练习）。 */
export async function streamNativeChat(
  payload: NativeChatPayload,
  options: { responseStrength?: ChatResponseStrength; model?: string },
  onDelta: (delta: string) => void,
): Promise<NativeChatResult> {
  const result = await runNativeChatTurn(
    {
      requestId: payload.requestId,
      idempotencyKey: payload.requestId,
      model: options.responseStrength ? undefined : options.model,
      responseStrength: options.responseStrength,
      payload,
    },
    (event) => {
      const delta = deltaOf(event);
      if (delta) onDelta(delta);
    },
  );
  return {
    text: result.text,
    model: result.model,
    metadata: metadataOf(result.finalEvent),
  };
}
