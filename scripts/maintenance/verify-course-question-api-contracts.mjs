#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const route = read('app/api/v1/courses/[id]/questions/route.ts');
const contextBuilder = read('lib/chat/server-course-question-context.ts');
const trustedTurn = read('features/chat/server/trusted-course-turn.ts');
const answerContract = read('features/memory/domain/course-answer-contract.ts');
const runStore = read('lib/server/course-question-run-store.ts');
const runMigration = read('prisma/migrations/20260727040000_add_course_question_run/migration.sql');
const conversationStore = read('lib/server/learn-conversation-store.ts');
const studyMemoryStore = read('lib/server/study-memory-store.ts');
const learnPage = read('components/learn/learn-page-client.tsx');
const learnRoute = read('app/api/learn/conversations/route.ts');
const openapi = read('public/openapi-v1.yaml');

assert.match(route, /requirePublicApi\(request,\s*requestId\)/);
assert.match(route, /request\.headers\.get\('idempotency-key'\)/);
assert.match(route, /IDEMPOTENCY_KEY_PATTERN/);
assert.doesNotMatch(
  route.match(/const requestSchema = z\.object\(\{[\s\S]*?\n\}\);/)?.[0] || '',
  /courseContext|user_id|apiKey|baseUrl|source_notes|history/,
  'The public request schema must not accept prompt-bearing or identity fields.',
);
assert.match(
  route,
  /claimCourseQuestionRun\([\s\S]*if \(claim\.kind === 'completed'\)[\s\S]*resolveModelFromHeaders/,
  'A completed idempotent request must replay before any model resolution.',
);
assert.match(
  route,
  /withRequestContext\([\s\S]*buildTrustedCourseQuestionContext\([\s\S]*collectTrustedCourseTurn\(/,
  'Memory planning, retrieval, and generation must run inside one request context.',
);
assert.match(route, /completeCourseQuestionRun\([\s\S]*learningActions[\s\S]*publicTrace/);
assert.match(route, /status:\s*'pending_confirmation'/);
assert.match(route, /buildCourseAnswerContractMemorySignal\(/);
assert.match(route, /taskHint:\s*'grading'/);
assert.match(route, /deterministic_course_contract/);
assert.match(route, /knowledgePoint:[\s\S]*stuckPoint:[\s\S]*cause:[\s\S]*nextTeachingMove:/);
assert.doesNotMatch(route, /createMemory|upsertMemory|POST.*memory|memoryFact\.(?:create|upsert)/);
assert.match(
  route,
  /courseQuestionRetrievalQuery\(input\.question,\s*history\.messages\)/,
  'Context-dependent follow-ups must retrieve with the previous user topic.',
);
assert.match(
  route,
  /find\(\(message\) => message\.role === 'user'/,
  'Follow-up retrieval may inherit only user-authored context.',
);
assert.match(route, /unexpected failure[\s\S]*requestId[\s\S]*Course question generation failed\./);
assert.doesNotMatch(
  route,
  /500,[\s\S]{0,100}'internal_error'[\s\S]{0,120}error instanceof Error \? error\.message/,
  'Unknown public API failures must not expose internal exception messages.',
);

for (const source of [contextBuilder, trustedTurn]) {
  assert.match(source, /findCourseAccessRole|hasCourseEnrollment/);
}
assert.match(contextBuilder, /listCourseSourceUploads\(/);
assert.match(contextBuilder, /includeTextSections:\s*true/);
assert.match(contextBuilder, /includeArtifacts:\s*false/);
assert.match(contextBuilder, /buildLayeredMemoryRecallContext\(/);
assert.match(contextBuilder, /maxSources:\s*4/);
assert.match(contextBuilder, /maxSourceTextChars:\s*9_000/);
assert.match(
  contextBuilder,
  /\.filter\(\(candidate\) => candidate\.score > 0\)/,
  'Zero-relevance course sources must not consume prompt tokens or appear as evidence.',
);
assert.match(
  trustedTurn,
  /serverCourseContext\?\.layeredMemory/,
  'Prompt-bearing memory may only enter through the explicit server context.',
);
assert.match(trustedTurn, /trustedCourseAnswerContractText\(/);
assert.match(trustedTurn, /resolveCourseAnswerContractReviewText\(/);
assert.match(answerContract, /priorSubmission[\s\S]*Follow-up review request:/);
assert.doesNotMatch(
  trustedTurn,
  /\.\.\.args\.body\.courseContext|\.\.\.suppliedContext/,
  'The trusted turn must not merge an HTTP course context.',
);

assert.match(
  runMigration,
  /UNIQUE INDEX[\s\S]*"ownerId", "courseId", "idempotencyKey"/,
  'The idempotency constraint must be owned by a migration, not request-time DDL.',
);
assert.doesNotMatch(
  runStore,
  /CREATE TABLE|CREATE (?:UNIQUE )?INDEX|ensureCourseQuestionRunTable/,
  'Course-question requests must never build their schema at runtime.',
);
assert.match(runStore, /status" = 'processing'[\s\S]*leaseToken[\s\S]*leaseExpiresAt/);
assert.match(runStore, /requestHash !== args\.requestHash/);
assert.match(
  runStore,
  /\$transaction\(\s*async \(tx\)[\s\S]*appendCourseQuestionTurnInTransaction\(tx[\s\S]*status" = 'completed'/,
  'Conversation append and run completion must share one transaction.',
);
assert.match(runStore, /locked\.leaseToken !== args\.leaseToken/);
assert.match(runStore, /new Date\(locked\.leaseExpiresAt\)\.getTime\(\) <= Date\.now\(\)/);

assert.match(
  conversationStore,
  /\[args\.userId,\s*args\.courseId,\s*args\.sessionId,\s*args\.idempotencyKey,\s*args\.role\]\.join\('\\0'\)/,
  'Deterministic message IDs must be scoped to owner, course, session, key, and role.',
);
assert.match(
  studyMemoryStore,
  /\$transaction\(async \(transaction\)[\s\S]*pg_advisory_xact_lock\(hashtextextended\(\$1,\s*0\)\)[\s\S]*SELECT[\s\S]*INSERT INTO "StudyMemory"/,
  'Concurrent identical memory confirmations must serialize before SELECT-then-INSERT.',
);
assert.match(conversationStore, /requestPayloadHash !== args\.requestPayloadHash/);
assert.match(conversationStore, /assistantCreatedAt = new Date\(userCreatedAt\.getTime\(\) \+ 1\)/);
assert.match(learnRoute, /orderBy:\s*\[\{ createdAt: 'asc' \}, \{ id: 'asc' \}\]/);

assert.match(learnRoute, /const DEFAULT_SESSION_PAGE_LIMIT = 5/);
assert.match(learnPage, /activeSessionId = urlSessionId \|\| draftSessionId/);
assert.match(
  learnPage,
  /if \(!hydrated \|\| !isLoggedIn\) return;[\s\S]{0,2500}enqueueInitialLearnBootRequest\(\{[\s\S]{0,300}listRemoteLearnSessionsPage\(courseId,\s*\{[\s\S]{0,120}limit:\s*5/,
);
assert.doesNotMatch(
  learnPage,
  /if \(!initialBootSettled\)[\s\S]{0,900}listRemoteLearnSessionsPage\(courseId/,
);
assert.match(
  learnRoute,
  /WITH "courseAccess" AS \([\s\S]{0,700}CASE[\s\S]{0,700}"CourseEnrollment"[\s\S]{0,700}"CoursePurchase"[\s\S]{0,1200}LEFT JOIN LATERAL[\s\S]{0,1200}LIMIT \$3/,
  'The five-name first page must resolve access and metadata in one pool lease.',
);
assert.match(
  learnRoute,
  /const page = await listLearnConversationPageWithoutTransaction\([\s\S]{0,400}if \(!page\.accessRole\)/,
  'The combined metadata query must fail closed when the course is unreadable.',
);
assert.match(
  learnPage,
  /requestedSessionDetailKey !== activeMessageStoreKey[\s\S]{0,500}loadRemoteLearnConversationOrThrow/,
);
assert.match(
  learnPage,
  /const requestCourseId = activeCourseId[\s\S]{0,900}listRemoteLearnSessionsPage\(requestCourseId,\s*\{[\s\S]{0,100}cursor,[\s\S]{0,80}limit:\s*5[\s\S]{0,300}activeCourseIdRef\.current !== requestCourseId/,
);
assert.match(learnPage, /memoryActionDetailRows\(/);
assert.match(
  learnPage,
  /label:\s*'知识点'[\s\S]*label:\s*'已掌握'[\s\S]*label:\s*'证据'[\s\S]*label:\s*'薄弱点'[\s\S]*label:\s*'原因'[\s\S]*label:\s*'下一步'/,
);
assert.match(learnPage, /memoryActionStructuredText\(/);
assert.match(
  learnPage,
  /knowledgePoint:[\s\S]*masteredSignal:[\s\S]*stuckPoint:[\s\S]*cause:[\s\S]*nextTeachingMove:/,
);
assert.match(
  learnPage,
  /learningActionExecutionIdsRef\.current\.has\(executionKey\)[\s\S]*markLearningActionStatus\(action\.id,\s*'confirmed'\)[\s\S]*finally[\s\S]*learningActionExecutionIdsRef\.current\.delete\(executionKey\)/,
  'The /learn memory confirmation path must disable duplicate in-flight action execution.',
);
assert.match(
  learnPage,
  /stableLearningActionCandidateId\(args\.action\.id\)/,
  'Long learning-action IDs must be reduced to a stable bounded candidate ID.',
);

assert.match(openapi, /\/api\/v1\/courses\/\{courseId\}\/questions:/);
assert.match(openapi, /name: Idempotency-Key[\s\S]*required: true/);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: [
        'public auth and required Idempotency-Key',
        'server-only course context and bounded evidence',
        'layered learner-memory retrieval',
        'answer-contract enforcement',
        'durable generation claim and write-side lease fencing',
        'atomic /learn conversation persistence',
        'pending-confirmation memory proposals',
        'deterministic course-contract memory proposals',
        'structured teaching-control fields preserved into /learn writes',
        'zero-relevance source filtering',
        'context-dependent follow-up retrieval',
        'memory confirmation concurrency dedupe',
        'bounded learning-action candidate IDs',
        'generic public internal errors',
        'fresh draft plus five-name/click-detail/cursor pagination UX',
        'OpenAPI contract',
      ],
    },
    null,
    2,
  )}\n`,
);
