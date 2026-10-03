import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireActualServerSession } from '@/lib/server/auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

const failureContext = new AsyncLocalStorage<Record<string, unknown>>();

export function setFailureActor(userId: string, userEmail?: string | null) {
  const context = failureContext.getStore();
  if (context) {
    if (context.userId !== userId) {
      context.role = 'UNKNOWN';
      context.userName = null;
      context.userEmail = null;
    }
    context.userId = userId;
    if (userEmail) context.userEmail = userEmail;
  }
}

// Store immutable snapshots; never retain credentials or inline binary data.
export function failureSnapshot(value: unknown): unknown {
  if (typeof value === 'string')
    return value.startsWith('data:')
      ? '[inline file omitted]'
      : value.length > 200000
        ? value.slice(0, 200000) + '\n[truncated after 200000 characters]'
        : value;
  if (Array.isArray(value)) return value.map(failureSnapshot);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /password|secret|token|authorization|api.?key|cookie/i.test(key)
          ? '[redacted]'
          : failureSnapshot(item),
      ]),
    );
  return value;
}

export async function captureFailureInput(request: Request): Promise<unknown> {
  try {
    const copy = request.clone();
    const type = request.headers.get('content-type') || '';
    if (type.includes('multipart/form-data')) {
      const form = await copy.formData();
      return failureSnapshot(
        Array.from(form.entries()).map(([field, value]) => ({
          field,
          ...(typeof value === 'string'
            ? { value }
            : {
                file: {
                  name: value.name,
                  size: value.size,
                  type: value.type,
                  lastModified: value.lastModified,
                },
              }),
        })),
      );
    }
    if (type.includes('json')) return failureSnapshot(await copy.json());
    // Binary uploads are already persisted by the upload service; retain metadata only.
    return {
      contentType: type,
      contentLength: request.headers.get('content-length'),
      query: failureSnapshot(Object.fromEntries(new URL(request.url).searchParams)),
    };
  } catch {
    return { unavailable: '请求内容无法解析' };
  }
}

export function classifyAiFailure(
  reason: unknown,
  output: unknown,
): { category: string; categoryLabel: string; suggestion?: string } {
  const message = String(reason || '') + ' ' + JSON.stringify(output || {});
  if (/算力积分不足|购买积分不足|余额不足，请先充值/i.test(message))
    return {
      category: 'user_credits',
      categoryLabel: '用户积分不足',
      suggestion: '查看该用户的平台积分及充值记录。',
    };
  if (
    /insufficient_quota|insufficient[_ ]?(balance|funds|credits)|credit balance.*(low|insufficient)|billing[_ ]?(hard[_ ]?limit|limit)|payment required|余额不足|余额耗尽|欠费|额度耗尽|exceeded your current quota/i.test(
      message,
    )
  )
    return {
      category: 'provider_balance',
      categoryLabel: '模型余额 / 额度不足',
      suggestion: '检查模型供应商账户余额、账单状态及项目额度；充值或调整额度后再重试。',
    };
  if (/rate[_ ]?limit|too many requests|频率限制/i.test(message))
    return {
      category: 'rate_limit',
      categoryLabel: '模型请求频率限制',
      suggestion: '等待供应商限流恢复或调整并发。',
    };
  return { category: 'other', categoryLabel: '其他失败' };
}

export async function persistAiFailure(data: Record<string, unknown>): Promise<void> {
  try {
    const { getRequestContext } = await import('@/lib/server/request-context');
    const context = failureContext.getStore();
    data = { ...context, requestInput: context?.input, ...getRequestContext(), ...data };
    data = { ...data, ...classifyAiFailure(data.reason, data.output) };
    if (!data.requestId) data.requestId = randomUUID();
    data.role ??= 'UNKNOWN';
    data.method ??= 'LLM';
    data.route ??= '/ai/' + String(data.source || 'unknown');
    data.durationMs ??= context?.startedAt ? Date.now() - Date.parse(String(context.startedAt)) : 0;
    const prisma = getOptionalPrisma();
    if (prisma && data.userId && (!data.role || data.role === 'UNKNOWN')) {
      const user = await prisma.user.findUnique({
        where: { id: String(data.userId) },
        select: { role: true, name: true, email: true },
      });
      if (user) data = { ...data, role: user.role, userName: user.name, userEmail: user.email };
    }
    if (!prisma) {
      console.error('[AI failure audit unavailable] DATABASE_URL is not configured');
      return;
    }
    await prisma.$executeRaw`INSERT INTO "AiFailureRecord" ("id", "data") VALUES (${randomUUID()}, ${JSON.stringify(failureSnapshot(data))}::jsonb)`;
  } catch (error) {
    console.error('[AI failure audit persistence failed]', error);
  }
}

export function withAiFailureAudit<
  Q extends Request,
  A extends unknown[],
  R extends Response | undefined,
>(handler: (request: Q, ...args: A) => Promise<R>) {
  return async (request: Parameters<typeof handler>[0], ...args: A): Promise<Response> => {
    const req = request as Request;
    const started = Date.now();
    const requestId = randomUUID();
    const [input, session] = await Promise.all([
      captureFailureInput(req),
      requireActualServerSession(),
    ]);
    const base = {
      requestId,
      route: new URL(req.url).pathname,
      method: req.method,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      role: session?.user?.role ?? 'UNKNOWN',
      input,
      startedAt: new Date(started).toISOString(),
    };
    const record = (output: unknown, reason: string, status: number) =>
      persistAiFailure({ ...base, output, reason, status, durationMs: Date.now() - started });
    try {
      const response = await failureContext.run(base, () => handler(request, ...args));
      if (!response) {
        await record(null, '路由未返回响应', 500);
        return NextResponse.json({ error: '内部错误', requestId }, { status: 500 });
      }
      if (response.status >= 400) {
        let output: unknown;
        try {
          output = await response.clone().json();
        } catch {
          output = { statusText: response.statusText };
        }
        await record(output, JSON.stringify(output), response.status);
      }
      if (response.body && response.headers.get('content-type')?.includes('text/event-stream')) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                return;
              }
              pending += decoder.decode(value, { stream: true });
              const lines = pending.split('\n');
              pending = lines.pop() || '';
              for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                try {
                  const event = JSON.parse(line.slice(5));
                  if (event.error || event.type === 'error' || event.type === 'task_error')
                    await record(
                      event,
                      String(
                        event.error?.message || event.error || event.message || '流式 AI 操作失败',
                      ),
                      500,
                    );
                } catch {
                  /* non-JSON SSE */
                }
              }
              controller.enqueue(value);
            } catch (error) {
              await record(
                { stack: error instanceof Error ? error.stack : null },
                String(error),
                500,
              );
              controller.error(error);
            }
          },
          async cancel(reason) {
            await reader.cancel(reason);
            await record({ cancelled: true }, '客户端取消了流式请求', 499);
          },
        });
        const headers = new Headers(response.headers);
        headers.set('x-ai-request-id', requestId);
        return new Response(stream, { status: response.status, headers });
      }
      response.headers.set('x-ai-request-id', requestId);
      return response;
    } catch (error) {
      await record(
        { stack: error instanceof Error ? error.stack : null },
        error instanceof Error ? error.message : String(error),
        500,
      );
      throw error;
    }
  };
}
