/** 聊天拍照发题：在设备上压缩照片，再随教学回合发给平台。 */

export const MAX_CHAT_IMAGES = 4;

const MAX_IMAGE_EDGE = 1600;
const IMAGE_QUALITY = 0.82;
const THUMBNAIL_EDGE = 360;
const THUMBNAIL_QUALITY = 0.7;

export interface PendingChatImage {
  id: string;
  name: string;
  mimeType: 'image/jpeg';
  /** Base64 (no data: prefix) of the compressed JPEG that is sent to the model. */
  dataBase64: string;
  /** Small JPEG data URL kept with the message so the bubble can show the photo later. */
  thumbnailDataUrl: string;
}

/** Stored on the user message so history can show what was attached. */
export interface ChatImageThumbnail {
  name: string;
  thumbnailDataUrl: string;
}

export function isChatImageFile(file: File): boolean {
  return (
    file.type.startsWith('image/') ||
    /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(file.name)
  );
}

async function decodeImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } catch {
    throw new Error(`“${file.name}”无法读取为图片。`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encodeJpeg(image: HTMLImageElement, maxEdge: number, quality: number): string {
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前设备无法处理图片。');
  // Photos of paper often have transparent PNG edges; flatten onto white for JPEG.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function prepareChatImage(file: File): Promise<PendingChatImage> {
  if (!isChatImageFile(file)) {
    throw new Error(`“${file.name}”不是图片。`);
  }
  const image = await decodeImage(file);
  const dataUrl = encodeJpeg(image, MAX_IMAGE_EDGE, IMAGE_QUALITY);
  return {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, '') + '.jpg',
    mimeType: 'image/jpeg',
    dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    thumbnailDataUrl: encodeJpeg(image, THUMBNAIL_EDGE, THUMBNAIL_QUALITY),
  };
}

export function chatImageThumbnails(metadata: unknown): ChatImageThumbnail[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const images = (metadata as { images?: unknown }).images;
  if (!Array.isArray(images)) return [];
  return images.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { name, thumbnailDataUrl } = item as Record<string, unknown>;
    return typeof thumbnailDataUrl === 'string' && thumbnailDataUrl.startsWith('data:image/')
      ? [{ name: typeof name === 'string' ? name : '图片', thumbnailDataUrl }]
      : [];
  });
}
