import { spawnSync } from 'node:child_process';

const explicitDatabaseMigration = process.env.RUN_DATABASE_MIGRATIONS === '1';
const isVercelProductionBuild =
  process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production';
if (!isVercelProductionBuild && !explicitDatabaseMigration) {
  console.log('[deploy] Skipping Vercel production migrations outside a production Vercel build.');
  process.exit(0);
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error('[deploy] DATABASE_URL is required for Vercel production migrations.');
  process.exit(1);
}

const deploymentEnvironment = process.env.SYNTARA_DEPLOYMENT_ENV?.trim();
if (!['development', 'production'].includes(deploymentEnvironment)) {
  console.error(
    '[deploy] SYNTARA_DEPLOYMENT_ENV must be either "development" or "production" before database migrations can run.',
  );
  process.exit(1);
}

const expectedDatabaseHost = process.env.EXPECTED_DATABASE_HOST?.trim();
if (!expectedDatabaseHost) {
  console.error('[deploy] EXPECTED_DATABASE_HOST is required before database migrations can run.');
  process.exit(1);
}

let actualDatabaseHost;
try {
  actualDatabaseHost = new URL(process.env.DATABASE_URL).host;
} catch {
  console.error('[deploy] DATABASE_URL is not a valid URL.');
  process.exit(1);
}

if (actualDatabaseHost !== expectedDatabaseHost) {
  console.error(
    `[deploy] Refusing to migrate ${deploymentEnvironment}: DATABASE_URL points to ${actualDatabaseHost}, expected ${expectedDatabaseHost}.`,
  );
  process.exit(1);
}

console.log(
  `[deploy] Database target verified for ${deploymentEnvironment} (${actualDatabaseHost}). Applying committed Prisma migrations.`,
);
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
