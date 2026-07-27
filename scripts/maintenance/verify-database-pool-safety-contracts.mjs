#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const sourcePaths = {
  conversationRoute: 'app/api/learn/conversations/route.ts',
  learnConversationStore: 'lib/server/learn-conversation-store.ts',
  memoryFactStore: 'lib/server/memory-fact-store.ts',
  studyMemoryRoute: 'app/api/study-memory/route.ts',
  courseQuestionRunStore: 'lib/server/course-question-run-store.ts',
};
const sources = Object.fromEntries(
  Object.entries(sourcePaths).map(([key, relativePath]) => [
    key,
    fs.readFileSync(path.join(root, relativePath), 'utf8'),
  ]),
);
const failures = [];

function requirePattern(source, pattern, label) {
  if (!pattern.test(source)) failures.push(label);
}

function forbidPattern(source, pattern, label) {
  if (pattern.test(source)) failures.push(label);
}

function sectionBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = start === -1 ? -1 : source.indexOf(endMarker, start + startMarker.length);
  if (start === -1 || end === -1) {
    failures.push(`${label} section could not be located`);
    return '';
  }
  return source.slice(start, end);
}

function countPattern(source, pattern) {
  return Array.from(source.matchAll(pattern)).length;
}

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const conversationRoute = sources.conversationRoute;
const replaceLearnMessages = sectionBetween(
  conversationRoute,
  'async function replaceLearnMessages(',
  'async function loadMessages(',
  'conversation message replacement',
);
const retryableFactWriteError = sectionBetween(
  sources.memoryFactStore,
  'function isRetryableFactWriteError(',
  'function shortDelay(',
  'MemoryFact retry classifier',
);
const studyMemoryGet = sectionBetween(
  sources.studyMemoryRoute,
  'export async function GET(',
  'export async function POST(',
  'study-memory GET handler',
);

requirePattern(
  replaceLearnMessages,
  /jsonb_to_recordset\(\$1::jsonb\)[\s\S]*INSERT INTO "Message"[\s\S]*ON CONFLICT \("id"\) DO UPDATE/,
  'conversation writes must batch message upserts through jsonb_to_recordset',
);
requirePattern(
  replaceLearnMessages,
  /"Message"\."conversationId" = EXCLUDED\."conversationId"[\s\S]*"Message"\."ownerId" = EXCLUDED\."ownerId"/,
  'the bulk conversation upsert must preserve the owner and conversation collision fence',
);
requirePattern(
  replaceLearnMessages,
  /affectedRows !== messages\.length/,
  'the bulk conversation upsert must reject partial writes caused by id collisions',
);
forbidPattern(
  replaceLearnMessages,
  /for\s*\(\s*const\s+message\s+of\s+messages\s*\)/,
  'conversation replacement must not restore per-message write loops',
);
forbidPattern(
  replaceLearnMessages,
  /prisma\.message\.(?:updateMany|create)\s*\(/,
  'conversation replacement must not issue one update/create request per message',
);
requirePattern(
  conversationRoute,
  /const CONVERSATION_TRANSACTION_TIMEOUT_MS\s*=\s*20_000\s*;/,
  'conversation write transactions must remain capped at 20 seconds',
);
const conversationTransactionCount = countPattern(conversationRoute, /\.\$transaction\s*\(/g);
const boundedConversationTransactionCount = countPattern(
  conversationRoute,
  /timeout:\s*CONVERSATION_TRANSACTION_TIMEOUT_MS/g,
);
if (
  conversationTransactionCount === 0 ||
  boundedConversationTransactionCount !== conversationTransactionCount
) {
  failures.push('every conversation transaction must use CONVERSATION_TRANSACTION_TIMEOUT_MS');
}
forbidPattern(
  conversationRoute,
  /\bALTER\s+TYPE\b/i,
  'the conversation route must not run ALTER TYPE at request time',
);
forbidPattern(
  conversationRoute,
  /\bensureLearnConversationDb\b/,
  'the conversation route must rely on migrations instead of a runtime schema ensure',
);
forbidPattern(
  sources.learnConversationStore,
  /\b(?:CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)|ALTER\s+(?:TABLE|TYPE)|DROP\s+TABLE)\b/i,
  'shared course-conversation persistence must not execute schema DDL at request time',
);
forbidPattern(
  sources.learnConversationStore,
  /\bensureCourseConversationStorage\b/,
  'shared course-conversation persistence must rely on migrations',
);

forbidPattern(
  sources.memoryFactStore,
  /\b(?:CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)|ALTER\s+TABLE|DROP\s+TABLE)\b/i,
  'MemoryFact persistence must not execute schema DDL at request time',
);
forbidPattern(
  sources.memoryFactStore,
  /\bensureMemoryFactTables\b/,
  'MemoryFact persistence must rely on migrations instead of runtime table ensures',
);
forbidPattern(
  withoutComments(retryableFactWriteError),
  /\bP2024\b/,
  'MemoryFact writes must not retry Prisma pool-acquisition timeouts',
);

requirePattern(
  studyMemoryGet,
  /listStudyMemoriesForViewer\(/,
  'study-memory GET must directly read the viewer-visible memories',
);
forbidPattern(
  studyMemoryGet,
  /\b(?:seed\w*|getDefaultCoursePublicMemories|createStudyMemory|ensureStudyMemoryTable)\s*\(/i,
  'study-memory GET must not seed or persist default memories',
);
forbidPattern(
  studyMemoryGet,
  /\.(?:create|createMany|upsert|update|updateMany|delete|deleteMany)\s*\(/,
  'study-memory GET must not execute database mutations',
);
forbidPattern(
  studyMemoryGet,
  /source:\s*['"]default-seed['"]/,
  'study-memory GET must not contain the default-seed write path',
);

forbidPattern(
  sources.courseQuestionRunStore,
  /\b(?:CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)|ALTER\s+(?:TABLE|TYPE)|DROP\s+TABLE)\b/i,
  'CourseQuestionRun persistence must not execute schema DDL at request time',
);
forbidPattern(
  sources.courseQuestionRunStore,
  /\bensureCourseQuestionRun(?:Table|Db|Schema)\b/,
  'CourseQuestionRun persistence must rely on migrations instead of runtime schema ensures',
);
requirePattern(
  sources.courseQuestionRunStore,
  /const COURSE_QUESTION_TRANSACTION_TIMEOUT_MS\s*=\s*20_000\s*;/,
  'CourseQuestionRun completion transactions must remain capped at 20 seconds',
);
requirePattern(
  sources.courseQuestionRunStore,
  /timeout:\s*COURSE_QUESTION_TRANSACTION_TIMEOUT_MS/,
  'CourseQuestionRun completion must apply the bounded transaction timeout',
);

if (failures.length > 0) {
  process.stderr.write(
    `${JSON.stringify(
      {
        ok: false,
        failures,
        checkedFiles: Object.values(sourcePaths),
      },
      null,
      2,
    )}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: [
        'set-based conversation message upsert through jsonb_to_recordset',
        'twenty-second conversation transaction ceiling',
        'migration-only shared conversation schema',
        'migration-only MemoryFact schema with no P2024 retry',
        'read-only study-memory GET without default seeding',
        'migration-only CourseQuestionRun schema with a twenty-second transaction ceiling',
      ],
      checkedFiles: Object.values(sourcePaths),
    },
    null,
    2,
  )}\n`,
);
