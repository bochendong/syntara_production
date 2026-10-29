export type SubmissionFeedback = {
  tone: 'success' | 'warning' | 'error' | 'neutral';
  title: string;
  description: string;
};

type GradedAnswer = {
  status: 'passed' | 'partial' | 'failed' | 'pending';
  score: number | null;
  label?: string;
};

/** Only include the questions submitted now, never the other unanswered parts. */
export function submissionFeedback(results: GradedAnswer[], multipart = false): SubmissionFeedback {
  const scope = multipart
    ? results.length === 1
      ? `小问 (${results[0].label?.replace(/^[（(]|[）)]$/g, '')})：`
      : '本次提交：'
    : '';
  const status =
    !results.length || results.some((item) => item.status === 'pending')
      ? 'pending'
      : results.every((item) => item.status === 'passed')
        ? 'passed'
        : results.every((item) => item.status === 'failed')
          ? 'failed'
          : 'partial';
  const score = results.length === 1 ? results[0].score : null;
  const scoreText =
    status !== 'pending' && score !== null && Number.isFinite(score)
      ? `得分 ${Math.round(Math.max(0, Math.min(1, score)) * 100)}%。`
      : '';
  const messages = {
    passed: { tone: 'success', title: '答对了', description: '可以继续检查，或手动前往下一题。' },
    partial: {
      tone: 'warning',
      title: '部分正确',
      description: '查看批改反馈后，可以修改再提交。',
    },
    failed: { tone: 'error', title: '答错了', description: '查看批改反馈后，可以修改再提交。' },
    pending: {
      tone: 'warning',
      title: '批改未完成',
      description: '作答已保存，尚未得出对错结果，请稍后重试。',
    },
  } as const;
  const message = messages[status];
  return {
    tone: message.tone,
    title: scope + message.title,
    description: scoreText + message.description,
  };
}
