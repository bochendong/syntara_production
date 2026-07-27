import type { CoursePurpose } from '@/lib/utils/database';
import type { NotebookContentDocument } from '@/lib/notebook-content';
import type { QuestionMemoryDiagnosis } from '@/features/memory/domain/learner-memory-update';

export type NotebookSceneBrief = {
  id: string;
  order: number;
  type: 'slide' | 'quiz' | 'interactive' | 'pbl' | 'markdown';
  title: string;
  knowledgeDigest: string;
};

export type NotebookKnowledgeReference = {
  order: number;
  title: string;
  why: string;
};

export type NotebookInsertOperation = {
  afterOrder: number;
  type: 'slide' | 'quiz';
  title: string;
  description: string;
  keyPoints: string[];
  contentDocument?: NotebookContentDocument;
};

export type NotebookUpdateOperation = {
  order: number;
  title?: string;
  appendKnowledge?: string;
};

export type NotebookDeleteOperation = {
  order: number;
  reason: string;
};

export type NotebookMessagePlan = {
  answer: string;
  answerDocument?: NotebookContentDocument;
  references: NotebookKnowledgeReference[];
  knowledgeGap: boolean;
  operations: {
    insert: NotebookInsertOperation[];
    update: NotebookUpdateOperation[];
    delete: NotebookDeleteOperation[];
  };
  /** Evidence-gated learner-state diagnosis produced with the reply. */
  memoryDiagnosis?: QuestionMemoryDiagnosis;
};

export type NotebookDurableMemoryWriteback = {
  status: 'created' | 'updated' | 'skipped' | 'unavailable' | 'failed';
  storage: 'database';
  memoryId?: string;
  knowledgePointKey?: string;
  reason?: string;
};

export type NotebookDurableMemoryReconciliation = {
  attempted: number;
  syncedLocalMemoryIds: string[];
  results: Array<NotebookDurableMemoryWriteback & { localMemoryId: string }>;
};

export type SendNotebookMessageRequest = {
  message: string;
  /** Stable ID of the persisted local user message that produced this request. */
  clientMessageId?: string;
  conversation?: Array<{
    role: 'user' | 'assistant';
    content: string;
    at?: number;
  }>;
  attachments?: Array<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    /** text attachments only; truncate on client */
    textExcerpt?: string;
  }>;
  notebook: {
    id: string;
    name: string;
    description?: string;
    scenes: NotebookSceneBrief[];
  };
  course?: {
    id?: string;
    name?: string;
    purpose?: CoursePurpose;
    language?: 'zh-CN' | 'en-US';
    tags?: string[];
    university?: string;
    courseCode?: string;
  };
  learnerWorkingMemory?: {
    source: 'chat_turn' | 'problem_attempt' | 'manual';
    summary: string;
    currentTask?: string;
    masteredSignal?: string;
    stuckPoint?: string;
    probableCause?: string;
    nextTeachingMove?: string;
    updatedAt: number;
  };
  learnerDurableMemory?: Array<{
    id: string;
    kind: 'knowledge_gap' | 'mistake' | 'preference' | 'reflection' | 'manual';
    knowledgePoint: string;
    masteredSignal?: string;
    stuckPoint?: string;
    cause?: string;
    nextTeachingMove: string;
    sourceMessageIds: string[];
    updatedAt: number;
    pendingServerSync?: {
      clientMessageId: string;
      action: 'create' | 'revise';
      evidenceFromMessage: string[];
      confidence: 'low' | 'medium' | 'high';
      durableMemoryReason: string;
      queuedAt: number;
    };
  }>;
  options?: {
    allowWrite?: boolean;
    preferWebSearch?: boolean;
    webSearchApiKey?: string;
  };
};

export type SendNotebookMessageResponse = NotebookMessagePlan & {
  webSearchUsed?: boolean;
  prerequisiteHints?: string[];
  promptLogId?: string;
  durableMemoryWriteback?: NotebookDurableMemoryWriteback;
  durableMemoryReconciliation?: NotebookDurableMemoryReconciliation;
};

export type SendNotebookMessageStreamEvent =
  | { type: 'answer_delta'; data: { content: string } }
  | { type: 'status'; data: { message: string } }
  | { type: 'final'; data: SendNotebookMessageResponse }
  | { type: 'error'; data: { message: string } };
