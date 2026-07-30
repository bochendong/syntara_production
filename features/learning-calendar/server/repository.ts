import type { LearningCalendarEvent, Prisma, PrismaClient } from '@prisma/client';
import type {
  CalendarEventCreateInput,
  CalendarEventPatchInput,
  CalendarListQuery,
} from './contracts';

export type LearningCalendarEventDto = {
  id: string;
  clientEventId: string | null;
  courseId: string | null;
  title: string;
  kind: string;
  date: string;
  start: string | null;
  sourceName: string;
  origin: string | null;
  sourceRef: { type: string; id: string } | null;
  proposalId: string | null;
  durationMinutes: number | null;
  status: string | null;
  week: string | null;
  sourceColumn: string | null;
  rawText: string | null;
  confidence: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export function calendarEventDto(event: LearningCalendarEvent): LearningCalendarEventDto {
  return {
    id: event.id,
    clientEventId: event.clientEventId,
    courseId: event.courseId,
    title: event.title,
    kind: event.kind,
    date: event.eventDate.toISOString().slice(0, 10),
    start: event.startTime,
    sourceName: event.sourceName,
    origin: event.origin,
    sourceRef:
      event.sourceRefType && event.sourceRefId
        ? { type: event.sourceRefType, id: event.sourceRefId }
        : null,
    proposalId: event.proposalId,
    durationMinutes: event.durationMinutes,
    status: event.status,
    week: event.week,
    sourceColumn: event.sourceColumn,
    rawText: event.rawText,
    confidence: event.confidence,
    version: event.version,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

function dateFromKey(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function createData(
  ownerId: string,
  event: CalendarEventCreateInput,
): Prisma.LearningCalendarEventCreateManyInput {
  return {
    ownerId,
    courseId: event.courseId ?? null,
    clientEventId: event.clientEventId ?? null,
    title: event.title,
    kind: event.kind,
    eventDate: dateFromKey(event.date),
    startTime: event.start ?? null,
    sourceName: event.sourceName,
    origin: event.origin ?? null,
    sourceRefType: event.sourceRef?.type ?? null,
    sourceRefId: event.sourceRef?.id ?? null,
    proposalId: event.proposalId ?? null,
    durationMinutes: event.durationMinutes ?? null,
    status: event.status ?? null,
    week: event.week ?? null,
    sourceColumn: event.sourceColumn ?? null,
    rawText: event.rawText ?? null,
    confidence: event.confidence ?? null,
  };
}

function patchData(
  input: CalendarEventPatchInput,
): Prisma.LearningCalendarEventUncheckedUpdateManyInput {
  const data: Prisma.LearningCalendarEventUncheckedUpdateManyInput = {
    version: { increment: 1 },
  };
  if ('courseId' in input) data.courseId = input.courseId;
  if ('title' in input) data.title = input.title;
  if ('kind' in input) data.kind = input.kind;
  if ('date' in input && input.date) data.eventDate = dateFromKey(input.date);
  if ('start' in input) data.startTime = input.start;
  if ('sourceName' in input) data.sourceName = input.sourceName;
  if ('origin' in input) data.origin = input.origin;
  if ('sourceRef' in input) {
    data.sourceRefType = input.sourceRef?.type ?? null;
    data.sourceRefId = input.sourceRef?.id ?? null;
  }
  if ('proposalId' in input) data.proposalId = input.proposalId;
  if ('durationMinutes' in input) data.durationMinutes = input.durationMinutes;
  if ('status' in input) data.status = input.status;
  if ('week' in input) data.week = input.week;
  if ('sourceColumn' in input) data.sourceColumn = input.sourceColumn;
  if ('rawText' in input) data.rawText = input.rawText;
  if ('confidence' in input) data.confidence = input.confidence;
  return data;
}

export async function listLearningCalendarEvents(
  prisma: PrismaClient,
  args: { ownerId: string; query: CalendarListQuery },
) {
  const events = await prisma.learningCalendarEvent.findMany({
    where: {
      ownerId: args.ownerId,
      deletedAt: null,
      eventDate: {
        gte: dateFromKey(args.query.start),
        lte: dateFromKey(args.query.end),
      },
      ...(args.query.courseId ? { courseId: args.query.courseId } : {}),
    },
    orderBy: [{ eventDate: 'asc' }, { id: 'asc' }],
    take: args.query.limit + 1,
  });
  return {
    events: events.slice(0, args.query.limit).map(calendarEventDto),
    truncated: events.length > args.query.limit,
  };
}

export async function findAccessibleCalendarCourseIds(
  tx: Prisma.TransactionClient,
  args: { ownerId: string; courseIds: string[] },
): Promise<Set<string>> {
  if (!args.courseIds.length) return new Set();
  const courses = await tx.course.findMany({
    where: {
      id: { in: args.courseIds },
      OR: [{ ownerId: args.ownerId }, { enrollments: { some: { userId: args.ownerId } } }],
    },
    select: { id: true },
  });
  return new Set(courses.map((course) => course.id));
}

export async function createLearningCalendarEvents(
  tx: Prisma.TransactionClient,
  args: { ownerId: string; events: CalendarEventCreateInput[] },
): Promise<LearningCalendarEvent[]> {
  return tx.learningCalendarEvent.createManyAndReturn({
    data: args.events.map((event) => createData(args.ownerId, event)),
  });
}

export async function updateLearningCalendarEventCas(
  tx: Prisma.TransactionClient,
  args: {
    ownerId: string;
    eventId: string;
    input: CalendarEventPatchInput;
  },
) {
  const updated = await tx.learningCalendarEvent.updateManyAndReturn({
    where: {
      id: args.eventId,
      ownerId: args.ownerId,
      deletedAt: null,
      version: args.input.expectedVersion,
    },
    data: patchData(args.input),
  });
  return updated[0] ?? null;
}

export async function softDeleteLearningCalendarEventCas(
  tx: Prisma.TransactionClient,
  args: { ownerId: string; eventId: string; expectedVersion: number },
) {
  const deletedAt = new Date();
  const updated = await tx.learningCalendarEvent.updateManyAndReturn({
    where: {
      id: args.eventId,
      ownerId: args.ownerId,
      deletedAt: null,
      version: args.expectedVersion,
    },
    data: {
      deletedAt,
      version: { increment: 1 },
    },
  });
  return updated[0] ?? null;
}

export async function findOwnedLearningCalendarEvent(
  tx: Prisma.TransactionClient,
  args: { ownerId: string; eventId: string },
) {
  return tx.learningCalendarEvent.findFirst({
    where: { id: args.eventId, ownerId: args.ownerId },
    select: { id: true, version: true, deletedAt: true },
  });
}
