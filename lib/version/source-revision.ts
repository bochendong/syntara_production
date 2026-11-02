import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Source exports have no .git directory; the exporter records the reviewed commit. */
export function readBuildRevision(
  root = process.cwd(),
  environmentRevision = process.env.RAILWAY_GIT_COMMIT_SHA,
): string | null {
  let exported: unknown;
  try {
    exported = JSON.parse(readFileSync(join(root, 'source-revision.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return environmentRevision || null;
  }
  const revision = (exported as { revision?: unknown })?.revision;
  if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision))
    throw new Error('Invalid exported source revision');
  return revision;
}
