import Dexie, { type EntityTable } from 'dexie';
import type { Scene, SceneType, SceneContent, Whiteboard } from '@/lib/types/stage';
import type { Action } from '@/lib/types/action';
import type {
  SessionType,
  SessionStatus,
  SessionConfig,
  ToolCallRecord,
  ToolCallRequest,
} from '@/lib/types/chat';
import type { SceneOutline } from '@/lib/types/generation';
import type { UIMessage } from 'ai';
import { createLogger } from '@/lib/logger';
import type { ProtocolMessageEnvelope } from '@/lib/types/agent-chat-protocol';

const log = createLogger('Database');

/**
 * Legacy Snapshot type for undo/redo functionality
 * Used by useSnapshotStore
 */
export interface Snapshot {
  id?: number;
  index: number;
  slides: Scene[];
}

/**
 * Synatra Local Database
 *
 * Uses IndexedDB to store all user data locally
 * - Does not delete expired data; all data is stored permanently
 * - Uses a fixed database name
 * - Supports multi-course management
 */

// ==================== Database Table Type Definitions ====================

/** 课程容器：其下可包含多个笔记本（原 Stage 一条记录 = 一个笔记本） */
export type CoursePurpose = 'research' | 'university' | 'daily';
export type AcademicTerm = 'winter' | 'summer' | 'fall';

export interface CourseRecord {
  id: string;
  name: string;
  description?: string;
  language: 'zh-CN' | 'en-US';
  tags: string[];
  purpose: CoursePurpose;
  /** 用途为大学课程时可选 */
  university?: string;
  courseCode?: string;
  academicYear?: number;
  academicTerm?: AcademicTerm;
  /** 课程头像，如 `/avatars/notebook-agents/xxx.avif` */
  avatarUrl?: string;
  /** 是否在课程商城对其他人可见（仅服务端课程） */
  listedInCourseStore?: boolean;
  coursePriceCents?: number;
  storePublishedAt?: number | string;
  sourceCourseId?: string;
  /** 旧版商城课程副本或已加入课程的源课程创作者展示名 */
  sourceOwnerName?: string;
  /** 当前用户与课程的关系：创建者可编辑，已加入课程只读 */
  accessRole?: 'owner' | 'enrolled';
  joinedAt?: number | string;
  notebookCount?: number;
  sceneCount?: number;
  problemCount?: number;
  publishedProblemCount?: number;
  speechReadyCount?: number;
  speechTotalCount?: number;
  speechStatus?: 'no_speech' | 'ready' | 'pending';
  createdAt: number;
  updatedAt: number;
}

export type LocalSchoolRole = 'student' | 'teacher';
export type AcademicCourseStatus = 'active' | 'archived';
export type CourseContentType = 'notebook' | 'problem_bank' | 'source';
export type CourseSourceCategory =
  | 'school_teacher_notes'
  | 'crash_course_teacher_notes'
  | 'problem_bank';

export interface LocalNotebookSectionRecord {
  id: string;
  title: string;
  summary?: string;
  markdown: string;
  order: number;
  sourcePages: number[];
}

export interface LocalNotebookQualityCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface LocalNotebookGenerationRecord {
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  sourcePageCount: number;
  qualityScore: number;
  qualityChecks: LocalNotebookQualityCheck[];
  generatedAt: number;
}

export interface LocalMindMapRecord {
  imageUrl: string;
  width: number;
  height: number;
  mimeType: string;
  sourceId: string;
  providerId?: string;
  model?: string;
  generatedAt: number;
}

/** Browser-local account used by the web-only school portal during local testing. */
export interface LocalSchoolAccountRecord {
  id: string;
  username: string;
  passwordDigest: string;
  displayName: string;
  role: LocalSchoolRole;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  attributes: Record<string, string | number | boolean>;
  createdAt: number;
  updatedAt: number;
}

/** One delivery of a course, e.g. CSC108 · 2026 Winter. */
export interface AcademicCourseRecord {
  id: string;
  /**
   * Legacy creator attribution. Institution-synced course management authority
   * comes from currentInstructorId + InstructorAssignmentRecord instead.
   */
  ownerId: string;
  currentInstructorId?: string;
  /** Stable identifier supplied by the education institution. */
  institutionCourseId?: string;
  institutionId?: string;
  syncSource?: 'institution' | 'local';
  lastSyncedAt?: number;
  code: string;
  name: string;
  description?: string;
  academicYear: number;
  term: AcademicTerm;
  status: AcademicCourseStatus;
  createdAt: number;
  updatedAt: number;
}

export interface CourseAccessRecord {
  /** `${userId}:${courseId}` */
  id: string;
  userId: string;
  courseId: string;
  role: LocalSchoolRole;
  /** Institution roster sync is the authority for production course access. */
  source?: 'institution' | 'local';
  externalEnrollmentId?: string;
  /** Institution-supplied student profile snapshot for teacher roster display. */
  studentName?: string;
  studentPhone?: string;
  studentAvatarUrl?: string;
  /** Students only receive the AI course surface when this is not false. */
  aiEnabled?: boolean;
  status: 'active' | 'revoked';
  grantedAt: number;
  updatedAt: number;
}

/** One institution-authoritative interval in which a teacher manages a course offering. */
export interface InstructorAssignmentRecord {
  id: string;
  courseId: string;
  teacherId: string;
  source: 'institution';
  startedAt: number;
  endedAt?: number;
  observedAt: number;
  createdAt: number;
}

/** A content asset exists once and can be referenced by many course deliveries. */
export interface CourseContentAssetRecord {
  id: string;
  ownerId: string;
  originCourseId: string;
  type: CourseContentType;
  title: string;
  description?: string;
  sourceCategory?: CourseSourceCategory;
  sourceFileId?: string;
  knowledgeRecordId?: string;
  notebookSections?: LocalNotebookSectionRecord[];
  generation?: LocalNotebookGenerationRecord;
  mindMap?: LocalMindMapRecord;
  createdAt: number;
  updatedAt: number;
}

/** Immutable snapshot pinned by a course content item. */
export interface CourseContentAssetVersionRecord {
  id: string;
  assetId: string;
  version: number;
  title: string;
  description?: string;
  sourceCategory?: CourseSourceCategory;
  sourceFileId?: string;
  createdByTeacherId: string;
  createdAt: number;
}

export type CourseContentItemMode = 'uploaded' | 'migrated' | 'generated';
export type CourseContentItemStatus = 'active' | 'hidden' | 'superseded';

/**
 * Course-scoped content item. Migration reuses an immutable asset version while
 * upload creates a new logical asset; neither action is deduplicated by content.
 */
export interface CourseContentReferenceRecord {
  id: string;
  courseId: string;
  assetId: string;
  assetVersionId?: string;
  mode?: CourseContentItemMode;
  status?: CourseContentItemStatus;
  createdByTeacherId?: string;
  inheritedFromCourseId?: string;
  migrationBatchId?: string;
  replacesReferenceId?: string;
  hiddenAt?: number;
  hiddenByTeacherId?: string;
  hiddenReason?: string;
  /** Zero-based teaching order for notebooks within this course. */
  learningOrder?: number;
  createdAt: number;
  updatedAt?: number;
}

export type CourseContentEventAction =
  | 'teacher_assigned'
  | 'teacher_unassigned'
  | 'uploaded'
  | 'migrated'
  | 'generated'
  | 'hidden'
  | 'restored'
  | 'permanently_deleted'
  | 'reordered'
  | 'superseded';

/** Append-only handoff and course-content audit event. */
export interface CourseContentEventRecord {
  id: string;
  courseId: string;
  referenceId?: string;
  actorTeacherId?: string;
  actorType: 'teacher' | 'institution_sync' | 'system';
  action: CourseContentEventAction;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface LocalSourceFileRecord {
  id: string;
  ownerId: string;
  fileName: string;
  mimeType: string;
  size: number;
  blob?: Blob;
  createdAt: number;
}

export interface LocalCourseKnowledgeRecord {
  id: string;
  courseId: string;
  sourceFileId: string;
  title: string;
  text: string;
  summary: string;
  sourcePageCount?: number;
  createdAt: number;
  updatedAt: number;
}

export type LocalKnowledgeQueueStatus = 'queued' | 'running' | 'completed' | 'failed';
export type LocalKnowledgeQueueStage =
  | 'queued'
  | 'extracting'
  | 'writing_knowledge'
  | 'generating_notebook'
  | 'creating_notebook_reference'
  | 'generating_mind_map'
  | 'persisting_mind_map'
  | 'completed'
  | 'failed';

export interface LocalKnowledgeQueueJobRecord {
  id: string;
  kind?: 'knowledge_notebook' | 'mind_map';
  courseId: string;
  sourceFileId: string;
  sourceAssetId: string;
  notebookId?: string;
  requestedBy: string;
  status: LocalKnowledgeQueueStatus;
  stage: LocalKnowledgeQueueStage;
  progress: number;
  attemptCount: number;
  errorReason?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
}

export interface LocalUsageEventRecord {
  id: string;
  teacherId: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  jobId: string;
  sourceFileId: string;
  sourceFileName: string;
  operation: 'pdf_notebook_generation';
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  qualityScore: number;
  createdAt: number;
}

/** Incremental daily bucket used by the usage chart instead of scanning raw events. */
export interface LocalUsageDailyRollupRecord {
  /** `${teacherId}:${utcDate}:${model}:${courseId}` */
  id: string;
  teacherId: string;
  utcDate: string;
  model: string;
  providerId: string;
  courseId: string;
  courseCode: string;
  jobCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  updatedAt: number;
}

/** One row per teacher for constant-cost usage summary cards. */
export interface LocalUsageTeacherTotalRecord {
  teacherId: string;
  jobCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  firstEventAt: number;
  lastEventAt: number;
  updatedAt: number;
}

export type LocalAiUsageOperation =
  | 'pdf_notebook_generation'
  | 'mind_map_generation'
  | 'course_chat'
  | 'practice_help'
  | 'review_plan'
  | 'mini_lecture';

/** Role-neutral AI usage audit row shared by the student and teacher portals. */
export interface LocalAiUsageEventRecord {
  id: string;
  userId: string;
  role: LocalSchoolRole;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  operation: LocalAiUsageOperation;
  activityLabel: string;
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  qualityScore?: number;
  sourceFileName?: string;
  createdAt: number;
}

/** Incremental per-day bucket; charts read only their bounded date range. */
export interface LocalAiUsageDailyRollupRecord {
  /** `${userId}:${utcDate}:${model}:${courseId}:${operation}` */
  id: string;
  userId: string;
  role: LocalSchoolRole;
  utcDate: string;
  model: string;
  providerId: string;
  courseId: string;
  courseCode: string;
  operation: LocalAiUsageOperation;
  activityLabel: string;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  updatedAt: number;
}

/** One constant-cost total row per local user. */
export interface LocalAiUsageTotalRecord {
  userId: string;
  role: LocalSchoolRole;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  firstEventAt: number;
  lastEventAt: number;
  updatedAt: number;
}

export function localUsageUtcDateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** 课程商城「社区」列表项（含创作者与笔记本数量） */
export type CommunityCourseListItem = CourseRecord & {
  ownerName: string;
  notebookCount: number;
  averageRating?: number;
  reviewCount?: number;
  purchased?: boolean;
};

/**
 * Stage table — 一个 Stage = 一门课程下的一个「笔记本」（互动课件）
 */
export interface StageRecord {
  id: string; // Primary key
  /** 所属课程（Course） */
  courseId?: string;
  /** 笔记本头像 */
  avatarUrl?: string;
  name: string;
  description?: string;
  tags?: string[];
  createdAt: number; // timestamp
  updatedAt: number; // timestamp
  language?: string;
  style?: string;
  currentSceneId?: string;
}

/**
 * Scene table - Scene/page data
 */
export interface SceneRecord {
  id: string; // Primary key
  stageId: string; // Foreign key -> stages.id
  type: SceneType;
  title: string;
  order: number; // Display order
  content: SceneContent; // Stored as JSON
  actions?: Action[]; // Stored as JSON
  whiteboard?: Whiteboard[]; // Stored as JSON
  createdAt: number;
  updatedAt: number;
}

/**
 * AudioFile table - Audio files (TTS)
 */
export interface AudioFileRecord {
  id: string; // Primary key (audioId)
  blob: Blob; // Audio binary data
  duration?: number; // Duration (seconds)
  format: string; // mp3, wav, etc.
  text?: string; // Corresponding text content
  voice?: string; // Voice used
  createdAt: number;
  ossKey?: string; // Full CDN URL for this audio blob
}

/**
 * ImageFile table - Image files
 */
export interface ImageFileRecord {
  id: string; // Primary key
  blob: Blob; // Image binary data
  filename: string; // Original filename
  mimeType: string; // image/png, image/jpeg, etc.
  size: number; // File size (bytes)
  createdAt: number;
}

/**
 * ChatSession table - Chat session data
 */
export interface ChatSessionRecord {
  id: string; // PK (session id)
  stageId: string; // FK -> stages.id
  type: SessionType;
  title: string;
  status: SessionStatus;
  messages: UIMessage[]; // JSON-safe serialized messages
  config: SessionConfig;
  toolCalls: ToolCallRecord[];
  pendingToolCalls: ToolCallRequest[];
  createdAt: number;
  updatedAt: number;
  sceneId?: string;
  lastActionIndex?: number;
}

/**
 * ContactConversation table - course-level chat timelines
 * Used by /chat (notebook + course-agent contacts)
 */
export type ContactConversationKind = 'notebook' | 'agent';

export interface ContactConversationRecord {
  /** PK: `${kind}:${targetId}` */
  id: string;
  courseId: string;
  kind: ContactConversationKind;
  targetId: string;
  targetName: string;
  /** JSON-safe message array; exact shape depends on contact kind */
  messages: unknown[];
  createdAt: number;
  updatedAt: number;
}

export type AgentTaskStatus = 'running' | 'waiting' | 'done' | 'failed';
export type AgentTaskContactKind = 'notebook' | 'agent';

export interface AgentTaskRecord {
  id: string;
  courseId: string;
  /** 与互动教室 `/classroom/[id]`、Prisma `AgentTask.notebookId` 一致 */
  notebookId?: string;
  parentTaskId?: string;
  contactKind: AgentTaskContactKind;
  contactId: string;
  status: AgentTaskStatus;
  title: string;
  detail?: string;
  lastEnvelope?: ProtocolMessageEnvelope;
  createdAt: number;
  updatedAt: number;
}

/**
 * PlaybackState table - Playback state snapshot (at most one per stage)
 */
export interface PlaybackStateRecord {
  stageId: string; // PK
  sceneIndex: number;
  actionIndex: number;
  consumedDiscussions: string[];
  updatedAt: number;
}

/**
 * StageOutlines table - Persisted outlines for resume-on-refresh
 */
export interface StageOutlinesRecord {
  stageId: string; // Primary key (FK -> stages.id)
  outlines: SceneOutline[];
  createdAt: number;
  updatedAt: number;
}

/**
 * MediaFile table - AI-generated media files (images/videos)
 */
export interface MediaFileRecord {
  id: string; // Compound key: `${stageId}:${elementId}`
  stageId: string; // FK → stages.id
  type: 'image' | 'video';
  blob: Blob; // Media binary
  mimeType: string; // image/png, video/mp4
  size: number;
  poster?: Blob; // Video thumbnail blob
  prompt: string; // Original prompt (for retry)
  params: string; // JSON-serialized generation params
  error?: string; // If set, this is a failed task (blob is empty placeholder)
  errorCode?: string; // Structured error code (e.g. 'CONTENT_SENSITIVE')
  ossKey?: string; // Full CDN URL for this media blob
  posterOssKey?: string; // Full CDN URL for the poster blob
  createdAt: number;
}

/**
 * GeneratedAgent table - AI-generated agent profiles
 */
export interface GeneratedAgentRecord {
  id: string; // PK: agent ID (e.g. "gen-abc123")
  stageId: string; // FK -> stages.id
  name: string;
  role: string; // 'teacher' | 'assistant' | 'student'
  persona: string;
  avatar: string;
  color: string;
  priority: number;
  createdAt: number;
}

/** Build the compound primary key for mediaFiles: `${stageId}:${elementId}` */
export function mediaFileKey(stageId: string, elementId: string): string {
  return `${stageId}:${elementId}`;
}

// ==================== Database Definition ====================

const DATABASE_NAME = 'Synatra-Database';
const _DATABASE_VERSION = 19;

/**
 * Synatra Database Instance
 */
class SynatraDatabase extends Dexie {
  // Table definitions
  courses!: EntityTable<CourseRecord, 'id'>;
  stages!: EntityTable<StageRecord, 'id'>;
  scenes!: EntityTable<SceneRecord, 'id'>;
  audioFiles!: EntityTable<AudioFileRecord, 'id'>;
  imageFiles!: EntityTable<ImageFileRecord, 'id'>;
  snapshots!: EntityTable<Snapshot, 'id'>; // Undo/redo snapshots (legacy)
  chatSessions!: EntityTable<ChatSessionRecord, 'id'>;
  playbackState!: EntityTable<PlaybackStateRecord, 'stageId'>;
  stageOutlines!: EntityTable<StageOutlinesRecord, 'stageId'>;
  mediaFiles!: EntityTable<MediaFileRecord, 'id'>;
  generatedAgents!: EntityTable<GeneratedAgentRecord, 'id'>;
  contactConversations!: EntityTable<ContactConversationRecord, 'id'>;
  agentTasks!: EntityTable<AgentTaskRecord, 'id'>;
  localSchoolAccounts!: EntityTable<LocalSchoolAccountRecord, 'id'>;
  academicCourses!: EntityTable<AcademicCourseRecord, 'id'>;
  courseAccess!: EntityTable<CourseAccessRecord, 'id'>;
  instructorAssignments!: EntityTable<InstructorAssignmentRecord, 'id'>;
  courseContentAssets!: EntityTable<CourseContentAssetRecord, 'id'>;
  courseContentAssetVersions!: EntityTable<CourseContentAssetVersionRecord, 'id'>;
  courseContentReferences!: EntityTable<CourseContentReferenceRecord, 'id'>;
  courseContentEvents!: EntityTable<CourseContentEventRecord, 'id'>;
  localSourceFiles!: EntityTable<LocalSourceFileRecord, 'id'>;
  localCourseKnowledge!: EntityTable<LocalCourseKnowledgeRecord, 'id'>;
  localKnowledgeQueue!: EntityTable<LocalKnowledgeQueueJobRecord, 'id'>;
  localUsageEvents!: EntityTable<LocalUsageEventRecord, 'id'>;
  localUsageDailyRollups!: EntityTable<LocalUsageDailyRollupRecord, 'id'>;
  localUsageTeacherTotals!: EntityTable<LocalUsageTeacherTotalRecord, 'teacherId'>;
  localAiUsageEvents!: EntityTable<LocalAiUsageEventRecord, 'id'>;
  localAiUsageDailyRollups!: EntityTable<LocalAiUsageDailyRollupRecord, 'id'>;
  localAiUsageTotals!: EntityTable<LocalAiUsageTotalRecord, 'userId'>;

  constructor() {
    super(DATABASE_NAME);

    // Version 1: Initial schema
    this.version(1).stores({
      stages: 'id, updatedAt',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      // Previously had: messages, participants, discussions, sceneSnapshots
    });

    // Version 2: Remove unused tables
    this.version(2).stores({
      stages: 'id, updatedAt',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      // Delete removed tables
      messages: null,
      participants: null,
      discussions: null,
      sceneSnapshots: null,
    });

    // Version 3: Add chatSessions and playbackState tables
    this.version(3).stores({
      stages: 'id, updatedAt',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
    });

    // Version 4: Add stageOutlines table for resume-on-refresh
    this.version(4).stores({
      stages: 'id, updatedAt',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
      stageOutlines: 'stageId',
    });

    // Version 5: Add mediaFiles table for async media generation
    this.version(5).stores({
      stages: 'id, updatedAt',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
      stageOutlines: 'stageId',
      mediaFiles: 'id, stageId, [stageId+type]',
    });

    // Version 6: Fix mediaFiles primary key — use compound key stageId:elementId
    // to prevent cross-course collisions (gen_img_1 is NOT globally unique)
    this.version(6)
      .stores({
        stages: 'id, updatedAt',
        scenes: 'id, stageId, order, [stageId+order]',
        audioFiles: 'id, createdAt',
        imageFiles: 'id, createdAt',
        snapshots: '++id',
        chatSessions: 'id, stageId, [stageId+createdAt]',
        playbackState: 'stageId',
        stageOutlines: 'stageId',
        mediaFiles: 'id, stageId, [stageId+type]',
      })
      .upgrade(async (tx) => {
        const table = tx.table('mediaFiles');
        const allRecords = await table.toArray();
        for (const rec of allRecords) {
          const newKey = `${rec.stageId}:${rec.id}`;
          // Skip if already migrated (idempotent)
          if (rec.id.includes(':')) continue;
          await table.delete(rec.id);
          await table.put({ ...rec, id: newKey });
        }
      });

    // Version 7: Add ossKey fields to mediaFiles and audioFiles for OSS storage plugin
    // Non-indexed optional fields — Dexie handles these transparently.
    this.version(7).stores({
      stages: 'id, updatedAt',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
      stageOutlines: 'stageId',
      mediaFiles: 'id, stageId, [stageId+type]',
    });

    // Version 8: Add generatedAgents table for AI-generated agent profiles
    this.version(8).stores({
      stages: 'id, updatedAt',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
      stageOutlines: 'stageId',
      mediaFiles: 'id, stageId, [stageId+type]',
      generatedAgents: 'id, stageId',
    });

    // Version 9: Courses as containers; stages (notebooks) link via courseId
    this.version(9).stores({
      courses: 'id, updatedAt',
      stages: 'id, updatedAt, courseId',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
      stageOutlines: 'stageId',
      mediaFiles: 'id, stageId, [stageId+type]',
      generatedAgents: 'id, stageId',
    });

    // Version 10: Notebook (stage) avatarUrl — backfill stable avatar per stage id
    this.version(10)
      .stores({
        courses: 'id, updatedAt',
        stages: 'id, updatedAt, courseId',
        scenes: 'id, stageId, order, [stageId+order]',
        audioFiles: 'id, createdAt',
        imageFiles: 'id, createdAt',
        snapshots: '++id',
        chatSessions: 'id, stageId, [stageId+createdAt]',
        playbackState: 'stageId',
        stageOutlines: 'stageId',
        mediaFiles: 'id, stageId, [stageId+type]',
        generatedAgents: 'id, stageId',
      })
      .upgrade(async (tx) => {
        const { pickStableNotebookAgentAvatarUrl } =
          await import('@/lib/constants/notebook-agent-avatars');
        const table = tx.table('stages');
        const rows: Array<{ id: string; avatarUrl?: string }> = await table.toArray();
        const now = Date.now();
        for (const s of rows) {
          if (s.avatarUrl?.trim()) continue;
          await table.update(s.id, {
            avatarUrl: pickStableNotebookAgentAvatarUrl(s.id),
            updatedAt: now,
          });
        }
      });

    // Version 11: Add course-level contact conversations for /chat
    this.version(11).stores({
      courses: 'id, updatedAt',
      stages: 'id, updatedAt, courseId',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
      stageOutlines: 'stageId',
      mediaFiles: 'id, stageId, [stageId+type]',
      generatedAgents: 'id, stageId',
      contactConversations:
        'id, courseId, kind, targetId, updatedAt, [kind+targetId], [courseId+kind], [courseId+updatedAt]',
    });

    // Version 12: Add agent task table for /chat orchestration status
    this.version(12).stores({
      courses: 'id, updatedAt',
      stages: 'id, updatedAt, courseId',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
      stageOutlines: 'stageId',
      mediaFiles: 'id, stageId, [stageId+type]',
      generatedAgents: 'id, stageId',
      contactConversations:
        'id, courseId, kind, targetId, updatedAt, [kind+targetId], [courseId+kind], [courseId+updatedAt]',
      agentTasks:
        'id, courseId, status, contactKind, contactId, updatedAt, [courseId+status], [contactKind+contactId], [courseId+updatedAt]',
    });

    // Version 13: agentTasks parentTaskId + protocol envelope snapshot
    this.version(13).stores({
      courses: 'id, updatedAt',
      stages: 'id, updatedAt, courseId',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
      stageOutlines: 'stageId',
      mediaFiles: 'id, stageId, [stageId+type]',
      generatedAgents: 'id, stageId',
      contactConversations:
        'id, courseId, kind, targetId, updatedAt, [kind+targetId], [courseId+kind], [courseId+updatedAt]',
      agentTasks:
        'id, courseId, parentTaskId, status, contactKind, contactId, updatedAt, [courseId+status], [contactKind+contactId], [courseId+updatedAt], [parentTaskId+updatedAt]',
    });

    // Version 14: web-only local school portal (roles, term courses, shared content, queue)
    this.version(14).stores({
      courses: 'id, updatedAt',
      stages: 'id, updatedAt, courseId',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
      stageOutlines: 'stageId',
      mediaFiles: 'id, stageId, [stageId+type]',
      generatedAgents: 'id, stageId',
      contactConversations:
        'id, courseId, kind, targetId, updatedAt, [kind+targetId], [courseId+kind], [courseId+updatedAt]',
      agentTasks:
        'id, courseId, parentTaskId, status, contactKind, contactId, updatedAt, [courseId+status], [contactKind+contactId], [courseId+updatedAt], [parentTaskId+updatedAt]',
      localSchoolAccounts: 'id, &username, role, updatedAt, [role+username]',
      academicCourses:
        'id, ownerId, code, academicYear, term, status, updatedAt, [ownerId+updatedAt], [code+academicYear+term]',
      courseAccess:
        'id, userId, courseId, role, status, updatedAt, [userId+status], [courseId+status]',
      courseContentAssets: 'id, ownerId, originCourseId, type, updatedAt, [originCourseId+type]',
      courseContentReferences:
        'id, courseId, assetId, inheritedFromCourseId, [courseId+createdAt], [assetId+courseId]',
      localSourceFiles: 'id, ownerId, createdAt',
      localCourseKnowledge: 'id, courseId, sourceFileId, updatedAt, [courseId+updatedAt]',
      localKnowledgeQueue:
        'id, courseId, sourceFileId, sourceAssetId, status, updatedAt, [courseId+updatedAt], [status+createdAt]',
    });

    // Version 15: generated markdown notebooks and browser-local LLM usage ledger.
    this.version(15).stores({
      courses: 'id, updatedAt',
      stages: 'id, updatedAt, courseId',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
      stageOutlines: 'stageId',
      mediaFiles: 'id, stageId, [stageId+type]',
      generatedAgents: 'id, stageId',
      contactConversations:
        'id, courseId, kind, targetId, updatedAt, [kind+targetId], [courseId+kind], [courseId+updatedAt]',
      agentTasks:
        'id, courseId, parentTaskId, status, contactKind, contactId, updatedAt, [courseId+status], [contactKind+contactId], [courseId+updatedAt], [parentTaskId+updatedAt]',
      localSchoolAccounts: 'id, &username, role, updatedAt, [role+username]',
      academicCourses:
        'id, ownerId, code, academicYear, term, status, updatedAt, [ownerId+updatedAt], [code+academicYear+term]',
      courseAccess:
        'id, userId, courseId, role, status, updatedAt, [userId+status], [courseId+status]',
      courseContentAssets: 'id, ownerId, originCourseId, type, updatedAt, [originCourseId+type]',
      courseContentReferences:
        'id, courseId, assetId, inheritedFromCourseId, [courseId+createdAt], [assetId+courseId]',
      localSourceFiles: 'id, ownerId, createdAt',
      localCourseKnowledge: 'id, courseId, sourceFileId, updatedAt, [courseId+updatedAt]',
      localKnowledgeQueue:
        'id, courseId, sourceFileId, sourceAssetId, status, updatedAt, [courseId+updatedAt], [status+createdAt]',
      localUsageEvents:
        'id, teacherId, courseId, jobId, operation, createdAt, [teacherId+createdAt], [courseId+createdAt]',
    });

    // Version 16: pre-aggregated usage buckets and constant-cost teacher totals.
    this.version(16)
      .stores({
        courses: 'id, updatedAt',
        stages: 'id, updatedAt, courseId',
        scenes: 'id, stageId, order, [stageId+order]',
        audioFiles: 'id, createdAt',
        imageFiles: 'id, createdAt',
        snapshots: '++id',
        chatSessions: 'id, stageId, [stageId+createdAt]',
        playbackState: 'stageId',
        stageOutlines: 'stageId',
        mediaFiles: 'id, stageId, [stageId+type]',
        generatedAgents: 'id, stageId',
        contactConversations:
          'id, courseId, kind, targetId, updatedAt, [kind+targetId], [courseId+kind], [courseId+updatedAt]',
        agentTasks:
          'id, courseId, parentTaskId, status, contactKind, contactId, updatedAt, [courseId+status], [contactKind+contactId], [courseId+updatedAt], [parentTaskId+updatedAt]',
        localSchoolAccounts: 'id, &username, role, updatedAt, [role+username]',
        academicCourses:
          'id, ownerId, code, academicYear, term, status, updatedAt, [ownerId+updatedAt], [code+academicYear+term]',
        courseAccess:
          'id, userId, courseId, role, status, updatedAt, [userId+status], [courseId+status]',
        courseContentAssets: 'id, ownerId, originCourseId, type, updatedAt, [originCourseId+type]',
        courseContentReferences:
          'id, courseId, assetId, inheritedFromCourseId, [courseId+createdAt], [assetId+courseId]',
        localSourceFiles: 'id, ownerId, createdAt',
        localCourseKnowledge: 'id, courseId, sourceFileId, updatedAt, [courseId+updatedAt]',
        localKnowledgeQueue:
          'id, courseId, sourceFileId, sourceAssetId, status, updatedAt, [courseId+updatedAt], [status+createdAt]',
        localUsageEvents:
          'id, teacherId, courseId, jobId, operation, createdAt, [teacherId+createdAt], [courseId+createdAt]',
        localUsageDailyRollups:
          'id, teacherId, utcDate, model, courseId, updatedAt, [teacherId+utcDate], [teacherId+model+utcDate], [teacherId+courseId+utcDate]',
        localUsageTeacherTotals: 'teacherId, updatedAt, lastEventAt',
      })
      .upgrade(async (tx) => {
        const events: LocalUsageEventRecord[] = await tx.table('localUsageEvents').toArray();
        const dailyById = new Map<string, LocalUsageDailyRollupRecord>();
        const totalsByTeacher = new Map<string, LocalUsageTeacherTotalRecord>();

        for (const event of events) {
          const utcDate = localUsageUtcDateKey(event.createdAt);
          const dailyId = `${event.teacherId}:${utcDate}:${event.model}:${event.courseId}`;
          const daily = dailyById.get(dailyId) ?? {
            id: dailyId,
            teacherId: event.teacherId,
            utcDate,
            model: event.model,
            providerId: event.providerId,
            courseId: event.courseId,
            courseCode: event.courseCode,
            jobCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            totalTokens: 0,
            updatedAt: event.createdAt,
          };
          daily.jobCount += 1;
          daily.inputTokens += event.inputTokens;
          daily.outputTokens += event.outputTokens;
          daily.cachedInputTokens += event.cachedInputTokens;
          daily.totalTokens += event.totalTokens;
          daily.updatedAt = Math.max(daily.updatedAt, event.createdAt);
          dailyById.set(dailyId, daily);

          const total = totalsByTeacher.get(event.teacherId) ?? {
            teacherId: event.teacherId,
            jobCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            totalTokens: 0,
            firstEventAt: event.createdAt,
            lastEventAt: event.createdAt,
            updatedAt: event.createdAt,
          };
          total.jobCount += 1;
          total.inputTokens += event.inputTokens;
          total.outputTokens += event.outputTokens;
          total.cachedInputTokens += event.cachedInputTokens;
          total.totalTokens += event.totalTokens;
          total.firstEventAt = Math.min(total.firstEventAt, event.createdAt);
          total.lastEventAt = Math.max(total.lastEventAt, event.createdAt);
          total.updatedAt = Math.max(total.updatedAt, event.createdAt);
          totalsByTeacher.set(event.teacherId, total);
        }

        if (dailyById.size > 0) {
          await tx.table('localUsageDailyRollups').bulkPut(Array.from(dailyById.values()));
        }
        if (totalsByTeacher.size > 0) {
          await tx.table('localUsageTeacherTotals').bulkPut(Array.from(totalsByTeacher.values()));
        }
      });

    // Version 17: role-neutral usage ledger used by both student and teacher apps.
    this.version(17)
      .stores({
        courses: 'id, updatedAt',
        stages: 'id, updatedAt, courseId',
        scenes: 'id, stageId, order, [stageId+order]',
        audioFiles: 'id, createdAt',
        imageFiles: 'id, createdAt',
        snapshots: '++id',
        chatSessions: 'id, stageId, [stageId+createdAt]',
        playbackState: 'stageId',
        stageOutlines: 'stageId',
        mediaFiles: 'id, stageId, [stageId+type]',
        generatedAgents: 'id, stageId',
        contactConversations:
          'id, courseId, kind, targetId, updatedAt, [kind+targetId], [courseId+kind], [courseId+updatedAt]',
        agentTasks:
          'id, courseId, parentTaskId, status, contactKind, contactId, updatedAt, [courseId+status], [contactKind+contactId], [courseId+updatedAt], [parentTaskId+updatedAt]',
        localSchoolAccounts: 'id, &username, role, updatedAt, [role+username]',
        academicCourses:
          'id, ownerId, code, academicYear, term, status, updatedAt, [ownerId+updatedAt], [code+academicYear+term]',
        courseAccess:
          'id, userId, courseId, role, status, updatedAt, [userId+status], [courseId+status]',
        courseContentAssets: 'id, ownerId, originCourseId, type, updatedAt, [originCourseId+type]',
        courseContentReferences:
          'id, courseId, assetId, inheritedFromCourseId, [courseId+createdAt], [assetId+courseId]',
        localSourceFiles: 'id, ownerId, createdAt',
        localCourseKnowledge: 'id, courseId, sourceFileId, updatedAt, [courseId+updatedAt]',
        localKnowledgeQueue:
          'id, courseId, sourceFileId, sourceAssetId, status, updatedAt, [courseId+updatedAt], [status+createdAt]',
        localUsageEvents:
          'id, teacherId, courseId, jobId, operation, createdAt, [teacherId+createdAt], [courseId+createdAt]',
        localUsageDailyRollups:
          'id, teacherId, utcDate, model, courseId, updatedAt, [teacherId+utcDate], [teacherId+model+utcDate], [teacherId+courseId+utcDate]',
        localUsageTeacherTotals: 'teacherId, updatedAt, lastEventAt',
        localAiUsageEvents:
          'id, userId, role, courseId, operation, createdAt, [userId+createdAt], [userId+courseId+createdAt]',
        localAiUsageDailyRollups:
          'id, userId, role, utcDate, model, courseId, operation, updatedAt, [userId+utcDate], [userId+model+utcDate], [userId+courseId+utcDate], [userId+operation+utcDate]',
        localAiUsageTotals: 'userId, role, updatedAt, lastEventAt',
      })
      .upgrade(async (tx) => {
        const legacyEvents: LocalUsageEventRecord[] = await tx.table('localUsageEvents').toArray();
        const events: LocalAiUsageEventRecord[] = legacyEvents.map((event) => ({
          id: event.id,
          userId: event.teacherId,
          role: 'teacher',
          courseId: event.courseId,
          courseCode: event.courseCode,
          courseTitle: event.courseTitle,
          operation: event.operation,
          activityLabel: 'PDF 笔记生成',
          providerId: event.providerId,
          model: event.model,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cachedInputTokens: event.cachedInputTokens,
          totalTokens: event.totalTokens,
          qualityScore: event.qualityScore,
          sourceFileName: event.sourceFileName,
          createdAt: event.createdAt,
        }));
        const dailyById = new Map<string, LocalAiUsageDailyRollupRecord>();
        const totalsByUser = new Map<string, LocalAiUsageTotalRecord>();

        for (const event of events) {
          const utcDate = localUsageUtcDateKey(event.createdAt);
          const dailyId = `${event.userId}:${utcDate}:${event.model}:${event.courseId}:${event.operation}`;
          const daily = dailyById.get(dailyId) ?? {
            id: dailyId,
            userId: event.userId,
            role: event.role,
            utcDate,
            model: event.model,
            providerId: event.providerId,
            courseId: event.courseId,
            courseCode: event.courseCode,
            operation: event.operation,
            activityLabel: event.activityLabel,
            callCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            totalTokens: 0,
            updatedAt: event.createdAt,
          };
          daily.callCount += 1;
          daily.inputTokens += event.inputTokens;
          daily.outputTokens += event.outputTokens;
          daily.cachedInputTokens += event.cachedInputTokens;
          daily.totalTokens += event.totalTokens;
          daily.updatedAt = Math.max(daily.updatedAt, event.createdAt);
          dailyById.set(dailyId, daily);

          const total = totalsByUser.get(event.userId) ?? {
            userId: event.userId,
            role: event.role,
            callCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            totalTokens: 0,
            firstEventAt: event.createdAt,
            lastEventAt: event.createdAt,
            updatedAt: event.createdAt,
          };
          total.callCount += 1;
          total.inputTokens += event.inputTokens;
          total.outputTokens += event.outputTokens;
          total.cachedInputTokens += event.cachedInputTokens;
          total.totalTokens += event.totalTokens;
          total.firstEventAt = Math.min(total.firstEventAt, event.createdAt);
          total.lastEventAt = Math.max(total.lastEventAt, event.createdAt);
          total.updatedAt = Math.max(total.updatedAt, event.createdAt);
          totalsByUser.set(event.userId, total);
        }

        if (events.length > 0) await tx.table('localAiUsageEvents').bulkPut(events);
        if (dailyById.size > 0) {
          await tx.table('localAiUsageDailyRollups').bulkPut(Array.from(dailyById.values()));
        }
        if (totalsByUser.size > 0) {
          await tx.table('localAiUsageTotals').bulkPut(Array.from(totalsByUser.values()));
        }
      });

    // Version 18: institution-owned course offerings, teacher handoff history,
    // immutable content versions, and course-scoped soft deletion.
    this.version(18)
      .stores({
        courses: 'id, updatedAt',
        stages: 'id, updatedAt, courseId',
        scenes: 'id, stageId, order, [stageId+order]',
        audioFiles: 'id, createdAt',
        imageFiles: 'id, createdAt',
        snapshots: '++id',
        chatSessions: 'id, stageId, [stageId+createdAt]',
        playbackState: 'stageId',
        stageOutlines: 'stageId',
        mediaFiles: 'id, stageId, [stageId+type]',
        generatedAgents: 'id, stageId',
        contactConversations:
          'id, courseId, kind, targetId, updatedAt, [kind+targetId], [courseId+kind], [courseId+updatedAt]',
        agentTasks:
          'id, courseId, parentTaskId, status, contactKind, contactId, updatedAt, [courseId+status], [contactKind+contactId], [courseId+updatedAt], [parentTaskId+updatedAt]',
        localSchoolAccounts: 'id, &username, role, updatedAt, [role+username]',
        academicCourses:
          'id, currentInstructorId, code, academicYear, term, status, updatedAt, [currentInstructorId+updatedAt], [code+academicYear+term]',
        courseAccess:
          'id, userId, courseId, role, status, updatedAt, [userId+status], [courseId+status]',
        instructorAssignments:
          'id, courseId, teacherId, endedAt, observedAt, [courseId+endedAt], [teacherId+startedAt]',
        courseContentAssets: 'id, ownerId, originCourseId, type, updatedAt, [originCourseId+type]',
        courseContentAssetVersions:
          'id, assetId, version, createdAt, [assetId+version], createdByTeacherId',
        courseContentReferences:
          'id, courseId, assetId, status, mode, inheritedFromCourseId, [courseId+status], [courseId+createdAt], [assetId+courseId]',
        courseContentEvents: 'id, courseId, referenceId, action, createdAt, [courseId+createdAt]',
        localSourceFiles: 'id, ownerId, createdAt',
        localCourseKnowledge: 'id, courseId, sourceFileId, updatedAt, [courseId+updatedAt]',
        localKnowledgeQueue:
          'id, courseId, sourceFileId, sourceAssetId, status, updatedAt, [courseId+updatedAt], [status+createdAt]',
        localUsageEvents:
          'id, teacherId, courseId, jobId, operation, createdAt, [teacherId+createdAt], [courseId+createdAt]',
        localUsageDailyRollups:
          'id, teacherId, utcDate, model, courseId, updatedAt, [teacherId+utcDate], [teacherId+model+utcDate], [teacherId+courseId+utcDate]',
        localUsageTeacherTotals: 'teacherId, updatedAt, lastEventAt',
        localAiUsageEvents:
          'id, userId, role, courseId, operation, createdAt, [userId+createdAt], [userId+courseId+createdAt]',
        localAiUsageDailyRollups:
          'id, userId, role, utcDate, model, courseId, operation, updatedAt, [userId+utcDate], [userId+model+utcDate], [userId+courseId+utcDate], [userId+operation+utcDate]',
        localAiUsageTotals: 'userId, role, updatedAt, lastEventAt',
      })
      .upgrade(async (tx) => {
        const courses: AcademicCourseRecord[] = await tx.table('academicCourses').toArray();
        const accesses: CourseAccessRecord[] = await tx.table('courseAccess').toArray();
        const assets: CourseContentAssetRecord[] = await tx.table('courseContentAssets').toArray();
        const references: CourseContentReferenceRecord[] = await tx
          .table('courseContentReferences')
          .toArray();
        const assetById = new Map(assets.map((asset) => [asset.id, asset] as const));

        for (const course of courses) {
          const activeTeachers = accesses
            .filter(
              (access) =>
                access.courseId === course.id &&
                access.role === 'teacher' &&
                access.source === 'institution' &&
                access.status === 'active',
            )
            .sort((left, right) => right.updatedAt - left.updatedAt);
          const current = activeTeachers[0];
          await tx.table('academicCourses').update(course.id, {
            currentInstructorId: current?.userId,
          });
          for (const stale of activeTeachers.slice(1)) {
            await tx.table('courseAccess').update(stale.id, {
              status: 'revoked',
              updatedAt: current?.updatedAt ?? stale.updatedAt,
            });
          }
        }

        const currentTeacherByCourse = new Map<string, string>();
        for (const course of courses) {
          const currentTeacher = accesses
            .filter(
              (access) =>
                access.courseId === course.id &&
                access.role === 'teacher' &&
                access.source === 'institution' &&
                access.status === 'active',
            )
            .sort((left, right) => right.updatedAt - left.updatedAt)[0];
          if (currentTeacher) currentTeacherByCourse.set(course.id, currentTeacher.userId);
        }

        const assignments: InstructorAssignmentRecord[] = accesses
          .filter((access) => access.role === 'teacher' && access.source === 'institution')
          .map((access) => {
            const isCurrent = currentTeacherByCourse.get(access.courseId) === access.userId;
            return {
              id: `assignment:${access.id}:${access.grantedAt}`,
              courseId: access.courseId,
              teacherId: access.userId,
              source: 'institution',
              startedAt: access.grantedAt,
              ...(isCurrent ? {} : { endedAt: access.updatedAt }),
              observedAt: access.updatedAt,
              createdAt: access.grantedAt,
            };
          });
        if (assignments.length > 0) {
          await tx.table('instructorAssignments').bulkPut(assignments);
        }

        const versions: CourseContentAssetVersionRecord[] = assets.map((asset) => ({
          id: `asset-version:${asset.id}:1`,
          assetId: asset.id,
          version: 1,
          title: asset.title,
          description: asset.description,
          sourceCategory: asset.sourceCategory,
          sourceFileId: asset.sourceFileId,
          createdByTeacherId: asset.ownerId,
          createdAt: asset.createdAt,
        }));
        if (versions.length > 0) {
          await tx.table('courseContentAssetVersions').bulkPut(versions);
        }

        for (const reference of references) {
          const asset = assetById.get(reference.assetId);
          await tx.table('courseContentReferences').update(reference.id, {
            assetVersionId: `asset-version:${reference.assetId}:1`,
            mode: reference.inheritedFromCourseId ? 'migrated' : 'uploaded',
            status: 'active',
            createdByTeacherId: asset?.ownerId,
            updatedAt: reference.createdAt,
          });
        }
      });

    // Version 19: the school portal is server-backed. Remove its obsolete
    // browser-local course, roster, content, queue, and usage tables.
    this.version(19).stores({
      localSchoolAccounts: null,
      academicCourses: null,
      courseAccess: null,
      instructorAssignments: null,
      courseContentAssets: null,
      courseContentAssetVersions: null,
      courseContentReferences: null,
      courseContentEvents: null,
      localSourceFiles: null,
      localCourseKnowledge: null,
      localKnowledgeQueue: null,
      localUsageEvents: null,
      localUsageDailyRollups: null,
      localUsageTeacherTotals: null,
      localAiUsageEvents: null,
      localAiUsageDailyRollups: null,
      localAiUsageTotals: null,
    });
  }
}

// Create database instance
export const db = new SynatraDatabase();

// ==================== Helper Functions ====================

/**
 * Initialize database
 * Call at application startup
 */
export async function initDatabase(): Promise<void> {
  try {
    await db.open();
    // Request persistent storage to prevent browser from evicting IndexedDB
    // under storage pressure (large media blobs can trigger LRU cleanup)
    void navigator.storage?.persist?.();
    log.info('Database initialized successfully');
  } catch (error) {
    log.error('Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Clear database (optional)
 * Use with caution: deletes all data
 */
export async function clearDatabase(): Promise<void> {
  await db.delete();
  log.info('Database cleared');
}

/**
 * Export database contents (for backup)
 */
export async function exportDatabase(): Promise<{
  stages: StageRecord[];
  scenes: SceneRecord[];
  chatSessions: ChatSessionRecord[];
  playbackState: PlaybackStateRecord[];
}> {
  return {
    stages: await db.stages.toArray(),
    scenes: await db.scenes.toArray(),
    chatSessions: await db.chatSessions.toArray(),
    playbackState: await db.playbackState.toArray(),
  };
}

/**
 * Import database contents (for restoring backups)
 */
export async function importDatabase(data: {
  stages?: StageRecord[];
  scenes?: SceneRecord[];
  chatSessions?: ChatSessionRecord[];
  playbackState?: PlaybackStateRecord[];
}): Promise<void> {
  await db.transaction(
    'rw',
    [db.stages, db.scenes, db.chatSessions, db.playbackState],
    async () => {
      if (data.stages) await db.stages.bulkPut(data.stages);
      if (data.scenes) await db.scenes.bulkPut(data.scenes);
      if (data.chatSessions) await db.chatSessions.bulkPut(data.chatSessions);
      if (data.playbackState) await db.playbackState.bulkPut(data.playbackState);
    },
  );
  log.info('Database imported successfully');
}

// ==================== Convenience Query Functions ====================

/**
 * Get all scenes for a course
 */
export async function getScenesByStageId(stageId: string): Promise<SceneRecord[]> {
  return db.scenes.where('stageId').equals(stageId).sortBy('order');
}

/**
 * Delete a course and all its related data
 */
export async function deleteStageWithRelatedData(stageId: string): Promise<void> {
  const resp = await fetch(`/api/notebooks/${encodeURIComponent(stageId)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ error: '删除失败' }));
    throw new Error(data.error || '删除失败');
  }
}

/**
 * Get all generated agents for a course
 */
export async function getGeneratedAgentsByStageId(
  stageId: string,
): Promise<GeneratedAgentRecord[]> {
  return db.generatedAgents.where('stageId').equals(stageId).toArray();
}

/**
 * Get database statistics
 */
export async function getDatabaseStats() {
  return {
    courses: await db.courses.count(),
    stages: await db.stages.count(),
    scenes: await db.scenes.count(),
    audioFiles: await db.audioFiles.count(),
    imageFiles: await db.imageFiles.count(),
    snapshots: await db.snapshots.count(),
    chatSessions: await db.chatSessions.count(),
    playbackState: await db.playbackState.count(),
    stageOutlines: await db.stageOutlines.count(),
    mediaFiles: await db.mediaFiles.count(),
    generatedAgents: await db.generatedAgents.count(),
    contactConversations: await db.contactConversations.count(),
    agentTasks: await db.agentTasks.count(),
  };
}
