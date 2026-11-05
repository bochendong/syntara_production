import { spawnSync } from 'node:child_process';

// The public home page embeds real App pages (problem bank, classroom, notes,
// memories, calendar) filled with bundled demo content. Built for every
// environment because the home page is public everywhere.
const result = spawnSync(
  'pnpm',
  ['--filter', '@syntara/native', 'exec', 'vite', 'build', '--config', 'vite.showcase.config.ts'],
  { stdio: 'inherit', env: { ...process.env, VITE_SYNTARA_SHOWCASE: '1' } },
);
process.exit(result.status ?? 1);
