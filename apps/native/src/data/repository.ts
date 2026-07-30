import type {
  LocalConversation,
  LocalCourse,
  LocalCourseLearningState,
  LocalCourseSummary,
  LocalCourseSearchResult,
  LocalCourseWorkspace,
  LocalMessage,
  LocalNotebook,
  LocalNotebookDocument,
  LocalProblem,
  LocalProblemAttempt,
  LocalProblemDocument,
  LocalProblemProgress,
  LocalAsset,
  LocalStudyMemory,
} from '../domain/models';
import type {
  LocalCourseEvent,
  PersistedMiniLectureDeck,
  PersistedMiniLectureDocument,
  RuntimeMiniLectureDeck,
} from '../domain/learning-experiences';
import type { NativeMessageMetadata } from '../domain/teaching';
import type { ArchiveImportSummary, SyntaraArchiveV1 } from './archive';
import type { LocalProblemAnswer } from './local-problem-grading';

export type LocalBackendKind = 'sqlite' | 'indexeddb';

export interface NewCourseInput {
  name: string;
  description?: string;
  purpose?: LocalCourse['purpose'];
}

export interface UpdateCourseInput {
  id: string;
  name: string;
  description: string;
  courseCode: string | null;
}

export interface AppendMessageInput {
  conversationId: string;
  role: LocalMessage['role'];
  text: string;
  metadata?: NativeMessageMetadata;
}

export interface ImportTextMaterialInput {
  courseId: string;
  name: string;
  text: string;
  source: 'chat' | 'syllabus' | 'notes';
}

export interface ImportTextProblemInput {
  courseId: string;
  name: string;
  text: string;
}

export interface SaveProblemAttemptInput {
  problemId: string;
  answer: LocalProblemAnswer;
  status: LocalProblemAttempt['status'];
  score: number | null;
  feedback?: string;
  result?: Record<string, unknown> | null;
}

export interface SaveProblemAttemptResult {
  attempt: LocalProblemAttempt;
  progress: LocalProblemProgress;
  document: LocalProblemDocument;
}

export interface SaveMiniLectureInput {
  document: PersistedMiniLectureDocument;
  assets: LocalAsset[];
}

export interface SaveCourseLearningStateInput {
  courseId: string;
  completedNotebookCount: number;
  currentNotebookId?: string | null;
  updatedAt?: number;
}

export interface LocalRepository {
  readonly kind: LocalBackendKind;
  bootstrap(): Promise<void>;
  listCourses(): Promise<LocalCourse[]>;
  listCourseSummaries(): Promise<LocalCourseSummary[]>;
  loadCourseWorkspace(courseId: string): Promise<LocalCourseWorkspace | null>;
  loadNotebookDocument(notebookId: string): Promise<LocalNotebookDocument | null>;
  loadProblemDocument(problemId: string): Promise<LocalProblemDocument | null>;
  listProblemProgress(courseId: string): Promise<LocalProblemProgress[]>;
  saveProblemAttempt(input: SaveProblemAttemptInput): Promise<SaveProblemAttemptResult>;
  searchCourse(courseId: string, query: string): Promise<LocalCourseSearchResult[]>;
  listMessages(conversationId: string): Promise<LocalMessage[]>;
  getCourseLearningState(courseId: string): Promise<LocalCourseLearningState | null>;
  saveCourseLearningState(input: SaveCourseLearningStateInput): Promise<LocalCourseLearningState>;
  listCourseEvents(courseId: string): Promise<LocalCourseEvent[]>;
  upsertCourseEvents(events: LocalCourseEvent[]): Promise<void>;
  deleteCourseEvent(courseId: string, eventId: string): Promise<void>;
  listMiniLectureDecks(conversationId: string): Promise<PersistedMiniLectureDeck[]>;
  loadMiniLectureDeck(deckId: string): Promise<RuntimeMiniLectureDeck | null>;
  saveMiniLectureDocument(input: SaveMiniLectureInput): Promise<PersistedMiniLectureDeck>;
  createCourse(input: NewCourseInput): Promise<LocalCourse>;
  updateCourse(input: UpdateCourseInput): Promise<LocalCourse>;
  createConversation(courseId: string, title: string): Promise<LocalConversation>;
  deleteConversation(conversationId: string): Promise<void>;
  appendMessage(input: AppendMessageInput): Promise<LocalMessage>;
  updateMessageMetadata(messageId: string, metadata: NativeMessageMetadata): Promise<void>;
  upsertStudyMemory(memory: LocalStudyMemory): Promise<LocalStudyMemory>;
  archiveStudyMemory(memoryId: string): Promise<void>;
  importTextMaterial(input: ImportTextMaterialInput): Promise<LocalNotebook>;
  importTextProblem(input: ImportTextProblemInput): Promise<LocalProblem>;
  importArchive(archive: SyntaraArchiveV1): Promise<ArchiveImportSummary>;
}

let repositoryPromise: Promise<LocalRepository> | null = null;

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function getLocalRepository(): Promise<LocalRepository> {
  if (repositoryPromise) return repositoryPromise;

  repositoryPromise = isTauriRuntime()
    ? import('./sqlite-repository').then(({ SqliteLocalRepository }) => new SqliteLocalRepository())
    : import('./browser-repository').then(
        ({ BrowserLocalRepository }) => new BrowserLocalRepository(),
      );

  return repositoryPromise;
}
