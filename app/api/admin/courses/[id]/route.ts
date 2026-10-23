import { z } from 'zod';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiError('INTERNAL_ERROR', 503, '数据库不可用，无法删除课程');
  }

  const { id } = await context.params;

  try {
    const existing = await prisma.course.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        owner: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    if (!existing) {
      return apiError('INVALID_REQUEST', 404, '课程不存在');
    }

    await prisma.course.delete({
      where: { id },
    });

    return apiSuccess({
      deletedCourse: existing,
      deletedBy: {
        userId: admin.identity.userId,
        email: admin.identity.email ?? null,
      },
    });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}

const updateStoreCourseSchema = z.object({
  /** 挂到某个机构下（null = 变回普通用户课程，同时下架） */
  organizationId: z.string().trim().min(1).nullable().optional(),
  listedInCourseStore: z.boolean().optional(),
  /** 机构「发布新版」：contentVersion +1，已加入的人会看到更新提示 */
  publishNewVersion: z.boolean().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiError('INTERNAL_ERROR', 503, '数据库不可用，无法更新课程');
  }

  const { id } = await context.params;
  const parsed = updateStoreCourseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('INVALID_REQUEST', 400, '参数无效', parsed.error.message);
  }
  const { organizationId, listedInCourseStore, publishNewVersion } = parsed.data;

  try {
    const existing = await prisma.course.findUnique({
      where: { id },
      select: { id: true, organizationId: true, listedInCourseStore: true },
    });
    if (!existing) {
      return apiError('INVALID_REQUEST', 404, '课程不存在');
    }

    const nextOrganizationId =
      organizationId === undefined ? existing.organizationId : organizationId;
    if (listedInCourseStore === true && !nextOrganizationId) {
      return apiError('INVALID_REQUEST', 400, '只有机构课程可以上架到商城');
    }

    const listed =
      nextOrganizationId === null ? false : (listedInCourseStore ?? existing.listedInCourseStore);
    const course = await prisma.course.update({
      where: { id },
      data: {
        ...(organizationId !== undefined ? { organizationId } : {}),
        listedInCourseStore: listed,
        ...(listed && !existing.listedInCourseStore ? { storePublishedAt: new Date() } : {}),
        ...(!listed ? { storePublishedAt: null } : {}),
        ...(publishNewVersion ? { contentVersion: { increment: 1 } } : {}),
      },
      select: {
        id: true,
        organizationId: true,
        listedInCourseStore: true,
        storePublishedAt: true,
        contentVersion: true,
      },
    });

    return apiSuccess({ course });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
