import type { LocalCourseEvent } from '../domain/learning-experiences';
import type {
  LocalCourseLearningState,
  LocalCourseWorkspace,
  LocalMessage,
  LocalNotebook,
  LocalNotebookDocument,
  LocalStudyMemory,
} from '../domain/models';
import type { LocalRepository } from '../data/repository';
import type { NativeChatContext, NativeChatSurface } from './types';

const MAX_NOTES = 6;
const MAX_NOTE_CHARS = 5000;
const MAX_NOTES_TOTAL_CHARS = 20_000;
const CHUNK_CHARS = 2400;
const MAX_SEARCHED_NOTEBOOKS = 30;

interface NoteChunk {
  id: string;
  notebookId: string;
  notebook: string;
  title: string;
  content: string;
  /** 小写、NFKC 后的标题和正文，检索用。 */
  haystack: string;
}

// 笔记本内容切块后缓存，避免每次发消息都重新读整本笔记。
const chunkCache = new Map<string, NoteChunk[]>();

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}

/** 页面 JSON 里的可读文字（图片笔记的页面没有 Markdown）。 */
function readableText(value: unknown, output: string[] = [], depth = 0): string[] {
  if (depth > 8 || output.length > 400) return output;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text && !/^(data:|blob:|https?:\/\/|\/)/.test(text) && !/^[\w-]{16,}$/.test(text)) {
      output.push(text);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) readableText(item, output, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/^(id|src|url|style|color|className|type|width|height|x|y)$/i.test(key)) continue;
      readableText(item, output, depth + 1);
    }
  }
  return output;
}

function chunksOf(document: LocalNotebookDocument): NoteChunk[] {
  const notebook = document.notebook;
  const sections = document.markdownSections.length
    ? [...document.markdownSections]
        .sort((left, right) => left.order - right.order)
        .map((section) => ({ id: section.id, title: section.title, text: section.markdown }))
    : [...document.pages]
        .sort((left, right) => left.order - right.order)
        .map((page) => ({
          id: page.id,
          title: page.title,
          text: readableText(page.content).join('\n'),
        }));
  return sections.flatMap((section) => {
    const text = section.text.trim();
    if (!text) return [];
    const parts: string[] = [];
    for (let start = 0; start < text.length; start += CHUNK_CHARS) {
      parts.push(text.slice(start, start + CHUNK_CHARS));
    }
    return parts.map((content, index) => ({
      id: `${section.id}${parts.length > 1 ? `#${index + 1}` : ''}`,
      notebookId: notebook.id,
      notebook: notebook.name,
      title: section.title || notebook.name,
      content,
      haystack: normalized(`${section.title}\n${content}`),
    }));
  });
}

async function notebookChunks(
  repository: LocalRepository,
  notebook: LocalNotebook,
): Promise<NoteChunk[]> {
  const key = `${notebook.id}:${notebook.updatedAt}`;
  const cached = chunkCache.get(key);
  if (cached) return cached;
  const document = await repository.loadNotebookDocument(notebook.id);
  const chunks = document ? chunksOf(document) : [];
  chunkCache.set(key, chunks);
  return chunks;
}

/** 检索词：英文/数字整词，中文用两字片段（Intl 分词对“导数”“极限”这类两字词也要命中）。 */
export function searchTerms(text: string): string[] {
  const terms = new Set<string>();
  const value = normalized(text);
  for (const word of value.match(/[a-z][a-z0-9_+-]{2,}|\d+(?:\.\d+)?/g) ?? []) terms.add(word);
  for (const run of value.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    const chars = [...run];
    for (let index = 0; index + 1 < chars.length; index += 1) {
      terms.add(chars[index] + chars[index + 1]);
    }
  }
  return [...terms].slice(0, 60);
}

const STOP_TERMS = new Set([
  '什么',
  '怎么',
  '为什',
  '么是',
  '一下',
  '这个',
  '那个',
  '可以',
  '如何',
  '是不',
  '不是',
  'the',
  'and',
  'what',
  'how',
  'why',
]);

function score(chunk: NoteChunk, primary: string[], secondary: string[]): number {
  let total = 0;
  for (const term of primary) {
    if (STOP_TERMS.has(term) || !chunk.haystack.includes(term)) continue;
    total += term.length > 2 ? 4 : 3;
  }
  for (const term of secondary) {
    if (!STOP_TERMS.has(term) && chunk.haystack.includes(term)) total += 1;
  }
  return total;
}

const MAX_MEMORIES = 30;
const MAX_LINKED_MEMORIES = 20;

function memoryRefs(memory: LocalStudyMemory): string[] {
  return memory.sourceReferences.filter((item): item is string => typeof item === 'string');
}

/**
 * 按星图连线挑记忆：和这次检索到的笔记节、笔记本、概念连着的珠子优先，
 * 再用最近的记忆补满。记忆越多，带给 AI 的越相关，而不是越杂。
 */
export function recallMemories(
  candidates: LocalStudyMemory[],
  notes: NativeChatContext['notes'],
  terms: string[],
): NativeChatContext['memories'] {
  const sections = new Set(notes.map((note) => `section:${note.id.split('#')[0]}`));
  const notebooks = new Set(notes.flatMap((note) => (note.notebookId ? [note.notebookId] : [])));
  const scored = candidates.map((memory) => {
    const refs = memoryRefs(memory);
    let value = 0;
    if (refs.some((ref) => sections.has(ref))) value += 6;
    if (memory.notebookId && notebooks.has(memory.notebookId)) value += 3;
    const haystack = normalized(
      `${memory.title} ${refs.filter((ref) => ref.startsWith('concept:')).join(' ')}`,
    );
    value += Math.min(6, terms.filter((term) => haystack.includes(term)).length * 2);
    return { memory, value };
  });
  const linked = scored
    .filter(({ value }) => value > 0)
    .sort(
      (left, right) => right.value - left.value || right.memory.updatedAt - left.memory.updatedAt,
    )
    .slice(0, MAX_LINKED_MEMORIES)
    .map(({ memory }) => memory);
  const linkedIds = new Set(linked.map((memory) => memory.id));
  const recent = candidates
    .filter((memory) => !linkedIds.has(memory.id))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_MEMORIES - linked.length);
  return [...linked, ...recent].map((memory) => ({
    id: memory.id,
    kind: memory.kind.slice(0, 80),
    title: memory.title.slice(0, 300),
    text: memory.text.slice(0, 1200),
    concepts: memoryRefs(memory)
      .filter((ref) => ref.startsWith('concept:'))
      .map((ref) => ref.slice('concept:'.length).slice(0, 60))
      .slice(0, 6),
  }));
}

export interface BuildNativeChatContextInput {
  repository: LocalRepository;
  workspace: LocalCourseWorkspace;
  surface: NativeChatSurface;
  /** 学习进度之内的笔记本（已按学习顺序排好）。 */
  readableNotebooks: LocalNotebook[];
  learningState: LocalCourseLearningState | null;
  scheduleItems: LocalCourseEvent[];
  history: LocalMessage[];
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 这次提问要带给助教的本机资料：按问题挑笔记片段，手机不带题库。 */
export async function buildNativeChatContext(
  input: BuildNativeChatContextInput,
): Promise<NativeChatContext> {
  const { repository, workspace, surface, readableNotebooks, learningState, history } = input;
  const question = history.at(-1)?.role === 'user' ? (history.at(-1)?.text ?? '') : '';
  const earlier = history
    .slice(-5, -1)
    .map((message) => message.text.slice(0, 600))
    .join('\n');

  const searched = readableNotebooks.slice(-MAX_SEARCHED_NOTEBOOKS);
  const chunks = (
    await Promise.all(searched.map((notebook) => notebookChunks(repository, notebook)))
  ).flat();
  const primary = searchTerms(question);
  const secondary = searchTerms(earlier);
  let picked = chunks
    .map((chunk) => ({ chunk, value: score(chunk, primary, secondary) }))
    .filter(({ value }) => value >= 3)
    .sort((left, right) => right.value - left.value)
    .map(({ chunk }) => chunk);
  if (!picked.length) {
    // 没命中（比如“继续”“这题怎么做”配照片）：给正在学的那本的开头几节。
    const currentId = learningState?.currentNotebookId ?? searched.at(-1)?.id;
    picked = chunks.filter((chunk) => chunk.notebookId === currentId).slice(0, 2);
  }
  const notes: NativeChatContext['notes'] = [];
  let budget = MAX_NOTES_TOTAL_CHARS;
  for (const chunk of picked) {
    if (notes.length >= MAX_NOTES || budget <= 0) break;
    const content = chunk.content.slice(0, Math.min(MAX_NOTE_CHARS, budget));
    budget -= content.length;
    notes.push({
      id: chunk.id,
      notebookId: chunk.notebookId,
      notebook: chunk.notebook,
      title: chunk.title,
      content,
    });
  }

  const readableIds = new Set(readableNotebooks.map((notebook) => notebook.id));
  const memories = recallMemories(
    workspace.memories
      .filter((memory) => memory.status === 'active')
      .filter((memory) => !memory.notebookId || readableIds.has(memory.notebookId)),
    notes,
    [...primary, ...secondary],
  );

  const today = localDateKey();
  const windowStart = localDateKey(new Date(Date.now() - 14 * 86_400_000));
  const calendar = input.scheduleItems
    .filter((event) => event.courseId === workspace.course.id && event.date >= windowStart)
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(0, 80)
    .map((event) => ({
      id: event.id.slice(0, 240),
      title: event.title.slice(0, 300),
      date: event.date,
      kind: event.kind,
      status: event.status,
    }));

  const currentNotebook = workspace.notebooks.find(
    (notebook) => notebook.id === learningState?.currentNotebookId,
  );
  const context: NativeChatContext = {
    today,
    progress: {
      completedNotebooks: readableNotebooks.length,
      totalNotebooks: workspace.notebooks.length,
      currentNotebook: currentNotebook?.name ?? null,
    },
    notes,
    memories,
    calendar,
    attempts: [],
    problems: [],
  };

  // 题库只在 iPad / 桌面端提供。
  if (surface !== 'phone') {
    const progress = await repository.listProblemProgress(workspace.course.id);
    const progressById = new Map(progress.map((item) => [item.problemId, item]));
    const recent = await Promise.all(
      progress
        .filter((item) => Boolean(item.latestAttemptId))
        .slice(0, 8)
        .map((item) => repository.loadProblemDocument(item.problemId)),
    );
    context.attempts = recent.flatMap((document) => {
      const attempt = document?.attempts[0];
      if (!document || !attempt) return [];
      const result = (attempt.result ?? {}) as Record<string, unknown>;
      return [
        {
          problemId: document.problem.id,
          title: document.problem.title.slice(0, 300),
          status: attempt.status.slice(0, 80),
          answer: JSON.stringify(attempt.answer ?? '').slice(0, 1200),
          feedback: typeof result.feedback === 'string' ? result.feedback.slice(0, 800) : undefined,
        },
      ];
    });
    const problemTerms = [...primary, ...secondary];
    context.problems = workspace.problems
      .filter((problem) => problem.status !== 'archived')
      .map((problem) => {
        const haystack = normalized(`${problem.title} ${problem.tags.join(' ')}`);
        return { problem, hits: problemTerms.filter((term) => haystack.includes(term)).length };
      })
      .sort((left, right) => right.hits - left.hits)
      .slice(0, 40)
      .map(({ problem }) => ({
        id: problem.id,
        title: problem.title.slice(0, 300),
        type: problem.type,
        difficulty: problem.difficulty,
        tags: problem.tags.slice(0, 12).map((tag) => tag.slice(0, 80)),
        excerpt: JSON.stringify(problem.publicContent).slice(0, 600),
        status: progressById.get(problem.id)?.status ?? null,
      }));
  }

  return context;
}
