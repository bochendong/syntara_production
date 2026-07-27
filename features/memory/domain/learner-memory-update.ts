import type { CourseAnswerContractMemorySignal } from './course-answer-contract';

export type LearnerMemoryConfidence = 'low' | 'medium' | 'high';

export type LearnerMemoryLayerRouting = {
  sourceOfTruth: 'conversation_message' | 'problem_attempt';
  /** Exact current-value control plane. Ordinary learner evidence does not overwrite it. */
  controlFacts: 'read_only';
  shortTerm: 'overwrite' | 'skip';
  longTerm: 'create' | 'revise' | 'strengthen' | 'skip';
  knowledgeBase: 'read_only';
  knowledgeCache: 'read_only';
};

export type QuestionMemoryCategory =
  | 'definition'
  | 'clarification'
  | 'pasted_problem'
  | 'code_review'
  | 'error_debug'
  | 'outside_course';

export type QuestionMemoryDiagnosis = {
  category: QuestionMemoryCategory;
  courseRelevant: boolean;
  knowledgePoint: string;
  masteredSignal: string | null;
  stuckPoint: string | null;
  cause: string | null;
  nextTeachingMove: string;
  confidence: LearnerMemoryConfidence;
  evidenceFromMessage: string[];
  workingMemoryAction: 'update' | 'skip';
  durableMemoryAction: 'create' | 'revise' | 'skip';
  durableMemoryReason: string;
  layerRouting: LearnerMemoryLayerRouting;
};

export type AttemptMemoryDiagnosis = {
  knowledgePoint: string;
  masteredSignal: string | null;
  stuckPoint: string | null;
  cause: string | null;
  nextTeachingMove: string;
  confidence: LearnerMemoryConfidence;
  evidenceFromAttempt: string[];
  workingMemoryAction: 'update' | 'skip';
  durableMemoryAction: 'create' | 'revise' | 'strengthen' | 'skip';
  durableMemoryReason: string;
  trend: 'new_signal' | 'repeated_gap' | 'improving' | 'insufficient_evidence';
  layerRouting: LearnerMemoryLayerRouting;
};

type RawQuestionDiagnosis = Partial<Omit<QuestionMemoryDiagnosis, 'layerRouting'>>;
type RawAttemptDiagnosis = Partial<Omit<AttemptMemoryDiagnosis, 'layerRouting' | 'trend'>>;

function compact(value: unknown, maxChars: number): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function nullableText(value: unknown, maxChars: number): string | null {
  return compact(value, maxChars) || null;
}

function confidence(value: unknown): LearnerMemoryConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

function normalizedForEvidence(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function groundedExcerpts(raw: unknown, evidenceCorpus: string): string[] {
  if (!Array.isArray(raw)) return [];
  const normalizedCorpus = normalizedForEvidence(evidenceCorpus);
  const excerpts: string[] = [];
  for (const item of raw) {
    const excerpt = compact(item, 320);
    if (!excerpt) continue;
    const normalizedExcerpt = normalizedForEvidence(excerpt);
    if (!normalizedExcerpt || !normalizedCorpus.includes(normalizedExcerpt)) continue;
    if (!excerpts.includes(excerpt)) excerpts.push(excerpt);
    if (excerpts.length >= 8) break;
  }
  return excerpts;
}

function isAmbiguousQuestion(message: string, resolvedConversationTopic?: string | null): boolean {
  if (resolvedConversationTopic?.trim()) return false;
  const normalized = message.replace(/[\s，。！？!?]/g, '');
  return /^(这|这个|这里|这块|那|那个|那里|那块)?(还是)?(没懂|不懂|不会|看不懂|咋办|什么意思)$/.test(
    normalized,
  );
}

function questionLayerRouting(args: {
  workingMemoryAction: 'update' | 'skip';
  durableMemoryAction: 'create' | 'revise' | 'skip';
}): LearnerMemoryLayerRouting {
  return {
    sourceOfTruth: 'conversation_message',
    controlFacts: 'read_only',
    shortTerm: args.workingMemoryAction === 'update' ? 'overwrite' : 'skip',
    longTerm: args.durableMemoryAction,
    knowledgeBase: 'read_only',
    knowledgeCache: 'read_only',
  };
}

export function normalizeQuestionMemoryDiagnosis(args: {
  raw: RawQuestionDiagnosis;
  studentMessage: string;
  hasCourseSource: boolean;
  resolvedConversationTopic?: string | null;
  courseContractSignal?: CourseAnswerContractMemorySignal | null;
}): QuestionMemoryDiagnosis {
  const proposed = args.raw || {};
  const contractSignal = args.courseContractSignal;
  const raw: RawQuestionDiagnosis = contractSignal
    ? {
        ...proposed,
        category: 'code_review',
        courseRelevant: true,
        knowledgePoint: contractSignal.knowledgePoint,
        masteredSignal: contractSignal.masteredSignal,
        stuckPoint: contractSignal.stuckPoint,
        cause: contractSignal.cause,
        nextTeachingMove: contractSignal.nextTeachingMove,
        confidence: contractSignal.confidence,
        evidenceFromMessage: [
          ...contractSignal.evidenceFromMessage,
          ...(Array.isArray(proposed.evidenceFromMessage) ? proposed.evidenceFromMessage : []),
        ],
        durableMemoryAction: proposed.durableMemoryAction === 'revise' ? 'revise' : 'create',
        durableMemoryReason: `Student-authored code directly failed ${contractSignal.contractCheckIds.join(', ')} from ${contractSignal.contractId}; store only the compact teaching state, not the source or full submission.`,
      }
    : proposed;
  const rawCategory = raw.category;
  const category: QuestionMemoryCategory =
    rawCategory === 'definition' ||
    rawCategory === 'clarification' ||
    rawCategory === 'pasted_problem' ||
    rawCategory === 'code_review' ||
    rawCategory === 'error_debug' ||
    rawCategory === 'outside_course'
      ? rawCategory
      : 'clarification';
  const ambiguous = isAmbiguousQuestion(args.studentMessage, args.resolvedConversationTopic);
  const courseRelevant = Boolean(raw.courseRelevant) && category !== 'outside_course';
  const evidenceFromMessage = groundedExcerpts(raw.evidenceFromMessage, args.studentMessage);
  const hasDirectLearnerEvidence = evidenceFromMessage.length > 0;
  const shouldSkip = ambiguous || !courseRelevant;
  const workingMemoryAction: 'update' | 'skip' = shouldSkip ? 'skip' : 'update';
  const diagnosticConfidence = confidence(raw.confidence);
  const durableEligibleCategory =
    category === 'code_review' || category === 'error_debug' || category === 'clarification';
  const durableEvidenceIsStrong =
    durableEligibleCategory && hasDirectLearnerEvidence && diagnosticConfidence === 'high';
  const requestedDurable =
    raw.durableMemoryAction === 'create' || raw.durableMemoryAction === 'revise'
      ? raw.durableMemoryAction
      : 'skip';
  const durableMemoryAction: 'create' | 'revise' | 'skip' =
    shouldSkip ||
    category === 'definition' ||
    category === 'pasted_problem' ||
    !durableEvidenceIsStrong
      ? 'skip'
      : requestedDurable;
  const knowledgePoint =
    compact(raw.knowledgePoint, 300) ||
    compact(args.resolvedConversationTopic, 300) ||
    (courseRelevant && args.hasCourseSource ? '当前课程知识点' : '未确认知识点');
  const masteredEvidenceIsStrong =
    hasDirectLearnerEvidence &&
    diagnosticConfidence === 'high' &&
    (category === 'code_review' || category === 'error_debug');
  const masteredSignal = masteredEvidenceIsStrong ? nullableText(raw.masteredSignal, 1_000) : null;
  const stuckPoint = shouldSkip ? null : nullableText(raw.stuckPoint, 1_000);
  const cause = shouldSkip || !durableEvidenceIsStrong ? null : nullableText(raw.cause, 1_000);
  const nextTeachingMove =
    compact(raw.nextTeachingMove, 1_000) ||
    (ambiguous
      ? '先确认学生指的是哪个知识点、题目或代码片段，再判断学习状态。'
      : '下一轮先用一个最小检查问题确认当前理解，再决定继续讲解还是练习。');
  const durableMemoryReason =
    durableMemoryAction === 'skip'
      ? ambiguous
        ? '消息缺少可确认的指代对象，不能猜测学生的学习状态。'
        : !courseRelevant
          ? '问题不属于当前课程，不能污染本课程学习记忆。'
          : category === 'definition' || category === 'pasted_problem'
            ? '本轮只有学习意图或当前任务证据，不足以证明稳定能力模式。'
            : '没有达到高置信、由学生本人产出的长期证据门槛。'
      : compact(raw.durableMemoryReason, 1_200) ||
        '学生自己的代码、推理或错误信息提供了高置信、可复用的能力证据。';

  return {
    category,
    courseRelevant,
    knowledgePoint,
    masteredSignal,
    stuckPoint,
    cause,
    nextTeachingMove,
    confidence: diagnosticConfidence,
    evidenceFromMessage,
    workingMemoryAction,
    durableMemoryAction,
    durableMemoryReason,
    layerRouting: questionLayerRouting({ workingMemoryAction, durableMemoryAction }),
  };
}

export function applyCourseAnswerContractMemorySignal(args: {
  diagnosis: QuestionMemoryDiagnosis;
  signal: CourseAnswerContractMemorySignal | null;
  studentMessage: string;
  hasCourseSource: boolean;
  resolvedConversationTopic?: string | null;
}): QuestionMemoryDiagnosis {
  if (!args.signal) return args.diagnosis;
  return normalizeQuestionMemoryDiagnosis({
    raw: args.diagnosis,
    studentMessage: args.studentMessage,
    hasCourseSource: args.hasCourseSource,
    resolvedConversationTopic: args.resolvedConversationTopic,
    courseContractSignal: args.signal,
  });
}

type AttemptEvidenceInput = {
  status: string;
  answer: string;
  feedback: string;
  gradingSource: string;
  gradingReliable: boolean;
};

export function normalizeAttemptMemoryDiagnosis(args: {
  raw: RawAttemptDiagnosis;
  concept: string;
  attempts: AttemptEvidenceInput[];
  hasExistingDurableMemory: boolean;
}): AttemptMemoryDiagnosis {
  const raw = args.raw || {};
  const submittedAttempts = args.attempts.filter((attempt) => attempt.answer.trim().length > 0);
  const evidenceReliable =
    submittedAttempts.length > 0 &&
    submittedAttempts.every(
      (attempt) =>
        attempt.gradingReliable && ['passed', 'failed', 'partial'].includes(attempt.status),
    );
  const latestAttempt = submittedAttempts.at(-1);
  const latestPassed = latestAttempt?.status === 'passed';
  const nonPassingCount = submittedAttempts.filter((attempt) =>
    ['failed', 'partial'].includes(attempt.status),
  ).length;
  const corpus = submittedAttempts
    .map((attempt) => `${attempt.answer}\n${attempt.feedback}`)
    .join('\n');
  const evidenceFromAttempt = groundedExcerpts(raw.evidenceFromAttempt, corpus);
  const hasGroundedEvidence = evidenceFromAttempt.length > 0;
  const objectiveEvidence = submittedAttempts.some(
    (attempt) => attempt.gradingSource === 'platform_objective',
  );
  const richStudentAuthoredEvidence = submittedAttempts.some((attempt) => {
    const answer = attempt.answer.trim();
    return (
      attempt.gradingSource !== 'platform_objective' &&
      attempt.feedback.trim().length > 0 &&
      (answer.length >= 80 ||
        /```|\b(?:return|def|class|except|raise)\b|traceback|\n/i.test(answer))
    );
  });
  const explicitPositiveGraderEvidence = submittedAttempts.some((attempt) => {
    const positiveCandidate = attempt.feedback.replace(
      /不正确|不准确|未正确|没有正确|incorrect(?:ly)?/gi,
      '',
    );
    return /(?:你|学生|回答|答案|代码).{0,24}(?:正确|准确|识别出|指出|实现了|理解了|知道)|(?:正确|准确)(?:地)?(?:指出|识别|实现|解释|处理|使用)|(?:获得|得到).{0,8}(?:分|credit)|\b(?:correctly|accurately|demonstrates|earned credit)\b/i.test(
      positiveCandidate,
    );
  });
  const diagnosticConfidence = objectiveEvidence ? 'high' : confidence(raw.confidence);
  const highConfidenceDirectSignal =
    evidenceReliable &&
    hasGroundedEvidence &&
    richStudentAuthoredEvidence &&
    diagnosticConfidence === 'high';
  const workingMemoryAction: 'update' | 'skip' = evidenceReliable ? 'update' : 'skip';
  let durableMemoryAction: AttemptMemoryDiagnosis['durableMemoryAction'] = 'skip';
  let trend: AttemptMemoryDiagnosis['trend'] = 'insufficient_evidence';
  if (evidenceReliable && latestAttempt) {
    if (latestPassed && hasGroundedEvidence) {
      trend = args.hasExistingDurableMemory ? 'improving' : 'new_signal';
      durableMemoryAction = args.hasExistingDurableMemory ? 'revise' : 'skip';
    } else if (!latestPassed && hasGroundedEvidence && args.hasExistingDurableMemory) {
      trend = 'repeated_gap';
      durableMemoryAction = 'strengthen';
    } else if (
      !latestPassed &&
      hasGroundedEvidence &&
      (nonPassingCount >= 2 || highConfidenceDirectSignal)
    ) {
      trend = nonPassingCount >= 2 ? 'repeated_gap' : 'new_signal';
      durableMemoryAction = 'create';
    } else {
      trend = 'new_signal';
    }
  }
  const knowledgePoint = compact(raw.knowledgePoint, 300) || compact(args.concept, 300);
  const masteredSignal =
    evidenceReliable && hasGroundedEvidence && (latestPassed || explicitPositiveGraderEvidence)
      ? nullableText(raw.masteredSignal, 1_000)
      : null;
  const stuckPoint =
    evidenceReliable && hasGroundedEvidence && !latestPassed
      ? nullableText(raw.stuckPoint, 1_000)
      : null;
  const cause =
    evidenceReliable &&
    hasGroundedEvidence &&
    !latestPassed &&
    (highConfidenceDirectSignal || nonPassingCount >= 2)
      ? nullableText(raw.cause, 1_000)
      : null;
  const nextTeachingMove =
    compact(raw.nextTeachingMove, 1_000) ||
    (latestPassed
      ? '下一轮用一道独立迁移题复测；单次通过只标记为改善中。'
      : '下一轮先根据评分反馈定位错误步骤，再用一个更小的同类问题检查修复情况。');
  const durableMemoryReason =
    durableMemoryAction === 'skip'
      ? evidenceReliable
        ? '本轮证据只够更新短期状态，尚未达到长期模式的晋升门槛。'
        : '没有可靠、已提交且可判定的答案，不能生成学习诊断。'
      : durableMemoryAction === 'revise'
        ? '单次通过只能把既有弱点标记为改善中，仍需独立迁移证据才能关闭。'
        : compact(raw.durableMemoryReason, 1_200) ||
          '重复作答或高置信学生答案暴露了可复用的稳定能力模式。';
  const layerRouting: LearnerMemoryLayerRouting = {
    sourceOfTruth: 'problem_attempt',
    controlFacts: 'read_only',
    shortTerm: workingMemoryAction === 'update' ? 'overwrite' : 'skip',
    longTerm: durableMemoryAction,
    knowledgeBase: 'read_only',
    knowledgeCache: 'read_only',
  };
  return {
    knowledgePoint,
    masteredSignal,
    stuckPoint,
    cause,
    nextTeachingMove,
    confidence: diagnosticConfidence,
    evidenceFromAttempt,
    workingMemoryAction,
    durableMemoryAction,
    durableMemoryReason,
    trend,
    layerRouting,
  };
}
