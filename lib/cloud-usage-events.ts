export const WEEKLY_USAGE_UPDATED_EVENT = 'syntara-weekly-usage-updated';

export function dispatchWeeklyUsageUpdated() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(WEEKLY_USAGE_UPDATED_EVENT));
}
