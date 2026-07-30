import type {
  LocalAsset,
  LocalConversation,
  LocalCourse,
  LocalMarkdownSection,
  LocalMessage,
  LocalNotebook,
  LocalNotebookAssetLink,
  LocalNotebookPage,
  LocalPageAsset,
  LocalProblem,
  LocalProblemAttempt,
  LocalProblemProgress,
  LocalStudyMemory,
} from '../domain/models';

export const SYNTARA_ARCHIVE_FORMAT = 'syntara-native-archive';
export const SYNTARA_ARCHIVE_VERSION = 1;

export interface SyntaraArchiveV1 {
  format: typeof SYNTARA_ARCHIVE_FORMAT;
  version: typeof SYNTARA_ARCHIVE_VERSION;
  exportedAt: number;
  source: {
    kind: 'postgresql' | 'indexeddb' | 'native';
    appVersion?: string;
    ownerId?: string;
    ownerEmail?: string;
  };
  courses: LocalCourse[];
  notebooks: LocalNotebook[];
  notebookPages: LocalNotebookPage[];
  markdownSections: LocalMarkdownSection[];
  problems: LocalProblem[];
  problemAttempts: LocalProblemAttempt[];
  problemProgress: LocalProblemProgress[];
  conversations: LocalConversation[];
  messages: LocalMessage[];
  studyMemories: LocalStudyMemory[];
  assets: LocalAsset[];
  pageAssets: LocalPageAsset[];
  notebookAssets: LocalNotebookAssetLink[];
  missingAssetPaths: string[];
}

export interface ArchiveImportSummary {
  courseIds: string[];
  courses: number;
  notebooks: number;
  notebookPages: number;
  markdownSections: number;
  problems: number;
  problemAttempts: number;
  problemProgress: number;
  conversations: number;
  messages: number;
  studyMemories: number;
  assets: number;
  pageAssets: number;
  notebookAssets: number;
  missingAssets: number;
  skipped: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown, fallback = 0): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = numberValue(value, Number.NaN);
  return Number.isFinite(number) ? number : null;
}

function timestampValue(value: unknown): number {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return numberValue(value, Date.now());
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function requireId(row: Record<string, unknown>): string | null {
  const id = stringValue(row.id).trim();
  return id || null;
}

export function parseSyntaraArchive(input: string | unknown): SyntaraArchiveV1 {
  const value = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  if (!isRecord(value)) throw new Error('迁移文件不是有效的 JSON 对象。');
  if (value.format !== SYNTARA_ARCHIVE_FORMAT || Number(value.version) !== 1) {
    throw new Error('不支持的 Syntara 迁移文件版本。');
  }

  let skipped = 0;
  const courses = rows(value.courses).flatMap((row): LocalCourse[] => {
    const id = requireId(row);
    if (!id) {
      skipped += 1;
      return [];
    }
    return [
      {
        id,
        name: stringValue(row.name, '未命名课程'),
        description: stringValue(row.description),
        language: row.language === 'en-US' ? 'en-US' : 'zh-CN',
        tags: stringArray(row.tags),
        purpose: row.purpose === 'research' || row.purpose === 'university' ? row.purpose : 'daily',
        university: nullableString(row.university),
        courseCode: nullableString(row.courseCode),
        createdAt: timestampValue(row.createdAt),
        updatedAt: timestampValue(row.updatedAt),
      },
    ];
  });
  const courseIds = new Set(courses.map((course) => course.id));

  const notebooks = rows(value.notebooks).flatMap((row): LocalNotebook[] => {
    const id = requireId(row);
    const courseId = stringValue(row.courseId);
    if (!id || !courseIds.has(courseId)) {
      skipped += 1;
      return [];
    }
    return [
      {
        id,
        courseId,
        name: stringValue(row.name, '未命名笔记本'),
        description: stringValue(row.description),
        kind: row.kind === 'markdown' ? 'markdown' : 'image',
        tags: stringArray(row.tags),
        sectionCount: Math.max(0, numberValue(row.sectionCount)),
        createdAt: timestampValue(row.createdAt),
        updatedAt: timestampValue(row.updatedAt),
      },
    ];
  });
  const notebookIds = new Set(notebooks.map((notebook) => notebook.id));

  const notebookPages = rows(value.notebookPages).flatMap((row): LocalNotebookPage[] => {
    const id = requireId(row);
    const notebookId = stringValue(row.notebookId);
    if (!id || !notebookIds.has(notebookId)) {
      skipped += 1;
      return [];
    }
    const courseId = nullableString(row.courseId);
    return [
      {
        id,
        notebookId,
        courseId: courseId && courseIds.has(courseId) ? courseId : null,
        sourceSceneId: nullableString(row.sourceSceneId),
        title: stringValue(row.title, '未命名页面'),
        type: stringValue(row.type, 'slide'),
        order: numberValue(row.order),
        content: recordValue(row.content),
        actions: unknownArray(row.actions),
        whiteboard: isRecord(row.whiteboard) ? row.whiteboard : null,
        createdAt: timestampValue(row.createdAt),
        updatedAt: timestampValue(row.updatedAt),
      },
    ];
  });
  const pageIds = new Set(notebookPages.map((page) => page.id));

  const assets = rows(value.assets).flatMap((row): LocalAsset[] => {
    const id = requireId(row);
    const path = stringValue(row.path).trim();
    if (!id || !path) {
      skipped += 1;
      return [];
    }
    return [
      {
        id,
        path,
        mimeType: stringValue(row.mimeType, 'application/octet-stream'),
        sizeBytes: Math.max(0, numberValue(row.sizeBytes)),
        sha256: stringValue(row.sha256),
        source: nullableString(row.source),
        dataBase64: nullableString(row.dataBase64),
        createdAt: timestampValue(row.createdAt),
        updatedAt: timestampValue(row.updatedAt),
      },
    ];
  });
  const assetIds = new Set(assets.map((asset) => asset.id));

  const pageAssets = rows(value.pageAssets).flatMap((row): LocalPageAsset[] => {
    const id = requireId(row);
    const pageId = stringValue(row.pageId);
    const assetId = stringValue(row.assetId);
    if (!id || !pageIds.has(pageId) || !assetIds.has(assetId)) {
      skipped += 1;
      return [];
    }
    return [
      {
        id,
        pageId,
        assetId,
        role: stringValue(row.role, 'image'),
        order: numberValue(row.order),
        meta: recordValue(row.meta),
        createdAt: timestampValue(row.createdAt),
        updatedAt: timestampValue(row.updatedAt),
      },
    ];
  });

  const notebookAssets = rows(value.notebookAssets).flatMap((row): LocalNotebookAssetLink[] => {
    const id = requireId(row);
    const notebookId = stringValue(row.notebookId);
    const assetId = stringValue(row.assetId);
    if (!id || !notebookIds.has(notebookId) || !assetIds.has(assetId)) {
      skipped += 1;
      return [];
    }
    return [
      {
        id,
        notebookId,
        assetId,
        createdAt: timestampValue(row.createdAt),
        updatedAt: timestampValue(row.updatedAt),
      },
    ];
  });

  const markdownSections = rows(value.markdownSections).flatMap((row): LocalMarkdownSection[] => {
    const id = requireId(row);
    const notebookId = stringValue(row.notebookId);
    if (!id || !notebookIds.has(notebookId)) {
      skipped += 1;
      return [];
    }
    const courseId = nullableString(row.courseId);
    return [
      {
        id,
        notebookId,
        courseId: courseId && courseIds.has(courseId) ? courseId : null,
        title: stringValue(row.title, '未命名章节'),
        order: numberValue(row.order),
        markdown: stringValue(row.markdown),
        summary: nullableString(row.summary),
        sourceMeta: recordValue(row.sourceMeta),
        createdAt: timestampValue(row.createdAt),
        updatedAt: timestampValue(row.updatedAt),
      },
    ];
  });

  const problems = rows(value.problems).flatMap((row): LocalProblem[] => {
    const id = requireId(row);
    const courseId = stringValue(row.courseId);
    if (!id || !courseIds.has(courseId)) {
      skipped += 1;
      return [];
    }
    const notebookId = nullableString(row.notebookId);
    return [
      {
        id,
        courseId,
        notebookId: notebookId && notebookIds.has(notebookId) ? notebookId : null,
        title: stringValue(row.title, '未命名题目'),
        type: stringValue(row.type, 'short_answer'),
        status: row.status === 'published' || row.status === 'archived' ? row.status : 'draft',
        difficulty:
          row.difficulty === 'easy' || row.difficulty === 'hard' ? row.difficulty : 'medium',
        tags: stringArray(row.tags),
        publicContent: recordValue(row.publicContent),
        grading: recordValue(row.grading),
        createdAt: timestampValue(row.createdAt),
        updatedAt: timestampValue(row.updatedAt),
      },
    ];
  });
  const problemIds = new Set(problems.map((problem) => problem.id));

  const problemAttempts = rows(value.problemAttempts).flatMap((row): LocalProblemAttempt[] => {
    const id = requireId(row);
    const problemId = stringValue(row.problemId);
    if (!id || !problemIds.has(problemId)) {
      skipped += 1;
      return [];
    }
    return [
      {
        id,
        problemId,
        kind: stringValue(row.kind, 'manual'),
        answer: recordValue(row.answer),
        result: isRecord(row.result) ? row.result : null,
        score: nullableNumber(row.score),
        status: stringValue(row.status, 'pending'),
        createdAt: timestampValue(row.createdAt),
        updatedAt: timestampValue(row.updatedAt),
      },
    ];
  });
  const attemptIds = new Set(problemAttempts.map((attempt) => attempt.id));

  const problemProgress = rows(value.problemProgress).flatMap((row): LocalProblemProgress[] => {
    const id = requireId(row);
    const problemId = stringValue(row.problemId);
    if (!id || !problemIds.has(problemId)) {
      skipped += 1;
      return [];
    }
    const latestAttemptId = nullableString(row.latestAttemptId);
    return [
      {
        id,
        problemId,
        latestAttemptId:
          latestAttemptId && attemptIds.has(latestAttemptId) ? latestAttemptId : null,
        status: stringValue(row.status, 'pending'),
        score: nullableNumber(row.score),
        attemptedCount: Math.max(0, numberValue(row.attemptedCount)),
        passedCount: Math.max(0, numberValue(row.passedCount)),
        lastAttemptAt:
          row.lastAttemptAt === null || row.lastAttemptAt === undefined
            ? null
            : timestampValue(row.lastAttemptAt),
        createdAt: timestampValue(row.createdAt),
        updatedAt: timestampValue(row.updatedAt),
      },
    ];
  });

  const conversations = rows(value.conversations).flatMap((row): LocalConversation[] => {
    const id = requireId(row);
    const courseId = stringValue(row.courseId);
    if (!id || !courseIds.has(courseId)) {
      skipped += 1;
      return [];
    }
    const notebookId = nullableString(row.notebookId);
    return [
      {
        id,
        courseId,
        notebookId: notebookId && notebookIds.has(notebookId) ? notebookId : null,
        title: stringValue(row.title, '新对话'),
        createdAt: timestampValue(row.createdAt),
        updatedAt: timestampValue(row.updatedAt),
      },
    ];
  });
  const conversationIds = new Set(conversations.map((conversation) => conversation.id));

  const messages = rows(value.messages).flatMap((row): LocalMessage[] => {
    const id = requireId(row);
    const conversationId = stringValue(row.conversationId);
    if (!id || !conversationIds.has(conversationId)) {
      skipped += 1;
      return [];
    }
    return [
      {
        id,
        conversationId,
        role: row.role === 'assistant' || row.role === 'system' ? row.role : 'user',
        text: stringValue(row.text),
        createdAt: timestampValue(row.createdAt),
      },
    ];
  });

  const studyMemories = rows(value.studyMemories).flatMap((row): LocalStudyMemory[] => {
    const id = requireId(row);
    if (!id) {
      skipped += 1;
      return [];
    }
    const courseId = nullableString(row.courseId);
    const notebookId = nullableString(row.notebookId);
    if ((courseId && !courseIds.has(courseId)) || (notebookId && !notebookIds.has(notebookId))) {
      skipped += 1;
      return [];
    }
    return [
      {
        id,
        courseId,
        notebookId,
        targetType: stringValue(row.targetType, 'course'),
        scope: stringValue(row.scope, 'private'),
        kind: stringValue(row.kind, 'manual'),
        status: stringValue(row.status, 'active'),
        source: stringValue(row.source, 'migration'),
        title: stringValue(row.title, '学习记忆'),
        text: stringValue(row.text),
        reason: nullableString(row.reason),
        question: nullableString(row.question),
        sourceReferences: unknownArray(row.sourceReferences),
        confidence: nullableNumber(row.confidence),
        createdAt: timestampValue(row.createdAt),
        updatedAt: timestampValue(row.updatedAt),
      },
    ];
  });

  const source = isRecord(value.source) ? value.source : {};
  const archive: SyntaraArchiveV1 = {
    format: SYNTARA_ARCHIVE_FORMAT,
    version: SYNTARA_ARCHIVE_VERSION,
    exportedAt: timestampValue(value.exportedAt),
    source: {
      kind: source.kind === 'postgresql' || source.kind === 'native' ? source.kind : 'indexeddb',
      appVersion: nullableString(source.appVersion) ?? undefined,
      ownerId: nullableString(source.ownerId) ?? undefined,
      ownerEmail: nullableString(source.ownerEmail) ?? undefined,
    },
    courses,
    notebooks,
    notebookPages,
    markdownSections,
    problems,
    problemAttempts,
    problemProgress,
    conversations,
    messages,
    studyMemories,
    assets,
    pageAssets,
    notebookAssets,
    missingAssetPaths: stringArray(value.missingAssetPaths),
  };

  Object.defineProperty(archive, '__skipped', { value: skipped, enumerable: false });
  return archive;
}

export function summarizeArchive(archive: SyntaraArchiveV1): ArchiveImportSummary {
  const skipped = Number((archive as SyntaraArchiveV1 & { __skipped?: number }).__skipped ?? 0);
  return {
    courseIds: archive.courses.map((course) => course.id),
    courses: archive.courses.length,
    notebooks: archive.notebooks.length,
    notebookPages: archive.notebookPages.length,
    markdownSections: archive.markdownSections.length,
    problems: archive.problems.length,
    problemAttempts: archive.problemAttempts.length,
    problemProgress: archive.problemProgress.length,
    conversations: archive.conversations.length,
    messages: archive.messages.length,
    studyMemories: archive.studyMemories.length,
    assets: archive.assets.length,
    pageAssets: archive.pageAssets.length,
    notebookAssets: archive.notebookAssets.length,
    missingAssets: archive.missingAssetPaths.length,
    skipped,
  };
}
