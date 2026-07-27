import type {
  ConceptMastery,
  LearnerCourseState,
  LearnerWeakPoint,
} from '@/lib/learning/course-learner-state';

export type ConfirmedLearnerMemoryType =
  | 'weakness'
  | 'mastery'
  | 'progress'
  | 'preference'
  | 'correction'
  | 'next_step'
  | 'other';

export type LearnerMemoryCorrectionMode = 'mastery' | 'weakness' | 'resolve';

export type ConfirmedMemoryShadowChange =
  | 'opened_weak_point'
  | 'recorded_mastery'
  | 'resolved_weak_point'
  | 'none';

export type ConfirmedMemoryShadowUpdate = {
  state: LearnerCourseState;
  changed: boolean;
  change: ConfirmedMemoryShadowChange;
  concept: string;
  weakPointId?: string;
  conceptMastery?: ConceptMastery;
};

function normalizedConcept(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 64);
}

function sameConcept(left: string, right: string): boolean {
  return (
    normalizedConcept(left).toLocaleLowerCase() === normalizedConcept(right).toLocaleLowerCase()
  );
}

function resolveWeakPoints(args: {
  points: LearnerWeakPoint[];
  concept: string;
  evidence: string;
  timestamp: number;
}): { points: LearnerWeakPoint[]; changed: boolean; weakPointId?: string } {
  let changed = false;
  let weakPointId: string | undefined;
  const points = args.points.map((point) => {
    if (!sameConcept(point.concept, args.concept) || point.status === 'resolved') return point;
    changed = true;
    weakPointId ??= point.id;
    return {
      ...point,
      evidence: args.evidence,
      severity: 'low' as const,
      status: 'resolved' as const,
      updatedAt: args.timestamp,
    };
  });
  return { points, changed, weakPointId };
}

function openWeakPoint(args: {
  state: LearnerCourseState;
  concept: string;
  title: string;
  evidence: string;
  timestamp: number;
  makeId: (prefix: string) => string;
}): ConfirmedMemoryShadowUpdate {
  const matchingIndex = args.state.activeWeakPoints.findIndex((point) =>
    sameConcept(point.concept, args.concept),
  );
  const existing = matchingIndex >= 0 ? args.state.activeWeakPoints[matchingIndex] : null;
  const weakPoint: LearnerWeakPoint = existing
    ? {
        ...existing,
        concept: args.concept,
        title: args.title || existing.title,
        evidence: args.evidence,
        source: 'chat',
        severity: 'medium',
        status: 'open',
        updatedAt: args.timestamp,
      }
    : {
        id: args.makeId('weak'),
        concept: args.concept,
        title: args.title || 'AI 确认的薄弱点',
        evidence: args.evidence,
        source: 'chat',
        severity: 'medium',
        status: 'open',
        createdAt: args.timestamp,
        updatedAt: args.timestamp,
      };
  const activeWeakPoints =
    matchingIndex >= 0
      ? args.state.activeWeakPoints.map((point, index) =>
          index === matchingIndex ? weakPoint : point,
        )
      : [weakPoint, ...args.state.activeWeakPoints].slice(0, 30);
  const changed =
    !existing ||
    existing.title !== weakPoint.title ||
    existing.evidence !== weakPoint.evidence ||
    existing.severity !== weakPoint.severity ||
    existing.status !== weakPoint.status;
  return {
    state: changed
      ? {
          ...args.state,
          activeWeakPoints,
          updatedAt: args.timestamp,
        }
      : args.state,
    changed,
    change: 'opened_weak_point',
    concept: args.concept,
    weakPointId: weakPoint.id,
  };
}

function recordMastery(args: {
  state: LearnerCourseState;
  concept: string;
  evidence: string;
  timestamp: number;
}): ConfirmedMemoryShadowUpdate {
  const existingEntry = Object.entries(args.state.conceptMastery).find(([key, value]) =>
    sameConcept(value.concept || key, args.concept),
  );
  const conceptKey = existingEntry?.[0] || args.concept;
  const previous = existingEntry?.[1];
  const alreadyCounted = previous?.lastEvidence === args.evidence;
  const conceptMastery: ConceptMastery = {
    concept: args.concept,
    mastery: Math.max(previous?.mastery ?? 0, 0.72),
    status: 'stable',
    evidenceCount: (previous?.evidenceCount ?? 0) + (alreadyCounted ? 0 : 1),
    lastSeenAt: args.timestamp,
    lastEvidence: args.evidence,
  };
  const resolved = resolveWeakPoints({
    points: args.state.activeWeakPoints,
    concept: args.concept,
    evidence: `已确认掌握：${args.evidence}`,
    timestamp: args.timestamp,
  });
  const masteryChanged =
    !previous ||
    previous.mastery !== conceptMastery.mastery ||
    previous.status !== conceptMastery.status ||
    previous.evidenceCount !== conceptMastery.evidenceCount ||
    previous.lastEvidence !== conceptMastery.lastEvidence;
  const changed = masteryChanged || resolved.changed;
  return {
    state: changed
      ? {
          ...args.state,
          activeWeakPoints: resolved.points,
          conceptMastery: {
            ...args.state.conceptMastery,
            [conceptKey]: conceptMastery,
          },
          updatedAt: args.timestamp,
        }
      : args.state,
    changed,
    change: 'recorded_mastery',
    concept: args.concept,
    weakPointId: resolved.weakPointId,
    conceptMastery,
  };
}

function resolveWeaknessOnly(args: {
  state: LearnerCourseState;
  concept: string;
  evidence: string;
  timestamp: number;
}): ConfirmedMemoryShadowUpdate {
  const resolved = resolveWeakPoints({
    points: args.state.activeWeakPoints,
    concept: args.concept,
    evidence: `已纠正旧结论：${args.evidence}`,
    timestamp: args.timestamp,
  });
  return {
    state: resolved.changed
      ? {
          ...args.state,
          activeWeakPoints: resolved.points,
          updatedAt: args.timestamp,
        }
      : args.state,
    changed: resolved.changed,
    change: 'resolved_weak_point',
    concept: args.concept,
    weakPointId: resolved.weakPointId,
  };
}

export function applyConfirmedMemoryToLearnerCourseState(args: {
  state: LearnerCourseState;
  memoryType: ConfirmedLearnerMemoryType;
  concept: string;
  title: string;
  evidence: string;
  timestamp: number;
  makeId: (prefix: string) => string;
  correctionMode?: LearnerMemoryCorrectionMode;
}): ConfirmedMemoryShadowUpdate {
  const concept = normalizedConcept(args.concept);
  if (!concept) {
    return {
      state: args.state,
      changed: false,
      change: 'none',
      concept: '',
    };
  }

  if (args.memoryType === 'weakness') {
    return openWeakPoint({ ...args, concept });
  }
  if (args.memoryType === 'mastery') {
    return recordMastery({ ...args, concept });
  }
  if (args.memoryType === 'correction') {
    if (args.correctionMode === 'weakness') {
      return openWeakPoint({ ...args, concept });
    }
    if (args.correctionMode === 'mastery') {
      return recordMastery({ ...args, concept });
    }
    return resolveWeaknessOnly({ ...args, concept });
  }

  return {
    state: args.state,
    changed: false,
    change: 'none',
    concept,
  };
}
