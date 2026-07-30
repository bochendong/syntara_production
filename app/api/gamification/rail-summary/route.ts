import { apiSuccess } from '@/lib/server/api-response';
import { requireUserId } from '@/lib/server/api-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

const EMPTY_BALANCES = {
  cash: 0,
  compute: 0,
  purchase: 0,
} as const;

/**
 * The global navigation only needs three balances and the equipped character's
 * affinity level. Keep this read path separate from the full gamification
 * summary, whose catalog/profile/mission bootstrap work is intentionally much
 * heavier and may write missing rows.
 */
export async function GET() {
  const auth = await requireUserId();
  if ('response' in auth) return auth.response;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiSuccess({
      affinityLevel: 1,
      balances: EMPTY_BALANCES,
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: {
      creditsBalance: true,
      computeCreditsBalance: true,
      purchaseCreditsBalance: true,
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
    balances: user
      ? {
          cash: user.creditsBalance,
          compute: user.computeCreditsBalance,
          purchase: user.purchaseCreditsBalance,
        }
      : EMPTY_BALANCES,
  });
}
