import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { uploadNativeMaterial } from '@/lib/server/native-materials';
import { prisma } from '@/lib/server/prisma';

const uploadSchema = z.object({
  kind: z.enum(['notes', 'problems']),
  clientId: z.string().uuid(),
  name: z.string().max(400),
  text: z.string().min(1).max(1_000_000),
});

/** 网页资料库上传笔记 / 题目，和 App 资料页写进同一处，所有设备都能看到。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id } = await context.params;
    const parsed = uploadSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: '资料格式不对。' }, { status: 400 });
    }
    const result = await uploadNativeMaterial(prisma, auth.userId, {
      ...parsed.data,
      courseId: id,
    });
    if (result.status === 'not_found') {
      return NextResponse.json({ error: result.message }, { status: 404 });
    }
    if (result.status === 'forbidden') {
      return NextResponse.json({ error: result.message }, { status: 403 });
    }
    if (result.status === 'conflict') {
      return NextResponse.json({ error: result.message }, { status: 409 });
    }
    return NextResponse.json(result, { status: 201 });
  });
}
