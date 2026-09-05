import type { NotebookProblemAttemptRecord } from './schema';

export function codeTestSummaryFeedback(
  summary: { total: number; failed: number; failureSummary?: string },
  label: 'public' | 'secret',
  locale: 'zh-CN' | 'en-US',
): string {
  const name = locale === 'zh-CN' ? (label === 'public' ? '公开测试' : '隐藏测试') : label;
  // Also correct misleading summaries already persisted by older judges.
  if (summary.total === 0) {
    return locale === 'zh-CN' ? `未执行${name}。` : `No ${name} tests were run.`;
  }
  if (summary.failureSummary) {
    return locale === 'zh-CN'
      ? summary.failureSummary
          .replaceAll('Public tests', '公开测试')
          .replaceAll('Secret tests', '隐藏测试')
      : summary.failureSummary;
  }
  return locale === 'zh-CN'
    ? summary.failed > 0
      ? `${name} 有 ${summary.failed} 个未通过。`
      : `${name} 全部通过。`
    : summary.failed > 0
      ? `${summary.failed} ${name} test${summary.failed === 1 ? '' : 's'} failed.`
      : `All ${name} tests passed.`;
}

export function shouldShowAttemptFeedback(attempt: NotebookProblemAttemptRecord): boolean {
  if (!attempt.result?.feedback) return false;
  if (attempt.status === 'error') return true;
  if ([attempt.result.publicSummary, attempt.result.secretSummary].some((s) => s?.total === 0)) {
    return true;
  }
  const hasCodeTestSummary =
    (attempt.kind === 'run' || attempt.kind === 'submit') &&
    (attempt.result.publicSummary ||
      attempt.result.secretSummary ||
      (attempt.result.publicCases?.length ?? 0) > 0);
  return !hasCodeTestSummary;
}
