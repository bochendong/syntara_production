#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

const routePath = 'app/api/courses/[id]/source-ingest/route.ts';
const ingestionPath = 'features/memory/server/source-upload-ingestion.ts';
const pilotPath = 'scripts/maintenance/pilot-source-ingest-via-api.mjs';
const route = read(routePath);
const ingestion = read(ingestionPath);
const pilot = read(pilotPath);

requireMatch(
  route,
  /ingestIntent:\s*z\.enum\(\['standard',\s*'maintenance_pilot_reuse_only'\]\)/,
  'source-ingest must expose the explicit maintenance pilot intent',
);
requireMatch(
  route,
  /expectedReusableProblemCount:\s*z\.number\(\)\.int\(\)\.min\(1\)/,
  'source-ingest must validate the expected reusable problem count',
);
requireMatch(
  route,
  /prepareCourseSourceProblemReuseOnlyPlan\(\{[\s\S]*?userId:\s*auth\.userId[\s\S]*?expectedProblemCount:\s*payload\.expectedReusableProblemCount/,
  'source-ingest must run the owner-scoped provenance preflight',
);
const preflightIndex = route.indexOf(
  'problemReuseOnlyPlan = await prepareCourseSourceProblemReuseOnlyPlan',
);
const sourceReservationIndex = route.indexOf('const processing = await markCourseSourceProcessing');
const deferredFileUploadIndex = route.indexOf(
  'payload.openaiFileId = await tryUploadOpenAIUserFile',
);
if (
  preflightIndex < 0 ||
  deferredFileUploadIndex < 0 ||
  sourceReservationIndex < 0 ||
  preflightIndex >= deferredFileUploadIndex ||
  deferredFileUploadIndex >= sourceReservationIndex
) {
  throw new Error(
    'reuse-only provenance preflight must complete before remote file upload and source reservation',
  );
}
requireMatch(
  route,
  /SOURCE_PROBLEM_REUSE_CONTRACT_FAILED[\s\S]*?problemReuseOnlyContract:\s*problemReuseOnlyPlan\.contract/,
  'preflight rejection must return the failed contract without ingesting',
);
requireMatch(
  route,
  /ingestCourseSourceUpload\(\{[\s\S]*?problemReuseOnlyPlan,[\s\S]*?\}\);/,
  'the server-created reuse-only plan must be passed into ingestion',
);
requireMatch(
  route,
  /const deferOpenAIFileUpload\s*=\s*ingestControls\.ingestIntent ===\s*'maintenance_pilot_reuse_only'[\s\S]*?deferredOpenAIFileUpload/,
  'strict pilot must defer its OpenAI file upload until provenance validation succeeds',
);

requireMatch(
  ingestion,
  /path:\s*\['detachedSourceDigest'\],[\s\S]*?equals:\s*sourceHash/,
  'reuse-only matching must use detached source provenance',
);
requireMatch(
  ingestion,
  /if \(!problemReuseOnlyPlan\) \{\s*await ensureLegacyProblemsBackfilledForCourse/,
  'reuse-only mode must skip legacy problem backfill writes',
);
requireMatch(
  ingestion,
  /const problemExtraction = problemReuseOnlyPlan\s*\?\s*\{\s*drafts:\s*\[\]\s+as NotebookProblemImportDraft\[\],\s*usage:\s*null\s*\}/,
  'reuse-only mode must skip problem LLM extraction',
);
requireMatch(
  ingestion,
  /uniqueDrafts:\s*\[\]\s+as NotebookProblemImportDraft\[\][\s\S]*?matchedBy:\s*'detached_source_digest'/,
  'reuse-only mode must produce only duplicate/reuse matches and no insert drafts',
);
requireMatch(
  ingestion,
  /reuseOnlyContract:\s*problemReuseOnlyPlan\?\.contract\s*\?\?\s*null/,
  'successful ingestion must return the reuse-only proof',
);

requireMatch(
  pilot,
  /MAT102_INDUCTION_I_SOURCE_SHA256\s*=\s*[\s\S]*?'289ed839e6352a25784065c48d9b9cbb68202e50e5d14f82826ffb9323379206'/,
  'pilot must pin the approved MAT102 source hash',
);
requireMatch(
  pilot,
  /MAT102_INDUCTION_I_PROBLEM_IDS\s*=\s*\[[\s\S]*?'cmrytbvfu00017z87ekllttzq'[\s\S]*?'cmrytbxuu00097z870kfiz3js'[\s\S]*?\]\.sort\(\)/,
  'pilot must pin the five approved existing problem IDs',
);
requireMatch(
  pilot,
  /form\.append\('ingestIntent',\s*'maintenance_pilot_reuse_only'\)/,
  'pilot must explicitly request reuse-only ingestion',
);
requireMatch(
  pilot,
  /form\.append\('expectedReusableProblemCount',\s*String\(options\.expectedProblemCount\)\)/,
  'pilot must send its expected reusable count before upload',
);
requireMatch(
  pilot,
  /form\.append\('requireNotebookCover',\s*'true'\)/,
  'pilot must require cover generation to succeed before reporting success',
);
requireMatch(
  pilot,
  /reuseOnlyContract\?\.expectedProblemCount\s*!==\s*options\.expectedProblemCount[\s\S]*?reuseOnlyContract\?\.reusedProblemCount\s*!==\s*options\.expectedProblemCount[\s\S]*?reuseOnlyContract\?\.duplicateSkipCount\s*!==\s*options\.expectedProblemCount[\s\S]*?reuseOnlyContract\?\.insertedProblemCount\s*!==\s*0/,
  'pilot success must prove expected/reused/duplicate-skip/inserted counts',
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      contracts: [
        'owner-scoped detached provenance preflight',
        'preflight before source/notebook/problem persistence',
        'problem LLM extraction skipped',
        'expected equals reused equals duplicate skip',
        'inserted equals zero',
        'MAT102 source hash pinned',
      ],
    },
    null,
    2,
  )}\n`,
);
