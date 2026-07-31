import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { safeRoute } from '@/lib/server/json-error-response';
import { proxyFetch } from '@/lib/server/proxy-fetch';
import { normalizeQuestionMemoryDiagnosis } from '@/features/memory/domain/learner-memory-update';

export const runtime = 'nodejs';

const SOURCE_FILENAMES = [
  '1_The_Python_Memory_Model.md',
  '2_Testing_Your_code.md',
  '3_OOP.md',
  '4_ADT.md',
  '5_Exception.md',
  '6_Linked_List.md',
  '7_Recursion.md',
  '8_trees.md',
] as const;

const requestSchema = z.object({
  action: z.literal('diagnose_question'),
  caseId: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{1,100}$/i),
  question: z.string().trim().min(1).max(12_000),
  source: z
    .object({
      filename: z.enum(SOURCE_FILENAMES),
      title: z.string().trim().min(1).max(300),
    })
    .nullable(),
  baseline: z.object({
    userId: z
      .string()
      .trim()
      .regex(/^memory-test-[a-z0-9_-]{1,80}$/i),
    name: z.string().trim().min(1).max(120),
    level: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(2_000),
    mastered: z.array(z.string().trim().min(1).max(500)).max(30),
    weaknesses: z.array(z.string().trim().min(1).max(500)).max(30),
  }),
  conversation: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4_000),
      }),
    )
    .max(8)
    .optional(),
  resolvedConversationTopic: z.string().trim().min(1).max(300).nullable().optional(),
});

const diagnosisSchema = z.object({
  assistantReply: z.string().trim().min(1).max(8_000),
  diagnosis: z.object({
    category: z.enum([
      'definition',
      'clarification',
      'pasted_problem',
      'code_review',
      'error_debug',
      'outside_course',
    ]),
    courseRelevant: z.boolean(),
    knowledgePoint: z.string().trim().min(1).max(300),
    masteredSignal: z.string().trim().min(1).max(1_000).nullable(),
    stuckPoint: z.string().trim().min(1).max(1_000).nullable(),
    cause: z.string().trim().min(1).max(1_000).nullable(),
    nextTeachingMove: z.string().trim().min(1).max(1_000),
    confidence: z.enum(['low', 'medium', 'high']),
    evidenceFromMessage: z.array(z.string().trim().min(1).max(500)).max(8),
    workingMemoryAction: z.enum(['update', 'skip']),
    durableMemoryAction: z.enum(['create', 'revise', 'skip']),
    durableMemoryReason: z.string().trim().min(1).max(1_200),
  }),
});

type SourceSection = { title: string; content: string; score: number };

function resolveEnvironmentModel(request: NextRequest): string {
  const configuredDefault = process.env.DEFAULT_MODEL?.trim() || 'gpt-5.6-terra';
  const requested = request.headers.get('x-model')?.trim();
  if (!requested) return configuredDefault;

  const match = requested.match(/^(?:openai[:/])?([a-z0-9][a-z0-9._-]{0,100})$/i);
  return match?.[1] || configuredDefault;
}

function questionTokens(question: string) {
  const tokens = Array.from(
    new Set(
      (question.toLowerCase().match(/[a-z_][a-z0-9_]{1,}|[\p{Script=Han}]{2,}/giu) || [])
        .filter((token) => token.length >= 2)
        .slice(0, 80),
    ),
  );
  const normalized = question.toLowerCase();
  if (/\bri\b|representation invariant/i.test(question)) {
    tokens.push('representation', 'invariant', 'invariants');
  }
  if (/\bqueue\b|\badt\b/i.test(question)) {
    tokens.push('queue', 'fifo', 'stack', 'abstract data type');
  }
  if (/\bbst\b|binary search tree/i.test(question)) {
    tokens.push('binary search tree', 'bst', 'ordering invariant');
  }
  if (/traceback|except|exception|\btry\b/i.test(question)) {
    tokens.push('exception', 'exceptions', 'except', 'handler');
  }
  if (normalized.includes('class') || normalized.includes('python_ta')) {
    tokens.push('class design recipe', 'representation invariants', 'python_ta');
  }
  return Array.from(new Set(tokens));
}

function sourceSections(source: string, question: string) {
  const tokens = questionTokens(question);
  const chunks = source.split(/(?=^#{1,3}\s+)/gm).filter((chunk) => chunk.trim());
  const ranked: SourceSection[] = chunks.map((chunk, index) => {
    const firstLine = chunk
      .split('\n', 1)[0]
      ?.replace(/^#{1,3}\s+/, '')
      .trim();
    const normalized = chunk.toLowerCase();
    const score = tokens.reduce((total, token) => {
      const occurrences = normalized.split(token).length - 1;
      return total + Math.min(occurrences, 4);
    }, 0);
    return {
      title: firstLine || `资料片段 ${index + 1}`,
      content: chunk.trim(),
      score,
    };
  });
  const matching = ranked.filter((section) => section.score > 0).sort((a, b) => b.score - a.score);
  const selected = (matching.length ? matching : ranked).slice(0, 5);
  let remaining = 48_000;
  return selected
    .map((section) => {
      const content = section.content.slice(0, remaining);
      remaining -= content.length;
      return { ...section, content };
    })
    .filter((section) => section.content.length > 0);
}

export async function POST(request: NextRequest) {
  return safeRoute(async () => {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: '本地提问诊断测试请求无效。', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: '未配置 OPENAI_API_KEY，无法执行本地提问诊断测试。' },
        { status: 503 },
      );
    }

    const input = parsed.data;
    let matchedSections: SourceSection[] = [];
    if (input.source) {
      const sourceRoot = path.resolve(process.cwd(), 'queue', 'CSC148');
      const sourcePath = path.resolve(sourceRoot, input.source.filename);
      if (!sourcePath.startsWith(`${sourceRoot}${path.sep}`)) {
        return NextResponse.json({ error: '非法的课程资料路径。' }, { status: 400 });
      }
      const content = await readFile(sourcePath, 'utf8');
      matchedSections = sourceSections(content, input.question);
    }

    const sourceContext = input.source
      ? matchedSections
          .map((section, index) => `### ${index + 1}. ${section.title}\n${section.content}`)
          .join('\n\n')
      : '本轮没有可确认的 CSC148 资料上下文。';
    const modelId = resolveEnvironmentModel(request);
    const openai = createOpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
      fetch: proxyFetch as typeof fetch,
    });
    const generated = await generateText({
      model: openai.chat(modelId),
      system: [
        '你是 CSC148 教学平台中负责回答学生提问并提取学习诊断的助手。',
        '学生通常只会说一句口语、粘贴题目、代码或 traceback；不要要求他们先改写成正式问题。',
        '课程资料来自本地 queue 文件，不能访问数据库，也不能编造资料中没有的老师要求。',
        'assistantReply 要先真正回应学生，再给最小下一步；代码和题目可使用 Markdown。',
        'assistantReply 与 diagnosis 中的所有自然语言字段都使用简体中文；课程术语和代码标识符可保留英文。',
        '回答中的代码、紧邻解释和结论必须互相一致；输出前检查每个示例没有引用未在示例中出现的属性或条件。',
        '诊断的目的不是保存聊天原文，而是帮助下一次教学知道学生会什么、不会什么、为什么、下一步怎么教。',
        '一次定义性提问或只粘贴题目通常只能更新 working memory，不能证明稳定长期薄弱。',
        '只有学生自己的代码、推理或错误信息提供了明确能力证据时，才考虑 create/revise durable memory。',
        '如果“这块没懂”等话没有指代对象，先追问，workingMemoryAction 和 durableMemoryAction 都设为 skip。',
        '如果问题不属于当前 CSC148 资料，说明边界，可给通用帮助，但不得污染 CSC148 学习记忆。',
        'masteredSignal 只能写消息中有证据支持的能力；没有证据就返回 null，不能用 baseline 推测本轮掌握。',
        'evidenceFromMessage 只逐字摘录学生本轮消息里能支持诊断的短片段，不要改写，也不要复制整道题或整段代码。',
        'assistantReply 和课程资料只能帮助回答，不能作为学生掌握或薄弱的证据。',
      ].join('\n'),
      prompt: [
        '## 沙盒 baseline 用户',
        JSON.stringify(input.baseline, null, 2),
        '## 最近对话（只用于消解“这块/这里”的指代，不可当成本轮能力证据）',
        input.conversation?.length ? JSON.stringify(input.conversation, null, 2) : '无',
        '## 已确认的当前指代主题',
        input.resolvedConversationTopic || '无',
        '## 学生本轮原话',
        input.question,
        '## 当前可用课程资料',
        input.source ? `${input.source.title} · ${input.source.filename}` : '无',
        sourceContext,
      ].join('\n\n'),
      output: Output.object({ schema: diagnosisSchema }),
      maxOutputTokens: 8_000,
      maxRetries: 0,
    });
    const output = generated.output as z.infer<typeof diagnosisSchema>;
    const diagnosis = normalizeQuestionMemoryDiagnosis({
      raw: output.diagnosis,
      studentMessage: input.question,
      hasCourseSource: Boolean(input.source),
      resolvedConversationTopic: input.resolvedConversationTopic,
    });

    return NextResponse.json({
      action: input.action,
      caseId: input.caseId,
      model: `openai:${modelId}`,
      source: {
        filename: input.source?.filename || null,
        title: input.source?.title || '无可确认的 CSC148 资料',
        matchedSections: matchedSections.map((section) => section.title),
      },
      assistantReply: output.assistantReply,
      diagnosis,
      usage: generated.usage,
      persistence: 'none',
    });
  });
}
