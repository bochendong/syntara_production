import type { AppNotification } from '@/lib/notifications/types';
import type { Live2DPresenterModelId } from '@/lib/live2d/presenter-models';

const SIGN_IN_RELATED_SOURCE_KINDS = new Set([
  'DAILY_SIGN_IN_REWARD',
  'DAILY_TASK_REWARD',
  'STREAK_BONUS',
]);

export function resolveNotificationCompanionModelId(
  item: Pick<AppNotification, 'sourceKind'> | null | undefined,
  notificationCompanionId: Live2DPresenterModelId,
  checkInCompanionId: Live2DPresenterModelId,
): Live2DPresenterModelId {
  if (item && SIGN_IN_RELATED_SOURCE_KINDS.has(item.sourceKind)) {
    return checkInCompanionId;
  }
  return notificationCompanionId;
}
