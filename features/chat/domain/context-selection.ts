import { z } from 'zod';

const id = z.string().trim().min(1).max(200);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(value);
  });

/** References only. Client supplied facts, roles and summaries are never trusted. */
export const chatContextSelectionSchema = z
  .object({
    source: z.enum([
      'teacher-class',
      'teacher-student',
      'problem-attempt',
      'problem',
      'knowledge-point',
      'student-dashboard',
      'calendar',
    ]),
    studentId: id.optional(),
    problemId: id.optional(),
    attemptId: id.optional(),
    topicId: id.optional(),
    notebookId: id.optional(),
    calendarEventId: id.optional(),
    range: z.enum(['7d', '30d', 'term', 'all']).default('7d'),
    startDate: date.optional(),
    endDate: date.optional(),
    timeZone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      })
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.source === 'teacher-student' && !value.studentId)
      ctx.addIssue({ code: 'custom', message: 'studentId is required' });
    if (value.source === 'problem-attempt' && !value.attemptId)
      ctx.addIssue({ code: 'custom', message: 'attemptId is required' });
    if (value.source === 'problem' && !value.problemId)
      ctx.addIssue({ code: 'custom', message: 'problemId is required' });
    if (value.source === 'knowledge-point' && !value.topicId)
      ctx.addIssue({ code: 'custom', message: 'topicId is required' });
    if (
      Boolean(value.startDate) !== Boolean(value.endDate) ||
      (value.startDate && value.endDate && value.startDate > value.endDate)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide an ordered startDate and endDate together',
      });
    }
  });

export type ChatContextSelection = z.input<typeof chatContextSelectionSchema>;
export type ResolvedChatContextSelection = z.output<typeof chatContextSelectionSchema>;

export type CourseTurnEvidence = {
  id: string;
  kind:
    | 'problem'
    | 'attempt'
    | 'student'
    | 'class'
    | 'topic'
    | 'calendar'
    | 'note'
    | 'source'
    | 'conversation';
  title: string;
  content: unknown;
  href?: string;
  updatedAt?: string;
};

export type CourseTurnContext = {
  selection: ResolvedChatContextSelection;
  courseId: string;
  subjectUserId: string;
  preparedAt: string;
  evidence: CourseTurnEvidence[];
  gaps: string[];
};
