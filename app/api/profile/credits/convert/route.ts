import { z } from 'zod';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireUserId } from '@/lib/server/api-auth';
import { convertCashCredits } from '@/lib/server/credits';

const bodySchema = z.object({
  amount: z.number().finite().positive(),
  targetAccountType: z.enum(['COMPUTE', 'PURCHASE']),
});

export async function POST(request: Request) {
  const auth = await requireUserId();
  if ('response' in auth) return auth.response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    return apiError('INVALID_REQUEST', 400, error instanceof Error ? error.message : '请求体无效');
  }

  try {
    const result = await convertCashCredits({
      userId: auth.userId,
      amount: body.amount,
      targetAccountType: body.targetAccountType,
    });
    return apiSuccess({
      ...result,
      amount: Math.round(body.amount),
      targetAccountType: body.targetAccountType,
    });
  } catch (error) {
    return apiError('INVALID_REQUEST', 400, error instanceof Error ? error.message : '转换失败');
  }
}
