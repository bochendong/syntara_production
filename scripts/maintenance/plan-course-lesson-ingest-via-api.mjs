#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.OPENMAIC_API_BASE_URL || DEFAULT_BASE_URL,
    userId: process.env.SYNTARA_PUBLIC_API_USER_ID || '',
    userEmail:
      process.env.SYNTARA_PUBLIC_API_USER_EMAIL ||
      String(process.env.ADMIN_EMAILS || '')
        .split(',')
        .map((value) => value.trim())
        .find(Boolean) ||
      '',
    courseId: '',
    sourcePath: '',
    sourceTitle: '',
    outPath: '',
    timeoutMs: 30_000,
  };

  for (const arg of argv) {
    if (arg.startsWith('--base-url=')) {
      options.baseUrl = arg.slice('--base-url='.length).replace(/\/+$/, '');
    } else if (arg.startsWith('--user-id=')) {
      options.userId = arg.slice('--user-id='.length).trim();
    } else if (arg.startsWith('--user-email=')) {
      options.userEmail = arg.slice('--user-email='.length).trim();
    } else if (arg.startsWith('--course-id=')) {
      options.courseId = arg.slice('--course-id='.length).trim();
    } else if (arg.startsWith('--source=')) {
      options.sourcePath = path.resolve(arg.slice('--source='.length));
    } else if (arg.startsWith('--source-title=')) {
      options.sourceTitle = arg.slice('--source-title='.length).trim();
    } else if (arg.startsWith('--out=')) {
      options.outPath = path.resolve(arg.slice('--out='.length));
    } else if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`Usage:
  pnpm exec dotenv -e .env.local -- node scripts/maintenance/plan-course-lesson-ingest-via-api.mjs \\
    --course-id=... --source=queue/MAT102/10InductionI-1.pdf \\
    --source-title="MAT102 Induction I" --out=tmp/lesson-plan.json

This command is always read-only with respect to the application. It plans
exactly one lesson, computes its SHA256, and reads course/source/notebook/problem
state only through HTTP APIs. It has no execute or upload mode.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.userId) {
    throw new Error('SYNTARA_PUBLIC_API_USER_ID or --user-id is required.');
  }
  if (!options.courseId) throw new Error('--course-id is required.');
  if (!options.sourcePath) throw new Error('--source is required.');
  if (!options.sourceTitle) throw new Error('--source-title is required.');
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000) {
    throw new Error('--timeout-ms must be at least 1000.');
  }
  if (!options.outPath) {
    const suffix = new Date().toISOString().replace(/[:.]/g, '-');
    options.outPath = path.resolve('tmp', `course-lesson-ingest-plan-${suffix}.json`);
  }
  return options;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function exactIdDigest(ids) {
  return sha256([...ids].sort().join('\n'));
}

function requireArray(payload, key, label) {
  if (!Array.isArray(payload?.[key])) {
    throw new Error(`${label} returned no ${key} array.`);
  }
  return payload[key];
}

function exactIds(items, label) {
  const ids = items.map((item) => String(item?.id || '').trim());
  if (ids.some((id) => !id)) throw new Error(`${label} returned an item without an ID.`);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} returned duplicate IDs.`);
  return ids.sort();
}

function sourceKindForPath(sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.pdf') return 'pdf';
  if (extension === '.md' || extension === '.markdown') return 'markdown';
  if (extension === '.txt') return 'plain_text';
  if (extension === '.pptx') return 'pptx';
  if (extension === '.docx') return 'docx';
  return 'other';
}

async function requestJson(options, pathname) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(`${options.baseUrl}${pathname}`, {
      headers: {
        accept: 'application/json',
        'x-user-id': options.userId,
        ...(options.userEmail ? { 'x-user-email': options.userEmail } : {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      throw new Error(`GET ${pathname} -> ${response.status}: ${text.slice(0, 2_000)}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

const options = parseArgs(process.argv.slice(2));
const sourceBytes = await fs.readFile(options.sourcePath);
const sourceHash = sha256(sourceBytes);
const coursePath = `/api/courses/${encodeURIComponent(options.courseId)}`;

// Sequential requests protect the small local remote-DB pool. This planner is
// intentionally GET-only so it can be run before the user authorizes a lesson.
const course = await requestJson(options, coursePath);
const contentState = await requestJson(options, `${coursePath}/content-state`);
const sourcePayload = await requestJson(
  options,
  `${coursePath}/source-uploads?includeText=0&includeArtifacts=0`,
);
const notebookPayload = await requestJson(
  options,
  `/api/notebooks?courseId=${encodeURIComponent(options.courseId)}`,
);
const problemPayload = await requestJson(options, `${coursePath}/problems?summary=1`);

const sources = requireArray(sourcePayload, 'uploads', 'Source list API');
const notebooks = requireArray(notebookPayload, 'notebooks', 'Notebook list API');
const problems = requireArray(problemPayload, 'problems', 'Problem list API');
const notebookIds = exactIds(notebooks, 'Notebook list API');
const problemIds = exactIds(problems, 'Problem list API');
const sourceHashes = sources
  .map((source) => String(source?.sourceHash || '').trim())
  .filter(Boolean)
  .sort();
const matchingSource = sources.find((source) => source?.sourceHash === sourceHash) || null;
const decision = matchingSource
  ? {
      status: 'already_ingested',
      uploadRequired: false,
      reason: 'The exact raw source SHA256 is already visible through the source API.',
      ingestStatus: matchingSource.ingestStatus ?? null,
      indexStatus: matchingSource.indexStatus ?? null,
      notebookIds: Array.isArray(matchingSource.notebookIds)
        ? matchingSource.notebookIds.map(String).sort()
        : [],
      problemIds: Array.isArray(matchingSource.problemIds)
        ? matchingSource.problemIds.map(String).sort()
        : [],
    }
  : {
      status: 'ready_for_explicit_single_lesson_authorization',
      uploadRequired: true,
      reason: 'No source with the exact raw SHA256 is present.',
      ingestStatus: null,
      indexStatus: null,
      notebookIds: [],
      problemIds: [],
    };

const planWithoutDigest = {
  schemaVersion: 1,
  mode: 'read_only_plan',
  createdAt: new Date().toISOString(),
  lessonCount: 1,
  course: {
    id: options.courseId,
    name: course?.course?.name ?? course?.name ?? null,
    courseCode: course?.course?.courseCode ?? course?.courseCode ?? null,
    accessRole: contentState?.accessRole ?? null,
  },
  lesson: {
    sourcePath: options.sourcePath,
    sourceTitle: options.sourceTitle,
    sourceKind: sourceKindForPath(options.sourcePath),
    byteLength: sourceBytes.byteLength,
    rawSha256: sourceHash,
  },
  baseline: {
    contentRevision: String(contentState?.revision || ''),
    notebookCount: notebookIds.length,
    notebookIdDigest: exactIdDigest(notebookIds),
    problemCount: problemIds.length,
    problemIdDigest: exactIdDigest(problemIds),
    sourceCount: sourceHashes.length,
    sourceHashDigest: exactIdDigest(sourceHashes),
  },
  decision,
  safety: {
    applicationWrites: 0,
    generationCalls: 0,
    maximumLessonsPerFutureRun: 1,
    requiresFreshApiPreflight: true,
    requiresExactPlanDigest: true,
    duplicateSourcePolicy: 'reconcile_same_hash_without_post',
    problemPolicy: 'preserve_existing_ids_and_report_exact_delta',
  },
};
const planDigest = sha256(JSON.stringify(planWithoutDigest));
const plan = { ...planWithoutDigest, planDigest };

await fs.mkdir(path.dirname(options.outPath), { recursive: true });
await fs.writeFile(options.outPath, `${JSON.stringify(plan, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      mode: plan.mode,
      lessonCount: plan.lessonCount,
      courseId: plan.course.id,
      sourceHash: plan.lesson.rawSha256,
      decision: plan.decision.status,
      applicationWrites: plan.safety.applicationWrites,
      generationCalls: plan.safety.generationCalls,
      problemCount: plan.baseline.problemCount,
      planDigest,
      planPath: options.outPath,
    },
    null,
    2,
  )}\n`,
);
