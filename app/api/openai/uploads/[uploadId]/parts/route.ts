import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { verifyOpenAIUploadCapability } from '@/lib/server/openai-upload-capability';
import {
  addOpenAIUserUploadPart,
  OPENAI_BROWSER_UPLOAD_PART_BYTES,
} from '@/lib/server/openai-user-files';

export const runtime = 'nodejs';

export async function POST(
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
    const partIndex = Number(request.headers.get('x-part-index'));
    const partCount = Math.ceil(capability.bytes / OPENAI_BROWSER_UPLOAD_PART_BYTES);
    if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= partCount) {
      return NextResponse.json({ error: '上传分片序号无效。' }, { status: 400 });
    }
    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > OPENAI_BROWSER_UPLOAD_PART_BYTES) {
      return NextResponse.json({ error: '单个上传分片过大。' }, { status: 413 });
    }
    const chunk = Buffer.from(await request.arrayBuffer());
    const expectedBytes = Math.min(
      OPENAI_BROWSER_UPLOAD_PART_BYTES,
      capability.bytes - partIndex * OPENAI_BROWSER_UPLOAD_PART_BYTES,
    );
    if (chunk.byteLength !== expectedBytes) {
      return NextResponse.json(
        { error: `上传分片大小不正确：应为 ${expectedBytes} 字节。` },
        { status: 400 },
      );
    }
    const partId = await addOpenAIUserUploadPart({ uploadId, partIndex, chunk });
    return NextResponse.json({ partId, partIndex });
  });
}
