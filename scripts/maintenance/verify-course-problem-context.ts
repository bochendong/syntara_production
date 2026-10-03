import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import type { TrustedCourseAccess } from '../../features/chat/server/trusted-course-turn';
import type { PrismaClient } from '../../lib/server/generated-prisma';

const access: TrustedCourseAccess = {
  userId: 'admin-teacher',
  role: 'owner',
  course: {
    id: 'course-1',
    ownerId: 'teacher-1',
    name: 'Calculus',
    description: null,
    language: 'zh-CN',
    purpose: 'university',
    tags: [],
    university: null,
    courseCode: null,
    notebookCount: 8,
    problemCount: 1,
  },
};
let enrollmentReads = 0;
let problemReads = 0;
const db = {
  courseEnrollment: {
    findUnique: async () => {
      enrollmentReads++;
      return null;
    },
  },
  notebookProblem: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      problemReads++;
      assert.deepEqual(where.OR, [
        { courseId: 'course-1' },
        { notebook: { courseId: 'course-1' } },
      ]);
      assert.equal('status' in where, false);
      if (where.id !== 'problem-143') return null;
      return {
        id: 'problem-143',
        title: 'A Tangent Equation and a Power-Function Limit',
        publicContentJson: { stem: 'Find the tangent equation.' },
        updatedAt: new Date(0),
      };
    },
  },
  studyMemory: { findMany: async () => [] },
} as unknown as PrismaClient;

async function verify() {
  const jiti = createJiti(import.meta.url, {
    alias: { '@': fileURLToPath(new URL('../..', import.meta.url)) },
  });
  const { prepareCourseTurnContext } = await jiti.import<
    typeof import('../../features/chat/server/turn-context')
  >('../../features/chat/server/turn-context.ts');
  // The course has zero students. A teacher/admin can still read a draft problem,
  // even if the model erroneously fills the optional studentId field.
  for (const studentId of [undefined, access.userId, 'problem-143']) {
    const selection = { source: 'problem' as const, problemId: 'problem-143', studentId };
    const context = await prepareCourseTurnContext({ db, access, selection });
    assert.equal(context?.evidence[0].id, 'problem-143');
    assert.equal(context?.selection.studentId, undefined);
    assert.equal(selection.studentId, studentId, 'must not mutate caller input');
  }
  assert.equal(enrollmentReads, 0);
  assert.equal(problemReads, 3);
  await assert.rejects(
    prepareCourseTurnContext({
      db,
      access,
      selection: { source: 'problem', problemId: 'outside-course', studentId: access.userId },
    }),
    /题目不属于当前可访问范围/,
  );
  // Student analytics and attempts still require a real active enrollment.
  await assert.rejects(
    prepareCourseTurnContext({
      db,
      access,
      selection: { source: 'teacher-student', studentId: 'missing-student' },
    }),
    /当前课程没有这名有效学生/,
  );
  await assert.rejects(
    prepareCourseTurnContext({
      db,
      access,
      selection: {
        source: 'problem',
        problemId: 'problem-143',
        attemptId: 'attempt-1',
        studentId: 'missing-student',
      },
    }),
    /当前课程没有这名有效学生/,
  );
  assert.equal(enrollmentReads, 2);
  await assert.rejects(
    prepareCourseTurnContext({
      db,
      access,
      selection: { source: 'problem-attempt', attemptId: 'attempt-1' },
    }),
    /查看作答必须同时指定学生/,
  );
  await assert.rejects(
    prepareCourseTurnContext({
      db,
      access: { ...access, role: 'enrolled', userId: 'student-1' },
      selection: { source: 'problem', problemId: 'problem-143', studentId: 'student-2' },
    }),
    /不能读取其他学生/,
  );
  assert.equal(enrollmentReads, 2);
  console.log(
    'PASS: teacher/admin problem reads, empty enrollment, course scope, and student/attempt access guards.',
  );
}

void verify();
