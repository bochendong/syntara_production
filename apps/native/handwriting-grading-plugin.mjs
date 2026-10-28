import { resolveBackendAuth } from '../../scripts/learn/syntara-backend-auth.mjs';

const gradePath = '/api/native/v1/grade';
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const maxBodyBytes = 4 * 1024 * 1024;

/** Explicit opt-in, loopback-only development bridge. Credentials never reach Vite's client. */
export function createHandwritingGrader({
  credentialFile,
  resolveAuth = resolveBackendAuth,
  fetchImpl = fetch,
}) {
  let busy = false;
  return async (request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(body));
    };
    let origin;
    try {
      origin = new URL(request.headers.origin);
    } catch {
      return reply(403, { error: { message: 'Only same-origin local grading is allowed.' } });
    }
    if (
      !loopbackAddresses.has(request.socket.remoteAddress) ||
      origin.protocol !== 'http:' ||
      !loopbackHosts.has(origin.hostname) ||
      origin.host !== request.headers.host
    )
      return reply(403, { error: { message: 'Only same-origin local grading is allowed.' } });
    if (request.url !== gradePath || request.method !== 'POST')
      return reply(405, { error: { message: 'Unsupported grading request.' } });
    if (!request.headers['content-type']?.startsWith('application/json'))
      return reply(415, { error: { message: 'Grading requires JSON.' } });
    if (Number(request.headers['content-length']) > maxBodyBytes) {
      request.resume();
      return reply(413, { error: { message: '作答图片过大。' } });
    }
    if (busy) return reply(429, { error: { message: '正在评分，请稍后重试。' } });
    busy = true;
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        bytes += chunk.length;
        if (bytes > maxBodyBytes) {
          request.resume();
          return reply(413, { error: { message: '作答图片过大。' } });
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        JSON.parse(body);
      } catch {
        return reply(400, { error: { message: 'Invalid grading JSON.' } });
      }
      const auth = await resolveAuth({ credentialFile });
      const token = await auth.getToken();
      const upstream = await fetchImpl(`${auth.origin}${gradePath}`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(120_000),
      });
      const result = await upstream.json();
      reply(upstream.status, result);
    } catch {
      reply(502, { error: { message: '平台评分暂不可用，请检查本机评分连接后重试。' } });
    } finally {
      busy = false;
    }
  };
}

export function handwritingGradingPlugin() {
  return {
    name: 'handwriting-local-grading',
    apply: 'serve',
    configureServer(server) {
      const credentialFile = process.env.SYNTARA_QA_GRADING_CREDENTIAL_FILE;
      if (!credentialFile) return;
      const grade = createHandwritingGrader({ credentialFile });
      server.middlewares.use((request, response, next) => {
        if (request.url !== gradePath) return next();
        void grade(request, response);
      });
    },
  };
}
