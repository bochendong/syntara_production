import { spawn } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, unlink, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const project = '8cddd1ea-24e1-49a9-8d27-dce86069dc8b';
const environment = '6697de1f-eb0d-4a6f-8709-cfe477a29f11';
const service = 'staging-postgres';
const tokenDir = join(homedir(), '.codex', 'syntara-staging-admin');
const tokenFile = join(tokenDir, 'token');
const token = randomBytes(32).toString('hex');
const tunnelPort = 15433;
const checkPort = (port) =>
  new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
if (!(await checkPort(tunnelPort)) || !(await checkPort(8766)))
  throw Error('A required local port (15433 or 8766) is already in use.');
await mkdir(tokenDir, { recursive: true, mode: 0o700 });
await chmod(tokenDir, 0o700);
try {
  await writeFile(tokenFile, token, { mode: 0o600, flag: 'wx' });
} catch (e) {
  if (e.code === 'EEXIST')
    throw Error(
      `Token file ${tokenFile} already exists; stop the other server or remove the stale file.`,
    );
  throw e;
}
const args = ['dlx', '@railway/cli'];
const tunnel = spawn(
  'pnpm',
  [
    ...args,
    'connect',
    service,
    '--project',
    project,
    '--environment',
    environment,
    '--tunnel-only',
    '--port',
    String(tunnelPort),
  ],
  { stdio: ['ignore', 'ignore', 'ignore'], detached: process.platform !== 'win32' },
);
let api;
let cleaned = false;
async function cleanup(code) {
  if (cleaned) return;
  cleaned = true;
  for (const child of [api, tunnel]) {
    if (!child?.pid) continue;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
  await unlink(tokenFile).catch(() => {});
  process.exit(code);
}
process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));
tunnel.on('error', () => cleanup(1));
tunnel.on('exit', () => {
  if (!cleaned) {
    console.error('Railway staging tunnel stopped. Check Railway login and registered SSH key.');
    cleanup(1);
  }
});
async function reachable() {
  return new Promise((resolve) => {
    const s = createConnection({ host: '127.0.0.1', port: tunnelPort });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
}
let connected = false;
for (let i = 0; i < 100 && !cleaned; i++) {
  if (await reachable()) {
    connected = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!connected) {
  console.error('Could not start the staging database tunnel.');
  await cleanup(1);
}
api = spawn(
  'pnpm',
  [
    ...args,
    'run',
    '--project',
    project,
    '--environment',
    environment,
    '--service',
    service,
    '--',
    'node',
    'scripts/staging-admin/server.mjs',
  ],
  {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      SYNTARA_STAGING_ADMIN_TOKEN: token,
      SYNTARA_STAGING_TUNNEL_PORT: String(tunnelPort),
    },
  },
);
console.log(`Local CLI authentication file: ${tokenFile}`);
api.on('error', () => cleanup(1));
api.on('exit', (code) => cleanup(code ?? 1));
