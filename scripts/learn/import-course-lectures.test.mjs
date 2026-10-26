import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseArgs, runImport, validateOrigin } from './import-course-lectures.mjs';

const TOKEN = 'private-bearer-test-fixture';
const MATERIAL = {
  clientId: '03106b08-2a26-5be3-8a3a-97df2bb168fe',
  name: 'How to Read',
  text: '# How to Read\n\nA proof explains why a statement is true.\n',
};

function archive(material = MATERIAL) {
  return {
    notebook: {
      id: material.clientId,
      name: material.name,
      courseId: 'mat102',
      kind: 'markdown',
      contentVersion: 1,
    },
    markdownSections: [{ courseId: 'mat102', order: 0, markdown: material.text }],
  };
}

function reply(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ success: status < 400, data }));
}

async function fixture(t, handler) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'course-lecture-import-'));
  const tokenFile = path.join(directory, 'token');
  const manifest = path.join(directory, 'manifest.json');
  const receipt = path.join(directory, 'receipt.json');
  await writeFile(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
  await writeFile(manifest, JSON.stringify({ version: 1, materials: [MATERIAL] }));
  const requests = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ method: request.method, url: request.url, body });
    assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
    await handler(request, response, body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return {
    requests,
    directory,
    options: {
      origin: `http://127.0.0.1:${server.address().port}`,
      courseId: 'mat102',
      manifest,
      tokenFile,
      receipt,
      apply: true,
    },
    readReceipt: async () => JSON.parse(await readFile(receipt, 'utf8')),
  };
}

function courses(response, role = 'owner') {
  reply(response, 200, { courses: [{ id: 'mat102', name: 'MAT102', accessRole: role }] });
}

test('default dry-run reads relative Markdown files and never authenticates or writes', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lecture-dry-run-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'lecture.md'), MATERIAL.text);
  const manifest = path.join(directory, 'manifest.json');
  await writeFile(
    manifest,
    JSON.stringify({
      version: 1,
      materials: [
        {
          clientId: MATERIAL.clientId,
          name: MATERIAL.name,
          markdownFile: 'lecture.md',
        },
      ],
    }),
  );
  const result = await runImport({ origin: 'http://127.0.0.1:1', courseId: 'mat102', manifest });
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.materials[0].state, 'planned');
  assert.equal(result.materials[0].characters, MATERIAL.text.length);
  assert.equal(JSON.stringify(result).includes(MATERIAL.text), false);
});

test('authentication failure stops before any notebook write and does not expose the token', async (t) => {
  const f = await fixture(t, (_request, response) => reply(response, 401, { token: TOKEN }));
  await assert.rejects(runImport(f.options), /Course authentication\/list failed \(HTTP 401\)/);
  assert.equal(f.requests.length, 1);
  const receipt = await f.readReceipt();
  assert.equal(JSON.stringify(receipt).includes(TOKEN), false);
  assert.ok(receipt.failedAt);
});

test('existing different content conflicts without POST or overwrite', async (t) => {
  const f = await fixture(t, (request, response) => {
    if (request.url === '/api/native/v1/courses') return courses(response);
    reply(response, 200, archive({ ...MATERIAL, text: 'Teacher edited this lecture.' }));
  });
  await assert.rejects(runImport(f.options), /Content conflict or readback mismatch/);
  assert.equal(
    f.requests.some((request) => request.method === 'POST'),
    false,
  );
});

test('matching existing content is skipped and verified from archive', async (t) => {
  const f = await fixture(t, (request, response) => {
    if (request.url === '/api/native/v1/courses') return courses(response);
    reply(response, 200, archive());
  });
  const result = await runImport(f.options);
  assert.equal(result.materials[0].state, 'skipped');
  assert.equal(f.requests.length, 2);
});

test('ambiguous POST failure reads back the saved content before retrying', async (t) => {
  let saved = false;
  const f = await fixture(t, (request, response) => {
    if (request.url === '/api/native/v1/courses') return courses(response);
    if (request.method === 'POST') {
      saved = true;
      return reply(response, 500, null);
    }
    reply(response, saved ? 200 : 404, saved ? archive() : null);
  });
  const result = await runImport(f.options);
  assert.equal(result.materials[0].state, 'verified');
  assert.equal(result.materials[0].attempts, 1);
  assert.equal(f.requests.filter((request) => request.method === 'POST').length, 1);
});

test('transient failure retries the identical clientId/body and checks the final readback', async (t) => {
  let posts = 0;
  const f = await fixture(t, (request, response) => {
    if (request.url === '/api/native/v1/courses') return courses(response);
    if (request.method === 'POST') {
      posts += 1;
      return reply(
        response,
        posts === 1 ? 503 : 201,
        posts === 1
          ? null
          : {
              status: 'saved',
              kind: 'notes',
              notebookId: MATERIAL.clientId,
            },
      );
    }
    reply(response, posts >= 2 ? 200 : 404, posts >= 2 ? archive() : null);
  });
  const result = await runImport(f.options);
  const uploads = f.requests.filter((request) => request.method === 'POST');
  assert.equal(result.materials[0].attempts, 2);
  assert.equal(uploads.length, 2);
  assert.deepEqual(uploads[0].body, uploads[1].body);
  assert.deepEqual(uploads[0].body, { courseId: 'mat102', kind: 'notes', ...MATERIAL });
  const receipt = await f.readReceipt();
  assert.equal(receipt.materials[0].state, 'verified');
  assert.equal(JSON.stringify(receipt).includes(TOKEN), false);
  assert.equal(JSON.stringify(receipt).includes(MATERIAL.text), false);
});

test('successful upload with incorrect readback fails instead of retrying or claiming success', async (t) => {
  let saved = false;
  const f = await fixture(t, (request, response) => {
    if (request.url === '/api/native/v1/courses') return courses(response);
    if (request.method === 'POST') {
      saved = true;
      return reply(response, 201, { status: 'saved', notebookId: MATERIAL.clientId });
    }
    reply(response, saved ? 200 : 404, saved ? archive({ ...MATERIAL, name: 'Wrong name' }) : null);
  });
  await assert.rejects(runImport(f.options), /readback mismatch/);
  assert.equal(f.requests.filter((request) => request.method === 'POST').length, 1);
});

test('enrolled course is blocked unless explicitly accepting personal notes', async (t) => {
  const f = await fixture(t, (request, response) => {
    if (request.url === '/api/native/v1/courses') return courses(response, 'enrolled');
    reply(response, 200, archive());
  });
  await assert.rejects(runImport(f.options), /Course owner access is required/);
  assert.equal(f.requests.length, 1);
  const result = await runImport({ ...f.options, allowPrivate: true });
  assert.equal(result.scope, 'personal-notes');
});

test('exact course ID is required and a same-name course cannot substitute', async (t) => {
  const f = await fixture(t, (_request, response) => {
    reply(response, 200, { courses: [{ id: 'another-id', name: 'MAT102', accessRole: 'owner' }] });
  });
  await assert.rejects(runImport(f.options), /exact course ID is not present/);
  assert.equal(f.requests.length, 1);
});

test('origin and CLI guards reject insecure targets and token arguments', () => {
  for (const origin of [
    'http://example.com',
    'https://user:secret@example.com',
    'https://example.com/api',
    'https://example.com/?token=x',
  ]) {
    assert.throws(() => validateOrigin(origin));
  }
  assert.equal(validateOrigin('https://example.com/'), 'https://example.com');
  assert.equal(validateOrigin('http://[::1]:3000'), 'http://[::1]:3000');
  assert.throws(() => parseArgs(['--token', TOKEN]), /Unknown/);
  assert.throws(
    () => parseArgs(['--origin', 'https://one', '--origin', 'https://two']),
    /repeated/,
  );
});
