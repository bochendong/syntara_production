#!/usr/bin/env node
import { readFile, mkdir, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { resolveBackendAuth } from './syntara-backend-auth.mjs';

export const HELP = `Upload reviewed structured questions as an authorized course owner/admin/grantee.
node scripts/learn/import-course-problems.mjs --origin URL --manifest FILE --token-file FILE
  --token-env NAME       Alternative: read a bearer token from an environment variable
  --credential-file FILE Native-device JSON credentials; refreshes securely and can supply origin
  --list-courses         Save all authorized courses to a private receipt; no manifest or --apply
  --course-context ID    Save course chapters/rules to a private receipt; no manifest or --apply
  --apply                Commit after preview (default: read-only server preview)
  --receipt FILE         Private JSON receipt, including grading (default: MANIFEST.receipt.json)
The manifest is split into stable batches of at most 100. Keep the same manifest/key to retry.
Never pass a token value on the command line. No environment file is loaded.`;

export function ensure(value, message) {
  if (!value) throw new Error(message);
}

export function parseArgs(args, extraValues = {}) {
  const options = {};
  const values = {
    '--origin': 'origin',
    '--manifest': 'manifest',
    '--token-file': 'tokenFile',
    '--token-env': 'tokenEnv',
    '--credential-file': 'credentialFile',
    '--course-context': 'courseContext',
    '--receipt': 'receipt',
    ...extraValues,
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    const key =
      values[argument] ||
      { '--apply': 'apply', '--help': 'help', '--list-courses': 'listCourses' }[argument];
    ensure(key && options[key] === undefined, 'Unknown or repeated option. Use --help.');
    if (['--apply', '--help', '--list-courses'].includes(argument)) options[key] = true;
    else {
      const value = args[++index];
      ensure(value && !value.startsWith('--'), 'Missing option value.');
      options[key] = value;
    }
  }
  return options;
}

export function validateOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('A valid API origin is required.');
  }
  ensure(
    (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash,
    'Origin must be HTTPS (or loopback HTTP) without credentials, path or query.',
  );
  return url.origin;
}

export function splitManifest(manifest) {
  ensure(
    manifest?.version === 1 &&
      typeof manifest.courseId === 'string' &&
      manifest.courseId.trim() &&
      typeof manifest.idempotencyKey === 'string' &&
      manifest.idempotencyKey.length >= 8 &&
      manifest.idempotencyKey.length <= 130 &&
      Array.isArray(manifest.chapters) &&
      manifest.chapters.length > 0 &&
      manifest.chapters.length <= 100 &&
      Array.isArray(manifest.items) &&
      manifest.items.length > 0,
    'Manifest requires version:1, courseId, idempotencyKey (8–130 characters), chapters and items.',
  );
  ensure(
    Object.keys(manifest).every((key) =>
      ['version', 'courseId', 'idempotencyKey', 'chapters', 'items'].includes(key),
    ),
    'Unknown manifest field.',
  );
  const refs = new Set(manifest.chapters.map((chapter) => chapter.ref));
  const ids = manifest.items.map((item) => item?.draft?.draftId);
  ensure(
    refs.size === manifest.chapters.length &&
      ids.every((id) => typeof id === 'string' && id.trim()) &&
      new Set(ids).size === ids.length &&
      manifest.items.every((item) => refs.has(item.chapterRef)),
    'Question IDs must be unique and chapter references must be declared.',
  );
  const result = [];
  for (let start = 0; start < manifest.items.length; start += 100) {
    result.push({
      ...manifest,
      idempotencyKey: `${manifest.idempotencyKey}:part:${result.length + 1}`,
      items: manifest.items.slice(start, start + 100),
    });
  }
  return result;
}

export async function saveReceipt(filename, receipt) {
  await mkdir(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
  await writeFile(filename, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'w' });
  await chmod(filename, 0o600);
}

export async function readToken(options, dependencies) {
  return (await resolveBackendAuth(options, dependencies)).getToken();
}

export async function resolveImportAuth(options, dependencies) {
  const auth = await resolveBackendAuth(options, dependencies);
  ensure(auth.origin, '--origin is required unless supplied by --credential-file.');
  return auth;
}

export async function importThroughHttp({
  origin,
  token,
  getToken,
  batches,
  apply = false,
  onReceipt = async () => {},
  fetchImpl = fetch,
}) {
  origin = validateOrigin(origin);
  const receipt = { version: 1, origin, mode: apply ? 'commit' : 'preview', batches: [] };
  async function request(body) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const requestToken = getToken ? await getToken() : token;
      ensure(
        requestToken && !/[\r\n]/.test(requestToken),
        'The selected token is missing or invalid.',
      );
      let response;
      try {
        response = await fetchImpl(`${origin}/api/native/v1/course-problem-imports`, {
          method: 'POST',
          redirect: 'error',
          headers: { authorization: `Bearer ${requestToken}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(300_000),
        });
      } catch {
        if (attempt < 2) continue;
        throw new Error(
          'API connection failed. Re-run the identical manifest/key to reconcile its receipt.',
        );
      }
      if (response.status === 401)
        throw new Error(
          'Authentication failed (401). Sign in as the course owner and select a valid device bearer token.',
        );
      if (response.status === 403)
        throw new Error(
          'Permission denied (403). Shared question upload requires the real course owner, an existing administrator, or an unexpired grant for this course; an enrolled account alone cannot publish.',
        );
      if ([502, 503, 504].includes(response.status) && attempt < 2) continue;
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error(`API returned an invalid response (${response.status}).`);
      }
      // Do not echo server-controlled strings: they could contain submitted content or credentials.
      const errorCode = payload.error?.code;
      ensure(
        response.ok && payload.success && payload.data,
        `Import failed (${response.status}, ${typeof errorCode === 'string' && /^[a-z_]+$/.test(errorCode) ? errorCode : 'api_error'}). Keep the same manifest/key when checking an uncertain operation.`,
      );
      return payload.data;
    }
  }
  // Preview every batch before any write, so an invalid later batch cannot start an earlier one.
  for (const data of batches) {
    const preview = await request({ mode: 'preview', data });
    ensure(
      /^[a-f0-9]{64}$/.test(preview.payloadHash),
      'Preview did not return a valid payload hash.',
    );
    receipt.batches.push({ preview });
    await onReceipt(receipt);
  }
  if (apply)
    for (let index = 0; index < batches.length; index++) {
      receipt.batches[index].result = await request({
        mode: 'commit',
        data: batches[index],
        expectedHash: receipt.batches[index].preview.payloadHash,
      });
      await onReceipt(receipt);
    }
  return receipt;
}

export async function listCoursesThroughHttp({
  origin,
  token,
  getToken,
  onReceipt = async () => {},
  fetchImpl = fetch,
}) {
  origin = validateOrigin(origin);
  const receipt = { version: 1, origin, mode: 'course-catalog', pages: [], courses: [] };
  const courses = new Map();
  const cursors = new Set();
  let cursor;
  do {
    const url = new URL('/api/native/v1/course-problem-imports', origin);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    let data;
    for (let attempt = 0; attempt < 3; attempt++) {
      const requestToken = getToken ? await getToken() : token;
      ensure(
        requestToken && !/[\r\n]/.test(requestToken),
        'The selected token is missing or invalid.',
      );
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          redirect: 'error',
          headers: { authorization: `Bearer ${requestToken}` },
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        if (attempt < 2) continue;
        throw new Error('Course catalog connection failed. Retry the same command.');
      }
      if ([502, 503, 504].includes(response.status) && attempt < 2) continue;
      if ([401, 403].includes(response.status))
        throw new Error(`Course catalog authorization failed (${response.status}).`);
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error('Course catalog returned an invalid response.');
      }
      ensure(
        response.ok && payload?.success && Array.isArray(payload.data?.courses),
        'Course catalog request failed.',
      );
      data = payload.data;
      break;
    }
    ensure(
      data.courses.every((course) => course && typeof course.id === 'string' && course.id) &&
        (data.nextCursor === null ||
          (typeof data.nextCursor === 'string' && data.nextCursor.length > 0)),
      'Course catalog returned invalid pagination or course identifiers.',
    );
    receipt.pages.push(data);
    for (const course of data.courses) courses.set(course.id, course);
    receipt.courses = [...courses.values()];
    await onReceipt(receipt);
    cursor = data.nextCursor;
    if (cursor) {
      ensure(!cursors.has(cursor), 'Course catalog pagination did not advance.');
      cursors.add(cursor);
    }
  } while (cursor);
  return receipt;
}

export async function readCourseContextThroughHttp({
  origin,
  courseId,
  token,
  getToken,
  fetchImpl = fetch,
}) {
  origin = validateOrigin(origin);
  ensure(typeof courseId === 'string' && courseId.trim(), 'A course identifier is required.');
  const url = new URL('/api/native/v1/course-problem-imports', origin);
  url.searchParams.set('courseId', courseId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const requestToken = getToken ? await getToken() : token;
    ensure(
      requestToken && !/[\r\n]/.test(requestToken),
      'The selected token is missing or invalid.',
    );
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        headers: { authorization: `Bearer ${requestToken}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      if (attempt < 2) continue;
      throw new Error('Course context connection failed. Retry the same command.');
    }
    if ([502, 503, 504].includes(response.status) && attempt < 2) continue;
    if ([401, 403].includes(response.status))
      throw new Error(`Course context authorization failed (${response.status}).`);
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Course context returned an invalid response.');
    }
    const course = payload?.data?.course;
    ensure(
      response.ok &&
        payload?.success &&
        course?.id === courseId &&
        Array.isArray(course.chapters) &&
        Array.isArray(course.hardRules) &&
        Array.isArray(course.rulePacks),
      'Course context request failed or returned incomplete/mismatched course rules.',
    );
    return { ...payload.data, version: 1, origin, mode: 'course-context' };
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (options.listCourses) {
    ensure(
      !options.apply && !options.manifest && !options.courseContext,
      '--list-courses cannot be combined with --apply, --manifest or --course-context.',
    );
    const auth = await resolveImportAuth(options);
    const filename =
      options.receipt ||
      path.join(
        homedir(),
        '.config',
        'syntara',
        'receipts',
        `course-catalog-${Date.now()}-${randomUUID().slice(0, 8)}.json`,
      );
    const receipt = await listCoursesThroughHttp({
      origin: auth.origin,
      getToken: auth.getToken,
      onReceipt: (value) => saveReceipt(filename, value),
    });
    process.stdout.write(
      `Listed ${receipt.courses.length} course(s). Private receipt: ${filename}\n`,
    );
    return;
  }
  if (options.courseContext) {
    ensure(
      !options.apply && !options.manifest,
      '--course-context cannot be combined with --apply, --manifest or --list-courses.',
    );
    const auth = await resolveImportAuth(options);
    const filename =
      options.receipt ||
      path.join(
        homedir(),
        '.config',
        'syntara',
        'receipts',
        `course-context-${Date.now()}-${randomUUID().slice(0, 8)}.json`,
      );
    const receipt = await readCourseContextThroughHttp({
      origin: auth.origin,
      courseId: options.courseContext,
      getToken: auth.getToken,
    });
    await saveReceipt(filename, receipt);
    process.stdout.write(`${filename}\n`);
    return;
  }
  ensure(options.manifest, '--manifest is required.');
  const batches = splitManifest(JSON.parse(await readFile(options.manifest, 'utf8')));
  const filename = options.receipt || `${options.manifest}.receipt.json`;
  const auth = await resolveImportAuth(options);
  await importThroughHttp({
    origin: auth.origin,
    getToken: auth.getToken,
    batches,
    apply: options.apply,
    onReceipt: (receipt) => saveReceipt(filename, receipt),
  });
  process.stdout.write(
    `${options.apply ? 'Committed and read back' : 'Previewed'} ${batches.length} batch(es). Private receipt: ${filename}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
