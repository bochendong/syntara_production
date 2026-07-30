import type { NativeMessageMetadata } from './teaching';

export type CoursePurpose = 'research' | 'university' | 'daily';
export type NotebookKind = 'image' | 'markdown';
export type ProblemDifficulty = 'easy' | 'medium' | 'hard';
export type MessageRole = 'user' | 'assistant' | 'system';

export interface LocalCourse {
  id: string;
  name: string;
  description: string;
  language: 'zh-CN' | 'en-US';
  tags: string[];
  purpose: CoursePurpose;
  university: string | null;
  courseCode: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface LocalCourseSummary extends LocalCourse {
  notebookCount: number;
  problemCount: number;
  conversationCount: number;
}

export interface LocalCourseLearningState {
  courseId: string;
  completedNotebookCount: number;
  currentNotebookId: string | null;
  updatedAt: number;
}

export interface LocalNotebook {
  id: string;
  courseId: string;
  name: string;
  description: string;
  kind: NotebookKind;
  tags: string[];
  sectionCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface LocalProblem {
  id: string;
  courseId: string;
  notebookId: string | null;
  title: string;
  type: string;
  status: 'draft' | 'published' | 'archived';
  difficulty: ProblemDifficulty;
  tags: string[];
  publicContent: Record<string, unknown>;
  grading: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface LocalConversation {
  id: string;
  courseId: string;
  notebookId: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface LocalMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  text: string;
  metadata?: NativeMessageMetadata;
  createdAt: number;
}

export interface LocalNotebookPage {
  id: string;
  notebookId: string;
  courseId: string | null;
  sourceSceneId: string | null;
  title: string;
  type: string;
  order: number;
  content: Record<string, unknown>;
  actions: unknown[];
  whiteboard: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface LocalMarkdownSection {
  id: string;
  notebookId: string;
  courseId: string | null;
  title: string;
  order: number;
  markdown: string;
  summary: string | null;
  sourceMeta: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface LocalProblemAttempt {
  id: string;
  problemId: string;
  kind: string;
  answer: Record<string, unknown>;
  result: Record<string, unknown> | null;
  score: number | null;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface LocalProblemProgress {
  id: string;
  problemId: string;
  latestAttemptId: string | null;
  status: string;
  score: number | null;
  attemptedCount: number;
  passedCount: number;
  lastAttemptAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface LocalStudyMemory {
  id: string;
  courseId: string | null;
  notebookId: string | null;
  targetType: string;
  scope: string;
  kind: string;
  status: string;
  source: string;
  title: string;
  text: string;
  reason: string | null;
  question: string | null;
  sourceReferences: unknown[];
  confidence: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface LocalAsset {
  id: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  source: string | null;
  dataBase64: string | null;
  storagePath?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface LocalPageAsset {
  id: string;
  pageId: string;
  assetId: string;
  role: string;
  order: number;
  meta: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface LocalNotebookAssetLink {
  id: string;
  notebookId: string;
  assetId: string;
  createdAt: number;
  updatedAt: number;
}

export interface LocalCourseWorkspace {
  course: LocalCourse;
  notebooks: LocalNotebook[];
  problems: LocalProblem[];
  conversations: LocalConversation[];
  memories: LocalStudyMemory[];
}

export interface LocalNotebookDocument {
  notebook: LocalNotebook;
  pages: LocalNotebookPage[];
  markdownSections: LocalMarkdownSection[];
  assets: LocalAsset[];
  pageAssets: LocalPageAsset[];
  notebookAssets: LocalNotebookAssetLink[];
}

export interface LocalProblemDocument {
  problem: LocalProblem;
  attempts: LocalProblemAttempt[];
  progress: LocalProblemProgress | null;
}

export type LocalCourseSearchResultType = 'memory' | 'notebook' | 'problem';

export interface LocalCourseSearchResult {
  id: string;
  resourceId: string | null;
  type: LocalCourseSearchResultType;
  title: string;
  excerpt: string;
  updatedAt: number;
}
