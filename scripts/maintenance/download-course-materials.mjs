#!/usr/bin/env node

/**
 * Download one course from the configured database using the same archive
 * builder as the authenticated admin download endpoint. Read-only.
 *
 * Usage: node --env-file=.env.local scripts/maintenance/download-course-materials.mjs COURSE_ID [OUTPUT.zip]
 */
import { readFileSync } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const courseId = process.argv[2];
if (!courseId || !/^[A-Za-z0-9_-]+$/.test(courseId) || process.argv.length > 4) {
  console.error(
    'Usage: node --env-file=.env.local scripts/maintenance/download-course-materials.mjs COURSE_ID [OUTPUT.zip]',
  );
  process.exitCode = 2;
} else {
  const output = resolve(
    process.argv[3] ??
      join(
        tmpdir(),
        'syntara-course-audits',
        `${courseId}-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
      ),
  );
  if (!output.endsWith('.zip')) {
    console.error('Output path must end in .zip');
    process.exitCode = 2;
  } else {
    const source = readFileSync(
      new URL('../../lib/server/admin-course-export.ts', import.meta.url),
      'utf8',
    );
    const compiled = ts.transpileModule(source, {
      fileName: 'admin-course-export.ts',
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(require, loaded, loaded.exports);
    const { buildAdminCourseArchive } = loaded.exports;
    const db = new PrismaClient();
    try {
      const course = await db.course.findUnique({
        where: { id: courseId },
        select: { id: true, name: true },
      });
      if (!course) throw new Error(`Course not found: ${courseId}`);
      await mkdir(dirname(output), { recursive: true, mode: 0o700 });
      const zip = await buildAdminCourseArchive(db, [course.id]);
      const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
      let created = false;
      try {
        const handle = await open(output, 'wx', 0o600);
        created = true;
        await pipeline(
          zip.generateNodeStream({
            streamFiles: true,
            compression: 'DEFLATE',
            compressionOptions: { level: 3 },
          }),
          handle.createWriteStream(),
        );
      } catch (error) {
        if (created) await rm(output, { force: true });
        throw error;
      }
      console.log(JSON.stringify({ output, course: course.name, manifest }, null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      await db.$disconnect();
    }
  }
}
