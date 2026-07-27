'use client';

import type { CoursePersonalizationContext } from '@/lib/generation/pipeline-types';
import { backendFetch } from '@/lib/utils/backend-api';
import { getApiHeaders } from './generation-headers';

export type NotebookMetadata = {
  name: string;
  description: string;
  tags: string[];
};

function extractTopicFromRequirement(requirement: string): string {
  const trimmed = requirement.trim();
  if (!trimmed) return '未命名笔记本';
  if (trimmed.length <= 28) return trimmed;
  return `${trimmed.substring(0, 28).trim()}...`;
}

function buildFallbackNotebookMetadata(
  requirement: string,
  language: 'zh-CN' | 'en-US',
  courseContext?: CoursePersonalizationContext,
): NotebookMetadata {
  const name = extractTopicFromRequirement(requirement);
  const normalized = requirement.replace(/[，。、“”‘’！？;；,.!?()[\]{}<>]/g, ' ');
  const words = normalized
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
  const unique = Array.from(new Set(words)).slice(0, 5);
  const defaultTags =
    language === 'en-US' ? ['learning', 'notebook', 'ai-generated'] : ['学习', '笔记本', 'AI生成'];
  const tags = Array.from(
    new Set([...(courseContext?.tags || []), ...(unique.length > 0 ? unique : defaultTags)]),
  ).slice(0, 8);
  const description =
    language === 'en-US'
      ? `Includes: ${name}. Not included: Deep dives beyond the current requirement or unrelated topics.`
      : `包含：${name}相关核心内容与关键知识点。不包含：超出当前需求范围的深度延展或无关主题。`;
  return { name, description, tags };
}

export async function generateNotebookMetadata(args: {
  requirement: string;
  language: 'zh-CN' | 'en-US';
  webSearch: boolean;
  courseContext?: CoursePersonalizationContext;
  signal?: AbortSignal;
  pdfText?: string;
  getHeaders?: () => HeadersInit;
}): Promise<NotebookMetadata> {
  const resp = await backendFetch('/api/generate/notebook-metadata', {
    method: 'POST',
    headers: (args.getHeaders ?? (() => getApiHeaders()))(),
    body: JSON.stringify({
      requirements: {
        requirement: args.requirement,
        language: args.language,
        webSearch: args.webSearch,
      },
      pdfText: args.pdfText || '',
      courseContext: args.courseContext,
    }),
    signal: args.signal,
  });

  if (!resp.ok) {
    return buildFallbackNotebookMetadata(args.requirement, args.language, args.courseContext);
  }

  const data = await resp.json();
  if (!data?.success || !data?.name || !data?.description) {
    return buildFallbackNotebookMetadata(args.requirement, args.language, args.courseContext);
  }

  return {
    name: String(data.name),
    description: String(data.description),
    tags: Array.isArray(data.tags) ? data.tags.map((x: unknown) => String(x)).slice(0, 8) : [],
  };
}
