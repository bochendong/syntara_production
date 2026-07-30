import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationPath = path.join(
  root,
  'prisma/migrations/20260730010000_repair_course_notebook_counts/migration.sql',
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const repository = fs.readFileSync(
  path.join(root, 'lib/server/repositories/notebook-repository.ts'),
  'utf8',
);
const databaseVerifier = fs.readFileSync(
  path.join(root, 'scripts/maintenance/verify-course-notebook-counts.sql'),
  'utf8',
);

const expectedAppliedChecksum = '85d7c68642780ae3cacf4845fc086d1f6b4f7cf4dbc388496d41485a618fb6c2';
const actualChecksum = crypto.createHash('sha256').update(migration).digest('hex');
assert.equal(
  actualChecksum,
  expectedAppliedChecksum,
  'The applied notebook-count migration must remain immutable',
);

assert.match(
  migration,
  /UPDATE "Course" AS course[\s\S]*course\."notebookCount" IS DISTINCT FROM counts\."notebookCount"/,
);
assert.match(migration, /AFTER INSERT OR DELETE OR UPDATE OF "courseId" ON "Notebook"/);

const refreshStart = repository.indexOf('export async function refreshCourseSummaryFields');
const refreshEnd = repository.indexOf('\nconst notebookListSelect', refreshStart);
assert.ok(refreshStart >= 0 && refreshEnd > refreshStart);
const refreshBody = repository.slice(refreshStart, refreshEnd);
assert.doesNotMatch(
  refreshBody,
  /\bnotebookCount\s*:/,
  'Course summary refresh must not race the database trigger',
);
assert.doesNotMatch(
  refreshBody,
  /_count:\s*\{\s*_all:/,
  'Course summary refresh no longer needs a Notebook count aggregation',
);

assert.match(databaseVerifier, /finished_at IS NOT NULL/);
assert.match(databaseVerifier, /trigger_row\.tgenabled = 'O'/);
assert.match(databaseVerifier, /Course notebook count mismatch count is/);
assert.match(databaseVerifier, /Notebook INSERT trigger probe failed/);
assert.match(databaseVerifier, /Notebook DELETE trigger probe failed/);
assert.match(databaseVerifier, /ROLLBACK;/);

console.log('course notebook-count contracts: OK');
console.log(`applied migration checksum: ${actualChecksum}`);
console.log('runtime notebookCount writer: database trigger only');
