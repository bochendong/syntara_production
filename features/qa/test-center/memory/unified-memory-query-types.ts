export const UNIFIED_MEMORY_QUERY_TOOL_IDS = [
  'read_user_profile',
  'read_calendar',
  'search_working_memory',
  'search_learning_memory',
  'search_problem_attempts',
  'search_notebooks',
  'search_problem_bank',
] as const;

export type UnifiedMemoryQueryToolId = (typeof UNIFIED_MEMORY_QUERY_TOOL_IDS)[number];

export type UnifiedMemoryQueryIntent =
  | 'personal_context'
  | 'learning_state'
  | 'concept_explanation'
  | 'problem_explanation'
  | 'calendar_read'
  | 'calendar_update'
  | 'mixed';

export type UnifiedMemoryQueryRequest = {
  action: 'run_unified_memory_query';
  caseId: string;
  query: string;
  today: string;
  timezone: string;
  user: {
    id: string;
    name: string;
    courseCode: 'CSC148';
  };
  sources: {
    profile: {
      facts: Array<{
        id: string;
        namespace: string;
        key: string;
        valueJson: unknown;
        updatedAt: number;
      }>;
    };
    calendar: Array<{
      id: string;
      title: string;
      startsAt: string;
      endsAt: string | null;
      durationMinutes: number | null;
      timezone: string;
      status: string;
    }>;
    workingMemory: unknown | null;
    memories: Array<{
      id: string;
      title: string;
      text: string;
      kind: string;
      scope: string;
      status: string;
      updatedAt: number;
    }>;
    attempts: Array<{
      id: string;
      problemId: string;
      problemTitle: string;
      concept: string;
      status: string;
      score: number;
      maxScore: number | null;
      answerPreview: string | null;
      feedback: string;
      createdAt: number;
    }>;
    notebooks: Array<{
      id: string;
      title: string;
      content: string;
      updatedAt: number;
    }>;
  };
};

export type UnifiedMemoryQueryToolCall = {
  toolId: UnifiedMemoryQueryToolId;
  reason: string;
  query: string | null;
  limit: number;
};

export type UnifiedMemoryQueryToolTrace = UnifiedMemoryQueryToolCall & {
  status: 'completed' | 'failed';
  durationMs: number;
  outputEvidenceIds: string[];
  error: string | null;
};

export type UnifiedMemoryQueryEvidence = {
  id: string;
  sourceType:
    | 'profile'
    | 'schedule'
    | 'working_memory'
    | 'learning_memory'
    | 'attempt'
    | 'notebook'
    | 'problem';
  title: string;
  excerpt: string;
  sourceId: string;
  score: number | null;
};

export type UnifiedMemoryCalendarAction = {
  status: 'none' | 'needs_clarification' | 'ready';
  operation: 'update' | null;
  targetEvidenceId: string | null;
  targetEventId: string | null;
  updatedTitle: string | null;
  updatedStartsAt: string | null;
  durationMinutes: number | null;
  confirmationSummary: string | null;
  clarificationQuestion: string | null;
};

export type UnifiedMemoryQueryResponse = {
  action: 'run_unified_memory_query';
  caseId: string;
  model: string;
  agent: {
    intent: UnifiedMemoryQueryIntent;
    decisionSummary: string;
    calls: UnifiedMemoryQueryToolCall[];
  };
  trace: UnifiedMemoryQueryToolTrace[];
  evidence: UnifiedMemoryQueryEvidence[];
  answer: {
    message: string;
    evidenceState: 'sufficient' | 'partial' | 'insufficient';
    citedEvidenceIds: string[];
    calendarAction: UnifiedMemoryCalendarAction;
  };
  problemBank: {
    courseCode: 'CSC148';
    source: string;
    totalCount: number;
    selectedProblemIds: string[];
  };
  machineChecks: Array<{
    id: string;
    label: string;
    passed: boolean;
    detail: string;
  }>;
  passedMachineCheck: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    totalTokens: number;
  };
  persistence: 'none';
};
