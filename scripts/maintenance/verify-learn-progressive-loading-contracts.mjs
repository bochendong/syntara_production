#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const learnPagePath = 'components/learn/learn-page-client.tsx';
const learnRoutePath = 'app/learn/page.tsx';
const shellPath = 'components/learn/learn-page-shell-skeleton.tsx';
const sidebarPath = 'components/learn/learn-course-sidebar.tsx';
const conversationApiPath = 'features/learn-conversations/client/remote-conversation-api.ts';
const learnerCourseApiPath = 'lib/utils/learner-course-api.ts';
const studyMemoryRoutePath = 'app/api/study-memory/route.ts';
const learnPage = fs.readFileSync(path.join(root, learnPagePath), 'utf8');
const learnRoute = fs.readFileSync(path.join(root, learnRoutePath), 'utf8');
const shell = fs.readFileSync(path.join(root, shellPath), 'utf8');
const sidebar = fs.readFileSync(path.join(root, sidebarPath), 'utf8');
const conversationApi = fs.readFileSync(path.join(root, conversationApiPath), 'utf8');
const learnerCourseApi = fs.readFileSync(path.join(root, learnerCourseApiPath), 'utf8');
const studyMemoryRoute = fs.readFileSync(path.join(root, studyMemoryRoutePath), 'utf8');
const surfaceStatusBlock =
  learnPage.match(/const learnSurfaceStatusItems:[\s\S]*?=\s*\[([\s\S]*?)\n\s*\];/)?.[1] ?? '';
const failures = [];

function requirePattern(source, pattern, label) {
  if (!pattern.test(source)) failures.push(label);
}

function forbidPattern(source, pattern, label) {
  if (pattern.test(source)) failures.push(label);
}

requirePattern(
  learnRoute,
  /dynamic\(\(\)\s*=>[\s\S]*learn-page-client[\s\S]*<Suspense fallback=\{<LearnPageShellSkeleton \/>}/,
  'the route must stream a stable shell before the learn client bundle is ready',
);
requirePattern(
  shell,
  /aria-busy=\{!hasError}[\s\S]*role="status"[\s\S]*aria-live="polite"/,
  'the route shell must expose an accessible loading state',
);
requirePattern(
  learnPage,
  /courseShellFromUrl\([\s\S]*matchingName[\s\S]*name:\s*matchingName \|\| '课程学习空间'/,
  'a direct course URL must render a useful persisted title before remote metadata resolves',
);
requirePattern(
  learnPage,
  /readLearnCourseListCache\(localUserId,\s*\{\s*allowStale:\s*true\s*}\)/,
  'the course shell must use stale-while-refresh course metadata',
);
requirePattern(
  learnPage,
  /activeCourseCanLoadResources[\s\S]{0,240}initialBootSettled[\s\S]{0,240}!isProvisionalCourseShell\(activeCourse\)[\s\S]{0,240}isUsefulCourseShellName\(activeCourse\.name\)[\s\S]{0,120}courseLoadError/,
  'database-heavy resources must wait for the initial boot sequence and useful course metadata',
);
requirePattern(
  learnPage,
  /if \(urlCourseId && activeCourseId !== urlCourseId\)[\s\S]{0,260}const bootKey = activeCourseBootKey[\s\S]{0,500}getCourseOrThrow\(urlCourseId/,
  'course detail must never pair an optimistic active-course key with a stale route course',
);
requirePattern(
  learnPage,
  /learnDatabaseQueueTailRef = useRef<Promise<void>>\(Promise\.resolve\(\)\)/,
  'all database-backed course reads must share one max-one client queue',
);
requirePattern(
  learnPage,
  /enqueueInitialLearnBootRequest\(\{[\s\S]{0,240}getCourseOrThrow\(urlCourseId/,
  'course detail must enter the shared database queue',
);
requirePattern(
  learnPage,
  /listRemoteLearnSessionsPage\(courseId,\s*\{[\s\S]{0,120}limit:\s*5,[\s\S]{0,120}ownerScope:\s*localUserId/,
  'the remote history refresh must fetch only five session metadata rows',
);
requirePattern(
  learnPage,
  /enqueueInitialLearnBootRequest\(\{[\s\S]{0,500}listRemoteLearnSessionsPage/,
  'conversation metadata must enter the shared database queue as soon as possible',
);
forbidPattern(
  learnPage,
  /startupConversationSettledKey/,
  'course metadata and resources must never wait for conversation history synchronization',
);
requirePattern(
  learnPage,
  /if \(!hydrated \|\| !isLoggedIn\) return;[\s\S]{0,1600}void enqueueInitialLearnBootRequest\(\{[\s\S]{0,500}listRemoteLearnSessionsPage\(courseId,\s*\{[\s\S]{0,120}limit:\s*5/,
  'remote conversation names must enter the shared queue as soon as auth and the route course are known',
);
forbidPattern(
  learnPage,
  /if \(!initialBootSettled\)[\s\S]{0,900}listRemoteLearnSessionsPage\(courseId/,
  'the five conversation names must not wait for the course-detail request',
);
forbidPattern(
  learnPage,
  /enqueueDeferredLearnDataRequest\(\{[\s\S]{0,320}listRemoteLearnSessionsPage\(courseId/,
  'the five conversation names must not wait behind deferred course data',
);
forbidPattern(
  learnPage,
  /if \(!firstResourceRoundReady\)[\s\S]{0,650}listRemoteLearnSessionsPage\(courseId/,
  'the five conversation names must not wait for notebook or problem hydration',
);
forbidPattern(
  learnPage,
  /enqueueInitialLearnBootRequest\(\{[\s\S]{0,500}loadRemoteLearnConversationOrThrow/,
  'initial course boot must never fetch a conversation body',
);
requirePattern(
  learnPage,
  /if \(!activeCourseId \|\| activeCourseId !== urlCourseId \|\| !urlSessionId\) return;[\s\S]{0,240}const sessionId = urlSessionId[\s\S]{0,3500}loadRemoteLearnConversationOrThrow\(courseId,\s*sessionId,\s*localUserId,\s*\{[\s\S]{0,100}signal:\s*controller\.signal/,
  'conversation detail must load only when the URL names a selected session',
);
requirePattern(
  learnPage,
  /selectedLocalSession\?\.remoteState === 'local-only'[\s\S]{0,100}selectedLocalSession\.currentRevision === 0[\s\S]{0,900}setRemoteConversationReadyKey\(detailKey\);[\s\S]{0,80}return;[\s\S]{0,120}const controller = new AbortController\(\)/,
  'an explicitly registered local-only rev0 draft must become ready without a detail database read',
);
requirePattern(
  learnPage,
  /loadRemoteLearnConversationOrThrow\(courseId,\s*sessionId,\s*localUserId,[\s\S]{0,220}signal:\s*controller\.signal[\s\S]{0,12000}controller\.abort\(new DOMException\('会话已切换'/,
  'rapid session switches must abort obsolete queued conversation bodies',
);
requirePattern(
  learnPage,
  /selectLearnSession[\s\S]{0,320}router\.push\(learnSessionHref\(sessionId\)\)/,
  'session clicks must navigate through the canonical URL before loading the body',
);
requirePattern(
  learnPage,
  /learnSessionHref[\s\S]{0,260}next\.set\('session',\s*sessionId\)/,
  'every historical session id, including the legacy default id, must remain addressable',
);
forbidPattern(
  learnPage,
  /sessionId === 'default'[\s\S]{0,80}delete\('session'\)/,
  'the legacy default session must not be mistaken for a fresh blank draft',
);
requirePattern(
  learnPage,
  /draftSessionId = useMemo\([\s\S]{0,160}makeLearnSessionId\(`\$\{localUserId}:\$\{urlCourseId}`\)[\s\S]{0,160}activeSessionId = urlSessionId \|\| draftSessionId/,
  'course entry must use a unique local draft instead of a remote default session',
);
requirePattern(
  learnPage,
  /switchCourse[\s\S]{0,300}next\.set\('courseId',\s*courseId\);[\s\S]{0,100}next\.delete\('session'\)[\s\S]{0,500}!activeCourseId \|\|[\s\S]{0,100}activeCourseId !== urlCourseId \|\|[\s\S]{0,100}urlSessionId \|\|[\s\S]{0,100}showLearnHomeDashboard[\s\S]{0,260}registerLocalOnlyLearnSession\(\{[\s\S]{0,120}sessionId:\s*draftSessionId,[\s\S]{0,120}resetMessages:\s*true,[\s\S]{0,180}clearMessagesFromRead\(\);[\s\S]{0,100}router\.replace\(learnSessionHref\(draftSessionId\)/,
  'course switching must strip any prior session parameter and canonicalize a fresh draft URL',
);
requirePattern(
  learnPage,
  /learnSessionListCourseIdRef\.current !== activeCourseId[\s\S]{0,500}setLearnSessionListState\(\{/,
  'selecting a session must preserve the already-loaded metadata cursor for the same course',
);
requirePattern(
  learnPage,
  /const requestCourseId = activeCourseId[\s\S]{0,1200}listRemoteLearnSessionsPage\(requestCourseId,\s*\{[\s\S]{0,100}cursor,[\s\S]{0,80}limit:\s*5/,
  'load-more must paginate session metadata five rows at a time',
);
requirePattern(
  learnPage,
  /listRemoteLearnSessionsPage\(requestCourseId,[\s\S]{0,400}activeCourseIdRef\.current !== requestCourseId[\s\S]{0,160}learnSessionListCourseIdRef\.current !== requestCourseId[\s\S]{0,160}return;/,
  'load-more must discard a page returned after the user switches courses',
);
requirePattern(
  sidebar,
  /const MAX_VISIBLE_SESSIONS = 5;/,
  'the course sidebar must never show more than five recent sessions',
);
requirePattern(
  learnPage,
  /const enqueueCourseResourceRequest[\s\S]{0,500}const previous = learnDatabaseQueueTailRef\.current[\s\S]{0,500}await previous/,
  'course resources must pass through the shared cancellable database queue',
);
requirePattern(
  learnPage,
  /args\.signal\.aborted \|\| activeCourseIdRef\.current !== args\.courseId[\s\S]*COURSE_RESOURCE_QUEUE_ABORT_COOLDOWN_MS/,
  'queued resource work must cancel by course and cool down abandoned database requests',
);
for (const [kind, call] of [
  ['problems', 'listCourseProblemSummaries'],
  ['notebooks', 'listStagesByCourseOrThrow'],
  ['sources', 'listCourseSourceUploads'],
]) {
  requirePattern(
    learnPage,
    new RegExp(
      `enqueueCourseResourceRequest\\(\\{[\\s\\S]{0,240}kind:\\s*'${kind}'[\\s\\S]{0,260}${call}\\(`,
    ),
    `${kind} must use the serial resource queue`,
  );
}
requirePattern(
  learnPage,
  /if \(!activeCourse \|\| !activeCourseCanLoadResources \|\| !sourceUploadPanelOpen\) return;[\s\S]{0,900}listCourseSourceUploads\(courseId/,
  'original lecture files must stay completely lazy until their panel opens',
);
requirePattern(
  learnPage,
  /function courseSourceHealthNotice[\s\S]{0,500}failureCount === 0 && incompleteCount === 0\) return null/,
  'healthy source aggregates must remain invisible in the default course header',
);
requirePattern(
  learnPage,
  /activeCourseSourceHealthNotice \? \([\s\S]{0,400}onClick=\{openSourceUploadPanel\}[\s\S]{0,1800}data-testid="learn-source-health-warning"/,
  'abnormal aggregate source health may open, but must not prefetch, the source panel',
);
forbidPattern(
  learnPage,
  /activeCourseSourceHealthNotice[\s\S]{0,500}listCourseSourceUploads\(/,
  'rendering the source-health warning must not fetch source metadata or bodies',
);
forbidPattern(
  learnPage,
  /Promise\.all\(\s*\[[\s\S]{0,1000}(?:listCourseProblemSummaries|listStagesByCourseOrThrow|listCourseSourceUploads)[\s\S]{0,1000}(?:listCourseProblemSummaries|listStagesByCourseOrThrow|listCourseSourceUploads)/,
  'problem, notebook, and source requests must never launch together',
);
requirePattern(
  learnPage,
  /const enqueueDeferredLearnDataRequest[\s\S]{0,400}const previous = learnDatabaseQueueTailRef\.current[\s\S]{0,500}await previous/,
  'non-critical course data must reuse the same max-one database queue',
);
for (const [label, call] of [
  ['practice plans', 'listRemotePracticePlans'],
  ['learner state', 'loadRemoteLearnerCourseState'],
]) {
  requirePattern(
    learnPage,
    new RegExp(
      `if \\(!activeCourse[\\s\\S]{0,180}!firstResourceRoundReady\\)[\\s\\S]{0,180}(?:return;|setPublishableMemoryCount\\(0\\);[\\s\\S]{0,80}return;)[\\s\\S]{0,900}enqueueDeferredLearnDataRequest\\(\\{[\\s\\S]{0,300}${call}\\(`,
    ),
    `${label} must wait for the first resource round and use the deferred queue`,
  );
}
requirePattern(
  learnPage,
  /if\s*\([\s\S]{0,120}!activeCourse[\s\S]{0,180}!firstResourceRoundReady[\s\S]{0,180}\(!publishDialogOpen && !memoryActivityDialogOpen\)[\s\S]{0,300}enqueueDeferredLearnDataRequest\(\{[\s\S]{0,300}listStudyMemoryRecords/,
  'course memory counts must wait for resources, stay lazy until needed, and reuse the deferred queue',
);
requirePattern(
  learnPage,
  /\{publishableMemoryCount \?\? '—'\}/,
  'an unloaded memory count must render as unknown instead of a false zero',
);
forbidPattern(
  studyMemoryRoute,
  /seedDefaultCoursePublicMemories|getDefaultCoursePublicMemories|source:\s*'default-seed'/,
  'the study-memory GET route must never seed or mutate default memories',
);
requirePattern(
  studyMemoryRoute,
  /export async function GET[\s\S]{0,1800}const memories = await listStudyMemoriesForViewer/,
  'the study-memory GET route must remain a direct read',
);
requirePattern(
  learnPage,
  /if \(!firstResourceRoundReady\) return;[\s\S]{0,180}enqueueDeferredLearnDataRequest\(\{[\s\S]{0,160}request:\s*fetchServerProviders/,
  'provider discovery must not take an initial course connection',
);
requirePattern(
  learnerCourseApi,
  /options:\s*\{\s*throwOnError\?:\s*boolean\s*\}[\s\S]{0,900}if \(options\.throwOnError\) throw error/,
  'learner-state reads must distinguish a failed request from an empty result',
);
requirePattern(
  learnerCourseApi,
  /loadRemoteLearnerCourseState[\s\S]{0,900}listUserFacts\([\s\S]{0,500}throwOnError:\s*true/,
  'the course learner-state read must propagate transport failures',
);
forbidPattern(
  learnPage,
  /loadRemoteLearnerCourseState\(courseId\)[\s\S]{0,1400}if \(!remoteState\)[\s\S]{0,160}saveRemoteLearnerCourseState/,
  'opening a course must not create an empty learner-state fact',
);
requirePattern(
  learnPage,
  /listCourseProblemSummaries\(courseId,[\s\S]*setProblemsLoadState\([\s\S]*settledResourceLoadState/,
  'problem-bank loading must own an independent state',
);
requirePattern(
  learnPage,
  /listStagesByCourseOrThrow\(courseId,[\s\S]*setNotebooksLoadState\([\s\S]*settledResourceLoadState/,
  'notebook loading must own an independent state',
);
requirePattern(
  learnPage,
  /listCourseSourceUploads\(courseId,[\s\S]*setSourcesLoadState\([\s\S]*settledResourceLoadState/,
  'source-library loading must own an independent state',
);
requirePattern(
  learnPage,
  /const learnSurfaceStatusItems: LearnSurfaceStatusItem\[\] = \[/,
  'the course chat surface must keep the independent surface status model',
);
for (const label of ['题库', '笔记本']) {
  requirePattern(
    learnPage,
    new RegExp(`label:\\s*'${label}'`),
    `the visible status model must include ${label}`,
  );
}
requirePattern(
  learnPage,
  /const notebookSurfaceStatus[\s\S]{0,800}label:\s*'笔记本'[\s\S]{0,800}deferredWhenListIdle:\s*true/,
  'an untouched notebook list must remain visibly deferred instead of pretending to load',
);
requirePattern(
  learnPage,
  /deferredWhenListIdle\?: boolean[\s\S]{0,1200}args\.deferredWhenListIdle[\s\S]{0,160}status:\s*'deferred',\s*statusLabel:\s*'按需加载'/,
  'the deferred notebook state must use a non-loading status and an explicit on-demand label',
);
forbidPattern(
  surfaceStatusBlock,
  /key:\s*'sources'|label:\s*'(?:资料|原始讲义)'/,
  'the default surface status must not expose unloaded original lecture files',
);
requirePattern(
  learnPage,
  /const firstResourceRoundReady = Boolean\([\s\S]{0,160}activeCourse && courseContentStateRevision\.startsWith\(`\$\{activeCourse\.id}:/,
  'deferred course reads must unlock only after the lightweight course-content state resolves',
);
requirePattern(
  learnPage,
  /sourceUploadPanelOpenRef\.current &&[\s\S]{0,120}previousState\.sources\.revision !== nextState\.sources\.revision/,
  'content-state reconciliation may refresh sources only while their panel is open',
);
requirePattern(
  learnPage,
  /const COURSE_CONTENT_STATE_POLL_MS = 30_000/,
  'visible-page steady-state content polling must avoid competing with foreground course reads',
);
requirePattern(
  learnPage,
  /const COURSE_CONTENT_STATE_HOT_POLL_MS = 5_000[\s\S]*const COURSE_CONTENT_STATE_HOT_WINDOW_MS = 60_000/,
  'the post-mutation hot window must remain faster and bounded',
);
requirePattern(
  learnPage,
  /let requestInFlight = false[\s\S]*if \(requestInFlight\) return[\s\S]*requestInFlight = true[\s\S]*requestInFlight = false/,
  'content polling must keep a single request in flight',
);
requirePattern(
  learnPage,
  /firstResourceRoundReady[\s\S]*state\.status === 'ready'[\s\S]*state\.status === 'empty'[\s\S]*!firstResourceRoundReady[\s\S]*requestCourseContentPoll/,
  'the content-state watcher must not start after a problem or notebook error',
);
requirePattern(
  learnPage,
  /enqueueDeferredLearnDataRequest\(\{[\s\S]{0,180}runCourseContentStatePollWithLock\(\{[\s\S]{0,260}loadCourseContentState\(courseId/,
  'content-state polling must share the deferred queue and a cross-tab lock',
);
requirePattern(
  learnPage,
  /new BroadcastChannel\([\s\S]*contentStateChannel\?\.addEventListener\('message',\s*handleContentStateBroadcast\)/,
  'successful content checks must fan out to sibling tabs',
);
requirePattern(
  learnPage,
  /contentStateChannel\?\.removeEventListener\('message',\s*handleContentStateBroadcast\)[\s\S]{0,120}contentStateChannel\?\.close\(\)/,
  'course switches must release the cross-tab content-state channel',
);
requirePattern(
  learnPage,
  /document\.visibilityState === 'hidden'[\s\S]*document\.addEventListener\('visibilitychange'/,
  'content polling must pause while the page is hidden',
);
requirePattern(
  learnPage,
  /consecutiveFailures \+= 1[\s\S]*Math\.min\([\s\S]*COURSE_CONTENT_STATE_MAX_BACKOFF_MS[\s\S]*COURSE_CONTENT_STATE_FAILURE_BACKOFF_MS \* 2 \*\* Math\.min\(consecutiveFailures - 1,\s*3\)/,
  'content polling failures must use bounded exponential backoff',
);
requirePattern(
  conversationApi,
  /CONVERSATION_LIST_TIMEOUT_MS\s*=\s*40_000/,
  'the metadata-only conversation list must have at least a 35-second timeout',
);
requirePattern(
  conversationApi,
  /listRemoteLearnSessionsPage[\s\S]{0,900}timeoutMs:\s*CONVERSATION_LIST_TIMEOUT_MS/,
  'the session-page request must use its longer metadata-list timeout',
);
requirePattern(
  conversationApi,
  /RemoteLearnSessionPageOptions[\s\S]{0,220}signal\?:\s*AbortSignal/,
  'conversation-title metadata reads must accept caller cancellation',
);
requirePattern(
  conversationApi,
  /listRemoteLearnSessionsPage[\s\S]{0,700}signal:\s*options\.signal/,
  'the conversation-title request must forward caller cancellation',
);
requirePattern(
  conversationApi,
  /listRemoteLearnSessionsPage[\s\S]{0,2000}catch \(error\)[\s\S]{0,360}if \(options\.signal\?\.aborted\) throw error/,
  'an intentional course switch must remain a cancellation instead of becoming a false list failure',
);
requirePattern(
  conversationApi,
  /loadRemoteLearnConversationOrThrow\([\s\S]{0,260}options:\s*\{[\s\S]{0,120}signal\?:\s*AbortSignal[\s\S]{0,320}signal:\s*options\.signal/,
  'conversation-body reads must accept latest-selection cancellation',
);
requirePattern(
  learnPage,
  /const courseId = activeCourseId;\s*const controller = new AbortController\(\)[\s\S]{0,1200}listRemoteLearnSessionsPage\(courseId,[\s\S]{0,240}signal:\s*controller\.signal[\s\S]{0,3000}controller\.abort\(/,
  'switching courses must abort a stale queued conversation-title read',
);
requirePattern(
  learnPage,
  /function courseResourceQueueErrorNeedsCooldown[\s\S]{0,260}error\.kind === 'aborted'\) return false[\s\S]{0,120}error\.kind === 'timeout'\) return true/,
  'intentional navigation cancellation must release the shared queue without a recovery cooldown',
);
requirePattern(
  learnPage,
  /const switchCourse[\s\S]{0,400}next\.delete\('session'\)[\s\S]{0,120}setSourceUploadDialogOpen\(false\)[\s\S]{0,240}router\.replace/,
  'switching courses must close the lazy source panel before the next course can hydrate it',
);
forbidPattern(
  learnPage,
  /initialLearnBootQueueTailRef|courseResourceQueueTailRef|deferredLearnDataQueueTailRef/,
  'independent cold-load queues would exceed the small Prisma connection budget',
);

if (failures.length > 0) {
  process.stderr.write(
    `${JSON.stringify(
      {
        ok: false,
        failures,
        checkedFiles: [
          learnPagePath,
          learnRoutePath,
          shellPath,
          sidebarPath,
          conversationApiPath,
          learnerCourseApiPath,
          studyMemoryRoutePath,
        ],
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
        'immediate route shell and persisted course title',
        'fresh blank course drafts without automatic conversation-body reads',
        'early queued five-row session metadata with click-only detail loading',
        'course-switch cancellation and stale-page guards for conversation metadata',
        'independent progressive problem and notebook loading',
        'panel-gated original lecture file loading',
        'quiet healthy source state and aggregate-only abnormal warning',
        'success-only deferral for plans, learner state, memory, providers, and content state',
        'course entry and failed learner-state reads remain read-only',
        'course memory counts and default-memory persistence remain explicit and lazy',
        'one max-one database queue across bootstrap, resources, and deferred reads',
        'visible per-surface loading and failure status',
        'thirty-second visible-page reconciliation through deferred and cross-tab single-flight gates',
        'hidden-tab pause, hot window, and failure backoff',
      ],
    },
    null,
    2,
  )}\n`,
);
