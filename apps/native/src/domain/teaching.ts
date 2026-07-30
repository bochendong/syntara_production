export type NativeTeachingEvidenceSourceType =
  | 'control_fact'
  | 'memory'
  | 'conversation'
  | 'calendar'
  | 'schedule'
  | 'problem_attempt'
  | 'problem_bank'
  | 'template'
  | 'notebook'
  | 'source'
  | 'course_material'
  | 'knowledge_cache'
  | 'web'
  | 'user'
  | 'system';

export interface NativeTeachingEvidence {
  id?: string;
  sourceType: NativeTeachingEvidenceSourceType;
  sourceId?: string;
  title?: string;
  excerpt?: string;
  reason?: string;
  confidence?: number;
  occurredAt?: string;
  conceptTags?: string[];
  metadata?: Record<string, unknown>;
}

export type NativeLearningActionKind =
  | 'calendar.propose_add'
  | 'calendar.propose_update'
  | 'calendar.propose_delete'
  | 'calendar.search'
  | 'calendar.start_recent'
  | 'memory.search'
  | 'web.search'
  | 'review_mode.request_choice'
  | 'learner_progress.request_confirmation'
  | 'practice.propose_generation'
  | 'classroom.propose_temporary_explanation'
  | 'image.propose_generation'
  | 'memory.propose_write';

export type NativeLearningActionStatus =
  | 'proposed'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'failed';

export type NativeLearningActionConfirmation = 'none' | 'optional' | 'required';

export interface NativeLearningActionResult {
  status: NativeLearningActionStatus;
  executor: 'native-client' | 'native-core' | 'server' | 'simulator';
  executedAt: number;
  summary: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
}

export interface NativeLearningAction {
  id: string;
  kind: NativeLearningActionKind;
  label: string;
  summary?: string;
  status?: NativeLearningActionStatus;
  confirmation?: NativeLearningActionConfirmation;
  payload?: Record<string, unknown>;
  result?: NativeLearningActionResult;
  evidence?: NativeTeachingEvidence[];
}

export interface NativeReviewPlanTask {
  id: string;
  title: string;
  activity?: 'review' | 'template_drill' | 'practice' | 'diagnostic' | 'reflection';
  date?: string;
  concepts?: string[];
  minutes?: number;
  reason?: string;
  evidenceIds?: string[];
  problemIds?: string[];
}

export interface NativeReviewPlanCalendarItem {
  id?: string;
  eventId?: string;
  title: string;
  date?: string;
  durationMinutes?: number;
  reason?: string;
}

export interface NativeReviewPlan {
  id: string;
  title: string;
  summary?: string;
  learningGoal?: string;
  estimatedMinutes?: number;
  tasks: NativeReviewPlanTask[];
  calendarItems?: NativeReviewPlanCalendarItem[];
  evidence?: NativeTeachingEvidence[];
  rationale?: string[];
  gaps?: string[];
  nextSteps?: string[];
}

export interface NativeSelectedProblem {
  problemId: string;
  title: string;
  reason: string;
  evidenceIds?: string[];
  type?: string;
  difficulty?: string;
  tags?: string[];
  latestAttemptStatus?: string | null;
  metadata?: Record<string, unknown>;
}

export interface NativeProblemSelection {
  id: string;
  title?: string;
  query?: string;
  requestedCount?: number;
  problems: NativeSelectedProblem[];
  evidence?: NativeTeachingEvidence[];
  rationale?: string[];
  gaps?: string[];
}

export interface NativeMessageMetadata {
  schemaVersion?: 1;
  lectureEligible?: boolean;
  lectureEligibilityReason?: 'course_answer' | 'explicit_classroom_action' | 'bundled_reference';
  learningActions?: NativeLearningAction[];
  reviewPlan?: NativeReviewPlan;
  problemSelection?: NativeProblemSelection;
  evidence?: NativeTeachingEvidence[];
  lectureDeckId?: string;
  teachingRunId?: string;
  model?: {
    provider?: string;
    model?: string;
    responseId?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
  };
  [key: string]: unknown;
}
