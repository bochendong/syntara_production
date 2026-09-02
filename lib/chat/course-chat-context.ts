import type {
  CourseChatContext,
  CourseChatContextNotebook,
  CourseChatContextPage,
  CourseChatResourceLoadState,
  CourseChatResourceLoadStatus,
} from '@/lib/types/chat';
import { getCourse } from '@/lib/utils/course-storage';
import {
  listCourseSourceUploads,
  type CourseSourceUploadRecord,
} from '@/lib/utils/course-source-upload-api';

const MAX_SOURCES = 5;
const MAX_SECTIONS_PER_SOURCE = 4;
const MAX_SECTION_DIGEST_LENGTH = 1800;
const COURSE_META_TIMEOUT_MS = 1200;
const SOURCE_CONTEXT_TIMEOUT_MS = 15_000;
const MOCK_COURSE_CHAT_ID = 'syntara-mock-course-chat';

type CourseChatResourceStatuses = Partial<
  Record<'notebooks' | 'problems' | 'sources', CourseChatResourceLoadStatus>
>;

function loadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return typeof error === 'string' && error.trim() ? error.trim() : 'Unknown resource load error.';
}

function resourceStateFromStatus(
  status: CourseChatResourceLoadStatus | undefined,
): CourseChatResourceLoadState {
  return { status: status || 'unknown' };
}

async function loadCourseSources(courseId: string): Promise<{
  sources: CourseSourceUploadRecord[];
  state: CourseChatResourceLoadState;
}> {
  if (courseId === MOCK_COURSE_CHAT_ID) {
    return {
      sources: [],
      state: { status: 'empty', itemCount: 0 },
    };
  }

  try {
    const sources = await listCourseSourceUploads(courseId, {
      includeText: true,
      includeArtifacts: false,
      timeoutMs: SOURCE_CONTEXT_TIMEOUT_MS,
    });
    const textSources = sources.filter(
      (source) =>
        source.ingestStatus === 'ready' &&
        source.indexStatus === 'ready' &&
        source.allQuestionUpload !== true &&
        source.kind !== 'problem_bank',
    );
    const textSectionCount = textSources.reduce(
      (total, source) =>
        total + source.textSections.filter((section) => section.markdown.trim()).length,
      0,
    );
    const processing = textSources.some((source) => source.ingestStatus === 'processing');
    const failedSource = textSources.find((source) => source.ingestStatus === 'error');
    return {
      sources: textSources,
      state:
        textSectionCount > 0
          ? { status: 'ready', itemCount: textSectionCount }
          : processing
            ? { status: 'loading', itemCount: 0 }
            : failedSource
              ? {
                  status: 'error',
                  itemCount: 0,
                  error: failedSource.errorReason || '资料文本处理失败。',
                }
              : { status: 'empty', itemCount: 0 },
    };
  } catch (error) {
    return {
      sources: [],
      state: {
        status: 'error',
        error: loadErrorMessage(error),
      },
    };
  }
}

function normalizeText(input: string): string {
  return input.replace(/\r\n?/g, '\n').trim();
}

function focusedDigest(
  input: string,
  tokens: string[],
  maxLength = MAX_SECTION_DIGEST_LENGTH,
): string {
  const text = normalizeText(input);
  if (text.length <= maxLength) return text;

  const lowered = text.toLowerCase();
  const firstHit = tokens
    .map((token) => lowered.indexOf(token.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (firstHit === undefined) return text.slice(0, maxLength).trim();

  const preferredStart = Math.max(0, firstHit - Math.floor(maxLength * 0.35));
  const start = Math.min(preferredStart, Math.max(0, text.length - maxLength));
  const end = Math.min(text.length, start + maxLength);
  return `${start > 0 ? '... ' : ''}${text.slice(start, end).trim()}${
    end < text.length ? ' ...' : ''
  }`;
}

export function tokenizeCourseChatQuery(input: string): string[] {
  const lowered = input.toLowerCase();
  const zhChunks = lowered.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const zhStopTokens = new Set([
    '一下',
    '一个',
    '这个',
    '那个',
    '我们',
    '你们',
    '他们',
    '为什么',
    '怎么',
    '如何',
    '说明',
    '解释',
    '必要',
  ]);
  const zhTokens = zhChunks.flatMap((chunk) => {
    const tokens: string[] = [chunk];
    for (const size of [2, 3, 4]) {
      for (let index = 0; index <= chunk.length - size; index++) {
        const token = chunk.slice(index, index + size);
        if (!zhStopTokens.has(token)) tokens.push(token);
      }
    }
    return tokens;
  });
  const latinTokens = lowered.match(/[a-z0-9][a-z0-9-]{1,}/g) || [];
  return Array.from(new Set([...zhTokens, ...latinTokens]));
}

export function scoreCourseChatText(tokens: string[], haystack: string): number {
  if (!tokens.length || !haystack.trim()) return 0;
  const normalized = haystack.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (!normalized.includes(token)) continue;
    score += token.length >= 6 ? 4 : token.length >= 4 ? 3 : 2;
  }
  return score;
}

function scoreSourceMeta(tokens: string[], source: CourseSourceUploadRecord): number {
  return scoreCourseChatText(
    tokens,
    [source.title, source.topic || '', source.kind, source.usageProfile || ''].join(' '),
  );
}

function sourceTextState(source: CourseSourceUploadRecord): CourseChatResourceLoadState {
  const textSectionCount = source.textSections.filter((section) => section.markdown.trim()).length;
  if (textSectionCount > 0) {
    return { status: 'ready', itemCount: textSectionCount };
  }
  if (source.ingestStatus === 'error') {
    return {
      status: 'error',
      itemCount: 0,
      error: source.errorReason || '资料文本处理失败。',
    };
  }
  if (source.ingestStatus === 'processing') {
    return { status: 'loading', itemCount: 0 };
  }
  return { status: 'empty', itemCount: 0 };
}

async function getCourseForChatContext(courseId: string) {
  if (courseId === MOCK_COURSE_CHAT_ID) return undefined;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getCourse(courseId),
      new Promise<undefined>((resolve) => {
        timeoutId = setTimeout(() => resolve(undefined), COURSE_META_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function buildCourseChatContext(args: {
  courseId: string;
  courseName?: string;
  question: string;
  target: CourseChatContext['target'];
  learner?: CourseChatContext['learner'];
  resourceStates?: CourseChatResourceStatuses;
}): Promise<CourseChatContext> {
  const [course, sourceLoad] = await Promise.all([
    getCourseForChatContext(args.courseId),
    loadCourseSources(args.courseId),
  ]);
  const tokens = tokenizeCourseChatQuery(args.question);

  const hydrated: CourseChatContextNotebook[] = sourceLoad.sources.map((source) => {
    const notebookOrder = new Map(source.notebookIds.map((id, index) => [id, index]));
    const pages: CourseChatContextPage[] = source.textSections
      .slice()
      .filter((section) => section.markdown.trim())
      .sort(
        (a, b) =>
          (notebookOrder.get(a.notebookId) ?? Number.MAX_SAFE_INTEGER) -
            (notebookOrder.get(b.notebookId) ?? Number.MAX_SAFE_INTEGER) ||
          a.order - b.order ||
          a.title.localeCompare(b.title, 'zh-CN'),
      )
      .map((section, index) => {
        const title = section.title.trim() || '未命名章节';
        const digest = focusedDigest(section.markdown, tokens);
        return {
          id: section.id,
          order: index + 1,
          title,
          digest,
          sourceScore: scoreCourseChatText(tokens, `${title} ${digest}`),
        };
      });
    const metaScore = scoreSourceMeta(tokens, source);
    const topPageScore = pages.reduce((best, page) => Math.max(best, page.sourceScore), 0);
    const pageScoreTotal = pages.reduce((total, page) => total + page.sourceScore, 0);
    const selectedPages = pages
      .slice()
      .sort((a, b) => b.sourceScore - a.sourceScore || a.order - b.order)
      .slice(0, MAX_SECTIONS_PER_SOURCE)
      .sort((a, b) => a.order - b.order);
    const description = source.topic?.trim();
    const tags = Array.from(
      new Set([source.kind.trim(), source.usageProfile?.trim()].filter(Boolean) as string[]),
    );

    return {
      id: `source:${args.courseId}:${source.sourceHash}`,
      name: source.title.trim() || description || '未命名资料',
      description: description || undefined,
      tags,
      updatedAt: Date.parse(source.updatedAt) || undefined,
      pages: selectedPages,
      pagesState: sourceTextState(source),
      sourceScore: metaScore + topPageScore + Math.min(pageScoreTotal, 12),
    };
  });

  const selectedSources = hydrated
    .sort((a, b) => b.sourceScore - a.sourceScore || (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_SOURCES);

  return {
    course: {
      id: args.courseId,
      name: course?.name || args.courseName?.trim() || '当前课程',
      description: course?.description || undefined,
      language: course?.language,
      purpose: course?.purpose,
      tags: course?.tags || [],
      university: course?.university,
      courseCode: course?.courseCode,
    },
    learner: args.learner,
    target: args.target,
    notebooks: selectedSources,
    resourceStates: {
      notebooks: resourceStateFromStatus(args.resourceStates?.notebooks),
      problems: resourceStateFromStatus(args.resourceStates?.problems),
      sources: sourceLoad.state,
    },
  };
}
