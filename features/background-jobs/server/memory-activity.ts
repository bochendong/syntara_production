import type { Prisma } from '@/lib/server/generated-prisma';
import type { MemoryJobActivity } from '../domain/memory-activity';
import { type JobDb, unpackResult } from './store';

const select = {
  id: true,
  courseId: true,
  kind: true,
  status: true,
  attempts: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  result: true,
} satisfies Prisma.BackgroundJobSelect;

type MemoryJobRow = Prisma.BackgroundJobGetPayload<{ select: typeof select }>;

/** Only committed results count as a write. Never expose prompts, notes, or provider errors. */
export function memoryJobActivity(job: MemoryJobRow): MemoryJobActivity {
  const conversation = job.kind === 'conversation-memory';
  const activity: MemoryJobActivity = {
    id: job.id,
    courseId: job.courseId,
    status: 'queued',
    title: job.attempts ? '记忆整理等待重试' : '学习记忆等待整理',
    description: job.attempts
      ? '这次整理暂未完成，系统会自动重试。你可以继续学习。'
      : '新的学习信息已收到，稍后会整理需要记住的内容。',
    chips: [conversation ? '课程对话' : '学习互动'],
    createdAt: job.createdAt.getTime(),
    updatedAt: job.updatedAt.getTime(),
  };
  if (job.status === 'queued') return activity;
  if (job.status === 'running') {
    return {
      ...activity,
      status: 'running',
      title: '正在整理学习记忆',
      description: '正在核对这次互动中的学习信息，确认哪些内容值得记住。',
    };
  }
  activity.finishedAt = (job.completedAt ?? job.updatedAt).getTime();
  if (job.status === 'failed') {
    return {
      ...activity,
      status: 'failed',
      title: '学习记忆整理未完成',
      description: '多次尝试后仍未完成这次整理，原有记忆不受影响。',
    };
  }
  const result = job.result
    ? unpackResult<{ notes?: string[]; conversationId?: string; skipped?: string }>(job.result)
    : null;
  if (job.status !== 'completed' || !result) {
    return {
      ...activity,
      status: 'failed',
      title: '学习记忆结果暂不可用',
      description: '暂时无法确认这次记忆更新的结果。',
    };
  }
  const count = result.notes?.length ?? 0;
  if (!result.skipped && (count || result.conversationId)) {
    return {
      ...activity,
      status: 'completed',
      title: count ? `已更新 ${count} 条学习记忆` : '对话记忆已更新',
      description: count
        ? '已保存这次互动中有依据的学习信息，之后回答时可以参考。'
        : '已保存这次对话的摘要，方便下次继续交流；没有新增学习状态或偏好。',
    };
  }
  return {
    ...activity,
    status: 'skipped',
    title: '本次没有新增记忆',
    description:
      result.skipped === 'source-changed'
        ? '对话内容已变化，这次整理结果没有写入。'
        : result.skipped === 'already-summarized'
          ? '这段对话已有摘要，无需重复保存。'
          : result.skipped
            ? '这次没有可保存的新内容，原有记忆保持不变。'
            : '没有发现需要新增或更新的学习信息。',
  };
}

export async function readMemoryJobActivities(
  db: JobDb,
  ownerId: string,
  courseId: string,
  now = Date.now(),
): Promise<MemoryJobActivity[]> {
  // Index tasks are implementation steps of the same write, not additional memories.
  const where = { ownerId, courseId, kind: { in: ['learner-note', 'conversation-memory'] } };
  const [active, recent] = await Promise.all([
    db.backgroundJob.findMany({
      where: { ...where, status: { in: ['queued', 'running'] } },
      select,
      orderBy: { createdAt: 'asc' },
      take: 50,
    }),
    db.backgroundJob.findMany({
      where: {
        ...where,
        status: { in: ['completed', 'failed'] },
        updatedAt: { gte: new Date(now - 7 * 24 * 60 * 60 * 1000) },
      },
      select,
      orderBy: { updatedAt: 'desc' },
      take: 30,
    }),
  ]);
  // A job can finish between the two reads; prefer its terminal result.
  return [...new Map([...active, ...recent].map((job) => [job.id, job])).values()]
    .map(memoryJobActivity)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
