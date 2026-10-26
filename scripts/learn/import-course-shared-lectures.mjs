#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as client from './import-course-problems.mjs';

export async function readSharedLectureManifest(filename) {
  const manifest = JSON.parse(await readFile(filename, 'utf8'));
  client.ensure(
    manifest?.version === 1 &&
      typeof manifest.courseId === 'string' &&
      manifest.courseId.trim() &&
      Array.isArray(manifest.materials) &&
      manifest.materials.length > 0,
    'Manifest requires version:1, exact courseId and nonempty materials.',
  );
  client.ensure(
    Object.keys(manifest).every((key) => ['version', 'courseId', 'materials'].includes(key)),
    'Unknown lecture manifest field.',
  );
  const ids = new Set();
  const materials = [];
  for (const item of manifest.materials) {
    client.ensure(
      item &&
        Object.keys(item).every((key) =>
          ['clientId', 'name', 'text', 'markdownFile', 'language'].includes(key),
        ) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          item.clientId,
        ) &&
        !ids.has(item.clientId.toLowerCase()),
      'Each lecture requires a unique UUID clientId and recognized fields.',
    );
    ids.add(item.clientId.toLowerCase());
    client.ensure(
      typeof item.name === 'string' &&
        item.name.trim() === item.name &&
        item.name.length > 0 &&
        item.name.length <= 200 &&
        (typeof item.text === 'string') !== (typeof item.markdownFile === 'string'),
      'Each lecture requires a title and exactly one of text/markdownFile.',
    );
    const text =
      typeof item.text === 'string'
        ? item.text
        : await readFile(path.resolve(path.dirname(filename), item.markdownFile), 'utf8');
    client.ensure(
      text.trim() && text.length <= 1_000_000,
      'Lecture Markdown must contain 1–1,000,000 characters.',
    );
    client.ensure(
      item.language === undefined || ['zh-CN', 'en-US'].includes(item.language),
      'Lecture language must be zh-CN or en-US.',
    );
    materials.push({
      courseId: manifest.courseId,
      clientId: item.clientId,
      name: item.name,
      text,
      ...(item.language ? { language: item.language } : {}),
    });
  }
  return materials;
}

function payloadHash(material, language) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        courseId: material.courseId,
        clientId: material.clientId,
        name: material.name,
        text: material.text,
        language,
      }),
    )
    .digest('hex');
}

export async function sharedImportRequest({ origin, getToken, fetchImpl = fetch }, endpoint, body) {
  origin = client.validateOrigin(origin);
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetchImpl(`${origin}${endpoint}`, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${await getToken()}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(300_000),
      });
    } catch {
      if (attempt < 2) continue;
      throw new Error('API connection failed; retry with the identical fixed lecture IDs.');
    }
    if (response.status === 401)
      throw new Error('Authentication failed (401). Refresh the backend device credential.');
    if (response.status === 403)
      throw new Error(
        'Permission denied (403). Shared lectures require a course owner/admin or a matching materials import grant for this credential.',
      );
    if ([502, 503, 504].includes(response.status) && attempt < 2) continue;
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`Invalid API response (${response.status}).`);
    }
    client.ensure(
      response.ok && result.success && result.data,
      `Shared import failed (${response.status}); inspect the private receipt before retrying.`,
    );
    return result.data;
  }
}

export async function importSharedLectures({
  origin,
  getToken,
  materials,
  apply = false,
  fetchImpl = fetch,
  onReceipt = async () => {},
}) {
  const receipt = {
    version: 1,
    origin: client.validateOrigin(origin),
    scope: 'shared',
    mode: apply ? 'commit' : 'preview',
    materials: [],
  };
  const request = (body) =>
    sharedImportRequest({ origin, getToken, fetchImpl }, '/api/native/v1/materials', body);
  const verify = (result, material, status) =>
    client.ensure(
      result.status === status &&
        result.scope === 'shared' &&
        result.kind === 'notes' &&
        result.notebookId === material.clientId &&
        result.courseId === material.courseId &&
        result.name === material.name &&
        result.text === material.text &&
        typeof result.language === 'string' &&
        result.language.length > 0 &&
        (!material.language || result.language === material.language) &&
        result.payloadHash === payloadHash(material, result.language),
      'Server preview/readback differs from the accepted lecture; nothing further was uploaded.',
    );
  for (const material of materials) {
    const preview = await request({ ...material, kind: 'notes', scope: 'shared', mode: 'preview' });
    verify(preview, material, 'preview');
    receipt.materials.push({ preview });
    await onReceipt(receipt);
  }
  if (apply)
    for (let index = 0; index < materials.length; index++) {
      const result = await request({
        ...materials[index],
        kind: 'notes',
        scope: 'shared',
        mode: 'commit',
        expectedHash: receipt.materials[index].preview.payloadHash,
      });
      verify(result, materials[index], 'saved');
      client.ensure(
        result.payloadHash === receipt.materials[index].preview.payloadHash &&
          result.language === receipt.materials[index].preview.language,
        'Committed lecture differs from the accepted preview.',
      );
      receipt.materials[index].result = result;
      await onReceipt(receipt);
    }
  return receipt;
}

export async function main(args = process.argv.slice(2)) {
  const list = args.includes('--list-courses');
  client.ensure(
    args.filter((argument) => argument === '--list-courses').length <= 1,
    'Repeated --list-courses option.',
  );
  const options = client.parseArgs(
    args.filter((argument) => argument !== '--list-courses'),
    { '--course-context': 'courseContext' },
  );
  client.ensure(
    !(list && (options.manifest || options.apply)),
    '--list-courses cannot be combined with --manifest or --apply.',
  );
  client.ensure(
    !(options.courseContext && (list || options.manifest || options.apply)),
    '--course-context is a separate read-only command.',
  );
  if (options.help) {
    process.stdout.write(
      'Shared reviewed lecture upload: --manifest FILE [--apply] --credential-file FILE [--origin URL] [--receipt FILE]\nLegacy --token-file/--token-env also supported. Default: server preview.\nUse --list-courses for backend targets; --course-context ID for language/chapters/HardRules/rule packs.\n',
    );
    return;
  }
  const auth = await client.resolveImportAuth(options);
  if (options.courseContext) {
    const result = await sharedImportRequest(
      auth,
      `/api/native/v1/course-problem-imports?courseId=${encodeURIComponent(options.courseContext)}`,
    );
    client.ensure(
      result.course?.id === options.courseContext,
      'Course context does not match the requested course ID.',
    );
    const filename = options.receipt || path.resolve('.private/course-import-context.receipt.json');
    await client.saveReceipt(filename, result);
    process.stdout.write(`Saved course preparation context to private receipt: ${filename}\n`);
    return;
  }
  if (list) {
    const courses = [];
    let cursor;
    do {
      const page = await sharedImportRequest(
        auth,
        `/api/native/v1/course-problem-imports?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      courses.push(...page.courses);
      cursor = page.nextCursor;
    } while (cursor);
    const filename = options.receipt || path.resolve('.private/course-import-catalog.receipt.json');
    await client.saveReceipt(filename, { version: 1, origin: auth.origin, courses });
    process.stdout.write(
      `Saved ${courses.length} course targets to private receipt: ${filename}\n`,
    );
    return;
  }
  client.ensure(options.manifest, '--manifest is required.');
  const materials = await readSharedLectureManifest(options.manifest);
  const filename = options.receipt || `${options.manifest}.receipt.json`;
  await importSharedLectures({
    ...auth,
    materials,
    apply: options.apply,
    onReceipt: (receipt) => client.saveReceipt(filename, receipt),
  });
  process.stdout.write(
    `${options.apply ? 'Committed and read back' : 'Previewed'} ${materials.length} shared lecture(s). Private receipt: ${filename}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
