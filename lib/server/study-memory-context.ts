import type { PrismaClient } from '@/lib/server/generated-prisma';
import { createLogger } from '@/lib/logger';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  listSupersededMemoryFactEvents,
  resolveEffectiveMemoryFacts,
  type MemoryFactConflict,
  type MemoryFactRecord,
  type MemoryFactScopeRef,
} from '@/lib/server/memory-fact-store';
import {
  problemEvidenceToKnowledgeMatch,
  type MemoryKnowledgeMatch,
} from '@/lib/server/memory-knowledge-search';
import {
  buildLearnerAnalytics,
  type LearnerAnalytics,
} from '@/lib/server/memory-learner-analytics';
import {
  mergeEvidencePackets,
  searchMarkdownSourceEvidence,
  searchProblemAttemptEvidence,
  searchProblemSourceEvidence,
  searchStudentMessageEvidence,
  type MemoryEvidencePacket,
} from '@/lib/server/memory-source-evidence';
import {
  inferMemorySearchIntent,
  type MemorySearchIntent,
  type MemorySearchScopeMode,
} from '@/lib/server/memory-search-intent';
import {
  semanticSearchStudyMemoryChunks,
  type StudyMemorySemanticMatch,
} from '@/lib/server/study-memory-vector-store';
import {
  listKnowledgeCache,
  uniqueKnowledgeCacheEntries,
  type KnowledgeCacheEntry,
} from '@/features/memory/server/knowledge-cache';
import {
  PLATFORM_STUDY_MEMORY_TARGET_ID,
  listCourseStudyMemoryLayersForViewer,
  listStudyMemoriesForViewer,
  resolveReadableStudyMemoryTarget,
  type ReadableStudyMemoryTarget,
  type StudyMemoryRecord,
  type StudyMemoryTargetType,
} from '@/lib/server/study-memory-store';

const log = createLogger('StudyMemoryContext');

type MemorySection = {
  title: string;
  memories: StudyMemoryRecord[];
};

export type MemoryContextTargetType = Extract<StudyMemoryTargetType, 'course' | 'notebook'>;

export type MemoryNotebookScope = {
  /** Null means progress is unknown and notebook recall remains unscoped. */
  allowedNotebookIds: string[] | null;
};

export type MemoryRecallScope = {
  requestedMode: MemorySearchScopeMode;
  effectiveMode: Exclude<MemorySearchScopeMode, 'auto_expand'>;
  expanded: boolean;
  reason: string;
  originalTargetType: MemoryContextTargetType;
  originalTargetId: string;
  effectiveTargetType: MemoryContextTargetType;
  effectiveTargetId: string;
  courseId: string | null;
  notebookId: string | null;
  localEvidenceCount: number;
  courseEvidenceCount: number;
};

export type MemoryRecallContext = {
  prompt: string;
  scope: MemoryRecallScope;
  staticFacts: MemoryFactRecord[];
  courseControllerMemories: StudyMemoryRecord[];
  currentNotebookMemories: StudyMemoryRecord[];
  crossNotebookLearnerMemories: StudyMemoryRecord[];
  specialistMemories: StudyMemoryRecord[];
  directMemories: StudyMemoryRecord[];
  semanticMatches: StudyMemoryRecord[];
  knowledgeCache: KnowledgeCacheEntry[];
  knowledgeMatches: MemoryKnowledgeMatch[];
  sourceEvidence: MemoryEvidencePacket[];
  learnerAnalytics: LearnerAnalytics | null;
  conflicts: MemoryFactConflict[];
  filteredStaleMemoryIds: string[];
  searchIntent: MemorySearchIntent;
  platformMemories: StudyMemoryRecord[];
  directCount: number;
  semanticCount: number;
  knowledgeCacheCount: number;
  knowledgeCount: number;
  sourceEvidenceCount: number;
  learnerAnalyticsCount: number;
  vectorUsed: boolean;
  storage: 'database' | 'unavailable';
};

export type NotebookStudyMemoryPromptContext = MemoryRecallContext;

type MemoryRecallPass = {
  recallTarget: ReadableStudyMemoryTarget;
  directPlatform: StudyMemoryRecord[];
  directCourse: StudyMemoryRecord[];
  directTarget: StudyMemoryRecord[];
  directCourseLearner: StudyMemoryRecord[];
  directMemories: StudyMemoryRecord[];
  semanticMemories: StudyMemoryRecord[];
  knowledgeCache: KnowledgeCacheEntry[];
  knowledgeMatches: MemoryKnowledgeMatch[];
  sourceEvidence: MemoryEvidencePacket[];
  learnerAnalytics: LearnerAnalytics | null;
  filteredStaleMemoryIds: string[];
  vectorUsed: boolean;
  evidenceCount: number;
};

function compact(input: string | null | undefined, maxChars: number): string {
  const text = String(input || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

type BudgetedPromptSection = {
  text: string;
  minChars: number;
  maxChars: number;
};

function budgetPromptSections(sections: BudgetedPromptSection[], totalChars: number): string[] {
  const active = sections.filter((section) => Boolean(section.text.trim()));
  let remaining = Math.max(0, totalChars);
  const result: string[] = [];

  for (let index = 0; index < active.length && remaining > 0; index += 1) {
    const section = active[index];
    const laterMinimum = active.slice(index + 1).reduce((sum, item) => sum + item.minChars + 2, 0);
    const availableBeforeReserve = Math.max(0, remaining - laterMinimum);
    const allowance = Math.min(
      section.maxChars,
      Math.max(section.minChars, availableBeforeReserve),
      remaining,
    );
    const bounded = compact(section.text, allowance);
    if (!bounded) continue;
    result.push(bounded);
    remaining = Math.max(0, remaining - bounded.length - 2);
  }
  return result;
}

function referenceValueText(value: unknown, depth = 0): string {
  if (value == null || depth > 2) return '';
  if (typeof value === 'string') return compact(value, 120);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, 4)
      .map((item) => referenceValueText(item, depth + 1))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value !== 'object') return '';

  const raw = value as Record<string, unknown>;
  const preferredKeys = ['messageId', 'id', 'role', 'excerpt', 'title', 'why'];
  const keys = [
    ...preferredKeys.filter((key) => raw[key] != null),
    ...Object.keys(raw)
      .filter((key) => !preferredKeys.includes(key))
      .sort(),
  ].slice(0, 4);
  return keys
    .map((key) => {
      const text = referenceValueText(raw[key], depth + 1);
      return text ? `${key}=${text}` : '';
    })
    .filter(Boolean)
    .join(', ');
}

function sourceReferenceObjectText(raw: Record<string, unknown>): string {
  const excluded = new Set(['order', 'title', 'why']);
  const priority = [
    'schema',
    'learnerMemoryKey',
    'memoryKey',
    'knowledgePointKey',
    'semanticPatternKey',
    'state',
    'latestAttemptStatus',
    'messageId',
    'excerpt',
    'messageReferences',
    'evidence',
    'attemptIds',
    'problemIds',
    'problemTitles',
    'tags',
  ];
  const keys = [
    ...priority.filter((key) => raw[key] != null),
    ...Object.keys(raw)
      .filter((key) => !excluded.has(key) && !priority.includes(key))
      .sort(),
  ].slice(0, 8);
  return keys
    .map((key) => {
      const text = referenceValueText(raw[key]);
      return text ? `${key}=${text}` : '';
    })
    .filter(Boolean)
    .join('; ');
}

export function sourceReferencesText(sourceReferences: unknown): string {
  const references = Array.isArray(sourceReferences) ? sourceReferences : [sourceReferences];
  return references
    .slice(0, 4)
    .map((source) => {
      if (typeof source === 'string') return compact(source, 160);
      if (!source || typeof source !== 'object') return '';
      const raw = source as Record<string, unknown>;
      const order = typeof raw.order === 'number' ? raw.order : Number(raw.order);
      const title = typeof raw.title === 'string' ? raw.title.trim() : '';
      const why = typeof raw.why === 'string' ? raw.why.trim() : '';
      const structured = sourceReferenceObjectText(raw);
      if (Number.isFinite(order) && title) {
        return `unit ${order}: ${title}${why ? ` (${why})` : ''}${
          structured ? `; ${structured}` : ''
        }`;
      }
      return structured;
    })
    .filter(Boolean)
    .join('; ');
}

function formatMemory(memory: StudyMemoryRecord, index: number): string {
  const scopeLabel = memory.scope === 'private' ? 'private learner memory' : 'public shared memory';
  const targetLabel =
    memory.targetType === 'platform'
      ? 'platform'
      : memory.targetType === 'course'
        ? 'course'
        : 'notebook';
  const references = sourceReferencesText(memory.sourceReferences);
  return [
    `${index + 1}. ${memory.title}`,
    `   - scope: ${scopeLabel}`,
    `   - target: ${targetLabel}`,
    `   - kind/source: ${memory.kind} / ${memory.source}`,
    memory.reason ? `   - reason: ${compact(memory.reason, 180)}` : '',
    references ? `   - sources: ${compact(references, 280)}` : '',
    `   - text: ${compact(memory.text, 900)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatSection(section: MemorySection): string {
  if (section.memories.length === 0) return '';
  return [`## ${section.title}`, ...section.memories.map(formatMemory)].join('\n');
}

function semanticMatchToMemory(match: StudyMemorySemanticMatch): StudyMemoryRecord {
  const targetType: StudyMemoryTargetType =
    match.targetType === 'platform'
      ? 'platform'
      : match.targetType === 'course'
        ? 'course'
        : 'notebook';
  return {
    id: match.memoryId,
    ownerId: match.ownerId,
    courseId: match.courseId,
    notebookId: match.notebookId,
    targetType,
    scope: match.scope === 'private' ? 'private' : 'public',
    kind: 'semantic_recall',
    status: 'active',
    source: `vector:${match.similarity.toFixed(3)}`,
    title: match.title,
    text: match.text || match.chunkText,
    reason: match.reason,
    question: match.question,
    sourceReferences: match.sourceReferences,
    createdAt: match.updatedAt,
    updatedAt: match.updatedAt,
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

function uniqueStrings(items: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const text = item?.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

async function getCourseTarget(
  prisma: PrismaClient,
  userId: string | null | undefined,
  notebookTarget: ReadableStudyMemoryTarget,
): Promise<ReadableStudyMemoryTarget | null> {
  if (!notebookTarget.courseId) return null;
  return resolveReadableStudyMemoryTarget(prisma, userId, 'course', notebookTarget.courseId);
}

function platformTargetForOwner(args: {
  ownerId: string;
  viewerUserId?: string | null;
}): ReadableStudyMemoryTarget {
  return {
    targetType: 'platform',
    targetId: PLATFORM_STUDY_MEMORY_TARGET_ID,
    courseId: null,
    notebookId: null,
    targetOwnerId: args.ownerId,
    accessRole: args.viewerUserId === args.ownerId ? 'owner' : 'enrolled',
  };
}

function memoryContextTargetType(target: ReadableStudyMemoryTarget): MemoryContextTargetType {
  return target.targetType === 'notebook' ? 'notebook' : 'course';
}

function resolveRecallScope(args: {
  target: ReadableStudyMemoryTarget;
  courseTarget: ReadableStudyMemoryTarget | null;
  searchIntent: MemorySearchIntent;
}): {
  factTarget: ReadableStudyMemoryTarget;
  recallTarget: ReadableStudyMemoryTarget;
  scope: MemoryRecallScope;
} {
  const requestedMode: MemorySearchScopeMode =
    args.target.targetType === 'course' ? 'course_wide' : args.searchIntent.scopeMode;
  const canUseCourse = Boolean(args.courseTarget);
  const shouldUseCourse =
    args.target.targetType === 'course' ||
    (canUseCourse && (requestedMode === 'course_wide' || requestedMode === 'auto_expand'));
  const recallTarget = shouldUseCourse && args.courseTarget ? args.courseTarget : args.target;
  const effectiveMode: Exclude<MemorySearchScopeMode, 'auto_expand'> =
    recallTarget.targetType === 'course' ? 'course_wide' : 'notebook_local';
  const expanded =
    args.target.targetType === 'notebook' &&
    recallTarget.targetType === 'course' &&
    args.target.targetId !== recallTarget.targetId;
  const originalTargetType = memoryContextTargetType(args.target);
  const effectiveTargetType = memoryContextTargetType(recallTarget);

  return {
    factTarget: recallTarget,
    recallTarget,
    scope: {
      requestedMode,
      effectiveMode,
      expanded,
      reason: args.searchIntent.scopeReason,
      originalTargetType,
      originalTargetId: args.target.targetId,
      effectiveTargetType,
      effectiveTargetId: recallTarget.targetId,
      courseId: recallTarget.courseId,
      notebookId: recallTarget.notebookId,
      localEvidenceCount: 0,
      courseEvidenceCount: 0,
    },
  };
}

function evidenceCount(args: {
  directMemories: StudyMemoryRecord[];
  semanticMemories: StudyMemoryRecord[];
  knowledgeCache: KnowledgeCacheEntry[];
  knowledgeMatches: MemoryKnowledgeMatch[];
  sourceEvidence: MemoryEvidencePacket[];
  learnerAnalytics: LearnerAnalytics | null;
}): number {
  return (
    args.directMemories.length +
    args.semanticMemories.length +
    args.knowledgeCache.length +
    args.knowledgeMatches.length +
    args.sourceEvidence.length +
    learnerAnalyticsEvidenceCount(args.learnerAnalytics)
  );
}

function learnerAnalyticsEvidenceCount(analytics: LearnerAnalytics | null): number {
  if (!analytics) return 0;
  return (
    analytics.summary.questionCount +
    analytics.summary.attemptCount +
    analytics.summary.privateMemoryCount
  );
}

function formatRecallScope(scope: MemoryRecallScope): string {
  const range =
    scope.effectiveMode === 'course_wide'
      ? `course:${scope.courseId || scope.effectiveTargetId}`
      : `notebook:${scope.notebookId || scope.effectiveTargetId}`;
  return [
    '## Memory recall scope',
    `requestedMode: ${scope.requestedMode}`,
    `effectiveMode: ${scope.effectiveMode}`,
    `expandedFromNotebookToCourse: ${scope.expanded ? 'yes' : 'no'}`,
    `effectiveTarget: ${range}`,
    `localEvidenceCount: ${scope.localEvidenceCount}`,
    `courseEvidenceCount: ${scope.courseEvidenceCount}`,
    `reason: ${scope.reason}`,
    'Use local notebook evidence as the classroom floor. If expandedFromNotebookToCourse=yes, say that the search was widened to the course when the answer depends on cross-notebook evidence.',
  ].join('\n');
}

function formatSourceGroundingPolicy(searchIntent: MemorySearchIntent): string {
  const grounding = searchIntent.sourceGrounding;
  if (!grounding?.required) {
    return [
      '## Source grounding policy',
      'required: no',
      'Summary and study memory can answer if they are sufficient. Original source evidence should still be preferred when the answer becomes exact, ambiguous, or quote-like.',
    ].join('\n');
  }
  return [
    '## Source grounding policy',
    'required: yes',
    `reason: ${grounding.reason}`,
    grounding.signals.length ? `signals: ${grounding.signals.join(', ')}` : '',
    'Rule: summaries route the lookup; original source evidence grounds exact claims. If original evidence is missing, say what evidence is missing instead of inferring exact numbers, wording, formulas, or table cells from summaries/cache.',
    'Table rule: when original source evidence includes a relevant table, preserve relevant rows and columns as table cells; do not collapse table rows into prose if that would drop values.',
    'Coverage rule: if a requested item/model is absent from one retrieved source table but appears in another retrieved source table, include that other table or section before concluding what is unavailable.',
  ]
    .filter(Boolean)
    .join('\n');
}

function factValueText(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatFacts(facts: MemoryFactRecord[]): string {
  if (facts.length === 0) return '';
  const lines = [
    '## Structured memory facts (exact current values)',
    'These facts are precise and updateable. They override semantically recalled text when values conflict.',
  ];
  for (const fact of facts.slice(0, 24)) {
    const scope = fact.scopeId ? `${fact.scopeType}:${fact.scopeId}` : fact.scopeType;
    lines.push(
      `- ${fact.namespace}.${fact.key} = ${compact(factValueText(fact.valueJson), 360)} (scope: ${scope}; source: ${fact.source}; validFrom: ${fact.validFrom})`,
    );
  }
  return lines.join('\n');
}

function formatConflicts(conflicts: MemoryFactConflict[]): string {
  if (conflicts.length === 0) return '';
  return [
    '## Structured memory overrides',
    ...conflicts.slice(0, 12).map((conflict, index) => {
      const fromScope = conflict.overridden.scopeId
        ? `${conflict.overridden.scopeType}:${conflict.overridden.scopeId}`
        : conflict.overridden.scopeType;
      const toScope = conflict.winner.scopeId
        ? `${conflict.winner.scopeType}:${conflict.winner.scopeId}`
        : conflict.winner.scopeType;
      return `${index + 1}. ${conflict.namespace}.${conflict.key}: ${compact(
        factValueText(conflict.overridden.valueJson),
        160,
      )} (${fromScope}) -> ${compact(factValueText(conflict.winner.valueJson), 160)} (${toScope})`;
    }),
  ].join('\n');
}

function formatKnowledgeMatches(matches: MemoryKnowledgeMatch[]): string {
  if (matches.length === 0) return '';
  return [
    '## Metadata-first knowledge matches',
    'These are discovered from course/notebook knowledge sources after target filtering.',
    ...matches.slice(0, 8).map((match, index) => {
      const tags = match.metadata.tags.length ? ` tags=${match.metadata.tags.join(', ')}` : '';
      const progress =
        match.metadata.attemptedCount > 0
          ? ` progress=${match.metadata.attemptStatus || 'attempted'}`
          : ' progress=unattempted';
      return `${index + 1}. [${match.sourceType}] ${match.title} (score=${match.score.toFixed(
        1,
      )}; ${match.metadata.problemType}/${match.metadata.difficulty}${tags}${progress})\n   - ${compact(
        match.text,
        520,
      )}`;
    }),
  ].join('\n');
}

function formatKnowledgeCache(entries: KnowledgeCacheEntry[]): string {
  if (entries.length === 0) return '';
  return [
    '## Knowledge access cache',
    'These are source/problem items that were recently or frequently useful in knowledge-base searches. Treat them as warm hints, then verify with original source evidence when exact wording matters.',
    ...entries.slice(0, 8).map((entry, index) => {
      const notebookName =
        entry.metadata &&
        typeof entry.metadata === 'object' &&
        typeof (entry.metadata as Record<string, unknown>).notebookName === 'string'
          ? String((entry.metadata as Record<string, unknown>).notebookName)
          : '';
      const meta = [
        entry.sourceType,
        notebookName,
        `hits=${entry.hitCount}`,
        `last=${entry.lastAccessedAt.slice(0, 10)}`,
      ].filter(Boolean);
      return `${index + 1}. ${entry.title} (${meta.join('; ')})\n   - ${compact(
        entry.previewText,
        620,
      )}`;
    }),
  ].join('\n');
}

function sourceEvidenceLabel(sourceType: MemoryEvidencePacket['sourceType']): string {
  if (sourceType === 'markdown_section') return 'notebook markdown original';
  if (sourceType === 'problem') return 'problem original';
  if (sourceType === 'student_message') return 'learner question history';
  return 'learner problem attempt';
}

function formatSourceEvidence(
  matches: MemoryEvidencePacket[],
  searchIntent: MemorySearchIntent,
): string {
  if (matches.length === 0) return '';
  const sourceRequired = searchIntent.sourceGrounding.required;
  const maxItems = sourceRequired ? 12 : 10;
  const maxChars = sourceRequired ? 1600 : 900;
  return [
    '## Original source evidence',
    sourceRequired
      ? 'These packets are authoritative evidence for this exact-source turn. Use them for numeric values, tables, formulas, page/source wording, and citations; do not replace them with summaries.'
      : 'These packets contain original text expanded from the indexed source. Prefer this over summaries when answering source lookup questions.',
    ...matches.slice(0, maxItems).map((match, index) => {
      const notebookName =
        typeof match.metadata.notebookName === 'string' ? match.metadata.notebookName : '';
      const meta = [
        sourceEvidenceLabel(match.sourceType),
        notebookName,
        `score=${match.score.toFixed(1)}`,
      ].filter(Boolean);
      return `${index + 1}. ${match.title} (${meta.join('; ')})\n   - ${compact(
        match.renderedText || match.originalText,
        maxChars,
      )}`;
    }),
  ].join('\n');
}

function timeScopeLabel(scope: LearnerAnalytics['timeScope']): string {
  if (scope === 'week') return '最近 7 天';
  if (scope === 'month') return '最近 30 天';
  if (scope === 'term') return '本课程周期';
  return '全部记录';
}

function formatLearnerAnalytics(analytics: LearnerAnalytics | null): string {
  if (!analytics) return '';
  const lines = [
    '## Learner analytics evidence',
    `Time window: ${timeScopeLabel(analytics.timeScope)}${
      analytics.since ? ` (${analytics.since} to ${analytics.until})` : ''
    }`,
    `Summary: questions=${analytics.summary.questionCount}; attempts=${analytics.summary.attemptCount}; attemptedProblems=${analytics.summary.attemptedProblemCount}; passed=${analytics.summary.passedCount}; failed=${analytics.summary.failedCount}; partial=${analytics.summary.partialCount}; privateMemories=${analytics.summary.privateMemoryCount}; activeNotebooks=${analytics.summary.activeNotebookCount}`,
  ];

  if (analytics.activeNotebooks.length > 0) {
    lines.push(
      'Active notebooks:',
      ...analytics.activeNotebooks
        .slice(0, 6)
        .map((item) => `- ${item.notebookName} (${item.count} signals)`),
    );
  }
  if (analytics.messages.length > 0) {
    lines.push(
      'Recent learner questions:',
      ...analytics.messages
        .slice(0, 6)
        .map(
          (item) =>
            `- ${item.createdAt} / ${item.notebookName || 'course'}: ${compact(item.text, 240)}`,
        ),
    );
  }
  if (analytics.attempts.length > 0) {
    lines.push(
      'Recent problem attempts:',
      ...analytics.attempts.slice(0, 6).map((item) => {
        const tags = item.tags.slice(0, 4).join(', ');
        return `- ${item.createdAt} / ${item.status}${
          item.score == null ? '' : ` / score=${item.score}`
        }: ${item.problemTitle}${tags ? ` (${tags})` : ''}`;
      }),
    );
  }
  if (analytics.weakTags.length > 0) {
    lines.push(
      'Weak tags from wrong/partial attempts:',
      ...analytics.weakTags.map((item) => `- ${item.tag}: ${item.count}`),
    );
  }
  if (analytics.privateMemories.length > 0) {
    lines.push(
      'Private learner memories:',
      ...analytics.privateMemories
        .slice(0, 5)
        .map((item) => `- ${item.title}: ${compact(item.text, 240)}`),
    );
  }

  return lines.join('\n');
}

function staleNeedlesFromValue(value: unknown): string[] {
  const needles = new Set<string>();
  const visit = (item: unknown) => {
    if (item == null) return;
    if (typeof item === 'string') {
      const text = item.trim();
      if (text.length >= 2) needles.add(text);
      return;
    }
    if (typeof item === 'number' && Number.isFinite(item)) {
      needles.add(String(item));
      if (Math.abs(item) >= 10000 && item % 10000 === 0) {
        needles.add(`${item / 10000}万`);
        needles.add(`${item / 10000} 万`);
      }
      return;
    }
    if (typeof item === 'boolean') {
      needles.add(String(item));
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (typeof item === 'object') {
      Object.values(item as Record<string, unknown>).forEach(visit);
    }
  };
  visit(value);
  return Array.from(needles).filter((needle) => needle.length >= 2);
}

function memoryContainsNeedle(memory: StudyMemoryRecord, needle: string): boolean {
  const haystack = `${memory.title}\n${memory.text}\n${memory.reason || ''}\n${memory.question || ''}`;
  return haystack.includes(needle);
}

function filterStaleMemories(args: {
  memories: StudyMemoryRecord[];
  staleNeedles: string[];
  currentNeedles: string[];
}): { memories: StudyMemoryRecord[]; filteredIds: string[] } {
  if (args.staleNeedles.length === 0) return { memories: args.memories, filteredIds: [] };
  const filteredIds: string[] = [];
  const memories = args.memories.filter((memory) => {
    const hasStale = args.staleNeedles.some((needle) => memoryContainsNeedle(memory, needle));
    if (!hasStale) return true;
    const hasCurrent = args.currentNeedles.some((needle) => memoryContainsNeedle(memory, needle));
    if (hasCurrent) return true;
    filteredIds.push(memory.id);
    return false;
  });
  return { memories, filteredIds };
}

async function buildFactScopes(args: {
  userId?: string | null;
  target: ReadableStudyMemoryTarget;
  courseTarget: ReadableStudyMemoryTarget | null;
  conversationId?: string | null;
}): Promise<MemoryFactScopeRef[]> {
  const scopes: MemoryFactScopeRef[] = args.userId
    ? [{ ownerId: args.userId, scopeType: 'user', scopeId: null }]
    : [];
  const courseId = args.courseTarget?.courseId || args.target.courseId;
  const courseOwnerId = args.courseTarget?.targetOwnerId || args.target.targetOwnerId;
  if (courseId) {
    scopes.push({ ownerId: courseOwnerId, scopeType: 'course', scopeId: courseId });
  }
  if (args.target.targetType === 'notebook' && args.target.notebookId) {
    scopes.push({
      ownerId: args.target.targetOwnerId,
      scopeType: 'notebook',
      scopeId: args.target.notebookId,
    });
  }
  if (args.userId && args.conversationId?.trim()) {
    scopes.push({
      ownerId: args.userId,
      scopeType: 'conversation',
      scopeId: args.conversationId.trim(),
    });
  }
  return scopes;
}

async function resolveFactRecallState(args: {
  prisma: PrismaClient;
  scopes: MemoryFactScopeRef[];
}): Promise<{
  facts: MemoryFactRecord[];
  conflicts: MemoryFactConflict[];
  staleNeedles: string[];
  currentNeedles: string[];
}> {
  try {
    const resolution = await resolveEffectiveMemoryFacts({
      prisma: args.prisma,
      scopes: args.scopes,
    });
    const currentNeedles = resolution.facts.flatMap((fact) =>
      staleNeedlesFromValue(fact.valueJson),
    );
    const factKeys = resolution.facts.map((fact) => ({
      namespace: fact.namespace,
      key: fact.key,
    }));
    if (factKeys.length === 0) {
      return { ...resolution, staleNeedles: [], currentNeedles };
    }
    try {
      const supersededEvents = await listSupersededMemoryFactEvents({
        prisma: args.prisma,
        scopes: args.scopes,
        keys: factKeys,
        limit: 120,
      });
      return {
        ...resolution,
        currentNeedles,
        staleNeedles: supersededEvents.flatMap((event) =>
          staleNeedlesFromValue(event.oldValueJson),
        ),
      };
    } catch (error) {
      log.warn('Superseded memory-fact recall failed; continuing with current facts:', error);
      return { ...resolution, staleNeedles: [], currentNeedles };
    }
  } catch (error) {
    // Source and notebook evidence remain useful when the optional structured
    // fact layer is temporarily unavailable.
    log.warn('Structured memory-fact recall failed; continuing with source evidence:', error);
    return { facts: [], conflicts: [], staleNeedles: [], currentNeedles: [] };
  }
}

async function buildRecallPass(args: {
  prisma: PrismaClient;
  userId?: string | null;
  recallTarget: ReadableStudyMemoryTarget;
  courseTarget: ReadableStudyMemoryTarget | null;
  searchIntent: MemorySearchIntent;
  recallQuery: string;
  sourceEvidenceQuery: string;
  skipMarkdownSourceEvidence?: boolean;
  notebookScope?: MemoryNotebookScope;
}): Promise<MemoryRecallPass> {
  const shouldSearchSemanticMemory = args.searchIntent.knowledgeTypes.some(
    (type) => type === 'study_memory' || type === 'knowledge_sources',
  );
  const shouldSearchProblemBank =
    Boolean(args.searchIntent.progressFilter) ||
    args.searchIntent.knowledgeTypes.includes('problem_bank');
  const shouldSearchMarkdownEvidence =
    args.skipMarkdownSourceEvidence !== true &&
    Boolean(args.sourceEvidenceQuery) &&
    (args.searchIntent.sourceGrounding.required ||
      args.searchIntent.knowledgeTypes.includes('knowledge_sources') ||
      args.searchIntent.plan.primarySources.includes('knowledge_sources') ||
      args.searchIntent.plan.secondarySources.includes('knowledge_sources'));
  const shouldSearchProblemEvidence =
    shouldSearchProblemBank ||
    args.searchIntent.plan.primarySources.includes('problem_bank') ||
    args.searchIntent.plan.secondarySources.includes('problem_bank');
  const shouldSearchLearnerHistory =
    Boolean(args.userId && args.sourceEvidenceQuery) &&
    (args.searchIntent.knowledgeTypes.includes('learner_history') ||
      args.searchIntent.plan.primarySources.includes('learner_history') ||
      args.searchIntent.plan.secondarySources.includes('learner_history') ||
      args.searchIntent.kind === 'learner_understanding' ||
      args.searchIntent.kind === 'learning_status' ||
      args.searchIntent.kind === 'learner_questions');
  const problemQuery = args.sourceEvidenceQuery || args.recallQuery;
  const retrieveProblems =
    Boolean(problemQuery) && (shouldSearchProblemEvidence || shouldSearchLearnerHistory);
  const warnAndEmpty =
    (label: string) =>
    (error: unknown): MemoryEvidencePacket[] => {
      log.warn(`${label} recall failed; continuing with other evidence:`, error);
      return [];
    };

  const directLayersPromise = (() => {
    if (args.recallTarget.targetType === 'course') {
      return listCourseStudyMemoryLayersForViewer(args.prisma, args.userId, args.recallTarget, {
        course: 8,
        platform: 4,
        courseLearner: 6,
      }).then((layers) => ({
        target: layers.course,
        course: [] as StudyMemoryRecord[],
        platform: layers.platform,
        courseLearner: layers.courseLearner,
      }));
    }

    return Promise.all([
      listStudyMemoriesForViewer(args.prisma, args.userId, args.recallTarget, 8),
      args.courseTarget
        ? listStudyMemoriesForViewer(args.prisma, args.userId, args.courseTarget, 4)
        : Promise.resolve<StudyMemoryRecord[]>([]),
      listStudyMemoriesForViewer(
        args.prisma,
        args.userId,
        platformTargetForOwner({
          ownerId: args.recallTarget.targetOwnerId,
          viewerUserId: args.userId,
        }),
        4,
      ),
    ]).then(([target, course, platform]) => ({
      target,
      course,
      platform,
      courseLearner: [] as StudyMemoryRecord[],
    }));
  })();

  const semanticPromise: Promise<{
    memories: StudyMemoryRecord[];
    vectorUsed: boolean;
  }> =
    shouldSearchSemanticMemory && args.recallQuery
      ? semanticSearchStudyMemoryChunks({
          prisma: args.prisma,
          query: args.recallQuery,
          viewerUserId: args.userId || '',
          publicOwnerId: args.recallTarget.targetOwnerId,
          notebookId: args.recallTarget.notebookId,
          courseId: args.recallTarget.courseId,
          limit: 8,
        })
          .then((matches) => {
            return {
              memories: uniqueById(matches.map(semanticMatchToMemory)),
              vectorUsed: matches.length > 0,
            };
          })
          .catch((error) => {
            log.warn('Semantic study memory recall failed:', error);
            return { memories: [], vectorUsed: false };
          })
      : Promise.resolve({ memories: [], vectorUsed: false });

  // Direct memory, semantic memory, source/problem/message evidence, warm
  // cache, and learner analytics are independent stores. Start all of them at
  // once; only attempt-detail enrichment waits for the selected problem IDs.
  const evidencePromise = Promise.all([
    shouldSearchMarkdownEvidence
      ? searchMarkdownSourceEvidence({
          prisma: args.prisma,
          query: args.sourceEvidenceQuery,
          notebookId: args.recallTarget.notebookId,
          courseId: args.recallTarget.courseId,
          limit: args.searchIntent.sourceGrounding.required ? 8 : 5,
        }).catch(warnAndEmpty('Markdown source evidence'))
      : Promise.resolve<MemoryEvidencePacket[]>([]),
    retrieveProblems
      ? searchProblemSourceEvidence({
          prisma: args.prisma,
          query: problemQuery,
          notebookId: args.recallTarget.notebookId,
          courseId: args.recallTarget.courseId,
          viewerUserId: args.userId || '',
          progressFilter:
            args.searchIntent.progressFilter ||
            (!shouldSearchProblemEvidence && shouldSearchLearnerHistory ? 'attempted' : null),
          includeAttemptDetails: shouldSearchLearnerHistory,
          limit: shouldSearchLearnerHistory ? 8 : 6,
        }).catch(warnAndEmpty('Problem source evidence'))
      : Promise.resolve<MemoryEvidencePacket[]>([]),
    shouldSearchLearnerHistory
      ? searchStudentMessageEvidence({
          prisma: args.prisma,
          query: args.sourceEvidenceQuery,
          userId: args.userId || '',
          notebookId: args.recallTarget.notebookId,
          courseId: args.recallTarget.courseId,
          limit: 5,
        }).catch(warnAndEmpty('Student message evidence'))
      : Promise.resolve<MemoryEvidencePacket[]>([]),
  ]);

  const knowledgeCachePromise: Promise<KnowledgeCacheEntry[]> = args.userId
    ? listKnowledgeCache({
        prisma: args.prisma,
        ownerId: args.userId,
        target: args.recallTarget,
        query: args.recallQuery || args.sourceEvidenceQuery || args.searchIntent.originalQuery,
        limit: 8,
      }).catch((error) => {
        // The cache is a warm hint layer. A missing table or temporary cache
        // outage must never prevent direct memory and source evidence from
        // reaching the answer path.
        log.warn('Knowledge cache read failed; continuing without cache hints:', error);
        return [];
      })
    : Promise.resolve([]);
  const learnerAnalyticsPromise: Promise<LearnerAnalytics | null> = args.userId
    ? buildLearnerAnalytics({
        prisma: args.prisma,
        userId: args.userId,
        target: {
          targetType: memoryContextTargetType(args.recallTarget),
          targetId: args.recallTarget.targetId,
          courseId: args.recallTarget.courseId,
          notebookId: args.recallTarget.notebookId,
        },
        query: args.searchIntent.originalQuery,
        searchIntent: args.searchIntent,
      }).catch((error) => {
        log.warn('Learner analytics recall failed:', error);
        return null;
      })
    : Promise.resolve(null);

  const [directLayers, semanticResult, evidenceResults, knowledgeCache, learnerAnalytics] =
    await Promise.all([
      directLayersPromise,
      semanticPromise,
      evidencePromise,
      knowledgeCachePromise,
      learnerAnalyticsPromise,
    ]);
  const [markdownEvidence, problemEvidence, studentMessages] = evidenceResults;
  const allowedNotebookIds =
    args.notebookScope?.allowedNotebookIds == null
      ? null
      : new Set(args.notebookScope.allowedNotebookIds);
  const notebookAllowed = (notebookId: string | null | undefined) =>
    !notebookId || allowedNotebookIds === null || allowedNotebookIds.has(notebookId);
  const directCourse =
    args.recallTarget.targetType === 'course'
      ? directLayers.target.slice(0, 8)
      : directLayers.course.slice(0, 4);
  const directTarget =
    args.recallTarget.targetType === 'course' ? [] : directLayers.target.slice(0, 8);
  const directPlatform = directLayers.platform.slice(0, 4);
  const directCourseLearner = directLayers.courseLearner
    .filter((memory) => notebookAllowed(memory.notebookId))
    .slice(0, 6);
  const directMemories = uniqueById([
    ...directPlatform,
    ...directCourse,
    ...directTarget,
    ...directCourseLearner,
  ]);
  const semanticMemories = semanticResult.memories.filter((memory) =>
    notebookAllowed(memory.notebookId),
  );
  const vectorUsed = semanticResult.vectorUsed;

  const attemptEvidence = shouldSearchLearnerHistory
    ? await searchProblemAttemptEvidence({
        prisma: args.prisma,
        query: problemQuery,
        userId: args.userId || '',
        notebookId: args.recallTarget.notebookId,
        courseId: args.recallTarget.courseId,
        progressFilter: args.searchIntent.progressFilter,
        baseMatches: problemEvidence,
        limit: 5,
      })
    : [];
  const scopedProblemEvidence = problemEvidence.filter((packet) =>
    notebookAllowed(packet.notebookId),
  );
  const knowledgeMatches: MemoryKnowledgeMatch[] = shouldSearchProblemBank
    ? scopedProblemEvidence.slice(0, 6).map(problemEvidenceToKnowledgeMatch)
    : [];
  const sourceEvidence = mergeEvidencePackets(
    markdownEvidence.filter((packet) => notebookAllowed(packet.notebookId)),
    shouldSearchProblemEvidence ? scopedProblemEvidence : [],
    studentMessages.filter((packet) => notebookAllowed(packet.notebookId)),
    attemptEvidence.filter((packet) => notebookAllowed(packet.notebookId)),
  ).slice(0, args.searchIntent.sourceGrounding.required ? 16 : 12);
  const scopedKnowledgeCache = knowledgeCache.filter((entry) => notebookAllowed(entry.notebookId));

  return {
    recallTarget: args.recallTarget,
    directPlatform,
    directCourse,
    directTarget,
    directCourseLearner,
    directMemories,
    semanticMemories,
    knowledgeCache: scopedKnowledgeCache,
    knowledgeMatches,
    sourceEvidence,
    learnerAnalytics,
    filteredStaleMemoryIds: [],
    vectorUsed,
    evidenceCount: evidenceCount({
      directMemories,
      semanticMemories,
      knowledgeCache: scopedKnowledgeCache,
      knowledgeMatches,
      sourceEvidence,
      learnerAnalytics,
    }),
  };
}

function mergeRecallPasses(
  localPass: MemoryRecallPass,
  coursePass: MemoryRecallPass,
): MemoryRecallPass {
  const directPlatform = uniqueById([
    ...coursePass.directPlatform,
    ...localPass.directPlatform,
  ]).slice(0, 4);
  const directCourse = uniqueById([...coursePass.directCourse, ...localPass.directCourse]);
  const directTarget = localPass.directTarget;
  const directCourseLearner = uniqueById([
    ...coursePass.directCourseLearner,
    ...localPass.directCourseLearner,
  ]).slice(0, 6);
  const directMemories = uniqueById([
    ...directPlatform,
    ...directCourse,
    ...directTarget,
    ...directCourseLearner,
  ]);
  const semanticMemories = uniqueById([
    ...localPass.semanticMemories,
    ...coursePass.semanticMemories,
  ]).slice(0, 8);
  const knowledgeCache = uniqueKnowledgeCacheEntries([
    ...localPass.knowledgeCache,
    ...coursePass.knowledgeCache,
  ]).slice(0, 8);
  const knowledgeMatches = uniqueById([
    ...localPass.knowledgeMatches,
    ...coursePass.knowledgeMatches,
  ]).slice(0, 8);
  const sourceEvidence = mergeEvidencePackets(
    localPass.sourceEvidence,
    coursePass.sourceEvidence,
  ).slice(0, 12);
  const learnerAnalytics = coursePass.learnerAnalytics || localPass.learnerAnalytics;

  return {
    recallTarget: coursePass.recallTarget,
    directPlatform,
    directCourse,
    directTarget,
    directCourseLearner,
    directMemories,
    semanticMemories,
    knowledgeCache,
    knowledgeMatches,
    sourceEvidence,
    learnerAnalytics,
    filteredStaleMemoryIds: [
      ...new Set([...localPass.filteredStaleMemoryIds, ...coursePass.filteredStaleMemoryIds]),
    ],
    vectorUsed: localPass.vectorUsed || coursePass.vectorUsed,
    evidenceCount: evidenceCount({
      directMemories,
      semanticMemories,
      knowledgeCache,
      knowledgeMatches,
      sourceEvidence,
      learnerAnalytics,
    }),
  };
}

function emptyContext(storage: 'database' | 'unavailable'): MemoryRecallContext {
  return {
    prompt: 'N/A',
    scope: {
      requestedMode: 'course_wide',
      effectiveMode: 'course_wide',
      expanded: false,
      reason: 'No memory target was available.',
      originalTargetType: 'course',
      originalTargetId: '',
      effectiveTargetType: 'course',
      effectiveTargetId: '',
      courseId: null,
      notebookId: null,
      localEvidenceCount: 0,
      courseEvidenceCount: 0,
    },
    staticFacts: [],
    courseControllerMemories: [],
    currentNotebookMemories: [],
    crossNotebookLearnerMemories: [],
    specialistMemories: [],
    directMemories: [],
    semanticMatches: [],
    knowledgeCache: [],
    knowledgeMatches: [],
    sourceEvidence: [],
    learnerAnalytics: null,
    conflicts: [],
    filteredStaleMemoryIds: [],
    searchIntent: inferMemorySearchIntent(''),
    platformMemories: [],
    directCount: 0,
    semanticCount: 0,
    knowledgeCacheCount: 0,
    knowledgeCount: 0,
    sourceEvidenceCount: 0,
    learnerAnalyticsCount: 0,
    vectorUsed: false,
    storage,
  };
}

export async function buildMemoryRecallContext(args: {
  targetType: MemoryContextTargetType;
  targetId: string;
  userId?: string;
  question: string;
  conversationId?: string | null;
  searchIntent?: MemorySearchIntent;
  skipMarkdownSourceEvidence?: boolean;
  resolvedTarget?: ReadableStudyMemoryTarget;
  notebookScope?: MemoryNotebookScope;
}): Promise<MemoryRecallContext> {
  const prisma = getOptionalPrisma();
  if (!prisma) return emptyContext('unavailable');

  try {
    const searchIntent =
      args.searchIntent ?? inferMemorySearchIntent(args.question, args.targetType);
    const recallQuery =
      searchIntent.rewrittenQuery || (searchIntent.progressFilter ? '' : args.question);
    const sourceEvidenceQuery = uniqueStrings([
      searchIntent.originalQuery,
      args.question,
      searchIntent.rewrittenQuery,
      ...searchIntent.plan.searchQueries,
    ]).join('\n');
    const suppliedTarget =
      args.resolvedTarget?.targetType === args.targetType &&
      args.resolvedTarget.targetId === args.targetId
        ? args.resolvedTarget
        : null;
    const target =
      suppliedTarget ||
      (await resolveReadableStudyMemoryTarget(prisma, args.userId, args.targetType, args.targetId));
    if (!target) return emptyContext('database');

    const courseTarget =
      target.targetType === 'notebook' ? await getCourseTarget(prisma, args.userId, target) : null;
    const scopeResolution = resolveRecallScope({
      target,
      courseTarget,
      searchIntent,
    });
    const recallTarget = scopeResolution.recallTarget;
    const factTarget = scopeResolution.factTarget;

    const factScopes = await buildFactScopes({
      userId: args.userId,
      target: factTarget,
      courseTarget: factTarget.targetType === 'notebook' ? courseTarget : null,
      conversationId: args.conversationId,
    });
    const shouldRunLocalExpansionPass =
      searchIntent.scopeMode === 'auto_expand' &&
      target.targetType === 'notebook' &&
      recallTarget.targetType === 'course';

    const factStatePromise = resolveFactRecallState({
      prisma,
      scopes: factScopes,
    });
    const localPassPromise = shouldRunLocalExpansionPass
      ? buildRecallPass({
          prisma,
          userId: args.userId,
          recallTarget: target,
          courseTarget,
          searchIntent,
          recallQuery,
          sourceEvidenceQuery,
          skipMarkdownSourceEvidence: args.skipMarkdownSourceEvidence,
          notebookScope: args.notebookScope,
        })
      : Promise.resolve<MemoryRecallPass | null>(null);
    const recallPassPromise = buildRecallPass({
      prisma,
      userId: args.userId,
      recallTarget,
      courseTarget,
      searchIntent,
      recallQuery,
      sourceEvidenceQuery,
      skipMarkdownSourceEvidence: args.skipMarkdownSourceEvidence,
      notebookScope: args.notebookScope,
    });
    const [factResolution, localPass, recallPass] = await Promise.all([
      factStatePromise,
      localPassPromise,
      recallPassPromise,
    ]);
    const mergedPass = localPass ? mergeRecallPasses(localPass, recallPass) : recallPass;
    const directFilter = filterStaleMemories({
      memories: mergedPass.directMemories,
      staleNeedles: factResolution.staleNeedles,
      currentNeedles: factResolution.currentNeedles,
    });
    const semanticFilter = filterStaleMemories({
      memories: mergedPass.semanticMemories,
      staleNeedles: factResolution.staleNeedles,
      currentNeedles: factResolution.currentNeedles,
    });
    const finalPass: MemoryRecallPass = {
      ...mergedPass,
      directMemories: directFilter.memories,
      semanticMemories: semanticFilter.memories,
      filteredStaleMemoryIds: [
        ...new Set([
          ...mergedPass.filteredStaleMemoryIds,
          ...directFilter.filteredIds,
          ...semanticFilter.filteredIds,
        ]),
      ],
      evidenceCount: evidenceCount({
        directMemories: directFilter.memories,
        semanticMemories: semanticFilter.memories,
        knowledgeCache: mergedPass.knowledgeCache,
        knowledgeMatches: mergedPass.knowledgeMatches,
        sourceEvidence: mergedPass.sourceEvidence,
        learnerAnalytics: mergedPass.learnerAnalytics,
      }),
    };
    const directPlatform = finalPass.directPlatform;
    const directCourse = finalPass.directCourse;
    const directTarget = finalPass.directTarget;
    const directCourseLearner = finalPass.directCourseLearner;
    const directMemories = finalPass.directMemories;
    const semanticMemories = finalPass.semanticMemories;
    const knowledgeCache = finalPass.knowledgeCache;
    const knowledgeMatches = finalPass.knowledgeMatches;
    const sourceEvidence = finalPass.sourceEvidence;
    const learnerAnalytics = finalPass.learnerAnalytics;
    const vectorUsed = finalPass.vectorUsed;
    const directMemoryIds = new Set(directMemories.map((memory) => memory.id));
    const platformMemories = directPlatform.filter((memory) => directMemoryIds.has(memory.id));
    const courseControllerMemories = directCourse.filter((memory) =>
      directMemoryIds.has(memory.id),
    );
    const currentNotebookMemories = directTarget.filter((memory) => directMemoryIds.has(memory.id));
    const currentNotebookMemoryIds = new Set(currentNotebookMemories.map((memory) => memory.id));
    const crossNotebookLearnerMemories = directCourseLearner.filter(
      (memory) => directMemoryIds.has(memory.id) && !currentNotebookMemoryIds.has(memory.id),
    );
    const directLayerIds = new Set([
      ...platformMemories.map((memory) => memory.id),
      ...courseControllerMemories.map((memory) => memory.id),
      ...currentNotebookMemories.map((memory) => memory.id),
      ...crossNotebookLearnerMemories.map((memory) => memory.id),
    ]);
    const specialistMemories = semanticMemories.filter((memory) => !directLayerIds.has(memory.id));

    const scope = {
      ...scopeResolution.scope,
      localEvidenceCount: localPass
        ? localPass.evidenceCount
        : recallTarget.targetType === 'notebook'
          ? recallPass.evidenceCount
          : 0,
      courseEvidenceCount: recallTarget.targetType === 'course' ? recallPass.evidenceCount : 0,
    };

    const sections = budgetPromptSections(
      [
        { text: formatRecallScope(scope), minChars: 320, maxChars: 450 },
        {
          text: formatSourceGroundingPolicy(searchIntent),
          minChars: 420,
          maxChars: 700,
        },
        { text: formatFacts(factResolution.facts), minChars: 900, maxChars: 1800 },
        { text: formatConflicts(factResolution.conflicts), minChars: 200, maxChars: 500 },
        {
          // Exact source packets belong ahead of fuzzy memory so a long course
          // controller section cannot silently push table/formula evidence out
          // of the final prompt.
          text: formatSourceEvidence(sourceEvidence, searchIntent),
          minChars: searchIntent.sourceGrounding.required ? 1500 : 500,
          maxChars: searchIntent.sourceGrounding.required ? 3000 : 1400,
        },
        {
          text: formatSection({
            title: 'Platform memory injected directly',
            memories: platformMemories,
          }),
          minChars: 350,
          maxChars: 800,
        },
        {
          text: formatSection({
            title: 'Course controller memory injected directly',
            memories: courseControllerMemories,
          }),
          minChars: 500,
          maxChars: 1400,
        },
        {
          text: formatSection({
            title: 'Current notebook specialist memory injected directly',
            memories: currentNotebookMemories,
          }),
          minChars: 400,
          maxChars: 1000,
        },
        {
          text: formatSection({
            title: 'Recent private learner memories from course notebooks injected directly',
            memories: crossNotebookLearnerMemories,
          }),
          minChars: 400,
          maxChars: 800,
        },
        {
          text: formatSection({
            title: 'Semantically recalled specialist memory from course notebooks',
            memories: specialistMemories.slice(0, 6),
          }),
          minChars: 350,
          maxChars: 800,
        },
        {
          text: formatLearnerAnalytics(learnerAnalytics),
          minChars: 500,
          maxChars: 1000,
        },
        {
          text: formatKnowledgeMatches(knowledgeMatches),
          minChars: 400,
          maxChars: 800,
        },
        { text: formatKnowledgeCache(knowledgeCache), minChars: 180, maxChars: 400 },
      ],
      9500,
    );

    const prompt =
      sections.length > 0
        ? [
            'Use this layered memory context as durable context for the answer.',
            'Act as the course controller: apply course rules first, then notebook specialist evidence.',
            'Structured memory facts are exact current values and override any fuzzy or semantic memory.',
            'Original source packets ground exact wording, numbers, tables, and formulas.',
            'Public memory supplies reusable course rules; private memory personalizes only this learner.',
            'Semantic matches and cache entries are discovery hints, not current truth.',
            'If memory conflicts with current source excerpts, prefer the source and state uncertainty.',
            '',
            ...sections,
          ].join('\n')
        : 'N/A';

    return {
      prompt: compact(prompt, 12000),
      scope,
      staticFacts: factResolution.facts,
      platformMemories,
      courseControllerMemories,
      currentNotebookMemories,
      crossNotebookLearnerMemories,
      specialistMemories,
      directMemories,
      semanticMatches: semanticMemories,
      knowledgeCache,
      knowledgeMatches,
      sourceEvidence,
      learnerAnalytics,
      conflicts: factResolution.conflicts,
      filteredStaleMemoryIds: finalPass.filteredStaleMemoryIds,
      searchIntent,
      directCount: directMemories.length,
      semanticCount: semanticMemories.length,
      knowledgeCacheCount: knowledgeCache.length,
      knowledgeCount: knowledgeMatches.length,
      sourceEvidenceCount: sourceEvidence.length,
      learnerAnalyticsCount: learnerAnalytics
        ? learnerAnalytics.summary.questionCount +
          learnerAnalytics.summary.attemptCount +
          learnerAnalytics.summary.privateMemoryCount
        : 0,
      vectorUsed,
      storage: 'database',
    };
  } catch (error) {
    log.warn('Failed to build layered memory context:', error);
    return emptyContext('database');
  }
}

export async function buildNotebookStudyMemoryPromptContext(args: {
  notebookId: string;
  courseId?: string | null;
  userId?: string;
  question: string;
  conversationId?: string | null;
  searchIntent?: MemorySearchIntent;
}): Promise<NotebookStudyMemoryPromptContext> {
  const notebookContext = await buildMemoryRecallContext({
    targetType: 'notebook',
    targetId: args.notebookId,
    userId: args.userId,
    question: args.question,
    conversationId: args.conversationId,
    searchIntent: args.searchIntent,
  });
  const hasNotebookEvidence =
    notebookContext.directCount > 0 ||
    notebookContext.semanticCount > 0 ||
    notebookContext.knowledgeCount > 0 ||
    notebookContext.sourceEvidenceCount > 0 ||
    notebookContext.staticFacts.length > 0;
  if (hasNotebookEvidence || !args.courseId) return notebookContext;

  const courseContext = await buildMemoryRecallContext({
    targetType: 'course',
    targetId: args.courseId,
    userId: args.userId,
    question: args.question,
    conversationId: args.conversationId,
    searchIntent: args.searchIntent,
  });
  return {
    ...courseContext,
    scope: {
      ...courseContext.scope,
      expanded: true,
      originalTargetType: 'notebook',
      originalTargetId: args.notebookId,
      reason: `${courseContext.scope.reason} Fallback to course-level memory because the notebook target had no readable memory evidence.`,
    },
  };
}
