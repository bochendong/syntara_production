/** Local Syntara native-device credentials. Never log tokens or server response bodies. */
import { constants } from 'node:fs';
import { open, lstat, rename, unlink, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const REFRESH_EARLY_MS = 60_000;
const REFRESH_TIMEOUT_MS = 20_000;
const LOCK_TIMEOUT_MS = 30_000;
const MAX_CREDENTIAL_BYTES = 1_048_576;

function requireAuth(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateBackendOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('A valid API origin is required.');
  }
  requireAuth(
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

function credentialsFrom(value) {
  requireAuth(
    value && typeof value === 'object' && !Array.isArray(value),
    'Invalid credential file.',
  );
  requireAuth(
    typeof value.accessToken === 'string' &&
      /^snt_acc_[A-Za-z0-9_-]+$/.test(value.accessToken) &&
      typeof value.refreshToken === 'string' &&
      /^snt_ref_[A-Za-z0-9_-]+$/.test(value.refreshToken) &&
      typeof value.accessTokenExpiresAt === 'string' &&
      Number.isFinite(Date.parse(value.accessTokenExpiresAt)) &&
      typeof value.refreshTokenExpiresAt === 'string' &&
      Number.isFinite(Date.parse(value.refreshTokenExpiresAt)) &&
      typeof value.sessionId === 'string' &&
      value.sessionId.trim() &&
      !/[\r\n]/.test(value.sessionId),
    'Invalid Syntara native-device credentials.',
  );
  return {
    origin: validateBackendOrigin(value.origin),
    accessToken: value.accessToken,
    accessTokenExpiresAt: value.accessTokenExpiresAt,
    refreshToken: value.refreshToken,
    refreshTokenExpiresAt: value.refreshTokenExpiresAt,
    sessionId: value.sessionId,
    ...(value.user === undefined ? {} : { user: value.user }),
  };
}

async function readCredentials(filename, expectedOrigin) {
  let handle;
  let contents;
  try {
    handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    requireAuth(
      stat.isFile() &&
        (stat.mode & 0o777) === 0o600 &&
        (typeof process.getuid !== 'function' || stat.uid === process.getuid()) &&
        stat.size <= MAX_CREDENTIAL_BYTES,
      'Credential file must be an owned regular file with mode 0600.',
    );
    contents = await handle.readFile('utf8');
  } catch {
    throw new Error(
      'Cannot read a private credential file. Use an owned regular file with mode 0600.',
    );
  } finally {
    await handle?.close().catch(() => {});
  }
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error('Credential file is not valid JSON.');
  }
  const credentials = credentialsFrom(parsed);
  requireAuth(
    !expectedOrigin || credentials.origin === expectedOrigin,
    'Credential origin does not match the selected API origin.',
  );
  return credentials;
}

async function atomicSaveCredentials(filename, credentials) {
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(credentials, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filename);
  } catch {
    throw new Error('Refreshed credentials could not be saved securely. Sign in again if needed.');
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

async function removeDeadLock(filename) {
  let handle;
  try {
    handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 4096 || Date.now() - stat.mtimeMs < 1000) return;
    const metadata = JSON.parse(await handle.readFile('utf8'));
    if (!Number.isSafeInteger(metadata.pid) || metadata.pid <= 0) return;
    try {
      process.kill(metadata.pid, 0);
      return;
    } catch (error) {
      if (error?.code !== 'ESRCH') return;
    }
    const current = await lstat(filename);
    if (current.dev === stat.dev && current.ino === stat.ino) await unlink(filename);
  } catch {
    // A malformed/busy lock is never stolen. Acquisition will time out with a safe message.
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function withRefreshLock(filename, timeoutMs, operation) {
  const lockfile = `${filename}.lock`;
  const started = Date.now();
  let handle;
  let identity;
  for (;;) {
    try {
      handle = await open(lockfile, 'wx', 0o600);
      identity = await handle.stat();
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }), 'utf8');
      break;
    } catch (error) {
      await handle?.close().catch(() => {});
      handle = undefined;
      if (identity) {
        await unlink(lockfile).catch(() => {});
        throw new Error('Cannot create a private credential refresh lock.');
      }
      requireAuth(error?.code === 'EEXIST', 'Cannot create a private credential refresh lock.');
      requireAuth(Date.now() - started < timeoutMs, 'Credential refresh is busy. Retry shortly.');
      await removeDeadLock(lockfile);
      await delay(25);
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    try {
      const current = await lstat(lockfile);
      if (current.dev === identity.dev && current.ino === identity.ino) await unlink(lockfile);
    } catch {
      // Do not mask an authentication error or remove another process's lock.
    }
  }
}

/**
 * Returns {origin, getToken}; getToken reloads the file on every request and serializes rotation
 * across processes. The optional dependencies support offline tests; no env file is ever loaded.
 */
export async function resolveBackendAuth(
  options,
  {
    fetchImpl = fetch,
    now = Date.now,
    refreshEarlyMs = REFRESH_EARLY_MS,
    lockTimeoutMs = LOCK_TIMEOUT_MS,
    env = process.env,
  } = {},
) {
  requireAuth(
    [options.credentialFile, options.tokenFile, options.tokenEnv].filter(Boolean).length === 1,
    'Choose exactly one of --credential-file, --token-file or --token-env.',
  );
  if (!options.credentialFile) {
    const origin = options.origin === undefined ? undefined : validateBackendOrigin(options.origin);
    if (options.tokenEnv)
      requireAuth(
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(options.tokenEnv),
        'Invalid token environment variable name.',
      );
    let token;
    try {
      token = (
        options.tokenFile ? await readFile(options.tokenFile, 'utf8') : env[options.tokenEnv]
      )?.trim();
    } catch {
      throw new Error('Cannot read the selected token file.');
    }
    requireAuth(token && !/[\r\n]/.test(token), 'The selected token is missing or invalid.');
    return { origin, getToken: async () => token };
  }

  const filename = path.resolve(options.credentialFile);
  const expectedOrigin =
    options.origin === undefined ? undefined : validateBackendOrigin(options.origin);
  const first = await readCredentials(filename, expectedOrigin);
  const origin = expectedOrigin ?? first.origin;
  const fresh = (credentials) =>
    Date.parse(credentials.accessTokenExpiresAt) > now() + refreshEarlyMs;
  const requireLiveSession = (credentials) =>
    requireAuth(
      Date.parse(credentials.refreshTokenExpiresAt) > now(),
      'Native session expired. Sign in again.',
    );

  return {
    origin,
    async getToken() {
      const current = await readCredentials(filename, origin);
      requireLiveSession(current);
      if (fresh(current)) return current.accessToken;
      return withRefreshLock(filename, lockTimeoutMs, async () => {
        // Another agent may have rotated the refresh token while this process waited.
        const latest = await readCredentials(filename, origin);
        requireLiveSession(latest);
        if (fresh(latest)) return latest.accessToken;
        let payload;
        try {
          const response = await fetchImpl(`${origin}/api/native/v1/auth/refresh`, {
            method: 'POST',
            redirect: 'error',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refreshToken: latest.refreshToken }),
            signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
          });
          requireAuth(response.ok, 'refresh_rejected');
          payload = await response.json();
        } catch {
          throw new Error(
            'Native session refresh failed. Check the selected service or sign in again.',
          );
        }
        requireAuth(
          payload?.success && payload.data?.status === 'authorized',
          'Invalid native refresh response.',
        );
        const rotated = credentialsFrom({ ...payload.data, origin });
        requireAuth(
          rotated.sessionId === latest.sessionId &&
            Date.parse(rotated.accessTokenExpiresAt) > now() &&
            Date.parse(rotated.refreshTokenExpiresAt) > now(),
          'Native refresh returned an invalid session.',
        );
        await atomicSaveCredentials(filename, rotated);
        return rotated.accessToken;
      });
    },
  };
}
