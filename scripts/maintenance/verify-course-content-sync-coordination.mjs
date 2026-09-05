#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const learnPagePath = 'components/learn/learn-page-client.tsx';
const contentStateRoutePath = 'app/api/courses/[id]/content-state/route.ts';
const courseDetailRoutePath = 'app/api/courses/[id]/route.ts';
const learnPage = fs.readFileSync(path.join(root, learnPagePath), 'utf8');
const contentStateRoute = fs.readFileSync(path.join(root, contentStateRoutePath), 'utf8');
const courseDetailRoute = fs.readFileSync(path.join(root, courseDetailRoutePath), 'utf8');

assert.match(
  learnPage,
  /navigator\.locks\.request\([\s\S]{0,220}encodeURIComponent\(args\.ownerScope\)[\s\S]{0,100}args\.courseId[\s\S]{0,180}mode:\s*'exclusive'/,
  'A user/course-scoped exclusive Web Lock must serialize sibling-tab polls.',
);
assert.match(
  learnPage,
  /readFreshSharedState[\s\S]{0,900}navigator\.locks\.request[\s\S]{0,500}const shared = readFreshSharedState\(\)[\s\S]{0,160}source:\s*'shared'/,
  'Each lock holder must reuse a fresh shared snapshot before making another request.',
);
assert.match(
  learnPage,
  /enqueueDeferredLearnDataRequest\(\{[\s\S]{0,180}runCourseContentStatePollWithLock\(\{[\s\S]{0,260}loadCourseContentState\(courseId/,
  'Content polling must wait behind the tab-local deferred-data queue before taking a connection.',
);
assert.match(
  learnPage,
  /new BroadcastChannel\([\s\S]{0,180}COURSE_CONTENT_STATE_CHANNEL_PREFIX[\s\S]{0,180}encodeURIComponent\(localUserId\)[\s\S]{0,100}courseId/,
  'Content-state broadcasts must be scoped to both the current user and course.',
);
assert.match(
  learnPage,
  /contentStateChannel\?\.postMessage\(\{[\s\S]{0,100}type:\s*'course-content-state'[\s\S]{0,100}state:\s*pollResult\.value/,
  'The polling tab must broadcast a successful state snapshot.',
);
assert.match(
  learnPage,
  /handleContentStateBroadcast[\s\S]{0,180}applyExternalContentState\(\s*courseContentStateFromBroadcast\(event\.data,\s*courseId\)/,
  'Sibling tabs must apply a validated broadcast snapshot without another request.',
);
assert.match(
  learnPage,
  /contentStateChannel\?\.close\(\)/,
  'Course switches must close the per-course broadcast channel.',
);
assert.match(
  learnPage,
  /window\.addEventListener\('storage',\s*handleContentStateStorage\)[\s\S]{0,500}window\.removeEventListener\('storage',\s*handleContentStateStorage\)/,
  'A localStorage event must fan out snapshots when BroadcastChannel is unavailable.',
);
assert.match(
  learnPage,
  /window\.addEventListener\('focus',\s*pollWhenDue\)/,
  'Window focus must respect the existing poll deadline.',
);

assert.doesNotMatch(
  contentStateRoute,
  /findCourseAccessRole/,
  'The watcher route must not spend a separate pool lease on access lookup.',
);
assert.match(
  contentStateRoute,
  /CASE[\s\S]*course\."ownerId"[\s\S]*"CourseEnrollment"[\s\S]*"CoursePurchase"[\s\S]*END AS "accessRole"/,
  'Access role must be resolved in the same compact SQL statement as resource revisions.',
);
assert.match(
  contentStateRoute,
  /__synatraCourseContentStateFlightsV2__/,
  'The watcher route must keep its in-flight map on the server global.',
);
assert.match(
  contentStateRoute,
  /readCourseContentStateSingleFlight[\s\S]{0,400}existing = flights\.get\(key\)[\s\S]{0,220}Date\.now\(\) - existing\.startedAt < CONTENT_STATE_STALE_FLIGHT_MS[\s\S]{0,120}return existing\.promise/,
  'Concurrent server requests for the same user/course must share one in-flight snapshot.',
);
assert.match(
  contentStateRoute,
  /if \(existing\) flights\.delete\(key\)[\s\S]{0,300}readCourseContentState\(userId,\s*courseId\)\.finally\([\s\S]{0,180}flights\.get\(key\) === flight[\s\S]{0,100}flights\.delete\(key\)/,
  'A stale server flight must be replaced without allowing the old promise to delete its replacement.',
);
assert.match(
  contentStateRoute,
  /CONTENT_STATE_STALE_FLIGHT_MS = 45_000/,
  'A permanently stuck snapshot must become replaceable after a bounded stale-flight window.',
);
assert.match(
  contentStateRoute,
  /Promise\.race\([\s\S]{0,500}CourseContentStateTimeoutError[\s\S]{0,300}CONTENT_STATE_WAIT_TIMEOUT_MS/,
  'Each watcher request must stop waiting for a stuck shared query after a bounded timeout.',
);
assert.match(
  contentStateRoute,
  /COURSE_CONTENT_STATE_TIMEOUT[\s\S]{0,120}retryable:\s*true[\s\S]{0,180}status:\s*504[\s\S]{0,180}'Retry-After':\s*'5'/,
  'A timed-out synchronization check must fail visibly as a retryable 504 response.',
);
assert.match(
  contentStateRoute,
  /readCourseContentState\(userId,\s*courseId\)\.finally\([\s\S]{0,180}flights\.delete\(key\)/,
  'The server single-flight entry must always be released after completion.',
);
assert.match(
  contentStateRoute,
  /withCourseEnrollmentSchemaFallback\(\s*prisma/,
  'The compact access query must preserve the legacy CourseEnrollment schema fallback.',
);
assert.match(
  contentStateRoute,
  /problem\."courseId" IS NULL[\s\S]*?problem_notebook\."id" = problem\."notebookId"[\s\S]*?problem_notebook\."courseId" = \$\{courseId\}/,
  'Problem revisions must include legacy notebook-scoped course problems.',
);
assert.match(
  contentStateRoute,
  /CROSS JOIN LATERAL[\s\S]*COUNT\(\*\) FILTER \([\s\S]*"ingestStatus" = 'processing'[\s\S]*"sourceProcessingCount"[\s\S]*"sourceIngestErrorCount"[\s\S]*"sourceIndexPendingCount"[\s\S]*"sourceIndexErrorCount"[\s\S]*"sourceOldestProcessingAt"/,
  'Source synchronization health must come from one cheap aggregate scan.',
);
assert.match(
  contentStateRoute,
  /const sourceHealthRevision = \[[\s\S]{0,350}sources\.processingCount[\s\S]{0,350}sources\.indexErrorCount[\s\S]{0,220}timestamp\(row\.sourceOldestProcessingAt\)[\s\S]{0,400}sourceHealthRevision/,
  'Aggregate health changes must rerender the warning without changing the source-list cache revision.',
);
assert.doesNotMatch(
  contentStateRoute,
  /"extractedText"|"metadataJson"|"artifactCountsJson"/,
  'The content-state watcher must never read source bodies or artifact payloads.',
);
assert.match(
  learnPage,
  /sourceHealthCounts[\s\S]{0,400}processingCount[\s\S]{0,220}ingestErrorCount[\s\S]{0,220}indexPendingCount[\s\S]{0,220}indexErrorCount[\s\S]{0,500}oldestProcessingAt/,
  'Shared and broadcast content-state snapshots must validate every source-health field.',
);
assert.doesNotMatch(
  learnPage,
  /courseSourceHealthNotice|learn-source-health-warning|资料同步未完成|资料同步异常/,
  'Neither teacher nor student chat headers should display source-sync notices.',
);
assert.match(
  learnPage,
  /if \(!activeCourse \|\| !activeCourseCanLoadResources \|\| !sourceUploadPanelOpen\) return;[\s\S]{0,900}listCourseSourceUploads\(courseId/,
  'The source list must remain panel-gated even though aggregate health is always monitored.',
);
assert.doesNotMatch(
  courseDetailRoute,
  /course\.findUnique\([\s\S]{0,400}hasCourseEnrollment/,
  'The course shell must not use separate course and access queries.',
);
assert.match(
  courseDetailRoute,
  /CASE[\s\S]*course\."ownerId"[\s\S]*"CourseEnrollment"[\s\S]*"CoursePurchase"[\s\S]*END AS "accessRole"/,
  'The course shell must resolve course details and access in one SQL statement.',
);
assert.match(
  courseDetailRoute,
  /__synatraCourseDetailFlights__/,
  'The course shell route must keep its in-flight map on the server global.',
);
assert.match(
  courseDetailRoute,
  /readCourseDetailSingleFlight[\s\S]{0,300}existing = flights\.get\(key\)[\s\S]{0,120}if \(existing\) return existing/,
  'Concurrent course-shell reads for the same user/course must share one in-flight query.',
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      checked: [
        'tab-local deferred queue',
        'user/course-scoped exclusive Web Lock',
        'fresh shared-snapshot reuse',
        'BroadcastChannel and storage-event fan-out',
        'deadline-preserving focus checks',
        'single SQL access and revision snapshot',
        'server user/course single-flight',
        'stale-flight recovery',
        'retryable content-state timeout',
        'legacy notebook-scoped problem revisions',
        'single-scan source synchronization health',
        'independent source-health revision',
        'source-body-free health polling',
        'validated cross-tab source health',
        'quiet healthy state and lazy abnormal warning',
        'single SQL course shell and access snapshot',
        'server course-shell single-flight',
        'legacy enrollment schema fallback',
      ],
      files: [learnPagePath, contentStateRoutePath, courseDetailRoutePath],
    },
    null,
    2,
  )}\n`,
);
