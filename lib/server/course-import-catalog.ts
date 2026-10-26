import type { PrismaClient } from '@/lib/server/generated-prisma';
import { resolveCourseProblemImportAdmin } from '@/lib/server/course-problem-import-admin';
import {
  resolveCourseProblemImportGrant,
  courseProblemImportGrantAudit,
} from '@/lib/server/course-problem-import-grant';

export async function listBackendImportCourses(
  db: PrismaClient,
  principal: { userId: string; keyId?: string },
  input: { cursor?: string; limit: number },
) {
  const grant = resolveCourseProblemImportGrant({
    ...principal,
    courseId: '*',
    dataOwnerId: '',
    requireWildcard: true,
  });
  const admin = grant
    ? null
    : await resolveCourseProblemImportAdmin({
        db,
        userId: principal.userId,
        courseId: '*',
        dataOwnerId: '',
      });
  if (!grant && !admin) return null;
  const rows = await db.course.findMany({
    select: {
      id: true,
      name: true,
      organization: { select: { id: true, name: true } },
      notebookCount: true,
      problemCount: true,
      publishedProblemCount: true,
      updatedAt: true,
    },
    orderBy: { id: 'asc' },
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const courses = rows.slice(0, input.limit);
  return {
    courses,
    nextCursor: rows.length > input.limit ? (courses.at(-1)?.id ?? null) : null,
    actor: grant
      ? courseProblemImportGrantAudit(grant)
      : { kind: 'authenticated-admin', userId: principal.userId, keyId: principal.keyId },
    capabilities:
      grant?.capability === 'append-reviewed-problems'
        ? ['append-reviewed-problems']
        : ['append-reviewed-problems', 'append-reviewed-markdown-notes'],
  };
}

/** Course constraints for reviewed content preparation; never includes learner identities/data. */
export async function getBackendImportCourseContext(
  db: PrismaClient,
  principal: { userId: string; keyId?: string },
  courseId: string,
) {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      ownerId: true,
      name: true,
      language: true,
      description: true,
      tags: true,
      organization: { select: { id: true, name: true } },
      notebookCount: true,
      problemCount: true,
      publishedProblemCount: true,
      problemChapters: {
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, description: true, position: true },
      },
    },
  });
  if (!course) return null;
  const grant = resolveCourseProblemImportGrant({
    ...principal,
    courseId,
    dataOwnerId: course.ownerId,
  });
  const admin =
    grant || principal.userId === course.ownerId
      ? null
      : await resolveCourseProblemImportAdmin({
          db,
          userId: principal.userId,
          courseId,
          dataOwnerId: course.ownerId,
        });
  if (!grant && !admin && principal.userId !== course.ownerId) return null;
  const [hardRules, rulePacks] = await Promise.all([
    db.courseHardRule.findMany({
      where: { courseId, ownerId: course.ownerId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, content: true, position: true },
    }),
    db.courseRulePack.findMany({
      where: { courseId, status: 'active' },
      orderBy: [{ ruleSetKey: 'asc' }],
      select: {
        id: true,
        ruleSetKey: true,
        evaluatorKey: true,
        artifactKind: true,
        appliesTo: true,
        version: true,
        contractJson: true,
        sourceRefs: true,
        contentHash: true,
      },
    }),
  ]);
  const { ownerId: _ownerId, problemChapters, ...metadata } = course;
  return {
    course: { ...metadata, chapters: problemChapters, hardRules, rulePacks },
    actor: grant
      ? courseProblemImportGrantAudit(grant)
      : {
          kind: admin ? 'authenticated-admin' : 'course-owner',
          userId: principal.userId,
          keyId: principal.keyId,
          courseId,
          dataOwnerId: course.ownerId,
        },
  };
}
