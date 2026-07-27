#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Agent } from 'undici';

const DEFAULT_COURSE_ID = 'cmpd5bird007v8ogmjuuiio03';
const DEFAULT_SOURCE_PATH = 'queue/MAT102/10InductionI-1.pdf';
const MAT102_INDUCTION_I_SOURCE_SHA256 =
  '289ed839e6352a25784065c48d9b9cbb68202e50e5d14f82826ffb9323379206';
const MAT102_INDUCTION_I_PROBLEM_IDS = [
  'cmrytbvfu00017z87ekllttzq',
  'cmrytbwn700037z87e65ufbaf',
  'cmrytbx1n00057z87y6cdl2dj',
  'cmrytbxgc00077z87id9busp3',
  'cmrytbxuu00097z870kfiz3js',
].sort();
const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_MS = 10_000;
const DEFAULT_VERIFY_ATTEMPTS = 6;
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
    execute: false,
    resumeExisting: false,
    baseUrl: process.env.OPENMAIC_API_BASE_URL || DEFAULT_BASE_URL,
    userId: process.env.SYNTARA_PUBLIC_API_USER_ID || '',
    userEmail:
      process.env.SYNTARA_PUBLIC_API_USER_EMAIL ||
      String(process.env.ADMIN_EMAILS || '')
        .split(',')
        .map((value) => value.trim())
        .find(Boolean) ||
      '',
    courseId: DEFAULT_COURSE_ID,
    sourcePath: path.resolve(process.cwd(), DEFAULT_SOURCE_PATH),
    sourceTitle: 'MAT102 Induction I',
    model: 'openai:gpt-5.6-sol',
    timeoutMs: 20 * 60_000,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    retryBaseMs: DEFAULT_RETRY_BASE_MS,
    verifyAttempts: DEFAULT_VERIFY_ATTEMPTS,
    expectedProblemCount: 5,
    outDir: path.resolve(
      process.cwd(),
      'tmp',
      `mat102-induction-pilot-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    ),
  };
  for (const arg of argv) {
    if (arg === '--execute') options.execute = true;
    else if (arg === '--resume-existing') options.resumeExisting = true;
    else if (arg.startsWith('--base-url=')) {
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
    } else if (arg.startsWith('--model=')) {
      options.model = arg.slice('--model='.length).trim();
    } else if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    } else if (arg.startsWith('--max-attempts=')) {
      options.maxAttempts = Number(arg.slice('--max-attempts='.length));
    } else if (arg.startsWith('--retry-base-ms=')) {
      options.retryBaseMs = Number(arg.slice('--retry-base-ms='.length));
    } else if (arg.startsWith('--verify-attempts=')) {
      options.verifyAttempts = Number(arg.slice('--verify-attempts='.length));
    } else if (arg.startsWith('--expected-problem-count=')) {
      options.expectedProblemCount = Number(arg.slice('--expected-problem-count='.length));
    } else if (arg.startsWith('--out-dir=')) {
      options.outDir = path.resolve(arg.slice('--out-dir='.length));
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`Usage:
  pnpm exec dotenv -e .env.local -- node scripts/maintenance/pilot-source-ingest-via-api.mjs
  pnpm exec dotenv -e .env.local -- node scripts/maintenance/pilot-source-ingest-via-api.mjs --execute

Without --execute, this script only reads API state and computes the source hash.
The execute path uploads exactly one MAT102 lesson through source-ingest, then
verifies that existing problem IDs are unchanged and a notebook is visible.

Retry options:
  --resume-existing       Never upload; verify the exact already-created pilot source.
  --timeout-ms=MS         Per-request timeout.
  --max-attempts=N        Attempts for transient failures (default: ${DEFAULT_MAX_ATTEMPTS}).
  --retry-base-ms=MS      Exponential retry base delay (default: ${DEFAULT_RETRY_BASE_MS}).
  --verify-attempts=N     Visibility verification polls (default: ${DEFAULT_VERIFY_ATTEMPTS}).
  --expected-problem-count=N
                          Existing lesson questions that must be reused (default: 5).
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
  if (
    !Number.isInteger(options.verifyAttempts) ||
    options.verifyAttempts < 1 ||
    options.verifyAttempts > 20
  ) {
    throw new Error('--verify-attempts must be an integer between 1 and 20.');
  }
  if (!Number.isInteger(options.expectedProblemCount) || options.expectedProblemCount < 0) {
    throw new Error('--expected-problem-count must be a non-negative integer.');
  }
  if (options.resumeExisting && !options.execute) {
    throw new Error('--resume-existing requires --execute so the verification report is explicit.');
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const apiDispatcher = new Agent({
  connectTimeout: Math.min(options.timeoutMs, 30_000),
  headersTimeout: options.timeoutMs,
  bodyTimeout: options.timeoutMs,
});

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
  if (errorCode === 'SOURCE_INGEST_FAILED') return false;
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
        body: init.body,
        signal: controller.signal,
        dispatcher: apiDispatcher,
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
          `${method} ${pathname} -> ${response.status}: ${text.slice(0, 2_000)}`,
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

function problemIds(payload, requestLabel = 'Problem list API') {
  const problems = requireArray(payload, 'problems', requestLabel);
  const ids = problems.map((problem) => String(problem?.id || '').trim());
  if (ids.some((id) => !id)) {
    throw new Error(`${requestLabel} returned a problem without an ID.`);
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${requestLabel} returned duplicate problem IDs.`);
  }
  return ids.sort();
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

function exactIdDigest(ids) {
  return createHash('sha256').update(ids.join('\n')).digest('hex');
}

function compactSourceSummary(source) {
  if (!source) return null;
  return {
    sourceHash: source.sourceHash,
    title: source.title,
    ingestStatus: source.ingestStatus,
    indexStatus: source.indexStatus,
    coverImagePath: source.coverImagePath || null,
    coverStatus: source.coverStatus || null,
    notebookCount: Array.isArray(source.notebookIds) ? source.notebookIds.length : null,
    problemCount: Array.isArray(source.problemIds) ? source.problemIds.length : null,
  };
}

async function readPilotState({ includeProblems, includeArtifacts = false }) {
  // Sequential reads avoid exhausting the deliberately small local remote-DB
  // pool while still letting each request use its own bounded retry budget.
  const sourcesPayload = await api(
    `/api/courses/${encodeURIComponent(
      options.courseId,
    )}/source-uploads?includeText=0&includeArtifacts=${includeArtifacts ? '1' : '0'}`,
  );
  const notebooksPayload = await api(
    `/api/notebooks?courseId=${encodeURIComponent(options.courseId)}`,
  );
  const problemsPayload = includeProblems
    ? await api(`/api/courses/${encodeURIComponent(options.courseId)}/problems?summary=1`)
    : null;
  return {
    sources: requireArray(sourcesPayload, 'uploads', 'Source list API'),
    notebooks: requireArray(notebooksPayload, 'notebooks', 'Notebook list API'),
    problemIds: problemsPayload ? problemIds(problemsPayload) : null,
  };
}

async function waitForPilotVisibility(rawFileHash, responseNotebookId) {
  for (let attempt = 1; attempt <= options.verifyAttempts; attempt += 1) {
    process.stdout.write(
      `[verify ${attempt}/${options.verifyAttempts}] checking source and notebook visibility\n`,
    );
    // Artifact reads also claim a stale/pending source projection for retry,
    // so this verification checks the user-visible search state rather than
    // accepting an ingest row that can remain pending forever.
    const state = await readPilotState({ includeProblems: false, includeArtifacts: true });
    const source = state.sources.find((item) => item.sourceHash === rawFileHash) || null;
    if (source?.ingestStatus === 'error') {
      throw new Error(
        `Pilot source entered error state: ${String(source.errorReason || 'unknown error')}`,
      );
    }
    if (source?.indexStatus === 'error' && attempt === options.verifyAttempts) {
      throw new Error(
        `Pilot source search projection entered error state: ${String(
          source.errorReason || 'unknown error',
        )}`,
      );
    }
    const sourceNotebookIds = Array.isArray(source?.notebookIds) ? source.notebookIds : [];
    const candidateNotebookIds = new Set(
      [responseNotebookId, ...sourceNotebookIds].filter(Boolean),
    );
    const notebook = state.notebooks.find((item) => candidateNotebookIds.has(item.id)) || null;
    if (source?.ingestStatus === 'ready' && source?.indexStatus === 'ready' && notebook) {
      process.stdout.write(
        `[verify complete] source ${rawFileHash.slice(0, 12)} and its search projection are ready; notebook ${notebook.id} is visible\n`,
      );
      return { ...state, source, notebook };
    }
    if (attempt < options.verifyAttempts) {
      const delayMs = retryDelayMs(attempt);
      process.stdout.write(
        `[verify pending] source=${source?.ingestStatus || 'missing'}, index=${source?.indexStatus || 'missing'}, notebook=${notebook ? 'visible' : 'missing'}; checking again in ${delayMs}ms\n`,
      );
      await sleep(delayMs);
    }
  }
  throw new Error(
    `Pilot source, search projection, and notebook did not all become ready after ${options.verifyAttempts} verification attempt(s).`,
  );
}

async function verifyCoverAsset(imagePath) {
  const assetUrl = new URL(imagePath, `${options.baseUrl}/`);
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(assetUrl, {
        headers: {
          accept: 'image/*',
          'x-user-id': options.userId,
          ...(options.userEmail ? { 'x-user-email': options.userEmail } : {}),
        },
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type') || '';
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!response.ok) {
        throw new ApiRequestError(`Cover asset -> HTTP ${response.status}`, {
          status: response.status,
          attempt,
        });
      }
      if (!contentType.toLowerCase().startsWith('image/') || bytes.byteLength < 1_024) {
        throw new Error(
          `Cover asset is not a usable image: content-type=${contentType || 'missing'}, bytes=${bytes.byteLength}`,
        );
      }
      const metadata = await (await import('sharp')).default(Buffer.from(bytes)).metadata();
      if (metadata.width !== 1024 || metadata.height !== 1448) {
        throw new Error(
          `Cover asset dimensions are not the production target: expected 1024x1448, received ${metadata.width || 'unknown'}x${metadata.height || 'unknown'}`,
        );
      }
      return {
        url: assetUrl.toString(),
        contentType,
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        width: metadata.width,
        height: metadata.height,
        format: metadata.format || null,
      };
    } catch (error) {
      if (isTransientError(error) && attempt < options.maxAttempts) {
        const delayMs = retryDelayMs(attempt, error?.serverRetryAfterMs);
        process.stdout.write(
          `[cover retry ${attempt}/${options.maxAttempts - 1}] ${errorLabel(error)}; retrying in ${delayMs}ms\n`,
        );
        await sleep(delayMs);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('Unreachable cover verification state');
}

async function readSourceKnowledgeFact(rawFileHash) {
  const params = new URLSearchParams({
    scopeType: 'course',
    scopeId: options.courseId,
    namespace: 'knowledge_graph',
    key: `source:${rawFileHash}`,
    limit: '4',
  });
  const payload = await api(`/api/memory/facts?${params.toString()}`);
  const facts = requireArray(payload, 'facts', 'Memory facts API');
  return facts.find((fact) => fact?.valueJson?.source?.hash === rawFileHash) || null;
}

const sourceBytes = await fs.readFile(options.sourcePath);
const rawFileHash = createHash('sha256').update(sourceBytes).digest('hex');
if (options.courseId !== DEFAULT_COURSE_ID || rawFileHash !== MAT102_INDUCTION_I_SOURCE_SHA256) {
  throw new Error(
    `This maintenance pilot is locked to MAT102 Induction I (${DEFAULT_COURSE_ID}, ${MAT102_INDUCTION_I_SOURCE_SHA256}); received ${options.courseId}, ${rawFileHash}.`,
  );
}
if (options.expectedProblemCount !== MAT102_INDUCTION_I_PROBLEM_IDS.length) {
  throw new Error(
    `This maintenance pilot requires exactly ${MAT102_INDUCTION_I_PROBLEM_IDS.length} approved existing questions; received ${options.expectedProblemCount}.`,
  );
}
await fs.mkdir(options.outDir, { recursive: true });

process.stdout.write('[preflight] reading exact problem IDs, sources, and notebooks through API\n');
const beforeState = await readPilotState({ includeProblems: true, includeArtifacts: false });
const beforeProblemIds = beforeState.problemIds;
const beforeSources = beforeState.sources;
const beforeNotebooks = beforeState.notebooks;
if (!MAT102_INDUCTION_I_PROBLEM_IDS.every((problemId) => beforeProblemIds.includes(problemId))) {
  throw new Error(
    `The approved MAT102 Induction I questions are not all present before ingestion: ${JSON.stringify(
      {
        expectedProblemIds: MAT102_INDUCTION_I_PROBLEM_IDS,
        missingProblemIds: MAT102_INDUCTION_I_PROBLEM_IDS.filter(
          (problemId) => !beforeProblemIds.includes(problemId),
        ),
      },
    )}`,
  );
}
const preflight = {
  mode: options.execute ? 'execute' : 'dry-run',
  courseId: options.courseId,
  sourcePath: options.sourcePath,
  sourceTitle: options.sourceTitle,
  rawFileHash,
  model: options.model,
  expectedProblemCount: options.expectedProblemCount,
  before: {
    problems: beforeProblemIds.length,
    problemIds: beforeProblemIds,
    sources: beforeSources.length,
    notebooks: beforeNotebooks.length,
    matchingSource: beforeSources.find((source) => source.sourceHash === rawFileHash) || null,
  },
};
await fs.writeFile(
  path.join(options.outDir, 'preflight.json'),
  `${JSON.stringify(preflight, null, 2)}\n`,
);

if (!options.execute) {
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: preflight.mode,
        courseId: preflight.courseId,
        sourcePath: preflight.sourcePath,
        sourceTitle: preflight.sourceTitle,
        rawFileHash: preflight.rawFileHash,
        model: preflight.model,
        expectedProblemCount: preflight.expectedProblemCount,
        before: {
          problems: beforeProblemIds.length,
          problemIdsSha256: exactIdDigest(beforeProblemIds),
          sources: beforeSources.length,
          notebooks: beforeNotebooks.length,
          matchingSource: compactSourceSummary(preflight.before.matchingSource),
        },
        fullAudit: path.join(options.outDir, 'preflight.json'),
        outDir: options.outDir,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}
if (preflight.before.matchingSource && !options.resumeExisting) {
  throw new Error(
    'The lesson source is still present. Run the resource-reset API first; this pilot never overwrites an existing source.',
  );
}
if (
  options.resumeExisting &&
  (beforeSources.length !== 1 ||
    beforeSources[0]?.sourceHash !== rawFileHash ||
    beforeNotebooks.length !== 1)
) {
  throw new Error(
    `The verification-only resume requires exactly the MAT102 pilot source and one notebook: ` +
      `sources=${beforeSources.length}, notebooks=${beforeNotebooks.length}.`,
  );
}
if (!options.resumeExisting && (beforeSources.length !== 0 || beforeNotebooks.length !== 0)) {
  throw new Error(
    `The MAT102 resource reset is incomplete: sources=${beforeSources.length}, notebooks=${beforeNotebooks.length}. ` +
      'This one-lesson pilot requires an empty course resource library and never deletes existing content itself.',
  );
}

const form = new FormData();
form.append(
  'file',
  new Blob([sourceBytes], { type: 'application/pdf' }),
  path.basename(options.sourcePath),
);
form.append('sourceTitle', options.sourceTitle);
form.append('sourceKind', 'pdf');
form.append('language', 'zh-CN');
form.append('usageProfile', 'university_course');
form.append('coverTitle', 'MAT102 数学归纳法');
form.append('coverCourseLabel', 'MAT102');
form.append('coverFocus', '普通归纳法, 强归纳法, 递归与结构归纳');
form.append('ingestIntent', 'maintenance_pilot_reuse_only');
form.append('expectedReusableProblemCount', String(options.expectedProblemCount));
form.append('requireNotebookCover', 'true');

let ingest;
let uploadReconciledFromConflict = false;
let resumedExistingSource = false;
if (options.resumeExisting) {
  resumedExistingSource = true;
  ingest = {
    storage: 'database',
    ingest: null,
    resumedExistingSource: compactSourceSummary(preflight.before.matchingSource),
  };
  process.stdout.write(
    '[resume] exact pilot source is present; skipping POST and running bounded API verification only\n',
  );
} else {
  try {
    ingest = await api(`/api/courses/${encodeURIComponent(options.courseId)}/source-ingest`, {
      method: 'POST',
      headers: { 'x-model': options.model },
      body: form,
    });
  } catch (error) {
    const conflict = error instanceof ApiRequestError ? error.body : null;
    const isSameSourceConflict =
      error instanceof ApiRequestError &&
      error.status === 409 &&
      conflict?.code === 'SOURCE_UPLOAD_CONFLICT' &&
      conflict?.sourceHash === rawFileHash;
    if (!isSameSourceConflict) throw error;

    // If an earlier response was lost after the server committed (or another
    // identical request won the race), the hash-based API guard returns 409.
    // Never send a differently shaped fallback write: reconcile the same source
    // through read APIs and require all postconditions below.
    uploadReconciledFromConflict = true;
    ingest = {
      storage: 'database',
      ingest: null,
      reconciledConflict: conflict,
    };
    process.stdout.write(
      `[upload reconciled] API reports the exact source hash as ${String(conflict.ingestStatus)}; switching to bounded read-after-write verification\n`,
    );
  }
}
await fs.writeFile(
  path.join(options.outDir, 'ingest-response.json'),
  `${JSON.stringify(ingest, null, 2)}\n`,
);

const visible = await waitForPilotVisibility(rawFileHash, ingest?.ingest?.notebook?.id);
process.stdout.write('[verify] reading final exact problem-ID set through API\n');
const afterProblemsPayload = await api(
  `/api/courses/${encodeURIComponent(options.courseId)}/problems?summary=1`,
);
process.stdout.write(
  '[verify] reading course knowledge fact for cover/model evidence through API\n',
);
const sourceKnowledgeFact = await readSourceKnowledgeFact(rawFileHash);
const afterProblemIds = problemIds(afterProblemsPayload);
const createdSource = visible.source;
const createdNotebook = visible.notebook;
const problemsUnchanged = sameIds(beforeProblemIds, afterProblemIds);
const missingProblemIds = beforeProblemIds.filter((id) => !afterProblemIds.includes(id));
const unexpectedProblemIds = afterProblemIds.filter((id) => !beforeProblemIds.includes(id));
const responseCover = ingest?.ingest?.notebookCover || null;
const factCover = sourceKnowledgeFact?.valueJson?.cover || null;
const verifiedCoverModel = responseCover?.model || factCover?.model || null;
const verifiedCoverStatus =
  responseCover?.status || factCover?.status || createdSource.coverStatus || null;
const verifiedCoverImagePath =
  responseCover?.imagePath || factCover?.imagePath || createdSource.coverImagePath || null;
let coverAsset = null;
if (
  verifiedCoverModel === 'gpt-image-2' &&
  verifiedCoverStatus === 'generated' &&
  typeof verifiedCoverImagePath === 'string' &&
  verifiedCoverImagePath.trim()
) {
  process.stdout.write('[verify] checking generated cover bytes through the app URL\n');
  coverAsset = await verifyCoverAsset(verifiedCoverImagePath);
}
const sourceProblemIds = Array.isArray(createdSource.problemIds)
  ? normalizedExactIds(createdSource.problemIds, 'Pilot source problemIds')
  : [];
const reuseOnlyContract =
  ingest?.ingest?.problems?.reuseOnlyContract ||
  sourceKnowledgeFact?.valueJson?.problemReuseOnlyContract ||
  null;
const contractProblemIds = Array.isArray(reuseOnlyContract?.matchedProblemIds)
  ? normalizedExactIds(reuseOnlyContract.matchedProblemIds, 'Reuse-only contract problem IDs')
  : [];
const report = {
  courseId: options.courseId,
  sourceHash: rawFileHash,
  expectedProblems: options.expectedProblemCount,
  notebookId: ingest?.ingest?.notebook?.id || createdNotebook.id,
  cover: responseCover || factCover,
  coverModelEvidence: responseCover
    ? 'source-ingest-response'
    : factCover
      ? 'course-knowledge-fact'
      : null,
  coverAsset,
  insertedProblems:
    ingest?.ingest?.problems?.insertedCount ??
    sourceKnowledgeFact?.valueJson?.stats?.insertedProblemCount ??
    null,
  duplicateProblems:
    ingest?.ingest?.problems?.duplicateCount ??
    sourceKnowledgeFact?.valueJson?.stats?.duplicateProblemCount ??
    null,
  reusedProblems:
    ingest?.ingest?.problems?.reusedProblemIds?.length ??
    sourceKnowledgeFact?.valueJson?.stats?.reusedProblemCount ??
    null,
  reuseOnlyContract,
  contractProblemIds,
  problemsBefore: beforeProblemIds.length,
  problemsAfter: afterProblemIds.length,
  afterProblemIds,
  problemsUnchanged,
  missingProblemIds,
  unexpectedProblemIds,
  sourceVisible: Boolean(createdSource),
  notebookVisible: Boolean(createdNotebook),
  uploadReconciledFromConflict,
  resumedExistingSource,
  sourceStatus: createdSource
    ? {
        ingestStatus: createdSource.ingestStatus,
        indexStatus: createdSource.indexStatus,
      }
    : null,
  sourceProblemIds,
};
await fs.writeFile(
  path.join(options.outDir, 'report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
if (!problemsUnchanged || !createdSource || !createdNotebook) {
  throw new Error(`Pilot verification failed: ${JSON.stringify(report)}`);
}
if (verifiedCoverModel !== 'gpt-image-2') {
  throw new Error(`Pilot did not use GPT Image 2: ${String(verifiedCoverModel || 'none')}`);
}
if (
  verifiedCoverStatus !== 'generated' ||
  !verifiedCoverImagePath ||
  createdSource.coverStatus !== 'generated' ||
  !createdSource.coverImagePath ||
  !coverAsset ||
  coverAsset.width !== 1024 ||
  coverAsset.height !== 1448
) {
  throw new Error(
    `Pilot cover was not successfully generated and published: ${JSON.stringify({
      verifiedCoverStatus,
      verifiedCoverImagePath,
      sourceCoverStatus: createdSource.coverStatus,
      sourceCoverImagePath: createdSource.coverImagePath,
      coverAsset,
    })}`,
  );
}
if (
  reuseOnlyContract?.mode !== 'maintenance_pilot_reuse_only' ||
  reuseOnlyContract?.provenanceKey !== 'detachedSourceDigest' ||
  reuseOnlyContract?.sourceHash !== rawFileHash ||
  reuseOnlyContract?.expectedProblemCount !== options.expectedProblemCount ||
  reuseOnlyContract?.matchedProblemCount !== options.expectedProblemCount ||
  reuseOnlyContract?.reusedProblemCount !== options.expectedProblemCount ||
  reuseOnlyContract?.duplicateSkipCount !== options.expectedProblemCount ||
  reuseOnlyContract?.insertedProblemCount !== 0 ||
  reuseOnlyContract?.satisfied !== true ||
  !sameIds(contractProblemIds, MAT102_INDUCTION_I_PROBLEM_IDS) ||
  !sameIds(contractProblemIds, sourceProblemIds) ||
  sourceProblemIds.some((id) => !beforeProblemIds.includes(id)) ||
  report.insertedProblems !== 0 ||
  report.duplicateProblems !== options.expectedProblemCount ||
  report.reusedProblems !== options.expectedProblemCount ||
  sourceProblemIds.length !== options.expectedProblemCount
) {
  throw new Error(
    `Pilot did not prove the strict reuse-only contract for exactly ${options.expectedProblemCount} existing questions: ${JSON.stringify(
      {
        inserted: report.insertedProblems,
        duplicates: report.duplicateProblems,
        reused: report.reusedProblems,
        sourceProblemCount: sourceProblemIds.length,
        reuseOnlyContract,
      },
    )}`,
  );
}
process.stdout.write(`${JSON.stringify({ ...report, outDir: options.outDir }, null, 2)}\n`);
