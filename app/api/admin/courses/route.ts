import { withAiFailureAudit } from '@/lib/server/ai-failure-log';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { pickRandomCourseAvatarUrl } from '@/lib/constants/course-avatars';

const createAdminCourseSchema = z.object({
  ownerId: z.string().trim().min(1).max(160),
  courseCode: z.string().trim().min(1).max(60),
  academicYear: z.number().int().min(2020).max(2100),
  academicTerm: z.enum(['winter', 'summer', 'fall']),
});

const ACADEMIC_TERM_LABEL = {
  winter: 'Winter',
  summer: 'Summer',
  fall: 'Fall',
} as const;

function normalizeSearch(raw: string | null): string {
  return raw?.trim() || '';
}

function normalizeTake(raw: string | null): number {
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(Math.max(parsed, 1), 200);
}

function toNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type CourseUsageSummary = {
  studentCount: number;
  studentTokens: number;
  teacherTokens: number;
};

async function loadCourseUsageSummaries(
  prisma: NonNullable<ReturnType<typeof getOptionalPrisma>>,
  courses: Array<{ id: string }>,
) {
  if (courses.length === 0) return new Map<string, CourseUsageSummary>();
  const rows = await prisma.$queryRaw<
    Array<{
      courseId: string;
      studentCount: number;
      studentTokens: number;
      teacherTokens: number;
    }>
  >(Prisma.sql`
    WITH page_courses AS (
      SELECT c.id, c."ownerId", c.name
      FROM "Course" c
      WHERE c.id IN (${Prisma.join(courses.map((course) => course.id))})
    ),
    attributed AS (
      SELECT l.id, p.id AS "courseId", l."totalTokens" AS tokens, 'teacher'::text AS side
      FROM "LLMUsageLog" l
      JOIN page_courses p ON p."ownerId" = l."userId"
      WHERE l."requestContent" ILIKE '%' || p.name || '%'
        AND char_length(p.name) >= 4
        AND l.source NOT IN ('student-course-chat', 'teacher-course-chat')

      UNION

      SELECT l.id, p.id, l."totalTokens", 'student'::text
      FROM "LLMUsageLog" l
      JOIN "User" u ON u.id = l."userId" AND u.role = 'STUDENT'::"UserRole"
      JOIN "CourseEnrollment" e ON e."userId" = u.id
      JOIN page_courses p ON p.id = e."courseId"
      WHERE l."requestContent" ILIKE '%' || p.name || '%'
        AND char_length(p.name) >= 4
        AND l.source NOT IN ('student-course-chat', 'teacher-course-chat')

      UNION

      SELECT l.id, p.id, l."totalTokens",
        CASE WHEN l."userId" = p."ownerId" THEN 'teacher' ELSE 'student' END
      FROM "LLMUsageLog" l
      JOIN LATERAL (
        SELECT cc."courseId"
        FROM "CourseConversation" cc
        WHERE cc."ownerId" = l."userId"
          AND cc."deletedAt" IS NULL
          AND ABS(EXTRACT(EPOCH FROM (COALESCE(cc."lastMessageAt", cc."updatedAt") - l."createdAt"))) <= 7200
        ORDER BY ABS(EXTRACT(EPOCH FROM (COALESCE(cc."lastMessageAt", cc."updatedAt") - l."createdAt")))
        LIMIT 1
      ) matched ON true
      JOIN page_courses p ON p.id = matched."courseId"
      WHERE l.source IN ('student-course-chat', 'teacher-course-chat')
        AND (
          l."userId" = p."ownerId"
          OR EXISTS (
            SELECT 1
            FROM "CourseEnrollment" e
            JOIN "User" u ON u.id = e."userId"
            WHERE e."courseId" = p.id
              AND e."userId" = l."userId"
              AND u.role = 'STUDENT'::"UserRole"
          )
        )
    )
    SELECT p.id AS "courseId",
      (
        SELECT COUNT(*)::int
        FROM "CourseEnrollment" e
        INNER JOIN "User" u ON u.id = e."userId"
        WHERE e."courseId" = p.id
          AND u.role = 'STUDENT'::"UserRole"
      ) AS "studentCount",
      COALESCE(SUM(a.tokens) FILTER (WHERE a.side = 'student'), 0)::float8 AS "studentTokens",
      COALESCE(SUM(a.tokens) FILTER (WHERE a.side = 'teacher'), 0)::float8 AS "teacherTokens"
    FROM page_courses p
    LEFT JOIN attributed a ON a."courseId" = p.id
    GROUP BY p.id
  `);
  return new Map(
    rows.map((row) => [
      row.courseId,
      {
        studentCount: toNumber(row.studentCount),
        studentTokens: toNumber(row.studentTokens),
        teacherTokens: toNumber(row.teacherTokens),
      },
    ]),
  );
}

function normalizeSkip(raw: string | null): number {
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 10_000);
}

function normalizeAcademicYear(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 2020 || parsed > 2100) return null;
  return parsed;
}

function normalizeAcademicTerm(raw: string | null): 'winter' | 'summer' | 'fall' | null {
  if (raw === 'winter' || raw === 'summer' || raw === 'fall') return raw;
  return null;
}

const TERM_RANK = { winter: 0, summer: 1, fall: 2 } as const;

function materialRichness(counts: {
  notebooks: number;
  notebookPages: number;
  problems: number;
  studyMemories: number;
}) {
  return counts.notebooks + counts.notebookPages + counts.problems + counts.studyMemories;
}

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiError('INTERNAL_ERROR', 503, '数据库不可用，无法读取课程列表');
  }

  const { searchParams } = new URL(request.url);
  const query = normalizeSearch(searchParams.get('query'));
  const take = normalizeTake(searchParams.get('take'));
  const skip = normalizeSkip(searchParams.get('skip'));
  const academicYear = normalizeAcademicYear(searchParams.get('academicYear'));
  const academicTerm = normalizeAcademicTerm(searchParams.get('academicTerm'));

  const where: Prisma.CourseWhereInput = {
    ...(academicYear != null ? { academicYear } : {}),
    ...(academicTerm ? { academicTerm } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
            { courseCode: { contains: query, mode: 'insensitive' } },
            { university: { contains: query, mode: 'insensitive' } },
            { owner: { email: { contains: query, mode: 'insensitive' } } },
            { owner: { name: { contains: query, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  try {
    const [courses, semesterRows] = await Promise.all([
      prisma.course.findMany({
        where,
        select: {
          id: true,
          ownerId: true,
          name: true,
          description: true,
          purpose: true,
          university: true,
          courseCode: true,
          academicYear: true,
          academicTerm: true,
          avatarUrl: true,
          listedInCourseStore: true,
          coursePriceCents: true,
          storePublishedAt: true,
          sourceCourseId: true,
          notebookCount: true,
          sceneCount: true,
          problemCount: true,

          speechReadyCount: true,
          speechTotalCount: true,
          createdAt: true,
          updatedAt: true,
          owner: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
          _count: {
            select: {
              notebooks: true,
              notebookPages: true,
              markdownSections: true,
              problems: true,
              enrollments: true,
              sourcePurchases: true,
              reviews: true,
              conversations: true,
              studyMemories: true,
            },
          },
        },
      }),
      prisma.course.findMany({
        where: { academicYear: { not: null }, academicTerm: { not: null } },
        distinct: ['academicYear', 'academicTerm'],
        select: { academicYear: true, academicTerm: true },
      }),
    ]);
    courses.sort(
      (left, right) =>
        materialRichness(right._count) - materialRichness(left._count) ||
        right.updatedAt.getTime() - left.updatedAt.getTime(),
    );
    const pageCourses = courses.slice(skip, skip + take);
    const usageByCourse = await loadCourseUsageSummaries(prisma, pageCourses);
    const emptyUsage: CourseUsageSummary = {
      studentCount: 0,
      studentTokens: 0,
      teacherTokens: 0,
    };

    return apiSuccess({
      totalCount: courses.length,
      semesters: semesterRows
        .flatMap((row) =>
          row.academicYear == null || row.academicTerm == null
            ? []
            : [{ academicYear: row.academicYear, academicTerm: row.academicTerm }],
        )
        .sort(
          (left, right) =>
            right.academicYear - left.academicYear ||
            TERM_RANK[left.academicTerm] - TERM_RANK[right.academicTerm],
        ),
      courses: pageCourses.map((course) => ({
        id: course.id,
        ownerId: course.ownerId,
        name: course.name,
        description: course.description,
        purpose: course.purpose,
        university: course.university,
        courseCode: course.courseCode,
        academicYear: course.academicYear,
        academicTerm: course.academicTerm,
        avatarUrl: course.avatarUrl,
        listedInCourseStore: course.listedInCourseStore,
        coursePriceCents: course.coursePriceCents,
        storePublishedAt: course.storePublishedAt,
        sourceCourseId: course.sourceCourseId,
        notebookCount: course.notebookCount,
        sceneCount: course.sceneCount,
        problemCount: course.problemCount,

        speechReadyCount: course.speechReadyCount,
        speechTotalCount: course.speechTotalCount,
        createdAt: course.createdAt,
        updatedAt: course.updatedAt,
        owner: course.owner,
        counts: course._count,
        usage: usageByCourse.get(course.id) ?? emptyUsage,
      })),
    });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}

async function auditedPOST(request: Request) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;
  const prisma = getOptionalPrisma();
  if (!prisma) return apiError('INTERNAL_ERROR', 503, '数据库不可用，无法创建课程');
  const parsed = createAdminCourseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('INVALID_REQUEST', 400, '请指定老师并填写课程代码和学期');
  }
  const teacher = await prisma.user.findFirst({
    where: { id: parsed.data.ownerId, role: 'TEACHER', isActive: true },
    select: { id: true },
  });
  if (!teacher) return apiError('INVALID_REQUEST', 400, '指定的老师不存在或已停用');
  try {
    const courseCode = parsed.data.courseCode.toUpperCase();
    const termLabel = ACADEMIC_TERM_LABEL[parsed.data.academicTerm];
    const course = await prisma.course.create({
      data: {
        ownerId: teacher.id,
        courseCode,
        academicYear: parsed.data.academicYear,
        academicTerm: parsed.data.academicTerm,
        name: `${courseCode} · ${parsed.data.academicYear} ${termLabel}`,
        language: 'zh-CN',
        purpose: 'university',
        tags: [String(parsed.data.academicYear), termLabel],
        avatarUrl: pickRandomCourseAvatarUrl(),
      },
    });
    return apiSuccess({ course }, 201);
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}

export const POST = withAiFailureAudit(auditedPOST);
