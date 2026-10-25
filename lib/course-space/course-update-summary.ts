/** 机构课程「发布新版」后，给加入的人看的更新摘要。服务端和 App 共用。 */
export type CourseUpdateSummary = {
  addedProblems: number;
  updatedProblems: number;
  addedNotebooks: number;
  updatedNotebooks: number;
};

export function hasCourseUpdateContent(summary: CourseUpdateSummary | null | undefined): boolean {
  return Boolean(
    summary &&
    summary.addedProblems +
      summary.updatedProblems +
      summary.addedNotebooks +
      summary.updatedNotebooks >
      0,
  );
}

/** 「+3 题，改了 1 篇笔记」；没有具体变化时返回空串。 */
export function formatCourseUpdateSummary(summary: CourseUpdateSummary | null | undefined): string {
  if (!summary) return '';
  const parts: string[] = [];
  if (summary.addedProblems) parts.push(`+${summary.addedProblems} 题`);
  if (summary.addedNotebooks) parts.push(`+${summary.addedNotebooks} 篇笔记`);
  if (summary.updatedProblems) parts.push(`改了 ${summary.updatedProblems} 道题`);
  if (summary.updatedNotebooks) parts.push(`改了 ${summary.updatedNotebooks} 篇笔记`);
  return parts.join('，');
}
