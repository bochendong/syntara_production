// Four base64 images plus text stay below the deployment's request-body budget.
export const MAX_PHOTO_UPLOAD_BYTES = 600 * 1024;
export const MAX_PHOTO_SOURCE_BYTES = 12 * 1024 * 1024;

export function isValidPhotoAnswerUpload(image: {
  dataUrl: string;
  mimeType: string;
  size: number;
}): boolean {
  const match = image.dataUrl.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/,
  );
  if (!match || match[1] !== image.mimeType || match[2].length % 4 !== 0) return false;
  const bytes =
    (match[2].length / 4) * 3 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
  return bytes > 0 && bytes <= MAX_PHOTO_UPLOAD_BYTES && image.size === bytes;
}

export async function preparePhotoAnswer(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error('无法读取这张图片，请使用 JPG、PNG 或 WebP 照片。');
    }
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片没有有效内容。');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法处理图片，请重试。');
    for (const edge of [2200, 1800, 1400]) {
      const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.88, 0.76, 0.64]) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const size = atob(dataUrl.split(',')[1]).length;
        if (size <= MAX_PHOTO_UPLOAD_BYTES)
          return {
            id: crypto.randomUUID(),
            name: file.name.slice(0, 240),
            mimeType: 'image/jpeg',
            size,
            dataUrl,
          };
      }
    }
    throw new Error('图片内容过大，请裁剪到答题区域后重新上传。');
  } finally {
    URL.revokeObjectURL(url);
  }
}
