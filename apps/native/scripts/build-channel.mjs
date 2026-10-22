import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const channel = process.argv[2];
if (channel !== 'staging') throw new Error('Supported channel: staging');
const origin = new URL(
  process.env.SYNTARA_STAGING_API_ORIGIN ||
    'https://native-api-staging-staging-95a1.up.railway.app',
);
if (
  origin.protocol !== 'https:' ||
  origin.username ||
  origin.password ||
  origin.href !== `${origin.origin}/`
) {
  throw new Error('The staging API must be an HTTPS origin without credentials or a path.');
}
const cwd = fileURLToPath(new URL('..', import.meta.url));
const guard = spawnSync(
  process.execPath,
  [path.join(cwd, '../../scripts/maintenance/verify-native-staging-source.mjs')],
  { cwd, stdio: 'inherit' },
);
if (guard.error) throw guard.error;
if (guard.status !== 0) process.exit(guard.status ?? 1);

const result = spawnSync(
  'pnpm',
  ['exec', 'tauri', 'build', '--bundles', 'app', '--config', 'src-tauri/tauri.staging.conf.json'],
  {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_SYNTARA_CHANNEL: channel,
      SYNTARA_NATIVE_API_BASE_URL: origin.origin,
      CARGO_TARGET_DIR: path.join(cwd, 'src-tauri/target', channel),
    },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
