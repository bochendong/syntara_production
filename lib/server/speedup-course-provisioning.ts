import { prisma } from '@/lib/server/prisma';
import {
  listSpeedupCoursesForUser,
  SpeedupSsoError,
  type SpeedupCourse,
} from '@/lib/server/speedup-sso';

const SPEEDUP_PROVIDER = 'speedup';

type SpeedupMembershipRole = 'TEACHER' | 'STUDENT';

function speedupCourseKey(course: Pick<SpeedupCourse, 'campusCode' | 'id'>): string {
  return `${course.campusCode}:${course.id}`;
}

export type SpeedupTeacherCourseOption = SpeedupCourse & {
  isActivated: boolean;
  ownedByCurrentTeacher: boolean;
  localCourseId: string | null;
};

/**
 * Refresh the current Speedup user's external course memberships before an
 * access-sensitive read. A successful empty upstream list intentionally
 * revokes every cached membership; local courses and learning history remain.
 */
export async function reconcileSpeedupCourseMembershipsForUser(
  userId: string,
): Promise<'refreshed' | 'skipped'> {
  const speedupAccount = await prisma.account.findFirst({
    where: { userId, provider: SPEEDUP_PROVIDER },
    select: { user: { select: { role: true } } },
  });
  if (!speedupAccount) return 'skipped';

  const role = speedupAccount.user.role;
  if (role !== 'STUDENT' && role !== 'TEACHER') return 'skipped';

  const courses = await listSpeedupCoursesForUser(userId, role);
  await syncSpeedupCourseMemberships(userId, role, courses);
  return 'refreshed';
}

export async function syncSpeedupCourseMemberships(
  userId: string,
  role: SpeedupMembershipRole,
  courses: SpeedupCourse[],
) {
  const uniqueCourses = Array.from(
    new Map(courses.map((course) => [speedupCourseKey(course), course] as const)).values(),
  );
  const bindings = uniqueCourses.length
    ? await prisma.externalCourseBinding.findMany({
        where: {
          provider: SPEEDUP_PROVIDER,
          OR: uniqueCourses.map((course) => ({
            campusCode: course.campusCode,
            externalCourseId: course.id,
          })),
        },
        select: {
          id: true,
          courseId: true,
          campusCode: true,
          externalCourseId: true,
          course: { select: { ownerId: true } },
        },
      })
    : [];
  const verifiedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.externalCourseMembership.updateMany({
      where: {
        userId,
        role,
        active: true,
        binding: { provider: SPEEDUP_PROVIDER },
      },
      data: { active: false, revokedAt: verifiedAt, lastVerifiedAt: verifiedAt },
    });
    for (const binding of bindings) {
      if (role === 'TEACHER' && binding.course.ownerId !== userId) {
        const previousOwnerId = binding.course.ownerId;
        await Promise.all([
          tx.course.update({ where: { id: binding.courseId }, data: { ownerId: userId } }),
          tx.courseHardRule.updateMany({
            where: { courseId: binding.courseId, ownerId: previousOwnerId },
            data: { ownerId: userId },
          }),
          tx.notebook.updateMany({
            where: { courseId: binding.courseId, ownerId: previousOwnerId },
            data: { ownerId: userId },
          }),
          tx.problemImportBatch.updateMany({
            where: { courseId: binding.courseId, ownerId: previousOwnerId },
            data: { ownerId: userId },
          }),
          tx.courseSource.updateMany({
            where: { courseId: binding.courseId, ownerId: previousOwnerId },
            data: { ownerId: userId },
          }),
          tx.knowledgeDocument.updateMany({
            where: { courseId: binding.courseId, ownerId: previousOwnerId },
            data: { ownerId: userId },
          }),
          tx.knowledgeChunk.updateMany({
            where: { courseId: binding.courseId, ownerId: previousOwnerId },
            data: { ownerId: userId },
          }),
          tx.studyMemory.updateMany({
            where: { courseId: binding.courseId, ownerId: previousOwnerId },
            data: { ownerId: userId },
          }),
          tx.studyMemoryChunk.updateMany({
            where: { courseId: binding.courseId, ownerId: previousOwnerId },
            data: { ownerId: userId },
          }),
          tx.memoryKnowledgeCache.updateMany({
            where: { courseId: binding.courseId, ownerId: previousOwnerId },
            data: { ownerId: userId },
          }),
        ]);
      }
      await tx.externalCourseMembership.upsert({
        where: {
          bindingId_userId_role: { bindingId: binding.id, userId, role },
        },
        update: { active: true, revokedAt: null, lastVerifiedAt: verifiedAt },
        create: {
          bindingId: binding.id,
          userId,
          role,
          active: true,
          lastVerifiedAt: verifiedAt,
        },
      });
    }
  });

  return bindings;
}

function parseAcademicPeriod(termName: string | null): {
  academicYear: number | null;
  academicTerm: 'winter' | 'summer' | 'fall' | null;
} {
  const normalized = termName?.trim().toLowerCase() || '';
  const yearMatch = normalized.match(/\b(20\d{2})\b/);
  const academicYear = yearMatch ? Number.parseInt(yearMatch[1], 10) : null;
  const academicTerm = /winter|冬/.test(normalized)
    ? 'winter'
    : /summer|夏/.test(normalized)
      ? 'summer'
      : /fall|autumn|秋/.test(normalized)
        ? 'fall'
        : null;
  return { academicYear, academicTerm };
}

function courseDescription(course: SpeedupCourse): string {
  return Array.from(
    new Set(
      [course.termName, course.universityAbbrs, 'Speedup AI 课程'].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ).join(' · ');
}

function courseTags(course: SpeedupCourse): string[] {
  return Array.from(
    new Set(
      [course.code, course.termName, course.campusCode, course.universityAbbrs, 'Speedup']
        .filter((value): value is string => Boolean(value))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

export async function listSpeedupTeacherCourseOptions(
  teacherId: string,
): Promise<SpeedupTeacherCourseOption[]> {
  // Integration contract: TeacherCourses already returns only this term's
  // courses that are eligible for AI activation.
  const courses = await listSpeedupCoursesForUser(teacherId, 'TEACHER');
  await syncSpeedupCourseMemberships(teacherId, 'TEACHER', courses);
  const bindings = courses.length
    ? await prisma.externalCourseBinding.findMany({
        where: {
          provider: SPEEDUP_PROVIDER,
          OR: courses.map((course) => ({
            campusCode: course.campusCode,
            externalCourseId: course.id,
          })),
        },
        select: {
          externalCourseId: true,
          campusCode: true,
          courseId: true,
          memberships: {
            where: { userId: teacherId, role: 'TEACHER', active: true },
            select: { id: true },
          },
        },
      })
    : [];
  const bindingByExternalId = new Map(
    bindings.map(
      (binding) =>
        [
          speedupCourseKey({
            id: binding.externalCourseId,
            campusCode: binding.campusCode,
          }),
          binding,
        ] as const,
    ),
  );

  return courses.map((course) => {
    const binding = bindingByExternalId.get(speedupCourseKey(course));
    const ownedByCurrentTeacher = Boolean(binding?.memberships.length);
    return {
      ...course,
      isActivated: Boolean(binding),
      ownedByCurrentTeacher,
      localCourseId: ownedByCurrentTeacher ? (binding?.courseId ?? null) : null,
    };
  });
}

export async function activateSpeedupTeacherCourses(
  teacherId: string,
  externalCourseIds: string[],
  verifiedCourses?: SpeedupCourse[],
): Promise<
  Array<{
    externalCourseId: string;
    campusCode: string;
    localCourseId: string;
    created: boolean;
  }>
> {
  const availableCourses =
    verifiedCourses ?? (await listSpeedupCoursesForUser(teacherId, 'TEACHER'));
  await syncSpeedupCourseMemberships(teacherId, 'TEACHER', availableCourses);
  const requestedIdSet = new Set(externalCourseIds);
  const requestedCourses = verifiedCourses
    ? availableCourses.filter((course) => requestedIdSet.has(course.id))
    : externalCourseIds.map((externalCourseId) => {
        const matches = availableCourses.filter((course) => course.id === externalCourseId);
        if (matches.length > 1) {
          throw new SpeedupSsoError(502, 'Speedup 课程数据包含重复的 CourseId。');
        }
        const course = matches[0];
        if (!course) {
          throw new SpeedupSsoError(403, '所选课程不在本学期可开通的 Speedup 课程中。');
        }
        return course;
      });

  return prisma.$transaction(async (tx) => {
    const activated: Array<{
      externalCourseId: string;
      campusCode: string;
      localCourseId: string;
      created: boolean;
    }> = [];

    for (const externalCourse of requestedCourses) {
      const existing = await tx.externalCourseBinding.findUnique({
        where: {
          provider_campusCode_externalCourseId: {
            provider: SPEEDUP_PROVIDER,
            campusCode: externalCourse.campusCode,
            externalCourseId: externalCourse.id,
          },
        },
        include: { course: { select: { ownerId: true } } },
      });
      if (existing) {
        await tx.externalCourseBinding.update({
          where: { id: existing.id },
          data: {
            externalCourseName: externalCourse.name,
            externalCourseCode: externalCourse.code,
            termName: externalCourse.termName,
            universityAbbrs: externalCourse.universityAbbrs,
          },
        });
        await tx.externalCourseMembership.upsert({
          where: {
            bindingId_userId_role: {
              bindingId: existing.id,
              userId: teacherId,
              role: 'TEACHER',
            },
          },
          update: { active: true, revokedAt: null, lastVerifiedAt: new Date() },
          create: {
            bindingId: existing.id,
            userId: teacherId,
            role: 'TEACHER',
          },
        });
        activated.push({
          externalCourseId: externalCourse.id,
          campusCode: externalCourse.campusCode,
          localCourseId: existing.courseId,
          created: false,
        });
        continue;
      }

      const period = parseAcademicPeriod(externalCourse.termName);
      const localCourse = await tx.course.create({
        data: {
          ownerId: teacherId,
          name: externalCourse.name,
          description: courseDescription(externalCourse),
          language: 'zh-CN',
          tags: courseTags(externalCourse),
          purpose: 'university',
          university: externalCourse.universityAbbrs || externalCourse.campusCode,
          courseCode: externalCourse.code,
          academicYear: period.academicYear,
          academicTerm: period.academicTerm,
        },
        select: { id: true },
      });
      await tx.externalCourseBinding.create({
        data: {
          provider: SPEEDUP_PROVIDER,
          campusCode: externalCourse.campusCode,
          externalCourseId: externalCourse.id,
          courseId: localCourse.id,
          activatedById: teacherId,
          externalCourseName: externalCourse.name,
          externalCourseCode: externalCourse.code,
          termName: externalCourse.termName,
          universityAbbrs: externalCourse.universityAbbrs,
          memberships: {
            create: { userId: teacherId, role: 'TEACHER' },
          },
        },
      });
      activated.push({
        externalCourseId: externalCourse.id,
        campusCode: externalCourse.campusCode,
        localCourseId: localCourse.id,
        created: true,
      });
    }

    return activated;
  });
}

export async function enrollSpeedupStudentCourse(
  studentId: string,
  externalCourseId: string,
  courses: SpeedupCourse[],
  requestedCampusCode?: string,
): Promise<string> {
  const bindings = await syncSpeedupCourseMemberships(studentId, 'STUDENT', courses);
  if (bindings.length > 0) {
    await prisma.courseEnrollment.createMany({
      data: bindings.map((binding) => ({ userId: studentId, courseId: binding.courseId })),
      skipDuplicates: true,
    });
  }
  const binding = bindings.find(
    (candidate) =>
      candidate.externalCourseId === externalCourseId &&
      (!requestedCampusCode || candidate.campusCode === requestedCampusCode),
  );
  if (!binding) {
    throw new SpeedupSsoError(409, '这门 AI 课程尚未由老师开通，请联系任课老师后重试。');
  }
  return binding.courseId;
}
