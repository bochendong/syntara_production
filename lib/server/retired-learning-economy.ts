import { apiError } from '@/lib/server/api-response';

/** Old clients receive an explicit retirement response without reading or writing accounts. */
export function retiredLearningEconomyResponse() {
  return apiError('INVALID_REQUEST', 410, '学习积分、奖励和抽奖功能已停用。');
}
