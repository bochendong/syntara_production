import { spawnSync } from 'node:child_process';

const explicitDatabaseMigration = process.env.RUN_DATABASE_MIGRATIONS === '1';
if (
  process.env.VERCEL !== '1' ||
  (process.env.VERCEL_ENV !== 'production' && !explicitDatabaseMigration)
) {
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
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

console.log('[deploy] Generating Prisma client for post-migration data rebuild.');
const generate = spawnSync(command, ['exec', 'prisma', 'generate'], {
  env: process.env,
  stdio: 'inherit',
});
if (generate.error || (generate.status ?? 1) !== 0) {
  console.error('[deploy] Failed to generate Prisma client after migration.');
  process.exit(generate.status ?? 1);
}

console.log('[deploy] Rebuilding database-backed course rule packs.');
const rebuildArgs = [
  'exec',
  'node',
  'scripts/maintenance/rebuild-course-rule-packs.mjs',
  '--apply',
  ...(explicitDatabaseMigration ? ['--reset'] : []),
];
const rebuild = spawnSync(command, rebuildArgs, { env: process.env, stdio: 'inherit' });
if (rebuild.error) {
  console.error('[deploy] Failed to start course rule rebuild:', rebuild.error.message);
  process.exit(1);
}
process.exit(rebuild.status ?? 1);
