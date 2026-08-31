import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { verifyOpenAIUploadCapability } from '@/lib/server/openai-upload-capability';
import { cancelOpenAIUserUpload } from '@/lib/server/openai-user-files';

export const runtime = 'nodejs';

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ uploadId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { uploadId } = await context.params;
    const uploadToken = request.headers.get('x-upload-token')?.trim() || '';
    const capability = verifyOpenAIUploadCapability({
      token: uploadToken,
      userId: auth.userId,
      uploadId,
    });
    if (!capability) {
      return NextResponse.json({ error: '上传凭证无效或已过期。' }, { status: 403 });
    }
    await cancelOpenAIUserUpload(uploadId);
    return NextResponse.json({ cancelled: true });
  });
}
