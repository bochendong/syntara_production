/** Display estimates only; completion always comes from the task status. */
export type ProgressTask = {
  status: string;
  kind: string;
  stage: string;
  progress?: number;
  createdAt: number;
  updatedAt: number;
};

export function taskTimeEstimate(kind: string) {
  if (kind === 'problem_bank_import') return { seconds: 240, label: '预计 2–6 分钟' };
  if (kind === 'mind_map') return { seconds: 180, label: '预计 2–5 分钟' };
  if (kind === 'mini-lecture') return { seconds: 300, label: '预计 3–8 分钟' };
  return { seconds: 180, label: '预计 1–5 分钟' };
}

// Each real stage owns a bounded interval. A timer cannot enter the next stage.
const stages: Record<string, [number, number, number]> = {
  extracting: [5, 12, 30],
  extracting_structure: [40, 84, 150],
  converting_to_pdf: [12, 24, 40],
  uploading_to_openai: [25, 39, 40],
  extracting_questions: [40, 90, 200],
  writing_knowledge: [25, 39, 45],
  generating_notebook: [40, 84, 150],
  creating_notebook_reference: [85, 96, 20],
  persisting_notebook: [85, 96, 20],
  generating_mind_map: [15, 59, 60],
  generating_image: [60, 84, 140],
  persisting_mind_map: [85, 96, 20],
};

export function estimateTaskProgress(task: ProgressTask, now: number) {
  if (task.status === 'completed') return { percent: 100, hint: '已完成' };
  // Some legacy failures carry progress=100. Never render that as completed work.
  if (task.status === 'failed' || task.status === 'cancelled')
    return { percent: null, hint: task.status === 'failed' ? '处理失败，可重试' : '已取消' };
  const estimate = taskTimeEstimate(task.kind);
  const waited = Math.max(0, Math.floor((now - task.createdAt) / 60_000));
  const waitedLabel =
    waited >= 1440
      ? `${Math.floor(waited / 1440)} 天`
      : waited >= 60
        ? `${Math.floor(waited / 60)} 小时`
        : `${waited} 分钟`;
  if (task.status === 'queued')
    return {
      percent: 0,
      hint: `等待开始${waited ? ` · 已等待 ${waitedLabel}` : ''} · 开始后${estimate.label}`,
    };
  const [floor, ceiling, seconds] = stages[task.stage] ?? [3, 92, estimate.seconds];
  const elapsed = Math.max(0, (now - task.updatedAt) / 1000);
  const reported = Number.isFinite(task.progress) ? task.progress! : 0;
  const baseline = Math.max(floor, Math.min(ceiling, reported));
  const percent = Math.floor(baseline + (ceiling - baseline) * (1 - Math.exp(-elapsed / seconds)));
  return {
    percent,
    hint:
      elapsed > seconds * 1.8
        ? '本阶段耗时较长，尚未收到完成结果；状态会自动更新'
        : `总耗时${estimate.label} · 进度为估算，复杂内容可能更久`,
  };
}
