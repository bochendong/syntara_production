import type { PracticePlan } from '@/lib/learning/course-learner-state';
import type { LearnProblemBankSearchResult } from '@/features/learn-core/domain/types';
import type { TeacherProblemMatch } from './course-agent/problem-bank-tools';

/** Build UI data only from the scoped bank results, never from model-written URLs. */
export function practiceCardFromSearch(args: {
  result: LearnProblemBankSearchResult;
  id: string;
  userId: string;
  courseId: string;
  courseName: string;
  now?: number;
}): PracticePlan | null {
  const matches = [...new Map(args.result.matches.map((item) => [item.problemId, item])).values()]
    .filter((item) => item.problemId && item.title)
    .slice(0, 12);
  if (!matches.length) return null;
  const now = args.now ?? Date.now();
  return {
    version: 1,
    id: args.id,
    userId: args.userId,
    courseId: args.courseId,
    courseName: args.courseName,
    mode: 'practice',
    title: `${args.result.query.slice(0, 48)} · ${matches.length} 道练习`,
    targetConcepts: [],
    problemIds: matches.map((item) => item.problemId),
    questions: matches.map((item) => ({
      problemId: item.problemId,
      title: item.title,
      href: `/course/${encodeURIComponent(args.courseId)}/problem-bank/${encodeURIComponent(item.problemId)}`,
      reason: item.reason,
      difficulty: item.difficulty || '',
      tags: item.tags || [],
    })),
    estimatedMinutes: 0,
    difficultyMix: {
      easy: matches.filter((item) => item.difficulty === 'easy').length,
      medium: matches.filter((item) => item.difficulty === 'medium').length,
      hard: matches.filter((item) => item.difficulty === 'hard').length,
    },
    createdFrom: { weakPoints: [], recentAttemptProblemIds: [], prompt: args.result.query },
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    evidence: { rationale: [], gaps: args.result.gaps, items: [] },
  };
}

/**
 * Teacher preview card: the same problem cards students get, but opening one only
 * previews the problem (no practice session or progress). Built only from the
 * course-scoped, provenance-free matches returned by searchTeacherProblemBank.
 */
export function teacherPreviewCardFromMatches(args: {
  matches: TeacherProblemMatch[];
  query: string;
  gaps?: string[];
  id: string;
  userId: string;
  courseId: string;
  courseName: string;
  now?: number;
}): PracticePlan | null {
  const matches = [...new Map(args.matches.map((item) => [item.problemId, item])).values()].filter(
    (item) => item.problemId && item.title,
  );
  if (!matches.length) return null;
  const now = args.now ?? Date.now();
  return {
    version: 1,
    presentation: 'teacher_preview',
    id: args.id,
    userId: args.userId,
    courseId: args.courseId,
    courseName: args.courseName,
    mode: 'practice',
    title: '正文引用题目（按正文顺序）',
    targetConcepts: [],
    problemIds: matches.map((item) => item.problemId),
    questions: matches.map((item) => ({
      problemId: item.problemId,
      title: item.title,
      href: `/course/${encodeURIComponent(args.courseId)}/problem-bank/${encodeURIComponent(item.problemId)}`,
      reason: item.reason,
      difficulty: item.difficulty || '',
      tags: item.tags || [],
      chapterName: item.chapterName,
      problemNumber: item.problemNumber,
      problemType: item.problemType,
    })),
    estimatedMinutes: 0,
    difficultyMix: {
      easy: matches.filter((item) => item.difficulty === 'easy').length,
      medium: matches.filter((item) => item.difficulty === 'medium').length,
      hard: matches.filter((item) => item.difficulty === 'hard').length,
    },
    createdFrom: { weakPoints: [], recentAttemptProblemIds: [], prompt: args.query },
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    evidence: { rationale: [], gaps: args.gaps || [], items: [] },
  };
}
