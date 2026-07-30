import Database from '@tauri-apps/plugin-sql';
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
import { courseSearchTerms } from './course-search';
import type { ArchiveImportSummary, SyntaraArchiveV1 } from './archive';
import { summarizeArchive } from './archive';
import {
  deleteLocalAssetFiles,
  persistArchiveAssets,
  readLocalAsset,
  verifyLocalAssets,
} from './asset-storage';
import {
  bundledMiniLectureSeed,
  materializeBundledMiniLectureAssets,
  type BundledMiniLectureSeed,
} from './bundled-mini-lecture-package';
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
import { NATIVE_MAT136_MOCK_EXAM } from './mock-review-plan';

type SqlRow = Record<string, unknown>;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' ? value : Number(value) || 0;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

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

function jsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapCourse(row: SqlRow): LocalCourse {
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    description: stringValue(row.description),
    language: stringValue(row.language) === 'en-US' ? 'en-US' : 'zh-CN',
    tags: jsonValue<string[]>(row.tags_json, []),
    purpose: stringValue(row.purpose) as LocalCourse['purpose'],
    university: nullableString(row.university),
    courseCode: nullableString(row.course_code),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function mapCourseSummary(row: SqlRow): LocalCourseSummary {
  return {
    ...mapCourse(row),
    notebookCount: numberValue(row.notebook_count),
    problemCount: numberValue(row.problem_count),
    conversationCount: numberValue(row.conversation_count),
  };
}

function mapNotebook(row: SqlRow): LocalNotebook {
  return {
    id: stringValue(row.id),
    courseId: stringValue(row.course_id),
    name: stringValue(row.name),
    description: stringValue(row.description),
    kind: stringValue(row.kind) === 'markdown' ? 'markdown' : 'image',
    tags: jsonValue<string[]>(row.tags_json, []),
    sectionCount: numberValue(row.section_count),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function mapProblem(row: SqlRow): LocalProblem {
  return {
    id: stringValue(row.id),
    courseId: stringValue(row.course_id),
    notebookId: nullableString(row.notebook_id),
    title: stringValue(row.title),
    type: stringValue(row.type),
    status: stringValue(row.status) as LocalProblem['status'],
    difficulty: stringValue(row.difficulty) as LocalProblem['difficulty'],
    tags: jsonValue<string[]>(row.tags_json, []),
    publicContent: jsonValue<Record<string, unknown>>(row.public_content_json, {}),
    grading: jsonValue<Record<string, unknown>>(row.grading_json, {}),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function mapConversation(row: SqlRow): LocalConversation {
  return {
    id: stringValue(row.id),
    courseId: stringValue(row.course_id),
    notebookId: nullableString(row.notebook_id),
    title: stringValue(row.title),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function mapMessage(row: SqlRow): LocalMessage {
  const metadata = jsonValue<NativeMessageMetadata>(row.metadata_json, {});
  return {
    id: stringValue(row.id),
    conversationId: stringValue(row.conversation_id),
    role: stringValue(row.role) as LocalMessage['role'],
    text: stringValue(row.text),
    createdAt: numberValue(row.created_at),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function mapNotebookPage(row: SqlRow): LocalNotebookPage {
  return {
    id: stringValue(row.id),
    notebookId: stringValue(row.notebook_id),
    courseId: nullableString(row.course_id),
    sourceSceneId: nullableString(row.source_scene_id),
    title: stringValue(row.title),
    type: stringValue(row.type),
    order: numberValue(row.sort_order),
    content: jsonValue<Record<string, unknown>>(row.content_json, {}),
    actions: jsonValue<unknown[]>(row.actions_json, []),
    whiteboard: row.whiteboard_json
      ? jsonValue<Record<string, unknown>>(row.whiteboard_json, {})
      : null,
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function mapMarkdownSection(row: SqlRow): LocalMarkdownSection {
  return {
    id: stringValue(row.id),
    notebookId: stringValue(row.notebook_id),
    courseId: nullableString(row.course_id),
    title: stringValue(row.title),
    order: numberValue(row.sort_order),
    markdown: stringValue(row.markdown),
    summary: nullableString(row.summary),
    sourceMeta: jsonValue<Record<string, unknown>>(row.source_meta_json, {}),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function mapAsset(row: SqlRow): LocalAsset {
  return {
    id: stringValue(row.id),
    path: stringValue(row.path),
    mimeType: stringValue(row.mime_type),
    sizeBytes: numberValue(row.size_bytes),
    sha256: stringValue(row.sha256),
    source: nullableString(row.source),
    dataBase64: nullableString(row.data_base64),
    storagePath: nullableString(row.storage_path),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function mapPageAsset(row: SqlRow): LocalPageAsset {
  return {
    id: stringValue(row.id),
    pageId: stringValue(row.page_id),
    assetId: stringValue(row.asset_id),
    role: stringValue(row.role),
    order: numberValue(row.sort_order),
    meta: jsonValue<Record<string, unknown>>(row.meta_json, {}),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function mapNotebookAsset(row: SqlRow): LocalNotebookAssetLink {
  return {
    id: stringValue(row.id),
    notebookId: stringValue(row.notebook_id),
    assetId: stringValue(row.asset_id),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function mapProblemAttempt(row: SqlRow): LocalProblemAttempt {
  return {
    id: stringValue(row.id),
    problemId: stringValue(row.problem_id),
    kind: stringValue(row.kind),
    answer: jsonValue<Record<string, unknown>>(row.answer_json, {}),
    result: row.result_json ? jsonValue<Record<string, unknown>>(row.result_json, {}) : null,
    score: row.score === null || row.score === undefined ? null : numberValue(row.score),
    status: stringValue(row.status),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function mapProblemProgress(row: SqlRow): LocalProblemProgress {
  return {
    id: stringValue(row.id),
    problemId: stringValue(row.problem_id),
    latestAttemptId: nullableString(row.latest_attempt_id),
    status: stringValue(row.status),
    score: row.score === null || row.score === undefined ? null : numberValue(row.score),
    attemptedCount: numberValue(row.attempted_count),
    passedCount: numberValue(row.passed_count),
    lastAttemptAt:
      row.last_attempt_at === null || row.last_attempt_at === undefined
        ? null
        : numberValue(row.last_attempt_at),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function mapCourseSearchResult(row: SqlRow): LocalCourseSearchResult | null {
  const type = stringValue(row.source_type);
  if (type !== 'memory' && type !== 'notebook' && type !== 'problem') return null;
  const id = stringValue(row.source_id);
  if (!id) return null;
  return {
    id,
    resourceId: nullableString(row.resource_id),
    type,
    title: stringValue(row.title),
    excerpt: stringValue(row.excerpt),
    updatedAt: numberValue(row.updated_at),
  };
}

function mapStudyMemory(row: SqlRow): LocalStudyMemory {
  return {
    id: stringValue(row.id),
    courseId: nullableString(row.course_id),
    notebookId: nullableString(row.notebook_id),
    targetType: stringValue(row.target_type),
    scope: stringValue(row.scope),
    kind: stringValue(row.kind),
    status: stringValue(row.status),
    source: stringValue(row.source),
    title: stringValue(row.title),
    text: stringValue(row.text),
    reason: nullableString(row.reason),
    question: nullableString(row.question),
    sourceReferences: jsonValue<unknown[]>(row.source_references_json, []),
    confidence:
      row.confidence === null || row.confidence === undefined ? null : numberValue(row.confidence),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function mapCourseEvent(row: SqlRow): LocalCourseEvent {
  return {
    id: stringValue(row.id),
    courseId: stringValue(row.course_id),
    title: stringValue(row.title),
    date: stringValue(row.event_date),
    note: stringValue(row.note),
    kind: stringValue(row.kind) as LocalCourseEvent['kind'],
    source: stringValue(row.source) as LocalCourseEvent['source'],
    status: stringValue(row.status) as LocalCourseEvent['status'],
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function mapMiniLectureDeck(row: SqlRow): PersistedMiniLectureDeck {
  return {
    id: stringValue(row.id),
    messageId: stringValue(row.message_id),
    title: stringValue(row.title),
    origin: stringValue(row.origin) as PersistedMiniLectureDeck['origin'],
    packageName: nullableString(row.package_name),
    packageVersion: numberValue(row.package_version),
    status: stringValue(row.status) as PersistedMiniLectureDeck['status'],
    generatorMeta: jsonValue<PersistedMiniLectureDeck['generatorMeta']>(
      row.generator_meta_json,
      {},
    ),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function mapMiniLecturePage(row: SqlRow): PersistedMiniLecturePage {
  return {
    id: stringValue(row.id),
    deckId: stringValue(row.deck_id),
    order: numberValue(row.sort_order),
    title: stringValue(row.title),
    imageAssetId: stringValue(row.image_asset_id),
    width: numberValue(row.width),
    height: numberValue(row.height),
    recoveryStatus: stringValue(row.recovery_status) as PersistedMiniLecturePage['recoveryStatus'],
    regions: jsonValue<PersistedMiniLecturePage['regions']>(row.regions_json, []),
    actions: jsonValue<PersistedMiniLectureAction[]>(row.actions_json, []),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

export class SqliteLocalRepository implements LocalRepository {
  readonly kind = 'sqlite' as const;
  private connection: Database | null = null;
  private bootstrapTask: Promise<void> | null = null;

  private async database(): Promise<Database> {
    if (!this.connection) {
      this.connection = await Database.load('sqlite:syntara-local.db');
    }
    return this.connection;
  }

  private async migrateEmbeddedAssets(database: Database): Promise<void> {
    while (true) {
      const rows = await database.select<SqlRow[]>(
        `SELECT *
           FROM assets
          WHERE data_base64 IS NOT NULL AND storage_path IS NULL
          LIMIT 4`,
      );
      if (!rows.length) return;
      const assets = rows.map(mapAsset);
      let persisted: Map<string, string>;
      try {
        persisted = await persistArchiveAssets(assets);
      } catch (cause) {
        console.warn('Unable to move legacy assets to App Data.', cause);
        return;
      }
      if (!persisted.size) return;
      for (const asset of assets) {
        const storagePath = persisted.get(asset.id);
        if (!storagePath) continue;
        await database.execute(
          `UPDATE assets
              SET storage_path = $1, data_base64 = NULL
            WHERE id = $2`,
          [storagePath, asset.id],
        );
      }
    }
  }

  private async installBundledProblemSnapshot(database: Database): Promise<void> {
    const metadataKey = 'bundled-problem-snapshot-version';
    const metadata = await database.select<Array<{ value: string }>>(
      'SELECT value FROM app_metadata WHERE key = $1 LIMIT 1',
      [metadataKey],
    );
    if (metadata[0]?.value === bundledProblemSnapshotVersion) return;

    await database.execute('BEGIN IMMEDIATE');
    try {
      for (const course of seedCourses) {
        await database.execute(
          `INSERT INTO courses
            (id, name, description, language, tags_json, purpose, university, course_code,
             created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT(id) DO NOTHING`,
          [
            course.id,
            course.name,
            course.description,
            course.language,
            JSON.stringify(course.tags),
            course.purpose,
            course.university,
            course.courseCode,
            course.createdAt,
            course.updatedAt,
          ],
        );
      }
      for (const problemId of legacyDemoProblemIds) {
        await database.execute('DELETE FROM problems WHERE id = $1', [problemId]);
      }
      for (const problemBatch of chunks(seedProblems, 50)) {
        const bindings: unknown[] = [];
        const valueGroups = problemBatch.map((problem, rowIndex) => {
          const firstParameter = rowIndex * 12 + 1;
          bindings.push(
            problem.id,
            problem.courseId,
            problem.notebookId,
            problem.title,
            problem.type,
            problem.status,
            problem.difficulty,
            JSON.stringify(problem.tags),
            JSON.stringify(problem.publicContent),
            JSON.stringify(problem.grading),
            problem.createdAt,
            problem.updatedAt,
          );
          return `(${Array.from(
            { length: 12 },
            (_, parameterIndex) => `$${firstParameter + parameterIndex}`,
          ).join(', ')})`;
        });
        await database.execute(
          `INSERT INTO problems
            (id, course_id, notebook_id, title, type, status, difficulty, tags_json,
             public_content_json, grading_json, created_at, updated_at)
           VALUES ${valueGroups.join(', ')}
           ON CONFLICT(id) DO UPDATE SET
             course_id = excluded.course_id, notebook_id = excluded.notebook_id,
             title = excluded.title, type = excluded.type, status = excluded.status,
             difficulty = excluded.difficulty, tags_json = excluded.tags_json,
             public_content_json = excluded.public_content_json,
             grading_json = excluded.grading_json, created_at = excluded.created_at,
             updated_at = excluded.updated_at`,
          bindings,
        );
      }
      await database.execute(
        `INSERT INTO app_metadata (key, value, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [metadataKey, bundledProblemSnapshotVersion, Date.now()],
      );
      await database.execute('COMMIT');
    } catch (cause) {
      await database.execute('ROLLBACK').catch(() => undefined);
      throw cause;
    }
  }

  private async installBundledLearningContent(database: Database): Promise<void> {
    const metadataKey = 'bundled-learning-content-version';
    const metadata = await database.select<Array<{ value: string }>>(
      'SELECT value FROM app_metadata WHERE key = $1 LIMIT 1',
      [metadataKey],
    );
    if (metadata[0]?.value === bundledLearningContentVersion) return;

    await database.execute('BEGIN IMMEDIATE');
    try {
      for (const notebook of bundledLearningNotebooks) {
        await database.execute(
          `INSERT INTO notebooks
            (id, course_id, name, description, kind, tags_json, section_count, created_at,
             updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT(id) DO UPDATE SET
             course_id = excluded.course_id, name = excluded.name,
             description = excluded.description, kind = excluded.kind,
             tags_json = excluded.tags_json, section_count = excluded.section_count,
             updated_at = excluded.updated_at`,
          [
            notebook.id,
            notebook.courseId,
            notebook.name,
            notebook.description,
            notebook.kind,
            JSON.stringify(notebook.tags),
            notebook.sectionCount,
            notebook.createdAt,
            notebook.updatedAt,
          ],
        );
      }
      for (const section of bundledLearningMarkdownSections) {
        await database.execute(
          `INSERT INTO markdown_sections
            (id, notebook_id, course_id, title, sort_order, markdown, summary,
             source_meta_json, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT(id) DO UPDATE SET
             notebook_id = excluded.notebook_id, course_id = excluded.course_id,
             title = excluded.title, sort_order = excluded.sort_order,
             markdown = excluded.markdown, summary = excluded.summary,
             source_meta_json = excluded.source_meta_json, updated_at = excluded.updated_at`,
          [
            section.id,
            section.notebookId,
            section.courseId,
            section.title,
            section.order,
            section.markdown,
            section.summary,
            JSON.stringify(section.sourceMeta),
            section.createdAt,
            section.updatedAt,
          ],
        );
      }
      for (const memory of bundledLearningMemories) {
        await database.execute(
          `INSERT INTO study_memories
            (id, course_id, notebook_id, target_type, scope, kind, status, source, title,
             text, reason, question, source_references_json, confidence, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           ON CONFLICT(id) DO UPDATE SET
             course_id = excluded.course_id, notebook_id = excluded.notebook_id,
             target_type = excluded.target_type, scope = excluded.scope, kind = excluded.kind,
             status = excluded.status, source = excluded.source, title = excluded.title,
             text = excluded.text, reason = excluded.reason, question = excluded.question,
             source_references_json = excluded.source_references_json,
             confidence = excluded.confidence, updated_at = excluded.updated_at`,
          [
            memory.id,
            memory.courseId,
            memory.notebookId,
            memory.targetType,
            memory.scope,
            memory.kind,
            memory.status,
            memory.source,
            memory.title,
            memory.text,
            memory.reason,
            memory.question,
            JSON.stringify(memory.sourceReferences),
            memory.confidence,
            memory.createdAt,
            memory.updatedAt,
          ],
        );
      }
      await database.execute(
        `INSERT INTO app_metadata (key, value, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [metadataKey, bundledLearningContentVersion, Date.now()],
      );
      await database.execute('COMMIT');
    } catch (cause) {
      await database.execute('ROLLBACK').catch(() => undefined);
      throw cause;
    }
  }

  private async installBundledMockConversations(database: Database): Promise<void> {
    const metadataKey = 'bundled-mock-conversation-version';
    const metadata = await database.select<Array<{ value: string }>>(
      'SELECT value FROM app_metadata WHERE key = $1 LIMIT 1',
      [metadataKey],
    );
    if (metadata[0]?.value === bundledMockConversationVersion) return;

    await database.execute('BEGIN IMMEDIATE');
    try {
      for (const messageId of legacyMockMessageIds) {
        await database.execute('DELETE FROM messages WHERE id = $1', [messageId]);
      }
      for (const conversationId of legacyMockConversationIds) {
        await database.execute('DELETE FROM conversations WHERE id = $1', [conversationId]);
      }
      for (const conversation of seedConversations) {
        await database.execute(
          `INSERT INTO conversations
            (id, course_id, notebook_id, title, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT(id) DO UPDATE SET
             course_id = excluded.course_id, notebook_id = excluded.notebook_id,
             title = excluded.title, updated_at = excluded.updated_at`,
          [
            conversation.id,
            conversation.courseId,
            conversation.notebookId,
            conversation.title,
            conversation.createdAt,
            conversation.updatedAt,
          ],
        );
      }
      for (const message of seedMessages) {
        await database.execute(
          `INSERT INTO messages (id, conversation_id, role, text, metadata_json, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT(id) DO UPDATE SET
             conversation_id = excluded.conversation_id, role = excluded.role,
             text = excluded.text, metadata_json = excluded.metadata_json,
             created_at = excluded.created_at`,
          [
            message.id,
            message.conversationId,
            message.role,
            message.text,
            JSON.stringify(message.metadata ?? {}),
            message.createdAt,
          ],
        );
      }
      await database.execute(
        `INSERT INTO app_metadata (key, value, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [metadataKey, bundledMockConversationVersion, Date.now()],
      );
      await database.execute('COMMIT');
    } catch (cause) {
      await database.execute('ROLLBACK').catch(() => undefined);
      throw cause;
    }
  }

  private async installBundledCourseEvents(database: Database): Promise<void> {
    const metadataKey = 'bundled-course-events-version';
    const version = 'mat136-review-plan-v1';
    const metadata = await database.select<Array<{ value: string }>>(
      'SELECT value FROM app_metadata WHERE key = $1 LIMIT 1',
      [metadataKey],
    );
    if (metadata[0]?.value === version) return;

    const timestamp = Date.UTC(2026, 6, 28, 0, 0, 0);
    await database.execute(
      `INSERT INTO course_events
          (id, course_id, title, event_date, note, kind, source, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'exam', 'bundled', 'active', $6, $7)
         ON CONFLICT(id) DO NOTHING`,
      [
        NATIVE_MAT136_MOCK_EXAM.id,
        'course-mat136-local',
        NATIVE_MAT136_MOCK_EXAM.title,
        NATIVE_MAT136_MOCK_EXAM.date,
        NATIVE_MAT136_MOCK_EXAM.note,
        timestamp,
        timestamp,
      ],
    );
    await database.execute(
      `INSERT INTO app_metadata (key, value, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [metadataKey, version, Date.now()],
    );
  }

  private async bundledMiniLecturesAreComplete(
    database: Database,
    seed: BundledMiniLectureSeed,
  ): Promise<boolean> {
    const deckIds = seed.documents.map(({ deck }) => deck.id);
    const pageIds = seed.documents.flatMap(({ pages }) => pages.map((page) => page.id));
    const assetIds = seed.assets.map((asset) => asset.id);
    if (!deckIds.length || !pageIds.length || !assetIds.length) return false;

    const selectByIds = (table: string, ids: string[]) =>
      database.select<SqlRow[]>(
        `SELECT * FROM ${table} WHERE id IN (${ids.map((_, index) => `$${index + 1}`).join(', ')})`,
        ids,
      );
    const [deckRows, pageRows, assetRows] = await Promise.all([
      selectByIds('lecture_decks', deckIds),
      selectByIds('lecture_pages', pageIds),
      selectByIds('assets', assetIds),
    ]);
    if (
      deckRows.length !== deckIds.length ||
      pageRows.length !== pageIds.length ||
      assetRows.length !== assetIds.length
    ) {
      return false;
    }
    const expectedDecks = new Map(seed.documents.map(({ deck }) => [deck.id, deck]));
    if (
      deckRows.some((row) => {
        const expected = expectedDecks.get(stringValue(row.id));
        return (
          !expected ||
          stringValue(row.message_id) !== expected.messageId ||
          stringValue(row.status) !== 'ready' ||
          numberValue(row.package_version) !== expected.packageVersion
        );
      })
    ) {
      return false;
    }
    return verifyLocalAssets(assetRows.map(mapAsset));
  }

  private async installBundledMiniLectures(database: Database): Promise<void> {
    const metadataKey = 'bundled-mini-lecture-version';
    const seed = bundledMiniLectureSeed();
    const metadata = await database.select<Array<{ value: string }>>(
      'SELECT value FROM app_metadata WHERE key = $1 LIMIT 1',
      [metadataKey],
    );
    if (
      metadata[0]?.value === seed.version &&
      (await this.bundledMiniLecturesAreComplete(database, seed))
    ) {
      return;
    }

    const assets = await materializeBundledMiniLectureAssets(seed.assets);
    const persistedAssets = await persistArchiveAssets(assets);
    if (persistedAssets.size !== assets.length) {
      throw new Error('内置课堂资源没有完整写入 App Data。');
    }

    for (const asset of assets) {
      const storagePath = persistedAssets.get(asset.id);
      if (!storagePath) throw new Error(`课堂资源缺少本机路径：${asset.path}`);
      await database.execute(
        `INSERT INTO assets
            (id, path, mime_type, size_bytes, sha256, source, data_base64, storage_path,
             created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9)
           ON CONFLICT(id) DO UPDATE SET
             path = excluded.path, mime_type = excluded.mime_type,
             size_bytes = excluded.size_bytes, sha256 = excluded.sha256,
             source = excluded.source, data_base64 = NULL,
             storage_path = excluded.storage_path, updated_at = excluded.updated_at`,
        [
          asset.id,
          asset.path,
          asset.mimeType,
          asset.sizeBytes,
          asset.sha256,
          asset.source,
          storagePath,
          asset.createdAt,
          asset.updatedAt,
        ],
      );
    }

    for (const document of seed.documents) {
      const { deck } = document;
      await database.execute('DELETE FROM lecture_decks WHERE message_id = $1 AND id <> $2', [
        deck.messageId,
        deck.id,
      ]);
      await database.execute(
        `INSERT INTO lecture_decks
            (id, message_id, title, origin, package_name, package_version, status,
             generator_meta_json, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT(id) DO UPDATE SET
             message_id = excluded.message_id, title = excluded.title,
             origin = excluded.origin, package_name = excluded.package_name,
             package_version = excluded.package_version, status = excluded.status,
             generator_meta_json = excluded.generator_meta_json,
             updated_at = excluded.updated_at`,
        [
          deck.id,
          deck.messageId,
          deck.title,
          deck.origin,
          deck.packageName,
          deck.packageVersion,
          deck.status,
          JSON.stringify(deck.generatorMeta),
          deck.createdAt,
          deck.updatedAt,
        ],
      );
      await database.execute('DELETE FROM lecture_pages WHERE deck_id = $1', [deck.id]);
      for (const page of document.pages) {
        await database.execute(
          `INSERT INTO lecture_pages
              (id, deck_id, sort_order, title, image_asset_id, width, height, recovery_status,
               regions_json, actions_json, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            page.id,
            page.deckId,
            page.order,
            page.title,
            page.imageAssetId,
            page.width,
            page.height,
            page.recoveryStatus,
            JSON.stringify(page.regions),
            JSON.stringify(page.actions),
            page.createdAt,
            page.updatedAt,
          ],
        );
      }
    }
    await database.execute(
      `INSERT INTO app_metadata (key, value, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [metadataKey, seed.version, Date.now()],
    );
  }

  async bootstrap(): Promise<void> {
    if (!this.bootstrapTask) {
      this.bootstrapTask = this.bootstrapOnce().catch((cause) => {
        this.bootstrapTask = null;
        throw cause;
      });
    }
    return this.bootstrapTask;
  }

  private async bootstrapOnce(): Promise<void> {
    const database = await this.database();
    await this.migrateEmbeddedAssets(database);
    const rows = await database.select<Array<{ count: number }>>(
      'SELECT COUNT(*) AS count FROM courses',
    );
    const isNewDatabase = numberValue(rows[0]?.count) === 0;

    if (isNewDatabase) {
      for (const course of seedCourses) {
        await database.execute(
          `INSERT INTO courses
            (id, name, description, language, tags_json, purpose, university, course_code,
             created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            course.id,
            course.name,
            course.description,
            course.language,
            JSON.stringify(course.tags),
            course.purpose,
            course.university,
            course.courseCode,
            course.createdAt,
            course.updatedAt,
          ],
        );
      }
    }
    await this.installBundledProblemSnapshot(database);
    for (const notebook of seedNotebooks) {
      await database.execute(
        `INSERT INTO notebooks
          (id, course_id, name, description, kind, tags_json, section_count, created_at,
           updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT(id) DO NOTHING`,
        [
          notebook.id,
          notebook.courseId,
          notebook.name,
          notebook.description,
          notebook.kind,
          JSON.stringify(notebook.tags),
          notebook.sectionCount,
          notebook.createdAt,
          notebook.updatedAt,
        ],
      );
    }
    await this.installBundledLearningContent(database);
    await this.installBundledMockConversations(database);
    await this.installBundledCourseEvents(database);
    try {
      await this.installBundledMiniLectures(database);
    } catch (cause) {
      console.warn('Unable to install bundled mini lectures.', cause);
    }
  }

  async listCourses(): Promise<LocalCourse[]> {
    const rows = await (
      await this.database()
    ).select<SqlRow[]>('SELECT * FROM courses ORDER BY updated_at DESC');
    return rows.map(mapCourse);
  }

  async listCourseSummaries(): Promise<LocalCourseSummary[]> {
    const rows = await (
      await this.database()
    ).select<SqlRow[]>(
      `SELECT courses.*,
              (SELECT COUNT(*) FROM notebooks WHERE notebooks.course_id = courses.id)
                AS notebook_count,
              (SELECT COUNT(*) FROM problems WHERE problems.course_id = courses.id)
                AS problem_count,
              (SELECT COUNT(*) FROM conversations WHERE conversations.course_id = courses.id)
                AS conversation_count
         FROM courses
        ORDER BY courses.updated_at DESC`,
    );
    return rows.map(mapCourseSummary);
  }

  async loadCourseWorkspace(courseId: string): Promise<LocalCourseWorkspace | null> {
    const database = await this.database();
    const [courseRows, notebookRows, problemRows, conversationRows, memoryRows] = await Promise.all(
      [
        database.select<SqlRow[]>('SELECT * FROM courses WHERE id = $1 LIMIT 1', [courseId]),
        database.select<SqlRow[]>(
          'SELECT * FROM notebooks WHERE course_id = $1 ORDER BY updated_at DESC',
          [courseId],
        ),
        database.select<SqlRow[]>(
          'SELECT * FROM problems WHERE course_id = $1 ORDER BY updated_at DESC',
          [courseId],
        ),
        database.select<SqlRow[]>(
          'SELECT * FROM conversations WHERE course_id = $1 ORDER BY updated_at DESC',
          [courseId],
        ),
        database.select<SqlRow[]>(
          `SELECT * FROM study_memories
          WHERE course_id = $1 AND status = 'active'
          ORDER BY updated_at DESC`,
          [courseId],
        ),
      ],
    );
    const course = courseRows[0] ? mapCourse(courseRows[0]) : null;
    if (!course) return null;
    return {
      course,
      notebooks: notebookRows.map(mapNotebook),
      problems: problemRows.map(mapProblem),
      conversations: conversationRows.map(mapConversation),
      memories: memoryRows.map(mapStudyMemory),
    };
  }

  async loadNotebookDocument(notebookId: string): Promise<LocalNotebookDocument | null> {
    const database = await this.database();
    const [notebookRows, pageRows, sectionRows, assetRows, pageAssetRows, notebookAssetRows] =
      await Promise.all([
        database.select<SqlRow[]>('SELECT * FROM notebooks WHERE id = $1 LIMIT 1', [notebookId]),
        database.select<SqlRow[]>(
          'SELECT * FROM notebook_pages WHERE notebook_id = $1 ORDER BY sort_order ASC',
          [notebookId],
        ),
        database.select<SqlRow[]>(
          'SELECT * FROM markdown_sections WHERE notebook_id = $1 ORDER BY sort_order ASC',
          [notebookId],
        ),
        database.select<SqlRow[]>(
          `SELECT DISTINCT assets.*
         FROM assets
         INNER JOIN notebook_assets ON notebook_assets.asset_id = assets.id
         WHERE notebook_assets.notebook_id = $1
         ORDER BY assets.path ASC`,
          [notebookId],
        ),
        database.select<SqlRow[]>(
          `SELECT page_assets.*
         FROM page_assets
         INNER JOIN notebook_pages ON notebook_pages.id = page_assets.page_id
         WHERE notebook_pages.notebook_id = $1
         ORDER BY page_assets.page_id ASC, page_assets.sort_order ASC`,
          [notebookId],
        ),
        database.select<SqlRow[]>(
          'SELECT * FROM notebook_assets WHERE notebook_id = $1 ORDER BY created_at ASC',
          [notebookId],
        ),
      ]);
    if (!notebookRows[0]) return null;
    return {
      notebook: mapNotebook(notebookRows[0]),
      pages: pageRows.map(mapNotebookPage),
      markdownSections: sectionRows.map(mapMarkdownSection),
      assets: assetRows.map(mapAsset),
      pageAssets: pageAssetRows.map(mapPageAsset),
      notebookAssets: notebookAssetRows.map(mapNotebookAsset),
    };
  }

  async loadProblemDocument(problemId: string): Promise<LocalProblemDocument | null> {
    const database = await this.database();
    const [problemRows, attemptRows, progressRows] = await Promise.all([
      database.select<SqlRow[]>('SELECT * FROM problems WHERE id = $1 LIMIT 1', [problemId]),
      database.select<SqlRow[]>(
        'SELECT * FROM problem_attempts WHERE problem_id = $1 ORDER BY created_at DESC',
        [problemId],
      ),
      database.select<SqlRow[]>('SELECT * FROM problem_progress WHERE problem_id = $1 LIMIT 1', [
        problemId,
      ]),
    ]);
    if (!problemRows[0]) return null;
    return {
      problem: mapProblem(problemRows[0]),
      attempts: attemptRows.map(mapProblemAttempt),
      progress: progressRows[0] ? mapProblemProgress(progressRows[0]) : null,
    };
  }

  async listProblemProgress(courseId: string): Promise<LocalProblemProgress[]> {
    const rows = await (
      await this.database()
    ).select<SqlRow[]>(
      `SELECT problem_progress.*
         FROM problem_progress
         INNER JOIN problems ON problems.id = problem_progress.problem_id
        WHERE problems.course_id = $1
        ORDER BY coalesce(problem_progress.last_attempt_at, 0) DESC,
                 problem_progress.updated_at DESC`,
      [courseId],
    );
    return rows.map(mapProblemProgress);
  }

  async saveProblemAttempt(input: SaveProblemAttemptInput): Promise<SaveProblemAttemptResult> {
    const database = await this.database();
    const problemRows = await database.select<SqlRow[]>(
      'SELECT * FROM problems WHERE id = $1 LIMIT 1',
      [input.problemId],
    );
    if (!problemRows[0]) throw new Error('本地找不到这道题。');

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

    const progressRows = await database.select<SqlRow[]>(
      'SELECT * FROM problem_progress WHERE problem_id = $1 LIMIT 1',
      [input.problemId],
    );
    const existing = progressRows[0] ? mapProblemProgress(progressRows[0]) : null;
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

    await database.execute(
      `INSERT INTO problem_attempts
        (id, problem_id, kind, answer_json, result_json, score, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        attempt.id,
        attempt.problemId,
        attempt.kind,
        JSON.stringify(attempt.answer),
        attempt.result ? JSON.stringify(attempt.result) : null,
        attempt.score,
        attempt.status,
        attempt.createdAt,
        attempt.updatedAt,
      ],
    );
    await database.execute(
      `INSERT INTO problem_progress
        (id, problem_id, latest_attempt_id, status, score, attempted_count, passed_count,
         last_attempt_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT(id) DO UPDATE SET
         problem_id = excluded.problem_id, latest_attempt_id = excluded.latest_attempt_id,
         status = excluded.status, score = excluded.score,
         attempted_count = excluded.attempted_count, passed_count = excluded.passed_count,
         last_attempt_at = excluded.last_attempt_at, updated_at = excluded.updated_at`,
      [
        progress.id,
        progress.problemId,
        progress.latestAttemptId,
        progress.status,
        progress.score,
        progress.attemptedCount,
        progress.passedCount,
        progress.lastAttemptAt,
        progress.createdAt,
        progress.updatedAt,
      ],
    );

    const document = await this.loadProblemDocument(input.problemId);
    if (!document) throw new Error('保存作答后无法重新读取题目。');
    return { attempt, progress, document };
  }

  async searchCourse(courseId: string, query: string): Promise<LocalCourseSearchResult[]> {
    const database = await this.database();
    const terms = courseSearchTerms(query);
    const matchExpression = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
    const normalizedQuery = query.normalize('NFKC').trim();
    if (!normalizedQuery) return [];
    const rows = matchExpression
      ? await database.select<SqlRow[]>(
          `SELECT
             source_id,
             resource_id,
             source_type,
             title,
             snippet(local_course_search, 5, '', '', ' … ', 64) AS excerpt,
             updated_at
           FROM local_course_search
          WHERE course_id = $1 AND local_course_search MATCH $2
          ORDER BY bm25(local_course_search, 0.0, 0.0, 0.0, 0.0, 8.0, 2.0, 0.0) ASC,
                   CAST(updated_at AS INTEGER) DESC
          LIMIT 20`,
          [courseId, matchExpression],
        )
      : await database.select<SqlRow[]>(
          `SELECT
             source_id,
             resource_id,
             source_type,
             title,
             substr(body, 1, 700) AS excerpt,
             updated_at
           FROM local_course_search
          WHERE course_id = $1
            AND (
              instr(lower(title), lower($2)) > 0
              OR instr(lower(body), lower($2)) > 0
            )
          ORDER BY CAST(updated_at AS INTEGER) DESC
          LIMIT 20`,
          [courseId, normalizedQuery],
        );
    return rows.flatMap((row) => {
      const result = mapCourseSearchResult(row);
      return result ? [result] : [];
    });
  }

  async listMessages(conversationId: string): Promise<LocalMessage[]> {
    const rows = await (
      await this.database()
    ).select<SqlRow[]>(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId],
    );
    return rows.map(mapMessage);
  }

  async getCourseLearningState(courseId: string): Promise<LocalCourseLearningState | null> {
    const database = await this.database();
    const [courseRows, notebookRows, metadataRows] = await Promise.all([
      database.select<SqlRow[]>('SELECT id FROM courses WHERE id = $1 LIMIT 1', [courseId]),
      database.select<Array<{ id: string }>>('SELECT id FROM notebooks WHERE course_id = $1', [
        courseId,
      ]),
      database.select<Array<{ value: string; updated_at: number }>>(
        'SELECT value, updated_at FROM app_metadata WHERE key = $1 LIMIT 1',
        [courseLearningStateMetadataKey(courseId)],
      ),
    ]);
    if (!courseRows[0] || !metadataRows[0]) return null;
    return parseCourseLearningState(
      metadataRows[0].value,
      courseId,
      new Set(notebookRows.map((row) => row.id)),
      numberValue(metadataRows[0].updated_at),
    );
  }

  async saveCourseLearningState(
    input: SaveCourseLearningStateInput,
  ): Promise<LocalCourseLearningState> {
    const database = await this.database();
    await database.execute('BEGIN IMMEDIATE');
    try {
      const [courseRows, notebookRows, metadataRows] = await Promise.all([
        database.select<SqlRow[]>('SELECT id FROM courses WHERE id = $1 LIMIT 1', [input.courseId]),
        database.select<Array<{ id: string }>>('SELECT id FROM notebooks WHERE course_id = $1', [
          input.courseId,
        ]),
        database.select<Array<{ value: string; updated_at: number }>>(
          'SELECT value, updated_at FROM app_metadata WHERE key = $1 LIMIT 1',
          [courseLearningStateMetadataKey(input.courseId)],
        ),
      ]);
      if (!courseRows[0]) throw new Error('本地找不到这门课程。');

      const notebookIds = new Set(notebookRows.map((row) => row.id));
      const existing = metadataRows[0]
        ? parseCourseLearningState(
            metadataRows[0].value,
            input.courseId,
            notebookIds,
            numberValue(metadataRows[0].updated_at),
          )
        : null;
      const state = normalizeCourseLearningState(input, notebookIds, existing);
      await database.execute(
        `INSERT INTO app_metadata (key, value, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [courseLearningStateMetadataKey(input.courseId), JSON.stringify(state), state.updatedAt],
      );
      await database.execute('COMMIT');
      return state;
    } catch (cause) {
      await database.execute('ROLLBACK').catch(() => undefined);
      throw cause;
    }
  }

  async listCourseEvents(courseId: string): Promise<LocalCourseEvent[]> {
    const rows = await (
      await this.database()
    ).select<SqlRow[]>(
      `SELECT *
         FROM course_events
        WHERE course_id = $1 AND status = 'active'
        ORDER BY event_date ASC, created_at ASC`,
      [courseId],
    );
    return rows.map(mapCourseEvent);
  }

  async upsertCourseEvents(events: LocalCourseEvent[]): Promise<void> {
    if (!events.length) return;
    const coursesById = eventCoursesById(events);
    const database = await this.database();
    await database.execute('BEGIN IMMEDIATE');
    try {
      for (const eventBatch of chunks(events, 50)) {
        const eventIds = eventBatch.map((event) => event.id);
        const existingRows = await database.select<Array<{ id: string; course_id: string }>>(
          `SELECT id, course_id
             FROM course_events
            WHERE id IN (${eventIds.map((_, index) => `$${index + 1}`).join(', ')})`,
          eventIds,
        );
        const collision = existingRows.find((row) => coursesById.get(row.id) !== row.course_id);
        if (collision) {
          throw new Error(`日历事项 ${collision.id} 已属于其他课程，已阻止覆盖。`);
        }
        const bindings: unknown[] = [];
        const valueGroups = eventBatch.map((event, rowIndex) => {
          const firstParameter = rowIndex * 10 + 1;
          bindings.push(
            event.id,
            event.courseId,
            event.title,
            event.date,
            event.note,
            event.kind,
            event.source,
            event.status,
            event.createdAt,
            event.updatedAt,
          );
          return `(${Array.from(
            { length: 10 },
            (_, parameterIndex) => `$${firstParameter + parameterIndex}`,
          ).join(', ')})`;
        });
        await database.execute(
          `INSERT INTO course_events
            (id, course_id, title, event_date, note, kind, source, status,
             created_at, updated_at)
           VALUES ${valueGroups.join(', ')}
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             event_date = excluded.event_date, note = excluded.note,
             kind = excluded.kind, source = excluded.source,
             status = excluded.status, updated_at = excluded.updated_at
           WHERE course_events.course_id = excluded.course_id`,
          bindings,
        );
      }
      await database.execute('COMMIT');
    } catch (cause) {
      await database.execute('ROLLBACK').catch(() => undefined);
      throw cause;
    }
  }

  async deleteCourseEvent(courseId: string, eventId: string): Promise<void> {
    await (
      await this.database()
    ).execute('DELETE FROM course_events WHERE course_id = $1 AND id = $2', [courseId, eventId]);
  }

  async listMiniLectureDecks(conversationId: string): Promise<PersistedMiniLectureDeck[]> {
    const rows = await (
      await this.database()
    ).select<SqlRow[]>(
      `SELECT lecture_decks.*
         FROM lecture_decks
         INNER JOIN messages ON messages.id = lecture_decks.message_id
        WHERE messages.conversation_id = $1
          AND lecture_decks.status = 'ready'
        ORDER BY lecture_decks.created_at ASC`,
      [conversationId],
    );
    return rows.map(mapMiniLectureDeck);
  }

  async loadMiniLectureDeck(deckId: string): Promise<RuntimeMiniLectureDeck | null> {
    const database = await this.database();
    const [deckRows, pageRows] = await Promise.all([
      database.select<SqlRow[]>('SELECT * FROM lecture_decks WHERE id = $1 LIMIT 1', [deckId]),
      database.select<SqlRow[]>(
        'SELECT * FROM lecture_pages WHERE deck_id = $1 ORDER BY sort_order ASC',
        [deckId],
      ),
    ]);
    if (!deckRows[0]) return null;

    const deck = mapMiniLectureDeck(deckRows[0]);
    const pages = pageRows.map(mapMiniLecturePage);
    const assetIds = [
      ...new Set(
        pages.flatMap((page) => [
          page.imageAssetId,
          ...page.actions.flatMap((action) =>
            action.type === 'speech' ? [action.audioAssetId] : [],
          ),
        ]),
      ),
    ];
    const assetRows = assetIds.length
      ? await database.select<SqlRow[]>(
          `SELECT * FROM assets WHERE id IN (${assetIds
            .map((_, index) => `$${index + 1}`)
            .join(', ')})`,
          assetIds,
        )
      : [];
    const assets = new Map(assetRows.map((row) => [stringValue(row.id), mapAsset(row)]));
    const resolvedUrls = new Map<string, string>();
    await Promise.all(
      assetIds.map(async (assetId) => {
        const asset = assets.get(assetId);
        if (!asset) throw new Error(`课堂资源记录缺失：${assetId}`);
        const url = await readLocalAsset(asset);
        if (!url) throw new Error(`课堂资源文件缺失：${asset.path}`);
        resolvedUrls.set(assetId, url);
      }),
    );

    return {
      ...deck,
      pages: pages.map((page) => ({
        ...page,
        imageUrl: resolvedUrls.get(page.imageAssetId) || '',
        actions: page.actions.map((action): RuntimeMiniLectureAction => {
          if (action.type === 'spotlight') return action;
          return {
            ...action,
            audioUrl: resolvedUrls.get(action.audioAssetId) || '',
          };
        }),
      })),
    };
  }

  async saveMiniLectureDocument(input: SaveMiniLectureInput): Promise<PersistedMiniLectureDeck> {
    const { document, assets } = input;
    if (document.deck.status !== 'ready') {
      throw new Error('只有完成标记恢复与语音生成的课堂讲解才能保存。');
    }
    if (!document.pages.length) throw new Error('课堂讲解至少需要一页。');
    if (document.pages.some((page) => page.recoveryStatus !== 'passed')) {
      throw new Error('课堂讲解存在未通过标记恢复的页面。');
    }

    const persistedAssets = await persistArchiveAssets(assets);
    if (persistedAssets.size !== assets.length) {
      throw new Error('课堂图片或语音没有完整写入 App Data。');
    }

    const database = await this.database();
    let removableStoragePaths: string[] = [];
    await database.execute('BEGIN IMMEDIATE');
    try {
      const previousPageRows = await database.select<SqlRow[]>(
        `SELECT lecture_pages.*
           FROM lecture_pages
           INNER JOIN lecture_decks ON lecture_decks.id = lecture_pages.deck_id
          WHERE lecture_decks.message_id = $1`,
        [document.deck.messageId],
      );
      const previousAssetIds = miniLectureAssetIds(previousPageRows.map(mapMiniLecturePage));

      for (const asset of assets) {
        const storagePath = persistedAssets.get(asset.id);
        if (!storagePath) throw new Error(`课堂资源写入失败：${asset.id}`);
        await database.execute(
          `INSERT INTO assets
            (id, path, mime_type, size_bytes, sha256, source, data_base64, storage_path,
             created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9)
           ON CONFLICT(id) DO UPDATE SET
             path = excluded.path, mime_type = excluded.mime_type,
             size_bytes = excluded.size_bytes, sha256 = excluded.sha256,
             source = excluded.source, data_base64 = NULL,
             storage_path = excluded.storage_path, updated_at = excluded.updated_at`,
          [
            asset.id,
            asset.path,
            asset.mimeType,
            asset.sizeBytes,
            asset.sha256,
            asset.source,
            storagePath,
            asset.createdAt,
            asset.updatedAt,
          ],
        );
      }

      const deck = document.deck;
      await database.execute('DELETE FROM lecture_decks WHERE message_id = $1 AND id <> $2', [
        deck.messageId,
        deck.id,
      ]);
      await database.execute(
        `INSERT INTO lecture_decks
          (id, message_id, title, origin, package_name, package_version, status,
           generator_meta_json, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT(id) DO UPDATE SET
           message_id = excluded.message_id, title = excluded.title,
           origin = excluded.origin, package_name = excluded.package_name,
           package_version = excluded.package_version, status = excluded.status,
           generator_meta_json = excluded.generator_meta_json,
           updated_at = excluded.updated_at`,
        [
          deck.id,
          deck.messageId,
          deck.title,
          deck.origin,
          deck.packageName,
          deck.packageVersion,
          deck.status,
          JSON.stringify(deck.generatorMeta),
          deck.createdAt,
          deck.updatedAt,
        ],
      );
      await database.execute('DELETE FROM lecture_pages WHERE deck_id = $1', [deck.id]);
      for (const page of document.pages) {
        await database.execute(
          `INSERT INTO lecture_pages
            (id, deck_id, sort_order, title, image_asset_id, width, height,
             recovery_status, regions_json, actions_json, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            page.id,
            page.deckId,
            page.order,
            page.title,
            page.imageAssetId,
            page.width,
            page.height,
            page.recoveryStatus,
            JSON.stringify(page.regions),
            JSON.stringify(page.actions),
            page.createdAt,
            page.updatedAt,
          ],
        );
      }

      if (previousAssetIds.size) {
        const candidateIds = [...previousAssetIds];
        const lectureAssetRows = await database.select<SqlRow[]>(
          'SELECT image_asset_id, actions_json FROM lecture_pages',
        );
        const referencedAssetIds = new Set<string>();
        for (const row of lectureAssetRows) {
          referencedAssetIds.add(stringValue(row.image_asset_id));
          const actions = jsonValue<PersistedMiniLectureAction[]>(row.actions_json, []);
          for (const action of actions) {
            if (action.type === 'speech') referencedAssetIds.add(action.audioAssetId);
          }
        }
        const placeholders = candidateIds.map((_, index) => `$${index + 1}`).join(', ');
        const pageAssetRows = await database.select<SqlRow[]>(
          `SELECT asset_id FROM page_assets WHERE asset_id IN (${placeholders})`,
          candidateIds,
        );
        const notebookAssetRows = await database.select<SqlRow[]>(
          `SELECT asset_id FROM notebook_assets WHERE asset_id IN (${placeholders})`,
          candidateIds,
        );
        for (const row of [...pageAssetRows, ...notebookAssetRows]) {
          referencedAssetIds.add(stringValue(row.asset_id));
        }

        const orphanAssetIds = candidateIds.filter((assetId) => !referencedAssetIds.has(assetId));
        if (orphanAssetIds.length) {
          const orphanPlaceholders = orphanAssetIds.map((_, index) => `$${index + 1}`).join(', ');
          const orphanRows = await database.select<SqlRow[]>(
            `SELECT id, storage_path
               FROM assets
              WHERE id IN (${orphanPlaceholders})`,
            orphanAssetIds,
          );
          await database.execute(
            `DELETE FROM assets WHERE id IN (${orphanPlaceholders})`,
            orphanAssetIds,
          );
          const candidatePaths = [
            ...new Set(
              orphanRows
                .map((row) => nullableString(row.storage_path))
                .filter((path): path is string => Boolean(path)),
            ),
          ];
          if (candidatePaths.length) {
            const pathPlaceholders = candidatePaths.map((_, index) => `$${index + 1}`).join(', ');
            const sharedRows = await database.select<SqlRow[]>(
              `SELECT DISTINCT storage_path
                 FROM assets
                WHERE storage_path IN (${pathPlaceholders})`,
              candidatePaths,
            );
            const sharedPaths = new Set(
              sharedRows
                .map((row) => nullableString(row.storage_path))
                .filter((path): path is string => Boolean(path)),
            );
            removableStoragePaths = candidatePaths.filter((path) => !sharedPaths.has(path));
          }
        }
      }

      await database.execute('COMMIT');
    } catch (cause) {
      await database.execute('ROLLBACK').catch(() => undefined);
      throw cause;
    }
    await deleteLocalAssetFiles(removableStoragePaths).catch(() => undefined);
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
    await (
      await this.database()
    ).execute(
      `INSERT INTO courses
        (id, name, description, language, tags_json, purpose, university, course_code, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        course.id,
        course.name,
        course.description,
        course.language,
        JSON.stringify(course.tags),
        course.purpose,
        course.university,
        course.courseCode,
        course.createdAt,
        course.updatedAt,
      ],
    );
    return course;
  }

  async updateCourse(input: UpdateCourseInput): Promise<LocalCourse> {
    const database = await this.database();
    const timestamp = Date.now();
    await database.execute(
      `UPDATE courses
          SET name = $1, description = $2, course_code = $3, updated_at = $4
        WHERE id = $5`,
      [
        input.name.trim() || '未命名课程',
        input.description.trim(),
        input.courseCode?.trim() || null,
        timestamp,
        input.id,
      ],
    );
    const rows = await database.select<SqlRow[]>('SELECT * FROM courses WHERE id = $1 LIMIT 1', [
      input.id,
    ]);
    if (!rows[0]) throw new Error('本地找不到这门课程。');
    return mapCourse(rows[0]);
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
    await (
      await this.database()
    ).execute(
      `INSERT INTO conversations
        (id, course_id, notebook_id, title, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        conversation.id,
        conversation.courseId,
        conversation.notebookId,
        conversation.title,
        conversation.createdAt,
        conversation.updatedAt,
      ],
    );
    return conversation;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await (
      await this.database()
    ).execute('DELETE FROM conversations WHERE id = $1', [conversationId]);
  }

  async appendMessage(input: AppendMessageInput): Promise<LocalMessage> {
    const database = await this.database();
    const message: LocalMessage = {
      id: crypto.randomUUID(),
      conversationId: input.conversationId,
      role: input.role,
      text: input.text,
      createdAt: Date.now(),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    await database.execute(
      `INSERT INTO messages (id, conversation_id, role, text, metadata_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        message.id,
        message.conversationId,
        message.role,
        message.text,
        JSON.stringify(message.metadata ?? {}),
        message.createdAt,
      ],
    );
    await database.execute('UPDATE conversations SET updated_at = $1 WHERE id = $2', [
      message.createdAt,
      message.conversationId,
    ]);
    return message;
  }

  async updateMessageMetadata(messageId: string, metadata: NativeMessageMetadata): Promise<void> {
    await (
      await this.database()
    ).execute('UPDATE messages SET metadata_json = $1 WHERE id = $2', [
      JSON.stringify(metadata),
      messageId,
    ]);
  }

  async upsertStudyMemory(memory: LocalStudyMemory): Promise<LocalStudyMemory> {
    await (
      await this.database()
    ).execute(
      `INSERT INTO study_memories
        (id, course_id, notebook_id, target_type, scope, kind, status, source, title, text,
         reason, question, source_references_json, confidence, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT(id) DO UPDATE SET
         course_id = excluded.course_id, notebook_id = excluded.notebook_id,
         target_type = excluded.target_type, scope = excluded.scope, kind = excluded.kind,
         status = excluded.status, source = excluded.source, title = excluded.title,
         text = excluded.text, reason = excluded.reason, question = excluded.question,
         source_references_json = excluded.source_references_json,
         confidence = excluded.confidence, updated_at = excluded.updated_at`,
      [
        memory.id,
        memory.courseId,
        memory.notebookId,
        memory.targetType,
        memory.scope,
        memory.kind,
        memory.status,
        memory.source,
        memory.title,
        memory.text,
        memory.reason,
        memory.question,
        JSON.stringify(memory.sourceReferences),
        memory.confidence,
        memory.createdAt,
        memory.updatedAt,
      ],
    );
    return memory;
  }

  async archiveStudyMemory(memoryId: string): Promise<void> {
    await (
      await this.database()
    ).execute(`UPDATE study_memories SET status = 'archived', updated_at = $1 WHERE id = $2`, [
      Date.now(),
      memoryId,
    ]);
  }

  async importTextMaterial(input: ImportTextMaterialInput): Promise<LocalNotebook> {
    const database = await this.database();
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
    await database.execute(
      `INSERT INTO notebooks
        (id, course_id, name, description, kind, tags_json, section_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'markdown', $5, 1, $6, $7)`,
      [
        notebook.id,
        notebook.courseId,
        notebook.name,
        notebook.description,
        JSON.stringify(notebook.tags),
        notebook.createdAt,
        notebook.updatedAt,
      ],
    );
    await database.execute(
      `INSERT INTO markdown_sections
        (id, notebook_id, course_id, title, sort_order, markdown, summary, source_meta_json,
         created_at, updated_at)
       VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9)`,
      [
        crypto.randomUUID(),
        notebook.id,
        notebook.courseId,
        notebook.name,
        input.text,
        input.text.slice(0, 240),
        JSON.stringify({ source: input.source, importedLocally: true }),
        timestamp,
        timestamp,
      ],
    );
    await database.execute('UPDATE courses SET updated_at = $1 WHERE id = $2', [
      timestamp,
      input.courseId,
    ]);
    return notebook;
  }

  async importTextProblem(input: ImportTextProblemInput): Promise<LocalProblem> {
    const database = await this.database();
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
    await database.execute(
      `INSERT INTO problems
        (id, course_id, notebook_id, title, type, status, difficulty, tags_json,
         public_content_json, grading_json, created_at, updated_at)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        problem.id,
        problem.courseId,
        problem.title,
        problem.type,
        problem.status,
        problem.difficulty,
        JSON.stringify(problem.tags),
        JSON.stringify(problem.publicContent),
        JSON.stringify(problem.grading),
        problem.createdAt,
        problem.updatedAt,
      ],
    );
    await database.execute('UPDATE courses SET updated_at = $1 WHERE id = $2', [
      timestamp,
      input.courseId,
    ]);
    return problem;
  }

  async importArchive(archive: SyntaraArchiveV1): Promise<ArchiveImportSummary> {
    const database = await this.database();
    const persistedAssets = await persistArchiveAssets(archive.assets);

    for (const course of archive.courses) {
      await database.execute(
        `INSERT INTO courses
          (id, name, description, language, tags_json, purpose, university, course_code,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, description = excluded.description,
           language = excluded.language, tags_json = excluded.tags_json,
           purpose = excluded.purpose, university = excluded.university,
           course_code = excluded.course_code, created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        [
          course.id,
          course.name,
          course.description,
          course.language,
          JSON.stringify(course.tags),
          course.purpose,
          course.university,
          course.courseCode,
          course.createdAt,
          course.updatedAt,
        ],
      );
    }

    for (const notebook of archive.notebooks) {
      await database.execute(
        `INSERT INTO notebooks
          (id, course_id, name, description, kind, tags_json, section_count, created_at,
           updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT(id) DO UPDATE SET
           course_id = excluded.course_id, name = excluded.name,
           description = excluded.description, kind = excluded.kind,
           tags_json = excluded.tags_json, section_count = excluded.section_count,
           created_at = excluded.created_at, updated_at = excluded.updated_at`,
        [
          notebook.id,
          notebook.courseId,
          notebook.name,
          notebook.description,
          notebook.kind,
          JSON.stringify(notebook.tags),
          notebook.sectionCount,
          notebook.createdAt,
          notebook.updatedAt,
        ],
      );
    }

    for (const page of archive.notebookPages) {
      await database.execute(
        `INSERT INTO notebook_pages
          (id, notebook_id, course_id, source_scene_id, title, type, sort_order, content_json,
           actions_json, whiteboard_json, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT(id) DO UPDATE SET
           notebook_id = excluded.notebook_id, course_id = excluded.course_id,
           source_scene_id = excluded.source_scene_id, title = excluded.title,
           type = excluded.type, sort_order = excluded.sort_order,
           content_json = excluded.content_json, actions_json = excluded.actions_json,
           whiteboard_json = excluded.whiteboard_json, created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        [
          page.id,
          page.notebookId,
          page.courseId,
          page.sourceSceneId,
          page.title,
          page.type,
          page.order,
          JSON.stringify(page.content),
          JSON.stringify(page.actions),
          page.whiteboard ? JSON.stringify(page.whiteboard) : null,
          page.createdAt,
          page.updatedAt,
        ],
      );
    }

    for (const section of archive.markdownSections) {
      await database.execute(
        `INSERT INTO markdown_sections
          (id, notebook_id, course_id, title, sort_order, markdown, summary, source_meta_json,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT(id) DO UPDATE SET
           notebook_id = excluded.notebook_id, course_id = excluded.course_id,
           title = excluded.title, sort_order = excluded.sort_order,
           markdown = excluded.markdown, summary = excluded.summary,
           source_meta_json = excluded.source_meta_json, created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        [
          section.id,
          section.notebookId,
          section.courseId,
          section.title,
          section.order,
          section.markdown,
          section.summary,
          JSON.stringify(section.sourceMeta),
          section.createdAt,
          section.updatedAt,
        ],
      );
    }

    for (const asset of archive.assets) {
      const storagePath = persistedAssets.get(asset.id) ?? null;
      await database.execute(
        `INSERT INTO assets
          (id, path, mime_type, size_bytes, sha256, source, data_base64, storage_path,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT(id) DO UPDATE SET
           path = excluded.path, mime_type = excluded.mime_type,
           size_bytes = excluded.size_bytes, sha256 = excluded.sha256,
           source = excluded.source,
           data_base64 = COALESCE(excluded.data_base64, assets.data_base64),
           storage_path = COALESCE(excluded.storage_path, assets.storage_path),
           created_at = excluded.created_at, updated_at = excluded.updated_at`,
        [
          asset.id,
          asset.path,
          asset.mimeType,
          asset.sizeBytes,
          asset.sha256,
          asset.source,
          storagePath ? null : asset.dataBase64,
          storagePath,
          asset.createdAt,
          asset.updatedAt,
        ],
      );
    }

    for (const pageAsset of archive.pageAssets) {
      await database.execute(
        `INSERT INTO page_assets
          (id, page_id, asset_id, role, sort_order, meta_json, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT(id) DO UPDATE SET
           page_id = excluded.page_id, asset_id = excluded.asset_id,
           role = excluded.role, sort_order = excluded.sort_order,
           meta_json = excluded.meta_json, created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        [
          pageAsset.id,
          pageAsset.pageId,
          pageAsset.assetId,
          pageAsset.role,
          pageAsset.order,
          JSON.stringify(pageAsset.meta),
          pageAsset.createdAt,
          pageAsset.updatedAt,
        ],
      );
    }

    for (const notebookAsset of archive.notebookAssets) {
      await database.execute(
        `INSERT INTO notebook_assets
          (id, notebook_id, asset_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT(id) DO UPDATE SET
           notebook_id = excluded.notebook_id, asset_id = excluded.asset_id,
           created_at = excluded.created_at, updated_at = excluded.updated_at`,
        [
          notebookAsset.id,
          notebookAsset.notebookId,
          notebookAsset.assetId,
          notebookAsset.createdAt,
          notebookAsset.updatedAt,
        ],
      );
    }

    for (const problem of archive.problems) {
      await database.execute(
        `INSERT INTO problems
          (id, course_id, notebook_id, title, type, status, difficulty, tags_json,
           public_content_json, grading_json, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT(id) DO UPDATE SET
           course_id = excluded.course_id, notebook_id = excluded.notebook_id,
           title = excluded.title, type = excluded.type, status = excluded.status,
           difficulty = excluded.difficulty, tags_json = excluded.tags_json,
           public_content_json = excluded.public_content_json,
           grading_json = excluded.grading_json, created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        [
          problem.id,
          problem.courseId,
          problem.notebookId,
          problem.title,
          problem.type,
          problem.status,
          problem.difficulty,
          JSON.stringify(problem.tags),
          JSON.stringify(problem.publicContent),
          JSON.stringify(problem.grading),
          problem.createdAt,
          problem.updatedAt,
        ],
      );
    }

    for (const attempt of archive.problemAttempts) {
      await database.execute(
        `INSERT INTO problem_attempts
          (id, problem_id, kind, answer_json, result_json, score, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT(id) DO UPDATE SET
           problem_id = excluded.problem_id, kind = excluded.kind,
           answer_json = excluded.answer_json, result_json = excluded.result_json,
           score = excluded.score, status = excluded.status,
           created_at = excluded.created_at, updated_at = excluded.updated_at`,
        [
          attempt.id,
          attempt.problemId,
          attempt.kind,
          JSON.stringify(attempt.answer),
          attempt.result ? JSON.stringify(attempt.result) : null,
          attempt.score,
          attempt.status,
          attempt.createdAt,
          attempt.updatedAt,
        ],
      );
    }

    for (const progress of archive.problemProgress) {
      await database.execute(
        `INSERT INTO problem_progress
          (id, problem_id, latest_attempt_id, status, score, attempted_count, passed_count,
           last_attempt_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT(id) DO UPDATE SET
           problem_id = excluded.problem_id, latest_attempt_id = excluded.latest_attempt_id,
           status = excluded.status, score = excluded.score,
           attempted_count = excluded.attempted_count, passed_count = excluded.passed_count,
           last_attempt_at = excluded.last_attempt_at, created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        [
          progress.id,
          progress.problemId,
          progress.latestAttemptId,
          progress.status,
          progress.score,
          progress.attemptedCount,
          progress.passedCount,
          progress.lastAttemptAt,
          progress.createdAt,
          progress.updatedAt,
        ],
      );
    }

    for (const conversation of archive.conversations) {
      await database.execute(
        `INSERT INTO conversations
          (id, course_id, notebook_id, title, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT(id) DO UPDATE SET
           course_id = excluded.course_id, notebook_id = excluded.notebook_id,
           title = excluded.title, created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        [
          conversation.id,
          conversation.courseId,
          conversation.notebookId,
          conversation.title,
          conversation.createdAt,
          conversation.updatedAt,
        ],
      );
    }

    for (const message of archive.messages) {
      await database.execute(
        `INSERT INTO messages (id, conversation_id, role, text, metadata_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT(id) DO UPDATE SET
           conversation_id = excluded.conversation_id, role = excluded.role,
           text = excluded.text, metadata_json = excluded.metadata_json,
           created_at = excluded.created_at`,
        [
          message.id,
          message.conversationId,
          message.role,
          message.text,
          JSON.stringify(message.metadata ?? {}),
          message.createdAt,
        ],
      );
    }

    for (const memory of archive.studyMemories) {
      await database.execute(
        `INSERT INTO study_memories
          (id, course_id, notebook_id, target_type, scope, kind, status, source, title, text,
           reason, question, source_references_json, confidence, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT(id) DO UPDATE SET
           course_id = excluded.course_id, notebook_id = excluded.notebook_id,
           target_type = excluded.target_type, scope = excluded.scope, kind = excluded.kind,
           status = excluded.status, source = excluded.source, title = excluded.title,
           text = excluded.text, reason = excluded.reason, question = excluded.question,
           source_references_json = excluded.source_references_json,
           confidence = excluded.confidence, created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        [
          memory.id,
          memory.courseId,
          memory.notebookId,
          memory.targetType,
          memory.scope,
          memory.kind,
          memory.status,
          memory.source,
          memory.title,
          memory.text,
          memory.reason,
          memory.question,
          JSON.stringify(memory.sourceReferences),
          memory.confidence,
          memory.createdAt,
          memory.updatedAt,
        ],
      );
    }

    return summarizeArchive(archive);
  }
}
