#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const schema = read('prisma/schema.prisma');
const migration = read(
  'prisma/migrations/20260730030000_add_learning_calendar_store/migration.sql',
);
const contracts = read('features/learning-calendar/server/contracts.ts');
const repository = read('features/learning-calendar/server/repository.ts');
const service = read('features/learning-calendar/server/service.ts');
const collectionRoute = read('app/api/learn/calendar/events/route.ts');
const itemRoute = read('app/api/learn/calendar/events/[eventId]/route.ts');

assert.match(schema, /model LearningCalendarEvent \{/);
assert.match(schema, /ownerId\s+String/);
assert.match(schema, /eventDate\s+DateTime\s+@db\.Date/);
assert.match(schema, /version\s+Int\s+@default\(1\)/);
assert.match(schema, /deletedAt\s+DateTime\?/);
assert.match(schema, /@@unique\(\[ownerId, clientEventId\]\)/);
assert.match(schema, /@@index\(\[ownerId, deletedAt, eventDate, id\]\)/);
assert.match(schema, /model LearningCalendarMutation \{/);
assert.match(schema, /@@unique\(\[ownerId, idempotencyKey\]\)/);

assert.match(migration, /CREATE TABLE "LearningCalendarEvent"/);
assert.match(migration, /CREATE TABLE "LearningCalendarMutation"/);
assert.match(migration, /LearningCalendarEvent_durationMinutes_check/);
assert.match(migration, /LearningCalendarEvent_confidence_check/);
assert.match(migration, /LearningCalendarEvent_version_check/);
assert.match(migration, /LearningCalendarEvent_startTime_check/);
assert.match(migration, /FOREIGN KEY \("ownerId"\) REFERENCES "User"\("id"\) ON DELETE CASCADE/);
assert.match(
  migration,
  /FOREIGN KEY \("courseId"\) REFERENCES "Course"\("id"\) ON DELETE SET NULL/,
);

assert.match(contracts, /CALENDAR_EVENT_BATCH_LIMIT = 50/);
assert.match(contracts, /CALENDAR_EVENT_LIST_LIMIT = 120/);
assert.match(contracts, /CALENDAR_EVENT_DEFAULT_LIMIT = 80/);
assert.match(contracts, /CALENDAR_RANGE_MAX_DAYS = 366/);
assert.match(contracts, /CALENDAR_REQUEST_BODY_MAX_BYTES = 256 \* 1024/);
assert.match(contracts, /utf8Bytes/);
assert.match(contracts, /expectedVersion: z\.number\(\)\.int\(\)\.min\(1\)/);
assert.match(contracts, /clientEventId must be unique within a batch/);

assert.match(
  repository,
  /where:\s*\{[\s\S]{0,120}ownerId: args\.ownerId,[\s\S]{0,120}deletedAt: null/,
  'Every account calendar list must exclude other owners and soft-deleted events.',
);
assert.match(repository, /take: args\.query\.limit \+ 1/);
assert.match(repository, /createManyAndReturn/);
assert.match(
  repository,
  /id: args\.eventId,[\s\S]{0,100}ownerId: args\.ownerId,[\s\S]{0,100}deletedAt: null,[\s\S]{0,100}version: args\.input\.expectedVersion/,
  'Patch must use owner-scoped compare-and-swap.',
);
assert.match(
  repository,
  /deletedAt,[\s\S]{0,100}version: \{ increment: 1 \}/,
  'Delete must be a versioned soft delete.',
);
assert.equal(
  repository.match(/learningCalendarEvent\.updateManyAndReturn/g)?.length,
  2,
  'Patch and delete must return their CAS row without a second read.',
);
assert.doesNotMatch(repository, /\.delete\(|\.deleteMany\(/);

assert.match(service, /learningCalendarMutation\.findUnique/);
assert.match(service, /learningCalendarMutation\.create/);
assert.match(service, /receipt\.operation !== args\.operation/);
assert.match(service, /receipt\.requestHash !== args\.requestHash/);
assert.match(service, /findAccessibleCalendarCourseIds/);
assert.match(service, /'idempotency_conflict'/);
assert.match(service, /'version_conflict'/);
assert.match(service, /'event_not_found'/);

for (const route of [collectionRoute, itemRoute]) {
  assert.match(route, /requireUserId/);
  assert.match(route, /getOptionalPrisma/);
  assert.match(route, /Cache-Control': 'private, no-store'/);
}
assert.match(
  collectionRoute,
  /export async function POST[\s\S]*requireUserId\(\{ ensureFallbackUser: false \}\)/,
);
assert.equal(
  itemRoute.match(/requireUserId\(\{ ensureFallbackUser: false \}\)/g)?.length,
  2,
  'Calendar patch and delete must not repeat compatibility user initialization.',
);
assert.match(collectionRoute, /calendarListQuerySchema/);
assert.match(collectionRoute, /parseCalendarIdempotencyKey/);
assert.match(collectionRoute, /createLearningCalendarEventBatch/);
assert.match(itemRoute, /calendarEventPatchSchema/);
assert.match(itemRoute, /calendarDeleteSchema/);
assert.match(itemRoute, /patchLearningCalendarEvent/);
assert.match(itemRoute, /deleteLearningCalendarEvent/);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: [
        'account-owned calendar schema and indexes',
        'bounded date-range and payload contracts',
        'durable idempotency receipts',
        'owner-scoped create, list, patch, and delete',
        'CAS conflict and versioned soft-delete semantics',
        'course access enforcement',
      ],
    },
    null,
    2,
  )}\n`,
);
