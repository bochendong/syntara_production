import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { requestBrowserAuthUser } from '../../apps/native/src/data/browser-auth-session.ts';

test('a stalled login response body times out, and the next check can recover', async (t) => {
  let stalled = true;
  const user = { id: 'fixture-user' };
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    if (stalled) response.write('{"data":');
    else response.end(JSON.stringify({ data: { user } }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  const fetchImpl = (path, init) => fetch(origin + path, init);
  await assert.rejects(requestBrowserAuthUser({ fetchImpl, timeoutMs: 80 }), /登录验证超时/);
  stalled = false;
  assert.deepEqual(await requestBrowserAuthUser({ fetchImpl, timeoutMs: 1000 }), user);
});

test('unauthorized sessions stay signed out and transport errors expose a retry message', async () => {
  for (const status of [401, 403]) {
    assert.equal(
      await requestBrowserAuthUser({ fetchImpl: async () => new Response(null, { status }) }),
      null,
    );
  }
  await assert.rejects(
    requestBrowserAuthUser({
      fetchImpl: async () => {
        throw new TypeError('private transport details');
      },
    }),
    { message: '无法连接登录服务，请检查网络后重试连接。' },
  );
  await assert.rejects(
    requestBrowserAuthUser({ fetchImpl: async () => new Response(null, { status: 502 }) }),
    /登录验证暂时不可用，请重试连接/,
  );
});
