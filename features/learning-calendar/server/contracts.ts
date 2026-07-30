import { z } from 'zod';

export const CALENDAR_EVENT_BATCH_LIMIT = 50;
export const CALENDAR_EVENT_LIST_LIMIT = 120;
export const CALENDAR_EVENT_DEFAULT_LIMIT = 80;
export const CALENDAR_RANGE_MAX_DAYS = 366;
export const CALENDAR_REQUEST_BODY_MAX_BYTES = 256 * 1024;

const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Invalid calendar date');

const boundedIdSchema = z.string().trim().min(1).max(200);
const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const boundedUtf8String = (maxChars: number, maxBytes = maxChars * 3) =>
  z
    .string()
    .trim()
    .max(maxChars)
    .refine((value) => utf8Bytes(value) <= maxBytes, `Value cannot exceed ${maxBytes} UTF-8 bytes`);
const nullableBoundedString = (maxChars: number, maxBytes = maxChars * 3) =>
  boundedUtf8String(maxChars, maxBytes).nullable();

export const calendarIdempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const calendarEventKindSchema = z.enum([
  'assignment',
  'exam',
  'progress',
  'tutorial',
  'holiday',
  'other',
]);

export const calendarEventOriginSchema = z.enum([
  'syllabus',
  'ai_plan',
  'manual',
  'practice',
  'exam_prep',
]);

export const calendarEventStatusSchema = z.enum(['planned', 'done', 'skipped']);
export const calendarSourceRefTypeSchema = z.enum(['plan', 'action', 'syllabus', 'manual']);

export const calendarEventCreateSchema = z
  .object({
    clientEventId: boundedIdSchema.optional(),
    courseId: boundedIdSchema.nullable().optional(),
    title: boundedUtf8String(500, 1500).pipe(z.string().min(1)),
    kind: calendarEventKindSchema,
    date: dateKeySchema,
    start: z
      .string()
      .trim()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .optional(),
    sourceName: boundedUtf8String(300, 900).pipe(z.string().min(1)).default('学习日历'),
    origin: calendarEventOriginSchema.nullable().optional(),
    sourceRef: z
      .object({
        type: calendarSourceRefTypeSchema,
        id: boundedIdSchema,
      })
      .strict()
      .nullable()
      .optional(),
    proposalId: boundedIdSchema.nullable().optional(),
    durationMinutes: z.number().int().min(5).max(1440).nullable().optional(),
    status: calendarEventStatusSchema.nullable().optional(),
    week: nullableBoundedString(120).optional(),
    sourceColumn: nullableBoundedString(200).optional(),
    rawText: nullableBoundedString(3000, 3000).optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
  })
  .strict();

export const calendarBatchCreateSchema = z
  .object({
    events: z.array(calendarEventCreateSchema).min(1).max(CALENDAR_EVENT_BATCH_LIMIT),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.events.forEach((event, index) => {
      if (!event.clientEventId) return;
      if (seen.has(event.clientEventId)) {
        context.addIssue({
          code: 'custom',
          message: 'clientEventId must be unique within a batch',
          path: ['events', index, 'clientEventId'],
        });
      }
      seen.add(event.clientEventId);
    });
  });

export const calendarEventPatchSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    courseId: boundedIdSchema.nullable().optional(),
    title: boundedUtf8String(500, 1500).pipe(z.string().min(1)).optional(),
    kind: calendarEventKindSchema.optional(),
    date: dateKeySchema.optional(),
    start: z
      .string()
      .trim()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .optional(),
    sourceName: boundedUtf8String(300, 900).pipe(z.string().min(1)).optional(),
    origin: calendarEventOriginSchema.nullable().optional(),
    sourceRef: z
      .object({
        type: calendarSourceRefTypeSchema,
        id: boundedIdSchema,
      })
      .strict()
      .nullable()
      .optional(),
    proposalId: boundedIdSchema.nullable().optional(),
    durationMinutes: z.number().int().min(5).max(1440).nullable().optional(),
    status: calendarEventStatusSchema.nullable().optional(),
    week: nullableBoundedString(120).optional(),
    sourceColumn: nullableBoundedString(200).optional(),
    rawText: nullableBoundedString(3000, 3000).optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'expectedVersion'), {
    message: 'At least one calendar event field is required',
  });

export const calendarDeleteSchema = z
  .object({
    expectedVersion: z.coerce.number().int().min(1),
  })
  .strict();

export const calendarListQuerySchema = z
  .object({
    start: dateKeySchema,
    end: dateKeySchema,
    courseId: boundedIdSchema.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CALENDAR_EVENT_LIST_LIMIT)
      .default(CALENDAR_EVENT_DEFAULT_LIMIT),
  })
  .strict()
  .superRefine((value, context) => {
    const start = new Date(`${value.start}T00:00:00.000Z`);
    const end = new Date(`${value.end}T00:00:00.000Z`);
    const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    if (spanDays < 0) {
      context.addIssue({ code: 'custom', message: 'end must not precede start', path: ['end'] });
    } else if (spanDays > CALENDAR_RANGE_MAX_DAYS) {
      context.addIssue({
        code: 'custom',
        message: `Date range cannot exceed ${CALENDAR_RANGE_MAX_DAYS} days`,
        path: ['end'],
      });
    }
  });

export type CalendarEventCreateInput = z.infer<typeof calendarEventCreateSchema>;
export type CalendarEventPatchInput = z.infer<typeof calendarEventPatchSchema>;
export type CalendarListQuery = z.infer<typeof calendarListQuerySchema>;
