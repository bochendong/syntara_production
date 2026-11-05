import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import {
  createPreviewGateway,
  localPreviewRequest,
  stagingOrigin,
} from '../../apps/native/staging-preview-plugin.mjs';

test('loopback preview rejects remote hosts, cross-site and mismatched origins', () => {
  const request = (headers = {}, address = '127.0.0.1') => ({
    headers: { host: '127.0.0.1:1422', ...headers },
    socket: { remoteAddress: address },
  });
  assert.equal(localPreviewRequest(request()), true);
  assert.equal(localPreviewRequest(request({ 'sec-fetch-site': 'same-origin' })), true);
  assert.equal(localPreviewRequest(request({ host: 'attacker.example' })), false);
  assert.equal(localPreviewRequest(request({ origin: 'https://attacker.example' })), false);
  assert.equal(localPreviewRequest(request({ 'sec-fetch-site': 'cross-site' })), false);
  assert.equal(localPreviewRequest(request({}, '192.168.1.2')), false);
});

test('gateway only forwards read routes and strips device session and upstream cookies', async (t) => {
  const calls = [];
  const gateway = createPreviewGateway({
    getToken: async () => 'server-only-test-token',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json(
        { success: true, data: { user: { id: 'fixture-user' }, sessionId: 'private-session' } },
        { headers: { 'set-cookie': 'secret=value' } },
      );
    },
  });
  const server = createServer((request, response) => void gateway(request, response));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const local = `http://127.0.0.1:${server.address().port}`;
  const auth = await fetch(`${local}/api/native/v1/auth/browser`, {
    headers: { authorization: 'Bearer browser-supplied' },
  });
  assert.deepEqual(await auth.json(), { success: true, data: { user: { id: 'fixture-user' } } });
  assert.equal(auth.headers.get('set-cookie'), null);
  assert.equal(calls[0].url, `${stagingOrigin}/api/native/v1/auth/me`);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer server-only-test-token');
  assert.equal(calls[0].init.redirect, 'error');
  const read = await fetch(`${local}/api/native/v1/teach?sessionId=fixture`);
  assert.equal(read.status, 200);
  await read.text();
  assert.equal(calls[1].url, `${stagingOrigin}/api/native/v1/teach?sessionId=fixture`);
  for (const [path, method] of [
    ['/api/native/v1/teach', 'POST'],
    ['/api/native/v1/courses', 'DELETE'],
    ['/api/native/v1/courses', 'PATCH'],
    ['/api/native/v1/hidden-tests', 'GET'],
    ['/api/native/v1/auth/me', 'GET'],
    ['/api/native/v1/auth/refresh', 'POST'],
    ['/api/native/v2/chat', 'POST'],
  ]) {
    const blocked = await fetch(local + path, { method });
    assert.equal(blocked.status, 403);
    await blocked.text();
  }
  const crossSite = await fetch(`${local}/api/native/v1/teach`, {
    headers: { origin: 'https://attacker.example' },
  });
  assert.equal(crossSite.status, 403);
  await crossSite.text();
  assert.equal(calls.length, 2, 'blocked requests must not acquire credentials or reach staging');
});

test('upstream failures do not expose credential or transport error text', async (t) => {
  const gateway = createPreviewGateway({
    getToken: async () => {
      throw new Error('secret-token');
    },
  });
  const server = createServer((request, response) => void gateway(request, response));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/native/v1/teach`);
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /secret-token/);
});

test('opening an existing class resolves GET data without forwarding a write', async (t) => {
  const calls = [];
  const gateway = createPreviewGateway({
    getToken: async () => 'test-token',
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method });
      return Response.json({
        success: true,
        data: { courses: [{ id: 'existing-course', currentClass: { id: 'existing-class' } }] },
      });
    },
  });
  const server = createServer((request, response) => void gateway(request, response));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const local = `http://127.0.0.1:${server.address().port}`;
  const post = (body) =>
    fetch(`${local}/api/native/v1/teach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const existing = await post({ action: 'open-class', courseId: 'existing-course' });
  assert.equal(existing.status, 200);
  assert.deepEqual(await existing.json(), { success: true, data: { classId: 'existing-class' } });
  const missing = await post({ action: 'open-class', courseId: 'missing-course' });
  assert.equal(missing.status, 403);
  await missing.text();
  const mutation = await post({ action: 'rename', sessionId: 'session', name: 'should not save' });
  assert.equal(mutation.status, 403);
  await mutation.text();
  const oversized = await post({ action: 'open-class', courseId: 'a'.repeat(5000) });
  assert.equal(oversized.status, 403);
  await oversized.text();
  assert.deepEqual(
    calls,
    Array.from({ length: 2 }, () => ({
      url: `${stagingOrigin}/api/native/v1/teach`,
      method: 'GET',
    })),
  );
});
