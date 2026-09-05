// Both processes share Railway's lifecycle; a worker failure restarts the service.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnvConfig } = createRequire(require.resolve('next/package.json'))('@next/env');
const dev = process.argv.includes('--dev');
const forwardedArgs = process.argv.slice(2).filter((arg) => arg !== '--dev' && arg !== '--');
loadEnvConfig(process.cwd(), dev);
const children = [
  spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      ...(dev ? ['dev', '--turbo'] : ['start']),
      ...forwardedArgs,
    ],
    { stdio: 'inherit' },
  ),
  ...(process.env.DATABASE_URL
    ? [
        spawn(process.execPath, ['scripts/workers/ai-worker.mjs'], {
          stdio: 'inherit',
          env: { ...process.env, NODE_ENV: dev ? 'development' : 'production' },
        }),
      ]
    : []),
];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  const timer = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 10_000);
  timer.unref();
  Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once('exit', resolve);
        }),
    ),
  ).then(() => process.exit(code));
}
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', (code) => stop(code || 1));
}
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
