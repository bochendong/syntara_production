import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { toPrismaJson, toPrismaNullableJson } from '@/lib/server/prisma-json';
import { safeRoute } from '@/lib/server/json-error-response';
import { persistLocalGeneratedNotebookImages } from '@/lib/server/notebook-scene-image-assets';
import { stripPrivateSpeechAudioFromActions } from '@/lib/server/speech-action-assets';
import {
  beginOwnedNotebookSceneGeneration,
  finalizeOwnedNotebookSceneGeneration,
  findOwnedNotebookSceneGenerationFence,
  findReadableNotebookId,
  listNotebookScenes,
  NotebookSceneGenerationWriteError,
  replaceOwnedNotebookScenes,
  upsertOwnedNotebookGenerationScenes,
} from '@/lib/server/repositories/notebook-repository';

const sceneInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(60),
  order: z.number().int().min(0),
  content: z.unknown(),
  actions: z.unknown().optional(),
  whiteboards: z.unknown().optional(),
  generationDiagnostics: z.unknown().optional(),
});

const replaceScenesSchema = z.object({
  scenes: z.array(sceneInputSchema).max(500),
});

const incrementalSceneInputSchema = sceneInputSchema.extend({
  id: z.string().trim().min(1).max(128),
});

const incrementalScenesSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('begin'),
    expectedCourseId: z.string().trim().min(1).max(128).nullable(),
    expectedContentVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  }),
  z.object({
    operation: z.literal('upsert'),
    expectedCourseId: z.string().trim().min(1).max(128).nullable(),
    expectedContentVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    scenes: z.array(incrementalSceneInputSchema).min(1).max(8),
  }),
  z.object({
    operation: z.literal('finalize'),
    expectedCourseId: z.string().trim().min(1).max(128).nullable(),
    expectedContentVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    expectedSceneCount: z.number().int().min(1).max(500),
  }),
]);

const MAX_INCREMENTAL_REQUEST_BYTES = 2_500_000;
const MAX_INCREMENTAL_SCENE_CONTENT_BYTES = 1_600_000;
const MAX_INCREMENTAL_SCENE_ACTIONS_BYTES = 600_000;
const MAX_INCREMENTAL_SCENE_WHITEBOARD_BYTES = 300_000;
const MAX_INCREMENTAL_SCENE_DIAGNOSTICS_BYTES = 200_000;
const SCENE_CONTENT_DIAGNOSTICS_KEY = '__generationDiagnostics';
const IMAGE_NOTEBOOK_FOCUS_REPAIR_KEY = 'imageNotebookFocusRepair';

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function incrementalPayloadTooLarge(
  rawBody: unknown,
  scenes: z.infer<typeof incrementalSceneInputSchema>[],
): boolean {
  if (serializedBytes(rawBody) > MAX_INCREMENTAL_REQUEST_BYTES) return true;
  return scenes.some(
    (scene) =>
      serializedBytes(scene.content) > MAX_INCREMENTAL_SCENE_CONTENT_BYTES ||
      serializedBytes(scene.actions) > MAX_INCREMENTAL_SCENE_ACTIONS_BYTES ||
      serializedBytes(scene.whiteboards) > MAX_INCREMENTAL_SCENE_WHITEBOARD_BYTES ||
      serializedBytes(scene.generationDiagnostics) > MAX_INCREMENTAL_SCENE_DIAGNOSTICS_BYTES,
  );
}

function incrementalWriteErrorResponse(error: NotebookSceneGenerationWriteError) {
  const status =
    error.code === 'NOTEBOOK_NOT_FOUND'
      ? 404
      : error.code === 'NOTEBOOK_SCENE_COUNT_MISMATCH'
        ? 422
        : 409;
  return NextResponse.json(
    {
      error: error.code,
      code: error.code,
      currentContentVersion: error.currentContentVersion,
      actualSceneCount: error.actualSceneCount,
    },
    { status },
  );
}

function attachGenerationDiagnosticsToContent(content: unknown, diagnostics: unknown): unknown {
  if (!diagnostics || !content || typeof content !== 'object' || Array.isArray(content)) {
    return content;
  }
  return {
    ...(content as Record<string, unknown>),
    [SCENE_CONTENT_DIAGNOSTICS_KEY]: diagnostics,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getCanvasElements(content: unknown): Array<Record<string, unknown>> {
  if (!isRecord(content)) return [];
  const canvas = content.canvas;
  if (!isRecord(canvas) || !Array.isArray(canvas.elements)) return [];
  return canvas.elements.filter(isRecord);
}

function hasFullPageBitmap(content: unknown): boolean {
  return getCanvasElements(content).some((element) => {
    if (element.type !== 'image') return false;
    const name = String(element.name || '');
    const width = Number(element.width || 0);
    const height = Number(element.height || 0);
    return /full_page_bitmap/i.test(name) || (width >= 900 && height >= 500);
  });
}

function hasImageNotebookFocusRepair(content: unknown): boolean {
  if (!isRecord(content)) return false;
  const diagnostics = content[SCENE_CONTENT_DIAGNOSTICS_KEY];
  return isRecord(diagnostics) && isRecord(diagnostics[IMAGE_NOTEBOOK_FOCUS_REPAIR_KEY]);
}

function shouldPreserveRepairedImageNotebookContent(
  existingContent: unknown,
  incomingContent: unknown,
) {
  return (
    hasImageNotebookFocusRepair(existingContent) &&
    hasFullPageBitmap(existingContent) &&
    hasFullPageBitmap(incomingContent) &&
    !hasImageNotebookFocusRepair(incomingContent)
  );
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { userId } = auth;
    const { id } = await context.params;

    const notebook = await findReadableNotebookId(prisma, userId, id);
    if (!notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }

    const scenes = await listNotebookScenes(prisma, id);
    return NextResponse.json({
      scenes: scenes.map((scene) => ({
        ...scene,
        actions: stripPrivateSpeechAudioFromActions(scene.actions),
      })),
    });
  });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { userId } = auth;
    const { id } = await context.params;

    const payload = replaceScenesSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: payload.error.flatten() },
        { status: 400 },
      );
    }

    const existingScenes = await listNotebookScenes(prisma, id);
    const existingById = new Map(existingScenes.map((scene) => [scene.id, scene]));
    const existingByOrder = new Map(existingScenes.map((scene) => [scene.order, scene]));

    const sceneData = await Promise.all(
      payload.data.scenes.map(async (s) => {
        const contentWithDiagnostics = attachGenerationDiagnosticsToContent(
          s.content,
          s.generationDiagnostics,
        );
        const { content } = await persistLocalGeneratedNotebookImages(
          prisma,
          contentWithDiagnostics,
        );
        const existingScene =
          (s.id ? existingById.get(s.id) : undefined) || existingByOrder.get(s.order);
        const mergedContent = shouldPreserveRepairedImageNotebookContent(
          existingScene?.content,
          content,
        )
          ? existingScene?.content
          : content;
        return {
          id: s.id,
          title: s.title,
          type: s.type,
          order: s.order,
          content: toPrismaJson(mergedContent),
          actions: toPrismaNullableJson(stripPrivateSpeechAudioFromActions(s.actions)),
          whiteboard: toPrismaNullableJson(s.whiteboards),
        };
      }),
    );

    const scenes = await replaceOwnedNotebookScenes(prisma, userId, id, sceneData);
    if (!scenes) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    return NextResponse.json({ scenes });
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { userId } = auth;
    const { id } = await context.params;
    const rawBody = await request.json();
    const payload = incrementalScenesSchema.safeParse(rawBody);
    if (!payload.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: payload.error.flatten() },
        { status: 400 },
      );
    }

    try {
      if (payload.data.operation === 'begin') {
        const fence = await beginOwnedNotebookSceneGeneration(
          prisma,
          userId,
          id,
          payload.data.expectedCourseId,
          payload.data.expectedContentVersion,
        );
        return NextResponse.json({ ok: true, ...fence });
      }

      if (payload.data.operation === 'finalize') {
        const fence = await finalizeOwnedNotebookSceneGeneration(
          prisma,
          userId,
          id,
          payload.data.expectedCourseId,
          payload.data.expectedContentVersion,
          payload.data.expectedSceneCount,
        );
        return NextResponse.json({ ok: true, ...fence });
      }

      if (incrementalPayloadTooLarge(rawBody, payload.data.scenes)) {
        return NextResponse.json(
          { error: 'Incremental scene payload is too large', code: 'SCENE_PAYLOAD_TOO_LARGE' },
          { status: 413 },
        );
      }
      const sceneIds = payload.data.scenes.map((scene) => scene.id);
      if (new Set(sceneIds).size !== sceneIds.length) {
        return NextResponse.json(
          { error: 'Incremental scene ids must be unique', code: 'DUPLICATE_SCENE_ID' },
          { status: 400 },
        );
      }

      // Asset persistence can write rows, so authorize the owner/course/version
      // fence before accepting any local generated image.
      const currentFence = await findOwnedNotebookSceneGenerationFence(prisma, userId, id);
      if (!currentFence) {
        return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
      }
      if (
        currentFence.courseId !== payload.data.expectedCourseId ||
        currentFence.contentVersion !== payload.data.expectedContentVersion
      ) {
        return NextResponse.json(
          {
            error: 'Notebook generation fence changed',
            code: 'NOTEBOOK_CONTENT_VERSION_CONFLICT',
            currentContentVersion: currentFence.contentVersion,
          },
          { status: 409 },
        );
      }

      const sceneData = await Promise.all(
        payload.data.scenes.map(async (scene) => {
          const contentWithDiagnostics = attachGenerationDiagnosticsToContent(
            scene.content,
            scene.generationDiagnostics,
          );
          const { content } = await persistLocalGeneratedNotebookImages(
            prisma,
            contentWithDiagnostics,
          );
          return {
            id: scene.id,
            title: scene.title,
            type: scene.type,
            order: scene.order,
            content: toPrismaJson(content),
            actions: toPrismaNullableJson(stripPrivateSpeechAudioFromActions(scene.actions)),
            whiteboard: toPrismaNullableJson(scene.whiteboards),
          };
        }),
      );
      const fence = await upsertOwnedNotebookGenerationScenes(
        prisma,
        userId,
        id,
        payload.data.expectedCourseId,
        payload.data.expectedContentVersion,
        sceneData,
      );
      return NextResponse.json({
        ok: true,
        ...fence,
        writtenSceneIds: sceneData.map((scene) => scene.id),
      });
    } catch (error) {
      if (error instanceof NotebookSceneGenerationWriteError) {
        return incrementalWriteErrorResponse(error);
      }
      throw error;
    }
  });
}
