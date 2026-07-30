import Dexie, { type EntityTable } from 'dexie';
import type {
  LocalAsset,
  LocalConversation,
  LocalCourse,
  LocalCourseLearningState,
  LocalCourseSearchResult,
  LocalCourseSummary,
  LocalCourseWorkspace,
  LocalMarkdownSection,
  LocalMessage,
  LocalNotebook,
  LocalNotebookAssetLink,
  LocalNotebookDocument,
  LocalNotebookPage,
  LocalPageAsset,
  LocalProblem,
  LocalProblemAttempt,
  LocalProblemDocument,
  LocalProblemProgress,
  LocalStudyMemory,
} from '../domain/models';
import {
  miniLectureAssetIds,
  type LocalCourseEvent,
  type PersistedMiniLectureAction,
  type PersistedMiniLectureDeck,
  type PersistedMiniLecturePage,
  type RuntimeMiniLectureAction,
  type RuntimeMiniLectureDeck,
} from '../domain/learning-experiences';
import type { NativeMessageMetadata } from '../domain/teaching';
import {
  courseLearningStateMetadataKey,
  normalizeCourseLearningState,
  parseCourseLearningState,
} from './course-learning-state';
import { rankCourseSearchResults } from './course-search';
import type { ArchiveImportSummary, SyntaraArchiveV1 } from './archive';
import { summarizeArchive } from './archive';
import type {
  AppendMessageInput,
  ImportTextMaterialInput,
  ImportTextProblemInput,
  LocalRepository,
  NewCourseInput,
  SaveProblemAttemptInput,
  SaveProblemAttemptResult,
  SaveCourseLearningStateInput,
  SaveMiniLectureInput,
  UpdateCourseInput,
} from './repository';
import {
  bundledMockConversationVersion,
  legacyMockConversationIds,
  legacyMockMessageIds,
  seedConversations,
  seedCourses,
  seedMessages,
  seedNotebooks,
  seedProblems,
} from './seed';
import { bundledProblemSnapshotVersion, legacyDemoProblemIds } from './bundled-problem-snapshot';
import {
  bundledLearningContentVersion,
  bundledLearningMarkdownSections,
  bundledLearningMemories,
  bundledLearningNotebooks,
} from './bundled-learning-content';
import {
  bundledMiniLectureVersion,
  bundledMockMiniLectures,
  type NativeMiniLectureDeck,
} from './mock-mini-lectures';
import { NATIVE_MAT136_MOCK_EXAM } from './mock-review-plan';

type LocalAppMetadata = {
  key: string;
  value: string;
  updatedAt: number;
};

function eventCoursesById(events: LocalCourseEvent[]): Map<string, string> {
  const coursesById = new Map<string, string>();
  for (const event of events) {
    const existingCourseId = coursesById.get(event.id);
    if (existingCourseId && existingCourseId !== event.courseId) {
      throw new Error(`日历事项 ${event.id} 不能同时属于多个课程。`);
    }
    coursesById.set(event.id, event.courseId);
  }
  return coursesById;
}

class NativePreviewDatabase extends Dexie {
  courses!: EntityTable<LocalCourse, 'id'>;
  notebooks!: EntityTable<LocalNotebook, 'id'>;
  problems!: EntityTable<LocalProblem, 'id'>;
  conversations!: EntityTable<LocalConversation, 'id'>;
  messages!: EntityTable<LocalMessage, 'id'>;
  notebookPages!: EntityTable<LocalNotebookPage, 'id'>;
  markdownSections!: EntityTable<LocalMarkdownSection, 'id'>;
  problemAttempts!: EntityTable<LocalProblemAttempt, 'id'>;
  problemProgress!: EntityTable<LocalProblemProgress, 'id'>;
  studyMemories!: EntityTable<LocalStudyMemory, 'id'>;
  assets!: EntityTable<LocalAsset, 'id'>;
  pageAssets!: EntityTable<LocalPageAsset, 'id'>;
  notebookAssets!: EntityTable<LocalNotebookAssetLink, 'id'>;
  appMetadata!: EntityTable<LocalAppMetadata, 'key'>;
  courseEvents!: EntityTable<LocalCourseEvent, 'id'>;
  lectureDecks!: EntityTable<PersistedMiniLectureDeck, 'id'>;
  lecturePages!: EntityTable<PersistedMiniLecturePage, 'id'>;

  constructor() {
    super('Syntara-Native-Preview');
    this.version(1).stores({
      courses: 'id, updatedAt',
      notebooks: 'id, courseId, updatedAt, [courseId+updatedAt]',
      problems: 'id, courseId, notebookId, updatedAt',
      conversations: 'id, courseId, notebookId, updatedAt',
      messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
    });
    this.version(2).stores({
      courses: 'id, updatedAt',
      notebooks: 'id, courseId, updatedAt, [courseId+updatedAt]',
      problems: 'id, courseId, notebookId, updatedAt',
      conversations: 'id, courseId, notebookId, updatedAt',
      messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
      notebookPages: 'id, notebookId, courseId, [notebookId+order]',
      markdownSections: 'id, notebookId, courseId, [notebookId+order]',
      problemAttempts: 'id, problemId, createdAt, [problemId+createdAt]',
      problemProgress: 'id, &problemId, status, lastAttemptAt',
      studyMemories: 'id, courseId, notebookId, updatedAt',
    });
    this.version(3).stores({
      courses: 'id, updatedAt',
      notebooks: 'id, courseId, updatedAt, [courseId+updatedAt]',
      problems: 'id, courseId, notebookId, updatedAt',
      conversations: 'id, courseId, notebookId, updatedAt',
      messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
      notebookPages: 'id, notebookId, courseId, [notebookId+order]',
      markdownSections: 'id, notebookId, courseId, [notebookId+order]',
      problemAttempts: 'id, problemId, createdAt, [problemId+createdAt]',
      problemProgress: 'id, &problemId, status, lastAttemptAt',
      studyMemories: 'id, courseId, notebookId, updatedAt',
      assets: 'id, &path, sha256',
      pageAssets: 'id, pageId, assetId, [pageId+order]',
      notebookAssets: 'id, notebookId, assetId, [notebookId+assetId]',
    });
    this.version(4).stores({
      courses: 'id, updatedAt',
      notebooks: 'id, courseId, updatedAt, [courseId+updatedAt]',
      problems: 'id, courseId, notebookId, updatedAt',
      conversations: 'id, courseId, notebookId, updatedAt',
      messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
      notebookPages: 'id, notebookId, courseId, [notebookId+order]',
      markdownSections: 'id, notebookId, courseId, [notebookId+order]',
      problemAttempts: 'id, problemId, createdAt, [problemId+createdAt]',
      problemProgress: 'id, &problemId, status, lastAttemptAt',
      studyMemories: 'id, courseId, notebookId, updatedAt',
      assets: 'id, &path, sha256',
      pageAssets: 'id, pageId, assetId, [pageId+order]',
      notebookAssets: 'id, notebookId, assetId, [notebookId+assetId]',
      appMetadata: 'key, updatedAt',
    });
    this.version(5).stores({
      courses: 'id, updatedAt',
      notebooks: 'id, courseId, updatedAt, [courseId+updatedAt]',
      problems: 'id, courseId, notebookId, updatedAt',
      conversations: 'id, courseId, notebookId, updatedAt',
      messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
      notebookPages: 'id, notebookId, courseId, [notebookId+order]',
      markdownSections: 'id, notebookId, courseId, [notebookId+order]',
      problemAttempts: 'id, problemId, createdAt, [problemId+createdAt]',
      problemProgress: 'id, &problemId, status, lastAttemptAt',
      studyMemories: 'id, courseId, notebookId, updatedAt',
      assets: 'id, &path, sha256',
      pageAssets: 'id, pageId, assetId, [pageId+order]',
      notebookAssets: 'id, notebookId, assetId, [notebookId+assetId]',
      appMetadata: 'key, updatedAt',
      courseEvents: 'id, courseId, date, status, [courseId+date]',
      lectureDecks: 'id, messageId, origin, packageName, status, updatedAt',
      lecturePages: 'id, deckId, order, [deckId+order]',
    });
  }
}

const BUNDLED_LECTURE_PACKAGE_NAME = 'mat136-image2-openai-tts';

function bundledAssetId(kind: 'image' | 'audio', sourceId: string): string {
  return `bundled-mini-lecture:${kind}:${sourceId}`;
}

function staticAsset(
  id: string,
  path: string,
  mimeType: string,
  sizeBytes: number,
  sha256: string,
  timestamp: number,
): LocalAsset {
  return {
    id,
    path,
    mimeType,
    sizeBytes,
    sha256,
    source: 'bundled-static-url',
    dataBase64: null,
    storagePath: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function persistBundledMiniLecture(
  lecture: NativeMiniLectureDeck,
  timestamp: number,
): {
  deck: PersistedMiniLectureDeck;
  pages: PersistedMiniLecturePage[];
  assets: LocalAsset[];
} {
  const assets: LocalAsset[] = [];
  const pages = lecture.pages.map((page, order): PersistedMiniLecturePage => {
    const imageAssetId = bundledAssetId('image', page.id);
    assets.push(
      staticAsset(
        imageAssetId,
        page.imageUrl,
        'image/png',
        page.imageBytes,
        page.imageSha256,
        timestamp,
      ),
    );

    const actions: PersistedMiniLectureAction[] = page.actions.map((action) => {
      if (action.type === 'spotlight') return { ...action };
      const audioAssetId = bundledAssetId('audio', action.id);
      assets.push(
        staticAsset(
          audioAssetId,
          action.audioUrl,
          'audio/mpeg',
          action.audioBytes,
          action.audioSha256,
          timestamp,
        ),
      );
      return {
        id: action.id,
        type: action.type,
        regionId: action.regionId,
        title: action.title,
        text: action.text,
        audioAssetId,
        audioProvider: action.audioProvider,
        audioModel: action.audioModel,
        audioVoice: action.audioVoice,
        audioSha256: action.audioSha256,
        audioBytes: action.audioBytes,
      };
    });

    return {
      id: page.id,
      deckId: lecture.id,
      order,
      title: page.title,
      imageAssetId,
      width: page.width,
      height: page.height,
      recoveryStatus: page.recoveryStatus,
      regions: page.regions,
      actions,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });

  return {
    deck: {
      id: lecture.id,
      messageId: lecture.sourceMessageId,
      title: lecture.title,
      origin: 'bundled',
      packageName: BUNDLED_LECTURE_PACKAGE_NAME,
      packageVersion: 1,
      status: lecture.status,
      generatorMeta: lecture.generatedBy,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    pages,
    assets,
  };
}

function browserAssetUrl(asset: LocalAsset | undefined): string | null {
  if (!asset) return null;
  if (asset.dataBase64) return `data:${asset.mimeType};base64,${asset.dataBase64}`;
  if (
    asset.path.startsWith('/') ||
    asset.path.startsWith('http://') ||
    asset.path.startsWith('https://') ||
    asset.path.startsWith('blob:')
  ) {
    return asset.path;
  }
  return null;
}

export class BrowserLocalRepository implements LocalRepository {
  readonly kind = 'indexeddb' as const;
  private readonly database = new NativePreviewDatabase();

  private async installBundledCourseEvents(): Promise<void> {
    const metadataKey = 'bundled-course-events-version';
    const version = 'mat136-stage-exam-v1';
    const metadata = await this.database.appMetadata.get(metadataKey);
    if (metadata?.value === version) return;

    const timestamp = Date.now();
    await this.database.transaction(
      'rw',
      [this.database.courseEvents, this.database.appMetadata],
      async () => {
        const existing = await this.database.courseEvents.get(NATIVE_MAT136_MOCK_EXAM.id);
        if (!existing) {
          await this.database.courseEvents.put({
            ...NATIVE_MAT136_MOCK_EXAM,
            courseId: 'course-mat136-local',
            kind: 'exam',
            source: 'bundled',
            status: 'active',
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
        await this.database.appMetadata.put({
          key: metadataKey,
          value: version,
          updatedAt: timestamp,
        });
      },
    );
  }

  private async installBundledMiniLectures(): Promise<void> {
    const metadataKey = 'bundled-mini-lecture-version';
    const metadata = await this.database.appMetadata.get(metadataKey);
    if (metadata?.value === bundledMiniLectureVersion) return;

    const timestamp = Date.now();
    const documents = bundledMockMiniLectures().map((lecture) =>
      persistBundledMiniLecture(lecture, timestamp),
    );
    const decks = documents.map((document) => document.deck);
    const pages = documents.flatMap((document) => document.pages);
    const assets = documents.flatMap((document) => document.assets);

    await this.database.transaction(
      'rw',
      [
        this.database.assets,
        this.database.lectureDecks,
        this.database.lecturePages,
        this.database.appMetadata,
      ],
      async () => {
        const previousDecks = await this.database.lectureDecks
          .where('packageName')
          .equals(BUNDLED_LECTURE_PACKAGE_NAME)
          .toArray();
        const previousDeckIds = previousDecks.map((deck) => deck.id);
        const previousPages = previousDeckIds.length
          ? await this.database.lecturePages.where('deckId').anyOf(previousDeckIds).toArray()
          : [];
        const previousAssetIds = previousPages.flatMap((page) => [
          page.imageAssetId,
          ...page.actions.flatMap((action) =>
            action.type === 'speech' ? [action.audioAssetId] : [],
          ),
        ]);

        if (previousAssetIds.length) {
          await this.database.assets.bulkDelete([...new Set(previousAssetIds)]);
        }
        if (previousPages.length) {
          await this.database.lecturePages.bulkDelete(previousPages.map((page) => page.id));
        }
        if (previousDeckIds.length) {
          await this.database.lectureDecks.bulkDelete(previousDeckIds);
        }
        if (assets.length) await this.database.assets.bulkPut(assets);
        if (decks.length) await this.database.lectureDecks.bulkPut(decks);
        if (pages.length) await this.database.lecturePages.bulkPut(pages);
        await this.database.appMetadata.put({
          key: metadataKey,
          value: bundledMiniLectureVersion,
          updatedAt: timestamp,
        });
      },
    );
  }

  private async installBundledMockConversations(): Promise<void> {
    const metadataKey = 'bundled-mock-conversation-version';
    const metadata = await this.database.appMetadata.get(metadataKey);
    if (metadata?.value === bundledMockConversationVersion) return;

    await this.database.transaction(
      'rw',
      [this.database.conversations, this.database.messages, this.database.appMetadata],
      async () => {
        await this.database.messages.bulkDelete(legacyMockMessageIds);
        await this.database.conversations.bulkDelete(legacyMockConversationIds);
        await this.database.conversations.bulkPut(seedConversations);
        await this.database.messages.bulkPut(seedMessages);
        await this.database.appMetadata.put({
          key: metadataKey,
          value: bundledMockConversationVersion,
          updatedAt: Date.now(),
        });
      },
    );
  }

  private async installBundledLearningContent(): Promise<void> {
    const metadataKey = 'bundled-learning-content-version';
    const metadata = await this.database.appMetadata.get(metadataKey);
    if (metadata?.value === bundledLearningContentVersion) return;

    await this.database.transaction(
      'rw',
      [
        this.database.notebooks,
        this.database.markdownSections,
        this.database.studyMemories,
        this.database.appMetadata,
      ],
      async () => {
        await this.database.notebooks.bulkPut(bundledLearningNotebooks);
        await this.database.markdownSections.bulkPut(bundledLearningMarkdownSections);
        await this.database.studyMemories.bulkPut(bundledLearningMemories);
        await this.database.appMetadata.put({
          key: metadataKey,
          value: bundledLearningContentVersion,
          updatedAt: Date.now(),
        });
      },
    );
  }

  async bootstrap(): Promise<void> {
    const isNewDatabase = (await this.database.courses.count()) === 0;
    if (isNewDatabase) {
      await this.database.transaction(
        'rw',
        [
          this.database.courses,
          this.database.notebooks,
          this.database.conversations,
          this.database.messages,
        ],
        async () => {
          await this.database.courses.bulkPut(seedCourses);
          await this.database.notebooks.bulkPut(seedNotebooks);
          await this.database.conversations.bulkPut(seedConversations);
          await this.database.messages.bulkPut(seedMessages);
        },
      );
    }

    const metadataKey = 'bundled-problem-snapshot-version';
    const metadata = await this.database.appMetadata.get(metadataKey);
    if (metadata?.value !== bundledProblemSnapshotVersion) {
      await this.database.transaction(
        'rw',
        [this.database.courses, this.database.problems, this.database.appMetadata],
        async () => {
          const existingCourses = await this.database.courses.bulkGet(
            seedCourses.map((course) => course.id),
          );
          const missingCourses = seedCourses.filter((_, index) => !existingCourses[index]);
          if (missingCourses.length) await this.database.courses.bulkAdd(missingCourses);
          await this.database.problems.bulkDelete(legacyDemoProblemIds);
          await this.database.problems.bulkPut(seedProblems);
          await this.database.appMetadata.put({
            key: metadataKey,
            value: bundledProblemSnapshotVersion,
            updatedAt: Date.now(),
          });
        },
      );
    }
    await this.installBundledLearningContent();
    await this.installBundledMockConversations();
    await this.installBundledCourseEvents();
    await this.installBundledMiniLectures();
  }

  listCourses(): Promise<LocalCourse[]> {
    return this.database.courses.orderBy('updatedAt').reverse().toArray();
  }

  async listCourseSummaries(): Promise<LocalCourseSummary[]> {
    const courses = await this.listCourses();
    return Promise.all(
      courses.map(async (course) => {
        const [notebookCount, problemCount, conversationCount] = await Promise.all([
          this.database.notebooks.where('courseId').equals(course.id).count(),
          this.database.problems.where('courseId').equals(course.id).count(),
          this.database.conversations.where('courseId').equals(course.id).count(),
        ]);
        return { ...course, notebookCount, problemCount, conversationCount };
      }),
    );
  }

  async loadCourseWorkspace(courseId: string): Promise<LocalCourseWorkspace | null> {
    const [course, notebooks, problems, conversations, memories] = await Promise.all([
      this.database.courses.get(courseId),
      this.database.notebooks.where('courseId').equals(courseId).sortBy('updatedAt'),
      this.database.problems.where('courseId').equals(courseId).sortBy('updatedAt'),
      this.database.conversations.where('courseId').equals(courseId).sortBy('updatedAt'),
      this.database.studyMemories.where('courseId').equals(courseId).sortBy('updatedAt'),
    ]);
    if (!course) return null;
    return {
      course,
      notebooks: notebooks.reverse(),
      problems: problems.reverse(),
      conversations: conversations.reverse(),
      memories: memories.filter((memory) => memory.status === 'active').reverse(),
    };
  }

  async loadNotebookDocument(notebookId: string): Promise<LocalNotebookDocument | null> {
    const [notebook, pages, markdownSections] = await Promise.all([
      this.database.notebooks.get(notebookId),
      this.database.notebookPages.where('notebookId').equals(notebookId).sortBy('order'),
      this.database.markdownSections.where('notebookId').equals(notebookId).sortBy('order'),
    ]);
    if (!notebook) return null;
    const pageIds = pages.map((page) => page.id);
    const [pageAssets, notebookAssets] = await Promise.all([
      pageIds.length ? this.database.pageAssets.where('pageId').anyOf(pageIds).sortBy('order') : [],
      this.database.notebookAssets.where('notebookId').equals(notebookId).toArray(),
    ]);
    const assets = (
      await this.database.assets.bulkGet([...new Set(notebookAssets.map((link) => link.assetId))])
    ).filter((asset): asset is LocalAsset => Boolean(asset));
    return { notebook, pages, markdownSections, assets, pageAssets, notebookAssets };
  }

  async loadProblemDocument(problemId: string): Promise<LocalProblemDocument | null> {
    const [problem, attempts, progress] = await Promise.all([
      this.database.problems.get(problemId),
      this.database.problemAttempts.where('problemId').equals(problemId).sortBy('createdAt'),
      this.database.problemProgress.where('problemId').equals(problemId).first(),
    ]);
    if (!problem) return null;
    return {
      problem,
      attempts: attempts.reverse(),
      progress: progress ?? null,
    };
  }

  async listProblemProgress(courseId: string): Promise<LocalProblemProgress[]> {
    const problems = await this.database.problems.where('courseId').equals(courseId).toArray();
    if (!problems.length) return [];
    const progress = await this.database.problemProgress
      .where('problemId')
      .anyOf(problems.map((problem) => problem.id))
      .toArray();
    return progress.sort(
      (left, right) =>
        (right.lastAttemptAt ?? 0) - (left.lastAttemptAt ?? 0) || right.updatedAt - left.updatedAt,
    );
  }

  async saveProblemAttempt(input: SaveProblemAttemptInput): Promise<SaveProblemAttemptResult> {
    const problem = await this.database.problems.get(input.problemId);
    if (!problem) throw new Error('本地找不到这道题。');
    const timestamp = Date.now();
    const attempt: LocalProblemAttempt = {
      id: crypto.randomUUID(),
      problemId: input.problemId,
      kind: 'submit',
      answer: input.answer as unknown as Record<string, unknown>,
      result: input.result ?? (input.feedback ? { feedback: input.feedback } : null),
      score: input.score,
      status: input.status,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const existing =
      (await this.database.problemProgress.where('problemId').equals(input.problemId).first()) ??
      null;
    const passedDelta = input.status === 'passed' ? 1 : 0;
    const progress: LocalProblemProgress = existing
      ? {
          ...existing,
          latestAttemptId: attempt.id,
          status: input.status,
          score: input.score,
          attemptedCount: existing.attemptedCount + 1,
          passedCount: existing.passedCount + passedDelta,
          lastAttemptAt: timestamp,
          updatedAt: timestamp,
        }
      : {
          id: `progress:${input.problemId}`,
          problemId: input.problemId,
          latestAttemptId: attempt.id,
          status: input.status,
          score: input.score,
          attemptedCount: 1,
          passedCount: passedDelta,
          lastAttemptAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

    await this.database.transaction(
      'rw',
      this.database.problemAttempts,
      this.database.problemProgress,
      async () => {
        await this.database.problemAttempts.put(attempt);
        await this.database.problemProgress.put(progress);
      },
    );

    const document = await this.loadProblemDocument(input.problemId);
    if (!document) throw new Error('保存作答后无法重新读取题目。');
    return { attempt, progress, document };
  }

  async searchCourse(courseId: string, query: string): Promise<LocalCourseSearchResult[]> {
    const [notebooks, problems, memories] = await Promise.all([
      this.database.notebooks.where('courseId').equals(courseId).toArray(),
      this.database.problems.where('courseId').equals(courseId).toArray(),
      this.database.studyMemories.where('courseId').equals(courseId).toArray(),
    ]);
    const notebookIds = notebooks.map((notebook) => notebook.id);
    const [sections, pages] = notebookIds.length
      ? await Promise.all([
          this.database.markdownSections.where('notebookId').anyOf(notebookIds).toArray(),
          this.database.notebookPages.where('notebookId').anyOf(notebookIds).toArray(),
        ])
      : [[], []];
    const notebookNames = new Map(notebooks.map((notebook) => [notebook.id, notebook.name]));
    const candidates: LocalCourseSearchResult[] = [
      ...memories
        .filter((memory) => memory.status === 'active')
        .map((memory) => ({
          id: memory.id,
          resourceId: null,
          type: 'memory' as const,
          title: memory.title,
          excerpt: [memory.text, memory.reason, memory.question].filter(Boolean).join('\n'),
          updatedAt: memory.updatedAt,
        })),
      ...sections.map((section) => ({
        id: section.id,
        resourceId: section.notebookId,
        type: 'notebook' as const,
        title: `${notebookNames.get(section.notebookId) || '笔记本'} / ${section.title}`,
        excerpt: [section.summary, section.markdown].filter(Boolean).join('\n'),
        updatedAt: section.updatedAt,
      })),
      ...pages.map((page) => ({
        id: page.id,
        resourceId: page.notebookId,
        type: 'notebook' as const,
        title: `${notebookNames.get(page.notebookId) || '笔记本'} / ${page.title}`,
        excerpt: JSON.stringify(page.content),
        updatedAt: page.updatedAt,
      })),
      ...problems
        .filter((problem) => problem.status !== 'archived')
        .map((problem) => ({
          id: problem.id,
          resourceId: problem.id,
          type: 'problem' as const,
          title: problem.title,
          excerpt: `${problem.tags.join(' ')}\n${JSON.stringify(problem.publicContent)}`,
          updatedAt: problem.updatedAt,
        })),
    ];
    return rankCourseSearchResults(candidates, query);
  }

  listMessages(conversationId: string): Promise<LocalMessage[]> {
    return this.database.messages
      .where('[conversationId+createdAt]')
      .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
      .toArray();
  }

  async getCourseLearningState(courseId: string): Promise<LocalCourseLearningState | null> {
    const [course, notebooks, metadata] = await Promise.all([
      this.database.courses.get(courseId),
      this.database.notebooks.where('courseId').equals(courseId).toArray(),
      this.database.appMetadata.get(courseLearningStateMetadataKey(courseId)),
    ]);
    if (!course || !metadata) return null;
    return parseCourseLearningState(
      metadata.value,
      courseId,
      new Set(notebooks.map((notebook) => notebook.id)),
      metadata.updatedAt,
    );
  }

  async saveCourseLearningState(
    input: SaveCourseLearningStateInput,
  ): Promise<LocalCourseLearningState> {
    return this.database.transaction(
      'rw',
      [this.database.courses, this.database.notebooks, this.database.appMetadata],
      async () => {
        const [course, notebooks, metadata] = await Promise.all([
          this.database.courses.get(input.courseId),
          this.database.notebooks.where('courseId').equals(input.courseId).toArray(),
          this.database.appMetadata.get(courseLearningStateMetadataKey(input.courseId)),
        ]);
        if (!course) throw new Error('本地找不到这门课程。');

        const notebookIds = new Set(notebooks.map((notebook) => notebook.id));
        const existing = metadata
          ? parseCourseLearningState(
              metadata.value,
              input.courseId,
              notebookIds,
              metadata.updatedAt,
            )
          : null;
        const state = normalizeCourseLearningState(input, notebookIds, existing);
        await this.database.appMetadata.put({
          key: courseLearningStateMetadataKey(input.courseId),
          value: JSON.stringify(state),
          updatedAt: state.updatedAt,
        });
        return state;
      },
    );
  }

  async listCourseEvents(courseId: string): Promise<LocalCourseEvent[]> {
    const events = await this.database.courseEvents
      .where('[courseId+date]')
      .between([courseId, Dexie.minKey], [courseId, Dexie.maxKey])
      .toArray();
    return events.filter((event) => event.status === 'active');
  }

  async upsertCourseEvents(events: LocalCourseEvent[]): Promise<void> {
    if (!events.length) return;
    const coursesById = eventCoursesById(events);
    await this.database.transaction('rw', this.database.courseEvents, async () => {
      const existing = await this.database.courseEvents.bulkGet([...coursesById.keys()]);
      const collision = existing.find(
        (event) => event && coursesById.get(event.id) !== event.courseId,
      );
      if (collision) {
        throw new Error(`日历事项 ${collision.id} 已属于其他课程，已阻止覆盖。`);
      }
      await this.database.courseEvents.bulkPut(events);
    });
  }

  async deleteCourseEvent(courseId: string, eventId: string): Promise<void> {
    const event = await this.database.courseEvents.get(eventId);
    if (!event || event.courseId !== courseId) return;
    await this.database.courseEvents.delete(eventId);
  }

  async listMiniLectureDecks(conversationId: string): Promise<PersistedMiniLectureDeck[]> {
    const messages = await this.listMessages(conversationId);
    if (!messages.length) return [];
    const messageOrder = new Map(messages.map((message, index) => [message.id, index]));
    const decks = await this.database.lectureDecks
      .where('messageId')
      .anyOf(messages.map((message) => message.id))
      .toArray();
    return decks
      .filter((deck) => deck.status !== 'archived')
      .sort(
        (left, right) =>
          (messageOrder.get(left.messageId) ?? Number.MAX_SAFE_INTEGER) -
            (messageOrder.get(right.messageId) ?? Number.MAX_SAFE_INTEGER) ||
          left.createdAt - right.createdAt,
      );
  }

  async loadMiniLectureDeck(deckId: string): Promise<RuntimeMiniLectureDeck | null> {
    const [deck, pages] = await Promise.all([
      this.database.lectureDecks.get(deckId),
      this.database.lecturePages.where('deckId').equals(deckId).sortBy('order'),
    ]);
    if (!deck) return null;

    const assetIds = pages.flatMap((page) => [
      page.imageAssetId,
      ...page.actions.flatMap((action) => (action.type === 'speech' ? [action.audioAssetId] : [])),
    ]);
    const assets = await this.database.assets.bulkGet([...new Set(assetIds)]);
    const assetsById = new Map(
      assets.flatMap((asset) => (asset ? [[asset.id, asset] as const] : [])),
    );
    const runtimePages: RuntimeMiniLectureDeck['pages'] = [];

    for (const page of pages) {
      const imageUrl = browserAssetUrl(assetsById.get(page.imageAssetId));
      if (!imageUrl) return null;
      const actions: RuntimeMiniLectureAction[] = [];
      for (const action of page.actions) {
        if (action.type === 'spotlight') {
          actions.push(action);
          continue;
        }
        const audioUrl = browserAssetUrl(assetsById.get(action.audioAssetId));
        if (!audioUrl) return null;
        actions.push({ ...action, audioUrl });
      }
      runtimePages.push({ ...page, imageUrl, actions });
    }

    return { ...deck, pages: runtimePages };
  }

  async saveMiniLectureDocument(input: SaveMiniLectureInput): Promise<PersistedMiniLectureDeck> {
    const { document, assets } = input;
    if (
      document.deck.status !== 'ready' ||
      !document.pages.length ||
      document.pages.some((page) => page.recoveryStatus !== 'passed')
    ) {
      throw new Error('课堂讲解尚未完成图片标记恢复，不能保存为可播放课堂。');
    }
    if (assets.some((asset) => !asset.dataBase64 && !asset.path.startsWith('http'))) {
      throw new Error('课堂图片或语音资源不完整。');
    }

    await this.database.transaction(
      'rw',
      [
        this.database.assets,
        this.database.pageAssets,
        this.database.notebookAssets,
        this.database.lectureDecks,
        this.database.lecturePages,
      ],
      async () => {
        const existing = await this.database.lectureDecks
          .where('messageId')
          .equals(document.deck.messageId)
          .toArray();
        const existingDeckIds = existing.map((deck) => deck.id);
        const previousPages = existingDeckIds.length
          ? await this.database.lecturePages.where('deckId').anyOf(existingDeckIds).toArray()
          : [];
        const previousAssetIds = miniLectureAssetIds(previousPages);
        const replacedIds = existingDeckIds.filter((deckId) => deckId !== document.deck.id);
        if (replacedIds.length) {
          await this.database.lecturePages.where('deckId').anyOf(replacedIds).delete();
          await this.database.lectureDecks.bulkDelete(replacedIds);
        }
        await this.database.assets.bulkPut(assets);
        await this.database.lectureDecks.put(document.deck);
        await this.database.lecturePages.where('deckId').equals(document.deck.id).delete();
        await this.database.lecturePages.bulkPut(document.pages);

        if (previousAssetIds.size) {
          const allLecturePages = await this.database.lecturePages.toArray();
          const referencedAssetIds = miniLectureAssetIds(allLecturePages);
          const candidateIds = [...previousAssetIds];
          const [pageLinks, notebookLinks] = await Promise.all([
            this.database.pageAssets.where('assetId').anyOf(candidateIds).toArray(),
            this.database.notebookAssets.where('assetId').anyOf(candidateIds).toArray(),
          ]);
          for (const link of pageLinks) referencedAssetIds.add(link.assetId);
          for (const link of notebookLinks) referencedAssetIds.add(link.assetId);
          const orphanAssetIds = candidateIds.filter((assetId) => !referencedAssetIds.has(assetId));
          if (orphanAssetIds.length) await this.database.assets.bulkDelete(orphanAssetIds);
        }
      },
    );
    return document.deck;
  }

  async createCourse(input: NewCourseInput): Promise<LocalCourse> {
    const timestamp = Date.now();
    const course: LocalCourse = {
      id: crypto.randomUUID(),
      name: input.name.trim() || '未命名课程',
      description: input.description?.trim() || '保存在本机的课程',
      language: 'zh-CN',
      tags: [],
      purpose: input.purpose ?? 'daily',
      university: null,
      courseCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.database.courses.put(course);
    return course;
  }

  async updateCourse(input: UpdateCourseInput): Promise<LocalCourse> {
    const current = await this.database.courses.get(input.id);
    if (!current) throw new Error('本地找不到这门课程。');
    const course: LocalCourse = {
      ...current,
      name: input.name.trim() || '未命名课程',
      description: input.description.trim(),
      courseCode: input.courseCode?.trim() || null,
      updatedAt: Date.now(),
    };
    await this.database.courses.put(course);
    return course;
  }

  async createConversation(courseId: string, title: string): Promise<LocalConversation> {
    const timestamp = Date.now();
    const conversation: LocalConversation = {
      id: crypto.randomUUID(),
      courseId,
      notebookId: null,
      title: title.trim() || '新对话',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.database.conversations.put(conversation);
    return conversation;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.conversations,
      this.database.messages,
      async () => {
        await this.database.messages.where('conversationId').equals(conversationId).delete();
        await this.database.conversations.delete(conversationId);
      },
    );
  }

  async appendMessage(input: AppendMessageInput): Promise<LocalMessage> {
    const message: LocalMessage = {
      id: crypto.randomUUID(),
      conversationId: input.conversationId,
      role: input.role,
      text: input.text,
      createdAt: Date.now(),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    await this.database.transaction(
      'rw',
      this.database.messages,
      this.database.conversations,
      async () => {
        await this.database.messages.put(message);
        await this.database.conversations.update(input.conversationId, {
          updatedAt: message.createdAt,
        });
      },
    );
    return message;
  }

  async updateMessageMetadata(messageId: string, metadata: NativeMessageMetadata): Promise<void> {
    await this.database.messages.update(messageId, { metadata });
  }

  async upsertStudyMemory(memory: LocalStudyMemory): Promise<LocalStudyMemory> {
    await this.database.studyMemories.put(memory);
    return memory;
  }

  async archiveStudyMemory(memoryId: string): Promise<void> {
    await this.database.studyMemories.update(memoryId, {
      status: 'archived',
      updatedAt: Date.now(),
    });
  }

  async importTextMaterial(input: ImportTextMaterialInput): Promise<LocalNotebook> {
    const timestamp = Date.now();
    const notebook: LocalNotebook = {
      id: crypto.randomUUID(),
      courseId: input.courseId,
      name: input.name.trim() || '未命名资料',
      description:
        input.source === 'syllabus'
          ? '从 syllabus 导入的本机资料'
          : input.source === 'notes'
            ? '上传到本机的笔记资料'
            : '从聊天页导入的本机资料',
      kind: 'markdown',
      tags: [
        input.source === 'syllabus'
          ? 'syllabus'
          : input.source === 'notes'
            ? '上传笔记'
            : '聊天资料',
      ],
      sectionCount: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const section: LocalMarkdownSection = {
      id: crypto.randomUUID(),
      notebookId: notebook.id,
      courseId: notebook.courseId,
      title: notebook.name,
      order: 0,
      markdown: input.text,
      summary: input.text.slice(0, 240),
      sourceMeta: { source: input.source, importedLocally: true },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.database.transaction(
      'rw',
      this.database.notebooks,
      this.database.markdownSections,
      this.database.courses,
      async () => {
        await this.database.notebooks.put(notebook);
        await this.database.markdownSections.put(section);
        await this.database.courses.update(input.courseId, { updatedAt: timestamp });
      },
    );
    return notebook;
  }

  async importTextProblem(input: ImportTextProblemInput): Promise<LocalProblem> {
    const timestamp = Date.now();
    const title = input.name.replace(/\.[^.]+$/, '').trim() || input.name.trim() || '导入题目';
    const problem: LocalProblem = {
      id: crypto.randomUUID(),
      courseId: input.courseId,
      notebookId: null,
      title,
      type: 'short_answer',
      status: 'published',
      difficulty: 'medium',
      tags: ['本地导入'],
      publicContent: {
        type: 'short_answer',
        stem: input.text,
        assets: { images: [] },
      },
      grading: {
        type: 'short_answer',
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.database.transaction(
      'rw',
      this.database.problems,
      this.database.courses,
      async () => {
        await this.database.problems.put(problem);
        await this.database.courses.update(input.courseId, { updatedAt: timestamp });
      },
    );
    return problem;
  }

  async importArchive(archive: SyntaraArchiveV1): Promise<ArchiveImportSummary> {
    await this.database.transaction(
      'rw',
      [
        this.database.courses,
        this.database.notebooks,
        this.database.notebookPages,
        this.database.markdownSections,
        this.database.problems,
        this.database.problemAttempts,
        this.database.problemProgress,
        this.database.conversations,
        this.database.messages,
        this.database.studyMemories,
        this.database.assets,
        this.database.pageAssets,
        this.database.notebookAssets,
      ],
      async () => {
        await this.database.courses.bulkPut(archive.courses);
        await this.database.notebooks.bulkPut(archive.notebooks);
        await this.database.notebookPages.bulkPut(archive.notebookPages);
        await this.database.markdownSections.bulkPut(archive.markdownSections);
        await this.database.problems.bulkPut(archive.problems);
        await this.database.problemAttempts.bulkPut(archive.problemAttempts);
        await this.database.problemProgress.bulkPut(archive.problemProgress);
        await this.database.conversations.bulkPut(archive.conversations);
        await this.database.messages.bulkPut(archive.messages);
        await this.database.studyMemories.bulkPut(archive.studyMemories);
        await this.database.assets.bulkPut(archive.assets);
        await this.database.pageAssets.bulkPut(archive.pageAssets);
        await this.database.notebookAssets.bulkPut(archive.notebookAssets);
      },
    );
    return summarizeArchive(archive);
  }
}
