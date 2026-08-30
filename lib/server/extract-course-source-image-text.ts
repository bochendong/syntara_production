import type { LanguageModel, UserContent } from 'ai';

import { callLLM } from '@/lib/ai/llm';
import { resolveModel } from '@/lib/server/resolve-model';
import { normalizedCourseSourceMimeType } from '@/lib/uploads/course-source-policy';

export async function extractCourseSourceImageText(args: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  model?: LanguageModel;
}): Promise<string> {
  const model = args.model || (await resolveModel({})).model;
  const mediaType = normalizedCourseSourceMimeType(
    { name: args.fileName, type: args.mimeType },
    'image',
  );
  const content: UserContent = [
    {
      type: 'text',
      text: `Read this course-material image and return clean Markdown only.

Rules:
- Transcribe every legible heading, paragraph, list, table, code block, and formula.
- Rebuild formulas with LaTeX and tables with Markdown when possible.
- Briefly describe educational diagrams or charts that contain meaning not captured by text.
- Do not add explanations, guesses, or content that is not visible.
- If part of the image is unreadable, mark that part as [无法辨认].

File name: ${args.fileName}`,
    },
    { type: 'image', image: args.buffer, mediaType },
  ];
  const result = await callLLM(
    {
      model,
      system: 'You are a precise OCR and educational document transcription engine.',
      maxOutputTokens: 12000,
      messages: [{ role: 'user', content }],
      maxRetries: 0,
    },
    'course-source-image-extraction',
  );
  return result.text;
}
