import { wrapLanguageModel, type LanguageModel } from 'ai';
import type { NextRequest } from 'next/server';
import { requireServerSession } from '@/lib/server/auth';
import { verifyOpenAIFileCapability } from '@/lib/server/openai-upload-capability';

// This SDK version only serializes PDF/image file parts. For uploaded document
// IDs, application/pdf selects input_file; OpenAI uses the stored file's actual
// format (including DOCX, PPTX, Markdown and TXT), not this transport hint.
export function notebookOriginalFilePart(file: {
  fileId: string;
  mimeType: string;
  fileName: string;
}) {
  return {
    type: 'file' as const,
    data: file.fileId,
    mediaType: file.mimeType.startsWith('image/') ? file.mimeType : 'application/pdf',
    filename: file.fileName,
  };
}

export async function withNotebookOriginalFile(model: LanguageModel, req: NextRequest) {
  const token = req.headers.get('x-notebook-source-token');
  if (!token) return model;
  const session = await requireServerSession();
  const userId = session?.user?.id;
  if (!userId) throw new Error('原文件笔记本生成需要登录。');
  const file = verifyOpenAIFileCapability({ token, userId, intents: ['course_source'] });
  if (!file) throw new Error('笔记本原文件凭证无效或已过期，请重新上传。');
  if (typeof model === 'string' || model.specificationVersion !== 'v3')
    throw new Error('原文件生成需要 OpenAI Responses v3 模型。');
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params }) => {
        const prompt = [...params.prompt];
        const index = prompt.findLastIndex((message) => message.role === 'user');
        const message = prompt[index];
        if (!message || message.role !== 'user') throw new Error('笔记本生成缺少用户请求。');
        prompt[index] = {
          ...message,
          content: [...message.content, notebookOriginalFilePart(file)],
        };
        return { ...params, prompt };
      },
    },
  });
}
