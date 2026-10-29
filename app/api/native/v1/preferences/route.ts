import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { upsertMemoryFact } from '@/lib/server/memory-fact-store';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';
const profile = z.object({
  avatarId: z.string().max(200).nullable(),
  name: z.string().max(300),
  signature: z.string().max(2000),
  school: z.string().max(300),
  updatedAt: z.number().finite().nonnegative(),
});
const schema = z.object({
  profile: profile.optional(),
  memoryTourSeen: z.boolean().optional(),
  progressTourSeen: z.boolean().optional(),
});
type Preferences = z.infer<typeof schema>;
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma)
    return publicApiError(
      requestId,
      503,
      'auth_not_configured',
      'Preferences storage is unavailable.',
    );
  if (Number(request.headers.get('content-length')) > 16_000)
    return publicApiError(requestId, 413, 'invalid_request', 'Preferences are too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 16_000)
    return publicApiError(requestId, 413, 'invalid_request', 'Preferences are too large.');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return publicApiError(requestId, 400, 'invalid_request', 'Invalid preferences.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    return publicApiError(requestId, 400, 'invalid_request', 'Invalid preferences.');
  const namespace = 'syntara.native.preferences';
  const key = 'profile-and-tours';
  const existing = await prisma.memoryFact.findFirst({
    where: {
      ownerId: principal.userId,
      scopeType: 'user',
      scopeId: null,
      namespace,
      key,
      status: 'active',
    },
    orderBy: { updatedAt: 'desc' },
    select: { valueJson: true },
  });
  const old = schema.safeParse(existing?.valueJson);
  let value: Preferences = old.success ? old.data : {};
  const incoming = parsed.data;
  const needsWrite = Boolean(
    (incoming.profile &&
      (!value.profile || incoming.profile.updatedAt > value.profile.updatedAt)) ||
    (incoming.memoryTourSeen && !value.memoryTourSeen) ||
    (incoming.progressTourSeen && !value.progressTourSeen),
  );
  if (needsWrite) {
    const saved = await upsertMemoryFact({
      prisma,
      ownerId: principal.userId,
      scopeType: 'user',
      namespace,
      key,
      valueJson: parsed.data,
      source: 'native-preferences',
      mergeValue: (current, incoming) => {
        const base = schema.safeParse(current);
        const next = schema.parse(incoming);
        const previous = base.success ? base.data : {};
        return {
          profile:
            !previous.profile ||
            (next.profile && next.profile.updatedAt > previous.profile.updatedAt)
              ? next.profile
              : previous.profile,
          memoryTourSeen: previous.memoryTourSeen || next.memoryTourSeen,
          progressTourSeen: previous.progressTourSeen || next.progressTourSeen,
        };
      },
    });
    value = schema.parse(saved.fact.valueJson);
  }
  return publicApiSuccess(requestId, value, { headers: { 'Cache-Control': 'private, no-store' } });
}
