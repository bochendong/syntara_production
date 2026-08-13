#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const apply = process.argv.includes('--apply');
const reset = process.argv.includes('--reset');

const contractPath = resolve(repositoryRoot, 'features/memory/domain/course-answer-contract.ts');
const compiled = ts.transpileModule(readFileSync(contractPath, 'utf8'), {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: contractPath,
});
const localModule = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', compiled.outputText)(
  require,
  localModule,
  localModule.exports,
  contractPath,
  dirname(contractPath),
);
const { COURSE_ANSWER_CONTRACT_REGISTRY } = localModule.exports;

const prisma = new PrismaClient();
try {
  const courses = await prisma.course.findMany({
    select: { id: true, name: true, courseCode: true },
    orderBy: { updatedAt: 'desc' },
  });
  const planned = courses.flatMap((course) => {
    const identity = `${course.courseCode || ''} ${course.name}`.toUpperCase();
    const contract = identity.includes('CSC108')
      ? COURSE_ANSWER_CONTRACT_REGISTRY.CSC108
      : identity.includes('CSC148')
        ? COURSE_ANSWER_CONTRACT_REGISTRY.CSC148
        : null;
    if (!contract) return [];
    return [
      {
        course,
        contract,
        ruleSetKey: `builtin:${contract.id}`,
        evaluatorKey:
          contract.courseCode === 'CSC108' ? 'python_function_contract' : 'python_class_contract',
        artifactKind: contract.courseCode === 'CSC108' ? 'python_function' : 'python_class',
      },
    ];
  });

  console.log(
    JSON.stringify(
      {
        mode: apply ? (reset ? 'reset-and-apply' : 'apply') : 'audit',
        matchedCourseCount: planned.length,
        courses: planned.map(({ course, contract, evaluatorKey }) => ({
          id: course.id,
          name: course.name,
          courseCode: course.courseCode,
          contractId: contract.id,
          evaluatorKey,
        })),
      },
      null,
      2,
    ),
  );
  if (!apply) process.exit(0);

  await prisma.$transaction(async (tx) => {
    if (reset) {
      await tx.courseRulePack.deleteMany({ where: { ruleSetKey: { startsWith: 'builtin:' } } });
    }
    for (const item of planned) {
      const contentHash = createHash('sha256').update(JSON.stringify(item.contract)).digest('hex');
      await tx.courseRulePack.upsert({
        where: {
          courseId_ruleSetKey: {
            courseId: item.course.id,
            ruleSetKey: item.ruleSetKey,
          },
        },
        create: {
          courseId: item.course.id,
          ruleSetKey: item.ruleSetKey,
          evaluatorKey: item.evaluatorKey,
          artifactKind: item.artifactKind,
          appliesTo: ['generation', 'code_review', 'grading'],
          version: item.contract.version,
          contractJson: item.contract,
          sourceRefs: item.contract.evidence,
          contentHash,
        },
        update: {
          evaluatorKey: item.evaluatorKey,
          artifactKind: item.artifactKind,
          appliesTo: ['generation', 'code_review', 'grading'],
          version: item.contract.version,
          status: 'active',
          contractJson: item.contract,
          sourceRefs: item.contract.evidence,
          contentHash,
        },
      });
    }
  });
  console.log(`[course-rule-packs] rebuilt ${planned.length} built-in course rule pack(s).`);
} finally {
  await prisma.$disconnect();
}
