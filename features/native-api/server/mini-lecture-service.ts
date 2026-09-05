import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import {
  IMAGE_NOTEBOOK_CANVAS_HEIGHT,
  IMAGE_NOTEBOOK_CANVAS_WIDTH,
  type ImageNotebookFocusRegion,
  type ImageNotebookPromptComponentPlan,
  type ImageNotebookPromptRecoveryResult,
} from '@/lib/generation/image-notebook-quality';
import {
  NOTEBOOK_IMAGE2_MODEL_ID,
  NOTEBOOK_IMAGE2_PROVIDER_ID,
} from '@/lib/generation/notebook-page-content';
import type { CoursePersonalizationContext } from '@/lib/generation/pipeline-types';
import type { ImageGenerationResult } from '@/lib/media/types';
import type { Action } from '@/lib/types/action';
import type { SceneOutline } from '@/lib/types/generation';
import type { Scene } from '@/lib/types/stage';
import {
  generateTTS,
  OPENAI_TTS_MODEL_ID,
  type TTSGenerationResult,
} from '@/lib/audio/tts-providers';
import { verbalizeNarrationText } from '@/lib/audio/spoken-text';
import {
  isTrustedInternalHeaders,
  markInternalRequestHeaders,
} from '@/lib/server/internal-request';
import { resolveTTSApiKey, resolveTTSBaseUrl } from '@/lib/server/provider-config';
import { resolveModelFromHeadersForNotebookStage } from '@/lib/server/resolve-model';
import { getSystemLLMRuntimeConfig } from '@/lib/server/system-llm-config';
import { POST as generateNotebookPageContentRoute } from '@/features/ppt-generation/server/notebook-page-content-route';
import { POST as generateSceneActionsRoute } from '@/features/ppt-generation/server/scene-actions-route';
import {
  NATIVE_MINI_LECTURE_MANIFEST_KIND,
  NATIVE_MINI_LECTURE_SCHEMA_VERSION,
  type NativeMiniLectureAction,
  type NativeMiniLectureAudioAsset,
  type NativeMiniLectureErrorCode,
  type NativeMiniLectureErrorStage,
  type NativeMiniLectureManifest,
  type NativeMiniLecturePage,
  type NativeMiniLectureRegion,
  type NativeMiniLectureRequest,
} from '@/features/native-api/domain/mini-lecture';

const OPENAI_TTS_PROVIDER_ID = 'openai-tts' as const;
const DEFAULT_MARKER_RECOVERY_ATTEMPTS = 3;
const DEFAULT_ACTION_GENERATION_ATTEMPTS = 2;
const TTS_CONCURRENCY = 3;
const MAX_SPEECH_SEGMENTS_PER_PAGE = 6;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_AUDIO_SEGMENT_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 64 * 1024 * 1024;
const IDEMPOTENCY_TTL_MS = 15 * 60 * 1_000;
const IDEMPOTENCY_CACHE_LIMIT = 4;
const REGION_DISPLAY_COLORS = ['#38bdf8', '#34d399', '#f59e0b', '#a78bfa', '#fb7185'];

type NativeMiniLectureRequestContext = {
  requestUrl: string;
  headers: Headers;
};

type NotebookContentBundle = {
  contents?: unknown[];
  effectiveOutlines?: SceneOutline[];
  allOutlinesForActions?: SceneOutline[];
  actionContextsByOutlineId?: Record<string, unknown>;
};

type NotebookPageRoutePayload = {
  success?: boolean;
  contentBundle?: NotebookContentBundle;
  image?: {
    imageUrl?: string;
    imageResult?: ImageGenerationResult;
    imagePrompt?: string;
    providerId?: string;
    modelId?: string;
  };
  errorCode?: string;
  error?: string;
};

type SceneActionsRoutePayload = {
  success?: boolean;
  scene?: Scene;
  previousSpeeches?: string[];
  fallbackUsed?: boolean;
  errorCode?: string;
  error?: string;
};

type PageGenerationInput = {
  context: NativeMiniLectureRequestContext;
  outline: SceneOutline;
  allOutlines: SceneOutline[];
  stageId: string;
  stageName: string;
  stageDescription: string;
  language: 'zh-CN' | 'en-US';
  courseId?: string;
  courseContext?: CoursePersonalizationContext;
};

type ActionGenerationInput = {
  context: NativeMiniLectureRequestContext;
  outline: SceneOutline;
  allOutlines: SceneOutline[];
  content: unknown;
  actionContext?: unknown;
  stageId: string;
  stageName: string;
  courseContext?: CoursePersonalizationContext;
  previousSpeeches: string[];
};

export type NativeMiniLectureServiceDependencies = {
  generatePage: (input: PageGenerationInput) => Promise<NotebookPageRoutePayload>;
  generateActions: (input: ActionGenerationInput) => Promise<SceneActionsRoutePayload>;
  synthesizeSpeech: (args: { text: string; voice: string }) => Promise<TTSGenerationResult>;
  resolveActionModel: (context: NativeMiniLectureRequestContext) => Promise<string>;
  now: () => Date;
};

type IdempotencyEntry = {
  requestHash: string;
  expiresAt: number;
  settled: boolean;
  promise: Promise<NativeMiniLectureManifest>;
};

type NativeMiniLectureGenerationResult = {
  manifest: NativeMiniLectureManifest;
  replayed: boolean;
};

const idempotencyCache = new Map<string, IdempotencyEntry>();

export class NativeMiniLectureServiceError extends Error {
  readonly code: NativeMiniLectureErrorCode;
  readonly stage: NativeMiniLectureErrorStage;
  readonly retryable: boolean;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(args: {
    code: NativeMiniLectureErrorCode;
    stage: NativeMiniLectureErrorStage;
    message: string;
    retryable: boolean;
    status: number;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(args.message, { cause: args.cause });
    this.name = 'NativeMiniLectureServiceError';
    this.code = args.code;
    this.stage = args.stage;
    this.retryable = args.retryable;
    this.status = args.status;
    this.details = args.details;
  }
}

function sha256Hex(value: string | Uint8Array): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (value === undefined) return '"__undefined__"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function compactText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/```[a-zA-Z0-9_-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .trim();
}

function sentenceChunks(value: string): string[] {
  const plain = stripMarkdown(value);
  const paragraphChunks = plain
    .split(/\n{2,}/)
    .map((item) => compactText(item, 520))
    .filter(Boolean);
  const chunks: string[] = [];
  for (const paragraph of paragraphChunks.length ? paragraphChunks : [plain]) {
    if (paragraph.length <= 260) {
      chunks.push(paragraph);
      continue;
    }
    const sentences = paragraph.match(/[^。！？.!?；;\n]+[。！？.!?；;]?/g) || [paragraph];
    let current = '';
    for (const sentence of sentences) {
      const candidate = `${current}${sentence}`.trim();
      if (candidate.length > 260 && current) {
        chunks.push(current);
        current = sentence.trim();
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks.filter(Boolean);
}

function ensureChunkCount(chunks: string[], count: number): string[] {
  const result = chunks.slice();
  while (result.length < count) {
    let longestIndex = -1;
    let longestLength = 0;
    for (let index = 0; index < result.length; index += 1) {
      if (result[index].length > longestLength) {
        longestIndex = index;
        longestLength = result[index].length;
      }
    }
    if (longestIndex < 0 || longestLength < 80) break;
    const value = result[longestIndex];
    const middle = Math.floor(value.length / 2);
    const splitAtCandidates = [
      value.lastIndexOf('，', middle),
      value.lastIndexOf(',', middle),
      value.lastIndexOf('；', middle),
      value.lastIndexOf(';', middle),
      value.lastIndexOf(' ', middle),
    ].filter((position) => position > 20);
    const splitAt = splitAtCandidates[0];
    if (splitAt === undefined) break;
    result.splice(
      longestIndex,
      1,
      value.slice(0, splitAt + 1).trim(),
      value.slice(splitAt + 1).trim(),
    );
  }
  return result.filter(Boolean);
}

function splitChunksIntoPages(chunks: string[], pageCount: 1 | 2, question: string): string[][] {
  if (pageCount === 1) return [chunks];
  const normalized = ensureChunkCount(chunks, 2);
  if (normalized.length <= 1) {
    const answerPage = normalized.length ? normalized : [compactText(question, 260)];
    return [[compactText(question, 260)], answerPage];
  }
  const totalLength = normalized.reduce((sum, item) => sum + item.length, 0);
  const target = totalLength / 2;
  let running = 0;
  let splitIndex = 1;
  for (let index = 0; index < normalized.length - 1; index += 1) {
    running += normalized[index].length;
    splitIndex = index + 1;
    if (running >= target) break;
  }
  return [normalized.slice(0, splitIndex), normalized.slice(splitIndex)];
}

function groupChunks(chunks: string[], groupCount: number): string[][] {
  const normalized = ensureChunkCount(chunks, groupCount);
  const groups = Array.from(
    { length: Math.min(groupCount, normalized.length) },
    () => [] as string[],
  );
  if (!groups.length) return [];
  normalized.forEach((chunk, index) => {
    const groupIndex = Math.min(
      groups.length - 1,
      Math.floor((index * groups.length) / normalized.length),
    );
    groups[groupIndex].push(chunk);
  });
  return groups.filter((group) => group.length > 0);
}

function extractFormulaLines(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(/\n+/))
    .map((value) => compactText(value, 220))
    .filter((value) => /[$=∫∑Σ√∞]|\b(?:lim|dx|dy|du|dt)\b|\\(?:frac|int|sum|lim)/i.test(value))
    .slice(0, 6);
}

function entityText(
  value: NativeMiniLectureRequest['message'] | NativeMiniLectureRequest['answer'],
) {
  return typeof value === 'string' ? value : value.text;
}

function entityId(
  value: NativeMiniLectureRequest['message'] | NativeMiniLectureRequest['answer'],
): string | undefined {
  return typeof value === 'string' ? undefined : value.id;
}

function courseDetails(course: NativeMiniLectureRequest['course']): {
  id?: string;
  name?: string;
  description?: string;
  subject?: string;
  courseCode?: string;
  purpose?: 'research' | 'university' | 'daily';
} {
  if (!course) return {};
  if (typeof course === 'string') return { name: course };
  return course;
}

function sourceDetails(source: NativeMiniLectureRequest['source']): {
  id?: string;
  title?: string;
  text?: string;
  referenceIds: string[];
} {
  if (!source) return { referenceIds: [] };
  if (typeof source === 'string') return { text: source, referenceIds: [] };
  return {
    id: source.id,
    title: source.title,
    text: [
      source.text,
      ...(source.references || []).flatMap((reference) => [reference.title, reference.excerpt]),
    ]
      .filter(Boolean)
      .join(' '),
    referenceIds: (source.references || []).flatMap((reference) =>
      reference.id ? [reference.id] : [],
    ),
  };
}

function answerTitle(input: NativeMiniLectureRequest): string {
  if (typeof input.answer !== 'string' && input.answer.title) return input.answer.title;
  const question = compactText(entityText(input.message), 90);
  return (
    question.replace(/[？?。.！!]$/, '') ||
    (input.language === 'zh-CN' ? '课堂讲解' : 'Mini lesson')
  );
}

function localizedPageTitle(
  baseTitle: string,
  pageIndex: number,
  pageCount: number,
  language: 'zh-CN' | 'en-US',
): string {
  if (pageCount === 1) return baseTitle;
  if (language === 'zh-CN') {
    return pageIndex === 0 ? `${baseTitle}：先建立判断` : `${baseTitle}：完成推理`;
  }
  return pageIndex === 0 ? `${baseTitle}: Build the idea` : `${baseTitle}: Complete the reasoning`;
}

function buildComponentPlans(args: {
  outlineId: string;
  question: string;
  chunks: string[];
  language: 'zh-CN' | 'en-US';
}): ImageNotebookPromptComponentPlan[] {
  const groups = groupChunks(args.chunks, 3);
  const labels =
    args.language === 'zh-CN'
      ? ['问题入口', '关键推理', '结论与检查']
      : ['Start with the question', 'Key reasoning', 'Conclusion and check'];
  const roles: ImageNotebookPromptComponentPlan['role'][] = [
    'setup',
    extractFormulaLines(args.chunks).length ? 'formula' : 'strategy',
    'takeaway',
  ];
  const slots: ImageNotebookPromptComponentPlan['layoutSlot'][] = [
    'middle-left',
    'middle-right',
    'bottom-full',
  ];
  const markerColors = [
    { name: 'red' as const, hex: '#ff0000' },
    { name: 'lime' as const, hex: '#00ff00' },
    { name: 'blue' as const, hex: '#0048ff' },
  ];

  return groups.map((group, index) => {
    const visibleText = group.map((item) => compactText(item, 190)).slice(0, 4);
    if (index === 0) visibleText.unshift(compactText(args.question, 180));
    const formulas = extractFormulaLines(group);
    return {
      id: `${args.outlineId}-${['opening', 'reasoning', 'takeaway'][index]}`,
      label: labels[index],
      role: roles[index],
      order: index + 1,
      layoutSlot: slots[index],
      markerColorName: markerColors[index].name,
      markerColorHex: markerColors[index].hex,
      visibleText: Array.from(new Set(visibleText)).slice(0, 4),
      formulas,
      diagramPrompt:
        args.language === 'zh-CN'
          ? '用清楚的手绘图、箭头或分步公式帮助学生看见这一部分的逻辑；普通内容只用黑灰色。'
          : 'Use a clear hand-drawn diagram, arrows, or stepped formulas to show this part of the reasoning; keep ordinary content in black and gray.',
      participatesInMask: true,
    };
  });
}

export function buildNativeMiniLectureOutlines(args: {
  input: NativeMiniLectureRequest;
  lectureId: string;
}): SceneOutline[] {
  const answer = entityText(args.input.answer);
  const question = entityText(args.input.message);
  const chunks = ensureChunkCount(sentenceChunks(answer), args.input.pageCount);
  const pageChunks = splitChunksIntoPages(chunks, args.input.pageCount, question);
  const baseTitle = answerTitle(args.input);
  const source = sourceDetails(args.input.source);

  return pageChunks.map((pageItems, pageIndex) => {
    const resolvedPageItems = pageItems.length ? pageItems : [answer];
    const outlineId = `${args.lectureId}-page-${pageIndex + 1}`;
    const title = localizedPageTitle(baseTitle, pageIndex, pageChunks.length, args.input.language);
    const componentPlans = buildComponentPlans({
      outlineId,
      question,
      chunks: resolvedPageItems,
      language: args.input.language,
    });
    const formulas = extractFormulaLines(resolvedPageItems);
    const keyPoints = resolvedPageItems.map((item) => compactText(item, 220)).slice(0, 6);
    const description = compactText(
      [
        resolvedPageItems.join(' '),
        source.text
          ? args.input.language === 'zh-CN'
            ? `来源依据：${source.text}`
            : `Source grounding: ${source.text}`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      520,
    );
    const isLastPage = pageIndex === pageChunks.length - 1;
    const isSinglePage = pageChunks.length === 1;

    return {
      id: outlineId,
      type: 'slide',
      archetype: !isSinglePage && isLastPage ? 'summary' : 'concept',
      title,
      description,
      keyPoints,
      teachingObjective: description,
      studentThinkingMove:
        args.input.language === 'zh-CN'
          ? '先看清题目中的判断，再沿关键依据走到结论。'
          : 'Identify the decision in the question, then follow the evidence to the conclusion.',
      sourceFactIds: source.referenceIds,
      estimatedDuration: Math.max(90, componentPlans.length * 55),
      order: pageIndex + 1,
      language: args.input.language,
      imageNotebookBrief: {
        outlineId,
        pageNumber: pageIndex + 1,
        pageRole: !isSinglePage && isLastPage ? 'summary' : 'strategy',
        title,
        pageMove: {
          fromPrevious:
            pageIndex > 0
              ? args.input.language === 'zh-CN'
                ? '承接上一页已经建立的判断。'
                : 'Continue from the decision established on the previous page.'
              : undefined,
          currentJob: description,
          toNext: isLastPage
            ? args.input.language === 'zh-CN'
              ? '把这一页的判断迁移回原问题，并能独立复述原因。'
              : 'Apply this decision back to the original question and explain why.'
            : args.input.language === 'zh-CN'
              ? '带着这个判断进入下一页，完成推理。'
              : 'Carry this decision into the next page and complete the reasoning.',
        },
        visualBrief:
          args.input.language === 'zh-CN'
            ? '一张完整的手绘课堂笔记图。白色方格纸铺满画布，简体中文与公式清楚，绝不画成网页组件、卡片或 SVG。'
            : 'A complete hand-drawn classroom notebook image on full-bleed white graph paper, with readable English and formulas; never render UI cards, components, or SVG.',
        visibleContent: {
          mustShow: componentPlans.flatMap((component) => component.visibleText).slice(0, 12),
          formulas,
          exampleSteps: keyPoints.slice(0, 5),
          commonPitfalls: [],
          bottomTakeaway: keyPoints.at(-1) || description,
        },
        focusRegions: [],
        componentPlans,
        generationNotes:
          args.input.language === 'zh-CN'
            ? [
                '学生可见文字必须使用简体中文。',
                '公式必须保持标准数学记号与原回答一致。',
                '每段讲解必须落在对应四角 marker 恢复出的语义区域内。',
              ]
            : [
                'All student-visible text must use English.',
                'Keep formulas faithful to the supplied answer.',
                'Each narration segment must map to a recovered semantic region.',
              ],
        qaChecklist: [
          'Each semantic region has exactly four isolated pure-color corner markers.',
          'Ordinary content does not use reserved marker colors.',
          'Recovered regions do not overlap and all text remains readable.',
        ],
      },
    };
  });
}

function forwardHeaders(context: NativeMiniLectureRequestContext): Headers {
  const headers = new Headers();
  const trusted = isTrustedInternalHeaders(context.headers);
  headers.set('Content-Type', 'application/json');
  const forwardedNames = trusted
    ? [
        'authorization',
        'cookie',
        'x-user-id',
        'x-user-email',
        'x-user-name',
        'x-request-id',
        'x-notebook-generation-session-id',
        'x-notebook-generation-task-id',
      ]
    : ['authorization', 'cookie', 'x-request-id'];

  for (const name of forwardedNames) {
    const value = context.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (trusted) markInternalRequestHeaders(headers);
  return headers;
}

async function parseRouteResponse<T extends { success?: boolean; error?: string }>(
  response: Response,
  route: string,
): Promise<T> {
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || !payload?.success) {
    throw new NativeMiniLectureServiceError({
      code: route.includes('scene-actions')
        ? 'ACTION_GENERATION_FAILED'
        : 'IMAGE_GENERATION_FAILED',
      stage: route.includes('scene-actions') ? 'actions' : 'image',
      message: payload?.error || `${route} failed with HTTP ${response.status}`,
      retryable: response.status >= 408 || response.status === 429,
      status: response.status >= 400 ? response.status : 502,
      details: {
        route,
        upstreamStatus: response.status,
      },
    });
  }
  return payload;
}

async function defaultGeneratePage(input: PageGenerationInput): Promise<NotebookPageRoutePayload> {
  const request = new NextRequest(
    new URL('/api/generate/notebook-page-content', input.context.requestUrl),
    {
      method: 'POST',
      headers: forwardHeaders(input.context),
      body: JSON.stringify({
        outline: input.outline,
        allOutlines: input.allOutlines,
        stageInfo: {
          id: input.stageId,
          name: input.stageName,
          description: input.stageDescription,
          language: input.language,
          courseId: input.courseId,
          style:
            input.language === 'zh-CN'
              ? '全幅白色方格纸、自然的大学课堂手写笔记、黑色和石墨灰墨迹、克制的暖灰装饰；不要网页 UI、不要演示文稿模板。'
              : 'Full-bleed white graph paper, natural university classroom handwriting, black and graphite ink, restrained warm-gray decoration; no web UI or presentation template.',
          imageNotebookStyle: {
            schemaVersion: 1,
            preset: 'hand-drawn-course-notebook',
            canvas: '16:9',
            background:
              input.language === 'zh-CN'
                ? '全幅白色方格纸，淡灰网格触及四边'
                : 'full-bleed white graph paper with a faint gray grid touching all edges',
            writingStyle:
              input.language === 'zh-CN'
                ? '自然但清楚的简体中文课堂手写体与标准数学公式'
                : 'natural, highly legible classroom handwriting and standard mathematical notation',
            colorMood:
              input.language === 'zh-CN'
                ? '黑色、石墨灰、浅暖灰；普通内容禁用 marker 纯色'
                : 'black, graphite, and light warm gray; reserved pure marker colors are forbidden in ordinary content',
            density: 'medium',
            decorationLevel: 'light',
            palette: {
              label: 'graphite notebook',
              colors: ['#111111', '#4b4b4b', '#d6d3d1', '#f5f5f4'],
            },
            userStylePrompt:
              input.language === 'zh-CN'
                ? '像大学老师边讲边画的一页精致课堂笔记，而不是前端组件。'
                : 'A polished notebook page drawn live by a university instructor, not a frontend component.',
            avoidPureMarkerColors: [
              '#ff0000',
              '#00ff00',
              '#0048ff',
              '#00ffff',
              '#ff00ff',
              '#ffff00',
            ],
            ordinaryContentColorRule:
              input.language === 'zh-CN'
                ? '普通内容只用黑、灰和暖灰；纯色仅供四角 marker。'
                : 'Use black, gray, and warm gray for ordinary content; pure colors are reserved for corner markers.',
          },
        },
        courseContext: input.courseContext,
        slideGenerationRoute: 'image-ppt',
        imageNotebookMaxAttempts: 1,
        includeActions: false,
      }),
    },
  );
  return parseRouteResponse<NotebookPageRoutePayload>(
    await generateNotebookPageContentRoute(request),
    '/api/generate/notebook-page-content',
  );
}

async function defaultGenerateActions(
  input: ActionGenerationInput,
): Promise<SceneActionsRoutePayload> {
  const request = new NextRequest(
    new URL('/api/generate/scene-actions', input.context.requestUrl),
    {
      method: 'POST',
      headers: forwardHeaders(input.context),
      body: JSON.stringify({
        outline: input.outline,
        allOutlines: input.allOutlines,
        content: input.content,
        actionContext: input.actionContext,
        stageId: input.stageId,
        notebookName: input.stageName,
        agents: [],
        previousSpeeches: input.previousSpeeches,
        courseContext: input.courseContext,
      }),
    },
  );
  return parseRouteResponse<SceneActionsRoutePayload>(
    await generateSceneActionsRoute(request),
    '/api/generate/scene-actions',
  );
}

async function defaultSynthesizeSpeech(args: {
  text: string;
  voice: string;
}): Promise<TTSGenerationResult> {
  const systemOpenAI = await getSystemLLMRuntimeConfig();
  const apiKey = systemOpenAI.apiKey || resolveTTSApiKey(OPENAI_TTS_PROVIDER_ID);
  if (!apiKey) {
    throw new NativeMiniLectureServiceError({
      code: 'MISSING_PROVIDER_CONFIGURATION',
      stage: 'tts',
      message: 'OpenAI TTS is not configured on the server.',
      retryable: false,
      status: 503,
      details: { provider: OPENAI_TTS_PROVIDER_ID },
    });
  }
  return generateTTS(
    {
      providerId: OPENAI_TTS_PROVIDER_ID,
      apiKey,
      baseUrl: systemOpenAI.baseUrl || resolveTTSBaseUrl(OPENAI_TTS_PROVIDER_ID),
      voice: args.voice,
      speed: 1,
      format: 'mp3',
    },
    verbalizeNarrationText(args.text),
    { analyzeMouthCues: false },
  );
}

async function defaultResolveActionModel(
  context: NativeMiniLectureRequestContext,
): Promise<string> {
  const request = new NextRequest(new URL('/api/generate/scene-actions', context.requestUrl), {
    headers: forwardHeaders(context),
  });
  const resolved = await resolveModelFromHeadersForNotebookStage(request, 'actions', {
    allowOpenAIModelOverride: true,
  });
  return resolved.modelString;
}

export const nativeMiniLectureDependencies: NativeMiniLectureServiceDependencies = {
  generatePage: defaultGeneratePage,
  generateActions: defaultGenerateActions,
  synthesizeSpeech: defaultSynthesizeSpeech,
  resolveActionModel: defaultResolveActionModel,
  now: () => new Date(),
};

function focusRegionsHaveSaneGeometry(
  focusRegions: ImageNotebookFocusRegion[],
  expectedComponentIds: Set<string>,
): boolean {
  const regionIds = new Set(focusRegions.map((region) => region.id));
  if (
    regionIds.size !== focusRegions.length ||
    regionIds.size !== expectedComponentIds.size ||
    [...expectedComponentIds].some((id) => !regionIds.has(id))
  ) {
    return false;
  }

  for (const region of focusRegions) {
    const coordinates = [region.left, region.top, region.width, region.height];
    if (
      coordinates.some((value) => !Number.isFinite(value)) ||
      region.left < 0 ||
      region.top < 0 ||
      region.width < 16 ||
      region.height < 16 ||
      region.left + region.width > IMAGE_NOTEBOOK_CANVAS_WIDTH + 0.5 ||
      region.top + region.height > IMAGE_NOTEBOOK_CANVAS_HEIGHT + 0.5
    ) {
      return false;
    }
  }

  for (let leftIndex = 0; leftIndex < focusRegions.length; leftIndex += 1) {
    const left = focusRegions[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < focusRegions.length; rightIndex += 1) {
      const right = focusRegions[rightIndex];
      const intersectionWidth = Math.max(
        0,
        Math.min(left.left + left.width, right.left + right.width) -
          Math.max(left.left, right.left),
      );
      const intersectionHeight = Math.max(
        0,
        Math.min(left.top + left.height, right.top + right.height) - Math.max(left.top, right.top),
      );
      const smallerArea = Math.min(left.width * left.height, right.width * right.height);
      if (smallerArea > 0 && (intersectionWidth * intersectionHeight) / smallerArea > 0.4) {
        return false;
      }
    }
  }
  return true;
}

function strictRecovery(payload: NotebookPageRoutePayload): {
  outline: SceneOutline;
  content: unknown;
  allOutlinesForActions: SceneOutline[];
  actionContext?: unknown;
  recovery: ImageNotebookPromptRecoveryResult;
  focusRegions: ImageNotebookFocusRegion[];
  imageResult: ImageGenerationResult;
  imageProvider: string;
  imageModel: string;
  promptHash?: string;
} | null {
  const bundle = payload.contentBundle;
  const outline = bundle?.effectiveOutlines?.[0];
  const content = bundle?.contents?.[0];
  const recovery = outline?.imageNotebookPromptPlan?.recoveryResult;
  const focusRegions = outline?.imageNotebookBrief?.focusRegions || [];
  const expectedComponents = (outline?.imageNotebookPromptPlan?.componentPlans || []).filter(
    (component) => component.participatesInMask,
  );
  const expectedComponentIds = new Set(expectedComponents.map((component) => component.id));
  const recoveredComponents = recovery?.components || [];
  const strictComponentsPass =
    recoveredComponents.length === expectedComponents.length &&
    recoveredComponents.every(
      (component) =>
        expectedComponentIds.has(component.componentId) &&
        component.markerCount === 4 &&
        Array.isArray(component.bbox) &&
        component.bbox.length === 4,
    );
  if (
    !outline ||
    !content ||
    recovery?.status !== 'passed' ||
    focusRegions.length !== expectedComponents.length ||
    !strictComponentsPass ||
    !focusRegionsHaveSaneGeometry(focusRegions, expectedComponentIds) ||
    !payload.image?.imageResult ||
    payload.image.providerId !== NOTEBOOK_IMAGE2_PROVIDER_ID ||
    payload.image.modelId !== NOTEBOOK_IMAGE2_MODEL_ID
  ) {
    return null;
  }
  return {
    outline,
    content,
    allOutlinesForActions: bundle?.allOutlinesForActions || [outline],
    actionContext: bundle?.actionContextsByOutlineId?.[outline.id],
    recovery,
    focusRegions,
    imageResult: payload.image.imageResult,
    imageProvider: payload.image.providerId,
    imageModel: payload.image.modelId,
    promptHash: outline.imageNotebookPromptPlan?.promptHash,
  };
}

function imageBuffer(result: ImageGenerationResult): Buffer {
  const value = result.base64 || '';
  const dataUrl = /^data:([^;,]+);base64,([\s\S]+)$/.exec(value);
  const mimeType = dataUrl?.[1] || 'image/png';
  if (mimeType === 'image/svg+xml' || /<svg[\s>]/i.test(value.slice(0, 500))) {
    throw new NativeMiniLectureServiceError({
      code: 'IMAGE_GENERATION_FAILED',
      stage: 'image',
      message: 'The image classroom pipeline returned SVG instead of a generated PNG.',
      retryable: true,
      status: 502,
    });
  }
  const buffer = Buffer.from(dataUrl?.[2] || value, 'base64');
  const pngSignature = buffer.subarray(0, 8).toString('hex');
  if (buffer.length === 0 || pngSignature !== '89504e470d0a1a0a') {
    throw new NativeMiniLectureServiceError({
      code: 'IMAGE_GENERATION_FAILED',
      stage: 'image',
      message: 'The generated classroom page is not a valid PNG image.',
      retryable: true,
      status: 502,
    });
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new NativeMiniLectureServiceError({
      code: 'IMAGE_GENERATION_FAILED',
      stage: 'image',
      message: 'The generated classroom PNG exceeds the 16 MB per-page limit.',
      retryable: true,
      status: 502,
      details: { bytes: buffer.length, maxBytes: MAX_IMAGE_BYTES },
    });
  }
  return buffer;
}

function normalizedRegions(args: {
  outline: SceneOutline;
  focusRegions: ImageNotebookFocusRegion[];
}): NativeMiniLectureRegion[] {
  const components = new Map(
    (args.outline.imageNotebookPromptPlan?.componentPlans || []).map((component) => [
      component.id,
      component,
    ]),
  );
  return args.focusRegions
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((region, index) => {
      const component = components.get(region.id);
      return {
        id: region.id,
        semanticId: region.id.startsWith(`${args.outline.id}-`)
          ? region.id.slice(args.outline.id.length + 1)
          : region.id,
        label: component?.label || region.label,
        order: index + 1,
        role: region.role,
        color: REGION_DISPLAY_COLORS[index] || REGION_DISPLAY_COLORS[0],
        bbox: [region.left, region.top, region.width, region.height],
      };
    });
}

type PendingSpeechAction = Omit<Extract<NativeMiniLectureAction, { type: 'speech' }>, 'audio'> & {
  sourceText: string;
};

type PendingPage = Omit<NativeMiniLecturePage, 'actions'> & {
  actions: Array<NativeMiniLectureAction | PendingSpeechAction>;
};

function normalizeSceneActions(args: {
  pageId: string;
  actions: Action[];
  regions: NativeMiniLectureRegion[];
}): Array<NativeMiniLectureSpotlightActionDraft | PendingSpeechAction> {
  const regionById = new Map(args.regions.map((region) => [region.id, region]));
  const normalized: Array<NativeMiniLectureSpotlightActionDraft | PendingSpeechAction> = [];
  let currentRegionId = args.regions[0]?.id;
  let spotlightIndex = 0;
  let speechIndex = 0;

  for (const action of args.actions) {
    if (action.type === 'spotlight' || action.type === 'laser') {
      if (!regionById.has(action.elementId)) continue;
      currentRegionId = action.elementId;
      spotlightIndex += 1;
      const region = regionById.get(action.elementId)!;
      normalized.push({
        id: `${args.pageId}-spotlight-${spotlightIndex}`,
        type: 'spotlight',
        regionId: region.id,
        title: action.title || region.label,
        dimOpacity: action.type === 'spotlight' ? (action.dimOpacity ?? 0.76) : 0.76,
      });
      continue;
    }
    if (action.type !== 'speech' || !currentRegionId || !regionById.has(currentRegionId)) continue;
    speechIndex += 1;
    const region = regionById.get(currentRegionId)!;
    normalized.push({
      id: `${args.pageId}-speech-${speechIndex}`,
      type: 'speech',
      regionId: region.id,
      title: action.title || region.label,
      text: action.text,
      sourceText: action.text,
    });
  }
  return normalized;
}

type NativeMiniLectureSpotlightActionDraft = Extract<
  NativeMiniLectureAction,
  { type: 'spotlight' }
>;

function limitSpeechSegments(
  actions: Array<NativeMiniLectureSpotlightActionDraft | PendingSpeechAction>,
  regions: NativeMiniLectureRegion[],
): Array<NativeMiniLectureSpotlightActionDraft | PendingSpeechAction> {
  if (regions.length === 0) return actions;
  const baseLimit = Math.max(1, Math.floor(MAX_SPEECH_SEGMENTS_PER_PAGE / regions.length));
  let remaining = Math.max(0, MAX_SPEECH_SEGMENTS_PER_PAGE - baseLimit * regions.length);
  const limits = new Map(
    regions.map((region) => {
      const limit = baseLimit + (remaining > 0 ? 1 : 0);
      remaining = Math.max(0, remaining - 1);
      return [region.id, limit];
    }),
  );
  const counts = new Map<string, number>();
  return actions.filter((action) => {
    if (action.type !== 'speech') return true;
    const count = counts.get(action.regionId) || 0;
    const limit = limits.get(action.regionId) || 1;
    if (count >= limit) return false;
    counts.set(action.regionId, count + 1);
    return true;
  });
}

function actionQualityIssues(
  actions: Array<NativeMiniLectureSpotlightActionDraft | PendingSpeechAction>,
  regions: NativeMiniLectureRegion[],
): string[] {
  const issues: string[] = [];
  const focused = new Set(
    actions.filter((action) => action.type === 'spotlight').map((action) => action.regionId),
  );
  const narrated = new Set(
    actions.filter((action) => action.type === 'speech').map((action) => action.regionId),
  );
  if (!actions.some((action) => action.type === 'speech')) {
    issues.push('No speech actions were generated.');
  }
  for (const region of regions) {
    if (!focused.has(region.id)) issues.push(`Region ${region.id} has no spotlight action.`);
    if (!narrated.has(region.id)) issues.push(`Region ${region.id} has no speech action.`);
  }
  return issues;
}

function completeActionCoverage(args: {
  pageId: string;
  actions: Array<NativeMiniLectureSpotlightActionDraft | PendingSpeechAction>;
  regions: NativeMiniLectureRegion[];
  outline: SceneOutline;
  language: 'zh-CN' | 'en-US';
}): Array<NativeMiniLectureSpotlightActionDraft | PendingSpeechAction> {
  const componentById = new Map(
    (args.outline.imageNotebookPromptPlan?.componentPlans || []).map((component) => [
      component.id,
      component,
    ]),
  );
  const result = [...args.actions];
  const focused = new Set(
    result.filter((action) => action.type === 'spotlight').map((action) => action.regionId),
  );
  const narrated = new Set(
    result.filter((action) => action.type === 'speech').map((action) => action.regionId),
  );
  let spotlightIndex = result.filter((action) => action.type === 'spotlight').length;
  let speechIndex = result.filter((action) => action.type === 'speech').length;

  for (const region of args.regions) {
    if (!focused.has(region.id)) {
      spotlightIndex += 1;
      result.push({
        id: `${args.pageId}-spotlight-${spotlightIndex}`,
        type: 'spotlight',
        regionId: region.id,
        title: region.label,
        dimOpacity: 0.76,
      });
    }
    if (!narrated.has(region.id)) {
      const component = componentById.get(region.id);
      const visibleText = (component?.visibleText || [])
        .map((text) => compactText(text, 180))
        .filter(Boolean)
        .join(args.language === 'zh-CN' ? '；' : '; ');
      const sourceText = compactText(
        visibleText ||
          (args.language === 'zh-CN'
            ? `现在看${region.label}。沿着图中的文字和箭头，把这一部分的依据与结论连起来。`
            : `Now focus on ${region.label}. Follow the text and arrows to connect the evidence to the conclusion.`),
        520,
      );
      speechIndex += 1;
      result.push({
        id: `${args.pageId}-speech-${speechIndex}`,
        type: 'speech',
        regionId: region.id,
        title: region.label,
        text: sourceText,
        sourceText,
      });
    }
  }

  return limitSpeechSegments(result, args.regions);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function pruneIdempotencyCache(now: number) {
  for (const [key, entry] of idempotencyCache) {
    if (entry.settled && entry.expiresAt <= now) idempotencyCache.delete(key);
  }
}

function makeIdempotencyCacheKey(
  context: NativeMiniLectureRequestContext,
  idempotencyKey: string,
): string {
  const identity =
    (isTrustedInternalHeaders(context.headers) ? context.headers.get('x-user-id')?.trim() : '') ||
    context.headers.get('authorization')?.trim() ||
    context.headers.get('cookie')?.trim() ||
    `anonymous:${new URL(context.requestUrl).origin}`;
  return `${sha256Hex(identity).slice(0, 24)}:${idempotencyKey}`;
}

function reserveIdempotencyCapacity() {
  while (idempotencyCache.size >= IDEMPOTENCY_CACHE_LIMIT) {
    const oldestSettled = Array.from(idempotencyCache.entries()).find(([, entry]) => entry.settled);
    if (!oldestSettled) break;
    idempotencyCache.delete(oldestSettled[0]);
  }
}

function contentHashForManifest(
  manifest: Omit<NativeMiniLectureManifest, 'contentHash' | 'contentVersion'>,
) {
  return sha256Hex(
    stableJson({
      schemaVersion: manifest.schemaVersion,
      kind: manifest.kind,
      lectureId: manifest.lectureId,
      requestHash: manifest.requestHash,
      title: manifest.title,
      language: manifest.language,
      source: manifest.source,
      generator: manifest.generator,
      pages: manifest.pages.map((page) => ({
        id: page.id,
        order: page.order,
        title: page.title,
        width: page.width,
        height: page.height,
        image: {
          provider: page.image.provider,
          model: page.image.model,
          sha256: page.image.sha256,
          bytes: page.image.bytes,
          pixelWidth: page.image.pixelWidth,
          pixelHeight: page.image.pixelHeight,
          promptHash: page.image.promptHash,
        },
        recovery: page.recovery,
        regions: page.regions,
        actions: page.actions.map((action) =>
          action.type === 'spotlight'
            ? action
            : {
                ...action,
                audio: {
                  provider: action.audio.provider,
                  model: action.audio.model,
                  voice: action.audio.voice,
                  speed: action.audio.speed,
                  mimeType: action.audio.mimeType,
                  sha256: action.audio.sha256,
                  bytes: action.audio.bytes,
                },
              },
        ),
      })),
    }),
  );
}

function asServiceError(
  error: unknown,
  fallback: {
    code: NativeMiniLectureErrorCode;
    stage: NativeMiniLectureErrorStage;
    message: string;
  },
): NativeMiniLectureServiceError {
  if (error instanceof NativeMiniLectureServiceError) return error;
  return new NativeMiniLectureServiceError({
    ...fallback,
    message: error instanceof Error ? error.message : fallback.message,
    retryable: true,
    status: 502,
    cause: error,
  });
}

async function generateManifest(args: {
  context: NativeMiniLectureRequestContext;
  input: NativeMiniLectureRequest & { idempotencyKey: string };
  requestHash: string;
  lectureId: string;
  dependencies: NativeMiniLectureServiceDependencies;
}): Promise<NativeMiniLectureManifest> {
  const course = courseDetails(args.input.course);
  const source = sourceDetails(args.input.source);
  const title = answerTitle(args.input);
  const sourceContext = compactText(
    [source.title, source.text, course.description].filter(Boolean).join(' '),
    1_200,
  );
  const stageName = course.name ? `${course.name} · ${title}` : title;
  const stageDescription = compactText(
    [entityText(args.input.answer), sourceContext].filter(Boolean).join(' '),
    1_500,
  );
  const courseContext: CoursePersonalizationContext | undefined = course.name
    ? {
        name: course.name,
        description: course.description,
        purpose: course.purpose,
        courseCode: course.courseCode,
        language: args.input.language,
        tags: course.subject ? [course.subject] : undefined,
      }
    : undefined;
  const outlines = buildNativeMiniLectureOutlines({
    input: args.input,
    lectureId: args.lectureId,
  });

  let actionModel = 'openai:system-managed';
  try {
    actionModel = await args.dependencies.resolveActionModel(args.context);
  } catch {
    // The actions route remains the source of truth and will return a structured
    // generation error if the system model cannot actually be resolved.
  }

  const pendingPages: PendingPage[] = [];
  let previousSpeeches: string[] = [];

  for (let pageIndex = 0; pageIndex < outlines.length; pageIndex += 1) {
    const requestedOutline = outlines[pageIndex];
    let accepted: ReturnType<typeof strictRecovery> = null;
    let lastRecovery: ImageNotebookPromptRecoveryResult | undefined;

    for (let attempt = 1; attempt <= DEFAULT_MARKER_RECOVERY_ATTEMPTS; attempt += 1) {
      let payload: NotebookPageRoutePayload;
      try {
        payload = await args.dependencies.generatePage({
          context: args.context,
          outline: requestedOutline,
          allOutlines: outlines,
          stageId: args.lectureId,
          stageName,
          stageDescription,
          language: args.input.language,
          courseId: course.id,
          courseContext,
        });
      } catch (error) {
        throw asServiceError(error, {
          code: 'IMAGE_GENERATION_FAILED',
          stage: 'image',
          message: `Failed to generate mini-lecture page ${pageIndex + 1}.`,
        });
      }
      lastRecovery =
        payload.contentBundle?.effectiveOutlines?.[0]?.imageNotebookPromptPlan?.recoveryResult;
      accepted = strictRecovery(payload);
      if (accepted) break;
    }

    if (!accepted) {
      throw new NativeMiniLectureServiceError({
        code: 'MARKER_RECOVERY_FAILED',
        stage: 'marker-recovery',
        message: `Marker recovery did not pass for mini-lecture page ${pageIndex + 1}.`,
        retryable: true,
        status: 502,
        details: {
          page: pageIndex + 1,
          attempts: DEFAULT_MARKER_RECOVERY_ATTEMPTS,
          recoveryStatus: lastRecovery?.status || 'missing',
          findings: lastRecovery?.findings || [],
        },
      });
    }

    const regions = normalizedRegions({
      outline: accepted.outline,
      focusRegions: accepted.focusRegions,
    });
    let normalizedActions: Array<NativeMiniLectureSpotlightActionDraft | PendingSpeechAction> = [];
    let lastActionIssues: string[] = [];
    let acceptedActionPayload: SceneActionsRoutePayload | undefined;
    let lastActionPayload: SceneActionsRoutePayload | undefined;

    for (let attempt = 1; attempt <= DEFAULT_ACTION_GENERATION_ATTEMPTS; attempt += 1) {
      let actionPayload: SceneActionsRoutePayload;
      try {
        actionPayload = await args.dependencies.generateActions({
          context: args.context,
          outline: accepted.outline,
          allOutlines: accepted.allOutlinesForActions,
          content: accepted.content,
          actionContext: accepted.actionContext,
          stageId: args.lectureId,
          stageName,
          courseContext,
          previousSpeeches,
        });
      } catch (error) {
        throw asServiceError(error, {
          code: 'ACTION_GENERATION_FAILED',
          stage: 'actions',
          message: `Failed to generate actions for mini-lecture page ${pageIndex + 1}.`,
        });
      }
      lastActionPayload = actionPayload;
      const sceneActions = actionPayload.scene?.actions || [];
      normalizedActions = limitSpeechSegments(
        normalizeSceneActions({
          pageId: accepted.outline.id,
          actions: sceneActions,
          regions,
        }),
        regions,
      );
      lastActionIssues = actionQualityIssues(normalizedActions, regions);
      if (!actionPayload.fallbackUsed && lastActionIssues.length === 0) {
        acceptedActionPayload = actionPayload;
        break;
      }
    }

    if (!acceptedActionPayload) {
      normalizedActions = completeActionCoverage({
        pageId: accepted.outline.id,
        actions: normalizedActions,
        regions,
        outline: accepted.outline,
        language: args.input.language,
      });
      lastActionIssues = actionQualityIssues(normalizedActions, regions);
      if (lastActionPayload && lastActionIssues.length === 0) {
        acceptedActionPayload = lastActionPayload;
      }
    }

    if (!acceptedActionPayload) {
      throw new NativeMiniLectureServiceError({
        code: 'ACTION_GENERATION_FAILED',
        stage: 'actions',
        message: `Generated actions did not cover every recovered region on page ${pageIndex + 1}.`,
        retryable: true,
        status: 502,
        details: {
          page: pageIndex + 1,
          attempts: DEFAULT_ACTION_GENERATION_ATTEMPTS,
          issues: lastActionIssues,
        },
      });
    }
    previousSpeeches = acceptedActionPayload.previousSpeeches || previousSpeeches;

    const png = imageBuffer(accepted.imageResult);
    pendingPages.push({
      id: accepted.outline.id,
      order: pageIndex + 1,
      title: accepted.outline.title,
      width: IMAGE_NOTEBOOK_CANVAS_WIDTH,
      height: IMAGE_NOTEBOOK_CANVAS_HEIGHT,
      image: {
        delivery: 'inline-base64',
        mimeType: 'image/png',
        base64: png.toString('base64'),
        sha256: sha256Hex(png),
        bytes: png.length,
        pixelWidth: accepted.imageResult.width || 1792,
        pixelHeight: accepted.imageResult.height || 1008,
        provider: accepted.imageProvider,
        model: accepted.imageModel,
        promptHash: accepted.promptHash,
      },
      recovery: {
        status: 'passed',
        recoveredAt: accepted.recovery.recoveredAt,
        findings: accepted.recovery.findings || [],
        expectedRegionCount: regions.length,
        recoveredRegionCount: regions.length,
      },
      regions,
      actions: normalizedActions,
    });
  }

  const speechJobs = pendingPages.flatMap((page, pageIndex) =>
    page.actions.flatMap((action, actionIndex) =>
      action.type === 'speech' && 'sourceText' in action
        ? [{ pageIndex, actionIndex, action }]
        : [],
    ),
  );
  let speechAssets: NativeMiniLectureAudioAsset[];
  try {
    speechAssets = await mapWithConcurrency(speechJobs, TTS_CONCURRENCY, async ({ action }) => {
      const result = await args.dependencies.synthesizeSpeech({
        text: action.sourceText,
        voice: args.input.ttsVoice,
      });
      if (result.format !== 'mp3' || result.audio.length === 0) {
        throw new Error(`OpenAI TTS returned an unsupported audio format: ${result.format}`);
      }
      const audio = Buffer.from(result.audio);
      if (audio.length > MAX_AUDIO_SEGMENT_BYTES) {
        throw new Error(`OpenAI TTS segment exceeds the ${MAX_AUDIO_SEGMENT_BYTES} byte limit.`);
      }
      return {
        delivery: 'inline-base64',
        mimeType: 'audio/mpeg',
        format: 'mp3',
        base64: audio.toString('base64'),
        sha256: sha256Hex(audio),
        bytes: audio.length,
        provider: OPENAI_TTS_PROVIDER_ID,
        model: OPENAI_TTS_MODEL_ID,
        voice: args.input.ttsVoice,
        speed: 1,
      };
    });
  } catch (error) {
    throw asServiceError(error, {
      code: 'TTS_GENERATION_FAILED',
      stage: 'tts',
      message: 'Failed to generate OpenAI MP3 narration for the mini lecture.',
    });
  }

  const totalAssetBytes =
    pendingPages.reduce((total, page) => total + page.image.bytes, 0) +
    speechAssets.reduce((total, audio) => total + audio.bytes, 0);
  if (totalAssetBytes > MAX_TOTAL_ASSET_BYTES) {
    throw new NativeMiniLectureServiceError({
      code: 'INTERNAL_ERROR',
      stage: 'internal',
      message: 'The generated classroom package exceeds the 64 MB asset limit.',
      retryable: true,
      status: 502,
      details: { bytes: totalAssetBytes, maxBytes: MAX_TOTAL_ASSET_BYTES },
    });
  }

  const pages: NativeMiniLecturePage[] = pendingPages.map((page) => ({
    ...page,
    actions: page.actions.map((action, actionIndex) => {
      if (action.type !== 'speech' || !('sourceText' in action)) return action;
      const jobIndex = speechJobs.findIndex(
        (job) => job.pageIndex === page.order - 1 && job.actionIndex === actionIndex,
      );
      const audio = speechAssets[jobIndex];
      if (!audio) {
        throw new NativeMiniLectureServiceError({
          code: 'TTS_GENERATION_FAILED',
          stage: 'tts',
          message: `Missing generated MP3 for speech action ${action.id}.`,
          retryable: true,
          status: 502,
        });
      }
      const { sourceText: _sourceText, ...speechAction } = action;
      return {
        ...speechAction,
        audio,
      };
    }),
  }));

  const createdAt = args.dependencies.now().toISOString();
  const manifestWithoutHashes: Omit<NativeMiniLectureManifest, 'contentHash' | 'contentVersion'> = {
    schemaVersion: NATIVE_MINI_LECTURE_SCHEMA_VERSION,
    kind: NATIVE_MINI_LECTURE_MANIFEST_KIND,
    lectureId: args.lectureId,
    idempotencyKey: args.input.idempotencyKey,
    requestHash: args.requestHash,
    status: 'ready',
    title,
    language: args.input.language,
    source: {
      courseId: course.id,
      messageId: entityId(args.input.message),
      answerId: entityId(args.input.answer),
      sourceId: source.id,
    },
    generator: {
      image: {
        provider: NOTEBOOK_IMAGE2_PROVIDER_ID,
        model: NOTEBOOK_IMAGE2_MODEL_ID,
      },
      actions: {
        provider: 'openai',
        model: actionModel,
      },
      tts: {
        provider: OPENAI_TTS_PROVIDER_ID,
        model: OPENAI_TTS_MODEL_ID,
        voice: args.input.ttsVoice,
      },
    },
    pages,
    createdAt,
  };
  const contentHash = contentHashForManifest(manifestWithoutHashes);
  return {
    ...manifestWithoutHashes,
    contentHash,
    contentVersion: `sha256:${contentHash}`,
  };
}

export async function generateNativeMiniLecture(args: {
  context: NativeMiniLectureRequestContext;
  input: NativeMiniLectureRequest & { idempotencyKey: string };
  dependencies?: Partial<NativeMiniLectureServiceDependencies>;
}): Promise<NativeMiniLectureGenerationResult> {
  const dependencies = { ...nativeMiniLectureDependencies, ...args.dependencies };
  const requestHash = sha256Hex(
    stableJson({
      ...args.input,
      idempotencyKey: undefined,
    }),
  );
  const lectureId = `mini-lecture-${sha256Hex(`${args.input.idempotencyKey}\0${requestHash}`).slice(
    0,
    24,
  )}`;
  const now = dependencies.now().getTime();
  pruneIdempotencyCache(now);
  const cacheKey = makeIdempotencyCacheKey(args.context, args.input.idempotencyKey);
  const existing = idempotencyCache.get(cacheKey);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new NativeMiniLectureServiceError({
        code: 'IDEMPOTENCY_CONFLICT',
        stage: 'idempotency',
        message: 'The idempotency key was already used with a different mini-lecture request.',
        retryable: false,
        status: 409,
        details: {
          idempotencyKey: args.input.idempotencyKey,
        },
      });
    }
    return {
      manifest: await existing.promise,
      replayed: true,
    };
  }

  const promise = generateManifest({
    context: args.context,
    input: args.input,
    requestHash,
    lectureId,
    dependencies,
  });
  reserveIdempotencyCapacity();
  idempotencyCache.set(cacheKey, {
    requestHash,
    expiresAt: Number.POSITIVE_INFINITY,
    settled: false,
    promise,
  });
  try {
    const manifest = await promise;
    const current = idempotencyCache.get(cacheKey);
    if (current?.promise === promise) {
      current.settled = true;
      current.expiresAt = dependencies.now().getTime() + IDEMPOTENCY_TTL_MS;
    }
    return {
      manifest,
      replayed: false,
    };
  } catch (error) {
    const current = idempotencyCache.get(cacheKey);
    if (current?.promise === promise) idempotencyCache.delete(cacheKey);
    throw error;
  }
}

export function clearNativeMiniLectureIdempotencyCacheForTests(): void {
  idempotencyCache.clear();
}
