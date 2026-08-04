import type { ModelMessage } from 'ai';

/**
 * AI SDK treats string image content as a remote URL during its asset planning
 * pass. Decode browser data URLs to bytes so inline images never enter the
 * HTTP downloader. Normal remote URLs keep their existing provider path.
 */
export function normalizeModelImageContent(value: string): string | Uint8Array {
  if (!value.startsWith('data:')) return value;

  const commaIndex = value.indexOf(',');
  if (commaIndex < 0) throw new Error('图片 data URL 格式无效。');
  const metadata = value.slice(5, commaIndex);
  const payload = value.slice(commaIndex + 1);

  try {
    if (metadata.split(';').includes('base64')) {
      return Uint8Array.from(Buffer.from(payload, 'base64'));
    }
    return new TextEncoder().encode(decodeURIComponent(payload));
  } catch {
    throw new Error('图片 data URL 内容无法解码。');
  }
}

/**
 * `convertToModelMessages` represents every UI attachment as a file part. For
 * images, that makes the AI SDK's asset planner treat a browser data URL as a
 * remote file URL. Convert image files into real image parts before invoking a
 * model, while leaving PDFs and other uploaded files untouched.
 */
export function normalizeModelMessageInlineImages(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user' || typeof message.content === 'string') return message;

    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== 'file' || !part.mediaType.startsWith('image/')) return part;

        return {
          type: 'image' as const,
          image: typeof part.data === 'string' ? normalizeModelImageContent(part.data) : part.data,
          mediaType: part.mediaType,
          providerOptions: part.providerOptions,
        };
      }),
    };
  });
}
