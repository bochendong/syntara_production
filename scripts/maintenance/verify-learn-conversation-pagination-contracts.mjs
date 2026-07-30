#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const route = fs.readFileSync(path.join(root, 'app/api/learn/conversations/route.ts'), 'utf8');
const repository = fs.readFileSync(
  path.join(root, 'features/learn-conversations/server/course-conversation-repository.ts'),
  'utf8',
);
const learnPage = fs.readFileSync(
  path.join(root, 'components/learn/learn-page-client.tsx'),
  'utf8',
);

function sourceBetween(source, startPattern, endPattern) {
  const start = source.search(startPattern);
  assert.notEqual(start, -1, `Missing start pattern: ${startPattern}`);
  const remainder = source.slice(start);
  const end = remainder.search(endPattern);
  assert.notEqual(end, -1, `Missing end pattern after ${startPattern}: ${endPattern}`);
  return remainder.slice(0, end);
}

assert.match(repository, /DEFAULT_COURSE_CONVERSATION_PAGE_LIMIT = 5/);
assert.match(repository, /DEFAULT_COURSE_MESSAGE_PAGE_LIMIT = 30/);
assert.match(route, /messagePageLimitSchema[\s\S]*MAX_COURSE_MESSAGE_PAGE_LIMIT/);
assert.match(route, /decodeCourseMessagePageCursor\(rawBefore\)/);
assert.match(route, /messagePage:\s*snapshot\.messagePage/);
assert.match(route, /messageWindow:\s*snapshot\.messageWindow/);
assert.match(route, /summary:\s*snapshot\.summary/);

assert.match(
  repository,
  /typeof parsed\.updatedAt !== 'string'[\s\S]{0,260}\^\\d\{4\}[\s\S]{0,160}\\\.\\d\{6\}\$/,
  'The session cursor must preserve all six PostgreSQL fractional-second digits.',
);
assert.match(
  repository,
  /to_char\("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS\.US'\) AS "cursorUpdatedAt"/,
);
assert.match(
  repository,
  /\("updatedAt", "id"\) < \(\$3::timestamp, \$4\)/,
  'The session list must use exact timestamp/id keyset pagination.',
);
assert.match(repository, /ORDER BY "updatedAt" DESC, "id" DESC[\s\S]{0,80}LIMIT \$5/);
assert.match(repository, /args\.limit \+ 1/);
assert.match(repository, /conversations\.length > args\.limit/);
assert.match(repository, /encodeCourseConversationPageCursor\(visible\[visible\.length - 1\]\)/);

const listSource = sourceBetween(
  repository,
  /export async function listCourseConversationPage\(/,
  /export async function loadCourseConversationSnapshot\(/,
);
assert.match(listSource, /FROM "CourseConversation"/);
assert.doesNotMatch(listSource, /CourseConversationMessage|FROM "Message"|prisma\.message/);
assert.equal(
  listSource.match(/\.\$queryRawUnsafe</g)?.length ?? 0,
  1,
  'Access, exact count, and the five-name page must share one PostgreSQL statement.',
);
assert.match(
  listSource,
  /SELECT count\(\*\)::bigint[\s\S]{0,180}counted\."deletedAt" IS NULL/,
  'The metadata statement must return an exact count of live conversations.',
);
assert.match(listSource, /WITH "courseAccess" AS \([\s\S]*LEFT JOIN LATERAL/);
assert.match(listSource, /access\."accessRole" IS NOT NULL/);
assert.match(listSource, /"deletedAt" IS NULL/);
assert.doesNotMatch(listSource, /FROM "Conversation"/);

const detailSource = sourceBetween(
  repository,
  /export async function loadCourseConversationSnapshot\(/,
  /async function lockCourseConversation\(/,
);
assert.equal(
  detailSource.match(/\.\$queryRawUnsafe</g)?.length ?? 0,
  1,
  'Course conversation detail must use one PostgreSQL statement/snapshot.',
);
assert.match(detailSource, /m\."sequence" < \$4::bigint/);
assert.match(detailSource, /ORDER BY m\."sequence" DESC[\s\S]{0,80}LIMIT \$5/);
assert.match(detailSource, /MAX_RETURNED_COURSE_MESSAGE_TOMBSTONES/);
assert.match(repository, /sequence <= BigInt\(0\) \|\| sequence > MAX_SAFE_REVISION/);
assert.match(detailSource, /summaryFromRow\(conversation\)/);
assert.match(detailSource, /encodeCourseMessagePageCursor/);
assert.match(detailSource, /messages:\s*visible\.reverse\(\)/);
assert.doesNotMatch(detailSource, /FROM "Conversation"|FROM "Message"/);

assert.match(
  route,
  /if \(sessionId\) \{[\s\S]*loadCourseConversationSnapshot\([\s\S]*return NextResponse\.json\([\s\S]*const rawLimit = searchParams\.get\('limit'\)/,
  'Detail must require an explicit sessionId and return before metadata listing.',
);
assert.match(
  learnPage,
  /totalCount:\s*Math\.max\(page\.totalCount,\s*mergedSessions\.length\)/,
  'Load-more must preserve the exact server count while including unsynced local drafts.',
);

const fixtures = [
  { updatedAt: '2026-07-26T12:00:00.123999', id: 'c' },
  { updatedAt: '2026-07-26T12:00:00.123500', id: 'b' },
  { updatedAt: '2026-07-26T12:00:00.123500', id: 'a' },
  { updatedAt: '2026-07-26T12:00:00.123001', id: 'z' },
  { updatedAt: '2026-07-26T12:00:00.122999', id: 'y' },
];

function compareDescending(left, right) {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? -1 : 1;
  return left.id > right.id ? -1 : left.id < right.id ? 1 : 0;
}

function pageAfter(cursor, limit) {
  const sorted = [...fixtures].sort(compareDescending);
  const remaining = cursor
    ? sorted.filter(
        (row) =>
          row.updatedAt < cursor.updatedAt ||
          (row.updatedAt === cursor.updatedAt && row.id < cursor.id),
      )
    : sorted;
  return remaining.slice(0, limit);
}

const firstPage = pageAfter(null, 2);
const secondPage = pageAfter(firstPage.at(-1), 2);
const thirdPage = pageAfter(secondPage.at(-1), 2);
const pagedIds = [...firstPage, ...secondPage, ...thirdPage].map((row) => row.id);
assert.deepEqual(
  pagedIds,
  [...fixtures].sort(compareDescending).map((row) => row.id),
);
assert.equal(new Set(pagedIds).size, fixtures.length);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: [
        'five-item dedicated metadata query',
        'exact live total in the same metadata statement',
        'single-statement thirty-message detail',
        'opaque session and sequence cursors',
        'microsecond keyset pages without gaps',
        'summary plus messagePage with legacy messageWindow',
        'no generic Conversation/Message reads',
      ],
    },
    null,
    2,
  )}\n`,
);
