import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolveBackendAuth } from '../../scripts/learn/syntara-backend-auth.mjs';

const capabilitiesPath = '/api/native/v1/capabilities';
const chatPath = '/api/native/v2/chat';
const stagingOrigin = 'https://native-api-staging-staging-95a1.up.railway.app';
const maxBodyBytes = 48 * 1024 * 1024;

function reply(response, status, message) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify({ error: { message } }));
}

async function forwardPreviewRequest(request, response, credentialFile) {
  const chat = request.url === chatPath;
  const host = request.headers.host ?? '';
  const origin = `http://${host}`;
  if (
    !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) ||
    !/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) ||
    (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') ||
    (chat && request.headers.origin !== origin)
  ) {
    return reply(response, 403, 'Only the same-origin local preview can use staging chat.');
  }
  if (request.method !== (chat ? 'POST' : 'GET')) {
    return reply(response, 405, 'Unsupported preview chat request.');
  }

  const disconnect = new AbortController();
  response.once('close', () => disconnect.abort());
  try {
    let body;
    const headers = new Headers();
    if (chat) {
      if (!request.headers['content-type']?.startsWith('application/json')) {
        return reply(response, 415, 'Preview chat requires JSON.');
      }
      if (Number(request.headers['content-length']) > maxBodyBytes) {
        request.resume();
        return reply(response, 413, 'Preview chat request is too large.');
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > maxBodyBytes) {
          request.resume();
          return reply(response, 413, 'Preview chat request is too large.');
        }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks, size);
      for (const name of [
        'content-type',
        'x-request-id',
        'x-response-strength',
        'x-model',
        'idempotency-key',
      ]) {
        const value = request.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }
    }
    const auth = await resolveBackendAuth({ credentialFile, origin: stagingOrigin });
    headers.set('Authorization', `Bearer ${await auth.getToken()}`);
    const upstream = await fetch(`${auth.origin}${request.url}`, {
      method: request.method,
      redirect: 'error',
      headers,
      body,
      signal: AbortSignal.any([disconnect.signal, AbortSignal.timeout(chat ? 180_000 : 15_000)]),
    });
    response.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store, no-transform',
    });
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response);
    else response.end();
  } catch {
    if (!response.headersSent && !response.destroyed) {
      reply(response, 502, '本机预览无法连接测试服聊天，请检查设备登录凭据后重试。');
    } else if (!response.destroyed) {
      response.destroy();
    }
  }
}

export function previewChatPlugin() {
  return {
    name: 'syntara-local-preview-chat',
    apply: 'serve',
    config() {
      return {
        define: {
          'import.meta.env.VITE_SYNTARA_PREVIEW_CHAT': JSON.stringify(
            Boolean(process.env.SYNTARA_QA_CHAT_CREDENTIAL_FILE),
          ),
        },
      };
    },
    configureServer(server) {
      const credentialFile = process.env.SYNTARA_QA_CHAT_CREDENTIAL_FILE;
      if (!credentialFile) return;
      server.middlewares.use((request, response, next) => {
        if (request.url !== capabilitiesPath && request.url !== chatPath) return next();
        void forwardPreviewRequest(request, response, credentialFile);
      });
    },
  };
}
