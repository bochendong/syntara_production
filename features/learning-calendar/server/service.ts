import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { CalendarEventCreateInput, CalendarEventPatchInput } from './contracts';
import {
  calendarEventDto,
  createLearningCalendarEvents,
  findAccessibleCalendarCourseIds,
  findOwnedLearningCalendarEvent,
  softDeleteLearningCalendarEventCas,
  updateLearningCalendarEventCas,
  type LearningCalendarEventDto,
} from './repository';

const CALENDAR_TRANSACTION_MAX_WAIT_MS = 5_000;
const CALENDAR_TRANSACTION_TIMEOUT_MS = 12_000;

export type LearningCalendarServiceErrorCode =
  | 'course_not_accessible'
  | 'event_conflict'
  | 'event_deleted'
  | 'event_not_found'
  | 'idempotency_conflict'
  | 'version_conflict';

export class LearningCalendarServiceError extends Error {
  constructor(
    readonly code: LearningCalendarServiceErrorCode,
    readonly status: 404 | 409,
    message: string,
    readonly currentVersion?: number,
  ) {
    super(message);
    this.name = 'LearningCalendarServiceError';
  }
}

type MutationResult<T> = T & { idempotentReplay: boolean };

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function assertCourseAccess(
  tx: Prisma.TransactionClient,
  args: { ownerId: string; courseIds: Array<string | null | undefined> },
) {
  const courseIds = Array.from(
    new Set(args.courseIds.filter((courseId): courseId is string => Boolean(courseId))),
  );
  if (!courseIds.length) return;
  const accessible = await findAccessibleCalendarCourseIds(tx, {
    ownerId: args.ownerId,
    courseIds,
  });
  if (accessible.size !== courseIds.length) {
    throw new LearningCalendarServiceError(
      'course_not_accessible',
      404,
      'One or more courses are not available to this account.',
    );
  }
}

async function replayMutation<T extends Record<string, unknown>>(
  prisma: PrismaClient,
  args: {
    ownerId: string;
    idempotencyKey: string;
    operation: string;
    requestHash: string;
  },
): Promise<MutationResult<T> | null> {
  const receipt = await prisma.learningCalendarMutation.findUnique({
    where: {
      ownerId_idempotencyKey: {
        ownerId: args.ownerId,
        idempotencyKey: args.idempotencyKey,
      },
    },
  });
  if (!receipt) return null;
  if (receipt.operation !== args.operation || receipt.requestHash !== args.requestHash) {
    throw new LearningCalendarServiceError(
      'idempotency_conflict',
      409,
      'This idempotency key was already used for a different calendar mutation.',
    );
  }
  return {
    ...(receipt.responseJson as T),
    idempotentReplay: true,
  };
}

async function executeIdempotentMutation<T extends Record<string, unknown>>(
  prisma: PrismaClient,
  args: {
    ownerId: string;
    idempotencyKey: string;
    operation: string;
    request: unknown;
    mutate: (tx: Prisma.TransactionClient) => Promise<T>;
  },
): Promise<MutationResult<T>> {
  const hash = requestHash(args.request);

  try {
    const outcome = await prisma.$transaction(
      async (tx) => {
        const inTransactionReplay = await tx.learningCalendarMutation.findUnique({
          where: {
            ownerId_idempotencyKey: {
              ownerId: args.ownerId,
              idempotencyKey: args.idempotencyKey,
            },
          },
        });
        if (inTransactionReplay) {
          if (
            inTransactionReplay.operation !== args.operation ||
            inTransactionReplay.requestHash !== hash
          ) {
            throw new LearningCalendarServiceError(
              'idempotency_conflict',
              409,
              'This idempotency key was already used for a different calendar mutation.',
            );
          }
          return { response: inTransactionReplay.responseJson as T, replayed: true };
        }

        const result = await args.mutate(tx);
        await tx.learningCalendarMutation.create({
          data: {
            ownerId: args.ownerId,
            idempotencyKey: args.idempotencyKey,
            requestHash: hash,
            operation: args.operation,
            responseJson: result as Prisma.InputJsonValue,
          },
        });
        return { response: result, replayed: false };
      },
      {
        maxWait: CALENDAR_TRANSACTION_MAX_WAIT_MS,
        timeout: CALENDAR_TRANSACTION_TIMEOUT_MS,
      },
    );
    return {
      ...outcome.response,
      idempotentReplay: outcome.replayed,
    };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const racedReplay = await replayMutation<T>(prisma, { ...args, requestHash: hash });
    if (racedReplay) return racedReplay;
    throw new LearningCalendarServiceError(
      'event_conflict',
      409,
      'A calendar event with the same clientEventId already exists.',
    );
  }
}

export async function createLearningCalendarEventBatch(
  prisma: PrismaClient,
  args: {
    ownerId: string;
    idempotencyKey: string;
    events: CalendarEventCreateInput[];
  },
): Promise<MutationResult<{ events: LearningCalendarEventDto[] }>> {
  return executeIdempotentMutation(prisma, {
    ownerId: args.ownerId,
    idempotencyKey: args.idempotencyKey,
    operation: 'create_batch',
    request: { events: args.events },
    mutate: async (tx) => {
      await assertCourseAccess(tx, {
        ownerId: args.ownerId,
        courseIds: args.events.map((event) => event.courseId),
      });
      const events = await createLearningCalendarEvents(tx, args);
      return { events: events.map(calendarEventDto) };
    },
  });
}

export async function patchLearningCalendarEvent(
  prisma: PrismaClient,
  args: {
    ownerId: string;
    eventId: string;
    idempotencyKey: string;
    input: CalendarEventPatchInput;
  },
): Promise<MutationResult<{ event: LearningCalendarEventDto }>> {
  return executeIdempotentMutation(prisma, {
    ownerId: args.ownerId,
    idempotencyKey: args.idempotencyKey,
    operation: 'patch',
    request: { eventId: args.eventId, input: args.input },
    mutate: async (tx) => {
      await assertCourseAccess(tx, {
        ownerId: args.ownerId,
        courseIds: [args.input.courseId],
      });
      const event = await updateLearningCalendarEventCas(tx, args);
      if (event) return { event: calendarEventDto(event) };
      return throwCalendarCasError(tx, args);
    },
  });
}

export async function deleteLearningCalendarEvent(
  prisma: PrismaClient,
  args: {
    ownerId: string;
    eventId: string;
    idempotencyKey: string;
    expectedVersion: number;
  },
): Promise<MutationResult<{ event: { id: string; version: number; deletedAt: string } }>> {
  return executeIdempotentMutation(prisma, {
    ownerId: args.ownerId,
    idempotencyKey: args.idempotencyKey,
    operation: 'delete',
    request: {
      eventId: args.eventId,
      expectedVersion: args.expectedVersion,
    },
    mutate: async (tx) => {
      const event = await softDeleteLearningCalendarEventCas(tx, args);
      if (event?.deletedAt) {
        return {
          event: {
            id: event.id,
            version: event.version,
            deletedAt: event.deletedAt.toISOString(),
          },
        };
      }
      return throwCalendarCasError(tx, args);
    },
  });
}

async function throwCalendarCasError(
  tx: Prisma.TransactionClient,
  args: { ownerId: string; eventId: string; expectedVersion?: number },
): Promise<never> {
  const current = await findOwnedLearningCalendarEvent(tx, args);
  if (!current) {
    throw new LearningCalendarServiceError('event_not_found', 404, 'Calendar event not found.');
  }
  if (current.deletedAt) {
    throw new LearningCalendarServiceError(
      'event_deleted',
      409,
      'Calendar event was already deleted.',
      current.version,
    );
  }
  throw new LearningCalendarServiceError(
    'version_conflict',
    409,
    'Calendar event changed on another client.',
    current.version,
  );
}
