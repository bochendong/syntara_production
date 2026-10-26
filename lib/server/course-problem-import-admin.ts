import { Prisma, type PrismaClient } from '@/lib/server/generated-prisma';
import { isAuthorizedAdminIdentity } from '@/lib/server/admin-identity';

const authority = Symbol('authenticated-course-problem-import-admin');
export type CourseProblemImportAdmin = Readonly<{
  [authority]: true;
  kind: 'authenticated-admin';
  userId: string;
  courseId: string;
  dataOwnerId: string;
}>;

/** Uses persisted identity and the existing admin policy; never accepts email/role from a request body. */
export async function resolveCourseProblemImportAdmin(args: {
  db: PrismaClient;
  userId: string;
  courseId: string;
  dataOwnerId: string;
}): Promise<CourseProblemImportAdmin | null> {
  const profile = await args.db.user.findUnique({
    where: { id: args.userId },
    select: { email: true },
  });
  if (!profile) return null;
  let role: string | null = null;
  try {
    // Same migration-compatible role query used by requireAdmin.
    const rows = await args.db.$queryRaw<Array<{ role: string }>>(
      Prisma.sql`SELECT role::text AS "role" FROM "User" WHERE id = ${args.userId} LIMIT 1`,
    );
    role = rows[0]?.role ?? null;
  } catch {
    /* Older schemas retain the existing allowlist fallback. */
  }
  if (!isAuthorizedAdminIdentity({ userId: args.userId, email: profile.email }, role)) return null;
  return Object.freeze({
    [authority]: true as const,
    kind: 'authenticated-admin' as const,
    userId: args.userId,
    courseId: args.courseId,
    dataOwnerId: args.dataOwnerId,
  });
}

export function assertCourseProblemImportAdmin(
  context: CourseProblemImportAdmin,
  courseId: string,
  dataOwnerId: string,
) {
  if (
    context?.[authority] !== true ||
    context.courseId !== courseId ||
    context.dataOwnerId !== dataOwnerId
  )
    throw new Error('The authenticated administrator authority does not match this course.');
}

export function courseProblemImportAdminAudit(context: CourseProblemImportAdmin) {
  return { kind: context.kind, userId: context.userId, dataOwnerId: context.dataOwnerId };
}
