import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolveBackendAuth } from '../../scripts/learn/syntara-backend-auth.mjs';

export const stagingOrigin = 'https://native-api-staging-staging-95a1.up.railway.app';
const repoRoot = new URL('../../', import.meta.url);
const uiPaths = ['apps/native/src', 'apps/native/index.html', 'apps/native/public'];
// Only existing read routes. Never forward auth tokens, hidden tests or arbitrary URLs.
const readRoutes = new Set([
  'v1/auth/browser',
  'v1/version',
  'v1/capabilities',
  'v1/courses',
  'v1/usage',
  'v1/course-data',
  'v1/notebooks',
  'v1/mini-lectures',
  'v1/conversations',
  'v1/memories',
  'v1/problems',
  'v1/store',
  'v1/classroom',
  'v1/teach',
  'v1/admin',
  'v1/onboarding',
  'v2/general-conversations',
]);

function git(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function previewSourceStatus(revision) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid staging revision.');
  git(['cat-file', '-e', `${revision}^{commit}`]);
  const changed = git(['diff', '--name-only', revision, '--', ...uiPaths]);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', ...uiPaths]);
  let includesBaseline = true;
  try {
    git(['merge-base', '--is-ancestor', revision, 'HEAD']);
  } catch {
    includesBaseline = false;
  }
  return {
    branch: git(['branch', '--show-current']),
    localRevision: git(['rev-parse', 'HEAD']),
    stagingRevision: revision,
    includesBaseline,
    uiMatches: !changed && !untracked,
    changedFiles: [...new Set(`${changed}\n${untracked}`.split('\n').filter(Boolean))],
  };
}

export function localPreviewRequest(request) {
  const host = request.headers.host ?? '';
  const origin = `http://${host}`;
  return (
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) &&
    /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) &&
    (!request.headers.origin || request.headers.origin === origin) &&
    (!request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'same-origin')
  );
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

/** Retry only reads, never device-token refresh or other writes. */
export async function fetchPreviewRead(
  path,
  { fetchImpl = fetch, signal, headers, timeoutMs = 15_000 } = {},
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal?.throwIfAborted();
    try {
      const response = await fetchImpl(stagingOrigin + path, {
        method: 'GET',
        redirect: 'error',
        headers,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
      if (attempt === 0 && [502, 503, 504].includes(response.status)) {
        await response.body?.cancel();
        continue;
      }
      return response;
    } catch (error) {
      if (signal?.aborted || attempt === 1) throw error;
    }
  }
}

async function existingClassNavigation(request) {
  if (
    request.url !== '/api/native/v1/teach' ||
    request.method !== 'POST' ||
    !request.headers['content-type']?.startsWith('application/json')
  )
    return null;
  let body = '';
  try {
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      body += chunk.toString();
      if (Buffer.byteLength(body) > 4096) {
        request.resume();
        return null;
      }
    }
    const input = JSON.parse(body);
    return input?.action === 'open-class' &&
      typeof input.courseId === 'string' &&
      input.courseId.length > 0 &&
      input.courseId.length <= 200
      ? input.courseId
      : null;
  } catch {
    return null;
  }
}

export function createPreviewGateway({ getToken, fetchImpl = fetch }) {
  return async (request, response) => {
    if (!localPreviewRequest(request)) {
      return json(response, 403, { error: { message: '仅限本机同源预览。' } });
    }
    const url = new URL(request.url, 'http://localhost');
    // The App's "open class" action normally creates a class if missing. For local
    // previews, resolve an already existing class from a GET; never forward the POST.
    const courseId = await existingClassNavigation(request);
    if (
      !courseId &&
      (request.method !== 'GET' || !readRoutes.has(url.pathname.slice('/api/native/'.length)))
    ) {
      return json(response, 403, {
        error: { message: '本地预览只读；请在测试服执行保存、开课或提交。' },
      });
    }
    const browserAuth = url.pathname === '/api/native/v1/auth/browser';
    const path = courseId
      ? '/api/native/v1/teach'
      : browserAuth
        ? '/api/native/v1/auth/me'
        : url.pathname + url.search;
    const disconnect = new AbortController();
    response.once('close', () => disconnect.abort());
    let authenticating = true;
    try {
      const token = await getToken();
      authenticating = false;
      const upstream = await fetchPreviewRead(path, {
        fetchImpl,
        headers: { Authorization: `Bearer ${token}` },
        signal: disconnect.signal,
      });
      if (courseId && upstream.ok) {
        const body = await upstream.json();
        const existing = body.data?.courses?.find((course) => course.id === courseId)?.currentClass;
        return existing?.id
          ? json(response, 200, { success: true, data: { classId: existing.id } })
          : json(response, 403, {
              error: { message: '这门课尚未开班；本地只读预览不能新建班级。' },
            });
      }
      if (browserAuth && upstream.ok) {
        const body = await upstream.json();
        // The frontend only receives the public user, never device/session credentials.
        return json(response, 200, { success: true, data: { user: body.data.user } });
      }
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
      });
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response);
      else response.end();
    } catch {
      if (!response.headersSent && !response.destroyed) {
        json(response, 502, {
          error: {
            code: authenticating ? 'preview_auth_unavailable' : 'preview_connection_failed',
            message: authenticating
              ? '测试服设备登录验证暂时失败，请稍后重试。'
              : '本机暂时无法连接测试服，请稍后重试。',
          },
        });
      } else if (!response.destroyed) response.destroy();
    }
  };
}

/** @returns {import('vite').Plugin} */
export function stagingPreviewPlugin() {
  const enabled = process.env.SYNTARA_STAGING_PREVIEW === '1';
  let gateway;
  let versionCheck;
  let checkedAt = 0;
  return {
    name: 'syntara-preview-identity',
    apply: 'serve',
    config() {
      if (!enabled) return;
      return {
        define: {
          'import.meta.env.VITE_SYNTARA_HOME_URL': JSON.stringify(
            process.env.SYNTARA_STAGING_PREVIEW_HOME_URL || `${stagingOrigin}/`,
          ),
        },
      };
    },
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: '/__syntara_preview/toolbar.js' },
          injectTo: 'body',
        },
      ];
    },
    configureServer(server) {
      if (enabled) {
        const credentialFile = process.env.SYNTARA_STAGING_PREVIEW_CREDENTIAL_FILE;
        if (!credentialFile)
          throw new Error('Use pnpm staging:preview to select private device credentials.');
        const auth = resolveBackendAuth({ credentialFile, origin: stagingOrigin });
        gateway = createPreviewGateway({ getToken: async () => (await auth).getToken() });
      }
      server.middlewares.use((request, response, next) => {
        if (enabled && request.url?.startsWith('/api/')) {
          if (!request.url.startsWith('/api/native/')) {
            return json(response, 403, {
              error: { message: '本地预览只读；此操作请使用测试服。' },
            });
          }
          void gateway(request, response);
          return;
        }
        if (!request.url?.startsWith('/__syntara_preview/')) return next();
        if (!localPreviewRequest(request) || request.method !== 'GET') {
          return json(response, 403, { error: { message: '仅限本机同源预览。' } });
        }
        if (request.url === '/__syntara_preview/toolbar.js') {
          response.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'no-store',
          });
          response.end(readFileSync(new URL('./preview-toolbar.js', import.meta.url), 'utf8'));
          return;
        }
        if (request.url !== '/__syntara_preview/status') return next();
        if (!versionCheck || Date.now() - checkedAt > 30_000) {
          checkedAt = Date.now();
          versionCheck = fetchPreviewRead('/api/native/v1/version', { timeoutMs: 5000 })
            .then((result) => {
              if (!result.ok) throw new Error();
              return result.json();
            })
            .then((body) => body.revision)
            .catch(() => null);
        }
        void versionCheck.then((revision) => {
          try {
            json(response, 200, {
              mode: enabled ? 'staging-readonly' : 'demo',
              stagingOrigin,
              ...previewSourceStatus(revision),
            });
          } catch {
            json(response, 200, {
              mode: enabled ? 'staging-readonly' : 'demo',
              stagingOrigin,
              error: '无法核对测试服版本，请更新源码或检查网络。',
            });
          }
        });
      });
    },
  };
}
