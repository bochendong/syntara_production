#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const courseIds = Array.from(
  new Set(
    process.argv
      .slice(2)
      .map((value) => value.trim())
      .filter(Boolean),
  ),
);

if (courseIds.length === 0) {
  throw new Error('Pass at least one course ID.');
}

const dedupeModuleUrl = pathToFileURL(
  path.join(process.cwd(), 'features/problems/domain/problem-dedupe.ts'),
).href;
const { courseProblemDedupeKey } = await import(dedupeModuleUrl);

const prisma = new PrismaClient();

try {
  const reports = [];
  for (const courseId of courseIds) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, name: true },
    });
    if (!course) throw new Error(`Course not found: ${courseId}`);

    const rows = await prisma.notebookProblem.findMany({
      where: {
        OR: [{ courseId }, { courseId: null, notebook: { courseId } }],
      },
      select: {
        id: true,
        title: true,
        type: true,
        publicContentJson: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const canonicalProblemIdByKey = new Map();
    const duplicateGroupsByKey = new Map();
    const invalidProblemIds = [];

    for (const row of rows) {
      let dedupeKey;
      try {
        dedupeKey = courseProblemDedupeKey({
          title: row.title,
          type: row.type,
          publicContent: row.publicContentJson,
        });
      } catch {
        invalidProblemIds.push(row.id);
        continue;
      }

      const canonicalProblemId = canonicalProblemIdByKey.get(dedupeKey);
      if (!canonicalProblemId) {
        canonicalProblemIdByKey.set(dedupeKey, row.id);
        continue;
      }
      const group = duplicateGroupsByKey.get(dedupeKey) ?? {
        canonicalProblemId,
        duplicateProblemIds: [],
      };
      group.duplicateProblemIds.push(row.id);
      duplicateGroupsByKey.set(dedupeKey, group);
    }

    reports.push({
      courseId,
      courseName: course.name,
      problemCount: rows.length,
      fingerprintedCount: canonicalProblemIdByKey.size,
      duplicateGroupCount: duplicateGroupsByKey.size,
      duplicateRowCount: Array.from(duplicateGroupsByKey.values()).reduce(
        (total, group) => total + group.duplicateProblemIds.length,
        0,
      ),
      invalidProblemCount: invalidProblemIds.length,
      invalidProblemIds,
      duplicateGroups: Array.from(duplicateGroupsByKey.values()),
    });
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        mode: 'read_only',
        courseCount: reports.length,
        totalProblemCount: reports.reduce((total, report) => total + report.problemCount, 0),
        reports,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await prisma.$disconnect();
}
