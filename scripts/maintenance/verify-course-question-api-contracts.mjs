#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const route = read('app/api/v1/courses/[id]/questions/route.ts');
const contextBuilder = read('lib/chat/server-course-question-context.ts');
const statelessChat = read('features/chat/server/stateless-chat.ts');
const trustedTurn = read('features/chat/server/trusted-course-turn.ts');
const trustedLearnHandoff = read('features/learn-core/server/trusted-answerer-handoff.ts');
const learnTurnRoute = read('app/api/learn/turn/route.ts');
const learnClientAdapters = read('features/learn-core/client-adapters.ts');
const askCourseOrchestrator = read('lib/chat/ask-course-orchestrator.ts');
const runCourseSideChatLoop = read('lib/chat/run-course-side-chat-loop.ts');
const sourceUploadLibrary = read('features/memory/server/source-upload-library.ts');
const boundedSourceRetrieval = read('features/memory/server/bounded-course-source-retrieval.ts');
const answerContract = read('features/memory/domain/course-answer-contract.ts');
const runStore = read('lib/server/course-question-run-store.ts');
const runMigration = read('prisma/migrations/20260727040000_add_course_question_run/migration.sql');
const conversationStore = read('lib/server/learn-conversation-store.ts');
const conversationRepository = read(
  'features/learn-conversations/server/course-conversation-repository.ts',
);
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
assert.match(contextBuilder, /includeTextSections:\s*false/);
assert.match(contextBuilder, /includeArtifacts:\s*false/);
assert.match(contextBuilder, /retrieveBoundedCourseSourceSnippets\(/);
assert.match(boundedSourceRetrieval, /FROM "KnowledgeChunk"/);
assert.match(
  boundedSourceRetrieval,
  /WITH eligible_metadata AS MATERIALIZED[\s\S]*LIMIT \$5[\s\S]*substring\([\s\S]*FOR \$6[\s\S]*"cumulativeChars" <= \$8/,
  'The non-indexed source fallback must shortlist metadata before projecting SQL-budgeted Markdown windows.',
);
assert.match(contextBuilder, /buildLayeredMemoryRecallContext\(/);
assert.match(contextBuilder, /maxSources:\s*4/);
assert.match(contextBuilder, /maxSourceTextChars:\s*9_000/);
assert.match(
  contextBuilder,
  /loadCourseSources\(\{[\s\S]{0,300}verifiedAccess:\s*\{[\s\S]{0,120}ownerId:\s*course\.ownerId,[\s\S]{0,80}accessRole,/,
  'The answerer context must reuse the access result already verified for this request.',
);
assert.match(contextBuilder, /const serverAnswererHandoff:[\s\S]*requiredBehavior:/);
assert.match(contextBuilder, /mergeTrustedPlannerHandoff\([\s\S]*args\.trustedPlannerHandoff/);
assert.match(
  statelessChat,
  /trustedAccess:\s*trusted\.courseAccess[\s\S]{0,900}attachTrustedServerCourseContext\(/,
  'The chat route must carry verified access and attach prompt context without resolving the course twice.',
);
assert.equal(
  statelessChat.match(/await resolveTrustedCourseTurn\(/g)?.length ?? 0,
  1,
  'The chat route must resolve the trusted course exactly once.',
);
assert.match(
  route,
  /const trustedAccess = await resolveTrustedCourseAccess\(\{[\s\S]{0,180}principal\.userId[\s\S]{0,120}courseId/,
  'The public question route must resolve access from the authenticated principal.',
);
assert.match(
  route,
  /buildTrustedCourseQuestionContext\(\{[\s\S]{0,400}trustedAccess,/,
  'The public question context builder must reuse the resolved access.',
);
assert.match(
  route,
  /resolveTrustedCourseTurn\(\{[\s\S]{0,300}trustedAccess,/,
  'The public question turn must reuse the resolved access.',
);
assert.equal(
  route.match(/await resolveTrustedCourseAccess\(/g)?.length ?? 0,
  1,
  'The public question route must perform exactly one explicit trusted-access resolution.',
);
assert.doesNotMatch(
  route,
  /findCourseAccessRole/,
  'The public question route must not maintain a second access-resolution path.',
);
assert.match(
  trustedTurn,
  /args\.trustedAccess\.userId === userId[\s\S]{0,120}args\.trustedAccess\.course\.id === courseId/,
  'A reused access result must remain bound to both the authenticated user and course.',
);
assert.match(
  sourceUploadLibrary,
  /verifiedAccess\?:[\s\S]{0,500}args\.verifiedAccess \?\? \(await requireReadableCourse\(args\)\)/,
  'Source listing must accept only an internal verified-access shortcut and otherwise fail closed.',
);
assert.match(
  contextBuilder,
  /\.filter\(\s*\(candidate\) => candidate\.score > 0 && candidate\.rankedPages\.length > 0\s*\)/,
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
assert.match(learnTurnRoute, /issueTrustedLearnAnswererHandoff\(\{/);
assert.match(
  trustedLearnHandoff,
  /createHmac\('sha256'[\s\S]*timingSafeEqual[\s\S]*userId[\s\S]*courseId[\s\S]*questionDigest[\s\S]*expiresAt/,
  'Learn-core handoffs must be signed and bound to user, course, question, and expiry.',
);
assert.match(
  learnClientAdapters,
  /trustedToken:\s*response\?\.trustedAnswererHandoffToken/,
  'The browser adapter may carry only the opaque signed handoff capability.',
);
assert.match(
  askCourseOrchestrator,
  /trustedLearnAnswererHandoffToken:\s*options\.answererHandoff\?\.trustedToken/,
);
assert.match(runCourseSideChatLoop, /trustedLearnAnswererHandoffToken,/);
assert.match(
  statelessChat,
  /const trustedPlannerHandoff = verifyTrustedLearnAnswererHandoff\(\{/,
  'The chat server must verify the opaque handoff before adding planner constraints to trusted context.',
);
assert.match(
  statelessChat,
  /buildTrustedCourseQuestionContext\(\{[\s\S]{0,500}trustedPlannerHandoff,/,
);
assert.match(
  statelessChat,
  /stripTrustedLearnHandoffToken\(trustedBody\)/,
  'The opaque transport token must not continue into model generation.',
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
assert.match(conversationRepository, /message\.requestPayloadHash !== args\.requestPayloadHash/);
assert.match(conversationStore, /assistantCreatedAt = new Date\(userCreatedAt\.getTime\(\) \+ 1\)/);
assert.match(
  conversationRepository,
  /loadCourseQuestionHistory[\s\S]*"deletedAt" IS NULL[\s\S]*ORDER BY "sequence" DESC[\s\S]*LIMIT \$4/,
  'Public question history must exclude tombstones before applying its bounded take.',
);
assert.match(
  conversationRepository,
  /loadCourseConversationSnapshot[\s\S]*ORDER BY m\."sequence" DESC[\s\S]*LIMIT \$5/,
  'Conversation detail must read a bounded sequence window with lookahead.',
);
assert.match(
  learnRoute,
  /syncMode:\s*z\.literal\('patch'\)\.default\('patch'\)/,
  'The public conversation API must accept incremental patches only.',
);
assert.match(
  conversationRepository,
  /patchCourseConversationMessages[\s\S]*"operation" = 'delete'[\s\S]*ON CONFLICT \("id"\) DO UPDATE/,
  'Patch sync must persist explicitly named message tombstones idempotently.',
);
assert.match(
  `${learnRoute}\n${conversationRepository}`,
  /messageWindow:[\s\S]*hasMore[\s\S]*isComplete/,
  'A bounded message response must identify whether its window is complete.',
);
assert.match(
  learnRoute,
  /appliedMessageIds[\s\S]{0,200}appliedDeletedMessageIds/,
  'Patch responses must explicitly acknowledge accepted upserts and tombstones.',
);
assert.match(
  learnRoute,
  /serverDeletedMessageIds/,
  'Patch responses must reject stale upserts for server-tombstoned messages.',
);

assert.match(conversationRepository, /DEFAULT_COURSE_CONVERSATION_PAGE_LIMIT = 5/);
assert.match(learnPage, /activeSessionId = urlSessionId \|\| draftSessionId/);
assert.doesNotMatch(
  learnPage,
  /requestedSessionDetailKey/,
  'The URL session must be the only trigger for loading conversation detail.',
);
assert.match(
  learnPage,
  /if \(!hydrated \|\| !isLoggedIn\) return;[\s\S]{0,2500}enqueueInitialLearnBootRequest\(\{[\s\S]{0,300}listRemoteLearnSessionsPage\(courseId,\s*\{[\s\S]{0,120}limit:\s*5/,
);
assert.doesNotMatch(
  learnPage,
  /if \(!initialBootSettled\)[\s\S]{0,900}listRemoteLearnSessionsPage\(courseId/,
);

const conversationListRepositorySource = conversationRepository.slice(
  conversationRepository.indexOf('export async function listCourseConversationPage('),
  conversationRepository.indexOf('export async function loadCourseConversationSnapshot('),
);
assert.match(
  conversationListRepositorySource,
  /WITH "courseAccess" AS \([\s\S]*CASE[\s\S]*"CourseEnrollment"[\s\S]*"CoursePurchase"[\s\S]*LEFT JOIN LATERAL[\s\S]*LIMIT \$5/,
  'The five-name first page must resolve access and metadata in one pool lease.',
);
assert.match(
  learnRoute,
  /const page = await listCourseConversationPage\([\s\S]{0,400}if \(!page\.accessRole\)/,
  'The combined metadata query must fail closed when the course is unreadable.',
);
assert.doesNotMatch(
  `${learnRoute}\n${conversationStore}\n${conversationRepository}`,
  /FROM "Conversation"|FROM "Message"|INSERT INTO "Conversation"|INSERT INTO "Message"/,
  'Course question persistence must use only dedicated conversation tables.',
);
assert.match(
  learnPage,
  /if \(!activeCourseId \|\| activeCourseId !== urlCourseId \|\| !urlSessionId\) return;[\s\S]{0,2200}loadRemoteLearnConversationOrThrow/,
  'A canonical URL session may trigger lazy detail only after the route and active course agree.',
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
        'single-pass trusted course access and answerer handoff',
        'signed learn-core planner handoff transport',
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
