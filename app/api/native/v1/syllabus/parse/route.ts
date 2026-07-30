import { Buffer } from 'node:buffer';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { POST as parseSyllabus } from '@/app/api/syllabus/parse/route';
import {
  publicApiError,
  publicApiRequestId,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';
export const maxDuration = 180;

const safeNativeModelSchema = z.enum(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);

const requestSchema = z.object({
  course: z.object({
    id: z.string().trim().max(200).optional(),
    name: z.string().trim().max(200).default(''),
    description: z.string().trim().max(4000).default(''),
  }),
  file: z.object({
    name: z.string().trim().min(1).max(500),
    mimeType: z.string().trim().min(1).max(200),
    dataBase64: z.string().min(1).max(40_000_000),
  }),
  preferences: z
    .object({
      model: safeNativeModelSchema.optional(),
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return publicApiError(
      requestId,
      400,
      'invalid_request',
      'Invalid native syllabus request.',
      parsed.error.flatten(),
    );
  }
  const bytes = Buffer.from(parsed.data.file.dataBase64, 'base64');
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) {
    return publicApiError(
      requestId,
      400,
      'invalid_request',
      'Syllabus must decode to a non-empty file no larger than 20 MB.',
    );
  }

  const form = new FormData();
  form.set(
    'file',
    new File([bytes], parsed.data.file.name, {
      type: parsed.data.file.mimeType,
    }),
  );
  form.set('courseName', parsed.data.course.name);
  form.set('courseDescription', parsed.data.course.description);
  const internalHeaders = new Headers({
    'x-request-id': requestId,
    'x-native-user-id': principal.userId,
  });
  if (parsed.data.preferences?.model) {
    internalHeaders.set('x-model', `openai:${parsed.data.preferences.model}`);
  }
  const internalRequest = new NextRequest('http://syntara.internal/api/syllabus/parse', {
    method: 'POST',
    headers: internalHeaders,
    body: form,
  });
  return parseSyllabus(internalRequest);
}
