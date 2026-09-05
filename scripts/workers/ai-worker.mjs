import { createJiti } from 'jiti';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnvConfig } = createRequire(require.resolve('next/package.json'))('@next/env');
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
const root = fileURLToPath(new URL('../../', import.meta.url));
loadEnvConfig(root, process.env.NODE_ENV !== 'production');
const jiti = createJiti(import.meta.url, { alias: { '@': root }, interopDefault: true });
const { runNextBackgroundJob } = await jiti.import(
  '../../features/background-jobs/server/worker.ts',
);
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
if (!process.env.DATABASE_URL) throw new Error('AI worker requires DATABASE_URL');
console.info('[ai-worker] ready');
while (!stopping) {
  try {
    if (await runNextBackgroundJob()) continue;
  } catch (error) {
    console.error('[ai-worker]', error instanceof Error ? error.message : error);
  }
  await setTimeout(3000);
}
process.exit(0);
