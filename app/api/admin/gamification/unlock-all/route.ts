import { CharacterAssetType } from '@prisma/client';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { getGamificationSummary } from '@/lib/server/gamification';
import { USER_AVATAR_GACHA_CATALOG } from '@/lib/constants/user-avatars';

type UnlockAllRequestBody = {
  userId?: string;
};

const LIVE2D_FRAGMENT_TARGET = 10;
const TEST_UNLOCK_AFFINITY_LEVEL = 20;
const TEST_UNLOCK_AFFINITY_EXP = 2000;
const DEFAULT_PREFERRED_CHARACTER_ID = 'mark';

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiError('INTERNAL_ERROR', 503, '数据库不可用，无法执行测试解锁');
  }

  let body: UnlockAllRequestBody;
  try {
    body = (await request.json()) as UnlockAllRequestBody;
  } catch {
    return apiError('INVALID_REQUEST', 400, '请求体不是有效 JSON');
  }

  const userId = body.userId?.trim();
  if (!userId) {
    return apiError('MISSING_REQUIRED_FIELD', 400, '缺少 userId');
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 先调用 summary，确保 catalog/profile/progress 已初始化。
      await getGamificationSummary(tx, userId);

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true },
      });
      if (!user) {
        throw new Error('用户不存在');
      }

      const [live2dRows, avatarRows] = await Promise.all([
        tx.userCharacterProgress.findMany({
          where: {
            userId,
            character: { assetType: CharacterAssetType.LIVE2D },
          },
          select: { characterId: true, equippedAt: true },
        }),
        tx.userCharacterProgress.findMany({
          where: {
            userId,
            character: { assetType: CharacterAssetType.AVATAR },
          },
          select: { characterId: true },
        }),
      ]);

      await tx.userCharacterProgress.updateMany({
        where: {
          userId,
          character: { assetType: CharacterAssetType.LIVE2D },
        },
        data: {
          isUnlocked: true,
          fragmentCount: LIVE2D_FRAGMENT_TARGET,
          affinityLevel: TEST_UNLOCK_AFFINITY_LEVEL,
          affinityExp: TEST_UNLOCK_AFFINITY_EXP,
        },
      });

      await tx.userCharacterProgress.updateMany({
        where: {
          userId,
          character: { assetType: CharacterAssetType.AVATAR },
        },
        data: {
          isUnlocked: true,
          fragmentCount: 1,
        },
      });

      const hasEquippedLive2d = live2dRows.some((row) => row.equippedAt != null);
      if (!hasEquippedLive2d) {
        await tx.userCharacterProgress.updateMany({
          where: {
            userId,
            character: { assetType: CharacterAssetType.LIVE2D },
          },
          data: { equippedAt: null },
        });

        const preferredId = live2dRows.some((row) => row.characterId === DEFAULT_PREFERRED_CHARACTER_ID)
          ? DEFAULT_PREFERRED_CHARACTER_ID
          : (live2dRows[0]?.characterId ?? DEFAULT_PREFERRED_CHARACTER_ID);

        await tx.userCharacterProgress.updateMany({
          where: {
            userId,
            characterId: preferredId,
          },
          data: { equippedAt: new Date() },
        });

        await tx.userEngagementProfile.upsert({
          where: { userId },
          create: {
            userId,
            preferredCharacterId: preferredId,
            avatarInventory: {
              version: 1,
              ownedIds: USER_AVATAR_GACHA_CATALOG.map((item) => item.id),
              fragmentCounts: {},
            },
          },
          update: {
            preferredCharacterId: preferredId,
            avatarInventory: {
              version: 1,
              ownedIds: USER_AVATAR_GACHA_CATALOG.map((item) => item.id),
              fragmentCounts: {},
            },
          },
        });
      } else {
        await tx.userEngagementProfile.upsert({
          where: { userId },
          create: {
            userId,
            preferredCharacterId: DEFAULT_PREFERRED_CHARACTER_ID,
            avatarInventory: {
              version: 1,
              ownedIds: USER_AVATAR_GACHA_CATALOG.map((item) => item.id),
              fragmentCounts: {},
            },
          },
          update: {
            avatarInventory: {
              version: 1,
              ownedIds: USER_AVATAR_GACHA_CATALOG.map((item) => item.id),
              fragmentCounts: {},
            },
          },
        });
      }

      return {
        user,
        unlockedLive2dCount: live2dRows.length,
        unlockedAvatarCharacterCount: avatarRows.length,
        unlockedAvatarInventoryCount: USER_AVATAR_GACHA_CATALOG.length,
      };
    });

    return apiSuccess({
      success: true,
      user: result.user,
      unlockedLive2dCount: result.unlockedLive2dCount,
      unlockedAvatarCharacterCount: result.unlockedAvatarCharacterCount,
      unlockedAvatarInventoryCount: result.unlockedAvatarInventoryCount,
    });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}

