import { z } from 'zod';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,78}$/, 'slug 只能包含小写字母、数字和连字符'),
  logoUrl: z.string().trim().url().max(500).nullable().optional(),
  verified: z.boolean().optional(),
  /** 机构成员（可编辑、上架该机构课程的账号）的邮箱 */
  memberEmails: z.array(z.string().trim().email()).max(50).optional(),
});

export async function GET() {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiError('INTERNAL_ERROR', 503, '数据库不可用，无法读取机构');
  }

  const organizations = await prisma.organization.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      slug: true,
      name: true,
      logoUrl: true,
      verified: true,
      members: { select: { role: true, user: { select: { id: true, email: true, name: true } } } },
      _count: { select: { courses: true } },
    },
  });
  return apiSuccess({ organizations });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiError('INTERNAL_ERROR', 503, '数据库不可用，无法创建机构');
  }

  const parsed = createOrganizationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('INVALID_REQUEST', 400, '参数无效', parsed.error.message);
  }
  const { memberEmails = [], ...data } = parsed.data;

  try {
    const users = memberEmails.length
      ? await prisma.user.findMany({
          where: { email: { in: memberEmails, mode: 'insensitive' } },
          select: { id: true },
        })
      : [];
    const organization = await prisma.organization.upsert({
      where: { slug: data.slug },
      create: data,
      update: {
        name: data.name,
        ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
        ...(data.verified !== undefined ? { verified: data.verified } : {}),
      },
      select: { id: true, slug: true, name: true, logoUrl: true, verified: true },
    });
    if (users.length > 0) {
      await prisma.organizationMember.createMany({
        data: users.map((user) => ({ organizationId: organization.id, userId: user.id })),
        skipDuplicates: true,
      });
    }
    return apiSuccess({ organization }, 201);
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
