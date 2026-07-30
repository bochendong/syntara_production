export type LocalCourseEventKind =
  | 'assignment'
  | 'exam'
  | 'progress'
  | 'tutorial'
  | 'holiday'
  | 'other';

export type LocalCourseEventSource =
  | 'manual'
  | 'syllabus'
  | 'review-plan'
  | 'ai-proposal'
  | 'bundled'
  | 'imported';

export type LocalCourseEventStatus = 'active' | 'completed' | 'cancelled';

/**
 * A course-local, date-only calendar event.
 *
 * `date` uses `YYYY-MM-DD`, matching the existing local schedule format and
 * avoiding timezone shifts for all-day learning events.
 */
export interface LocalCourseEvent {
  id: string;
  courseId: string;
  title: string;
  date: string;
  note: string;
  kind: LocalCourseEventKind;
  source: LocalCourseEventSource;
  status: LocalCourseEventStatus;
  createdAt: number;
  updatedAt: number;
}

/**
 * IDs supplied by an AI route or review-plan artifact are not globally unique.
 * Persist them under the owning course and feature namespace so the SQLite
 * primary key cannot make one course overwrite another course's event.
 */
export function courseScopedEventId(
  courseId: string,
  namespace: 'ai-proposal' | 'review-plan',
  externalId: string,
): string {
  const prefix = `native-course-event:${encodeURIComponent(courseId)}:${namespace}:`;
  const normalized = externalId.trim();
  if (!normalized) throw new Error('课程日历事项缺少可持久化 ID。');
  return normalized.startsWith(prefix) ? normalized : `${prefix}${encodeURIComponent(normalized)}`;
}

export function reviewPlanEventId(
  courseId: string,
  planId: string,
  taskId: string,
  externalId?: string | null,
): string {
  const normalizedExternalId = externalId?.trim();
  const coursePrefix = `native-course-event:${encodeURIComponent(courseId)}:review-plan:`;
  if (normalizedExternalId?.startsWith(coursePrefix)) return normalizedExternalId;
  return courseScopedEventId(
    courseId,
    'review-plan',
    `${planId.trim() || 'plan'}:${normalizedExternalId || taskId.trim() || 'task'}`,
  );
}

export type MiniLectureOrigin = 'generated' | 'bundled' | 'imported';

export type MiniLectureDeckStatus = 'draft' | 'generating' | 'ready' | 'failed' | 'archived';

export type MiniLecturePageRecoveryStatus = 'pending' | 'passed' | 'failed';

export type MiniLectureGeneratorMeta = {
  imageProvider?: string;
  imageModel?: string;
  ttsProvider?: string;
  ttsModel?: string;
  ttsVoice?: string;
  [key: string]: unknown;
};

export type MiniLectureRegion = {
  id: string;
  semanticId: string;
  label: string;
  order: number;
  role: string;
  color: string;
  /** Classroom canvas coordinates: [left, top, width, height]. */
  bbox: [number, number, number, number];
};

export type PersistedMiniLectureSpotlightAction = {
  id: string;
  type: 'spotlight';
  regionId: string;
  title: string;
  dimOpacity: number;
};

export type PersistedMiniLectureSpeechAction = {
  id: string;
  type: 'speech';
  regionId: string;
  title: string;
  text: string;
  /**
   * References an `assets.id`. Persisted actions never contain a device-local
   * URL; the repository resolves that URL when it builds the runtime deck.
   */
  audioAssetId: string;
  audioProvider?: string;
  audioModel?: string;
  audioVoice?: string;
  audioSha256?: string;
  audioBytes?: number;
};

export type PersistedMiniLectureAction =
  | PersistedMiniLectureSpotlightAction
  | PersistedMiniLectureSpeechAction;

export interface PersistedMiniLectureDeck {
  id: string;
  messageId: string;
  title: string;
  origin: MiniLectureOrigin;
  packageName: string | null;
  packageVersion: number;
  status: MiniLectureDeckStatus;
  generatorMeta: MiniLectureGeneratorMeta;
  createdAt: number;
  updatedAt: number;
}

export interface PersistedMiniLecturePage {
  id: string;
  deckId: string;
  order: number;
  title: string;
  imageAssetId: string;
  width: number;
  height: number;
  recoveryStatus: MiniLecturePageRecoveryStatus;
  regions: MiniLectureRegion[];
  actions: PersistedMiniLectureAction[];
  createdAt: number;
  updatedAt: number;
}

export interface PersistedMiniLectureDocument {
  deck: PersistedMiniLectureDeck;
  pages: PersistedMiniLecturePage[];
}

export function miniLectureAssetIds(
  pages: Array<Pick<PersistedMiniLecturePage, 'imageAssetId' | 'actions'>>,
): Set<string> {
  const assetIds = new Set<string>();
  for (const page of pages) {
    assetIds.add(page.imageAssetId);
    for (const action of page.actions) {
      if (action.type === 'speech') assetIds.add(action.audioAssetId);
    }
  }
  return assetIds;
}

export type RuntimeMiniLectureSpeechAction = PersistedMiniLectureSpeechAction & {
  /** Runtime-only URL resolved from `audioAssetId`. */
  audioUrl: string;
};

export type RuntimeMiniLectureAction =
  | PersistedMiniLectureSpotlightAction
  | RuntimeMiniLectureSpeechAction;

export interface RuntimeMiniLecturePage extends Omit<PersistedMiniLecturePage, 'actions'> {
  /** Runtime-only URL resolved from `imageAssetId`. */
  imageUrl: string;
  actions: RuntimeMiniLectureAction[];
}

export interface RuntimeMiniLectureDeck extends PersistedMiniLectureDeck {
  pages: RuntimeMiniLecturePage[];
}
