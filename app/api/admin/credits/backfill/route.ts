import { CreditTransactionKind, type Prisma } from '@prisma/client';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

const TARGET_CREDITS = 500;
const PREVIEW_LIMIT = 10;

type PreviewUser = {
  id: string;
  email: string | null;
  name: string | null;
  creditsBalance: number;
  delta: number;
};

async function ensureLedgerInitialized(tx: Prisma.TransactionClient, userId: string) {
  const [user, existingTransactions] = await Promise.all([
    tx.user.findUnique({
      where: { id: userId },
      select: { creditsBalance: true },
    }),
    tx.creditTransaction.count({
      where: { userId },
    }),
  ]);

  if (!user) return null;
  if (existingTransactions > 0) return user.creditsBalance;

  await tx.creditTransaction.create({
    data: {
      userId,
      kind: CreditTransactionKind.WELCOME_BONUS,
      delta: 0,
      balanceAfter: user.creditsBalance,
      description: 'Credits ledger initialized before 500-credit admin backfill',
      referenceType: 'credits_backfill_init',
      referenceId: 'admin-backfill-500',
      metadata: {
        targetCredits: TARGET_CREDITS,
      },
    },
  });

  return user.creditsBalance;
}

async function loadPreview() {
  const prisma = getOptionalPrisma();
  if (!prisma) throw new Error('数据库不可用，无法预览积分补发');

  const rows = await prisma.user.findMany({
    where: {
      creditsBalance: {
        lt: TARGET_CREDITS,
      },
    },
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true,
      email: true,
      name: true,
      creditsBalance: true,
    },
  });

  const users: PreviewUser[] = rows.map((row) => ({
    ...row,
    delta: TARGET_CREDITS - row.creditsBalance,
  }));

  return {
    targetCredits: TARGET_CREDITS,
    affectedUsers: users.length,
    totalCreditsToGrant: users.reduce((sum, row) => sum + row.delta, 0),
    previewUsers: users.slice(0, PREVIEW_LIMIT),
  };
}

export async function GET() {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  try {
    const preview = await loadPreview();
    return apiSuccess(preview);
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}

export async function POST() {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiError('INTERNAL_ERROR', 503, '数据库不可用，无法执行积分补发');
  }

  try {
    const preview = await loadPreview();
    const users = await prisma.user.findMany({
      where: { creditsBalance: { lt: TARGET_CREDITS } },
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true },
    });
    let updatedUsers = 0;
    let grantedCredits = 0;

    for (const user of users) {
      await prisma.$transaction(async (tx) => {
        const currentBalance = await ensureLedgerInitialized(tx, user.id);
        if (currentBalance == null) return;

        const delta = TARGET_CREDITS - currentBalance;
        if (delta <= 0) return;

        const nextBalance = currentBalance + delta;

        await tx.user.update({
          where: { id: user.id },
          data: { creditsBalance: nextBalance },
        });

        await tx.creditTransaction.create({
          data: {
            userId: user.id,
            kind: CreditTransactionKind.WELCOME_BONUS,
            delta,
            balanceAfter: nextBalance,
            description: `One-time backfill to ${TARGET_CREDITS} welcome credits`,
            referenceType: 'credits_backfill',
            referenceId: admin.identity.userId,
            metadata: {
              targetCredits: TARGET_CREDITS,
              balanceBefore: currentBalance,
              balanceAfter: nextBalance,
              adminUserId: admin.identity.userId,
              adminEmail: admin.identity.email ?? null,
            },
          },
        });

        updatedUsers += 1;
        grantedCredits += delta;
      });
    }

    return apiSuccess({
      targetCredits: TARGET_CREDITS,
      affectedUsers: updatedUsers,
      totalCreditsGranted: grantedCredits,
      previewAffectedUsers: preview.affectedUsers,
      previewTotalCreditsToGrant: preview.totalCreditsToGrant,
    });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
