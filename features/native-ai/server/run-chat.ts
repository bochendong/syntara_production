import type { ModelMessage } from 'ai';
import { stepCountIs } from 'ai';
import type { NextRequest } from 'next/server';

import { streamLLM } from '@/lib/ai/llm';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';

import { fileTextBlock, readNativeChatFiles } from './attachments';
import { buildNativeChatSystemPrompt } from './prompt';
import type { NativeChatRequest } from './schema';
import { createNativeChatTools, latestQuestion, type NativeChatProposals } from './tools';

/** 学生自己明说要课堂 / 幻灯片 / 图解时，模型没建议也给课堂卡片（关键词兜底）。 */
const LECTURE_REQUEST =
  /课堂|小课|微课|讲一节|上一节|做成.{0,6}(课|讲解|幻灯片)|生成.{0,8}讲解|幻灯片|slides?|ppt|图解|配图|画图.{0,4}讲|可视化|动画|视频|lecture|lesson/i;

const MAX_STEPS = 4;

async function chatMessages(input: NativeChatRequest): Promise<ModelMessage[]> {
  const last = input.messages.length - 1;
  const files = await readNativeChatFiles(input.files);
  return input.messages.map((message, index): ModelMessage => {
    if (message.role === 'assistant') return { role: 'assistant', content: message.text };
    if (index !== last || (!input.images.length && !files.length)) {
      return { role: 'user', content: message.text };
    }
    const fallback = input.images.length ? '请看图片。' : '请看我发的文件。';
    return {
      role: 'user',
      content: [
        ...files.map((file) =>
          file.kind === 'pdf'
            ? {
                type: 'file' as const,
                data: file.dataBase64,
                mediaType: 'application/pdf',
                filename: file.name,
              }
            : { type: 'text' as const, text: fileTextBlock(file) },
        ),
        { type: 'text', text: message.text || fallback },
        ...input.images.map((image) => ({
          type: 'image' as const,
          image: image.dataBase64,
          mediaType: image.mimeType,
        })),
      ],
    };
  });
}

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function messageMetadata(
  input: NativeChatRequest,
  proposals: NativeChatProposals,
  model: Record<string, unknown>,
) {
  if (input.scope === 'general') {
    return {
      schemaVersion: 1 as const,
      aiVersion: 'native-v2',
      surface: input.surface,
      learningActions: [],
      evidence: [],
      model,
    };
  }
  const askedForLecture = LECTURE_REQUEST.test(latestQuestion(input));
  const lectureSuggested = Boolean(proposals.classroom) || askedForLecture;
  return {
    schemaVersion: 1 as const,
    aiVersion: 'native-v2',
    surface: input.surface,
    lectureEligible: lectureSuggested,
    lectureEligibilityReason: lectureSuggested ? ('course_answer' as const) : undefined,
    lectureSuggested: lectureSuggested || undefined,
    lectureTitle: proposals.classroom?.title,
    learningActions: proposals.actions,
    problemSelection: proposals.problemSelection ?? undefined,
    evidence: [
      ...input.context.notes.map((note) => ({
        id: note.id,
        sourceType: 'notebook' as const,
        sourceId: note.id,
        title: `${note.notebook} · ${note.title}`,
        metadata: note.notebookId ? { notebookId: note.notebookId } : undefined,
      })),
      // 回答里的 [^mn] 指向这些记忆，App 画成对应颜色的珠子。
      ...input.context.memories.map((memory) => ({
        id: memory.id,
        sourceType: 'memory' as const,
        sourceId: memory.id,
        title: memory.title,
        metadata: { kind: memory.kind },
      })),
    ],
    model,
  };
}

/**
 * 一个模型边流式回答边按需调用“提议”工具。返回 SSE：
 * text_delta {delta} … done {assistantMessage:{text, metadata}} | error {error:{message}}
 */
export async function runNativeChat(
  request: NextRequest,
  input: NativeChatRequest,
): Promise<ReadableStream<Uint8Array>> {
  const resolved = await resolveModelFromHeaders(request, { allowOpenAIModelOverride: true });
  const proposals: NativeChatProposals = { actions: [], classroom: null, problemSelection: null };
  const result = await streamLLM(
    {
      model: resolved.model,
      system: buildNativeChatSystemPrompt(input),
      messages: await chatMessages(input),
      tools: input.scope === 'general' ? undefined : createNativeChatTools(input, proposals),
      stopWhen: stepCountIs(MAX_STEPS),
      maxOutputTokens: input.surface === 'phone' ? 4000 : 6000,
      maxRetries: 0,
      abortSignal: request.signal,
    },
    'native-chat',
  );

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let text = '';
      try {
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta' && part.text) {
            text += part.text;
            controller.enqueue(sse('text_delta', { delta: part.text }));
          } else if (part.type === 'finish-step' && text && !text.endsWith('\n\n')) {
            // 工具调用前后的两段文字之间补一个空行。
            const gap = text.endsWith('\n') ? '\n' : '\n\n';
            text += gap;
            controller.enqueue(sse('text_delta', { delta: gap }));
          } else if (part.type === 'error') {
            throw part.error instanceof Error ? part.error : new Error(String(part.error));
          }
        }
        const usage = await result.totalUsage;
        const metadata = messageMetadata(input, proposals, {
          provider: resolved.providerId,
          model: resolved.modelString,
          inputTokens: usage.inputTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
        });
        const finalText = text.trim() || '好的，我把下一步放在下面的卡片里了。';
        controller.enqueue(
          sse('done', {
            requestId: input.requestId,
            assistantMessage: { text: finalText, metadata },
          }),
        );
      } catch (error) {
        controller.enqueue(
          sse('error', {
            error: { message: error instanceof Error ? error.message : '助教回复失败。' },
          }),
        );
      } finally {
        controller.close();
      }
    },
  });
}
