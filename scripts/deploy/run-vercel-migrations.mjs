import { spawnSync } from 'node:child_process';

if (process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production') {
  console.log('[deploy] Skipping Vercel production migrations outside a production Vercel build.');
  process.exit(0);
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error('[deploy] DATABASE_URL is required for Vercel production migrations.');
  process.exit(1);
}

console.log('[deploy] Applying committed Prisma migrations before the production build.');
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(command, ['exec', 'prisma', 'migrate', 'deploy'], {
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error('[deploy] Failed to start Prisma migration:', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
