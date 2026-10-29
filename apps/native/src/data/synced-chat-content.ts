import { z } from 'zod';
import type { NativeMessageMetadata } from '../domain/teaching';

// Only display content belongs in the account history. Device paths, provider
// traces, credentials and local lecture database IDs must never cross devices.
const contentKeys = [
  'schemaVersion',
  'images',
  'files',
  'evidence',
  'learningActions',
  'reviewPlan',
  'problemSelection',
  'lectureEligible',
  'lectureEligibilityReason',
  'lectureSuggested',
] as const;

function boundedJson(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 600_000;
  if (Array.isArray(value))
    return value.length <= 200 && value.every((item) => boundedJson(item, depth + 1));
  return Boolean(
    value &&
    typeof value === 'object' &&
    Object.keys(value).length <= 80 &&
    Object.entries(value).every(
      ([key, item]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key) && boundedJson(item, depth + 1),
    ),
  );
}

export const syncedChatContentSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (value) => Object.keys(value).every((key) => (contentKeys as readonly string[]).includes(key)),
    'Unsupported chat content',
  )
  .refine(
    (value) =>
      boundedJson(value) && new TextEncoder().encode(JSON.stringify(value)).length <= 2_500_000,
    'Chat content is too large',
  );

export function syncedChatContent(metadata: unknown): NativeMessageMetadata | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const record = metadata as Record<string, unknown>;
  const selected = Object.fromEntries(
    contentKeys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]),
  );
  return Object.keys(selected).length
    ? (syncedChatContentSchema.parse(selected) as NativeMessageMetadata)
    : undefined;
}
