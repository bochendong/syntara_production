#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const SNAPSHOT_FORMAT = 'syntara-native-problem-snapshot';
const SNAPSHOT_SCHEMA_VERSION = 1;
const DEFAULT_SNAPSHOT_ID = 'production-problem-bank-2026-07-28';
const DEFAULT_OUTPUT = 'apps/native/src/data/snapshots/production-problem-bank.v1.json';

const coursePlan = [
  {
    sourceCourseId: 'cmpanemia001v8ouzmhttvkrn',
    localCourseId: 'course-mat136-local',
    expectedCourseCode: 'MAT136',
    localName: 'MAT136 · 积分学',
    localDescription: 'Calculus II 本地题库快照，可在无网络和无数据库时直接学习。',
    tags: ['积分', '微积分'],
  },
  {
    sourceCourseId: 'cmqjfarz800158oi68s595q9n',
    localCourseId: 'course-csc148-local',
    expectedCourseCode: 'CSC148',
    localName: 'CSC148 · 数据结构',
    localDescription: '面向对象程序设计、递归与数据结构的本地题库快照。',
    tags: ['Python', '数据结构'],
  },
  {
    sourceCourseId: 'cmpd5bird007v8ogmjuuiio03',
    localCourseId: 'course-mat102-local',
    expectedCourseCode: 'MAT102',
    localName: 'MAT102 · 数学证明',
    localDescription: '命题逻辑、集合、关系、函数与数论的本地题库快照。',
    tags: ['数学证明', '离散数学'],
  },
  {
    sourceCourseId: 'cmpnueg4p001d8o017jee1mjq',
    localCourseId: 'course-csc108-local',
    expectedCourseCode: 'CSC108',
    localName: 'CSC108 · 程序设计',
    localDescription: 'Python 程序设计基础与函数设计的本地题库快照。',
    tags: ['Python', '程序设计'],
  },
];

function option(name) {
  const inlinePrefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalizeCourseCode(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
}

function timestamp(value) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function jsonRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalProblem(problem, localCourseId) {
  return {
    id: `snapshot:${problem.id}`,
    courseId: localCourseId,
    notebookId: null,
    title: problem.title,
    type: problem.type,
    status: 'published',
    difficulty: problem.difficulty,
    tags: Array.isArray(problem.tags) ? problem.tags : [],
    publicContent: jsonRecord(problem.publicContentJson),
    grading: jsonRecord(problem.gradingJson),
    createdAt: timestamp(problem.createdAt),
    updatedAt: timestamp(problem.updatedAt),
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const sourceCourseIds = coursePlan.map((course) => course.sourceCourseId);
    const [sourceCourses, sourceProblems] = await Promise.all([
      prisma.course.findMany({
        where: { id: { in: sourceCourseIds } },
        select: {
          id: true,
          name: true,
          description: true,
          language: true,
          purpose: true,
          university: true,
          courseCode: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.notebookProblem.findMany({
        where: {
          courseId: { in: sourceCourseIds },
          status: 'published',
        },
        select: {
          id: true,
          courseId: true,
          title: true,
          type: true,
          difficulty: true,
          tags: true,
          publicContentJson: true,
          gradingJson: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ courseId: 'asc' }, { order: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const sourceCourseById = new Map(sourceCourses.map((course) => [course.id, course]));
    const sourceProblemsByCourseId = new Map();
    for (const problem of sourceProblems) {
      const rows = sourceProblemsByCourseId.get(problem.courseId) ?? [];
      rows.push(problem);
      sourceProblemsByCourseId.set(problem.courseId, rows);
    }
    const courses = [];
    const problems = [];

    for (const plannedCourse of coursePlan) {
      const course = sourceCourseById.get(plannedCourse.sourceCourseId);
      if (!course) {
        throw new Error(`找不到生产课程 ${plannedCourse.sourceCourseId}`);
      }
      if (
        normalizeCourseCode(course.courseCode) !==
        normalizeCourseCode(plannedCourse.expectedCourseCode)
      ) {
        throw new Error(
          `课程 ${course.id} 的代码是 ${course.courseCode ?? '空'}，预期为 ${plannedCourse.expectedCourseCode}`,
        );
      }

      const courseProblems = sourceProblemsByCourseId.get(course.id) ?? [];
      if (!courseProblems.length) {
        throw new Error(`课程 ${plannedCourse.expectedCourseCode} 没有已发布题目，拒绝生成空快照`);
      }

      courses.push({
        id: plannedCourse.localCourseId,
        sourceCourseId: course.id,
        sourceName: course.name,
        name: plannedCourse.localName,
        description: plannedCourse.localDescription,
        language: course.language === 'en-US' ? 'en-US' : 'zh-CN',
        tags: plannedCourse.tags,
        purpose: course.purpose,
        university: course.university,
        courseCode: plannedCourse.expectedCourseCode,
        problemCount: courseProblems.length,
        createdAt: timestamp(course.createdAt),
        updatedAt: timestamp(course.updatedAt),
      });
      problems.push(
        ...courseProblems.map((problem) => canonicalProblem(problem, plannedCourse.localCourseId)),
      );
    }

    const snapshotId = option('snapshot-id') || DEFAULT_SNAPSHOT_ID;
    const payload = { courses, problems };
    const snapshot = {
      format: SNAPSHOT_FORMAT,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      snapshotId,
      exportedAt: Date.now(),
      source: {
        kind: 'production-postgresql',
        scope: 'published-course-problems',
        excludes: ['NotebookProblemSecret', 'accounts', 'messages', 'user progress'],
      },
      integrity: {
        algorithm: 'sha256',
        value: sha256(JSON.stringify(payload)),
      },
      ...payload,
    };
    const outputPath = path.resolve(option('output') || DEFAULT_OUTPUT);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

    console.log(
      JSON.stringify(
        {
          output: outputPath,
          snapshotId,
          integrity: snapshot.integrity.value,
          courses: Object.fromEntries(
            courses.map((course) => [course.courseCode, course.problemCount]),
          ),
          problems: problems.length,
          excludes: snapshot.source.excludes,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
