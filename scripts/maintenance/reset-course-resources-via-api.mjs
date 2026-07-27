#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_MS = 10_000;
const MAX_RETRY_DELAY_MS = 60_000;
const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

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
    execute: false,
    courseIds: [],
    confirmNotebooks: null,
    confirmSources: null,
    confirmProblems: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    retryBaseMs: DEFAULT_RETRY_BASE_MS,
    outDir: path.resolve(
      process.cwd(),
      'tmp',
      `course-resource-reset-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    ),
  };

  for (const arg of argv) {
    if (arg === '--execute') {
      options.execute = true;
    } else if (arg.startsWith('--base-url=')) {
      options.baseUrl = arg.slice('--base-url='.length).replace(/\/+$/, '');
    } else if (arg.startsWith('--user-id=')) {
      options.userId = arg.slice('--user-id='.length).trim();
    } else if (arg.startsWith('--user-email=')) {
      options.userEmail = arg.slice('--user-email='.length).trim();
    } else if (arg.startsWith('--course-id=')) {
      const courseId = arg.slice('--course-id='.length).trim();
      if (courseId) options.courseIds.push(courseId);
    } else if (arg.startsWith('--confirm-notebooks=')) {
      options.confirmNotebooks = Number(arg.slice('--confirm-notebooks='.length));
    } else if (arg.startsWith('--confirm-sources=')) {
      options.confirmSources = Number(arg.slice('--confirm-sources='.length));
    } else if (arg.startsWith('--confirm-problems=')) {
      options.confirmProblems = Number(arg.slice('--confirm-problems='.length));
    } else if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    } else if (arg.startsWith('--max-attempts=')) {
      options.maxAttempts = Number(arg.slice('--max-attempts='.length));
    } else if (arg.startsWith('--retry-base-ms=')) {
      options.retryBaseMs = Number(arg.slice('--retry-base-ms='.length));
    } else if (arg.startsWith('--out-dir=')) {
      options.outDir = path.resolve(arg.slice('--out-dir='.length));
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`Usage:
  pnpm exec dotenv -e .env.local -- node scripts/maintenance/reset-course-resources-via-api.mjs
  pnpm exec dotenv -e .env.local -- node scripts/maintenance/reset-course-resources-via-api.mjs --execute

Options:
  --execute               Perform deletion. Without it, the script is read-only.
  --course-id=ID          Limit to one or more courses (repeatable; avoids the full course-list API).
  --confirm-notebooks=N   Required with --execute; must match the live preflight total.
  --confirm-sources=N     Required with --execute; must match the live preflight total.
  --confirm-problems=N    Required with --execute; exact problem total that must be preserved.
  --base-url=URL          API origin (default: ${DEFAULT_BASE_URL}).
  --user-id=ID            x-user-id fallback identity.
  --user-email=EMAIL      x-user-email fallback identity.
  --timeout-ms=MS         Per-request timeout.
  --max-attempts=N        Attempts for transient failures (default: ${DEFAULT_MAX_ATTEMPTS}).
  --retry-base-ms=MS      Exponential retry base delay (default: ${DEFAULT_RETRY_BASE_MS}).
  --out-dir=PATH          Audit manifest directory.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.userId) {
    throw new Error('SYNTARA_PUBLIC_API_USER_ID or --user-id is required.');
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000) {
    throw new Error('--timeout-ms must be at least 1000.');
  }
  if (
    !Number.isInteger(options.maxAttempts) ||
    options.maxAttempts < 1 ||
    options.maxAttempts > 10
  ) {
    throw new Error('--max-attempts must be an integer between 1 and 10.');
  }
  if (!Number.isFinite(options.retryBaseMs) || options.retryBaseMs < 100) {
    throw new Error('--retry-base-ms must be at least 100.');
  }
  if (new Set(options.courseIds).size !== options.courseIds.length) {
    throw new Error('--course-id values must be unique.');
  }
  for (const [flag, value] of [
    ['--confirm-notebooks', options.confirmNotebooks],
    ['--confirm-sources', options.confirmSources],
    ['--confirm-problems', options.confirmProblems],
  ]) {
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`${flag} must be a non-negative integer.`);
    }
  }
  if (
    options.execute &&
    (options.confirmNotebooks === null ||
      options.confirmSources === null ||
      options.confirmProblems === null)
  ) {
    throw new Error(
      '--execute requires --confirm-notebooks, --confirm-sources, and --confirm-problems.',
    );
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

class ApiRequestError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = details.status ?? null;
    this.body = details.body ?? null;
    this.attempt = details.attempt ?? 1;
    this.hadTransientFailure = details.hadTransientFailure === true;
    if (details.cause) this.cause = details.cause;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response) {
  const value = response.headers.get('retry-after')?.trim();
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
}

function retryDelayMs(attempt, serverDelayMs = 0) {
  const exponential = options.retryBaseMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(exponential, serverDelayMs));
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.cause?.name === 'AbortError';
}

function isNetworkFetchError(error) {
  const code = error?.code || error?.cause?.code;
  return (
    (typeof code === 'string' && TRANSIENT_NETWORK_CODES.has(code)) ||
    (error instanceof TypeError && /fetch failed/i.test(error.message))
  );
}

function isTransientError(error) {
  const errorCode = error instanceof ApiRequestError ? error.body?.code : null;
  if (errorCode === 'PROBLEM_PRESERVATION_INVARIANT_FAILED') return false;
  return (
    isAbortError(error) ||
    isNetworkFetchError(error) ||
    (error instanceof ApiRequestError &&
      error.status !== null &&
      TRANSIENT_HTTP_STATUSES.has(error.status))
  );
}

function errorLabel(error) {
  if (isAbortError(error)) return `timeout after ${options.timeoutMs}ms`;
  if (isNetworkFetchError(error)) {
    return String(error?.code || error?.cause?.code || error?.message || 'network failure');
  }
  if (error instanceof ApiRequestError && error.status !== null) {
    return `HTTP ${error.status}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function api(pathname, init = {}) {
  const method = init.method || 'GET';
  let hadTransientFailure = false;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    const startedAt = Date.now();
    process.stdout.write(
      `[api ${attempt}/${options.maxAttempts}] ${method} ${pathname} started (timeout ${options.timeoutMs}ms)\n`,
    );
    try {
      const response = await fetch(`${options.baseUrl}${pathname}`, {
        method,
        headers: {
          accept: 'application/json',
          'x-user-id': options.userId,
          ...(options.userEmail ? { 'x-user-email': options.userEmail } : {}),
          ...(init.headers || {}),
        },
        signal: controller.signal,
      });
      const text = await response.text();
      let body;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { raw: text };
      }
      if (!response.ok) {
        const error = new ApiRequestError(
          `${method} ${pathname} -> ${response.status}: ${text.slice(0, 1_000)}`,
          {
            status: response.status,
            body,
            attempt,
            hadTransientFailure,
          },
        );
        error.serverRetryAfterMs = retryAfterMs(response);
        throw error;
      }
      process.stdout.write(
        `[api ${attempt}/${options.maxAttempts}] ${method} ${pathname} -> ${response.status} in ${Date.now() - startedAt}ms\n`,
      );
      return body;
    } catch (error) {
      const transient = isTransientError(error);
      if (transient && attempt < options.maxAttempts) {
        hadTransientFailure = true;
        const delayMs = retryDelayMs(attempt, error?.serverRetryAfterMs);
        process.stdout.write(
          `[retry ${attempt}/${options.maxAttempts - 1}] ${method} ${pathname}: ${errorLabel(error)}; retrying in ${delayMs}ms\n`,
        );
        await sleep(delayMs);
        continue;
      }
      const finalError =
        error instanceof ApiRequestError
          ? error
          : new ApiRequestError(`${method} ${pathname} failed: ${errorLabel(error)}`, {
              attempt,
              hadTransientFailure,
              cause: error,
            });
      finalError.hadTransientFailure = hadTransientFailure;
      process.stdout.write(
        `[api failed] ${method} ${pathname}: ${errorLabel(finalError)} after ${attempt} attempt(s)\n`,
      );
      throw finalError;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Unreachable request state for ${method} ${pathname}`);
}

function requireArray(payload, key, requestLabel) {
  if (!Array.isArray(payload?.[key])) {
    throw new Error(`${requestLabel} returned no ${key} array; refusing to infer empty state.`);
  }
  return payload[key];
}

function normalizedExactIds(values, label) {
  if (!Array.isArray(values)) {
    throw new Error(`${label} is not an array.`);
  }
  const ids = values.map((value) =>
    String(value && typeof value === 'object' ? value.id || '' : value || '').trim(),
  );
  if (ids.some((id) => !id)) {
    throw new Error(`${label} contains an item without an ID.`);
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} contains duplicate IDs.`);
  }
  return ids.sort();
}

function sameIds(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

async function writeAuditJson(fileName, value) {
  const target = path.join(options.outDir, fileName);
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, target);
}

async function readOwnedCourse(courseId) {
  const state = await api(`/api/courses/${encodeURIComponent(courseId)}/content-state`);
  if (!state || typeof state !== 'object' || state.courseId !== courseId) {
    throw new Error(`Course content-state API returned no matching course for ${courseId}.`);
  }
  if (state.accessRole !== 'owner') {
    throw new Error(`Course ${courseId} is not owned by this user; refusing to continue.`);
  }
  return {
    id: courseId,
    name: courseId,
    courseCode: null,
    accessRole: state.accessRole,
  };
}

async function readSelectedOwnedCourses() {
  if (options.courseIds.length > 0) {
    const courses = [];
    // Keep explicit detail reads sequential so maintenance does not compete
    // with the visible course page for a deliberately small remote DB pool.
    for (const courseId of options.courseIds) {
      courses.push(await readOwnedCourse(courseId));
    }
    return courses;
  }
  const courseData = await api('/api/courses');
  return requireArray(courseData, 'courses', 'Course list API').filter(
    (course) => course.accessRole === 'owner',
  );
}

async function readCourseState(course, { includeArtifacts = true } = {}) {
  // Keep these reads sequential: the local development server intentionally
  // uses a small remote DB pool, and three simultaneous list requests can
  // otherwise starve one another before retries have a chance to help.
  const notebookData = await api(`/api/notebooks?courseId=${encodeURIComponent(course.id)}`);
  const problemData = await api(`/api/courses/${encodeURIComponent(course.id)}/problems?summary=1`);
  const sourceData = await api(
    `/api/courses/${encodeURIComponent(course.id)}/source-uploads?includeText=0&includeArtifacts=${includeArtifacts ? '1' : '0'}&deferKnowledgeSync=1`,
  );
  const notebooks = requireArray(notebookData, 'notebooks', 'Notebook list API');
  const problems = requireArray(problemData, 'problems', 'Problem list API');
  const sources = requireArray(sourceData, 'uploads', 'Source list API');
  if (sourceData?.knowledgeSyncDeferred !== true) {
    throw new Error(
      `Source list API did not confirm its side-effect-free maintenance read for ${course.id}.`,
    );
  }
  return {
    course: {
      id: course.id,
      name: course.name,
      courseCode: course.courseCode || null,
      accessRole: course.accessRole,
    },
    notebooks: notebooks.map((notebook) => ({
      id: notebook.id,
      name: notebook.name,
      notebookKind: notebook.notebookKind,
      sectionCount: notebook.sectionCount,
      sceneCount: notebook.sceneCount,
      problemCount: notebook.problemCount,
    })),
    problemIds: normalizedExactIds(problems, `Problem list for ${course.id}`),
    sources: sources.map((source) => ({
      sourceHash: source.sourceHash,
      title: source.title,
      ingestStatus: source.ingestStatus,
      indexStatus: source.indexStatus,
      notebookIds: source.notebookIds,
      problemIds: source.problemIds,
    })),
  };
}

async function readCourseProblemBackup(baseline) {
  const payload = await api(`/api/courses/${encodeURIComponent(baseline.course.id)}/problems`);
  const problems = requireArray(payload, 'problems', 'Full problem backup API');
  const backupIds = normalizedExactIds(problems, `Full problem backup for ${baseline.course.id}`);
  if (!sameIds(baseline.problemIds, backupIds)) {
    throw new Error(
      `Full problem backup does not match the preflight ID set for ${baseline.course.id}; refusing deletion.`,
    );
  }
  return {
    course: baseline.course,
    problemIds: backupIds,
    problems,
  };
}

async function resetCourseResources(baseline) {
  const courseId = baseline.course.id;
  const sourceReset = await api(
    `/api/courses/${encodeURIComponent(courseId)}/source-uploads?preserveProblems=1&deferKnowledgeSync=1`,
    { method: 'DELETE' },
  );
  const sourceInvariant = sourceReset?.invariant;
  if (
    sourceReset?.ok !== true ||
    sourceReset?.preserveProblems !== true ||
    sourceReset?.knowledgeSyncDeferred !== true ||
    sourceInvariant?.problemsUnchanged !== true
  ) {
    throw new Error(
      `Source cleanup did not preserve problems and defer per-item knowledge sync for ${courseId}.`,
    );
  }
  const sourceResults = requireArray(sourceReset, 'results', 'Bulk source-delete API');
  if (
    Number(sourceReset.deletedSourceCount) !== sourceResults.length ||
    sourceResults.length > baseline.sources.length
  ) {
    throw new Error(
      `Bulk source-delete count mismatch for ${courseId}: baseline=${baseline.sources.length}, response=${String(sourceReset.deletedSourceCount)}, results=${sourceResults.length}`,
    );
  }
  const sourceDeleteResponseReconciled = sourceResults.length < baseline.sources.length;
  if (sourceDeleteResponseReconciled) {
    process.stdout.write(
      `[source delete reconciled] ${courseId}: response reported ${sourceResults.length}/${baseline.sources.length} sources after a retry; final artifact and problem postconditions remain mandatory\n`,
    );
  }
  const cleanupErrors = sourceResults.flatMap((result) =>
    Array.isArray(result?.cleanupErrors)
      ? result.cleanupErrors
          .map((message) => String(message || '').trim())
          .filter(Boolean)
          .map((message) => ({
            sourceHash: String(result?.source?.sourceHash || ''),
            message,
          }))
      : [],
  );
  const sourceBeforeProblemIds = normalizedExactIds(
    sourceInvariant.beforeProblemIds,
    `Source-delete beforeProblemIds for ${courseId}`,
  );
  const sourceAfterProblemIds = normalizedExactIds(
    sourceInvariant.afterProblemIds,
    `Source-delete afterProblemIds for ${courseId}`,
  );
  if (
    !sameIds(baseline.problemIds, sourceBeforeProblemIds) ||
    !sameIds(baseline.problemIds, sourceAfterProblemIds)
  ) {
    throw new Error(
      `Source cleanup returned a different exact problem-ID set for ${courseId}: baseline=${baseline.problemIds.length}, API before=${sourceBeforeProblemIds.length}, API after=${sourceAfterProblemIds.length}`,
    );
  }
  process.stdout.write(
    `[source delete verified] ${courseId}: API preserved all ${baseline.problemIds.length} exact problem IDs\n`,
  );

  const notebookData = await api(`/api/notebooks?courseId=${encodeURIComponent(courseId)}`);
  const notebooks = requireArray(notebookData, 'notebooks', 'Notebook list API');
  const notebookResults = [];
  for (const notebook of notebooks) {
    let result = null;
    let alreadyAbsent = false;
    try {
      result = await api(`/api/notebooks/${encodeURIComponent(notebook.id)}?deferKnowledgeSync=1`, {
        method: 'DELETE',
      });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        // A prior timed-out/transient attempt may have committed the delete.
        // Treat absence as an idempotent outcome only because the full
        // notebook/source and exact problem-ID postconditions are checked below.
        alreadyAbsent = true;
        process.stdout.write(
          `[delete reconciled] notebook ${notebook.id} is already absent; final course verification is still required\n`,
        );
      } else {
        throw error;
      }
    }
    if (!alreadyAbsent && (result?.ok !== true || result?.knowledgeSyncDeferred !== true)) {
      throw new Error(
        `Notebook delete did not return ok=true with deferred knowledge sync: ${notebook.id}`,
      );
    }
    notebookResults.push({ id: notebook.id, ok: true, alreadyAbsent });
  }

  // includeArtifacts=1 catches legacy or orphaned sections, memories, imports,
  // facts, and cache rows instead of trusting the first-class catalog alone.
  const after = await readCourseState(baseline.course, { includeArtifacts: true });
  if (!sameIds(baseline.problemIds, after.problemIds)) {
    const beforeOnly = baseline.problemIds.filter((id) => !after.problemIds.includes(id));
    const afterOnly = after.problemIds.filter((id) => !baseline.problemIds.includes(id));
    throw new Error(
      `Problem invariant failed for ${courseId}: before=${baseline.problemIds.length}, after=${after.problemIds.length}, missing=${beforeOnly.slice(0, 20).join(',') || 'none'}, unexpected=${afterOnly.slice(0, 20).join(',') || 'none'}`,
    );
  }
  if (after.notebooks.length !== 0 || after.sources.length !== 0) {
    throw new Error(
      `Resource reset incomplete for ${courseId}: notebooks=${after.notebooks.length}, sources=${after.sources.length}`,
    );
  }
  const knowledgeProjection = await api(
    `/api/courses/${encodeURIComponent(courseId)}/knowledge-projection`,
    { method: 'POST' },
  );
  if (
    knowledgeProjection?.ok !== true ||
    knowledgeProjection?.courseId !== courseId ||
    knowledgeProjection?.knowledgeSyncCompleted !== true ||
    knowledgeProjection?.result?.available !== true ||
    knowledgeProjection?.result?.synced !== true
  ) {
    throw new Error(`Final course knowledge sync did not complete for ${courseId}.`);
  }
  return {
    sourceReset,
    notebookResults,
    knowledgeProjection,
    after,
    problemsUnchanged: true,
    cleanupErrors,
    sourceDeleteResponseReconciled,
  };
}

await fs.mkdir(options.outDir, { recursive: true });
const selectedCourses = await readSelectedOwnedCourses();
if (selectedCourses.length === 0) {
  throw new Error('No owned courses were selected; refusing to produce an empty reset run.');
}

const baselines = [];
for (const course of selectedCourses) {
  process.stdout.write(`[preflight] ${course.courseCode || course.name}\n`);
  baselines.push(await readCourseState(course));
  const baseline = baselines.at(-1);
  process.stdout.write(
    `[preflight complete] ${course.courseCode || course.name}: ${baseline.notebooks.length} notebooks, ${baseline.sources.length} sources, ${baseline.problemIds.length} exact problem IDs recorded\n`,
  );
  await writeAuditJson('before.partial.json', {
    mode: options.execute ? 'execute-preflight' : 'dry-run-preflight',
    generatedAt: new Date().toISOString(),
    selectedCourseIds: selectedCourses.map((item) => item.id),
    completedCourseIds: baselines.map((item) => item.course.id),
    courses: baselines,
  });
}
await writeAuditJson('before.json', {
  generatedAt: new Date().toISOString(),
  courses: baselines,
});

if (!options.execute) {
  const summary = baselines.map((baseline) => ({
    courseId: baseline.course.id,
    courseCode: baseline.course.courseCode,
    notebooks: baseline.notebooks.length,
    sources: baseline.sources.length,
    problemsPreserved: baseline.problemIds.length,
  }));
  await writeAuditJson('dry-run.json', { mode: 'dry-run', summary });
  process.stdout.write(
    `${JSON.stringify({ mode: 'dry-run', outDir: options.outDir, summary }, null, 2)}\n`,
  );
  process.exit(0);
}

const liveTotals = baselines.reduce(
  (totals, baseline) => ({
    notebooks: totals.notebooks + baseline.notebooks.length,
    sources: totals.sources + baseline.sources.length,
    problems: totals.problems + baseline.problemIds.length,
  }),
  { notebooks: 0, sources: 0, problems: 0 },
);
const confirmedTotals = {
  notebooks: options.confirmNotebooks,
  sources: options.confirmSources,
  problems: options.confirmProblems,
};
if (
  confirmedTotals.notebooks !== liveTotals.notebooks ||
  confirmedTotals.sources !== liveTotals.sources ||
  confirmedTotals.problems !== liveTotals.problems
) {
  await writeAuditJson('confirmation-mismatch.json', {
    mode: 'execute-refused',
    refusedAt: new Date().toISOString(),
    liveTotals,
    confirmedTotals,
  });
  throw new Error(
    `Destructive confirmation does not match the live API preflight. ` +
      `Pass --confirm-notebooks=${liveTotals.notebooks} --confirm-sources=${liveTotals.sources} ` +
      `--confirm-problems=${liveTotals.problems} after explicitly confirming that exact scope.`,
  );
}

const problemBackups = [];
for (const baseline of baselines) {
  process.stdout.write(
    `[backup] ${baseline.course.courseCode || baseline.course.name}: reading full problem records through API before deletion\n`,
  );
  problemBackups.push(await readCourseProblemBackup(baseline));
  await writeAuditJson('problem-backup.partial.json', {
    mode: 'execute-backup-in-progress',
    generatedAt: new Date().toISOString(),
    completedCourseIds: problemBackups.map((backup) => backup.course.id),
    courses: problemBackups,
  });
}
await writeAuditJson('problem-backup.json', {
  mode: 'pre-delete-problem-backup',
  generatedAt: new Date().toISOString(),
  courses: problemBackups,
});

const results = [];
for (const baseline of baselines) {
  process.stdout.write(
    `[delete] ${baseline.course.courseCode || baseline.course.name}: ${baseline.notebooks.length} notebooks, ${baseline.sources.length} sources; preserving ${baseline.problemIds.length} problems\n`,
  );
  let result;
  try {
    result = await resetCourseResources(baseline);
    results.push({
      courseId: baseline.course.id,
      result,
    });
    await writeAuditJson('after.partial.json', {
      mode: 'execute-in-progress',
      updatedAt: new Date().toISOString(),
      completedCourseIds: results.map((item) => item.courseId),
      pendingCourseIds: baselines
        .map((item) => item.course.id)
        .filter((courseId) => !results.some((item) => item.courseId === courseId)),
      courses: results,
    });
  } catch (error) {
    await writeAuditJson('failure.json', {
      mode: 'execute-failed',
      failedAt: new Date().toISOString(),
      failedCourseId: baseline.course.id,
      error: error instanceof Error ? error.message : String(error),
      completedCourseIds: results.map((item) => item.courseId),
      courses: results,
    });
    throw error;
  }
  process.stdout.write(
    `[verified] ${baseline.course.courseCode || baseline.course.name}: resources empty; all ${result.after.problemIds.length} problem IDs unchanged\n`,
  );
  if (result.cleanupErrors.length > 0) {
    await writeAuditJson('failure.json', {
      mode: 'execute-failed',
      failedAt: new Date().toISOString(),
      failedCourseId: baseline.course.id,
      error: 'Local resources were removed, but external source cleanup reported errors.',
      cleanupErrors: result.cleanupErrors,
      completedCourseIds: results.map((item) => item.courseId),
      courses: results,
    });
    throw new Error(
      `External cleanup failed for ${baseline.course.id}: ${result.cleanupErrors
        .map((item) => `${item.sourceHash || 'unknown-source'}: ${item.message}`)
        .join(' | ')}`,
    );
  }
}

const report = {
  mode: 'execute',
  completedAt: new Date().toISOString(),
  outDir: options.outDir,
  courses: results.map(({ courseId, result }) => ({
    courseId,
    deletedSources: result.sourceReset?.results?.length || 0,
    deletedNotebooksViaSources: result.sourceReset.results.reduce(
      (sum, sourceResult) => sum + Number(sourceResult?.deleted?.notebooks || 0),
      0,
    ),
    deletedNotebooksExplicitly: result.notebookResults.length,
    deletedNotebooksTotal:
      baselines.find((baseline) => baseline.course.id === courseId)?.notebooks.length || 0,
    remainingProblems: result.after.problemIds.length,
    remainingProblemIds: result.after.problemIds,
    problemsUnchanged: result.problemsUnchanged,
    sourceDeleteResponseReconciled: result.sourceDeleteResponseReconciled,
  })),
};
await writeAuditJson('after.json', report);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
