import { Prisma, type UserRole } from '@/lib/server/generated-prisma';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/admin-auth';
import {
  getCloudUsageGlobalLimit,
  getCloudUsageUserLimit,
  summarizeCloudUsage,
} from '@/lib/server/cloud-usage-limits';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

type UserSearchRow = {
  id: string;
  email: string | null;
  name: string | null;
  role: string | null;
  createdAt: Date;
};

function normalizeNullableNumber(value: unknown): number | null {
  if (value === '' || value == null) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function normalizeNullableInt(value: unknown): number | null {
  if (value === '' || value == null) return null;
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiError('INTERNAL_ERROR', 503, '数据库不可用，无法读取云端额度配置');
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query')?.trim().toLowerCase() || '';
  const listRole = searchParams.get('listRole') as 'STUDENT' | 'TEACHER' | 'ALL' | null;

  try {
    const [globalLimit, globalUsage] = await Promise.all([
      getCloudUsageGlobalLimit(prisma),
      summarizeCloudUsage(prisma),
    ]);

    const bulkRoles: UserRole[] = ['STUDENT', 'TEACHER'];
    const userRows = listRole === 'STUDENT' || listRole === 'TEACHER' || listRole === 'ALL'
      ? await prisma.user.findMany({
          where:
            listRole === 'STUDENT' || listRole === 'TEACHER'
              ? { role: listRole, isActive: true }
              : { role: { in: bulkRoles }, isActive: true },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            createdAt: true,
          },
          orderBy: [{ role: 'asc' }, { updatedAt: 'desc' }],
          take: 500,
        })
      : query
      ? await prisma.$queryRaw<UserSearchRow[]>(
          Prisma.sql`
            SELECT id, email, name, role::text AS role, "createdAt"
            FROM "User"
            WHERE LOWER(COALESCE(email, '')) LIKE ${`%${query}%`}
               OR LOWER(COALESCE(name, '')) LIKE ${`%${query}%`}
            ORDER BY "updatedAt" DESC
            LIMIT 20
          `,
        )
      : [];

    const users = await Promise.all(
      userRows.map(async (user) => {
        const [limit, usage] = await Promise.all([
          getCloudUsageUserLimit(prisma, user.id),
          summarizeCloudUsage(prisma, user.id),
        ]);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
          limit,
          usage,
        };
      }),
    );

    return apiSuccess({
      global: {
        limit: globalLimit,
        usage: globalUsage,
      },
      users,
    });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiError('INTERNAL_ERROR', 503, '数据库不可用，无法更新云端额度配置');
  }

  let body: {
    scope?: 'global' | 'user' | 'bulk-users';
    userId?: string;
    userIds?: string[];
    targetRole?: 'STUDENT' | 'TEACHER' | 'ALL';
    enabled?: boolean;
    disabled?: boolean;
    monthlyCostLimitUsd?: unknown;
    monthlyRequestLimit?: unknown;
    note?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError('INVALID_REQUEST', 400, '请求体不是有效 JSON');
  }

  const monthlyCostLimitUsd = normalizeNullableNumber(body.monthlyCostLimitUsd);
  const monthlyRequestLimit = normalizeNullableInt(body.monthlyRequestLimit);

  try {
    if (body.scope === 'global') {
      await prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO "CloudUsageGlobalLimit" (
            "id", "enabled", "monthlyCostLimitUsd", "monthlyRequestLimit", "updatedBy", "updatedAt"
          )
          VALUES (
            'global',
            ${Boolean(body.enabled)},
            ${monthlyCostLimitUsd},
            ${monthlyRequestLimit},
            ${admin.identity.email ?? admin.identity.userId},
            CURRENT_TIMESTAMP
          )
          ON CONFLICT ("id") DO UPDATE SET
            "enabled" = EXCLUDED."enabled",
            "monthlyCostLimitUsd" = EXCLUDED."monthlyCostLimitUsd",
            "monthlyRequestLimit" = EXCLUDED."monthlyRequestLimit",
            "updatedBy" = EXCLUDED."updatedBy",
            "updatedAt" = CURRENT_TIMESTAMP
        `,
      );

      const [limit, usage] = await Promise.all([
        getCloudUsageGlobalLimit(prisma),
        summarizeCloudUsage(prisma),
      ]);
      return apiSuccess({ global: { limit, usage } });
    }

    if (body.scope === 'user') {
      const userId = body.userId?.trim();
      if (!userId) return apiError('MISSING_REQUIRED_FIELD', 400, '缺少用户 ID');

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!user) return apiError('INVALID_REQUEST', 404, '用户不存在');

      await prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO "CloudUsageUserLimit" (
            "userId", "monthlyCostLimitUsd", "monthlyRequestLimit", "disabled", "note", "updatedBy", "updatedAt"
          )
          VALUES (
            ${userId},
            ${monthlyCostLimitUsd},
            ${monthlyRequestLimit},
            ${Boolean(body.disabled)},
            ${body.note?.trim() || null},
            ${admin.identity.email ?? admin.identity.userId},
            CURRENT_TIMESTAMP
          )
          ON CONFLICT ("userId") DO UPDATE SET
            "monthlyCostLimitUsd" = EXCLUDED."monthlyCostLimitUsd",
            "monthlyRequestLimit" = EXCLUDED."monthlyRequestLimit",
            "disabled" = EXCLUDED."disabled",
            "note" = EXCLUDED."note",
            "updatedBy" = EXCLUDED."updatedBy",
            "updatedAt" = CURRENT_TIMESTAMP
        `,
      );

      const [limit, usage] = await Promise.all([
        getCloudUsageUserLimit(prisma, userId),
        summarizeCloudUsage(prisma, userId),
      ]);
      return apiSuccess({ user: { id: userId, limit, usage } });
    }

    if (body.scope === 'bulk-users') {
      const targetRole = body.targetRole || 'ALL';
      const bulkRoles: UserRole[] = ['STUDENT', 'TEACHER'];
      const selectedUserIds = Array.isArray(body.userIds)
        ? Array.from(
            new Set(
              body.userIds
                .map((id) => (typeof id === 'string' ? id.trim() : ''))
                .filter(Boolean),
            ),
          )
        : [];
      const where =
        selectedUserIds.length > 0
          ? { id: { in: selectedUserIds }, role: { in: bulkRoles }, isActive: true }
          : targetRole === 'STUDENT' || targetRole === 'TEACHER'
          ? { role: targetRole, isActive: true }
          : { role: { in: bulkRoles }, isActive: true };
      const users = await prisma.user.findMany({
        where,
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
      });

      if (!users.length) {
        return apiSuccess({ updatedCount: 0, users: [] });
      }

      const updatedBy = admin.identity.email ?? admin.identity.userId;
      await prisma.$transaction(
        users.map((user) =>
          prisma.$executeRaw(
            Prisma.sql`
              INSERT INTO "CloudUsageUserLimit" (
                "userId", "monthlyCostLimitUsd", "monthlyRequestLimit", "disabled", "note", "updatedBy", "updatedAt"
              )
              VALUES (
                ${user.id},
                ${monthlyCostLimitUsd},
                ${monthlyRequestLimit},
                ${Boolean(body.disabled)},
                ${body.note?.trim() || null},
                ${updatedBy},
                CURRENT_TIMESTAMP
              )
              ON CONFLICT ("userId") DO UPDATE SET
                "monthlyCostLimitUsd" = EXCLUDED."monthlyCostLimitUsd",
                "monthlyRequestLimit" = EXCLUDED."monthlyRequestLimit",
                "disabled" = EXCLUDED."disabled",
                "note" = EXCLUDED."note",
                "updatedBy" = EXCLUDED."updatedBy",
                "updatedAt" = CURRENT_TIMESTAMP
            `,
          ),
        ),
      );

      return apiSuccess({
        updatedCount: users.length,
        users: users.map((user) => ({ id: user.id })),
      });
    }

    return apiError('INVALID_REQUEST', 400, 'scope 必须是 global、user 或 bulk-users');
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
