import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { isAdminTextModel } from '@/lib/ai/admin-model-options';
import { parseCloudUsageWeek } from '@/lib/cloud-usage-week';
import {
  ADMIN_CONSOLE_ROLES,
  AdminConsoleError,
  getAdminConsoleOverview,
  getAdminConsoleUserCourses,
  resolveAdminConsoleViewer,
  saveAdminConsoleLlm,
  searchAdminConsoleUsers,
  setAdminConsoleGlobalLimit,
  setAdminConsoleUserLimit,
  setAdminConsoleUserRole,
} from '@/lib/server/admin-console';
import { summarizeCloudUsage } from '@/lib/server/cloud-usage-limits';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  listAdminManagedCourses,
  listAdminCourseStudents,
  removeAdminCourseStudent,
  searchAdminCourseAssignees,
  setAdminCourseManager,
} from '@/lib/server/admin-course-management';
import { archiveResponse, buildAdminCourseArchive } from '@/lib/server/admin-course-export';
import {
  courseProblemTagUpdatesSchema,
  CourseProblemTagUpdateConflict,
  updateCourseProblemTags,
} from '@/lib/server/course-problem-tag-updates';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * App 里的「管理」页（测试服管理员控制台）。只有管理员账号能用：
 * 库里 role = ADMIN，或邮箱 / ID 在 ADMIN_EMAILS / ADMIN_USER_IDS 里（和网页 /admin 同一个规则）。
 */
async function adminFor(request: NextRequest, requestId: string) {
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Admin console is unavailable.');
  }
  const viewer = await resolveAdminConsoleViewer(prisma, principal.userId);
  if (!viewer) return publicApiError(requestId, 403, 'unauthorized', '只有管理员能打开管理页。');
  return { prisma, viewer };
}

function adminError(requestId: string, error: unknown) {
  if (error instanceof AdminConsoleError) {
    return publicApiError(
      requestId,
      error.status,
      error.status === 404
        ? 'not_found'
        : error.status === 403
          ? 'unauthorized'
          : 'invalid_request',
      error.message,
    );
  }
  throw error;
}

const roleSchema = z.enum(ADMIN_CONSOLE_ROLES);

/** ?check=1 = 管理员检查；?usageWeek=YYYY-MM-DD = 该周全站用量；没有参数 = 总览。 */
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const admin = await adminFor(request, requestId);
  if (admin instanceof NextResponse) return admin;
  const query = request.nextUrl.searchParams;
  try {
    if (query.get('check')) return publicApiSuccess(requestId, { admin: true });
    const usageWeek = query.get('usageWeek');
    if (usageWeek !== null) {
      const period = parseCloudUsageWeek(usageWeek);
      if (!period) {
        return publicApiError(requestId, 400, 'invalid_request', '请选择本周或更早的有效日期。');
      }
      return publicApiSuccess(requestId, {
        weekUsage: await summarizeCloudUsage(admin.prisma, null, period),
      });
    }
    if (query.get('students') || query.get('export')) {
      const courseId = query.get('courseId')?.trim();
      if (!courseId || courseId.length > 200) {
        return publicApiError(requestId, 400, 'invalid_request', '请选择课程。');
      }
      if (query.get('students')) {
        return publicApiSuccess(
          requestId,
          await listAdminCourseStudents(
            admin.prisma,
            courseId,
            query.get('query') || '',
            Number(query.get('page') || 1),
          ),
        );
      }
      const course = await admin.prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true, name: true, courseCode: true },
      });
      if (!course) throw new AdminConsoleError(404, '找不到这门课程。');
      return archiveResponse(
        await buildAdminCourseArchive(admin.prisma, [course.id], { materialsOnly: true }),
        `course-${course.id}-materials`,
      );
    }
    if (query.get('catalog')) {
      return publicApiSuccess(
        requestId,
        await listAdminManagedCourses(
          admin.prisma,
          query.get('query') || '',
          Number(query.get('page') || 1),
        ),
      );
    }
    if (query.get('assignees')) {
      return publicApiSuccess(requestId, {
        users: await searchAdminCourseAssignees(admin.prisma, query.get('query') || ''),
      });
    }
    if (query.get('courses')) {
      const userId = query.get('userId')?.trim();
      if (!userId || userId.length > 200) {
        return publicApiError(requestId, 400, 'invalid_request', '请选择要查看的账号。');
      }
      return publicApiSuccess(requestId, {
        courses: await getAdminConsoleUserCourses(admin.prisma, userId),
      });
    }
    if (query.get('users')) {
      const role = roleSchema.safeParse(query.get('role'));
      return publicApiSuccess(
        requestId,
        await searchAdminConsoleUsers(admin.prisma, {
          query: query.get('query'),
          role: role.success ? role.data : null,
          page: Number(query.get('page') || 1),
        }),
      );
    }
    return publicApiSuccess(requestId, await getAdminConsoleOverview(admin.prisma, admin.viewer));
  } catch (error) {
    return adminError(requestId, error);
  }
}

const id = z.string().trim().min(1).max(200);
const model = z.string().trim().refine(isAdminTextModel, '请选择支持的模型');
const costLimit = z.number().min(0).max(1_000_000).nullable();
const requestLimit = z.number().int().min(0).max(100_000_000).nullable();

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update-course-problem-tags'),
    courseId: id,
    changes: courseProblemTagUpdatesSchema.shape.changes,
    apply: z.boolean().default(false),
  }),
  z.object({ action: z.literal('remove-course-student'), courseId: id, userId: id }),
  z.object({
    action: z.literal('set-course-manager'),
    courseId: id,
    userId: id,
    assigned: z.boolean(),
  }),
  z.object({
    action: z.literal('save-llm'),
    modelId: model.optional(),
    tierModels: z.object({ low: model, medium: model, high: model }).optional(),
    apiKey: z.string().trim().max(1000).optional(),
    baseUrl: z
      .string()
      .trim()
      .url()
      .refine((value) => /^https?:\/\//.test(value), '请输入有效服务地址')
      .optional(),
  }),
  z.object({ action: z.literal('set-role'), userId: id, role: roleSchema }),
  z.object({
    action: z.literal('set-user-limit'),
    userId: id,
    weeklyCostLimitUsd: costLimit,
    weeklyRequestLimit: requestLimit,
    disabled: z.boolean(),
  }),
  z.object({
    action: z.literal('set-global-limit'),
    enabled: z.boolean(),
    weeklyCostLimitUsd: costLimit,
    weeklyRequestLimit: requestLimit,
  }),
]);

export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const admin = await adminFor(request, requestId);
  if (admin instanceof NextResponse) return admin;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return publicApiError(
      requestId,
      400,
      'invalid_request',
      parsed.error.issues[0]?.message || '请求无效。',
    );
  }
  const { prisma, viewer } = admin;
  const input = parsed.data;
  try {
    switch (input.action) {
      case 'update-course-problem-tags':
        return publicApiSuccess(
          requestId,
          await updateCourseProblemTags(prisma, input.courseId, {
            changes: input.changes,
            apply: input.apply,
          }),
        );
      case 'remove-course-student':
        return publicApiSuccess(
          requestId,
          await prisma.$transaction((tx) => removeAdminCourseStudent(tx, viewer, input)),
        );
      case 'set-course-manager':
        return publicApiSuccess(requestId, {
          course: await prisma.$transaction((tx) => setAdminCourseManager(tx, viewer, input)),
        });
      case 'save-llm': {
        const { action: _action, ...llm } = input;
        return publicApiSuccess(requestId, { llm: await saveAdminConsoleLlm(llm) });
      }
      case 'set-role':
        return publicApiSuccess(requestId, {
          user: await setAdminConsoleUserRole(prisma, viewer, input.userId, input.role),
        });
      case 'set-user-limit': {
        const { action: _action, ...limit } = input;
        return publicApiSuccess(requestId, {
          user: await setAdminConsoleUserLimit(prisma, viewer, limit),
        });
      }
      case 'set-global-limit': {
        const { action: _action, ...limit } = input;
        return publicApiSuccess(requestId, {
          usage: await setAdminConsoleGlobalLimit(prisma, viewer, limit),
        });
      }
    }
  } catch (error) {
    if (error instanceof CourseProblemTagUpdateConflict)
      return publicApiError(requestId, 409, 'idempotency_conflict', error.message);
    return adminError(requestId, error);
  }
}
