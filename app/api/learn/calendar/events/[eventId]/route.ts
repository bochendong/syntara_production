import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  calendarDeleteSchema,
  calendarEventPatchSchema,
} from '@/features/learning-calendar/server/contracts';
import {
  calendarServiceErrorResponse,
  calendarStorageUnavailableResponse,
  invalidCalendarRequest,
  parseCalendarIdempotencyKey,
  readBoundedCalendarJson,
} from '@/features/learning-calendar/server/http';
import {
  deleteLearningCalendarEvent,
  patchLearningCalendarEvent,
} from '@/features/learning-calendar/server/service';
import { requireUserId } from '@/lib/server/api-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

export const runtime = 'nodejs';

const eventIdSchema = z.string().trim().min(1).max(200);

type CalendarEventRouteContext = {
  params: Promise<{ eventId: string }>;
};

export async function PATCH(request: Request, context: CalendarEventRouteContext) {
  try {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const prisma = getOptionalPrisma();
    if (!prisma) return calendarStorageUnavailableResponse();

    const eventId = eventIdSchema.safeParse((await context.params).eventId);
    if (!eventId.success) return invalidCalendarRequest(eventId.error);
    const idempotency = parseCalendarIdempotencyKey(request);
    if (!idempotency.ok) return idempotency.response;
    const body = await readBoundedCalendarJson(request);
    if (!body.ok) return body.response;
    const input = calendarEventPatchSchema.safeParse(body.value);
    if (!input.success) return invalidCalendarRequest(input.error);

    const result = await patchLearningCalendarEvent(prisma, {
      ownerId: auth.userId,
      eventId: eventId.data,
      idempotencyKey: idempotency.value,
      input: input.data,
    });
    return NextResponse.json(
      { storage: 'database', ...result },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    const serviceResponse = calendarServiceErrorResponse(error);
    if (serviceResponse) return serviceResponse;
    console.error('[learning-calendar] patch failed', error);
    return NextResponse.json({ error: 'Unable to update calendar event' }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: CalendarEventRouteContext) {
  try {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const prisma = getOptionalPrisma();
    if (!prisma) return calendarStorageUnavailableResponse();

    const eventId = eventIdSchema.safeParse((await context.params).eventId);
    if (!eventId.success) return invalidCalendarRequest(eventId.error);
    const idempotency = parseCalendarIdempotencyKey(request);
    if (!idempotency.ok) return idempotency.response;
    const query = calendarDeleteSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!query.success) return invalidCalendarRequest(query.error);

    const result = await deleteLearningCalendarEvent(prisma, {
      ownerId: auth.userId,
      eventId: eventId.data,
      idempotencyKey: idempotency.value,
      expectedVersion: query.data.expectedVersion,
    });
    return NextResponse.json(
      { storage: 'database', deleted: true, ...result },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    const serviceResponse = calendarServiceErrorResponse(error);
    if (serviceResponse) return serviceResponse;
    console.error('[learning-calendar] delete failed', error);
    return NextResponse.json({ error: 'Unable to delete calendar event' }, { status: 500 });
  }
}
