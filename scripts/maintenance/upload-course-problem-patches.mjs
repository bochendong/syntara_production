#!/usr/bin/env node

/**
 * Preview or apply existing draft-problem revisions in one course.
 * Apply always downloads a fresh, complete course backup first.
 *
 * Usage: node --env-file=.env.local scripts/maintenance/upload-course-problem-patches.mjs PATCH.json [--apply]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const here = dirname(fileURLToPath(import.meta.url));
const upload = createJiti(import.meta.url, { interopDefault: true })(
  join(here, '../../lib/server/admin-course-problem-upload.ts'),
);

const patchPath = process.argv[2];
const apply = process.argv[3] === '--apply';
if (!patchPath || process.argv.length > (apply ? 4 : 3)) {
  console.error(
    'Usage: node --env-file=.env.local scripts/maintenance/upload-course-problem-patches.mjs PATCH.json [--apply]',
  );
  process.exit(2);
}

const input = JSON.parse(readFileSync(patchPath, 'utf8'));
const parsed = upload.courseProblemUploadSchema.parse(input);
const db = new PrismaClient();
try {
  const preview = await upload.previewCourseProblemUpload(db, parsed);
  if (!apply) {
    console.log(JSON.stringify({ mode: 'preview', ...preview }, null, 2));
  } else {
    const backup = spawnSync(
      process.execPath,
      [join(here, 'download-course-materials.mjs'), parsed.courseId],
      { encoding: 'utf8', maxBuffer: 2_000_000 },
    );
    if (backup.status !== 0) {
      throw new Error(`Course backup failed: ${backup.stderr || backup.stdout}`);
    }
    const backupInfo = JSON.parse(backup.stdout);
    if (backupInfo.manifest?.courses?.[0]?.id !== parsed.courseId) {
      throw new Error('Course backup did not match upload target');
    }
    const result = await upload.applyCourseProblemUpload(db, parsed);
    console.log(JSON.stringify({ mode: 'applied', backup: backupInfo.output, ...result }, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
