import { apiSuccess } from '@/lib/server/api-response';
import { requireUserId } from '@/lib/server/api-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

/**
 * The global navigation only needs the equipped character's affinity level.
 * Keep this read path separate from the full gamification
 * summary, whose catalog/profile/mission bootstrap work is intentionally much
 * heavier and may write missing rows.
 */
export async function GET() {
  const auth = await requireUserId();
  if ('response' in auth) return auth.response;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiSuccess({ affinityLevel: 1 });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: {
      characterProgress: {
        where: {
          equippedAt: { not: null },
        },
        orderBy: {
          equippedAt: 'desc',
        },
        take: 1,
        select: {
          affinityLevel: true,
        },
      },
    },
  });

  return apiSuccess({
    affinityLevel: user?.characterProgress[0]?.affinityLevel ?? 1,
  });
}
