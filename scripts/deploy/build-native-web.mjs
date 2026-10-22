import { spawnSync } from 'node:child_process';
if (
  process.env.SYNTARA_APP_ENV !== 'staging' ||
  process.env.SYNTARA_NATIVE_ACCESS_POLICY !== 'google-test'
) {
  console.log('Native web: skipped outside Google staging.');
  process.exit(0);
}
const result = spawnSync(
  'pnpm',
  [
    '--filter',
    '@syntara/native',
    'exec',
    'vite',
    'build',
    '--base',
    '/native-web/',
    '--outDir',
    '../../public/native-web',
    '--emptyOutDir',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, VITE_SYNTARA_CHANNEL: 'staging', VITE_SYNTARA_WEB_APP: '1' },
  },
);
process.exit(result.status ?? 1);
