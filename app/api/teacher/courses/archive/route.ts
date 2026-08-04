import { NextResponse } from 'next/server';

import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { requireTeacher } from '@/lib/server/teacher-auth';

function currentAcademicPeriod(date = new Date()) {
  const month = date.getMonth() + 1;
  return {
    academicYear: date.getFullYear(),
    term: month <= 4 ? ('winter' as const) : month <= 8 ? ('summer' as const) : ('fall' as const),
  };
}

export async function GET() {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const rows = await prisma.course.findMany({
      where: { ownerId: teacher.userId, academicYear: { not: null }, academicTerm: { not: null } },
      orderBy: [{ academicYear: 'desc' }, { academicTerm: 'desc' }, { courseCode: 'asc' }],
      select: {
        id: true,
        name: true,
        courseCode: true,
        academicYear: true,
        academicTerm: true,
        createdAt: true,
        updatedAt: true,
        problemCount: true,
        _count: {
          select: {
            notebooks: { where: { removedAt: null } },
            courseSources: { where: { removedAt: null } },
            enrollments: true,
          },
        },
      },
    });
    const current = currentAcademicPeriod();
    const courses = rows.map((course) => ({
      id: course.id,
      code: course.courseCode?.trim() || course.name,
      name: course.name,
      academicYear: course.academicYear!,
      term: course.academicTerm!,
      contentCount:
        course._count.notebooks + course._count.courseSources + (course.problemCount > 0 ? 1 : 0),
      inheritedCount: 0,
      studentCount: course._count.enrollments,
      createdAt: course.createdAt.getTime(),
      updatedAt: course.updatedAt.getTime(),
    }));
    const termCounts = new Map<string, number>();
    for (const course of courses) {
      const key = `${course.academicYear}-${course.term}`;
      termCounts.set(key, (termCounts.get(key) || 0) + 1);
    }
    const termRank = { winter: 0, summer: 1, fall: 2 } as const;
    const terms = Array.from(termCounts, ([key, courseCount]) => {
      const [year, term] = key.split('-') as [string, keyof typeof termRank];
      return { key, academicYear: Number(year), term, courseCount };
    }).sort(
      (left, right) =>
        right.academicYear * 3 +
        termRank[right.term] -
        (left.academicYear * 3 + termRank[left.term]),
    );

    return NextResponse.json({
      storage: 'postgresql',
      current,
      courses,
      terms,
    });
  });
}
