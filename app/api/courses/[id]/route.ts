import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { pickStableCourseAvatarUrl } from '@/lib/constants/course-avatars';
import { getCoursePublishBlockReasonFromFlags } from '@/lib/utils/course-publish';
import {
  type CourseAccessRole,
  findCourseAccessRole,
  removeCourseEnrollmentForUser,
  withCourseEnrollmentSchemaFallback,
} from '@/lib/server/repositories/course-enrollment-repository';
import {
  countPurchasedNotebooksInOwnedCourse,
  deleteOwnedCourseWithNotebooks,
  findOwnedCourse,
  syncOwnedCourseNotebookStoreState,
  updateOwnedCourse,
} from '@/lib/server/repositories/course-repository';
import { publishCourseProblemBankForUser } from '@/features/problems/server/service';
import { reconcileSpeedupCourseMembershipsIfAvailable } from '@/lib/server/speedup-course-provisioning';

function ownerDisplayName(owner: { name: string | null; email: string | null }): string {
  const n = owner.name?.trim();
  if (n) return n;
  const e = owner.email?.trim();
  if (e) return e.split('@')[0] || e;
  return '匿名创作者';
}

type CourseDetailRow = {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  language: string;
  tags: string[];
  purpose: 'research' | 'university' | 'daily';
  university: string | null;
  courseCode: string | null;
  academicYear: number | null;
  academicTerm: 'winter' | 'summer' | 'fall' | null;
  avatarUrl: string | null;
  listedInCourseStore: boolean;
  coursePriceCents: number;
  storePublishedAt: Date | null;
  sourceCourseId: string | null;
  notebookCount: number;
  sceneCount: number;
  problemCount: number;
  publishedProblemCount: number;
  speechReadyCount: number;
  speechTotalCount: number;
  createdAt: Date;
  updatedAt: Date;
  ownerName: string | null;
  ownerEmail: string | null;
  accessRole: CourseAccessRole | null;
};

declare global {
  var __synatraCourseDetailFlights__: Map<string, Promise<CourseDetailRow | null>> | undefined;
}

function courseDetailFlights() {
  globalThis.__synatraCourseDetailFlights__ ??= new Map();
  return globalThis.__synatraCourseDetailFlights__;
}

async function readCourseDetail(userId: string, courseId: string): Promise<CourseDetailRow | null> {
  const accessRole = await findCourseAccessRole(prisma, userId, courseId);
  if (!accessRole) return null;
  // Resolve Speedup-backed access first so inactive external memberships cannot
  // use a stale enrollment or historical owner id to reopen the course.
  const rows = await withCourseEnrollmentSchemaFallback(
    prisma,
    () =>
      prisma.$queryRaw<CourseDetailRow[]>`
        SELECT
          course.*,
          owner."name" AS "ownerName",
          owner."email" AS "ownerEmail",
          ${accessRole}::text AS "accessRole"
        FROM "Course" AS course
        INNER JOIN "User" AS owner ON owner."id" = course."ownerId"
        WHERE course."id" = ${courseId}
        LIMIT 1
      `,
  );
  const course = rows[0];
  return course?.accessRole ? course : null;
}

async function readCourseDetailSingleFlight(userId: string, courseId: string) {
  const key = `${encodeURIComponent(userId)}:${encodeURIComponent(courseId)}`;
  const flights = courseDetailFlights();
  const existing = flights.get(key);
  if (existing) return existing;

  const flight = readCourseDetail(userId, courseId).finally(() => {
    if (flights.get(key) === flight) flights.delete(key);
  });
  flights.set(key, flight);
  return flight;
}

const updateCourseSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  language: z.enum(['zh-CN', 'en-US']).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).optional(),
  purpose: z.enum(['research', 'university', 'daily']).optional(),
  university: z.string().trim().max(120).optional(),
  courseCode: z.string().trim().max(60).optional(),
  avatarUrl: z.string().trim().max(2048).optional(),
  listedInCourseStore: z.boolean().optional(),
  coursePriceCents: z.number().int().min(0).max(100000000).optional(),
});

async function countPublicCourseMemoriesForPublish(userId: string, courseId: string) {
  const notebooks = await prisma.notebook.findMany({
    where: { ownerId: userId, courseId },
    select: { id: true },
  });
  const notebookIds = notebooks.map((notebook) => notebook.id);
  return prisma.studyMemory.count({
    where: {
      ownerId: userId,
      scope: 'public',
      status: 'active',
      OR:
        notebookIds.length > 0
          ? [
              { targetType: 'course', courseId },
              { targetType: 'notebook', notebookId: { in: notebookIds } },
            ]
          : [{ targetType: 'course', courseId }],
    },
  });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { userId } = auth;
    const { id } = await context.params;

    const reconciliation = await reconcileSpeedupCourseMembershipsIfAvailable(userId);

    let course =
      reconciliation === 'refreshed'
        ? await readCourseDetail(userId, id)
        : await readCourseDetailSingleFlight(userId, id);
    if (!course) {
      return NextResponse.json(
        { error: '课程不存在，或该课程的 AI 访问权限已由机构关闭。' },
        { status: 404 },
      );
    }
    const accessRole = course.accessRole;
    if (accessRole === 'owner' && !course.avatarUrl?.trim()) {
      // Keep this read path side-effect free and responsive. Older rows may
      // predate persisted avatars; the same deterministic fallback is enough
      // for rendering and avoids another remote write before the shell opens.
      course = {
        ...course,
        avatarUrl: pickStableCourseAvatarUrl(id),
      };
    }
    const { ownerName, ownerEmail, ...courseWithoutRelations } = course;
    return NextResponse.json({
      course: {
        ...courseWithoutRelations,
        accessRole,
        sourceOwnerName:
          accessRole === 'enrolled'
            ? ownerDisplayName({ name: ownerName, email: ownerEmail })
            : undefined,
      },
    });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { userId } = auth;
    const { id } = await context.params;

    const payload = updateCourseSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: payload.error.flatten() },
        { status: 400 },
      );
    }

    const existing = await findOwnedCourse(prisma, userId, id);
    if (!existing) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    if (payload.data.listedInCourseStore === true) {
      const purchasedNotebookCount = await countPurchasedNotebooksInOwnedCourse(prisma, userId, id);
      const publishBlockReason = getCoursePublishBlockReasonFromFlags(
        existing,
        purchasedNotebookCount > 0,
      );
      if (publishBlockReason) {
        return NextResponse.json({ error: publishBlockReason }, { status: 400 });
      }
    }

    const shouldPublishCourse = payload.data.listedInCourseStore === true;
    const shouldUnpublishCourse = payload.data.listedInCourseStore === false;
    const course = await updateOwnedCourse(prisma, userId, id, {
      ...payload.data,
      ...(shouldPublishCourse ? { storePublishedAt: new Date() } : {}),
      ...(shouldUnpublishCourse ? { storePublishedAt: null } : {}),
    });
    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    if (payload.data.listedInCourseStore !== undefined) {
      await syncOwnedCourseNotebookStoreState(prisma, userId, id, payload.data.listedInCourseStore);
    }
    let publishScope:
      | {
          problemBank: Awaited<ReturnType<typeof publishCourseProblemBankForUser>> | null;
          publicMemoryCount: number;
          sourceFilesUploaded: false;
          privateContentUploaded: false;
        }
      | undefined;
    if (shouldPublishCourse) {
      // Course publishing deliberately does not copy or upload source files, private study memory,
      // learner progress, or chat transcripts. Public course/notebook memories remain readable
      // through the shared course context; only the problem bank gets an explicit publish pass.
      const [problemBank, publicMemoryCount] = await Promise.all([
        publishCourseProblemBankForUser({ userId, courseId: id }),
        countPublicCourseMemoriesForPublish(userId, id),
      ]);
      publishScope = {
        problemBank,
        publicMemoryCount,
        sourceFilesUploaded: false,
        privateContentUploaded: false,
      };
    }
    return NextResponse.json({ course, publishScope });
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { userId } = auth;
    const { id } = await context.params;

    const accessRole = await findCourseAccessRole(prisma, userId, id);
    if (!accessRole) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    if (accessRole === 'owner') {
      const externalBinding = await prisma.externalCourseBinding.findUnique({
        where: { courseId: id },
        select: { id: true },
      });
      if (externalBinding) {
        return NextResponse.json(
          { error: 'Speedup 托管课程不能在 Syntara 中永久删除。' },
          { status: 409 },
        );
      }
      await deleteOwnedCourseWithNotebooks(prisma, userId, id);
      return NextResponse.json({ ok: true, action: 'deleted' });
    }

    const { removedEnrollment, removedLegacyPurchases } = await prisma.$transaction(async (tx) => ({
      removedEnrollment: await removeCourseEnrollmentForUser(tx, userId, id),
      removedLegacyPurchases: await tx.coursePurchase.deleteMany({
        where: {
          buyerId: userId,
          sourceCourseId: id,
        },
      }),
    }));

    if (removedEnrollment === 0 && removedLegacyPurchases.count === 0) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, action: 'removed' });
  });
}
