import { NextResponse } from 'next/server';
import {
  calendarBatchCreateSchema,
  calendarListQuerySchema,
} from '@/features/learning-calendar/server/contracts';
import {
  calendarServiceErrorResponse,
  calendarStorageUnavailableResponse,
  invalidCalendarRequest,
  parseCalendarIdempotencyKey,
  readBoundedCalendarJson,
} from '@/features/learning-calendar/server/http';
import { listLearningCalendarEvents } from '@/features/learning-calendar/server/repository';
import { createLearningCalendarEventBatch } from '@/features/learning-calendar/server/service';
import { requireUserId } from '@/lib/server/api-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const prisma = getOptionalPrisma();
    if (!prisma) return calendarStorageUnavailableResponse();

    const query = calendarListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!query.success) return invalidCalendarRequest(query.error);

    const result = await listLearningCalendarEvents(prisma, {
      ownerId: auth.userId,
      query: query.data,
    });
    return NextResponse.json(
      {
        storage: 'database',
        range: { start: query.data.start, end: query.data.end },
        limit: query.data.limit,
        ...result,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    const serviceResponse = calendarServiceErrorResponse(error);
    if (serviceResponse) return serviceResponse;
    console.error('[learning-calendar] list failed', error);
    return NextResponse.json({ error: 'Unable to load calendar events' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    // User creation belongs to the login boundary. Re-running the compatibility
    // upsert and credit initialization makes a small calendar write wait on
    // several unrelated database round trips.
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const prisma = getOptionalPrisma();
    if (!prisma) return calendarStorageUnavailableResponse();

    const idempotency = parseCalendarIdempotencyKey(request);
    if (!idempotency.ok) return idempotency.response;
    const body = await readBoundedCalendarJson(request);
    if (!body.ok) return body.response;
    const input = calendarBatchCreateSchema.safeParse(body.value);
    if (!input.success) return invalidCalendarRequest(input.error);

    const result = await createLearningCalendarEventBatch(prisma, {
      ownerId: auth.userId,
      idempotencyKey: idempotency.value,
      events: input.data.events,
    });
    return NextResponse.json(
      { storage: 'database', ...result },
      {
        status: result.idempotentReplay ? 200 : 201,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch (error) {
    const serviceResponse = calendarServiceErrorResponse(error);
    if (serviceResponse) return serviceResponse;
    console.error('[learning-calendar] create failed', error);
    return NextResponse.json({ error: 'Unable to create calendar events' }, { status: 500 });
  }
}
