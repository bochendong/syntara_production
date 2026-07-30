#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const adapter = read('features/learning-calendar/client/calendar-api.ts');
const hook = read('features/learning-calendar/client/use-learning-calendar-range.ts');
const calendarPage = read('components/learn/learning-calendar-page.tsx');
const learnPage = read('components/learn/learn-page-client.tsx');
const backendApi = read('lib/utils/backend-api.ts');

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing source block: ${startMarker}`);
  return source.slice(start, end);
}

assert.match(adapter, /const CALENDAR_API_PATH = '\/api\/learn\/calendar\/events'/);
assert.match(adapter, /function parseRemoteEvent\(/);
assert.match(adapter, /version 必须是正整数/);
assert.match(adapter, /kindValue[\s\S]{0,180}EVENT_KINDS\.has/);
assert.match(adapter, /'Idempotency-Key': args\.idempotencyKey/);
assert.match(
  adapter,
  /JSON\.stringify\(\{ expectedVersion: args\.expectedVersion, \.\.\.args\.patch \}\)/,
);
assert.match(adapter, /expectedVersion: String\(args\.expectedVersion\)/);
assert.match(adapter, /learningCalendarMonthRange/);
assert.match(adapter, /learningCalendarCompactRange/);
assert.match(adapter, /searchLearningCalendarEvents[\s\S]{0,1400}terms\.every/);

assert.match(hook, /loadAbortRef\.current\?\.abort\(\)/);
assert.match(hook, /const optimistic = incoming\.map/);
assert.match(hook, /expectedVersion: previous\.version/);
assert.match(hook, /current\.map\(\(candidate\) => \(candidate\.id === previous\.id \? previous/);
assert.match(hook, /current\.filter\(\(candidate\) => candidate\.id !== previous\.id\)/);
assert.match(hook, /mutationQueueRef/);
assert.match(hook, /const calendarRangeCache = new Map/);
assert.match(hook, /RANGE_CACHE_MAX_ENTRIES = 24/);
assert.match(hook, /Date\.now\(\) - cached\.storedAt <= Math\.max\(0, cacheTtlMs\)/);
const cacheHydrationBlock = sourceBlock(
  hook,
  'const cached = calendarRangeCache.get(rangeKey);',
  'void load().catch',
);
assert.match(cacheHydrationBlock, /commitEvents\(cached\.events\);/);
assert.doesNotMatch(
  cacheHydrationBlock,
  /cache:\s*true/,
  'Reading cached data must not refresh storedAt and postpone stale revalidation.',
);
for (const [label, block] of [
  [
    'create',
    sourceBlock(hook, 'const createEvents = useCallback', 'const updateEvent = useCallback'),
  ],
  [
    'update',
    sourceBlock(hook, 'const updateEvent = useCallback', 'const deleteEvent = useCallback'),
  ],
  [
    'delete',
    sourceBlock(hook, 'const deleteEvent = useCallback', 'const mergeLoadedEvents = useCallback'),
  ],
]) {
  assert.ok(
    (block.match(/\{\s*cache:\s*true\s*,?\s*\}/g) || []).length >= 3,
    `${label} optimistic, success, and rollback states must synchronize the range cache.`,
  );
}

assert.match(calendarPage, /useLearningCalendarRange\(\{/);
assert.match(calendarPage, /rangeMode: 'month'/);
assert.match(calendarPage, /await createEvents\(/);
assert.match(calendarPage, /await updateEvent\(/);
assert.match(calendarPage, /await deleteEvent\(/);
assert.match(calendarPage, /正在加载这个月的账号日历/);
assert.doesNotMatch(calendarPage, /readSyllabusEvents|writeSyllabusEvents/);
assert.doesNotMatch(calendarPage, /useCurrentCourseStore|useAuthStore/);

assert.match(
  learnPage,
  /calendarDemanded =[\s\S]{0,1200}enabled: Boolean\(activeCourseId && calendarDemanded\)/,
);
assert.doesNotMatch(
  learnPage,
  /enabled: Boolean\(activeCourseId && firstResourceRoundReady && calendarDemanded\)/,
);
assert.match(learnPage, /const searchResult = await searchLearningCalendarEvents\(/);
assert.match(learnPage, /const createdEvents = await createCalendarEvents\(/);
assert.match(learnPage, /const currentEvents = await reloadCalendarEvents\(\)/);
assert.match(learnPage, /await updateCalendarEvent\(/);
assert.match(learnPage, /await deleteCalendarEvent\(/);
assert.match(
  learnPage,
  /const createdEvents = await createCalendarEvents\([\s\S]{0,800}markLearningActionStatus\(/,
  'AI calendar add must wait for the API before it can mark the action completed.',
);
assert.match(
  learnPage,
  /updatedEvents\.push\([\s\S]{0,700}await updateCalendarEvent\([\s\S]{0,1200}markLearningActionStatus\(/,
  'AI calendar update must wait for CAS writes before completion.',
);
assert.match(
  learnPage,
  /for \(const event of deleteResult\.deletedEvents\)[\s\S]{0,800}await deleteCalendarEvent\([\s\S]{0,1000}markLearningActionStatus\(/,
  'AI calendar delete must wait for CAS writes before completion.',
);
assert.doesNotMatch(learnPage, /readSyllabusEvents|writeSyllabusEvents|syllabusEventState/);

assert.match(backendApi, /'\/api\/learn\/calendar'/);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: [
        'strict client calendar response parsing',
        'bounded account and course range loading',
        'abortable reads and serialized optimistic mutations',
        'idempotency and CAS headers on all client writes',
        'account-global independent calendar',
        'course calendar demand loading independent from content-state readiness',
        'bounded course-and-range stale-while-revalidate cache',
        'mutation success and rollback cache consistency without stale timestamp extension',
        'AI calendar search against remote events',
        'AI add, update, and delete completion after remote success',
        'no production calendar authority in localStorage',
      ],
    },
    null,
    2,
  )}\n`,
);
