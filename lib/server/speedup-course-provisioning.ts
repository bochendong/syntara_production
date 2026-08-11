import { prisma } from '@/lib/server/prisma';
import {
  listSpeedupCoursesForUser,
  SpeedupSsoError,
  type SpeedupCourse,
} from '@/lib/server/speedup-sso';

const SPEEDUP_PROVIDER = 'speedup';

export type SpeedupTeacherCourseOption = SpeedupCourse & {
  isActivated: boolean;
  ownedByCurrentTeacher: boolean;
  localCourseId: string | null;
};

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
  return [course.termName, course.universityAbbrs, 'Speedup AI 课程']
    .filter((value): value is string => Boolean(value))
    .join(' · ');
}

function courseTags(course: SpeedupCourse): string[] {
  return Array.from(
    new Set(
      [course.code, course.termName, course.universityAbbrs, 'Speedup']
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
  const bindings = courses.length
    ? await prisma.externalCourseBinding.findMany({
        where: {
          provider: SPEEDUP_PROVIDER,
          externalCourseId: { in: courses.map((course) => course.id) },
        },
        select: {
          externalCourseId: true,
          courseId: true,
          course: { select: { ownerId: true } },
        },
      })
    : [];
  const bindingByExternalId = new Map(
    bindings.map((binding) => [binding.externalCourseId, binding] as const),
  );

  return courses.map((course) => {
    const binding = bindingByExternalId.get(course.id);
    const ownedByCurrentTeacher = binding?.course.ownerId === teacherId;
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
): Promise<Array<{ externalCourseId: string; localCourseId: string; created: boolean }>> {
  const availableCourses = await listSpeedupCoursesForUser(teacherId, 'TEACHER');
  const availableById = new Map(availableCourses.map((course) => [course.id, course] as const));
  const requestedCourses = externalCourseIds.map((externalCourseId) => {
    const course = availableById.get(externalCourseId);
    if (!course) {
      throw new SpeedupSsoError(403, '所选课程不在本学期可开通的 Speedup 课程中。');
    }
    return course;
  });

  return prisma.$transaction(async (tx) => {
    const activated: Array<{
      externalCourseId: string;
      localCourseId: string;
      created: boolean;
    }> = [];

    for (const externalCourse of requestedCourses) {
      const existing = await tx.externalCourseBinding.findUnique({
        where: {
          provider_externalCourseId: {
            provider: SPEEDUP_PROVIDER,
            externalCourseId: externalCourse.id,
          },
        },
        include: { course: { select: { ownerId: true } } },
      });
      if (existing) {
        if (existing.course.ownerId !== teacherId) {
          throw new SpeedupSsoError(
            409,
            `课程“${externalCourse.name}”已经由另一位教师开通，请联系管理员处理课程归属。`,
          );
        }
        await tx.externalCourseBinding.update({
          where: { id: existing.id },
          data: {
            externalCourseName: externalCourse.name,
            externalCourseCode: externalCourse.code,
            termName: externalCourse.termName,
            universityAbbrs: externalCourse.universityAbbrs,
          },
        });
        activated.push({
          externalCourseId: externalCourse.id,
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
          university: externalCourse.universityAbbrs,
          courseCode: externalCourse.code,
          academicYear: period.academicYear,
          academicTerm: period.academicTerm,
        },
        select: { id: true },
      });
      await tx.externalCourseBinding.create({
        data: {
          provider: SPEEDUP_PROVIDER,
          externalCourseId: externalCourse.id,
          courseId: localCourse.id,
          activatedById: teacherId,
          externalCourseName: externalCourse.name,
          externalCourseCode: externalCourse.code,
          termName: externalCourse.termName,
          universityAbbrs: externalCourse.universityAbbrs,
        },
      });
      activated.push({
        externalCourseId: externalCourse.id,
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
): Promise<string> {
  const binding = await prisma.externalCourseBinding.findUnique({
    where: {
      provider_externalCourseId: {
        provider: SPEEDUP_PROVIDER,
        externalCourseId,
      },
    },
    select: { courseId: true },
  });
  if (!binding) {
    throw new SpeedupSsoError(409, '这门 AI 课程尚未由老师开通，请联系任课老师后重试。');
  }
  await prisma.courseEnrollment.upsert({
    where: { userId_courseId: { userId: studentId, courseId: binding.courseId } },
    update: {},
    create: { userId: studentId, courseId: binding.courseId },
  });
  return binding.courseId;
}
