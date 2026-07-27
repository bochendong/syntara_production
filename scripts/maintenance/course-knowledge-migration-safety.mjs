import fs from 'node:fs';
import path from 'node:path';

export function loadCourseKnowledgeMigrationEnv(
  root = process.cwd(),
  names = ['.env', '.env.local'],
) {
  for (const name of names) {
    const envPath = path.join(root, name);
    if (!fs.existsSync(envPath)) continue;

    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
      if (!match || line.trim().startsWith('#')) continue;

      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] ??= value;
    }
  }
}

export function hasCourseKnowledgeMigrationFlag(name) {
  return process.argv.includes(`--${name}`);
}

export function selectedCourseId() {
  const prefix = '--course-id=';
  const value = process.argv
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
  return value || null;
}

export function assertCourseKnowledgeMigrationWriteAllowed(scriptName) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(`${scriptName} requires DATABASE_URL.`);
  }
  if (!hasCourseKnowledgeMigrationFlag('apply')) {
    throw new Error(`${scriptName} is dry-run by default. Pass --apply to enable writes.`);
  }

  let hostname = '';
  try {
    hostname = new URL(databaseUrl).hostname;
  } catch {
    throw new Error(`${scriptName} found an invalid DATABASE_URL.`);
  }

  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  const allowRemote =
    process.env.ALLOW_REMOTE_COURSE_KNOWLEDGE_MIGRATION === '1' ||
    hasCourseKnowledgeMigrationFlag('allow-remote-course-knowledge-migration');
  if (!isLocal && !allowRemote) {
    throw new Error(
      [
        `${scriptName} refused to update a non-local database (${hostname}).`,
        'Confirm the target, then set ALLOW_REMOTE_COURSE_KNOWLEDGE_MIGRATION=1',
        'or pass --allow-remote-course-knowledge-migration.',
      ].join(' '),
    );
  }
}

export function databaseHostname() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return 'unconfigured';
  try {
    return new URL(databaseUrl).hostname || 'unknown';
  } catch {
    return 'invalid';
  }
}
