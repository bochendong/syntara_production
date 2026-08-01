import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { normalizeAttemptMemoryDiagnosis } from '@/features/memory/domain/learner-memory-update';
import { safeRoute } from '@/lib/server/json-error-response';
import { proxyFetch } from '@/lib/server/proxy-fetch';

export const runtime = 'nodejs';

const requestSchema = z.object({
  action: z.literal('diagnose_attempt'),
  caseId: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{1,100}$/i),
  problem: z.object({
    id: z.string().trim().min(1).max(180),
    title: z.string().trim().min(1).max(300),
    prompt: z.string().trim().min(1).max(12_000),
    questionType: z.string().trim().min(1).max(80),
    concept: z.string().trim().min(1).max(300),
    points: z.number().positive().max(100),
    referenceAnswer: z.union([z.string(), z.array(z.string())]),
    rubric: z.string().trim().min(1).max(5_000),
    analysis: z.string().trim().min(1).max(4_000),
  }),
  attempts: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(180),
        status: z.string().trim().min(1).max(40),
        score: z.number().min(0).max(100),
        maxScore: z.number().positive().max(100),
        answer: z.string().max(12_000),
        feedback: z.string().max(5_000),
        gradingSource: z.string().trim().min(1).max(80),
        gradingReliable: z.boolean(),
      }),
    )
    .min(1)
    .max(8),
  baseline: z.object({
    level: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(2_000),
    mastered: z.array(z.string().trim().min(1).max(500)).max(30),
    weaknesses: z.array(z.string().trim().min(1).max(500)).max(30),
    hasExistingDurableMemory: z.boolean(),
    existingDurableMemory: z.string().trim().max(3_000).nullable(),
  }),
});

const generatedSchema = z.object({
  knowledgePoint: z.string().trim().min(1).max(300),
  masteredSignal: z.string().trim().min(1).max(1_000).nullable(),
  stuckPoint: z.string().trim().min(1).max(1_000).nullable(),
  cause: z.string().trim().min(1).max(1_000).nullable(),
  nextTeachingMove: z.string().trim().min(1).max(1_000),
  confidence: z.enum(['low', 'medium', 'high']),
  evidenceFromAttempt: z.array(z.string().trim().min(1).max(320)).max(8),
  durableMemoryReason: z.string().trim().min(1).max(1_200),
});

function resolveEnvironmentModel(request: NextRequest): string {
  const configuredDefault = process.env.DEFAULT_MODEL?.trim() || 'gpt-5.6-terra';
  const requested = request.headers.get('x-model')?.trim();
  if (!requested) return configuredDefault;
  const match = requested.match(/^(?:openai[:/])?([a-z0-9][a-z0-9._-]{0,100})$/i);
  return match?.[1] || configuredDefault;
}

export async function POST(request: NextRequest) {
  return safeRoute(async () => {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: '本地做题诊断测试请求无效。', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: '未配置 OPENAI_API_KEY，无法执行本地做题诊断测试。' },
        { status: 503 },
      );
    }

    const input = parsed.data;
    const modelId = resolveEnvironmentModel(request);
    const openai = createOpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
      fetch: proxyFetch as typeof fetch,
    });
    const generated = await generateText({
      model: openai.chat(modelId),
      system: [
        '你是 CSC148 教学平台中负责把真实判题结果提炼成教学诊断的助手。',
        'Attempt 与评分结果是业务事实；你只负责解释这些证据支持的掌握、薄弱、原因与下一教学动作。',
        '禁止读取测试预期后反推诊断；禁止仅凭 baseline 虚构本轮掌握。',
        'masteredSignal 只写学生答案中确有证据的部分；没有就返回 null。',
        'stuckPoint 必须与学生答案、正确答案、rubric 或可信评分反馈的差异对应。',
        'cause 是对错误心智模型的谨慎解释；证据不足就返回 null，不要把“粗心”当默认原因。',
        '一次通过只说明本轮通过，不足以声称稳定掌握；下一步应安排独立迁移复测。',
        'evidenceFromAttempt 必须逐字摘录学生答案或评分反馈中的短片段，不得引用 baseline、参考答案或你的解释。',
        '所有自然语言字段使用简体中文，课程术语和代码标识符可保留英文。',
      ].join('\n'),
      prompt: [
        '## 题目与评分合同',
        JSON.stringify(input.problem, null, 2),
        '## 已落库作答与评分证据',
        JSON.stringify(input.attempts, null, 2),
        '## 既有学习状态（只能用于判断是否修订旧记忆，不能证明本轮能力）',
        JSON.stringify(input.baseline, null, 2),
      ].join('\n\n'),
      output: Output.object({ schema: generatedSchema }),
      maxOutputTokens: 5_000,
      maxRetries: 0,
    });
    const raw = generated.output as z.infer<typeof generatedSchema>;
    const diagnosis = normalizeAttemptMemoryDiagnosis({
      raw,
      concept: input.problem.concept,
      attempts: input.attempts.map((attempt) => ({
        status: attempt.status,
        answer: attempt.answer,
        feedback: attempt.feedback,
        gradingSource: attempt.gradingSource,
        gradingReliable: attempt.gradingReliable,
      })),
      hasExistingDurableMemory: input.baseline.hasExistingDurableMemory,
    });

    return NextResponse.json({
      action: input.action,
      caseId: input.caseId,
      model: `openai:${modelId}`,
      diagnosis,
      usage: generated.usage,
      persistence: 'none',
    });
  });
}
