#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const sourceEvidence = read('lib/server/memory-source-evidence.ts');
const learnerAnalytics = read('lib/server/memory-learner-analytics.ts');
const reviewPlan = read('features/teaching-orchestrator/server/review-plan.ts');
const memoryFacts = read('app/api/memory/facts/route.ts');
const memoryWriteRouter = read('lib/server/memory-write-router.ts');
const adminList = read('app/api/admin/users/[userId]/courses/[courseId]/conversations/route.ts');
const adminDetail = read(
  'app/api/admin/users/[userId]/courses/[courseId]/conversations/[conversationId]/route.ts',
);
const nativeArchive = read('scripts/maintenance/export-native-archive.mjs');

for (const [name, source] of [
  ['memory source evidence', sourceEvidence],
  ['learner analytics', learnerAnalytics],
  ['review planning', reviewPlan],
]) {
  assert.match(
    source,
    /FROM "CourseConversationMessage"/,
    `${name} must read the dedicated store.`,
  );
  assert.match(source, /FROM "Message"/, `${name} must retain generic legacy history.`);
  assert.match(source, /UNION ALL/, `${name} must combine both stores in one bounded SQL read.`);
  assert.match(
    source,
    /"deletedAt" IS NULL/,
    `${name} must exclude deleted dedicated conversations/messages.`,
  );
  assert.match(
    source,
    /NOT LIKE 'learn:%'/,
    `${name} must not count retained legacy learn rows twice.`,
  );
  assert.match(
    source,
    /"kind" IN \('notebook', 'agent', 'system'\)/,
    `${name} must leave generic notebook/agent/system history on the legacy store.`,
  );
}

assert.equal(
  [...learnerAnalytics.matchAll(/message\."createdAt" >= \(\$2::timestamptz AT TIME ZONE 'UTC'\)/g)]
    .length,
  2,
  'Both dedicated and legacy learner-history branches must compare like-for-like timestamp types.',
);

for (const [name, source] of [
  ['memory facts API', memoryFacts],
  ['memory write router', memoryWriteRouter],
]) {
  assert.match(source, /FROM "CourseConversation"/, `${name} must recognize dedicated scopes.`);
  assert.match(source, /FROM "Conversation"/, `${name} must recognize legacy scopes.`);
  assert.match(source, /UNION ALL/, `${name} must authorize either conversation store.`);
}

assert.match(adminList, /'course_conversation'::text AS "storage"/);
assert.match(adminList, /'legacy_conversation'::text AS "storage"/);
assert.match(adminList, /FROM "CourseConversation"/);
assert.match(adminList, /FROM "Conversation"/);
assert.match(adminList, /NOT LIKE 'learn:%'/);
assert.match(adminDetail, /FROM "CourseConversationMessage"/);
assert.match(adminDetail, /FROM "Message"/);
assert.match(
  adminDetail,
  /UPDATE "CourseQuestionRun"[\s\S]{0,220}SET "conversationId" = NULL[\s\S]{0,420}DELETE FROM "CourseConversation"/,
  'Permanent deletion must detach question runs before the scoped FK-protected conversation row.',
);
assert.match(adminDetail, /DELETE FROM "CourseConversation"/);
assert.match(adminDetail, /DELETE FROM "Conversation"/);
assert.match(adminDetail, /confirmation !== conversationId/);

assert.match(nativeArchive, /prisma\.courseConversation\.findMany\(/);
assert.match(nativeArchive, /kind:\s*\{ in: \['notebook', 'agent', 'system'\] \}/);
assert.match(nativeArchive, /deletedAt:\s*null/);
assert.match(nativeArchive, /archivedCourseConversations/);
assert.match(nativeArchive, /archivedLegacyConversations/);
assert.match(nativeArchive, /conversations:\s*archivedConversations/);
assert.match(nativeArchive, /messages:\s*archivedMessages/);

for (const [name, source] of [
  ['memory source evidence', sourceEvidence],
  ['learner analytics', learnerAnalytics],
  ['review planning', reviewPlan],
  ['memory facts API', memoryFacts],
  ['memory write router', memoryWriteRouter],
  ['native archive', nativeArchive],
]) {
  assert.doesNotMatch(
    source,
    /INSERT INTO "CourseConversation"|\.courseConversation\.(?:create|upsert|update)\(/,
    `${name} is a reader/permission surface and must not introduce a second conversation write path.`,
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: [
        'course AI history reads dedicated and generic stores once',
        'legacy learn rows excluded from unions',
        'conversation memory scopes authorize both stores',
        'admin list/detail/permanent delete support both stores and detach question runs',
        'native archive includes dedicated conversations without legacy learn duplicates',
        'no conversation dual-write introduced',
      ],
    },
    null,
    2,
  )}\n`,
);
