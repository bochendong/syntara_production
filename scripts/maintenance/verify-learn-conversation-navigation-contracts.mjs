import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const learnPage = readFileSync(resolve(root, 'components/learn/learn-page-client.tsx'), 'utf8');
const learnRoute = readFileSync(resolve(root, 'app/api/learn/conversations/route.ts'), 'utf8');
const conversationApi = readFileSync(
  resolve(root, 'features/learn-conversations/client/remote-conversation-api.ts'),
  'utf8',
);
const localSessionCache = readFileSync(
  resolve(root, 'features/learn-conversations/client/local-session-cache.ts'),
  'utf8',
);
const conversationRepository = readFileSync(
  resolve(root, 'features/learn-conversations/server/course-conversation-repository.ts'),
  'utf8',
);
const sidebar = readFileSync(resolve(root, 'components/learn/learn-course-sidebar.tsx'), 'utf8');
const allSessionsDialog = readFileSync(
  resolve(root, 'components/learn/learn-all-sessions-dialog.tsx'),
  'utf8',
);

const checks = [
  [
    'URL is the detail-load trigger',
    () => {
      assert.doesNotMatch(learnPage, /requestedSessionDetailKey/);
      assert.match(
        learnPage,
        /if \(!activeCourseId \|\| activeCourseId !== urlCourseId \|\| !urlSessionId\) return;[\s\S]{0,2200}loadRemoteLearnConversationOrThrow\(/,
      );
      assert.match(
        learnPage,
        /selectedLocalSession\?\.remoteState === 'local-only'[\s\S]{0,100}selectedLocalSession\.currentRevision === 0[\s\S]{0,900}setRemoteConversationReadyKey\(detailKey\);[\s\S]{0,80}return;/,
        'Only an explicitly registered local-only rev0 draft may skip detail.',
      );
      assert.doesNotMatch(
        learnPage,
        /const switchCourse[\s\S]{0,300}setActiveCourseId\(courseId\)/,
        'Course navigation must not pair a new course with the previous URL session.',
      );
    },
  ],
  [
    'new sessions receive a canonical URL',
    () => {
      assert.doesNotMatch(learnPage, /draftSessionGeneration/);
      assert.match(
        learnPage,
        /!activeCourseId \|\|[\s\S]{0,100}activeCourseId !== urlCourseId \|\|[\s\S]{0,100}urlSessionId \|\|[\s\S]{0,100}showLearnHomeDashboard[\s\S]{0,260}registerLocalOnlyLearnSession\(\{[\s\S]{0,120}sessionId:\s*draftSessionId,[\s\S]{0,120}resetMessages:\s*true,[\s\S]{0,180}clearMessagesFromRead\(\);[\s\S]{0,100}router\.replace\(learnSessionHref\(draftSessionId\)/,
        'Canonical course entry must register and clear the fresh local-only draft before navigation.',
      );
      assert.match(
        learnPage,
        /const createNewLearnSession[\s\S]{0,450}registerLocalOnlyLearnSession\(\{[\s\S]{0,180}resetMessages:\s*true[\s\S]{0,260}next\.set\('session', nextSessionId\)/,
        'New conversation must register and clear its local-only key before navigation.',
      );
      assert.match(localSessionCache, /remoteState\?: 'local-only' \| 'remote'/);
    },
  ],
  [
    'composer drafts are scoped per session',
    () => {
      assert.match(localSessionCache, /LEARN_SESSION_COMPOSER_DRAFT_PREFIX/);
      assert.match(learnPage, /composerAttachmentsBySessionRef/);
      assert.match(learnPage, /readLearnSessionComposerDraft\([\s\S]{0,180}activeSessionId/);
      assert.match(
        learnPage,
        /learnSessionIsBlank\(visibleMessages\) && !draft\.trim\(\) && attachments\.length === 0/,
        'New conversation may no-op only when the current composer is also empty.',
      );
      assert.match(
        learnPage,
        /function pruneDuplicateBlankLearnSessions[\s\S]{0,650}!readLearnSessionComposerDraft\([\s\S]{0,150}!hasComposerAttachments\?\.\(session\.id\)/,
        'Draft-bearing sessions must not be pruned as duplicate empty conversations.',
      );
    },
  ],
  [
    'conversation deletion is target-scoped and recoverable',
    () => {
      const deleteHandler =
        learnPage.match(
          /const deleteLearnSession = useCallback\(([\s\S]*?)\n\s*const loadMoreLearnSessions/,
        )?.[1] ?? '';
      assert.ok(deleteHandler, 'deleteLearnSession handler was not found');
      assert.doesNotMatch(deleteHandler, /setSending\(/);
      assert.match(deleteHandler, /rememberDeletedLearnSessionId/);
      assert.match(deleteHandler, /replaceDeletedSessionWithFallback/);
      assert.match(
        deleteHandler,
        /session\.remoteState === 'local-only' && session\.currentRevision === 0/,
        'Only an explicit local-only rev0 session may bypass remote delete.',
      );
      assert.match(
        deleteHandler,
        /if \(!localOnlyDraft\) \{[\s\S]{0,180}await deleteRemoteLearnConversation/,
      );
      assert.ok(
        deleteHandler.indexOf('rememberDeletedLearnSessionId') >
          deleteHandler.indexOf('await deleteRemoteLearnConversation'),
        'The durable local session tombstone may be written only after remote delete succeeds.',
      );
      assert.match(deleteHandler, /pendingDeletedSessionKeysRef/);
      assert.match(learnPage, /删除这条会话？/);
    },
  ],
  [
    'late list responses merge against current state',
    () => {
      assert.match(learnPage, /learnSessionsRef\.current/);
      assert.match(
        learnPage,
        /latestCachedSessions[\s\S]{0,350}learnSessionsRef\.current[\s\S]{0,300}remoteSessions\.sessions/,
      );
      assert.match(learnPage, /excludePendingDeletedLearnSessions/);
    },
  ],
  [
    'sidebar and dialog expose honest loading recovery',
    () => {
      assert.match(sidebar, /云端会话列表暂时不可用/);
      assert.match(sidebar, /onRetry/);
      assert.match(sidebar, /\{hasMore \? '\+' : ''\}/);
      assert.match(allSessionsDialog, /已加载 \$\{sessions\.length\}\+ 条/);
      assert.match(
        learnPage,
        /learnSessionListState\.error && !learnSessionListState\.hasMore[\s\S]{0,140}setLearnSessionListRefreshAttempt/,
      );
    },
  ],
  [
    'message tombstones participate in the dirty signature',
    () => {
      assert.match(
        learnPage,
        /function learnConversationSyncSignature[\s\S]{0,240}deletedMessageIds/,
      );
      assert.match(
        learnPage,
        /const deletedMessageIds = Array\.from\([\s\S]{0,250}learnConversationSyncSignature\(\{[\s\S]{0,180}deletedMessageIds/,
      );
      assert.match(
        conversationRepository,
        /EXCLUDED\."deletedAt" IS NOT NULL[\s\S]{0,500}"CourseConversationMessage"\."deletedAt" IS NULL/,
        'Message deletion must leave an explicit tombstone that stale upserts cannot replace.',
      );
      assert.match(
        conversationRepository,
        /recordKind === 'tombstone'[\s\S]{0,180}messageId/,
        'Conversation detail must return durable server tombstone ids.',
      );
      assert.doesNotMatch(
        `${learnRoute}\n${conversationRepository}`,
        /FROM "Message"|INSERT INTO "Message"|FROM "Conversation"/,
        'Course chat persistence must not fall back to the generic chat tables.',
      );
      assert.match(conversationApi, /observeServerDeletedMessageIds\(/);
      assert.match(
        learnPage,
        /serverDeletedMessageIds[\s\S]{0,180}!serverDeletedMessageIds\.has\(message\.id\)/,
        'Remote tombstones must remove stale local messages before reconciliation.',
      );
    },
  ],
  [
    'partial detail reads never infer message upserts',
    () => {
      assert.match(localSessionCache, /LEARN_SESSION_DIRTY_MESSAGES_PREFIX/);
      assert.match(conversationApi, /dirtyMessages\?: RemoteLearnMessagePayload\[\]/);
      assert.match(
        conversationApi,
        /Never infer[\s\S]{0,180}Callers must explicitly[\s\S]{0,160}for \(const message of dirtyMessages\)/,
      );
      assert.match(learnPage, /dirtyConversationMessagesRef/);
      assert.match(
        learnPage,
        /if \(dirtyMessages\.length === 0 && deletedMessageIds\.length === 0\) return;/,
        'An untouched rev0 conversation must not POST an empty patch.',
      );
      assert.match(learnPage, /dirtyMessages,\s*\n\s*deletedMessageIds,/);
      assert.match(
        learnPage,
        /remoteConversation\.session === null[\s\S]{0,120}remoteRevision === 0[\s\S]{0,1600}retainedDirtyMessages\.length === 0[\s\S]{0,300}deleteLearnSessionMessages[\s\S]{0,900}replaceMessagesFromRead\(detailKey, retainedDirtyMessages\)/,
        'A clean revision-zero miss must clear polluted cache/UI and retain only explicit dirty operations.',
      );
    },
  ],
  [
    'message detail is keyed and older pages are explicit reads',
    () => {
      assert.match(
        learnPage,
        /const \[keyedMessagesState,\s*setKeyedMessagesState\] = useState<\{[\s\S]{0,120}key:\s*string;[\s\S]{0,80}messages:\s*LearnMessage\[\];[\s\S]{0,80}>\(\{ key: '', messages: \[\] \}\)/,
        'The rendered conversation key and messages must change as one atomic state.',
      );
      assert.doesNotMatch(
        learnPage,
        /setMessageStoreKey/,
        'A standalone key setter can pair a new session with the previous message array.',
      );
      assert.match(
        learnPage,
        /activeMessagesRef\.current = \{ key, messages: next \};[\s\S]{0,80}setKeyedMessagesState\(\{ key, messages: next \}\)/,
      );
      assert.match(
        learnPage,
        /messageStoreKey === activeMessageStoreKey && activeMessageStoreKey \? messages : \[\]/,
      );
      assert.match(learnPage, /visibleMessages\.map\(/);
      const fallbackHandler =
        learnPage.match(
          /const replaceDeletedSessionWithFallback = useCallback\(([\s\S]*?)\n\s*const handleCourseCreated/,
        )?.[1] ?? '';
      assert.match(
        fallbackHandler,
        /clearMessagesFromRead\(\)[\s\S]{0,180}router\.replace\(/,
        'Fallback navigation must invalidate the old keyed body before changing the URL.',
      );
      assert.match(learnPage, /加载更早消息/);
      assert.match(learnPage, /before:\s*cursor,[\s\S]{0,120}preserveLocalBaseline:\s*true/);
      assert.match(
        learnPage,
        /replaceMessagesFromRead\(detailKey,[\s\S]{0,120}mergeOlderRemoteLearnMessages/,
      );
    },
  ],
  [
    'remote counts protect blank pruning and active sessions stay visible',
    () => {
      assert.match(localSessionCache, /messageCount\?: number/);
      assert.match(
        learnPage,
        /session\.messageCount === 0[\s\S]{0,120}session\.messageCount === undefined/,
      );
      assert.match(
        sidebar,
        /recent\.some\(\(session\) => session\.id === activeSessionId\)[\s\S]{0,180}sessions\.find\(\(session\) => session\.id === activeSessionId\)/,
      );
    },
  ],
];

let passed = 0;
for (const [name, check] of checks) {
  try {
    check();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

console.log(`\nPASS ${passed}/${checks.length} learn conversation navigation contract checks.`);
