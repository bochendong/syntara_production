import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { runWithRequestContext } from '@/lib/server/request-context';
import {
  repairMathSlide,
  type RepairMathSlideResult,
} from '@/lib/server/slide-repair/math-repair';
import type { RepairRequestBody } from '@/lib/server/slide-repair/shared';

export const maxDuration = 180;

function toApiResponse(result: RepairMathSlideResult) {
  if (result.ok) {
    return apiSuccess(result.value);
  }

  return apiError(result.code, result.status, result.message);
}

export async function POST(req: NextRequest) {
  let body: RepairRequestBody;
  try {
    body = (await req.json()) as RepairRequestBody;
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid request body');
  }

  const sceneTitle = body.sceneTitle?.trim() || 'Slide';

  return runWithRequestContext(
    req,
    '/api/classroom/repair-slide-math',
    async () => toApiResponse(await repairMathSlide({ req, body, sceneTitle })),
    {
      notebookId: body.notebookId?.trim() || undefined,
      notebookName: body.notebookName?.trim() || undefined,
      sceneId: body.sceneId?.trim() || undefined,
      sceneTitle,
      sceneOrder:
        typeof body.sceneOrder === 'number' && Number.isFinite(body.sceneOrder)
          ? Math.max(1, Math.round(body.sceneOrder))
          : undefined,
      sceneType: 'slide',
      operationCode: 'slide_repair_math',
      chargeReason: '修复当前数学页面',
    },
  );
}
