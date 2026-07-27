import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { toPrismaJson, toPrismaNullableJson } from '@/lib/server/prisma-json';
import { safeRoute } from '@/lib/server/json-error-response';

const createEnvelopeSchema = z.object({
  fromAgentId: z.string().trim().max(120).optional(),
  toAgentId: z.string().trim().max(120).optional(),
  envelopeType: z.enum([
    'task_dispatch',
    'task_ack',
    'task_wait',
    'task_partial',
    'task_result',
    'task_error',
  ]),
  payload: z.unknown(),
  taskStatus: z.enum(['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled']).optional(),
  /** 关联互动笔记本，与 `/classroom/[id]` 一致 */
  taskNotebookId: z.string().trim().min(1).max(120).optional(),
  taskResult: z.unknown().optional(),
  taskError: z.string().trim().max(4000).optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { userId } = auth;
    const { id } = await context.params;

    const task = await prisma.agentTask.findFirst({
      where: { id, ownerId: userId },
      select: { id: true },
    });
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const envelopes = await prisma.agentEnvelope.findMany({
      where: { taskId: id, ownerId: userId },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({ envelopes });
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { userId } = auth;
    const { id } = await context.params;

    const payload = createEnvelopeSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: payload.error.flatten() },
        { status: 400 },
      );
    }

    const task = await prisma.agentTask.findFirst({
      where: { id, ownerId: userId },
      select: { id: true },
    });
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const envelope = await prisma.agentEnvelope.create({
      data: {
        taskId: id,
        ownerId: userId,
        fromAgentId: payload.data.fromAgentId,
        toAgentId: payload.data.toAgentId,
        envelopeType: payload.data.envelopeType,
        payload: toPrismaJson(payload.data.payload),
      },
    });

    const p = payload.data.payload as { detail?: string; title?: string } | null | undefined;
    const shouldUpdateTask =
      payload.data.taskStatus ||
      payload.data.taskResult ||
      payload.data.taskError ||
      payload.data.taskNotebookId ||
      (p != null && typeof p === 'object' && (p.detail !== undefined || p.title !== undefined));

    if (shouldUpdateTask) {
      let mergedRequest: Record<string, unknown> | undefined;
      if (p != null && typeof p === 'object' && (p.detail !== undefined || p.title !== undefined)) {
        const cur = await prisma.agentTask.findFirst({ where: { id }, select: { request: true } });
        const base = (cur?.request as Record<string, unknown> | null) || {};
        mergedRequest = { ...base };
        if (p.detail !== undefined) mergedRequest.detail = p.detail;
        if (p.title !== undefined) mergedRequest.title = p.title;
      }

      await prisma.agentTask.update({
        where: { id },
        data: {
          ...(payload.data.taskStatus ? { status: payload.data.taskStatus } : {}),
          ...(payload.data.taskNotebookId ? { notebookId: payload.data.taskNotebookId } : {}),
          ...(payload.data.taskResult ? { result: toPrismaNullableJson(payload.data.taskResult) } : {}),
          ...(payload.data.taskError ? { error: payload.data.taskError } : {}),
          ...(mergedRequest ? { request: toPrismaNullableJson(mergedRequest) } : {}),
        },
      });
    }

    return NextResponse.json({ envelope }, { status: 201 });
  });
}
