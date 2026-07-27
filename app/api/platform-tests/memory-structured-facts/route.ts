import { Output } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { callLLM } from '@/lib/ai/llm';
import {
  applyStructuredMemoryExtraction,
  buildStructuredMemoryCasePrompt,
  getStructuredMemoryFactCase,
} from '@/features/qa/test-center/memory/structured-memory-fact-cases';
import { safeRoute } from '@/lib/server/json-error-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { runWithRequestContext } from '@/lib/server/request-context';

export const runtime = 'nodejs';

const requestSchema = z.object({
  action: z.literal('extract_structured_memory'),
  caseId: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{1,100}$/i),
  userMessage: z.string().trim().min(1).max(4_000),
});

const extractionSchema = z.object({
  decision: z.enum([
    'write_calendar',
    'write_learning_memory',
    'write_preference',
    'update_calendar',
    'skip',
  ]),
  reasonToStore: z.string().trim().min(1).max(1_200),
  evidenceQuote: z.string().trim().min(1).max(600),
  confidence: z.enum(['low', 'medium', 'high']),
  normalizationNote: z.string().trim().min(1).max(1_200),
  calendar: z
    .object({
      eventId: z.string().trim().min(1).max(160),
      title: z.string().trim().min(1).max(300),
      startsAt: z.string().trim().min(1).max(80),
      durationMinutes: z.number().int().min(1).max(720),
      timezone: z.string().trim().min(1).max(100),
    })
    .nullable(),
  learningMemory: z
    .object({
      memoryKey: z.string().trim().min(1).max(160),
      title: z.string().trim().min(1).max(300),
      mastery: z.string().trim().min(1).max(1_000).nullable(),
      weakness: z.string().trim().min(1).max(1_000).nullable(),
      cause: z.string().trim().min(1).max(1_000).nullable(),
      nextTeachingMove: z.string().trim().min(1).max(1_000).nullable(),
    })
    .nullable(),
  preference: z
    .object({
      preferenceKey: z.string().trim().min(1).max(160),
      label: z.string().trim().min(1).max(300),
      value: z.string().trim().min(1).max(1_000),
      conclusionLanguage: z.string().trim().min(1).max(80).nullable(),
      explanationLanguage: z.string().trim().min(1).max(80).nullable(),
      reason: z.string().trim().min(1).max(1_000),
    })
    .nullable(),
});

export async function POST(request: NextRequest) {
  return runWithRequestContext(
    request,
    '/api/platform-tests/memory-structured-facts',
    () =>
      safeRoute(async () => {
        const parsed = requestSchema.safeParse(await request.json());
        if (!parsed.success) {
          return NextResponse.json(
            { error: '结构化记忆自然语言测试请求无效。', details: parsed.error.flatten() },
            { status: 400 },
          );
        }

        const testCase = getStructuredMemoryFactCase(parsed.data.caseId);
        if (!testCase) {
          return NextResponse.json({ error: '找不到这条结构化记忆测试。' }, { status: 404 });
        }

        const { model, modelString } = await resolveModelFromHeaders(request, {
          allowOpenAIModelOverride: true,
        });
        const generated = await callLLM(
          {
            model,
            system: [
              '你负责为学习平台生成可人工确认的用户状态写入提案。',
              '只根据用户自然原话、当前日期、时区和已有状态判断；不要要求用户使用产品内部术语。',
              'calendar 和 preference 是精确可覆盖的当前事实；learning_memory 只保存可复用的学习诊断与下一教学动作。',
              '偏好里同时出现结论语言和解释语言时，分别填写 conclusionLanguage 与 explanationLanguage；不能用“有语言偏好”代替具体值。',
              '不要暴露隐藏推理。reasonToStore 只给出简短、可核对的产品理由。',
              '如果信息不足就返回 skip；如果是修改已有日程，必须使用已有 eventId，不能另建重复事项。',
              'decision 对应哪个对象就只填哪个对象，其余对象返回 null。',
            ].join('\n'),
            prompt: buildStructuredMemoryCasePrompt(testCase, parsed.data.userMessage),
            output: Output.object({ schema: extractionSchema }),
            maxOutputTokens: 3_000,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(45_000),
          },
          'platform-test-structured-memory-extraction',
        );
        const extraction = generated.output as z.infer<typeof extractionSchema>;
        const applied = applyStructuredMemoryExtraction({
          testCase,
          userMessage: parsed.data.userMessage,
          extraction,
        });

        return NextResponse.json({
          action: parsed.data.action,
          caseId: testCase.id,
          model: modelString,
          promptVersion: 'structured-memory-natural-language-v1',
          extraction,
          before: testCase.before,
          after: applied.after,
          change: applied.change,
          checks: applied.checks,
          passed: applied.checks.every((check) => check.passed),
          usage: generated.usage,
          persistence: 'none',
        });
      }),
    {
      operationCode: 'qa.memory.structured_facts',
      chargeReason: '结构化记忆自然语言测试',
      serviceLabel: 'QA 测试中心',
    },
  );
}
