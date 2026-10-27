import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
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
if (result.status !== 0) process.exit(result.status ?? 1);
// This isolated browser check uses normal Google staging authentication and never saves attempts.
copyFileSync(
  new URL('../qa/native-grading-check.html', import.meta.url),
  new URL('../../public/native-web/grading-check.html', import.meta.url),
);
process.exit(0);
