import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CALENDAR_REQUEST_BODY_MAX_BYTES, calendarIdempotencyKeySchema } from './contracts';
import { LearningCalendarServiceError } from './service';

export async function readBoundedCalendarJson(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > CALENDAR_REQUEST_BODY_MAX_BYTES) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Request body is too large' }, { status: 413 }),
    };
  }
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > CALENDAR_REQUEST_BODY_MAX_BYTES) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Request body is too large' }, { status: 413 }),
      };
    }
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 }),
    };
  }
}

export function parseCalendarIdempotencyKey(
  request: Request,
): { ok: true; value: string } | { ok: false; response: NextResponse } {
  const parsed = calendarIdempotencyKeySchema.safeParse(
    request.headers.get('idempotency-key')?.trim(),
  );
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: 'A valid Idempotency-Key header is required',
        details: parsed.error.flatten(),
      },
      { status: 400 },
    ),
  };
}

export function invalidCalendarRequest(error: z.ZodError) {
  return NextResponse.json(
    { error: 'Invalid calendar request', details: error.flatten() },
    { status: 400 },
  );
}

export function calendarServiceErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof LearningCalendarServiceError) {
    return NextResponse.json(
      {
        error: error.code,
        message: error.message,
        ...(error.currentVersion ? { currentVersion: error.currentVersion } : {}),
      },
      { status: error.status },
    );
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2021' || error.code === 'P2022')
  ) {
    return NextResponse.json(
      {
        storage: 'unavailable',
        error: 'Calendar storage migration is required',
      },
      { status: 503 },
    );
  }
  return null;
}

export function calendarStorageUnavailableResponse() {
  return NextResponse.json(
    { storage: 'unavailable', error: 'Calendar storage is unavailable' },
    { status: 503 },
  );
}
