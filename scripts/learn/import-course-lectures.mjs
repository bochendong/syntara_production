#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HELP = `Import accepted Markdown lectures through the existing native materials API.
Usage: node scripts/learn/import-course-lectures.mjs --origin URL --course-id ID --manifest FILE
  --apply                    Write after course/scope checks (default: offline dry-run)
  --token-file FILE           Read a plain bearer token from a private file
  --token-env VARIABLE        Read a bearer token from the named environment variable
  --allow-private             Allow personal notes in an enrolled course
  --receipt FILE              Receipt path (default: MANIFEST.receipt.json)
Never pass a token value as a command-line argument. No environment file is loaded.`;

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

export function parseArgs(args) {
  const options = {};
  const values = {
    '--origin': 'origin',
    '--course-id': 'courseId',
    '--manifest': 'manifest',
    '--token-file': 'tokenFile',
    '--token-env': 'tokenEnv',
    '--receipt': 'receipt',
  };
  const flags = { '--apply': 'apply', '--allow-private': 'allowPrivate', '--help': 'help' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const key = values[argument] || flags[argument];
    ensure(key && options[key] === undefined, 'Unknown or repeated command-line option.');
    if (flags[argument]) options[key] = true;
    else {
      const value = args[++index];
      ensure(value && !value.startsWith('--'), 'An option value is missing.');
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
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  ensure(
    (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash,
    'Origin must use HTTPS (or HTTP on loopback), without credentials, a path, or a query.',
  );
  return url.origin;
}

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function readMaterials(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  ensure(
    manifest.version === 1 && Array.isArray(manifest.materials) && manifest.materials.length > 0,
    'Manifest requires version:1 and a nonempty materials array.',
  );
  const ids = new Set();
  const materials = [];
  for (const item of manifest.materials) {
    ensure(item && typeof item === 'object', 'Invalid material.');
    ensure(
      typeof item.clientId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          item.clientId,
        ) &&
        !ids.has(item.clientId.toLowerCase()),
      'Each material needs a unique UUID clientId.',
    );
    ids.add(item.clientId.toLowerCase());
    ensure(
      typeof item.name === 'string' &&
        item.name === item.name.trim() &&
        item.name.length > 0 &&
        item.name.length <= 200,
      'Material names must contain 1–200 characters without surrounding whitespace.',
    );
    ensure(
      (typeof item.text === 'string') !== (typeof item.markdownFile === 'string'),
      'Each material must supply exactly one of text or markdownFile.',
    );
    const sourcePath =
      typeof item.markdownFile === 'string'
        ? path.resolve(path.dirname(manifestPath), item.markdownFile)
        : null;
    const text = typeof item.text === 'string' ? item.text : await readFile(sourcePath, 'utf8');
    ensure(text.trim().length > 0 && text.length <= 1_000_000, 'Invalid Markdown length.');
    materials.push({
      clientId: item.clientId,
      name: item.name,
      text,
      sourcePath,
      sha256: digest(text),
    });
  }
  return materials;
}

async function loadToken(options) {
  ensure(
    Boolean(options.tokenFile) !== Boolean(options.tokenEnv),
    'Apply requires exactly one of --token-file or --token-env.',
  );
  if (options.tokenEnv)
    ensure(
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(options.tokenEnv),
      'Invalid token environment variable name.',
    );
  const token = (
    options.tokenFile
      ? await readFile(options.tokenFile, 'utf8')
      : process.env[options.tokenEnv] || ''
  ).trim();
  ensure(/^[A-Za-z0-9._~+/-]+=*$/.test(token), 'A valid bearer token is required.');
  return token;
}

function apiClient(origin, token) {
  return async (method, endpoint, body) => {
    let response;
    try {
      response = await fetch(`${origin}${endpoint}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      return { status: 0, data: null };
    }
    const payload = await response.json().catch(() => null);
    return { status: response.status, data: payload?.success === true ? payload.data : null };
  };
}

function checkStatus(result, operation) {
  ensure(
    result.status >= 200 && result.status < 300 && result.data,
    `${operation} failed (HTTP ${result.status || 'network error'}).`,
  );
}

function compareArchive(archive, courseId, material) {
  const notebook = archive?.notebook;
  const sections = archive?.markdownSections;
  ensure(
    notebook?.id === material.clientId &&
      notebook.courseId === courseId &&
      notebook.name === material.name &&
      notebook.kind === 'markdown' &&
      Array.isArray(sections) &&
      sections.length === 1 &&
      sections[0].courseId === courseId &&
      sections[0].markdown === material.text,
    `Content conflict or readback mismatch for ${material.clientId}; existing content was not overwritten.`,
  );
}

async function lookup(client, material) {
  const result = await client(
    'GET',
    `/api/native/v1/notebooks?id=${encodeURIComponent(material.clientId)}`,
  );
  if (result.status === 404) return null;
  checkStatus(result, 'Notebook read');
  return result.data;
}

async function upload(client, courseId, material) {
  const existing = await lookup(client, material);
  if (existing) {
    compareArchive(existing, courseId, material);
    return { state: 'skipped', contentVersion: existing.notebook.contentVersion };
  }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await client('POST', '/api/native/v1/materials', {
      courseId,
      kind: 'notes',
      clientId: material.clientId,
      name: material.name,
      text: material.text,
    });
    const retryable = result.status === 0 || result.status === 429 || result.status >= 500;
    if (!retryable && result.status !== 409) checkStatus(result, 'Material upload');
    const archive = await lookup(client, material);
    if (archive) {
      compareArchive(archive, courseId, material);
      return {
        state: 'verified',
        attempts: attempt,
        contentVersion: archive.notebook.contentVersion,
      };
    }
    ensure(retryable && attempt < 3, 'Upload could not be verified; rerun with the same clientId.');
    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
}

export async function runImport(options) {
  const origin = validateOrigin(options.origin);
  ensure(
    typeof options.courseId === 'string' &&
      options.courseId.trim() === options.courseId &&
      options.courseId.length > 0 &&
      options.courseId.length <= 200,
    'An exact course ID is required.',
  );
  ensure(options.manifest, '--manifest is required.');
  const manifestPath = path.resolve(options.manifest);
  const materials = await readMaterials(manifestPath);
  const receipt = {
    version: 1,
    origin,
    courseId: options.courseId,
    mode: options.apply ? 'apply' : 'dry-run',
    startedAt: new Date().toISOString(),
    materials: materials.map(({ clientId, name, sha256, text }) => ({
      clientId,
      name,
      sha256,
      characters: text.length,
      state: 'planned',
    })),
  };
  if (!options.apply) return receipt;
  const token = await loadToken(options);
  const client = apiClient(origin, token);
  const receiptPath = path.resolve(options.receipt || `${manifestPath}.receipt.json`);
  ensure(
    receiptPath !== manifestPath &&
      receiptPath !== path.resolve(options.tokenFile || manifestPath) &&
      !materials.some((material) => material.sourcePath === receiptPath),
    'Receipt must not replace the manifest, Markdown source, or token file.',
  );
  const save = () =>
    writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  try {
    const courses = await client('GET', '/api/native/v1/courses');
    checkStatus(courses, 'Course authentication/list');
    const matches = courses.data.courses?.filter((course) => course.id === options.courseId);
    ensure(matches?.length === 1, 'The exact course ID is not present in this account.');
    const course = matches[0];
    ensure(
      course.accessRole === 'owner' || (options.allowPrivate && course.accessRole === 'enrolled'),
      'Course owner access is required; --allow-private permits personal notes in an enrolled course.',
    );
    receipt.scope = course.accessRole === 'owner' ? 'owner-course' : 'personal-notes';
    receipt.courseName = course.name;
    await save();
    for (const [index, material] of materials.entries()) {
      receipt.materials[index].state = 'checking';
      await save();
      Object.assign(receipt.materials[index], await upload(client, options.courseId, material));
      await save();
    }
    receipt.completedAt = new Date().toISOString();
    await save();
    return receipt;
  } catch (error) {
    receipt.failedAt = new Date().toISOString();
    receipt.error = error.message;
    await save();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(HELP);
    else console.log(JSON.stringify(await runImport(options), null, 2));
  } catch (error) {
    // API response bodies, fetch errors and bearer values are never logged.
    console.error(`Lecture import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
