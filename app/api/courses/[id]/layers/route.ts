import { NextResponse } from 'next/server';
import { z } from 'zod';

import { formatCourseUpdateSummary } from '@/lib/course-space/course-update-summary';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import {
  findCourseAccessRole,
  markCourseEnrollmentSeen,
} from '@/lib/server/repositories/course-enrollment-repository';
import {
  copyCourseContentToMine,
  CourseContentNotFoundError,
  PublicProblemReadOnlyError,
  courseLayersForUser,
  releaseCourseVersion,
  removeCourseContentForUser,
  restoreCourseContentForUser,
} from '@/lib/server/store-course-layers';

/**
 * 加入的机构课程的两层内容（公有层 / 私有层）。
 * GET：自己隐藏的内容、「新」笔记、还没看过的更新摘要。
 * POST：remove / restore / copy / seen；发布者 release（发布新版）。
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id } = await context.params;
    const role = await findCourseAccessRole(prisma, auth.userId, id);
    if (!role) return NextResponse.json({ error: '课程不存在。' }, { status: 404 });
    if (role === 'owner') {
      const course = await prisma.course.findUnique({
        where: { id },
        select: { contentVersion: true, lastReleasedAt: true, organizationId: true },
      });
      return NextResponse.json({
        role,
        contentVersion: course?.contentVersion ?? 1,
        lastReleasedAt: course?.lastReleasedAt?.getTime() ?? null,
        canRelease: Boolean(course?.organizationId),
      });
    }
    return NextResponse.json({ role, ...(await courseLayersForUser(prisma, auth.userId, id)) });
  });
}

const actionSchema = z.union([
  z.object({ action: z.enum(['seen', 'release']) }).strict(),
  z
    .object({
      action: z.enum(['remove', 'restore', 'copy']),
      targetType: z.enum(['notebook', 'problem']),
      targetId: z.string().trim().min(1).max(200),
    })
    .strict(),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id } = await context.params;
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: '请求无效。' }, { status: 400 });
    const body = parsed.data;

    if (body.action === 'seen') {
      if ((await findCourseAccessRole(prisma, auth.userId, id)) === 'enrolled')
        await markCourseEnrollmentSeen(prisma, auth.userId, id);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'release') {
      const course = await prisma.course.findFirst({
        where: { id, ownerId: auth.userId, organizationId: { not: null } },
        select: { id: true },
      });
      if (!course)
        return NextResponse.json({ error: '只有机构课程的发布者可以发布新版。' }, { status: 403 });
      const release = await releaseCourseVersion(prisma, id);
      return NextResponse.json({ ...release, text: formatCourseUpdateSummary(release) });
    }

    if (!('targetType' in body)) return NextResponse.json({ error: '请求无效。' }, { status: 400 });
    const target = {
      userId: auth.userId,
      courseId: id,
      targetType: body.targetType,
      targetId: body.targetId,
    };
    try {
      if (body.action === 'restore') {
        await restoreCourseContentForUser(prisma, target);
        return NextResponse.json({ restored: true });
      }
      if (body.action === 'copy')
        return NextResponse.json(await copyCourseContentToMine(prisma, target), { status: 201 });
      return NextResponse.json({ result: await removeCourseContentForUser(prisma, target) });
    } catch (error) {
      if (error instanceof CourseContentNotFoundError)
        return NextResponse.json({ error: error.message }, { status: 404 });
      if (error instanceof PublicProblemReadOnlyError)
        return NextResponse.json({ error: error.message }, { status: 403 });
      throw error;
    }
  });
}
