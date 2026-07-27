import type { ImageGenerationResult } from '@/lib/media/types';

function parseImageBase64(data: string): string {
  return data.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
}

async function imageResultBuffer(
  result: ImageGenerationResult,
  request: typeof fetch,
): Promise<Buffer | null> {
  if (result.base64) {
    return Buffer.from(parseImageBase64(result.base64), 'base64');
  }
  if (!result.url) return null;

  const response = await request(result.url);
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Materialize an image-provider result at the exact pixel dimensions requested
 * by the caller. OpenAI currently generates portrait images at 1024x1536, so
 * A4-like consumers must normalize the returned pixels before previewing or
 * persisting the asset.
 */
export async function normalizeRequestedImageDimensions(
  result: ImageGenerationResult,
  width?: number,
  height?: number,
  request: typeof fetch = fetch,
): Promise<ImageGenerationResult> {
  if (!width || !height || (result.width === width && result.height === height)) return result;

  const sourceBuffer = await imageResultBuffer(result, request);
  if (!sourceBuffer) return result;

  const sharp = (await import('sharp')).default;
  const normalized = await sharp(sourceBuffer)
    .resize(width, height, {
      fit: 'contain',
      position: 'centre',
      background: '#ffffff',
    })
    .png()
    .toBuffer();

  return {
    ...result,
    url: undefined,
    base64: normalized.toString('base64'),
    width,
    height,
  };
}
