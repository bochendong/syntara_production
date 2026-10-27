import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
const [method, path, file] = process.argv.slice(2);
if (
  !['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ||
  !(path === '/v1/courses' || path?.startsWith('/v1/courses/')) ||
  (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && !file)
) {
  console.error(
    'Usage: node scripts/staging-admin/cli.mjs METHOD /v1/courses/COURSE_ID/... [body.json]',
  );
  process.exit(2);
}
const token = await readFile(join(homedir(), '.codex', 'syntara-staging-admin', 'token'), 'utf8');
const content = file ? await readFile(file, 'utf8') : undefined;
const response = await fetch(`http://127.0.0.1:8766${path}`, {
  method,
  headers: {
    Authorization: `Bearer ${token}`,
    ...(content ? { 'Content-Type': 'application/json' } : {}),
  },
  body: content,
});
const output = await response.text();
console.log(output);
if (!response.ok) process.exitCode = 1;
