import type { LearnTurnAnswerMode } from '@/features/learn-core/domain/types';
import type { LearnerCourseState } from '@/lib/learning/course-learner-state';

const NON_LEARNING_QUESTION_PATTERN =
  /^(?:你好|您好|嗨|hello|hi|谢谢|感谢|再见|好的|好|收到|ok|okay)[!！。,.，\s]*$/i;
const MEMORY_READ_ONLY_PATTERN =
  /(?:你记得|还记得|我的记忆|我的薄弱点|为什么认为|为什么觉得|依据是什么|查看记忆|读取记忆|what do you remember)/i;
const MEMORY_REJECTION_PATTERN =
  /(?:不要|别|无需|不用|先不要).{0,24}(?:记忆|记录|保存|学习状态|薄弱点|memory)/i;

function normalizedConcept(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 64);
}

function sameConcept(left: string, right: string): boolean {
  return (
    normalizedConcept(left).toLocaleLowerCase() === normalizedConcept(right).toLocaleLowerCase()
  );
}

export function questionLearningFocusConcept(args: {
  question: string;
  focusTopics: string[];
  answerMode?: LearnTurnAnswerMode;
}): string | null {
  const question = args.question.replace(/\s+/g, ' ').trim();
  if (!question || args.answerMode !== 'course_answer') return null;
  if (
    NON_LEARNING_QUESTION_PATTERN.test(question) ||
    MEMORY_READ_ONLY_PATTERN.test(question) ||
    MEMORY_REJECTION_PATTERN.test(question)
  ) {
    return null;
  }

  const concept = args.focusTopics
    .map(normalizedConcept)
    .find((topic) => topic.length >= 2 && !/^(?:课程|问题|知识点|当前内容|course)$/i.test(topic));
  return concept || null;
}

export function applyQuestionLearningFocus(args: {
  state: LearnerCourseState;
  concept: string;
  timestamp: number;
}): LearnerCourseState {
  const concept = normalizedConcept(args.concept);
  if (!concept) return args.state;

  const existingEntry = Object.entries(args.state.conceptMastery).find(([key, value]) =>
    sameConcept(value.concept || key, concept),
  );
  const conceptKey = existingEntry?.[0] || concept;
  const previous = existingEntry?.[1];
  const evidence = `学生主动询问了「${concept}」，当前正在进一步理解这个知识点。`;

  return {
    ...args.state,
    conceptMastery: {
      ...args.state.conceptMastery,
      [conceptKey]: {
        concept,
        mastery: previous?.mastery ?? 0.35,
        status:
          previous?.status === 'stable' || previous?.status === 'weak'
            ? previous.status
            : 'learning',
        evidenceCount: Math.min(999, (previous?.evidenceCount ?? 0) + 1),
        lastSeenAt: args.timestamp,
        lastEvidence: evidence,
      },
    },
    updatedAt: args.timestamp,
  };
}
