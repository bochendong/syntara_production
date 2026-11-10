export function getCloudUsageWeekWindow(now = new Date()): { start: Date; end: Date } {
  const start = new Date(now);
  const day = start.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return { start, end };
}

export function parseCloudUsageWeek(date: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000-')) return null;

  const day = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) {
    return null;
  }

  const week = getCloudUsageWeekWindow(day);
  return week.start < getCloudUsageWeekWindow(now).end ? week : null;
}
