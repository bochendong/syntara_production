#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const routePath = 'app/api/learn/conversations/route.ts';
const route = fs.readFileSync(path.join(root, routePath), 'utf8');
const clientPath = 'components/learn/learn-page-client.tsx';
const client = fs.readFileSync(path.join(root, clientPath), 'utf8');

function sourceBetween(startPattern, endPattern) {
  const start = route.search(startPattern);
  assert.notEqual(start, -1, `Missing start pattern: ${startPattern}`);
  const remainder = route.slice(start);
  const end = remainder.search(endPattern);
  assert.notEqual(end, -1, `Missing end pattern after ${startPattern}: ${endPattern}`);
  return remainder.slice(0, end);
}

assert.match(
  route,
  /const DEFAULT_SESSION_PAGE_LIMIT = 5;/,
  'The metadata endpoint must default to the five most recent conversations.',
);
assert.match(
  route,
  /z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(MAX_SESSION_PAGE_LIMIT\)/,
  'The metadata page limit must remain bounded.',
);
assert.match(
  route,
  /updatedAt:\s*z[\s\S]{0,160}\^\\d\{4\}[\s\S]{0,160}\\\.\\d\{6\}\$/,
  'The cursor schema must preserve all six PostgreSQL fractional-second digits.',
);
assert.match(
  route,
  /to_char\("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS\.US'\) AS "cursorUpdatedAt"/,
  'The list query must serialize updatedAt with PostgreSQL microsecond precision.',
);
assert.doesNotMatch(
  route,
  /to_char\("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS\.MS'\) AS "cursorUpdatedAt"/,
  'Millisecond cursor serialization can skip rows that share a millisecond.',
);
assert.match(
  route,
  /\("updatedAt", "id"\) < \(CAST\(\$3 AS TIMESTAMP\), \$4\)/,
  'The next page must compare the exact timestamp/id keyset represented by the cursor.',
);
assert.match(
  route,
  /ORDER BY "updatedAt" DESC, "id" DESC[\s\S]{0,100}LIMIT \$5/,
  'Cursor comparison and ordering must use the same updatedAt/id tuple.',
);
assert.match(
  route,
  /args\.limit \+ 1/,
  'The list query must fetch one extra metadata row to determine hasMore.',
);
assert.match(
  route,
  /rows\.length > args\.limit[\s\S]{0,180}rows\.slice\(0, args\.limit\)/,
  'The metadata response must trim the lookahead row from the visible page.',
);
assert.match(
  route,
  /encodeSessionPageCursor\(visibleRows\[visibleRows\.length - 1\]\)/,
  'The next cursor must come from the last visible row, not the lookahead row.',
);

const listSource = sourceBetween(
  /async function listLearnConversations\(/,
  /async function upsertLearnConversation\(/,
);
assert.doesNotMatch(
  listSource,
  /FROM "Message"|prisma\.message|loadMessages\(/,
  'Conversation metadata pagination must never read message bodies.',
);
assert.match(
  listSource,
  /SELECT[\s\S]*"id"[\s\S]*"title"[\s\S]*"targetId"[\s\S]*"updatedAt"/,
  'Conversation pagination must return metadata fields.',
);
assert.doesNotMatch(
  listSource,
  /COUNT\s*\(/i,
  'The five-name metadata path must use its lookahead row instead of reserving another pool connection for COUNT.',
);
assert.match(
  listSource,
  /WITH "courseAccess" AS \([\s\S]*LEFT JOIN LATERAL/,
  'Course access and conversation names must share one SQL round trip.',
);
assert.match(
  listSource,
  /access\."accessRole" IS NOT NULL/,
  'The combined metadata query must never return conversation rows without course access.',
);

const getSource = sourceBetween(/export async function GET\(/, /export async function POST\(/);
assert.match(
  getSource,
  /const sessionId = searchParams\.get\('sessionId'\)\?\.trim\(\);[\s\S]*if \(sessionId\) \{[\s\S]*loadLearnConversationWithoutTransaction/,
  'Conversation detail must require an explicit sessionId query parameter.',
);
assert.match(
  getSource,
  /if \(sessionId\) \{[\s\S]*return NextResponse\.json\(\{ storage: 'database', \.\.\.snapshot \}\);[\s\S]*const rawLimit = searchParams\.get\('limit'\)/,
  'The detail branch must return before the metadata-list branch.',
);
assert.match(
  client,
  /current\.totalCount \+ page\.sessions\.length/,
  'Each Load more metadata page must grow the client-side count without requiring COUNT(*).',
);

const fixtures = [
  { updatedAt: '2026-07-26T12:00:00.123999', id: 'c' },
  { updatedAt: '2026-07-26T12:00:00.123500', id: 'b' },
  { updatedAt: '2026-07-26T12:00:00.123500', id: 'a' },
  { updatedAt: '2026-07-26T12:00:00.123001', id: 'z' },
  { updatedAt: '2026-07-26T12:00:00.122999', id: 'y' },
];

function compareDescending(left, right) {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt ? -1 : 1;
  }
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
  'Exact microsecond timestamp/id keyset pagination must not skip or repeat rows.',
);
assert.equal(new Set(pagedIds).size, fixtures.length, 'Pagination returned a duplicate row.');

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: [
        'bounded five-item metadata default',
        'opaque timestamp/id cursor',
        'PostgreSQL microsecond precision',
        'stable keyset pages without gaps or duplicates',
        'metadata list excludes message bodies',
        'course access and names in one SQL round trip',
        'lookahead pagination without an exact count query',
        'client-side count growth after Load more',
        'detail requires explicit sessionId',
      ],
    },
    null,
    2,
  )}\n`,
);
